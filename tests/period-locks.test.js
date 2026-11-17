'use strict';
/* ============================================================
   قفل الفترات المنتهية (القاعدة): مشغّل يرفض أي إضافة/تعديل/حذف داخل فترة مقفلة،
   والقفل في عمود مستقل period_locks لا يكتبه حفظ الإعدادات (features) أبدًا.
   (تحقق وظيفي على Postgres محلي: التعديل والحذف وتغيير التسليم في المقفلة مرفوضة، والفترة الجارية مسموحة،
   والفتح للتعديل يسمح، وما بعد حذف الطالب لا يُمنع.)
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp } = require('./load-app');
const root = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
const BLK = SQL.slice(SQL.indexOf('-- قفل الفترات المنتهية'), SQL.indexOf('-- ============ استبانة رضا المستفيدين'));
const fn = name => { const i = BLK.indexOf('create or replace function public.' + name); return BLK.slice(i, BLK.indexOf('$fn$;', i)); };

test('SQL: القفل في عمود مستقل على الإعدادات (لا يكتبه حفظ features) بقيد شكل وحجم', () => {
  assert.match(BLK, /alter table public\.user_app_settings add column if not exists period_locks jsonb not null default '\{\}'::jsonb;/);
  assert.match(BLK, /check \(jsonb_typeof\(period_locks\) = 'object' and octet_length\(period_locks::text\) <= 20000\)/);
  const a22 = fs.readFileSync(path.join(root, 'app', 'app-22-customize.js'), 'utf8');
  assert.doesNotMatch(a22, /period_locks/, 'saveAppFeatures لا يرسل period_locks فلا يمحوه جهاز قديم');
});

test('SQL: الحارس قبل الكتابة على الجداول الأربعة، يفحص الصف القديم والجديد، وبلا تنفيذ مباشر', () => {
  assert.match(BLK, /array\['classroom_grade_period_scores', 'classroom_homework_status', 'classroom_task_students', 'classroom_tool_marks'\] loop/);
  assert.match(BLK, /before insert or update or delete on public\.%I for each row execute function public\.grade_lock_guard\(\)/);
  const g = fn('grade_lock_guard');
  assert.match(g, /tg_op in \('UPDATE', 'DELETE'\) and public\.grade_lock_blocked\(tg_table_name, to_jsonb\(old\)\)/);
  assert.match(g, /tg_op in \('INSERT', 'UPDATE'\) and public\.grade_lock_blocked\(tg_table_name, to_jsonb\(new\)\)/);
  ['grade_lock_blocked(text, jsonb)', 'grade_lock_guard()'].forEach(f =>
    assert.match(BLK, new RegExp('revoke execute on function public\\.' + f.replace(/[()]/g, '\\$&') + ' from public, anon, authenticated;')));
});

test('SQL: ما يُقفل — الفترة بالرقم للمرصود بفترة، وبالتاريخ للمؤرَّخ؛ والحذف المتتابع والاسترجاع لا يُمنعان', () => {
  const b = fn('grade_lock_blocked');
  assert.match(b, /return v_per <= coalesce\(\(v_lock->>'p'\)::smallint, 0\);/);
  assert.match(b, /v_date < \(v_lock->>'before'\)::date/);
  assert.match(b, /if not exists \(select 1 from public\.classroom_students s where s\.id = \(r->>'student_id'\)::uuid\) then return false;/, 'حذف الطالب');
  assert.match(b, /coalesce\(t\.due_date, t\.created_at::date\)/, 'تاريخ المهمة كما في التطبيق');
  assert.match(b, /current_setting\('shahid\.lock_bypass', true\)/);
  assert.match(SQL, /perform set_config\('shahid\.lock_bypass', 'on', true\);/, 'استرجاع السلة يتجاوز القفل');
  assert.match(SQL.slice(SQL.indexOf('create or replace function public.restore_deleted_item')), /perform set_config\('shahid\.lock_bypass'/);
});

test('SQL: set_period_lock بصلاحية المعلم، تعديل ذرّي لمفتاح واحد، ومدخلات محروسة، والمرآة حرفية', () => {
  const s = fn('set_period_lock');
  assert.match(s, /returns jsonb language plpgsql security invoker set search_path = ''/);
  assert.match(s, /p_term !~ '\^\[0-9٠-٩\/ -\]\{1,20\}\[\|\]\[12\]\$'/);
  assert.match(s, /p_key !~ '\^\(kind:\(participation\|homework\|task\)\|tool:\[0-9a-f-\]\{36\}\)\$'/);
  assert.match(s, /where s\.user_id = v_uid/);
  assert.doesNotMatch(BLK, /\\/, 'بلا شرطة مائلة (نسخة app-07 داخل نص JS)');
  assert.ok(loadApp().buildSchemaSql().includes(BLK.trim()), 'المرآة حرفية');
});

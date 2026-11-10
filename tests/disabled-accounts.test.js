'use strict';
/* فرض «تعطيل الحساب» من القاعدة (لا من الواجهة وحدها): سياسة مقيِّدة على كل جدول بيانات معلم + الحاويتين.
   يفشل الاختبار لو أُضيف جدول بيانات معلم جديد ولم يُضف لقائمة التعطيل. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const root = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
const BLK = SQL.slice(SQL.indexOf('-- فرض «تعطيل الحساب» من القاعدة نفسها'));
const listed = () => [...(/foreach v_t in array array\[([\s\S]*?)\] loop/.exec(BLK)[1]).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

test('كل جدول فيه teacher_id/user_id داخل قائمة التعطيل، والمستثنى مقصود', () => {
  const schema = runInAppContext(loadApp({}), 'buildSchemaSql()');
  const owned = new Set();
  for(const src of [SQL, schema]){
    for(const m of src.matchAll(/create table if not exists public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g)){
      if(/\b(teacher_id|user_id)\b/.test(m[2])) owned.add(m[1]);
    }
    for(const m of src.matchAll(/alter table public\.([a-z_]+) add column if not exists (teacher_id|user_id)\b/g)) owned.add(m[1]);
  }
  const missing = [...owned].filter(t => !listed().includes(t) && !['admins', 'login_attempts'].includes(t)).sort();
  assert.deepEqual(missing, [], 'جداول بيانات معلم خارج سياسة التعطيل');
  assert.ok(!listed().includes('profiles'), 'profiles مستثنى: منه يقرأ التطبيق حالة التعطيل');
});

test('السياسة مقيِّدة (restrictive) للقراءة والكتابة، والدالة بمسار بحث فارغ وبلا تنفيذ للزائر', () => {
  assert.match(BLK, /as restrictive for all to authenticated using \(not \(select public\.am_disabled\(\)\)\) with check \(not \(select public\.am_disabled\(\)\)\)/);
  assert.match(BLK, /function public\.am_disabled\(\)\s*returns boolean language sql stable security definer set search_path = ''/);
  assert.match(BLK, /revoke execute on function public\.am_disabled\(\) from public, anon/);
  assert.match(BLK, /on storage\.objects as restrictive[\s\S]*bucket_id not in \('shawahid-photos', 'report-shares'\)/);
});

test('مرآة buildSchemaSql: نفس الكتلة حرفيًا', () => {
  assert.ok(runInAppContext(loadApp({}), 'buildSchemaSql()').includes(BLK.trim()));
});

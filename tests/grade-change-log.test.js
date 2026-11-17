'use strict';
/* سجل نقص الدرجات (grade_change_log): مراقبة صامتة لكشف أي ضياع درجات (درجة رُصدت ثم اختفت أو نقصت).
   للمسؤول وحده، ولا يُفشل حفظ أي درجة. سُلوكه الفعلي (نقص/مسح/نقل، حذف تابع لحذف طالب أو عمود، تجاهل الزيادة،
   الحفظ ينجح لو تعطّل السجل) جُرِّب على PostgreSQL 16 محلي؛ هنا حرّاس البنية كي لا تنكسر بتعديل لاحق. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const root = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
const HEAD = '-- سجل نقص الدرجات (للمراجعة وضبط الجودة';
const blockOf = src => {
  const s = src.lastIndexOf('-- ====', src.indexOf(HEAD));
  return src.slice(s, src.indexOf('\n$do$;', s) + 6);
};
const B = blockOf(SQL);

test('الكتلة موجودة مرة واحدة ومرآة buildSchemaSql حرفية', () => {
  assert.equal(SQL.split(HEAD).length, 2);
  const schema = runInAppContext(loadApp({}), 'buildSchemaSql()');
  assert.ok(schema.includes(B), 'نسخة app-07 تختلف عن sql-updates');
  /* في البناء الكامل: بعد إنشاء جداول الدرجات الأربعة (وإلا تخطّاها التريجر بصمت) */
  const at = schema.indexOf(HEAD);
  ['classroom_grade_scores', 'classroom_grade_period_scores', 'classroom_tool_marks', 'classroom_rubric_marks'].forEach(t => {
    const c = schema.indexOf('create table if not exists public.' + t + ' (');
    assert.ok(c > -1 && c < at, t + ' يُنشأ قبل الكتلة');
  });
  assert.doesNotMatch(B, /\\|`|\$\{/, 'بلا شرطة مائلة ولا ` ولا ${ (نسخة app-07)');
});

test('التريجر على جداول الدرجات الأربعة، بعد التعديل والحذف فقط', () => {
  assert.match(B, /array\['classroom_grade_scores', 'classroom_grade_period_scores', 'classroom_tool_marks', 'classroom_rubric_marks'\]/);
  assert.match(B, /create trigger trg_log_grade_change after update or delete on public\.%I for each row execute function public\.log_grade_change\(\)/);
  assert.doesNotMatch(B, /after insert/i, 'الإضافة لا تُسجَّل');
});

test('يُسجَّل النقص والمسح والنقل فقط، والزيادة وإعادة نفس القيمة تُتجاهلان', () => {
  assert.match(B, /elsif v_new < v_old then\s+v_op := 'decrease';\s+else\s+return null;/);
  assert.match(B, /op text not null check \(op in \('delete', 'decrease', 'move'\)\)/);
});

test('فشل التسجيل لا يُفشل حفظ الدرجة', () => {
  assert.match(B, /exception when others then\s+raise warning 'grade_change_log: %', sqlerrm;/);
  assert.match(B, /return null;\s+end\s+\$fn\$;/);
});

test('للمسؤول وحده: قراءة فقط بسياسة is_admin، ولا كتابة لأحد إلا التريجر', () => {
  assert.match(B, /alter table public\.grade_change_log enable row level security;/);
  assert.equal((B.match(/create policy /g) || []).length, 1, 'سياسة واحدة');
  assert.match(B, /create policy "[^"]+" on public\.grade_change_log for select using \(public\.is_admin\(auth\.uid\(\)\)\);/);
  assert.match(B, /revoke all on public\.grade_change_log from anon;/);
  assert.match(B, /revoke insert, update, delete, truncate on public\.grade_change_log from authenticated;/);
  assert.match(B, /function public\.log_grade_change\(\) returns trigger\s+language plpgsql security definer set search_path = ''/);
  assert.match(B, /revoke execute on function public\.log_grade_change\(\) from public, anon, authenticated;/);
});

test('بلا مفاتيح أجنبية (الدليل يبقى بعد حذف الطالب/العمود)، وتنظيف بعد 90 يومًا', () => {
  const body = B.slice(B.indexOf('create table if not exists public.grade_change_log ('), B.indexOf('\n);', B.indexOf('create table if not exists public.grade_change_log (')));
  assert.doesNotMatch(body, /references/);
  assert.match(B, /delete from public\.grade_change_log where changed_at < now\(\) - interval '90 days';/);
});

test('ضمن سياسة تعطيل الحساب، وخارج النسخة الشاملة عمدًا', () => {
  const dis = /foreach v_t in array array\[([\s\S]*?)\] loop/.exec(SQL.slice(SQL.indexOf('-- فرض «تعطيل الحساب» من القاعدة نفسها')))[1];
  assert.match(dis, /'grade_change_log'/);
  const wl = /function public\.admin_backup_tables\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(SQL)[1];
  assert.doesNotMatch(wl, /grade_change_log/);
});

/* ============ بطاقة المصدر (x-grade-source) ============ */

test('القاعدة تقرأ البطاقة من ترويسة الطلب، وتقبل [a-z_] فقط، وفشل قراءتها لا يوقف التسجيل', () => {
  assert.match(B, /add column if not exists source text check \(source ~ '\^\[a-z_\]\{1,40\}\$'\)/);
  assert.match(B, /v_src := nullif\(current_setting\('request\.headers', true\), ''\)::json->>'x-grade-source';\s+if v_src !~ '\^\[a-z_\]\{1,40\}\$' then v_src := null; end if;\s+exception when others then\s+v_src := null;/);
  assert.match(B, /old_updated_at, parent_gone, source\)/);
});

test('gradeSrc: يضع الترويسة ويعيد نفس الطلب، وبلا setHeader يعيده كما هو', () => {
  const app = loadApp({});
  const r = runInAppContext(app, `(() => {
    const q = { h: null, setHeader(k, v){ this.h = [k, v]; return this; } };
    const plain = { x: 1 };
    return { same: gradeSrc(q, 'cell_clear') === q, h: q.h, plain: gradeSrc(plain, 'x') === plain };
  })()`);
  assert.equal(r.same, true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.h)), ['x-grade-source', 'cell_clear']);
  assert.equal(r.plain, true);
});

/* كل كتابة على جداول الدرجات (أو حذف صاحبها: طالب/عمود/أداة) تحمل بطاقة — وإلا ظهر مسحها في السجل «بلا بطاقة» كأنه مشبوه */
const SCORE_TABLES = ['classroom_grade_scores', 'classroom_grade_period_scores', 'classroom_tool_marks', 'classroom_rubric_marks'];
const PARENT_TABLES = ['classroom_grade_columns', 'classroom_custom_tools', 'classroom_students', 'classroom_rubric_criteria'];
const GRADE_RPCS = ['set_period_score', 'increment_grade_score', 'increment_period_score', 'set_column_counted_periods', 'restore_deleted_item'];
function untaggedWrites(){
  const bad = [];
  for(const f of fs.readdirSync(path.join(root, 'app')).filter(n => n.endsWith('.js'))){
    const s = fs.readFileSync(path.join(root, 'app', f), 'utf8');
    const at = i => f + ':' + (s.slice(0, i).split('\n').length);
    const tagged = i => /gradeSrc\($/.test(s.slice(Math.max(0, i - 9), i));
    for(const t of SCORE_TABLES.concat(PARENT_TABLES)){
      const re = new RegExp(`sb\\.from\\('${t}'\\)`, 'g'); let m;
      while((m = re.exec(s))){
        const chain = s.slice(m.index, m.index + 400).split(';')[0];
        const w = /\.(delete|upsert|update|insert)\(/.exec(chain);
        if(!w) continue;
        if(PARENT_TABLES.includes(t) && w[1] !== 'delete') continue; /* الصاحب: حذفه وحده يمسح درجات */
        if(!tagged(m.index)) bad.push(at(m.index) + ' ' + t + '.' + w[1]);
      }
    }
    for(const r of GRADE_RPCS){
      const re = new RegExp(`sb\\.rpc\\('${r}'`, 'g'); let m;
      while((m = re.exec(s))) if(!tagged(m.index)) bad.push(at(m.index) + ' rpc ' + r);
    }
  }
  return bad;
}

test('كل كتابة تمسّ الدرجات في app/ تمرّ بـgradeSrc (بطاقة مصدر)', () => {
  assert.deepEqual(untaggedWrites(), []);
});

test('الموصل: تعديل الدرجة يحمل بطاقة mcp_set_grades', () => {
  const src = fs.readFileSync(path.join(root, 'api', '_mcp-write.js'), 'utf8');
  assert.match(src, /setHeader\('x-grade-source', 'mcp_set_grades'\)/);
  assert.match(src, /await mcpGradeSrc\(supabase\.from\('classroom_grade_scores'\)\.update\(/);
});

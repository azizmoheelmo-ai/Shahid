'use strict';
/* ============================================================
   سجل الدرجات والاستعادة (app-55 + grade_history بالقاعدة)
   - مشغّل بالقاعدة يحفظ كل تغيير في جداول الدرجات الخمسة (قبل/بعد)، والمعلم يقرأ سجله فقط.
   - الاستعادة لما قبل لحظة: معاينة لا تكتب، ثم تطبيق في معاملة واحدة، والاستعادة نفسها تُسجَّل.
   (التحقق الوظيفي للدوال جرى على Postgres محلي بدوال الملف نفسها: مسح ثم استعادة ثم تراجع، ومعلم آخر لا يرى شيئًا.)
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const root = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
const BLK = SQL.slice(SQL.indexOf('-- سجل الدرجات والاستعادة (30 يومًا)'), SQL.indexOf('-- ============ استبانة رضا المستفيدين'));
const fnBody = name => { const i = BLK.indexOf('create or replace function public.' + name); return BLK.slice(i, BLK.indexOf('$fn$;', i)); };

function appWith(rpcs){
  const log = [];
  const client = {
    from(){ const api = { select(){ return api; }, eq(){ return api; }, in(){ return api; }, order(){ return api; }, limit(){ return api; }, then(r){ return Promise.resolve({ data: [], error: null }).then(r); } }; return api; },
    rpc(name, args){ log.push({ name, args }); const v = rpcs[name]; return Promise.resolve(typeof v === 'function' ? v(args) : (v || { data: null, error: null })); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__modal = ''; showInfoModal = h => { window.__modal = h; }; window.__closed = 0; closeCrmModal = () => { window.__closed++; };
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m); crmSectionLabel = () => 'ثاني ثانوي ١';
    window.__rendered = 0; renderCrmGrades = async () => { window.__rendered++; }; afterCrmGradesChanged = () => {};
    crmGrades = { sectionId: 'S1' };
    window.__btn = { disabled: false, textContent: 'استعادة' }; { const g = document.getElementById; document.getElementById = id => id === 'gradeRestoreBtn' ? window.__btn : g(id); }`);
  return { app, log };
}
const get = (app, e) => runInAppContext(app, e);
const MOMENTS = [{ at: '2026-11-17T10:12:00Z', changes: 133, deletes: 99, tbls: ['classroom_grade_period_scores', 'classroom_homework_status'] }, { at: '2026-11-17T09:00:00Z', changes: 2, deletes: 0, tbls: ['classroom_grade_scores'] }];

/* ============ الواجهة ============ */
test('القيم كما يفهمها المعلم', () => {
  const app = loadApp();
  assert.equal(app.gradeHistoryValue('classroom_homework_status', null), 'لم يسلّم');
  assert.equal(app.gradeHistoryValue('classroom_homework_status', 'partial'), 'ناقص');
  assert.equal(app.gradeHistoryValue('classroom_grade_scores', '27.00'), '27');
  assert.equal(app.gradeHistoryValue('classroom_grade_period_scores', null), 'لا درجة');
  assert.equal(app.gradeHistoryValue('classroom_task_students', '|'), 'لم يُقيَّم');
  assert.equal(app.gradeHistoryValue('classroom_task_students', '7.5|2'), '7.5');
});

test('السجل: لحظات الشعبة بالأحدث، وعدد الحذف بالأحمر، واللحظة تُمرَّر برقمها لا بنصها', async () => {
  const { app, log } = appWith({ grade_history_moments: { data: MOMENTS, error: null } });
  await app.openGradeHistory('S1');
  assert.deepEqual(JSON.parse(JSON.stringify(log[0])), { name: 'grade_history_moments', args: { p_section: 'S1' } });
  const m = get(app, 'window.__modal');
  assert.match(m, /سجل الدرجات[\s\S]*ثاني ثانوي ١ · آخر 30 يومًا/);
  assert.match(m, /133 تغيير · الفترات، الواجبات<\/small><\/span><span class="tlx-pill is-red">حذف 99<\/span>/);
  assert.match(m, /onclick="previewGradeRestore\(0\)"[\s\S]*onclick="previewGradeRestore\(1\)"/);
  assert.doesNotMatch(m, /2026-11-17T/, 'لا تاريخ خام داخل onclick');
});

test('السجل: قبل تحديث القاعدة رسالة واضحة، وشعبة بلا تغييرات تقول ذلك', async () => {
  const a = appWith({ grade_history_moments: { data: null, error: { code: 'PGRST202' } } });
  await a.app.openGradeHistory('S1');
  assert.match(get(a.app, 'window.__modal'), /يحتاج تحديث قاعدة البيانات/);
  const b = appWith({ grade_history_moments: { data: [], error: null } });
  await b.app.openGradeHistory('S1');
  assert.match(get(b.app, 'window.__modal'), /لا تغييرات مسجّلة لهذه الشعبة بعد/);
});

test('المعاينة لا تكتب، وتهرّب الأسماء، وتعرض «الآن ← بعد الاستعادة»', async () => {
  const items = [{ tbl: 'classroom_grade_period_scores', student: '<img src=x onerror=alert(1)>', item: 'مشاركة · ف1', now: '30', then: '27' },
    { tbl: 'classroom_homework_status', student: 'بدر', item: 'الوحدة الثانية', now: 'submitted', then: null }];
  const { app, log } = appWith({ grade_history_moments: { data: MOMENTS, error: null }, grade_history_restore: { data: { changes: 2, skipped: 0, applied: false, items }, error: null } });
  await app.openGradeHistory('S1');
  await app.previewGradeRestore(0);
  const call = log.find(l => l.name === 'grade_history_restore');
  assert.deepEqual(JSON.parse(JSON.stringify(call.args)), { p_section: 'S1', p_at: MOMENTS[0].at, p_apply: false });
  const m = get(app, 'window.__modal');
  assert.doesNotMatch(m, /<img/, 'الاسم مهرَّب');
  assert.match(m, /&lt;img/);
  assert.match(m, /<span class="gh-now">30<\/span> ← <b class="gh-then">27<\/b>/);
  assert.match(m, /<span class="gh-now">سلّم<\/span> ← <b class="gh-then">لم يسلّم<\/b>/);
  assert.match(m, /سيرجع 2 تغييرًا/);
  assert.match(m, /id="gradeRestoreBtn" onclick="applyGradeRestore\(\)">استعادة/);
});

test('الاستعادة: الزر يتعطّل، والنقرة المزدوجة لا تكرّر، ويُعاد رسم الكشف للشعبة نفسها فقط', async () => {
  let release;
  const { app, log } = appWith({
    grade_history_moments: { data: MOMENTS, error: null },
    grade_history_restore: a => a.p_apply ? new Promise(r => { release = () => r({ data: { changes: 3, skipped: 0, applied: true, items: [] }, error: null }); }) : { data: { changes: 3, items: [] }, error: null }
  });
  await app.openGradeHistory('S1');
  await app.previewGradeRestore(0);
  const p1 = app.applyGradeRestore();
  assert.equal(get(app, 'window.__btn.disabled'), true);
  await app.applyGradeRestore(); /* نقرة ثانية أثناء العمل */
  assert.equal(log.filter(l => l.name === 'grade_history_restore' && l.args.p_apply).length, 1, 'استدعاء واحد');
  release();
  await p1;
  assert.equal(get(app, 'window.__rendered'), 1);
  assert.match(get(app, 'window.__toasts.join("|")'), /ok:استُعيد 3 تغييرًا ✓/);
  /* شعبة أخرى ظاهرة الآن: لا إعادة رسم لكشفها */
  const b = appWith({ grade_history_moments: { data: MOMENTS, error: null }, grade_history_restore: { data: { changes: 1, skipped: 0, items: [] }, error: null } });
  await b.app.openGradeHistory('S1');
  await b.app.previewGradeRestore(0);
  runInAppContext(b.app, `crmGrades = { sectionId: 'S9' };`);
  await b.app.applyGradeRestore();
  assert.equal(get(b.app, 'window.__rendered'), 0);
});

test('فشل الاستعادة: رسالة «لم يتغيّر شيء» والزر يعود', async () => {
  const { app } = appWith({ grade_history_moments: { data: MOMENTS, error: null }, grade_history_restore: a => a.p_apply ? { data: null, error: { message: 'x' } } : { data: { changes: 1, items: [] }, error: null } });
  await app.openGradeHistory('S1');
  await app.previewGradeRestore(0);
  await app.applyGradeRestore();
  assert.match(get(app, 'window.__toasts.join("|")'), /error:تعذّرت الاستعادة — لم يتغيّر شيء/);
  assert.equal(get(app, 'window.__btn.disabled'), false);
  assert.equal(get(app, 'window.__closed'), 0);
});

test('المدخل في قائمة الكشف، والتنظيف بعد الدخول، والملف مسجّل في الصفحة والكاش', () => {
  const a17 = fs.readFileSync(path.join(root, 'app', 'app-17-grades.js'), 'utf8');
  assert.match(a17, /onclick="openGradeHistory\('\$\{g\.sectionId\}'\)"[^`]*سجل الدرجات والاستعادة/);
  assert.match(fs.readFileSync(path.join(root, 'app', 'app-03-auth-home-risk.js'), 'utf8'), /gradeHistoryCleanup\(\)/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-55-grade-history\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-55-grade-history\.js/);
});

/* ============ قاعدة البيانات ============ */
test('SQL: الجدول للقراءة فقط لصاحبه، والمشغّل وحده يكتب، على الجداول الخمسة', () => {
  assert.match(BLK, /create table if not exists public\.grade_history \(/);
  assert.match(BLK, /on public\.grade_history for select to authenticated using \(auth\.uid\(\) = teacher_id\);/);
  assert.match(BLK, /grant select on public\.grade_history to authenticated;/);
  assert.match(BLK, /revoke all on public\.grade_history from anon, authenticated;/, 'الصلاحيات الافتراضية تُسحب من المستخدم أيضًا قبل منح القراءة');
  assert.doesNotMatch(BLK.replace(/--[^\n]*/g, ''), /grant (insert|update|delete|all)[^;]*grade_history/i, 'لا كتابة مباشرة');
  assert.doesNotMatch(BLK, /is_admin/, 'ولا المسؤول');
  assert.match(fnBody('grade_history_log'), /returns trigger\s+language plpgsql security definer set search_path = ''/);
  assert.match(BLK, /array\['classroom_grade_scores', 'classroom_grade_period_scores', 'classroom_homework_status', 'classroom_task_students', 'classroom_tool_marks'\] loop/);
  assert.match(BLK, /after insert or update or delete on public\.%I for each row execute function public\.grade_history_log\(\)/);
  assert.match(fnBody('grade_history_log'), /if \(v_old - 'updated_at'\) = \(v_new - 'updated_at'\) then return null;/, 'لا يُسجَّل ما لا يغيّر شيئًا');
});

test('SQL: الاستعادة بصلاحية المعلم نفسه، ومقيّدة به صراحةً في كل خطوة، ومعاينة بلا كتابة', () => {
  const r = fnBody('grade_history_restore');
  assert.match(r, /returns jsonb language plpgsql security invoker set search_path = ''/);
  assert.match(r, /s\.id = p_section and s\.teacher_id = v_uid\) then\s+raise exception 'section not found'/);
  const writes = r.match(/(delete from|insert into) public\.\w+/g);
  assert.equal(writes.length, 10, 'حذف وإضافة لكل جدول من الخمسة');
  (r.match(/delete from public\.\w+ x where [^;]*/g) || []).forEach(d => assert.match(d, /x\.teacher_id = v_uid/));
  assert.match(r, /if not coalesce\(p_apply, false\) then continue; end if;/, 'المعاينة تقف قبل الكتابة');
  assert.match(r, /h\.teacher_id = v_uid and h\.section_id = p_section and h\.changed_at >= p_at/);
  assert.match(r, /order by h\.tbl, h\.row_key, h\.changed_at, h\.id/, 'أول تغيير بعد اللحظة = الحالة قبلها');
});

test('SQL: التنظيف 30 يومًا لصاحبه فقط، والدوال بلا تنفيذ للزائر، والجدول في سياسة التعطيل وخارج النسخة الشاملة', () => {
  assert.match(fnBody('grade_history_cleanup'), /delete from public\.grade_history where teacher_id = v_uid and changed_at < now\(\) - interval '30 days'/);
  ['grade_history_cleanup()', 'grade_history_moments(uuid)', 'grade_history_restore(uuid, timestamptz, boolean)'].forEach(f =>
    assert.match(BLK, new RegExp('revoke execute on function public\\.' + f.replace(/[()]/g, '\\$&') + ' from public, anon;')));
  const dis = /foreach v_t in array array\[([\s\S]*?)\] loop/.exec(SQL.slice(SQL.indexOf('-- فرض «تعطيل الحساب» من القاعدة نفسها')))[1];
  assert.match(dis, /'grade_history'/);
  assert.ok(runInAppContext(loadApp(), 'buildSchemaSql()').includes(BLK.trim()), 'المرآة حرفية');
});

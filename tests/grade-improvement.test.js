'use strict';
/* ============================================================
   تحسين الدرجات (app-56) — نشاط اختياري يرفع بند الاختبارات أو المهام الأدائية
   ------------------------------------------------------------
   باتفاق مع المعلم:
   - الزيادة = درجة الطالب في النشاط، تُضاف فوق درجة البند بسقف درجته العظمى (16 + 5 من 20 = 20).
   - من لم يشارك لا يتأثر، ولا زيادة لمن لا درجة له في البند (لا شيء يُحسَّن).
   - المهام: «على المجموع» (بعد معدّل الفترات) أو فترة بعينها (قبل المعدّل، بسقف العمود).
   - النشاط لشعبة أو لعدة شعب (نشاط مستقل لكل شعبة).
   والحمايات: فلترة teacher_id صريحة، تهريب النصوص، زر واحد أثناء الحفظ، السلة، النسخ الاحتياطي، القفل.
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const J = x => JSON.parse(JSON.stringify(x));

function fakeClient(seed, log, opts) {
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table) {
      const f = [];
      let op = 'select', values = null, wantRows = false;
      const result = () => {
        if (opts.fail && opts.fail(table, op)) return { data: null, error: { message: 'boom' } };
        if (op === 'insert') {
          const rows = Array.isArray(values) ? values : [values];
          log.push({ table, op, rows });
          return { data: wantRows ? rows.map((r, i) => Object.assign({ id: 'NEW' + i }, r)) : null, error: null };
        }
        if (op === 'upsert') { log.push({ table, op, rows: values }); return { data: null, error: null }; }
        if (op === 'update' || op === 'delete') { log.push({ table, op, filters: f.slice() }); return { data: [], error: null }; }
        log.push({ table, op: 'select', filters: f.slice() });
        return { data: match(seed[table], f), error: null };
      };
      const api = {
        select() { if (op === 'insert') wantRows = true; return api; }, order() { return api; }, range() { return api; }, limit() { return api; },
        eq(c, v) { f.push([c, v]); return api; }, in(c, v) { f.push([c, v]); return api; },
        insert(r) { op = 'insert'; values = r; return api; }, upsert(r) { op = 'upsert'; values = r; return api; },
        update() { op = 'update'; return api; }, delete() { op = 'delete'; return api; },
        maybeSingle() { return Promise.resolve(result()).then(r => ({ data: (r.data || [])[0] || null, error: r.error })); },
        then(res, rej) { return Promise.resolve(opts.delay && opts.delay(table, op)).then(() => result()).then(res, rej); },
      };
      return api;
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) },
  };
}

function appWith(seed, log, opts) {
  const app = loadApp({ supabaseClient: fakeClient(seed || {}, log, opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    showInfoModal = (h) => { window.__modal = h; }; closeCrmModal = () => {};
    showConfirm = async () => true; afterCrmGradesChanged = () => {};
    crmStudentsOfSection = () => [{ id: 's1', full_name: 'سلمان' }, { id: 's2', full_name: 'ريان' }];
    crmSectionLabel = () => 'الأول/1';
    crmCurrentTerm = () => ({ year: '1448', semester: 1 });
  `);
  return app;
}

/* ============ الحساب ============ */
test('الزيادة فوق البند بسقف درجته العظمى: 16 + 5 من 20 = 20 (يُضاف 4)، ولا زيادة لمن لا درجة له', () => {
  const app = loadApp({});
  assert.equal(app.improveAddCapped(16, 5, 20), 20);
  assert.equal(app.improveAddCapped(12, 5, 20), 17);
  assert.equal(app.improveAddCapped(12, 0, 20), 12);
  assert.equal(app.improveAddCapped(null, 5, 20), null, 'لا شيء يُحسَّن');
});

test('الاختبارات: studentGradeResult يضيف الزيادة فوق المحصلة بسقف وزن الاختبارات، ويحفظ الأصل وما أُضيف', () => {
  const app = loadApp({});
  const cols = [{ id: 't1', category: 'tests', name: 'أول', max_score: 20 }, { id: 'p', category: 'performance', name: 'مشاركة', max_score: 10, kind: 'participation' }];
  const sc = [{ column_id: 't1', student_id: 'a', score: 16 }, { column_id: 'p', student_id: 'a', score: 8 }];
  const caps = { performance: 40, tests: 20 };
  const plain = J(app.studentGradeResult(cols, sc, 'a', caps));
  assert.equal(plain.tests.points, 16);
  assert.equal(plain.tests.bonus, 0);
  const up = J(app.studentGradeResult(cols, sc, 'a', caps, 5));
  assert.equal(up.tests.base, 16);
  assert.equal(up.tests.points, 20, 'لا يتجاوز 20');
  assert.equal(up.tests.bonus, 4, 'ما أُضيف فعلًا');
  assert.equal(up.total, 28);
  assert.equal(J(app.studentGradeResult(cols, sc, 'a', caps, 2)).tests.points, 18);
  /* طالب بلا اختبار مرصود: الزيادة لا تصنع درجة */
  assert.equal(J(app.studentGradeResult(cols, [], 'b', caps, 5)).tests.points, null);
});

test('فهرس الزيادات: لكل طالب حسب البند والفترة، ويتجاهل نشاطًا غير معروف', () => {
  const app = loadApp({});
  const list = [{ id: 'i1', target: 'tests', name: 'أ', max_score: 5 }, { id: 'i2', target: 'task', grade_period: null, name: 'ب', max_score: 5 },
    { id: 'i3', target: 'task', grade_period: 2, name: 'ج', max_score: 3 }, { id: 'i4', target: 'tests', name: 'د', max_score: 5 }];
  const scores = [{ improvement_id: 'i1', student_id: 'a', score: '3' }, { improvement_id: 'i4', student_id: 'a', score: '1.5' },
    { improvement_id: 'i2', student_id: 'a', score: 2 }, { improvement_id: 'i3', student_id: 'a', score: 1 }, { improvement_id: 'zz', student_id: 'a', score: 5 }];
  const idx = app.improveIndex(list, scores);
  assert.equal(app.improveTestsOf(idx, 'a'), 4.5);
  assert.deepEqual(J(app.improveTaskOf(idx, 'a')), { periods: { 2: 1 }, final: 2 });
  assert.equal(app.improveTaskOf(idx, 'b'), null, 'لم يشارك = لا شيء');
  assert.equal(app.improveTestsOf(idx, 'b'), 0);
});

test('المهام: زيادة «المجموع» بعد المعدّل، وزيادة الفترة قبله — كلتاهما بسقف العمود', () => {
  const app = loadApp({});
  const tasks = [{ id: 'k1', max_score: 10, grade_period: 1, created_at: '2026-09-01' }, { id: 'k2', max_score: 10, grade_period: 2, created_at: '2026-10-01' }];
  const rows = [{ task_id: 'k1', student_id: 'a', score: 6 }, { task_id: 'k2', student_id: 'a', score: 8 }];
  const cfg = { n: 2, starts: ['2026-09-20'], ended: true };
  const base = J(app.taskPeriodScores(tasks, rows, 'a', 20, cfg));
  assert.deepEqual([base.p1, base.p2, base.final], [12, 16, 14]);
  const fin = J(app.taskPeriodScores(tasks, rows, 'a', 20, cfg, { periods: {}, final: 3 }));
  assert.equal(fin.final, 17);
  assert.equal(J(app.taskPeriodScores(tasks, rows, 'a', 20, cfg, { periods: {}, final: 10 })).final, 20, 'سقف العمود');
  const per = J(app.taskPeriodScores(tasks, rows, 'a', 20, cfg, { periods: { 1: 4 }, final: 0 }));
  assert.deepEqual([per.p1, per.p2, per.final], [16, 16, 16], 'الأولى 12+4 ثم المعدّل');
  const capP = J(app.taskPeriodScores(tasks, rows, 'a', 20, cfg, { periods: { 2: 9 }, final: 0 }));
  assert.equal(capP.p2, 20);
  /* فترة بلا درجة للطالب: لا زيادة فيها */
  const none = J(app.taskPeriodScores(tasks, [rows[0]], 'a', 20, cfg, { periods: { 2: 5 }, final: 0 }));
  assert.equal(none.p2, null);
  assert.equal(none.final, 12);
});

test('مزامنة عمود المهام: المحفوظ يشمل الزيادة، وما أُضيف فعلًا يُحسب للعلامة', () => {
  const app = loadApp({});
  const tasks = [{ id: 'k1', max_score: 10, grade_period: 1, created_at: '2026-09-01' }];
  const rows = [{ task_id: 'k1', student_id: 'a', score: 9 }, { task_id: 'k1', student_id: 'b', score: 5 }];
  const idx = app.improveIndex([{ id: 'i', target: 'task', grade_period: null, max_score: 5 }],
    [{ improvement_id: 'i', student_id: 'a', score: 5 }, { improvement_id: 'i', student_id: 'b', score: 5 }]);
  const plan = J(app.planTaskScoreSync(['a', 'b'], tasks, rows, 20, new Map(), [], idx));
  assert.deepEqual(plan.upserts, [{ student_id: 'a', score: 20 }, { student_id: 'b', score: 15 }]);
  const applied = app.taskImproveApplied(['a', 'b'], tasks, rows, 20, [], idx);
  assert.equal(applied.get('a'), 2, '18 → 20: أُضيف 2 فقط');
  assert.equal(applied.get('b'), 5);
});

/* ============ النموذج ============ */
test('التحقق من النموذج، ونشاط مستقل لكل شعبة، والفترة للمهام فقط', () => {
  const app = loadApp({});
  const ok = { target: 'task', mode: 'new', name: 'تحسيني', max: '5', period: 2, sectionIds: ['S1', 'S2'] };
  assert.equal(app.validateImproveDraft(ok), null);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { name: ' ' })), /اسم/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { max: '0' })), /أكبر من صفر/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { max: '41' })), /40/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { sectionIds: [] })), /شعبة/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { target: 'tests' })), /للمهام فقط/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { mode: 'retake', sourceName: '' })), /ما يُعاد/);
  const rows = J(app.improveInsertRows(Object.assign({}, ok, { max: '٥' }), { year: '1448', semester: 1 }, 'u1'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.section_id), ['S1', 'S2']);
  assert.ok(rows.every(r => r.teacher_id === 'u1' && r.max_score === 5 && r.grade_period === 2 && r.rule === 'add' && r.source_name === null));
  const t = J(app.improveInsertRows({ target: 'tests', mode: 'retake', sourceName: 'الأول', name: 'x', max: '5', period: 3, sectionIds: ['S1'] }, { year: '1448', semester: 1 }, 'u1'))[0];
  assert.equal(t.grade_period, null, 'الاختبارات بلا فترة');
  assert.equal(t.source_name, 'الأول');
});

test('ورقة الرصد: الفارغ = لم يشارك (يُحذف فقط إن كان مرصودًا)، والأكبر من الكاملة خطأ', () => {
  const app = loadApp({});
  const prev = new Map([['a', 3], ['b', 2]]);
  const plan = J(app.planImproveScoreChanges([{ student_id: 'a', text: '' }, { student_id: 'b', text: '2' }, { student_id: 'c', text: '٤' }, { student_id: 'd', text: '' }], prev, 5));
  assert.deepEqual(plan.deletes, ['a']);
  assert.deepEqual(plan.upserts, [{ student_id: 'c', score: 4 }]);
  assert.equal(plan.errors.length, 0);
  assert.equal(J(app.planImproveScoreChanges([{ student_id: 'a', text: '6' }], new Map(), 5)).errors.length, 1);
});

/* ============ الحمايات ============ */
test('كل استعلام على جدولي التحسين في التطبيق يحمل فلتر teacher_id صريحًا', () => {
  const dir = path.join(root, 'app');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const re = /sb\.from\('(classroom_improvements|classroom_improvement_scores)'\)/g;
    let m;
    while ((m = re.exec(src))) {
      const chain = src.slice(m.index, m.index + 400).split(/;\s*\n|\)\),\s*\n/)[0];
      if (/\.insert\(/.test(chain)) continue; /* الإدراج يحمل teacher_id في الصف نفسه */
      if (/\.upsert\(/.test(chain)) { if (!/teacher_id: uid/.test(chain)) offenders.push(file + ': upsert'); continue; }
      if (!/\.eq\('teacher_id', (uid|currentUser\.id)\)/.test(chain)) offenders.push(`${file}: ${chain.slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('XSS: اسم النشاط ومصدره يمرّان بـescapeHtml في القائمة', () => {
  const app = appWith({}, []);
  const html = runInAppContext(app, `improveListHtml({ sectionId: 'S', counts: new Map(), presetTarget: null,
    list: [{ id: 'i1', target: 'tests', mode: 'retake', source_name: '<img src=x onerror=alert(2)>', name: '<b onclick=x>', max_score: 5 }] })`);
  assert.doesNotMatch(html, /<img src=x|<b onclick/);
  assert.match(html, /&lt;b onclick=x&gt;/);
});

test('إنشاء النشاط: نقرة مزدوجة = إدراج واحد، بصفوف تحمل teacher_id', async () => {
  const log = [];
  const app = appWith({}, log, { delay: (t, op) => op === 'insert' ? new Promise(r => setTimeout(r, 20)) : null });
  runInAppContext(app, `readImproveInputs = () => {}; openImproveSheet = async () => {};
    improveCtx = { sectionId: 'S1', term: { year: '1448', semester: 1 }, list: [], counts: new Map() };
    improveDraft = { target: 'tests', mode: 'new', sourceName: '', name: 'تحسيني', max: '5', period: null, sectionIds: ['S1', 'S2'], sources: { tests: [], task: [] }, saving: false, ctx: improveCtx };`);
  await Promise.all([runInAppContext(app, 'saveImproveForm()'), runInAppContext(app, 'saveImproveForm()')]);
  const ins = log.filter(l => l.table === 'classroom_improvements' && l.op === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].rows.length, 2, 'نشاط لكل شعبة');
  assert.ok(ins[0].rows.every(r => r.teacher_id === 'u1'));
});

test('حفظ ورقة الرصد: نقرة مزدوجة = حفظ واحد، والفترة المقفلة لا تُكتب', async () => {
  const log = [];
  const app = appWith({}, log, { delay: (t, op) => op === 'upsert' ? new Promise(r => setTimeout(r, 20)) : null });
  runInAppContext(app, `paintImproveSheet = () => {}; improveAfterChange = async () => {};
    document.querySelectorAll = (sel) => sel === '.imp-input' ? [{ dataset: { student: 's1' }, value: '4', classList: { add(){} } }] : [];
    improveSheet = { id: 'I', imp: { id: 'I', section_id: 'S1', target: 'tests', max_score: 5, grade_period: null }, term: { year: '1448', semester: 1 }, values: new Map(), saving: false };`);
  await Promise.all([runInAppContext(app, 'saveImproveSheet()'), runInAppContext(app, 'saveImproveSheet()')]);
  const ups = log.filter(l => l.table === 'classroom_improvement_scores' && l.op === 'upsert');
  assert.equal(ups.length, 1);
  assert.deepEqual(J(ups[0].rows), [{ teacher_id: 'u1', improvement_id: 'I', student_id: 's1', score: 4 }]);
  /* فترة مقفلة: لا كتابة */
  const log2 = [];
  const app2 = appWith({}, log2);
  runInAppContext(app2, `paintImproveSheet = () => {}; improveAfterChange = async () => {}; isPeriodLocked = () => true;
    document.querySelectorAll = () => [{ dataset: { student: 's1' }, value: '4', classList: { add(){} } }];
    improveSheet = { id: 'I', imp: { id: 'I', section_id: 'S1', target: 'task', max_score: 5, grade_period: 1 }, term: { year: '1448', semester: 1 }, values: new Map(), saving: false };`);
  await runInAppContext(app2, 'saveImproveSheet()');
  assert.equal(log2.filter(l => l.op === 'upsert').length, 0);
});

test('السباق: فتح نشاط آخر أثناء التحميل لا يرسم فوقه', async () => {
  const log = [];
  const seed = {
    classroom_improvements: [{ id: 'A', teacher_id: 'u1', section_id: 'S1', target: 'tests', name: 'أ', max_score: 5, academic_year: '1448', semester: 1 },
      { id: 'B', teacher_id: 'u1', section_id: 'S1', target: 'tests', name: 'ب', max_score: 5, academic_year: '1448', semester: 1 }],
    classroom_improvement_scores: []
  };
  const app = appWith(seed, log, { delay: (t, op) => t === 'classroom_improvements' && op === 'select' ? new Promise(r => setTimeout(r, 15)) : null });
  runInAppContext(app, `window.__painted = []; paintImproveSheet = () => window.__painted.push(improveSheet.imp.id);`);
  const first = runInAppContext(app, `openImproveSheet('A')`);
  await runInAppContext(app, `openImproveSheet('B')`);
  await first;
  assert.deepEqual(J(runInAppContext(app, 'window.__painted')), ['B']);
});

/* ============ القاعدة والنسخ الاحتياطي والسلة ============ */
test('SQL: الجدولان وRLS والحارسان والقفل في ملف التحديث ومرآة buildSchemaSql', () => {
  const upd = read('sql-updates-run-in-supabase.sql');
  const schema = runInAppContext(loadApp({}), 'buildSchemaSql()');
  for (const sql of [upd, schema]) {
    assert.match(sql, /create table if not exists public\.classroom_improvements \(/);
    assert.match(sql, /create table if not exists public\.classroom_improvement_scores \(/);
    assert.match(sql, /alter table public\.classroom_improvements enable row level security/);
    assert.match(sql, /alter table public\.classroom_improvement_scores enable row level security/);
    assert.match(sql, /improvement_score_above_max/);
    assert.match(sql, /improvement_fixed/);
    assert.match(sql, /check \(target = 'task' or grade_period is null\)/);
    assert.match(sql, /elsif p_tbl = 'classroom_improvement_scores' then/);
    assert.match(sql, /create trigger trg_grade_lock before insert or update or delete on public\.classroom_improvement_scores/);
    assert.match(sql.match(/v_allowed text\[\] := array\[[\s\S]*?\];/)[0], /'classroom_improvements','classroom_improvement_scores'/);
    for (const m of sql.matchAll(/create policy "([^"]+)" on public\.classroom_improvement/g)) {
      assert.ok(Buffer.byteLength(m[1], 'utf8') <= 63, 'اسم سياسة أطول من 63 بايت: ' + m[1]);
    }
  }
  /* الجدولان قبل كتلتي النسخ الشاملة وحظر الحسابات المعطّلة (حلقتهما تتخطى جدولًا غير منشأ بعد) */
  assert.ok(upd.indexOf('create table if not exists public.classroom_improvement_scores') < upd.indexOf('function public.admin_backup_tables'));
  assert.ok(upd.indexOf('create table if not exists public.classroom_improvement_scores') < upd.indexOf("'block_disabled_accounts', v_t"));
  /* الكتلة تُنسخ داخل نص JS: بلا backtick ولا ${ */
  const blk = upd.slice(upd.indexOf('-- ============ تحسين الدرجات'), upd.indexOf('-- النسخة الاحتياطية الشاملة للمسؤول'));
  assert.doesNotMatch(blk, /`|\$\{|\\/);
});

test('النسخ الاحتياطي: الشخصية بتصفية teacher_id (وغياب الجدول لا يوقفها)، والشاملة، ودليل الاستعادة بترتيبه', async () => {
  const a08 = read('app/app-08-admin.js');
  for (const t of ['classroom_improvements', 'classroom_improvement_scores']) {
    assert.match(a08, new RegExp(`sb\\.from\\('${t}'\\)\\.select\\('\\*'\\)\\.eq\\('teacher_id', uid\\)`));
    assert.match(a08, new RegExp(`${t}: \\w+Res\\.data \\|\\| \\[\\]`));
  }
  const a07 = read('app/app-07-backup-export.js');
  const i = a07.indexOf('async function exportFullBackup');
  assert.match(/const tables = \[([^\]]*)\]/.exec(a07.slice(i))[1], /'classroom_improvements', 'classroom_improvement_scores'/);
  assert.ok(a07.indexOf('classroom_improvements.csv') < a07.indexOf('classroom_improvement_scores.csv'));
  const app = loadApp({});
  const missing = await app.backupOptionalTable(Promise.resolve({ data: null, error: { code: '42P01' } }));
  assert.deepEqual(J(missing), { data: [], error: null });
  const net = await app.backupOptionalTable(Promise.resolve({ data: null, error: { message: 'network' } }));
  assert.equal(net.error.message, 'network', 'خطأ الشبكة يبقى خطأً يوقف النسخة');
});

test('السلة: حذف النشاط يلتقطه مع درجاته، وحذف الطالب يلتقط درجاته في التحسين', () => {
  const trash = read('app/app-32-trash.js');
  assert.match(trash, /async function trashCaptureImprovement/);
  assert.match(trash, /\{ t: 'classroom_improvements', rows: imp \}, \{ t: 'classroom_improvement_scores', rows: sc \}/);
  assert.match(trash, /\{ t: 'classroom_improvement_scores', rows: improveScores \}/);
  const src = read('app/app-56-grade-improvement.js');
  const del = src.slice(src.indexOf('async function deleteImprovement'));
  assert.match(del, /trashProtect\(\(\) => trashCaptureImprovement\(id, uid\)\)/);
  assert.match(del, /trashRunOnce\(/);
});

test('قبل تشغيل ملف التحديث: الجدول غير موجود = لا أنشطة (الكشف والمزامنة يعملان)', async () => {
  const sb = fakeClient({}, [], { fail: () => false });
  const orig = sb.from;
  sb.from = t => t === 'classroom_improvements' ? { select() { return this; }, eq() { return this; }, then(r) { return Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'not found' } }).then(r); } } : orig(t);
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'u1' } });
  const res = await runInAppContext(app, `loadImprovementsForStudents(['s1'], { year: '1448', semester: 1 })`);
  assert.deepEqual(J(res), { list: [], scores: [] });
});

test('الشكل: علامة «↑» بمتغيّرات الهوية، والملف في APP_SHELL والصفحة', () => {
  const css = read('style.css');
  const rule = css.match(/\.imp-mark\{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /#[0-9a-f]{3,6}/i, 'لا لون مكتوب كرقم (DESIGN.md)');
  assert.match(rule, /var\(--ui-ok\)/);
  assert.match(read('sw.js'), /'\.\/app\/app-56-grade-improvement\.js'/);
  assert.match(read('index.html'), /<script src="app\/app-56-grade-improvement\.js"><\/script>/);
  const app = loadApp({});
  assert.equal(app.improveMarkHtml(0), '');
  assert.match(app.improveMarkHtml(2.5), /↑ \+2\.5/);
});

test('انحدار: مقارنة الشعب/الفصل السابق تحسب زيادة الاختبارات للشعب الأخرى كما لشعبتك', async () => {
  const log = [];
  const seed = {
    classroom_grade_columns: [{ id: 't1', teacher_id: 'u1', section_id: 'S2', academic_year: '1448', semester: 1, category: 'tests', name: 'أول', max_score: 20, position: 0 }],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 't1', student_id: 'x', score: 10 }],
    classroom_improvements: [{ id: 'I', teacher_id: 'u1', section_id: 'S2', academic_year: '1448', semester: 1, target: 'tests', name: 'ت', max_score: 5 }],
    classroom_improvement_scores: [{ id: 'r1', teacher_id: 'u1', improvement_id: 'I', student_id: 'x', score: 4 }]
  };
  const app = appWith(seed, log);
  runInAppContext(app, `gradeColumnVisible = () => true; appToolOn = () => true;`);
  const total = await runInAppContext(app, `loadGradeSheetsRaw(['S2'], '1448', 1).then(s => gradeAnalysisRows(s[0], [{ id: 'x', full_name: 'س' }], 'total', { performance: 40, tests: 20 }, true).rows[0].points)`);
  assert.equal(total, 14, '10 + 4 تحسين');
});

'use strict';
/* ============================================================
   تحسين الدرجات (app-56) — نشاط اختياري يرفع بند الاختبارات أو المهام الأدائية
   ------------------------------------------------------------
   باتفاق مع المعلم:
   - الزيادة = درجة الطالب في النشاط، تُضاف فوق درجة البند بسقف درجته العظمى (16 + 5 من 20 = 20).
   - من لم يشارك لا يتأثر. ومن شارك ودرجته في البند فارغة: تُحسب درجة التحسين وحدها مع تنبيه (3.78)؛ الصفر درجة عادية.
   - لا نشاط تحسين لبند لا اختبار/مهمة فيه بعد: يُمنع الإنشاء مع ذكر السبب (3.78).
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
test('الزيادة فوق البند بسقف درجته العظمى: 16 + 5 من 20 = 20 (يُضاف 4)، والفارغ + زيادة = الزيادة وحدها', () => {
  const app = loadApp({});
  assert.equal(app.improveAddCapped(16, 5, 20), 20);
  assert.equal(app.improveAddCapped(12, 5, 20), 17);
  assert.equal(app.improveAddCapped(12, 0, 20), 12);
  assert.equal(app.improveAddCapped(null, 5, 20), 5, 'فارغة (غائب): درجة التحسين وحدها');
  assert.equal(app.improveAddCapped(null, 30, 20), 20, 'بسقف البند');
  assert.equal(app.improveAddCapped(null, 0, 20), null, 'بلا زيادة يبقى فارغًا');
  assert.equal(app.improveAddCapped(0, 3, 20), 3, 'الصفر درجة عادية');
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
  assert.equal(up.tests.fromEmpty, false);
  /* طالب بلا اختبار مرصود (غائب): درجة التحسين وحدها، ومعلَّم «كانت فارغة» للتنبيه */
  const em = J(app.studentGradeResult(cols, [], 'b', caps, 5));
  assert.equal(em.tests.points, 5);
  assert.equal(em.tests.bonus, 5);
  assert.equal(em.tests.fromEmpty, true);
  assert.equal(J(app.studentGradeResult(cols, [], 'b', caps)).tests.points, null, 'بلا تحسين يبقى فارغًا');
  /* الصفر ليس فارغًا */
  const zero = J(app.studentGradeResult(cols, [{ column_id: 't1', student_id: 'z', score: 0 }], 'z', caps, 3));
  assert.equal(zero.tests.points, 3);
  assert.equal(zero.tests.fromEmpty, false);
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
  /* فترة بلا درجة للطالب (فارغة): درجة التحسين وحدها فيها، ثم المعدّل */
  const none = J(app.taskPeriodScores(tasks, [rows[0]], 'a', 20, cfg, { periods: { 2: 5 }, final: 0 }));
  assert.equal(none.p2, 5);
  assert.equal(none.final, 8.5);
  /* لا مهام مرصودة أصلًا + زيادة «على المجموع» */
  assert.equal(J(app.taskPeriodScores(tasks, [], 'a', 20, cfg, { periods: {}, final: 4 })).final, 4);
});

test('مزامنة عمود المهام: المحفوظ يشمل الزيادة، وما أُضيف فعلًا يُحسب للعلامة', () => {
  const app = loadApp({});
  const tasks = [{ id: 'k1', max_score: 10, grade_period: 1, created_at: '2026-09-01' }];
  const rows = [{ task_id: 'k1', student_id: 'a', score: 9 }, { task_id: 'k1', student_id: 'b', score: 5 }];
  const idx = app.improveIndex([{ id: 'i', target: 'task', grade_period: null, max_score: 5 }],
    [{ improvement_id: 'i', student_id: 'a', score: 5 }, { improvement_id: 'i', student_id: 'b', score: 5 }]);
  const plan = J(app.planTaskScoreSync(['a', 'b'], tasks, rows, 20, new Map(), [], idx));
  assert.deepEqual(plan.upserts, [{ student_id: 'a', score: 20 }, { student_id: 'b', score: 15 }]);
  const applied = app.taskImproveApplied(['a', 'b'], tasks, rows, rows, 20, [], idx);
  assert.deepEqual(J(applied.get('a')), { add: 2, empty: false }, '18 → 20: أُضيف 2 فقط');
  assert.deepEqual(J(applied.get('b')), { add: 5, empty: false });
  /* طالب بلا مهمة مرصودة: معلَّم «كانت فارغة» */
  const idx2 = app.improveIndex([{ id: 'i', target: 'task', grade_period: null, max_score: 5 }], [{ improvement_id: 'i', student_id: 'c', score: 3 }]);
  assert.deepEqual(J(app.taskImproveApplied(['c'], tasks, rows, rows, 20, [], idx2).get('c')), { add: 3, empty: true });
});

/* ============ النموذج ============ */
test('التحقق من النموذج: زيادة/إعادة، الفترة لزيادة مجموع المهام فقط، ونشاط مستقل لكل شعبة مربوط بعنصرها', () => {
  const app = loadApp({});
  const ok = { target: 'task', kind: 'add', itemKey: '', retake: 'max', name: 'تحسيني', max: '5', period: 2, sectionIds: ['S1', 'S2'] };
  assert.equal(app.validateImproveDraft(ok), null);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { name: ' ' })), /اسم/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { max: '0' })), /أكبر من صفر/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { max: '41' })), /40/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { sectionIds: [] })), /شعبة/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { target: 'tests' })), /للمهام فقط/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { kind: 'retake', period: null })), /الذي يُعاد/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { kind: 'retake', itemKey: 'x|20', period: null, retake: 'zz' })), /طريقة/);
  assert.match(app.validateImproveDraft(Object.assign({}, ok, { itemKey: 'x|20' })), /مجموع المهام فقط/, 'لا فترة لزيادة على مهمة معيّنة');
  const rows = J(app.improveInsertRows(Object.assign({}, ok, { max: '٥' }), { year: '1448', semester: 1 }, 'u1'));
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.teacher_id === 'u1' && r.max_score === 5 && r.grade_period === 2 && r.rule === 'add' && r.retake === null && r.task_id === null));
  /* إعادة اختبار لشعبتين: كل شعبة مربوطة باختبارها (الاسم والدرجة)، والكاملة كالأصل، بلا فترة */
  const items = { tests: [{ id: 'A1', section_id: 'S1', name: 'الأول', max: 20 }, { id: 'B1', section_id: 'S2', name: 'الأول ', max: 20 }, { id: 'B2', section_id: 'S2', name: 'الأول', max: 10 }], task: [] };
  const rd = { target: 'tests', kind: 'retake', itemKey: app.improveItemKey('الأول', 20), retake: 'replace', name: 'إعادة', max: '5', period: null, sectionIds: ['S1', 'S2'], items };
  assert.equal(app.validateImproveDraft(rd), null);
  const rr = J(app.improveInsertRows(rd, { year: '1448', semester: 1 }, 'u1'));
  assert.deepEqual(rr.map(r => r.column_id), ['A1', 'B1'], 'بالاسم المطبّع والدرجة نفسها');
  assert.ok(rr.every(r => r.retake === 'replace' && r.max_score === 20 && r.mode === 'retake' && r.grade_period === null && r.source_name.startsWith('الأول')));
  /* شعبة بلا الاختبار نفسه: ممنوعة */
  assert.match(app.validateImproveDraft(Object.assign({}, rd, { items: { tests: [items.tests[0], items.tests[2]], task: [] } })), /غير موجود/);
  /* زيادة على اختبار معيّن: الكاملة مستقلة */
  const ad = J(app.improveInsertRows(Object.assign({}, rd, { kind: 'add', sectionIds: ['S1'] }), { year: '1448', semester: 1 }, 'u1'))[0];
  assert.deepEqual([ad.column_id, ad.retake, ad.max_score, ad.mode], ['A1', null, 5, 'new']);
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
    improveDraft = { target: 'tests', kind: 'add', itemKey: '', retake: 'max', name: 'تحسيني', max: '5', period: null, sectionIds: ['S1', 'S2'], items: { tests: [], task: [] }, saving: false, ctx: improveCtx };`);
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
  assert.match(app.improveMarkHtml(2.5), /↑ <bdi dir="ltr">\+2\.5<\/bdi>/);
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

/* ============ 3.78: لا تحسين بلا ما يُحسَّن، والفارغ يُنبَّه عليه ============ */
test('المنع: لا نشاط تحسين لبند بلا اختبار/مهمة في الشعبة، مع السبب', () => {
  const app = loadApp({});
  const av = app.improveAvailability(
    [{ section_id: 'S1', category: 'tests' }, { section_id: 'S1', category: 'performance', kind: 'task' }, { section_id: 'S2', category: 'performance', kind: 'task' },
     { section_id: 'S3', category: 'performance', kind: 'task', tool_id: 'x' }],
    [{ section_id: 'S1' }, { section_id: 'S3' }]);
  assert.equal(app.improveBlockReason(av, 'S1', 'tests'), null);
  assert.equal(app.improveBlockReason(av, 'S1', 'task'), null);
  assert.match(app.improveBlockReason(av, 'S2', 'tests'), /لا اختبارات/);
  assert.match(app.improveBlockReason(av, 'S2', 'task'), /لا مهام أدائية في هذه الشعبة/, 'عمود بلا مهام');
  assert.match(app.improveBlockReason(av, 'S3', 'task'), /لا عمود «مهام أدائية»/, 'عمود أداة ليس عمود المهام');
  assert.match(app.improveBlockReason(av, 'S9', 'tests'), /لا اختبارات/, 'شعبة بلا كشف');
  const d = { target: 'tests', kind: 'add', itemKey: '', retake: 'max', name: 'ت', max: '5', period: null, sectionIds: ['S1', 'S2'], avail: av };
  assert.match(app.validateImproveDraft(d), /لا يوجد ما يُحسَّن في إحدى الشعب/);
  assert.equal(app.validateImproveDraft(Object.assign({}, d, { sectionIds: ['S1'] })), null);
  assert.match(app.validateImproveDraft(Object.assign({}, d, { avail: null })), /انتظر/, 'لا إنشاء قبل التحقق');
  assert.match(app.validateImproveDraft(Object.assign({}, d, { avail: 'error' })), /تعذّر التحقق/);
});

test('المنع: النموذج يعرض «لا يوجد ما يُحسَّن» بلا زر إنشاء، والإنشاء لا يُدرج شيئًا', async () => {
  const log = [];
  const app = appWith({ classroom_grade_columns: [], classroom_tasks: [] }, log);
  runInAppContext(app, `appToolOn = () => true; crmSections = [];
    improveCtx = { sectionId: 'S1', term: { year: '1448', semester: 1 }, list: [], counts: new Map(), presetTarget: null };`);
  await runInAppContext(app, 'openImproveForm()');
  const html = runInAppContext(app, 'window.__modal');
  assert.match(html, /لا يوجد ما يُحسَّن بعد/);
  assert.match(html, /لا اختبارات في هذه الشعبة بعد/);
  assert.doesNotMatch(html, /id="impSaveBtn"/);
  runInAppContext(app, `readImproveInputs = () => {}; improveDraft.name = 'ت';`);
  await runInAppContext(app, 'saveImproveForm()');
  assert.equal(log.filter(l => l.op === 'insert').length, 0);
});

test('المنع: البند المتاح فقط يُختار، والشعبة التي لا يوجد فيها البند معطّلة', async () => {
  const log = [];
  const seed = {
    classroom_grade_columns: [{ id: 'k', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, category: 'performance', kind: 'task', name: 'مهام' }],
    classroom_tasks: [{ id: 't', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, title: 'بحث' }]
  };
  const app = appWith(seed, log);
  runInAppContext(app, `appToolOn = () => true; gradeColumnVisible = () => true; periodCfg = () => ({ n: 1, starts: [] });
    crmSections = [{ id: 'S1' }, { id: 'S2' }]; crmSectionOptionLabel = s => 'شعبة ' + s.id;
    improveCtx = { sectionId: 'S1', term: { year: '1448', semester: 1 }, list: [], counts: new Map(), presetTarget: null };`);
  await runInAppContext(app, `openImproveForm({ target: 'tests' })`);
  assert.equal(runInAppContext(app, 'improveDraft.target'), 'task', 'لا اختبارات: ينتقل للمهام');
  const html = runInAppContext(app, 'window.__modal');
  assert.match(html, /disabled title="لا اختبارات في هذه الشعبة بعد">الاختبارات/);
  assert.match(html, /disabled title="لا عمود «مهام أدائية» في كشف هذه الشعبة">شعبة S2 — لا يوجد ما يُحسَّن/);
  runInAppContext(app, `toggleImproveSection('S2')`);
  assert.deepEqual(J(runInAppContext(app, 'improveDraft.sectionIds')), ['S1'], 'لا تُضاف شعبة بلا بند');
  runInAppContext(app, `setImproveDraft('target', 'tests')`);
  assert.equal(runInAppContext(app, 'improveDraft.target'), 'task', 'لا يُختار بند ممنوع');
});

test('الفارغ: ورقة الرصد تنبّه بجانب من درجته فارغة (والصفر ليس فارغًا)', async () => {
  const log = [];
  const seed = {
    classroom_grade_columns: [{ id: 'T', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, category: 'tests', name: 'أول' }],
    classroom_grade_scores: [{ id: 'g1', teacher_id: 'u1', column_id: 'T', student_id: 's1', score: 0 }]
  };
  const app = appWith(seed, log);
  runInAppContext(app, `gradeColumnVisible = () => true;`);
  const empty = await runInAppContext(app, `improveEmptyBase({ target: 'tests', section_id: 'S1' }, ['s1', 's2'], { year: '1448', semester: 1 }).then(s => [...s])`);
  assert.deepEqual(J(empty), ['s2'], 's1 درجته صفر (ليست فارغة)، s2 فارغة');
  const q = log.filter(l => l.op === 'select' && (l.table === 'classroom_grade_columns' || l.table === 'classroom_grade_scores'));
  assert.ok(q.length && q.every(l => l.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1')), 'فلتر teacher_id');
  runInAppContext(app, `improveSheet = { id: 'I', imp: { id: 'I', section_id: 'S1', target: 'tests', name: 'ت', max_score: 5, mode: 'new' },
    term: { year: '1448', semester: 1 }, values: new Map(), empty: new Set(['s2']), saving: false }; paintImproveSheet();`);
  const html = runInAppContext(app, 'window.__modal');
  assert.equal((html.match(/imp-empty-note/g) || []).length, 1);
  assert.match(html, /ريان<small class="imp-empty-note">لا درجة له في الاختبارات \(فارغة\)/);
});

test('الفارغ: علامة «كانت فارغة» في الكشف تختلف عن العلامة العادية', () => {
  const app = loadApp({});
  assert.match(app.improveMarkHtml(5, true), /imp-mark is-empty[^>]*>↑ <bdi dir="ltr">\+5<\/bdi> · كانت فارغة/);
  assert.doesNotMatch(app.improveMarkHtml(2, false), /is-empty|فارغة/);
  assert.match(app.improveTestsMarkHtml({ bonus: 5, fromEmpty: true }), /كانت فارغة/);
  const g = { improve: { taskApplied: new Map([['a', { add: 3, empty: true }], ['b', { add: 2, empty: false }]]) } };
  assert.match(app.improveTaskMarkHtml(g, 'a'), /كانت فارغة/);
  assert.match(app.improveTaskMarkHtml(g, 'b'), /↑ <bdi dir="ltr">\+2<\/bdi><\//);
  assert.equal(app.improveTaskMarkHtml(g, 'z'), '');
  assert.equal(app.gradeImproveTaskApplied(g, 'a'), 3);
});

/* ============ 3.79: حذف اختبار/مهمة عليها تحسين ============ */
test('آخر اختبار حُذف: زيادة الاختبارات تتوقف مؤقتًا (لا تُحسب)، وتعود متى وُجد اختبار', () => {
  const app = loadApp({});
  const caps = { performance: 40, tests: 20 };
  const perf = [{ id: 'p', category: 'performance', name: 'مشاركة', max_score: 10, kind: 'participation' }];
  const off = J(app.studentGradeResult(perf, [], 'a', caps, 5));
  assert.equal(off.tests.points, null, 'لا تُحسب');
  assert.equal(off.tests.suspended, true);
  assert.equal(off.tests.bonus, 0);
  const on = J(app.studentGradeResult(perf.concat([{ id: 't', category: 'tests', name: 'جديد', max_score: 20 }]), [], 'a', caps, 5));
  assert.equal(on.tests.points, 5, 'عاد يُحسب (الطالب فارغ في الجديد)');
  assert.equal(on.tests.suspended, false);
});

test('آخر مهمة حُذفت: عمود المهام لا يأخذ زيادة التحسين (متوقف)، والمهمة في شعبة أخرى لا تكفي', async () => {
  const log = [];
  const seed = {
    classroom_tasks: [{ id: 'k9', teacher_id: 'u1', section_id: 'S2', academic_year: '1448', semester: 1, max_score: 10, created_at: '2026-09-01' }],
    classroom_task_students: [],
    classroom_grade_scores: [],
    classroom_improvements: [{ id: 'I', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, target: 'task', grade_period: null, max_score: 5 }],
    classroom_improvement_scores: [{ id: 'r', teacher_id: 'u1', improvement_id: 'I', student_id: 's1', score: 4 }]
  };
  const app = appWith(seed, log);
  runInAppContext(app, `periodCfg = () => ({ n: 1, starts: [] }); withGradePeriodCol = (fn) => fn(true);`);
  const res = await runInAppContext(app, `syncTaskColumn({ id: 'C', max_score: 20 }, 'S1', { year: '1448', semester: 1 }, ['s1'])`);
  assert.equal(res.suspended, true);
  assert.equal(log.filter(l => l.op === 'upsert').length, 0, 'لا درجة تُكتب من التحسين وحده');
  /* بوجود مهمة في الشعبة نفسها: يعود الحساب */
  seed.classroom_tasks.push({ id: 'k1', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, max_score: 10, created_at: '2026-09-01' });
  const res2 = await runInAppContext(app, `syncTaskColumn({ id: 'C', max_score: 20 }, 'S1', { year: '1448', semester: 1 }, ['s1'])`);
  assert.equal(res2.suspended, false);
  assert.deepEqual(J(log.filter(l => l.op === 'upsert').pop().rows), [{ teacher_id: 'u1', column_id: 'C', student_id: 's1', score: 4 }]);
});

test('فحص الحذف: يربط بالمعرّف ما عليه (إعادة أو زيادة على هذا الاختبار)، وينبّه بتوقف أنشطة المجموع حين لا يبقى اختبار', async () => {
  const base = {
    classroom_grade_columns: [{ id: 'T1', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, category: 'tests', name: 'الوحدة الأولى' }],
    classroom_improvements: [
      { id: 'R', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, target: 'tests', retake: 'max', column_id: 'T1', source_name: 'الوحدة الأولى', name: 'إعادة الأولى' },
      { id: 'L', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, target: 'tests', mode: 'retake', retake: null, column_id: null, source_name: 'الوحدة الأولى', name: 'قديم بالاسم' },
      { id: 'N', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, target: 'tests', retake: null, column_id: null, source_name: null, name: 'تحسيني عام' }]
  };
  const log = [];
  const app = appWith(base, log);
  runInAppContext(app, `gradeColumnVisible = () => true;`);
  const last = J(await runInAppContext(app, `improveLinksForDelete('tests', 'T1')`));
  assert.deepEqual(last.linked.map(i => i.id), ['R'], 'بالمعرّف لا بالاسم (القديم بالاسم زيادة على المجموع)');
  assert.deepEqual(last.suspend.map(i => i.id).sort(), ['L', 'N'], 'آخر اختبار: أنشطة المجموع تتوقف');
  assert.ok(log.filter(l => l.op === 'select').every(l => l.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1')), 'فلتر teacher_id');
  base.classroom_grade_columns.push({ id: 'T2', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, category: 'tests', name: 'الثانية' });
  const notLast = J(await runInAppContext(app, `improveLinksForDelete('tests', 'T1')`));
  assert.deepEqual(notLast.linked.map(i => i.id), ['R']);
  assert.deepEqual(notLast.suspend, []);
  assert.equal(await runInAppContext(app, `improveLinksForDelete('tests', 'T2')`), null, 'لا شيء عليه وبقي غيره');
});

test('حذف اختبار عليه «إعادة»: «معًا» = اللقطة نفسها تشمل التحسين ثم يُحذف؛ «أبقِ» = يصير نشاطًا عامًا', async () => {
  const seed = {
    classroom_grade_columns: [{ id: 'T1', teacher_id: 'u1', section_id: 'S1', academic_year: '1448', semester: 1, category: 'tests', name: 'أ', max_score: 20 }],
    classroom_grade_scores: [],
    classroom_improvements: [{ id: 'R', teacher_id: 'u1', section_id: 'S1', target: 'tests', retake: null, column_id: 'T1', source_name: 'أ', name: 'زيادة على أ' }],
    classroom_improvement_scores: [{ id: 'x', teacher_id: 'u1', improvement_id: 'R', student_id: 's1', score: 3 }]
  };
  for (const ch of ['both', 'keep']) {
    const log = [];
    const app = appWith(seed, log);
    runInAppContext(app, `
      crmGrades = { sectionId: 'S1', columns: [{ id: 'T1', category: 'tests', name: 'أ', max_score: 20 }], scores: [] };
      renderCrmGrades = async () => {}; trashOfferUndo = () => {}; trashDiscard = async () => {};
      improveConfirmDelete = async () => ({ ok: true, withImps: '${ch}' === 'both' ? ['R'] : [], keepIds: '${ch}' === 'keep' ? ['R'] : [] });
      window.__cap = null; trashProtect = async (fn) => { window.__cap = await fn(); return { id: 'TR' }; };`);
    await runInAppContext(app, `deleteCrmGradeColumn('T1')`);
    const tables = J(runInAppContext(app, 'window.__cap.tables.map(t => t.t + ":" + t.rows.length)'));
    const impDel = log.filter(l => l.table === 'classroom_improvements' && l.op === 'delete');
    const impUpd = log.filter(l => l.table === 'classroom_improvements' && l.op === 'update');
    if (ch === 'both') {
      assert.ok(tables.includes('classroom_improvements:1') && tables.includes('classroom_improvement_scores:1'), 'التراجع يعيدهما معًا');
      assert.equal(impDel.length, 1);
      assert.ok(impDel[0].filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'));
    } else {
      assert.ok(!tables.some(t => t.startsWith('classroom_improvement')));
      assert.equal(impDel.length, 0);
      assert.equal(impUpd.length, 1, 'يصير عامًا');
    }
    assert.equal(log.filter(l => l.table === 'classroom_grade_columns' && l.op === 'delete').length, 1);
  }
});

test('حذف اختبار: الإغلاق دون اختيار = لا حذف', async () => {
  const log = [];
  const app = appWith({}, log);
  runInAppContext(app, `crmGrades = { sectionId: 'S1', columns: [{ id: 'T1', category: 'tests', name: 'أ', max_score: 20 }], scores: [] };
    improveConfirmDelete = async () => ({ ok: false, withImps: [], keepIds: [] });`);
  await runInAppContext(app, `deleteCrmGradeColumn('T1')`);
  assert.equal(log.filter(l => l.op === 'delete').length, 0);
});

test('المتوقف مؤقتًا: شارة في القائمة، ولا يُذكر في التقرير التحليلي (لا أثر له)', () => {
  const app = appWith({}, []);
  const html = runInAppContext(app, `improveListHtml({ sectionId: 'S1', counts: new Map([['i1', 4]]), presetTarget: null,
    avail: improveAvailability([], []), list: [{ id: 'i1', section_id: 'S1', target: 'tests', mode: 'new', name: 'ت', max_score: 5 }] })`);
  assert.match(html, /متوقف مؤقتًا/);
  assert.match(html, /لا اختبارات في هذه الشعبة بعد/);
  runInAppContext(app, `appToolOn = () => true;`);
  const g = `({ columns: [{ id: 'p', category: 'performance', name: 'م', max_score: 10 }], scores: [],
    improve: { idx: improveIndex([{ id: 'i1', target: 'tests', name: 'ت', max_score: 5 }], [{ improvement_id: 'i1', student_id: 'a', score: 4 }]), taskApplied: new Map(), taskSuspended: false } })`;
  assert.equal(runInAppContext(app, `srImproveData(${g}, 'a')`), null);
});

/* ============ 3.80: زيادة على اختبار/مهمة معيّنة، وإعادة كاملة (تحلّ محلها / الأعلى) ============ */
const IMP = (o) => Object.assign({ target: 'tests', rule: 'add', retake: null, column_id: null, task_id: null, grade_period: null, created_at: '2026-11-01' }, o);

test('الإعادة: «الأعلى» لا تُنزل الدرجة، و«تحلّ محلها» تحلّ أيًّا كانت، والفارغ يأخذ الإعادة', () => {
  const app = loadApp({});
  const mx = { imp: IMP({ retake: 'max', max_score: 20 }), score: 18 };
  const rp = { imp: IMP({ retake: 'replace', max_score: 20 }), score: 9 };
  assert.deepEqual(J(app.improveApplyItem(12, [mx], 20)), { score: 18, orig: 12, retake: 'max', add: 0, empty: false });
  assert.equal(app.improveApplyItem(19, [mx], 20).score, 19, 'الأعلى: الأصلية أعلى فتبقى');
  assert.equal(app.improveApplyItem(12, [rp], 20).score, 9, 'تحلّ محلها ولو أقل');
  const em = J(app.improveApplyItem(null, [mx], 20));
  assert.equal(em.score, 18);
  assert.equal(em.empty, true);
  /* تغيّرت الكاملة للأصل من 20 إلى 10 بعد الإعادة: تُحوَّل بالنسبة */
  assert.equal(app.improveApplyItem(5, [mx], 10).score, 9);
  /* زيادة على الاختبار نفسه بعد الإعادة، بسقفه */
  assert.deepEqual(J(app.improveApplyItem(12, [mx, { imp: IMP({ max_score: 5, created_at: '2026-10-01' }), score: 5 }], 20)), { score: 20, orig: 12, retake: 'max', add: 2, empty: false });
});

test('درجات الاختبارات الفعلية: الإعادة والزيادة على اختبار معيّن تغيّران ذلك الاختبار فقط، والخام لا يُمس', () => {
  const app = loadApp({});
  const cols = [{ id: 't1', category: 'tests', name: 'أ', max_score: 20 }, { id: 't2', category: 'tests', name: 'ب', max_score: 20 }, { id: 'p', category: 'performance', name: 'م', max_score: 10 }];
  const raw = [{ column_id: 't1', student_id: 'a', score: 10 }, { column_id: 't2', student_id: 'a', score: 16 }, { column_id: 't1', student_id: 'b', score: 14 }];
  const list = [IMP({ id: 'R', retake: 'max', column_id: 't1', max_score: 20 }), IMP({ id: 'Z', column_id: 't2', max_score: 5 }), IMP({ id: 'T', max_score: 5 })];
  const sc = [{ improvement_id: 'R', student_id: 'a', score: 15 }, { improvement_id: 'R', student_id: 'b', score: 11 },
    { improvement_id: 'Z', student_id: 'a', score: 5 }, { improvement_id: 'R', student_id: 'c', score: 12 }];
  const rawCopy = J(raw);
  const eff = app.improveEffectiveScores(cols, raw, list, sc);
  assert.deepEqual(J(raw), rawCopy, 'الخام كما هو');
  const get = (c, s) => J(eff.find(x => x.column_id === c && x.student_id === s));
  assert.equal(get('t1', 'a').score, 15);
  assert.deepEqual(get('t1', 'a').imp, { orig: 10, retake: 'max', add: 0 });
  assert.equal(get('t1', 'b').score, 14, 'الأعلى: الأصلية 14 > 11');
  assert.deepEqual(get('t2', 'a').imp, { orig: 16, retake: null, add: 4 }, 'زيادة 5 بسقف 20');
  assert.equal(get('t1', 'c').score, 12, 'غاب عن الأصلي: الإعادة درجته');
  /* المحصلة: (15 + 20) من 40 × 20 = 17.5 — والزيادة على المجموع T لا تمسّ اختبارًا بعينه */
  const r = J(app.studentGradeResult(cols, eff, 'a', { performance: 40, tests: 20 }, app.improveTestsOf(app.improveIndex(list, sc), 'a')));
  assert.equal(r.tests.points, 17.5);
  assert.equal(r.tests.list[0].imp.retake, 'max', 'العلامة تصل لصفحة الطالب');
  assert.equal(app.improveTestsOf(app.improveIndex(list, sc), 'a'), 0, 'المجموع لا يحسب ما رُبط بعنصر');
});

test('المهام: إعادة مهمة معيّنة («تحلّ محلها») تنزل عمود المهام، وتظهر بعلامة ↓', () => {
  const app = loadApp({});
  const tasks = [{ id: 'k1', max_score: 10, grade_period: 1, created_at: '2026-09-01' }, { id: 'k2', max_score: 10, grade_period: 1, created_at: '2026-09-02' }];
  const rows = [{ task_id: 'k1', student_id: 'a', score: 8 }, { task_id: 'k2', student_id: 'a', score: 6 }];
  const list = [IMP({ id: 'R', target: 'task', retake: 'replace', task_id: 'k1', max_score: 10 })];
  const eff = app.improveEffectiveTaskRows(tasks, rows, list, [{ improvement_id: 'R', student_id: 'a', score: 4 }]);
  assert.equal(eff.find(r => r.task_id === 'k1').score, 4);
  assert.equal(rows.find(r => r.task_id === 'k1').score, 8, 'الخام لا يُمس');
  const plan = J(app.planTaskScoreSync(['a'], tasks, eff, 20, new Map(), [], null));
  assert.deepEqual(plan.upserts, [{ student_id: 'a', score: 10 }], '(4 + 6) من 20 × 20');
  const applied = J(app.taskImproveApplied(['a'], tasks, rows, eff, 20, [], null).get('a'));
  assert.deepEqual(applied, { add: -4, empty: false });
  assert.match(app.improveMarkHtml(-4), /is-down[^>]*>↓ <bdi dir="ltr">-4<\/bdi>/);
  /* غير مكلَّف بالمهمة وشارك في إعادتها: تُحسب له */
  const eff2 = app.improveEffectiveTaskRows(tasks, rows, list, [{ improvement_id: 'R', student_id: 'b', score: 7 }]);
  assert.deepEqual(J(eff2.find(r => r.student_id === 'b')), { task_id: 'k1', student_id: 'b', score: 7, imp: { orig: null, retake: 'replace', add: 0 } });
});

test('الكشف: الخانة تعرض «إعادة، كانت 12» والتعديل يكتب الخام لا درجة الإعادة', async () => {
  const log = [];
  const app = appWith({}, log);
  assert.match(runInAppContext(app, `improveCellNoteHtml({ orig: 12, retake: 'max', add: 0 })`), /إعادة، كانت 12/);
  assert.match(runInAppContext(app, `improveCellNoteHtml({ orig: null, retake: 'replace', add: 0 })`), /إعادة، كانت فارغة/);
  assert.match(runInAppContext(app, `improveCellNoteHtml({ orig: 16, retake: null, add: 4 })`), /↑ <bdi dir="ltr">\+4/);
  /* مدخل التعديل يبدأ من الخام (12) لا من الفعلية (18) */
  const v = runInAppContext(app, `(() => { const g = { rawScores: [{ column_id: 't1', student_id: 'a', score: 12 }], scores: [{ column_id: 't1', student_id: 'a', score: 18, imp: { orig: 12, retake: 'max', add: 0 } }] };
    return crmGradeEntryScores(g, { id: 't1' }, null).get('a'); })()`);
  assert.equal(v, 12);
  const ex = J(runInAppContext(app, `crmGradeImportExisting({ columns: [], rawScores: [{ column_id: 't1', student_id: 'a', score: 12 }], scores: [{ column_id: 't1', student_id: 'a', score: 18 }] })`));
  assert.equal(ex[0].score, 12, 'الاستيراد يقارن بالخام');
});

test('حذف اختبار عليه إعادة كاملة: لا خيار «أبقِ» (الإعادة لا تبقى بلا أصلها)؛ وعليه زيادة: «أبقِ» على المجموع', async () => {
  const app = appWith({}, []);
  runInAppContext(app, `window.__choices = null; improveAskChoice = async (h, c) => { window.__choices = c.map(x => x.key); return 'both'; };`);
  runInAppContext(app, `improveLinksForDelete = async () => ({ linked: [{ id: 'R', name: 'إعادة', retake: 'max', column_id: 'T1', target: 'tests', section_id: 'S1' }], suspend: [], lastFor: new Set() });`);
  const c1 = J(await runInAppContext(app, `improveConfirmDelete('tests', 'T1', 'أ', 'حذف؟')`));
  assert.deepEqual(J(runInAppContext(app, 'window.__choices')), ['both']);
  assert.deepEqual(c1.withImps, ['R']);
  runInAppContext(app, `improveLinksForDelete = async () => ({ linked: [{ id: 'Z', name: 'زيادة', retake: null, column_id: 'T1', target: 'tests', section_id: 'S1' }], suspend: [], lastFor: new Set() });`);
  await runInAppContext(app, `improveConfirmDelete('tests', 'T1', 'أ', 'حذف؟')`);
  assert.deepEqual(J(runInAppContext(app, 'window.__choices')), ['both', 'keep']);
});

test('«أبقِ الزيادة على المجموع»: يفرّغ الربط بفلتر teacher_id', async () => {
  const log = [];
  const app = appWith({}, log);
  await runInAppContext(app, `improveAfterItemDelete({ withImps: [], keepIds: ['Z'] })`);
  const u = log.find(l => l.table === 'classroom_improvements' && l.op === 'update');
  assert.ok(u && u.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'));
});

test('SQL 3.80: حقول الربط والإعادة إضافية فقط، والحرّاس والقفل بالمهمة المعيّنة، في الملفين', () => {
  const upd = read('sql-updates-run-in-supabase.sql');
  const schema = runInAppContext(loadApp({}), 'buildSchemaSql()');
  for (const sql of [upd, schema]) {
    assert.match(sql, /add column if not exists column_id uuid/);
    assert.match(sql, /add column if not exists task_id uuid/);
    assert.match(sql, /add column if not exists retake text/);
    assert.match(sql, /check \(retake is null or retake in \('replace', 'max'\)\)/);
    assert.match(sql, /on delete set null \(column_id\)/);
    assert.match(sql, /on delete set null \(task_id\)/);
    assert.match(sql, /new\.retake is distinct from old\.retake/);
    assert.match(sql, /\(new\.column_id is distinct from old\.column_id and new\.column_id is not null\)/, 'الربط لا يتغيّر إلا إلى فارغ');
    assert.match(sql, /left join public\.classroom_tasks t on t\.id = i\.task_id/, 'قفل فترة المهمة المعيّنة');
  }
  const blk = upd.slice(upd.indexOf('-- ============ تحسين الدرجات (3.80)'), upd.indexOf('-- النسخة الاحتياطية الشاملة للمسؤول'));
  assert.doesNotMatch(blk.replace(/--[^\n]*/g, ''), /drop constraint|drop column|drop table/i);
  assert.doesNotMatch(blk, /`|\$\{|\\/);
});

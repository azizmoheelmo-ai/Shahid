'use strict';
/* ============================================================
   اختبار بسلّم تقدير (app-41) — السلوك مع عميل وهمي
   ------------------------------------------------------------
   - متاح لكل الحسابات (بلا مفتاح).
   - الاعتماد: رصد المعايير ثم الدرجة الكلية، بفلتر المعلم، ونقرة واحدة فقط أثناء الحفظ.
   - فشل رصد المعايير: لا درجة تُكتب، والطالب يبقى غير معتمد.
   - المعلم انتقل لشاشة أخرى أثناء الحفظ: لا يُكتب شيء فوق الشاشة الجديدة.
   - فشل حفظ المعايير بعد إنشاء الاختبار: يُحذف الاختبار الفارغ ولا يبقى اختبار بلا معاييره.
   - عمود السلّم محسوب: لا رصد يدوي ولا تعديل لدرجته، وتحميه السلة مع معاييره ورصده.
   - XSS: أسماء المعايير تمرّ بـescapeHtml في الرصد والتقرير.
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

function fakeClient(seed, log, opts) {
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table) {
      const f = [];
      let op = 'select', values = null, onConflict = null, wantRows = false;
      const result = () => {
        if (opts.fail && opts.fail(table, op)) return { data: null, error: { message: 'boom' } };
        if (op === 'insert') {
          const rows = Array.isArray(values) ? values : [values];
          log.push({ table, op, rows });
          return { data: wantRows ? rows.map((r, i) => Object.assign({ id: 'NEW' + i }, r)) : null, error: null };
        }
        if (op === 'upsert') { log.push({ table, op, rows: Array.isArray(values) ? values : [values], onConflict }); return { data: null, error: null }; }
        if (op === 'update' || op === 'delete') { log.push({ table, op, filters: f.slice() }); return { data: null, error: null }; }
        log.push({ table, op: 'select', filters: f.slice() });
        return { data: match(seed[table], f), error: null };
      };
      const api = {
        select() { if (op === 'insert') wantRows = true; return api; }, order() { return api; }, range() { return api; }, limit() { return api; },
        eq(c, v) { f.push([c, v]); return api; }, in(c, v) { f.push([c, v]); return api; },
        insert(r) { op = 'insert'; values = r; return api; }, upsert(r, o) { op = 'upsert'; values = r; onConflict = o && o.onConflict; return api; },
        update() { op = 'update'; return api; }, delete() { op = 'delete'; return api; },
        then(res, rej) { return Promise.resolve(opts.delay && opts.delay(table, op)).then(() => result()).then(res, rej); },
      };
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) },
  };
}

const CRIT = [{ id: 'c1', name: 'الدقة', points: 2, position: 0 }, { id: 'c2', name: 'الطلاقة', points: 2, position: 1 }, { id: 'c3', name: 'الفهم', points: 1, position: 2 }];
const STUDENTS = [{ id: 's1', full_name: 'سلمان' }, { id: 's2', full_name: 'ريان' }];

function appWith(seed, log, opts, on) {
  const app = loadApp({ supabaseClient: fakeClient(seed || {}, log, opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    appFeatures = ${on === false ? '{}' : '{ rubricTests: true }'};
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    showConfirm = async () => true; afterCrmGradesChanged = () => {};
    crmStudentsOfSection = () => ${JSON.stringify(STUDENTS)};
  `);
  return app;
}

function openSheet(app) {
  runInAppContext(app, `
    window.__A = { token: 1, sectionId: 'S', states: {}, test: { selectedId: 'T1', values: new Map(), queue: new Map(), tests: [] }, rubric: null };
    crmSheet = window.__A;
    crmSheet.rubric = rubricInitState({ id: 'T1', max_score: 5 }, ${JSON.stringify(CRIT)}, [], crmSheet.test.values, crmStudentsOfSection());
  `);
}
const J = x => JSON.parse(JSON.stringify(x));
const writes = (log, table, op) => log.filter(l => l.table === table && l.op === op);

test('متاح لكل الحسابات بلا مفتاح: النموذج يظهر والمعايير تُحمَّل حتى مع features فارغة', async () => {
  const log = [];
  const app = appWith({}, log, {}, false); /* features = {} : لا rubricTests */
  assert.equal(runInAppContext(app, 'rubricOn()'), true);
  assert.notEqual(runInAppContext(app, 'rubricFormHtml()'), '');
  await runInAppContext(app, `rubricLoadCriteria(['T1'])`);
  assert.ok(log.length > 0, 'استعلام المعايير يجري لكل معلم');
});

test('المفتاح مفتوح: تحميل المعايير بفلتر المعلم، والعمود يصير محسوبًا وغير قابل للرصد اليدوي', async () => {
  const log = [];
  const seed = { classroom_rubric_criteria: CRIT.map(c => ({ id: c.id, column_id: 'T1', teacher_id: 'u1', name: c.name, points: String(c.points), position: c.position })) };
  const app = appWith(seed, log);
  assert.match(runInAppContext(app, 'rubricFormHtml()'), /رصد بسلّم تقدير/);
  await runInAppContext(app, `rubricLoadCriteria(['T1', 'T2'])`);
  const q = log.find(l => l.table === 'classroom_rubric_criteria');
  assert.deepEqual(q.filters.map(([c]) => c).sort(), ['column_id', 'teacher_id'], 'فلتر teacher_id صريح');
  assert.equal(runInAppContext(app, 'rubricIsColumn("T1")'), true);
  assert.equal(runInAppContext(app, 'rubricIsColumn("T2")'), false);
  assert.equal(runInAppContext(app, 'isComputedGradeColumn({ id: "T1", kind: "manual" })'), true);
  assert.equal(runInAppContext(app, 'crmGradeColumnEditable({ id: "T1", kind: "manual" })'), false);
  assert.equal(runInAppContext(app, 'crmGradeColumnEditable({ id: "T2", kind: "manual" })'), true);
});

test('الاعتماد: المعايير ثم الدرجة الكلية، وبفلتر المعلم', async () => {
  const log = [];
  const app = appWith({}, log);
  openSheet(app);
  runInAppContext(app, 'rubricPickLevel(1, 1); rubricPickLevel(2, 3);'); /* الدقة كامل (افتراضي) · الطلاقة كبير · الفهم بداية */
  await runInAppContext(app, 'rubricApprove()');
  const marks = writes(log, 'classroom_rubric_marks', 'upsert')[0];
  assert.equal(marks.onConflict, 'criterion_id,student_id');
  assert.deepEqual(J(marks.rows).map(r => [r.criterion_id, r.level, r.teacher_id, r.student_id, r.column_id]),
    [['c1', 0, 'u1', 's1', 'T1'], ['c2', 1, 'u1', 's1', 'T1'], ['c3', 3, 'u1', 's1', 'T1']]);
  const sc = writes(log, 'classroom_grade_scores', 'upsert')[0];
  assert.equal(sc.rows[0].score, 3.75);
  assert.equal(sc.rows[0].teacher_id, 'u1');
  assert.ok(log.indexOf(marks) < log.indexOf(sc), 'المعايير قبل الدرجة');
  assert.equal(runInAppContext(app, 'crmSheet.rubric.cur'), 's2', 'ينتقل للطالب التالي');
  assert.equal(runInAppContext(app, 'crmSheet.test.values.get("s1")'), 3.75);
});

test('نقرة اعتماد مزدوجة: كتابة واحدة فقط', async () => {
  const log = [];
  const app = appWith({}, log, { delay: (t, op) => op === 'upsert' ? new Promise(r => setTimeout(r, 15)) : null });
  openSheet(app);
  const a = runInAppContext(app, 'rubricApprove()');
  const b = runInAppContext(app, 'rubricApprove()');
  await Promise.all([a, b]);
  assert.equal(writes(log, 'classroom_rubric_marks', 'upsert').length, 1);
  assert.equal(writes(log, 'classroom_grade_scores', 'upsert').length, 1);
});

test('فشل رصد المعايير: لا درجة تُكتب والطالب يبقى غير معتمد', async () => {
  const log = [];
  const app = appWith({}, log, { fail: (t, op) => t === 'classroom_rubric_marks' && op === 'upsert' });
  openSheet(app);
  await runInAppContext(app, 'rubricApprove()');
  assert.equal(writes(log, 'classroom_grade_scores', 'upsert').length, 0);
  assert.equal(runInAppContext(app, 'crmSheet.rubric.done.has("s1")'), false);
  assert.equal(runInAppContext(app, 'crmSheet.rubric.busy'), false);
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /error:لم يُحفظ الرصد/);
});

test('سباق: انتقل المعلم لشاشة أخرى أثناء الحفظ فلا يُكتب شيء فوقها', async () => {
  const log = [];
  const app = appWith({}, log, { delay: (t, op) => op === 'upsert' ? new Promise(r => setTimeout(r, 15)) : null });
  openSheet(app);
  const p = runInAppContext(app, 'rubricApprove()');
  /* المعلم يبدّل الاختبار من القائمة قبل انتهاء الحفظ: نفس كائن الورقة يُعاد بناؤه على اختبار آخر */
  runInAppContext(app, `crmSheet.test = { selectedId: 'T2', values: new Map(), queue: new Map(), tests: [] }; crmSheet.rubric = null;`);
  await p;
  assert.equal(runInAppContext(app, 'crmSheet.test.values.size'), 0, 'الشاشة الجديدة لم تُلمَس');
  assert.equal(runInAppContext(app, 'crmSheet.rubric'), null);
});

test('إنشاء الاختبار: معايير لكل شعبة، والفشل يحذف الاختبار الفارغ بفلتر المعلم', async () => {
  const log = [];
  const app = appWith({}, log);
  const cols = [{ id: 'A' }, { id: 'B' }];
  const rows = [{ name: 'الدقة', points: 3, position: 0 }, { name: 'الفهم', points: 2, position: 1 }];
  const err = await runInAppContext(app, `rubricCreateForColumns(${JSON.stringify(cols)}, ${JSON.stringify(rows)})`);
  assert.equal(err, null);
  const ins = writes(log, 'classroom_rubric_criteria', 'insert')[0].rows;
  assert.equal(ins.length, 4);
  assert.ok(ins.every(r => r.teacher_id === 'u1'));
  assert.deepEqual(J(ins).filter(r => r.column_id === 'A').map(r => r.name), ['الدقة', 'الفهم']);

  const log2 = [];
  const app2 = appWith({}, log2, { fail: (t, op) => t === 'classroom_rubric_criteria' && op === 'insert' });
  const err2 = await runInAppContext(app2, `rubricCreateForColumns(${JSON.stringify(cols)}, ${JSON.stringify(rows)})`);
  assert.ok(err2);
  const del = writes(log2, 'classroom_grade_columns', 'delete')[0];
  assert.deepEqual(J(del.filters), [['teacher_id', 'u1'], ['id', ['A', 'B']]]);
});

test('رصد غير مكتمل في وضع «صفر»: لا اعتماد', async () => {
  const log = [];
  const app = appWith({}, log);
  runInAppContext(app, `localStorage = { getItem: () => 'up', setItem: () => {} };`);
  openSheet(app);
  assert.equal(runInAppContext(app, 'crmSheet.rubric.mode'), 'up');
  runInAppContext(app, 'rubricPickLevel(0, 0);');
  await runInAppContext(app, 'rubricApprove()');
  assert.equal(writes(log, 'classroom_rubric_marks', 'upsert').length, 0);
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /أكمل رصد كل المعايير/);
});

test('XSS: أسماء المعايير والطلاب تُهرَّب في الرصد والتقرير', async () => {
  const app = appWith({}, []);
  const bad = '<img src=x onerror=alert(1)>';
  runInAppContext(app, `
    window.__A = { token: 1, sectionId: 'S', states: {}, test: { selectedId: 'T1', values: new Map(), queue: new Map(), tests: [] }, rubric: null };
    crmSheet = window.__A;
    crmStudentsOfSection = () => [{ id: 's1', full_name: ${JSON.stringify(bad)} }];
    crmSheet.rubric = rubricInitState({ id: 'T1', max_score: 5 }, [{ id: 'c1', name: ${JSON.stringify(bad)}, points: 5, position: 0 }], [], crmSheet.test.values, crmStudentsOfSection());
  `);
  const html = runInAppContext(app, 'rubricBodyHtml(crmSheet.rubric, crmStudentsOfSection())');
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  const rep = runInAppContext(app, `rubricReportHtml([{ name: ${JSON.stringify(bad)}, max: 5, score: 5, items: [{ name: ${JSON.stringify(bad)}, points: 5, level: 0 }] }])`);
  assert.doesNotMatch(rep, /<img src=x/);
});

test('السلة: حذف الاختبار يلتقط معاييره ورصدها بترتيب الاسترجاع (العمود ثم المعايير ثم الدرجات ثم الرصد)', async () => {
  const log = [];
  const seed = {
    classroom_grade_columns: [{ id: 'T1', teacher_id: 'u1', name: 'اختبار قراءة' }],
    classroom_grade_scores: [{ id: 'g1', teacher_id: 'u1', column_id: 'T1' }],
    classroom_rubric_criteria: [{ id: 'c1', teacher_id: 'u1', column_id: 'T1' }],
    classroom_rubric_marks: [{ id: 'm1', teacher_id: 'u1', column_id: 'T1' }],
    classroom_rubric_notes: [{ id: 'n1', teacher_id: 'u1', column_id: 'T1' }],
  };
  const app = appWith(seed, log);
  const cap = await runInAppContext(app, `trashCaptureGradeColumns(['T1'], 'u1', 'اختبار قراءة')`);
  assert.deepEqual(J(cap.tables).map(t => t.t), ['classroom_grade_columns', 'classroom_rubric_criteria', 'classroom_grade_scores', 'classroom_grade_period_scores', 'classroom_rubric_marks', 'classroom_rubric_notes']);
  assert.equal(cap.tables[1].rows.length, 1);
  assert.equal(cap.tables[4].rows.length, 1);
});

test('السلة: جداول السلّم غير موجودة بعد في القاعدة لا تمنع الحذف', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [{ id: 'T1', teacher_id: 'u1', name: 'اختبار' }] };
  const app = appWith(seed, log, { fail: t => t.startsWith('classroom_rubric') });
  /* تعذّر القراءة لسبب غير «الجدول غير موجود» يبقى خطأً (لا نخفي الأعطال)، أما غيابه فيُتجاوز */
  const miss = loadApp({ supabaseClient: (() => {
    const c = fakeClient(seed, [], {});
    const from = c.from;
    c.from = t => t.startsWith('classroom_rubric') ? (() => { const a = from(t); a.then = (res) => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }).then(res); return a; })() : from(t);
    return c;
  })(), currentUser: { id: 'u1' } });
  const cap = await runInAppContext(miss, `trashCaptureGradeColumns(['T1'], 'u1', 'اختبار')`);
  assert.equal(cap.tables.find(t => t.t === 'classroom_rubric_criteria').rows.length, 0);
  await assert.rejects(runInAppContext(app, `trashCaptureGradeColumns(['T1'], 'u1', 'اختبار')`));
});

test('انحدار: المجموع يُكتب «س من ص» لا «س / ص» (في الاتجاه من اليمين لليسار تنقلب فتظهر «5 / 0»)', async () => {
  const app = appWith({}, []);
  openSheet(app);
  const html = runInAppContext(app, 'rubricBodyHtml(crmSheet.rubric, crmStudentsOfSection())');
  assert.match(html, /<b>5 من 5<\/b>/, 'يبدأ كاملًا في وضع «كامل الدرجة»');
  assert.doesNotMatch(html, /<b>[\d.]+ \/ [\d.]+<\/b>/);
});

test('اختبار السلّم: أسفل الشاشة اعتماد ثم رجوع وملاحظة، بلا زر «حفظ» العام (لا يرى الاعتماد فيطمئن كذبًا)', () => {
  const app = appWith({}, []);
  openSheet(app);
  const html = runInAppContext(app, 'rubricBodyHtml(crmSheet.rubric, crmStudentsOfSection())');
  assert.match(html, /rubricApprove\(\)/);
  assert.match(html, /rubricBack\(\)[^<]*>رجوع</);
  assert.match(html, /rubricOpenNote\(\)[^<]*>📝 ملاحظة/);
  assert.doesNotMatch(html, /crmModeFinishBtn|finishCrmLessonSheet|>حفظ</);
  /* الترتيب: الاعتماد ثم رجوع ثم ملاحظة */
  assert.ok(html.indexOf('rubricApprove()') < html.indexOf('rubricBack()') && html.indexOf('rubricBack()') < html.indexOf('rubricOpenNote()'));
  /* فرع السلّم في ورقة الاختبار لا يستدعي زر الحفظ العام، والاختبار العادي يبقى به */
  const src = fs.readFileSync(path.join(root, "app", "app-24-tests-sheet.js"), 'utf8');
  const branch = src.slice(src.indexOf('if(s.rubric){'), src.indexOf('rubricPaint();', src.indexOf('if(s.rubric){')));
  assert.doesNotMatch(branch, /crmSheetFinishBtnHtml/);
  assert.match(src, /\$\{crmSheetFinishBtnHtml\(\)\}/);
});

test('ملاحظة الطالب: تُحفظ بفلتر المعلم، والفارغة تحذف، ونقطة على الاسم والزر', async () => {
  const log = [];
  const app = appWith({}, log);
  runInAppContext(app, `window.__modal = ''; showInfoModal = h => { window.__modal = h; }; closeCrmModal = () => {};`);
  openSheet(app);
  runInAppContext(app, 'rubricOpenNote()');
  assert.match(runInAppContext(app, 'window.__modal'), /ملاحظة — سلمان/);
  runInAppContext(app, `document.getElementById = id => id === 'rubricNoteText' ? { value: '  يتعثر في الراء  ' } : { innerHTML: '', querySelector: () => null, disabled: false };`);
  await runInAppContext(app, 'rubricSaveNote()');
  const up = writes(log, 'classroom_rubric_notes', 'upsert')[0];
  assert.deepEqual(J(up.rows[0]), { teacher_id: 'u1', column_id: 'T1', student_id: 's1', note: 'يتعثر في الراء' });
  assert.equal(up.onConflict, 'column_id,student_id');
  assert.equal(runInAppContext(app, 'crmSheet.rubric.notes.get("s1")'), 'يتعثر في الراء');
  const html = runInAppContext(app, 'rubricBodyHtml(crmSheet.rubric, crmStudentsOfSection())');
  assert.equal((html.match(/rb-dot/g) || []).length, 2, 'نقطة على اسم الطالب وعلى زر الملاحظة');
  /* فارغة = حذف بفلتر المعلم */
  runInAppContext(app, 'rubricOpenNote()');
  runInAppContext(app, `document.getElementById = id => id === 'rubricNoteText' ? { value: '   ' } : { innerHTML: '', querySelector: () => null, disabled: false };`);
  await runInAppContext(app, 'rubricSaveNote()');
  const del = writes(log, 'classroom_rubric_notes', 'delete')[0];
  assert.deepEqual(J(del.filters), [['teacher_id', 'u1'], ['column_id', 'T1'], ['student_id', 's1']]);
  assert.equal(runInAppContext(app, 'crmSheet.rubric.notes.has("s1")'), false);
  /* طول الملاحظة محدود بـ300 */
  assert.equal(runInAppContext(app, `rubricNormalizeNote('ا'.repeat(400)).length`), 300);
});

test('ملاحظة الطالب: تبديل الاختبار أثناء الحفظ لا يلمس الشاشة الجديدة، والفشل يترك الملاحظة كما كانت', async () => {
  const log = [];
  const app = appWith({}, log, { delay: (t, op) => op === 'upsert' ? new Promise(r => setTimeout(r, 15)) : null });
  runInAppContext(app, `showInfoModal = () => {}; closeCrmModal = () => {};`);
  openSheet(app);
  runInAppContext(app, 'rubricOpenNote()');
  runInAppContext(app, `document.getElementById = id => id === 'rubricNoteText' ? { value: 'ملاحظة' } : { innerHTML: '', querySelector: () => null, disabled: false };`);
  const p = runInAppContext(app, 'rubricSaveNote()');
  runInAppContext(app, `crmSheet.test = { selectedId: 'T2', values: new Map(), queue: new Map(), tests: [] }; crmSheet.rubric = rubricInitState({ id: 'T2', max_score: 5 }, [], [], new Map(), []);`);
  await p;
  assert.equal(runInAppContext(app, 'crmSheet.rubric.notes.size'), 0, 'الشاشة الجديدة لم تُلمَس');

  const app2 = appWith({}, [], { fail: (t, op) => t === 'classroom_rubric_notes' && op === 'upsert' });
  runInAppContext(app2, `showInfoModal = () => {}; closeCrmModal = () => {};`);
  openSheet(app2);
  runInAppContext(app2, 'rubricOpenNote()');
  runInAppContext(app2, `document.getElementById = id => id === 'rubricNoteText' ? { value: 'ملاحظة' } : { innerHTML: '', querySelector: () => null, disabled: false };`);
  await runInAppContext(app2, 'rubricSaveNote()');
  assert.equal(runInAppContext(app2, 'crmSheet.rubric.notes.size'), 0);
  assert.match(runInAppContext(app2, 'window.__toasts.join("|")'), /error:لم تُحفظ الملاحظة/);
});

test('ملاحظة الطالب: النص يُهرَّب في النافذة (XSS)', () => {
  const app = appWith({}, []);
  runInAppContext(app, `window.__modal = ''; showInfoModal = h => { window.__modal = h; };`);
  openSheet(app);
  runInAppContext(app, `crmSheet.rubric.notes.set('s1', '</textarea><img src=x onerror=alert(1)>'); rubricOpenNote();`);
  const m = runInAppContext(app, 'window.__modal');
  assert.doesNotMatch(m, /<img src=x/);
  assert.match(m, /&lt;img src=x/);
});

test('صف الطلاب: الطالب الحالي يُمرَّر لمجال الرؤية بعد الانتقال أو الاختيار لا بعد نقر مستوى', async () => {
  const app = appWith({}, []);
  openSheet(app);
  runInAppContext(app, `
    window.__scrolls = 0;
    document.getElementById = id => id === 'rubricSheetBox' ? { innerHTML: '', querySelector: () => ({ scrollIntoView: o => { window.__scrolls++; window.__opt = o; } }) } : { innerHTML: '' };
  `);
  runInAppContext(app, 'rubricPickLevel(0, 1)');
  assert.equal(runInAppContext(app, 'window.__scrolls'), 0, 'نقر مستوى لا يحرّك الصف');
  runInAppContext(app, 'rubricSelectStudent(1)');
  assert.equal(runInAppContext(app, 'window.__scrolls'), 1);
  assert.equal(runInAppContext(app, 'window.__opt.inline'), 'center');
  await runInAppContext(app, 'rubricApprove()');
  assert.equal(runInAppContext(app, 'window.__scrolls'), 2, 'بعد الاعتماد والانتقال للتالي');
});

test('زر الاعتماد: اسم واحد «اعتماد» دائمًا، وتنبيه «لم تُحفظ» بعد أي اختيار، ويزول بالاعتماد', async () => {
  const app = appWith({}, []);
  openSheet(app);
  const html = () => runInAppContext(app, `rubricBodyHtml(crmSheet.rubric, rubricStudents())`);
  const h0 = html();
  assert.match(h0, /id="rubricApproveBtn"[^>]*>اعتماد<\/button>/, 'الطالب الأول');
  assert.doesNotMatch(h0, /اعتماد والانتقال للتالي|اعتماد الدرجة/);
  assert.doesNotMatch(h0, /لم تُحفظ بعد/, 'لا تنبيه قبل أي اختيار');
  assert.doesNotMatch(h0, /أكمل رصد كل المعايير ليُفعَّل/, 'لا جملة «أكمل رصد…» بلا اختيار');
  runInAppContext(app, `rubricSetMode('up')`);
  const hUp = html();
  assert.doesNotMatch(hUp, /أكمل رصد كل المعايير ليُفعَّل/, 'وضع «يبدأ من صفر»: لا جملة، والزر معطّل');
  assert.match(hUp, /id="rubricApproveBtn"[^>]*disabled/);
  runInAppContext(app, `rubricPickLevel(0, 1)`);
  assert.match(html(), /اختياراتك لم تُحفظ بعد/);
  runInAppContext(app, `rubricSelectStudent(1)`);
  assert.match(html(), /id="rubricApproveBtn"[^>]*>اعتماد<\/button>/, 'الطالب الأخير بالاسم نفسه');
  runInAppContext(app, `rubricSelectStudent(0); crmSheet.rubric.criteria.forEach((c, i) => rubricPickLevel(i, 0));`);
  assert.match(html(), /اعتمد لحفظ الدرجة/, 'مكتمل وغير معتمد');
  await runInAppContext(app, 'rubricApprove()');
  assert.equal(runInAppContext(app, 'crmSheet.rubric.touched.has("s1")'), false, 'الاعتماد يُنهي حالة «لم يُحفظ»');
});

test('«رجوع»: يسأل إن بقيت اختيارات غير معتمدة ولا يخرج لو رفض، ويخرج مباشرة بلا شيء معلّق', async () => {
  const app = appWith({}, []);
  openSheet(app);
  runInAppContext(app, `window.__closed = 0; closeCrmLessonSheet = () => { window.__closed++; }; window.__asked = 0; showConfirm = async () => { window.__asked++; return window.__ans; };`);
  await runInAppContext(app, 'rubricBack()');
  assert.equal(runInAppContext(app, 'window.__closed'), 1, 'بلا اختيارات: يخرج بلا سؤال');
  assert.equal(runInAppContext(app, 'window.__asked'), 0);
  runInAppContext(app, `rubricPickLevel(0, 1); window.__ans = false;`);
  await runInAppContext(app, 'rubricBack()');
  assert.equal(runInAppContext(app, 'window.__asked'), 1);
  assert.equal(runInAppContext(app, 'window.__closed'), 1, 'رفض: يبقى');
  runInAppContext(app, `window.__ans = true;`);
  await runInAppContext(app, 'rubricBack()');
  assert.equal(runInAppContext(app, 'window.__closed'), 2, 'وافق: يخرج');
});

test('شريط الاعتماد يثبت فوق شريط التنقل السفلي لا خلفه', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(css, /\.rb-actions\{[^}]*position:sticky;bottom:calc\(66px \+ env\(safe-area-inset-bottom/);
});

'use strict';
/* ============================================================
   الكشف الجدولي («جدول كامل») وأدواته:
   - لا مبدّل «جدول كامل»: القائمة وحدها، وزر ＋ بجانب الشعبة (الكود القديم للجدول باقٍ خاملاً).
   - الجدول: اسم ومجموع ثابتان، شريط مجموعات، ألوان، متوسط الشعبة.
   - تعديل خانة واحدة: يكتب بمعرّف المعلم، لا يكتب غير المتغيّر، ولا يرسم فوق شاشة أخرى.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const C = (id, category, max, extra) => Object.assign({ id, category, name: id, max_score: max, kind: 'manual' }, extra || {});
const S = (column_id, student_id, score) => ({ column_id, student_id, score });
const COLS = [
  C('p', 'performance', 10, { name: 'مشاركة', kind: 'manual' }), C('h', 'performance', 10, { name: 'واجبات', kind: 'homework' }),
  C('k', 'performance', 20, { name: 'مهام أدائية', kind: 'task' }),
  C('t1', 'tests', 10, { name: 'اختبار ١' }),
];
const G = (cols, scores) => ({ sectionId: 'S', year: 'Y', semester: 1, columns: cols, allColumns: cols, hiddenColumns: [], scores, breakdown: new Map() });

function appWith(log, extra){
  const sb = {
    from(table){
      const f = []; let op = 'select', values = null, options = null;
      const api = { select(){ return api; }, eq(c, v){ f.push([c, v]); return api; }, in(){ return api; },
        upsert(r, o){ op = 'upsert'; values = r; options = o; return api; }, delete(){ op = 'delete'; return api; },
        then(res, rej){ log.push({ table, op, values, options, filters: f.slice() }); return Promise.resolve({ data: [], error: (extra && extra.error) || null }).then(res, rej); } };
      return api;
    },
    rpc(name, args){ log.push({ op: 'rpc', name, args }); return Promise.resolve({ data: 1, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) },
  };
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'u1' } });
  runInAppContext(app, `
    crmStudents = [{ id: 'a', full_name: 'سامي <b>علي</b>', section_id: 'S' }, { id: 'b', full_name: 'فهد', section_id: 'S' }];
    crmSectionLabel = () => 'ثاني/٦';
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__modal = []; showInfoModal = h => window.__modal.push(h);
    window.__closed = 0; closeCrmModal = () => { window.__closed++; };
    afterCrmGradesChanged = () => {};
    window.__painted = 0; paintCrmGradeCell = () => { window.__painted++; };
    repaintCrmGradesKeepScroll = () => { window.__repainted = (window.__repainted || 0) + 1; };`);
  return app;
}

function openCell(app, g, columnId, studentId, value){
  app.__g = g;
  runInAppContext(app, `
    crmGrades = __g;
    document.body.innerHTML = '<input id="crmGradeCellInput"><div id="crmGradeCellErr"></div>';
    document.getElementById('crmGradeCellInput').value = ${JSON.stringify(value)};
    crmGradeCell = { sheet: __g, columnId: ${JSON.stringify(columnId)}, studentId: ${JSON.stringify(studentId)}, saving: false };`);
}

test('المكان: لا «جدول كامل» ولا مبدّل؛ زر ＋ بجانب الشعبة، وترس واحد، وأزرار «رصد» للأعمدة اليدوية فقط', async () => {
  const app = appWith([]);
  const g = G(COLS, [S('p', 'a', 8)]);
  runInAppContext(app, 'crmGradesDetail = true'); /* حتى لو بقيت الحالة القديمة: القائمة هي المعروضة */
  const page = app.crmGradesPageHtml(g);
  assert.doesNotMatch(page, /جدول كامل|setCrmGradesDetail|crm-grade-table/);
  assert.match(page, /crm-gs-topbar[\s\S]*<select[\s\S]*crm-gs-plus[^>]*onclick="openCrmGradeToolsMenu\(\)">＋</, '＋ في صف اختيار الشعبة نفسه');
  assert.equal((page.match(/openCrmGradeSettings\(\)/g) || []).length, 1, 'ترس واحد للإعداد');
  assert.doesNotMatch(page, />⋮</);
  assert.match(page, /التوزيع: <b>الأداء 40<\/b> · <b>الاختبارات 20<\/b>/, 'سطر توزيع قصير');
  assert.doesNotMatch(page, /مشاركة 10 \+ واجبات/, 'لا سطر تفصيل طويل');
  assert.match(page, /openCrmGradeEntry\('p'\)">مشاركة</, 'المشاركة تُرصد يدويًا');
  assert.match(page, /openCrmGradeEntry\('t1'\)">اختبار ١</);
  assert.doesNotMatch(page, /openCrmGradeEntry\('h'\)|openCrmGradeEntry\('k'\)/, 'الواجبات والمهام محسوبة تلقائيًا فلا زر رصد');
});

test('الجدول: مجموع ثابت، شريط مجموعات، خانات ملوّنة، متوسط الشعبة؛ والمحسوب لا يُعدَّل بالضغط', async () => {
  const app = appWith([]);
  const html = app.crmGradeDetailHtml(G(COLS, [S('p', 'a', 9), S('h', 'a', 4), S('t1', 'a', 10), S('p', 'b', 2)]));
  assert.match(html, /class="crm-grade-gt">المجموع<span class="crm-grade-max">من 60<\/span>/);
  assert.match(html, /grp-performance">الأداء · 40/);
  assert.match(html, /grp-tests">الاختبارات · 20/);
  assert.match(html, /crm-grade-cell gc-hi" data-edit="1" onclick="openCrmGradeCell\('p', 'a'\)">9</);
  assert.match(html, /crm-grade-cell gc-lo" data-edit="1" onclick="openCrmGradeCell\('p', 'b'\)">2</);
  assert.match(html, /crm-grade-cell gc-lo">4</, 'واجبات 4 من 10 ملوّنة لكن للقراءة فقط');
  assert.doesNotMatch(html, /openCrmGradeCell\('h'|openCrmGradeCell\('k'/, 'الواجبات والمهام محسوبة تلقائيًا');
  assert.match(html, /متوسط الشعبة/);
  assert.doesNotMatch(html, /<b>علي<\/b>/, 'الاسم مُهرَّب');
});

test('زر ＋: ثلاثة أسطر مطوية (اختبار جديد، عمود أداء، نقل الدرجات)، والسقف الممتلئ يبقى ظاهرًا ومعطّلًا بسببه', async () => {
  const app = appWith([]);
  app.__g = G(COLS, []);
  runInAppContext(app, `crmGrades = __g; appToolOn = () => true;`);
  app.openCrmGradeToolsMenu();
  let html = runInAppContext(app, 'window.__modal[window.__modal.length - 1]');
  assert.match(html, />إضافة<\/h3>/);
  assert.match(html, /data-am="test"/); assert.match(html, /data-am="move"/);
  assert.equal((html.match(/class="crm-am-head"[^>]*aria-expanded="false"/g) || []).length, 2, 'الأقسام القابلة للفتح مطوية');
  assert.doesNotMatch(html, /class="crm-am-item open"/, 'لا قسم مفتوح عند الفتح');
  assert.match(html, /اكتمل توزيع الأداء/, 'الأداء 40 من 40: سبب ظاهر');
  assert.doesNotMatch(html, /openCrmGradeColumnEditor\('performance'/, 'ولا زر يرفضه الخادم');
  assert.match(html, /استيراد من Excel[\s\S]*ارفع ملفك/);
  assert.match(html, /قالب جاهز/);
  assert.match(html, /تصدير الكشف/);
  assert.match(html, /exportCrmGradeSheet\('template', this\)/); assert.match(html, /exportCrmGradeSheet\('sheet', this\)/);
  assert.doesNotMatch(html, /openCrmGradeSettings\(\)/, 'الإعداد على الترس لا في هذه القائمة');
  assert.match(html, /ثاني\/٦/, 'اسم الشعبة ظاهر');
  assert.deepEqual(JSON.parse(JSON.stringify(runInAppContext(app, 'crmGradeColumnDraft'))), { id: null, category: 'tests', saving: false });
  /* الاختبارات مخفية وفي الأداء متّسع: لا اختبار جديد، ويظهر عمود الأداء */
  app.__g = G([C('p', 'performance', 10, { name: 'مشاركة' })], []);
  runInAppContext(app, `crmGrades = __g; appToolOn = k => k !== 'tests'; crmGradeColumnDraft = null;`);
  app.openCrmGradeToolsMenu();
  html = runInAppContext(app, 'window.__modal[window.__modal.length - 1]');
  assert.match(html, /openCrmGradeColumnEditor\('performance', null\)/);
  assert.doesNotMatch(html, /data-am="test"|crmGradeColName/);
  assert.equal(runInAppContext(app, 'crmGradeColumnDraft'), null);
});

test('اختبار جديد: اسم ودرجة وزر واحد، وأزرار 5·10·20·40، والمفتاح (مغلق افتراضيًا) والوصف تحت «خيارات أخرى»، والحفظ بالمعرّفات نفسها', async () => {
  const app = appWith([]);
  app.__g = G(COLS, []);
  runInAppContext(app, `crmGrades = __g; appToolOn = () => true;`);
  app.openCrmGradeColumnEditor('tests', null);
  const html = runInAppContext(app, 'window.__modal[window.__modal.length - 1]');
  assert.match(html, /اختبار جديد/);
  assert.match(html, /id="crmGradeColName"/);
  assert.match(html, /id="crmGradeColMax"[^>]*value="10"/, 'يقترح درجة آخر اختبار');
  assert.match(html, /class="crm-nt-q on" onclick="setCrmNewTestMax\(10\)">10</, 'زر 10 محدد');
  for(const v of [5, 20, 40]) assert.match(html, new RegExp('class="crm-nt-q" onclick="setCrmNewTestMax\\(' + v + '\\)">' + v + '<'));
  assert.match(html, /id="crmGradeColSaveBtn"[^>]*onclick="saveCrmGradeColumn\(\)">إضافة الاختبار</);
  assert.doesNotMatch(html, /disabled>إضافة الاختبار/, 'الحفظ متاح من أول لحظة (لا خطوات)');
  assert.match(html, /class="crm-nt-more" hidden>[\s\S]*id="crmGradeColAll"[\s\S]*id="crmGradeColMeasures"/, 'المفتاح والوصف مطويان');
  assert.doesNotMatch(html, /id="crmGradeColAll" checked/, 'مغلق افتراضيًا: لا يُضاف لشعب لم تقصدها');
  assert.doesNotMatch(html, /crmSt1|crmNewTestStep/, 'لا خطوات');
  assert.deepEqual(JSON.parse(JSON.stringify(runInAppContext(app, 'crmGradeColumnDraft'))), { id: null, category: 'tests', saving: false });
});

test('صفحة الطالب: ضغط الدرجة اليدوية يفتح تعديلها (بدل الجدول)، والمحسوب تلقائيًا للقراءة فقط', async () => {
  const app = appWith([]);
  runInAppContext(app, `crmGradesSectionId = () => 'S';`);
  const g = G(COLS, [S('p', 'a', 8), S('h', 'a', 6), S('t1', 'a', 7)]);
  const html = app.crmGradeStudentPageHtml(g, 'a');
  assert.match(html, /اضغط على أي درجة لتعديلها/);
  assert.match(html, /is-edit"[^>]*onclick="openCrmGradeCell\('p', 'a'\)"[^>]*>[\s\S]*مشاركة[\s\S]*✎/);
  assert.match(html, /openCrmGradeCell\('t1', 'a'\)/);
  assert.doesNotMatch(html, /openCrmGradeCell\('h'|openCrmGradeCell\('k'/, 'الواجبات والمهام محسوبة');
  /* ما لم يُرصد بعد يحمل ＋ */
  const empty = app.crmGradeStudentPageHtml(G(COLS, []), 'a');
  assert.match(empty, /openCrmGradeCell\('t1', 'a'\)[\s\S]*اختبار ١[\s\S]*لم يُرصد بعد[\s\S]*crm-gs-pen[^>]*>＋/);
});

test('نافذة تعديل اختبار قائم لا تتغيّر بعد استخراج النموذج: قيمته هو وزر «حفظ»', async () => {
  const app = appWith([]);
  app.__g = G(COLS, []);
  runInAppContext(app, `crmGrades = __g; appToolOn = () => true;`);
  app.openCrmGradeColumnEditor('tests', 't1');
  const html = runInAppContext(app, 'window.__modal[window.__modal.length - 1]');
  assert.match(html, /تعديل اختبار/);
  assert.match(html, /id="crmGradeColName"[^>]*value="اختبار ١"/);
  assert.match(html, /onclick="saveCrmGradeColumn\(\)">حفظ</);
  assert.doesNotMatch(html, /crmGradeColAll/);
});

test('تعديل خانة: يكتب بمعرّف المعلم، ويحدّث الكشف المحلي، ويرسم من جديد', async () => {
  const log = [];
  const app = appWith(log);
  const g = G(COLS, [S('p', 'a', 8)]);
  openCell(app, g, 'p', 'a', '٩');
  await app.saveCrmGradeCell(0);
  const up = log.find(l => l.op === 'upsert');
  assert.equal(up.table, 'classroom_grade_scores');
  assert.deepEqual(JSON.parse(JSON.stringify(up.values)), [{ teacher_id: 'u1', column_id: 'p', student_id: 'a', score: 9 }]);
  assert.equal(up.options.onConflict, 'column_id,student_id');
  assert.equal(g.scores.find(s => s.column_id === 'p' && s.student_id === 'a').score, 9);
  assert.equal(runInAppContext(app, 'window.__repainted'), 1);
  assert.equal(runInAppContext(app, 'window.__closed'), 1);
  assert.equal(runInAppContext(app, 'crmGradeCell'), null);
});

test('تعديل خانة: غير المتغيّرة لا تُكتب، والمسح حذف مقيّد بالمعلم والعمود والطالب', async () => {
  const log = [];
  const app = appWith(log);
  const g = G(COLS, [S('p', 'a', 8)]);
  openCell(app, g, 'p', 'a', '8');
  await app.saveCrmGradeCell(0);
  assert.equal(log.length, 0, 'نفس الدرجة: لا كتابة');
  openCell(app, g, 'p', 'a', '');
  await app.saveCrmGradeCell(0);
  const del = log.find(l => l.op === 'delete');
  assert.deepEqual(JSON.parse(JSON.stringify(del.filters)), [['teacher_id', 'u1'], ['column_id', 'p'], ['student_id', 'a']]);
  assert.equal(g.scores.length, 0);
});

test('تعديل خانة: درجة أكبر من الحد أو نص لا تُكتب وتبقى الورقة', async () => {
  const log = [];
  const app = appWith(log);
  const g = G(COLS, []);
  for(const bad of ['11', 'abc', '-1']){
    openCell(app, g, 'p', 'a', bad);
    await app.saveCrmGradeCell(0);
  }
  assert.equal(log.length, 0);
  assert.equal(g.scores.length, 0);
  assert.equal(runInAppContext(app, 'window.__closed'), 0);
  assert.match(runInAppContext(app, `document.getElementById('crmGradeCellErr').textContent`), /الحد 10/);
});

test('تعديل خانة: "حفظ والتالي" ينتقل للطالب التالي، والأخير يُغلق', async () => {
  const log = [];
  const app = appWith(log);
  const g = G(COLS, []);
  openCell(app, g, 'p', 'a', '5');
  await app.saveCrmGradeCell(1);
  assert.equal(runInAppContext(app, 'crmGradeCell.studentId'), 'b');
  assert.equal(runInAppContext(app, 'window.__painted'), 1);
  openCell(app, g, 'p', 'b', '');
  await app.saveCrmGradeCell(1);
  assert.equal(runInAppContext(app, 'window.__closed'), 1, 'لا تالي بعد الأخير');
});

test('انحدار سباق: تبدّلت الشعبة أثناء الحفظ — لا رسم فوق الشاشة الجديدة ولا تعديل لكشفها', async () => {
  const log = [];
  const app = appWith(log);
  const g = G(COLS, [S('p', 'a', 8)]);
  const other = G(COLS, [S('p', 'a', 1)]);
  app.__other = other;
  openCell(app, g, 'p', 'a', '9');
  /* القاعدة تردّ بعد أن صار الكشف الحالي غير كشف الورقة */
  const sb = runInAppContext(app, 'sb');
  const origFrom = sb.from.bind(sb);
  sb.from = t => { const api = origFrom(t); const th = api.then; api.then = (a, b) => { runInAppContext(app, 'crmGrades = __other'); return th(a, b); }; return api; };
  await app.saveCrmGradeCell(0);
  assert.equal(log.filter(l => l.op === 'upsert').length, 1, 'الكتابة تمّت بمعرّف المعلم');
  assert.equal(other.scores[0].score, 1, 'كشف الشعبة الجديدة لم يُمسّ');
  assert.equal(runInAppContext(app, 'window.__repainted'), undefined, 'لا إعادة رسم');
  assert.equal(runInAppContext(app, 'crmGradeCell'), null);
});

test('عمود الفترات (المشاركة): الخانة تكتب درجة الفترة الجارية عبر set_period_score لا الكشف مباشرة', async () => {
  const log = [];
  const app = appWith(log);
  const g = G([C('pp', 'performance', 10, { name: 'مشاركة', kind: 'participation' })], [S('pp', 'a', 6)]);
  g.breakdown.set('pp', new Map([['a', { p1: 6, p2: null, p3: null }]]));
  app.__g = g;
  runInAppContext(app, `crmGrades = __g; crmGradeEntryPeriod = () => 1; loadCrmGradeSheet = async () => Object.assign({}, __g);`);
  openCell(app, g, 'pp', 'a', '9');
  await app.saveCrmGradeCell(0);
  assert.deepEqual(log.filter(l => l.op === 'rpc').map(l => JSON.parse(JSON.stringify(l.args))),
    [{ p_column_id: 'pp', p_student_id: 'a', p_period: 1, p_score: 9, p_only_missing: false }]);
  assert.equal(log.filter(l => l.op === 'upsert').length, 0);
});

test('عمود محسوب (واجبات/مهام): openCrmGradeCell لا يفتح ورقة', async () => {
  const app = appWith([]);
  app.__g = G(COLS, []);
  runInAppContext(app, 'crmGrades = __g');
  app.openCrmGradeCell('h', 'a');
  app.openCrmGradeCell('k', 'a');
  assert.equal(runInAppContext(app, 'crmGradeCell'), null);
  app.openCrmGradeCell('p', 'a');
  assert.equal(runInAppContext(app, 'crmGradeCell.columnId'), 'p');
});

test('فشل الحفظ: تبقى الورقة والرقم، والأزرار تعود، ولا تتغيّر النسخة المحلية', async () => {
  const log = [];
  const app = appWith(log, { error: { message: 'boom' } });
  const g = G(COLS, [S('p', 'a', 8)]);
  openCell(app, g, 'p', 'a', '9');
  runInAppContext(app, `window.__btns = [{ disabled: false }]; document.querySelectorAll = () => window.__btns;`);
  await app.saveCrmGradeCell(0);
  assert.equal(g.scores[0].score, 8);
  assert.equal(runInAppContext(app, 'window.__closed'), 0);
  assert.equal(runInAppContext(app, 'window.__btns[0].disabled'), false);
  assert.match(runInAppContext(app, `document.getElementById('crmGradeCellErr').textContent`), /تعذّر الحفظ/);
  assert.equal(runInAppContext(app, 'crmGradeCell.saving'), false, 'ضغطة ثانية ممكنة بعد الفشل');
});

/* ============ قالب Excel وتصدير الكشف ============ */
const CP = [C('p', 'performance', 10, { name: 'مشاركة' }), C('h', 'performance', 10, { name: 'واجبات', kind: 'homework' }), C('t1', 'tests', 20, { name: 'اختبار قصير ١' })];

test('القالب: أسماء الطلاب وأعمدة الرصد اليدوي فقط، وأسماؤها تُطابَق تلقائيًا عند الاستيراد', async () => {
  const app = appWith([]);
  runInAppContext(app, `appToolOn = () => true;`);
  const rows = JSON.parse(JSON.stringify(app.gradeTemplateRows([{ full_name: 'سامي' }, { full_name: 'فهد' }], CP)));
  assert.deepEqual(rows, [['اسم الطالب', 'مشاركة', 'اختبار قصير ١'], ['سامي'], ['فهد']], 'الواجبات محسوبة فلا عمود لها');
  const map = JSON.parse(JSON.stringify(app.autoMapGradeHeaders(rows[0], CP, 'اسم الطالب')));
  assert.deepEqual(map, { 'مشاركة': 'p', 'اختبار قصير ١': 't1' }, 'كل عمود يُربط دون تدخل');
});

test('التصدير: الخانة غير المرصودة فارغة لا صفر، والصفر المرصود يبقى صفرًا، ولا يدخل غير طلاب الكشف', async () => {
  const app = appWith([]);
  const caps = { performance: 40, tests: 20 };
  const rows = JSON.parse(JSON.stringify(app.gradeExportRows(CP, [S('p', 'a', 0), S('t1', 'a', 10), S('p', 'zzz', 9)], [{ id: 'a', full_name: 'سامي' }, { id: 'b', full_name: 'فهد' }], caps, true)));
  assert.deepEqual(rows[0], ['الطالب', 'مشاركة', 'واجبات', 'اختبار قصير ١', 'مجموع الأداء', 'مجموع الاختبارات', 'المجموع']);
  assert.deepEqual(rows[1].slice(0, 4), ['سامي', 0, '', 10], 'صفر مرصود ≠ بلا درجة');
  assert.deepEqual(rows[2], ['فهد', '', '', '', '', '', ''], 'طالب بلا رصد: كله فارغ');
  assert.equal(rows.length, 3);
  const info = JSON.parse(JSON.stringify(app.gradeColumnsInfoRows(CP)));
  assert.deepEqual(info[2], ['واجبات', 'أدائي', 10, 'محسوب تلقائيًا']);
});

function exportEnv(app, cols, students){
  app.__g = G(cols, []);
  runInAppContext(app, `
    crmGrades = __g; appToolOn = () => true;
    crmStudentsOfSection = () => ${JSON.stringify(students)};
    window.__sheets = []; window.__files = []; window.__busy = [];
    ensureXlsxLib = async () => {};
    XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: a => ({ aoa: a, '!ref': 'A1:C3' }), book_append_sheet: (wb, ws, n) => window.__sheets.push([n, ws.aoa]), decode_range: () => ({ e: { c: 2 } }) }, write: () => new Uint8Array(1) };
    Blob = function(){}; URL = { createObjectURL: () => 'blob:x', revokeObjectURL(){} };
    document.createElement = () => ({ remove(){}, click(){ window.__files.push(this.download); }, set href(v){}, get href(){ return ''; } });
    if(!window.__b0){ window.__b0 = beginExportBusy; window.__e0 = endExportBusy; }
    beginExportBusy = (b, t) => { window.__busy.push('begin'); window.__b0(b, t); }; endExportBusy = b => { window.__busy.push('end'); window.__e0(b); };`);
}

test('exportCrmGradeSheet: يبني الورقتين، يُنزّل ملفًا باسم الشعبة، ويعطّل الزر أثناء التجهيز', async () => {
  const app = appWith([]);
  exportEnv(app, CP, [{ id: 'a', full_name: 'سامي' }]);
  const btn = { disabled: false, dataset: {}, textContent: 'x', querySelector: () => null };
  await app.exportCrmGradeSheet('template', btn);
  assert.deepEqual(JSON.parse(JSON.stringify(runInAppContext(app, 'window.__sheets.map(x => x[0])'))), ['الدرجات', 'الأعمدة']);
  assert.match(runInAppContext(app, 'window.__files[0]'), /^قالب-درجات-ثاني-٦-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.deepEqual(JSON.parse(JSON.stringify(runInAppContext(app, 'window.__busy'))), ['begin', 'end']);
  assert.equal(btn.disabled, false, 'يعود الزر بعد الانتهاء');
  assert.equal(runInAppContext(app, 'window.__closed'), 1);
  await app.exportCrmGradeSheet('sheet', btn);
  assert.deepEqual(JSON.parse(JSON.stringify(runInAppContext(app, 'window.__sheets.slice(2).map(x => x[0])'))), ['الكشف', 'الأعمدة']);
  assert.match(runInAppContext(app, 'window.__files[1]'), /^كشف-درجات-/);
});

test('exportCrmGradeSheet: نقرتان متتاليتان تُنتجان ملفًا واحدًا، وبلا طلاب لا يُنزَّل شيء', async () => {
  const app = appWith([]);
  exportEnv(app, CP, [{ id: 'a', full_name: 'سامي' }]);
  await Promise.all([app.exportCrmGradeSheet('sheet', null), app.exportCrmGradeSheet('sheet', null)]);
  assert.equal(runInAppContext(app, 'window.__files.length'), 1);
  exportEnv(app, CP, []);
  await app.exportCrmGradeSheet('sheet', null);
  assert.equal(runInAppContext(app, 'window.__files.length'), 0);
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /لا طلاب/);
  exportEnv(app, [C('h', 'performance', 10, { kind: 'homework' })], [{ id: 'a', full_name: 'سامي' }]);
  await app.exportCrmGradeSheet('template', null);
  assert.equal(runInAppContext(app, 'window.__files.length'), 0, 'كل الأعمدة محسوبة: لا قالب فارغ');
});

test('قائمة الأدوات: القالب والتصدير ظاهران بنص الحالة داخل سطر الشرح فقط', async () => {
  const app = appWith([]);
  app.__g = G(COLS, []);
  runInAppContext(app, `crmGrades = __g; appToolOn = () => true;`);
  app.openCrmGradeToolsMenu();
  const html = runInAppContext(app, 'window.__modal[window.__modal.length - 1]');
  assert.match(html, /exportCrmGradeSheet\('template', this\)/);
  assert.match(html, /exportCrmGradeSheet\('sheet', this\)/);
  assert.match(html, /<small class="hb-sub">/);
});

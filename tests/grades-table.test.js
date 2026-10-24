'use strict';
/* ============================================================
   الكشف الجدولي («جدول كامل») وأدواته:
   - مبدّل «قائمة الطلاب | جدول كامل» وزر ⋮ ظاهران دائمًا (لا رابط مخبّأ آخر الصفحة).
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

test('المكان: المبدّل وزر ⋮ في القائمة والجدول، ولا رابط "الكشف التفصيلي" آخر الصفحة', async () => {
  const app = appWith([]);
  const g = G(COLS, [S('p', 'a', 8)]);
  const simple = app.crmGradeSimpleHtml(g);
  runInAppContext(app, 'crmGradesDetail = true');
  const detail = app.crmGradeDetailHtml(g);
  for(const html of [simple, detail]){
    assert.match(html, /قائمة الطلاب/);
    assert.match(html, /جدول كامل/);
    assert.match(html, /openCrmGradeToolsMenu\(\)/);
  }
  assert.doesNotMatch(simple, /الكشف التفصيلي \(كل الأعمدة/);
  assert.doesNotMatch(detail, /→ الكشف المبسّط/);
  assert.match(simple, /setCrmGradesDetail\(true\)/);
  assert.match(detail, /setCrmGradesDetail\(false\)/);
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

test('قائمة الأدوات: ما لا يصلح لا يظهر (سقف الأداء ممتلئ، الاختبارات مخفية)', async () => {
  const app = appWith([]);
  app.__g = G(COLS, []);
  runInAppContext(app, `crmGrades = __g; appToolOn = () => true;`);
  app.openCrmGradeToolsMenu();
  let html = runInAppContext(app, 'window.__modal[window.__modal.length - 1]');
  assert.doesNotMatch(html, /إضافة عمود أداء/, 'الأداء 40 من 40');
  assert.match(html, /إضافة اختبار/);
  assert.match(html, /استيراد من Excel/);
  assert.match(html, /openCrmGradeSettings\(\)/);
  app.__g = G([C('p', 'performance', 10, { name: 'مشاركة' })], []);
  runInAppContext(app, `crmGrades = __g; appToolOn = k => k !== 'tests';`);
  app.openCrmGradeToolsMenu();
  html = runInAppContext(app, 'window.__modal[window.__modal.length - 1]');
  assert.match(html, /إضافة عمود أداء/);
  assert.doesNotMatch(html, /إضافة اختبار/);
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

'use strict';
/* ============================================================
   "الكشف الثابت" — الاتفاق مع المعلم:
   - الأداء 40 = مكوّناته (مشاركة 10 + واجبات 10 + مهام 20) — مجموع درجاتها.
   - الاختبارات 20 = مجموع ما أخذه ÷ مجموع الدرجات الكاملة لما رُصد له × 20،
     بلا سقف ولا عدد محدد للاختبارات، وكل اختبار بأي درجة كاملة.
   - ما لم يُرصد لا يُحسب (لا صفر).
   - الكشف المبسّط سطر لكل طالب، والتفاصيل بالضغط، ولا زر "نسخ لنور".
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const C = (id, category, max, extra) => Object.assign({ id, category, name: id, max_score: max, kind: 'manual' }, extra || {});
const S = (column_id, student_id, score) => ({ column_id, student_id, score });
const COLS = [
  C('p', 'performance', 10, { name: 'مشاركة', kind: 'participation' }), C('h', 'performance', 10, { name: 'واجبات', kind: 'homework' }),
  C('k', 'performance', 20, { name: 'مهام أدائية', kind: 'task' }),
  C('t1', 'tests', 20, { name: 'اختبار قصير ١' }), C('t2', 'tests', 20, { name: 'الفترة الأولى' }), C('t3', 'tests', 10, { name: 'شفهي' }),
];

test('studentGradeResult — الاختبارات مجموع ما أخذه ÷ مجموع الكامل لما رُصد × 20، والأداء مجموع مكوّناته', async () => {
  const app = loadApp();
  const scores = [S('p', 'a', 10), S('h', 'a', 7), S('t1', 'a', 17), S('t2', 'a', 19), S('t3', 'a', 9)];
  const r = app.studentGradeResult(COLS, scores, 'a', { performance: 40, tests: 20 });
  assert.equal(r.tests.earned, 45);
  assert.equal(r.tests.possible, 50);
  assert.equal(r.tests.pct, 90);
  assert.equal(r.tests.points, 18);
  assert.equal(r.performance.points, 17, 'المهام لم تُرصد: لا تُحسب صفرًا ولا تمنع المجموع');
  assert.equal(r.performance.max, 40);
  assert.equal(r.total, 35);
  assert.deepEqual([...r.performance.parts].map(x => x.score), [10, 7, null]);
});

test('studentGradeResult — اختبار لم يُرصد له لا يدخل المقام، ولا اختبار = لا محصلة (لا صفر)', async () => {
  const app = loadApp();
  const r = app.studentGradeResult(COLS, [S('t1', 'a', 10)], 'a', { performance: 40, tests: 20 });
  assert.equal(r.tests.possible, 20, 'الفترة والشفهي لم يُرصدا له');
  assert.equal(r.tests.points, 10);
  const none = app.studentGradeResult(COLS, [S('p', 'a', 5)], 'a', { performance: 40, tests: 20 });
  assert.equal(none.tests.points, null);
  assert.equal(none.total, 5);
  assert.equal(app.studentGradeResult(COLS, [], 'a').total, null);
});

test('studentGradeResult — اختبارات كثيرة مجموعها يتجاوز 20 تبقى من 20، وتتبع توزيع المعلم', async () => {
  const app = loadApp();
  const many = [1, 2, 3, 4, 5].map(i => C('x' + i, 'tests', 20));
  const scores = many.map(c => S(c.id, 'a', 16));
  assert.equal(app.studentGradeResult(many, scores, 'a', { performance: 40, tests: 20 }).tests.points, 16);
  assert.equal(app.studentGradeResult(many, scores, 'a', { performance: 35, tests: 25 }).tests.points, 20);
});

function appWithSheet(extra){
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `
    crmStudents = [{ id: 'a', full_name: 'سامي <b>علي</b>', section_id: 'S' }, { id: 'b', full_name: 'فهد', section_id: 'S' }];
    crmSectionLabel = () => 'ثاني/٦';
    window.__modal = []; showInfoModal = h => window.__modal.push(h);
    ${extra || ''}`);
  return app;
}
const G = (cols, scores) => ({ sectionId: 'S', year: 'Y', semester: 1, columns: cols, allColumns: cols, hiddenColumns: [], scores });

test('الكشف المبسّط — سطر لكل طالب بالأداء/الاختبارات/المجموع، و"لم يُرصد"، وبطاقة الاختبارات، بلا "نسخ لنور"', async () => {
  const app = appWithSheet();
  const scores = [S('p', 'a', 10), S('h', 'a', 7), S('t1', 'a', 17), S('t2', 'a', 19), S('t3', 'a', 9), S('p', 'b', 4)];
  const html = app.crmGradeSimpleHtml(G(COLS, scores));
  assert.match(html, /الأداء<small>من 40<\/small>/);
  assert.match(html, /الاختبارات<small>من 20<\/small>/);
  assert.match(html, /المجموع<small>من 60<\/small>/);
  assert.match(html, /<td class="crm-gs-tot">35<\/td>/, 'سامي: 17 + 18');
  assert.match(html, /لم يُرصد/, 'فهد بلا اختبارات');
  assert.match(html, /openCrmGradeColumnEditor\('tests', null\)/, '+ اختبار');
  assert.match(html, /اختبار قصير ١<\/b> · من 20/);
  assert.match(html, /رُصد 1 من 2/);
  assert.doesNotMatch(html, /نور/);
  assert.match(html, /سامي &lt;b&gt;علي&lt;\/b&gt;/, 'الاسم مُهرَّب');
  assert.doesNotMatch(html, /<b>علي<\/b>/);
});

test('الكشف المبسّط — الاختبارات مخفية من التخصيص: لا عمود ولا بطاقة، والمجموع من الأداء', async () => {
  const app = appWithSheet('appToolOn = k => k !== "tests";');
  const html = app.crmGradeSimpleHtml(G(COLS, [S('p', 'a', 10), S('t1', 'a', 20)]));
  assert.doesNotMatch(html, /الاختبارات<small>/);
  assert.doesNotMatch(html, /openCrmGradeColumnEditor\('tests'/);
  assert.match(html, /المجموع<small>من 40<\/small>/);
  assert.match(html, /<td class="crm-gs-tot">10<\/td>/);
});

test('تفاصيل الطالب — كل اختبار ونسبته وطريقة الحساب، ومكوّنات الأداء، والاسم مُهرَّب', async () => {
  const app = appWithSheet();
  const g = G(COLS.concat([C('t4', 'tests', 10, { name: '<img src=x>' })]), [S('p', 'a', 10), S('h', 'a', 7), S('t1', 'a', 17), S('t2', 'a', 19), S('t3', 'a', 9)]);
  runInAppContext(app, `crmGrades = ${JSON.stringify(g)};`);
  app.openCrmGradeStudentDetail('a');
  const html = runInAppContext(app, 'window.__modal[0]');
  assert.match(html, /17 من 20 · <span class="crm-gs-chip">85%<\/span>/);
  assert.match(html, /المحصلة: 45 من 50 = 90% × 20 = <b>18<\/b>/);
  assert.match(html, /مهام أدائية<\/span><span><span class="crm-gs-none">لم يُرصد بعد/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /سامي &lt;b&gt;علي/);
});

test('الكشف التفصيلي — خانة الاختبارات محصلة من 20 لا مجموع الأعمدة', async () => {
  const app = appWithSheet();
  const html = app.crmGradeDetailHtml(G(COLS, [S('t1', 'a', 17), S('t2', 'a', 19), S('t3', 'a', 9)]));
  assert.match(html, /<td class="crm-grade-total">18<\/td>/);
  assert.doesNotMatch(html, /<td class="crm-grade-total">45<\/td>/);
  assert.match(html, /3 اختبارات — المحصلة من 20/);
});

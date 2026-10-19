'use strict';
/* ============================================================
   "الكشف الثابت" — الاتفاق مع المعلم:
   - الأداء 40 = مكوّناته (مشاركة 10 + واجبات 10 + مهام 20) — مجموع درجاتها.
   - الاختبارات 20 = مجموع ما أخذه ÷ مجموع الدرجات الكاملة لما رُصد له × 20،
     بلا سقف ولا عدد محدد للاختبارات، وكل اختبار بأي درجة كاملة.
   - ما لم يُرصد لا يُحسب (لا صفر).
   - الكشف المبسّط: قائمة أسماء بمجموع كل طالب (ملوّن حسب ما رُصد فقط)، والضغط على
     الاسم يفتح صفحته (الأداء والاختبارات بأشرطة، والسابق/التالي)، ولا زر "نسخ لنور".
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

test('الكشف المبسّط — قائمة أسماء بمجموع كل طالب ملوّن حسب ما رُصد، بلا "نسخ لنور"؛ والاختبارات في إعداد الدرجات', async () => {
  const app = appWithSheet(`crmStudents.push({ id: 'c', full_name: 'خالد', section_id: 'S' });`);
  const scores = [S('p', 'a', 10), S('h', 'a', 7), S('t1', 'a', 17), S('t2', 'a', 19), S('t3', 'a', 9), S('p', 'b', 4)];
  const html = app.crmGradeSimpleHtml(G(COLS, scores));
  assert.match(html, /id="crmGsRow_a" onclick="openCrmGradeStudentDetail\('a'\)">\s*<span class="crm-gs-iname">سامي &lt;b&gt;علي&lt;\/b&gt;<\/span>\s*<span class="crm-gs-itot"><b class="gs-tone-hi">35<\/b> <small>من 60<\/small>/, 'سامي: 17 + 18 = 35، رُصد له 40 (أخضر)');
  assert.match(html, /<b class="gs-tone-lo">4<\/b> <small>من 60<\/small>/, 'فهد: 4 من 10 مرصودة (أحمر) — الاختبارات لم تُرصد فلا تُحسب عليه');
  assert.match(html, /id="crmGsRow_c"[\s\S]*?— لم يُرصد/, 'خالد بلا أي رصد');
  assert.doesNotMatch(html, /crm-gs-table/, 'لا جدول أعمدة');
  assert.doesNotMatch(html, /نور/);
  const settings = app.crmGradeSettingsHtml(G(COLS, scores));
  assert.match(settings, /openCrmGradeColumnEditor\('tests', null\)/, '+ اختبار');
  assert.match(settings, /اختبار قصير ١<\/b> · من 20/);
  assert.match(settings, /رُصد 1 من 3/);
  assert.match(html, /سامي &lt;b&gt;علي&lt;\/b&gt;/, 'الاسم مُهرَّب');
  assert.doesNotMatch(html, /<b>علي<\/b>/);
});

test('الكشف المبسّط — الاختبارات مخفية من التخصيص: لا عمود ولا بطاقة، والمجموع من الأداء', async () => {
  const app = appWithSheet('appToolOn = k => k !== "tests";');
  const html = app.crmGradeSimpleHtml(G(COLS, [S('p', 'a', 10), S('t1', 'a', 20)]));
  assert.doesNotMatch(html, /الاختبارات<small>/);
  assert.doesNotMatch(html, /openCrmGradeColumnEditor\('tests'/);
  assert.match(html, /<b class="gs-tone-hi">10<\/b> <small>من 40<\/small>/);
});

test('صفحة الطالب — المجموع، والأداء والاختبارات بأشرطة ونِسَب وطريقة الحساب، والسابق/التالي، والاسم مُهرَّب', async () => {
  const app = appWithSheet(`crmGradesSectionId = () => 'S';`);
  const g = G(COLS.concat([C('t4', 'tests', 10, { name: '<img src=x>' })]), [S('p', 'a', 10), S('h', 'a', 7), S('t1', 'a', 17), S('t2', 'a', 19), S('t3', 'a', 9)]);
  runInAppContext(app, `crmGrades = ${JSON.stringify(g)};`);
  app.openCrmGradeStudentDetail('a');
  const html = runInAppContext(app, `document.getElementById('crmGradesBody').innerHTML`);
  assert.match(html, /1 من 2/);
  assert.match(html, /المجموع<\/span><span><b>35<\/b> <small>من 60<\/small>/);
  assert.match(html, /اختبار قصير ١<\/span><span>17 من 20 · 85%<\/span>/);
  assert.match(html, /<i class="gs-bg-hi" style="width:85%"><\/i>/);
  assert.match(html, /المحصلة: 45 من 50 = 90% × 20 = <b>18<\/b>/);
  assert.match(html, /مهام أدائية<\/span><span><span class="crm-gs-none">لم يُرصد بعد/);
  assert.match(html, /<button type="button" class="btn btn-outline" disabled>‹ الطالب السابق/, 'الأول: لا سابق');
  assert.match(html, /onclick="openCrmGradeStudentDetail\('b'\)">الطالب التالي/);
  assert.doesNotMatch(html, /crmGradesSection"/, 'صفحة الطالب بلا قائمة الشعب');
  app.openCrmGradeStudentDetail('b');
  assert.match(runInAppContext(app, `document.getElementById('crmGradesBody').innerHTML`), /2 من 2[\s\S]*onclick="openCrmGradeStudentDetail\('a'\)">‹ الطالب السابق[\s\S]*disabled>الطالب التالي/);
  app.closeCrmGradeStudent();
  const list = runInAppContext(app, `document.getElementById('crmGradesBody').innerHTML`);
  assert.match(list, /crmGsRow_a/, 'رجوع لقائمة الطلاب');
  assert.equal(runInAppContext(app, 'crmGradeStudentId'), null);
  app.openCrmGradeStudentDetail('a');
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /سامي &lt;b&gt;علي/);
});

test('صفحة الطالب — طالب ليس في الشعبة لا تُفتح، وتغيير الشعبة أو التبويب يعيد قائمة الطلاب، و"ملخص الشعبة" ملغى', async () => {
  const app = appWithSheet(`crmGradesSectionId = () => 'S'; renderCrmGrades = () => { window.__rendered = (window.__rendered || 0) + 1; };
    renderCrmLinkBanner = () => {}; showCrmOverlayPane = () => {};
    document.getElementById('crmLessonSheet').style.display = 'none'; document.getElementById('crmStudentProfile').style.display = 'none';`);
  runInAppContext(app, `crmGrades = ${JSON.stringify(G(COLS, []))};`);
  app.openCrmGradeStudentDetail('zz');
  assert.equal(runInAppContext(app, 'crmGradeStudentId'), null);
  app.openCrmGradeStudentDetail('a');
  assert.equal(runInAppContext(app, 'crmGradeStudentId'), 'a');
  app.onCrmGradesSectionChange('S2');
  assert.equal(runInAppContext(app, 'crmGradeStudentId'), null);
  app.openCrmGradeStudentDetail('a');
  app.switchCrmTab('grades');
  assert.equal(runInAppContext(app, 'crmGradeStudentId'), null);
  assert.equal(runInAppContext(app, 'SECTION_SUMMARY_ON'), false);
  assert.equal(app.crmGradesViewSwitchHtml(), '');
  runInAppContext(app, `localStorage.setItem('crm_grades_view', 'summary');`);
  assert.equal(app.crmGradesView(), 'sheet', 'ولو حُفظ "ملخص" سابقًا');
});

test('الكشف التفصيلي — خانة الاختبارات محصلة من 20 لا مجموع الأعمدة', async () => {
  const app = appWithSheet();
  const html = app.crmGradeDetailHtml(G(COLS, [S('t1', 'a', 17), S('t2', 'a', 19), S('t3', 'a', 9)]));
  assert.match(html, /<td class="crm-grade-total">18<\/td>/);
  assert.doesNotMatch(html, /<td class="crm-grade-total">45<\/td>/);
  assert.match(html, /3 اختبارات — المحصلة من 20/);
});

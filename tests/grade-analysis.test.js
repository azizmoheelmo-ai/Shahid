'use strict';
/* ============================================================
   تحليل درجات الشعبة (app-29):
   - الشريط أعلى الكشف هو الزر (لا عنصر جديد)
   - لم يُرصد ≠ صفر: التحليل لمن رُصد له فقط، والعدد مذكور
   - المستويات الثلاثة: ضعاف (< 50%) · متوسطون (50–89%) · متفوقون (≥ 90%)
   - أسماء الطلاب بـ escapeHtml، والتصدير بلا أسماء ما لم يُطلب
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const C = (id, category, max, extra) => Object.assign({ id, category, name: id, max_score: max, kind: 'manual' }, extra || {});
const S = (column_id, student_id, score) => ({ column_id, student_id, score });
const COLS = [C('p', 'performance', 40, { name: 'أداء' }), C('t1', 'tests', 20, { name: 'اختبار' })];
const CAPS = { performance: 40, tests: 20 };
const ST = (id, name) => ({ id, full_name: name || id });

/* 5 طلاب: درجاتهم من 40 (عمود الأداء) = 10 · 22 · 30 · 36 · 40 → 25% · 55% · 75% · 90% · 100% */
const STUDENTS = ['a', 'b', 'c', 'd', 'e'].map(id => ST(id));
const SCORES = [S('p', 'a', 10), S('p', 'b', 22), S('p', 'c', 30), S('p', 'd', 36), S('p', 'e', 40)];
const G = (scores, cols) => ({ sectionId: 'S', columns: cols || COLS, allColumns: cols || COLS, hiddenColumns: [], scores });

test('gradeAnalysisRows — عمود: درجة ونسبة من القصوى، ومن لم يُرصد له points = null (لا صفر)', async () => {
  const app = loadApp();
  const { rows, displayMax } = app.gradeAnalysisRows(G(SCORES.slice(0, 2)), STUDENTS, 'p', CAPS, true);
  assert.equal(displayMax, 40);
  assert.deepEqual([...rows].map(r => [r.id, r.points, r.pct]), [['a', 10, 25], ['b', 22, 55], ['c', null, null], ['d', null, null], ['e', null, null]]);
});

test('gradeAnalysisRows — المجموع يطابق الكشف: نقاط الطالب، ونسبته مما رُصد له فقط', async () => {
  const app = loadApp();
  runInAppContext(app, 'appGradeCaps = () => ({ performance: 40, tests: 20 });');
  /* أ: أداء 20/40 فقط → نقاطه 20 ونسبته 50% (من 40 مرصودة لا من 60) */
  const { rows, displayMax } = app.gradeAnalysisRows(G([S('p', 'a', 20)]), [ST('a'), ST('b')], 'total', CAPS, true);
  assert.equal(displayMax, 60);
  assert.equal(rows[0].points, 20);
  assert.equal(rows[0].pct, 50);
  assert.equal(rows[0].partial, true, 'رُصد من 40 من 60');
  assert.equal(rows[1].points, null);
});

test('analyzeGradeRows — الأرقام والفئات لمن رُصد له فقط', async () => {
  const app = loadApp();
  const { rows, displayMax } = app.gradeAnalysisRows(G(SCORES.concat([])), STUDENTS.concat([ST('f')]), 'p', CAPS, true);
  const s = app.analyzeGradeRows(rows, displayMax);
  assert.equal(s.total, 6);
  assert.equal(s.recorded, 5);
  assert.equal(s.missing, 1, 'f لم يُرصد له: لا يدخل الحساب ولا يُعدّ صفرًا');
  assert.equal(s.avg, 27.6);
  assert.equal(s.avgPct, 69);
  assert.equal(s.median, 30);
  assert.equal(s.min, 10);
  assert.equal(s.max, 40);
  assert.equal(s.passed, 4);
  assert.equal(s.passRate, 80);
  assert.deepEqual([...s.groups.low].map(r => r.id), ['a']);
  assert.deepEqual([...s.groups.edge].map(r => r.id), ['b'], '55% فوق النجاح بأقل من 10 نقاط مئوية');
  assert.deepEqual([...s.groups.top].map(r => r.id), ['e', 'd'], 'متفوقون: الأعلى أولًا');
  assert.deepEqual([...s.bands], [1, 1, 0, 1, 0, 2]);
});

test('analyzeGradeRows — حدّ النجاح بالضبط ينجح (50%)، والوسيط لعدد زوجي متوسط الوسطين، وصف فارغ بلا انهيار', async () => {
  const app = loadApp();
  const rows = [10, 20].map((p, i) => ({ id: 'x' + i, name: 'x' + i, points: p, pct: 100 * p / 20, partial: false }));
  const s = app.analyzeGradeRows(rows, 20);
  assert.equal(s.median, 15);
  assert.equal(s.groups.low.length, 0, '10 من 20 = 50% بالضبط: ليس تحت النصف');
  assert.equal(s.groups.edge.length, 1);
  const empty = app.analyzeGradeRows([{ id: 'z', name: 'z', points: null, pct: null }], 20);
  assert.equal(empty.recorded, 0);
  assert.equal(empty.avg, null);
  assert.equal(empty.passRate, null);
});

function openedApp(scores){
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `
    crmStudents = ${JSON.stringify(STUDENTS.map(s => Object.assign({ section_id: 'S' }, s)))};
    crmSectionLabel = () => 'ثاني/٦';
    appGradeCaps = () => ({ performance: 40, tests: 20 });
    appToolOn = () => true;
    crmGrades = ${JSON.stringify(G(scores))};
    window.__modal = []; showInfoModal = h => window.__modal.push(h);`);
  return app;
}

test('الكشف: شريط الملخص نفسه زر التحليل، ولا زر إضافي', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, 'window.__html = crmGradeSimpleHtml(crmGrades);');
  const html = app.__html;
  assert.match(html, /<button type="button" class="crm-gs-strip crm-gs-strip-btn"[^>]*onclick="openCrmGradeAnalysis\(\)">[\s\S]*?متوسط الشعبة[\s\S]*?<\/button>/);
  assert.equal((html.match(/openCrmGradeAnalysis\(\)/g) || []).length, 1);
});

test('فتح النافذة: عمود المجموع افتراضيًا، ومستوى «ضعاف» مفتوح بأسمائه في تبويب الطلاب، والاسم يُهرَّب', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `crmStudents[0].full_name = 'سامي <b>علي</b>'; openCrmGradeAnalysis();
    window.__over = crmGradeAnalysisHtml(crmGradeAnalysis); setCrmGaTab('students');
    window.__body = crmGradeAnalysisHtml(crmGradeAnalysis); window.__st = crmGradeAnalysis;`);
  assert.equal(app.__modal.length, 1);
  assert.match(app.__modal[0], /<option value="total">المجموع<\/option>/);
  assert.match(app.__modal[0], /<option value="p">أداء \(من 40\)<\/option>/);
  assert.equal(app.__st.open, 'low');
  assert.doesNotMatch(app.__over, /سامي/, 'نظرة عامة: أعداد فقط بلا أسماء');
  assert.match(app.__body, /سامي &lt;b&gt;علي&lt;\/b&gt;/);
  assert.doesNotMatch(app.__body, /<b>علي<\/b>/);
  assert.match(app.__body, /ضعاف<small>[^<]*<\/small><\/span><b>1<\/b>/);
});

test('نظرة عامة: جملة خلاصة، ثلاثة مستويات تغطي الجميع بلا تداخل، وأرقام صحيحة بلا كسور', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `openCrmGradeAnalysis(); window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__s = gradeAnalysisView(crmGradeAnalysis).stats;`);
  /* 5 طلاب: 25% · 55% · 75% · 90% · 100% ← ضعاف 1 · متوسطون 2 (55 و75) · متفوقون 2 */
  assert.match(app.__body, /<b>4 من 5<\/b> طلاب ناجحون \(<bdi dir="ltr">80%<\/bdi>\)/);
  assert.match(app.__body, /المتوسط <b>\d+ من 60<\/b>/);
  assert.deepEqual([app.__s.groups.low.length, app.__s.mid.length, app.__s.groups.top.length], [1, 2, 2]);
  assert.equal(app.__s.groups.low.length + app.__s.mid.length + app.__s.groups.top.length, app.__s.recorded);
  for(const label of ['ضعاف', 'متوسطون', 'متفوقون']) assert.match(app.__body, new RegExp(`class="crm-ga-lvt">${label}<small>`));
  assert.doesNotMatch(app.__body, /على الحافة|يحتاجون دعمًا|>جيد</, 'لا تصنيف رابع');
  assert.match(app.__body, /أقل من 50% \(أقل من 30 درجة\)/);
  assert.match(app.__body, /من 50% إلى أقل من 90%/);
  assert.match(app.__body, /90% فأكثر \(54 درجة فأكثر\)/);
  assert.doesNotMatch(app.__body, /\d\.\d/, 'لا كسور عشرية بالواجهة');
  assert.doesNotMatch(app.__body, /الوسيط|أدنى وأعلى/, 'التفاصيل الإحصائية مطويّة افتراضيًا');
});

test('تفاصيل إحصائية: الوسيط وأدنى/أعلى والتوزيع بالنسبة، وكلها أعداد صحيحة', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `openCrmGradeAnalysis(); toggleCrmGaDetails(); window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__body, /<span>الوسيط<\/span>/);
  assert.match(app.__body, /<b>10 إلى 40<\/b>/, 'أدنى وأعلى بالعربية لا "40–10" معكوسة');
  assert.match(app.__body, /توزيع الطلاب حسب النسبة المئوية/);
  assert.match(app.__body, /النسبة = درجة الطالب ÷ الدرجة الكاملة \(60\) × 100/);
  assert.doesNotMatch(app.__body, /\d\.\d/);
});

test('التقريب لا يُظهر رقمًا يوحي بتجاوز حدّ لم يُبلغ: 49.6% تُعرض 49% لا 50%، والنسب الكلية لا تبلغ 100% أو 0% زورًا', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `window.__a = gradeAnalysisPctShown(49.6, [50, 60, 90]); window.__b = gradeAnalysisPctShown(50, [50, 60, 90]);
    window.__c = gradeAnalysisPctShown(89.7, [50, 60, 90]); window.__d = gradeAnalysisPctShown(52.4, [50, 60, 90]);
    window.__r = [gaRateShown(199, 200), gaRateShown(1, 300), gaRateShown(200, 200), gaRateShown(0, 5), gaRateShown(0, 0)];`);
  assert.equal(app.__a, 49);
  assert.equal(app.__b, 50);
  assert.equal(app.__c, 89);
  assert.equal(app.__d, 52);
  assert.deepEqual([...app.__r], [99, 1, 100, 0, 0]);
});

test('تبويب الطلاب: أول 5 أسماء ثم «عرض الكل»، والنسب والدرجات صحيحة', async () => {
  const students = Array.from({ length: 8 }, (_, i) => ST('s' + i));
  const scores = students.map((st, i) => S('p', st.id, 5 + i));
  const app = openedApp(scores);
  runInAppContext(app, `crmStudents.splice(0, crmStudents.length, ...${JSON.stringify(students.map(st => ({ id: st.id, full_name: st.full_name, section_id: 'S' })))});
    openCrmGradeAnalysis(); setCrmGaTab('students'); window.__few = crmGradeAnalysisHtml(crmGradeAnalysis);
    toggleCrmGaShowAll('low'); window.__all = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.equal((app.__few.match(/class="crm-ga-name"/g) || []).length, 5);
  assert.match(app.__few, /عرض الكل \(8\)/);
  assert.equal((app.__all.match(/class="crm-ga-name"/g) || []).length, 8);
  assert.match(app.__all, /عرض أقل/);
});

test('تغيير المستوى أو العمود يعيد «عرض الكل» لحالته المطوية (لا يبقى مفتوحًا لمستوى آخر)', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `openCrmGradeAnalysis(); crmGradeAnalysis.showAll = 'low'; toggleCrmGaGroup('mid'); window.__a = crmGradeAnalysis.showAll;
    crmGradeAnalysis.showAll = 'low'; onCrmGradeAnalysisKey('p'); window.__b = crmGradeAnalysis.showAll;
    openCrmGaLevel('top'); window.__t = [crmGradeAnalysis.tab, crmGradeAnalysis.open];`);
  assert.equal(app.__a, null);
  assert.equal(app.__b, null);
  assert.deepEqual([...app.__t], ['students', 'top']);
});

test('النافذة تذكر من لم يُرصد له ولا تعدّه صفرًا، وتبدّل العمود دون إغلاق', async () => {
  const app = openedApp([S('p', 'a', 10), S('p', 'b', 22)]);
  runInAppContext(app, `openCrmGradeAnalysis(); onCrmGradeAnalysisKey('p');
    window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__body, /لم يُرصد لـ 3 من 5 طلاب شيء بعد — لا يدخلون في الحساب/);
  assert.match(app.__body, /\(لا يُعدّون أصفارًا\)/);
});

test('من رُصد له جزء من الأعمدة يُحسب بنسبته مما رُصد، والتنبيه قصير', async () => {
  const app = openedApp([S('p', 'a', 10), S('p', 'b', 22), S('p', 'c', 30), S('t1', 'c', 5)]);
  runInAppContext(app, `openCrmGradeAnalysis(); window.__s = gradeAnalysisView(crmGradeAnalysis).stats; window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.equal(app.__s.recorded, 3, 'الثلاثة محسوبون');
  assert.ok(app.__s.partial >= 2, 'من رُصد له عمود واحد فقط محسوب جزئيًا');
  assert.match(app.__body, /لم تكتمل درجاتهم — حُسبت نتائجهم مما رُصد/);
});

test('عمود بلا رصد: رسالة بدل أرقام فارغة', async () => {
  const app = openedApp([]);
  runInAppContext(app, `openCrmGradeAnalysis(); window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__body, /لم تُرصد درجات لهذا العمود بعد/);
});

test('الضغط على اسم يفتح صفحة الطالب، ويتجاهل إن تغيّرت الشعبة المعروضة (سباق)', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `window.__opened = []; closeCrmModal = () => {}; openCrmGradeStudentDetail = id => window.__opened.push(id);
    openCrmGradeAnalysis(); openCrmGradeAnalysisStudent('a');
    crmGrades = Object.assign({}, crmGrades, { sectionId: 'OTHER' }); openCrmGradeAnalysisStudent('b');`);
  assert.deepEqual([...app.__opened], ['a']);
});

test('التصدير: بلا أسماء افتراضيًا، ومع الأسماء عند الطلب، والمستوى الفارغ لا يُصدَّر', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `openCrmGradeAnalysis(); window.__v = gradeAnalysisView(crmGradeAnalysis);
    window.__plain = gradeAnalysisExportRows(crmGradeAnalysis, __v, false);
    window.__named = gradeAnalysisExportRows(crmGradeAnalysis, __v, true);
    window.__pdf = gradeReportSectionHtml(crmGradeAnalysis, __v, gradeReportPrefsNow(), { logo: '', date: '2026-01-01', withNames: false });`);
  const flat = rows => JSON.stringify(rows);
  assert.doesNotMatch(flat(app.__plain), /"الطالب"/);
  assert.match(flat(app.__named), /\["الطالب","الدرجة","النسبة %","الفئة","التقدير"\]/);
  assert.match(flat(app.__named), /\["a",10,25,"ضعيف","هـ"\]/);
  assert.doesNotMatch(app.__pdf, /<td>a<\/td>/, 'PDF بلا أسماء الطلاب');
});

test('الإصدار والملف الجديد: version.json = APP_VERSION = APP_VERSION_SW، والملف في APP_SHELL وindex.html', async () => {
  const root = path.join(__dirname, '..');
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
  assert.match(fs.readFileSync(path.join(root, 'app/app-26-update-check.js'), 'utf8'), new RegExp(`APP_VERSION = '${v}'`));
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), new RegExp(`APP_VERSION_SW = '${v}'`));
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-29-grade-analysis\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-30-grade-compare\.js/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app-30-grade-compare\.js/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app-29-grade-analysis\.js/);
});

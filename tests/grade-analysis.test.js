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
/* + الاختبار t1 لكل منهم بالنسبة نفسها (5 · 11 · 15 · 18 · 20 من 20) فيبقى المجموع من 60 بالنسب 25 · 55 · 75 · 90 · 100 وكلهم مكتملو الرصد */
const SCORES = [S('p', 'a', 10), S('p', 'b', 22), S('p', 'c', 30), S('p', 'd', 36), S('p', 'e', 40), S('t1', 'a', 5), S('t1', 'b', 11), S('t1', 'c', 15), S('t1', 'd', 18), S('t1', 'e', 20)];
const G = (scores, cols) => ({ sectionId: 'S', columns: cols || COLS, allColumns: cols || COLS, hiddenColumns: [], scores });

test('gradeAnalysisRows — عمود: درجة ونسبة من القصوى، ومن لم يُرصد له points = null (لا صفر)', async () => {
  const app = loadApp();
  const { rows, displayMax } = app.gradeAnalysisRows(G(SCORES.slice(0, 2)), STUDENTS, 'p', CAPS, true);
  assert.equal(displayMax, 40);
  assert.deepEqual([...rows].map(r => [r.id, r.points, r.pct]), [['a', 10, 25], ['b', 22, 55], ['c', null, null], ['d', null, null], ['e', null, null]]);
});

test('gradeAnalysisRows — المجموع: البند الذي لم يُرصد لأحد خارج السلّم، ومن لم يُرصد له بندٌ رُصد لغيره «غير مكتمل» لا صفر', async () => {
  const app = loadApp();
  runInAppContext(app, 'appGradeCaps = () => ({ performance: 40, tests: 20 });');
  /* اختبار t1 لم يُرصد لأحد ← خارج التقرير: السلّم 40 (الأداء فقط)، وأ مكتمل بـ20/40 = 50% */
  const one = app.gradeAnalysisRows(G([S('p', 'a', 20)]), [ST('a'), ST('b')], 'total', CAPS, true);
  assert.equal(one.displayMax, 40, 't1 لم يُختبر بعد: لا يدخل المقام');
  assert.equal(one.rows[0].points, 20);
  assert.equal(one.rows[0].pct, 50);
  assert.equal(one.rows[0].incomplete, false);
  assert.equal(one.rows[1].points, null);
  assert.equal(one.rows[1].incomplete, true, 'ب لا درجة له: غير مكتمل');
  /* رُصد t1 لـ ب فقط: الأداء رُصد لـ أ فقط ← كلاهما ناقص بندًا رُصد لغيره */
  const both = app.gradeAnalysisRows(G([S('p', 'a', 20), S('t1', 'b', 10)]), [ST('a'), ST('b')], 'total', CAPS, true);
  assert.equal(both.displayMax, 60);
  assert.equal(both.rows[0].incomplete, true);
  assert.equal(both.rows[0].partial, true);
  assert.deepEqual([...both.rows[0].missing], ['اختبار']);
  assert.equal(both.rows[0].points, 20, 'يُحفظ ما رُصد ولا يُملأ الناقص');
  assert.deepEqual([...both.rows[1].missing], ['أداء']);
  /* الصفر المُدخَل صفر فعلًا: يُحسب ويُصنَّف */
  const zero = app.gradeAnalysisRows(G([S('p', 'a', 20), S('p', 'b', 0), S('t1', 'a', 10), S('t1', 'b', 0)]), [ST('a'), ST('b')], 'total', CAPS, true);
  assert.equal(zero.rows[1].incomplete, false);
  assert.equal(zero.rows[1].points, 0);
  assert.equal(zero.rows[1].pct, 0);
});

test('analyzeGradeRows — غير المكتمل خارج المتوسط والوسيط والمدى والمستويات، ويُعرض منفصلًا (لا يُعدّ صفرًا ولا يُصنَّف)', async () => {
  const app = loadApp();
  runInAppContext(app, 'appGradeCaps = () => ({ performance: 40, tests: 20 });');
  /* أ، ب، ج مكتملون (t1 رُصد لهم)؛ د: رُصد أداؤه 11 فقط بلا t1؛ هـ: بلا أي درجة */
  const sc = [S('p', 'a', 40), S('t1', 'a', 20), S('p', 'b', 20), S('t1', 'b', 10), S('p', 'c', 30), S('t1', 'c', 10), S('p', 'd', 11)];
  const { rows, displayMax } = app.gradeAnalysisRows(G(sc), ['a', 'b', 'c', 'd', 'e'].map(id => ST(id)), 'total', CAPS, true);
  const s = JSON.parse(JSON.stringify(app.analyzeGradeRows(rows, displayMax)));
  assert.equal(displayMax, 60);
  assert.equal(s.total, 5);
  assert.equal(s.recorded, 3, 'مكتملو الرصد فقط');
  assert.deepEqual(s.incomplete.map(r => r.id), ['d', 'e'], 'د وهـ منفصلان');
  assert.equal(s.partial, 1, 'د رُصد له جزء');
  assert.equal(s.missing, 1, 'هـ بلا أي درجة');
  assert.equal(s.avg, 43.33, 'متوسط 60 و30 و40 فقط، لا 11 ولا أصفار');
  assert.equal(s.median, 40);
  assert.equal(s.min, 30);
  assert.equal(s.max, 60);
  assert.equal(s.groups.low.length + s.mid.length + s.groups.top.length, 3, 'المستويات تغطي المكتملين فقط');
  assert.equal(s.groups.low.length, 0, 'د (11 من 40 = 28%) لا يُصنَّف ضعيفًا');
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
  assert.match(app.__body, /متوسط الشعبة <b>\d+ من 60<\/b> \(<bdi dir="ltr">\d+%<\/bdi>\)/);
  assert.match(app.__body, /5 طلاب · الوسيط <b>\d+<\/b> · من <b>\d+<\/b> إلى <b>\d+<\/b>/);
  assert.doesNotMatch(app.__body, /ناجح|نجاح|رسوب/, 'لا لغة نجاح في النافذة');
  assert.deepEqual([app.__s.groups.low.length, app.__s.mid.length, app.__s.groups.top.length], [1, 2, 2]);
  assert.equal(app.__s.groups.low.length + app.__s.mid.length + app.__s.groups.top.length, app.__s.recorded);
  for(const label of ['ضعاف', 'متوسطون', 'متفوقون']) assert.match(app.__body, new RegExp(`class="crm-ga-lvt">${label}<small>`));
  assert.doesNotMatch(app.__body, /على الحافة|يحتاجون دعمًا|>جيد</, 'لا تصنيف رابع');
  assert.match(app.__body, /أقل من 50% \(أقل من 30 درجة\)/);
  assert.match(app.__body, /من 50% إلى أقل من 90%/);
  assert.match(app.__body, /90% فأكثر \(54 درجة فأكثر\)/);
  assert.doesNotMatch(app.__body, /\d\.\d/, 'لا كسور عشرية بالواجهة');
  assert.doesNotMatch(app.__body, /أدنى وأعلى/, 'التفاصيل الإحصائية مطويّة افتراضيًا');
});

test('تفاصيل إحصائية: الوسيط وأدنى/أعلى والتوزيع بالنسبة، وكلها أعداد صحيحة', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `openCrmGradeAnalysis(); toggleCrmGaDetails(); window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__body, /<span>الوسيط<\/span>/);
  assert.match(app.__body, /<b>15 إلى 60<\/b>/, 'أدنى وأعلى بالعربية لا "60–15" معكوسة');
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

test('النافذة تذكر من لم تكتمل درجاته ولا تصنّفه ولا تعدّه صفرًا، وتبدّل العمود دون إغلاق', async () => {
  const app = openedApp([S('p', 'a', 10), S('p', 'b', 22)]);
  runInAppContext(app, `openCrmGradeAnalysis(); onCrmGradeAnalysisKey('p');
    window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__body, /3 طلاب لم تكتمل درجاتهم — لا يُصنَّفون ولا يدخلون في المتوسط/);
  assert.match(app.__body, /openCrmGaLevel\('inc'\)/, 'رابط لعرض أسمائهم');
  assert.doesNotMatch(app.__body, /ناجح|نجاح|أصفار/);
});

test('بطاقة المتوسط الداكنة تُغلق قبل التنبيه وبطاقات المستويات (لا تبتلعها)', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `openCrmGradeAnalysis(); window.__b = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  const hero = app.__b.slice(app.__b.indexOf('<div class="crm-ga-hero">'), app.__b.indexOf('<button type="button" class="crm-ga-lv'));
  const opens = (hero.match(/<div\b/g) || []).length, closes = (hero.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, 'وسوم div متوازنة داخل البطاقة الداكنة وحدها');
});

test('من رُصد له جزء من الأعمدة لا يُحسب ولا يُصنَّف، ويظهر مجموعة «رصد غير مكتمل» بما رُصد له وما ينقصه', async () => {
  const app = openedApp([S('p', 'a', 10), S('p', 'b', 22), S('p', 'c', 30), S('t1', 'c', 5)]);
  runInAppContext(app, `openCrmGradeAnalysis(); window.__s = gradeAnalysisView(crmGradeAnalysis).stats; window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);
    setCrmGaTab('students'); toggleCrmGaGroup('inc'); window.__inc = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.equal(app.__s.recorded, 1, 'ج وحده مكتمل (أ وب بلا t1، ود وهـ بلا شيء)');
  assert.equal(app.__s.incomplete.length, 4);
  assert.equal(app.__s.partial, 2, 'أ وب رُصد لهما جزء');
  assert.match(app.__body, /4 طلاب لم تكتمل درجاتهم — لا يُصنَّفون ولا يدخلون في المتوسط/);
  assert.match(app.__inc, /رصد غير مكتمل<small>لا يُصنَّفون ولا يدخلون في المتوسط<\/small>/);
  assert.match(app.__inc, /<small>ناقص: اختبار<\/small>/, 'ما ينقص كل طالب');
  assert.match(app.__inc, /<b class="gs-tone-none"><bdi dir="ltr">10<\/bdi><\/b><small>من 40<\/small>/, 'درجته المرصودة ومقامها لا نسبة مصنِّفة');
  assert.match(app.__inc, /<b class="gs-tone-none">—<\/b><small>بلا درجات<\/small>/, 'من لا درجة له');
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
    window.__named = gradeAnalysisExportRows(crmGradeAnalysis, __v, true);`);
  const flat = rows => JSON.stringify(rows);
  assert.doesNotMatch(flat(app.__plain), /"الطالب"/);
  assert.match(flat(app.__named), /\["الطالب","الدرجة","النسبة %","الفئة","التقدير","الناقص"\]/);
  assert.match(flat(app.__named), /\["a",15,25,"ضعيف","هـ",""\]/);
  assert.doesNotMatch(flat(app.__named), /ناجحون|نجاح/, 'لا لغة نجاح في Excel');
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

'use strict';
/* ============================================================
   تحليل درجات الشعبة (app-29):
   - الشريط أعلى الكشف هو الزر (لا عنصر جديد)
   - لم يُرصد ≠ صفر: التحليل لمن رُصد له فقط، والعدد مذكور
   - الفئات: يحتاج دعمًا (< 50%) · على الحافة (50–59%) · متفوقون (≥ 90%)
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

test('فتح النافذة: عمود المجموع افتراضيًا، وفئة «يحتاج دعمًا» مفتوحة بأسمائها، والاسم يُهرَّب', async () => {
  const app = openedApp(SCORES);
  runInAppContext(app, `crmStudents[0].full_name = 'سامي <b>علي</b>'; openCrmGradeAnalysis();
    window.__body = crmGradeAnalysisHtml(crmGradeAnalysis); window.__st = crmGradeAnalysis;`);
  assert.equal(app.__modal.length, 1);
  assert.match(app.__modal[0], /<option value="total">المجموع<\/option>/);
  assert.match(app.__modal[0], /<option value="p">أداء \(من 40\)<\/option>/);
  assert.equal(app.__st.open, 'low');
  assert.match(app.__body, /سامي &lt;b&gt;علي&lt;\/b&gt;/);
  assert.doesNotMatch(app.__body, /<b>علي<\/b>/);
  assert.match(app.__body, /يحتاج دعمًا<\/span><b>1<\/b>/);
});

test('النافذة تذكر من لم يُرصد له ولا تعدّه صفرًا، وتبدّل العمود دون إغلاق', async () => {
  const app = openedApp([S('p', 'a', 10), S('p', 'b', 22)]);
  runInAppContext(app, `openCrmGradeAnalysis(); onCrmGradeAnalysisKey('p');
    window.__body = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__body, /المحلَّل 2 من 5 طالبًا — لم يُرصد لـ 3/);
  assert.match(app.__body, /\(لا يُعدّون أصفارًا\)/);
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
    window.__pdf = gradeAnalysisPdfHtml(crmGradeAnalysis, __v, false);`);
  const flat = rows => JSON.stringify(rows);
  assert.doesNotMatch(flat(app.__plain), /"الطالب"/);
  assert.match(flat(app.__named), /\["الطالب","الدرجة","النسبة %","الفئة","التقدير"\]/);
  assert.match(flat(app.__named), /\["a",10,25,"يحتاج دعمًا","هـ"\]/);
  assert.doesNotMatch(app.__pdf, /\(10\)/, 'PDF بلا أسماء');
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

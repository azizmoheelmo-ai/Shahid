'use strict';
/* ============================================================
   تقارير الدرجات PDF (app-34): خيارات المعلم، التعليق الشرطي، الأقسام، الأمان
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const C = (id, category, name, max) => ({ id, section_id: 'S', category, name, max_score: max, kind: 'manual' });
const S = (column_id, student_id, score) => ({ column_id, student_id, score });
/* الأداء من 40، والاختبار من 20 (الاختبارات مفعّلة) */
const COLS = [C('p', 'performance', 'المشاركة', 40), C('t', 'tests', 'الاختبار الأول', 20)];
const NAMES = { a: 'أحمد', b: 'بدر', c: 'جاسر', d: 'دخيل', e: 'عادل' };
/* نسب الأداء: 25% · 55% · 75% · 90% · 100% */
const SCORES = [S('p', 'a', 10), S('p', 'b', 22), S('p', 'c', 30), S('p', 'd', 36), S('p', 'e', 40),
  S('t', 'a', 4), S('t', 'b', 11), S('t', 'c', 15), S('t', 'd', 18), S('t', 'e', 20)];

function opened(extra, features){
  const app = loadApp({ currentUser: { id: 'u1', user_metadata: { full_name: 'عبدالعزيز المطيري' } } });
  runInAppContext(app, `
    crmStudents = ${JSON.stringify(Object.entries(NAMES).map(([id, full_name]) => ({ id, full_name, section_id: 'S' })))};
    crmSections = [{ id: 'S', grade_level_id: 'G' }, { id: 'S2', grade_level_id: 'G' }];
    crmGradeLevels = [{ id: 'G', name: 'ثاني ثانوي' }];
    crmSectionById = id => crmSections.find(s => s.id === id) || null;
    crmSectionLabel = id => id === 'S' ? 'ثاني ثانوي / 6' : 'ثاني ثانوي / 7';
    appGradeCaps = () => ({ performance: 40, tests: 20 }); appToolOn = () => true;
    appFeatures = ${JSON.stringify(features || {})};
    crmGrades = { sectionId: 'S', year: '2025-2026', semester: 1, columns: ${JSON.stringify(COLS)}, allColumns: ${JSON.stringify(COLS)}, hiddenColumns: [], scores: ${JSON.stringify(SCORES)} };
    window.__modal = []; showInfoModal = h => window.__modal.push(h); openCrmGradeAnalysis(); ${extra || ''}`);
  return app;
}
const CTX = "{ date: '2026-11-05', withNames: false }";
/* التعليق التربوي مطفأ افتراضيًا؛ هذه خيارات معلم فعّله كله */
const NOTES_ON = { reportPrefs: { notes: { reading: true, strengths: true, weaknesses: true, plans: true } } };

test('normalizeReportPrefs — الافتراضي = null، وتُنقَّى القيم، وتُقصّ الأسماء', async () => {
  const app = loadApp();
  assert.equal(app.normalizeReportPrefs(null), null);
  assert.equal(app.normalizeReportPrefs({ school: '  ', show: { levels: true } }), null, 'مطابق للافتراضي');
  const n = JSON.parse(JSON.stringify(app.normalizeReportPrefs({ school: '  ثانوية   بدر  ', vice: 5, teacher: 'س'.repeat(200), show: { names: true, levels: 'no', hack: true }, notes: { plans: true }, stats: true })));
  assert.equal(n.school, 'ثانوية بدر');
  assert.equal(n.vice, '', 'غير النص يُهمَل');
  assert.equal(n.teacher.length, 80);
  assert.equal(n.show.names, true);
  assert.equal(n.show.levels, true, 'قيمة غير منطقية = الافتراضي');
  assert.equal(n.show.hack, undefined);
  assert.equal(n.notes, undefined, 'التعليق التربوي أُلغي (ق12): المفتاح القديم المخزَّن يُهمَل');
  assert.equal(n.show.stats, undefined, 'خيار المؤشرات الإحصائية أُلغي (ق12)');
  assert.equal(app.normalizeReportPrefs({ notes: { plans: true }, show: { stats: false } }), null, 'مفاتيح قديمة فقط = الافتراضي');
});

test('normalizeFeatures يحتفظ بخيارات التقارير، ويُسقط المفسود', async () => {
  const app = loadApp();
  const keep = JSON.parse(JSON.stringify(app.normalizeFeatures({ reportPrefs: { school: 'م', notes: { reading: true } } })));
  assert.equal(keep.reportPrefs.school, 'م');
  assert.equal(keep.reportPrefs.notes, undefined, 'مفتاح قديم مخزَّن لا يُحمل');
  assert.equal(app.normalizeFeatures({ reportPrefs: 'x' }).reportPrefs, undefined);
});

test('اسم المعلم تلقائي من الحساب، ويغلبه ما كتبه المعلم', async () => {
  const app = opened('');
  assert.equal(app.gradeReportTeacherName({ teacher: '' }), 'عبدالعزيز المطيري');
  assert.equal(app.gradeReportTeacherName({ teacher: 'أ. فلان' }), 'أ. فلان');
});

test('gradeReportMark: العنوان والشعبة والمادة يمين، والمدرسة يسار', async () => {
  const app = opened(`window.__m = gradeReportMark({ subject: 'الفيزياء', school: 'ثانوية بدر' }, 'تحليل نتائج الدرجات', 'ثاني ثانوي / 6');`);
  assert.equal(app.__m.right, 'تحليل نتائج الدرجات · ثاني ثانوي / 6 · الفيزياء');
  assert.equal(app.__m.left, 'ثانوية بدر');
});

test('الطباعة بنص حقيقي: CSS الصفحة (ترويسة صفحات 2+، ترقيم، هامش) وتهريب النص', async () => {
  const app = opened(`window.__css = gradeReportPrintCss(${JSON.stringify({ right: 'تقرير "خطير" \\ سطر\nثانٍ', left: 'مدرسة' })}); window.__none = gradeReportPrintCss(null);`);
  const css = app.__css;
  assert.match(css, /@page\{size:A4;margin:/);
  assert.match(css, /@top-right\{content:"تقرير خطير  سطر ثانٍ"/, 'الاقتباس والشرطة المائلة تُحذف والسطر الجديد مسافة');
  assert.match(css, /@top-left\{content:"مدرسة"/);
  assert.match(css, /@page :first\{@top-right\{content:none\}@top-left\{content:none\}\}/, 'لا ترويسة مصغّرة بالصفحة 1');
  assert.match(css, /@bottom-center\{content:"صفحة " counter\(page\) " \/ " counter\(pages\)/);
  assert.match(css, /#printArea\.wrap\{max-width:none;padding-bottom:0\}/, 'padding-bottom:70px لـ.wrap يولّد صفحة فارغة');
  assert.doesNotMatch(app.__none, /@top-right\{content:"/);
});

test('CSS التقرير للطباعة: ألوان الأشرطة تُطبع، والكتل لا تُقسَم، والحشوة تُصفَّر', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(src, /\.gr-pg\{break-after:page/, 'فاصل صفحة بين تقارير الطلاب في التصدير الجماعي');
});

test('gradeReportPrint: يضع التقرير في #printArea ويطبع، ويُنظَّف بعد الطباعة', async () => {
  const app = opened(`window.__printed = 0;
    const area = { innerHTML: '', querySelector: sel => area.innerHTML.includes('class="gr"') ? {} : null };
    document.getElementById = id => id === 'printArea' ? area : null; window.__area = area;
    printNow = c => { window.__printed++; window.__cleanup = c; };
    gradeReportPrint('<div class="gr">تقرير</div>', { right: 'ي', left: 'ش' });
    window.__during = area.innerHTML; window.__cleanup();`);
  assert.equal(app.__printed, 1);
  assert.match(app.__during, /^<style>@page\{/);
  assert.match(app.__during, /<div class="gr">تقرير<\/div>/);
  assert.equal(app.__area.innerHTML, '', 'بعد الطباعة يُفرَّغ فلا يبقى @page يؤثر في طباعات أخرى');
});

test('gradeReportPrint: عنوان الصفحة اسم الملف المقترح أثناء الطباعة ثم يُعاد', async () => {
  const app = opened(`window.__printed = 0; window.__titles = [];
    const area = { innerHTML: '', querySelector: () => ({}) };
    document.getElementById = id => id === 'printArea' ? area : null; document.title = 'شاهد';
    printNow = c => { window.__printed++; window.__titles.push(document.title); window.__cleanup = c; printKeepCleanup = c; };
    gradeReportPrint('<div class="gr">x</div>', null, 'تقرير-درجات-ثاني-6');
    window.__during = document.title; window.__cleanup(); printKeepCleanup = null;
    window.__after = document.title;
    gradeReportPrint('<div class="gr">y</div>', null, 'ثانٍ'); gradeReportPrint('<div class="gr">z</div>', null, 'ثالث');
    window.__cleanup(); window.__final = document.title;`);
  assert.equal(app.__during, 'تقرير-درجات-ثاني-6');
  assert.equal(app.__after, 'شاهد');
  assert.equal(app.__final, 'شاهد', 'طباعتان متتاليتان بلا afterprint بينهما لا تُضيعان العنوان الأصلي');
});

test('التقرير يطبع بنص حقيقي فقط: لا html2canvas ولا jsPDF ولا صور للصفحات', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  for(const gone of ['html2canvas', 'jsPDF', 'jspdf', 'addPdfPagesMulti', 'ensurePdfLibs', 'gradeReportAddMarks'])
    assert.doesNotMatch(src, new RegExp(gone), gone);
});

test('gradeReportRun: يطبع الناتج، ويتوقف عند الفراغ، ويمنع النقر المزدوج، ويعيد الزر', async () => {
  const app = opened(`window.__n = 0; window.__args = null; gradeReportPrint = (h, m, t) => { window.__n++; if(window.__n === 1) window.__args = [h, m, t]; };
    window.__r = (async () => {
      await gradeReportRun(null, async () => ({ html: '<div class="gr">x</div>', mark: { right: 'ي' } }), 'اسم-الملف');
      window.__afterOk = gradeReportBusy;
      await gradeReportRun(null, async () => '', 'f'); window.__afterEmpty = window.__n;
      const first = gradeReportRun(null, async () => { await new Promise(r => setTimeout(r, 20)); return { html: '<b class="gr">1</b>' }; }, 'a');
      await gradeReportRun(null, async () => ({ html: '<b class="gr">2</b>' }), 'b');
      await first; window.__total = window.__n;
      await gradeReportRun(null, async () => { throw new Error('boom'); }, 'e'); window.__afterErr = gradeReportBusy; })();`);
  await app.__r;
  assert.match(app.__args[0], /class="gr">x</);
  assert.equal(app.__args[1].right, 'ي');
  assert.equal(app.__args[2], 'اسم-الملف', 'الاسم المقترح للملف يصل للطباعة');
  assert.equal(app.__afterOk, false);
  assert.equal(app.__afterEmpty, 1, 'فارغ لا يطبع');
  assert.equal(app.__total, 2, 'الطباعة الثانية أثناء الأولى لم تُنفَّذ');
  assert.equal(app.__afterErr, false, 'الخطأ لا يترك الحالة مشغولة');
});

test('زر واحد بدل زرين: PDF — طباعة / حفظ، في النافذة وصفحة الطالب', async () => {
  const app = opened(`crmGradeAnalysis.exportOpen = true; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.equal((app.__d.match(/exportGradeReport\(this\)/g) || []).length, 1);
  assert.doesNotMatch(app.__d, /exportCrmGradeAnalysis\('pdf'/, 'زر الصورة القديم أُزيل');
  assert.doesNotMatch(app.__d, /تجريبي/);
  assert.match(app.__d, /⤓ PDF للطباعة/);
  assert.doesNotMatch(app.__d, /الوزارة/, 'لا هوية وزارة في الأزرار');
  const grades = fs.readFileSync(path.join(root, 'app/app-17-grades.js'), 'utf8');
  assert.equal((grades.match(/openStudentReportChooser\('\$\{st\.id\}'\)/g) || []).length, 1, 'زر واحد يفتح نافذة اختيار النسخة (app-36)');
  assert.doesNotMatch(grades, /exportCrmStudentReport\(this/, 'الزر القديم أُزيل');
});

test('الطباعة تنتظر فكّ صورة الشعار (وإلا خرجت الترويسة بلا شعار)، وفشل تحميل الشعار لا يُخزَّن', async () => {
  const app = opened(`window.__printed = 0; let release; const gate = new Promise(r => { release = r; });
    const area = { innerHTML: '', querySelector: () => ({}), querySelectorAll: sel => sel === 'img' ? [{ decode: () => gate }] : [] };
    document.getElementById = id => id === 'printArea' ? area : null;
    printNow = () => { window.__printed++; };
    window.addEventListener = () => {}; window.removeEventListener = () => {};
    window.__p = gradeReportPrint('<div class="gr"><img src="data:image/png;base64,AA"></div>', null);
    window.__before = window.__printed; window.__release = release;`);
  assert.equal(app.__before, 0, 'لا طباعة قبل فكّ الصورة');
  app.__release();
  await app.__p;
  assert.equal(app.__printed, 1);
  const f = opened(`fetch = () => Promise.reject(new Error('x')); window.__r = gradeReportLogoData(); `);
  assert.equal(await f.__r, '');
  assert.equal(runInAppContext(f, 'gradeReportLogoCache'), null, 'الفشل لا يُخزَّن فيُعاد المحاولة بالتصدير التالي');
});

test('نافذة التحليل: نطاق التقرير، وزر PDF، ومفتاح التعليق التربوي، وخيارات التقرير', async () => {
  const app = opened(`crmGradeAnalysis.exportOpen = true; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__d, /id="crmGaScope"/);
  assert.doesNotMatch(app.__d, /crmGaNotes|ملاحظات تربوية/, 'مفتاح التعليق التربوي أُلغي (ق12)');
  assert.match(app.__d, /exportGradeReport\(this\)/);
  assert.match(app.__d, /openGradeReportEditor\('ga'\)/);
  assert.match(app.__d, /<option value="group"[^>]*>كل شعب الصف/);
  const solo = opened(`crmSections = [{ id: 'S', grade_level_id: 'G' }]; crmGradeAnalysis.exportOpen = true; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(solo.__d, /<option value="group"[^>]*disabled[^>]*>/, 'بلا شعب أخرى: الخيار معطّل');
});

test('التصدير بنقرتين: PDF وExcel ظاهران دون فتح الخيارات، والخيارات مطوية افتراضيًا', async () => {
  const app = opened(`window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__d, /onclick="exportGradeReport\(this\)"/, 'PDF ظاهر مباشرة');
  assert.match(app.__d, /exportCrmGradeAnalysis\('xlsx', this\)/, 'Excel ظاهر مباشرة');
  assert.doesNotMatch(app.__d, /id="crmGaScope"/, 'النطاق والخانات مطوية حتى يفتح المعلم الخيارات');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(css, /\.crm-ga-bot\{position:sticky;bottom:-24px;/, 'الشريط يلتصق بحافة النافذة لا بحافة المحتوى (حشو confirm-box = 24px) فلا يظهر محتوى تحته');
});

test('تقرير ولي الأمر: زر «تقرير» بجانب كل اسم في قائمة الطلاب، ويُنتج تقرير ذلك الطالب وحده', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; crmGradeAnalysis.open = 'low'; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build, filename) => { window.__calls.push({ out: await build(), filename }); };
    window.__p = exportCrmStudentReportFor('a', null);`);
  await app.__p;
  const shownNames = (app.__d.match(/class="crm-ga-name"/g) || []).length;
  assert.ok(shownNames >= 1);
  assert.equal((app.__d.match(/toggleCrmGaReportTo\('(?!\*)/g) || []).length, shownNames, 'سهم لكل اسم ظاهر');
  assert.equal(app.__calls.length, 1);
  assert.match(app.__calls[0].out.html, /أحمد/);
  assert.doesNotMatch(app.__calls[0].out.html, /بدر|جاسر|دخيل|عادل/, 'لا أسماء طلاب آخرين في تقرير ولي الأمر');
  assert.match(app.__calls[0].filename, /^تقرير-طالب-أحمد-/);
  assert.match(app.__d, /title="تنزيل تقرير الطالب"[^>]*onclick="toggleCrmGaReportTo\('a'\)">⤓<\/button>/, 'سهم فقط بلا نص');
});

test('تقارير كل الطلاب: ملف واحد، تقرير لكل طالب بصفحة، ومن بلا درجات يُستثنى', async () => {
  const app = opened(`crmGrades = Object.assign({}, crmGrades, { scores: crmGrades.scores.filter(x => x.student_id !== 'e') }); crmGradeAnalysis.g = crmGrades;
    crmGradeAnalysis.tab = 'students'; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build, filename) => { window.__calls.push({ out: await build(), filename }); };
    window.__p = exportCrmAllStudentReports(null);`);
  await app.__p;
  assert.match(app.__d, /toggleCrmGaReportTo\('\*'\)">⤓ تقارير الطلاب — ملفات PDF/);
  assert.equal(app.__calls.length, 1);
  const h = app.__calls[0].out.html;
  assert.equal((h.match(/class="gr-pg"/g) || []).length, 4, 'تقرير لكل طالب له درجات');
  assert.doesNotMatch(h, /عادل/, 'من بلا درجات لا يُضمَّن');
  for(const n of ['أحمد', 'بدر', 'جاسر', 'دخيل']) assert.match(h, new RegExp(n));
  assert.match(app.__calls[0].filename, /^تقارير-الطلاب-/);
  assert.match(app.__calls[0].out.mark.right, /تقارير أداء الطلاب/);
  assert.match(fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8'), /\.gr-pg\{break-after:page/, 'فاصل صفحة بين التقارير عند الطباعة');
});

test('الجهة الموجَّه إليها: السهم يفتح الخيارات الأربعة، والاختيار ينزّل التقرير مكتوبًا عليه الجهة', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; crmGradeAnalysis.open = 'low';
    window.__before = crmGradeAnalysisHtml(crmGradeAnalysis);
    toggleCrmGaReportTo('a'); window.__open = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build, filename) => { window.__calls.push({ out: await build(), filename }); };
    window.__p = pickCrmGaReportTo('vice', null);`);
  assert.doesNotMatch(app.__before, /crm-ga-pop"/, 'الخيارات مخفية قبل ضغط السهم');
  for(const k of ['guardian', 'vice', 'staff', 'counselor', 'other']) assert.match(app.__open, new RegExp(`pickCrmGaReportTo\\('${k}'`));
  for(const t of ['ولي الأمر', 'وكيل شؤون الطلاب', 'وكيل شؤون المعلمين', 'الموجه الطلابي', 'أخرى']) assert.match(app.__open, new RegExp(t));
  await app.__p;
  assert.equal(app.__calls.length, 1);
  const h = app.__calls[0].out.html;
  assert.doesNotMatch(h, /موجّه إلى/, 'لا سطر «موجّه إلى» في الترويسة');
  assert.equal((h.match(/وكيل شؤون الطلاب/g) || []).length, 1, 'اسم الجهة مرة واحدة: خانة توقيعها');
  assert.match(h, /<div><small><\/small>وكيل شؤون الطلاب<\/div>/);
  const app2 = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('a');
    window.__calls = []; gradeReportRun = async (btn, build) => { window.__calls.push(await build()); };
    window.__p = pickCrmGaReportTo('counselor', null);`);
  await app2.__p;
  assert.doesNotMatch(app2.__calls[0].html, /موجّه إلى/);
  assert.match(app2.__calls[0].html, /<div><small><\/small>الموجه الطلابي<\/div>/, 'خانة توقيع للجهة');
  assert.equal(app2.__repFor, undefined);
});

test('الجهة «أخرى»: نص حرّ يُهرَّب ويُقصّ، والفارغ لا ينزّل، و«كل الطلاب» يحمل الجهة', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('a'); pickCrmGaReportTo('other', null);
    window.__o = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build) => { window.__calls.push(await build()); };
    const orig = document.getElementById.bind(document); document.getElementById = id => id === 'crmGaToOther' ? { value: '  <img src=x onerror=1>  مدير ' + 'م'.repeat(80), focus(){} } : orig(id);
    window.__p = pickCrmGaReportTo('otherGo', null);`);
  assert.match(app.__o, /id="crmGaToOther"/);
  await app.__p;
  const h = app.__calls[0].html;
  assert.doesNotMatch(h, /<img src=x/, 'النص مُهرَّب');
  assert.match(h, /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(h, /م{50}/, 'يُقصّ على 40 حرفًا');
  assert.match(h, /<div><small><\/small>&lt;img src=x onerror=1&gt; مدير/, 'الجهة الحرّة مُهرَّبة تحت خانة التوقيع');
  const empty = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('a'); pickCrmGaReportTo('other', null);
    window.__calls = []; gradeReportRun = async () => { window.__calls.push(1); };
    const orig = document.getElementById.bind(document); document.getElementById = id => id === 'crmGaToOther' ? { value: '   ', focus(){} } : orig(id);
    window.__p = pickCrmGaReportTo('otherGo', null);`);
  await empty.__p;
  assert.equal(empty.__calls.length, 0);
  const all = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('*');
    window.__calls = []; gradeReportRun = async (btn, build) => { window.__calls.push(await build()); };
    window.__p = pickCrmGaReportTo('guardian', null);`);
  await all.__p;
  assert.equal((all.__calls[0].html.match(/<div><small><\/small>ولي الأمر<\/div>/g) || []).length, 5, 'كل تقرير يحمل الجهة تحت التوقيع');
});

test('تقارير الطلاب (الزر العام): تختار الفئة ثم الجهة، والفئة تحدّد من يُنزَّل لهم', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('*'); window.__s1 = crmGradeAnalysisHtml(crmGradeAnalysis);
    pickCrmGaScope('mid'); window.__s2 = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build, filename) => { window.__calls.push({ out: await build(), filename }); };
    window.__p = pickCrmGaReportTo('vice', null);`);
  await app.__p;
  for(const k of ['all', 'low', 'mid', 'top']) assert.match(app.__s1, new RegExp(`pickCrmGaScope\\('${k}'\\)`));
  assert.match(app.__s1, /الضعاف<\/span><b>1<\/b>/);
  assert.match(app.__s1, /المتوسطون<\/span><b>2<\/b>/);
  assert.match(app.__s1, /المتفوقون<\/span><b>2<\/b>/);
  assert.doesNotMatch(app.__s1, /pickCrmGaReportTo\('guardian'/, 'الخطوة الأولى فئات فقط، لا جهات');
  assert.match(app.__s2, /المتوسطون — موجّه إلى/);
  assert.match(app.__s2, /pickCrmGaScope\(null\)/, 'رجوع لاختيار الفئة');
  const c = app.__calls[0];
  assert.equal((c.out.html.match(/class="gr-pg"/g) || []).length, 2, 'المتوسطون اثنان فقط');
  assert.match(c.out.html, /بدر/);
  assert.match(c.out.html, /جاسر/);
  assert.doesNotMatch(c.out.html, /أحمد|دخيل|عادل/, 'لا طلاب من فئات أخرى');
  assert.match(c.out.html, /<div><small><\/small>وكيل شؤون الطلاب<\/div>/);
  assert.match(c.filename, /^تقارير-المتوسطون-/);
  assert.match(c.out.mark.right, /المتوسطون/);
  const none = opened(`crmGrades = Object.assign({}, crmGrades, { scores: crmGrades.scores.filter(x => !['d', 'e'].includes(x.student_id)) }); crmGradeAnalysis.g = crmGrades;
    crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('*'); window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(none.__d, /disabled onclick="pickCrmGaScope\('top'\)"/, 'فئة فارغة معطّلة');
});

test('قائمة السهم تذكر اسم الطالب، وبديل «الأعلى درجات» لا يُسمّى «المتفوقون» في الفئات ولا Excel', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('a'); window.__n = crmGradeAnalysisHtml(crmGradeAnalysis); pickCrmGaReportTo('other', null); window.__h = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__n, /<span>أحمد — موجّه إلى<\/span>/);
  assert.match(app.__h, /onkeydown="if\(event\.key==='Enter'\)/, 'Enter في خانة «أخرى» ينزّل');
  const fb = opened(`crmGrades = Object.assign({}, crmGrades, { scores: crmGrades.scores.filter(x => x.student_id !== 'e') }); crmGradeAnalysis.g = crmGrades;
    crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('*'); window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);
    const v = gradeAnalysisView(crmGradeAnalysis); window.__x = gradeAnalysisExportRows(crmGradeAnalysis, v, true);`, { analysisRules: { pass: 50, edge: 10, top: 95, fallback: true } });
  assert.match(fb.__d, /<span>الأعلى درجات<\/span><b>\d+<\/b>/, 'اسم الفئة بالبديل');
  assert.doesNotMatch(fb.__d, /<span>المتفوقون<\/span>/);
  assert.match(JSON.stringify(fb.__x), /"الأعلى درجات"/, 'Excel يوسم أصحاب البديل');
});

test('تقارير كل الطلاب: لا تعمل لو تبدّلت الشعبة المعروضة', async () => {
  const app = opened(`window.__calls = []; gradeReportRun = async () => { window.__calls.push(1); };
    crmGrades = Object.assign({}, crmGrades, { sectionId: 'S2' }); exportCrmAllStudentReports(null);`);
  assert.equal(app.__calls.length, 0);
});

test('تقرير ولي الأمر: لا يعمل لو تبدّلت الشعبة المعروضة، ولا لطالب ليس في الشعبة', async () => {
  const app = opened(`window.__calls = []; gradeReportRun = async () => { window.__calls.push(1); };
    exportCrmStudentReportFor('zzz', null);
    crmGrades = Object.assign({}, crmGrades, { sectionId: 'S2' }); exportCrmStudentReportFor('a', null);`);
  assert.equal(app.__calls.length, 0);
});

test('محرّر الخيارات: المدرسة والمعلم والوكيل ظاهرة (تُحفظ مرة واحدة)، والبقية داخل «خيارات إضافية»', async () => {
  const app = opened(`openGradeReportEditor('ga'); window.__d = gradeReportEditorHtml();`);
  const [head, more] = app.__d.split('<details class="gr-more">');
  assert.ok(more, 'قسم الخيارات الإضافية موجود');
  assert.match(head, /id="grFld_school"/);
  assert.match(head, /id="grFld_teacher"/);
  assert.match(head, /id="grFld_vice"/, 'وكيل الشؤون ظاهر بلا فتح خيارات إضافية');
  assert.match(head, /تُدخلها مرة واحدة فتُحفظ/);
  assert.doesNotMatch(head, /grFld_subject/);
  assert.doesNotMatch(more, /grFld_vice/);
  assert.match(more, /grFld_subject/);
  assert.match(more, /ما يُطبع في التقرير/);
});

test('وكيل شؤون المعلمين والموجه الطلابي: حقلان يُحفظان بعد التنقية', async () => {
  const app = opened(`openGradeReportEditor('ga'); window.__e = gradeReportEditorHtml(); window.__n = normalizeReportPrefs({ staff: '  أ.  خالد ', counselor: 'م. سعد', vice: 'ف' });`);
  const head = app.__e.split('<details class="gr-more">')[0];
  for(const k of ['vice', 'staff', 'counselor']) assert.match(head, new RegExp(`id="grFld_${k}"`));
  assert.equal(app.__n.staff, 'أ. خالد', 'الحقل يُنقّى ويُحفظ');
  assert.equal(app.__n.counselor, 'م. سعد');
});

test('خيار «الأسماء» الافتراضي يتبع إعداد المعلم', async () => {
  assert.equal(opened('').__modal.length, 1);
  const app = opened(`window.__w = crmGradeAnalysis.withNames;`, { reportPrefs: { show: { names: true } } });
  assert.equal(app.__w, true);
});

test('محرّر الخيارات: يُحفظ المخصَّص، والافتراضي لا يُخزَّن، وفشل الحفظ يُرجع رسالة', async () => {
  const app = opened(`saveAppFeatures = async () => { appFeaturesSaved = appFeatures; };`);
  runInAppContext(app, `(async () => {
    window.__r1 = await persistGradeReportPrefs({ school: 'ثانوية بدر', teacher: '', vice: 'سامي', show: { levels: true, stats: true, items: true, names: true, compare: false }, notes: { reading: true, strengths: false, weaknesses: true, plans: true } });
    window.__saved = JSON.stringify(appFeatures.reportPrefs);
    window.__r2 = await persistGradeReportPrefs(${JSON.stringify({ school: '', teacher: '', vice: '', show: { levels: true, stats: true, items: true, names: false, compare: false }, notes: { reading: false, strengths: false, weaknesses: false, plans: false } })});
    window.__after = appFeatures.reportPrefs;
    saveAppFeatures = async () => {}; window.__r3 = await persistGradeReportPrefs({ school: 'س' }); })()`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(app.__r1, null);
  assert.match(app.__saved, /ثانوية بدر/);
  assert.equal(app.__r2, null);
  assert.equal(app.__after, undefined);
  assert.equal(app.__r3, 'تعذّر حفظ الخيارات');
});

test('المحرّر من النافذة: يفتح، يحفظ، ويحدّث «مع أسماء الطلاب»، والإلغاء يعيد الشاشة', async () => {
  const app = opened(`saveAppFeatures = async () => { appFeaturesSaved = appFeatures; };
    openGradeReportEditor('ga'); window.__open = crmGradeAnalysis.reportEdit; window.__html = crmGradeAnalysisHtml(crmGradeAnalysis);
    gradeReportDraftText('school', 'مدرستي'); gradeReportDraftFlag('show', 'names', true);
    window.__p = saveGradeReportPrefs();`);
  await app.__p;
  assert.equal(app.__open, true);
  assert.match(app.__html, /خيارات التقارير/);
  assert.match(app.__html, /وكيل شؤون الطلاب/);
  assert.match(app.__html, /تلقائي: عبدالعزيز المطيري/);
  assert.equal(runInAppContext(app, 'crmGradeAnalysis.reportEdit'), null);
  assert.equal(runInAppContext(app, 'crmGradeAnalysis.withNames'), true);
  assert.equal(runInAppContext(app, 'gradeReportPrefsNow().school'), 'مدرستي');
  assert.equal(runInAppContext(app, 'gradeReportPrefsNow().notes'), undefined);
  runInAppContext(app, `openGradeReportEditor('ga'); gradeReportEditorCancel();`);
  assert.equal(runInAppContext(app, 'crmGradeAnalysis.reportEdit'), null);
});

test('الإعدادات: زر خيارات التقارير في تخصيص التطبيق', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-22-customize.js'), 'utf8');
  assert.match(src, /openGradeReportEditor\('cust'\)/);
  assert.match(src, /normalizeReportPrefs/);
});

test('عزل البيانات: app-34 لا يستعلم القاعدة مباشرة (كل التحميل عبر loadGradeSheetsRaw المفلتر بـ teacher_id)', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.doesNotMatch(src, /\bsb\.from\(/);
  assert.match(src, /loadGradeSheetsRaw\(/);
  assert.match(fs.readFileSync(path.join(root, 'app/app-30-grade-compare.js'), 'utf8'), /\.eq\('teacher_id', uid\)/);
});

test('أزرار التصدير: الطالب والتحليل يمرّان بـ beginExportBusy ومنع النقر المزدوج', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(src, /if\(gradeReportBusy\) return;/);
  assert.match(src, /beginExportBusy\(btn/);
  assert.match(src, /endExportBusy\(btn\)/);
  assert.match(fs.readFileSync(path.join(root, 'app/app-17-grades.js'), 'utf8'), /openStudentReportChooser\(/);
  assert.match(fs.readFileSync(path.join(root, 'app/app-36-student-report.js'), 'utf8'), /gradeReportRun\(btn, \(\) => srBuildReport/, 'تقرير الطالب يمرّ بحارس gradeReportRun (busy + منع النقر المزدوج)');
});

test('الملف في index.html وAPP_SHELL، وشعار الوزارة في المشروع وAPP_SHELL، والإصدارات متطابقة', async () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app-34-grade-report\.js/);
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /app-34-grade-report\.js/);
  assert.match(sw, /\.\/moe-logo\.png/, 'الشعار في APP_SHELL ليعمل بلا اتصال');
  assert.ok(fs.existsSync(path.join(root, 'moe-logo.png')), 'ملف شعار الوزارة موجود');
  assert.match(fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8'), /fetch\('moe-logo\.png'\)/);
  assert.match(sw, new RegExp(`APP_VERSION_SW = '${v.version}'`));
  assert.match(fs.readFileSync(path.join(root, 'app/app-26-update-check.js'), 'utf8'), new RegExp(`APP_VERSION = '${v.version}'`));
  assert.ok(v.notes.length >= 1);
});

/* ===== 2.82: اسم الطالب بعنوانه بسطر واحد، وشعار المدرسة، والتاريخ ضمن سطر المادة ===== */
test('شعار المدرسة: لا يُحفظ بالخيارات إلا مسار ملف بمجلد المستخدم', () => {
  const uid = '123e4567-e89b-12d3-a456-426614174000';
  const ok = uid + '/school-logo-1793961117103.png';
  const data = 'data:image/png;base64,iVBORw0KGgo=';
  const app = opened(`window.__n1 = normalizeReportPrefs({ logo: '${ok}' });
    window.__bad = [ 'javascript:alert(1)', '${data}', '../x/school-logo-1793961117103.png', '${uid}/other.png', '${ok}" onerror="x', 'A'.repeat(5000) ].map(v => normalizeReportPrefs({ logo: v }));
    window.__size = JSON.stringify(normalizeReportPrefs({ logo: '${ok}', school: 'ثانوية بدر', teacher: 'x'.repeat(80), vice: 'x'.repeat(80), staff: 'x'.repeat(80), counselor: 'x'.repeat(80), subject: 'x'.repeat(80) })).length;`, NOTES_ON);
  assert.equal(app.__n1.logo, ok);
  app.__bad.forEach(n => assert.ok(n === null || n.logo === '', 'شعار غير صالح يُهمَل'));
  assert.ok(app.__size < 3000, 'الخيارات كلها تبقى تحت قيد القاعدة (4000 بايت): ' + app.__size);
});

test('الشعار لا يدخل features كصورة (قيد user_app_settings < 4000 بايت): يُرفع لحاوية الصور ويُحفظ مساره', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(src, /storage\.from\('shawahid-photos'\)\.upload\(path, blob/);
  assert.match(src, /school-logo-\$\{Date\.now\(\)\}\.png/);
  assert.match(src, /if\(newPath\) sb\.storage\.from\('shawahid-photos'\)\.remove\(\[newPath\]\)/, 'فشل الحفظ يحذف الملف المرفوع');
  assert.match(src, /oldLogo !== p\.logo[\s\S]*remove\(\[oldLogo\]\)/, 'استبدال/حذف الشعار يحذف القديم');
});

test('محرر الخيارات يعرض حقل شعار المدرسة، والصورة المختارة تبقى بالمسودة حتى «حفظ»', () => {
  const app = opened(`openGradeReportEditor('cust'); window.__h = gradeReportEditorHtml(); gradeReportDraftLogo('data:image/png;base64,iVBORw0KGgo=', false);
    window.__d1 = gradeReportDraft.logoData; gradeReportDraftLogo('', true); window.__d2 = gradeReportDraft.logoData + '|' + gradeReportDraft.logo;`, NOTES_ON);
  assert.match(app.__h, /شعار المدرسة/);
  assert.match(app.__h, /gradeReportPickLogo/);
  assert.match(app.__d1, /iVBORw0KGgo=/);
  assert.equal(app.__d2, '|');
});

test('رفع الشعار لا يستعمل fetch على data: (CSP connect-src يمنعه) بل يفكّ base64 مباشرة', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html.match(/connect-src[^;]*;/)[0], /data:/, 'الفرض: CSP لا يسمح بـdata: في connect-src');
  assert.doesNotMatch(src, /fetch\(d\.logoData\)/);
  const app = opened(`const K = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    globalThis.atob = v => { v = v.replace(/=+$/, ''); let o = '', b = 0, n = 0; for(const ch of v){ b = (b << 6) | K.indexOf(ch); n += 6; if(n >= 8){ n -= 8; o += String.fromCharCode((b >> n) & 255); } } return o; };
    globalThis.Blob = class { constructor(parts, o){ this.size = parts[0].length; this.type = o.type; } };
    window.__b = gradeReportDataToBlob('data:image/png;base64,iVBORw0KGgo='); window.__bad = (() => { try{ gradeReportDataToBlob('javascript:1'); return 'no'; } catch(e){ return 'throws'; } })();`, NOTES_ON);
  assert.equal(app.__b.type, 'image/png');
  assert.equal(app.__b.size, 8);
  assert.equal(app.__bad, 'throws');
});

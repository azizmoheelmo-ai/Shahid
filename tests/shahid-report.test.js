'use strict';
/* قالب الشاهد الوحيد بهوية وزارة التعليم (ق14) — راجع REPORTS.md §4.3 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, runInAppContext } = require('./load-app.js');
const root = path.join(__dirname, '..');

const rec = { school: 'مدرسة <b>س</b>', teacher_name: 'م', element_label: 'عنصر', steps: ['أ', 'ب'], description: '<img src=x>' };

test('هوية الوزارة: خطها وألوانها وتدرجها، بلا ألوان الهوية القديمة (كحلي/ذهبي)', () => {
  const app = loadApp();
  const html = app.buildPdfHtml(rec, []);
  assert.match(html, /Helvetica Neue W23 for SKY/);
  assert.match(html, /#15445a/);
  assert.match(html, /linear-gradient\(90deg,#3B83B7,#4CB176\)/);
  assert.doesNotMatch(html, /#A9852E|#1B3245|#876A25|Amiri/i, 'لا ألوان ذهبية ولا خط Amiri');
});

test('النصوص مهرّبة، والقسم الفارغ يُحذف، والصور الفارغة تقول لا توجد صور', () => {
  const app = loadApp();
  const html = app.buildPdfHtml(rec, []);
  assert.match(html, /لا توجد صور مرفقة/);
  assert.doesNotMatch(html, /الهدف من هذا الإجراء/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<b>س<\/b>/);
});

test('الشعاران: شعار الوزارة والمدرسة يظهران إن حُمّلا، ولا يظهر شعار مدرسة غير صالح', async () => {
  const app = loadApp();
  assert.doesNotMatch(app.buildPdfHtml(rec, []), /<img /, 'بلا شعار قبل التحميل');
  const { runInAppContext } = require('./load-app.js');
  runInAppContext(app, `gradeReportLogoData = async () => 'data:image/png;base64,MOE'; gradeReportSchoolLogoData = async () => 'javascript:alert(1)'; srEnsureFonts = async () => {};`);
  await runInAppContext(app, 'shahidWarmLogos()');
  const bad = app.buildPdfHtml(rec, []);
  assert.match(bad, /<img src="data:image\/png;base64,MOE"/);
  assert.doesNotMatch(bad, /javascript:/, 'شعار المدرسة الفاسد يُهمَل');
  runInAppContext(app, `gradeReportSchoolLogoData = async () => 'data:image/png;base64,SCH';`);
  await runInAppContext(app, 'shahidWarmLogos()');
  const ok = app.buildPdfHtml(rec, []);
  assert.equal((ok.match(/<img /g) || []).length, 2);
});

test('التصميمان القديمان واختيارهما أُزيلا: لا buildClassicPdfHtml ولا قائمة اختيار تصميم', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-09-shahid-form.js'), 'utf8');
  assert.doesNotMatch(src, /buildClassicPdfHtml|SHAHID_PRINT_THEME|setShahidPrintTheme/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /shPrintTheme/);
});

test('كل مسارات الشاهد (طباعة/مشاركة/الكل/الإنجاز/المدير) تحمّل الشعارين قبل البناء', () => {
  const a9 = fs.readFileSync(path.join(root, 'app/app-09-shahid-form.js'), 'utf8');
  const a8 = fs.readFileSync(path.join(root, 'app/app-08-admin.js'), 'utf8');
  assert.equal((a9.match(/await shahidWarmLogos\(\)/g) || []).length, 4, 'نموذج · سجل · PDF · الكل');
  assert.equal((a8.match(/await shahidWarmLogos\(\)/g) || []).length, 4, 'المدير · ملف الإنجاز · الخطة · التقييم الذاتي');
});

test('الصور: أكثر من ٦ تُختصر بملاحظة، والمفرد بعرض كامل', () => {
  const app = loadApp();
  const imgs = Array.from({ length: 8 }, (_, i) => 'data:image/png;base64,A' + i);
  const html = app.buildPdfHtml(rec, imgs);
  assert.equal((html.match(/<img /g) || []).length, 6);
  assert.match(html, /\+ 2 صور أخرى/);
  assert.match(app.buildPdfHtml(rec, [imgs[0]]), /width:100%;display:flex/);
});

/* ===== الشاهد صفحة واحدة ديناميكية (3.07) ===== */
test('التاريخ بصيغة لاتينية واحدة (2026-10-05) سواء من lesson_date أو created_at، وبلا تاريخ يبقى فارغًا', () => {
  const app = loadApp();
  assert.equal(app.shahidDateDisplay({ lesson_date: '2026-10-05' }), '2026-10-05');
  assert.match(app.shahidDateDisplay({ created_at: '2026-10-06T10:00:00Z' }), /^2026-10-0[56]$/);
  assert.equal(app.shahidDateDisplay({}), '');
  assert.doesNotMatch(app.buildPdfHtml({ created_at: '2026-10-06T10:00:00Z', element_label: 'ع' }, []), /[٠-٩]/, 'لا أرقام هندية');
});

test('شبكة الصور: 1 بعرض كامل · 2–4 بعمودين · 5–6 بثلاثة، ومعامل التصغير يُصغّر الإطارات', () => {
  const app = loadApp();
  assert.deepEqual(JSON.parse(runInAppContext(app, 'JSON.stringify([1, 2, 3, 4, 5, 6].map(shahidPhotoCols))')), [1, 2, 2, 2, 3, 3]);
  const imgs = n => Array.from({ length: n }, (_, i) => 'data:image/png;base64,A' + i);
  assert.match(app.buildPdfHtml(rec, imgs(5)), /width:calc\(33\.333% - 7px\)/);
  assert.match(app.buildPdfHtml(rec, imgs(3)), /width:calc\(50% - 5px\)/);
  const h = sc => +app.buildPdfHtml(rec, imgs(2), { frameScale: sc }).match(/height:(\d+)px;padding:5px/)[1];
  assert.ok(h(0.5) < h(1), 'تصغير الإطار');
});

test('كل طباعة شاهد مفرد تمرّ بـprintShahidRecord (zoom + صفحة واحدة) لا بوضع HTML خام في printArea (سبب قصّ الحافة اليسرى وصفحة التوقيع)', () => {
  const a9 = fs.readFileSync(path.join(root, 'app/app-09-shahid-form.js'), 'utf8');
  const a8 = fs.readFileSync(path.join(root, 'app/app-08-admin.js'), 'utf8');
  for(const src of [a9, a8]) assert.doesNotMatch(src, /printArea'\)\.innerHTML = buildPdfHtml/, 'لا HTML خام في printArea');
  assert.equal((a9.match(/printShahidRecord\(/g) || []).length, 3, 'التعريف + المسودة + سجلي');
  assert.match(a8, /await printShahidRecord\(rec/);
  assert.match(a9, /pages\.push\(await shahidFitPage\(/, 'الكل');
  assert.match(a8, /pages\.push\(await shahidFitPage\(/, 'ملف الإنجاز');
  assert.match(a9, /\(await shahidFitPage\(rec, photoDataUrls\)\)\.html/, 'الإرسال');
});

test('شريط «عنصر الأداء» كحليّ بنص أبيض (ق25) لا الأزرق الفاتح القديم', () => {
  const app = loadApp();
  const html = app.buildPdfHtml(rec, []);
  const i = html.indexOf('عنصر الأداء');
  const bar = html.slice(html.lastIndexOf('<div', i), html.indexOf('</div>', i));
  assert.match(bar, /background:#15445a/);
  assert.match(bar, /color:#fff/);
  assert.doesNotMatch(bar, /#eaf2f8/);
  assert.match(bar, /عنصر/, 'اسم العنصر ما زال في الشريط');
});

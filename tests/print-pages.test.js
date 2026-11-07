'use strict';
/* ============================================================
   طباعة الصفحات بنص حقيقي (app-35): الخطة · التقييم الذاتي · ملخص البرنامج · كل الشواهد · ملف الإنجاز
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('printFitZoom — العرض دائمًا، والارتفاع للصفحة الكاملة (الأصغر منهما)', async () => {
  const app = loadApp();
  const fw = 700 / 794;
  assert.ok(Math.abs(app.printFitZoom('width', 794, 5000) - fw) < 1e-9, 'تنساب: عرض فقط ولو طال المحتوى');
  assert.ok(Math.abs(app.printFitZoom('page', 794, 500) - fw) < 1e-9, 'صفحة قصيرة: العرض');
  const tall = app.printFitZoom('page', 794, 2000);
  assert.ok(tall < fw && Math.abs(tall * 2000 - (1010 - 12)) < 1e-6, 'صفحة طويلة تُصغَّر لتتسع في ارتفاع A4');
  assert.equal(app.printFitZoom('page', 794, 0), fw, 'ارتفاع غير معروف: العرض');
  assert.equal(app.printFitZoom('width', 600, 100), 1, 'لا تكبير فوق 1');
});

test('printPagesHtml — قسم لكل صفحة بعرض التصميم وzoom، وعرض مخصص يُحترم', async () => {
  const app = loadApp();
  const html = app.printPagesHtml([{ html: '<b>1</b>', fit: 'width' }, { html: '<i>2</i>', fit: 'page', h: 2000 }, { html: 'x', fit: 'width', designWidth: 700 }]);
  assert.equal((html.match(/<section class="pp"/g) || []).length, 3);
  assert.equal((html.match(/height:1006px;overflow:hidden/g) || []).length, 1, 'الصفحة الكاملة فقط بارتفاع ثابت وقصّ');
  assert.match(html, /<div class="pp-in" style="width:794px;zoom:0\.8816"><b>1<\/b>/);
  assert.match(html, /zoom:0\.499/, 'الصفحة الطويلة 998/2000');
  assert.match(html, /width:700px;zoom:1"/);
});

test('CSS الطباعة: ألوان تُطبع، فاصل صفحة بين الأقسام، وحشوة .wrap تُصفَّر، وكتل لا تُقسَم', async () => {
  const css = loadApp().PRINT_PAGES_CSS || '';
  const src = read('app/app-35-print-pages.js');
  assert.match(src, /print-color-adjust:exact/);
  assert.match(src, /break-after:page/);
  assert.match(src, /\.pp:last-child\{break-after:auto/, 'لا صفحة فارغة أخيرة');
  assert.match(src, /#printArea\.wrap\{max-width:none;padding-bottom:0\}/);
  assert.match(src, /\.pdf-avoid-break\{break-inside:avoid/);
  assert.match(src, /@page\{size:A4;margin:10mm\}/);
  void css;
});

function printApp(extra){
  const app = loadApp({ currentUser: { id: 'u1', user_metadata: { full_name: 'عبدالعزيز' } } });
  runInAppContext(app, `window.__printed = 0; window.__measured = []; window.__handlers = []; window.__order = [];
    const area = { innerHTML: '', querySelector: sel => area.innerHTML.includes('class="pp"') ? {} : null };
    window.__area = area;
    const origGet = document.getElementById; window.__origGet = origGet;
    document.getElementById = id => id === 'printArea' ? area : origGet.call(document, id); document.title = 'شاهد';
    printNow = c => { window.__printed++; window.__titleAtPrint = document.title; window.__handlers.push(c); };
    window.addEventListener = (ev, fn) => window.__handlers.push(fn); window.removeEventListener = () => {};
    printMeasureHeight = async (html, w) => { window.__measured.push(html); return 2000; };
    ${extra || ''}`);
  return app;
}

test('printPages — يقيس صفحات fit:page فقط، ويطبع، ويُنظَّف بعد الطباعة ويعيد العنوان', async () => {
  const app = printApp(`window.__p = printPages([{ html: '<b>a</b>', fit: 'width' }, { html: '<b>b</b>', fit: 'page' }], 'اسم-الملف');`);
  await app.__p;
  assert.deepEqual([...app.__measured], ['<b>b</b>'], 'القياس لصفحات fit:page فقط');
  assert.equal(app.__printed, 1);
  assert.equal(app.__titleAtPrint, 'اسم-الملف');
  assert.match(app.__area.innerHTML, /^<style>@page\{size:A4;margin:10mm\}/);
  assert.equal((app.__area.innerHTML.match(/<section class="pp"/g) || []).length, 2);
  runInAppContext(app, 'window.__handlers[0]();');
  assert.equal(app.__area.innerHTML, '', 'بعد الطباعة يُفرَّغ');
  assert.equal(runInAppContext(app, 'document.title'), 'شاهد');
  runInAppContext(app, `window.__p2 = printPages([], 'x');`);
  await app.__p2;
  assert.equal(app.__printed, 1, 'لا صفحات: لا طباعة');
});

test('الخطة وملخص البرنامج والتقييم الذاتي: تمر عبر printPages (عرض/صفحة) بعنوان ملف عربي', async () => {
  const app = printApp(`window.__calls = []; printPages = async (pages, title) => { window.__calls.push({ pages, title }); };
    buildPlanHtml = () => '<div>plan</div>'; buildSelfAssessmentHtml = async () => '<div>sa</div>';
    activityPrograms = [{ id: 7 }]; buildProgramSummaryHtml = () => '<div>prog</div>';
    window.__r = (async () => { await printPlan(null); await printSelfAssessment(null); await printProgramSummary(7, null); })();`);
  await app.__r;
  const calls = [...app.__calls];
  assert.deepEqual(calls.map(c => c.pages[0].fit), ['width', 'width', 'page']);
  assert.match(calls[0].title, /^خطة-الأداء-\d{4}-\d{2}-\d{2}$/);
  assert.match(calls[1].title, /^التقييم-الذاتي-/);
  assert.match(calls[2].title, /^ملخص-البرنامج-/);
});

test('الخطة والتقييم: بلا محتوى لا طباعة (رسالة) ولا يبقى الزر مشغولًا', async () => {
  const app = printApp(`window.__n = 0; printPages = async () => { window.__n++; };
    buildPlanHtml = () => ''; buildSelfAssessmentHtml = async () => '';
    window.__r = (async () => { await printPlan(null); await printSelfAssessment(null); window.__busy = activeExportCount; })();`);
  await app.__r;
  assert.equal(app.__n, 0);
  assert.equal(app.__busy, 0, 'beginExportBusy/endExportBusy متوازنان');
});

test('كل الشواهد: مرتّبة بالعنصر ثم التاريخ، كل شاهد صفحة كاملة، وتقدّم على الزر', async () => {
  const app = printApp(`window.__calls = []; printPages = async (pages, title) => { window.__calls.push({ pages, title }); };
    getElementsOrder = () => [{ key: 'A' }, { key: 'B' }];
    myRecords = [{ id: 3, element_key: 'B', created_at: '2026-01-01' }, { id: 2, element_key: 'A', created_at: '2026-02-01' }, { id: 1, element_key: 'A', created_at: '2026-01-01' }];
    buildPdfHtml = (rec) => '<p>' + rec.id + '</p>'; isImageUrl = () => true; toDataUrl = async u => u;
    window.__texts = []; const btn = { disabled: false, textContent: 'ب', dataset: {}, querySelector: () => null };
    document.getElementById = id => id === 'exportAllBtn' ? btn : id === 'printArea' ? window.__area : window.__origGet.call(document, id);
    const orig = setExportBusyText; setExportBusyText = (b, t) => { window.__texts.push(t); orig(b, t); };
    window.__r = exportAllShawahid(); window.__btn = btn;`);
  await app.__r;
  const c = app.__calls[0];
  assert.deepEqual([...c.pages].map(p => p.html), ['<p>1</p>', '<p>2</p>', '<p>3</p>']);
  assert.ok([...c.pages].every(p => p.fit === 'page'));
  assert.match(c.title, /^كل-الشواهد-/);
  assert.match([...app.__texts].join('|'), /\(3\/3\)/);
  assert.equal(app.__btn.disabled, false);
});

test('كل الشواهد: بلا شواهد لا طباعة', async () => {
  const app = printApp(`window.__n = 0; printPages = async () => { window.__n++; }; myRecords = []; window.__r = exportAllShawahid();`);
  await app.__r;
  assert.equal(app.__n, 0);
});

test('ملف الإنجاز: غلاف ثم تقرير الخطة (ملخصه أولًا) ثم الشواهد، والغلاف والشواهد صفحات كاملة والخطة تنساب', async () => {
  const app = printApp(`window.__calls = []; printPages = async (pages, title) => { window.__calls.push({ pages, title }); };
    loadPlan = async () => {}; loadSelfAssessment = async () => {};
    getElementsOrder = () => [{ key: 'A', label: 'عنصر (10%)' }];
    myPlan = {}; mySelfAssessment = {};
    buildPlanHtml = () => '<div>plan-detail</div>'; buildPdfHtml = rec => '<p>شاهد ' + rec.id + '</p>';
    isImageUrl = () => false; toDataUrl = async () => null;
    sb.from = () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 1, element_key: 'A', created_at: '2026-01-01' }, { id: 2, element_key: 'A', created_at: '2026-01-02' }] }) }) }) });
    window.__r = exportPortfolio(null);`);
  await app.__r;
  const c = app.__calls[0];
  const pages = [...c.pages];
  assert.equal(pages.length, 4);
  assert.deepEqual(pages.map(p => p.fit), ['page', 'width', 'page', 'page']);
  assert.equal(pages[1].designWidth, 700, 'الخطة بعرض الطباعة الفعلي');
  assert.match(pages[0].html, /ملف الإنجاز الوظيفي/);
  assert.match(pages[1].html, /plan-detail/);
  assert.doesNotMatch(pages.map(p => p.html).join(''), /ملخص الخطة والتقييم الذاتي/, 'لا صفحة ملخص قديمة منفصلة');
  assert.match(pages[2].html, /شاهد 1/);
  assert.match(c.title, /^ملف-الإنجاز-/);
});

test('ملف الإنجاز يستعلم شواهد المستخدم الحالي فقط (فلترة صريحة)', async () => {
  const src = read('app/app-08-admin.js');
  const body = src.slice(src.indexOf('async function exportPortfolio'));
  assert.match(body, /\.from\('shawahid'\)\.select\('\*'\)\.eq\('user_id', currentUser\.id\)/);
});

test('لا صورة ولا jsPDF في المسارات الخمسة، والأزرار المكررة أُزيلت وسُمّيت «طباعة / حفظ PDF»', async () => {
  const a8 = read('app/app-08-admin.js'), a9 = read('app/app-09-shahid-form.js'), a10 = read('app/app-10-programs.js'), html = read('index.html');
  const fn = (src, name) => { const i = src.indexOf(name); const j = src.indexOf('\n}\n', i); return src.slice(i, j); };
  for(const [src, name] of [[a8, 'async function printPlan'], [a8, 'async function printSelfAssessment'], [a8, 'async function exportPortfolio'], [a9, 'async function exportAllShawahid'], [a10, 'async function printProgramSummary']]){
    const body = fn(src, name);
    for(const gone of ['jsPDF', 'html2canvas', 'addPdfPage', 'ensurePdfLibs', 'pdf.save', 'pdfRenderArea']) assert.doesNotMatch(body, new RegExp(gone), `${name} ← ${gone}`);
    assert.match(body, /printPages\(/, name);
  }
  for(const gone of ['exportPlanPdf', 'exportSelfAssessment', 'exportProgramSummaryPdf']){
    assert.doesNotMatch(html, new RegExp(gone), gone);
    assert.doesNotMatch(a8 + a9 + a10, new RegExp('function ' + gone), gone);
  }
  assert.match(html, /printPlan\(event\)">طباعة \/ حفظ PDF/);
  assert.match(html, /printSelfAssessment\(event\)">طباعة \/ حفظ التقييم PDF/);
  assert.match(html, /printProgramSummary\(currentProgramId, event\)">🖨 طباعة \/ حفظ PDF/);
  assert.match(html, /طباعة \/ حفظ الكل PDF/);
  assert.match(html, /ملف الإنجاز \(طباعة \/ حفظ PDF\)/);
});

function letterApp(extra){
  return printApp(`window.__calls = []; printPages = async (pages, title) => { window.__calls.push({ pages, title }); };
    const prevEl = { innerHTML: '<p>نص الخطاب</p>' };
    const origGet2 = document.getElementById;
    document.getElementById = id => id === 'acLetterPreview' || id === 'rlPreview' ? prevEl : origGet2.call(document, id);
    toDataUrl = async u => u === 'bad' ? null : 'data:image/png;base64,AAA' + u;
    ${extra || ''}`);
}

test('طباعة الخطاب: صفحة الخطاب fit:page، وصورة إثبات التسليم صفحة ثانية إن وُجدت', async () => {
  const app = letterApp(`window.__r = (async () => {
    await printLetterPages('acLetterPreview', 'p1', 'خطاب-إحالة', null);
    await printLetterPages('acLetterPreview', null, 'خطاب-إحالة', null);
    await printLetterPages('acLetterPreview', 'bad', 'خطاب-إحالة', null); window.__busy = activeExportCount; })();`);
  await app.__r;
  const [withPhoto, noPhoto, badPhoto] = [...app.__calls].map(c => [...c.pages]);
  assert.equal(withPhoto.length, 2);
  assert.ok(withPhoto.every(p => p.fit === 'page'));
  assert.match(withPhoto[0].html, /نص الخطاب/);
  assert.match(withPhoto[1].html, /صورة إثبات التسليم الموقّع/);
  assert.match(withPhoto[1].html, /src="data:image\/png;base64,AAAp1"/);
  assert.equal(noPhoto.length, 1);
  assert.equal(badPhoto.length, 1, 'تعذّر تحميل الصورة: الخطاب وحده');
  assert.match(app.__calls[0].title, /^خطاب-إحالة-\d{4}-\d{2}-\d{2}$/);
  assert.equal(app.__busy, 0);
});

test('طباعة الخطاب: مصدر صورة التسليم مُهرَّب (لا حقن عبر src)', async () => {
  const app = letterApp(`toDataUrl = async () => 'x" onerror="alert(1)'; window.__r = printLetterPages('acLetterPreview', 'p', 'خ', null);`);
  await app.__r;
  const photo = [...app.__calls[0].pages][1].html;
  assert.doesNotMatch(photo, /onerror="alert/);
  assert.match(photo, /&quot; onerror=&quot;alert\(1\)/);
});

test('أزرار الخطابين: تمرّر المعاينة والصورة الصحيحة، وتتحمّل غياب الحالة الحالية', async () => {
  const app = letterApp(`window.__args = []; printLetterPages = async (...a) => { window.__args.push(a.slice(0, 3)); };
    acCurrentCase = { case: { referral_receipt_photo_url: 'A' }, student: {} }; rlCurrentIncident = { incident: { referral_receipt_photo_url: 'R' }, student: {} };
    window.__r = (async () => { await printAcLetter(null); await printReferralLetter(null); acCurrentCase = null; rlCurrentIncident = null; await printAcLetter(null); await printReferralLetter(null); })();`);
  await app.__r;
  assert.deepEqual([...app.__args].map(a => [...a]), [
    ['acLetterPreview', 'A', 'خطاب-إحالة'], ['rlPreview', 'R', 'خطاب-تحويل'],
    ['acLetterPreview', null, 'خطاب-إحالة'], ['rlPreview', null, 'خطاب-تحويل']]);
});

test('الخطابان: زر «تنزيل PDF» أُزيل ودوال الصورة المرتبطة به، وزر طباعة/حفظ واحد، وواتساب يبقى ملفًا', async () => {
  const html = read('index.html'), a4 = read('app/app-04-academic-crm.js');
  assert.doesNotMatch(html, /downloadAcLetterPDF|downloadReferralLetterPDF/);
  assert.match(html, /printAcLetter\(event\)">طباعة \/ حفظ PDF/);
  assert.match(html, /printReferralLetter\(event\)">طباعة \/ حفظ PDF/);
  assert.match(html, /shareAcLetterWhatsApp\(event\)">إرسال واتساب/);
  assert.match(html, /downloadAcLetterWordFile|downloadReferralLetterWordFile/, 'تنزيل Word باقٍ');
  for(const gone of ['function printLetterContent', 'function downloadLetterPdfFile', 'function downloadAcLetterPDF', 'function downloadReferralLetterPDF'])
    assert.doesNotMatch(a4, new RegExp(gone), gone);
  const body = a4.slice(a4.indexOf('async function printLetterPages'), a4.indexOf('async function shareLetterWhatsApp'));
  for(const g of ['jsPDF', 'html2canvas', 'window.open', 'createObjectURL', 'buildLetterPdfBlob']) assert.doesNotMatch(body, new RegExp(g), 'printLetterPages ← ' + g);
  assert.match(a4.slice(a4.indexOf('async function shareLetterWhatsApp')), /navigator\.share\(\{ files/, 'المشاركة ما زالت ملفًا');
});

test('الملف الجديد في index.html وAPP_SHELL، والإصدارات متطابقة', async () => {
  const v = JSON.parse(read('version.json'));
  assert.match(read('index.html'), /app-35-print-pages\.js/);
  assert.match(read('sw.js'), /app-35-print-pages\.js/);
  assert.match(read('sw.js'), new RegExp(`APP_VERSION_SW = '${v.version}'`));
  assert.match(read('app/app-26-update-check.js'), new RegExp(`APP_VERSION = '${v.version}'`));
  assert.ok(v.notes.length >= 1);
});

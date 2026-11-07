'use strict';
/* مطبوعات المعلم بهوية الوزارة (ق15): الغلاف والخطة والتقييم الذاتي وملف الإنجاز وملخص البرنامج والخطابات */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, runInAppContext } = require('./load-app.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const OLD = /#A9852E|#1B3245|#876A25|#F1EEE6|#D8D2C4|Amiri/;

async function warmed(){
  const app = loadApp();
  runInAppContext(app, `gradeReportLogoData = async () => 'data:image/png;base64,MOE'; gradeReportSchoolLogoData = async () => 'data:image/png;base64,SCH'; srEnsureFonts = async () => {};`);
  await runInAppContext(app, 'shahidWarmLogos()');
  return app;
}

test('الغلاف: شعار الوزارة كبير (300px) وبيانات مهرّبة، وبلا ألوان الهوية القديمة', async () => {
  const app = await warmed();
  const h = runInAppContext(app, `moeCoverHtml('ملف <i>الإنجاز</i>', 'فرعي', [['المعلم', '<b>س</b>'], ['فارغ', '']], 'تذييل')`);
  assert.match(h, /<img src="data:image\/png;base64,MOE"[^>]*width:300px/);
  assert.match(h, /data:image\/png;base64,SCH/, 'شعار المدرسة إن وُجد');
  assert.doesNotMatch(h, /<i>|<b>س<\/b>/);
  assert.doesNotMatch(h, /فارغ/, 'الحقل الفارغ لا يظهر');
  assert.doesNotMatch(h, OLD);
  assert.match(h, /Helvetica Neue W23 for SKY/);
});

test('الترويسة: شعار فاسد يُهمَل، وبلا عنوان لا يُرسم عنوان', async () => {
  const app = await warmed();
  runInAppContext(app, `shahidLogos = { moe: 'javascript:alert(1)', school: '' };`);
  const h = runInAppContext(app, `moeHeaderHtml('', '')`);
  assert.doesNotMatch(h, /<img|javascript:/);
  assert.doesNotMatch(h, /font-size:21px/);
});

test('الخطابات: صفحة الخطاب وصفحة الإثبات بالهوية، ونص الخطاب كما هو', async () => {
  const app = await warmed();
  const l = runInAppContext(app, `moeLetterPageHtml('<p>نص الخطاب</p>')`);
  assert.match(l, /<p>نص الخطاب<\/p>/);
  assert.match(l, /data:image\/png;base64,MOE/);
  assert.doesNotMatch(l, /font-family:Arial/);
  const p = runInAppContext(app, `moeProofPageHtml('data:image/png;base64,PRF')`);
  assert.match(p, /صورة إثبات التسليم الموقّع/);
  const src = read('app/app-04-academic-crm.js');
  assert.doesNotMatch(src, /font-family:Arial;font-size:14px|font-family:Arial;padding:30px/, 'لا Arial في صفحات PDF/الطباعة (تصدير Word خارج النطاق)');
  assert.equal((src.match(/await shahidWarmLogos\(\)/g) || []).length, 2, 'PDF والطباعة');
});

test('ملخص البرنامج: ترويسة الوزارة وتقدّم الإنجاز، بلا ألوان قديمة', async () => {
  const app = await warmed();
  const h = runInAppContext(app, `currentUser = { user_metadata: { full_name: 'م' } }; programDetailSections = [];
    buildProgramSummaryHtml({ name: '<b>ب</b>', total_sessions: 1, sessions: [{ session_no: 1, week_label: 'أ', done: true, done_date: 'd' }] })`);
  assert.match(h, /ملخص برنامج نشاط طلابي/);
  assert.match(h, /data:image\/png;base64,MOE/);
  assert.match(h, /مكتمل ✓/);
  assert.doesNotMatch(h, /<b>ب<\/b>/);
  assert.doesNotMatch(h, OLD);
  assert.match(read('app/app-10-programs.js'), /await shahidWarmLogos\(\)/);
});

test('الخطة والتقييم الذاتي وملف الإنجاز: لا ألوان قديمة ولا Amiri في منشئاتها، والغلاف من moeCoverHtml', () => {
  const src = read('app/app-08-admin.js');
  for(const fn of ['function buildPlanHtml', 'async function buildSelfAssessmentHtml', 'async function exportPortfolio']){
    const a = src.indexOf(fn), b = src.indexOf('\n}\n', a);
    assert.doesNotMatch(src.slice(a, b), OLD, fn);
    assert.match(src.slice(a, b), /moeHeaderHtml|moeCoverHtml/, fn);
  }
  assert.match(src, /moeCoverHtml\('ملف الإنجاز الوظيفي'/);
});

test('الملف الجديد في index.html وAPP_SHELL، وأسماء ثوابته لا تتصادم مع غيرها', () => {
  assert.match(read('index.html'), /app-40-moe-docs\.js/);
  assert.match(read('sw.js'), /app-40-moe-docs\.js/);
  const names = [...read('app/app-40-moe-docs.js').matchAll(/^(?:const|function) (\w+)/gm)].map(m => m[1]);
  for(const n of names){
    const hits = fs.readdirSync(path.join(root, 'app')).filter(f => f !== 'app-40-moe-docs.js')
      .filter(f => new RegExp(`^(?:const|let|var|function|async function) ${n}\\b`, 'm').test(read('app/' + f)));
    assert.deepEqual(hits, [], n);
  }
});

'use strict';
/* ============================================================
   حدود تحليل الدرجات بيد المعلم (app-31): النجاح · الحافة · المتفوق · أعلى 3
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const R = (pass, edge, top, fallback) => ({ pass, edge, top, fallback: !!fallback });
/* نسب الطلاب: 40 · 55 · 62 · 75 · 78 (الأعلى 78%) من عمود درجته 100 */
const PCTS = { a: 40, b: 55, c: 62, d: 75, e: 78 };
const rowsOf = () => Object.entries(PCTS).map(([id, p]) => ({ id, name: id, points: p, pct: p, partial: false, recordedMax: 100 }));
const ids = list => [...list].map(r => r.id);

test('validateGradeRules — أعداد صحيحة ضمن الحدود، والمتفوق لا يقلّ عن النجاح + الحافة', async () => {
  const app = loadApp();
  assert.equal(app.validateGradeRules(R(50, 10, 90)), null);
  assert.equal(app.validateGradeRules(R(60, 10, 70)), null, 'مجموع 70 = المتفوق: مسموح');
  assert.match(app.validateGradeRules(R(60, 10, 69)), /حدّ المتفوق/);
  assert.match(app.validateGradeRules(R(0, 10, 90)), /1 إلى 99/);
  assert.match(app.validateGradeRules(R(50, 31, 90)), /1 إلى 30/);
  assert.match(app.validateGradeRules(R(50, 10, 101)), /50 إلى 100/);
  assert.match(app.validateGradeRules(R(50.5, 10, 90)), /رقم صحيح/);
  assert.match(app.validateGradeRules(R('', 10, 90)), /رقم صحيح/);
  assert.match(app.validateGradeRules(null), /غير صالحة/);
});

test('normalizeFeatures — الحدود السليمة تبقى والتالفة من القاعدة تُسقَط', async () => {
  const app = loadApp();
  assert.deepEqual(JSON.parse(JSON.stringify(app.normalizeFeatures({ analysisRules: { pass: '55', edge: 8, top: 85, fallback: true } }).analysisRules)), R(55, 8, 85, true));
  assert.equal(app.normalizeFeatures({ analysisRules: { pass: 90, edge: 10, top: 50 } }).analysisRules, undefined);
  assert.equal(app.normalizeFeatures({ analysisRules: 'x' }).analysisRules, undefined);
  assert.equal(app.normalizeFeatures({}).analysisRules, undefined);
});

test('التحليل يطبّق حدود المعلم: النجاح والحافة والمتفوق', async () => {
  const app = loadApp();
  const def = app.analyzeGradeRows(rowsOf(), 100);
  assert.deepEqual([ids(def.groups.low), ids(def.groups.edge), ids(def.groups.top)], [['a'], ['b'], []], 'الافتراضي: لا أحد ≥ 90');
  runInAppContext(app, `appFeatures = { analysisRules: ${JSON.stringify(R(60, 10, 75))} };`);
  const s = app.analyzeGradeRows(rowsOf(), 100);
  assert.deepEqual(ids(s.groups.low), ['a', 'b'], 'أقل من 60');
  assert.deepEqual(ids(s.groups.edge), ['c'], '60 إلى أقل من 70');
  assert.deepEqual(ids(s.groups.top), ['e', 'd'], 'من 75، الأعلى أولًا');
  assert.equal(s.passed, 3);
});

test('«أعلى 3»: عند خلوّ المتفوقين تُعرض أعلى ثلاثة ممن نجحوا فقط، وإلا فلا', async () => {
  const app = loadApp();
  runInAppContext(app, `appFeatures = { analysisRules: ${JSON.stringify(R(50, 10, 90, true))} };`);
  const s = app.analyzeGradeRows(rowsOf(), 100);
  assert.equal(s.topIsFallback, true);
  assert.deepEqual(ids(s.groups.top), ['e', 'd', 'c'], 'أ (40%) و ب (55%) ليسا ضمنها، ولا يتجاوز العدد 3');
  runInAppContext(app, `appFeatures = { analysisRules: ${JSON.stringify(R(70, 5, 95, true))} };`);
  assert.deepEqual(ids(app.analyzeGradeRows(rowsOf(), 100).groups.top), ['e', 'd'], 'ناجحان فقط: لا يُملأ العدد بمن دون حدّ النجاح');
  runInAppContext(app, `appFeatures = { analysisRules: ${JSON.stringify(R(50, 10, 70, true))} };`);
  const real = app.analyzeGradeRows(rowsOf(), 100);
  assert.equal(real.topIsFallback, false, 'وُجد من بلغ الحدّ: لا بديل');
  assert.deepEqual(ids(real.groups.top), ['e', 'd']);
  runInAppContext(app, `appFeatures = { analysisRules: ${JSON.stringify(R(50, 10, 90, false))} };`);
  assert.equal(app.analyzeGradeRows(rowsOf(), 100).groups.top.length, 0);
});

function opened(extra){
  const app = loadApp({ currentUser: { id: 'u1' } });
  const cols = [{ id: 'k', section_id: 'S', category: 'performance', name: 'أداء', max_score: 100 > 40 ? 40 : 40, kind: 'manual' }];
  const scores = Object.entries(PCTS).map(([id, p]) => ({ column_id: 'k', student_id: id, score: p * 40 / 100 }));
  runInAppContext(app, `
    crmStudents = ${JSON.stringify(Object.keys(PCTS).map(id => ({ id, full_name: id, section_id: 'S' })))};
    crmSections = [{ id: 'S', grade_level_id: 'G' }]; crmSectionById = id => crmSections.find(s => s.id === id) || null;
    crmSectionLabel = () => 'ثاني/٦'; appGradeCaps = () => ({ performance: 40, tests: 20 }); appToolOn = () => false;
    crmGrades = { sectionId: 'S', year: 'Y', semester: 1, columns: ${JSON.stringify(cols)}, allColumns: ${JSON.stringify(cols)}, hiddenColumns: [], scores: ${JSON.stringify(scores)} };
    window.__modal = []; showInfoModal = h => window.__modal.push(h); openCrmGradeAnalysis(); ${extra || ''}`);
  return app;
}

test('الواجهة: ترس بجانب «من هم؟»، والتسمية تتبع الحدّ، واسم «الأعلى درجات» عند البديل', async () => {
  const app = opened(`window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);
    appFeatures = { analysisRules: ${JSON.stringify(R(60, 10, 90, true))} }; window.__c = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__d, /<span class="crm-ga-sec">من هم؟<\/span><button type="button" class="crm-ic-btn" aria-label="حدود التحليل"[^>]*onclick="openCrmGaRulesEditor\(\)">/);
  assert.match(app.__d, /<span>تحت النصف<\/span>|>تحت النصف</);
  assert.match(app.__c, />تحت 60%</, 'الحدّ 60: لم تعد «النصف»');
  assert.match(app.__c, /<span>الأعلى درجات<\/span><b>3<\/b>/);
  assert.doesNotMatch(app.__c, /<span>متفوقون<\/span>/);
});

test('المحرّر: − و+ يتقيّدان بالحدود، والأرقام الجاهزة تضبط المتفوق، والافتراضي يرجع', async () => {
  const app = opened(`openCrmGaRulesEditor(); const e = crmGradeAnalysis.rulesEdit;
    crmGaRuleStep('pass', -100); window.__min = e.draft.pass; crmGaRuleStep('pass', 500); window.__max = e.draft.pass;
    crmGaRulePreset(95); window.__top = e.draft.top; crmGaRuleSet('edge', '12'); window.__edge = e.draft.edge;
    crmGaRulesReset(); window.__reset = JSON.stringify(e.draft); window.__h = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.equal(app.__min, 1);
  assert.equal(app.__max, 99);
  assert.equal(app.__top, 95);
  assert.equal(app.__edge, 12);
  assert.equal(app.__reset, JSON.stringify(R(50, 10, 90, false)));
  assert.match(app.__h, /حدود التحليل/);
  assert.match(app.__h, /id="crmGaRule_top"[^>]*value="90"/);
});

test('الحفظ: خطأ التحقق يظهر ولا يُحفظ شيء، والنجاح يغلق المحرّر ويحدّث الفئات', async () => {
  const app = opened(`
    window.__n = 0; persistGradeRules = async () => { window.__n++; return null; }; showToast = () => {};
    openCrmGaRulesEditor(); crmGaRuleSet('top', 55); window.__p1 = saveCrmGaRules();`);
  await app.__p1;
  assert.equal(app.__n, 0);
  runInAppContext(app, `window.__err = crmGradeAnalysis.rulesEdit.error;
    crmGaRuleSet('top', 75); window.__p2 = saveCrmGaRules();`);
  await app.__p2;
  assert.match(app.__err, /حدّ المتفوق/);
  assert.equal(app.__n, 1);
  assert.equal(runInAppContext(app, 'crmGradeAnalysis.rulesEdit'), null);
});

test('persistGradeRules — الافتراضي لا يُخزَّن، والمخصّص يُحفظ، وفشل الحفظ يُرجع رسالة', async () => {
  const app = opened(`saveAppFeatures = async () => { appFeaturesSaved = appFeatures; };`);
  runInAppContext(app, `(async () => {
    window.__r1 = await persistGradeRules(${JSON.stringify(R(55, 8, 80, true))}); window.__saved = JSON.stringify(appFeatures.analysisRules);
    window.__r2 = await persistGradeRules(${JSON.stringify(R(50, 10, 90, false))}); window.__after = appFeatures.analysisRules;
    saveAppFeatures = async () => {}; window.__r3 = await persistGradeRules(${JSON.stringify(R(55, 8, 80, true))}); })()`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(app.__r1, null);
  assert.equal(app.__saved, JSON.stringify(R(55, 8, 80, true)));
  assert.equal(app.__r2, null);
  assert.equal(app.__after, undefined);
  assert.equal(app.__r3, 'تعذّر حفظ الحدود');
});

test('الملف الجديد في index.html وAPP_SHELL، والإصدارات متطابقة', async () => {
  const root = path.join(__dirname, '..');
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app-31-grade-rules\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-31-grade-rules\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), new RegExp(`APP_VERSION_SW = '${v}'`));
  assert.match(fs.readFileSync(path.join(root, 'app/app-26-update-check.js'), 'utf8'), new RegExp(`APP_VERSION = '${v}'`));
});

'use strict';
/* تقرير أهداف الأداء الوظيفي (خطة الأداء) — REPORTS.md ق23:
   صفحة ملخص ثم تفاصيل كل هدف بجدول بتسميات جانبية؛ بعرض الطباعة الفعلي فلا يُصغَّر الخط. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, runInAppContext } = require('./load-app.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const goal = (name, extra) => Object.assign({ template_name: name, target_level: 5, target_count: 2,
  target_performance: 'أداء ' + name, success_indicators: ['مؤشر ' + name], recommended_evidence: ['شاهد ' + name], action_steps: ['إجراء ' + name] }, extra || {});

async function build(goalsByKey, asDraft, elements, extraJs){
  const app = loadApp();
  runInAppContext(app, `gradeReportLogoData = async () => 'data:image/png;base64,MOE'; gradeReportSchoolLogoData = async () => ''; srEnsureFonts = async () => {};`);
  await runInAppContext(app, 'shahidWarmLogos()');
  return runInAppContext(app, `
    const G = ${JSON.stringify({ goalsByKey, elements: elements || [1, 2, 3].map(n => ({ key: 'e' + n, label: 'العنصر ' + n + ' (10%)' })) })};
    getElementsOrder = () => G.elements; getElementWeight = () => 10; getProfileSubject = () => 'اللغة'; getCycleYear = () => '2026/2027';
    myPlanGoals = G.goalsByKey; planShahidCounts = {}; goalShahidCounts = {}; mySelfAssessment = {};
    ${extraJs || ''}
    document.getElementById = id => ({ value: '' });
    buildPlanHtml(${asDraft === undefined ? '' : asDraft})`);
}

test('planGoalHasText: النص وحده يُعدّ تفصيلًا، والمستوى وعدد الشواهد لا', async () => {
  const app = loadApp();
  assert.equal(app.planGoalHasText({ target_level: 5, target_count: 3 }), false);
  assert.equal(app.planGoalHasText({ success_indicators: ['  ', ''] }), false);
  assert.equal(app.planGoalHasText({ action_steps: ['س'] }), true);
  assert.equal(app.planGoalHasText({ target_performance: ' أداء ' }), true);
  assert.equal(app.planGoalHasText(null), false);
});

test('planElementStats: عدد الأهداف وأعلى مستوى ومجموع الشواهد', async () => {
  const app = loadApp();
  assert.deepEqual(JSON.parse(JSON.stringify(app.planElementStats([{ target_level: 3, target_count: 2 }, { target_level: 5, target_count: 1 }]))), { goals: 2, level: 5, evidence: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(app.planElementStats([]))), { goals: 0, level: null, evidence: 0 });
});

test('لا أهداف إطلاقًا: لا تقرير', async () => {
  assert.equal(await build({}), null);
});

test('الهيكل: صفحة ملخص بقطع صفحة ثم التفاصيل، بعرض الطباعة 700px (لا تصغير)', async () => {
  const h = await build({ e1: [goal('أ')], e2: [goal('ب')] });
  assert.match(h, /width:700px/);
  assert.match(h, /break-after:page/);
  assert.match(h, /عناصر لها أهداف/);
  assert.match(h, /أعلى مستوى مستهدف/);
  assert.ok(h.indexOf('عناصر لها أهداف') < h.indexOf('الأداء المستهدف'), 'الملخص قبل التفاصيل');
  assert.match(h, /data:image\/png;base64,MOE/, 'ترويسة الوزارة');
  assert.doesNotMatch(h, /width:794px/);
});

test('لا خط أصغر من 11px (الخطة كانت 9.5–10.5px وتُصغَّر بـ0.88)', async () => {
  const h = await build({ e1: [goal('أ'), goal('ب')], e2: [goal('ج')] });
  const sizes = [...h.matchAll(/font-size:([\d.]+)px/g)].map(m => parseFloat(m[1]));
  assert.ok(sizes.length > 10);
  assert.ok(Math.min(...sizes) >= 11, 'أصغر خط ' + Math.min(...sizes));
});

test('هدف بلا نصوص: لا صفوف فارغة ولا «—»، وعنصره يُختصر في سطر واحد ويبقى رقمه بالملخص', async () => {
  const h = await build({ e1: [goal('أ')], e2: [goal('ب')], e3: [{ target_level: 5, target_count: 3 }] });
  assert.doesNotMatch(h, />—<\/div>/, 'لا خانة «—» فارغة في التفاصيل');
  assert.match(h, /عناصر لم تُكتب تفاصيل أهدافها بعد: <b>3<\/b> العنصر 3/);
  assert.equal((h.match(/الأداء المستهدف/g) || []).length, 2, 'هدفان بنصوص فقط');
  assert.match(h, /مثالي \(5\)/, 'مستوى العنصر 3 بالملخص');
});

test('صف التفصيل الفارغ يُحذف (هدف بمؤشرات فقط)', async () => {
  const h = await build({ e1: [{ template_name: 'هـ', success_indicators: ['م'] }] });
  assert.match(h, /مؤشرات النجاح/);
  assert.doesNotMatch(h, /الأداء المستهدف|شواهد التوثيق|الإجراء التنفيذي/);
});

test('شارة «تابع العنصر N» على الهدف الثاني فصاعدًا فقط', async () => {
  const h = await build({ e1: [goal('أ'), goal('ب'), goal('ج')], e2: [goal('د')] });
  assert.equal((h.match(/تابع العنصر 1/g) || []).length, 2);
  assert.doesNotMatch(h, /تابع العنصر 2/);
});

test('آخر هدف والتوقيعان في كتلة واحدة لا تنفصل', async () => {
  const h = await build({ e1: [goal('أ'), goal('خاتمة')] });
  const sign = h.indexOf('توقيع المعلم');
  const blockStart = h.lastIndexOf('<div style="break-inside:avoid;page-break-inside:avoid;">', sign);
  assert.ok(blockStart > 0, 'كتلة لا تنقسم تسبق التوقيع');
  const between = h.slice(blockStart, sign);
  assert.match(between, /أداء خاتمة/, 'آخر هدف ضمن الكتلة نفسها');
  assert.doesNotMatch(between, /أداء أ</, 'ولا غيره');
});

test('XSS: نصوص المعلم تُهرَّب في كل مواضعها', async () => {
  const bad = '<img src=x onerror=alert(1)>';
  const h = await build({ e1: [goal(bad, { target_performance: bad, success_indicators: [bad], recommended_evidence: [bad], action_steps: [bad] })] },
    true, [{ key: 'e1', label: bad + ' (10%)' }]);
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /&lt;img src=x/);
});

test('المسودة: عنوان وتنويه فقط عند asDraft (الافتراضي)، وملف الإنجاز بلا مسودة', async () => {
  const g = { e1: [goal('أ')] };
  const draft = await build(g);
  assert.match(draft, /مسودة أهداف الأداء الوظيفي/);
  assert.match(draft, /مسودة نقاش/);
  const final = await build(g, false);
  assert.doesNotMatch(final, /مسودة/);
  assert.match(final, /أهداف الأداء الوظيفي/);
});

test('من يطبع الخطة يمرّر designWidth: PLAN_DESIGN_W (وإلا عاد التصغير 0.88)', () => {
  const src = read('app/app-08-admin.js');
  assert.match(src, /printPages\(\[\{ html, fit: 'width', designWidth: PLAN_DESIGN_W \}\], printFileTitle\('خطة-الأداء'\)\)/);
  assert.match(src, /addHtmlPageMultiPage\(planDetailHtml, PLAN_DESIGN_W\)/);
  assert.match(src, /const PLAN_DESIGN_W = 700/);
  const w = Number(/const PRINT_PAGE_W = (\d+)/.exec(read('app/app-35-print-pages.js'))[1]);
  assert.equal(w, 700, 'عرض التصميم يساوي عرض الطباعة');
});

test('المنجز: «الموثّق / المستهدف» بالملخص وبشارة الهدف، ومن شواهد السنة المحمّلة', async () => {
  const h = await build({ e1: [goal('أ', { id: 11, target_count: 6 })], e2: [goal('ب', { id: 12, target_count: 2 })] }, false, undefined,
    `planShahidCounts = { e1: 3, e2: 1 }; goalShahidCounts = { 11: 3, 12: 1 };`);
  assert.match(h, /4 \/ 8/, 'بطاقة المجموع الموثّق من المستهدف');
  assert.match(h, />3 \/ 6</, 'عنصر 1 بالجدول');
  assert.match(h, />1 \/ 2</, 'عنصر 2 بالجدول');
  assert.match(h, /شواهد 3 \/ 6/, 'شارة الهدف');
  assert.match(h, /شواهد موثّقة من المستهدف/);
});

test('لا «0 / ن» قبل أي توثيق (م9): المستهدف وحده', async () => {
  const h = await build({ e1: [goal('أ', { id: 11, target_count: 6 })] });
  assert.doesNotMatch(h, /0 \/ 6/);
  assert.match(h, /شاهدًا مستهدفًا/);
  assert.match(h, /شواهد 6</);
});

test('التقييم الذاتي: العمود وسلم التقدير يظهران فقط إن قيّم المعلم، والقيمة غير المعروفة تُهمَل', async () => {
  const none = await build({ e1: [goal('أ')] });
  assert.doesNotMatch(none, /التقييم الذاتي|سلم التقدير/);
  const some = await build({ e1: [goal('أ')], e2: [goal('ب')] }, false, undefined, `mySelfAssessment = { e1: { self_level: 4 }, e2: { self_level: 99 } };`);
  assert.match(some, /التقييم الذاتي/);
  assert.match(some, /فاق التوقعات \(4\)/);
  assert.match(some, /سلم التقدير/);
  assert.doesNotMatch(some, /99|undefined/);
});

test('ملف الإنجاز بلا صفحة ملخص قديمة، وprintPlan يحمّل التقييم الذاتي', () => {
  const src = read('app/app-08-admin.js');
  assert.doesNotMatch(src, /ملخص الخطة والتقييم الذاتي/);
  const a = src.indexOf('async function printPlan'), b = src.indexOf('\n}\n', a);
  assert.match(src.slice(a, b), /await loadSelfAssessment\(\)/);
});

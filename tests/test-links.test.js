'use strict';
/* ============================================================
   ربط الاختبارات و«ماذا يقيس؟» (app-37، ق4، م2): المقارنة بالربط أو بتطابق «يقيس»، التخزين، الواجهة، إعادة التسمية
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));
const T = (name, measures) => ({ name, measures: measures || null });

test('normalizeTestLinks: يُنقّى ما يُقرأ من القاعدة، ويُسقَط التالف، وتُقصّ الحدود', () => {
  const app = loadApp();
  assert.equal(app.normalizeTestLinks(null), null);
  assert.equal(app.normalizeTestLinks([]), null);
  assert.equal(app.normalizeTestLinks({ bad: [['أ', 'ب']] }), null, 'مفتاح فصل غير صالح');
  assert.equal(app.normalizeTestLinks({ '1448|1': [['أ']] }), null, 'مجموعة باسم واحد لا تكفي');
  const ok = J(app.normalizeTestLinks({ '1448|1': [['  اختبار   أول ', 'ثاني', 'ثاني', 5, 'س'.repeat(31)]] }));
  assert.deepEqual(ok, { '1448|1': [['اختبار أول', 'ثاني']] }, 'تطبيع ومنع التكرار ورفض غير النص وأسماء أطول من 30');
  const big = J(app.normalizeTestLinks({ '1448|1': [['أ1', 'أ2', 'أ3', 'أ4', 'أ5', 'أ6'], ['ب1', 'ب2'], ['ج1', 'ج2'], ['د1', 'د2']] }));
  assert.equal(big['1448|1'].length, 3, '3 مجموعات كحدّ أقصى');
  assert.equal(big['1448|1'][0].length, 5, '5 أسماء كحدّ أقصى');
  assert.equal(J(app.normalizeTestLinks({ '1448|1': [['أ', 'ب'], ['ب', 'ج']] }))['1448|1'].length, 1, 'الاسم لا يقع في مجموعتين (الثانية تسقط لبقاء اسم واحد)');
});

test('tlLink: ضمّ المجموعات، وأخطاء الاسم الواحد والحدود', () => {
  const app = loadApp();
  assert.deepEqual(J(app.tlLink([], 'أ', 'ب').groups), [['أ', 'ب']]);
  assert.deepEqual(J(app.tlLink([['أ', 'ب']], 'ج', 'أ').groups), [['أ', 'ب', 'ج']], 'ضمّ لمجموعة قائمة');
  assert.deepEqual(J(app.tlLink([['أ', 'ب'], ['ج', 'د']], 'ب', 'ج').groups), [['أ', 'ب', 'ج', 'د']].map(g => g), 'دمج مجموعتين');
  assert.equal(app.tlLink([], 'أ', 'أ').error, 'اختر اختبارًا آخر');
  assert.match(app.tlLink([], 'أ', 'س'.repeat(31)).error, /أطول من 30/);
  const three = [['1', '2'], ['3', '4'], ['5', '6']];
  const r = app.tlLink(three, '7', '8');
  assert.match(r.error, /3 مجموعات/);
  assert.deepEqual(J(r.groups), three, 'لا يتغيّر شيء عند الخطأ');
  assert.equal(app.tlLink([['أ', 'ب']], 'أ', 'ب').error, null, 'مربوطان أصلًا');
});

test('tlUnlink وtlRename وtlPartnerOf', () => {
  const app = loadApp();
  assert.deepEqual(J(app.tlUnlink([['أ', 'ب', 'ج']], 'ب')), [['أ', 'ج']]);
  assert.deepEqual(J(app.tlUnlink([['أ', 'ب']], 'ب')), [], 'تُحذف المجموعة إذا بقي اسم واحد');
  const r = app.tlRename([['أ', 'ب']], 'أ', 'أ جديد');
  assert.equal(r.changed, true);
  assert.deepEqual(J(r.groups), [['أ', 'ب', 'أ جديد']], 'الجديد يُضاف والقديم يبقى (شعب أخرى)');
  assert.equal(app.tlRename([['أ', 'ب']], 'س', 'ص').changed, false, 'اسم غير مربوط');
  assert.equal(app.tlRename([['أ', 'ب']], 'أ', 'ب').changed, false, 'الجديد موجود');
  assert.equal(app.tlRename([['1', '2', '3', '4', '5']], '1', 'جديد').changed, false, 'مجموعة ممتلئة');
  assert.equal(app.tlPartnerOf([['أ', 'ب', 'ج']], 'أ', ['ج', 'س']), 'ج', 'من الموجودين بالشعبة فقط');
  assert.equal(app.tlPartnerOf([['أ', 'ب']], 'أ', ['س']), '');
  assert.equal(app.tlPartnerOf([], 'أ', ['ب']), '');
});

test('tlComparableClasses: بالربط أو بتطابق «يقيس» أو بهما، والسبب يُذكر', () => {
  const app = loadApp();
  const cls = (tests, groups) => J(app.tlComparableClasses(tests, groups)).map(c => ({ names: c.members.map(m => m.name), reason: c.reason, label: c.label }));
  assert.deepEqual(cls([T('أ'), T('ب')], []), [], 'بلا ربط ولا يقيس: لا مقارنة (ق3)');
  assert.deepEqual(cls([T('أ'), T('ب')], [['أ', 'ب']]), [{ names: ['أ', 'ب'], reason: 'link', label: 'ربطهما المعلم' }]);
  assert.deepEqual(cls([T('أ', 'القراءة'), T('ب', ' القراءة')], []), [{ names: ['أ', 'ب'], reason: 'measures', label: 'كلاهما يقيس: القراءة' }]);
  assert.deepEqual(cls([T('أ', 'القراءة'), T('ب', 'الكتابة')], []), [], 'مقيسان مختلفان');
  assert.deepEqual(cls([T('أ', ''), T('ب', '')], []), [], 'الفارغ لا يطابق الفارغ');
  const three = cls([T('أ', 'القراءة'), T('ب'), T('ج', 'القراءة')], []);
  assert.equal(three[0].label, 'كلاهما يقيس: القراءة', 'اثنان فقط في الفئة (ب خارجها)');
  assert.deepEqual(three[0].names, ['أ', 'ج'], 'بترتيب الكشف');
  const chain = cls([T('أ'), T('ب'), T('ج', 'القراءة'), T('د', 'القراءة')], [['أ', 'ب']]);
  assert.equal(chain.length, 2, 'فئتان منفصلتان');
  const merged = cls([T('أ', 'القراءة'), T('ب'), T('ج', 'القراءة')], [['ب', 'ج']]);
  assert.equal(merged.length, 1, 'ضمّ متعدٍّ: أ مع ج بـ«يقيس» وج مع ب بالربط');
  assert.equal(merged[0].reason, 'link');
  assert.equal(merged[0].label, 'ربطها المعلم');
  assert.equal(cls([T('أ'), T('ب'), T('ج')], [['أ', 'ب', 'ج']])[0].label, 'ربطها المعلم');
  assert.deepEqual(cls([T('أ'), T('ب')], [['س', 'ص']]), [], 'ربط لأسماء غير موجودة في كشف الطالب');
});

test('أزرار «يقيس» السريعة بحسب المادة: 5–6 فقط، والمجهولة قائمة عامة', () => {
  const app = loadApp();
  assert.deepEqual(J(app.measuresPresetsFor('اللغة الإنجليزية')), ['القراءة', 'الكتابة', 'الاستماع', 'التحدث', 'المفردات', 'القواعد']);
  assert.deepEqual(J(app.measuresPresetsFor('English')), ['القراءة', 'الكتابة', 'الاستماع', 'التحدث', 'المفردات', 'القواعد']);
  assert.ok(app.measuresPresetsFor('اللغة العربية').includes('الإملاء'));
  assert.ok(app.measuresPresetsFor('الرياضيات').includes('الجبر'));
  assert.ok(app.measuresPresetsFor('الكيمياء').includes('المهارات العملية'));
  assert.ok(app.measuresPresetsFor('الدراسات الإسلامية').includes('التلاوة'));
  assert.deepEqual(J(app.measuresPresetsFor('')), ['الحفظ', 'الفهم', 'التطبيق', 'حل المسائل', 'المهارات']);
  assert.deepEqual(J(app.measuresPresetsFor('حاسب')), ['الحفظ', 'الفهم', 'التطبيق', 'حل المسائل', 'المهارات']);
  for(const s of ['اللغة الإنجليزية', 'اللغة العربية', 'الرياضيات', 'الكيمياء', 'الدراسات الإسلامية', 'x']){
    const n = app.measuresPresetsFor(s).length;
    assert.ok(n >= 4 && n <= 6, s + ' قائمة قصيرة (م8)');
  }
});

test('الحجم: أسوأ حالة لـtestLinks تبقى صغيرة بالنسبة لقيد features (أقل من 4000 بايت)', () => {
  const app = loadApp();
  const names = i => Array.from({ length: 5 }, (_, k) => 'ع'.repeat(30 - 1) + String(i * 5 + k).slice(-1));
  const raw = { '1448-1449|1': [names(0), names(1), names(2)].map(g => g.map((n, k) => n.slice(0, 29) + k)) };
  const cleaned = app.normalizeTestLinks(J(raw));
  const bytes = Buffer.byteLength(JSON.stringify(cleaned), 'utf8');
  assert.ok(bytes < 1400, `أسوأ حالة ${bytes} بايت`);
});

/* ============ الواجهة ============ */
test('أزرار «يقيس» تملأ الحقل نفسه وتُهرَّب، وتتبع مادة المعلم', () => {
  const app = loadApp();
  runInAppContext(app, `getProfileSubject = () => 'اللغة الإنجليزية'; window.__c = tlMeasureChipsHtml();
    window.__v = ''; const inp = { value: '' }; const orig = document.getElementById.bind(document);
    document.getElementById = id => id === 'crmGradeColMeasures' ? inp : orig(id);
    tlPickMeasure({ textContent: 'الاستماع', parentElement: 1 }); window.__v = inp.value;`);
  assert.match(app.__c, />القراءة</);
  assert.match(app.__c, /tlPickMeasure\(this\)/);
  assert.equal(app.__v, 'الاستماع');
});

test('حقل «قارنه مع»: لا يظهر بلا اختبارات أخرى، ويختار الشريك، ويهرّب الأسماء', () => {
  const app = loadApp();
  const cols = [{ id: '1', category: 'tests', name: 'الأول' }, { id: '2', category: 'tests', name: 'ثاني <b>' }, { id: '3', category: 'performance', name: 'مشاركة' }];
  runInAppContext(app, `window.__none = tlLinkFieldHtml(${JSON.stringify([cols[0], cols[2]])}, ${JSON.stringify(cols[0])}, []);
    window.__add = tlLinkFieldHtml(${JSON.stringify(cols)}, null, []);
    window.__edit = tlLinkFieldHtml(${JSON.stringify(cols)}, ${JSON.stringify(cols[0])}, [['الأول', 'ثاني <b>']]);`);
  assert.equal(app.__none, '', 'لا اختبار آخر');
  assert.match(app.__add, /بلا مقارنة/);
  assert.doesNotMatch(app.__add, /مشاركة/, 'الاختبارات فقط');
  assert.doesNotMatch(app.__add, /<b>/);
  assert.match(app.__add, /ثاني &lt;b&gt;/);
  assert.match(app.__add, /data-had=""/);
  assert.match(app.__edit, /selected/);
  assert.match(app.__edit, /data-had="1"/);
  assert.doesNotMatch(app.__edit, /<option value="الأول"/, 'لا يعرض الاختبار نفسه');
});

/* ============ الحفظ والتخزين ============ */
function withSettings(extra){
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `
    appFeatures = {}; appFeaturesSaved = {}; window.__toasts = []; window.__saves = 0;
    showToast = (m, k) => window.__toasts.push([m, k]);
    saveAppFeatures = async () => { window.__saves++; appFeaturesSaved = JSON.parse(JSON.stringify(appFeatures)); };
    ${extra || ''}`);
  return app;
}
const TERM = '{ year: "1448-1449", semester: 1 }';

test('normalizeFeatures يحفظ testLinks ويُسقط التالف', () => {
  const app = loadApp();
  const out = J(runInAppContext(app, `normalizeFeatures({ testLinks: { '1448-1449|1': [['أ', 'ب']], bad: [['x', 'y']] } })`));
  assert.deepEqual(out.testLinks, { '1448-1449|1': [['أ', 'ب']] });
  assert.equal(runInAppContext(app, `normalizeFeatures({ testLinks: 5 }).testLinks`), undefined);
});

test('persistTestLinks: يحفظ ويتحقق، ولا يمسّ فصولًا أخرى، وفشل الحفظ يُرجع نصًّا', async () => {
  const app = withSettings(`appFeatures = { testLinks: { '1447-1448|2': [['س', 'ص']] } };`);
  runInAppContext(app, `window.__p = persistTestLinks(${TERM}, [['أ', 'ب']]);`);
  assert.equal(await app.__p, null);
  assert.deepEqual(J(runInAppContext(app, 'appFeatures.testLinks')), { '1447-1448|2': [['س', 'ص']], '1448-1449|1': [['أ', 'ب']] });
  runInAppContext(app, `window.__p = persistTestLinks(${TERM}, []);`);
  await app.__p;
  assert.deepEqual(J(runInAppContext(app, 'appFeatures.testLinks')), { '1447-1448|2': [['س', 'ص']] }, 'حذف مجموعات الفصل فقط');
  runInAppContext(app, `saveAppFeatures = async () => {}; window.__p = persistTestLinks(${TERM}, [['أ', 'ب']]);`);
  assert.equal(await app.__p, 'تعذّر حفظ الربط');
});

function form(app, link, had){
  runInAppContext(app, `
    const sel = { value: ${JSON.stringify(link || '')}, dataset: { had: ${JSON.stringify(had ? '1' : '')} } };
    const orig = document.getElementById.bind(document);
    document.getElementById = id => id === 'crmGradeColLink' ? sel : orig(id);`);
}

test('tlApplyFromForm: اختيار «قارنه مع» يربط ويُنبّه، وبلا تغيير لا يحفظ', async () => {
  const app = withSettings();
  form(app, 'الأول');
  runInAppContext(app, `window.__p = tlApplyFromForm(${TERM}, null, 'الثاني');`);
  await app.__p;
  assert.deepEqual(J(runInAppContext(app, 'appFeatures.testLinks["1448-1449|1"]')), [['الثاني', 'الأول']]);
  assert.match(app.__toasts[0][0], /رُبط الاختبار بـ«الأول»/);
  assert.equal(app.__saves, 1);
  runInAppContext(app, `window.__p = tlApplyFromForm(${TERM}, 'الثاني', 'الثاني');`);
  await app.__p;
  assert.equal(app.__saves, 1, 'لا تغيير = لا حفظ');
});

test('tlApplyFromForm: إعادة التسمية تُحدّث الربط مع تنبيه للمعلم، وإلغاء المقارنة يفكّه', async () => {
  const app = withSettings(`appFeatures = { testLinks: { '1448-1449|1': [['الأول', 'الثاني']] } };`);
  form(app, 'الأول', true);
  runInAppContext(app, `window.__p = tlApplyFromForm(${TERM}, 'الثاني', 'الثاني (جديد)');`);
  await app.__p;
  assert.deepEqual(J(runInAppContext(app, 'appFeatures.testLinks["1448-1449|1"]')), [['الأول', 'الثاني', 'الثاني (جديد)']]);
  assert.ok(app.__toasts.some(t => /حُدّث ربط الاختبار بالاسم الجديد/.test(t[0])), 'تنبيه للمعلم');
  const off = withSettings(`appFeatures = { testLinks: { '1448-1449|1': [['الأول', 'الثاني']] } };`);
  form(off, '', true);
  runInAppContext(off, `window.__p = tlApplyFromForm(${TERM}, 'الثاني', 'الثاني');`);
  await off.__p;
  assert.equal(runInAppContext(off, 'appFeatures.testLinks'), undefined, 'فُكّ الربط وحُذفت المجموعة');
  assert.match(off.__toasts[0][0], /أُلغيت مقارنة الاختبار/);
});

test('tlApplyFromForm: خطأ الحدود/الحفظ تنبيه فقط ولا يرمي (العمود حُفظ أصلًا)', async () => {
  const app = withSettings(`appFeatures = { testLinks: { '1448-1449|1': [['1', '2'], ['3', '4'], ['5', '6']] } };`);
  form(app, '7');
  runInAppContext(app, `window.__p = tlApplyFromForm(${TERM}, null, '8');`);
  await app.__p;
  assert.match(app.__toasts[0][0], /3 مجموعات/);
  assert.equal(app.__toasts[0][1], 'error');
  const fail = withSettings(`saveAppFeatures = async () => { throw new Error('شبكة'); };`);
  form(fail, 'أ');
  runInAppContext(fail, `window.__p = tlApplyFromForm(${TERM}, null, 'ب');`);
  await fail.__p;
  assert.match(fail.__toasts[0][0], /تعذّر حفظ الربط/);
});

/* ============ دمج بالنموذج والتقرير ============ */
test('نموذج الاختبار (إضافة وتعديل) يحمل أزرار «يقيس» و«قارنه مع»، وحفظه يطبّق الربط قبل إغلاق النموذج', () => {
  const g = read('app/app-17-grades.js');
  assert.equal((g.match(/tlMeasureChipsHtml\(\)/g) || []).length, 2, 'نموذج الإضافة والتعديل');
  assert.equal((g.match(/tlLinkFieldHtml\(/g) || []).length, 2);
  const save = g.slice(g.indexOf('async function saveCrmGradeColumn'), g.indexOf('async function deleteCrmGradeColumn'));
  assert.ok(save.indexOf('tlApplyFromForm(') > save.indexOf('trash') || save.indexOf('tlApplyFromForm(') > 0);
  assert.ok(save.indexOf('tlApplyFromForm(') < save.indexOf('closeCrmModal();'), 'قبل إغلاق النموذج لقراءة اختياره');
  assert.match(save, /d\.category === 'tests'/, 'للاختبارات فقط');
});

test('الملف مسجَّل بـindex.html وAPP_SHELL، وتخزين الربط بلا SQL', () => {
  assert.match(read('index.html'), /app\/app-37-test-links\.js/);
  assert.match(read('sw.js'), /\.\/app\/app-37-test-links\.js/);
  assert.match(read('app/app-22-customize.js'), /normalizeTestLinks\(raw && raw\.testLinks\)/);
  assert.ok(!/testLinks|compare_group/.test(read('sql-updates-run-in-supabase.sql')), 'لا تعديل في قاعدة البيانات');
});

test('التقرير: التحليلي يذكر «يقيس» وسبب المقارنة، ونسخة الدرجات لا تذكر «يقيس»', () => {
  const app = loadApp();
  const R = { pass: 50, edge: 10, top: 90, severe: 30 };
  const rows = [
    { id: 't1', name: 'قراءة 1', label: 'قراءة 1', score: 4, max: 10, pct: 40, row: 'item', kind: 'manual', domain: 'tahsili', category: 'tests', live: false, classPct: null, measures: 'القراءة' },
    { id: 't2', name: 'قراءة 2', label: 'قراءة 2', score: 9, max: 10, pct: 90, row: 'item', kind: 'manual', domain: 'tahsili', category: 'tests', live: false, classPct: null, measures: 'القراءة' }
  ];
  const out = J(runInAppContext(app, `(() => {
    const rows = ${JSON.stringify(rows)}; const rules = ${JSON.stringify(R)};
    const dx = srDiagnose({ rows, rules, homework: null, lessonsHeld: 0, overall: { pct: 65, incomplete: false }, testGroups: [] });
    const base = { student: { name: 'ط', label: 'ص' }, term: { year: '1448', semester: 1 }, date: 'd', prefs: {}, logo: '', schoolLogo: '', to: null, rules, rows,
      overall: { pts: 13, max: 20, pct: 65, incomplete: false, classPts: null }, missing: [], dx, attendance: null, incidents: [], positives: [], followups: [], tasks: [], cases: [] };
    return { a: buildStudentReportHtml2(Object.assign({ version: 'analytical' }, base)), g: buildStudentReportHtml2(Object.assign({ version: 'grades' }, base)) };
  })()`));
  assert.match(out.a, /يقيس: القراءة/);
  /* صف التقدّم في جدول التشخيص: سبب المقارنة في خانة البند، والحكم تحسّن، والدليل القياسان */
  assert.match(out.a, /<td>التقدّم<\/td><td><b>كلاهما يقيس: القراءة<\/b><\/td><td class="n"><span class="chip j">تحسّن<\/span><\/td><td>من «قراءة 1» <bdi dir="ltr">40%<\/bdi> إلى «قراءة 2» <bdi dir="ltr">90%<\/bdi><\/td>/);
  assert.doesNotMatch(out.g, /يقيس/);
});

test('الضعف المستمر يقوم على الفترات وعلى المربوط/المتطابق فقط', () => {
  const app = loadApp();
  const R = { pass: 50, edge: 10, top: 90, severe: 30 };
  const P = (k, score) => ({ id: 'x', name: 'مهمة', label: 'مهمة — ' + k, score, max: 10, pct: score * 10, row: 'period', kind: 'task', domain: 'tahsili', category: 'performance', live: false, classPct: null });
  const sub = { id: 'x', name: 'مهمة', label: 'مهمة — المحسوب', score: 3, max: 10, pct: 30, row: 'sub', kind: 'task', domain: 'tahsili', category: 'performance', live: false, classPct: null };
  const other = { id: 'y', name: 'قصير', label: 'قصير', score: 9, max: 10, pct: 90, row: 'item', kind: 'manual', domain: 'tahsili', category: 'tests', live: false, classPct: null };
  const d = J(app.srDiagnose({ rows: [P('الفترة الأولى', 3), P('الفترة الثانية', 4), sub, other], rules: R, homework: null, lessonsHeld: 5, overall: { pct: 60, incomplete: false }, testGroups: [] }));
  assert.equal(d.tahsili.persistent, true, 'فترتان متتاليتان منخفضتان للمكوّن نفسه');
  assert.match(d.tahsili.persistentInfo.label, /فترتين/);
  assert.ok(d.recommendations.some(r => /مستمر/.test(r.diagnosis)));
  const ok = J(app.srDiagnose({ rows: [P('الفترة الأولى', 3), P('الفترة الثانية', 8), sub, other], rules: R, homework: null, lessonsHeld: 5, overall: { pct: 60, incomplete: false }, testGroups: [] }));
  assert.equal(ok.tahsili.persistent, false);
});

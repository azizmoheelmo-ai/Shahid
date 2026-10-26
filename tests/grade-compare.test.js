'use strict';
/* ============================================================
   تحليل الدرجات — النسخة الثانية (app-30):
   تقديرات الحروف (يعدّلها المعلم) · أين الصعوبة؟ · شعب الصف · الفصل السابق
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext, makeFakeSupabaseClient } = require('./load-app');

const C = (id, category, max, extra) => Object.assign({ id, section_id: 'S', category, name: id, max_score: max, kind: 'manual' }, extra || {});
const S = (column_id, student_id, score) => ({ column_id, student_id, score });
const CAPS = { performance: 40, tests: 20 };

test('validateGradeLetters — تنازلي بلا تكرار، آخره 0، أسماء غير مكررة', async () => {
  const app = loadApp();
  const L = (...a) => a.map(([label, min]) => ({ label, min }));
  assert.equal(app.validateGradeLetters(L(['أ', 90], ['ب', 50], ['ج', 0])), null);
  assert.match(app.validateGradeLetters(L(['أ', 90])), /من 2 إلى 12/);
  assert.match(app.validateGradeLetters(L(['أ', 50], ['ب', 90], ['ج', 0])), /رتّب/);
  assert.match(app.validateGradeLetters(L(['أ', 90], ['ب', 90], ['ج', 0])), /رتّب/);
  assert.match(app.validateGradeLetters(L(['أ', 90], ['ب', 50])), /آخر تقدير يبدأ من 0/);
  assert.match(app.validateGradeLetters(L(['أ', 90], ['أ', 50], ['ج', 0])), /مكرر/);
  assert.match(app.validateGradeLetters(L(['', 90], ['ب', 0])), /اسم/);
  assert.match(app.validateGradeLetters(L(['أ', 120], ['ب', 0])), /0 و100/);
  assert.match(app.validateGradeLetters(L(['أ', NaN], ['ب', 0])), /0 و100/);
});

test('normalizeFeatures — تقديرات سليمة تبقى، والتالفة من القاعدة تُسقَط', async () => {
  const app = loadApp();
  const ok = [{ label: ' أ ', min: '90' }, { label: 'ب', min: 0 }];
  assert.deepEqual(JSON.parse(JSON.stringify(app.normalizeFeatures({ gradeLetters: ok }).gradeLetters)), [{ label: 'أ', min: 90 }, { label: 'ب', min: 0 }]);
  assert.equal(app.normalizeFeatures({ gradeLetters: [{ label: 'أ', min: 10 }, { label: 'ب', min: 50 }] }).gradeLetters, undefined);
  assert.equal(app.normalizeFeatures({ gradeLetters: 'x' }).gradeLetters, undefined);
  assert.equal(app.normalizeFeatures({}).gradeLetters, undefined);
});

test('gradeLetterIndex/Counts — الحد نفسه يأخذ التقدير الأعلى، وغير المرصود لا يُعدّ', async () => {
  const app = loadApp();
  runInAppContext(app, 'window.__L = GRADE_LETTERS_DEFAULT;');
  const L = app.__L;
  const idx = p => L[app.gradeLetterIndex(p, L)].label;
  assert.equal(idx(100), 'أ+');
  assert.equal(idx(95), 'أ+');
  assert.equal(idx(94.99), 'أ');
  assert.equal(idx(50), 'د');
  assert.equal(idx(49.99), 'هـ');
  assert.equal(idx(0), 'هـ');
  const counts = app.gradeLetterCounts([{ pct: 96 }, { pct: 95 }, { pct: 10 }, { pct: null }], L);
  assert.equal(counts[0], 2);
  assert.equal(counts[8], 1);
  assert.equal(counts.reduce((a, b) => a + b, 0), 3, 'من لم يُرصد له لا يدخل');
});

test('gradeColumnDifficulty + hardestGradeColumn — أصعب اختبار فقط، وبشرط 30% تحت النصف', async () => {
  const app = loadApp();
  const cols = [C('h', 'performance', 10, { name: 'واجبات' }), C('t1', 'tests', 20, { name: 'اختبار ١' }), C('t2', 'tests', 20, { name: 'اختبار ٢', measures: 'الكسور <b>' })];
  const ids = ['a', 'b', 'c', 'd'];
  const scores = [S('h', 'a', 1), S('h', 'b', 1), S('h', 'c', 1), S('h', 'd', 1),
    S('t1', 'a', 18), S('t1', 'b', 16), S('t1', 'c', 15), S('t1', 'd', 14),
    S('t2', 'a', 5), S('t2', 'b', 6), S('t2', 'c', 18), S('t2', 'd', 15)];
  const list = app.gradeColumnDifficulty(cols, scores, ids);
  assert.deepEqual([...list].map(x => [x.id, x.avgPct, x.low]), [['h', 10, 4], ['t1', 79, 0], ['t2', 55, 2]]);
  const hard = app.hardestGradeColumn(list);
  assert.equal(hard.id, 't2', 'الواجبات أضعف لكنها لا تقيس صعوبة الدرس');
  assert.equal(app.hardestGradeColumn(list.filter(x => x.id !== 't2')), null, 'اختبار ١ بلا أحد تحت النصف');
  assert.equal(app.hardestGradeColumn(list.filter(x => x.category !== 'tests')), null);
  assert.deepEqual([...app.gradeColumnDifficulty(cols, scores, ['a'])].map(x => x.recorded), [1, 1, 1], 'الطلاب خارج الشعبة لا يُحسبون');
});

test('gradePctMap + gradeMeanPct + gradeChangeSummary — العمود بالاسم، والتغيّر 10 نقاط فأكثر', async () => {
  const app = loadApp();
  runInAppContext(app, 'appGradeCaps = () => ({ performance: 40, tests: 20 });');
  const now = { columns: [C('n1', 'tests', 20, { name: 'اختبار ١' })], scores: [S('n1', 'a', 18), S('n1', 'b', 10), S('n1', 'c', 12)] };
  const prev = { columns: [C('p1', 'tests', 40, { name: 'اختبار ١' })], scores: [S('p1', 'a', 24), S('p1', 'b', 20), S('p1', 'c', 24)] };
  const ST = ['a', 'b', 'c', 'd'].map(id => ({ id, full_name: id }));
  const spec = { name: 'اختبار ١' };
  const nm = app.gradePctMap(now, ST, spec, CAPS, true), pm = app.gradePctMap(prev, ST, spec, CAPS, true);
  assert.deepEqual([...nm], [['a', 90], ['b', 50], ['c', 60]], 'd لم يُرصد له: غائب لا صفر');
  assert.equal(app.gradeMeanPct(nm), 67);
  assert.equal(app.gradePctMap(now, ST, { name: 'غير موجود' }, CAPS, true), null);
  const sum = app.gradeChangeSummary(nm, pm);
  assert.equal(sum.compared, 3);
  assert.deepEqual([...sum.up].map(r => [r.id, r.delta]), [['a', 30]], 'a: 60% ← 90%');
  assert.equal(sum.down.length, 0, 'b وc مستقران (50←50، 60←60)');
  assert.equal(sum.avgDelta, 10, '(+30 + 0 + 0) / 3');
  const edge = app.gradeChangeSummary(new Map([['a', 60]]), new Map([['a', 50]]));
  assert.equal(edge.up.length, 1, '10 بالضبط تُعدّ تحسّنًا');
  assert.equal(app.gradeChangeSummary(new Map([['a', 40]]), new Map([['a', 50]])).down.length, 1, '-10 بالضبط تراجع');
  assert.equal(app.gradeChangeSummary(new Map([['a', 41]]), new Map([['a', 50]])).down.length, 0);
});

/* عميل بديل تعيد from() فيه صفوفًا (أو خطأ) بعد release() إن طُلب التأجيل */
function fakeSb(handler){
  return Object.assign(makeFakeSupabaseClient(), { from: table => {
    const q = { select: () => q, eq: () => q, in: () => q, then(res){ return handler(table, res); } };
    return q;
  } });
}

function opened(extra, client){
  const app = loadApp(Object.assign({ currentUser: { id: 'u1' } }, client ? { supabaseClient: client } : {}));
  const cols = [C('h', 'performance', 40, { name: 'أداء' }), C('t1', 'tests', 20, { name: 'اختبار ١', measures: 'الكسور <b>' })];
  runInAppContext(app, `
    crmStudents = [{ id: 'a', full_name: 'سامي', section_id: 'S' }, { id: 'b', full_name: 'فهد', section_id: 'S' }, { id: 'c', full_name: 'خالد', section_id: 'S' }];
    crmSections = [{ id: 'S', grade_level_id: 'G' }, { id: 'T', grade_level_id: 'G' }, { id: 'U', grade_level_id: 'H' }];
    crmSectionById = id => crmSections.find(s => s.id === id) || null;
    crmSectionLabel = id => id === 'T' ? 'ثاني/<٧>' : 'ثاني/٦';
    appGradeCaps = () => ({ performance: 40, tests: 20 }); appToolOn = () => true;
    crmGrades = { sectionId: 'S', year: '1448-1449', semester: 1, columns: ${JSON.stringify(cols)}, allColumns: ${JSON.stringify(cols)}, hiddenColumns: [],
      scores: ${JSON.stringify([S('h', 'a', 30), S('h', 'b', 10), S('h', 'c', 36), S('t1', 'a', 5), S('t1', 'b', 6), S('t1', 'c', 18)])} };
    window.__modal = []; showInfoModal = h => window.__modal.push(h);
    openCrmGradeAnalysis(); ${extra || ''}`);
  return app;
}

test('الواجهة: «أين الصعوبة؟» تُظهر أصعب اختبار وما يقيسه مُهرَّبًا', async () => {
  const app = opened(`crmGradeAnalysis.cmp = 'diff'; window.__h = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__h, /أصعب اختبار: اختبار ١/);
  assert.match(app.__h, /2 من 3 تحت النصف \(67%\)/);
  assert.match(app.__h, /يقيس: الكسور &lt;b&gt;/);
  assert.doesNotMatch(app.__h, /الكسور <b>/);
});

test('الواجهة: مقارنة الشعب معطّلة بلا شعب أخرى للصف، ومفتوحة مع شعبة أخرى', async () => {
  const app = opened(`window.__h1 = crmGradeAnalysisHtml(crmGradeAnalysis);
    crmSections = crmSections.filter(s => s.id !== 'T'); window.__h2 = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.doesNotMatch(app.__h1, /toggleCrmGaCompare\('sib'\)"[^>]*disabled/);
  assert.match(app.__h2, /disabled onclick="toggleCrmGaCompare\('sib'\)"[\s\S]*?لا شعب أخرى لهذا الصف/);
});

test('الواجهة: مقارنة الشعب تحسب متوسط نسبة كل شعبة وتُهرّب الاسم، وتتجاهل شعبة بلا رصد', async () => {
  const app = opened(`
    crmStudents.push({ id: 'x', full_name: 'ط', section_id: 'T' }, { id: 'y', full_name: 'ي', section_id: 'T' });
    const a = crmGradeAnalysis; a.cmp = 'sib'; a.key = 't1';
    a.sib = { status: 'ready', data: [{ id: 'T', columns: [{ id: 'q1', section_id: 'T', category: 'tests', name: 'اختبار  ١', max_score: 20, kind: 'manual' }], scores: [{ column_id: 'q1', student_id: 'x', score: 20 }, { column_id: 'q1', student_id: 'y', score: 10 }] }] };
    window.__h = crmGradeAnalysisHtml(a);`);
  /* شعبتي: (25% + 30% + 90%) / 3 = 48% ؛ الأخرى: (100% + 50%) / 2 = 75% — والأعلى أولًا */
  assert.match(app.__h, /ثاني\/&lt;٧&gt;<small>2 طالبًا<\/small>[\s\S]*?75%[\s\S]*?ثاني\/٦ ★<small>3 طالبًا<\/small>[\s\S]*?48%/);
  assert.match(app.__h, /الفارق بين أعلى شعبة وأدنى شعبة: <b>27<\/b>/);
});

test('الواجهة: الفصل السابق — تحسّن/تراجع بأسماء، وغياب الكشف السابق برسالة', async () => {
  const app = opened(`
    const a = crmGradeAnalysis; a.cmp = 'prev'; a.prevOpen = 'up';
    a.prev = { status: 'ready', data: { id: 'S', columns: [{ id: 'o1', section_id: 'S', category: 'performance', name: 'أداء', max_score: 40, kind: 'manual' }], scores: [{ column_id: 'o1', student_id: 'a', score: 20 }, { column_id: 'o1', student_id: 'b', score: 36 }, { column_id: 'o1', student_id: 'c', score: 36 }] } };
    window.__h = crmGradeAnalysisHtml(a);
    a.prev = { status: 'ready', data: null }; window.__none = crmGradeAnalysisHtml(a);`);
  /* الكل مقارنة بالمجموع: الحالي أداء فقط + اختبار؛ نكتفي بالتحقق من التركيب والرسالة */
  assert.match(app.__h, /تحسّنوا/);
  assert.match(app.__h, /تراجعوا/);
  assert.match(app.__h, /قارنّا 3 طالبًا/);
  assert.match(app.__none, /لا كشف لهذه الشعبة في الفصل السابق/);
});

test('سباق: جواب تحميل المقارنة يُهمَل إن فُتحت نافذة أخرى قبل وصوله', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const app = opened(`window.__a = crmGradeAnalysis; window.__p = loadGradeCompare(__a, 'sib');`,
    fakeSb((table, res) => gate.then(() => res({ data: [], error: null }))));
  assert.equal(app.__a.sib.status, 'loading');
  runInAppContext(app, `crmGradeAnalysis = { other: true };`);
  release();
  await app.__p;
  assert.equal(app.__a.sib.status, 'loading', 'لم تُكتب النتيجة على نافذة لم تعد الحالية');
});

test('خطأ التحميل يُظهر «إعادة المحاولة» ولا يترك التحميل معلّقًا', async () => {
  const app = opened(`window.__a = crmGradeAnalysis; window.__a.cmp = 'prev'; window.__p = loadGradeCompare(__a, 'prev');`,
    fakeSb((table, res) => res({ data: null, error: { message: 'x' } })));
  await app.__p;
  assert.equal(app.__a.prev.status, 'error');
  runInAppContext(app, 'window.__h = crmGradeAnalysisHtml(__a);');
  assert.match(app.__h, /إعادة المحاولة/);
});

test('persistGradeLetters — الافتراضي لا يُخزَّن، والمخصّص يُحفظ، وفشل الحفظ يُرجع رسالة', async () => {
  const app = opened(`
    saveAppFeatures = async () => { appFeaturesSaved = appFeatures; };
    window.__r1 = null; window.__r2 = null; window.__r3 = null;`);
  const custom = [{ label: 'ممتاز', min: 90 }, { label: 'جيد', min: 70 }, { label: 'ضعيف', min: 0 }];
  runInAppContext(app, `(async () => { window.__r1 = await persistGradeLetters(${JSON.stringify(custom)}); window.__saved = JSON.stringify(appFeatures.gradeLetters);
    window.__r2 = await persistGradeLetters(JSON.parse(JSON.stringify(GRADE_LETTERS_DEFAULT))); window.__after = appFeatures.gradeLetters;
    saveAppFeatures = async () => { /* الحفظ فشل: لم يتغيّر المؤكَّد */ };
    window.__r3 = await persistGradeLetters(${JSON.stringify(custom)}); })()`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(app.__r1, null);
  assert.equal(app.__saved, JSON.stringify(custom));
  assert.equal(app.__r2, null);
  assert.equal(app.__after, undefined, 'الافتراضي = غياب المفتاح');
  assert.equal(app.__r3, 'تعذّر حفظ التقديرات');
});

test('محرّر التقديرات — خطأ التحقق يظهر ولا يُحفظ شيء، والحذف لا ينزل تحت تقديرين', async () => {
  const app = opened(`
    window.__persist = 0; persistGradeLetters = async () => { window.__persist++; return null; };
    openCrmGaLettersEditor(); crmGaLetterEdit(0, 'min', '10'); window.__p = saveCrmGaLetters();`);
  await app.__p;
  assert.equal(app.__persist, 0);
  runInAppContext(app, `window.__err = crmGradeAnalysis.editing.error; window.__h = crmGradeAnalysisHtml(crmGradeAnalysis);
    while(crmGradeAnalysis.editing.list.length > 2) crmGaLetterRemove(0); crmGaLetterRemove(0); window.__len = crmGradeAnalysis.editing.list.length;`);
  assert.match(app.__err, /رتّب/);
  assert.match(app.__h, /id="crmGaEditErr">[^<]*رتّب/);
  assert.equal(app.__len, 2);
});

test('محرّر التقديرات — حفظ ناجح يغلق المحرّر ويعرض التوزيع بالتقدير', async () => {
  const app = opened(`
    window.__persist = 0; persistGradeLetters = async l => { window.__persist++; appFeatures = Object.assign({}, appFeatures, { gradeLetters: l }); return null; };
    showToast = () => {};
    openCrmGaLettersEditor(); window.__p = saveCrmGaLetters();`);
  await app.__p;
  runInAppContext(app, `window.__st = [crmGradeAnalysis.editing, crmGradeAnalysis.mode]; window.__h = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.equal(app.__persist, 1);
  assert.equal(app.__st[0], null);
  assert.equal(app.__st[1], 'letters');
  assert.match(app.__h, /crm-ga-lnote/);
});

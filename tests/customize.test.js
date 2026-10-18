'use strict';
/* ============================================================
   تخصيص التطبيق (app-22-customize.js) — الدفعة 1
   ------------------------------------------------------------
   باتفاق مع المعلم:
   - لا يُفرض أي قسم، بشرط قسم واحد على الأقل.
   - إيقاف أداة يُخفيها فقط: بياناتها باقية، ودرجاتها لا تُحسب، ولا تنبيهات.
   - غياب الاختيار = كل شيء ظاهر (المعلمون الحاليون لا يتغيّر عليهم شيء).
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

/* عميل وهمي: يطبّق eq/in على بيانات seed (ويتجاهل بقية المرشحات)، ويسجّل الكتابات */
function fakeClient(seed, log, opts){
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table){
      const f = [];
      let op = 'select', values = null, single = false;
      const result = () => {
        if(opts.fail && opts.fail(table, op)) return { data: null, error: { message: 'boom' } };
        if(op === 'upsert' || op === 'insert' || op === 'update' || op === 'delete'){
          log.push({ table, op, values, filters: f.slice() });
          return { data: null, error: null };
        }
        log.push({ table, op: 'select', filters: f.slice() });
        const rows = match(seed[table], f);
        return { data: single ? (rows[0] || null) : rows, error: null };
      };
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; }, gte(){ return api; }, is(){ return api; },
        eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; },
        upsert(r){ op = 'upsert'; values = r; return api; }, insert(r){ op = 'insert'; values = r; return api; },
        update(r){ op = 'update'; values = r; return api; }, delete(){ op = 'delete'; return api; },
        maybeSingle(){ single = true; return Promise.resolve(result()); }, single(){ single = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(result()).then(res, rej); },
      };
      return api;
    },
    rpc(name, args){ log.push({ op: 'rpc', name, args }); return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
}

function appWith(seed, log, opts){
  const app = loadApp({ supabaseClient: fakeClient(seed || {}, log || [], opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);`);
  return app;
}
const setFeatures = (app, f) => runInAppContext(app, `appFeatures = ${JSON.stringify(f)}; appFeaturesSaved = appFeatures;`);
const filtersOf = e => Object.fromEntries(e.filters.map(([c, v]) => [c, Array.isArray(v) ? [...v] : v]));

/* ============ الدوال الصرفة ============ */
test('الافتراضي: كل شيء ظاهر (المعلمون الحاليون لا يتغيّر عليهم شيء)', async () => {
  const app = loadApp();
  ['shahid', 'plan', 'work', 'classroom'].forEach(k => assert.equal(app.appSectionOn(k), true, k));
  ['attendance', 'participation', 'homework', 'tasks', 'tests', 'behavior'].forEach(k => assert.equal(app.appToolOn(k), true, k));
});

test('normalizeFeatures — يُبقي المفاتيح المعروفة وقيم الإيقاف الصريحة فقط', async () => {
  const app = loadApp();
  const n = app.normalizeFeatures({ sections: { shahid: false, plan: true, hack: false }, tools: { homework: false, attendance: 'no' }, extra: { x: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(n)), { sections: { shahid: false }, tools: { homework: false } });
  assert.deepEqual(JSON.parse(JSON.stringify(app.normalizeFeatures(null))), { sections: {}, tools: {} });
});

test('الأداة تتبع قسمها: إدارة الصف موقوفة = كل أدواتها موقوفة', async () => {
  const app = loadApp();
  setFeatures(app, { sections: { classroom: false }, tools: {} });
  assert.equal(app.appToolOn('attendance'), false);
  setFeatures(app, { sections: {}, tools: { homework: false } });
  assert.equal(app.appToolOn('homework'), false);
  assert.equal(app.appToolOn('participation'), true);
});

test('gradeColumnVisible — الاختبارات بفئتها، والمحسوبة بأداتها، واليدوي الأدائي دائمًا', async () => {
  const app = loadApp();
  setFeatures(app, { sections: {}, tools: { homework: false, tests: false } });
  assert.equal(app.gradeColumnVisible({ category: 'performance', kind: 'homework' }), false);
  assert.equal(app.gradeColumnVisible({ category: 'tests', kind: 'manual' }), false);
  assert.equal(app.gradeColumnVisible({ category: 'performance', kind: 'participation' }), true);
  assert.equal(app.gradeColumnVisible({ category: 'performance', kind: 'manual' }), true);
  assert.equal(app.gradeColumnVisible({ category: 'performance', kind: 'task' }), true);
});

test('enabledSheetModes و followupVisible', async () => {
  const app = loadApp();
  setFeatures(app, { sections: {}, tools: { attendance: false, homework: false } });
  assert.deepEqual([...app.enabledSheetModes()], ['participation', 'task']);
  assert.equal(app.followupVisible({ reason_type: 'absence' }), false);
  assert.equal(app.followupVisible({ reason_type: 'grades' }), true);
  setFeatures(app, { sections: {}, tools: { behavior: false } });
  assert.equal(app.followupVisible({ reason_type: 'behavior' }), false);
});

test('landingSection — قسم واحد مفعّل يفتح عليه', async () => {
  const app = loadApp();
  assert.equal(app.landingSection({ sections: { shahid: false, plan: false, work: false } }), 'classroom');
  assert.equal(app.landingSection({ sections: { plan: false } }), null);
});

/* ============ التحميل والحفظ ============ */
test('loadAppFeatures — يقرأ صف المعلم الحالي فقط', async () => {
  const log = [];
  const seed = { user_app_settings: [{ user_id: 'u2', features: { sections: { shahid: false } } }, { user_id: 'u1', features: { tools: { homework: false } } }] };
  const app = appWith(seed, log);
  await app.loadAppFeatures('u1');
  assert.deepEqual(filtersOf(log[0]), { user_id: 'u1' });
  assert.equal(app.appToolOn('homework'), false);
  assert.equal(app.appSectionOn('shahid'), true, 'إعداد معلم آخر لا يُطبَّق');
});

test('toggleAppFeature — يحفظ باسم المعلم، ولا يسمح بإيقاف آخر قسم', async () => {
  const log = [];
  const app = appWith({}, log);
  setFeatures(app, { sections: { shahid: false, plan: false, work: false }, tools: {} });
  await app.toggleAppFeature('sections', 'classroom');
  assert.equal(app.appSectionOn('classroom'), true, 'آخر قسم يبقى');
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /قسم واحد على الأقل/);
  assert.equal(log.filter(l => l.op === 'upsert').length, 0);
  await app.toggleAppFeature('tools', 'homework');
  const up = log.filter(l => l.op === 'upsert')[0];
  assert.equal(up.values.user_id, 'u1');
  assert.deepEqual(JSON.parse(JSON.stringify(up.values.features)), { sections: { shahid: false, plan: false, work: false }, tools: { homework: false } });
});

test('نقرتان سريعتان — تُحفظان بالتتابع، وآخر حفظ = آخر اختيار', async () => {
  const log = [];
  const app = appWith({}, log);
  setFeatures(app, { sections: {}, tools: {} });
  await Promise.all([app.toggleAppFeature('tools', 'homework'), app.toggleAppFeature('tools', 'tests')]);
  const ups = log.filter(l => l.op === 'upsert');
  assert.deepEqual(JSON.parse(JSON.stringify(ups[ups.length - 1].values.features.tools)), { homework: false, tests: false });
});

test('فشل الحفظ — يعود آخر اختيار محفوظ ولا يبقى العرض كاذبًا', async () => {
  const log = [];
  const app = appWith({}, log, { fail: (t, op) => t === 'user_app_settings' && op === 'upsert' });
  setFeatures(app, { sections: {}, tools: {} });
  await app.toggleAppFeature('tools', 'homework');
  assert.equal(app.appToolOn('homework'), true);
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /تعذّر حفظ التخصيص/);
});

/* ============ أثر الإخفاء على البيانات والحساب ============ */
test('محرك الانتباه — أداة مخفية: لا حضور ولا مواقف ولا عمودها ولا متابعاتها', async () => {
  const seed = {
    classroom_students: [{ id: 'a', teacher_id: 'u1', full_name: 'أ', section_id: 'S', is_active: true }],
    classroom_sections: [{ id: 'S', teacher_id: 'u1' }],
    classroom_lessons: [{ id: 'L1', teacher_id: 'u1', section_id: 'S', lesson_date: '2026-10-15', period: 1 }],
    classroom_attendance: [{ teacher_id: 'u1', lesson_id: 'L1', student_id: 'a', status: 'absent' }],
    classroom_incidents: [{ id: 'I1', teacher_id: 'u1', student_id: 'a', current_stage: 'referred', referral_letter_generated: false, created_at: '2026-10-10' }],
    academic_cases: [], classroom_attention_dismissals: [],
    classroom_followups: [{ id: 'F1', teacher_id: 'u1', student_id: 'a', reason_type: 'absence', status: 'open', review_date: '2026-10-01' }, { id: 'F2', teacher_id: 'u1', student_id: 'a', reason_type: 'grades', status: 'open', review_date: '2026-10-01' }],
    classroom_grade_columns: [{ id: 'HW', teacher_id: 'u1', section_id: 'S', category: 'performance', kind: 'homework', name: 'واجبات', max_score: 10, academic_year: '1448-1449', semester: 1 }, { id: 'P', teacher_id: 'u1', section_id: 'S', category: 'performance', kind: 'participation', name: 'مشاركة', max_score: 10, academic_year: '1448-1449', semester: 1 }],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'HW', student_id: 'a', score: 2 }, { teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 9 }],
  };
  const app = appWith(seed, []);
  runInAppContext(app, `crmIncidentTypes = [{ id: 't' }]; crmAttentionTerm = () => ({ year: '1448-1449', semester: 1 });`);
  setFeatures(app, { sections: {}, tools: { attendance: false, behavior: false, homework: false } });
  const d = await app.loadAttentionData();
  assert.equal(d.lessons.length, 0);
  assert.equal(d.attendance.length, 0);
  assert.equal(d.incidents.length, 0);
  assert.deepEqual([...d.followups].map(f => f.id), ['F2'], 'متابعة الغياب مخفية، ومتابعة الدرجات باقية');
  assert.deepEqual([...d.gradeColumns].map(c => c.id), ['P']);
  setFeatures(app, { sections: {}, tools: {} });
  const all = await app.loadAttentionData();
  assert.equal(all.attendance.length, 1, 'الإظهار يعيد كل شيء — البيانات لم تُحذف');
  assert.equal(all.incidents.length, 1);
});

test('محرك الانتباه — إدارة الصف مخفية: لا فحص ولا شارة', async () => {
  const log = [];
  const app = appWith({}, log);
  setFeatures(app, { sections: { classroom: false }, tools: {} });
  assert.equal(await app.refreshAttention(), null);
  assert.equal(log.length, 0, 'لا استعلامات أصلًا');
});

test('loadCrmGradeSheet — عمود الأداة المخفية: لا يُعرض ولا يُحسب ولا يُعاد حسابه، ويُذكر في سطر المخفي', async () => {
  const log = [];
  const seed = {
    classroom_grade_columns: [
      { id: 'HW', teacher_id: 'u1', section_id: 'S', academic_year: '1448-1449', semester: 1, category: 'performance', kind: 'homework', name: 'واجبات', max_score: 10 },
      { id: 'M', teacher_id: 'u1', section_id: 'S', academic_year: '1448-1449', semester: 1, category: 'performance', kind: 'manual', name: 'مشروع', max_score: 30 },
    ],
    classroom_grade_scores: [], classroom_homework: [], classroom_homework_status: [],
  };
  const app = appWith(seed, log);
  runInAppContext(app, `crmCurrentTerm = () => ({ year: '1448-1449', semester: 1 }); crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];`);
  setFeatures(app, { sections: {}, tools: { homework: false } });
  const g = await app.loadCrmGradeSheet('S');
  assert.deepEqual([...g.columns].map(c => c.id), ['M']);
  assert.deepEqual([...g.hiddenColumns].map(c => c.id), ['HW']);
  assert.equal(log.filter(l => l.table === 'classroom_homework').length, 0, 'لا مزامنة لعمود مخفي');
  const html = app.crmGradeSheetHtml(g);
  assert.match(html, /مخفي ولا يُحسب: واجبات \(10\)/);
  assert.match(html, /موزّع 30 من 40/, 'الموزّع الظاهر');
  assert.ok(!/openCrmGradeColumnEditor\('performance'/.test(html), 'السقف ممتلئ فعليًا بالمخفي — لا "+ عمود" يرفضه الخادم');
});

test('كشف كل أعمدته مخفية لا يُعرض كـ"لا كشف" (فلا يُنشأ كشف مكرر)', async () => {
  const app = loadApp();
  setFeatures(app, { sections: {}, tools: { tests: false } });
  const html = app.crmGradeSheetHtml({ sectionId: 'S', columns: [], allColumns: [{ id: 'T', category: 'tests', name: 'الفترة الأولى', max_score: 10 }], hiddenColumns: [{ id: 'T', category: 'tests', name: 'الفترة الأولى', max_score: 10 }], scores: [] });
  assert.ok(!/إنشاء الكشف/.test(html));
  assert.match(html, /كل أعمدة هذا الكشف لأدوات مخفية/);
});

test('ورقة الحصة — المفتاح يعرض الأدوات المفعّلة فقط، والوضع المخفي يتحوّل لأول مفعّل', async () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  setFeatures(app, { sections: {}, tools: { attendance: false, homework: false } });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-18', period: 1, token: 1, mode: 'participation' }; window.__modes = []; renderCrmParticipation = () => window.__modes.push('p'); renderCrmTasks = () => window.__modes.push('t');`);
  const html = app.crmSheetModeSwitchHtml();
  assert.ok(!/حضور|واجب/.test(html));
  assert.match(html, /مشاركة/);
  app.setCrmSheetMode('homework');
  assert.equal(runInAppContext(app, 'crmSheet.mode'), 'participation');
  setFeatures(app, { sections: {}, tools: { attendance: false, homework: false, tasks: false } });
  assert.equal(app.crmSheetModeSwitchHtml(), '', 'أداة واحدة = لا مفتاح');
});

test('انحدار: حفظ النطاق الجغرافي عبر الدالة المضبوطة (التحديث المباشر لا يحفظ للمعلم)', async () => {
  const log = [];
  const app = appWith({}, log);
  runInAppContext(app, `renderCurrentWeekWidget = () => {};`);
  await app.saveCalendarRegion('makkah_group');
  assert.deepEqual(log.filter(l => l.op === 'rpc').map(l => l.name + ':' + l.args.region), ['set_calendar_region:makkah_group']);
  assert.equal(log.filter(l => l.table === 'profiles').length, 0);
});

/* ============ الدفعة 2: توزيع الدرجات (المجموع 60) وأسئلة أول دخول ============ */
test('validGradeCaps — رقمان غير سالبين بمنازل 0.5 مجموعهما 60', async () => {
  const app = loadApp();
  [[40, 20], [45, 15], [45.5, 14.5], [60, 0]].forEach(([p, t]) => assert.equal(app.validGradeCaps({ performance: p, tests: t }), true, p + '/' + t));
  [[30, 20], [-5, 65], [40.3, 19.7], ['40', '20'], [null, 60]].forEach(([p, t]) => assert.equal(app.validGradeCaps({ performance: p, tests: t }), false, p + '/' + t));
});

test('التوزيع الافتراضي 40/20، وتوزيع المعلم الصالح يُطبَّق، وغير الصالح يُتجاهل', async () => {
  const app = loadApp();
  assert.equal(app.gradeCap('performance'), 40);
  assert.equal(app.gradeCap('tests'), 20);
  setFeatures(app, app.normalizeFeatures({ grades: { performance: 50, tests: 10 } }));
  assert.equal(app.gradeCap('performance'), 50);
  setFeatures(app, app.normalizeFeatures({ grades: { performance: 50, tests: 50 } }));
  assert.equal(app.gradeCap('tests'), 20, 'مجموع غير 60 = الرسمي');
});

test('validateGradeColumn — يتبع توزيع المعلم، والعمود الواحد 40 كحد أقصى', async () => {
  const app = loadApp();
  setFeatures(app, { sections: {}, tools: {}, grades: { performance: 50, tests: 10 } });
  const cols = [{ id: 'p1', category: 'performance', max_score: 30 }, { id: 't1', category: 'tests', max_score: 5 }];
  assert.equal(app.validateGradeColumn(cols, { category: 'performance', name: 'مشروع', max_score: '20' }, []), null, '30+20 = 50 ضمن السقف');
  assert.match(app.validateGradeColumn(cols, { category: 'tests', name: 'قصير', max_score: '10' }, []), /يتجاوز سقف التقويمات الشفهية والتحريرية \(10\)/);
  assert.match(app.validateGradeColumn([], { category: 'performance', name: 'كبير', max_score: '45' }, []), /40 كحد أقصى/);
});

test('gradeSheetSeed — الافتراضي يملأ توزيع المعلم بنسبه، والسابق يُصغَّر فقط إن تجاوز', async () => {
  const app = loadApp();
  const sum = (s, cat) => [...s].filter(c => c.category === cat).reduce((t, c) => t + c.max_score, 0);
  const def = app.gradeSheetSeed([], { performance: 40, tests: 20 });
  assert.deepEqual([...def].map(c => c.max_score), [10, 10, 20, 10, 10], '40/20 = الهيكل المعتاد بلا تغيير');
  const s45 = app.gradeSheetSeed([], { performance: 45, tests: 15 });
  assert.equal(sum(s45, 'performance'), 45);
  assert.equal(sum(s45, 'tests'), 15);
  assert.ok([...s45].every(c => c.max_score > 0 && c.max_score <= 40 && Math.round(c.max_score * 2) === c.max_score * 2));
  assert.equal([...app.gradeSheetSeed([], { performance: 60, tests: 0 })].filter(c => c.category === 'tests').length, 0, 'سقف 0 = لا أعمدة للفئة');
  const prev = [{ category: 'performance', name: 'أ', max_score: 15, kind: 'manual' }, { category: 'tests', name: 'ب', max_score: 20, kind: 'manual' }];
  const kept = app.gradeSheetSeed(prev, { performance: 45, tests: 15 });
  assert.equal(kept.find(c => c.name === 'أ').max_score, 15, 'ضمن السقف = كما هو');
  assert.equal(kept.find(c => c.name === 'ب').max_score, 15, 'تجاوز السقف = يُصغَّر إليه');
});

test('gradeCapsConflicts — كشف قائم يتجاوز السقف الجديد', async () => {
  const app = loadApp();
  const cols = [
    { section_id: 'S', academic_year: 'Y', semester: 1, category: 'tests', max_score: 10 }, { section_id: 'S', academic_year: 'Y', semester: 1, category: 'tests', max_score: 10 },
    { section_id: 'S', academic_year: 'Y', semester: 1, category: 'performance', max_score: 40 },
  ];
  assert.deepEqual([...app.gradeCapsConflicts(cols, { performance: 45, tests: 15 })].map(c => c.category + ':' + c.total), ['tests:20']);
  assert.equal(app.gradeCapsConflicts(cols, { performance: 40, tests: 20 }).length, 0);
});

function capsInputs(app, perf, tests){
  runInAppContext(app, `document.getElementById('custCapPerf').value = ${JSON.stringify(perf)}; document.getElementById('custCapTests').value = ${JSON.stringify(tests)};`);
}

test('saveGradeCaps — لا يُحفظ توزيع يجعل كشفًا قائمًا مخالفًا، والفحص باسم المعلم', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [{ teacher_id: 'u1', section_id: 'S', academic_year: 'Y', semester: 1, category: 'tests', max_score: 20 }, { teacher_id: 'u2', section_id: 'X', academic_year: 'Y', semester: 1, category: 'performance', max_score: 40 }] };
  const app = appWith(seed, log);
  setFeatures(app, { sections: {}, tools: {} });
  capsInputs(app, '45', '15');
  await app.saveGradeCaps();
  assert.equal(log.filter(l => l.op === 'upsert').length, 0);
  assert.match(runInAppContext(app, `document.getElementById('custCapsMsg').textContent`), /تتجاوز السقف الجديد/);
  assert.deepEqual(filtersOf(log.find(l => l.table === 'classroom_grade_columns')), { teacher_id: 'u1' });
  capsInputs(app, '٣٥', '25');
  await app.saveGradeCaps();
  const up = log.filter(l => l.op === 'upsert')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(up.values.features.grades)), { performance: 35, tests: 25 });
  assert.equal(app.gradeCap('tests'), 25);
});

test('saveGradeCaps — مجموع غير 60 يُرفض قبل أي طلب', async () => {
  const log = [];
  const app = appWith({}, log);
  capsInputs(app, '40', '30');
  await app.saveGradeCaps();
  assert.equal(log.length, 0);
  assert.match(runInAppContext(app, `document.getElementById('custCapsMsg').textContent`), /مجموعهما 60/);
});

test('needsCustomizeWizard — للحساب الجديد بلا إعدادات فقط', async () => {
  const app = loadApp();
  runInAppContext(app, 'appFeaturesRowExists = false;');
  assert.equal(app.needsCustomizeWizard({ created_at: '2026-10-20T10:00:00Z' }), true);
  assert.equal(app.needsCustomizeWizard({ created_at: '2026-09-01T10:00:00Z' }), false, 'المعلمون الحاليون لا يُسألون');
  runInAppContext(app, 'appFeaturesRowExists = true;');
  assert.equal(app.needsCustomizeWizard({ created_at: '2026-10-20T10:00:00Z' }), false, 'سبق أن اختار');
});

test('أسئلة أول دخول — الخطوات بحسب الاختيار، وما لم يُختر يُخفى', async () => {
  const app = loadApp();
  const w = runInAppContext(app, `({ step: 'sections', sections: new Set(['classroom']), tools: new Set(['attendance', 'behavior']) })`);
  assert.deepEqual([...app.wizardSteps(w)], ['sections', 'tools'], 'لا أداة لها درجات = لا سؤال توزيع');
  runInAppContext(app, `window.__w = { step: 'sections', sections: new Set(['classroom', 'shahid']), tools: new Set(['participation']) };`);
  assert.deepEqual([...app.wizardSteps(runInAppContext(app, 'window.__w'))], ['sections', 'tools', 'grades']);
  const f = JSON.parse(JSON.stringify(app.featuresFromWizard(runInAppContext(app, 'window.__w'), { performance: 45, tests: 15 })));
  assert.deepEqual(f, { sections: { plan: false, work: false }, tools: { attendance: false, homework: false, tasks: false, tests: false, behavior: false }, grades: { performance: 45, tests: 15 } });
  const onlyShahid = JSON.parse(JSON.stringify(app.featuresFromWizard(runInAppContext(app, `({ sections: new Set(['shahid']), tools: new Set() })`), null)));
  assert.deepEqual(onlyShahid, { sections: { plan: false, work: false, classroom: false }, tools: {} });
});

test('finishCustomizeWizard — لا شيء مختار مسبقًا، ويُحفظ الاختيار باسم المعلم ثم تُفتح الشاشة المناسبة', async () => {
  const log = [];
  const app = appWith({}, log);
  runInAppContext(app, `window.__opened = []; showInfoModal = () => {}; closeCrmModal = () => {}; showClassroomManagement = async () => window.__opened.push('classroom'); showHome = async () => window.__opened.push('home');`);
  app.openCustomizeWizard();
  assert.equal(runInAppContext(app, 'custWizard.sections.size + custWizard.tools.size'), 0, 'لا اختيار مسبق');
  app.toggleWizardPick('sections', 'classroom');
  app.moveCustomizeWizard(1);
  app.toggleWizardPick('tools', 'attendance');
  await app.finishCustomizeWizard();
  const up = log.filter(l => l.op === 'upsert')[0];
  assert.equal(up.values.user_id, 'u1');
  assert.equal(app.appSectionOn('shahid'), false);
  assert.equal(app.appToolOn('attendance'), true);
  assert.equal(app.appToolOn('homework'), false);
  assert.deepEqual([...runInAppContext(app, 'window.__opened')], ['classroom'], 'قسم واحد = يفتح عليه');
  assert.equal(runInAppContext(app, 'custWizard'), null);
});

test('جولة التعريف لا تُفتح فوق أسئلة أول دخول', async () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__tour = 0; showOnboardingStep = () => window.__tour++; custWizard = { pending: true };`);
  app.maybeShowOnboardingTour();
  assert.equal(runInAppContext(app, 'window.__tour'), 0);
});

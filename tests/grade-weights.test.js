'use strict';
/* ============================================================
   "توزيع الأداء" (app-25-grade-weights.js)
   - مكوّنات الأداء = أعمدته + أدوات الأداء الظاهرة بلا عمود (وزن 0).
   - المجموع لا يتجاوز وزن الأداء؛ المكوّن القائم لا يُصفَّر.
   - تغيير الوزن لا يغيّر نسبة الطالب: اليدوي يُحوَّل بالنسبة، والمحسوب يُعاد حسابه.
   - الترتيب: الخفض أولًا (الدرجات ثم الحد) ثم الرفع (الحد ثم الدرجات) ثم الإنشاء.
   - يُطبَّق على كل شعب المعلم لهذا الفصل (باسم المعلم).
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };
const col = (id, section, name, max, extra) => Object.assign({ id, teacher_id: 'u1', section_id: section, academic_year: TERM.year, semester: 1, category: 'performance', kind: 'manual', tool_id: null, name, max_score: max, position: 0 }, extra || {});
const baseCols = s => [col(s + 'p', s, 'مشاركة', 10, { kind: 'participation' }), col(s + 'h', s, 'واجبات', 10, { kind: 'homework' }), col(s + 'k', s, 'مهام أدائية', 20, { kind: 'task' })];
const TOOL = { id: 'T', name: 'إحضار الكتاب', tool_type: 'status', category: 'performance', max_score: 1, hidden: false };

function fakeClient(seed, log){
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => r[c] === v));
  return {
    from(table){
      const f = []; let op = 'select', values = null;
      const result = () => {
        if(op !== 'select'){ log.push({ table, op, values, filters: f.slice() }); return { data: null, error: null }; }
        return { data: match(seed[table], f), error: null };
      };
      const api = { select(){ return api; }, eq(c, v){ f.push([c, v]); return api; }, in(){ return api; }, order(){ return api; },
        insert(r){ op = 'insert'; values = r; return api; }, upsert(r){ op = 'upsert'; values = r; return api; },
        update(r){ op = 'update'; values = r; return api; }, delete(){ op = 'delete'; return api; },
        then(res, rej){ return Promise.resolve(result()).then(res, rej); } };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
}

function appWith(seed, log){
  const app = loadApp({ supabaseClient: fakeClient(seed, log), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__modal = []; showInfoModal = h => window.__modal.push(h); closeCrmModal = () => {};
    afterCrmGradesChanged = () => {}; renderCrmGrades = () => {}; crmSectionLabel = id => 'ش' + id;
    crmCurrentTerm = () => (${JSON.stringify(TERM)});
    crmSections = [{ id: 'S' }, { id: 'S2' }, { id: 'E' }];
    crmCustomTools = [${JSON.stringify(TOOL)}]; crmCustomToolsLoaded = true;
    window.__synced = []; loadCrmGradeSheet = async id => { window.__synced.push(id); return {}; };`);
  return app;
}
const get = (app, e) => runInAppContext(app, e);

test('perfComponentsFor — أعمدة الأداء ثم أدوات الأداء الظاهرة بلا عمود، لا الاختبارات ولا المخفية', async () => {
  const app = loadApp();
  const cols = baseCols('S').concat([col('t', 'S', 'قصير', 20, { category: 'tests' })]);
  const tools = [TOOL, { id: 'H', name: 'مخفية', category: 'performance', hidden: true }, { id: 'X', name: 'شفهي', category: 'tests', hidden: false }];
  const comps = app.perfComponentsFor(cols, tools);
  assert.deepEqual([...comps].map(c => c.key + '=' + c.max), ['c:Sp=10', 'c:Sh=10', 'c:Sk=20', 't:T=0']);
  const withCol = app.perfComponentsFor(cols.concat([col('ct', 'S', 'إحضار الكتاب', 5, { tool_id: 'T' })]), tools);
  assert.equal([...withCol].filter(c => c.key === 't:T').length, 0, 'لها عمود = لا تُكرَّر');
});

test('validatePerfWeights — لا يتجاوز وزن الأداء، ولا يُصفَّر قائم، وبمنازل 0.5، ويقبل الأرقام العربية', async () => {
  const app = loadApp();
  const comps = app.perfComponentsFor(baseCols('S'), [TOOL]);
  const W = o => new Map(Object.entries(o));
  assert.match(app.validatePerfWeights(comps, W({ 't:T': '5' }), 40).error, /يتجاوز وزن الأداء \(40\) — أنقص 5/);
  assert.match(app.validatePerfWeights(comps, W({ 'c:Sp': '0' }), 40).error, /أقل وزن له 0.5/);
  assert.match(app.validatePerfWeights(comps, W({ 'c:Sp': '7.3' }), 40).error, /بمنازل 0.5/);
  const ok = app.validatePerfWeights(comps, W({ 'c:Sp': '٥', 't:T': '5' }), 40);
  assert.equal(ok.total, 40);
  assert.equal(ok.weights.get('c:Sp'), 5);
  assert.equal(app.validatePerfWeights(comps, W({}), 40).total, 40, 'بلا تغيير');
});

test('scaleGradeScore و planSectionWeights — نفس النسبة، والخفض قبل الرفع، والإنشاء للأدوات فقط، والمطابقة بالنوع/الاسم', async () => {
  const app = loadApp();
  assert.equal(app.scaleGradeScore(8, 10, 5), 4);
  assert.equal(app.scaleGradeScore(7, 10, 15), 10.5);
  const cols = baseCols('S2').concat([col('m', 'S2', ' مشروع ', 0.5)]);
  const desired = [{ identity: 'kind:participation', max: 5 }, { identity: 'kind:task', max: 24 }, { identity: 'name:مشروع', max: 1 }, { identity: 'tool:T', tool: TOOL, max: 5 }, { identity: 'tool:Z', tool: { id: 'Z' }, max: 0 }];
  const plan = app.planSectionWeights(cols, desired);
  assert.deepEqual([...plan.decrease].map(x => x.column.id + ':' + x.old + '>' + x.max), ['S2p:10>5']);
  assert.deepEqual([...plan.increase].map(x => x.column.id + ':' + x.max), ['S2k:24', 'm:1']);
  assert.deepEqual([...plan.create].map(x => x.tool.id + ':' + x.max), ['T:5'], 'وزن 0 = لا عمود');
});

/* حقول شاشة الإعداد في DOM الاختبارات الوهمي */
function settingsInputs(app, perf, tests, weights){
  runInAppContext(app, `
    window.__els = { gsCapPerf: { value: ${JSON.stringify(perf)} }, gsCapTests: { value: ${JSON.stringify(tests)} },
      crmGradeSettingsSaveBtn: { disabled: false, textContent: '' }, crmGradeSettingsError: { style: {}, textContent: '' }, crmWeightsTotal: { style: {}, textContent: '' } };
    document.getElementById = id => window.__els[id] || null;
    document.querySelectorAll = () => ${JSON.stringify(weights)}.map(([key, value]) => ({ dataset: { key }, value }));`);
}
const sheetG = (seed, s) => ({ sectionId: s, columns: seed.filter(c => c.section_id === s && c.teacher_id === 'u1'), allColumns: seed.filter(c => c.section_id === s && c.teacher_id === 'u1'), hiddenColumns: [], scores: [] });

test('إعداد الدرجات — حفظ واحد لكل الشعب باسم المعلم: المشاركة تُحوَّل بالنسبة قبل خفض حدها، ويُنشأ عمود المكوّن، ويُعاد الحساب', async () => {
  const log = [];
  const seed = {
    /* عمود لمعلم آخر بنفس معرّف الشعبة: لا يُقرأ ولا يُكتب */
    classroom_grade_columns: baseCols('S').concat(baseCols('S2'), [col('Xp', 'S', 'مشاركة', 10, { kind: 'participation', teacher_id: 'u2' })]),
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'Sp', student_id: 'a', score: 8 }, { teacher_id: 'u1', column_id: 'S2p', student_id: 'b', score: 3 }],
  };
  const app = appWith(seed, log);
  runInAppContext(app, `crmStudents = []; renderCrmGrades = () => {};`);
  const html = app.crmGradeSettingsHtml(sheetG(seed.classroom_grade_columns, 'S'));
  assert.match(html, /① التوزيع/);
  assert.match(html, /② مكوّنات الأداء/);
  assert.match(html, /data-key="t:T" value="1"/, 'المكوّن الجديد بوزنه المبدئي');
  settingsInputs(app, '40', '20', [['c:Sp', '5'], ['c:Sh', '10'], ['c:Sk', '20'], ['t:T', '5']]);
  await Promise.all([app.saveCrmGradeSettings(), app.saveCrmGradeSettings()]);
  const w = log.filter(l => l.op !== 'select');
  assert.ok(w.every(x => x.op === 'insert' ? x.values.teacher_id === 'u1' : x.op === 'upsert' ? [...x.values].every(r => r.teacher_id === 'u1') : x.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1')), 'كل كتابة باسم المعلم');
  const seq = w.map(x => x.table.replace('classroom_grade_', '') + ':' + x.op);
  assert.deepEqual(seq, ['scores:upsert', 'columns:update', 'columns:insert', 'scores:upsert', 'columns:update', 'columns:insert'], 'شعبتان، مرة واحدة رغم النقرتين، والدرجات قبل خفض الحد، ولا حفظ للتوزيع بلا تغيير');
  assert.deepEqual(JSON.parse(JSON.stringify(w[0].values)), [{ teacher_id: 'u1', column_id: 'Sp', student_id: 'a', score: 4 }]);
  assert.equal(w[1].values.max_score, 5);
  assert.deepEqual({ tool: w[2].values.tool_id, max: w[2].values.max_score, cat: w[2].values.category, sec: w[2].values.section_id }, { tool: 'T', max: 5, cat: 'performance', sec: 'S' });
  assert.deepEqual([...get(app, 'window.__synced')], ['S', 'S2'], 'إعادة حساب المحسوب في الشعبتين، والشعبة بلا كشف تُتجاوز');
  assert.match(get(app, 'window.__toasts.join("|")'), /حُفظ إعداد الدرجات/);
});

test('إعداد الدرجات — مجموع المكوّنات أكبر من وزن الأداء الجديد لا يكتب شيئًا، وتوزيع ليس 60 يُرفض', async () => {
  const log = [];
  const app = appWith({ classroom_grade_columns: baseCols('S') }, log);
  app.crmGradeSettingsHtml(sheetG(baseCols('S'), 'S'));
  settingsInputs(app, '35', '25', [['t:T', '0']]);
  await app.saveCrmGradeSettings();
  assert.equal(log.length, 0);
  assert.match(get(app, 'window.__els.crmGradeSettingsError.textContent'), /يتجاوز وزن الأداء \(35\)/);
  settingsInputs(app, '40', '30', []);
  await app.saveCrmGradeSettings();
  assert.equal(log.length, 0);
  assert.match(get(app, 'window.__els.crmGradeSettingsError.textContent'), /مجموعهما 60/);
});

test('إعداد الدرجات — وزن أداء أكبر: يُحفظ التوزيع أولًا ثم تُرفع المكوّنات', async () => {
  const log = [];
  const app = appWith({ classroom_grade_columns: baseCols('S') }, log);
  runInAppContext(app, `window.__order = []; persistGradeCaps = async caps => { window.__order.push('caps:' + caps.performance); appFeatures = { sections: {}, tools: {}, grades: caps }; return null; }; renderCrmGrades = () => {};`);
  app.crmGradeSettingsHtml(sheetG(baseCols('S'), 'S'));
  settingsInputs(app, '45', '15', [['c:Sk', '25'], ['t:T', '0']]);
  await app.saveCrmGradeSettings();
  const firstWrite = log.findIndex(l => l.op !== 'select');
  assert.deepEqual([...get(app, 'window.__order')], ['caps:45']);
  assert.ok(firstWrite >= 0);
  assert.equal(log[firstWrite].values.max_score, 25);
});

test('الكشف المبسّط — زر "⚙ إعداد الدرجات" ولا بطاقة اختبارات (الإعداد في مكان واحد)', async () => {
  const app = appWith({}, []);
  runInAppContext(app, `crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];`);
  const g = { sectionId: 'S', columns: baseCols('S'), allColumns: baseCols('S'), hiddenColumns: [], scores: [] };
  const html = app.crmGradeSimpleHtml(g);
  assert.match(html, /openCrmGradeSettings\(\)">⚙ إعداد الدرجات/);
  assert.doesNotMatch(html, /openCrmGradeColumnEditor\('tests'/);
});

'use strict';
/* ============================================================
   معالج البداية (app-28) — أول مرة لكل فصل:
   ① الأداء (اختيار المكوّنات ودرجاتها بـ − و +، لا يتجاوز وزن الأداء)
   ② الاختبارات (الأصل اختباران) ③ الفترات لكل مكوّن (الأصل ١)
   ثم إنشاء الكشف لكل شعب المعلم التي لا كشف لها، باسم المعلم.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };
const TOOL_ID = '11111111-2222-3333-4444-555555555555';
const HID_ID = '22222222-3333-4444-5555-666666666666';
const TOOLS = [{ id: TOOL_ID, name: 'قراءة <b>', tool_type: 'counter', category: 'performance', max_score: 5, hidden: false },
  { id: HID_ID, name: 'مخفية', tool_type: 'status', category: 'performance', max_score: 2, hidden: true }];

function fakeClient(seed, log, rpcValues){
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table){
      const f = []; let op = 'select', values = null, options = null, single = false;
      const result = () => {
        if(op !== 'select'){
          log.push({ table, op, values, options, filters: f.slice() });
          if(op === 'update'){ match(seed[table], f).forEach(r => Object.assign(r, values)); }
          return { data: op === 'insert' ? [{ id: 'NEW' }] : null, error: null };
        }
        const rows = match(seed[table], f);
        log.push({ table, op: 'select', filters: f.slice() });
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const api = { select(){ return api; }, eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; }, order(){ return api; }, limit(){ return api; }, range(){ return api; },
        insert(r){ op = 'insert'; values = r; return api; }, upsert(r, o){ op = 'upsert'; values = r; options = o; return api; },
        update(r){ op = 'update'; values = r; return api; }, delete(){ op = 'delete'; return api; },
        single(){ single = true; return Promise.resolve(result()); }, maybeSingle(){ single = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(result()).then(res, rej); } };
      return api;
    },
    rpc(name, args){ log.push({ op: 'rpc', name, args }); return Promise.resolve({ data: (rpcValues || {})[name] !== undefined ? rpcValues[name] : 7, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) },
  };
}

function appWith(seed, log, features, extra){
  const app = loadApp({ supabaseClient: fakeClient(Object.assign({ }, seed || {}), log || [], extra && extra.rpc), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__saved = 0; saveAppFeatures = async () => { window.__saved++; }; afterAppFeaturesChanged = () => {};
    afterCrmGradesChanged = () => {}; showInfoModal = h => { window.__modal = h; }; closeCrmModal = () => {};
    crmCurrentTerm = () => (${JSON.stringify(TERM)}); crmSectionLabel = () => 'ش';
    crmSections = [{ id: 'S' }];
    crmStudents = [{ id: 'a', full_name: 'أحمد', section_id: 'S' }, { id: 'b', full_name: 'بدر', section_id: 'S' }, { id: 'c', full_name: 'جابر', section_id: 'S' }];
    calendarRegion = null;
    appFeatures = ${JSON.stringify(features || { sections: {}, tools: {} })};
    ${(extra && extra.code) || ''}`);
  return app;
}
const get = (app, e) => runInAppContext(app, e);

function wizApp(seed, features, code){
  const log = [];
  const app = appWith(seed || {}, log, features || { sections: {}, tools: {} }, { code: `
    crmSections = [{ id: 'S' }, { id: 'S2' }, { id: 'S3' }]; crmSectionLabel = id => 'ش' + id;
    crmCustomTools = ${JSON.stringify(TOOLS)}; crmCustomToolsLoaded = true;
    crmGradesSectionId = () => 'S'; window.__renders = 0; renderCrmGrades = () => { window.__renders++; };
    window.__box = { outerHTML: '' }; { const _g = document.getElementById; document.getElementById = id => id === 'crmGradeWizard' ? window.__box : _g(id); }
    ${code || ''}` });
  return { app, log };
}
const html = app => get(app, 'crmGradeWizardHtml()');

test('gradeWizardComponents — الهيكل الافتراضي مختار (10 + 10 + 20)، وأدوات الأداء الخاصة غير مختارة، والمخفية لا تظهر', () => {
  const { app } = wizApp();
  const comps = JSON.parse(JSON.stringify(app.gradeWizardComponents(app.gradeSheetSeed([]), TOOLS)));
  assert.deepEqual(comps.map(c => c.id + ':' + c.max + ':' + c.on), ['kind:participation:10:true', 'kind:homework:10:true', 'kind:task:20:true', 'tool:' + TOOL_ID + ':5:false']);
});

test('gradeWizardColumns — اختباران بأسماء جاهزة من 20، وعمود أداة قائم لا يتكرر، والأداء يُصغَّر فقط إن تجاوز المتبقي', () => {
  const { app } = wizApp();
  const w = { comps: [{ id: 'kind:participation', name: 'مشاركة', kind: 'participation', max: 10, on: true }, { id: 'kind:homework', name: 'واجبات', kind: 'homework', max: 10, on: false },
    { id: 'kind:task', name: 'مهام أدائية', kind: 'task', max: 25, on: true }, { id: 'tool:' + TOOL_ID, name: 'قراءة', kind: 'manual', tool_id: TOOL_ID, max: 5, on: true }], tests: 2 };
  const cols = JSON.parse(JSON.stringify(app.gradeWizardColumns(w, [])));
  assert.deepEqual(cols.map(c => c.category + ':' + c.name + ':' + c.max_score + ':' + c.kind + ':' + c.tool_id), [
    'performance:مشاركة:10:participation:null', 'performance:مهام أدائية:25:task:null', 'performance:قراءة:5:manual:' + TOOL_ID,
    'tests:الاختبار الأول:20:manual:null', 'tests:الاختبار الثاني:20:manual:null']);
  const withTool = JSON.parse(JSON.stringify(app.gradeWizardColumns(w, [{ id: 'X', category: 'performance', max_score: 10, tool_id: TOOL_ID }])));
  assert.ok(!withTool.some(c => c.tool_id === TOOL_ID), 'عمود الأداة قائم');
  assert.equal(withTool.filter(c => c.category === 'performance').reduce((a, c) => a + c.max_score, 0), 30, 'صُغِّر إلى المتبقي 30');
});

test('الخطوة ١ — مربّع لكل مكوّن، ودرجته بـ − و +، والمجموع لا يتجاوز 40، والتالي معطّل إن تجاوز', () => {
  const { app } = wizApp();
  let h = html(app);
  assert.match(h, /إنشاء الكشف — الخطوة 1 من 3/);
  assert.match(h, /40 من 40 ✓/);
  assert.match(h, /aria-checked="true"[\s\S]*المشاركة|aria-checked="true"[\s\S]*مشاركة/);
  assert.doesNotMatch(h, /قراءة <b>/, 'اسم الأداة مُهرَّب');
  assert.match(h, /قراءة &lt;b&gt;/);
  app.stepGradeWizardComp(0, 1);
  assert.equal(get(app, 'crmGradeWizard.comps[0].max'), 10, 'المجموع مكتمل: لا زيادة');
  app.toggleGradeWizardComp(1);
  assert.match(html(app), /30 من 40 — المتبقي 10/);
  app.toggleGradeWizardComp(3);
  assert.equal(get(app, 'crmGradeWizard.comps[3].on'), true);
  for(let i = 0; i < 30; i++) app.stepGradeWizardComp(3, 1);
  assert.equal(get(app, 'crmGradeWizard.comps[3].max'), 10, 'حتى المتبقي فقط');
  app.toggleGradeWizardComp(1);
  assert.equal(get(app, 'crmGradeWizard.comps[1].on'), false, 'المجموع مكتمل: لا يُضاف مكوّن');
  assert.match(get(app, 'window.__toasts.join("|")'), /المجموع مكتمل/);
});

test('الخطوة ٢ و٣ — الأصل اختباران، والفترات لكل مكوّن مختار، والملخص', () => {
  const { app } = wizApp();
  html(app);
  app.gradeWizardGo(2);
  let h = html(app);
  assert.match(h, /class="is-on" aria-pressed="true" onclick="setGradeWizardTests\(2\)"/);
  assert.match(h, /الاختبار الأول[\s\S]*الاختبار الثاني/);
  app.setGradeWizardTests(3);
  app.gradeWizardGo(3);
  app.setGradeWizardPeriods('kind:participation', 2);
  h = html(app);
  assert.match(h, /setGradeWizardPeriods\('kind:participation', 2\)/);
  assert.match(h, /الاختبارات 20<\/span><span>3 اختبارات/);
  assert.match(h, /مشاركة: فترتان/);
  assert.match(h, /✓ إنشاء الكشف لكل شعبي/);
});

test('الإنشاء — الإعدادات بحفظ واحد، ثم أعمدة كل شعبة بلا كشف باسم المعلم (لا تكرار بالنقر مرتين)', async () => {
  const seed = { classroom_grade_columns: [
    { id: 'e1', teacher_id: 'u1', section_id: 'S2', academic_year: TERM.year, semester: 1, category: 'performance', name: 'مشاركة', max_score: 10, kind: 'participation', tool_id: null },
    { id: 'x1', teacher_id: 'u2', section_id: 'S3', academic_year: TERM.year, semester: 1, category: 'performance', name: 'مشاركة', max_score: 10, kind: 'participation', tool_id: null }] };
  const { app, log } = wizApp(seed);
  html(app);
  app.toggleGradeWizardComp(1);
  app.gradeWizardGo(2);
  app.setGradeWizardTests(1);
  app.gradeWizardGo(3);
  app.setGradeWizardPeriods('kind:task', 3);
  await Promise.all([app.createGradeSheetFromWizard(), app.createGradeSheetFromWizard()]);
  assert.equal(get(app, 'window.__saved'), 1, 'حفظ واحد للإعدادات');
  assert.equal(get(app, 'appFeatures.tools.homework'), false, 'الواجبات غير مختارة: أداتها مخفية');
  assert.deepEqual(JSON.parse(JSON.stringify(get(app, `appFeatures.periods['${TERM.year}|1']`))), { 'kind:task': { n: 3, starts: [] } });
  const ins = log.filter(l => l.op === 'insert');
  assert.deepEqual(ins.map(l => [...l.values][0].section_id), ['S', 'S3'], 'S2 لها كشف؛ وكشف معلم آخر في S3 لا يُحسب');
  ins.forEach(l => assert.ok([...l.values].every(r => r.teacher_id === 'u1' && r.academic_year === TERM.year && r.semester === 1)));
  assert.deepEqual([...ins[0].values].map(r => r.category + ':' + r.name + ':' + r.max_score), ['performance:مشاركة:10', 'performance:مهام أدائية:20', 'tests:الاختبار الأول:20']);
  const sel = log.filter(l => l.table === 'classroom_grade_columns' && l.op === 'select');
  assert.ok(sel.every(l => l.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1')));
  assert.equal(get(app, 'crmGradeWizard'), null);
  assert.match(get(app, 'window.__toasts.join("|")'), /أُنشئ الكشف لـ 2 شعب/);
});

test('انحدار: فشل حفظ الإعدادات — لا أعمدة تُنشأ، والزر يعود', async () => {
  const { app, log } = wizApp({}, null, `saveAppFeatures = async () => { appFeatures = appFeaturesSaved; };`);
  html(app);
  app.gradeWizardGo(3);
  await app.createGradeSheetFromWizard();
  assert.equal(log.filter(l => l.op === 'insert').length, 0);
  assert.equal(get(app, 'crmGradeWizard.saving'), false);
});

test('الاختبارات مخفية — الخطوة ١ تنتقل للفترات مباشرة، ولا أعمدة اختبارات', async () => {
  const { app, log } = wizApp({}, { sections: {}, tools: { tests: false } });
  assert.match(html(app), /onclick="gradeWizardGo\(3\)"[^>]*>التالي: الفترات/);
  app.gradeWizardGo(3);
  await app.createGradeSheetFromWizard();
  assert.ok(log.filter(l => l.op === 'insert').every(l => [...l.values].every(r => r.category === 'performance')));
});

test('انحدار: هيكل الفصل السابق يحلّ محل الافتراضي، إلا إن بدأ المعلم التعديل قبل وصوله', async () => {
  const prev = [{ teacher_id: 'u1', section_id: 'S', academic_year: '1447-1448', semester: 2, category: 'performance', name: 'مشاركة', max_score: 15, kind: 'participation', tool_id: null, position: 0 },
    { teacher_id: 'u1', section_id: 'S', academic_year: '1447-1448', semester: 2, category: 'performance', name: 'بحث', max_score: 25, kind: 'manual', tool_id: null, position: 1 }];
  const a = wizApp({ classroom_grade_columns: prev });
  html(a.app);
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual([...get(a.app, 'crmGradeWizard.comps.map(c => c.id + ":" + c.max)')].slice(0, 2), ['kind:participation:15', 'name:بحث:25']);
  const b = wizApp({ classroom_grade_columns: prev });
  html(b.app);
  b.app.toggleGradeWizardComp(1);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(get(b.app, 'crmGradeWizard.comps[0].id'), 'kind:participation');
  assert.equal(get(b.app, 'crmGradeWizard.comps[1].id'), 'kind:homework', 'تعديل المعلم لا يُكتب فوقه');
});

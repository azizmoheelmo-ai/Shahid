'use strict';
/* ============================================================
   "يبدأ من": 0 (الأصل) أو الكاملة — المشاركة والواجبات والعدّادات الخاصة
   - من الكاملة: الكل يبدأ بالدرجة الكاملة، والنقرة −1 (والصفر درجة حقيقية).
   - الواجبات من الكاملة: الكل "سلّم"، والنقرة الأولى "لم يسلّم".
   - تغيير الخيار يعيد الكل لنقطة البداية في كل الشعب — بعد تأكيد صريح.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };
const TOOL_ID = '11111111-2222-3333-4444-555555555555';

function fakeClient(seed, log, opts){
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table){
      const f = []; let op = 'select', values = null, options = null, single = false;
      const result = () => {
        if(op !== 'select'){ log.push({ table, op, values, options, filters: f.slice() }); return { data: op === 'insert' ? (single ? { id: 'HW-NEW' } : [{ id: 'HW-NEW' }]) : null, error: null }; }
        const rows = match(seed[table], f);
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const api = { select(){ return api; }, eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; }, order(){ return api; }, limit(){ return api; },
        insert(r){ op = 'insert'; values = r; return api; }, upsert(r, o){ op = 'upsert'; values = r; options = o; return api; },
        update(r){ op = 'update'; values = r; return api; }, delete(){ op = 'delete'; return api; },
        single(){ single = true; return Promise.resolve(result()); }, maybeSingle(){ single = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(result()).then(res, rej); } };
      return api;
    },
    rpc(name, args){ log.push({ op: 'rpc', name, args }); return Promise.resolve({ data: opts.rpcValue !== undefined ? opts.rpcValue : 9, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) },
  };
}

function appWith(seed, log, features, opts){
  const app = loadApp({ supabaseClient: fakeClient(seed || {}, log || [], opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__confirm = []; window.__answer = true; showConfirm = async m => { window.__confirm.push(m); return window.__answer; };
    window.__saved = 0; saveAppFeatures = async () => { window.__saved++; }; afterAppFeaturesChanged = () => {}; renderCrmGrades = () => {};
    afterCrmGradesChanged = () => {}; window.__synced = []; loadCrmGradeSheet = async id => { window.__synced.push(id); };
    crmCurrentTerm = () => (${JSON.stringify(TERM)}); crmSectionLabel = () => 'ش';
    crmSections = [{ id: 'S' }, { id: 'S2' }];
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }, { id: 'b', full_name: 'ب', section_id: 'S' }, { id: 'c', full_name: 'ج', section_id: 'S2' }];
    appFeatures = ${JSON.stringify(features || { sections: {}, tools: {} })};`);
  return app;
}
const get = (app, e) => runInAppContext(app, e);
const col = (id, s, kind, max, extra) => Object.assign({ id, teacher_id: 'u1', section_id: s, academic_year: TERM.year, semester: 1, category: 'performance', kind, tool_id: null, name: kind, max_score: max }, extra || {});

test('normalizeFeatures — يحفظ "يبدأ من الكاملة" للمفاتيح الصالحة فقط', async () => {
  const app = loadApp();
  const out = app.normalizeFeatures({ startFull: { participation: true, homework: false, ['tool:' + TOOL_ID]: true, tasks: true, 'tool:x': true } });
  assert.deepEqual(JSON.parse(JSON.stringify(out.startFull)), { participation: true, ['tool:' + TOOL_ID]: true });
  assert.equal(app.normalizeFeatures({}).startFull, undefined);
});

test('nextHomeworkState — من الكاملة: سلّم ← لم يسلّم ← ناقص ← متأخر ← سلّم؛ والأصل كما هو', async () => {
  const app = loadApp();
  assert.equal(app.nextHomeworkState('submitted', true), 'missing');
  assert.equal(app.nextHomeworkState('missing', true), 'partial');
  assert.equal(app.nextHomeworkState('late', true), 'submitted');
  assert.equal(app.nextHomeworkState('missing'), 'submitted');
});

async function partSheet(scores, opts){
  const log = [];
  const seed = { classroom_grade_columns: [col('P', 'S', 'participation', 10)], classroom_grade_scores: scores || [] };
  const app = appWith(seed, log, { sections: {}, tools: {}, startFull: { participation: true } }, opts);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 1, token: 1, mode: 'participation', states: {} };`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  return { app, log };
}

test('المشاركة من الكاملة — من لا درجة له يأخذ الكاملة باسم المعلم بلا كتابة فوق رصد قائم، والنقرة −1 والصفر يبقى', async () => {
  const { app, log } = await partSheet([{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6 }], { rpcValue: 5 });
  const fill = log.find(l => l.op === 'upsert');
  assert.deepEqual(JSON.parse(JSON.stringify(fill.values)), [{ teacher_id: 'u1', column_id: 'P', student_id: 'b', score: 10 }]);
  assert.equal(fill.options.ignoreDuplicates, true);
  assert.equal(get(app, 'crmSheet.part.scores.get("b")'), 10);
  assert.match(get(app, `document.getElementById('crmLessonSheetBody').innerHTML`), /تبدأ الدرجة كاملة/);
  app.tapCrmParticipation('a');
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 5);
  await get(app, 'crmSheet.part.queue.get("a")');
  const rpc = log.find(l => l.op === 'rpc');
  assert.deepEqual(JSON.parse(JSON.stringify(rpc.args)), { p_column_id: 'P', p_student_id: 'a', p_delta: -1, p_keep_zero: true });
  app.undoCrmParticipation();
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 6, 'التراجع +1');
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(log.filter(l => l.op === 'rpc')[1].args.p_delta, 1);
});

test('المشاركة من الكاملة — عند الصفر لا تُرسل نقرة، والصفر المحفوظ لا يُحذف', async () => {
  const { app, log } = await partSheet([{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 1 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', score: 0 }], { rpcValue: 0 });
  app.tapCrmParticipation('b');
  assert.equal(log.filter(l => l.op === 'rpc').length, 0);
  assert.match(get(app, 'window.__toasts.join("|")'), /صفر/);
  app.tapCrmParticipation('a');
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 0, 'صفر حقيقي لا "لم تُرصد"');
});

test('واجب جديد والواجبات من الكاملة — كل طلاب الشعبة "سلّم" باسم المعلم', async () => {
  const log = [];
  const app = appWith({}, log, { sections: {}, tools: {}, startFull: { homework: true } });
  runInAppContext(app, `crmHomeworkDraft = { sectionId: 'S', saving: false }; afterCrmHomeworkChanged = async () => {}; closeCrmModal = () => {};
    { const _g = document.getElementById; document.getElementById = id => id === 'crmHwTitle' ? { value: 'تمارين' } : id === 'crmHwDue' ? { value: '2026-10-25' } : _g(id); }`);
  await app.saveCrmHomework();
  const up = log.find(l => l.table === 'classroom_homework_status' && l.op === 'upsert');
  assert.deepEqual([...up.values].map(r => r.student_id + ':' + r.status + ':' + r.teacher_id + ':' + r.homework_id), ['a:submitted:u1:HW-NEW', 'b:submitted:u1:HW-NEW']);
});

test('تغيير "يبدأ من" للمشاركة — بعد تأكيد: يُمسح المرصود في كل الشعب ويأخذ الكل الكاملة، ويُحفظ الخيار؛ والإلغاء لا يكتب', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [col('P', 'S', 'participation', 10), col('P2', 'S2', 'participation', 5), col('H', 'S', 'homework', 10), col('X', 'S', 'participation', 10, { teacher_id: 'u2' })] };
  const app = appWith(seed, log);
  runInAppContext(app, 'window.__answer = false;');
  await app.setGradeStartMode('participation', true);
  assert.equal(log.filter(l => l.op !== 'select').length, 0, 'الإلغاء لا يكتب');
  assert.match(get(app, 'window.__confirm[0]'), /يأخذ كل الطلاب الدرجة الكاملة الآن في كل شعبك، ويُمسح ما رصدته/);
  runInAppContext(app, 'window.__answer = true;');
  await app.setGradeStartMode('participation', true);
  const del = log.find(l => l.op === 'delete');
  assert.deepEqual(Object.fromEntries(del.filters.map(([c, v]) => [c, Array.isArray(v) ? [...v].sort() : v])), { teacher_id: 'u1', column_id: ['P', 'P2'] });
  const up = log.find(l => l.op === 'upsert');
  assert.deepEqual([...up.values].map(r => r.column_id + ':' + r.student_id + ':' + r.score + ':' + r.teacher_id), ['P:a:10:u1', 'P:b:10:u1', 'P2:c:5:u1']);
  assert.equal(get(app, 'appFeatures.startFull.participation'), true);
  assert.equal(get(app, 'window.__saved'), 1);
  assert.deepEqual([...get(app, 'window.__synced')], ['S', 'S2']);
});

test('تغيير "يبدأ من" للواجبات إلى 0 — يُمسح التسليم في واجبات الفصل لشعب المعلم، ولا "سلّم" جديد', async () => {
  const log = [];
  const seed = { classroom_homework: [{ id: 'h1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1 }, { id: 'h9', teacher_id: 'u1', section_id: 'S', academic_year: '1447-1448', semester: 1 }] };
  const app = appWith(seed, log, { sections: {}, tools: {}, startFull: { homework: true } });
  await app.setGradeStartMode('homework', false);
  const del = log.find(l => l.op === 'delete');
  assert.deepEqual(Object.fromEntries(del.filters.map(([c, v]) => [c, Array.isArray(v) ? [...v] : v])), { teacher_id: 'u1', homework_id: ['h1'] });
  assert.equal(log.filter(l => l.op === 'upsert').length, 0);
  assert.equal(get(app, 'gradeStartsFull("homework")'), false);
});

test('إعداد الدرجات — "يبدأ من [0][الكاملة]" للمشاركة والواجبات والعدّاد الخاص فقط', async () => {
  const app = appWith({}, [], { sections: {}, tools: {}, startFull: { homework: true } });
  runInAppContext(app, `crmCustomTools = [{ id: '${TOOL_ID}', name: 'قراءة', tool_type: 'counter', category: 'performance', max_score: 5, hidden: false }, { id: 'S-T', name: 'بحوث', tool_type: 'status', category: 'performance', max_score: 2, hidden: false }]; crmCustomToolsLoaded = true;`);
  const cols = [col('P', 'S', 'participation', 10), col('H', 'S', 'homework', 10), col('K', 'S', 'task', 10), col('R', 'S', 'manual', 5, { tool_id: '${TOOL_ID}'.replace('${TOOL_ID}', TOOL_ID), name: 'قراءة' }), col('B', 'S', 'manual', 5, { tool_id: 'S-T', name: 'بحوث' })];
  const html = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] });
  assert.match(html, /setGradeStartMode\('participation', true\)/);
  assert.match(html, /<button type="button" class="is-on" onclick="setGradeStartMode\('homework', true\)">الكاملة/, 'الواجبات على الكاملة');
  assert.match(html, new RegExp(`setGradeStartMode\\('tool:${TOOL_ID}', true\\)`));
  assert.doesNotMatch(html, /setGradeStartMode\('task'/);
  assert.doesNotMatch(html, /setGradeStartMode\('tool:S-T'/);
});

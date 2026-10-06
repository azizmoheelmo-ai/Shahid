'use strict';
/* ============================================================
   خطط الحصص القادمة (app-19-lesson-plans.js)
   ------------------------------------------------------------
   الدورة: أخطط ← أنفّذ في الحصة ← أوثّق. الخطة في جدول مستقل (lesson_plans)
   ولا تصير شاهدًا إلا بعد التنفيذ والحفظ — فلا تُحسب في الإنجاز أو التغطية
   أو لوحة المسؤول وهي لم تُنفّذ.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

test('nextSchoolDay — الغد، والجمعة/السبت تُرحَّل للأحد', async () => {
  const app = loadApp();
  assert.equal(app.nextSchoolDay('2026-10-06'), '2026-10-07'); // ثلاثاء ← أربعاء
  assert.equal(app.nextSchoolDay('2026-10-08'), '2026-10-11'); // خميس ← أحد
  assert.equal(app.nextSchoolDay('2026-10-09'), '2026-10-11'); // جمعة ← أحد
});

test('planLessonsForDay — حصص الجدول في ذلك اليوم', async () => {
  const app = loadApp();
  const slots = [
    { weekday: 3, period: 5, section_id: 'B' }, { weekday: 3, period: 2, section_id: 'A' }, { weekday: 1, period: 1, section_id: 'A' },
  ];
  assert.deepEqual([...app.planLessonsForDay(slots, '2026-10-07')].map(x => x.period + x.section_id), ['2A', '5B']); // أربعاء
});

test('classifyPlans — اليوم / القادمة / لم توثّق', async () => {
  const app = loadApp();
  const p = (id, date, status) => ({ id, planned_date: date, status: status || 'planned' });
  const plans = [p('t', '2026-10-06'), p('u', '2026-10-09'), p('far', '2026-10-30'), p('o', '2026-10-02'), p('old', '2026-09-20'), p('d', '2026-10-05', 'done'), p('c', '2026-10-06', 'cancelled')];
  const c = app.classifyPlans(plans, '2026-10-06');
  assert.deepEqual([...c.today].map(x => x.id), ['t']);
  assert.deepEqual([...c.upcoming].map(x => x.id), ['u', 'far'], 'كل القادمة مرتبة — لا تختفي خطة بعيدة');
  assert.deepEqual([...c.overdue].map(x => x.id), ['o'], 'لم توثّق: آخر 7 أيام فقط');
});

test('buildPlanRows — خطة لكل حصة مختارة، أو واحدة بلا حصة', async (t) => {
  const app = loadApp();
  const content = { element_key: 'تحسين نتائج المتعلمين', template_name: 'خطة مراجعة قبل الاختبار', title: 'مراجعة الوحدة 2', description: 'و', goal: 'ه', steps: ['أ', 'ب'] };
  await t.test('عدة شعب', () => {
    const rows = app.buildPlanRows(content, '2026-10-07', [{ section_id: 'A', period: 2 }, { section_id: 'B', period: 5 }], 'u1');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.section_id + r.period), ['A2', 'B5']);
    assert.ok(rows.every(r => r.user_id === 'u1' && r.planned_date === '2026-10-07' && r.status === 'planned'));
    assert.deepEqual([...rows[0].steps], ['أ', 'ب']);
  });
  await t.test('بلا حصة محددة', () => {
    const rows = app.buildPlanRows(content, '2026-10-07', [], 'u1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].section_id, null);
    assert.equal(rows[0].period, null);
  });
});

test('buildPlanShahidFields — الشاهد من الخطة بعد التنفيذ', async (t) => {
  const app = loadApp();
  const plan = { element_key: 'تحسين نتائج المتعلمين', title: 'مراجعة الوحدة 2', description: 'مراجعة شاملة', goal: 'رفع الاستعداد', steps: ['أ', 'ب'], planned_date: '2026-10-07', created_at: '2026-10-05T08:00:00Z' };
  const tpl = { name: 'خطة مراجعة قبل الاختبار', quant: 'نسبة الإجابات الصحيحة', qual: 'تفاعل', reflection: 'ما الذي أعدّله' };
  await t.test('نُفّذت في موعدها: التاريخ موعد الخطة، وسطر "خُطط لها مسبقًا"', () => {
    const f = app.buildPlanShahidFields(plan, tpl, '2026-10-07');
    assert.equal(f.date, '2026-10-07');
    assert.match(f.description, /^مراجعة شاملة/);
    assert.match(f.description, /خُطط لهذا الإجراء مسبقًا في 2026-10-05 ونُفّذ في 2026-10-07/);
    assert.deepEqual([...f.steps], ['أ', 'ب']);
    assert.equal(f.quant, 'نسبة الإجابات الصحيحة', 'حقول الأثر من النموذج نفسه');
  });
  await t.test('وُثّقت قبل موعدها (نُفّذت مبكرًا) = تاريخ اليوم', () => {
    assert.equal(app.buildPlanShahidFields(plan, null, '2026-10-06').date, '2026-10-06');
  });
  await t.test('بلا نموذج: حقول الأثر فارغة', () => {
    const f = app.buildPlanShahidFields(plan, null, '2026-10-07');
    assert.equal(f.quant, '');
  });
});

function scopedClient(seed, calls){
  return {
    from(table){
      const filters = [];
      const rows = () => (seed[table] || []).filter(r => filters.every(([c, v, op]) => op === 'gte' ? r[c] >= v : (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)));
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; },
        eq(c, v){ filters.push([c, v]); return api; }, gte(c, v){ filters.push([c, v, 'gte']); return api; },
        insert(r){ calls && calls.push({ table, op: 'insert', rows: r }); return { then(res){ setTimeout(() => res({ data: null, error: null }), 20); } }; },
        update(vals){ const f = []; const ch = { eq(c, v){ f.push([c, v]); return ch; }, then(res){ calls && calls.push({ table, op: 'update', vals, filters: f }); res({ data: null, error: null }); } }; return ch; },
        then(res){ res({ data: rows(), error: null }); },
      };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
}

test('loadLessonPlans — خطط المعلم الحالي فقط', async () => {
  const seed = { lesson_plans: [
    { id: 'a', user_id: 'u1', status: 'planned', planned_date: '2099-01-01' },
    { id: 'b', user_id: 'u2', status: 'planned', planned_date: '2099-01-01' },
    { id: 'c', user_id: 'u1', status: 'done', planned_date: '2099-01-01' },
  ] };
  const app = loadApp({ supabaseClient: scopedClient(seed), currentUser: { id: 'u1' } });
  const plans = await app.loadLessonPlans();
  assert.deepEqual([...plans].map(p => p.id), ['a']);
});

test('saveLessonPlan — نقرة مزدوجة لا تُنشئ الخطة مرتين، وباسم المعلم الحالي', async () => {
  const calls = [];
  const app = loadApp({ supabaseClient: scopedClient({}, calls), currentUser: { id: 'u1' } });
  const { runInAppContext } = require('./load-app');
  runInAppContext(app, `
    crmPlanDraft = { content: { element_key: 'ع', template_name: null, title: 'خطة', description: 'و', goal: '', steps: ['أ'] }, saving: false };
    showClassroomManagement = async () => {};
  `);
  const vals = { planDate: '2099-01-01', planTitle: 'مراجعة' };
  const realGet = app.document.getElementById;
  app.document.getElementById = (id) => (id in vals) ? { value: vals[id], disabled: false } : realGet(id);
  app.document.querySelectorAll = (sel) => sel === '.plan-target-cb'
    ? [{ checked: true, dataset: { section: 'A', period: '2' } }, { checked: true, dataset: { section: 'B', period: '' } }] : [];
  await Promise.all([app.saveLessonPlan(), app.saveLessonPlan()]);
  const ins = calls.filter(c => c.op === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].rows.length, 2, 'خطة لكل شعبة مختارة');
  assert.ok(ins[0].rows.every(r => r.user_id === 'u1' && r.title === 'مراجعة'));
  assert.equal(ins[0].rows[1].period, null);
});

test('markLessonPlanDone — مقيّدة بالمعلم الحالي', async () => {
  const calls = [];
  const app = loadApp({ supabaseClient: scopedClient({}, calls), currentUser: { id: 'u1' } });
  await app.markLessonPlanDone('P1', 'S1');
  const u = calls.find(c => c.op === 'update');
  assert.equal(u.vals.status, 'done');
  assert.equal(u.vals.shahid_id, 'S1');
  assert.ok(u.filters.some(([c, v]) => c === 'user_id' && v === 'u1'));
});

test('startNewShahid — يلغي سياق توثيق خطة سابقة (لا يُربط شاهد آخر بها)', async () => {
  const app = loadApp({ currentUser: { id: 'u1', user_metadata: {} } });
  const { runInAppContext } = require('./load-app');
  runInAppContext(app, `planShahidContext = { planId: 'P1' }; showForm = () => {};`);
  try{ app.startNewShahid(); } catch(e){}
  assert.equal(runInAppContext(app, 'planShahidContext'), null);
});

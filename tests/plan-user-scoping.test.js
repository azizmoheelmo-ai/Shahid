'use strict';
/* اختبار على loadPlan() (app-05-plan-goals.js): يتأكد أن استعلامات
   performance_goals / plan_header / shawahid تُفلتَر صراحة بمعرّف المستخدم
   الحالي (.eq('user_id', ...)) لا الاعتماد على RLS وحدها.

   هذا يحمي من خلل حقيقي صار لمستخدم فعلي: هذه الجداول الثلاثة لها أيضًا
   صلاحية "المسؤول يشوف الكل"، فبدون فلتر صريح، حساب مسؤول يرى صفوف كل
   المعلمين مجتمعة بمجرد وجود معلم آخر له بيانات بنفس دورة الأداء —
   performance_goals/shawahid تختلط ببيانات معلمين آخرين بصمت، وplan_header
   (عبر .maybeSingle، يتوقع صفًا واحدًا) يفشل فورًا بمجرد وجود صف ثانٍ من
   معلم آخر بنفس الدورة، برسالة PostgREST الحقيقية:
   "JSON object requested, multiple (or no) rows returned".

   راجع tests/load-app.js لتفاصيل آلية التحميل. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

/* عميل وهمي يطبّق فلاتر .eq() فعليًا على بيانات مزروعة (بعكس
   makeFakeSupabaseClient الافتراضي، ثابت الاستجابة) — ليحاكي RLS +
   "المسؤول يشوف الكل" معًا: نزرع صفوفًا لأكثر من مستخدم، والفلترة الحقيقية
   عبر .eq() هي الحاجز الوحيد بينها هنا، تمامًا كحال حساب مسؤول بالتطبيق
   الحقيقي. */
function makeScopedClient(seedByTable){
  function chain(table){
    const filters = [];
    const rowsFor = () => (seedByTable[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
    const api = {
      select(){ return api; },
      eq(col, val){ filters.push([col, val]); return api; },
      order(){ return api; },
      limit(){ return api; },
      maybeSingle: async () => {
        const rows = rowsFor();
        if(rows.length > 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
        return { data: rows[0] || null, error: null };
      },
      then(resolve){
        const result = { data: rowsFor(), error: null };
        resolve(result);
        return Promise.resolve(result);
      },
    };
    return api;
  }
  return {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: chain,
    storage: { from: () => ({}) },
    rpc: async () => ({ data: null, error: null }),
  };
}

describe('loadPlan — عزل بيانات كل مستخدم عن البقية (مهم لحسابات المسؤول)', () => {
  test('وجود صف معلم آخر بنفس دورة الأداء لا يكسر ولا يخلط بيانات المستخدم الحالي', async () => {
    const seed = {
      performance_goals: [
        { id: 'g-u1', user_id: 'u1', cycle_year: '2026/2027', element_key: 'أداء الواجبات الوظيفية', goal_order: 0, target_level: 5, target_count: 1 },
        { id: 'g-u2', user_id: 'u2', cycle_year: '2026/2027', element_key: 'أداء الواجبات الوظيفية', goal_order: 0, target_level: 2, target_count: 9 },
      ],
      plan_header: [
        { user_id: 'u1', cycle_year: '2026/2027', role_title: 'معلم رياضيات' },
        { user_id: 'u2', cycle_year: '2026/2027', role_title: 'معلم علوم' },
      ],
      shawahid: [
        { user_id: 'u1', element_key: 'أداء الواجبات الوظيفية', cycle_year: '2026/2027' },
        { user_id: 'u2', element_key: 'أداء الواجبات الوظيفية', cycle_year: '2026/2027' },
        { user_id: 'u2', element_key: 'أداء الواجبات الوظيفية', cycle_year: '2026/2027' },
      ],
    };
    const client = makeScopedClient(seed);
    const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });

    const result = await app.loadPlan('2026/2027');

    assert.equal(result.ok, true, 'ما يفشل رغم وجود صف plan_header لمعلم آخر بنفس الدورة');
    assert.equal(result.planHeader.role_title, 'معلم رياضيات', 'رأس الخطة يجب أن يكون رأس المستخدم الحالي، لا معلم آخر');
    assert.equal(result.myPlan['أداء الواجبات الوظيفية'].target_count, 1, 'الهدف يجب أن يعكس بيانات u1 فقط (1)، لا u2 (9)');
    assert.equal(result.planShahidCounts['أداء الواجبات الوظيفية'], 1, 'عدد الشواهد يجب أن يُحصى لـ u1 فقط (شاهد واحد)، لا شواهد u2 أيضًا');
  });
});

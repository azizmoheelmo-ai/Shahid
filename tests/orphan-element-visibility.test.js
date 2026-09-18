'use strict';
/* اختبار انحدار لخلل اكتُشف بمراجعة يدوية بعد ميزة "نشاط طلابي":
   renderShawahidGroups() (app-09) و renderPlanRows/renderPlanRowsReadOnly
   (app-05/app-04) و renderSelfRows/renderSelfRowsReadOnly (app-06) و
   buildCycleSheetAOA (app-08، تصدير النسخة الاحتياطية الشخصية) كل هذه كانت
   تكرّر فقط العناصر الحالية للمعلم (getElementsOrder()) بدل كل العناصر التي
   لها سجلات فعلية — فأي شاهد/هدف/تقييم ذاتي وُثِّق بعنصر نشاط طلابي أثناء
   تفعيل الخيار يختفي بصمت من الشاشة (لا من القاعدة) بمجرد إلغاء التفعيل، أو
   من نسخته الاحتياطية الشخصية عند تصديرها بعد ذلك. السجل نفسه يبقى محفوظًا،
   لكن يبدو للمعلم كأنه "ضاع". هذا الاختبار يغطي renderShawahidGroups تحديدًا
   (الأكثر أهمية للمعلم: قائمة "شواهدي المحفوظة"). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, runInAppContext } = require('./load-app.js');

function makeShawahidClient(seed){
  function chain(table){
    const filters = [];
    const rowsFor = () => (seed[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
    const api = {
      select(){ return api; },
      eq(c, v){ filters.push([c, v]); return api; },
      order(){ return api; },
      range(){ return api; },
      limit(){ return api; },
      maybeSingle: async () => ({ data: rowsFor()[0] || null, error: null }),
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

function makeLiveElement(){
  return { style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelector: () => makeLiveElement(),
    querySelectorAll: () => [], setAttribute(){}, getAttribute: () => null };
}
function installLiveDom(app){
  const registry = {};
  app.document.getElementById = (id) => (registry[id] = registry[id] || makeLiveElement());
}

describe('renderShawahidGroups: شواهد عنصر لم يعد ضمن قالب المعلم الحالي', () => {
  test('لا تختفي من "شواهدي المحفوظة" بعد إلغاء تفعيل "نشاط طلابي" (تبقى ظاهرة، لا تُحذف)', async () => {
    const seed = {
      shawahid: [
        { id: 's1', user_id: 'u1', element_key: 'basic', element_label: 'عنصر أساسي (10%)', lesson_title: 'حصة عادية', created_at: '2025-09-01', cycle_stage: 'planning', cycle_year: '2025/2026' },
        { id: 's2', user_id: 'u1', element_key: 'activity1', element_label: 'إعداد خطة مزمنة ومعتمدة لبرامج وفعاليات النشاط الطلابي (10%)', lesson_title: 'فعالية نادي القراءة', created_at: '2025-09-05', cycle_stage: 'planning', cycle_year: '2025/2026' },
      ],
    };
    const app = loadApp({ supabaseClient: makeShawahidClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    /* نحاكي معلمًا ألغى تفعيل "نشاط طلابي": القائمة الحالية لعناصره (كما
       تظهر بمربع اختيار العنصر) لا تضم إلا العنصر الأساسي — العنصر النشاط
       الطلابي (activity1) لم يعد ضمنها، رغم وجود شاهد محفوظ به سابقًا (s2) */
    runInAppContext(app, `
      elementSelect.options = [
        { value: 'basic', textContent: 'عنصر أساسي (10%)' }
      ];
    `);

    await app.loadMyShawahid();

    const html = app.document.getElementById('listBody').innerHTML;
    assert.match(html, /فعالية نادي القراءة/, 'شاهد العنصر غير المفعَّل حاليًا يجب أن يبقى ظاهرًا بالقائمة، لا أن يختفي بصمت');
    assert.match(html, /غير مفعَّل حاليًا/, 'يجب توضيح أن هذا العنصر غير ضمن قالب المعلم الحالي');
    assert.match(html, /حصة عادية/, 'شاهد العنصر النشط الأساسي يجب أن يظهر كالمعتاد');
  });
});

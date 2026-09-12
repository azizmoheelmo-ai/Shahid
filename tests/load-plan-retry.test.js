'use strict';
/* اختبار على loadPlan() (app-05-plan-goals.js): استعلام فاشل (خطأ شبكة، أو
   Supabase "بارد" لم يستيقظ بعد) لا يعود يُعامَل بصمت كـ"لا توجد بيانات" —
   الأرقام الحقيقية (الاكتمال الموزون، الأهداف المخطَّطة) لا يجب أن تظهر صفرًا
   بسبب عطل شبكة عابر. راجع tests/load-app.js لتفاصيل آلية التحميل. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeFakeSupabaseClient } = require('./load-app.js');

/* عميل Supabase وهمي يفشل استعلام جدول معيّن `failTable` أول N مرة بالضبط
   (N = failCount)، وينجح بعدها بالبيانات الحقيقية المُمرَّرة إليه. */
function makeFlakyClient({ failTable, failCount, seedData }){
  const base = makeFakeSupabaseClient();
  let callCount = 0;
  const origFrom = base.from;
  base.from = function(table){
    const chain = origFrom(table);
    if(table !== failTable) {
      /* لبقية الجداول: نُرجع البيانات المزروعة مباشرة بدل الفارغة الافتراضية */
      const rows = (seedData && seedData[table]) || [];
      chain.then = (resolve) => { resolve({ data: rows, error: null }); return Promise.resolve({ data: rows, error: null }); };
      chain.maybeSingle = async () => ({ data: rows[0] || null, error: null });
      return chain;
    }
    callCount++;
    const shouldFail = callCount <= failCount;
    const rows = (seedData && seedData[table]) || [];
    const result = shouldFail
      ? { data: null, error: { message: 'simulated transient failure #' + callCount } }
      : { data: rows, error: null };
    chain.then = (resolve) => { resolve(result); return Promise.resolve(result); };
    chain.maybeSingle = async () => result;
    return chain;
  };
  return { client: base, getCallCount: () => callCount };
}

describe('loadPlan — استعلام فاشل ثم إعادة محاولة', () => {
  test('فشل أول محاولة (performance_goals) ثم نجاح الثانية -> يُطبَّق الرقم الصحيح، لا صفر خاطئ', async () => {
    const seed = {
      performance_goals: [{
        id: 'g1', element_key: 'classroom_mgmt', cycle_year: '1447-1448',
        goal_name: 'هدف', target_level: 4, target_count: 2, goal_order: 1,
        personal_note: '', target_performance: '', success_indicators: [], recommended_evidence: [], action_steps: []
      }],
    };
    const { client, getCallCount } = makeFlakyClient({ failTable: 'performance_goals', failCount: 1, seedData: seed });
    const app = loadApp({ supabaseClient: client });

    const result = await app.loadPlan('1447-1448');

    assert.equal(getCallCount(), 2, 'يجب أن يُعاد الاستعلام مرة واحدة إضافية بعد الفشل الأول');
    assert.equal(result.ok, true);
    assert.equal(result.myPlan.classroom_mgmt.target_count, 2, 'يجب أن يعكس target_count الحقيقي من المحاولة الناجحة، لا صفرًا');
  });

  test('فشل المحاولتين معًا -> ok:false، بلا رمي استثناء', async () => {
    const seed = { performance_goals: [{ id: 'g1', element_key: 'x', cycle_year: '1447-1448', target_count: 5 }] };
    const { client, getCallCount } = makeFlakyClient({ failTable: 'performance_goals', failCount: 99, seedData: seed });
    const app = loadApp({ supabaseClient: client });

    const result = await app.loadPlan('1447-1448');

    assert.equal(result.ok, false);
    assert.ok(getCallCount() >= 2, 'يجب أن يحاول مرتين على الأقل قبل التسليم بالفشل');
  });

  test('نجاح من أول محاولة (بلا أي فشل) -> استعلام واحد فقط، لا تأخير إعادة محاولة', async () => {
    const seed = { performance_goals: [{ id: 'g1', element_key: 'y', cycle_year: '1447-1448', target_count: 3 }] };
    const { client, getCallCount } = makeFlakyClient({ failTable: 'performance_goals', failCount: 0, seedData: seed });
    const app = loadApp({ supabaseClient: client });

    const start = Date.now();
    const result = await app.loadPlan('1447-1448');
    const elapsed = Date.now() - start;

    assert.equal(getCallCount(), 1);
    assert.equal(result.ok, true);
    assert.ok(elapsed < 1000, 'لا يجب انتظار مهلة إعادة المحاولة إن نجح الاستعلام من أول مرة');
  });
});

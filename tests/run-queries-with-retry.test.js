'use strict';
/* اختبارات على runQueriesWithRetry (app-03-auth-home-risk.js) — الآلية
   المشتركة التي يعتمد عليها مركز التنبيهات (buildAdminRisks/buildAcademicRisks)
   وشارات "إدارة الصف"/"المتابعة الأكاديمية" (getTransferCounts) لتفادي
   معاملة استعلام فاشل (خطأ شبكة، أو Supabase لم يستيقظ بعد) كـ"لا توجد
   تنبيهات/عناصر معلّقة" خاطئة. راجع tests/load-app.js لتفاصيل آلية التحميل. */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

let app;
before(() => {
  app = loadApp();
});

function ok(data){ return async () => ({ data, error: null }); }
function fail(msg){ return async () => ({ data: null, error: { message: msg } }); }

describe('runQueriesWithRetry', () => {
  test('كل الاستعلامات ناجحة من أول مرة -> ok:true، بلا أي إعادة محاولة', async () => {
    const start = Date.now();
    const { ok: success, results } = await app.runQueriesWithRetry([ok([1, 2]), ok(['a'])]);
    const elapsed = Date.now() - start;
    assert.equal(success, true);
    assert.equal(JSON.stringify(results.map(r => r.data)), JSON.stringify([[1, 2], ['a']]));
    assert.ok(elapsed < 500, 'لا يجب أي تأخير إن نجحت كل الاستعلامات من أول مرة');
  });

  test('استعلام واحد فاشل من ضمن عدة استعلامات -> يُعاد الكل ويُصبح ناجحًا لو نجحت المحاولة الثانية', async () => {
    let calls = 0;
    const flaky = () => {
      calls++;
      return calls === 1 ? Promise.resolve({ data: null, error: { message: 'fail once' } }) : Promise.resolve({ data: [42], error: null });
    };
    const { ok: success, results } = await app.runQueriesWithRetry([ok([1]), flaky]);
    assert.equal(success, true);
    assert.equal(calls, 2, 'الاستعلام المتعثر يجب أن يُعاد مرة واحدة إضافية');
    assert.equal(JSON.stringify(results[1].data), JSON.stringify([42]));
  });

  test('فشل مستمر (المحاولتان معًا) -> ok:false، بلا رمي استثناء', async () => {
    const { ok: success } = await app.runQueriesWithRetry([ok([1]), fail('always fails')]);
    assert.equal(success, false);
  });
});

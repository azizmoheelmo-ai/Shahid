'use strict';
/* ============================================================
   اختبار getOnboardingSteps (الجولة التعريفية لأي معلم جديد).
   أُلغي "المسار السريع" بالكامل بطلب صريح من المستخدم — التطبيق شامل
   للجميع، فالجولة واحدة دائمًا. وأسماء خطواتها يجب أن تطابق أسماء التنقّل
   الفعلية بعد إعادة تنظيمه ("أدائي"/"الشواهد"/"التقييم الذاتي")، لا الأسماء
   القديمة ("خطتي"/"شواهدي"/"تقييمي الذاتي") التي لم يعد لها أي زر بالواجهة.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

test('getOnboardingSteps', async (t) => {
  await t.test('أول خطوة هي الترحيب', () => {
    const app = loadApp();
    assert.match(app.getOnboardingSteps()[0].title, /مرحبًا بك/);
  });

  await t.test('تذكر الأسماء الحالية للتنقّل: أدائي، الشواهد، التقييم الذاتي', () => {
    const app = loadApp();
    const text = app.getOnboardingSteps().map(s => s.title + ' ' + s.body).join(' | ');
    assert.match(text, /أدائي/);
    assert.match(text, /الشواهد/);
    assert.match(text, /التقييم الذاتي/);
  });

  await t.test('لا تذكر أسماء أزرار لم تعد موجودة (خطتي/شواهدي/تقييمي الذاتي/المسار السريع)', () => {
    const app = loadApp();
    const text = app.getOnboardingSteps().map(s => s.title + ' ' + s.body).join(' | ');
    ['خطتي', 'شواهدي', 'تقييمي الذاتي', 'المسار السريع'].forEach(oldName => {
      assert.ok(!text.includes(oldName), `اسم قديم "${oldName}" لا يزال بالجولة: ${text}`);
    });
  });
});

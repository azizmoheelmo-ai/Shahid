'use strict';
/* ============================================================
   اختبارات المسار السريع/الشامل (ui_mode) — الدوال الصرفة فقط:
   getOnboardingSteps (تبني خطوات الجولة التعريفية حسب المسار)،
   وshouldShowUiModeBanner (متى يظهر بانر التعريف بالمسار السريع).
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

test('getOnboardingSteps', async (t) => {
  await t.test("mode='quick' لا يذكر خطتي ولا تقييمي الذاتي إطلاقًا", () => {
    const app = loadApp();
    const steps = app.getOnboardingSteps('quick');
    const titles = steps.map(s => s.title).join(' | ');
    assert.ok(!titles.includes('خطتي'), 'لا يجب ذكر "خطتي" بالمسار السريع: ' + titles);
    assert.ok(!titles.includes('تقييمي الذاتي'), 'لا يجب ذكر "تقييمي الذاتي" بالمسار السريع: ' + titles);
    assert.ok(titles.includes('شواهدي'), 'يجب أن تبقى خطوة شواهدي: ' + titles);
  });

  await t.test("mode='full' يذكر خطتي وتقييمي الذاتي وشواهدي", () => {
    const app = loadApp();
    const steps = app.getOnboardingSteps('full');
    const titles = steps.map(s => s.title).join(' | ');
    assert.match(titles, /خطتي/);
    assert.match(titles, /شواهدي/);
    assert.match(titles, /تقييمي الذاتي/);
  });

  await t.test('mode=null (لم يختر بعد) يُعامَل كـfull بالجولة أيضًا', () => {
    const app = loadApp();
    const stepsNull = app.getOnboardingSteps(null).map(s => s.title).join(' | ');
    const stepsFull = app.getOnboardingSteps('full').map(s => s.title).join(' | ');
    assert.equal(stepsNull, stepsFull);
  });

  await t.test('أول خطوة بكل الحالات هي الترحيب نفسه', () => {
    const app = loadApp();
    assert.match(app.getOnboardingSteps('quick')[0].title, /مرحبًا بك/);
    assert.match(app.getOnboardingSteps('full')[0].title, /مرحبًا بك/);
  });
});

test('shouldShowUiModeBanner', async (t) => {
  await t.test('لا يظهر إطلاقًا لمن اختار مسارًا صراحة (quick أو full)', () => {
    const app = loadApp();
    assert.equal(app.shouldShowUiModeBanner('quick', true), false);
    assert.equal(app.shouldShowUiModeBanner('full', true), false);
  });

  await t.test('لا يظهر لمن لم ينتهِ من الجولة التعريفية بعد (حتى لو لم يختر مسارًا)', () => {
    const app = loadApp();
    assert.equal(app.shouldShowUiModeBanner(null, false), false);
  });

  await t.test('يظهر فقط لمن أنهى الجولة ولم يختر مسارًا بعد (حساب جديد أو قديم بأثر رجعي)', () => {
    const app = loadApp();
    assert.equal(app.shouldShowUiModeBanner(null, true), true);
  });
});

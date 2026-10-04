'use strict';
/* ============================================================
   دوال صرفة للوحة الرئيسية:
   - arabicCountPhrase: صياغة العدد مع المعدود (3 مهام / 11 مهمة / مهمتان).
   - homeActionCardState: حالة بطاقة "يحتاج إجراء الآن" — أهم قاعدة فيها:
     لا "لا إجراء عاجل" إلا بعد فحص مكتمل فعلًا (لا رسالة "كل شيء تمام"
     مبنية على تحميل فاشل).
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

const TASK_FORMS = { one: 'مهمة واحدة', two: 'مهمتان', few: '{n} مهام', many: '{n} مهمة' };

test('arabicCountPhrase', async (t) => {
  await t.test('1 مفرد، 2 مثنى', () => {
    const app = loadApp();
    assert.equal(app.arabicCountPhrase(1, TASK_FORMS), 'مهمة واحدة');
    assert.equal(app.arabicCountPhrase(2, TASK_FORMS), 'مهمتان');
  });

  await t.test('3 إلى 10 جمع', () => {
    const app = loadApp();
    assert.equal(app.arabicCountPhrase(3, TASK_FORMS), '3 مهام');
    assert.equal(app.arabicCountPhrase(10, TASK_FORMS), '10 مهام');
  });

  await t.test('11 فأكثر مفرد', () => {
    const app = loadApp();
    assert.equal(app.arabicCountPhrase(11, TASK_FORMS), '11 مهمة');
    assert.equal(app.arabicCountPhrase(100, TASK_FORMS), '100 مهمة');
  });
});

test('homeActionCardState', async (t) => {
  await t.test('لا بنود وفحص مكتمل = "لا إجراء عاجل"', () => {
    const app = loadApp();
    assert.equal(app.homeActionCardState(0, 0, 'ok', true).mode, 'clear');
  });

  await t.test('فشل تحميل المهام/البرامج = بطاقة مخفية، لا "لا إجراء عاجل" كاذبة', () => {
    const app = loadApp();
    assert.equal(app.homeActionCardState(0, 0, 'ok', false).mode, 'hidden');
  });

  await t.test('تعذّر جلب التقويم = بطاقة مخفية، لا "لا إجراء عاجل" كاذبة', () => {
    const app = loadApp();
    assert.equal(app.homeActionCardState(0, 0, 'failed', true).mode, 'hidden');
  });

  await t.test('برامج بلا نطاق جغرافي = بند إجراء صريح لتحديده', () => {
    const app = loadApp();
    const s = app.homeActionCardState(0, 0, 'no_region', true);
    assert.equal(s.mode, 'items');
    assert.equal(s.items.length, 1);
    assert.equal(s.items[0].kind, 'region');
  });

  await t.test('مهام وحصص: بندان بصياغة عدد صحيحة', () => {
    const app = loadApp();
    const s = app.homeActionCardState(2, 1, 'ok', true);
    assert.equal(s.mode, 'items');
    assert.equal(s.items.map(i => i.kind).join(','), 'tasks,sessions');
    assert.equal(s.items[0].text, 'مهمتان مستحقتان هذا الأسبوع');
    assert.equal(s.items[1].text, 'حصة برنامج غير موثّقة');
  });

  await t.test('بنود معروفة تُعرض حتى لو فشل جزء من الفحص', () => {
    const app = loadApp();
    const s = app.homeActionCardState(3, 0, 'failed', true);
    assert.equal(s.mode, 'items');
    assert.equal(s.items[0].text, '3 مهام مستحقة هذا الأسبوع');
  });
});

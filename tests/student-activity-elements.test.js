'use strict';
/* اختبار انحدار لـ computeEffectiveElements (app-01-core.js) — الدالة
   المسؤولة عن حساب عناصر التقييم الفعّالة لمعلم معيّن بحسب تفعيله خيار
   "نشاط طلابي": تستبعد عناصر النشاط الطلابي عن معلم غير مفعِّلها، وتستبدل
   الوزن العادي بـ weight_activity لمعلم مفعِّلها (لو كان محددًا للعنصر). */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

let app;
before(() => {
  app = loadApp();
});

const RAW = [
  { key: 'a', label: 'أداء الواجبات الوظيفية', weight: 10, weight_activity: 10, requires_student_activity: false, sort_order: 1 },
  { key: 'b', label: 'التنويع في استراتيجيات التدريس', weight: 10, weight_activity: 5, requires_student_activity: false, sort_order: 2 },
  { key: 'c', label: 'إعداد خطة مزمنة لبرامج النشاط الطلابي', weight: 10, weight_activity: 10, requires_student_activity: true, sort_order: 3 },
  { key: 'd', label: 'يحفز المتعلمين على المشاركة في الأنشطة', weight: 10, weight_activity: 10, requires_student_activity: true, sort_order: 4 },
];

describe('computeEffectiveElements', () => {
  test('معلم غير مفعِّل "نشاط طلابي": يستبعد عناصر النشاط الطلابي تمامًا ويحتفظ بالوزن العادي', () => {
    const result = app.computeEffectiveElements(RAW, false);
    assert.deepEqual(result.map(e => e.key), ['a', 'b']);
    assert.equal(result.find(e => e.key === 'a').weight, 10);
    assert.equal(result.find(e => e.key === 'b').weight, 10);
  });

  test('معلم مفعِّل "نشاط طلابي": يضم الكل، ويستبدل الوزن العادي بـ weight_activity', () => {
    const result = app.computeEffectiveElements(RAW, true);
    assert.deepEqual(result.map(e => e.key), ['a', 'b', 'c', 'd']);
    assert.equal(result.find(e => e.key === 'a').weight, 10);
    assert.equal(result.find(e => e.key === 'b').weight, 5); // 10 -> 5 لمعلم النشاط الطلابي
    assert.equal(result.find(e => e.key === 'c').weight, 10);
  });

  test('weight_activity = null: يبقى الوزن العادي حتى لو مفعِّلًا', () => {
    const raw = [{ key: 'x', label: 'عنصر', weight: 7, weight_activity: null, requires_student_activity: false }];
    const result = app.computeEffectiveElements(raw, true);
    assert.equal(result[0].weight, 7);
  });

  test('لا يُعدّل المصفوفة الأصلية (immutability)', () => {
    const before = JSON.stringify(RAW);
    app.computeEffectiveElements(RAW, true);
    assert.equal(JSON.stringify(RAW), before);
  });

  test('مصفوفة فارغة أو null لا تُسبب خطأ', () => {
    assert.equal(app.computeEffectiveElements([], true).length, 0);
    assert.equal(app.computeEffectiveElements(null, true).length, 0);
  });
});

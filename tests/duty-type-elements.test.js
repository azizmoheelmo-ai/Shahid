'use strict';
/* اختبار انحدار لـ computeEffectiveElements (app-01-core.js) — الدالة
   المسؤولة عن حساب عناصر التقييم الفعّالة لمعلم معيّن بحسب نوع تكليفه
   الإضافي (dutyType: 'none' | 'student_activity' | 'health_guidance' | ...):
   تستبعد عناصر مخصَّصة لتكليف آخر (required_duty_type لا يطابق)، وتستبدل
   الوزن العادي بـ weight_with_duty لأي معلم عليه أي تكليف إضافي. */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

let app;
before(() => {
  app = loadApp();
});

const RAW = [
  { key: 'a', label: 'أداء الواجبات الوظيفية', weight: 10, weight_with_duty: 10, required_duty_type: null, sort_order: 1 },
  { key: 'b', label: 'التنويع في استراتيجيات التدريس', weight: 10, weight_with_duty: 5, required_duty_type: null, sort_order: 2 },
  { key: 'c', label: 'إعداد خطة مزمنة لبرامج النشاط الطلابي', weight: 10, weight_with_duty: 10, required_duty_type: 'student_activity', sort_order: 3 },
  { key: 'd', label: 'يحفز المتعلمين على المشاركة في الأنشطة', weight: 10, weight_with_duty: 10, required_duty_type: 'student_activity', sort_order: 4 },
  { key: 'e', label: 'تنفيذ الخطة المشتركة للبرامج الصحية المدرسية', weight: 15, weight_with_duty: 15, required_duty_type: 'health_guidance', sort_order: 5 },
  { key: 'وكيل: أداء الواجبات الوظيفية', label: 'أداء الواجبات الوظيفية', weight: 5, weight_with_duty: null, required_duty_type: 'vice_principal', sort_order: 6 },
  { key: 'وكيل: يدعم ويشارك في المبادرات النوعية', label: 'يدعم ويشارك في المبادرات النوعية', weight: 10, weight_with_duty: null, required_duty_type: 'vice_principal', sort_order: 7 },
  { key: 'مدير: أداء الواجبات الوظيفية', label: 'أداء الواجبات الوظيفية', weight: 5, weight_with_duty: null, required_duty_type: 'school_principal', sort_order: 8 },
  { key: 'مدير: يُسهم في تحسين مستوى أداء المدرسة', label: 'يُسهم في تحسين مستوى أداء المدرسة', weight: 10, weight_with_duty: null, required_duty_type: 'school_principal', sort_order: 9 },
  { key: 'موجه: أداء الواجبات الوظيفية', label: 'أداء الواجبات الوظيفية', weight: 20, weight_with_duty: null, required_duty_type: 'student_counselor', sort_order: 10 },
  { key: 'موجه: إعداد خُطة لبرامج التوجيه الطلابي', label: 'إعداد خُطة لبرامج التوجيه الطلابي', weight: 10, weight_with_duty: null, required_duty_type: 'student_counselor', sort_order: 11 },
];

describe('computeEffectiveElements', () => {
  test('معلم بلا تكليف إضافي (none): يستبعد عناصر كل التكليفات ويحتفظ بالوزن العادي', () => {
    const result = app.computeEffectiveElements(RAW, 'none');
    assert.deepEqual(result.map(e => e.key), ['a', 'b']);
    assert.equal(result.find(e => e.key === 'a').weight, 10);
    assert.equal(result.find(e => e.key === 'b').weight, 10);
  });

  test('معلم عليه تكليف "نشاط طلابي": يضم عناصره + الأساسية بوزن مخفَّض، ويستبعد عناصر تكليف آخر', () => {
    const result = app.computeEffectiveElements(RAW, 'student_activity');
    assert.deepEqual(result.map(e => e.key), ['a', 'b', 'c', 'd']);
    assert.equal(result.find(e => e.key === 'a').weight, 10);
    assert.equal(result.find(e => e.key === 'b').weight, 5); // 10 -> 5 لأي تكليف إضافي
    assert.equal(result.find(e => e.key === 'c').weight, 10);
  });

  test('معلم عليه تكليف "توجيه صحي": يضم عناصره فقط من بين عناصر التكليفات، لا عناصر النشاط الطلابي', () => {
    const result = app.computeEffectiveElements(RAW, 'health_guidance');
    assert.deepEqual(result.map(e => e.key), ['a', 'b', 'e']);
    assert.equal(result.find(e => e.key === 'e').weight, 15);
  });

  test('وكيل مدرسة: يضم عناصره فقط بوزنها المكتوب مباشرة، ويستبعد كل عناصر المعلم (الأساسية وعناصر التكليفات)', () => {
    const result = app.computeEffectiveElements(RAW, 'vice_principal');
    assert.deepEqual(result.map(e => e.key), ['وكيل: أداء الواجبات الوظيفية', 'وكيل: يدعم ويشارك في المبادرات النوعية']);
    assert.equal(result.find(e => e.key === 'وكيل: أداء الواجبات الوظيفية').weight, 5);
    assert.equal(result.find(e => e.key === 'وكيل: يدعم ويشارك في المبادرات النوعية').weight, 10);
  });

  test('مدير مدرسة: يضم عناصره فقط بوزنها المكتوب مباشرة، ويستبعد عناصر المعلم وعناصر الوكيل معًا', () => {
    const result = app.computeEffectiveElements(RAW, 'school_principal');
    assert.deepEqual(result.map(e => e.key), ['مدير: أداء الواجبات الوظيفية', 'مدير: يُسهم في تحسين مستوى أداء المدرسة']);
    assert.equal(result.find(e => e.key === 'مدير: يُسهم في تحسين مستوى أداء المدرسة').weight, 10);
  });

  test('موجه طلابي: يضم عناصره فقط بوزنها المكتوب مباشرة، ويستبعد عناصر المعلم والوكيل والمدير معًا', () => {
    const result = app.computeEffectiveElements(RAW, 'student_counselor');
    assert.deepEqual(result.map(e => e.key), ['موجه: أداء الواجبات الوظيفية', 'موجه: إعداد خُطة لبرامج التوجيه الطلابي']);
    assert.equal(result.find(e => e.key === 'موجه: أداء الواجبات الوظيفية').weight, 20);
  });

  test('weight_with_duty = null: يبقى الوزن العادي حتى مع تكليف إضافي', () => {
    const raw = [{ key: 'x', label: 'عنصر', weight: 7, weight_with_duty: null, required_duty_type: null }];
    const result = app.computeEffectiveElements(raw, 'student_activity');
    assert.equal(result[0].weight, 7);
  });

  test('لا يُعدّل المصفوفة الأصلية (immutability)', () => {
    const before = JSON.stringify(RAW);
    app.computeEffectiveElements(RAW, 'student_activity');
    assert.equal(JSON.stringify(RAW), before);
  });

  test('مصفوفة فارغة أو null لا تُسبب خطأ', () => {
    assert.equal(app.computeEffectiveElements([], 'student_activity').length, 0);
    assert.equal(app.computeEffectiveElements(null, 'student_activity').length, 0);
  });
});

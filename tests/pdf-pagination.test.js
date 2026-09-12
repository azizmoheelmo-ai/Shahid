'use strict';
/* اختبارات على منطق تقسيم صفحات PDF (تنزيل الخطة وملف الإنجاز) —
   computePdfSliceBoundaries هي الدالة الحسابية البحتة المسؤولة عن اختيار
   أين تُقطع كل صفحة، بحيث لا تُقطع أي عنصر عليه class="pdf-avoid-break"
   (قسم عنصر أداء كامل، أو هدف واحد) في منتصفه بين صفحتين.
   راجع tests/load-app.js لتفاصيل آلية التحميل. */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

let app;
before(() => {
  app = loadApp();
});

/* الدالة تُنفَّذ داخل سياق vm فتُرجع مصفوفات من ذاك السياق (نموذج أولي
   Array.prototype مختلف عن سياق ملف الاختبار) — نقارن عبر JSON.stringify
   بدل deepEqual/deepStrictEqual (تفشل عبر السياقين رغم تطابق البنية تمامًا،
   لأنها تتحقق من هوية النموذج الأولي أيضًا لا من البنية فقط). */
function assertSlices(actual, expected){
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

describe('computePdfSliceBoundaries', () => {
  test('محتوى أقصر من صفحة واحدة يُنتج صفحة واحدة فقط', () => {
    const slices = app.computePdfSliceBoundaries(300, 700, [150, 300]);
    assertSlices(slices, [[0, 300]]);
  });

  test('بلا أي نقاط قطع آمنة، يقطع صلبًا كل ارتفاع صفحة بالضبط', () => {
    const slices = app.computePdfSliceBoundaries(2000, 700, []);
    assertSlices(slices, [[0, 700], [700, 1400], [1400, 2000]]);
  });

  test('يختار أقرب نقطة قطع آمنة لا تتجاوز سعة الصفحة، بدل القطع الآلي في المنتصف', () => {
    const slices = app.computePdfSliceBoundaries(1500, 700, [680, 1380]);
    assertSlices(slices, [[0, 680], [680, 1380], [1380, 1500]]);
  });

  test('لا نقطة قطع ضمن مدى الصفحة الحالية -> قطع صلب لهذه الصفحة فقط، ثم يتابع لاحقًا', () => {
    const slices = app.computePdfSliceBoundaries(1000, 400, [900]);
    assertSlices(slices, [[0, 400], [400, 800], [800, 1000]]);
  });

  test('طول المحتوى يساوي سعة الصفحة بالضبط -> صفحة واحدة، لا صفحة فارغة إضافية', () => {
    const slices = app.computePdfSliceBoundaries(700, 700, [700]);
    assertSlices(slices, [[0, 700]]);
  });

  test('نقطة قطع تقع قبل بداية الصفحة الحالية (من صفحة سابقة) تُتجاهل ولا تُنشئ صفحة فارغة', () => {
    const slices = app.computePdfSliceBoundaries(1000, 400, [50, 400, 800]);
    assertSlices(slices, [[0, 400], [400, 800], [800, 1000]]);
  });
});

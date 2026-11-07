'use strict';
/* ============================================================
   اختبار بسلّم تقدير (app-41-rubric-tests.js) — الدوال الصرفة
   - توزيع الدرجة الكلية على المعايير بأرقام صحيحة (5 على 3 → 2 و2 و1).
   - درجة الطالب = مجموع (درجة المعيار × نسبة المستوى)، وغير المرصود لا يُحسب.
   - لا تتجاوز الدرجة الكلية الدرجة الكاملة للاختبار أبدًا.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');
const J = x => JSON.parse(JSON.stringify(x));

test('rubricDistribute: توزيع صحيح يطابق الدرجة الكلية', () => {
  const app = loadApp();
  assert.deepEqual(J(app.rubricDistribute(5, 3)), [2, 2, 1]);
  assert.deepEqual(J(app.rubricDistribute(5, 5)), [1, 1, 1, 1, 1]);
  assert.deepEqual(J(app.rubricDistribute(5, 4)), [2, 1, 1, 1]);
  assert.deepEqual(J(app.rubricDistribute(10, 3)), [4, 3, 3]);
  assert.deepEqual(J(app.rubricDistribute(5, 1)), [5]);
  /* أقل من معيار لكل درجة صحيحة: بالنصف */
  assert.deepEqual(J(app.rubricDistribute(5, 6)), [1, 1, 1, 1, 0.5, 0.5]);
  for (const [t, n] of [[5, 3], [5, 7], [10, 9], [20, 10], [7, 3], [5, 10], [3, 5]]) {
    const sum = app.rubricDistribute(t, n).reduce((a, b) => a + b, 0);
    assert.equal(Math.round(sum * 1000) / 1000, t, `مجموع ${t} على ${n}`);
  }
  assert.deepEqual(J(app.rubricDistribute(0, 3)), []);
  assert.deepEqual(J(app.rubricDistribute(5, 0)), []);
});

test('rubricTotal: مجموع المعايير بنسب المستويات وغير المرصود لا يُحسب', () => {
  const app = loadApp();
  const cr = [{ id: 'a', points: 2 }, { id: 'b', points: 2 }, { id: 'c', points: 1 }];
  const of = m => id => (id in m ? m[id] : null);
  assert.equal(app.rubricTotal(cr, of({ a: 0, b: 0, c: 0 })), 5);
  assert.equal(app.rubricTotal(cr, of({ a: 0, b: 1, c: 3 })), 3.75); /* 2 + 1.5 + 0.25 */
  assert.equal(app.rubricTotal(cr, of({ a: 4, b: 4, c: 4 })), 0);
  assert.equal(app.rubricTotal(cr, of({ a: 0 })), 2, 'غير المرصود لا يُحسب');
  assert.equal(app.rubricTotal([], of({})), 0);
  assert.equal(app.rubricIsComplete(cr, of({ a: 0, b: 1, c: 3 })), true);
  assert.equal(app.rubricIsComplete(cr, of({ a: 0, b: 1 })), false);
  assert.equal(app.rubricIsComplete([], of({})), false);
  assert.equal(app.rubricPointsAt(1, 1), 0.75);
  assert.equal(app.rubricPointsAt(2, 3), 0.5);
});

test('rubricBuildCriteria: التحقق من مسودة المعايير', () => {
  const app = loadApp();
  assert.match(app.rubricBuildCriteria([], 5).error, /معيارًا واحدًا/);
  assert.match(app.rubricBuildCriteria(['الدقة', ' الدقة '], 5).error, /مكرر/);
  assert.match(app.rubricBuildCriteria(Array.from({ length: 11 }, (_, i) => 'م' + i), 20).error, /الحد الأقصى/);
  const ok = app.rubricBuildCriteria(['الدقة', 'الطلاقة', 'الفهم'], 5);
  assert.deepEqual(J(ok.rows), [{ name: 'الدقة', points: 2, position: 0 }, { name: 'الطلاقة', points: 2, position: 1 }, { name: 'الفهم', points: 1, position: 2 }]);
  /* مجموع درجات المعايير = الدرجة الكاملة دائمًا */
  assert.equal(ok.rows.reduce((a, r) => a + r.points, 0), 5);
});

test('rubricNormalizeName: تنظيف الاسم', () => {
  const app = loadApp();
  assert.equal(app.rubricNormalizeName('  الدقة   في   النطق '), 'الدقة في النطق');
  assert.equal(app.rubricNormalizeName(null), '');
  assert.equal(app.rubricNormalizeName('ا'.repeat(80)).length, 60);
});

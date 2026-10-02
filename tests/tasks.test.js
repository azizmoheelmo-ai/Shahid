'use strict';
/* ============================================================
   اختبار الدالة الصرفة sortTasksForDisplay بـapp-13-tasks.js —
   ترتيب قائمة "مهامّي": غير المُنجَزة قبل المُنجَزة، والأقرب استحقاقًا
   أولًا ضمن كل مجموعة، وبلا تاريخ استحقاق أخيرًا ضمن مجموعتها.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

/* بلا deepEqual على مصفوفة عائدة من sortTasksForDisplay: القيمة راجعة من
   داخل سياق vm (spread [...tasks] هناك يُنشئ Array بواسطة الـsandbox)،
   فتفشل مقارنتها مرجعيًا بمصفوفة حرفية بسياق الاختبار رغم تطابق البنية
   تمامًا (نفس الملاحظة الموثَّقة بـtests/pure-functions.test.js). */
function idsOf(sortedTasks){
  return sortedTasks.map(t => t.id).join(',');
}

test('sortTasksForDisplay', async (t) => {
  await t.test('غير المُنجَزة تسبق المُنجَزة بصرف النظر عن تاريخ الاستحقاق', () => {
    const app = loadApp();
    const tasks = [
      { id: 'a', done: true, due_date: '2026-01-01' },
      { id: 'b', done: false, due_date: '2026-12-31' },
    ];
    assert.equal(idsOf(app.sortTasksForDisplay(tasks)), 'b,a');
  });

  await t.test('ضمن المجموعة نفسها، الأقرب استحقاقًا أولًا', () => {
    const app = loadApp();
    const tasks = [
      { id: 'later', done: false, due_date: '2026-06-01' },
      { id: 'sooner', done: false, due_date: '2026-03-01' },
    ];
    assert.equal(idsOf(app.sortTasksForDisplay(tasks)), 'sooner,later');
  });

  await t.test('بلا تاريخ استحقاق تُعرَض أخيرًا ضمن مجموعتها', () => {
    const app = loadApp();
    const tasks = [
      { id: 'no-date', done: false, due_date: null },
      { id: 'has-date', done: false, due_date: '2026-01-01' },
    ];
    assert.equal(idsOf(app.sortTasksForDisplay(tasks)), 'has-date,no-date');
  });

  await t.test('قائمة فارغة أو غير مُعرَّفة لا تُسقط الدالة', () => {
    const app = loadApp();
    assert.equal(app.sortTasksForDisplay([]).length, 0);
    assert.equal(app.sortTasksForDisplay(undefined).length, 0);
  });

  await t.test('لا تُعدِّل المصفوفة الأصلية (نسخة جديدة)', () => {
    const app = loadApp();
    const original = [
      { id: 'a', done: false, due_date: '2026-06-01' },
      { id: 'b', done: false, due_date: '2026-01-01' },
    ];
    const originalOrder = original.map(t => t.id);
    app.sortTasksForDisplay(original);
    assert.deepEqual(original.map(t => t.id), originalOrder);
  });
});

/* بطاقة "يحتاج إجراء الآن" بالرئيسية — تحسب عدد المهام التي تستحق "إجراءً"
   (مستحقة قريبًا أو متأخرة فعلًا)، بلا الاعتماد على Date() الحقيقي داخل
   الدالة نفسها (المستدعي يمرّر cutoffIso صراحة) لتسهيل الاختبار. */
test('countTasksNeedingAttention', async (t) => {
  const cutoff = '2026-03-10'; // = اليوم + 3 أيام بسيناريو الاختبار

  await t.test('مهمة متأخرة فعلًا (تاريخها قبل اليوم) تُحسب', () => {
    const app = loadApp();
    const tasks = [{ id: 'a', done: false, due_date: '2026-01-01' }];
    assert.equal(app.countTasksNeedingAttention(tasks, cutoff), 1);
  });

  await t.test('مهمة مستحقة قريبًا (ضمن المهلة) تُحسب', () => {
    const app = loadApp();
    const tasks = [{ id: 'a', done: false, due_date: '2026-03-09' }];
    assert.equal(app.countTasksNeedingAttention(tasks, cutoff), 1);
  });

  await t.test('مهمة بعيدة الاستحقاق (بعد المهلة) لا تُحسب', () => {
    const app = loadApp();
    const tasks = [{ id: 'a', done: false, due_date: '2026-12-31' }];
    assert.equal(app.countTasksNeedingAttention(tasks, cutoff), 0);
  });

  await t.test('مهمة منجَزة لا تُحسب حتى لو متأخرة', () => {
    const app = loadApp();
    const tasks = [{ id: 'a', done: true, due_date: '2026-01-01' }];
    assert.equal(app.countTasksNeedingAttention(tasks, cutoff), 0);
  });

  await t.test('مهمة بلا تاريخ استحقاق لا تُحسب', () => {
    const app = loadApp();
    const tasks = [{ id: 'a', done: false, due_date: null }];
    assert.equal(app.countTasksNeedingAttention(tasks, cutoff), 0);
  });

  await t.test('قائمة فارغة أو غير مُعرَّفة = صفر بلا خطأ', () => {
    const app = loadApp();
    assert.equal(app.countTasksNeedingAttention([], cutoff), 0);
    assert.equal(app.countTasksNeedingAttention(undefined, cutoff), 0);
  });
});

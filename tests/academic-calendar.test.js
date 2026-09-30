'use strict';
/* ============================================================
   اختبارات الدوال الصرفة بـapp-12-calendar.js (الدفعة الأولى من ميزة
   التقويم الدراسي — عرض قراءة فقط):
   findHolidayForDate / resolveCurrentWeekInfo / buildWeekLabelDateIndex.
   لا شبكة ولا DOM هنا — بيانات وهمية تحاكي شكل صفوف academic_calendar_weeks
   /academic_calendar_holidays تمامًا. ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

const HOLIDAYS = [
  { holiday_name: 'إجازة الخريف', event_label: 'تبدأ إجازة الخريف', gregorian_date: '2026-11-20' },
  { holiday_name: 'إجازة الخريف', event_label: 'تنتهي الاجازة', gregorian_date: '2026-11-28' },
  { holiday_name: 'إجازة منتصف العام الدراسي', event_label: 'تبدأ إجازة منتصف العام الدراسي', gregorian_date: '2027-01-08' },
  { holiday_name: 'إجازة منتصف العام الدراسي', event_label: 'تنتهي الاجازة', gregorian_date: '2027-01-16' },
];

const WEEKS = [
  { week_label: 'عودة المعلمين والمعلمات', gregorian_date: '2026-08-23', semester: 1 },
  { week_label: 'الأسبوع الأول', gregorian_date: '2026-08-30', semester: 1 },
  { week_label: 'الأسبوع الأول', gregorian_date: '2026-08-31', semester: 1 },
  { week_label: 'الأسبوع الثاني', gregorian_date: '2026-09-06', semester: 1 },
  { week_label: 'الأسبوع الأول', gregorian_date: '2027-01-17', semester: 2 },
];

test('findHolidayForDate', async (t) => {
  await t.test('تاريخ داخل نطاق إجازة مسجَّلة (بين تبدأ وتنتهي) يُرجع اسمها', () => {
    const app = loadApp();
    assert.equal(app.findHolidayForDate(HOLIDAYS, '2026-11-24'), 'إجازة الخريف');
  });

  await t.test('تاريخ بداية/نهاية الإجازة نفسه يُحتسَب داخل النطاق (شامل)', () => {
    const app = loadApp();
    assert.equal(app.findHolidayForDate(HOLIDAYS, '2026-11-20'), 'إجازة الخريف');
    assert.equal(app.findHolidayForDate(HOLIDAYS, '2026-11-28'), 'إجازة الخريف');
  });

  await t.test('تاريخ خارج أي نطاق إجازة يُرجع null', () => {
    const app = loadApp();
    assert.equal(app.findHolidayForDate(HOLIDAYS, '2026-12-01'), null);
  });

  await t.test('قائمة إجازات فارغة أو غير مُعرَّفة لا تُسقط الدالة', () => {
    const app = loadApp();
    assert.equal(app.findHolidayForDate([], '2026-11-24'), null);
    assert.equal(app.findHolidayForDate(undefined, '2026-11-24'), null);
  });
});

test('resolveCurrentWeekInfo', async (t) => {
  await t.test('تاريخ داخل إجازة مسجَّلة يُغلَّب على أي أسبوع دراسي', () => {
    const app = loadApp();
    const info = app.resolveCurrentWeekInfo(WEEKS, HOLIDAYS, '2026-11-24');
    assert.equal(info.status, 'holiday');
    assert.equal(info.holidayName, 'إجازة الخريف');
  });

  await t.test('تاريخ بين يومين دراسيين (لا إجازة) يُرجع آخر أسبوع بدأ قبله', () => {
    const app = loadApp();
    // 2026-09-08 بعد "الأسبوع الثاني" (بدأ 09-06) ولا إجازة مسجَّلة بهذا التاريخ
    const info = app.resolveCurrentWeekInfo(WEEKS, HOLIDAYS, '2026-09-08');
    assert.equal(info.status, 'ok');
    assert.equal(info.weekLabel, 'الأسبوع الثاني');
    assert.equal(info.semester, 1);
  });

  await t.test('تاريخ قبل أول يوم مسجَّل بالتقويم كله يُرجع before_start', () => {
    const app = loadApp();
    const info = app.resolveCurrentWeekInfo(WEEKS, HOLIDAYS, '2026-08-01');
    assert.equal(info.status, 'before_start');
  });

  await t.test('نفس اسم الأسبوع يتكرر بالفصل الثاني بصفّه الصحيح (semester مطابق)', () => {
    const app = loadApp();
    const info = app.resolveCurrentWeekInfo(WEEKS, HOLIDAYS, '2027-01-20');
    assert.equal(info.status, 'ok');
    assert.equal(info.weekLabel, 'الأسبوع الأول');
    assert.equal(info.semester, 2);
  });
});

test('buildWeekLabelDateIndex', async (t) => {
  await t.test('يأخذ أول ظهور زمنيًا لكل اسم أسبوع (الصفوف مُرتَّبة تصاعديًا بالتاريخ)', () => {
    const app = loadApp();
    const index = app.buildWeekLabelDateIndex(WEEKS);
    // "الأسبوع الأول" يظهر أول مرة 2026-08-30 (الفصل الأول) رغم تكراره
    // لاحقًا بالفصل الثاني (2027-01-17) — قيد معروف موثَّق بأعلى app-12-calendar.js
    assert.equal(index['الأسبوع الأول'], '2026-08-30');
    assert.equal(index['الأسبوع الثاني'], '2026-09-06');
    assert.equal(index['عودة المعلمين والمعلمات'], '2026-08-23');
  });

  await t.test('قائمة فارغة تُرجع خريطة فارغة بلا خطأ', () => {
    const app = loadApp();
    // بلا deepEqual على كائن سطحي: يفشل عبر سياقي vm رغم تطابق البنية تمامًا
    // (راجع نفس الملاحظة بـtests/pure-functions.test.js وpdf-pagination.test.js)
    assert.equal(Object.keys(app.buildWeekLabelDateIndex([])).length, 0);
  });
});

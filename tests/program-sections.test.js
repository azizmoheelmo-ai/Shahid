'use strict';
/* ============================================================
   اختبارات الدالتين الصرفتين بـapp-10-programs.js لميزة "ربط البرنامج
   بالشُعب": countActiveStudentsInSections (عدّ الطلبة التلقائي)
   وfindSectionWeekConflicts (تحذير تعارض جدولة — لا منع حفظ).
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

test('countActiveStudentsInSections', async (t) => {
  const students = [
    { full_name: 'أحمد', grade_level: 'أول ثانوي', section_number: '1', is_active: true },
    { full_name: 'سعيد', grade_level: 'أول ثانوي', section_number: '1', is_active: true },
    { full_name: 'خالد', grade_level: 'أول ثانوي', section_number: '2', is_active: true },
    { full_name: 'فهد', grade_level: 'ثاني ثانوي', section_number: '1', is_active: true },
    { full_name: 'منصور (غير نشط)', grade_level: 'أول ثانوي', section_number: '1', is_active: false },
  ];

  await t.test('يعدّ فقط الطلاب النشطين بالشُعب المطابقة (مطابقة نصية مرحلة+شعبة)', () => {
    const app = loadApp();
    const count = app.countActiveStudentsInSections(students, [{ grade_level_name: 'أول ثانوي', section_name: '1' }]);
    assert.equal(count, 2);
  });

  await t.test('يجمع عبر أكثر من شعبة مختارة بنفس الوقت', () => {
    const app = loadApp();
    const count = app.countActiveStudentsInSections(students, [
      { grade_level_name: 'أول ثانوي', section_name: '1' },
      { grade_level_name: 'ثاني ثانوي', section_name: '1' },
    ]);
    assert.equal(count, 3);
  });

  await t.test('شعبة غير موجودة بين الطلاب تُرجع صفرًا بلا خطأ', () => {
    const app = loadApp();
    const count = app.countActiveStudentsInSections(students, [{ grade_level_name: 'ثالث ثانوي', section_name: '9' }]);
    assert.equal(count, 0);
  });

  await t.test('قائمة شُعب فارغة تُرجع صفرًا', () => {
    const app = loadApp();
    assert.equal(app.countActiveStudentsInSections(students, []), 0);
  });
});

test('findSectionWeekConflicts', async (t) => {
  const SEC_A = 'sec-a';
  const SEC_B = 'sec-b';

  await t.test('برنامجان مختلفان بنفس الشعبة ونفس نص الأسبوع — تعارض فعلي', () => {
    const app = loadApp();
    const others = [
      { id: 'prog-2', name: 'برنامج إثرائي', sessions: [{ week_label: 'الأسبوع الخامس' }], sectionIds: [SEC_A] },
    ];
    const conflicts = app.findSectionWeekConflicts('prog-1', [SEC_A], ['الأسبوع الخامس'], others);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].programName, 'برنامج إثرائي');
    assert.equal(conflicts[0].weeks.join(','), 'الأسبوع الخامس');
  });

  await t.test('نفس الشعبة لكن أسابيع مختلفة كليًا — لا تعارض', () => {
    const app = loadApp();
    const others = [
      { id: 'prog-2', name: 'برنامج إثرائي', sessions: [{ week_label: 'الأسبوع العاشر' }], sectionIds: [SEC_A] },
    ];
    const conflicts = app.findSectionWeekConflicts('prog-1', [SEC_A], ['الأسبوع الخامس'], others);
    assert.equal(conflicts.length, 0);
  });

  await t.test('نفس الأسبوع لكن شُعب مختلفة كليًا — لا تعارض', () => {
    const app = loadApp();
    const others = [
      { id: 'prog-2', name: 'برنامج إثرائي', sessions: [{ week_label: 'الأسبوع الخامس' }], sectionIds: [SEC_B] },
    ];
    const conflicts = app.findSectionWeekConflicts('prog-1', [SEC_A], ['الأسبوع الخامس'], others);
    assert.equal(conflicts.length, 0);
  });

  await t.test('يستبعد البرنامج نفسه من المقارنة (تعديل برنامج لا يتعارض مع نفسه)', () => {
    const app = loadApp();
    const others = [
      { id: 'prog-1', name: 'نفس البرنامج', sessions: [{ week_label: 'الأسبوع الخامس' }], sectionIds: [SEC_A] },
    ];
    const conflicts = app.findSectionWeekConflicts('prog-1', [SEC_A], ['الأسبوع الخامس'], others);
    assert.equal(conflicts.length, 0);
  });

  await t.test('بلا شُعب مختارة بالبرنامج الحالي — لا تعارض يُفحص أصلًا', () => {
    const app = loadApp();
    const others = [
      { id: 'prog-2', name: 'برنامج إثرائي', sessions: [{ week_label: 'الأسبوع الخامس' }], sectionIds: [SEC_A] },
    ];
    const conflicts = app.findSectionWeekConflicts('prog-1', [], ['الأسبوع الخامس'], others);
    assert.equal(conflicts.length, 0);
  });
});

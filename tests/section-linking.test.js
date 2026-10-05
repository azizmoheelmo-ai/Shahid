'use strict';
/* ============================================================
   ربط الطالب بشعبته بالمعرّف (section_id) — الدوال الصرفة
   ------------------------------------------------------------
   الأصل: الطالب كان مربوطًا بشعبته بنصّين حرّين من ملف Excel. بيانات حقيقية
   انكسرت بسبب ذلك: ملف كتب "ثاني"/"3" وقائمة الشعب "ثاني ثانوي"/"٣"، وملف
   آخر كتب "ثاني ثانوي"/"1" فظهر 33 طالبًا كصف منفصل. هذه الاختبارات تثبت:
   - مطابقة الكتابات المختلفة لنفس الشعبة (أرقام عربية، اسم مرحلة مختصر).
   - عدم التخمين عند الغموض (أكثر من شعبة مطابقة) أو عند غياب المطابقة.
   - استيراد إلى شعبة مختارة لا يُنشئ نسخًا مكررة، ويقترح "النقل" للطالب
     الموجود بشعبة أخرى بدل سجل مكرر بلا تاريخ.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

const GRADES = [
  { id: 'g2', name: 'ثاني ثانوي' },
  { id: 'g3', name: 'ثالث ثانوي' },
];
const SECTIONS = [
  { id: 's2-1', grade_level_id: 'g2', name: '١', academic_year: '1448-1449' },
  { id: 's2-6', grade_level_id: 'g2', name: '٦', academic_year: '1448-1449' },
  { id: 's3-3', grade_level_id: 'g3', name: '٣', academic_year: '1448-1449' },
];

test('normalizeClassLabel', async (t) => {
  const app = loadApp();
  await t.test('الأرقام العربية والفارسية تُوحَّد مع اللاتينية', () => {
    assert.equal(app.normalizeClassLabel('٣'), '3');
    assert.equal(app.normalizeClassLabel('۶'), '6');
    assert.equal(app.normalizeClassLabel('3'), '3');
  });
  await t.test('كلمة "الشعبة" البادئة والمسافات الزائدة لا تؤثر', () => {
    assert.equal(app.normalizeClassLabel('الشعبة ٦'), '6');
    assert.equal(app.normalizeClassLabel('  شعبة  6 '), '6');
  });
  await t.test('القيم الفارغة لا تنهار', () => {
    assert.equal(app.normalizeClassLabel(null), '');
    assert.equal(app.normalizeClassLabel(undefined), '');
  });
});

test('gradeTextMatches', async (t) => {
  const app = loadApp();
  await t.test('الاسم المختصر يطابق الاسم الكامل بكلمات كاملة', () => {
    assert.equal(app.gradeTextMatches('ثاني', 'ثاني ثانوي'), true);
    assert.equal(app.gradeTextMatches('ثاني ثانوي', 'ثاني'), true);
    assert.equal(app.gradeTextMatches('ثاني ثانوي', 'ثاني ثانوي'), true);
  });
  await t.test('جزء من كلمة لا يكفي، ومرحلة مختلفة لا تطابق', () => {
    assert.equal(app.gradeTextMatches('ثا', 'ثاني ثانوي'), false);
    assert.equal(app.gradeTextMatches('ثالث', 'ثاني ثانوي'), false);
    assert.equal(app.gradeTextMatches('', 'ثاني ثانوي'), false);
  });
});

test('proposeSectionLinks', async (t) => {
  await t.test('حالة حقيقية: "ثاني"/"6" و"ثالث"/"3" تُقترح لشعبتيهما الصحيحتين', () => {
    const app = loadApp();
    const students = [
      { id: 'a', full_name: 'أ', grade_level: 'ثاني', section_number: '6', academic_year: '1448-1449' },
      { id: 'b', full_name: 'ب', grade_level: 'ثاني', section_number: '6', academic_year: '1448-1449' },
      { id: 'c', full_name: 'ج', grade_level: 'ثالث', section_number: '3', academic_year: '1448-1449' },
    ];
    const groups = app.proposeSectionLinks(students, GRADES, SECTIONS);
    assert.equal(groups.length, 2);
    const g6 = groups.find(g => g.sectionText === '6');
    assert.deepEqual([...g6.studentIds], ['a', 'b']);
    assert.equal(g6.proposedSectionId, 's2-6');
    assert.equal(groups.find(g => g.sectionText === '3').proposedSectionId, 's3-3');
  });

  await t.test('الطالب المربوط أصلًا لا يظهر بالمراجعة', () => {
    const app = loadApp();
    const students = [{ id: 'a', full_name: 'أ', grade_level: 'ثاني', section_number: '6', section_id: 's2-6', academic_year: '1448-1449' }];
    assert.equal(app.proposeSectionLinks(students, GRADES, SECTIONS).length, 0);
  });

  await t.test('أكثر من شعبة مطابقة = بلا اقتراح (لا تخمين)', () => {
    const app = loadApp();
    const grades = [...GRADES, { id: 'gm', name: 'ثاني متوسط' }];
    const sections = [...SECTIONS, { id: 'm-6', grade_level_id: 'gm', name: '6', academic_year: '1448-1449' }];
    const students = [{ id: 'a', full_name: 'أ', grade_level: 'ثاني', section_number: '6', academic_year: '1448-1449' }];
    const [g] = app.proposeSectionLinks(students, grades, sections);
    assert.equal(g.proposedSectionId, '');
    assert.equal(g.candidateCount, 2);
  });

  await t.test('لا شعبة بهذا الاسم = بلا اقتراح', () => {
    const app = loadApp();
    const students = [{ id: 'a', full_name: 'أ', grade_level: 'ثاني', section_number: '9', academic_year: '1448-1449' }];
    const [g] = app.proposeSectionLinks(students, GRADES, SECTIONS);
    assert.equal(g.proposedSectionId, '');
    assert.equal(g.candidateCount, 0);
  });

  await t.test('شعبة من سنة دراسية أخرى لا تُقترح', () => {
    const app = loadApp();
    const sections = [{ id: 'old', grade_level_id: 'g2', name: '6', academic_year: '1447-1448' }];
    const students = [{ id: 'a', full_name: 'أ', grade_level: 'ثاني', section_number: '6', academic_year: '1448-1449' }];
    assert.equal(app.proposeSectionLinks(students, GRADES, sections)[0].proposedSectionId, '');
  });

  await t.test('طالب بلا نص شعبة لا يُطابَق مع أي شعبة', () => {
    const app = loadApp();
    const students = [{ id: 'a', full_name: 'أ', grade_level: 'ثاني', section_number: '', academic_year: '1448-1449' }];
    assert.equal(app.proposeSectionLinks(students, GRADES, SECTIONS)[0].candidateCount, 0);
  });
});

test('studentClassLabel', async (t) => {
  const app = loadApp();
  await t.test('المربوط يُعرض باسم المرحلة والشعبة الرسميين لا بنصه القديم', () => {
    const label = app.studentClassLabel({ grade_level: 'ثاني', section_number: '6', section_id: 's2-6' }, GRADES, SECTIONS);
    assert.equal(label.grade, 'ثاني ثانوي');
    assert.equal(label.section, '٦');
    assert.equal(label.linked, true);
  });
  await t.test('غير المربوط يُعرض بنصه كما هو', () => {
    const label = app.studentClassLabel({ grade_level: 'ثاني', section_number: '6' }, GRADES, SECTIONS);
    assert.equal(label.grade, 'ثاني');
    assert.equal(label.linked, false);
  });
  await t.test('مربوط بشعبة حُذفت من القائمة المحمّلة = يرجع لنصه', () => {
    const label = app.studentClassLabel({ grade_level: 'ثاني', section_number: '6', section_id: 'gone' }, GRADES, SECTIONS);
    assert.equal(label.linked, false);
  });
});

test('planStudentImport', async (t) => {
  const existing = [
    { id: 'x1', full_name: 'أحمد علي', section_id: 's2-1' },
    { id: 'x2', full_name: 'فراس سعيد بادويلان', section_id: 's2-6' },
    { id: 'x3', full_name: 'محمد سالم', section_id: 's2-6' },
    { id: 'x4', full_name: 'محمد سالم', section_id: 's3-3' },
  ];

  await t.test('الاسم الموجود بنفس الشعبة يُتخطّى (إعادة رفع الملف لا تكرّر)', () => {
    const app = loadApp();
    const plan = app.planStudentImport([{ full_name: 'أحمد علي' }, { full_name: 'خالد' }], existing, 's2-1');
    assert.deepEqual([...plan.toInsert.map(r => r.full_name)], ['خالد']);
    assert.equal(plan.duplicates, 1);
  });

  await t.test('الهمزة والمسافات الزائدة لا تجعل الاسم "جديدًا"', () => {
    const app = loadApp();
    const plan = app.planStudentImport([{ full_name: '  احمد   علي ' }], existing, 's2-1');
    assert.equal(plan.toInsert.length, 0);
    assert.equal(plan.duplicates, 1);
  });

  await t.test('التكرار داخل الملف نفسه يُدرج مرة واحدة', () => {
    const app = loadApp();
    const plan = app.planStudentImport([{ full_name: 'سعد' }, { full_name: 'سعد' }], existing, 's2-1');
    assert.equal(plan.toInsert.length, 1);
    assert.equal(plan.duplicates, 1);
  });

  /* انحدار حقيقي: طالبان نُقلا من الشعبة 6 إلى 1 فبقي لهما سجلان */
  await t.test('اسم بسجل واحد في شعبة أخرى = مرشّح نقل لا سجل جديد', () => {
    const app = loadApp();
    const plan = app.planStudentImport([{ full_name: 'فراس سعيد بادويلان' }], existing, 's2-1');
    assert.equal(plan.toInsert.length, 0);
    assert.deepEqual([...plan.moveCandidates].map(m => ({ ...m })), [{ full_name: 'فراس سعيد بادويلان', existingId: 'x2' }]);
  });

  await t.test('اسم بأكثر من سجل في شعب أخرى = غامض، يُضاف جديدًا بلا تخمين', () => {
    const app = loadApp();
    const plan = app.planStudentImport([{ full_name: 'محمد سالم' }], existing, 's2-1');
    assert.equal(plan.moveCandidates.length, 0);
    assert.equal(plan.toInsert.length, 1);
  });

  await t.test('الطالب غير المربوط لا يُعتبر "موجودًا بنفس الشعبة"', () => {
    const app = loadApp();
    const plan = app.planStudentImport([{ full_name: 'زيد' }], [{ id: 'u', full_name: 'زيد', section_id: null }], 's2-1');
    assert.equal(plan.duplicates, 0);
    assert.equal(plan.moveCandidates.length, 1);
  });
});

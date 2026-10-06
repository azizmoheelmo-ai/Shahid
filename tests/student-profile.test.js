'use strict';
/* ============================================================
   ملف الطالب والموقف الرسمي (app-15 + منطق المخالفة المشترك بـapp-04)
   ------------------------------------------------------------
   - incidentStageFor: نفس منطق اللائحة الذي كان مضمّنًا داخل شاشة "تسجيل
     مخالفة" قبل استخراجه — يجب ألا يتغيّر سلوكه.
   - انحدار حقيقي: نقرة مزدوجة على "حفظ الحادثة" كانت تسجّل نفس المخالفة
     مرتين (ورقم التكرار يرتفع خطأً فتصل للإحالة قبل أوانها).
   - بطاقة الحال: وقائع فقط، و"منذ آخر موقف".
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TYPE_WARN = { id: 'tw', problem_name: 'إعاقة سير الحصة', action_sequence: 'two_warnings_then_referral', stage_1_label: 'تنبيه شفهي', stage_2_label: 'تعهد خطي', regulation_article: 'م1' };
const TYPE_IMMEDIATE = { id: 'ti', problem_name: 'الهروب من الحصة', action_sequence: 'immediate_referral', regulation_article: 'م2' };

test('incidentStageFor', async (t) => {
  const app = loadApp();
  await t.test('تسلسل إنذارين ثم تحويل', () => {
    assert.equal(app.incidentStageFor(TYPE_WARN, 1).stage, 'warning_1');
    assert.equal(app.incidentStageFor(TYPE_WARN, 1).actionText, 'تنبيه شفهي');
    assert.equal(app.incidentStageFor(TYPE_WARN, 2).stage, 'warning_2');
    assert.equal(app.incidentStageFor(TYPE_WARN, 3).stage, 'referred');
    assert.match(app.incidentStageFor(TYPE_WARN, 4).actionText, /رقم 4/);
  });
  await t.test('التحويل الفوري من أول مرة', () => {
    assert.equal(app.incidentStageFor(TYPE_IMMEDIATE, 1).stage, 'referred');
    assert.match(app.incidentStageFor(TYPE_IMMEDIATE, 1).actionText, /م2/);
  });
});

test('saveClassroomIncident — نقرة مزدوجة لا تُسجّل مرتين', async () => {
  let inserts = 0;
  const client = {
    from(table){
      const chain = {
        select(){ return chain; }, eq(){ return chain; }, order(){ return chain; }, range(){ return chain; },
        in(){ return chain; }, is(){ return chain; }, limit(){ return chain; },
        insert(){
          if(table === 'classroom_incidents') inserts++;
          return { then(res){ setTimeout(() => res({ data: null, error: null }), 20); } };
        },
        then(res){ res({ data: [], error: null, count: 0 }); }
      };
      return chain;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `crmIncidentTypes = [${JSON.stringify(TYPE_WARN)}]; crmStudents = [{ id: 's1', full_name: 'أ', section_id: 'sec' }];`);
  app.document.getElementById('crmIncidentStudentId').value = 's1';
  app.document.getElementById('crmIncidentType').value = 'tw';
  app.document.getElementById('crmIncidentNotes').value = '';
  app.document.getElementById('crmSemesterSelect').value = 'الفصل الأول';
  app.document.getElementById('crmYearInput').value = '1448-1449';

  await Promise.all([app.saveClassroomIncident(), app.saveClassroomIncident()]);
  assert.equal(inserts, 1);
});

test('topIncidentTypes', async (t) => {
  const app = loadApp();
  const types = [
    { id: 'a', problem_name: 'أ' }, { id: 'b', problem_name: 'ب' }, { id: 'c', problem_name: 'ج' },
  ];
  await t.test('المستخدم فقط، الأكثر أولًا، وبحد أقصى', () => {
    const usage = new Map([['b', 5], ['c', 9]]);
    assert.deepEqual([...app.topIncidentTypes(types, usage, 5)].map(t => t.id), ['c', 'b']);
    assert.deepEqual([...app.topIncidentTypes(types, usage, 1)].map(t => t.id), ['c']);
  });
  await t.test('بلا استخدام سابق = قائمة فارغة', () => {
    assert.equal(app.topIncidentTypes(types, new Map(), 5).length, 0);
  });
});

test('buildStudentStatusLines', async (t) => {
  const app = loadApp();
  await t.test('الحضور: الاستثناءات من عدد الحصص المرصودة', () => {
    const lines = app.buildStudentStatusLines({
      recordedLessons: 18,
      attendance: [{ status: 'absent' }, { status: 'absent' }, { status: 'late' }],
      incidents: [], positives: [],
    }, '2026-10-05');
    assert.match(lines.attendanceLine, /غاب 2 · تأخر 1 · مستأذن 0 — من 18 حصة/);
  });
  await t.test('بلا حصص مرصودة لا تُعرض أصفار مضللة', () => {
    const lines = app.buildStudentStatusLines({ recordedLessons: 0, attendance: [], incidents: [], positives: [] }, '2026-10-05');
    assert.equal(lines.attendanceLine, 'لا حصص مرصودة لشعبته بعد');
  });
  await t.test('بعد النقل: غياب الشعبة السابقة منفصل لا يُقسم على حصص الجديدة', () => {
    const lines = app.buildStudentStatusLines({
      currentSectionId: 'new', recordedLessons: 3,
      attendance: [
        { status: 'absent', lesson: { section_id: 'old' } }, { status: 'absent', lesson: { section_id: 'old' } },
        { status: 'late', lesson: { section_id: 'old' } }, { status: 'absent', lesson: { section_id: 'new' } },
      ],
      incidents: [], positives: [],
    }, '2026-10-05');
    assert.equal(lines.attendanceLine, 'غاب 1 · تأخر 0 · مستأذن 0 — من 3 حصة مرصودة · وفي شعبة سابقة: غاب 2 · تأخر 1');
  });
  await t.test('نُقل لشعبة لم تُرصد لها حصص بعد: لا يختفي سجله السابق', () => {
    const lines = app.buildStudentStatusLines({
      currentSectionId: 'new', recordedLessons: 0,
      attendance: [{ status: 'absent', lesson: { section_id: 'old' } }],
      incidents: [], positives: [],
    }, '2026-10-05');
    assert.equal(lines.attendanceLine, 'لا حصص مرصودة لشعبته بعد · وفي شعبة سابقة: غاب 1');
  });
  await t.test('الدرجات: النسبة مما رُصد لكل فئة', () => {
    const columns = [
      { id: 'm', category: 'performance', max_score: 10 }, { id: 'p', category: 'performance', max_score: 20 },
      { id: 't1', category: 'tests', max_score: 10 },
    ];
    const lines = app.buildStudentStatusLines({
      studentId: 's', recordedLessons: 0, attendance: [], incidents: [], positives: [],
      grades: { columns, scores: [{ column_id: 'm', student_id: 's', score: 7 }, { column_id: 'p', student_id: 's', score: 15 }] },
    }, '2026-10-05');
    assert.equal(lines.gradesLine, 'أدائي 73% مما رُصد · اختبارات لم تُرصد');
  });
  await t.test('الدرجات: بلا كشف / بلا درجات له', () => {
    const base = { studentId: 's', recordedLessons: 0, attendance: [], incidents: [], positives: [] };
    assert.equal(app.buildStudentStatusLines(Object.assign({ grades: { columns: [], scores: [] } }, base), '2026-10-05').gradesLine, 'لا كشف درجات لشعبته هذا الفصل');
    assert.equal(app.buildStudentStatusLines(Object.assign({ grades: { columns: [{ id: 'm', category: 'performance', max_score: 10 }], scores: [] } }, base), '2026-10-05').gradesLine, 'لا درجات مرصودة له بعد');
  });
  await t.test('آخر موقف ومنذ كم يوم، والإيجابي بجانبه', () => {
    const lines = app.buildStudentStatusLines({
      recordedLessons: 0, attendance: [],
      incidents: [{ incident_date: '2026-09-14', typeName: 'إعاقة سير الحصة' }, { incident_date: '2026-09-20', typeName: 'النوم داخل الفصل' }],
      positives: [{}, {}],
    }, '2026-10-05');
    assert.match(lines.behaviorLine, /مواقف رسمية: 2 · آخرها النوم داخل الفصل \(2026-09-20\) · منذ 15 يومًا · ⭐ 2/);
  });
  await t.test('بلا مواقف', () => {
    const lines = app.buildStudentStatusLines({ recordedLessons: 0, attendance: [], incidents: [], positives: [] }, '2026-10-05');
    assert.equal(lines.behaviorLine, 'لا مواقف رسمية · ⭐ 0');
  });
});

test('buildBehaviorTimeline', async () => {
  const app = loadApp();
  const items = app.buildBehaviorTimeline(
    [{ incident_date: '2026-09-14' }, { incident_date: '2026-10-01' }],
    [{ note_date: '2026-09-20' }, { note_date: '2026-10-01' }]
  );
  // الأحدث أولًا، والإيجابي قبل الرسمي بنفس اليوم
  assert.deepEqual([...items].map(i => i.date + ':' + i.kind), [
    '2026-10-01:positive', '2026-10-01:incident', '2026-09-20:positive', '2026-09-14:incident',
  ]);
});

test('transferTargetSections — شعب النقل', async () => {
  const app = loadApp();
  const grades = [{ id: 'g2', name: 'ثاني ثانوي' }, { id: 'g3', name: 'ثالث ثانوي' }];
  const sections = [
    { id: 's7', grade_level_id: 'g2', name: '٧' },
    { id: 's6', grade_level_id: 'g2', name: '٦' },
    { id: 's1', grade_level_id: 'g2', name: '١' },
    { id: 's3', grade_level_id: 'g3', name: '٣' },
  ];
  const t = app.transferTargetSections(sections, grades, 's6');
  // كل الشعب عدا شعبته الحالية، مرتبة، ومعها الاسم الرسمي للكتابة المزدوجة
  assert.deepEqual([...t].map(x => x.id), ['s3', 's1', 's7']);
  assert.equal(t.find(x => x.id === 's7').gradeName, 'ثاني ثانوي');
  assert.equal(t.find(x => x.id === 's7').sectionName, '٧');
  assert.equal(app.transferTargetSections(sections, grades, null).length, 4, 'طالب بلا شعبة يرى كل الشعب');
});

test('showCrmOverlayPane — الملف يخفي كل التبويبات (لا لوحتان ظاهرتان معًا)', async () => {
  /* خلل حقيقي: قائمة التبويبات المخفية كانت ثابتة ونسيت "المتابعات" ثم
     "الدرجات" — فتح ملف طالب منهما أظهر الملف تحت التبويب المفتوح */
  const app = loadApp();
  const reg = {};
  app.document.getElementById = (id) => (reg[id] = reg[id] || { style: { display: 'block' } });
  const panes = ['crmTabToday', 'crmTabFollowups', 'crmTabGrades', 'crmTabRecord', 'crmTabStudents'];
  app.showCrmOverlayPane('profile');
  panes.forEach(id => assert.equal(reg[id].style.display, 'none', id + ' يجب أن يُخفى'));
  assert.equal(reg.crmStudentProfile.style.display, 'block');
});

test('crmActiveTab — يعرف تبويب الدرجات', async () => {
  const app = loadApp();
  const reg = {};
  app.document.getElementById = (id) => (reg[id] = reg[id] || { style: { display: id === 'crmTabGrades' ? 'block' : 'none' } });
  assert.equal(app.crmActiveTab(), 'grades');
});

'use strict';
/* ============================================================
   "اليوم" وورقة رصد الحصة (app-14-classroom-today.js) — الدوال الصرفة
   ------------------------------------------------------------
   أهم ما تثبته:
   - التاريخ محلي لا UTC (رصد بعد منتصف الليل لا يُسجَّل لليوم السابق).
   - الحفظ يرسل الاستثناءات فقط ("حاضر" = لا صف).
   - "غير مرصود" لا يشمل أيامًا قبل إضافة الخانة للجدول ولا أيام الإجازة.
   - نسبة الحضور بلا حصص مرصودة = null (لا 100% وهمية).
   - المسودة المحلية لا تُعيد حالة لطالب لم يعد بالشعبة، وتنتهي بعد 3 أيام.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

test('localIsoDate / addDaysIso / weekdayOfIso', async (t) => {
  const app = loadApp();
  await t.test('يستخدم مكوّنات التاريخ المحلية لا UTC', () => {
    // 1 صباحًا محليًا — toISOString كان سيعطي اليوم السابق بمنطقة زمنية موجبة
    assert.equal(app.localIsoDate(new Date(2026, 9, 5, 1, 0)), '2026-10-05');
    assert.equal(app.localIsoDate(new Date(2026, 0, 9)), '2026-01-09');
  });
  await t.test('جمع الأيام يعبر حدود الشهر والسنة', () => {
    assert.equal(app.addDaysIso('2026-10-01', -1), '2026-09-30');
    assert.equal(app.addDaysIso('2026-12-31', 1), '2027-01-01');
  });
  await t.test('اليوم من الأسبوع (الأحد = 0)', () => {
    assert.equal(app.weekdayOfIso('2026-10-04'), 0); // أحد
    assert.equal(app.weekdayOfIso('2026-10-08'), 4); // خميس
  });
});

test('حالات الحضور', async (t) => {
  const app = loadApp();
  await t.test('الدورة: حاضر ← غائب ← متأخر ← مستأذن ← حاضر', () => {
    assert.equal(app.nextAttendanceState('present'), 'absent');
    assert.equal(app.nextAttendanceState('absent'), 'late');
    assert.equal(app.nextAttendanceState('late'), 'permitted_exit');
    assert.equal(app.nextAttendanceState('permitted_exit'), 'present');
  });
  await t.test('الحفظ يرسل الاستثناءات فقط', () => {
    const ex = app.exceptionsFromStates({ a: 'present', b: 'absent', c: 'late', d: 'present', e: 'permitted_exit' });
    assert.deepEqual([...ex].map(x => x.student_id + ':' + x.status).sort(), ['b:absent', 'c:late', 'e:permitted_exit']);
  });
  await t.test('العدّاد لا يعدّ الحاضرين', () => {
    const c = app.attendanceCounts({ a: 'present', b: 'absent', c: 'absent', d: 'late' });
    assert.equal(c.absent, 2);
    assert.equal(c.late, 1);
    assert.equal(c.permitted_exit, 0);
  });
  await t.test('رقم الفصل الدراسي من نص القائمة', () => {
    assert.equal(app.crmSemesterNumber('الفصل الأول'), 1);
    assert.equal(app.crmSemesterNumber('الفصل الثاني'), 2);
  });
});

test('planDayLessons', async (t) => {
  const app = loadApp();
  // 2026-10-04 أحد
  const slots = [
    { weekday: 0, period: 3, section_id: 'B' },
    { weekday: 0, period: 1, section_id: 'A' },
    { weekday: 1, period: 2, section_id: 'A' },
  ];
  await t.test('حصص اليوم فقط، مرتبة بالرقم، وأول غير مرصودة هي التالية', () => {
    const lessons = [{ id: 'L1', section_id: 'A', lesson_date: '2026-10-04', period: 1 }];
    const plan = app.planDayLessons(slots, '2026-10-04', lessons);
    assert.deepEqual([...plan.rows].map(r => r.period + r.section_id + r.recorded), ['1Atrue', '3Bfalse']);
    assert.equal(plan.nextIndex, 1);
    assert.equal(plan.rows[0].lessonId, 'L1');
  });
  await t.test('رصد نفس الشعبة بحصة أخرى لا يجعل هذه الحصة مرصودة', () => {
    const lessons = [{ id: 'L1', section_id: 'B', lesson_date: '2026-10-04', period: 5 }];
    const plan = app.planDayLessons(slots, '2026-10-04', lessons);
    assert.equal(plan.rows.find(r => r.section_id === 'B').recorded, false);
  });
  await t.test('كلها مرصودة = لا حصة تالية', () => {
    const lessons = [
      { id: 'L1', section_id: 'A', lesson_date: '2026-10-04', period: 1 },
      { id: 'L2', section_id: 'B', lesson_date: '2026-10-04', period: 3 },
    ];
    assert.equal(app.planDayLessons(slots, '2026-10-04', lessons).nextIndex, -1);
  });
  await t.test('"لم أحضر": الحصة تُعلَّم ولا تكون "التالية"', () => {
    const skips = [{ id: 'K1', section_id: 'A', lesson_date: '2026-10-04', period: 1, note: 'مناسبة' }];
    const plan = app.planDayLessons(slots, '2026-10-04', [], skips);
    assert.equal(plan.rows[0].skip.id, 'K1');
    assert.equal(plan.rows[1].skip, null);
    assert.equal(plan.nextIndex, 1);
  });
  await t.test('رصدها بعد "لم أحضر" = الرصد يغلب', () => {
    const skips = [{ id: 'K1', section_id: 'A', lesson_date: '2026-10-04', period: 1 }];
    const lessons = [{ id: 'L1', section_id: 'A', lesson_date: '2026-10-04', period: 1 }];
    const plan = app.planDayLessons(slots, '2026-10-04', lessons, skips);
    assert.equal(plan.rows[0].recorded, true);
    assert.equal(plan.rows[0].skip, null);
  });
  await t.test('"لم أحضر" بيوم آخر لا يمسّ اليوم', () => {
    const skips = [{ id: 'K1', section_id: 'A', lesson_date: '2026-10-11', period: 1 }];
    assert.equal(app.planDayLessons(slots, '2026-10-04', [], skips).rows[0].skip, null);
  });
});

test('findUnrecordedLessons', async (t) => {
  const app = loadApp();
  const slot = (weekday, period, section_id, created_at) => ({ weekday, period, section_id, created_at });
  await t.test('يعدّ حصص الأيام السابقة غير المرصودة (لا اليوم نفسه)', () => {
    // اليوم الخميس 2026-10-08؛ خانة أحد + خانة خميس
    const slots = [slot(0, 2, 'A', '2026-09-01T08:00:00Z'), slot(4, 1, 'A', '2026-09-01T08:00:00Z')];
    const out = app.findUnrecordedLessons(slots, [], '2026-10-08', 7, null);
    assert.deepEqual([...out].map(u => u.date + '#' + u.period), ['2026-10-01#1', '2026-10-04#2']);
  });
  await t.test('المرصود لا يظهر', () => {
    const slots = [slot(0, 2, 'A', '2026-09-01T08:00:00Z')];
    const lessons = [{ section_id: 'A', lesson_date: '2026-10-04', period: 2 }];
    assert.equal(app.findUnrecordedLessons(slots, lessons, '2026-10-08', 7, null).length, 0);
  });
  await t.test('لا يُعدّ يوم قبل إضافة الخانة للجدول (جدول أُدخل اليوم لا يملأ الأسبوع الماضي)', () => {
    const slots = [slot(0, 2, 'A', '2026-10-06T08:00:00')];
    assert.equal(app.findUnrecordedLessons(slots, [], '2026-10-08', 7, null).length, 0);
  });
  await t.test('أيام الإجازة الرسمية لا تُعدّ', () => {
    const slots = [slot(0, 2, 'A', '2026-09-01T08:00:00Z')];
    const out = app.findUnrecordedLessons(slots, [], '2026-10-08', 7, d => d === '2026-10-04');
    assert.equal(out.length, 0);
  });
  await t.test('"لم أحضر" لا تظهر في "لم تُرصد"', () => {
    const slots = [slot(0, 2, 'A', '2026-09-01T08:00:00Z'), slot(0, 3, 'B', '2026-09-01T08:00:00Z')];
    const skips = [{ section_id: 'A', lesson_date: '2026-10-04', period: 2 }];
    const out = app.findUnrecordedLessons(slots, [], '2026-10-08', 7, null, skips);
    assert.deepEqual([...out].map(u => u.section_id + u.period), ['B3']);
  });
});

test('sectionAttendanceRate', async (t) => {
  const app = loadApp();
  await t.test('بلا حصص مرصودة = null لا 100%', () => {
    assert.equal(app.sectionAttendanceRate([], [], 30), null);
    assert.equal(app.sectionAttendanceRate([{ id: 'L1' }], [], 0), null);
  });
  await t.test('الغياب فقط يُنقص النسبة (المتأخر والمستأذن حضرا)', () => {
    const lessons = [{ id: 'L1' }, { id: 'L2' }];
    const att = [
      { lesson_id: 'L1', status: 'absent' }, { lesson_id: 'L2', status: 'absent' },
      { lesson_id: 'L2', status: 'late' }, { lesson_id: 'L2', status: 'permitted_exit' },
      { lesson_id: 'OTHER', status: 'absent' },
    ];
    // 2 غياب من 2×10 = 90%
    assert.equal(app.sectionAttendanceRate(lessons, att, 10), 90);
  });
});

test('sanitizeLessonDraft', async (t) => {
  const app = loadApp();
  const now = Date.UTC(2026, 9, 5);
  await t.test('يُبقي حالات طلاب الشعبة الحاليين فقط وبحالات صالحة', () => {
    const d = app.sanitizeLessonDraft({ at: now - 1000, states: { a: 'absent', gone: 'late', b: 'hacked' } }, ['a', 'b'], now);
    assert.deepEqual({ ...d.states }, { a: 'absent' });
  });
  await t.test('مسودة أقدم من 3 أيام تُتجاهل', () => {
    assert.equal(app.sanitizeLessonDraft({ at: now - 4 * 86400000, states: { a: 'absent' } }, ['a'], now), null);
  });
  await t.test('مسودة تالفة تُتجاهل بلا انهيار', () => {
    assert.equal(app.sanitizeLessonDraft('x', ['a'], now), null);
    assert.equal(app.sanitizeLessonDraft({ states: {} }, ['a'], now), null);
    assert.equal(app.sanitizeLessonDraft(null, ['a'], now), null);
  });
});

test('saveCrmLessonSkip — نقرة مزدوجة لا تحفظ مرتين، وباسم المعلم الحالي', async () => {
  const calls = [];
  const client = {
    from(table){
      const chain = {
        select(){ return chain; }, eq(){ return chain; }, gte(){ return chain; }, lte(){ return chain; }, order(){ return chain; }, in(){ return chain; },
        upsert(rows, opts){
          calls.push({ table, rows, opts });
          return { then(res){ setTimeout(() => res({ data: null, error: null }), 20); } };
        },
        then(res){ res({ data: [], error: null }); }
      };
      return chain;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  app.renderCrmToday = () => {};
  app.openCrmSkipModal('A', '2026-10-06', 4);
  await Promise.all([app.saveCrmLessonSkip(), app.saveCrmLessonSkip()]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'classroom_lesson_skips');
  assert.deepEqual({ ...calls[0].rows[0] }, { teacher_id: 'u1', section_id: 'A', lesson_date: '2026-10-06', period: 4, note: null });
});

'use strict';
/* ============================================================
   ملخص الشعبة (app-18-section-summary.js) — الدوال الصرفة
   ------------------------------------------------------------
   من التصميم (المحطة هـ، المرحلة 12):
   - رسم واحد فقط: نسبة من تحت النصف في كل عمود بالترتيب الزمني.
   - الأعداد مع النسب دائمًا ("11 من 30 (37%)").
   - الفجوات: أعمدة فيها 30% فأكثر تحت النصف.
   - مقارنة الشعب: نفس العمود في شعب الصف نفسه.
   - الأكثر تحسّنًا: أسماء، إيجابية فقط. نمط المواقف بلا أسماء.
   - نمط الحضور: جملة حقائق تظهر فقط عند تركّز واضح.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

const col = (id, name, max, extra) => Object.assign({ id, name, category: 'performance', max_score: max, section_id: 'S' }, extra || {});
const sc = (column_id, student_id, score, day) => ({ column_id, student_id, score, updated_at: '2026-10-' + String(day || 1).padStart(2, '0') + 'T08:00:00Z' });

test('sectionGradeTrend — ترتيب زمني ونسبة من تحت النصف', async (t) => {
  const app = loadApp();
  const cols = [col('b', 'واجبات', 10), col('a', 'مشاركة', 10), col('c', 'مهام', 20)];
  const scores = [
    sc('a', 's1', 3, 1), sc('a', 's2', 8, 1), sc('a', 's3', 9, 1), sc('a', 's4', 2, 1),
    sc('b', 's1', 9, 5), sc('b', 's2', 9, 5),
    sc('b', 'gone', 1, 5), // ليس في الشعبة الآن
  ];
  const trend = app.sectionGradeTrend(cols, scores, ['s1', 's2', 's3', 's4']);
  await t.test('الأعمدة بلا درجات تُستبعد، والترتيب بوقت الرصد', () => {
    assert.deepEqual([...trend].map(x => x.name), ['مشاركة', 'واجبات']);
  });
  await t.test('العدد مع النسبة، ومن الطلاب الحاليين فقط', () => {
    assert.equal(trend[0].low, 2);
    assert.equal(trend[0].recorded, 4);
    assert.equal(trend[0].lowPct, 50);
    assert.equal(trend[1].low, 0);
    assert.equal(trend[1].recorded, 2);
  });
  await t.test('الفجوات = 30% فأكثر تحت النصف', () => {
    assert.deepEqual([...app.sectionGradeGaps(trend)].map(x => x.name), ['مشاركة']);
  });
});

test('sectionComparison — نفس العمود في شعب الصف نفسه', async () => {
  const app = loadApp();
  const cols = [
    col('a1', 'مشاركة', 10, { section_id: 'A' }), col('b1', 'المشاركة', 10, { section_id: 'B' }),
    col('a2', 'واجبات', 10, { section_id: 'A' }),
  ];
  const scores = [sc('a1', 'x1', 8), sc('a1', 'x2', 4), sc('b1', 'y1', 3), sc('b1', 'y2', 2), sc('a2', 'x1', 9)];
  const rows = app.sectionComparison('A', cols, scores, { A: ['x1', 'x2'], B: ['y1', 'y2'] });
  assert.equal(rows.length, 1, 'واجبات في شعبة واحدة فقط = لا مقارنة');
  assert.equal(rows[0].name, 'مشاركة');
  assert.deepEqual([...rows[0].sections].map(s => s.sectionId + ':' + s.avgPct + ':' + s.lowPct), ['A:60:50', 'B:25:100']);
});

test('mostImprovedStudents — الإيجابي فقط', async () => {
  const app = loadApp();
  const cols = [col('c1', 'ع1', 10), col('c2', 'ع2', 10), col('c3', 'ع3', 10), col('c4', 'ع4', 10)];
  const scores = [
    sc('c1', 'up', 4, 1), sc('c2', 'up', 4, 2), sc('c3', 'up', 8, 3), sc('c4', 'up', 9, 4),
    sc('c1', 'flat', 7, 1), sc('c2', 'flat', 7, 2), sc('c3', 'flat', 7, 3), sc('c4', 'flat', 7, 4),
    sc('c1', 'down', 9, 1), sc('c2', 'down', 9, 2), sc('c3', 'down', 4, 3), sc('c4', 'down', 4, 4),
  ];
  const out = app.mostImprovedStudents(cols, scores, ['up', 'flat', 'down'], 5);
  assert.deepEqual([...out].map(x => x.id), ['up']);
  assert.equal(out[0].before, 40);
  assert.equal(out[0].after, 85);
});

test('followupImpact — نتائج المتابعات المغلقة وبحسب الإجراء', async () => {
  const app = loadApp();
  const fus = [
    { id: '1', outcome: 'improved' }, { id: '2', outcome: 'improved' }, { id: '3', outcome: 'partial' }, { id: '4', outcome: 'not_improved' },
  ];
  const firstAction = new Map([['1', 'individual_session'], ['2', 'individual_session'], ['3', 'reteach'], ['4', 'individual_session']]);
  const r = app.followupImpact(fus, firstAction);
  assert.equal(r.text, '4 متابعات مغلقة: 2 تحسّن · 1 جزئي · 1 لم يتحسّن');
  assert.deepEqual([...r.byAction].map(a => a.action + ':' + a.improved + '/' + a.total), ['individual_session:2/3', 'reteach:0/1']);
});

test('attendancePattern — جملة فقط عند تركّز واضح', async (t) => {
  const app = loadApp();
  const lesson = (id, date, period) => ({ id, lesson_date: date, period });
  // أحد (2026-10-04) الحصة 6 ثلاث مرات، وثلاثاء الحصة 2 ثلاث مرات
  const lessons = [
    lesson('s1', '2026-09-20', 6), lesson('s2', '2026-09-27', 6), lesson('s3', '2026-10-04', 6),
    lesson('t1', '2026-09-22', 2), lesson('t2', '2026-09-29', 2), lesson('t3', '2026-10-06', 2),
  ];
  await t.test('حصة الأحد السادسة ضعف بقية الحصص أو أكثر', () => {
    const abs = [];
    ['s1', 's2', 's3'].forEach(id => { for(let i = 0; i < 5; i++) abs.push({ lesson_id: id, status: 'absent' }); });
    ['t1', 't2', 't3'].forEach(id => abs.push({ lesson_id: id, status: 'absent' }));
    const p = app.attendancePattern(lessons, abs);
    assert.ok(p);
    assert.match(p, /الأحد الحصة 6/);
    assert.match(p, /5 غائبين في المتوسط مقابل 1/);
  });
  await t.test('بلا تركّز = لا جملة', () => {
    const abs = [];
    lessons.forEach(l => { for(let i = 0; i < 2; i++) abs.push({ lesson_id: l.id, status: 'absent' }); });
    assert.equal(app.attendancePattern(lessons, abs), null);
  });
  await t.test('بيانات قليلة = لا جملة (لا استنتاج من حصتين)', () => {
    assert.equal(app.attendancePattern(lessons.slice(0, 2), [{ lesson_id: 's1', status: 'absent' }]), null);
  });
});

test('incidentPattern — المخالفة الأكثر تكرارًا بلا أسماء', async () => {
  const app = loadApp();
  const types = [{ id: 'a', problem_name: 'إعاقة سير الحصة' }, { id: 'b', problem_name: 'النوم' }];
  const inc = [{ incident_type_id: 'a', student_id: 'x' }, { incident_type_id: 'a', student_id: 'y' }, { incident_type_id: 'b', student_id: 'x' }];
  assert.deepEqual({ ...app.incidentPattern(inc, types) }, { name: 'إعاقة سير الحصة', count: 2, total: 3 });
  assert.equal(app.incidentPattern([inc[0]], types), null, 'مخالفة واحدة لا تصنع نمطًا');
});

test('loadCrmSectionSummaryData — كل استعلام مقيّد بالمعلم الحالي', async () => {
  const T = { academic_year: '1448-1449', semester: 1 };
  const seed = {
    classroom_grade_columns: [Object.assign({ id: 'c1', teacher_id: 'u1', section_id: 'A', category: 'performance', name: 'م', max_score: 10 }, T),
      Object.assign({ id: 'c2', teacher_id: 'u2', section_id: 'A', category: 'performance', name: 'م', max_score: 10 }, T)],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'c1', student_id: 'x', score: 5 }, { teacher_id: 'u2', column_id: 'c1', student_id: 'z', score: 1 }],
    classroom_followups: [{ id: 'f1', teacher_id: 'u1', section_id: 'A', status: 'closed', outcome: 'improved' }, { id: 'f2', teacher_id: 'u2', section_id: 'A', status: 'closed', outcome: 'partial' }],
    classroom_followup_actions: [{ followup_id: 'f1', teacher_id: 'u1', action_type: 'reteach' }, { followup_id: 'f1', teacher_id: 'u2', action_type: 'other' }],
    classroom_lessons: [{ id: 'l1', teacher_id: 'u1', section_id: 'A', lesson_date: '2026-10-04', period: 1 }, { id: 'l2', teacher_id: 'u2', section_id: 'A', lesson_date: '2026-10-04', period: 2 }],
    classroom_attendance: [{ lesson_id: 'l1', teacher_id: 'u1', status: 'absent' }, { lesson_id: 'l1', teacher_id: 'u2', status: 'absent' }],
    classroom_incidents: [{ teacher_id: 'u1', section_id: 'A', incident_type_id: 't' }, { teacher_id: 'u2', section_id: 'A', incident_type_id: 't' }],
  };
  const client = {
    from(table){
      const filters = [];
      const rows = () => (seed[table] || []).filter(r => filters.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; },
        eq(c, v){ filters.push([c, v]); return api; }, in(c, v){ filters.push([c, v]); return api; },
        then(res){ res({ data: rows(), error: null }); },
      };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  const { runInAppContext } = require('./load-app');
  runInAppContext(app, `crmSections = [{ id: 'A', grade_level_id: 'g' }];`);
  app.document.getElementById('crmYearInput').value = '1448-1449';
  app.document.getElementById('crmSemesterSelect').value = 'الفصل الأول';
  const d = await app.loadCrmSectionSummaryData('A');
  assert.deepEqual([...d.columns].map(c => c.id), ['c1']);
  assert.equal(d.scores.length, 1);
  assert.deepEqual([...d.fus].map(f => f.id), ['f1']);
  assert.equal(d.firstAction.get('f1'), 'reteach');
  assert.deepEqual([...d.lessons].map(l => l.id), ['l1']);
  assert.equal(d.attendance.length, 1);
  assert.equal(d.incidents.length, 1);
});

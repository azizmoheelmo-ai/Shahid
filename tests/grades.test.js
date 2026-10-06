'use strict';
/* ============================================================
   كشف الدرجات (app-17-grades.js) — الدوال الصرفة
   ------------------------------------------------------------
   القواعد المتفق عليها بالتصميم:
   - فئتان بسقف: أعمال أدائية 40، اختبارات وتقييمات 20. أقل من السقف مسموح
     ("موزّع X من 40")، وتجاوزه ممنوع برسالة واضحة.
   - خفض الدرجة القصوى لعمود تحت درجة مرصودة ممنوع مع عدد الطلاب.
   - الخانة الفارغة "لم تُرصد" لا صفر — النسبة من الأعمدة المرصودة فقط.
   - الهيكل يُنسخ من الفصل السابق لنفس الشعبة (أعمدة بلا درجات)، وإلا الافتراضي.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

const col = (id, category, max, extra) => Object.assign({ id, category, name: id, max_score: max, position: 0 }, extra || {});

test('parseScoreInput', async (t) => {
  const app = loadApp();
  await t.test('فارغ = لم تُرصد (لا صفر)', () => {
    assert.deepEqual({ ...app.parseScoreInput('  ', 10) }, { ok: true, value: null });
  });
  await t.test('الأرقام العربية والفاصلة العشرية العربية', () => {
    assert.equal(app.parseScoreInput('٨', 10).value, 8);
    assert.equal(app.parseScoreInput('٧٫٥', 10).value, 7.5);
    assert.equal(app.parseScoreInput('7,25', 10).value, 7.25);
  });
  await t.test('الصفر درجة حقيقية', () => {
    assert.deepEqual({ ...app.parseScoreInput('0', 10) }, { ok: true, value: 0 });
  });
  await t.test('أكبر من الدرجة القصوى أو سالبة أو نص = خطأ', () => {
    assert.equal(app.parseScoreInput('11', 10).ok, false);
    assert.equal(app.parseScoreInput('-1', 10).ok, false);
    assert.equal(app.parseScoreInput('ثمانية', 10).ok, false);
    assert.equal(app.parseScoreInput('8.555', 10).ok, false, 'أكثر من منزلتين عشريتين');
  });
});

test('validateGradeColumn', async (t) => {
  const app = loadApp();
  const cols = [col('m', 'performance', 10), col('w', 'performance', 10), col('t1', 'tests', 10), col('t2', 'tests', 10)];
  await t.test('أقل من السقف مسموح', () => {
    assert.equal(app.validateGradeColumn(cols, { category: 'performance', name: 'مهام', max_score: 20 }, []), null);
  });
  await t.test('تجاوز السقف ممنوع ويذكر المتبقي', () => {
    const err = app.validateGradeColumn(cols, { category: 'tests', name: 'قصير', max_score: 5 }, []);
    assert.match(err, /20/);
    assert.match(err, /المتبقي 0/);
  });
  await t.test('تعديل عمود لا يحسب قيمته القديمة مرتين', () => {
    assert.equal(app.validateGradeColumn(cols, { id: 't1', category: 'tests', name: 't1', max_score: 10 }, []), null);
  });
  await t.test('خفض الدرجة القصوى تحت درجات مرصودة ممنوع مع العدد', () => {
    const scores = [{ column_id: 'm', score: 9 }, { column_id: 'm', score: 8 }, { column_id: 'm', score: 5 }];
    const err = app.validateGradeColumn(cols, { id: 'm', category: 'performance', name: 'm', max_score: 6 }, scores);
    assert.match(err, /طالبان/);
  });
  await t.test('الاسم مطلوب والدرجة موجبة', () => {
    assert.ok(app.validateGradeColumn(cols, { category: 'performance', name: ' ', max_score: 5 }, []));
    assert.ok(app.validateGradeColumn(cols, { category: 'performance', name: 'أ', max_score: 0 }, []));
  });
});

test('studentGradeSummary — النسبة مما رُصد فقط', async (t) => {
  const app = loadApp();
  const cols = [col('m', 'performance', 10), col('w', 'performance', 10), col('p', 'performance', 20), col('t1', 'tests', 10)];
  await t.test('عمود بلا درجة لا يُحسب صفرًا', () => {
    const scores = [{ column_id: 'm', student_id: 's', score: 8 }, { column_id: 'w', student_id: 's', score: 6 }];
    const sum = app.studentGradeSummary(cols, scores, 's');
    assert.equal(sum.performance.sum, 14);
    assert.equal(sum.performance.recordedMax, 20);
    assert.equal(sum.performance.pct, 70);
    assert.equal(sum.tests.pct, null, 'لا اختبارات مرصودة = لا نسبة');
  });
  await t.test('درجات طالب آخر لا تدخل', () => {
    const scores = [{ column_id: 'm', student_id: 'x', score: 10 }];
    assert.equal(app.studentGradeSummary(cols, scores, 's').performance.pct, null);
  });
});

test('gradeColumnStats', async () => {
  const app = loadApp();
  const scores = [{ column_id: 'm', student_id: 'a', score: 8 }, { column_id: 'm', student_id: 'b', score: 6 }, { column_id: 'm', student_id: 'gone', score: 1 }];
  const st = app.gradeColumnStats('m', scores, ['a', 'b', 'c']);
  assert.equal(st.missing, 1, 'c بلا درجة');
  assert.equal(st.avg, 7, 'المتوسط من طلاب الشعبة الحاليين فقط');
});

test('previousGradeTerm', async () => {
  const app = loadApp();
  assert.deepEqual({ ...app.previousGradeTerm('1448-1449', 2) }, { year: '1448-1449', semester: 1 });
  assert.deepEqual({ ...app.previousGradeTerm('1448-1449', 1) }, { year: '1447-1448', semester: 2 });
  assert.equal(app.previousGradeTerm('غير معروف', 1), null);
});

test('gradeSheetSeed', async (t) => {
  const app = loadApp();
  await t.test('بلا فصل سابق = الافتراضي (مشاركة 10، واجبات 10، مهام أدائية 20، فترتان 10+10)', () => {
    const seed = app.gradeSheetSeed([]);
    assert.deepEqual([...seed].map(c => c.category + ':' + c.name + ':' + c.max_score), [
      'performance:مشاركة:10', 'performance:واجبات:10', 'performance:مهام أدائية:20',
      'tests:الفترة الأولى:10', 'tests:الفترة الثانية:10',
    ]);
  });
  await t.test('من الفصل السابق: الأعمدة فقط (الاسم والدرجة وماذا يقيس)', () => {
    const prev = [col('x', 'tests', 20, { name: 'اختبار شامل', measures: 'الوحدات 1-3', position: 1, section_id: 'S', academic_year: '1447-1448' })];
    const seed = app.gradeSheetSeed(prev);
    assert.deepEqual({ ...seed[0] }, { category: 'tests', name: 'اختبار شامل', max_score: 20, measures: 'الوحدات 1-3', position: 1 });
  });
});

test('planGradeEntryChanges — ما يُحفظ وما يُحذف', async () => {
  const app = loadApp();
  const prev = new Map([['a', 8], ['b', 5], ['c', 7]]);
  const entries = [
    { studentId: 'a', parsed: { ok: true, value: 8 } },    // بلا تغيير
    { studentId: 'b', parsed: { ok: true, value: 6 } },    // تغيّرت
    { studentId: 'c', parsed: { ok: true, value: null } }, // مُسحت = لم تُرصد
    { studentId: 'd', parsed: { ok: true, value: 0 } },    // صفر حقيقي جديد
    { studentId: 'e', parsed: { ok: true, value: null } }, // فارغة أصلًا
  ];
  const plan = app.planGradeEntryChanges(entries, prev);
  assert.deepEqual([...plan.upserts].map(u => u.student_id + ':' + u.score), ['b:6', 'd:0']);
  assert.deepEqual([...plan.clears], ['c']);
  assert.equal(plan.invalid.length, 0);
});

/* عميل وهمي يطبّق فلاتر .eq/.in فعليًا على بيانات لمعلمَين — كحال حساب
   مسؤول لو أُضيفت للجداول سياسة "المسؤول يشوف الكل" لاحقًا */
function scopedClient(seed, calls){
  return {
    from(table){
      const filters = [];
      const rows = () => (seed[table] || []).filter(r => filters.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; }, gte(){ return api; }, lte(){ return api; },
        eq(c, v){ filters.push([c, v]); return api; },
        in(c, v){ filters.push([c, v]); return api; },
        upsert(r, o){ calls && calls.push({ table, rows: r, opts: o }); return { then(res){ setTimeout(() => res({ data: null, error: null }), 20); } }; },
        delete(){ calls && calls.push({ table, op: 'delete' }); return api; },
        then(res){ res({ data: rows(), error: null }); },
      };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
}

test('loadCrmGradeSheet — أعمدة ودرجات المعلم الحالي فقط', async () => {
  const seed = {
    classroom_grade_columns: [
      { id: 'c1', teacher_id: 'u1', section_id: 'S', academic_year: '1448-1449', semester: 1, category: 'performance', name: 'مشاركة', max_score: 10 },
      { id: 'c2', teacher_id: 'u2', section_id: 'S', academic_year: '1448-1449', semester: 1, category: 'performance', name: 'لمعلم آخر', max_score: 10 },
    ],
    classroom_grade_scores: [
      { id: 'g1', teacher_id: 'u1', column_id: 'c1', student_id: 'a', score: 9 },
      { id: 'g2', teacher_id: 'u2', column_id: 'c1', student_id: 'x', score: 3 },
    ],
  };
  const app = loadApp({ supabaseClient: scopedClient(seed), currentUser: { id: 'u1' } });
  app.document.getElementById('crmYearInput').value = '1448-1449';
  app.document.getElementById('crmSemesterSelect').value = 'الفصل الأول';
  const res = await app.loadCrmGradeSheet('S');
  assert.deepEqual([...res.columns].map(c => c.id), ['c1']);
  assert.deepEqual([...res.scores].map(s => s.id), ['g1']);
});

test('saveCrmGradeEntry — نقرة مزدوجة لا تحفظ مرتين، وباسم المعلم الحالي', async () => {
  const calls = [];
  const app = loadApp({ supabaseClient: scopedClient({}, calls), currentUser: { id: 'u1' } });
  const { runInAppContext } = require('./load-app');
  runInAppContext(app, `
    crmGrades = { sectionId: 'S', year: '1448-1449', semester: 1, columns: [{ id: 'c1', category: 'performance', name: 'مشاركة', max_score: 10 }], scores: [] };
    crmGradeEntry = { columnId: 'c1', saving: false };
    renderCrmGrades = () => {};
  `);
  const input = { value: '٩', dataset: { student: 'a' }, classList: { add(){}, remove(){} } };
  app.document.querySelectorAll = (sel) => sel === '.crm-grade-input' ? [input] : [];
  await Promise.all([app.saveCrmGradeEntry(), app.saveCrmGradeEntry()]);
  const ups = calls.filter(c => c.table === 'classroom_grade_scores' && c.rows);
  assert.equal(ups.length, 1);
  assert.deepEqual({ ...ups[0].rows[0] }, { teacher_id: 'u1', column_id: 'c1', student_id: 'a', score: 9 });
});

test('deleteCrmStudent — التراجع يعيد درجات الطالب أيضًا', async () => {
  const inserts = [];
  const seed = {
    classroom_grade_scores: [{ id: 'g1', teacher_id: 'u1', column_id: 'c1', student_id: 'a', score: 9 }],
  };
  const client = scopedClient(seed);
  const baseFrom = client.from;
  client.from = (table) => {
    const api = baseFrom(table);
    api.insert = (rows) => { inserts.push({ table, rows }); return Promise.resolve({ data: null, error: null }); };
    api.delete = () => api;
    return api;
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  const { runInAppContext } = require('./load-app');
  runInAppContext(app, `
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];
    showConfirm = async () => true;
    showUndoToast = async () => false;   /* المعلم ضغط "تراجع" */
    loadCrmStudents = async () => {}; renderCrmStudentsList = () => {};
    refreshCrmPendingBadges = async () => {}; refreshAcBadges = async () => {};
  `);
  await app.deleteCrmStudent('a');
  const restored = inserts.find(i => i.table === 'classroom_grade_scores');
  assert.ok(restored, 'درجات الطالب يجب أن تُعاد مع التراجع');
  assert.equal(restored.rows[0].id, 'g1');
});

test('planGradeTransfer — درجات المنقول تنتقل لعمود الاسم نفسه في الشعبة الجديدة', async (t) => {
  const app = loadApp();
  const term = { academic_year: '1448-1449', semester: 1 };
  const oldCols = [
    Object.assign({ id: 'o1', section_id: 'OLD', category: 'performance', name: 'مشاركة', max_score: 10 }, term),
    Object.assign({ id: 'o2', section_id: 'OLD', category: 'performance', name: 'مهام  أدائية', max_score: 20 }, term),
    Object.assign({ id: 'o3', section_id: 'OLD', category: 'tests', name: 'اختبار قصير', max_score: 5 }, term),
    Object.assign({ id: 'o4', section_id: 'OLD', category: 'tests', name: 'الفترة الأولى', max_score: 10 }, term),
    { id: 'p1', section_id: 'OLD', category: 'performance', name: 'مشاركة', max_score: 10, academic_year: '1447-1448', semester: 2 },
  ];
  const targetCols = [
    Object.assign({ id: 'n1', section_id: 'NEW', category: 'performance', name: 'مشاركة', max_score: 10 }, term),
    Object.assign({ id: 'n2', section_id: 'NEW', category: 'performance', name: 'مهام أدائية', max_score: 20 }, term),
    Object.assign({ id: 'n4', section_id: 'NEW', category: 'tests', name: 'الفترة الأولى', max_score: 8 }, term),
    Object.assign({ id: 'n5', section_id: 'NEW', category: 'performance', name: 'واجبات', max_score: 10 }, term),
  ];
  const scores = [
    { id: 's1', column_id: 'o1', score: 9 },
    { id: 's2', column_id: 'o2', score: 15 },
    { id: 's3', column_id: 'o3', score: 4 },   // لا عمود بنفس الاسم
    { id: 's4', column_id: 'o4', score: 9 },   // أعلى من حد العمود الجديد (8)
    { id: 's5', column_id: 'p1', score: 7 },   // فصل لا كشف له في الشعبة الجديدة
    { id: 's6', column_id: 'n5', score: 5 },   // موجودة أصلًا في الجديدة — لا تُمس
  ];
  const plan = app.planGradeTransfer(scores, oldCols.concat(targetCols), 'NEW', targetCols);

  await t.test('المطابقة بالاسم والفئة والفصل (والمسافات الزائدة لا تهم)', () => {
    assert.deepEqual([...plan.moves].map(m => m.scoreId + '→' + m.toColumnId), ['s1→n1', 's2→n2']);
  });
  await t.test('ما لا يطابق يبقى في القديمة مع السبب — لا حذف', () => {
    assert.deepEqual([...plan.stay].map(s => s.scoreId), ['s3', 's4']);
    assert.match(plan.stay[0].reason, /لا عمود/);
    assert.match(plan.stay[1].reason, /أعلى/);
  });
  await t.test('فصل بلا كشف في الجديدة: يُنشأ بهيكل القديمة ثم تُنقل', () => {
    assert.deepEqual([...plan.missingTerms].map(m => m.year + '/' + m.semester + '/' + m.sourceSectionId), ['1447-1448/2/OLD']);
    assert.equal(plan.pendingCount, 1);
  });
  await t.test('عمود فيه درجة للطالب أصلًا في الجديدة = لا كتابة فوقها', () => {
    const p2 = app.planGradeTransfer([{ id: 'x', column_id: 'o1', score: 9 }, { id: 'y', column_id: 'n1', score: 5 }],
      oldCols.concat(targetCols), 'NEW', targetCols);
    assert.equal(p2.moves.length, 0);
    assert.match(p2.stay[0].reason, /درجة/);
  });
});

test('moveStudentGrades — يُنشئ الكشف الناقص ثم ينقل، وكل كتابة باسم المعلم الحالي', async () => {
  const term = { academic_year: '1448-1449', semester: 1, teacher_id: 'u1' };
  const seed = {
    classroom_grade_scores: [{ id: 's1', teacher_id: 'u1', column_id: 'o1', student_id: 'a', score: 9 }],
    classroom_grade_columns: [Object.assign({ id: 'o1', section_id: 'OLD', category: 'performance', name: 'مشاركة', max_score: 10, position: 0 }, term)],
  };
  const writes = [];
  const client = scopedClient(seed);
  const baseFrom = client.from;
  client.from = (table) => {
    const api = baseFrom(table);
    const filters = [];
    const baseEq = api.eq;
    api.insert = (rows) => {
      writes.push({ table, op: 'insert', rows });
      rows.forEach((r, i) => seed[table].push(Object.assign({ id: 'new' + i }, r)));
      return Promise.resolve({ data: null, error: null });
    };
    api.update = (vals) => {
      const u = { table, op: 'update', vals, filters };
      writes.push(u);
      const chain = { eq(c, v){ filters.push([c, v]); return chain; }, then(res){
        seed[table].filter(r => filters.every(([c, v]) => r[c] === v)).forEach(r => Object.assign(r, vals));
        res({ data: null, error: null });
      } };
      return chain;
    };
    api.eq = baseEq;
    return api;
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  const res = await app.moveStudentGrades('a', 'NEW');
  assert.equal(res.moved, 1);
  const ins = writes.find(w => w.op === 'insert');
  assert.equal(ins.rows[0].teacher_id, 'u1');
  assert.equal(ins.rows[0].section_id, 'NEW');
  const upd = writes.find(w => w.op === 'update');
  assert.ok(upd.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'), 'نقل الدرجة مقيّد بالمعلم الحالي');
  assert.equal(seed.classroom_grade_scores[0].column_id, 'new0');
});

test('loadAttentionData — أعمدة ودرجات المعلم الحالي فقط (للقاعدتين 8 و9)', async () => {
  const seed = {
    classroom_grade_columns: [
      { id: 'c1', teacher_id: 'u1', section_id: 'S', academic_year: '1448-1449', semester: 1, category: 'performance', name: 'م', max_score: 10 },
      { id: 'c2', teacher_id: 'u2', section_id: 'S', academic_year: '1448-1449', semester: 1, category: 'performance', name: 'آخر', max_score: 10 },
    ],
    classroom_grade_scores: [
      { teacher_id: 'u1', column_id: 'c1', student_id: 'a', score: 9 },
      { teacher_id: 'u2', column_id: 'c1', student_id: 'x', score: 1 },
    ],
  };
  const app = loadApp({ supabaseClient: scopedClient(seed), currentUser: { id: 'u1' } });
  const data = await app.loadAttentionData();
  assert.ok(data);
  assert.deepEqual([...data.gradeColumns].map(c => c.id), ['c1']);
  assert.deepEqual([...data.gradeScores].map(s => s.student_id), ['a']);
});

'use strict';
/* ============================================================
   محرك الانتباه والمتابعات (app-16-attention-followups.js)
   ------------------------------------------------------------
   يثبت القواعد المتفق عليها بالتصميم ومنع الضجيج:
   - غياب 3 من آخر 8 حصص مرصودة خلال 30 يومًا = مهم؛ التأخر/الاستئذان = للمراجعة.
   - الغياب الجماعي (20% فأكثر من الشعبة بنفس الحصة) لا يُحتسب.
   - بطاقة واحدة لكل طالب بأعلى أولوية بين أسبابه.
   - متابعة مفتوحة لنفس السبب تُسكت قاعدته؛ والتجاهل يُخفي 14 يومًا فقط.
   - إنذار أول واحد لا يُنتج بطاقة (الإحالة فقط).
   - المتابعة: "لا بيانات كافية" بدل نتيجة مخترعة، واقتراح النتيجة من قبل/بعد.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

const TODAY = '2026-10-08'; // خميس
const NOW = new Date(2026, 9, 8, 10, 0).getTime();

function baseInput(over){
  return Object.assign({
    todayIso: TODAY, nowMs: NOW,
    students: [], sections: [{ id: 'S' }], lessons: [], attendance: [],
    incidents: [], academicCases: [], followups: [], dismissals: [],
  }, over);
}

/* 10 طلاب في الشعبة S، و8 حصص مرصودة خلال الأسبوعين الماضيين */
function classroom(){
  const students = Array.from({ length: 10 }, (_, i) => ({ id: 'st' + i, full_name: 'طالب ' + i, section_id: 'S', is_active: true }));
  const dates = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
  const lessons = dates.map((d, i) => ({ id: 'L' + i, section_id: 'S', lesson_date: d, period: 1 }));
  return { students, lessons };
}

test('computeAttentionItems — قواعد الحضور', async (t) => {
  const app = loadApp();
  const { students, lessons } = classroom();

  await t.test('غياب 3 من آخر 8 = بطاقة "مهم" بوقائع وتواريخ', () => {
    const attendance = ['L1', 'L4', 'L6'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    const cards = app.computeAttentionItems(baseInput({ students, lessons, attendance }));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].studentId, 'st0');
    assert.equal(cards[0].priority, 'important');
    assert.match(cards[0].reasons[0].text, /^غاب 3 من آخر 8 حصص: /);
    assert.equal(cards[0].reasons[0].action.kind, 'open_followup');
  });

  await t.test('غيابان فقط = لا بطاقة', () => {
    const attendance = ['L1', 'L4'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    assert.equal(app.computeAttentionItems(baseInput({ students, lessons, attendance })).length, 0);
  });

  await t.test('التأخر المتكرر = "للمراجعة" ولا يدخل الشارة', () => {
    const attendance = ['L1', 'L2', 'L3'].map(l => ({ lesson_id: l, student_id: 'st1', status: 'late' }));
    const cards = app.computeAttentionItems(baseInput({ students, lessons, attendance }));
    assert.equal(cards[0].priority, 'review');
    assert.equal(app.attentionBadgeCount(cards), 0);
  });

  await t.test('غياب جماعي (3 من 10 = 30%) بنفس الحصة لا يُحتسب على أحد', () => {
    const attendance = [];
    ['L1', 'L4', 'L6'].forEach(l => {
      ['st0', 'st1', 'st2'].forEach(id => attendance.push({ lesson_id: l, student_id: id, status: 'absent' }));
    });
    assert.equal(app.computeAttentionItems(baseInput({ students, lessons, attendance })).length, 0);
  });

  /* انحدار: كُشف بالمعاينة — في شعبة صغيرة غائب واحد = 20%، فكان كل غياب
     فردي يُعامَل "جماعيًا" ويُتجاهل، فلا تظهر بطاقة أبدًا */
  await t.test('غائبان فقط (حتى لو تجاوزا 20% في شعبة صغيرة) = غياب فردي يُحتسب', () => {
    const small = students.slice(0, 5);
    const attendance = [];
    ['L1', 'L4', 'L6'].forEach(l => {
      attendance.push({ lesson_id: l, student_id: 'st0', status: 'absent' });
      attendance.push({ lesson_id: l, student_id: 'st1', status: 'absent' });
    });
    const cards = app.computeAttentionItems(baseInput({ students: small, lessons, attendance }));
    assert.deepEqual([...cards].map(c => c.studentId).sort(), ['st0', 'st1']);
  });

  await t.test('غياب أقدم من 30 يومًا لا يُحتسب', () => {
    const old = [{ id: 'O1', section_id: 'S', lesson_date: '2026-08-01', period: 1 }, { id: 'O2', section_id: 'S', lesson_date: '2026-08-02', period: 1 }];
    const attendance = ['O1', 'O2', 'L1'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    assert.equal(app.computeAttentionItems(baseInput({ students, lessons: [...lessons, ...old], attendance })).length, 0);
  });

  await t.test('فقط آخر 8 حصص: غياب في حصة تاسعة أقدم لا يُحتسب', () => {
    const ninth = { id: 'L9', section_id: 'S', lesson_date: '2026-09-24', period: 1 };
    const attendance = ['L9', 'L1', 'L4'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    assert.equal(app.computeAttentionItems(baseInput({ students, lessons: [...lessons, ninth], attendance })).length, 0);
  });

  await t.test('متابعة مفتوحة لنفس السبب تُسكت القاعدة', () => {
    const attendance = ['L1', 'L4', 'L6'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    const followups = [{ id: 'F1', student_id: 'st0', reason_type: 'absence', reason_text: 'غياب', status: 'open', review_date: '2026-10-20' }];
    assert.equal(app.computeAttentionItems(baseInput({ students, lessons, attendance, followups })).length, 0);
  });

  await t.test('التجاهل يُخفي 14 يومًا ثم تعود البطاقة', () => {
    const attendance = ['L1', 'L4', 'L6'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    const recent = [{ rule_key: 'absence', subject_key: 'st0', dismissed_at: new Date(NOW - 5 * 86400000).toISOString() }];
    const old = [{ rule_key: 'absence', subject_key: 'st0', dismissed_at: new Date(NOW - 15 * 86400000).toISOString() }];
    assert.equal(app.computeAttentionItems(baseInput({ students, lessons, attendance, dismissals: recent })).length, 0);
    assert.equal(app.computeAttentionItems(baseInput({ students, lessons, attendance, dismissals: old })).length, 1);
  });

  await t.test('طالب غير نشط أو بلا شعبة لا يُفحص حضوره', () => {
    const attendance = ['L1', 'L4', 'L6'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    const inactive = students.map(s => s.id === 'st0' ? Object.assign({}, s, { is_active: false }) : s);
    assert.equal(app.computeAttentionItems(baseInput({ students: inactive, lessons, attendance })).length, 0);
  });
});

test('computeAttentionItems — الخطابات والمتابعات وتجميع البطاقة', async (t) => {
  const app = loadApp();
  const { students, lessons } = classroom();

  await t.test('إحالة بلا خطاب = عاجل، ولا تُتجاهل', () => {
    const incidents = [{ student_id: 'st2', current_stage: 'referred', referral_letter_generated: false, created_at: '2026-10-07T08:00:00Z', typeName: 'الهروب من الحصة' }];
    const cards = app.computeAttentionItems(baseInput({ students, incidents }));
    assert.equal(cards[0].priority, 'urgent');
    assert.equal(cards[0].reasons[0].dismissable, undefined);
    assert.equal(app.attentionUrgentCount(cards), 1);
  });

  await t.test('إنذار أول (غير محوّل) لا يُنتج بطاقة', () => {
    const incidents = [{ student_id: 'st2', current_stage: 'warning_1', referral_letter_generated: false, created_at: '2026-10-07T08:00:00Z' }];
    assert.equal(app.computeAttentionItems(baseInput({ students, incidents })).length, 0);
  });

  await t.test('خطاب بلا توثيق: لا شيء قبل 3 أيام، "مهم" بعدها', () => {
    const fresh = [{ student_id: 'st2', current_stage: 'referred', referral_letter_generated: true, referral_receipt_photo_url: null, created_at: new Date(NOW - 1 * 86400000).toISOString() }];
    const old = [{ student_id: 'st2', current_stage: 'referred', referral_letter_generated: true, referral_receipt_photo_url: null, created_at: new Date(NOW - 4 * 86400000).toISOString() }];
    assert.equal(app.computeAttentionItems(baseInput({ students, incidents: fresh })).length, 0);
    assert.equal(app.computeAttentionItems(baseInput({ students, incidents: old }))[0].priority, 'important');
  });

  await t.test('متابعة حان موعدها = مهم، ومتأخرة أكثر من 7 أيام = عاجل', () => {
    const due = [{ id: 'F', student_id: 'st3', reason_type: 'other', reason_text: 'س', status: 'open', review_date: TODAY }];
    const overdue = [{ id: 'F', student_id: 'st3', reason_type: 'other', reason_text: 'س', status: 'open', review_date: '2026-09-28' }];
    const notYet = [{ id: 'F', student_id: 'st3', reason_type: 'other', reason_text: 'س', status: 'open', review_date: '2026-10-09' }];
    assert.equal(app.computeAttentionItems(baseInput({ students, followups: due }))[0].priority, 'important');
    assert.equal(app.computeAttentionItems(baseInput({ students, followups: overdue }))[0].priority, 'urgent');
    assert.equal(app.computeAttentionItems(baseInput({ students, followups: notYet })).length, 0);
  });

  await t.test('بطاقة واحدة للطالب تجمع أسبابه بأعلى أولوية، والعاجل أولًا بين البطاقات', () => {
    const attendance = ['L1', 'L4', 'L6'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }))
      .concat(['L1', 'L2', 'L3'].map(l => ({ lesson_id: l, student_id: 'st5', status: 'late' })));
    const incidents = [{ student_id: 'st0', current_stage: 'referred', referral_letter_generated: false, created_at: '2026-10-07T08:00:00Z', typeName: 'م' }];
    const cards = app.computeAttentionItems(baseInput({ students, lessons, attendance, incidents }));
    assert.equal(cards.length, 2);
    assert.equal(cards[0].studentId, 'st0');
    assert.equal(cards[0].priority, 'urgent');
    assert.deepEqual([...cards[0].reasons].map(r => r.rule), ['referral_no_letter', 'absence']);
    assert.equal(cards[1].priority, 'review');
  });
});

test('defaultReviewDate', async () => {
  const app = loadApp();
  // 2026-10-08 خميس + 14 = 2026-10-22 خميس
  assert.equal(app.defaultReviewDate('2026-10-08'), '2026-10-22');
  // 2026-10-09 جمعة + 14 = جمعة → يُقدَّم للخميس
  assert.equal(app.defaultReviewDate('2026-10-09'), '2026-10-22');
  // سبت + 14 = سبت → الخميس قبله
  assert.equal(app.defaultReviewDate('2026-10-10'), '2026-10-22');
});

test('computeFollowupResult / suggestFollowupOutcome', async (t) => {
  const app = loadApp();
  const lessonsAfter = (n) => Array.from({ length: n }, (_, i) => ({ id: 'A' + i, lesson_date: '2026-10-' + String(10 + i).padStart(2, '0') }));
  const fu = { reason_type: 'absence', student_id: 'st0', created_at: '2026-10-08T08:00:00', baseline: { count: 3, of: 8 } };

  await t.test('أقل من 4 حصص بعد الفتح = لا بيانات كافية، ولا اقتراح', () => {
    const r = app.computeFollowupResult(fu, lessonsAfter(3), [], []);
    assert.equal(r.sufficient, false);
    assert.equal(app.suggestFollowupOutcome(fu, r), null);
  });
  await t.test('غياب واحد أو أقل بعد الفتح = تحسّن', () => {
    const r = app.computeFollowupResult(fu, lessonsAfter(6), [{ lesson_id: 'A1', student_id: 'st0', status: 'absent' }], []);
    assert.equal(r.count, 1);
    assert.equal(app.suggestFollowupOutcome(fu, r), 'improved');
  });
  await t.test('نسبة أقل من قبل لكن ليست ضئيلة = جزئي', () => {
    // قبل 3/8 = 37.5%؛ بعد 2/8 = 25%
    const att = ['A1', 'A2'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    assert.equal(app.suggestFollowupOutcome(fu, app.computeFollowupResult(fu, lessonsAfter(8), att, [])), 'partial');
  });
  await t.test('نفس النسبة أو أسوأ = لم يتحسّن', () => {
    const att = ['A0', 'A1', 'A2'].map(l => ({ lesson_id: l, student_id: 'st0', status: 'absent' }));
    assert.equal(app.suggestFollowupOutcome(fu, app.computeFollowupResult(fu, lessonsAfter(5), att, [])), 'not_improved');
  });
  await t.test('حصص يوم الفتح نفسه لا تُحسب "بعد"', () => {
    const sameDay = [{ id: 'X', lesson_date: '2026-10-08' }, ...lessonsAfter(3)];
    assert.equal(app.computeFollowupResult(fu, sameDay, [], []).of, 3);
  });
  await t.test('السلوك: تكرار نفس المخالفة بعد الفتح = لم يتحسّن', () => {
    const b = { reason_type: 'behavior', student_id: 'st0', created_at: '2026-10-08T08:00:00', baseline: { incident_type_id: 'T' } };
    const none = app.computeFollowupResult(b, [], [], [{ incident_type_id: 'T', incident_date: '2026-10-01' }, { incident_type_id: 'Q', incident_date: '2026-10-12' }]);
    assert.equal(app.suggestFollowupOutcome(b, none), 'improved');
    const again = app.computeFollowupResult(b, [], [], [{ incident_type_id: 'T', incident_date: '2026-10-12' }]);
    assert.equal(app.suggestFollowupOutcome(b, again), 'not_improved');
  });
  await t.test('سبب بلا مؤشر رقمي = حكم المعلم فقط', () => {
    const o = { reason_type: 'other', created_at: '2026-10-08T08:00:00' };
    assert.equal(app.suggestFollowupOutcome(o, app.computeFollowupResult(o, [], [], [])), null);
  });
});

test('homeActionCardState — سطر إدارة الصف العاجل', async (t) => {
  const app = loadApp();
  await t.test('عاجل بإدارة الصف يظهر بندًا', () => {
    const s = app.homeActionCardState(0, 0, 'ok', true, 2);
    assert.equal(s.mode, 'items');
    assert.equal(s.items[0].kind, 'classroom');
  });
  await t.test('فشل فحص إدارة الصف (null) يمنع "لا إجراء عاجل" الكاذبة', () => {
    assert.equal(app.homeActionCardState(0, 0, 'ok', true, null).mode, 'hidden');
  });
  await t.test('صفر عاجل = "لا إجراء عاجل" كالمعتاد', () => {
    assert.equal(app.homeActionCardState(0, 0, 'ok', true, 0).mode, 'clear');
  });
});

test('sheetMarkersFor — علامات ورقة الرصد', async (t) => {
  const app = loadApp();
  const cache = {
    cards: [
      { studentId: 'a', priority: 'urgent', reasons: [
        { rule: 'referral_no_letter', priority: 'urgent', text: 'بلغت الإحالة', action: { kind: 'crm_pending' } },
        { rule: 'absence', priority: 'important', text: 'غاب 3 من آخر 8', action: { kind: 'open_followup', reasonType: 'absence' } },
      ] },
      { studentId: 'b', priority: 'urgent', reasons: [
        { rule: 'referral_no_letter', priority: 'urgent', text: 'بلغت الإحالة', action: { kind: 'crm_pending' } },
      ] },
      { studentId: 'c', priority: 'urgent', reasons: [
        { rule: 'followup_due', priority: 'urgent', text: 'متابعة متأخرة', action: { kind: 'review', followupId: 'F1' } },
      ] },
      { studentId: 'other-section', priority: 'important', reasons: [
        { rule: 'absence', priority: 'important', text: 'غاب', action: { kind: 'open_followup' } },
      ] },
    ],
    data: { followups: [
      { id: 'F2', student_id: 'd', status: 'open', reason_text: 'الواجبات', review_date: '2026-10-20' },
      { id: 'F1', student_id: 'c', status: 'open', reason_text: 'س', review_date: '2026-09-20' },
    ] },
  };
  const m = app.sheetMarkersFor(cache, ['a', 'b', 'c', 'd', 'e'], '2026-10-08');

  await t.test('الخطابات (عمل مكتبي) لا تصنع علامة — ولا ترفع أولوية علامة الطالب', () => {
    assert.equal(m.has('b'), false);
    assert.equal(m.get('a').priority, 'important');
    assert.deepEqual([...m.get('a').reasons].map(r => r.rule), ['absence']);
  });
  await t.test('متابعة متأخرة تبقى بأولويتها (عاجل)', () => {
    assert.equal(m.get('c').priority, 'urgent');
    assert.equal(m.get('c').reasons.length, 1, 'لا تكرار بين بطاقة الاستحقاق والمتابعة المفتوحة');
  });
  await t.test('متابعة لم يحن موعدها = علامة رمادية للتذكير', () => {
    assert.equal(m.get('d').priority, 'info');
    assert.match(m.get('d').reasons[0].text, /متابعة مفتوحة: الواجبات/);
  });
  await t.test('طلاب الشعبة فقط، ومن لا شيء له بلا علامة', () => {
    assert.equal(m.has('other-section'), false);
    assert.equal(m.has('e'), false);
  });
  await t.test('فشل تحميل الانتباه = لا علامات (لا خطأ)', () => {
    assert.equal(app.sheetMarkersFor(null, ['a'], '2026-10-08').size, 0);
  });
});

test('computeAttentionItems — المنقول خارج المدرسة لا يُنتج بطاقات', () => {
  const app = loadApp();
  const students = [{ id: 'gone', full_name: 'منقول', section_id: 'S', is_active: false }];
  const cards = app.computeAttentionItems(baseInput({
    students,
    incidents: [{ id: 'I1', student_id: 'gone', current_stage: 'referred', referral_letter_generated: false, created_at: '2026-10-01T08:00:00Z' }],
    followups: [{ id: 'F1', student_id: 'gone', status: 'open', reason_type: 'absence', reason_text: 'غياب', review_date: '2026-09-20' }],
  }));
  /* متابعته المفتوحة وإحالته المعلّقة تبقيان بسجله، لكن لا تنبيه عاجل
     لطالب لم يعد عندك — وإلا ظلّت البطاقة الحمراء تلاحقك بلا نهاية */
  assert.equal(cards.length, 0);
});

/* ============ قواعد الدرجات (الإصدار الثاني) ============ */
function gradeFixture(pcts){
  /* pcts: { studentId: [score من 10 لكل عمود بالترتيب الزمني] } — عمود أدائي لكل خانة */
  const ids = Object.keys(pcts);
  const n = Math.max(...ids.map(id => pcts[id].length));
  const gradeColumns = Array.from({ length: n }, (_, i) => ({ id: 'c' + i, section_id: 'S', category: 'performance', name: 'عمود ' + (i + 1), max_score: 10 }));
  const gradeScores = [];
  ids.forEach(id => pcts[id].forEach((v, i) => {
    if(v !== null) gradeScores.push({ column_id: 'c' + i, student_id: id, score: v, updated_at: '2026-10-0' + (i + 1) + 'T08:00:00Z' });
  }));
  return { gradeColumns, gradeScores };
}
const tenStudents = () => Array.from({ length: 10 }, (_, i) => ({ id: 'st' + i, full_name: 'طالب ' + i, section_id: 'S', is_active: true }));

test('القاعدة 8 — تحت النصف: بطاقة على مستوى الشعبة لا لكل طالب', async (t) => {
  const app = loadApp();
  await t.test('3 من 10 (30%) = جماعي مهم، ببطاقة واحدة', () => {
    const g = gradeFixture({ st0: [3], st1: [4], st2: [2], st3: [8], st4: [9], st5: [7], st6: [6], st7: [10], st8: [5], st9: [8] });
    const cards = app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents() }, g)));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].kind, 'section');
    assert.equal(cards[0].priority, 'important');
    assert.match(cards[0].reasons[0].text, /3 من 10 تحت النصف في الأعمال الأدائية/);
    assert.deepEqual([...cards[0].lowStudents].map(x => x.id).sort(), ['st0', 'st1', 'st2']);
  });
  await t.test('طالبان فقط = للمراجعة (لا تدخل الشارة)', () => {
    const g = gradeFixture({ st0: [3], st1: [4], st2: [8], st3: [8] });
    const cards = app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents() }, g)));
    assert.equal(cards[0].priority, 'review');
    assert.equal(app.attentionBadgeCount(cards), 0);
  });
  await t.test('الفارغ ليس صفرًا: من لم تُرصد له درجة لا يُعدّ', () => {
    const g = gradeFixture({ st0: [8], st1: [9] });
    assert.equal(app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents() }, g))).length, 0);
  });
  await t.test('متابعة تحصيل مفتوحة تُخرج الطالب من العدّ', () => {
    const g = gradeFixture({ st0: [3], st1: [4], st2: [2], st3: [8] });
    const followups = ['st0', 'st1', 'st2'].map(id => ({ id: 'F' + id, student_id: id, status: 'open', reason_type: 'grades', reason_text: 'تحصيل', review_date: '2026-10-20' }));
    assert.equal(app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents(), followups }, g))).length, 0);
  });
  await t.test('التجاهل على مستوى الشعبة والفئة', () => {
    const g = gradeFixture({ st0: [3], st1: [4], st2: [2] });
    const dismissals = [{ rule_key: 'grades_low', subject_key: 'section:S:performance', dismissed_at: new Date(NOW - 86400000).toISOString() }];
    assert.equal(app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents(), dismissals }, g))).length, 0);
  });
  await t.test('المنقول خارج المدرسة لا يُعدّ', () => {
    const students = tenStudents(); students[0].is_active = false;
    const g = gradeFixture({ st0: [3], st1: [9] });
    assert.equal(app.computeAttentionItems(baseInput(Object.assign({ students }, g))).length, 0);
  });
});

test('القاعدة 9 — التراجع: آخر عمودين أقل من معدله السابق بـ20 نقطة', async (t) => {
  const app = loadApp();
  await t.test('كان 80% ← آخر عمودين 55% = للمراجعة، فردية', () => {
    const g = gradeFixture({ st0: [8, 8, 6, 5], st1: [8, 8, 8, 8] });
    const cards = app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents() }, g)));
    const c = cards.find(x => x.studentId === 'st0');
    assert.ok(c);
    assert.equal(c.priority, 'review');
    assert.match(c.reasons[0].text, /كان 80% ← آخر عمودين 55%/);
    assert.equal(c.reasons[0].action.reasonType, 'grades');
  });
  await t.test('أقل من 4 أعمدة مرصودة = لا حكم', () => {
    const g = gradeFixture({ st0: [9, 5, 4] });
    assert.equal(app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents() }, g))).filter(c => c.studentId === 'st0').length, 0);
  });
  await t.test('تراجع أقل من 20 نقطة = لا بطاقة', () => {
    const g = gradeFixture({ st0: [8, 8, 7, 7] });
    assert.equal(app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents() }, g))).length, 0);
  });
  await t.test('متابعة تحصيل مفتوحة تُسكت التراجع', () => {
    const g = gradeFixture({ st0: [8, 8, 6, 5] });
    const followups = [{ id: 'F1', student_id: 'st0', status: 'open', reason_type: 'grades', reason_text: 'تحصيل', review_date: '2026-10-20' }];
    assert.equal(app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents(), followups }, g))).length, 0);
  });
});

test('علامات ورقة الرصد — الدرجات علامة زرقاء للمراجعة', async () => {
  const app = loadApp();
  const g = gradeFixture({ st0: [3], st1: [4], st2: [2], st3: [8], st4: [8, 8, 6, 5] });
  const data = baseInput(Object.assign({ students: tenStudents() }, g));
  const cache = { cards: app.computeAttentionItems(data), data };
  const m = app.sheetMarkersFor(cache, ['st0', 'st4', 'st3'], TODAY);
  assert.equal(m.get('st0').priority, 'review');
  assert.match(m.get('st0').reasons[0].text, /تحت النصف/);
  assert.equal(m.get('st0').reasons[0].action.reasonType, 'grades');
  assert.ok(m.get('st4'), 'التراجع علامة أيضًا');
  assert.equal(m.has('st3'), false);
});

/* ============ متابعة التحصيل والمتابعة الجماعية ============ */
test('gradeFollowupBaseline — خط أساس التحصيل يُجمَّد وقت الفتح', async (t) => {
  const app = loadApp();
  const cols = [
    { id: 'p1', category: 'performance', max_score: 10 }, { id: 'p2', category: 'performance', max_score: 10 },
    { id: 't1', category: 'tests', max_score: 10 },
  ];
  const scores = [
    { column_id: 'p1', student_id: 's', score: 3 }, { column_id: 'p2', student_id: 's', score: 4 },
    { column_id: 't1', student_id: 's', score: 6 },
  ];
  await t.test('الفئة المحددة', () => {
    assert.deepEqual({ ...app.gradeFollowupBaseline(cols, scores, 's', 'tests') }, { category: 'tests', pct: 60, sum: 6, max: 10 });
  });
  await t.test('بلا فئة = الأضعف بين المرصود', () => {
    assert.equal(app.gradeFollowupBaseline(cols, scores, 's').category, 'performance');
    assert.equal(app.gradeFollowupBaseline(cols, scores, 's').pct, 35);
  });
  await t.test('بلا درجات = null (لا خط أساس مخترع)', () => {
    assert.equal(app.gradeFollowupBaseline(cols, [], 's'), null);
  });
});

test('computeGradeFollowupResult — "بعد" = ما رُصد بعد الفتح فقط', async (t) => {
  const app = loadApp();
  const cols = [{ id: 'p1', category: 'performance', max_score: 10 }, { id: 'p2', category: 'performance', max_score: 10 }, { id: 't1', category: 'tests', max_score: 10 }];
  const f = { student_id: 's', reason_type: 'grades', created_at: '2026-10-01T08:00:00Z', baseline: { category: 'performance', pct: 35 } };
  await t.test('لا درجة جديدة بعد الفتح = لا بيانات كافية', () => {
    const r = app.computeGradeFollowupResult(f, cols, [{ column_id: 'p1', student_id: 's', score: 3, updated_at: '2026-09-20T08:00:00Z' }]);
    assert.equal(r.sufficient, false);
  });
  await t.test('درجات الفئة نفسها بعد الفتح', () => {
    const r = app.computeGradeFollowupResult(f, cols, [
      { column_id: 'p1', student_id: 's', score: 3, updated_at: '2026-09-20T08:00:00Z' },
      { column_id: 'p2', student_id: 's', score: 7, updated_at: '2026-10-05T08:00:00Z' },
      { column_id: 't1', student_id: 's', score: 1, updated_at: '2026-10-05T08:00:00Z' },
      { column_id: 'p2', student_id: 'x', score: 1, updated_at: '2026-10-05T08:00:00Z' },
    ]);
    assert.deepEqual({ ...r }, { sufficient: true, pct: 70, of: 1 });
    assert.equal(app.suggestFollowupOutcome(f, r), 'improved');
  });
  await t.test('اقتراح: أعلى من قبل لكن تحت النصف = جزئي؛ لم يرتفع = لم يتحسّن', () => {
    assert.equal(app.suggestFollowupOutcome(f, { sufficient: true, pct: 45, of: 1 }), 'partial');
    assert.equal(app.suggestFollowupOutcome(f, { sufficient: true, pct: 30, of: 1 }), 'not_improved');
  });
});

test('المتابعة الجماعية — بطاقة واحدة عند حلول موعدها لا بطاقة لكل طالب', async () => {
  const app = loadApp();
  const followups = ['st0', 'st1', 'st2'].map(id => ({ id: 'F' + id, student_id: id, group_id: 'G1', status: 'open', reason_type: 'grades', reason_text: 'تحت النصف', review_date: '2026-10-08' }));
  const data = baseInput({ students: tenStudents(), followups });
  const cards = app.computeAttentionItems(data);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, 'group');
  assert.equal(cards[0].key, 'group:G1');
  assert.match(cards[0].reasons[0].text, /متابعة جماعية "تحت النصف" \(3 طلاب\)/);
  assert.deepEqual([...cards[0].memberIds].sort(), ['st0', 'st1', 'st2']);
  // علامة "حان موعدها" لكل عضو في ورقة الرصد
  const m = app.sheetMarkersFor({ cards, data }, ['st0', 'st5'], TODAY);
  assert.equal(m.get('st0').reasons[0].rule, 'followup_due');
  assert.equal(m.has('st5'), false);
});

test('groupOutcomeSummary — "X من Y تحسّنوا"', async () => {
  const app = loadApp();
  const s = app.groupOutcomeSummary([{ outcome: 'improved' }, { outcome: 'improved' }, { outcome: 'partial' }, { outcome: 'not_improved' }]);
  assert.equal(s, '2 من 4 تحسّنوا · 1 جزئي · 1 لم يتحسّن');
});

test('collapseFollowupGroups — أعضاء الجماعية صف واحد', async () => {
  const app = loadApp();
  const rows = [
    { id: '1', student_id: 'a', group_id: 'G', reason_text: 'تحت النصف' },
    { id: '2', student_id: 'x', group_id: null, reason_text: 'غياب' },
    { id: '3', student_id: 'b', group_id: 'G', reason_text: 'تحت النصف' },
  ];
  const out = app.collapseFollowupGroups(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].members.length, 2);
  assert.equal(out[1].id, '2');
});

/* ============ مسودة الشاهد من متابعة انتهت بتحسّن ============ */
test('buildFollowupShahidDraft — مسودة بلا اسم الطالب افتراضيًا', async (t) => {
  const app = loadApp();
  const f = { id: 'F1', student_id: 's', reason_type: 'absence', reason_text: 'غاب 3 من آخر 8 حصص', outcome: 'improved',
    baseline: { count: 3, of: 8 }, result: { sufficient: true, count: 1, of: 7 }, created_at: '2026-09-17T08:00:00Z', closed_at: '2026-10-05T08:00:00Z' };
  const actions = [{ action_type: 'individual_session', note: 'حوار عن أسباب الغياب', action_date: '2026-09-17' }];
  const base = { members: [{ followup: f, studentName: 'خالد سعد' }], actions, sectionLabel: 'ثاني ثانوي — الشعبة ٦' };
  await t.test('الاسم مخفي: "طالب في الشعبة"', () => {
    const d = app.buildFollowupShahidDraft(base);
    assert.equal(d.elementKey, 'الإدارة الصفية');
    assert.match(d.description, /طالب في ثاني ثانوي — الشعبة ٦/);
    assert.doesNotMatch(JSON.stringify(d), /خالد/);
    assert.match(d.quant, /قبل: غاب 3 من 8 حصص · بعد: غاب 1 من 7 حصص/);
    assert.deepEqual([...d.steps], ['جلسة فردية — حوار عن أسباب الغياب (2026-09-17)']);
    assert.match(d.reflection, /لا تثبت أنه سببه/);
    assert.equal(d.date, '2026-10-05');
  });
  await t.test('إظهار الاسم باختيار المعلم فقط', () => {
    const d = app.buildFollowupShahidDraft(Object.assign({ showNames: true }, base));
    assert.match(d.description, /خالد سعد/);
  });
  await t.test('التحصيل = عنصر "تحسين نتائج المتعلمين"', () => {
    const g = Object.assign({}, f, { reason_type: 'grades', reason_text: 'تحت النصف', baseline: { category: 'performance', pct: 30 }, result: { sufficient: true, pct: 80, of: 1 } });
    const d = app.buildFollowupShahidDraft({ members: [{ followup: g, studentName: 'خالد' }], actions, sectionLabel: '2/6' });
    assert.equal(d.elementKey, 'تحسين نتائج المتعلمين');
    assert.match(d.quant, /قبل: أدائي 30% · بعد: 80%/);
  });
  await t.test('جماعية: العدد والنتيجة لكل طالب بلا أسماء', () => {
    const mk = (id, out, b, a) => ({ followup: Object.assign({}, f, { id, student_id: id, reason_type: 'grades', group_id: 'G', reason_text: 'تحت النصف في الأعمال الأدائية', outcome: out, baseline: { category: 'performance', pct: b }, result: { sufficient: true, pct: a, of: 1 } }), studentName: 'اسم ' + id });
    const d = app.buildFollowupShahidDraft({ members: [mk('a', 'improved', 30, 70), mk('b', 'partial', 20, 40), mk('c', 'improved', 40, 60)], actions, sectionLabel: '2/6' });
    assert.match(d.description, /3 طلاب في 2\/6/);
    assert.match(d.quant, /2 من 3 تحسّنوا · 1 جزئي/);
    assert.match(d.quant, /طالب 1: 30% ← 70%/);
    assert.doesNotMatch(JSON.stringify(d), /اسم a/);
  });
});

test('بطاقة "تحسّن بعد التدخل" — معلومات لا تدخل الشارة', async (t) => {
  const app = loadApp();
  const closedAt = new Date(NOW - 2 * 86400000).toISOString();
  const imp = (extra) => Object.assign({ id: 'F1', student_id: 'st0', status: 'closed', outcome: 'improved', reason_type: 'absence', reason_text: 'غياب', closed_at: closedAt, shahid_id: null }, extra || {});
  await t.test('تظهر كمعلومة مع إجراء "إضافتها كشاهد"', () => {
    const cards = app.computeAttentionItems(baseInput({ students: tenStudents(), improvedFollowups: [imp()] }));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].priority, 'info');
    assert.equal(cards[0].reasons[0].action.kind, 'make_shahid');
    assert.equal(app.attentionBadgeCount(cards), 0);
  });
  await t.test('أُضيفت كشاهد أو مضى 14 يومًا = تختفي', () => {
    assert.equal(app.computeAttentionItems(baseInput({ students: tenStudents(), improvedFollowups: [imp({ shahid_id: 'S1' })] })).length, 0);
    const old = new Date(NOW - 15 * 86400000).toISOString();
    assert.equal(app.computeAttentionItems(baseInput({ students: tenStudents(), improvedFollowups: [imp({ closed_at: old })] })).length, 0);
  });
  await t.test('الجماعية = بطاقة واحدة', () => {
    const list = ['st0', 'st1'].map((id, i) => imp({ id: 'F' + i, student_id: id, group_id: 'G' }));
    const cards = app.computeAttentionItems(baseInput({ students: tenStudents(), improvedFollowups: list }));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].key, 'improved:G');
  });
  await t.test('تُرتَّب بعد كل ما سواها', () => {
    const g = { followups: [{ id: 'X', student_id: 'st5', status: 'open', reason_type: 'other', reason_text: 'س', review_date: TODAY }] };
    const cards = app.computeAttentionItems(baseInput(Object.assign({ students: tenStudents(), improvedFollowups: [imp()] }, g)));
    assert.equal(cards[cards.length - 1].priority, 'info');
  });
});

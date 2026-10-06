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

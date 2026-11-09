'use strict';
/* ============================================================
   المرحلة 2 (app-46 + app-45/44): محرّر الأسئلة، الاستبانة المخصّصة (طلاب بأعينهم + جهة أخرى)، تعديل الأسئلة قبل
   الإرسال، وحذف الاستبانة:
   - الأسئلة نسخة عمل لا تُكتب للقاعدة إلا عند «تم» (بوضع التعديل) أو عند الإنشاء، والحَكَم المدقّق المشترك.
   - المخصّصة: قالب فارغ، عتبة نتائج 1، تذاكر طلاب بجهتها وجهات أخرى بالاسم والرقم، وتراجع نظيف عند الفشل.
   - الحذف: عبر delete_survey فقط، بسؤال بالعواقب (وثانٍ مع الردود)، بلا نقرة مزدوجة، وتُعلَن النتيجة الحقيقية.
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { makeApp, runInAppContext, FUTURE, GOOD, J } = require('./survey-kit');
const { SURVEY_READY_TEMPLATES } = require('../survey-templates.js');
const root = path.join(__dirname, '..');

const GQ = J(SURVEY_READY_TEMPLATES.guardian_v1.questions);
const STUDENTS = [
  { id: 'a', full_name: 'أحمد', section_id: 'sec1', is_active: true, guardian_phone: '966501234567', student_phone: '966551234567' },
  { id: 'b', full_name: 'بدر', section_id: 'sec1', is_active: true, guardian_phone: null, student_phone: '966551111111' },
  { id: 'e', full_name: 'عمر', section_id: 'sec2', is_active: true, guardian_phone: '966503333333', student_phone: null }
];
const camp = (o) => Object.assign({ id: 'c1', teacher_id: 'u1', title: 'استبانتي', audience: 'guardian', template: 'guardian_v1', questions: J(GQ), status: 'open', closes_at: FUTURE(), sort_order: 0, min_results: 5, created_at: 'x' }, o || {});

const startCreate = async (opts) => {
  const k = makeApp(opts);
  runInAppContext(k.app, `showTools(); window.__opened = []; openSurvey = id => window.__opened.push(id);`);
  await runInAppContext(k.app, `toolsGo('create'); (async () => { for(let i = 0; i < 8; i++) await null; })()`);
  return k;
};
const ev = (k, code) => runInAppContext(k.app, code);

/* ============ دوال صرفة ============ */

test('معرّف السؤال الجديد: أصغر q غير مستعمل، وفارغة تبدأ q1، وممتلئة تُرجع null', () => {
  const { app } = makeApp();
  assert.equal(app.toolsNextQuestionId([]), 'q1');
  assert.equal(app.toolsNextQuestionId([{ id: 'q1' }, { id: 'q3' }]), 'q2');
  assert.equal(app.toolsNextQuestionId(Array.from({ length: 99 }, (_, i) => ({ id: 'q' + (i + 1) }))), null);
});

test('تحريك السؤال: نسخة جديدة، والأصل لا يتغيّر، والحافة null', () => {
  const { app } = makeApp();
  const l = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
  assert.deepEqual(J(app.toolsMoveQuestion(l, 0, 1)).map(q => q.id), ['q2', 'q1', 'q3']);
  assert.deepEqual(l.map(q => q.id), ['q1', 'q2', 'q3'], 'الأصل كما هو');
  assert.equal(app.toolsMoveQuestion(l, 0, -1), null);
  assert.equal(app.toolsMoveQuestion(l, 2, 1), null);
  assert.equal(app.toolsMoveQuestion(l, 9, 1), null);
});

test('بناء السؤال: نصوص مقصوصة، خيارات فارغة تُهمل، والخيارات للاختيار وحده', () => {
  const { app } = makeApp();
  assert.deepEqual(J(app.toolsBuildQuestion({ type: 'choice', label: '  هل؟  ', required: true, options: [' أ ', '', 'ب'] }, 'q4')), { id: 'q4', type: 'choice', label: 'هل؟', required: true, options: ['أ', 'ب'] });
  assert.deepEqual(J(app.toolsBuildQuestion({ type: 'rating', label: 'x', required: false, options: ['أ', 'ب'] }, 'q5')), { id: 'q5', type: 'rating', label: 'x', required: false });
});

test('عدد الروابط: لكل جهة لها رقم فعلًا فقط، ومعها الجهات الأخرى', () => {
  const { app } = makeApp();
  const r = { students: { a: { guardian: true, student: true }, b: { guardian: true, student: false }, zz: { guardian: true } }, others: [{ label: 'x', phone: '966500000001' }] };
  const c = J(app.toolsRecipCount(r, STUDENTS));
  assert.deepEqual(c, { students: 1, others: 1, links: 3 }, 'أحمد بجهتين + الأخرى؛ بدر بلا رقم ولي أمر؛ مجهول يُهمل');
});

test('نصوص الأخطاء مفهومة، والمجهول له نص عام', () => {
  const { app } = makeApp();
  assert.match(app.toolsQuestionErrorText('bad_label:3'), /نص السؤال/);
  assert.match(app.toolsQuestionErrorText('bad_options:0'), /2 إلى 8/);
  assert.match(app.toolsQuestionErrorText('count'), /1 إلى 12/);
  assert.match(app.toolsQuestionErrorText('???'), /غير صالحة/);
});

/* ============ محرّر الأسئلة (وضع الإنشاء) ============ */

test('المحرّر: يفتح بنسخة عمل من أسئلة القالب (9)، والحذف والتحريك على النسخة لا على القالب', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsEditQuestions('create')`);
  assert.equal(ev(k, 'toolsState.qed.questions.length'), 9);
  assert.equal((k.app.__els.toolsBody.innerHTML.match(/class="tq-tile"/g) || []).length, 9);
  ev(k, `toolsQDelete(0); toolsQMove(0, 1)`);
  assert.equal(ev(k, 'toolsState.qed.questions.length'), 8);
  assert.equal(SURVEY_READY_TEMPLATES.guardian_v1.questions.length, 9, 'القالب الجاهز لم يتأثر');
  assert.equal(ev(k, 'toolsState.create.questions.length'), 9, 'حالة الإنشاء لم تتغيّر قبل «تم»');
});

test('إضافة سؤال اختيار: يأخذ q10، ويُرفض بلا نص أو بخيار واحد، ويُقبل صحيحًا', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsEditQuestions('create'); toolsQAdd(); toolsQSetType('choice')`);
  assert.match(k.app.__els.toolsBody.innerHTML, /الخيارات/);
  ev(k, `toolsQSave()`); /* بلا نص */
  assert.match(k.app.__els.toolsBody.innerHTML, /نص السؤال مطلوب/);
  ev(k, `toolsQSetLabel('ما أفضل وقت؟'); toolsQSetOption(0, 'صباحًا'); toolsQSetOption(1, '   '); toolsQSave()`); /* خيار واحد فعلي */
  assert.match(k.app.__els.toolsBody.innerHTML, /2 إلى 8/);
  ev(k, `toolsQSetOption(1, 'مساءً'); toolsQSave()`);
  assert.equal(k.app.__els.toolsTitle.textContent, 'أسئلة الاستبانة');
  const last = J(ev(k, 'toolsState.qed.questions[toolsState.qed.questions.length - 1]'));
  assert.deepEqual(last, { id: 'q10', type: 'choice', label: 'ما أفضل وقت؟', required: true, options: ['صباحًا', 'مساءً'] });
});

test('الحد الأقصى 12: بعد الوصول لا زر إضافة', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsEditQuestions('create')`);
  for(let i = 0; i < 3; i++) ev(k, `toolsQAdd(); toolsQSetLabel('سؤال ${i}'); toolsQSave()`);
  assert.equal(ev(k, 'toolsState.qed.questions.length'), 12);
  assert.match(k.app.__els.toolsBody.innerHTML, /onclick="toolsQAdd\(\)" disabled/);
  ev(k, `toolsQAdd()`);
  assert.ok(k.app.__toasts.some(t => /الحد الأقصى 12/.test(t)));
});

test('تعديل سؤال قائم: يُبقي المعرّف، وتغيير النوع يضبط الإجباري (النص اختياري)', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsEditQuestions('create'); toolsQEdit(0); toolsQSetType('text'); toolsQSetLabel('وصف حر'); toolsQSave()`);
  assert.deepEqual(J(ev(k, 'toolsState.qed.questions[0]')), { id: 'q1', type: 'text', label: 'وصف حر', required: false });
});

test('«تم» بوضع الإنشاء: ترجع النسخة لحالة الإنشاء (qTouched) ويظهر العدد، وسؤال فاسد يُمنع', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsEditQuestions('create'); toolsQDelete(0); toolsQDelete(0)`);
  await ev(k, `toolsQuestionsDone()`);
  assert.equal(ev(k, 'toolsState.screen'), 'create');
  assert.equal(ev(k, 'toolsState.create.questions.length'), 7);
  assert.equal(ev(k, 'toolsState.create.qTouched'), true);
  assert.match(k.app.__els.toolsBody.innerHTML, /7 أسئلة/);
  /* قائمة فارغة لا تُقبل */
  ev(k, `toolsEditQuestions('create'); while(toolsState.qed.questions.length) toolsQDelete(0)`);
  await ev(k, `toolsQuestionsDone()`);
  assert.equal(ev(k, 'toolsState.screen'), 'questions', 'بقي بالمحرّر');
  assert.match(k.app.__els.toolsBody.innerHTML, /1 إلى 12/);
});

test('الإنشاء يحمل الأسئلة المعدّلة بلقطة (لا القالب الأصلي)', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsEditQuestions('create'); toolsQDelete(8); toolsQDelete(7)`);
  await ev(k, `toolsQuestionsDone()`);
  await ev(k, `toolsCreate()`);
  assert.equal(k.db.survey_campaigns[0].questions.length, 7);
  assert.equal(SURVEY_READY_TEMPLATES.guardian_v1.questions.length, 9);
});

test('تغيير الجهة بعد تعديل الأسئلة لا يمسح تعديلك، وقبله يبدّل القالب', async () => {
  const a = await startCreate({ students: STUDENTS });
  ev(a, `toolsPickAudience('student')`);
  assert.match(J(ev(a, 'toolsState.create.questions[1].label')), /معك/);
  const b = await startCreate({ students: STUDENTS });
  ev(b, `toolsEditQuestions('create'); toolsQDelete(0)`);
  await ev(b, `toolsQuestionsDone()`);
  ev(b, `toolsPickAudience('student')`);
  assert.equal(ev(b, 'toolsState.create.questions.length'), 8, 'تعديلك محفوظ');
});

/* ============ وضع التعديل (استبانة قائمة قبل أول إرسال) ============ */

test('وضع التعديل: يُحدّث أسئلة الاستبانة بتصفية المعلم ثم يعيد فتحها', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [camp()] });
  runInAppContext(k.app, `showTools('surveys'); window.__opened = []; openSurvey = id => window.__opened.push(id);`);
  ev(k, `toolsEditQuestions('edit', 'c1', ${JSON.stringify(GQ)}, 'استبانتي'); toolsQDelete(8)`);
  k.log.length = 0;
  await ev(k, `toolsQuestionsDone()`);
  const up = k.log.find(l => l.table === 'survey_campaigns' && l.op === 'update');
  assert.equal(up.f.teacher_id, 'u1');
  assert.equal(up.f.id, 'c1');
  assert.equal(up.values.questions.length, 8);
  assert.deepEqual(J(ev(k, 'window.__opened')), ['c1']);
});

test('وضع التعديل: رفض القاعدة (تجميد بعد الإرسال) يظهر نصه ولا يُغلق المحرّر', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [camp()], fail: (t, op) => t === 'survey_campaigns' && op === 'update' ? { message: 'الأسئلة تتجمّد بعد أول إرسال' } : null });
  runInAppContext(k.app, `showTools('surveys'); window.__opened = []; openSurvey = id => window.__opened.push(id);`);
  ev(k, `toolsEditQuestions('edit', 'c1', ${JSON.stringify(GQ)}, 'x'); toolsQDelete(0)`);
  await ev(k, `toolsQuestionsDone()`);
  assert.equal(ev(k, 'toolsState.screen'), 'questions');
  assert.match(k.app.__els.toolsBody.innerHTML, /تتجمّد بعد أول إرسال/);
  assert.equal(ev(k, 'window.__opened.length'), 0);
  assert.equal(k.db.survey_campaigns[0].questions.length, 9, 'لم يتغيّر شيء');
});

test('زر «تعديل الأسئلة» بالتفاصيل: يظهر قبل أول إرسال فقط، ويفتح المحرّر بنسخة عميقة', async () => {
  const campaigns = [camp()];
  const sections = [{ teacher_id: 'u1', campaign_id: 'c1', section_id: 'sec1' }];
  const fresh = makeApp({ students: STUDENTS, campaigns, sections });
  runInAppContext(fresh.app, `showTools('surveys')`);
  await runInAppContext(fresh.app, `openSurvey('c1')`);
  assert.match(fresh.app.__els.svSheet.innerHTML, /id="svEditQBtn"/);
  runInAppContext(fresh.app, `svEditQuestions()`);
  assert.ok(!fresh.app.__els.svBack, 'أُغلقت نافذة التفاصيل');
  assert.equal(ev(fresh, 'toolsState.screen'), 'questions');
  assert.equal(ev(fresh, 'toolsState.qed.mode'), 'edit');
  ev(fresh, `toolsQDelete(0)`);
  assert.equal(fresh.db.survey_campaigns[0].questions.length, 9, 'النسخة عميقة: الأصل لم يتأثر');

  const sent = makeApp({ students: STUDENTS, campaigns: [camp()], sections, invites: [{ id: 'i1', teacher_id: 'u1', campaign_id: 'c1', student_id: 'a', recipient: 'guardian', code: 'abcdefghjk', sent_at: 'x', answered_on: null }] });
  runInAppContext(sent.app, `showTools('surveys')`);
  await runInAppContext(sent.app, `openSurvey('c1')`);
  assert.doesNotMatch(sent.app.__els.svSheet.innerHTML, /svEditQBtn/, 'بعد أول إرسال لا تعديل');
});

/* ============ الاستبانة المخصّصة ============ */

test('المخصّصة: تبدأ بلا أسئلة، والإنشاء معطّل حتى تُضاف أسئلة ومستلمون', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsPickAudience('custom')`);
  assert.equal(ev(k, 'toolsState.create.questions.length'), 0);
  assert.match(k.app.__els.toolsBody.innerHTML, /لا أسئلة بعد/);
  assert.match(k.app.__els.toolsBody.innerHTML, /id="toolsCreateBtn"[^>]*disabled/);
  ev(k, `toolsEditQuestions('create'); toolsQAdd(); toolsQSetLabel('سؤالي'); toolsQSave()`);
  await ev(k, `toolsQuestionsDone()`);
  assert.match(k.app.__els.toolsBody.innerHTML, /id="toolsCreateBtn"[^>]*disabled/, 'بلا مستلمين');
  ev(k, `toolsEditRecips(); toolsRecipToggle('a', 'guardian')`);
  ev(k, `toolsGo('create')`);
  assert.doesNotMatch(k.app.__els.toolsBody.innerHTML, /id="toolsCreateBtn"[^>]*disabled/);
});

test('المستلمون: التبديل لكل جهة، ولا تبديل لجهة بلا رقم، وإلغاء الجهتين يحذف الطالب', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsPickAudience('custom'); toolsEditRecips()`);
  ev(k, `toolsRecipToggle('b', 'guardian')`);
  assert.deepEqual(J(ev(k, 'toolsState.create.recips.students')), {}, 'بدر بلا رقم ولي أمر');
  ev(k, `toolsRecipToggle('a', 'guardian'); toolsRecipToggle('a', 'student')`);
  assert.deepEqual(J(ev(k, 'toolsState.create.recips.students.a')), { guardian: true, student: true });
  ev(k, `toolsRecipToggle('a', 'guardian'); toolsRecipToggle('a', 'student')`);
  assert.equal(ev(k, `'a' in toolsState.create.recips.students`), false);
});

test('البحث والتصفية: بالاسم وبالشعبة، وبسقف عرض مع تنبيه', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 's' + i, full_name: 'طالب ' + i, section_id: 'sec1', is_active: true, guardian_phone: '96650000' + String(1000 + i), student_phone: null }));
  const k = await startCreate({ students: many.concat(STUDENTS) });
  ev(k, `toolsPickAudience('custom'); toolsEditRecips()`);
  const html = k.app.__els.toolsBody.innerHTML;
  assert.equal((html.match(/class="tq-stu"/g) || []).length, 40);
  assert.match(html, /أول 40 من 63/);
  k.app.__els.tqRecList = { innerHTML: '' };
  ev(k, `toolsRecipsSearch('بدر')`);
  assert.match(k.app.__els.tqRecList.innerHTML, /بدر/);
  assert.doesNotMatch(k.app.__els.tqRecList.innerHTML, /طالب 1/);
  ev(k, `toolsRecipsSec('sec2')`);
  assert.doesNotMatch(k.app.__els.toolsBody.innerHTML, /طالب 1</);
});

test('جهة أخرى: اسم ورقم بالتطبيع، وأخطاء مفهومة، وبلا تكرار للرقم، وحذف', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsPickAudience('custom'); toolsEditRecips()`);
  const put = (n, p) => { k.app.__els.tqOtherName = { value: n }; k.app.__els.tqOtherPhone = { value: p }; ev(k, `toolsRecipAddOther()`); };
  put('', '0501111111');
  assert.match(k.app.__els.toolsBody.innerHTML, /اكتب الاسم/);
  put('زميل', 'abc');
  assert.match(k.app.__els.toolsBody.innerHTML, /الرقم يحتوي/);
  put('زميل', '0501111111');
  assert.deepEqual(J(ev(k, 'toolsState.create.recips.others')), [{ label: 'زميل', phone: '966501111111' }]);
  put('آخر', '+966 50 111 1111');
  assert.match(k.app.__els.toolsBody.innerHTML, /هذا الرقم مضاف/);
  ev(k, `toolsRecipRemoveOther(0)`);
  assert.equal(ev(k, 'toolsState.create.recips.others.length'), 0);
});

test('إنشاء مخصّصة: استبانة custom/blank بعتبة 1 بلا شعب، وتذاكر الطلاب بجهتها والجهات الأخرى برقمها، بتصفية المعلم', async () => {
  const k = await startCreate({ students: STUDENTS });
  ev(k, `toolsPickAudience('custom'); toolsEditQuestions('create'); toolsQAdd(); toolsQSetLabel('رأيك؟'); toolsQSave()`);
  await ev(k, `toolsQuestionsDone()`);
  ev(k, `toolsEditRecips(); toolsRecipToggle('a', 'guardian'); toolsRecipToggle('a', 'student'); toolsRecipToggle('e', 'guardian')`);
  k.app.__els.tqOtherName = { value: 'مدير المدرسة' }; k.app.__els.tqOtherPhone = { value: '0507654321' };
  ev(k, `toolsRecipAddOther(); toolsGo('create'); toolsSetTitleText('تقييم الفعالية')`);
  await ev(k, `toolsCreate()`);
  const c = k.db.survey_campaigns[0];
  assert.deepEqual({ a: c.audience, t: c.template, m: c.min_results, n: c.questions.length, teacher: c.teacher_id }, { a: 'custom', t: 'blank', m: 1, n: 1, teacher: 'u1' });
  assert.equal(k.db.survey_campaign_sections.length, 0, 'بلا شعب');
  const inv = k.db.survey_invites.map(i => [i.recipient, i.student_id, i.contact_label || '', i.contact_phone || ''].join('|')).sort();
  assert.deepEqual(inv, ['guardian|a||', 'guardian|e||', 'other||مدير المدرسة|966507654321', 'student|a||']);
  k.db.survey_invites.filter(i => i.recipient === 'other').forEach(i => assert.equal(i.student_id, null, 'الجهة الأخرى بلا طالب'));
  k.db.survey_invites.forEach(i => { assert.equal(i.teacher_id, 'u1'); assert.equal(i.campaign_id, c.id); assert.match(i.code, /^[a-z2-9]{10}$/); });
  assert.deepEqual(J(ev(k, 'window.__opened')), [c.id]);
});

test('إنشاء مخصّصة: فشل إدراج التذاكر يحذف الاستبانة (لا يتيمة) ولا يفتح شيئًا', async () => {
  const k = await startCreate({ students: STUDENTS, fail: (t, op) => t === 'survey_invites' && op === 'insert' ? { message: 'boom' } : null });
  ev(k, `toolsPickAudience('custom'); toolsEditQuestions('create'); toolsQAdd(); toolsQSetLabel('رأيك؟'); toolsQSave()`);
  await ev(k, `toolsQuestionsDone()`);
  ev(k, `toolsEditRecips(); toolsRecipToggle('a', 'guardian'); toolsGo('create')`);
  await ev(k, `toolsCreate()`);
  assert.equal(k.db.survey_campaigns.length, 0);
  assert.ok(k.app.__toasts.some(t => /boom/.test(t)));
  assert.equal(ev(k, 'window.__opened.length'), 0);
});

/* ============ تفاصيل المخصّصة ============ */

const customCamp = () => camp({ id: 'c9', audience: 'custom', template: 'blank', min_results: 1, questions: [{ id: 'q1', type: 'text', label: 'رأيك؟', required: true }] });
const customInvites = () => [
  { id: 'i1', teacher_id: 'u1', campaign_id: 'c9', student_id: 'a', recipient: 'guardian', code: 'abcdefghj1', sent_at: null, answered_on: null },
  { id: 'i2', teacher_id: 'u1', campaign_id: 'c9', student_id: null, recipient: 'other', code: 'abcdefghj2', contact_label: 'مدير <b>المدرسة</b>', contact_phone: '966507654321', sent_at: null, answered_on: null }
];

test('تفاصيل المخصّصة: صف لكل تذكرة (طالب بجهته وجهة أخرى باسمها)، بلا مزامنة تلقائية، وواتساب برقم الجهة الأخرى', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [customCamp()], invites: customInvites() });
  runInAppContext(k.app, `showTools('surveys')`);
  await runInAppContext(k.app, `openSurvey('c9')`);
  const html = k.app.__els.svSheet.innerHTML;
  assert.equal(k.db.survey_invites.length, 2, 'لا تذاكر تُنشأ تلقائيًا للمخصّصة');
  assert.match(html, /أحمد/);
  assert.match(html, /ولي الأمر · لم يُرسل بعد/);
  assert.match(html, /جهة أخرى · لم يُرسل بعد/);
  assert.ok(!html.includes('<b>المدرسة'), 'اسم الجهة الأخرى مُهرَّب');
  assert.match(html, /wa\.me\/966507654321/);
  const wa = decodeURIComponent(html.match(/wa\.me\/966507654321\?text=([^"]+)"/)[1]);
  assert.match(wa, /\/s\/abcdefghj2/);
  assert.doesNotMatch(wa, /تعليم الطالب/);
});

test('رسالة الجهة الأخرى بلا اسم طالب، والرقم من التذكرة', () => {
  const { app } = makeApp();
  assert.doesNotMatch(app.svWaMessage('x', 'abcdefghjk', 'https://app.example', false, 'other'), /تعليم|الطالب/);
  assert.equal(app.svPhoneOfInvite(null, { recipient: 'other', contact_phone: '966500000000' }), '966500000000');
  assert.equal(app.svPhoneOfInvite({ guardian_phone: 'g', student_phone: 's' }, { recipient: 'student' }), 's');
});

test('عتبة المخصّصة 1: ردّ واحد يُظهر النتائج', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [customCamp()], invites: customInvites().map((i, n) => n ? i : Object.assign(i, { sent_at: 'x', answered_on: '2026-11-09' })), responses: [{ id: 'r1', campaign_id: 'c9', teacher_id: 'u1', answers: { q1: 'ممتاز' } }] });
  runInAppContext(k.app, `showTools('surveys')`);
  await runInAppContext(k.app, `openSurvey('c9')`);
  runInAppContext(k.app, `svSetTab('results')`);
  const html = k.app.__els.svSheet.innerHTML;
  assert.doesNotMatch(html, /ننتظر ردودًا أكثر/);
  assert.match(html, /ممتاز/);
});

/* ============ حذف الاستبانة ============ */

const openDetail = async (k, id) => { runInAppContext(k.app, `showTools('surveys'); window.__refreshed = 0; toolsRefreshIfVisible = () => { window.__refreshed++; };`); await runInAppContext(k.app, `openSurvey('${id || 'c1'}')`); };
const secs = [{ teacher_id: 'u1', campaign_id: 'c1', section_id: 'sec1' }];

test('حذف بلا ردود: سؤال واحد ثم الدالة المضبوطة وحدها، ثم تُغلق النافذة وتتحدّث القائمة', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs });
  await openDetail(k);
  k.log.length = 0;
  await runInAppContext(k.app, `svDelete()`);
  const calls = k.log.filter(l => l.rpc);
  assert.deepEqual(calls.map(c => c.name), ['delete_survey']);
  assert.deepEqual(J(calls[0].args), { p_id: 'c1' });
  assert.ok(!k.log.some(l => l.op === 'delete'), 'لا حذف مباشر بالجداول');
  assert.equal(k.db.survey_campaigns.length, 0);
  assert.ok(!k.app.__els.svBack, 'أُغلقت النافذة');
  assert.equal(runInAppContext(k.app, 'window.__refreshed'), 1);
  assert.ok(k.app.__toasts.some(t => /حُذفت/.test(t)));
});

test('حذف مع ردود: سؤالان بالعواقب وعدد الردود، والرفض بأيٍّ منهما لا يحذف', async () => {
  const invites = [{ id: 'i1', teacher_id: 'u1', campaign_id: 'c1', student_id: 'a', recipient: 'guardian', code: 'abcdefghjk', sent_at: 'x', answered_on: '2026-11-09' }];
  const responses = [{ id: 'r1', campaign_id: 'c1', teacher_id: 'u1', answers: GOOD }];
  const k = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs, invites, responses });
  await openDetail(k);
  runInAppContext(k.app, `window.__msgs = []; let n = 0; showConfirm = async m => { window.__msgs.push(m); n++; return n < 2; };`);
  await runInAppContext(k.app, `svDelete()`);
  const msgs = J(runInAppContext(k.app, 'window.__msgs'));
  assert.equal(msgs.length, 2);
  assert.match(msgs[0], /ردودها \(1\)/);
  assert.match(msgs[0], /بدل حذفها/);
  assert.match(msgs[1], /تأكيد أخير/);
  assert.equal(k.db.survey_campaigns.length, 1, 'رُفض السؤال الثاني فلم يُحذف شيء');
  assert.ok(!k.log.some(l => l.rpc));
  runInAppContext(k.app, `showConfirm = async () => true`);
  await runInAppContext(k.app, `svDelete()`);
  assert.equal(k.db.survey_campaigns.length, 0);
  assert.equal(k.db.survey_responses.length, 0);
});

test('الرفض عند السؤال الأول: لا استدعاء ولا تغيير', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs, confirm: false });
  await openDetail(k);
  await runInAppContext(k.app, `svDelete()`);
  assert.ok(!k.log.some(l => l.rpc));
  assert.equal(k.db.survey_campaigns.length, 1);
  assert.ok(k.app.__els.svBack, 'النافذة باقية');
});

test('الحذف: النتيجة الفعلية تُعلَن (false أو خطأ) وتُفتح الأزرار ثانية، ونقرتان متزامنتان تنفّذان مرة', async () => {
  const bad = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs, rpc: () => ({ data: false, error: null }) });
  await openDetail(bad);
  await runInAppContext(bad.app, `svDelete()`);
  assert.ok(bad.app.__toasts.some(t => /تعذّر الحذف/.test(t)));
  assert.ok(bad.app.__els.svBack);
  assert.doesNotMatch(bad.app.__els.svSheet.innerHTML, /id="svDeleteBtn"[^>]*disabled/);

  const err = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs, rpc: () => ({ data: null, error: { message: 'down' } }) });
  await openDetail(err);
  await runInAppContext(err.app, `svDelete()`);
  assert.ok(err.app.__toasts.some(t => /down/.test(t)));

  const dbl = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs });
  await openDetail(dbl);
  dbl.log.length = 0;
  await runInAppContext(dbl.app, `Promise.all([svDelete(), svDelete()])`);
  assert.equal(dbl.log.filter(l => l.rpc).length, 1);
});

test('الإغلاق: نقرتان متزامنتان تسألان وتنفّذان مرة واحدة', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs });
  await openDetail(k);
  runInAppContext(k.app, `window.__asked = 0; const orig = showConfirm; showConfirm = async m => { window.__asked++; return true; };`);
  k.log.length = 0;
  await runInAppContext(k.app, `Promise.all([svClose(), svClose()])`);
  assert.equal(runInAppContext(k.app, 'window.__asked'), 1);
  assert.equal(k.log.filter(l => l.table === 'survey_campaigns' && l.op === 'update').length, 1);
});

test('الحذف متاح للمغلقة أيضًا، وزر الحذف بالتذييل دائمًا', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [camp({ status: 'closed' })], sections: secs });
  await openDetail(k);
  assert.match(k.app.__els.svSheet.innerHTML, /id="svDeleteBtn"/);
});

/* ============ البنية ============ */

test('الملف الجديد مسجَّل، وكل استعلام survey_ فيه بتصفية المعلم، ولا حذف مباشر بجداول الاستبانة إلا تراجع الإنشاء', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-46-survey-editor.js'), 'utf8');
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-46-survey-editor\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-46-survey-editor\.js/);
  assert.match(src, /surveyValidateQuestions\(/);
  assert.doesNotMatch(src, /\.delete\(\)/);
  const calls = src.split(/sb\.from\('survey_/).slice(1);
  assert.ok(calls.length >= 1);
  calls.filter(c => !/^[a-z_]+'\)\.insert\(/.test(c)).forEach(c => assert.match(c.slice(0, 300), /teacher_id/));
  assert.ok((src.match(/teacher_id: uid/g) || []).length >= 1 || /toolsCustomInviteRows\(/.test(src), 'صفوف الإدراج تحمل المعلم');
  const a44 = fs.readFileSync(path.join(root, 'app/app-44-satisfaction.js'), 'utf8');
  assert.match(a44, /sb\.rpc\('delete_survey'/);
  assert.doesNotMatch(a44, /survey_responses'\)\.delete|survey_invites'\)\.delete/);
});

/* ============ إضافة مستلمين لاستبانة مخصّصة قائمة ============ */

const addCtx = async (opts) => {
  const k = makeApp(Object.assign({ students: STUDENTS, campaigns: [customCamp()], invites: customInvites() }, opts || {}));
  runInAppContext(k.app, `showTools('surveys'); window.__opened = []; openSurvey = id => window.__opened.push(id);`);
  runInAppContext(k.app, `toolsAddRecipients('c9', 'استبانتي', ${JSON.stringify(k.db.survey_invites)})`);
  return k;
};

test('زر «مستلمون»: للمخصّصة المفتوحة وحدها (لا لولي الأمر/الطالب ولا للمغلقة)', async () => {
  const cust = makeApp({ students: STUDENTS, campaigns: [customCamp()], invites: customInvites() });
  runInAppContext(cust.app, `showTools('surveys')`);
  await runInAppContext(cust.app, `openSurvey('c9')`);
  assert.match(cust.app.__els.svSheet.innerHTML, /id="svAddRecBtn"/);
  const guardian = makeApp({ students: STUDENTS, campaigns: [camp()], sections: [{ teacher_id: 'u1', campaign_id: 'c1', section_id: 'sec1' }] });
  runInAppContext(guardian.app, `showTools('surveys')`);
  await runInAppContext(guardian.app, `openSurvey('c1')`);
  assert.doesNotMatch(guardian.app.__els.svSheet.innerHTML, /svAddRecBtn/);
  const closed = makeApp({ students: STUDENTS, campaigns: [Object.assign(customCamp(), { status: 'closed' })], invites: customInvites() });
  runInAppContext(closed.app, `showTools('surveys')`);
  await runInAppContext(closed.app, `openSurvey('c9')`);
  assert.doesNotMatch(closed.app.__els.svSheet.innerHTML, /svAddRecBtn/);
});

test('فتح الإضافة: تغلق النافذة وتعرض المنتقين سابقًا مقفلين («مضاف») ولا يُغيَّرون', async () => {
  const k = makeApp({ students: STUDENTS, campaigns: [customCamp()], invites: customInvites() });
  runInAppContext(k.app, `showTools('surveys')`);
  await runInAppContext(k.app, `openSurvey('c9')`);
  runInAppContext(k.app, `svAddRecipients()`);
  assert.ok(!k.app.__els.svBack);
  assert.equal(ev(k, 'toolsState.screen'), 'recips');
  const html = k.app.__els.toolsBody.innerHTML;
  assert.match(html, /ولي الأمر ✓ مضاف/, 'أحمد/ولي الأمر موجود');
  ev(k, `toolsRecipToggle('a', 'guardian')`);
  assert.deepEqual(J(ev(k, 'toolsState.addR.recips.students')), {}, 'المقفل لا يتغيّر');
  ev(k, `toolsRecipToggle('a', 'student'); toolsRecipToggle('e', 'guardian')`);
  assert.deepEqual(J(ev(k, 'toolsState.addR.recips.students')), { a: { student: true }, e: { guardian: true } });
  assert.match(k.app.__els.toolsBody.innerHTML, /2 رابطان جديدة|2 روابط جديدة/);
});

test('جهة أخرى بالإضافة: رقم موجود مسبقًا يُرفض، والجديد يُقبل', async () => {
  const k = await addCtx();
  const put = (n, p) => { k.app.__els.tqOtherName = { value: n }; k.app.__els.tqOtherPhone = { value: p }; ev(k, `toolsRecipAddOther()`); };
  put('مكرر', '0507654321'); /* موجود بالتذكرة k i2 */
  assert.match(k.app.__els.toolsBody.innerHTML, /هذا الرقم مضاف/);
  put('زميل', '0509999999');
  assert.deepEqual(J(ev(k, 'toolsState.addR.recips.others')), [{ label: 'زميل', phone: '966509999999' }]);
});

test('الإضافة: تذاكر جديدة فقط بتصفية المعلم، والقديمة بحالتها، ثم تُعاد فتح الاستبانة', async () => {
  const k = await addCtx();
  k.db.survey_invites[0].sent_at = 'x'; /* أحمد/ولي الأمر أُرسل له */
  runInAppContext(k.app, `toolsState.addR.existing = toolsExistingRecips(${JSON.stringify(k.db.survey_invites)})`);
  ev(k, `toolsRecipToggle('a', 'guardian'); toolsRecipToggle('a', 'student'); toolsRecipToggle('e', 'guardian')`);
  k.app.__els.tqOtherName = { value: 'زميل' }; k.app.__els.tqOtherPhone = { value: '0509999999' };
  ev(k, `toolsRecipAddOther()`);
  k.log.length = 0;
  await ev(k, `toolsRecipsDone()`);
  const ins = k.log.filter(l => l.table === 'survey_invites' && l.op === 'insert');
  assert.equal(ins.length, 1);
  const rows = ins[0].values;
  assert.deepEqual(J(rows.map(r => r.recipient + ':' + (r.student_id || r.contact_phone)).sort()), ['guardian:e', 'other:966509999999', 'student:a']);
  rows.forEach(r => { assert.equal(r.teacher_id, 'u1'); assert.equal(r.campaign_id, 'c9'); assert.match(r.code, /^[a-z2-9]{10}$/); });
  assert.equal(k.db.survey_invites.length, 5);
  assert.equal(k.db.survey_invites.find(i => i.id === 'i1').sent_at, 'x', 'القديمة بحالتها');
  assert.deepEqual(J(ev(k, 'window.__opened')), ['c9']);
});

test('الإضافة: بلا اختيار جديد رسالة، ونقرتان متزامنتان تُدخلان مرة، والفشل يُعرض ولا يفتح شيئًا', async () => {
  const none = await addCtx();
  await ev(none, `toolsRecipsDone()`);
  assert.match(none.app.__els.toolsBody.innerHTML, /لم تختر مستلمًا جديدًا/);
  assert.equal(none.db.survey_invites.length, 2);

  const dbl = await addCtx();
  ev(dbl, `toolsRecipToggle('e', 'guardian')`);
  await ev(dbl, `Promise.all([toolsRecipsDone(), toolsRecipsDone()])`);
  assert.equal(dbl.db.survey_invites.length, 3);

  const bad = await addCtx({ fail: (t, op) => t === 'survey_invites' && op === 'insert' ? { message: 'boom' } : null });
  ev(bad, `toolsRecipToggle('e', 'guardian')`);
  await ev(bad, `toolsRecipsDone()`);
  assert.match(bad.app.__els.toolsBody.innerHTML, /boom/);
  assert.equal(ev(bad, 'window.__opened.length'), 0);
  assert.equal(ev(bad, 'toolsState.screen'), 'recips');
});

test('الإلغاء يعيد فتح الاستبانة بلا إدخال، ومغادرة الشاشة أثناء الإضافة لا تفتح نافذة فجأة', async () => {
  const c = await addCtx();
  ev(c, `toolsRecipToggle('e', 'guardian'); toolsCancelAddRecips()`);
  assert.equal(c.db.survey_invites.length, 2);
  assert.deepEqual(J(ev(c, 'window.__opened')), ['c9']);
  const r = await addCtx();
  ev(r, `toolsRecipToggle('e', 'guardian')`);
  await ev(r, `(async () => { const p = toolsRecipsDone(); toolsGo('home'); await p; })()`);
  assert.equal(r.db.survey_invites.length, 3, 'أُضيفت');
  assert.equal(ev(r, 'window.__opened.length'), 0);
});

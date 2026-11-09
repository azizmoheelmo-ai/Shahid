'use strict';
/* ============================================================
   استبانة رضا المستفيدين — تفاصيل الاستبانة (app-44، التصميم: SURVEYS.md):
   - كل استعلام بتصفية المعلم (teacher_id)، ولا شيء يمرّ بلا فلترة.
   - التذكرة لجهة الاستبانة وحدها (ولي الأمر أو الطالب) لطلاب نشطين بشعبها فقط، بلا تكرار، وتلتقط الجدد والأرقام المضافة لاحقًا.
   - الأسئلة من الاستبانة نفسها (لقطة) والتحليل بالمدقّق المشترك: غير الصالح يُعدّ ويُعلَن، والأسئلة التالفة تُعلَن.
   - عتبة النتائج من الاستبانة (min_results)، وكل الردود تُقرأ بصفحات (لا سقف صامت).
   - المغلقة: إعادة فتح ونسخ، بلا تكرار عند النقر المزدوج، وتراجع نظيف عند الفشل.
   - السباق: الإغلاق أثناء التحميل لا يرسم ولا يكتب.
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { makeApp, runInAppContext, FUTURE, GOOD, J } = require('./survey-kit');
const { SURVEY_READY_TEMPLATES } = require('../survey-templates.js');
const root = path.join(__dirname, '..');

const GQ = J(SURVEY_READY_TEMPLATES.guardian_v1.questions);
const SQ = J(SURVEY_READY_TEMPLATES.student_v1.questions);
const STUDENTS = [
  { id: 'a', full_name: 'أحمد', section_id: 'sec1', is_active: true, guardian_phone: '966501234567', student_phone: '966551234567' },
  { id: 'b', full_name: 'بدر', section_id: 'sec1', is_active: true, guardian_phone: null, student_phone: '966551111111' },
  { id: 'c', full_name: 'جاسر', section_id: 'sec1', is_active: true, guardian_phone: null, student_phone: null },
  { id: 'd', full_name: 'دخيل', section_id: 'sec1', is_active: false, guardian_phone: '966502222222', student_phone: null },
  { id: 'e', full_name: 'عمر', section_id: 'sec2', is_active: true, guardian_phone: '966503333333', student_phone: '966553333333' },
  { id: 'f', full_name: 'فهد', section_id: 'sec9', is_active: true, guardian_phone: '966505555555', student_phone: '966555555555' }
];
const camp = (o) => Object.assign({ id: 'c1', teacher_id: 'u1', title: 'رضا أولياء الأمور', audience: 'guardian', template: 'guardian_v1', questions: J(GQ), status: 'open', closes_at: FUTURE(), sort_order: 0, min_results: 5, created_at: 'x' }, o || {});
const secs = (cid, ids) => (ids || ['sec1', 'sec2']).map(s => ({ teacher_id: 'u1', campaign_id: cid || 'c1', section_id: s }));
const open = async (app, id) => runInAppContext(app, `openSurvey('${id || 'c1'}')`);

/* ============ دوال صرفة ============ */

test('الجهة: ولي الأمر بجوال ولي الأمر، والطالب بجوال الطالب، ولا خلط بينهما', () => {
  const { app } = makeApp();
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[0], 'guardian')), [{ recipient: 'guardian', phone: '966501234567' }]);
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[0], 'student')), [{ recipient: 'student', phone: '966551234567' }]);
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[1], 'guardian')), [], 'بدر بلا رقم ولي أمر');
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[1], 'student')), [{ recipient: 'student', phone: '966551111111' }]);
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[2], 'guardian')), []);
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[0], 'custom')), [], 'المخصّصة لا تُنشئ تذاكر الآن');
  assert.deepEqual(J(app.svRecipientsFor(null, 'guardian')), []);
});

test('العدّادات والحالة وعتبة النتائج', () => {
  const { app } = makeApp();
  const c = app.svCounts([{ sent_at: null, answered_on: null }, { sent_at: 'x', answered_on: null }, { sent_at: 'x', answered_on: '2026-11-01' }, { sent_at: null, answered_on: '2026-11-01' }]);
  assert.deepEqual({ total: c.total, answered: c.answered, sent: c.sent, unsent: c.unsent }, { total: 4, answered: 2, sent: 1, unsent: 1 });
  const future = new Date(Date.now() + 1000).toISOString(), past = new Date(Date.now() - 1000).toISOString();
  assert.equal(app.svCampaignOpen({ status: 'open', closes_at: future }), true);
  assert.equal(app.svCampaignOpen({ status: 'open', closes_at: past }), false);
  assert.equal(app.svCampaignOpen({ status: 'closed', closes_at: future }), false);
  assert.equal(app.svCampaignOpen(null), false);
  assert.equal(app.svMinResults({ min_results: 1 }), 1);
  assert.equal(app.svMinResults({ min_results: 7 }), 7);
  assert.equal(app.svMinResults({ min_results: 0 }), 5, 'قيمة غريبة ترجع للافتراضي');
  assert.equal(app.svMinResults({}), 5);
});

test('رسالة واتساب: الرابط مبهم (رمز فقط) والاسم في النص وحده، وصياغة للطالب ولولي الأمر وللتذكير', () => {
  const { app } = makeApp();
  const m = app.svWaMessage('أحمد', 'abcdefghjk', 'https://app.example', false, 'guardian');
  assert.match(m, /https:\/\/app\.example\/s\/abcdefghjk\n/);
  assert.match(m, /تعليم الطالب أحمد/);
  const url = m.match(/https:\/\/\S+/)[0];
  assert.doesNotMatch(url, /أحمد|966/);
  const s = app.svWaMessage('أحمد', 'abcdefghjk', 'https://app.example', false, 'student');
  assert.match(s, /في تعليمك/);
  assert.doesNotMatch(s, /تعليم الطالب أحمد/);
  assert.match(app.svWaMessage('أحمد', 'abcdefghjk', 'https://app.example', true, 'guardian'), /تذكير/);
  assert.ok(url.length <= 'https://app.example/s/'.length + 10);
});

test('التحليل بأسئلة الاستبانة نفسها: متوسط، نسبة صح، توزيع، وغير الصالح يُعدّ لا يُحسب', () => {
  const { app } = makeApp();
  const R = a => ({ answers: Object.assign({}, GOOD, a) });
  const rs = [R({}), R({ q1: 3, q7: 3, q4: false }), R({ q1: 4, q7: 4 }), { answers: { q1: 9 } }, { answers: null }];
  const an = app.svAnalyze(rs, GQ, () => 0);
  assert.equal(an.ok, true);
  assert.equal(an.valid, 3);
  assert.equal(an.invalid, 2, 'اثنان غير صالحين يُعدّان لا يُخفَيان');
  const by = id => an.items.find(a => a.id === id);
  assert.equal(by('q1').avg, 4);
  assert.equal(by('q4').pct, 67);
  assert.equal(by('q6').counts[1].count, 3);
  assert.equal(by('q8').texts.length, 3);
  assert.equal(app.svWeakestRating(an.items).id, 'q3', 'q3 أضعف (3)');
  const pct = app.svOverallPct(an.items);
  assert.ok(pct > 70 && pct < 100, 'متوسط كل أسئلة التقييم كنسبة');
});

test('أسئلة تالفة: لا تحليل ولا أرقام مضللة', () => {
  const { app } = makeApp();
  [null, [], 'x', [{ id: 'zz', type: 'rating' }], [{ id: 'q1', type: 'rating', label: '', required: true }]].forEach(bad => {
    const an = app.svAnalyze([{ answers: GOOD }], bad);
    assert.equal(an.ok, false, JSON.stringify(bad));
    assert.equal(an.items.length, 0);
  });
});

test('مدقّق الإجابات المستعمل بالتحليل هو المشترك (survey-templates.js): نفس الحكم على الأسئلة نفسها', () => {
  const { app } = makeApp();
  const shared = require('../survey-templates.js');
  [GOOD, Object.assign({}, GOOD, { q1: 0 }), Object.assign({}, GOOD, { q4: 'نعم' }), Object.assign({}, GOOD, { q6: 9 }), {}].forEach(a => {
    const here = app.svAnalyze([{ answers: a }], GQ).valid === 1;
    assert.equal(here, shared.surveyValidateAnswers(GQ, a).ok);
  });
});

test('النص يُخلط ترتيبه (لا يدلّ الترتيب على صاحب الرد)', () => {
  const { app } = makeApp();
  const rs = ['1', '2', '3', '4', '5', '6'].map(t => ({ answers: Object.assign({}, GOOD, { q8: t }) }));
  const a1 = app.svAnalyze(rs, GQ, () => 0).items.find(a => a.id === 'q8').texts.join('');
  assert.notEqual(a1, '123456');
  assert.deepEqual(a1.split('').sort(), ['1', '2', '3', '4', '5', '6']);
});

/* ============ قاعدة البيانات: التصفية والتذاكر ============ */

test('ولي الأمر: تذكرة لكل طالب نشط بشعب الاستبانة له رقم ولي أمر فقط، بالتصفية وبرمز 10 أحرف', async () => {
  const { app, log, db } = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs() });
  await open(app);
  log.forEach(l => {
    if(l.op === 'insert') (Array.isArray(l.values) ? l.values : [l.values]).forEach(v => assert.equal(v.teacher_id, 'u1', l.table));
    else assert.equal(l.f.teacher_id, 'u1', l.table + ' ' + l.op + ' بلا تصفية المعلم');
  });
  assert.deepEqual(db.survey_invites.map(i => i.student_id + ':' + i.recipient).sort(), ['a:guardian', 'e:guardian'],
    'بدر بلا ولي أمر، وجاسر بلا رقم، ودخيل غير نشط، وفهد بشعبة غير مختارة');
  db.survey_invites.forEach(i => assert.match(i.code, /^[a-z2-9]{10}$/));
  assert.equal(new Set(db.survey_invites.map(i => i.code)).size, db.survey_invites.length);
});

test('الطالب: تذكرة بجوال الطالب لطلاب شعبة واحدة فقط إن اختيرت واحدة', async () => {
  const { app, db } = makeApp({ students: STUDENTS, campaigns: [camp({ audience: 'student', template: 'student_v1', questions: J(SQ) })], sections: secs('c1', ['sec1']) });
  await open(app);
  assert.deepEqual(db.survey_invites.map(i => i.student_id + ':' + i.recipient).sort(), ['a:student', 'b:student']);
});

test('إعادة الفتح تلتقط الطالب الجديد والرقم المضاف لاحقًا فقط بلا تكرار', async () => {
  const { app, db } = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs() });
  await open(app);
  assert.equal(db.survey_invites.length, 2);
  runInAppContext(app, `crmStudents.find(s => s.id === 'b').guardian_phone = '966504444444'; crmStudents.push({ id: 'n', full_name: 'جديد', section_id: 'sec2', is_active: true, guardian_phone: '966506666666', student_phone: null })`);
  await open(app);
  assert.deepEqual(db.survey_invites.map(i => i.student_id).sort(), ['a', 'b', 'e', 'n']);
  await open(app);
  assert.equal(db.survey_invites.length, 4, 'فتح ثالث لا يكرّر');
});

test('مغلقة: لا تذاكر جديدة ولا أزرار واتساب، وتظهر بلاطتا إعادة الفتح والنسخ', async () => {
  const { app, db } = makeApp({ students: STUDENTS, campaigns: [camp({ status: 'closed' })], sections: secs() });
  await open(app);
  assert.equal(db.survey_invites.length, 0);
  const html = app.__els.svSheet.innerHTML;
  assert.ok(!/class="[^"]*sv-wa/.test(html));
  assert.match(html, /svReopen\(\)/);
  assert.match(html, /svCopy\(\)/);
  assert.match(html, /أُغلقت هذه الاستبانة/);
});

test('منتهية المدة (حالتها مفتوحة): تُعامل كمغلقة بعبارتها', async () => {
  const { app } = makeApp({ students: STUDENTS, campaigns: [camp({ closes_at: new Date(Date.now() - 1000).toISOString() })], sections: secs() });
  await open(app);
  assert.match(app.__els.svSheet.innerHTML, /انتهت مدة هذه الاستبانة/);
});

test('إعادة الفتح: تحدّث الحالة والمدة بتصفية المعلم وتكمل التذاكر، ونقرتان متزامنتان تنفّذان مرة', async () => {
  const { app, log, db } = makeApp({ students: STUDENTS, campaigns: [camp({ status: 'closed' })], sections: secs() });
  await open(app);
  log.length = 0;
  await runInAppContext(app, `Promise.all([svReopen(), svReopen()])`);
  const ups = log.filter(l => l.table === 'survey_campaigns' && l.op === 'update');
  assert.equal(ups.length, 1);
  assert.equal(ups[0].f.teacher_id, 'u1');
  assert.equal(ups[0].f.id, 'c1');
  assert.equal(ups[0].values.status, 'open');
  assert.ok(new Date(ups[0].values.closes_at).getTime() > Date.now() + 6 * 864e5, 'أسبوع تقريبًا');
  assert.equal(db.survey_invites.length, 2, 'التذاكر تكتمل بعد إعادة الفتح');
  assert.ok(!/svReopen\(\)/.test(app.__els.svSheet.innerHTML), 'لا بلاطة إعادة فتح بعد أن صارت مفتوحة');
});

test('النسخ: استبانة جديدة بالأسئلة نفسها (نسخة عميقة) والشعب نفسها بلا تذاكر، وبتصفية المعلم، وبلا تكرار عند النقر المزدوج', async () => {
  const { app, log, db } = makeApp({ students: STUDENTS, campaigns: [camp({ status: 'closed' })], sections: secs() });
  await open(app);
  runInAppContext(app, `window.__opened = []; const orig = openSurvey; openSurvey = id => { window.__opened.push(id); }`);
  log.length = 0;
  await runInAppContext(app, `Promise.all([svCopy(), svCopy()])`);
  const inserts = log.filter(l => l.table === 'survey_campaigns' && l.op === 'insert');
  assert.equal(inserts.length, 1);
  const v = inserts[0].values;
  assert.equal(v.teacher_id, 'u1');
  assert.equal(v.title, 'رضا أولياء الأمور (نسخة)');
  assert.equal(v.audience, 'guardian');
  assert.deepEqual(J(v.questions), GQ);
  assert.notEqual(v.questions, db.survey_campaigns[0].questions, 'نسخة عميقة لا مرجع مشترك');
  const created = db.survey_campaigns.find(c => c.id !== 'c1');
  assert.deepEqual(db.survey_campaign_sections.filter(s => s.campaign_id === created.id).map(s => s.section_id).sort(), ['sec1', 'sec2']);
  assert.equal(db.survey_invites.filter(i => i.campaign_id === created.id).length, 0);
  assert.equal(runInAppContext(app, 'window.__opened.length'), 1);
});

test('النسخ: فشل إدراج الشعب يحذف الاستبانة الجديدة (لا يتيمة) ويُعلن الخطأ', async () => {
  const { app, db } = makeApp({ students: STUDENTS, campaigns: [camp({ status: 'closed' })], sections: secs(), fail: (t, op) => t === 'survey_campaign_sections' && op === 'insert' ? { message: 'boom' } : null });
  await open(app);
  await runInAppContext(app, `svCopy()`);
  assert.equal(db.survey_campaigns.length, 1, 'لا بقايا');
  assert.ok(app.__toasts.some(t => /boom/.test(t)));
});

test('«أُرسل» تُسجَّل مرة واحدة حتى مع نقرتين، وبشرط sent_at فارغ وبتصفية المعلم', async () => {
  const { app, log, db } = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs() });
  await open(app);
  const id = db.survey_invites[0].id;
  log.length = 0;
  await runInAppContext(app, `Promise.all([svMarkSent('${id}'), svMarkSent('${id}')])`);
  const ups = log.filter(l => l.table === 'survey_invites' && l.op === 'update');
  assert.equal(ups.length, 1);
  assert.equal(ups[0].f.teacher_id, 'u1');
  assert.equal(ups[0].f.id, id);
  assert.ok('sent_at' in ups[0].f && ups[0].f.sent_at === null);
});

test('السباق: إغلاق الشاشة أثناء التحميل لا يرسم ولا يكتب', async () => {
  const { app, db } = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs() });
  await runInAppContext(app, `(async () => { const t = openSurvey('c1'); closeSurvey(); await t; })()`);
  assert.equal(db.survey_invites.length, 0);
  assert.ok(!app.__els.svBack);
});

test('استبانة غير موجودة: رسالة صريحة ولا انهيار', async () => {
  const { app } = makeApp({ students: STUDENTS });
  await open(app, 'nope');
  assert.ok(app.__toasts.some(t => /غير موجودة/.test(t)));
});

test('نصوص المعلم والطلاب تمرّ بـescapeHtml (عنوان الاستبانة واسم الطالب)', async () => {
  const evil = [{ id: 'a', full_name: '<img src=x onerror=alert(1)>', section_id: 'sec1', is_active: true, guardian_phone: '966501234567', student_phone: null }];
  const { app } = makeApp({ students: evil, campaigns: [camp({ title: '<script>alert(1)</script>' })], sections: secs('c1', ['sec1']) });
  await open(app);
  const html = app.__els.svSheet.innerHTML;
  assert.ok(!html.includes('<img') && !html.includes('<script'));
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
});

test('شرائح الشعب تُرشّح القائمة، ولا تظهر إن كانت شعبة واحدة', async () => {
  const two = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs() });
  await open(two.app);
  assert.match(two.app.__els.svSheet.innerHTML, /sv-chip2/);
  await runInAppContext(two.app, `svSetSecFilter('sec2')`);
  const html = two.app.__els.svSheet.innerHTML;
  assert.match(html, /عمر/);
  assert.doesNotMatch(html, /أحمد/);
  const one = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs('c1', ['sec1']) });
  await open(one.app);
  assert.doesNotMatch(one.app.__els.svSheet.innerHTML, /sv-chip2/);
});

/* ============ النتائج: لا إسقاط صامت ولا سقف صامت ============ */

const resp = (n, extra) => Array.from({ length: n }, (_, i) => ({ id: 'r' + String(i).padStart(5, '0'), campaign_id: 'c1', teacher_id: 'u1', answers: Object.assign({}, GOOD, extra || {}) }));
const answered = n => Array.from({ length: n }, (_, i) => ({ id: 'i' + i, campaign_id: 'c1', teacher_id: 'u1', student_id: 'a', recipient: 'guardian', code: 'abcdefghjk', sent_at: 'x', answered_on: '2026-11-09' }));

test('كل الردود تُقرأ بصفحات: 1200 رد كلها تُحسب (لا سقف 1000 صامت)', async () => {
  const { app, log } = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs(), invites: answered(2), responses: resp(1200) });
  await open(app);
  const reads = log.filter(l => l.table === 'survey_responses');
  assert.ok(reads.length >= 2);
  assert.ok(reads.every(l => l.f.teacher_id === 'u1' && l.f.campaign_id === 'c1' && l.rng));
  assert.equal(runInAppContext(app, 'svState.responses.length'), 1200);
});

test('رد لا يطابق أسئلة الاستبانة: يُستبعد ويظهر تنبيه صريح', async () => {
  const { app } = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs(), invites: answered(7), responses: resp(6).concat(resp(1, { q1: 'خمسة' })) });
  await open(app);
  await runInAppContext(app, `svSetTab('results')`);
  const html = app.__els.svSheet.innerHTML;
  assert.match(html, /تنبيه/);
  assert.match(html, /1 رد لا يطابق صيغة الأسئلة/);
});

test('أسئلة الاستبانة تالفة: رسالة صريحة بدل أرقام مضللة', async () => {
  const { app } = makeApp({ students: STUDENTS, campaigns: [camp({ questions: [{ id: 'x' }] })], sections: secs(), invites: answered(7), responses: resp(7) });
  await open(app);
  await runInAppContext(app, `svSetTab('results')`);
  const html = app.__els.svSheet.innerHTML;
  assert.match(html, /أسئلة الاستبانة غير صالحة/);
  assert.doesNotMatch(html, /متوسط التقييمات/);
});

test('العتبة من الاستبانة: 5 افتراضيًا (قبلها انتظار)، و1 لما تُحدَّد بذلك', async () => {
  const few = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs(), invites: answered(4), responses: resp(4) });
  await open(few.app);
  await runInAppContext(few.app, `svSetTab('results')`);
  assert.match(few.app.__els.svSheet.innerHTML, /ننتظر ردودًا أكثر/);
  const enough = makeApp({ students: STUDENTS, campaigns: [camp()], sections: secs(), invites: answered(5), responses: resp(5) });
  await open(enough.app);
  await runInAppContext(enough.app, `svSetTab('results')`);
  assert.match(enough.app.__els.svSheet.innerHTML, /متوسط التقييمات/);
  const one = makeApp({ students: STUDENTS, campaigns: [camp({ min_results: 1 })], sections: secs(), invites: answered(1), responses: resp(1) });
  await open(one.app);
  await runInAppContext(one.app, `svSetTab('results')`);
  assert.match(one.app.__els.svSheet.innerHTML, /متوسط التقييمات/, 'عتبة 1 تُظهر من أول رد');
});

/* ============ البنية ============ */

test('الملف المشترك محمَّل قبل شاشات الاستبانة، ومسجَّل بالكاش، والخادم يستعمله، ولا نسخة خاصة بالتطبيق', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-44-satisfaction.js'), 'utf8');
  assert.doesNotMatch(src, /SURVEY_TEMPLATE_V1|label: '(وضوح|أسلوب|متابعة)/);
  assert.match(src, /surveyValidateAnswers\(/);
  assert.match(src, /surveyValidateQuestions\(/);
  assert.match(src, /surveyNewCode\(\)/);
  assert.doesNotMatch(src, /\.limit\(1000\)/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const iShared = html.indexOf('survey-templates.js');
  assert.ok(iShared > 0 && iShared < html.indexOf('app/app-44-satisfaction.js') && iShared < html.indexOf('app/app-45-tools.js'));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  ['./survey-templates.js', 'app-44-satisfaction.js', 'app-45-tools.js'].forEach(f => assert.ok(sw.includes(f), f));
  assert.match(fs.readFileSync(path.join(root, 'api/s.js'), 'utf8'), /require\('\.\.\/survey-templates\.js'\)/);
});

test('لا حذف لاستبانة أو ردودها من الواجهة، وكل استعلام survey_ بتصفية المعلم', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-44-satisfaction.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/app-45-tools.js'), 'utf8');
  assert.doesNotMatch(src, /survey_responses'\)\.delete/);
  /* الحذف الوحيد: تراجع عن استبانة لم تكتمل (بلا ردود بعد) وبتصفية المعلم */
  (src.match(/from\('survey_campaigns'\)\.delete\(\)[^;]*/g) || []).forEach(m => assert.match(m, /teacher_id/));
  const calls = src.split(/sb\.from\('survey_/).slice(1);
  assert.ok(calls.length >= 12);
  calls.filter(c => !/^[a-z_]+'\)\.insert\(/.test(c)).forEach(c => assert.match(c.slice(0, 420), /teacher_id/, 'استعلام survey_ بلا teacher_id: ' + c.slice(0, 80)));
  assert.ok((src.match(/teacher_id: (currentUser\.id|uid)/g) || []).length >= 4);
});

test('النسخة الاحتياطية الشخصية تضم الجداول الأربعة بتصفية المعلم، والتذاكر بلا رمز', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-08-admin.js'), 'utf8');
  ['survey_campaigns', 'survey_campaign_sections', 'survey_invites', 'survey_responses'].forEach(t => {
    assert.match(src, new RegExp(`sb\\.from\\('${t}'\\)\\.select\\('\\*'\\)\\.eq\\('teacher_id', uid\\)`), t);
    assert.match(src, new RegExp(`${t}: `), t + ' بالمخرجات');
  });
  assert.match(src, /survey_invites: \(surveyInvitesRes\.data \|\| \[\]\)\.map\(r => Object\.assign\(\{\}, r, \{ code: null \}\)\)/);
});

test('نسخة بناء المخطط (app-07) تضم جداول الاستبانة ودالتها، وتتبع staging عند الطلب', () => {
  const { app } = makeApp();
  const pub = app.buildSchemaSql('public'), stg = app.buildSchemaSql('staging');
  ['survey_campaigns', 'survey_campaign_sections', 'survey_invites', 'survey_responses'].forEach(t => {
    assert.match(pub, new RegExp('create table if not exists public\\.' + t));
    assert.match(stg, new RegExp('create table if not exists staging\\.' + t));
  });
  assert.match(pub, /function public\.submit_survey/);
  assert.match(pub, /function public\.survey_questions_ok/);
  assert.doesNotMatch(stg, /public\.survey_/);
});

test('نسخة app-07 من SQL مطابقة حرفيًا لكتلة الاستبانة في sql-updates (لا انحراف بين النسختين)', () => {
  const sql = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
  const start = sql.indexOf('-- ============ استبانة رضا المستفيدين');
  assert.ok(start > 0);
  const block = sql.slice(start).trim();
  assert.ok(fs.readFileSync(path.join(root, 'app/app-07-backup-export.js'), 'utf8').includes(block), 'كتلة الاستبانة بـapp-07 تختلف عن sql-updates — أعد النسخ');
});

'use strict';
/* ============================================================
   استبانة رضا المستفيدين — الخادم (api/s.js) والمصدر المشترك (survey-templates.js) وSQL (SURVEYS.md):
   - الاستبانة كائن مستقل: عنوان وجمهور وشعب مختارة وأسئلتها هي (نسخة محفوظة)، والأسئلة المحفوظة هي الحاكمة.
   - surveyValidateQuestions = survey_questions_ok، وsurveyValidateAnswers = survey_answers_clean (نصًا هنا،
     وتطابقًا فعليًا على PostgreSQL 16 حقيقي بجدول حالات: 49 حالة أسئلة و199 حالة إجابات، صفر اختلاف).
   - الرمز الخاطئ والمنتهي والمستخدَم والمغلق: الرد نفسه تمامًا، والشكل الخاطئ لا يصل للقاعدة.
   - الصفحة مبهمة (لا بيانات طالب ولا رمز)، ونصوص المعلم مهرَّبة ومعزولة اتجاهيًا، وCSP بـnonce.
   - SQL: الردود بلا student_id/invite_id/recipient، بلا سياسة مسؤول، بلا سياسة إدراج، والدالة لـservice_role وحده،
     وتجميد الأسئلة بعد أول إرسال، ومطابقة المستلم للجمهور، وحارس الترقية من الشكل الأول.
   - محدِّد المحاولات الفاشلة لكل عنوان (20 فشلًا/10 دقائق ← 429)، والنجاح لا يُحتسب.
   (الذرّية تحت التزامن فُحصت يدويًا على PostgreSQL حقيقي: 20 طلبًا متزامنًا على تذكرة واحدة ← رد واحد.)
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const S = require('../api/s.js');
const T = require('../survey-templates.js');

const EXPORTS = ['SURVEY_AUDIENCES', 'SURVEY_CODE_LENGTH', 'SURVEY_CODE_RE', 'SURVEY_LIMITS', 'SURVEY_RATING_LABELS',
  'SURVEY_READY_TEMPLATES', 'surveyNewCode', 'surveyValidateAnswers', 'surveyValidateQuestions'];
const clone = x => JSON.parse(JSON.stringify(x));
const G = T.SURVEY_READY_TEMPLATES.guardian_v1.questions;
const ST = T.SURVEY_READY_TEMPLATES.student_v1.questions;
/* إجابة صالحة كاملة للقالبين الجاهزين (مفاتيح بمعرّفات الأسئلة) */
const OK = Object.freeze({ q1: 5, q2: 4, q3: 4, q4: true, q5: false, q6: 2, q7: 5 });
const okWith = extra => Object.assign({}, OK, extra);
const without = k => { const o = Object.assign({}, OK); delete o[k]; return o; };
const qmod = (qs, i, patch) => { const g = clone(qs); Object.assign(g[i], patch); return g; };

/* ================= survey-templates.js ================= */

test('survey-templates.js: الصادرات بالضبط، وبلا تلويث globalThis في Node', () => {
  assert.deepEqual(Object.keys(T).sort(), EXPORTS);
  for(const k of EXPORTS) assert.equal(globalThis[k], undefined, 'في Node لا يُلوَّث globalThis: ' + k);
  assert.deepEqual(T.SURVEY_LIMITS, { maxQuestions: 12, maxLabel: 120, maxOptions: 8, maxOption: 40, textMax: 300, maxTitle: 80 });
  assert.deepEqual(T.SURVEY_AUDIENCES, ['guardian', 'student', 'custom']);
  assert.deepEqual(T.SURVEY_RATING_LABELS, ['ضعيف جدًا', 'ضعيف', 'مقبول', 'جيد', 'ممتاز']);
  assert.ok(Object.isFrozen(T.SURVEY_LIMITS) && Object.isFrozen(T.SURVEY_AUDIENCES) && Object.isFrozen(T.SURVEY_RATING_LABELS));
});

test('survey-templates.js يعمل كسكربت متصفح عادي: أسماؤه فقط على globalThis، بلا تصادم عند الدمج', () => {
  const src = fs.readFileSync(path.join(root, 'survey-templates.js'), 'utf8');
  const ctx = vm.createContext({ crypto: { getRandomValues: a => crypto.webcrypto.getRandomValues(a) } });
  const before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(src, ctx);
  assert.deepEqual(Object.getOwnPropertyNames(ctx).filter(k => !before.has(k)).sort(), EXPORTS);
  assert.doesNotMatch(src, /^(const|let|var|function|class)\s/m, 'كل شيء داخل IIFE');
  assert.doesNotMatch(src, /\bimport\b|\bexport\b|\(\?<[=!]/, 'بلا وحدات ES ولا lookbehind (متصفحات iOS القديمة)');
  assert.equal(vm.runInContext('surveyValidateAnswers(SURVEY_READY_TEMPLATES.guardian_v1.questions, {q1:5,q2:5,q3:5,q4:true,q5:true,q6:0,q7:5}).ok', ctx), true);
  assert.match(vm.runInContext('surveyNewCode()', ctx), /^[a-z2-9]{10}$/);
  const ctx2 = vm.createContext({ crypto: ctx.crypto });
  vm.runInContext('const deepFreeze = 1; const CODE_ALPHABET = 2; function btrim(){ return 3; } const KEYS = 4;\n' + src, ctx2);
  assert.equal(vm.runInContext('btrim()', ctx2), 3, 'لا يكتب فوق دوال التطبيق');
});

test('القوالب الجاهزة: الجمهور والعنوان والأسئلة التسعة بنصوصها وأنواعها، ومجمّدة، وتجتاز التحقق', () => {
  const R = T.SURVEY_READY_TEMPLATES;
  assert.deepEqual(Object.keys(R), ['guardian_v1', 'student_v1', 'blank']);
  assert.deepEqual([R.guardian_v1.audience, R.student_v1.audience, R.blank.audience], ['guardian', 'student', 'custom']);
  assert.deepEqual([R.guardian_v1.title, R.student_v1.title, R.blank.title], ['رضا أولياء الأمور', 'رضا الطلاب', '']);
  assert.deepEqual(R.blank.questions, []);
  const types = ['rating', 'rating', 'rating', 'truefalse', 'truefalse', 'choice', 'rating', 'text', 'text'];
  for(const k of ['guardian_v1', 'student_v1']){
    const qs = R[k].questions;
    assert.deepEqual(qs.map(q => q.id), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9']);
    assert.deepEqual(qs.map(q => q.type), types);
    assert.deepEqual(qs.map(q => q.required), types.map(t => t !== 'text'));
    assert.deepEqual(T.surveyValidateQuestions(qs), { ok: true, value: clone(qs) }, k + ' يجتاز التحقق كما هو');
  }
  assert.deepEqual(G.map(q => q.label), ['وضوح شرح المعلم للدرس', 'أسلوب تعامل المعلم مع الطالب', 'متابعة المعلم لمستوى الطالب',
    'يتواصل المعلم معنا عند الحاجة', 'الواجبات مناسبة وتفيد الطالب', 'أفضل وسيلة للتواصل مع المعلم', 'رضاكم العام عن المعلم',
    'ما الذي أعجبكم؟', 'ما اقتراحكم للتحسين؟']);
  assert.deepEqual(G[5].options, ['واتساب', 'اتصال هاتفي', 'لقاء في المدرسة', 'رسالة من المدرسة']);
  assert.deepEqual(ST.map(q => q.label), ['وضوح شرح المعلم للدرس', 'أسلوب تعامل المعلم معك', 'اهتمام المعلم بمستواك',
    'يساعدني المعلم عندما أحتاج مساعدة', 'الواجبات مناسبة لي وتفيدني', 'أفضل طريقة للتواصل مع المعلم', 'رضاك العام عن المعلم',
    'ما الذي أعجبك؟', 'ما اقتراحك للتحسين؟']);
  assert.deepEqual(ST[5].options, ['سؤاله في الحصة', 'سؤاله بعد الحصة', 'رسالة عبر واتساب', 'عن طريق ولي أمري']);
  assert.equal(T.surveyValidateQuestions(R.blank.questions).ok, false, 'الفارغ نقطة بداية لا استبانة صالحة');
  assert.ok(Object.isFrozen(R) && Object.isFrozen(G) && Object.isFrozen(G[5].options));
  assert.ok(R.guardian_v1.title.length <= T.SURVEY_LIMITS.maxTitle && R.student_v1.title.length <= T.SURVEY_LIMITS.maxTitle);
});

test('surveyValidateQuestions: الحالات الخاطئة برموز خطأ قصيرة، والقيمة نسخة منظَّفة', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ id: 'q' + (i + 1), type: 'rating', label: 'س' + i, required: true }));
  assert.equal(T.surveyValidateQuestions(twelve).ok, true);
  const cases = [
    [null, 'not_array'], [{}, 'not_array'], [[], 'count'], [twelve.concat([{ id: 'q13', type: 'rating', label: 'x', required: true }]), 'count'],
    [[null], 'not_object:0'], [[[1]], 'not_object:0'],
    [qmod(G, 0, { extra: 1 }), 'bad_key:0'], [qmod(G, 0, { id: 'Q1' }), 'bad_id:0'], [qmod(G, 0, { id: 'q100' }), 'bad_id:0'], [qmod(G, 0, { id: 1 }), 'bad_id:0'],
    [qmod(G, 1, { id: 'q1' }), 'dup_id:1'], [qmod(G, 0, { type: 'radio' }), 'bad_type:0'],
    [qmod(G, 0, { label: '' }), 'bad_label:0'], [qmod(G, 0, { label: '   ' }), 'bad_label:0'], [qmod(G, 0, { label: 'a'.repeat(121) }), 'bad_label:0'],
    [qmod(G, 0, { label: 'a\nb' }), 'bad_label:0'], [qmod(G, 0, { label: 'a\u0085b' }), 'bad_label:0'], [qmod(G, 0, { label: 5 }), 'bad_label:0'],
    [qmod(G, 0, { required: 'true' }), 'bad_required:0'],
    [qmod(G, 5, { options: ['a'] }), 'bad_options:5'], [qmod(G, 5, { options: Array(9).fill('a') }), 'bad_options:5'],
    [qmod(G, 5, { options: ['a', ' '] }), 'bad_options:5'], [qmod(G, 5, { options: ['a', 'b'.repeat(41)] }), 'bad_options:5'],
    [qmod(G, 5, { options: ['a', 2] }), 'bad_options:5'], [qmod(G, 5, { options: 'ab' }), 'bad_options:5'],
    [qmod(G, 0, { options: ['a', 'b'] }), 'options_not_allowed:0'],
  ];
  for(const [qs, err] of cases) assert.deepEqual(T.surveyValidateQuestions(qs), { ok: false, error: err }, err);
  const del = clone(G); delete del[5].options;
  assert.equal(T.surveyValidateQuestions(del).error, 'bad_options:5');
  const norm = T.surveyValidateQuestions(qmod(G, 5, { label: '  مسافات  ', options: [' أ ', 'ب'] }));
  assert.equal(norm.value[5].label, 'مسافات'); assert.deepEqual(norm.value[5].options, ['أ', 'ب']);
  assert.equal(T.surveyValidateQuestions(qmod(G, 0, { label: 'a'.repeat(120) })).ok, true);
  assert.equal(T.surveyValidateQuestions(qmod(G, 0, { label: '😀'.repeat(120) })).ok, true, 'الطول بالمحارف الفعلية');
  assert.equal(T.surveyValidateQuestions(qmod(G, 0, { label: ' ' })).ok, true, 'btrim مثل PostgreSQL: المسافة العادية فقط');
});

test('surveyValidateAnswers: لكل نوع، والمطلوب/الاختياري، والمفاتيح الزائدة تُهمل، ولا تحويل للأنواع', () => {
  const v = T.surveyValidateAnswers(G, okWith({ q8: '  شرح ممتاز  ', q9: '', student_id: 'x', q10: 1 }));
  assert.deepEqual(v, { ok: true, value: okWith({ q8: 'شرح ممتاز' }) });
  assert.deepEqual(T.surveyValidateAnswers(G, okWith({ q6: 0 })).value.q6, 0);
  assert.equal(T.surveyValidateAnswers(G, okWith({ q8: 'ع'.repeat(300) })).ok, true);
  assert.equal(T.surveyValidateAnswers(G, okWith({ q8: '😀'.repeat(300) })).ok, true, 'الطول بالمحارف الفعلية');
  const bad = [
    [without('q1'), 'missing:q1'], [okWith({ q4: null }), 'missing:q4'], [without('q6'), 'missing:q6'],
    [okWith({ q1: 0 }), 'out_of_range:q1'], [okWith({ q2: 6 }), 'out_of_range:q2'], [okWith({ q3: 2.5 }), 'bad_type:q3'], [okWith({ q1: '5' }), 'bad_type:q1'],
    [okWith({ q7: true }), 'bad_type:q7'], [okWith({ q4: 'true' }), 'bad_type:q4'], [okWith({ q5: 0 }), 'bad_type:q5'],
    [okWith({ q6: 4 }), 'out_of_range:q6'], [okWith({ q6: -1 }), 'out_of_range:q6'], [okWith({ q6: '2' }), 'bad_type:q6'], [okWith({ q6: 1.5 }), 'bad_type:q6'],
    [okWith({ q8: 5 }), 'bad_type:q8'], [okWith({ q8: 'ع'.repeat(301) }), 'too_long:q8'], [okWith({ q9: 'a\u0000' }), 'bad_text:q9'], [okWith({ q9: 'a\uD800' }), 'bad_text:q9'],
  ];
  for(const [a, err] of bad) assert.deepEqual(T.surveyValidateAnswers(G, a), { ok: false, error: err }, err);
  for(const a of [null, [], 'x', 5]) assert.deepEqual(T.surveyValidateAnswers(G, a), { ok: false, error: 'not_object' });
  const reqText = qmod(G, 7, { required: true });
  assert.equal(T.surveyValidateAnswers(reqText, OK).error, 'missing:q8', 'نص مطلوب غائب');
  assert.equal(T.surveyValidateAnswers(reqText, okWith({ q8: '   ' })).error, 'missing:q8', 'نص مطلوب فارغ');
  const optRating = qmod(G, 1, { required: false });
  assert.deepEqual(T.surveyValidateAnswers(optRating, without('q2')).value, without('q2'), 'تقييم اختياري غائب يُهمل');
  assert.equal(T.surveyValidateAnswers(optRating, okWith({ q2: 9 })).ok, false, 'لكنه إن حضر يُتحقق منه');
  assert.deepEqual(T.surveyValidateAnswers([], OK), { ok: false, error: 'bad_questions' });
  assert.deepEqual(T.surveyValidateAnswers(qmod(G, 0, { type: 'x' }), OK), { ok: false, error: 'bad_questions' });
  const inherited = Object.create({ q1: 5 }); Object.assign(inherited, without('q1'));
  assert.equal(T.surveyValidateAnswers(G, inherited).ok, false, 'لا قيم من prototype');
});

test('الأسئلة المحفوظة بالاستبانة هي الحاكمة: تعديل قالب جاهز لا يغيّر التحقق من ردود استبانة قائمة', async () => {
  /* استبانة أُنشئت من guardian_v1 ثم عدّلها المعلم: حذف q6 وجعل q8 مطلوبًا وأضاف خيارًا */
  const stored = clone(G).filter(q => q.id !== 'q6'); stored.find(q => q.id === 'q8').required = true;
  const ans = without('q6');
  assert.equal(T.surveyValidateAnswers(G, ans).ok, false, 'بالقالب الجاهز: q6 مطلوب');
  assert.equal(T.surveyValidateAnswers(stored, okWith({ q8: 'x' })).ok, true, 'بالأسئلة المحفوظة: q6 غير موجود أصلًا');
  assert.equal(T.surveyValidateAnswers(stored, ans).error, 'missing:q8');
  /* والخادم يتحقق بأسئلة الحملة القادمة من القاعدة لا بأي قالب */
  const { h, f } = handlerWith({ campaign: { questions: stored } });
  const r1 = await call(h, 'POST', CODE, okWith({ q6: 99 }));
  assert.equal(r1.statusCode, 400, 'q8 المطلوب بالحملة غائب');
  const r2 = await call(h, 'POST', CODE, okWith({ q6: 99, q8: ' نعم ' }));
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(f.calls.find(c => c.rpc).args.p_answers, Object.assign(without('q6'), { q8: 'نعم' }), 'q6 ليس من أسئلة الحملة فيُهمل');
  const src = fs.readFileSync(path.join(root, 'api/s.js'), 'utf8');
  assert.doesNotMatch(src, /SURVEY_READY_TEMPLATES|SURVEY_TEMPLATES/, 'الخادم لا يقرأ أي قالب جاهز');
  const fn = sqlFn('submit_survey');
  assert.match(fn, /select c\.questions into v_questions/, 'الدالة تقرأ أسئلة الحملة');
  assert.doesNotMatch(fn, /'q[0-9]|"q[0-9]|'v1'/, 'لا مواصفة قالب مكتوبة بالدالة');
  assert.match(fn, /public\.survey_answers_clean\(v_questions, p_answers\)/);
});

test('surveyNewCode: 10 أحرف من الأبجدية بلا الملتبسة، وبلا انحياز (البايتات ≥248 تُرفض)', () => {
  assert.equal(T.SURVEY_CODE_LENGTH, 10);
  const seen = new Set();
  for(let i = 0; i < 300; i++){ const c = T.surveyNewCode(); assert.match(c, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/); seen.add(c); }
  assert.equal(seen.size, 300, 'بلا تكرار');
  const real = globalThis.crypto.getRandomValues;
  let n = 0;
  try {
    globalThis.crypto.getRandomValues = a => { n++; for(let i = 0; i < a.length; i++) a[i] = n === 1 ? 248 + (i % 8) : i % 31; return a; };
    assert.equal(T.surveyNewCode(), 'abcdefghjk', 'البايتات المرفوضة لا تُستعمل');
    assert.equal(n, 2);
  } finally { globalThis.crypto.getRandomValues = real; }
  assert.ok(T.SURVEY_CODE_RE.test('abcdefghjk') && T.SURVEY_CODE_RE.test('abcdefghjkmnpq'), '10 و14');
  assert.ok(!T.SURVEY_CODE_RE.test('abcdefg') && !T.SURVEY_CODE_RE.test('abcdefghj0') && !T.SURVEY_CODE_RE.test('a'.repeat(33)));
  assert.equal(S.CODE_RE, T.SURVEY_CODE_RE);
});

/* ================= SQL: مساعدات ================= */
const SQL = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
const BLOCK = SQL.slice(SQL.indexOf('-- ============ استبانة رضا المستفيدين (SURVEYS.md) ============'));
function tableBody(name){
  const i = BLOCK.indexOf(`create table if not exists public.${name} (`);
  assert.ok(i > -1, 'الجدول موجود: ' + name);
  return BLOCK.slice(i, BLOCK.indexOf('\n);', i));
}
function sqlFn(name){
  const i = BLOCK.indexOf('create or replace function public.' + name + '(');
  assert.ok(i > -1, 'الدالة موجودة: ' + name);
  return BLOCK.slice(i, BLOCK.indexOf('$fn$;', i));
}
function statements(re){ return BLOCK.split(';').filter(s => re.test(s)); }

test('SQL ↔ JS: قواعد survey_questions_ok وsurvey_answers_clean هي نفسها حدود ومعايير survey-templates.js', () => {
  const L = T.SURVEY_LIMITS;
  const qf = sqlFn('survey_questions_ok');
  assert.match(qf, /returns boolean language plpgsql immutable set search_path = ''/);
  assert.match(qf, new RegExp(`jsonb_array_length\\(q\\) < 1 or jsonb_array_length\\(q\\) > ${L.maxQuestions}\\b`));
  assert.match(qf, /k not in \('id', 'type', 'label', 'required', 'options'\)/);
  assert.match(qf, /v_id !~ '\^q\[0-9\]\{1,2\}\$' or v_id = any\(v_ids\)/, 'معرّف بالصيغة وفريد');
  assert.match(qf, /\(e->>'type'\) not in \('rating', 'truefalse', 'choice', 'text'\)/);
  assert.deepEqual(S.QUESTION_TYPES, ['rating', 'truefalse', 'choice', 'text']);
  assert.match(qf, new RegExp(`char_length\\(v_s\\) < 1 or char_length\\(v_s\\) > ${L.maxLabel} or v_s ~ v_ctl`));
  assert.match(qf, new RegExp(`char_length\\(v_s\\) < 1 or char_length\\(v_s\\) > ${L.maxOption} or v_s ~ v_ctl`));
  assert.match(qf, /v_ctl text := '\[' \|\| chr\(1\) \|\| '-' \|\| chr\(31\) \|\| chr\(127\) \|\| '-' \|\| chr\(159\) \|\| '\]'/, 'محارف التحكم C0/DEL/C1 كالـJS');
  assert.match(qf, /jsonb_typeof\(e->'required'\) is distinct from 'boolean'/);
  assert.match(qf, new RegExp(`jsonb_array_length\\(e->'options'\\) < 2 or jsonb_array_length\\(e->'options'\\) > ${L.maxOptions}\\b`));
  assert.match(qf, /elsif e \? 'options' then\s+return false;/, 'الخيارات لسؤال الاختيار وحده');
  const af = sqlFn('survey_answers_clean');
  assert.match(af, /if not public\.survey_questions_ok\(p_questions\) then return null; end if;/);
  assert.match(af, /if v_v is null or jsonb_typeof\(v_v\) = 'null' then\s+if v_req then return null; end if;\s+continue;/, 'المطلوب الغائب مرفوض وغير المطلوب يُهمل');
  assert.match(af, /jsonb_typeof\(v_v\) <> 'number' or v_v::text !~ '\^\[1-5\]\$'/, 'تقييم 1..5 صحيح');
  assert.match(af, /jsonb_typeof\(v_v\) <> 'boolean'/);
  assert.match(af, /v_v::text !~ '\^\[0-9\]\{1,2\}\$' or \(v_v::text\)::int >= jsonb_array_length\(e->'options'\)/, 'فهرس ضمن خيارات السؤال نفسه');
  assert.match(af, /v_s := btrim\(v_v #>> '\{\}'\);\s+if v_s = '' then\s+if v_req then return null; end if;\s+continue;/, 'النص الفارغ: مرفوض إن كان مطلوبًا وإلا يُحذف');
  assert.match(af, new RegExp(`char_length\\(v_s\\) > ${L.textMax}\\b`));
  assert.match(af, /v_out := v_out \|\| jsonb_build_object\(v_id, v_v\)/, 'يُبنى من معرّفات الأسئلة وحدها');
  assert.match(af, /immutable set search_path = ''/);
});

test('SQL: قيود الحملة تطابق الملف المشترك (الجمهور، القالب الجاهز، العنوان، العتبة)، والشكل القديم أُزيل', () => {
  const c = tableBody('survey_campaigns');
  const list = re => c.match(re)[1].split(',').map(x => x.trim().replace(/'/g, ''));
  assert.deepEqual(list(/audience text not null check \(audience in \(([^)]*)\)\)/), T.SURVEY_AUDIENCES.slice());
  assert.deepEqual(list(/template text not null default 'guardian_v1' check \(template in \(([^)]*)\)\)/), Object.keys(T.SURVEY_READY_TEMPLATES));
  assert.match(c, new RegExp(`title text not null check \\(char_length\\(btrim\\(title\\)\\) between 1 and ${T.SURVEY_LIMITS.maxTitle}\\)`));
  assert.match(c, /questions jsonb not null check \(public\.survey_questions_ok\(questions\)\)/, 'الأسئلة نسخة محفوظة ومُتحقَّق منها');
  assert.match(c, /min_results smallint not null default 5 check \(min_results between 1 and 50\)/);
  assert.match(c, /sort_order integer not null default 0/);
  assert.match(c, /status text not null default 'open' check \(status in \('open', 'closed'\)\)/);
  assert.match(c, /unique \(id, teacher_id\)/);
  assert.doesNotMatch(c, /section_id|academic_year|semester_label/, 'لا ربط بشعبة واحدة');
  const cs = tableBody('survey_campaign_sections');
  assert.match(cs, /primary key \(campaign_id, section_id\)/);
  assert.match(cs, /foreign key \(campaign_id, teacher_id\) references public\.survey_campaigns\(id, teacher_id\) on update cascade on delete cascade/);
  assert.match(cs, /foreign key \(section_id, teacher_id\) references public\.classroom_sections\(id, teacher_id\) on update cascade on delete cascade/, 'لا ربط بشعبة معلم آخر');
});

test('SQL: survey_responses بلا مرجع لطالب أو تذكرة أو مستلم، والتذاكر: تذكرة لكل مستلم ورموز 8..32', () => {
  const resp = tableBody('survey_responses');
  assert.doesNotMatch(resp, /student|invite|recipient/i, 'الرد لا يشير لطالب ولا لتذكرة ولا لمستلم');
  assert.match(resp, /created_on date not null/);
  assert.doesNotMatch(resp, /timestamptz|created_at/, 'لا وقت بالرد');
  assert.doesNotMatch(resp, /bigserial|serial|identity/i, 'معرّف عشوائي لا تسلسلي');
  assert.match(resp, /octet_length\(answers::text\) <= 16384/, 'سقف حجم الإجابات (12 سؤالًا نصيًا)');
  assert.ok(S.BODY_MAX_BYTES >= 16384 * 0.9 && S.BODY_MAX_BYTES <= 16384, 'سقف الطلب يتسع للإجابات');
  const inv = tableBody('survey_invites');
  assert.match(inv, /answered_on date,/);
  assert.match(inv, /\n  unique \(campaign_id, student_id, recipient\),/);
  assert.match(inv, /recipient text not null default 'guardian' check \(recipient in \('guardian', 'student'\)\)/);
  assert.match(inv, /code ~ '\^\[a-z2-9\]\{8,32\}\$'/);
  assert.match(inv, /foreign key \(student_id, teacher_id\) references public\.classroom_students\(id, teacher_id\)[^\n]*on delete cascade/);
  assert.doesNotMatch(inv, /answers|rating|comment/);
  assert.match(BLOCK, /create unique index if not exists survey_invites_code_key on public\.survey_invites\(code\) where code is not null/);
});

test('SQL: كل سياسات survey_* للمعلم وحده، بلا مسؤول، وبلا أي سياسة كتابة على الردود', () => {
  const pol = statements(/create policy[^]*on public\.survey_/);
  assert.equal(pol.length, 4);
  for(const p of pol){ assert.doesNotMatch(p, /admin/i, 'لا سياسة مسؤول'); assert.match(p, /auth\.uid\(\) = teacher_id/); }
  const respPol = pol.filter(p => /on public\.survey_responses/.test(p));
  assert.equal(respPol.length, 1);
  assert.match(respPol[0], /for select/); assert.doesNotMatch(respPol[0], /with check/);
  assert.equal(statements(/create policy[^]*on public\.survey_responses[^]*for (insert|update|delete|all)/).length, 0, 'لا سياسة إدراج');
  assert.match(BLOCK, /revoke insert, update, delete on public\.survey_responses from anon, authenticated/);
  for(const t of ['survey_campaigns', 'survey_campaign_sections', 'survey_invites', 'survey_responses'])
    assert.match(BLOCK, new RegExp(`alter table public\\.${t} enable row level security`));
  assert.ok(pol.some(p => /on public\.survey_campaign_sections for all to authenticated\s+using \(auth\.uid\(\) = teacher_id\) with check \(auth\.uid\(\) = teacher_id\)/.test(p)));
});

test('SQL: submit_survey وsurvey_answers_clean لـservice_role وحده، والاستلام ذرّي بأسئلة الحملة', () => {
  for(const sig of ['submit_survey(text, jsonb)', 'survey_answers_clean(jsonb, jsonb)']){
    const e = sig.replace(/[()]/g, '\\$&');
    assert.match(BLOCK, new RegExp(`revoke execute on function public\\.${e} from public, anon, authenticated;`));
    assert.match(BLOCK, new RegExp(`grant execute on function public\\.${e} to service_role;`));
  }
  assert.equal(statements(/grant execute on function public\.(submit_survey|survey_answers_clean)[^]*to [^;]*(anon|authenticated|public)/).length, 0);
  const fn = sqlFn('submit_survey');
  assert.match(fn, /security definer set search_path = ''/);
  assert.match(fn, /p_code !~ '\^\[a-z2-9\]\{8,32\}\$'/);
  assert.match(fn, /for share of c;/, 'أسئلة الحملة لا تتغير بين القراءة والإدراج');
  assert.match(fn, /if v_clean is null then return false; end if;/);
  const upd = fn.indexOf('update public.survey_invites'), ins = fn.indexOf('insert into public.survey_responses');
  assert.ok(upd > fn.indexOf('survey_answers_clean') && ins > upd, 'تحقق ثم تحديث ثم إدراج');
  const updStmt = fn.slice(upd, fn.indexOf(';', upd));
  assert.match(updStmt, /i\.answered_on is null/);
  assert.match(updStmt, /c\.status = 'open' and c\.closes_at > now\(\)/);
  assert.match(updStmt, /set answered_on = current_date/);
  assert.match(fn.slice(upd, ins), /if not found then return false; end if;/);
  assert.match(fn.slice(ins), /values \(v_campaign, v_teacher, v_clean, current_date\)/, 'يُخزَّن الكائن المعاد بناؤه لا المُرسَل');
});

test('SQL: تجميد الأسئلة والجمهور بعد أول إرسال، ومنع نقل المالك، ومطابقة مستلم التذكرة للجمهور', () => {
  const g = sqlFn('survey_campaign_guard');
  assert.match(g, /if new\.teacher_id is distinct from old\.teacher_id then\s+raise exception 'لا يُغيَّر مالك الاستبانة'/);
  assert.match(g, /\(new\.questions is distinct from old\.questions or new\.audience is distinct from old\.audience\)\s+and exists \(select 1 from public\.survey_invites i\s+where i\.campaign_id = old\.id and \(i\.sent_at is not null or i\.answered_on is not null\)\) then\s+raise exception 'الأسئلة تتجمّد بعد أول إرسال'/);
  assert.match(g, /new\.audience <> 'custom'\s+and exists \(select 1 from public\.survey_invites i where i\.campaign_id = old\.id and i\.recipient <> new\.audience\)/, 'جمهور جديد لا يخالف تذاكر قائمة');
  assert.match(BLOCK, /create or replace trigger trg_survey_campaign_guard before update on public\.survey_campaigns\s+for each row execute function public\.survey_campaign_guard\(\);/);
  const a = sqlFn('survey_invite_audience_guard');
  assert.match(a, /if v_aud is not null and v_aud <> 'custom' and new\.recipient <> v_aud then\s+raise exception/);
  assert.match(BLOCK, /create or replace trigger trg_survey_invite_audience_guard before insert or update of recipient, campaign_id on public\.survey_invites/);
});

test('SQL: حارس الترقية — الشكل القديم الفارغ يُحذف، وغير الفارغ يوقف التشغيل، وبلا اسم مخطط حرفي', () => {
  const i = BLOCK.indexOf('do $$'), end = BLOCK.indexOf('end $$;', i);
  assert.ok(i > -1 && i < BLOCK.indexOf('create table if not exists'), 'الحارس قبل إنشاء الجداول');
  const guard = BLOCK.slice(i, end);
  assert.match(guard, /v_camp regclass := to_regclass\('public\.survey_campaigns'\)/);
  assert.match(guard, /exists \(select 1 from pg_attribute where attrelid = v_camp and attname = 'section_id' and not attisdropped\) then/, 'يُعرف الشكل القديم بعموده لا بالاسم');
  assert.match(guard, /execute format\('select exists \(select 1 from %s\)', v_t\) into v_rows/);
  assert.match(guard, /if v_rows then\s+raise exception '[^']*ترحيل يدوي/, 'بيانات قديمة: توقف صريح بلا حذف');
  assert.ok(guard.indexOf('raise exception') < guard.indexOf('drop table'), 'لا حذف قبل التحقق من الفراغ');
  assert.match(guard, /drop table if exists public\.survey_responses, public\.survey_invites, public\.survey_campaigns cascade;/);
  assert.match(guard, /drop function if exists public\.submit_survey\(text, jsonb\);/);
  assert.doesNotMatch(guard, /'public'|table_schema|nspname/, 'بلا اسم مخطط حرفي: يعمل بعد تحويل public. إلى staging.');
  /* نفس تحويل buildSchemaSql بـapp-07 */
  const app07 = fs.readFileSync(path.join(root, 'app/app-07-backup-export.js'), 'utf8');
  assert.match(app07, /\.replace\(\/\\bpublic\\\.\/g, schema \+ '\.'\)/);
  const staged = BLOCK.replace(/\bpublic\./g, 'staging.');
  assert.doesNotMatch(staged, /\bpublic\.[a-z]/, 'لا مرجع public. باقٍ');
  assert.match(staged, /to_regclass\('staging\.survey_campaigns'\)/);
  assert.match(staged, /drop table if exists staging\.survey_responses, staging\.survey_invites, staging\.survey_campaigns cascade/);
  assert.match(staged, /check \(staging\.survey_questions_ok\(questions\)\)/);
  /* الكتلة تُنسخ حرفيًا داخل نص JavaScript بـapp-07: بلا شرطة مائلة ولا ` ولا ${ */
  assert.doesNotMatch(BLOCK, /\\|`|\$\{/);
});

test('buildSchemaSql (app-07): نسخة كتلة الاستبانة مطابقة لملف SQL، وتحويل staging يطال الحارس', () => {
  const { loadApp } = require('./load-app');
  const app = loadApp();
  const pub = app.buildSchemaSql();
  const mark = '-- ============ استبانة رضا المستفيدين (SURVEYS.md) ============';
  const mirrored = pub.slice(pub.indexOf(mark));
  assert.ok(mirrored.includes(BLOCK.trim()), 'انسخ كتلة الاستبانة من sql-updates-run-in-supabase.sql إلى buildSchemaSql بـapp-07 حرفيًا');
  const stg = app.buildSchemaSql('staging');
  assert.match(stg, /to_regclass\('staging\.survey_campaigns'\)/);
  assert.doesNotMatch(stg.slice(stg.indexOf(mark)), /\bpublic\.[a-z]/);
});

/* ================= الخادم api/s.js ================= */
const CODE = 'abcdefghjk';
function fakeDb(o){
  o = o || {};
  const future = new Date(Date.now() + 86400000).toISOString();
  const camp = (x) => Object.assign({ title: 'رضا أولياء الأمور', audience: 'guardian', questions: clone(G), status: 'open', closes_at: future, min_results: 5 }, x);
  const db = {
    survey_invites: [
      { code: CODE, campaign_id: 'c1', answered_on: null },
      { code: 'usedusedus', campaign_id: 'c1', answered_on: '2026-11-01' },
      { code: 'expiredexp', campaign_id: 'c2', answered_on: null },
      { code: 'closedclos', campaign_id: 'c3', answered_on: null },
      { code: 'badqsbadqs', campaign_id: 'c4', answered_on: null },
    ],
    survey_campaigns: [
      Object.assign(camp(o.campaign), { id: 'c1' }),
      Object.assign(camp({ closes_at: new Date(Date.now() - 1000).toISOString() }), { id: 'c2' }),
      Object.assign(camp({ status: 'closed' }), { id: 'c3' }),
      Object.assign(camp({ questions: [] }), { id: 'c4' }),
    ],
  };
  const calls = [];
  const pick = (row, cols) => { const out = {}; cols.split(',').map(c => c.trim()).forEach(c => { if(c in row) out[c] = row[c]; }); return out; };
  const client = {
    from(t){ const f = []; let cols = ''; const api = {
      select(c){ cols = c; return api; }, eq(c, v){ f.push([c, v]); return api; },
      maybeSingle: async () => { calls.push({ t, cols, f: f.slice() }); if(o.dbError) return { data: null, error: { message: 'x' } };
        const embed = /survey_campaigns!inner\(([^)]*)\)/.exec(cols);
        if(embed && o.noEmbed) return { data: null, error: { code: 'PGRST200', message: 'no relationship' } };
        const row = (db[t] || []).find(r => f.every(([c, v]) => r[c] === v));
        if(!row) return { data: null, error: null };
        if(embed){
          const c = db.survey_campaigns.find(x => x.id === row.campaign_id);
          return { data: { answered_on: row.answered_on, survey_campaigns: pick(c, embed[1]) }, error: null };
        }
        return { data: pick(row, cols), error: null }; } };
      return api; },
    rpc: async (name, args) => { calls.push({ rpc: name, args });
      if(o.rpcError) return { data: null, error: { message: 'x' } };
      if(o.rpcFalse) return { data: false, error: null };
      const inv = db.survey_invites.find(r => r.code === args.p_code && !r.answered_on);
      if(!inv) return { data: false, error: null };
      inv.answered_on = '2026-11-09'; return { data: true, error: null }; },
  };
  return { client, calls, db };
}
function fakeRes(){
  const r = { statusCode: 0, headers: {}, body: undefined,
    status(s){ r.statusCode = s; return r; }, setHeader(k, v){ r.headers[k.toLowerCase()] = v; }, send(b){ r.body = b; return r; } };
  return r;
}
function handlerWith(o){
  const f = fakeDb(o);
  const limiter = (o && o.limiter) || S.createFailureLimiter(); /* محدِّد جديد لكل اختبار: لا تراكم بين الاختبارات */
  const h = S.createHandler({ url: 'https://x.supabase.co', key: 'service', createClient: () => f.client, limiter });
  return { h, f, limiter };
}
async function call(h, method, code, body, headers, socketIp){
  const res = fakeRes();
  await h({ method, query: { c: code }, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body, socket: { remoteAddress: socketIp || '10.0.0.1' } }, res);
  return res;
}
function assertPrivateHeaders(res){
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.headers['x-robots-tag'], /noindex/);
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  const csp = res.headers['content-security-policy'];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/, 'لا inline عام ولا مصادر خارجية');
}

test('resolveSurveyCode: استعلام واحد بدمج الحملة (واحتياط باستعلامين)، ويرجع الاستبانة بلا أي معرّف', async () => {
  const { client, calls } = fakeDb();
  const r = await S.resolveSurveyCode(CODE, client);
  assert.deepEqual(r, { ok: true, campaign: { title: 'رضا أولياء الأمور', audience: 'guardian', questions: clone(G), minResults: 5 } });
  assert.equal(calls.length, 1, 'استعلام واحد');
  assert.match(calls[0].cols, /^answered_on, survey_campaigns!inner\(title, audience, questions, status, closes_at, min_results\)$/);
  assert.deepEqual(calls[0].f, [['code', CODE]], 'بالرمز وحده');
  for(const c of ['usedusedus', 'expiredexp', 'closedclos', 'badqsbadqs', 'mmmmmmmmmm'])
    assert.deepEqual(await S.resolveSurveyCode(c, client), { ok: false }, c);
  const before = calls.length;
  for(const bad of ['', 'ABCDEFGHJK', 'abc', "a' or '1'='1aaaaa", '../../etc/passwd', null, undefined, 'a'.repeat(40), [CODE], 'abcdefghj0'])
    assert.deepEqual(await S.resolveSurveyCode(bad, client), { ok: false }, 'يُرفض قبل أي استعلام: ' + String(bad));
  assert.equal(calls.length, before, 'الشكل الخاطئ لا يصل للقاعدة');
  assert.ok(calls.every(c => !/student|name|phone|recipient|teacher/.test(c.cols || '')), 'لا يُقرأ أي حقل يخص الطالب أو المعلم');
  const fb = fakeDb({ noEmbed: true });
  assert.deepEqual(await S.resolveSurveyCode(CODE, fb.client), r, 'الاحتياط باستعلامين يعطي النتيجة نفسها');
  assert.deepEqual(await S.resolveSurveyCode('usedusedus', fb.client), { ok: false });
  assert.deepEqual(await S.resolveSurveyCode(CODE, fakeDb({ dbError: true }).client), { ok: false });
});

test('GET: صفحة الاستبانة من أسئلة الحملة نفسها، بعنوانها ومقدمة جمهورها، وبنسق الأمان نفسه', async () => {
  const { h } = handlerWith();
  const ok = await call(h, 'GET', CODE);
  assert.equal(ok.statusCode, 200);
  assertPrivateHeaders(ok);
  const nonce = ok.headers['content-security-policy'].match(/'nonce-([^']+)'/)[1];
  assert.match(ok.body, new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}">`));
  assert.doesNotMatch(ok.body, /<script(?![^>]*nonce=)/); assert.doesNotMatch(ok.body, /<script[^>]+src=/);
  assert.doesNotMatch(ok.body, /\sstyle=/, 'لا style مضمّن (CSP يمنعه)');
  assert.match(ok.body, /<meta name="robots" content="noindex/);
  assert.match(ok.body, /<h1><bdi>رضا أولياء الأمور<\/bdi><\/h1>/);
  assert.match(ok.body, /هذه الاستبانة لولي الأمر\./);
  assert.match(ok.body, /ردّك لا يُربط باسمك/); assert.doesNotMatch(ok.body, /مجهول/);
  assert.doesNotMatch(ok.body, /العدد قليل/, 'العتبة 5: بلا جملة العدد القليل');
  assert.doesNotMatch(ok.body, new RegExp(CODE), 'الرمز لا يُطبع بالصفحة');
  assert.doesNotMatch(ok.body, /student|guardian|phone|full_name|c1/i, 'لا معرّفات ولا بيانات طالب');
  for(const q of G) assert.ok(ok.body.includes(q.label), q.label);
  assert.equal((ok.body.match(/<fieldset data-q=/g) || []).length, 9);
  assert.equal((ok.body.match(/<input type="radio" name="q1"/g) || []).length, 5, 'التقييم 5 أزرار');
  assert.match(ok.body, /name="q4" value="true"><span><b>صح<\/b>/);
  assert.equal((ok.body.match(/<input type="radio" name="q6"/g) || []).length, 4);
  assert.match(ok.body, /<textarea name="q8" maxlength="300"/); assert.match(ok.body, /id="c-q9"[^>]*>0 \/ 300</);
  assert.match(ok.body, /<span id="pgt"[^>]*>0 من 7 أسئلة مطلوبة<\/span>/); assert.match(ok.body, /<progress id="pgb" max="7" value="0"/);
  assert.match(ok.body, /\.prog\{position:sticky;top:0/);
  assert.match(ok.body, /prefers-reduced-motion: reduce/); assert.match(ok.body, /behavior:calm\?'auto':'smooth'/);
  assert.match(ok.body, /b\.classList\.toggle\('ready',all\)/); assert.match(ok.body, /button\.ready\{/);
  assert.doesNotMatch(ok.body, /alert\(/); assert.match(ok.body, /classList\.add\('miss'\)/);
  assert.match(ok.body, /var rq=fs\.getAttribute\('data-req'\)==='1';/, 'المطلوب من data-req لكل سؤال');
  assert.match(ok.body, /if\(v\)a\[id\]=v;else if\(rq\)miss\.push\(fs\);/, 'النص المطلوب الفارغ يُنبَّه عليه');
  assert.match(ok.body, /if\(!x\)\{if\(rq\)miss\.push\(fs\);return;\}/, 'غير المطلوب غير المُجاب لا يُنبَّه عليه');
  assert.match(ok.body, /b\.disabled=true/); assert.match(ok.body, /شكرًا لك/);

  const stud = await call(handlerWith({ campaign: { title: 'رضا الطلاب', audience: 'student', questions: clone(ST) } }).h, 'GET', CODE);
  assert.match(stud.body, /هذه الاستبانة للطالب\./); assert.ok(stud.body.includes('عن طريق ولي أمري'));
  const custom = [{ id: 'q1', type: 'text', label: 'رأيك؟', required: true }, { id: 'q2', type: 'rating', label: 'تقييم', required: false }, { id: 'q3', type: 'truefalse', label: 'هل؟', required: true }];
  const cu = await call(handlerWith({ campaign: { title: 'مخصصة', audience: 'custom', questions: custom, min_results: 3 } }).h, 'GET', CODE);
  assert.match(cu.body, /شكرًا لمشاركتك في هذه الاستبانة\./);
  assert.match(cu.body, /العدد قليل وقد يعرف المعلم من أجاب/, 'عتبة أقل من 5: جملة صادقة');
  assert.match(cu.body, />0 من 2 أسئلة مطلوبة</, 'التقدم بعدد مطلوب هذه الاستبانة');
  assert.equal((cu.body.match(/data-req="1"/g) || []).length, 2);
  assert.match(cu.body, /<legend><bdi>تقييم<\/bdi> <span class="opt-tag">\(اختياري\)<\/span>/);
  const allOpt = await call(handlerWith({ campaign: { questions: [{ id: 'q1', type: 'text', label: 'x', required: false }] } }).h, 'GET', CODE);
  assert.match(allOpt.body, /كل الأسئلة اختيارية/); assert.doesNotMatch(allOpt.body, /<progress/);

  const gone = [];
  for(const c of ['usedusedus', 'expiredexp', 'closedclos', 'badqsbadqs', 'mmmmmmmmmmmmmm', 'BAD!', undefined]){
    const r = await call(h, 'GET', c);
    assertPrivateHeaders(r);
    gone.push({ s: r.statusCode, b: r.body.replace(/nonce="[^"]+"/g, '') });
  }
  assert.ok(gone.every(g => g.s === 404 && g.b === gone[0].b), 'الصفحة نفسها حرفيًا لكل الأسباب');
});

test('GET: نصوص المعلم غير موثوقة — <script> وعلامات الاقتباس ومحارف الاتجاه في العنوان والأسئلة والخيارات مهرَّبة ومعزولة', async () => {
  const evil = '<script>alert(1)</script>"\'&‮أ';
  const qs = [{ id: 'q1', type: 'choice', label: evil + 'سؤال', required: true, options: [evil, '"><img src=x onerror=alert(1)>'] },
    { id: 'q2', type: 'rating', label: '</legend><script>x()</script>', required: true }];
  assert.equal(T.surveyValidateQuestions(qs).ok, true, 'نصوص كهذه مسموحة بالقيد، فالأمان من التهريب');
  const r = await call(handlerWith({ campaign: { title: evil, questions: qs } }).h, 'GET', CODE);
  assert.equal(r.statusCode, 200);
  assert.equal((r.body.match(/<script/g) || []).length, 1, 'السكربت الوحيد هو سكربت الصفحة بالـnonce');
  assert.doesNotMatch(r.body, /<img|<\/legend><script|"><img/, "لا وسم حقيقي من نص المعلم (onerror يبقى نصًا مهرَّبًا)");
  assert.match(r.body, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;&amp;/);
  assert.match(r.body, /<h1><bdi>&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&#39;&amp;‮أ<\/bdi><\/h1>/, 'محرف الاتجاه معزول داخل <bdi>');
  assert.match(r.body, /<span><bdi>&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;<\/bdi><\/span>/);
  assert.match(r.body, /<legend><bdi>&lt;\/legend&gt;&lt;script&gt;x\(\)&lt;\/script&gt;<\/bdi>/);
});

test('POST: يتحقق بأسئلة الحملة ثم الدالة؛ رد واحد فقط، والرموز السيئة برد موحَّد، والصيغة الخاطئة لا تصل للدالة', async () => {
  const { h, f } = handlerWith();
  const first = await call(h, 'POST', CODE, okWith({ q8: ' جيد ', student_id: 'S1' }));
  assert.equal(first.statusCode, 200); assert.deepEqual(JSON.parse(first.body), { ok: true });
  assertPrivateHeaders(first);
  const rpc = f.calls.find(c => c.rpc);
  assert.equal(rpc.rpc, 'submit_survey');
  assert.deepEqual(rpc.args, { p_code: CODE, p_answers: okWith({ q8: 'جيد' }) }, 'المنظَّف فقط');
  const uniform = [];
  for(const c of [CODE /* استُخدم للتو */, 'usedusedus', 'expiredexp', 'closedclos', 'badqsbadqs', 'mmmmmmmmmm', 'NOT-A-CODE']){
    const r = await call(h, 'POST', c, OK);
    uniform.push({ s: r.statusCode, b: r.body });
  }
  assert.ok(uniform.every(u => u.s === 404 && u.b === '{"ok":false}'), 'الرد نفسه حرفيًا: ' + JSON.stringify(uniform));
  assert.equal(f.calls.filter(c => c.rpc).length, 1);
  const g = handlerWith();
  assert.equal((await call(g.h, 'POST', CODE, without('q6'))).statusCode, 400);
  assert.equal(g.f.calls.filter(c => c.rpc).length, 0, 'الصيغة الخاطئة لا تصل للدالة');
  assert.equal(g.f.db.survey_invites[0].answered_on, null, 'ولا تستهلك التذكرة');
});

test('POST: سباق (الدالة رجعت false) كرمز مستخدَم؛ وخطأ الدالة 503؛ وخطأ القراءة غير موجود', async () => {
  const race = handlerWith({ rpcFalse: true });
  const r = await call(race.h, 'POST', CODE, OK);
  assert.equal(r.statusCode, 404); assert.equal(r.body, '{"ok":false}');
  assert.equal((await call(handlerWith({ rpcError: true }).h, 'POST', CODE, OK)).statusCode, 503);
  assert.equal((await call(handlerWith({ dbError: true }).h, 'POST', CODE, OK)).statusCode, 404);
});

test('POST: سقف الحجم 16KB، وJSON فقط، وطرق أخرى مرفوضة، وبلا متغيرات بيئة لا شيء', async () => {
  const { h, f } = handlerWith();
  assert.equal((await call(h, 'POST', CODE, okWith({ q8: 'x'.repeat(17000) }))).statusCode, 413);
  assert.equal((await call(h, 'POST', CODE, OK, { 'content-length': '999999' })).statusCode, 413);
  assert.equal((await call(h, 'POST', CODE, 'x'.repeat(17000))).statusCode, 413, 'نص خام كبير');
  assert.equal((await call(h, 'POST', CODE, '{bad json')).statusCode, 400);
  assert.equal((await call(h, 'POST', CODE, 'q1=1', { 'content-type': 'application/x-www-form-urlencoded' })).statusCode, 415);
  const big = {}; const many = Array.from({ length: 12 }, (_, i) => ({ id: 'q' + (i + 1), type: 'text', label: 'س', required: false }));
  many.forEach(q => { big[q.id] = 'ع'.repeat(300); });
  const m = handlerWith({ campaign: { questions: many } });
  assert.equal((await call(m.h, 'POST', CODE, JSON.stringify(big))).statusCode, 200, '12 نصًا × 300 حرف عربي تمر');
  assert.equal((await call(h, 'POST', CODE, JSON.stringify(OK))).statusCode, 200, 'الجسم النصي يُحلَّل');
  for(const meth of ['PUT', 'DELETE', 'PATCH']) assert.equal((await call(h, meth, CODE)).statusCode, 405);
  assert.equal(f.calls.filter(c => c.rpc).length, 1);
  const none = S.createHandler({ url: '', key: '', createClient: () => { throw new Error('لا يُنشأ عميل'); }, limiter: S.createFailureLimiter() });
  assert.equal((await call(none, 'GET', CODE)).statusCode, 503);
});

test('الملف: المصدر المشترك بمسار حرفي، والحزمة داخل المعالج فقط، وrewrite لـ/s/ و/r/', () => {
  const src = fs.readFileSync(path.join(root, 'api/s.js'), 'utf8');
  assert.match(src, /require\('\.\.\/survey-templates\.js'\)/, 'مسار حرفي ثابت ليجمعه متتبّع Vercel');
  assert.doesNotMatch(src, /Number\.isInteger\(v\)|function cleanText|function surveyValidate/, 'لا مدقق مكرر');
  assert.doesNotMatch(src.slice(0, src.indexOf('function createHandler')), /require\('@supabase\/supabase-js'\)/);
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(vj.rewrites.some(r => r.source === '/s/:code' && r.destination === '/api/s?c=:code'));
  assert.ok(vj.rewrites.some(r => r.source === '/r/:code' && r.destination === '/api/r?c=:code'));
});

/* ================= محدِّد المحاولات الفاشلة ================= */
function clock(){ const c = { t: 1e12, now: () => c.t }; return c; }

test('المحدِّد: 20 فشلًا من عنوان واحد ← 429 (GET صفحة ودية، POST JSON) مع Retry-After، حتى للرمز الصحيح', async () => {
  const c = clock();
  const { h, f } = handlerWith({ limiter: S.createFailureLimiter({ now: c.now }) });
  for(let i = 0; i < 20; i++){
    const r = await call(h, i % 2 ? 'POST' : 'GET', i % 3 ? 'mmmmmmmmmmmmmm' : 'BAD!', OK);
    assert.equal(r.statusCode, 404, 'محاولة ' + (i + 1) + ' ما تزال مسموحة');
  }
  const g = await call(h, 'GET', CODE);
  assert.equal(g.statusCode, 429); assert.equal(g.headers['retry-after'], '600');
  assert.match(g.body, /محاولات كثيرة/); assertPrivateHeaders(g); assert.doesNotMatch(g.body, /<script/);
  const p = await call(h, 'POST', CODE, OK);
  assert.equal(p.statusCode, 429); assert.equal(p.body, '{"ok":false}');
  assert.equal(f.calls.filter(x => x.rpc).length, 0, 'لا وصول للدالة أثناء الحظر');
  assert.equal((await call(h, 'GET', CODE, null, null, '10.9.9.9')).statusCode, 200, 'عنوان آخر غير متأثر');
  c.t += 5 * 60 * 1000;
  assert.equal((await call(h, 'GET', CODE)).headers['retry-after'], '300');
  c.t += 5 * 60 * 1000 + 1;
  assert.equal((await call(h, 'GET', CODE)).statusCode, 200, 'بعد 10 دقائق يُرفع الحظر');
});

test('المحدِّد: النجاح لا يُحتسب، والفشل يُحتسب للرمز المستخدَم والمنتهي والمغلق والمشوَّه وسباق الدالة', async () => {
  const { h, limiter } = handlerWith();
  for(let i = 0; i < 40; i++) assert.equal((await call(h, 'GET', CODE)).statusCode, 200);
  assert.equal(limiter.blockedFor('10.0.0.1'), 0);
  assert.equal((await call(h, 'POST', CODE, without('q1'))).statusCode, 400, 'إجابة ناقصة ليست محاولة رمز');
  assert.equal((await call(h, 'POST', CODE, '{bad')).statusCode, 400);
  assert.equal((await call(h, 'POST', CODE, OK)).statusCode, 200);
  assert.equal(limiter.size(), 0, 'لا شيء مسجَّل بعد النجاحات وأخطاء الجسم');
  for(const code of ['usedusedus', 'expiredexp', 'closedclos', 'NOPE', undefined, CODE /* صار مستخدَمًا */]) await call(h, 'GET', code);
  const race = handlerWith({ rpcFalse: true });
  await call(race.h, 'POST', CODE, OK);
  assert.equal(race.limiter.size(), 1, 'false من الدالة = فشل');
  assert.equal(limiter.size(), 1);
  for(let i = 0; i < 14; i++) await call(h, 'GET', 'NOPE');
  assert.equal((await call(h, 'GET', CODE)).statusCode, 429, '6 + 14 = 20 فشلًا');
});

test('المحدِّد: عنوان العميل أول قفزة بـx-forwarded-for وإلا المقبس، والذاكرة محدودة، وبلا مؤقتات', () => {
  assert.equal(S.clientIp({ headers: { 'x-forwarded-for': ' 1.2.3.4 , 10.0.0.1' }, socket: { remoteAddress: '9.9.9.9' } }), '1.2.3.4');
  assert.equal(S.clientIp({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
  assert.equal(S.clientIp({ headers: {} }), 'unknown');
  assert.equal(S.clientIp({ headers: { 'x-forwarded-for': 'x'.repeat(500) } }).length, 64);
  const c = clock();
  const l = S.createFailureLimiter({ now: c.now, maxKeys: 100 });
  for(let i = 0; i < 1000; i++) l.fail('ip' + i);
  assert.ok(l.size() <= 100, 'لا نمو بلا حد: ' + l.size());
  c.t += S.LIMIT_WINDOW_MS + 1;
  l.fail('fresh');
  assert.equal(l.size(), 1, 'التنظيف الكسول يحذف المنتهي');
  const store = new Map();
  const one = S.createFailureLimiter({ now: c.now, store });
  for(let i = 0; i < 500; i++) one.fail('same');
  assert.ok(one.blockedFor('same') > 0);
  assert.ok(store.get('same').length <= S.LIMIT_MAX_FAILURES, 'ذاكرة العنوان الواحد محدودة');
  const src = fs.readFileSync(path.join(root, 'api/s.js'), 'utf8').replace(/const SCRIPT = `[^`]*`;/, '');
  assert.doesNotMatch(src, /setInterval|setTimeout/, 'لا مؤقت يُبقي الدالة حية');
  assert.match(src, /Vercel WAF/);
  assert.equal(S.LIMIT_MAX_FAILURES, 20); assert.equal(S.LIMIT_WINDOW_MS, 600000);
});

'use strict';
/* ============================================================
   استبانة رضا المستفيدين — الخادم (api/s.js) وSQL (SURVEYS.md):
   - التحقق من الصيغة لكل نوع (تقييم 1..5، صح/خطأ منطقي، اختيار بفهرس، نص مقصوص ≤300)، الإلزامي، والمفاتيح الزائدة تُهمل.
   - الرمز الخاطئ والمنتهي والمستخدَم والمغلق: الرد نفسه تمامًا، والشكل الخاطئ لا يصل للقاعدة.
   - الصفحة مبهمة (لا بيانات طالب ولا رمز)، وبلا تخزين ولا فهرسة ولا Referer، وCSP بـnonce.
   - SQL: الردود بلا student_id/invite_id، بلا سياسة مسؤول، بلا سياسة إدراج، والدالة لـservice_role وحده.
   - survey-templates.js مصدر وحيد للقالب والمدقق والرمز: بصمة v1 مجمَّدة، ولكل إصدار فرع مطابق بالـSQL.
   - محدِّد المحاولات الفاشلة لكل عنوان (20 فشلًا/10 دقائق ← 429)، والنجاح لا يُحتسب.
   (الذرّية تحت التزامن فُحصت يدويًا على PostgreSQL 16 حقيقي: 20 طلبًا متزامنًا على تذكرة واحدة ← رد واحد.)
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const crypto = require('node:crypto');
const vm = require('node:vm');
const S = require('../api/s.js');
const T = require('../survey-templates.js');

/* إجابة صالحة كاملة للقالب v1 (مفاتيح بمعرّفات الأسئلة لا بالموضع) */
const OK = Object.freeze({ q1: 5, q2: 4, q3: 4, q4: true, q5: false, q6: 2, q7: 5 });
const okWith = extra => Object.assign({}, OK, extra);
const without = k => { const o = Object.assign({}, OK); delete o[k]; return o; };

test('validateAnswers: الصالح يُقبل بكل الأنواع، والمفاتيح الزائدة تُهمل، والنص يُقص ويُنظَّف ويُحذف إن فرغ', () => {
  const v = S.validateAnswers(okWith({ q8: '  شرح ممتاز  ', q9: 'المزيد من الأمثلة', student_id: 'x', name: 'أحمد', invite_id: 'i', q10: 1, ratings: [1] }), 'v1');
  assert.deepEqual(v, { ok: true, answers: okWith({ q8: 'شرح ممتاز', q9: 'المزيد من الأمثلة' }) });
  assert.deepEqual(Object.keys(v.answers).sort(), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'], 'لا مفتاح زائد يمر للقاعدة');
  assert.deepEqual(S.validateAnswers(OK, 'v1'), { ok: true, answers: OK }, 'النصوص اختيارية');
  assert.deepEqual(S.validateAnswers(okWith({ q8: '   ', q9: null }), 'v1'), { ok: true, answers: OK }, 'نص فارغ لا يُخزَّن مفتاحه');
  assert.deepEqual(S.validateAnswers(okWith({ q4: false, q5: true, q6: 0 }), 'v1').answers.q6, 0, 'الفهرس صفر صالح');
  assert.equal(S.validateAnswers(okWith({ q6: 3 }), 'v1').ok, true, 'آخر خيار صالح');
  const long = S.validateAnswers(okWith({ q8: 'ع'.repeat(500), q9: 'ب'.repeat(301) }), 'v1');
  assert.equal(Array.from(long.answers.q8).length, S.TEXT_MAX, 'مقصوص إلى 300 محرف');
  assert.equal(Array.from(long.answers.q9).length, 300);
  const emoji = S.validateAnswers(okWith({ q9: '😀'.repeat(400) }), 'v1');
  assert.equal(Array.from(emoji.answers.q9).length, 300, 'القص بالمحارف الفعلية لا بوحدات UTF-16');
  const ctl = S.validateAnswers(okWith({ q8: 'a\u0000b\u0007c\r\nd\uD800' }), 'v1');
  assert.equal(ctl.answers.q8, 'abc\nd�', 'محارف التحكم وأنصاف الأزواج لا تصل للقاعدة (jsonb يرفضها)');
});

test('validateAnswers: الإلزامي المفقود والنوع الخاطئ والمدى الخاطئ تُرفض بلا تحويل', () => {
  const bad = [
    [without('q1'), 'تقييم مفقود'], [without('q4'), 'صح/خطأ مفقود'], [without('q6'), 'اختيار مفقود'], [without('q7'), 'التقييم العام مفقود'],
    [okWith({ q1: null }), 'تقييم null'], [okWith({ q4: null }), 'صح/خطأ null'],
    [okWith({ q1: 0 }), 'تقييم أقل من 1'], [okWith({ q2: 6 }), 'تقييم أكبر من 5'], [okWith({ q3: 2.5 }), 'تقييم كسر'],
    [okWith({ q1: '5' }), 'تقييم نص'], [okWith({ q7: true }), 'تقييم منطقي'], [okWith({ q1: NaN }), 'NaN'],
    [okWith({ q4: 'true' }), 'صح/خطأ نص'], [okWith({ q4: 1 }), 'صح/خطأ رقم'], [okWith({ q5: 0 }), 'صح/خطأ صفر'],
    [okWith({ q6: 4 }), 'اختيار خارج المدى'], [okWith({ q6: -1 }), 'اختيار سالب'], [okWith({ q6: 1.5 }), 'اختيار كسر'],
    [okWith({ q6: '2' }), 'اختيار نص'], [okWith({ q6: 'واتساب' }), 'اختيار بالاسم لا بالفهرس'], [okWith({ q6: true }), 'اختيار منطقي'],
    [okWith({ q8: 5 }), 'نص رقم'], [okWith({ q9: { x: 1 } }), 'نص كائن'], [okWith({ q8: ['a'] }), 'نص مصفوفة'],
    [{}, 'فارغ'], [[1, 2, 3], 'مصفوفة لا كائن'], [null, 'null'], ['x', 'نص'],
    [{ ratings: [5, 4, 4, 5, 5, 5], comment: 'x' }, 'الشكل القديم بالمصفوفة'],
  ];
  for(const [b, why] of bad) assert.deepEqual(S.validateAnswers(b, 'v1'), { ok: false }, why);
  assert.deepEqual(S.validateAnswers(OK, 'v9'), { ok: false }, 'قالب مجهول');
  assert.deepEqual(S.validateAnswers(OK, '__proto__'), { ok: false }, 'لا مفاتيح موروثة');
  const inherited = Object.create({ q1: 5 }); Object.assign(inherited, without('q1'));
  assert.deepEqual(S.validateAnswers(inherited, 'v1'), { ok: false }, 'الإجابة من prototype لا تُحتسب');
});

test('SURVEY_TEMPLATES.v1: الأسئلة التسعة بترتيبها وأنواعها، JSON صرف، مجمّد', () => {
  const t = S.SURVEY_TEMPLATES.v1;
  assert.equal(S.SURVEY_TEMPLATE_V1, t);
  assert.deepEqual(t.questions.map(q => [q.id, q.type, q.required]), [
    ['q1', 'rating', true], ['q2', 'rating', true], ['q3', 'rating', true], ['q4', 'truefalse', true], ['q5', 'truefalse', true],
    ['q6', 'choice', true], ['q7', 'rating', true], ['q8', 'text', false], ['q9', 'text', false]]);
  assert.deepEqual(t.questions.map(q => q.label), ['وضوح شرح المعلم للدرس', 'أسلوب تعامل المعلم مع الطالب', 'متابعة المعلم لمستوى الطالب',
    'يتواصل المعلم مع الطالب أو ولي أمره عند الحاجة', 'الواجبات مناسبة وتفيد الطالب', 'أفضل وسيلة للتواصل مع المعلم', 'رضاكم العام عن المعلم',
    'ما الذي أعجبكم؟', 'ما اقتراحكم للتحسين؟']);
  assert.deepEqual(t.questions[5].options, ['واتساب', 'اتصال هاتفي', 'لقاء في المدرسة', 'رسالة من المدرسة']);
  assert.ok(t.questions.every(q => (q.type === 'choice') === Array.isArray(q.options)), 'الخيارات للاختيار فقط');
  assert.ok(t.questions.every(q => S.QUESTION_TYPES.includes(q.type)));
  assert.equal(t.scale.length, 5);
  assert.equal(t.textMax, 300);
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t, 'قابل للتحويل لـJSON بلا فقد');
  assert.ok(Object.isFrozen(S.SURVEY_TEMPLATES) && Object.isFrozen(t.questions) && Object.isFrozen(t.questions[5].options), 'لا تعديل عرضي للقالب');
});

/* ---------- survey-templates.js: المصدر الوحيد ---------- */
function canon(v){
  if(Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if(v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const V1_SHA256 = 'ee0c2289ee6ef19ce79724b0cbc9cb968ae531b4c4bf23d05fd6c476f35e6359';

test('بصمة v1 مجمَّدة: أي تغيير على أسئلته أو خياراته أو نصوصه يفشل هنا', () => {
  const got = crypto.createHash('sha256').update(canon(T.SURVEY_TEMPLATES.v1)).digest('hex');
  assert.equal(got, V1_SHA256,
    'SURVEY_TEMPLATES.v1 مجمَّد بعد الإطلاق: ردود محفوظة تعتمد على معنى كل معرّف وترتيب كل خيار. '
    + 'لا تعدّله؛ أضف إصدارًا جديدًا v2 بجانبه (مع فرعه في submit_survey وقيمته في قيد survey_campaigns.template). '
    + 'حدِّث هذه البصمة فقط إن كان v1 لم يُطلق بعد لأي مستخدم.');
});

test('survey-templates.js: الصادرات بالضبط، وapi/s.js يستعمل قالبه ومدققه هو لا نسخة', () => {
  assert.deepEqual(Object.keys(T).sort(), ['SURVEY_CODE_LENGTH', 'SURVEY_CODE_RE', 'SURVEY_TEMPLATES', 'surveyNewCode', 'surveyValidateAnswers']);
  assert.equal(S.SURVEY_TEMPLATES, T.SURVEY_TEMPLATES, 'الكائن نفسه لا نسخة');
  assert.equal(S.CODE_RE, T.SURVEY_CODE_RE);
  const src = fs.readFileSync(path.join(root, 'api/s.js'), 'utf8');
  assert.match(src, /require\('\.\.\/survey-templates\.js'\)/, 'مسار حرفي ثابت ليجمعه متتبّع Vercel');
  for(const q of T.SURVEY_TEMPLATES.v1.questions) assert.ok(!src.includes(q.label), 'لا نسخة من نص السؤال في api/s.js: ' + q.label);
  assert.doesNotMatch(src, /Number\.isInteger|function cleanText/, 'لا مدقق مكرر في api/s.js');
});

test('survey-templates.js يعمل كسكربت متصفح عادي: أسماؤه الخمسة فقط على globalThis، بلا أسماء عامة أخرى', () => {
  const src = fs.readFileSync(path.join(root, 'survey-templates.js'), 'utf8');
  const ctx = vm.createContext({ crypto: { getRandomValues: a => crypto.webcrypto.getRandomValues(a) } });
  const before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(src, ctx);
  const added = Object.getOwnPropertyNames(ctx).filter(k => !before.has(k)).sort();
  assert.deepEqual(added, ['SURVEY_CODE_LENGTH', 'SURVEY_CODE_RE', 'SURVEY_TEMPLATES', 'surveyNewCode', 'surveyValidateAnswers']);
  assert.doesNotMatch(src, /^(const|let|var|function|class)\s/m, 'كل شيء داخل IIFE: لا تصادم عند دمج سكربتات index.html');
  assert.doesNotMatch(src, /\bimport\b|\bexport\b|\(\?<[=!]/, 'بلا وحدات ES ولا lookbehind (متصفحات iOS القديمة)');
  assert.equal(vm.runInContext('surveyValidateAnswers("v1", {q1:5,q2:5,q3:5,q4:true,q5:true,q6:0,q7:5}).ok', ctx), true);
  assert.match(vm.runInContext('surveyNewCode()', ctx), /^[a-z2-9]{10}$/);
  /* ودمجه مع سكربتات أخرى بنفس السياق (كما يفعل load-app) لا يتصادم مع const بنفس الاسم الداخلي */
  const ctx2 = vm.createContext({ crypto: ctx.crypto });
  vm.runInContext('const deepFreeze = 1; const CODE_ALPHABET = 2; function cleanText(){ return 3; }\n' + src, ctx2);
  assert.equal(vm.runInContext('cleanText()', ctx2), 3, 'لا يكتب فوق دوال التطبيق');
});

test('surveyValidateAnswers: value بالمفاتيح المعروفة فقط، وerror نص قصير يحدد السبب', () => {
  const ok = T.surveyValidateAnswers('v1', okWith({ q8: '  نص  ', extra: 1 }));
  assert.deepEqual(ok, { ok: true, value: okWith({ q8: 'نص' }) });
  const cases = [
    [['v9', OK], 'unknown_template'], [['__proto__', OK], 'unknown_template'], [[undefined, OK], 'unknown_template'],
    [['v1', null], 'not_object'], [['v1', [1]], 'not_object'],
    [['v1', without('q2')], 'missing:q2'], [['v1', okWith({ q4: 'true' })], 'bad_type:q4'],
    [['v1', okWith({ q1: 6 })], 'out_of_range:q1'], [['v1', okWith({ q6: 4 })], 'out_of_range:q6'],
    [['v1', okWith({ q6: 1.5 })], 'bad_type:q6'], [['v1', okWith({ q9: 3 })], 'bad_type:q9'],
  ];
  for(const [args, err] of cases){
    const r = T.surveyValidateAnswers(...args);
    assert.equal(r.ok, false, err); assert.equal(r.error, err); assert.equal(r.value, undefined);
  }
});

test('surveyNewCode: 10 أحرف من الأبجدية بلا الملتبسة، وبلا انحياز (البايتات ≥248 تُرفض)', () => {
  assert.equal(T.SURVEY_CODE_LENGTH, 10);
  const seen = new Set();
  for(let i = 0; i < 300; i++){ const c = T.surveyNewCode(); assert.match(c, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/); seen.add(c); }
  assert.equal(seen.size, 300, 'بلا تكرار');
  const real = globalThis.crypto.getRandomValues;
  let n = 0;
  try {
    /* أول دفعة كلها ≥248 (يجب رفضها كلها)، ثم بايتات 0..30 بالترتيب */
    globalThis.crypto.getRandomValues = a => { n++; for(let i = 0; i < a.length; i++) a[i] = n === 1 ? 248 + (i % 8) : i % 31; return a; };
    assert.equal(T.surveyNewCode(), 'abcdefghjk', 'البايتات المرفوضة لا تُستعمل');
    assert.equal(n, 2);
  } finally { globalThis.crypto.getRandomValues = real; }
  assert.ok(T.SURVEY_CODE_RE.test('abcdefghjk') && T.SURVEY_CODE_RE.test('abcdefghjkmnpq'), '10 و14');
  assert.ok(!T.SURVEY_CODE_RE.test('abcdefg') && !T.SURVEY_CODE_RE.test('abcdefghj0') && !T.SURVEY_CODE_RE.test('a'.repeat(33)));
});

/* استخراج فروع القوالب من submit_survey */
function sqlSpecs(){
  const sql = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
  const i = sql.indexOf('create or replace function public.submit_survey');
  const fn = sql.slice(i, sql.indexOf('$fn$;', i));
  const out = {};
  for(const m of fn.matchAll(/when '([^']+)' then '(\[[^']*\])'::jsonb/g)) out[m[1]] = JSON.parse(m[2]);
  return { sql, fn, out };
}
const jsSpec = tpl => tpl.questions.map(q => q.type === 'choice' ? { id: q.id, type: q.type, n: q.options.length } : { id: q.id, type: q.type });

test('كل إصدار بـSURVEY_TEMPLATES له فرع مطابق بـsubmit_survey (معرّفات/أنواع/عدد خيارات) وقيمته بقيد الحملة، والعكس', () => {
  const { sql, fn, out } = sqlSpecs();
  const keys = Object.keys(T.SURVEY_TEMPLATES).sort();
  assert.deepEqual(Object.keys(out).sort(), keys, 'فرع SQL لكل إصدار ولا فرع بلا إصدار');
  for(const k of keys) assert.deepEqual(out[k], jsSpec(T.SURVEY_TEMPLATES[k]), 'مواصفة ' + k + ' متطابقة');
  const chk = sql.match(/template text not null default 'v1' check \(template in \(([^)]*)\)\)/);
  assert.ok(chk, 'قيد قالب الحملة');
  assert.deepEqual(chk[1].split(',').map(x => x.trim().replace(/'/g, '')).sort(), keys, 'القيد يقبل الإصدارات المعرَّفة فقط');
  for(const k of keys){
    const t = T.SURVEY_TEMPLATES[k];
    assert.ok(t.questions.every(q => q.type !== 'text' || !q.required), 'النص اختياري بالـSQL دائمًا: ' + k);
    assert.ok(t.questions.every(q => q.type === 'text' || q.required), 'غير النصي إلزامي بالـSQL دائمًا: ' + k);
    assert.equal(t.textMax, 300, 'سقف النص بالـSQL 300');
  }
  assert.match(fn, /char_length\(v_s\) > 300/);
  /* إصدار مجهول: المدقق والدالة يرفضانه */
  assert.equal(T.surveyValidateAnswers('v999', OK).ok, false);
  assert.match(fn, /else null end;\s*if v_spec is null then return false; end if;/, 'الدالة ترجع false لإصدار بلا فرع');
});

/* ---------- قاعدة وهمية ---------- */
function fakeDb(o){
  o = o || {};
  const future = new Date(Date.now() + 86400000).toISOString();
  const db = {
    survey_invites: [
      { code: 'abcdefghjkmnpq', campaign_id: 'c1', answered_on: null },
      { code: 'usedusedusedus', campaign_id: 'c1', answered_on: '2026-11-01' },
      { code: 'expiredexpired', campaign_id: 'c2', answered_on: null },
      { code: 'closedclosedcl', campaign_id: 'c3', answered_on: null },
    ],
    survey_campaigns: [
      { id: 'c1', status: 'open', closes_at: future, template: 'v1' },
      { id: 'c2', status: 'open', closes_at: new Date(Date.now() - 1000).toISOString(), template: 'v1' },
      { id: 'c3', status: 'closed', closes_at: future, template: 'v1' },
    ],
  };
  const calls = [];
  const client = {
    from(t){ const f = []; let cols = ''; const api = {
      select(c){ cols = c; return api; }, eq(c, v){ f.push([c, v]); return api; },
      maybeSingle: async () => { calls.push({ t, cols, f: f.slice() }); if(o.dbError) return { data: null, error: { message: 'x' } };
        return { data: (db[t] || []).find(r => f.every(([c, v]) => r[c] === v)) || null, error: null }; } };
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

test('resolveSurveyCode: الصالح المفتوح فقط، والخاطئ والمنتهي والمستخدَم والمغلق بالرد نفسه بلا أي معرّف', async () => {
  const { client, calls } = fakeDb();
  assert.deepEqual(await S.resolveSurveyCode('abcdefghjkmnpq', client), { ok: true, template: 'v1' }, 'لا يُرجع معرّف حملة ولا طالب');
  for(const c of ['usedusedusedus', 'expiredexpired', 'closedclosedcl', 'mmmmmmmmmmmmmm'])
    assert.deepEqual(await S.resolveSurveyCode(c, client), { ok: false }, c);
  const before = calls.length;
  for(const bad of ['', 'ABCDEFGHJKMNPQ', 'abc', "a' or '1'='1aaaaa", '../../etc/passwd', null, undefined, 'a'.repeat(40), ['abcdefghjkmnpq'], 'abcdefghjkmnp1'])
    assert.deepEqual(await S.resolveSurveyCode(bad, client), { ok: false }, 'يُرفض قبل أي استعلام: ' + String(bad));
  assert.equal(calls.length, before, 'الشكل الخاطئ لا يصل للقاعدة');
  const inv = calls.filter(c => c.t === 'survey_invites');
  assert.ok(inv.every(c => c.f.length === 1 && c.f[0][0] === 'code'), 'التذكرة تُقرأ بالرمز وحده');
  assert.ok(calls.every(c => !/student|name|phone/.test(c.cols || '')), 'لا يُقرأ أي حقل يخص الطالب');
});

/* ---------- المعالج ---------- */
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

test('GET: الرابط الصالح يعرض النموذج المبهم بـnonce؛ والخاطئ/المنتهي/المستخدَم/المغلق بصفحة واحدة متطابقة', async () => {
  const { h } = handlerWith();
  const ok = await call(h, 'GET', 'abcdefghjkmnpq');
  assert.equal(ok.statusCode, 200);
  assertPrivateHeaders(ok);
  const nonce = ok.headers['content-security-policy'].match(/'nonce-([^']+)'/)[1];
  assert.match(ok.body, new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}">`), 'السكربت بالـnonce نفسه');
  assert.doesNotMatch(ok.body, /<script(?![^>]*nonce=)/, 'لا سكربت بلا nonce');
  assert.doesNotMatch(ok.body, /<script[^>]+src=/, 'لا سكربتات خارجية');
  assert.doesNotMatch(ok.body, /\sstyle=/, 'لا style مضمّن (CSP يمنعه)');
  assert.match(ok.body, /<meta name="robots" content="noindex/);
  assert.match(ok.body, /ردّك لا يُربط باسمك/, 'العبارة الصادقة بنص الصفحة');
  assert.doesNotMatch(ok.body, /مجهول/, 'لا وعد بمجهولية مطلقة');
  assert.doesNotMatch(ok.body, /abcdefghjkmnpq/, 'الرمز لا يُطبع بالصفحة');
  assert.doesNotMatch(ok.body, /student|guardian|phone|full_name|c1/i, 'لا معرّفات ولا بيانات طالب');
  for(const q of S.SURVEY_TEMPLATES.v1.questions) assert.ok(ok.body.includes(q.label), q.label);
  assert.equal((ok.body.match(/<fieldset data-q=/g) || []).length, 9, 'سؤال لكل fieldset');
  assert.equal((ok.body.match(/<input type="radio" name="q1"/g) || []).length, 5, 'التقييم 5 أزرار');
  assert.match(ok.body, /name="q4" value="true"><span><b>صح<\/b>/); assert.match(ok.body, /name="q4" value="false"><span><b>خطأ<\/b>/);
  assert.equal((ok.body.match(/<input type="radio" name="q6"/g) || []).length, 4, 'خيارات الاختيار');
  assert.match(ok.body, /<textarea name="q8" maxlength="300"/); assert.match(ok.body, /id="c-q9"[^>]*>0 \/ 300</, 'عدّاد الحروف');
  assert.doesNotMatch(ok.body, /alert\(/, 'لا alert');
  assert.match(ok.body, /classList\.add\('miss'\)/, 'الإلزامي يُنبَّه عليه بالصفحة');
  assert.match(ok.body, /b\.disabled=true/, 'الزر يتعطّل أثناء الطلب');
  assert.match(ok.body, /شكرًا لك/, 'حالة الشكر');
  assert.match(ok.body, /لولي الأمر أو الطالب/, 'صياغة محايدة للمستلمَين');
  assert.match(ok.body, /<span id="pgt"[^>]*>0 من 7 أسئلة مطلوبة<\/span>/, 'شريط تقدّم بعدد الأسئلة المطلوبة');
  assert.match(ok.body, /<progress id="pgb" max="7" value="0"/);
  assert.match(ok.body, /\.prog\{position:sticky;top:0/, 'الشريط ثابت أعلى الصفحة');
  assert.equal((ok.body.match(/data-req="1"/g) || []).length, 7); assert.equal((ok.body.match(/data-req="0"/g) || []).length, 2);
  assert.match(ok.body, /prefers-reduced-motion: reduce/, 'يحترم تقليل الحركة');
  assert.match(ok.body, /behavior:calm\?'auto':'smooth'/);
  assert.match(ok.body, /b\.classList\.toggle\('ready',all\)/, 'إبراز الإرسال عند اكتمال المطلوب');
  assert.match(ok.body, /button\.ready\{/);

  const gone = [];
  for(const c of ['usedusedusedus', 'expiredexpired', 'closedclosedcl', 'mmmmmmmmmmmmmm', 'mmmmmmmmmm', 'BAD!', undefined]){
    const r = await call(h, 'GET', c);
    assertPrivateHeaders(r);
    gone.push({ s: r.statusCode, b: r.body.replace(/nonce="[^"]+"/g, '') });
  }
  assert.ok(gone.every(g => g.s === 404 && g.b === gone[0].b), 'الصفحة نفسها حرفيًا لكل الأسباب');
});

test('POST: رد واحد فقط، والرموز الخاطئة/المنتهية/المستخدمة/المغلقة بالرد الموحَّد نفسه، والصيغة الخاطئة لا تصل للدالة', async () => {
  const { h, f } = handlerWith();
  const first = await call(h, 'POST', 'abcdefghjkmnpq', okWith({ q8: ' جيد ', student_id: 'S1' }));
  assert.equal(first.statusCode, 200);
  assert.deepEqual(JSON.parse(first.body), { ok: true });
  assertPrivateHeaders(first);
  const rpc = f.calls.find(c => c.rpc);
  assert.equal(rpc.rpc, 'submit_survey');
  assert.deepEqual(rpc.args, { p_code: 'abcdefghjkmnpq', p_answers: okWith({ q8: 'جيد' }) }, 'الحقول الزائدة لا تُمرَّر');

  const uniform = [];
  for(const c of ['abcdefghjkmnpq' /* استُخدم للتو */, 'usedusedusedus', 'expiredexpired', 'closedclosedcl', 'mmmmmmmmmmmmmm', 'NOT-A-CODE']){
    const r = await call(h, 'POST', c, OK);
    uniform.push({ s: r.statusCode, b: r.body });
  }
  assert.ok(uniform.every(u => u.s === 404 && u.b === '{"ok":false}'), 'الرد نفسه حرفيًا: ' + JSON.stringify(uniform));
  assert.equal(f.calls.filter(c => c.rpc).length, 1, 'لا نداء للدالة لرمز غير صالح');

  const g = handlerWith();
  const bad = await call(g.h, 'POST', 'abcdefghjkmnpq', without('q6'));
  assert.equal(bad.statusCode, 400);
  assert.equal(g.f.calls.filter(c => c.rpc).length, 0, 'الصيغة الخاطئة لا تصل للدالة');
  assert.equal(g.f.db.survey_invites[0].answered_on, null, 'ولا تستهلك التذكرة');
});

test('POST: سباق (الدالة رجعت false) يُعامل كرمز مستخدَم؛ وخطأ القاعدة 503 قابل لإعادة المحاولة', async () => {
  const race = handlerWith({ rpcFalse: true });
  const r = await call(race.h, 'POST', 'abcdefghjkmnpq', OK);
  assert.equal(r.statusCode, 404); assert.equal(r.body, '{"ok":false}');
  const down = handlerWith({ rpcError: true });
  const d = await call(down.h, 'POST', 'abcdefghjkmnpq', OK);
  assert.equal(d.statusCode, 503);
  const dbDown = handlerWith({ dbError: true });
  assert.equal((await call(dbDown.h, 'POST', 'abcdefghjkmnpq', OK)).statusCode, 404, 'خطأ قراءة = غير موجود (لا يُكشف شيء)');
});

test('POST: سقف الحجم، وJSON فقط، وطرق أخرى مرفوضة، وبلا متغيرات بيئة لا شيء', async () => {
  const { h, f } = handlerWith();
  const big = await call(h, 'POST', 'abcdefghjkmnpq', okWith({ q8: 'x'.repeat(5000) }));
  assert.equal(big.statusCode, 413);
  assert.equal((await call(h, 'POST', 'abcdefghjkmnpq', OK, { 'content-length': '999999' })).statusCode, 413);
  assert.equal((await call(h, 'POST', 'abcdefghjkmnpq', 'x'.repeat(5000))).statusCode, 413, 'نص خام كبير');
  assert.equal((await call(h, 'POST', 'abcdefghjkmnpq', '{bad json')).statusCode, 400);
  assert.equal((await call(h, 'POST', 'abcdefghjkmnpq', 'ratings=1', { 'content-type': 'application/x-www-form-urlencoded' })).statusCode, 415);
  const parsed = await call(h, 'POST', 'abcdefghjkmnpq', JSON.stringify(OK));
  assert.equal(parsed.statusCode, 200, 'الجسم النصي يُحلَّل');
  for(const m of ['PUT', 'DELETE', 'PATCH']) assert.equal((await call(h, m, 'abcdefghjkmnpq')).statusCode, 405);
  assert.equal(f.calls.filter(c => c.rpc).length, 1);
  const none = S.createHandler({ url: '', key: '', createClient: () => { throw new Error('لا يُنشأ عميل'); } });
  assert.equal((await call(none, 'GET', 'abcdefghjkmnpq')).statusCode, 503);
});

test('الملف: الحزمة تُحمَّل داخل المعالج فقط، وrewrite لـ/s/ مع إبقاء /r/', () => {
  const src = fs.readFileSync(path.join(root, 'api/s.js'), 'utf8');
  const top = src.slice(0, src.indexOf('function createHandler'));
  assert.doesNotMatch(top, /require\('@supabase\/supabase-js'\)/);
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(vj.rewrites.some(r => r.source === '/s/:code' && r.destination === '/api/s?c=:code'));
  assert.ok(vj.rewrites.some(r => r.source === '/r/:code' && r.destination === '/api/r?c=:code'));
});

/* ---------- حرّاس SQL ---------- */
const SQL = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
function tableBody(name){
  const i = SQL.indexOf(`create table if not exists public.${name} (`);
  assert.ok(i > -1, 'الجدول موجود: ' + name);
  return SQL.slice(i, SQL.indexOf('\n);', i));
}
function statements(re){ return SQL.split(';').filter(s => re.test(s)); }

test('SQL: survey_responses بلا student_id ولا invite_id ولا وقت، والتذاكر بتاريخ بلا وقت وفريدة لكل طالب', () => {
  const resp = tableBody('survey_responses');
  assert.doesNotMatch(resp, /student_id|invite_id|student|invite/i, 'الرد لا يشير لطالب ولا لتذكرة');
  assert.match(resp, /created_on date not null/);
  assert.doesNotMatch(resp, /timestamptz|created_at/, 'لا وقت بالرد');
  assert.doesNotMatch(resp, /bigserial|serial|identity/i, 'معرّف عشوائي لا تسلسلي (التسلسل يكشف الترتيب)');
  assert.match(resp, /octet_length\(answers::text\) <= \d+/, 'سقف حجم الإجابات');
  const inv = tableBody('survey_invites');
  assert.match(inv, /answered_on date,/);
  assert.match(inv, /\n  unique \(campaign_id, student_id, recipient\),/, 'تذكرة لكل مستلم (ولي أمر/طالب) لا لكل طالب');
  assert.doesNotMatch(inv, /unique \(campaign_id, student_id\)/, 'القيد القديم يمنع التذكرة الثانية');
  assert.match(inv, /recipient text not null default 'guardian' check \(recipient in \('guardian', 'student'\)\)/);
  assert.match(inv, /code ~ '\^\[a-z2-9\]\{8,32\}\$'/, 'رموز 10 أحرف مقبولة');
  assert.match(SQL, /p_code !~ '\^\[a-z2-9\]\{8,32\}\$'/, 'والدالة بنفس النمط');
  assert.match(inv, /foreign key \(student_id, teacher_id\) references public\.classroom_students\(id, teacher_id\)[^\n]*on delete cascade/, 'لا تذكرة لطالب معلم آخر');
  assert.doesNotMatch(inv, /answers|rating|comment|q1/, 'لا إجابات بالتذكرة');
  assert.match(SQL, /create unique index if not exists survey_invites_code_key on public\.survey_invites\(code\) where code is not null/);
});

test('SQL: كل سياسات survey_* للمعلم وحده، بلا مسؤول، وبلا أي سياسة كتابة على الردود', () => {
  const pol = statements(/create policy[^]*on public\.survey_/);
  assert.equal(pol.length, 3);
  for(const p of pol){
    assert.doesNotMatch(p, /admin/i, 'لا سياسة مسؤول');
    assert.match(p, /auth\.uid\(\) = teacher_id/);
  }
  const respPol = pol.filter(p => /on public\.survey_responses/.test(p));
  assert.equal(respPol.length, 1);
  assert.match(respPol[0], /for select/, 'قراءة فقط');
  assert.doesNotMatch(respPol[0], /with check/);
  assert.equal(statements(/create policy[^]*on public\.survey_responses[^]*for (insert|update|delete|all)/).length, 0, 'لا سياسة إدراج');
  assert.match(SQL, /revoke insert, update, delete on public\.survey_responses from anon, authenticated/);
  for(const t of ['survey_campaigns', 'survey_invites', 'survey_responses'])
    assert.match(SQL, new RegExp(`alter table public\\.${t} enable row level security`));
});

test('SQL: submit_survey لـservice_role وحده، security definer بمسار فارغ، وذرّية (تحديث مشروط ثم إدراج)', () => {
  assert.match(SQL, /revoke execute on function public\.submit_survey\(text, jsonb\) from public, anon, authenticated;/);
  assert.match(SQL, /grant execute on function public\.submit_survey\(text, jsonb\) to service_role;/);
  assert.equal(statements(/grant execute on function public\.submit_survey[^]*to [^;]*(anon|authenticated|public)/).length, 0);
  const i = SQL.indexOf('create or replace function public.submit_survey');
  const fn = SQL.slice(i, SQL.indexOf('$fn$;', i));
  assert.match(fn, /security definer set search_path = ''/);
  const upd = fn.indexOf('update public.survey_invites');
  const ins = fn.indexOf('insert into public.survey_responses');
  assert.ok(upd > -1 && ins > upd, 'التحديث قبل الإدراج');
  const updStmt = fn.slice(upd, fn.indexOf(';', upd));
  assert.match(updStmt, /i\.answered_on is null/, 'لا يُستهلك إلا غير المستخدَم');
  assert.match(updStmt, /c\.status = 'open' and c\.closes_at > now\(\)/, 'الحملة مفتوحة ولم تنتهِ');
  assert.match(updStmt, /set answered_on = current_date/, 'تاريخ بلا وقت');
  assert.match(fn.slice(upd, ins), /if not found then return false; end if;/, 'لا إدراج إن لم يُحدَّث صف');
  const insStmt = fn.slice(ins, fn.indexOf(';', ins));
  assert.doesNotMatch(insStmt, /student|invite|p_answers/, 'الرد يُبنى من الحقول المعروفة فقط، بلا مرجع للطالب');
  assert.match(fn, /v_v::text !~ '\^\[1-5\]\$'/, 'تحقق التقييم 1..5 بالدالة أيضًا');
  assert.match(fn, /jsonb_typeof\(v_v\) <> 'boolean'/, 'صح/خطأ منطقي فقط');
  assert.match(fn, /\(v_v::text\)::int >= \(v_q->>'n'\)::int/, 'فهرس الاختيار ضمن الخيارات');
  assert.match(fn, /if v_v is null then return false; end if;/, 'الإلزامي المفقود يُرفض');
  assert.match(fn, /values \(v_campaign, v_teacher, v_out, current_date\)/, 'يُخزَّن الكائن المعاد بناؤه لا المُرسَل');
  assert.match(fn, /char_length\(v_s\) > 300/, 'سقف النص بالدالة أيضًا');
});

/* ---------- محدِّد المحاولات الفاشلة ---------- */
function clock(){ const c = { t: 1e12, now: () => c.t }; return c; }

test('المحدِّد: 20 فشلًا من عنوان واحد ← 429 (GET صفحة ودية، POST JSON) مع Retry-After، حتى للرمز الصحيح', async () => {
  const c = clock();
  const { h, f } = handlerWith({ limiter: S.createFailureLimiter({ now: c.now }) });
  for(let i = 0; i < 20; i++){
    const r = await call(h, i % 2 ? 'POST' : 'GET', i % 3 ? 'mmmmmmmmmmmmmm' : 'BAD!', OK);
    assert.equal(r.statusCode, 404, 'محاولة ' + (i + 1) + ' ما تزال مسموحة');
  }
  const g = await call(h, 'GET', 'abcdefghjkmnpq');
  assert.equal(g.statusCode, 429, 'بعد 20 فشلًا: محظور حتى برمز صحيح (لا يكتشف المخمِّن إصابة)');
  assert.equal(g.headers['retry-after'], '600');
  assert.match(g.body, /محاولات كثيرة/); assertPrivateHeaders(g);
  assert.doesNotMatch(g.body, /<script/);
  const p = await call(h, 'POST', 'abcdefghjkmnpq', OK);
  assert.equal(p.statusCode, 429); assert.equal(p.body, '{"ok":false}');
  assert.equal(f.calls.filter(x => x.rpc).length, 0, 'لا وصول للدالة أثناء الحظر');
  assert.equal((await call(h, 'GET', 'abcdefghjkmnpq', null, null, '10.9.9.9')).statusCode, 200, 'عنوان آخر غير متأثر');
  c.t += 5 * 60 * 1000;
  assert.equal((await call(h, 'GET', 'abcdefghjkmnpq')).headers['retry-after'], '300', 'المتبقي يتناقص');
  c.t += 5 * 60 * 1000 + 1;
  assert.equal((await call(h, 'GET', 'abcdefghjkmnpq')).statusCode, 200, 'بعد 10 دقائق يُرفع الحظر');
});

test('المحدِّد: النجاح لا يُحتسب، والفشل يُحتسب للرمز المستخدَم والمنتهي والمغلق والمشوَّه وسباق الدالة', async () => {
  const { h, limiter } = handlerWith();
  for(let i = 0; i < 40; i++) assert.equal((await call(h, 'GET', 'abcdefghjkmnpq')).statusCode, 200);
  assert.equal(limiter.blockedFor('10.0.0.1'), 0, '40 فتحًا ناجحًا لا تحظر');
  assert.equal((await call(h, 'POST', 'abcdefghjkmnpq', without('q1'))).statusCode, 400, 'إجابة ناقصة ليست محاولة رمز');
  assert.equal((await call(h, 'POST', 'abcdefghjkmnpq', '{bad')).statusCode, 400);
  assert.equal((await call(h, 'POST', 'abcdefghjkmnpq', OK)).statusCode, 200);
  assert.equal(limiter.size(), 0, 'لا شيء مسجَّل بعد النجاحات وأخطاء الجسم');
  for(const code of ['usedusedusedus', 'expiredexpired', 'closedclosedcl', 'NOPE', undefined, 'abcdefghjkmnpq' /* صار مستخدَمًا */]) await call(h, 'GET', code);
  const race = handlerWith({ rpcFalse: true });
  await call(race.h, 'POST', 'abcdefghjkmnpq', OK);
  assert.equal(race.limiter.size(), 1, 'false من الدالة = فشل');
  assert.equal(limiter.size(), 1);
  for(let i = 0; i < 14; i++) await call(h, 'GET', 'NOPE');
  assert.equal((await call(h, 'GET', 'abcdefghjkmnpq')).statusCode, 429, '6 + 14 = 20 فشلًا');
});

test('المحدِّد: عنوان العميل أول قفزة بـx-forwarded-for وإلا المقبس، والخريطة محدودة الحجم، وبلا مؤقتات', () => {
  assert.equal(S.clientIp({ headers: { 'x-forwarded-for': ' 1.2.3.4 , 10.0.0.1' }, socket: { remoteAddress: '9.9.9.9' } }), '1.2.3.4');
  assert.equal(S.clientIp({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
  assert.equal(S.clientIp({ headers: {} }), 'unknown');
  assert.equal(S.clientIp({ headers: { 'x-forwarded-for': 'x'.repeat(500) } }).length, 64, 'مفتاح محدود الطول');
  const c = clock();
  const l = S.createFailureLimiter({ now: c.now, maxKeys: 100 });
  for(let i = 0; i < 1000; i++) l.fail('ip' + i);
  assert.ok(l.size() <= 100, 'لا نمو بلا حد: ' + l.size());
  c.t += S.LIMIT_WINDOW_MS + 1;
  l.fail('fresh');
  assert.equal(l.size(), 1, 'التنظيف الكسول يحذف المنتهي');
  const one = S.createFailureLimiter({ now: c.now });
  for(let i = 0; i < 500; i++) one.fail('same');
  assert.ok(one.blockedFor('same') > 0);
  const src = fs.readFileSync(path.join(root, 'api/s.js'), 'utf8').replace(/const SCRIPT = `[^`]*`;/, '');
  assert.doesNotMatch(src, /setInterval|setTimeout/, 'لا مؤقت يُبقي الدالة حية');
  assert.match(src, /Vercel WAF/, 'التعليق يذكر المكمّل الحقيقي وحدود المحدِّد');
  assert.equal(S.LIMIT_MAX_FAILURES, 20); assert.equal(S.LIMIT_WINDOW_MS, 600000);
});

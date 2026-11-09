'use strict';
/* ============================================================
   استبانة رضا المستفيدين — الخادم (api/s.js) وSQL (SURVEYS.md):
   - التحقق من الصيغة لكل نوع (تقييم 1..5، صح/خطأ منطقي، اختيار بفهرس، نص مقصوص ≤300)، الإلزامي، والمفاتيح الزائدة تُهمل.
   - الرمز الخاطئ والمنتهي والمستخدَم والمغلق: الرد نفسه تمامًا، والشكل الخاطئ لا يصل للقاعدة.
   - الصفحة مبهمة (لا بيانات طالب ولا رمز)، وبلا تخزين ولا فهرسة ولا Referer، وCSP بـnonce.
   - SQL: الردود بلا student_id/invite_id، بلا سياسة مسؤول، بلا سياسة إدراج، والدالة لـservice_role وحده.
   (الذرّية تحت التزامن فُحصت يدويًا على PostgreSQL 16 حقيقي: 20 طلبًا متزامنًا على تذكرة واحدة ← رد واحد.)
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const S = require('../api/s.js');

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
    'يتواصل المعلم مع ولي الأمر عند الحاجة', 'الواجبات مناسبة وتفيد الطالب', 'أفضل وسيلة للتواصل مع المعلم', 'رضاكم العام عن المعلم',
    'ما الذي أعجبكم؟', 'ما اقتراحكم للتحسين؟']);
  assert.deepEqual(t.questions[5].options, ['واتساب', 'اتصال هاتفي', 'لقاء في المدرسة', 'رسالة من المدرسة']);
  assert.ok(t.questions.every(q => (q.type === 'choice') === Array.isArray(q.options)), 'الخيارات للاختيار فقط');
  assert.ok(t.questions.every(q => S.QUESTION_TYPES.includes(q.type)));
  assert.equal(t.scale.length, 5);
  assert.equal(t.textMax, 300);
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t, 'قابل للتحويل لـJSON بلا فقد');
  assert.ok(Object.isFrozen(S.SURVEY_TEMPLATES) && Object.isFrozen(t.questions) && Object.isFrozen(t.questions[5].options), 'لا تعديل عرضي للقالب');
});

test('SQL ↔ api/s.js: معرّفات أسئلة v1 وأنواعها وعدد خيارات الاختيار متطابقة، وسقف النص 300', () => {
  const sql = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
  const m = sql.match(/when 'v1' then '(\[[^']*\])'::jsonb/);
  assert.ok(m, 'مواصفة v1 داخل submit_survey');
  const spec = JSON.parse(m[1]);
  const fromJs = S.SURVEY_TEMPLATES.v1.questions.map(q => q.type === 'choice' ? { id: q.id, type: q.type, n: q.options.length } : { id: q.id, type: q.type });
  assert.deepEqual(spec, fromJs);
  assert.match(sql, /char_length\(v_s\) > 300/);
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
  const h = S.createHandler({ url: 'https://x.supabase.co', key: 'service', createClient: () => f.client });
  return { h, f };
}
async function call(h, method, code, body, headers){
  const res = fakeRes();
  await h({ method, query: { c: code }, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body }, res);
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

  const gone = [];
  for(const c of ['usedusedusedus', 'expiredexpired', 'closedclosedcl', 'mmmmmmmmmmmmmm', 'BAD!', undefined]){
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
  assert.match(inv, /unique \(campaign_id, student_id\)/);
  assert.match(inv, /code ~ '\^\[a-z2-9\]\{12,32\}\$'/);
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

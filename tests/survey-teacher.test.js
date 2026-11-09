'use strict';
/* ============================================================
   استبانة رضا المستفيدين — شاشة المعلم (app-44، التصميم: SURVEYS.md):
   - كل استعلام بتصفية المعلم (teacher_id)، ولا شيء يمرّ بلا فلترة.
   - المستفيد ولي الأمر أو الطالب: تذكرة لكل رقم (حتى تذكرتان للطالب)، وتطابق الرقمين = تذكرة واحدة،
     بلا تكرار، ويلتقط الطلاب الجدد والأرقام المضافة لاحقًا عند كل فتح. الرمز 10 أحرف.
   - التجميع بالمدقّق المشترك نفسه (survey-templates.js): غير الصالح يُعدّ ويُعلَن لا يُسقَط بصمت.
   - القالب من campaign.template: نسخة مجهولة تُعلَن صراحةً ولا تُعرض نتائج مضللة.
   - كل الردود تُقرأ بصفحات (لا سقف صامت).
   - السباق: الإغلاق أثناء التحميل لا يرسم ولا يكتب. نقرتان متزامنتان على «ابدأ» أو «واتساب» تُنفّذان مرة.
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const root = path.join(__dirname, '..');

function appWith(opts){
  opts = opts || {};
  const log = [];
  const db = { survey_campaigns: opts.campaigns || [], survey_invites: opts.invites || [], survey_responses: opts.responses || [] };
  let seq = 0;
  const sb = {
    from(table){
      const f = {}; let op = 'select', values = null, single = false, rng = null;
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; },
        range(a, b){ rng = [a, b]; return api; },
        eq(c, v){ f[c] = v; return api; }, is(c, v){ f[c] = null; return api; },
        insert(v){ op = 'insert'; values = v; return api; }, update(v){ op = 'update'; values = v; return api; },
        single(){ single = true; return api; },
        then(res, rej){
          log.push({ table, op, values, f: Object.assign({}, f), rng });
          const t = db[table];
          let data = null, error = null;
          if(op === 'select'){
            data = t.filter(r => Object.keys(f).every(k => !(k in r) || f[k] === null || r[k] === f[k]));
            if(rng) data = data.slice(rng[0], rng[1] + 1);
          }
          if(op === 'insert'){
            if(opts.insertError && opts.insertError(table)) error = opts.insertError(table);
            else { const arr = Array.isArray(values) ? values : [values]; arr.forEach(r => t.push(Object.assign({ id: table + (++seq), status: 'open', template: 'v1', closes_at: new Date(Date.now() + 864e5 * 14).toISOString(), sent_at: null, answered_on: null }, r))); data = single ? t[t.length - 1] : null; }
          }
          if(op === 'update'){ t.filter(r => r.id === f.id).forEach(r => Object.assign(r, values)); }
          return Promise.resolve({ data, error }).then(res, rej);
        }
      };
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
  };
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    showConfirm = async () => true;
    const els = {};
    window.__els = els;
    const mk = () => ({ style: {}, dataset: {}, innerHTML: '', setAttribute(){}, parentNode: null });
    document.getElementById = id => id === 'confirmModal' ? { style: { display: 'none' } } : (els[id] || null);
    document.createElement = () => mk();
    document.body = { appendChild(el){ els[el.id] = el; el.parentNode = document.body; els.svSheet = mk(); }, removeChild(el){ delete els[el.id]; delete els.svSheet; } };
    document.addEventListener = () => {}; document.removeEventListener = () => {};
    crmStudents = ${JSON.stringify(opts.students || [])};
    crmSections = [{ id: 'sec1', name: '3' }];
    crmCurrentTerm = () => ({ year: '2026/2027', semester: 1 });
    location = { origin: 'https://app.example' };
    let __n = 0; crypto = { getRandomValues: a => { __n++; for(let i = 0; i < a.length; i++) a[i] = (i * 7 + __n * 13) % 248; return a; } };`);
  return { app, log, db };
}

const FUTURE = () => new Date(Date.now() + 864e5).toISOString();
const STUDENTS = [
  { id: 'a', full_name: 'أحمد', section_id: 'sec1', is_active: true, guardian_phone: '966501234567', student_phone: '966551234567' },
  { id: 'b', full_name: 'بدر', section_id: 'sec1', is_active: true, guardian_phone: null, student_phone: '966551111111' },
  { id: 'c', full_name: 'جاسر', section_id: 'sec1', is_active: true, guardian_phone: null, student_phone: null },
  { id: 'd', full_name: 'دخيل', section_id: 'sec1', is_active: false, guardian_phone: '966502222222', student_phone: null },
  { id: 'e', full_name: 'عمر', section_id: 'other', is_active: true, guardian_phone: '966503333333', student_phone: null },
  { id: 'f', full_name: 'فهد', section_id: 'sec1', is_active: true, guardian_phone: '966505555555', student_phone: '966505555555' }
];
const GOOD = { q1: 5, q2: 4, q3: 3, q4: true, q5: false, q6: 1, q7: 5, q8: 'ممتاز', q9: 'أتمنى المزيد' };
const OPEN_CAMPAIGN = () => ({ id: 'c1', teacher_id: 'u1', section_id: 'sec1', status: 'open', template: 'v1', closes_at: FUTURE(), created_at: 'x' });
const J = v => JSON.parse(JSON.stringify(v));

/* ============ دوال صرفة ============ */

test('الجهات: ولي الأمر ثم الطالب، والرقم المتطابق تذكرة واحدة لولي الأمر، والفارغ لا شيء', () => {
  const { app } = appWith();
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[0])), [{ recipient: 'guardian', phone: '966501234567' }, { recipient: 'student', phone: '966551234567' }]);
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[1])), [{ recipient: 'student', phone: '966551111111' }]);
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[2])), []);
  assert.deepEqual(J(app.svRecipientsFor(STUDENTS[5])), [{ recipient: 'guardian', phone: '966505555555' }], 'الرقم نفسه: لا رابطان لجوال واحد');
  assert.deepEqual(J(app.svRecipientsFor(null)), []);
});

test('العدّادات والحالة: ردّ يغلب أُرسل، وأُرسل يغلب لم يُرسل، والحملة المنتهية أو المغلقة غير مفتوحة', () => {
  const { app } = appWith();
  const c = app.svCounts([{ sent_at: null, answered_on: null }, { sent_at: 'x', answered_on: null }, { sent_at: 'x', answered_on: '2026-11-01' }, { sent_at: null, answered_on: '2026-11-01' }]);
  assert.deepEqual({ total: c.total, answered: c.answered, sent: c.sent, unsent: c.unsent }, { total: 4, answered: 2, sent: 1, unsent: 1 });
  const future = new Date(Date.now() + 1000).toISOString(), past = new Date(Date.now() - 1000).toISOString();
  assert.equal(app.svCampaignOpen({ status: 'open', closes_at: future }), true);
  assert.equal(app.svCampaignOpen({ status: 'open', closes_at: past }), false);
  assert.equal(app.svCampaignOpen({ status: 'closed', closes_at: future }), false);
  assert.equal(app.svCampaignOpen(null), false);
});

test('رسالة واتساب: الرابط مبهم (رمز فقط) والاسم في النص وحده، وصياغة مختلفة للطالب ولولي الأمر وللتذكير', () => {
  const { app } = appWith();
  const m = app.svWaMessage('أحمد', 'abcdefghjk', 'https://app.example', false, 'guardian');
  assert.match(m, /https:\/\/app\.example\/s\/abcdefghjk\n/);
  assert.match(m, /تعليم الطالب أحمد/);
  const url = m.match(/https:\/\/\S+/)[0];
  assert.doesNotMatch(url, /أحمد|966/, 'لا اسم ولا رقم داخل الرابط نفسه');
  const s = app.svWaMessage('أحمد', 'abcdefghjk', 'https://app.example', false, 'student');
  assert.match(s, /في تعليمك/);
  assert.doesNotMatch(s, /تعليم الطالب أحمد/, 'الطالب يُخاطَب مباشرة');
  assert.match(app.svWaMessage('أحمد', 'abcdefghjk', 'https://app.example', true, 'guardian'), /تذكير/);
  assert.ok(m.match(/https:\/\/\S+/)[0].length <= 'https://app.example/s/'.length + 10, 'الرابط = النطاق + /s/ + 10 أحرف');
});

test('التحليل: متوسط التقييم، نسبة صح، توزيع الاختيار، النص يُخلط، وغير الصالح يُعدّ ولا يُحسب', () => {
  const { app } = appWith();
  const R = a => ({ answers: Object.assign({}, GOOD, a) });
  const rs = [R({}), R({ q1: 3, q7: 3, q4: false }), R({ q1: 4, q7: 4 }), { answers: { q1: 9 } }, { answers: null }];
  const an = app.svAnalyze(rs, 'v1', () => 0);
  assert.equal(an.ok, true);
  assert.equal(an.valid, 3);
  assert.equal(an.invalid, 2, 'اثنان غير صالحين يُعدّان لا يُخفَيان');
  const by = id => an.items.find(a => a.id === id);
  assert.equal(by('q1').avg, 4);
  assert.equal(by('q4').pct, 67);
  assert.equal(by('q6').counts[1].count, 3);
  assert.equal(by('q8').texts.length, 3);
  assert.equal(app.svWeakestRating(an.items.filter(a => a.id !== 'q7')).id, 'q3', 'q3 أضعف (3)');
});

test('قالب مجهول: لا تحليل ولا أرقام مضللة', () => {
  const { app } = appWith();
  const an = app.svAnalyze([{ answers: GOOD }], 'v99');
  assert.equal(an.ok, false);
  assert.equal(an.reason, 'unknown-template');
  assert.equal(an.items.length, 0);
});

test('النص يُخلط ترتيبه (لا يدلّ الترتيب على صاحب الرد)', () => {
  const { app } = appWith();
  const rs = ['1', '2', '3', '4', '5', '6'].map(t => ({ answers: Object.assign({}, GOOD, { q8: t }) }));
  const a1 = app.svAnalyze(rs, 'v1', () => 0).items.find(a => a.id === 'q8').texts.join('');
  assert.notEqual(a1, '123456', 'مع مولّد ثابت يتغيّر الترتيب فعلًا');
  assert.deepEqual(a1.split('').sort(), ['1', '2', '3', '4', '5', '6']);
});

/* ============ قاعدة البيانات: التصفية والتذاكر ============ */

test('كل استعلام بتصفية المعلم؛ التذاكر لكل رقم (حتى تذكرتان للطالب) بلا نشط/غير نشط خاطئ ولا شعبة أخرى، ورمز 10 أحرف', async () => {
  const { app, log, db } = appWith({ students: STUDENTS });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `svStart()`);
  assert.ok(log.length >= 3);
  log.forEach(l => {
    if(l.op === 'insert') (Array.isArray(l.values) ? l.values : [l.values]).forEach(v => assert.equal(v.teacher_id, 'u1', l.table + ' insert يحمل المعلم'));
    else assert.equal(l.f.teacher_id, 'u1', l.table + ' ' + l.op + ' بلا تصفية المعلم');
  });
  const pairs = db.survey_invites.map(i => i.student_id + ':' + i.recipient).sort();
  assert.deepEqual(pairs, ['a:guardian', 'a:student', 'b:student', 'f:guardian'], 'جاسر بلا رقم، ودخيل غير نشط، وعمر بشعبة أخرى، وفهد برقم واحد');
  db.survey_invites.forEach(i => assert.match(i.code, /^[a-z2-9]{10}$/));
  assert.equal(new Set(db.survey_invites.map(i => i.code)).size, db.survey_invites.length, 'رموز مختلفة');
});

test('إعادة الفتح تلتقط الطالب الجديد والرقم المضاف لاحقًا فقط بلا تكرار للقديم', async () => {
  const { app, db } = appWith({ students: STUDENTS.slice(1, 2) });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `svStart()`);
  assert.equal(db.survey_invites.length, 1);
  runInAppContext(app, `crmStudents[0].guardian_phone = '966504444444'; crmStudents.push({ id: 'n', full_name: 'جديد', section_id: 'sec1', is_active: true, guardian_phone: '966506666666', student_phone: null })`);
  await runInAppContext(app, `openSurvey('sec1')`);
  assert.deepEqual(db.survey_invites.map(i => i.student_id + ':' + i.recipient).sort(), ['b:guardian', 'b:student', 'n:guardian']);
  await runInAppContext(app, `openSurvey('sec1')`);
  assert.equal(db.survey_invites.length, 3, 'فتح ثالث لا يكرّر');
});

test('حملة مغلقة: لا تذاكر جديدة تُنشأ ولا أزرار إرسال', async () => {
  const closed = [Object.assign(OPEN_CAMPAIGN(), { status: 'closed' })];
  const { app, db } = appWith({ students: STUDENTS, campaigns: closed });
  await runInAppContext(app, `openSurvey('sec1')`);
  assert.equal(db.survey_invites.length, 0);
  assert.ok(!/class="[^"]*sv-wa/.test(app.__els.svSheet.innerHTML), 'لا واتساب على حملة مغلقة');
});

test('«ابدأ» مرتين متزامنتين: حملة واحدة فقط', async () => {
  const { app, db } = appWith({ students: STUDENTS });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `Promise.all([svStart(), svStart()])`);
  assert.equal(db.survey_campaigns.length, 1);
});

test('«أُرسل» تُسجَّل مرة واحدة حتى مع نقرتين، وبشرط sent_at فارغ وبتصفية المعلم', async () => {
  const { app, log, db } = appWith({ students: STUDENTS });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `svStart()`);
  const id = db.survey_invites[0].id;
  log.length = 0;
  await runInAppContext(app, `Promise.all([svMarkSent('${id}'), svMarkSent('${id}')])`);
  const ups = log.filter(l => l.table === 'survey_invites' && l.op === 'update');
  assert.equal(ups.length, 1);
  assert.equal(ups[0].f.teacher_id, 'u1');
  assert.equal(ups[0].f.id, id);
  assert.ok('sent_at' in ups[0].f && ups[0].f.sent_at === null, 'شرط is(sent_at, null)');
});

test('السباق: إغلاق الشاشة أثناء التحميل لا يرسم ولا يكتب', async () => {
  const { app, db } = appWith({ students: STUDENTS, campaigns: [OPEN_CAMPAIGN()] });
  await runInAppContext(app, `(async () => { const t = openSurvey('sec1'); closeSurvey(); await t; })()`);
  assert.equal(db.survey_invites.length, 0, 'لا تذاكر تُنشأ بعد الإغلاق');
  assert.ok(!app.__els.svBack, 'لا نافذة بعد الإغلاق');
});

test('نص الصفحة: أسماء الطلاب تمرّ بـescapeHtml', async () => {
  const evil = [{ id: 'a', full_name: '<img src=x onerror=alert(1)>', section_id: 'sec1', is_active: true, guardian_phone: '966501234567', student_phone: null }];
  const { app } = appWith({ students: evil });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `svStart()`);
  const html = app.__els.svSheet.innerHTML;
  assert.ok(!html.includes('<img'), 'لا وسم خام');
  assert.match(html, /&lt;img/);
});

/* ============ النتائج: لا إسقاط صامت ولا سقف صامت ============ */

function manyResponses(n, extra){ return Array.from({ length: n }, (_, i) => ({ id: 'r' + String(i).padStart(5, '0'), campaign_id: 'c1', teacher_id: 'u1', answers: Object.assign({}, GOOD, extra || {}) })); }
function answeredInvites(n){ return Array.from({ length: n }, (_, i) => ({ id: 'i' + i, campaign_id: 'c1', teacher_id: 'u1', student_id: 'a', recipient: i % 2 ? 'student' : 'guardian', code: 'abcdefghjk', sent_at: 'x', answered_on: '2026-11-09' })); }

test('كل الردود تُقرأ بصفحات: 1200 رد كلها تُحسب (لا سقف 1000 صامت)', async () => {
  const { app, log } = appWith({ students: STUDENTS, campaigns: [OPEN_CAMPAIGN()], invites: answeredInvites(2), responses: manyResponses(1200) });
  await runInAppContext(app, `openSurvey('sec1')`);
  const reads = log.filter(l => l.table === 'survey_responses');
  assert.ok(reads.length >= 2, 'صفحتان على الأقل');
  assert.ok(reads.every(l => l.f.teacher_id === 'u1' && l.f.campaign_id === 'c1' && l.rng), 'بتصفية المعلم وبمدى');
  assert.equal(runInAppContext(app, 'svState.responses.length'), 1200);
});

test('رد لا يطابق القالب: يُستبعد ويظهر تنبيه صريح (لا صمت)', async () => {
  const bad = manyResponses(1, { q1: 'خمسة' });
  const { app } = appWith({ students: STUDENTS, campaigns: [OPEN_CAMPAIGN()], invites: answeredInvites(7), responses: manyResponses(6).concat(bad) });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `svSetTab('results')`);
  const html = app.__els.svSheet.innerHTML;
  assert.match(html, /تنبيه/);
  assert.match(html, /1 رد لا يطابق صيغة الأسئلة/);
});

test('حملة بنسخة أسئلة مجهولة: رسالة صريحة بدل أرقام مضللة', async () => {
  const camp = Object.assign(OPEN_CAMPAIGN(), { template: 'v99' });
  const { app } = appWith({ students: STUDENTS, campaigns: [camp], invites: answeredInvites(7), responses: manyResponses(7) });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `svSetTab('results')`);
  const html = app.__els.svSheet.innerHTML;
  assert.match(html, /نسخة أسئلة غير مدعومة/);
  assert.doesNotMatch(html, /نسبة الرضا العام/);
});

test('نتائج كاملة: تظهر بعد 5 ردود فقط، وقبلها رسالة انتظار', async () => {
  const few = appWith({ students: STUDENTS, campaigns: [OPEN_CAMPAIGN()], invites: answeredInvites(4), responses: manyResponses(4) });
  await runInAppContext(few.app, `openSurvey('sec1')`);
  await runInAppContext(few.app, `svSetTab('results')`);
  assert.match(few.app.__els.svSheet.innerHTML, /ننتظر ردودًا أكثر/);
  const enough = appWith({ students: STUDENTS, campaigns: [OPEN_CAMPAIGN()], invites: answeredInvites(5), responses: manyResponses(5) });
  await runInAppContext(enough.app, `openSurvey('sec1')`);
  await runInAppContext(enough.app, `svSetTab('results')`);
  assert.match(enough.app.__els.svSheet.innerHTML, /نسبة الرضا العام/);
});

/* ============ البنية ============ */

test('مصدر واحد للقالب والمدقّق والرمز: التطبيق لا يحمل نسخة خاصة، والملف المشترك محمَّل قبله ومسجَّل بالكاش، والخادم يستعمله', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-44-satisfaction.js'), 'utf8');
  assert.doesNotMatch(src, /SURVEY_TEMPLATE_V1|label: '(وضوح|أسلوب|متابعة)/, 'لا نسخة أسئلة داخل التطبيق');
  assert.match(src, /surveyValidateAnswers\(/);
  assert.match(src, /surveyNewCode\(\)/);
  assert.doesNotMatch(src, /\.limit\(1000\)/, 'لا سقف صامت للردود');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const iShared = html.indexOf('survey-templates.js'), iApp = html.indexOf('app/app-44-satisfaction.js');
  assert.ok(iShared > 0 && iShared < iApp, 'الملف المشترك قبل شاشة المعلم');
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /\.\/survey-templates\.js/);
  assert.match(fs.readFileSync(path.join(root, 'api/s.js'), 'utf8'), /require\('\.\.\/survey-templates\.js'\)/);
});

test('الملف مسجّل، وزر الاستبانة بصفحة الشعبة، ولا حذف لحملة من الواجهة، وكل استعلام survey_ بتصفية المعلم', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-44-satisfaction.js'), 'utf8');
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-44-satisfaction\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-44-satisfaction\.js/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /id="crmStuSurveyBtn"[^>]*openSurvey\(/);
  assert.doesNotMatch(src, /survey_campaigns'\)\.delete|survey_responses'\)\.delete/, 'إغلاق فقط');
  const calls = src.split(/sb\.from\('survey_/).slice(1);
  assert.ok(calls.length >= 6);
  calls.filter(c => !/^[a-z_]+'\)\.insert\(/.test(c)).forEach(c => assert.match(c.slice(0, 340), /teacher_id/, 'استعلام survey_ بلا teacher_id'));
  assert.ok((src.match(/teacher_id: currentUser\.id/g) || []).length >= 2, 'صفوف الإدراج تحمل المعلم');
});

test('النسخة الاحتياطية الشخصية تضم الجداول الثلاثة بتصفية المعلم، والتذاكر بلا رمز', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-08-admin.js'), 'utf8');
  ['survey_campaigns', 'survey_invites', 'survey_responses'].forEach(t => {
    assert.match(src, new RegExp(`sb\\.from\\('${t}'\\)\\.select\\('\\*'\\)\\.eq\\('teacher_id', uid\\)`), t + ' مسحوب بتصفية المعلم');
    assert.match(src, new RegExp(`${t}: `), t + ' بالمخرجات');
  });
  assert.match(src, /survey_invites: \(surveyInvitesRes\.data \|\| \[\]\)\.map\(r => Object\.assign\(\{\}, r, \{ code: null \}\)\)/, 'الرمز يُنزع');
});

test('نسخة بناء المخطط (app-07) تضم جداول الاستبانة ودالتها، وتتبع staging عند الطلب', () => {
  const { app } = appWith();
  const pub = app.buildSchemaSql('public'), stg = app.buildSchemaSql('staging');
  ['survey_campaigns', 'survey_invites', 'survey_responses'].forEach(t => {
    assert.match(pub, new RegExp('create table if not exists public\\.' + t));
    assert.match(stg, new RegExp('create table if not exists staging\\.' + t));
  });
  assert.match(pub, /function public\.submit_survey/);
  assert.doesNotMatch(stg, /public\.survey_/, 'لا مرجع public متبقٍّ في staging');
});

test('نسخة app-07 من SQL مطابقة حرفيًا لكتلة الاستبانة في sql-updates (لا انحراف بين النسختين)', () => {
  const sql = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
  const start = sql.indexOf('-- ============ استبانة رضا المستفيدين');
  assert.ok(start > 0);
  const block = sql.slice(start).trim();
  const app07 = fs.readFileSync(path.join(root, 'app/app-07-backup-export.js'), 'utf8');
  assert.ok(app07.includes(block), 'كتلة الاستبانة بـapp-07 تختلف عن sql-updates — أعد النسخ');
});

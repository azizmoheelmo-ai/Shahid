'use strict';
/* ============================================================
   استبانة رضا المستفيدين — شاشة المعلم (app-44، التصميم: SURVEYS.md):
   - كل استعلام بتصفية المعلم (teacher_id)، ولا شيء يمرّ بلا فلترة.
   - التذاكر: لمن له جوال فقط، جوال ولي الأمر ثم الطالب، بلا تكرار، ويلتقط الطلاب الجدد عند كل فتح.
   - التجميع: التقييم والصح/خطأ والاختيار والنص، والنص يُخلط، والقيم الغريبة تُهمل.
   - السباق: الإغلاق أثناء التحميل لا يرسم ولا يكتب. نقرتان متزامنتان على «ابدأ» أو «واتساب» تُنفّذان مرة.
   - القالب بالتطبيق = القالب بالخادم (api/s.js) حرفيًا.
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
      const f = {}; let op = 'select', values = null, single = false;
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; },
        eq(c, v){ f[c] = v; return api; }, is(c, v){ f[c] = null; return api; },
        insert(v){ op = 'insert'; values = v; return api; }, update(v){ op = 'update'; values = v; return api; },
        single(){ single = true; return api; },
        then(res, rej){
          log.push({ table, op, values, f: Object.assign({}, f) });
          const t = db[table];
          let data = null, error = null;
          if(op === 'select') data = t.filter(r => Object.keys(f).every(k => !(k in r) || f[k] === null || r[k] === f[k]));
          if(op === 'insert'){
            if(opts.insertError && opts.insertError(table)) error = opts.insertError(table);
            else { const arr = Array.isArray(values) ? values : [values]; arr.forEach(r => t.push(Object.assign({ id: table + (++seq), status: 'open', closes_at: new Date(Date.now() + 864e5 * 14).toISOString(), sent_at: null, answered_on: null }, r))); data = single ? t[t.length - 1] : null; }
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

const STUDENTS = [
  { id: 'a', full_name: 'أحمد', section_id: 'sec1', is_active: true, guardian_phone: '966501234567', student_phone: '966551234567' },
  { id: 'b', full_name: 'بدر', section_id: 'sec1', is_active: true, guardian_phone: null, student_phone: '966551111111' },
  { id: 'c', full_name: 'جاسر', section_id: 'sec1', is_active: true, guardian_phone: null, student_phone: null },
  { id: 'd', full_name: 'دخيل', section_id: 'sec1', is_active: false, guardian_phone: '966502222222', student_phone: null },
  { id: 'e', full_name: 'عمر', section_id: 'other', is_active: true, guardian_phone: '966503333333', student_phone: null }
];

/* ============ دوال صرفة ============ */

test('المستلم: جوال ولي الأمر ثم الطالب ثم لا شيء', async () => {
  const { app } = appWith();
  assert.deepEqual(JSON.parse(JSON.stringify(app.svRecipientFor(STUDENTS[0]))), { recipient: 'guardian', phone: '966501234567' });
  assert.deepEqual(JSON.parse(JSON.stringify(app.svRecipientFor(STUDENTS[1]))), { recipient: 'student', phone: '966551111111' });
  assert.equal(app.svRecipientFor(STUDENTS[2]), null);
  assert.equal(app.svRecipientFor(null), null);
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

test('رسالة واتساب: الرابط مبهم (رمز فقط) والاسم في النص وحده، والتذكير بصياغة مختلفة', () => {
  const { app } = appWith();
  const m = app.svWaMessage('أحمد', 'abcdefghjkmnpq', 'https://app.example', false);
  assert.match(m, /https:\/\/app\.example\/s\/abcdefghjkmnpq/);
  assert.match(m, /أحمد/);
  const url = m.match(/https:\/\/\S+/)[0];
  assert.doesNotMatch(url, /أحمد|966/, 'لا اسم ولا رقم داخل الرابط نفسه');
  assert.match(app.svWaMessage('أحمد', 'abcdefghjkmnpq', 'https://app.example', true), /تذكير/);
});

test('التجميع: متوسط التقييم، نسبة صح، توزيع الاختيار، النص يُخلط، والقيم الغريبة تُهمل', () => {
  const { app } = appWith();
  const tpl = runInAppContext(app, 'SURVEY_TEMPLATE_V1');
  const R = (o) => ({ answers: o });
  const rs = [
    R({ q1: 5, q2: 4, q4: true, q5: false, q6: 0, q7: 5, q8: ' ممتاز ', q9: 'أ' }),
    R({ q1: 3, q2: 4, q4: true, q5: false, q6: 0, q7: 3, q8: 'جيد' }),
    R({ q1: 4, q2: 'x', q4: 'yes', q5: true, q6: 9, q7: 4 }),
    R({ q1: 0, q2: 6, q4: false })
  ];
  const agg = app.svAggregate(rs, tpl, () => 0);
  const by = id => agg.find(a => a.id === id);
  assert.equal(by('q1').avg, 4, '(5+3+4)/3: الصفر خارج المدى يُهمل');
  assert.equal(by('q1').n, 3);
  assert.equal(by('q2').avg, 4, 'النص و6 يُهملان');
  assert.equal(by('q4').n, 3, '"yes" ليست منطقية');
  assert.equal(by('q4').pct, 67);
  assert.equal(by('q6').counts[0].count, 2);
  assert.equal(by('q6').n, 2, 'فهرس 9 خارج الخيارات يُهمل');
  assert.deepEqual([...by('q8').texts].sort(), ['جيد', 'ممتاز'], 'النص يُقصّ');
  assert.equal(app.svWeakestRating(agg.filter(a => a.id !== 'q7')).id, 'q1', 'تعادل q1 وq2: الأول يغلب، وسؤال بلا ردود لا يدخل');
  assert.equal(by('q3').avg, null, 'سؤال بلا ردود: لا متوسط');
});

test('النص يُخلط ترتيبه (لا يدلّ الترتيب على صاحب الرد)', () => {
  const { app } = appWith();
  const tpl = runInAppContext(app, 'SURVEY_TEMPLATE_V1');
  const rs = ['1', '2', '3', '4', '5', '6'].map(t => ({ answers: { q8: t } }));
  const a1 = app.svAggregate(rs, tpl, () => 0).find(a => a.id === 'q8').texts.join('');
  assert.notEqual(a1, '123456', 'مع مولّد ثابت يتغيّر الترتيب فعلًا');
  assert.deepEqual(a1.split('').sort(), ['1', '2', '3', '4', '5', '6']);
});

/* ============ قاعدة البيانات: التصفية والتذاكر ============ */

test('كل استعلام بتصفية المعلم، والتذاكر لمن له جوال فقط (ولي الأمر ثم الطالب)، بلا نشط/غير نشط خاطئ ولا شعبة أخرى', async () => {
  const { app, log, db } = appWith({ students: STUDENTS });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `svStart()`);
  assert.ok(log.length >= 3);
  log.forEach(l => {
    if(l.op === 'insert') (Array.isArray(l.values) ? l.values : [l.values]).forEach(v => assert.equal(v.teacher_id, 'u1', l.table + ' insert يحمل المعلم'));
    else assert.equal(l.f.teacher_id, 'u1', l.table + ' ' + l.op + ' بلا تصفية المعلم');
  });
  const inv = db.survey_invites;
  assert.deepEqual(inv.map(i => i.student_id).sort(), ['a', 'b'], 'جاسر بلا رقم، ودخيل غير نشط، وعمر بشعبة أخرى');
  assert.equal(inv.find(i => i.student_id === 'a').recipient, 'guardian');
  assert.equal(inv.find(i => i.student_id === 'b').recipient, 'student');
  inv.forEach(i => assert.match(i.code, /^[a-z2-9]{14}$/));
  assert.equal(new Set(inv.map(i => i.code)).size, inv.length, 'رموز مختلفة');
});

test('إعادة الفتح تلتقط الطالب الجديد فقط بلا تكرار للقديم', async () => {
  const { app, db } = appWith({ students: STUDENTS.slice(0, 1) });
  await runInAppContext(app, `openSurvey('sec1')`);
  await runInAppContext(app, `svStart()`);
  assert.equal(db.survey_invites.length, 1);
  runInAppContext(app, `crmStudents.push({ id: 'n', full_name: 'جديد', section_id: 'sec1', is_active: true, guardian_phone: '966504444444', student_phone: null })`);
  await runInAppContext(app, `openSurvey('sec1')`);
  assert.deepEqual(db.survey_invites.map(i => i.student_id).sort(), ['a', 'n']);
  await runInAppContext(app, `openSurvey('sec1')`);
  assert.equal(db.survey_invites.length, 2, 'فتح ثالث لا يكرّر');
});

test('حملة مغلقة: لا تذاكر جديدة تُنشأ ولا أزرار إرسال', async () => {
  const closed = [{ id: 'c1', teacher_id: 'u1', section_id: 'sec1', status: 'closed', closes_at: new Date(Date.now() + 864e5).toISOString(), created_at: 'x' }];
  const { app, db } = appWith({ students: STUDENTS, campaigns: closed });
  await runInAppContext(app, `openSurvey('sec1')`);
  assert.equal(db.survey_invites.length, 0);
  assert.ok(!/class="sv-wa/.test(app.__els.svSheet.innerHTML), 'لا واتساب على حملة مغلقة');
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
  const { app, log, db } = appWith({ students: STUDENTS, campaigns: [{ id: 'c1', teacher_id: 'u1', section_id: 'sec1', status: 'open', closes_at: new Date(Date.now() + 864e5).toISOString(), created_at: 'x' }] });
  const p = runInAppContext(app, `(async () => { const t = openSurvey('sec1'); closeSurvey(); await t; })()`);
  await p;
  assert.equal(db.survey_invites.length, 0, 'لا تذاكر تُنشأ بعد الإغلاق');
  assert.ok(!app.__els.svBack, 'لا نافذة بعد الإغلاق');
  void log;
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

/* ============ البنية ============ */

test('القالب بالتطبيق مطابق لقالب الخادم api/s.js حرفيًا (المعرّفات والأنواع والعناوين والخيارات)', () => {
  const { app } = appWith();
  const client = JSON.parse(JSON.stringify(runInAppContext(app, 'SURVEY_TEMPLATE_V1'))).questions;
  const server = require(path.join(root, 'api/s.js')).SURVEY_TEMPLATES.v1.questions;
  const norm = qs => qs.map(q => ({ id: q.id, type: q.type, label: q.label, options: q.options || null }));
  assert.deepEqual(norm(client), norm(server));
});

test('الملف مسجّل، وزر الاستبانة بصفحة الشعبة، ولا حذف لحملة من الواجهة', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-44-satisfaction.js'), 'utf8');
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-44-satisfaction\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-44-satisfaction\.js/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /id="crmStuSurveyBtn"[^>]*openSurvey\(/);
  assert.doesNotMatch(src, /survey_campaigns'\)\.delete|survey_responses'\)\.delete/, 'إغلاق فقط');
  /* لا استعلام بلا تصفية المعلم: كل .from('survey_…') يتبعه teacher_id خلال الاستعلام نفسه */
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

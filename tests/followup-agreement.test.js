'use strict';
/* اتفاق المتابعة مع الطالب — المرحلة 1 (app-48، FOLLOWUP-AGREEMENT.md).
   - دوال صرفة: بناء الاتفاق والتحقق وسطر العرض.
   - الحفظ: مقيَّد بـteacher_id وبالمتابعة المفتوحة؛ نقرة مزدوجة لا تكتب مرتين؛ متابعة أُغلقت أثناء الشاشة لا تُكتب.
   - SQL: العمود وقيده في ملف التحديثات وفي مرآة buildSchemaSql.
   - XSS، وعدم ظهور زر الاتفاق للمتابعة المغلقة/الجماعية، وتسجيل الملف بالصفحة والكاش. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');

test('faBuildAgreement — اتفاق صالح وغير صالح', () => {
  const app = loadApp();
  const ok = app.faBuildAgreement('grades', { status: 'agreed', commit: 0, support: 1 }, '2026-11-10');
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), { v: 1, mode: 'in_person', status: 'agreed', commitment: 'أسلّم الواجبات في موعدها', support: 'أن تذكّرني قبل موعد التسليم', agreed_on: '2026-11-10' });
  assert.equal(app.faBuildAgreement('grades', { status: 'agreed', commit: 0, support: null }, 'd'), null, 'أوافق يتطلب الاختيارين');
  assert.equal(app.faBuildAgreement('grades', { status: 'agreed', commit: 9, support: 0 }, 'd'), null, 'فهرس خارج المكتبة');
  assert.equal(app.faBuildAgreement('grades', { status: 'agreed', commit: '0', support: 0 }, 'd'), null, 'لا تحويل للأنواع');
  assert.equal(app.faBuildAgreement('grades', { status: 'x', commit: 0, support: 0 }, 'd'), null);
  const talk = app.faBuildAgreement('grades', { status: 'wants_talk', commit: null, support: null }, 'd');
  assert.equal(talk.status, 'wants_talk');
  assert.equal(talk.commitment, null);
  assert.equal(app.faBuildAgreement('grades', { status: 'wants_talk', commit: 7, support: null }, 'd'), null);
});

test('المكتبة: ثلاثة خيارات لكل خطوة، ونوع غير معروف يرجع لـ«أخرى»', () => {
  const app = loadApp();
  for(const k of ['grades', 'absence', 'lateness', 'exits', 'behavior', 'other']){
    const lib = app.faLibraryFor(k);
    assert.equal(lib.commitments.length, 3, k);
    assert.equal(lib.supports.length, 3, k);
    assert.equal(lib.supports[2], 'لا أحتاج شيئًا الآن', k);
  }
  assert.equal(app.faLibraryFor('zzz'), app.faLibraryFor('other'));
});

test('faSummaryLine', () => {
  const app = loadApp();
  assert.equal(app.faSummaryLine(null), '');
  assert.match(app.faSummaryLine({ status: 'agreed', commitment: 'أ', support: 'ب' }), /اتفقنا: أ — ودعمك له: ب/);
  assert.doesNotMatch(app.faSummaryLine({ status: 'agreed', commitment: 'أ', support: 'لا أحتاج شيئًا الآن' }), /ودعمك/);
  assert.match(app.faSummaryLine({ status: 'wants_talk', commitment: null }), /يتحدث معك أولًا/);
});

function makeClient(followup){
  const calls = { updates: [], selects: [] };
  const client = {
    calls,
    from(table){
      const filters = [];
      let op = 'select', payload = null;
      const api = {
        select(){ return api; },
        update(p){ op = 'update'; payload = p; return api; },
        eq(c, v){ filters.push([c, v]); return api; },
        maybeSingle: async () => {
          calls.selects.push({ table, filters: filters.slice() });
          return { data: followup.row, error: null };
        },
        then(res){
          if(op === 'update'){
            calls.updates.push({ table, payload, filters: filters.slice() });
            const hit = followup.row && followup.row.status === 'open' && filters.every(([c, v]) => followup.row[c] === v || c === 'teacher_id');
            return Promise.resolve({ data: hit ? [{ id: followup.row.id }] : [], error: null }).then(res);
          }
          return Promise.resolve({ data: [], error: null }).then(res);
        }
      };
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) }
  };
  return client;
}

function appWith(row){
  const fu = { row };
  const client = makeClient(fu);
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m); crmStudents = [{ id: 's1', full_name: 'سالم بن أحمد' }];`);
  return { app, client, fu };
}
const ROW = { id: 'f1', student_id: 's1', reason_type: 'grades', reason_text: 'واجبات', review_date: '2026-11-24', status: 'open', group_id: null, agreement: null };

test('الشاشة: ثلاث خطوات ثم حفظ مقيَّد بالمعلم والمتابعة المفتوحة، ونقرة مزدوجة تكتب مرة', async () => {
  const { app, client } = appWith({ ...ROW });
  await app.openFollowupAgreement('f1');
  assert.deepEqual(client.calls.selects[0].filters, [['teacher_id', 'u1'], ['id', 'f1']]);
  const html = () => app.document.getElementById('faRoot').innerHTML;
  assert.match(html(), /سالم، ما الخطوة/);
  assert.equal((html().match(/fa-card/g) || []).length, 3, 'ثلاث بطاقات فقط');
  app.faPick('commit', 1);
  assert.match(html(), /ما الذي تحتاجه/);
  app.faPick('support', 0);
  assert.match(html(), /هذا اتفاقنا/);
  assert.match(html(), /أراجع الدرس عشر دقائق كل يوم/);
  assert.match(html(), /نراجع معًا يوم \S+ 24\/11/);
  const p1 = app.faSave('agreed');
  const p2 = app.faSave('agreed');
  await Promise.all([p1, p2]);
  assert.equal(client.calls.updates.length, 1, 'كتابة واحدة');
  const u = client.calls.updates[0];
  assert.equal(u.table, 'classroom_followups');
  assert.ok(u.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'));
  assert.ok(u.filters.some(([c, v]) => c === 'status' && v === 'open'));
  assert.equal(u.payload.agreement.status, 'agreed');
  assert.equal(u.payload.agreement.commitment, 'أراجع الدرس عشر دقائق كل يوم');
});

test('متابعة أُغلقت أثناء الشاشة: لا يُحفظ شيء وتظهر رسالة', async () => {
  const { app, fu } = appWith({ ...ROW });
  await app.openFollowupAgreement('f1');
  app.faPick('commit', 0); app.faPick('support', 0);
  fu.row.status = 'closed';
  await app.faSave('agreed');
  assert.ok(runInAppContext(app, 'window.__toasts').some(t => /أُغلقت/.test(t)));
});

test('«أريد أن أتحدث أولًا» متاح من الخطوة الأولى بلا اختيار', async () => {
  const { app, client } = appWith({ ...ROW });
  await app.openFollowupAgreement('f1');
  await app.faSave('wants_talk');
  assert.equal(client.calls.updates[0].payload.agreement.status, 'wants_talk');
  assert.equal(client.calls.updates[0].payload.agreement.commitment, null);
});

test('متابعة مغلقة أو جماعية: لا تُفتح الشاشة ولا يظهر الزر', async () => {
  for(const row of [{ ...ROW, status: 'closed' }, { ...ROW, group_id: 'g1' }]){
    const { app, client } = appWith(row);
    await app.openFollowupAgreement('f1');
    assert.equal(runInAppContext(app, 'faDraft'), null);
    assert.equal(client.calls.updates.length, 0);
    assert.equal(app.faInlineHtml(row), '');
  }
});

test('XSS: نص الاتفاق المحفوظ يُهرَّب عند العرض', () => {
  const app = loadApp();
  const h = app.faInlineHtml({ ...ROW, agreement: { status: 'agreed', commitment: '<img src=x onerror=1>', support: '"><script>' } });
  assert.doesNotMatch(h, /<img|<script/);
  assert.match(h, /تعديل الاتفاق/);
});

test('SQL: العمود وقيده في ملف التحديثات ومرآة buildSchemaSql، وبلا جدول جديد', () => {
  const upd = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
  const app = loadApp();
  for(const sql of [upd, app.buildSchemaSql()]){
    assert.match(sql, /alter table public\.classroom_followups add column if not exists agreement jsonb/);
    assert.match(sql, /classroom_followups_agreement_chk/);
    assert.match(sql, /octet_length\(agreement::text\) <= 1500/);
  }
  assert.match(app.buildSchemaSql('staging'), /alter table staging\.classroom_followups add column if not exists agreement jsonb/);
});

test('الاستعلامات: ملف الطالب يجلب agreement، والملف مسجَّل بالصفحة والكاش، وكل استعلام مقيَّد بالمعلم', () => {
  assert.match(fs.readFileSync(path.join(root, 'app/app-15-student-profile.js'), 'utf8'), /closed_at, created_at, agreement, result'\)/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-48-followup-agreement\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-48-followup-agreement\.js/);
  const src = fs.readFileSync(path.join(root, 'app/app-48-followup-agreement.js'), 'utf8');
  const froms = src.match(/sb\.from\('classroom_followups'\)[\s\S]*?(?=\n\s*\n|;\n)/g) || [];
  assert.equal(froms.length, 3); /* فتح الاتفاق، حفظه، شارة التذكير */
  froms.forEach(q => assert.match(q, /\.eq\('teacher_id', (currentUser\.id|uid)\)/));
  assert.match(src, /const uid = currentUser\.id;\n  const \{ data, error \} = await sb\.from\('classroom_followups'\)/, 'uid = معرّف المعلم الحالي');
});

test('بعد فتح متابعة: عرض مباشر للاتفاق (القسم مطويّ بملف الطالب)', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-16-attention-followups.js'), 'utf8');
  assert.match(src, /if\(typeof faOfferAfterOpen === 'function'\) faOfferAfterOpen\(fu\.id\);/);
  const app = loadApp();
  runInAppContext(app, `window.__m = ''; showInfoModal = (h) => { window.__m = h; };`);
  app.faOfferAfterOpen("x'\"<b>");
  const h = runInAppContext(app, 'window.__m');
  assert.match(h, /اتفاق مع الطالب الآن/);
  assert.doesNotMatch(h, /<b>/);
});

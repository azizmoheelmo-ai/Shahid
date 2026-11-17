'use strict';
/* ============================================================
   حصص البرامج في «أعمال تنتظر التوثيق» + ربط حصة بشاهد قائم (app-54)
   ------------------------------------------------------------
   من بيانات المستخدم الفعلية (2026-11-17، الأسبوع الثاني عشر): اقتُرحت 12 حصة برنامج مرّ أسبوعها كأنها
   نُفّذت، وبعضها نُفّذ ووُثّق بشاهد غير مربوط بالحصة. الآن: الأسبوع الحالي والماضي فقط، بسؤال صريح،
   وأداة ربط بشاهد قائم.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');
const J = x => JSON.parse(JSON.stringify(x));
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/* تقويم منطقة مكة 1448 (من القاعدة): أول أيام الأسابيع المستعملة */
const WEEKS = [['الأسبوع الثالث', '2026-09-13'], ['الأسبوع الرابع', '2026-09-20'], ['الأسبوع السادس', '2026-10-04'], ['الأسبوع السابع', '2026-10-11'],
  ['الأسبوع التاسع', '2026-10-25'], ['الأسبوع العاشر', '2026-11-01'], ['الأسبوع الحادي عشر', '2026-11-08'], ['الأسبوع الثاني عشر', '2026-11-15'],
  ['الأسبوع الثالث عشر', '2026-11-29'], ['الأسبوع الخامس عشر', '2026-12-13']].map(([l, d]) => ({ week_label: l, gregorian_date: d }));

test('بيانات المستخدم: يوم 2026-11-17 لا يُقترح إلا حصة الأسبوع الثاني عشر (لا الحصص القديمة)', () => {
  const app = loadApp();
  const occ = app.inboxWeekOccurrences(WEEKS);
  const firstAid = { id: 'FA', cycle_year: '2026/2027', created_at: '2026-09-17', sessions: [
    { session_no: 1, week_label: 'الأسبوع الثالث', section_status: { A: { done: true }, B: { done: true } } },
    { session_no: 2, week_label: 'الأسبوع السادس' }, { session_no: 3, week_label: 'الأسبوع التاسع' }, { session_no: 4, week_label: 'الأسبوع الثاني عشر' }] };
  const lang = { id: 'LG', cycle_year: '2026/2027', created_at: '2026-09-17', sessions: [
    { session_no: 1, week_label: 'الأسبوع الرابع', section_status: { D: { done: true } } }, { session_no: 2, week_label: 'الأسبوع السابع' },
    { session_no: 3, week_label: 'الأسبوع العاشر' }, { session_no: 4, week_label: 'الأسبوع الثالث عشر' }, { session_no: 5, week_label: 'الأسبوع الخامس عشر' }] };
  const map = new Map([['FA', ['A', 'B', 'C']], ['LG', ['D']]]);
  const out = app.inboxDueProgramSessions([firstAid, lang], map, occ, '2026-11-17', '2026/2027');
  assert.deepEqual(J(out.map(x => x.programId + x.sessionNo + x.sectionId)), ['FA4A', 'FA4B', 'FA4C'], 'كان 12 حصة؛ الآن 3');
  /* الأسبوع الماضي ما زال مقترحًا (الأسبوع الحادي عشر بداية 11-08 ضمن 13 يومًا) */
  const recent = { id: 'R', cycle_year: '2026/2027', created_at: '2026-09-01', sessions: [{ session_no: 1, week_label: 'الأسبوع الحادي عشر' }] };
  assert.equal(app.inboxDueProgramSessions([recent], new Map(), occ, '2026-11-17', '2026/2027').length, 1);
});

test('الورقة: سؤال «هل نفّذت؟» وزر «نفّذتها — احفظ الشاهد» و«لم أنفّذها» و«اربطها بشاهد موجود»', () => {
  const src = read('app/app-51-shahid-inbox.js');
  assert.match(src, /title: `هل نفّذت الحصة \$\{s\.sessionNo\}؟ — \$\{p\.name\}`/);
  assert.match(src, /isProg \? 'نفّذتها — احفظ الشاهد' : 'حفظ الشاهد'/);
  assert.match(src, /isProg \? 'لم أنفّذها — أخفِها من القائمة'/);
  assert.match(src, /وثّقتها سابقًا — اربطها بشاهد موجود/);
  assert.match(read('app/app-10-programs.js'), /linkProgramSessionFromDetail\('\$\{pid\}', \$\{s\.session_no\}, '\$\{escapeHtml\(String\(sec\.id\)\)\}'/, 'زر «ربط» في «برامجي» أيضًا');
});

test('المرشّحون للربط: غير المربوط، أو المربوط بالحصة نفسها بلا شعبة (توثيق قديم)؛ الأقرب لأسبوع الحصة أولًا', () => {
  const app = loadApp();
  const ctx = { programId: 'FA', sessionNo: 1, sectionId: 'C', weekStart: '2026-09-13' };
  const rows = [
    { id: 'cpr', lesson_title: 'Cpr نشاط', lesson_date: '2026-09-17' },                                     /* SH-00019 */
    { id: 'old', lesson_title: 'الحصة 1 من 4', lesson_date: '2026-09-17', program_id: 'FA', program_session_no: 1 }, /* SH-00022 */
    { id: 'far', lesson_title: 'بعيد', lesson_date: '2026-11-11' },
    { id: 'other', lesson_title: 'حصة أخرى', lesson_date: '2026-09-16', program_id: 'FA', program_session_no: 2, program_section_id: 'C' },
    { id: 'sec', lesson_title: 'مربوط بشعبة', lesson_date: '2026-09-15', program_id: 'FA', program_session_no: 1, program_section_id: 'A' }
  ];
  const out = app.linkCandidateShawahid(rows, ctx);
  assert.deepEqual(J(out.map(r => r.id)).sort(), ['cpr', 'far', 'old']);
  assert.ok(out[0].near && out[out.length - 1].id === 'far', 'الأقرب أولًا');
  const inWeek = app.linkCandidateShawahid([{ id: 'sun', lesson_date: '2026-09-13' }, { id: 'thu', lesson_date: '2026-09-17' }, { id: 'next', lesson_date: '2026-09-21' }], ctx);
  assert.deepEqual(J(inWeek.map(r => r.id)), ['thu', 'sun', 'next'], 'داخل الأسبوع سواء (الأحدث أولًا)، ثم الأقرب لطرفيه');
  assert.equal(app.linkShahidAllowed(rows[1], Object.assign({}, ctx, { sectionId: null })), false, 'بلا شعبة: المربوط مسبقًا مرفوض');
});

/* عميل وهمي بسيط */
function client(seed, log, opts){
  opts = opts || {};
  return {
    from(table){
      const f = []; let op = 'select', values = null, single = false;
      const rows = () => (seed[table] || []).filter(r => f.every(([c, v]) => r[c] === v));
      const run = () => {
        const forced = opts.fail && opts.fail(table, op, values);
        if(forced) return forced;
        if(op === 'update'){ log.push({ table, op, values, filters: f.slice() }); rows().forEach(r => Object.assign(r, values)); return { data: null, error: null }; }
        log.push({ table, op, filters: f.slice() });
        const r = rows();
        return { data: single ? (r[0] || null) : r, error: null };
      };
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; },
        eq(c, v){ f.push([c, v]); return api; },
        update(v){ op = 'update'; values = v; return api; },
        maybeSingle(){ single = true; return Promise.resolve(run()); },
        then(a, b){ return Promise.resolve(run()).then(a, b); }
      };
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) }
  };
}

const SEED = () => ({
  activity_programs: [{ id: 'FA', user_id: 'u1', name: 'برنامج الإسعافات الأولية', created_at: '2026-09-17', sessions: [
    { session_no: 1, week_label: 'الأسبوع الثالث', done: true, section_status: { A: { done: true }, B: { done: true } } }] }],
  shawahid: [
    { id: 'cpr', user_id: 'u1', lesson_title: 'Cpr نشاط', lesson_date: '2026-09-17', created_at: '2026-09-17T06:00:00Z', program_id: null, program_session_no: null, program_section_id: null },
    { id: 'taken', user_id: 'u1', lesson_title: 'مربوط', lesson_date: '2026-09-16', program_id: 'X', program_session_no: 1, program_section_id: null },
    { id: 'foreign', user_id: 'u2', lesson_title: 'لغيري', lesson_date: '2026-09-17', program_id: null }
  ]
});

async function linkApp(seed, log, opts){
  const app = loadApp({ supabaseClient: client(seed, log, opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m); calendarRegion = null; activityPrograms = [];`);
  await runInAppContext(app, `openLinkShahidPicker({ programId: 'FA', sessionNo: 1, sectionId: 'C', sectionLabel: 'شعبة ٦' })`);
  return app;
}

test('الربط: الشاهد يحمل الحصة وشعبتها، والحصة تُعلَّم بتاريخه — وكل كتابة بتصفية المعلم', async () => {
  const log = [];
  const seed = SEED();
  const app = await linkApp(seed, log);
  assert.deepEqual(J(runInAppContext(app, 'lkState.rows.map(r => r.id)')), ['cpr'], 'لا شاهد مربوط بغيرها ولا شاهد معلم آخر');
  runInAppContext(app, 'lkSelect(0)');
  await runInAppContext(app, 'lkLink()');
  const sh = seed.shawahid.find(r => r.id === 'cpr');
  assert.deepEqual({ p: sh.program_id, n: sh.program_session_no, s: sh.program_section_id }, { p: 'FA', n: 1, s: 'C' });
  const st = seed.activity_programs[0].sessions[0].section_status.C;
  assert.deepEqual(J(st), { done: true, done_date: '2026-09-17', shahid_id: 'cpr' });
  log.filter(l => l.op === 'update' || l.table === 'shawahid').forEach(l =>
    assert.ok(l.filters.some(([c, v]) => c === 'user_id' && v === 'u1'), 'تصفية المعلم: ' + l.table + ' ' + l.op));
});

test('الربط مرفوض إن ربطه جهاز آخر بحصة أخرى، أو وُثّقت الحصة في الأثناء — بلا كتابة', async () => {
  const log = [];
  const seed = SEED();
  const app = await linkApp(seed, log);
  runInAppContext(app, 'lkSelect(0)');
  Object.assign(seed.shawahid[0], { program_id: 'Y', program_session_no: 3 });
  await runInAppContext(app, 'lkLink()');
  assert.equal(log.filter(l => l.op === 'update').length, 0);
  assert.ok(app.__toasts.some(t => /مربوطًا بحصة أخرى/.test(t)));

  const log2 = [];
  const seed2 = SEED();
  const app2 = await linkApp(seed2, log2);
  runInAppContext(app2, 'lkSelect(0)');
  seed2.activity_programs[0].sessions[0].section_status.C = { done: true };
  await runInAppContext(app2, 'lkLink()');
  assert.equal(log2.filter(l => l.op === 'update').length, 0);
  assert.ok(app2.__toasts.some(t => /موثّقة من قبل/.test(t)));
});

test('فشل تعليم الحصة بعد ربط الشاهد = يُعاد الشاهد كما كان (لا ربط معلّق)', async () => {
  const log = [];
  const seed = SEED();
  const app = await linkApp(seed, log, { fail: (table, op) => table === 'activity_programs' && op === 'update' ? { data: null, error: { message: 'boom' } } : null });
  runInAppContext(app, 'lkSelect(0)');
  await runInAppContext(app, 'lkLink()');
  const sh = seed.shawahid.find(r => r.id === 'cpr');
  assert.deepEqual({ p: sh.program_id, n: sh.program_session_no, s: sh.program_section_id }, { p: null, n: null, s: null });
  assert.equal(log.filter(l => l.table === 'shawahid' && l.op === 'update').length, 2, 'ربط ثم إعادة');
});

test('نقرتان على «اربط» = ربط واحد', async () => {
  const log = [];
  const app = await linkApp(SEED(), log);
  runInAppContext(app, 'lkSelect(0)');
  await runInAppContext(app, 'Promise.all([lkLink(), lkLink()])');
  assert.equal(log.filter(l => l.table === 'shawahid' && l.op === 'update').length, 1);
});

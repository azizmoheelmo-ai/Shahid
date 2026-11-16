'use strict';
/* ============================================================
   رابط الاطلاع على الشواهد للإدارة: api/p.js (الصفحة) + app-52 (الإنشاء والإلغاء)
   ------------------------------------------------------------
   - الرمز وحده صلاحية: الخاطئ والمنتهي والملغى والحساب المعطَّل بالرد نفسه.
   - شواهد صاحب الرابط ودورته فقط، كل نص مهرَّب، والصور من حاويتنا فقط.
   - ترويسات: بلا تخزين ولا فهرسة ولا Referer، وCSP لا يسمح إلا بالتنسيق (nonce) وصور مشروعنا.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');
const p = require('../api/p.js');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const URL_ = 'https://abcd.supabase.co';
const PHOTO = URL_ + '/storage/v1/object/public/shawahid-photos/u1/1.jpg';
const FUTURE = new Date(Date.now() + 5 * 86400000).toISOString();

function fakeDb(seed, log){
  return {
    from(table){
      const f = [];
      let single = false;
      const run = () => {
        log && log.push({ table, filters: f.slice() });
        const rows = (seed[table] || []).filter(r => f.every(([op, c, v]) => op === 'eq' ? r[c] === v : op === 'is' ? (r[c] === v || (v === null && r[c] === undefined)) : true));
        return { data: single ? (rows[0] || null) : rows, error: null };
      };
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; },
        eq(c, v){ f.push(['eq', c, v]); return api; }, is(c, v){ f.push(['is', c, v]); return api; },
        maybeSingle(){ single = true; return Promise.resolve(run()); },
        then(a, b){ return Promise.resolve(run()).then(a, b); }
      };
      return api;
    }
  };
}

const SEED = () => ({
  portfolio_shares: [
    { code: 'abcdefghjkmnpq', teacher_id: 'u1', cycle_year: '2026/2027', expires_at: FUTURE, label: 'المدير' },
    { code: 'expiredcodexyz', teacher_id: 'u1', cycle_year: '2026/2027', expires_at: '2020-01-01T00:00:00Z' },
    { code: 'disabledcodexy', teacher_id: 'u9', cycle_year: '2026/2027', expires_at: FUTURE }
  ],
  profiles: [{ id: 'u1', disabled: false }, { id: 'u9', disabled: true }],
  shawahid: [
    { id: '1', user_id: 'u1', cycle_year: '2026/2027', element_key: 'k', element_label: 'العنصر', lesson_title: '<script>x</script>', lesson_date: '2026-10-01', teacher_name: 'معلم', photo_urls: [PHOTO, 'https://evil.example/x.jpg', 'https://evil.supabase.cx/storage/v1/object/public/shawahid-photos/u1/2.jpg', URL_ + '/storage/v1/object/public/shawahid-photos/u1/../../x.jpg', URL_ + '/storage/v1/object/public/shawahid-photos/u1/f.pdf'], steps: ['خطوة'], source_type: 'task', source_note: 'رُصدت' },
    { id: '2', user_id: 'u1', cycle_year: '2025/2026', element_key: 'k', element_label: 'العنصر', lesson_title: 'دورة سابقة' },
    { id: '3', user_id: 'u1', cycle_year: null, element_key: 'k', element_label: 'العنصر', lesson_title: 'قديم بلا دورة', lesson_date: '2026-09-15' },
    { id: '4', user_id: 'u2', cycle_year: '2026/2027', element_key: 'k', element_label: 'العنصر', lesson_title: 'معلم آخر' }
  ],
  performance_elements: [{ key: 'k', label: 'العنصر', sort_order: 1 }]
});

test('resolvePortfolio: شواهد صاحب الرابط ودورته فقط (والقديم بلا دورة يُحسب من تاريخه)', async () => {
  const log = [];
  const r = await p.resolvePortfolio('abcdefghjkmnpq', fakeDb(SEED(), log));
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map(x => x.id).sort(), ['1', '3']);
  log.filter(l => l.table === 'shawahid').forEach(l => assert.ok(l.filters.some(([op, c, v]) => op === 'eq' && c === 'user_id' && v === 'u1'), 'تصفية صاحب الرابط'));
});

test('resolvePortfolio: الخاطئ والمنتهي والمعطَّل = { ok: false } بلا تمييز', async () => {
  const db = fakeDb(SEED());
  for(const code of ['nope', 'ABCDEFGHJKMNPQ', 'zzzzzzzzzzzzzz', 'expiredcodexyz', 'disabledcodexy']){
    assert.deepEqual(await p.resolvePortfolio(code, db), { ok: false }, code);
  }
});

test('الصفحة: كل نص مهرَّب، والصور من حاويتنا فقط، وختم المصدر ظاهر', async () => {
  const r = await p.resolvePortfolio('abcdefghjkmnpq', fakeDb(SEED()));
  const html = p.buildPortfolioPage(r, 'N', URL_);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, new RegExp(PHOTO.replace(/[.\/]/g, '\\$&')));
  assert.doesNotMatch(html, /evil\.example/);
  assert.doesNotMatch(html, /evil\.supabase\.cx/, 'مشروع آخر بنفس البنية يُهمل');
  assert.doesNotMatch(html, /\.\.\/\.\.\//, 'مسار بخروج من المجلد يُهمل');
  assert.match(html, /مستند مرفق/);
  assert.match(html, /مصدره: مهمة أدائية مرصودة في التطبيق — رُصدت/);
  assert.match(html, /للاطلاع فقط/);
  assert.doesNotMatch(html, /<script/i, 'بلا سكربتات');
});

test('أسماء المصادر في الصفحة مطابقة للتطبيق', () => {
  const app = loadApp();
  assert.deepEqual(JSON.parse(JSON.stringify(runInAppContext(app, 'SHAHID_SOURCE_LABELS'))), Object.assign({}, p.SOURCE_LABELS));
});

test('cycleYearOf يطابق getCycleYear بالتطبيق', () => {
  const app = loadApp();
  for(const d of ['2026-07-31', '2026-08-01', '2026-12-15', '2027-01-10']){
    assert.equal(p.cycleYearOf(d), app.getCycleYear(d), d);
  }
});

function fakeRes(){
  const r = { headers: {}, statusCode: 0, body: '' };
  r.status = c => { r.statusCode = c; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.send = b => { r.body = b; };
  return r;
}
function limiter(){ let fails = 0; return { blockedFor: () => (fails >= 3 ? 60 : 0), fail: () => { fails++; } }; }

test('المعالج: ترويسات الحماية، و404 موحّد، ومحدّد المحاولات، وGET فقط', async () => {
  const lim = limiter();
  const h = p.createHandler({ url: URL_, key: 'k', createClient: () => fakeDb(SEED()), limiter: lim });
  const ok = fakeRes();
  await h({ method: 'GET', query: { c: 'abcdefghjkmnpq' }, headers: {} }, ok);
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['content-security-policy'], /default-src 'none'/);
  assert.match(ok.headers['content-security-policy'], /img-src https:\/\/abcd\.supabase\.co;/);
  assert.doesNotMatch(ok.headers['content-security-policy'], /script-src/);
  assert.equal(ok.headers['referrer-policy'], 'no-referrer');
  assert.match(ok.headers['cache-control'], /no-store/);
  assert.match(ok.headers['x-robots-tag'], /noindex/);
  const bodies = [];
  for(const c of ['expiredcodexyz', 'disabledcodexy', 'bad']){
    const r = fakeRes();
    await h({ method: 'GET', query: { c }, headers: {} }, r);
    assert.equal(r.statusCode, 404, c);
    bodies.push(r.body.replace(/nonce="[^"]+"/, ''));
  }
  assert.equal(new Set(bodies).size, 1, 'لا يُكشف السبب');
  const blocked = fakeRes();
  await h({ method: 'GET', query: { c: 'abcdefghjkmnpq' }, headers: {} }, blocked);
  assert.equal(blocked.statusCode, 429);
  const post = fakeRes();
  await p.createHandler({ url: URL_, key: 'k', createClient: () => fakeDb(SEED()), limiter: limiter() })({ method: 'POST', query: {}, headers: {} }, post);
  assert.equal(post.statusCode, 405);
});

test('vercel.json: توجيه /p/ للدالة، ومستثنى من ترويسة SAMEORIGIN العامة (له ترويساته)', () => {
  const vj = JSON.parse(read('vercel.json'));
  assert.ok(vj.rewrites.some(r => r.source === '/p/:code' && r.destination === '/api/p?c=:code'));
  const rule = vj.headers.find(h => /\(\?!/.test(h.source));
  const re = new RegExp('^' + rule.source + '$');
  assert.ok(!re.test('/p/abcdefghjkmnpq'));
  assert.ok(re.test('/index.html'));
});

test('SQL: الجدول بقيوده وRLS المالك، وداخل سياسة التعطيل، وخارج النسخة الشاملة، والمرآة حرفية', () => {
  const sql = read('sql-updates-run-in-supabase.sql');
  const blk = sql.slice(sql.indexOf('-- ============ رابط الاطلاع على الشواهد للإدارة'), sql.indexOf('-- ============ استبانة رضا المستفيدين'));
  assert.match(blk, /code text not null unique check \(code ~ '\^\[a-z2-9\]\{14,32\}\$'\)/);
  assert.match(blk, /check \(expires_at <= created_at \+ interval '121 days'\)/);
  assert.match(blk, /using \(auth\.uid\(\) = teacher_id\) with check \(auth\.uid\(\) = teacher_id\)/);
  const dis = /foreach v_t in array array\[([\s\S]*?)\] loop/.exec(sql.slice(sql.indexOf('-- فرض «تعطيل الحساب» من القاعدة نفسها')))[1];
  assert.match(dis, /'portfolio_shares'/);
  assert.ok(runInAppContext(loadApp(), 'buildSchemaSql()').includes(blk.trim()));
});

/* ============ app-52: الإنشاء والإلغاء ============ */

function appClient(log){
  return {
    from(table){
      const f = []; let op = 'select', values = null;
      const run = () => {
        log.push({ table, op, filters: f.slice(), values });
        if(op === 'insert') return { data: Object.assign({ id: 'L1', created_at: 'x' }, values), error: null };
        return { data: [], error: null };
      };
      const api = {
        select(){ return api; }, order(){ return api; },
        eq(c, v){ f.push([c, v]); return api; }, lt(c, v){ f.push([c, v]); return api; },
        insert(v){ op = 'insert'; values = v; return api; }, delete(){ op = 'delete'; return api; },
        single(){ return Promise.resolve(run()); },
        then(a, b){ return Promise.resolve(run()).then(a, b); }
      };
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) }
  };
}

test('buildPortfolioShareRow: المدة من الخيارات فقط، والاسم مقصوص', () => {
  const app = loadApp();
  const r = app.buildPortfolioShareRow({ uid: 'u1', code: 'abc', label: '  ' + 'م'.repeat(80), cycleYear: '2026/2027', days: 999, nowMs: 0 });
  assert.equal(r.expires_at, new Date(30 * 86400000).toISOString(), 'مدة غير معروفة = 30');
  assert.equal(r.label.length, 60);
  assert.equal(app.buildPortfolioShareRow({ uid: 'u1', code: 'a', label: ' ', cycleYear: 'y', days: 90, nowMs: 0 }).label, null);
});

test('pfCreate: نقرتان = رابط واحد، باسم المعلم ودورته الحالية', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: appClient(log), currentUser: { id: 'u1' } });
  runInAppContext(app, `showToast = () => {}; reportShareCode = () => 'abcdefghjkmnpq';`);
  await runInAppContext(app, 'showPortfolioLinks()');
  await runInAppContext(app, 'Promise.all([pfCreate(), pfCreate()])');
  const ins = log.filter(l => l.table === 'portfolio_shares' && l.op === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].values.teacher_id, 'u1');
  assert.equal(ins[0].values.cycle_year, app.getCycleYear());
  log.filter(l => l.table === 'portfolio_shares' && l.op !== 'insert').forEach(l => assert.ok(l.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'), 'تصفية المعلم: ' + l.op));
});

test('pfRevoke: نقرة أولى للتأكيد فقط، والثانية تحذف بتصفية المعلم', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: appClient(log), currentUser: { id: 'u1' } });
  runInAppContext(app, `showToast = () => {};`);
  await runInAppContext(app, 'showPortfolioLinks()');
  runInAppContext(app, `pfState.links = [{ id: 'L9', code: 'abcdefghjkmnpq', cycle_year: 'y', expires_at: '${FUTURE}' }];`);
  const dels = () => log.filter(l => l.table === 'portfolio_shares' && l.op === 'delete' && l.filters.some(([c]) => c === 'id'));
  await runInAppContext(app, `pfRevoke('L9')`);
  assert.equal(dels().length, 0);
  await runInAppContext(app, `pfRevoke('L9')`);
  assert.equal(dels().length, 1);
  assert.ok(dels()[0].filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'));
});

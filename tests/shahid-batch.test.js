'use strict';
/* ============================================================
   تجهيز الشواهد دفعة واحدة (app-33-shahid-batch.js)
   ------------------------------------------------------------
   المسودة بجدول مستقل (shahid_drafts) ولا تصير شاهدًا إلا بإرفاق صورة:
   1) دوال صرفة: توزيع التواريخ، الاقتراح التلقائي بحد 4 للعنصر، بناء السجلات.
   2) التحويل: يحمل معرّف المسودة (لا تكرار)، يحذف المسودة، ينظّف الصور عند الفشل.
   3) عزل المستخدم: loadBatchDrafts لا تجلب مسودات غيره.
   4) التوصيل: view تُخفى، sw/index، المخطط والنسخ الاحتياطية.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ---------- 1) دوال صرفة ---------- */
test('batchSchoolDays — تستثني الجمعة والسبت', () => {
  const app = loadApp();
  // 2026-10-04 أحد … 2026-10-10 سبت
  const days = [...app.batchSchoolDays('2026-10-04', '2026-10-11')];
  assert.deepEqual(days, ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-11']);
  assert.deepEqual([...app.batchSchoolDays('2026-10-11', '2026-10-04')], [], 'نطاق مقلوب = لا أيام');
});

test('batchSpreadDates — موزّعة تصاعديًا داخل النطاق وبأيام دراسة فقط', () => {
  const app = loadApp();
  const dates = [...app.batchSpreadDates(24, '2026-08-30', '2026-10-27')];
  assert.equal(dates.length, 24);
  assert.deepEqual([...dates].sort(), dates, 'مرتّبة تصاعديًا');
  assert.ok(dates.every(d => d >= '2026-08-30' && d <= '2026-10-27'));
  assert.ok(dates.every(d => ![5, 6].includes(app.weekdayOfIso(d))), 'لا جمعة ولا سبت');
  assert.ok(new Set(dates).size > 12, 'تواريخ متفاوتة وليست متطابقة');
  assert.deepEqual([...app.batchSpreadDates(1, '2026-10-04', '2026-10-08')], ['2026-10-08']);
  assert.deepEqual([...app.batchSpreadDates(0, '2026-10-04', '2026-10-08')], []);
});

test('batchInterleave — تناوب بين المجموعات', () => {
  const app = loadApp();
  assert.deepEqual([...app.batchInterleave([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])], ['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
});

test('batchAutoDistribute — حد 4 للعنصر، تناوب عادل، يحترم السعة والنماذج المتاحة', async (t) => {
  const app = loadApp();
  const names = (n) => Array.from({ length: n }, (_, i) => 't' + i);
  const els = ['A', 'B', 'C', 'D', 'E', 'F'].map(k => ({ key: k, names: names(14) }));

  await t.test('24 على 6 عناصر = 4 لكل عنصر', () => {
    const r = app.batchAutoDistribute(els, 24, {});
    assert.ok(els.every(e => r[e.key].length === 4));
  });
  await t.test('20 على 6 عناصر = توزيع متقارب (3-4)', () => {
    const r = app.batchAutoDistribute(els, 20, {});
    const counts = els.map(e => r[e.key].length);
    assert.equal(counts.reduce((a, b) => a + b, 0), 20);
    assert.ok(counts.every(c => c >= 3 && c <= 4));
  });
  await t.test('لا يتجاوز مجموع السعات حتى لو الهدف أكبر', () => {
    const r = app.batchAutoDistribute(els, 30, {});
    assert.equal(els.reduce((n, e) => n + r[e.key].length, 0), 24);
  });
  await t.test('سعة عنصر مستنفدة (قيد التجهيز) تُحترم', () => {
    const r = app.batchAutoDistribute(els, 24, { A: 0, B: 1 });
    assert.equal(r.A.length, 0);
    assert.equal(r.B.length, 1);
  });
  await t.test('عنصر بنموذجين فقط لا يُعطى أكثر منهما', () => {
    const r = app.batchAutoDistribute([{ key: 'X', names: ['p', 'q'] }, { key: 'Y', names: names(14) }], 10, {});
    assert.deepEqual([...r.X], ['p', 'q']);
    assert.equal(r.Y.length, 4);
  });
});

test('buildBatchDraftRows / buildBatchShahidRecord', async (t) => {
  const app = loadApp();
  await t.test('صفوف المسودات تحمل المالك والتاريخ وسنة الدورة', () => {
    const rows = app.buildBatchDraftRows(
      [{ element_key: 'E1', template_name: 'نموذج 1' }, { element_key: 'E2', template_name: 'نموذج 2' }],
      ['2026-10-05', '2026-10-06'],
      { userId: 'u1', teacher: 'م', school: 'مدرسة', subject: 'مادة', className: 'ص' });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.user_id === 'u1' && r.school === 'مدرسة'));
    assert.equal(rows[0].title, 'نموذج 1');
    assert.equal(rows[1].planned_date, '2026-10-06');
    assert.equal(rows[0].cycle_year, '2026/2027');
  });
  await t.test('الشاهد الحقيقي: معرّفه معرّف المسودة، ونصه من النموذج، وصوره المرفوعة', () => {
    const draft = { id: 'd-1', user_id: 'u1', element_key: 'E1', title: 'نموذج 1', planned_date: '2026-10-05', school: 'م', subject: 'ع', class_name: '1', teacher_name: 'أ' };
    const tpl = { description: 'وصف', goal: 'هدف', steps: ['خ1', 'خ2'], quant: 'ك', qual: 'ن', reflection: 'ت' };
    const r = app.buildBatchShahidRecord(draft, tpl, ['https://x/y.jpg'], 'عنصر (10%)', 'a@b.c');
    assert.equal(r.id, 'd-1');
    assert.equal(r.user_id, 'u1');
    assert.equal(r.description, 'وصف');
    assert.deepEqual([...r.steps], ['خ1', 'خ2']);
    assert.deepEqual([...r.photo_urls], ['https://x/y.jpg']);
    assert.equal(r.element_label, 'عنصر (10%)');
    assert.equal(r.cycle_stage, 'planning');
    assert.equal(r.teacher_email, 'a@b.c');
  });
  await t.test('نموذج مفقود لا يكسر البناء', () => {
    const r = app.buildBatchShahidRecord({ id: 'd', user_id: 'u', element_key: 'E', title: 't' }, null, [], '', '');
    assert.equal(r.description, '');
    assert.deepEqual([...r.steps], []);
    assert.equal(r.element_label, 'E');
  });
});

/* ---------- عميل وهمي بحالة (يطبّق eq/insert/delete/upsert فعليًا) ---------- */
function makeBatchClient(seed, opts = {}) {
  const log = [];
  const uploaded = [];
  const removed = [];
  function chain(table) {
    const filters = [];
    let mode = 'select', payload = null;
    const rows = () => (seed[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
    const exec = () => {
      if (mode === 'insert') {
        log.push({ op: 'insert', table, payload });
        if (opts.failInsert) return { data: null, error: opts.failInsert };
        const list = Array.isArray(payload) ? payload : [payload];
        const exists = (seed[table] || []).some(r => list.some(p => p.id && r.id === p.id));
        if (exists) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        seed[table] = (seed[table] || []).concat(list.map(p => Object.assign({ ref_number: 'SH-1' }, p)));
        return { data: list, error: null };
      }
      if (mode === 'delete') {
        log.push({ op: 'delete', table, filters: filters.slice() });
        const rm = rows();
        seed[table] = (seed[table] || []).filter(r => !rm.includes(r));
        return { data: null, error: null };
      }
      if (mode === 'update') {
        log.push({ op: 'update', table, payload });
        rows().forEach(r => Object.assign(r, payload));
        return { data: null, error: null };
      }
      log.push({ op: 'select', table, filters: filters.slice() });
      return { data: rows(), error: null };
    };
    const api = {
      select() { return api; },
      eq(c, v) { filters.push([c, v]); return api; },
      order() { return api; }, range() { return api; }, limit() { return api; },
      insert(p) { mode = 'insert'; payload = p; return api; },
      update(p) { mode = 'update'; payload = p; return api; },
      delete() { mode = 'delete'; return api; },
      single: async () => { const r = exec(); return r.error ? r : { data: r.data[0] ? (seed[table] || []).find(x => x.id === r.data[0].id) : null, error: null }; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      then(resolve) { const r = exec(); resolve(r); return Promise.resolve(r); },
    };
    return api;
  }
  return {
    log, uploaded, removed,
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) },
    from: chain,
    storage: {
      from: () => ({
        upload: async (p) => { if (opts.failUploadAt != null && uploaded.length === opts.failUploadAt) return { error: new Error('upload failed') }; uploaded.push(p); return { error: null }; },
        getPublicUrl: (p) => ({ data: { publicUrl: 'https://abc.supabase.co/storage/v1/object/public/shawahid-photos/' + p } }),
        remove: async (paths) => { removed.push(...paths); return { error: null }; },
      }),
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

function prep(seed, opts) {
  const client = makeBatchClient(seed, opts);
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1', email: 'a@b.c' } });
  const registry = {};
  const live = () => ({ style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, addEventListener() {}, appendChild() {}, querySelector: () => live(), querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null });
  app.document.getElementById = (id) => (registry[id] = registry[id] || live());
  app.document.querySelectorAll = () => [];
  /* الضغط يحتاج FileReader/canvas غير المتوفرين بـNode — نمرّر الملف كما هو */
  runInAppContext(app, 'compressImage = (f) => Promise.resolve(f);');
  return { app, client, seed };
}
const file = (name) => ({ name, type: 'image/jpeg', size: 10 });
const DRAFT = (over) => Object.assign({ id: 'd1', user_id: 'u1', element_key: 'تحسين نتائج المتعلمين', template_name: 'x', title: 'عنوان', planned_date: '2026-10-05', school: 'م' }, over || {});

/* ---------- 3) عزل المستخدم ---------- */
test('loadBatchDrafts — لا تجلب مسودات معلم آخر (فلترة user_id صريحة)', async () => {
  const { app } = prep({ shahid_drafts: [DRAFT({ id: 'a' }), DRAFT({ id: 'b', user_id: 'u2' })] });
  assert.equal(await app.loadBatchDrafts(), true);
  const ids = runInAppContext(app, 'batchDrafts.map(d => d.id)');
  assert.deepEqual([...ids], ['a']);
});

/* ---------- 2) التحويل لشاهد ---------- */
test('batchPromote — يُنشئ الشاهد بمعرّف المسودة ويحذف المسودة ويسجّل المنجز', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app, client } = prep(seed);
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "تحسين نتائج المتعلمين", template_name: "x", title: "عنوان", planned_date: "2026-10-05" }]; batchStep = "pick";');
  await app.batchPromote('d1', [file('1.jpg'), file('2.jpg')]);
  assert.equal(seed.shawahid.length, 1);
  assert.equal(seed.shawahid[0].id, 'd1', 'معرّف الشاهد = معرّف المسودة');
  assert.equal(seed.shawahid[0].user_id, 'u1');
  assert.equal(seed.shawahid[0].photo_urls.length, 2);
  assert.equal(seed.shahid_drafts.length, 0, 'المسودة حُذفت');
  assert.equal(runInAppContext(app, 'batchDone.length'), 1);
  assert.equal(runInAppContext(app, 'batchBusyIds.size'), 0, 'التعطيل يُرفع بعد الانتهاء');
  assert.ok(client.log.some(l => l.op === 'delete' && l.table === 'shahid_drafts' && l.filters.some(f => f[0] === 'user_id' && f[1] === 'u1')), 'الحذف مقيّد بالمالك');
});

test('batchPromote — شاهد بنفس المعرّف موجود (تبويب/جهاز آخر): لا تكرار وتُنظَّف الصور', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [{ id: 'd1', user_id: 'u1', photo_urls: ['old'] }] };
  const { app, client } = prep(seed);
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }];');
  await app.batchPromote('d1', [file('1.jpg')]);
  assert.equal(seed.shawahid.length, 1, 'لا شاهد مكرر');
  assert.equal(seed.shahid_drafts.length, 0, 'المسودة العالقة تُنظَّف');
  assert.equal(client.removed.length, 1, 'الصورة المرفوعة حديثًا تُحذف من التخزين');
  assert.equal(runInAppContext(app, 'batchDone.length'), 0);
});

test('batchPromote — فشل رفع صورة: لا شاهد، المسودة تبقى، وما رُفع يُنظَّف', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app, client } = prep(seed, { failUploadAt: 1 });
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }];');
  await app.batchPromote('d1', [file('1.jpg'), file('2.jpg')]);
  assert.equal(seed.shawahid.length, 0);
  assert.equal(seed.shahid_drafts.length, 1, 'المسودة سليمة لإعادة المحاولة');
  assert.equal(client.removed.length, 1, 'الصورة الأولى المرفوعة نُظّفت');
  assert.equal(runInAppContext(app, 'batchBusyIds.size'), 0);
});

test('batchPromote — فشل إدراج الشاهد: المسودة تبقى والصور تُنظَّف', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app, client } = prep(seed, { failInsert: { code: '42501', message: 'rls' } });
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }];');
  await app.batchPromote('d1', [file('1.jpg')]);
  assert.equal(seed.shahid_drafts.length, 1);
  assert.equal(client.removed.length, 1);
});

test('batchOnPhotos — بطاقة قيد الرفع تتجاهل نقرة/اختيارًا ثانيًا (لا شاهد مكرر)', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app } = prep(seed);
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }]; batchBusyIds.add("d1");');
  const input = { files: [file('1.jpg')], value: 'x' };
  await app.batchOnPhotos('d1', input);
  assert.equal(seed.shawahid.length, 0, 'لم يُنفَّذ تحويل ثانٍ');
});

test('batchOnPhotos — يرفض ما ليس صورة، ويحدّ العدد بـ4', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app, client } = prep(seed);
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }];');
  await app.batchOnPhotos('d1', { files: [{ name: 'a.pdf', type: 'application/pdf', size: 10 }], value: '' });
  assert.equal(client.uploaded.length, 0, 'مستند غير صورة لا يُرفع');
  const six = Array.from({ length: 6 }, (_, i) => file(i + '.jpg'));
  await app.batchOnPhotos('d1', { files: six, value: '' });
  assert.equal(client.uploaded.length, 4, 'أقصى 4 صور');
});

/* ---------- زر الدخول يُخفى لو جدول المسودات غير جاهز ---------- */
test('refreshBatchEntry — يُخفى الزر عند غياب الجدول، ويظهر عند وجوده', async (t) => {
  const mk = (result) => {
    const c = makeBatchClient({});
    const q = { select() { return q; }, eq() { return q; }, limit() { return q; }, then(r) { r(result); return Promise.resolve(result); } };
    c.from = () => q;
    return c;
  };
  const run = async (result) => {
    const client = mk(result);
    const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
    const registry = {};
    const live = () => ({ style: {}, textContent: '' });
    app.document.getElementById = (id) => (registry[id] = registry[id] || live());
    await app.refreshBatchEntry();
    return app.document.getElementById('batchEntry').style.display;
  };
  await t.test('خطأ صريح (الجدول غير موجود)', async () => assert.equal(await run({ count: null, error: { message: 'relation does not exist' } }), 'none'));
  await t.test('بلا عدّ وبلا خطأ (HEAD صامت)', async () => assert.equal(await run({ count: null, error: null }), 'none'));
  await t.test('الجدول جاهز', async () => assert.equal(await run({ count: 0, error: null }), 'block'));
});

/* ---------- 4) التوصيل ---------- */
test('التوصيل: الشاشة تُخفى مع بقية الشاشات، والملف بـindex/sw، والإصدار متطابق', () => {
  assert.match(read('app/app-04-academic-crm.js'), /getElementById\('batchView'\)\.style\.display = 'none'/);
  assert.match(read('index.html'), /id="batchView"/);
  assert.match(read('index.html'), /app\/app-33-shahid-batch\.js/);
  assert.match(read('sw.js'), /\.\/app\/app-33-shahid-batch\.js/);
  const showBatch = read('app/app-33-shahid-batch.js').match(/async function showBatch\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(showBatch, /hideAllMainViews\(\)/);
  assert.match(showBatch, /getElementById\('batchView'\)\.style\.display = 'block'/);
});

test('المخطط والنسخ الاحتياطية تشمل shahid_drafts مع RLS للمالك', () => {
  const app = loadApp();
  const sql = app.buildSchemaSql();
  assert.match(sql, /create table if not exists public\.shahid_drafts/);
  assert.match(sql, /alter table public\.shahid_drafts enable row level security/);
  assert.match(sql, /on public\.shahid_drafts for all using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
  assert.match(app.buildSchemaSql('staging'), /create table if not exists staging\.shahid_drafts/);
  assert.match(read('sql-updates-run-in-supabase.sql'), /create table if not exists public\.shahid_drafts/);
  assert.match(read('app/app-07-backup-export.js'), /'lesson_plans', 'shahid_drafts'/, 'النسخة الكاملة (المسؤول)');
  assert.match(read('app/app-08-admin.js'), /from\('shahid_drafts'\)\.select\('\*'\)\.eq\('user_id', uid\)/, 'النسخة الشخصية بفلترة المالك');
  assert.match(read('app/app-08-admin.js'), /shahid_drafts: shahidDraftsRes\.data/);
});

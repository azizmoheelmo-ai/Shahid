'use strict';
/* ============================================================
   سلة المحذوفات (app-32-trash.js): لقطة قبل الحذف، تراجع = استرجاع، تأجيل مسح الصور
   ------------------------------------------------------------
   القواعد التي تحميها هذه الاختبارات (كل واحدة تفشل لو رُجّع الكود لما قبل السلة):
   1) لا حذف قبل نجاح حفظ اللقطة.
   2) تعذّر حفظ اللقطة: لا حذف إلا بموافقة صريحة، وبلا موافقة لا يتغيّر شيء.
   3) فشل الحذف بعد حفظ اللقطة: تُزال اللقطة (لا استرجاع لما لم يُحذف).
   4) اللقطة كاملة (كل الصفحات، لا أول 1000 صف) ولمالك السجل فقط.
   5) صور الشاهد لا تُمسح عند الحذف، وتُمسح عند الحذف النهائي/انتهاء المدة.
   6) نقرة مزدوجة = عنصر سلة واحد.
   7) حارس: كل موضع حذف لجدول محمي يمرّ عبر trashProtect.
   ============================================================ */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const { tick } = require('./trash-helpers');
const plain = x => JSON.parse(JSON.stringify(x));

/* عميل وهمي: يطبّق eq/in/range فعليًا (للتحقق من الصفحات والمالك)، ويسجّل كل شيء بترتيبه */
function makeClient(seed, opts) {
  opts = opts || {};
  const events = [];
  const items = [];
  const removed = [];
  const queries = [];
  const client = {
    events, items, removed, queries, rpcCalls: [],
    from(table) {
      const f = [];
      let op = 'select', values = null, from = 0, to = 999, single = false; /* كحد PostgREST الافتراضي: 1000 صف بلا range */
      const result = () => {
        if (table === 'deleted_items') {
          if (op === 'insert') {
            if (opts.failSnapshot) return { data: null, error: { message: 'relation "deleted_items" does not exist' } };
            const row = Object.assign({ id: 'T' + (items.length + 1) }, values);
            items.push(row); events.push('snapshot');
            return { data: single ? { id: row.id } : [row], error: null };
          }
          if (op === 'delete') {
            const idf = f.find(x => x[0] === 'id');
            events.push('snapshot-discarded');
            if (idf) { const i = items.findIndex(x => x.id === idf[1]); if (i > -1) items.splice(i, 1); }
            return { data: null, error: null };
          }
          const rows = items.filter(r => f.every(([c, v]) => r[c] === v));
          return { data: rows, error: null };
        }
        if (op === 'delete') {
          events.push('delete:' + table);
          if (opts.failDelete) return { data: null, error: { message: 'boom' } };
          return { data: (seed[table] || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v)), error: null };
        }
        if (op === 'select') {
          queries.push({ table, filters: f.slice(), from, to });
          const all = (seed[table] || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
          const rows = all.slice(from, to + 1);
          return { data: single ? (rows[0] || null) : rows, error: null };
        }
        return { data: null, error: null };
      };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; }, lt() { return api; }, neq() { return api; },
        range(a, b) { from = a; to = b; return api; },
        eq(c, v) { f.push([c, v]); return api; }, in(c, v) { f.push([c, v]); return api; },
        insert(r) { op = 'insert'; values = r; return api; },
        delete() { op = 'delete'; return api; },
        update() { op = 'update'; return api; },
        single() { single = true; return Promise.resolve(result()); },
        maybeSingle() { single = true; return Promise.resolve(result()); },
        then(res, rej) { return Promise.resolve(result()).then(res, rej); },
      };
      return api;
    },
    rpc(name, args) {
      client.rpcCalls.push({ name, args });
      if (name === 'restore_deleted_item') return Promise.resolve({ data: opts.restoreData || { kind: 'student', rows: 3, meta: {} }, error: opts.restoreError || null });
      return Promise.resolve({ data: null, error: null });
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({ remove: async (paths) => { removed.push(...paths); events.push('photos-removed'); return { error: opts.failPhotos ? { message: 'x' } : null }; }, upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
  return client;
}

function appFor(client, code, user) {
  const app = loadApp({ supabaseClient: client, currentUser: user || { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    showConfirm = async () => true;
    showUndoToast = async () => true;
    loadCrmStudents = async () => {}; renderCrmStudentsList = () => {};
    refreshCrmPendingBadges = async () => {}; refreshAcBadges = async () => {};
    ${code || ''}`);
  return app;
}

const STUDENT_SEED = () => ({
  classroom_students: [{ id: 'a', teacher_id: 'u1', full_name: 'أحمد', section_id: 'S' }],
  classroom_incidents: [{ id: 'i1', teacher_id: 'u1', student_id: 'a' }],
  classroom_grade_scores: [{ id: 'g1', teacher_id: 'u1', student_id: 'a', column_id: 'c', score: 5 }, { id: 'gx', teacher_id: 'u2', student_id: 'a', column_id: 'c', score: 1 }],
  classroom_followups: [{ id: 'f1', teacher_id: 'u1', student_id: 'a' }],
  classroom_followup_actions: [{ id: 'fa1', teacher_id: 'u1', followup_id: 'f1' }],
});

/* ============ دوال صرفة ============ */
test('trashDaysLeft — يُقرَّب للأعلى ولا ينزل عن صفر', () => {
  const app = loadApp();
  const now = Date.parse('2026-10-27T00:00:00Z');
  assert.equal(app.trashDaysLeft('2026-11-26T00:00:00Z', now), 30);
  assert.equal(app.trashDaysLeft('2026-10-27T05:00:00Z', now), 1);
  assert.equal(app.trashDaysLeft('2026-10-20T00:00:00Z', now), 0);
  assert.equal(app.trashDaysLeft('غير-صالح', now), 0);
});

test('trashPhotoPaths — مسارات الملفات من روابط photo_urls، وتتجاهل غير الصالح', () => {
  const app = loadApp();
  const base = 'https://x.supabase.co/storage/v1/object/public/shawahid-photos/';
  assert.deepEqual([...app.trashPhotoPaths([base + 'u1/a.jpg', base + 'u1/b%20c.jpg?t=1', 'https://other/z.jpg', null])], ['u1/a.jpg', 'u1/b c.jpg']);
  assert.deepEqual([...app.trashPhotoPaths(null)], []);
});

test('trashRestoreErrorMessage — رسائل واضحة بلغة المعلم', () => {
  const app = loadApp();
  assert.match(app.trashRestoreErrorMessage({ code: '23503' }), /لم يعد موجودًا/);
  assert.match(app.trashRestoreErrorMessage({ code: '23505' }), /نفس المعرّف/);
  assert.match(app.trashRestoreErrorMessage({ code: 'P0002' }), /لم يعد في المحذوفات/);
  assert.match(app.trashRestoreErrorMessage({ code: '42501', message: 'forbidden' }), /صلاحية/);
  assert.match(app.trashRestoreErrorMessage({ code: 'PGRST202' }), /غير مفعّلة/);
});

/* ============ اللقطة قبل الحذف ============ */
test('حذف طالب: اللقطة تُحفظ قبل الحذف، كاملة ولمالكها فقط، وبترتيب الاسترجاع (الأب أولًا)', async () => {
  const client = makeClient(STUDENT_SEED());
  const app = appFor(client);
  await app.deleteCrmStudent('a');
  await tick();
  assert.deepEqual(client.events.slice(0, 2), ['snapshot', 'delete:classroom_students']);
  const item = client.items[0];
  assert.equal(item.teacher_id, 'u1');
  assert.equal(item.kind, 'student');
  const order = plain(item.payload.tables).map(t => t.t);
  assert.equal(order[0], 'classroom_students', 'الطالب أولًا');
  assert.ok(order.indexOf('classroom_followup_actions') > order.indexOf('classroom_followups'));
  const rows = t => plain(item.payload.tables.find(x => x.t === t).rows).map(r => r.id);
  assert.deepEqual(rows('classroom_grade_scores'), ['g1'], 'درجات معلمه فقط، لا درجات معلم آخر');
  assert.deepEqual(rows('classroom_followup_actions'), ['fa1']);
});

test('اللقطة تجلب كل الصفحات (أكثر من 1000 صف) لا أول صفحة فقط', async () => {
  const seed = STUDENT_SEED();
  seed.classroom_grade_scores = Array.from({ length: 2500 }, (_, i) => ({ id: 'g' + i, teacher_id: 'u1', student_id: 'a', column_id: 'c', score: 1 }));
  const client = makeClient(seed);
  const app = appFor(client);
  await app.deleteCrmStudent('a');
  const spec = client.items[0].payload.tables.find(t => t.t === 'classroom_grade_scores');
  assert.equal(spec.rows.length, 2500);
});

test('قائمة in(...) الطويلة تُقسَّم لطلبات صغيرة (حد طول الرابط)', async () => {
  const ids = Array.from({ length: 230 }, (_, i) => 'c' + i);
  const seed = { classroom_grade_columns: ids.map(id => ({ id, teacher_id: 'u1', name: 'ع' })), classroom_grade_scores: [], classroom_grade_period_scores: [] };
  const client = makeClient(seed);
  const app = appFor(client);
  const cap = await app.trashCaptureGradeColumns(ids, 'u1');
  assert.equal(cap.tables[0].rows.length, 230);
  const inQueries = client.queries.filter(q => q.table === 'classroom_grade_columns');
  assert.equal(inQueries.length, 3, '230 معرّفًا = 3 طلبات (100+100+30)');
  assert.ok(inQueries.every(q => q.filters.find(x => x[0] === 'teacher_id' && x[1] === 'u1')), 'كل طلب مقيَّد بالمالك');
});

/* ============ فشل حفظ اللقطة / فشل الحذف ============ */
test('تعذّر حفظ اللقطة وبدون موافقة: لا حذف ولا يتغيّر شيء', async () => {
  const client = makeClient(STUDENT_SEED(), { failSnapshot: true });
  const app = appFor(client, `
    window.__confirms = []; showConfirm = async (m) => { window.__confirms.push(m); return window.__confirms.length === 1; };`);
  await app.deleteCrmStudent('a');
  assert.ok(!client.events.some(e => e.startsWith('delete:')), 'لا حذف');
  assert.match(runInAppContext(app, 'window.__confirms[1]'), /تعذّر حفظ نسخة/);
});

test('تعذّر حفظ اللقطة وبموافقة صريحة على الحذف النهائي: يُحذف', async () => {
  const client = makeClient(STUDENT_SEED(), { failSnapshot: true });
  const app = appFor(client);
  await app.deleteCrmStudent('a');
  assert.ok(client.events.includes('delete:classroom_students'));
  assert.equal(client.items.length, 0);
});

test('فشل الحذف بعد حفظ اللقطة: اللقطة تُزال (لا عنصر يُغري باسترجاع ما لم يُحذف)', async () => {
  const client = makeClient(STUDENT_SEED(), { failDelete: true });
  const app = appFor(client);
  await app.deleteCrmStudent('a');
  assert.deepEqual(client.events.slice(0, 3), ['snapshot', 'delete:classroom_students', 'snapshot-discarded']);
  assert.equal(client.items.length, 0);
});

test('نقرتان متتاليتان على حذف الطالب = عنصر سلة واحد', async () => {
  const client = makeClient(STUDENT_SEED());
  const app = appFor(client);
  await Promise.all([app.deleteCrmStudent('a'), app.deleteCrmStudent('a')]);
  assert.equal(client.items.length, 1);
  assert.equal(client.events.filter(e => e === 'delete:classroom_students').length, 1);
});

/* ============ التراجع = استرجاع ============ */
test('«تراجع» بعد الحذف يستدعي restore_deleted_item بمعرّف عنصر السلة ويحدّث القوائم', async () => {
  const client = makeClient(STUDENT_SEED());
  const app = appFor(client, `showUndoToast = async () => false; window.__reloads = 0; loadCrmStudents = async () => { window.__reloads++; };`);
  await app.deleteCrmStudent('a');
  await tick();
  assert.deepEqual(client.rpcCalls.map(c => [c.name, c.args.p_id]), [['restore_deleted_item', 'T1']]);
  assert.ok(runInAppContext(app, 'window.__reloads') >= 2, 'القائمة أُعيد تحميلها بعد الحذف وبعد الاسترجاع');
  assert.ok(runInAppContext(app, 'window.__toasts').some(t => /تم التراجع/.test(t)));
});

test('فشل الاسترجاع يظهر للمعلم برسالة مفهومة ولا يُحدّث القوائم', async () => {
  const client = makeClient(STUDENT_SEED(), { restoreError: { code: '23503', message: 'fk' } });
  const app = appFor(client, `showUndoToast = async () => false;`);
  await app.deleteCrmStudent('a');
  await tick();
  assert.ok(runInAppContext(app, 'window.__toasts').some(t => /^error:.*لم يعد موجودًا/.test(t)));
});

test('الاسترجاع المزدوج لنفس العنصر يُمنع', async () => {
  const client = makeClient({});
  const app = appFor(client);
  const [a, b] = await Promise.all([app.trashRestoreItem('T9'), app.trashRestoreItem('T9')]);
  assert.equal(client.rpcCalls.length, 1);
  assert.ok(a.data || b.data);
  assert.ok(a.error || b.error);
});

/* ============ الشاهد: الصور تبقى حتى انتهاء المدة ============ */
const PHOTO = 'https://x.supabase.co/storage/v1/object/public/shawahid-photos/u1/p1.jpg';
function shahidSeed() {
  return { shawahid: [{ id: 's1', user_id: 'u1', lesson_title: 'درس', photo_urls: [PHOTO], program_id: null }] };
}
const SHAHID_CODE = `myRecords = [{ id: 's1', user_id: 'u1', lesson_title: 'درس', photo_urls: ['${PHOTO}'] }]; filterMyShawahid = () => {}; loadMyShawahid = async () => {};`;

test('حذف شاهد: الصور لا تُمسح من التخزين، ومساراتها محفوظة بعنصر السلة', async () => {
  const client = makeClient(shahidSeed());
  const app = appFor(client, SHAHID_CODE);
  await app.deleteRecord('s1');
  await tick();
  assert.deepEqual(client.events.slice(0, 2), ['snapshot', 'delete:shawahid']);
  assert.deepEqual([...client.items[0].photo_paths], ['u1/p1.jpg']);
  assert.deepEqual(client.removed, [], 'لا مسح للصور عند الحذف');
  assert.ok(!client.events.includes('photos-removed'));
});

test('حذف شاهد بلا سلة (بموافقة المعلم): الصور تُمسح فورًا كما كان', async () => {
  const client = makeClient(shahidSeed(), { failSnapshot: true });
  const app = appFor(client, SHAHID_CODE);
  await app.deleteRecord('s1');
  assert.deepEqual(client.removed, ['u1/p1.jpg']);
});

test('شاهد محذوف أصلًا من جهاز آخر: لا تُمسح صوره (هي في سلة ذلك الحذف)', async () => {
  const client = makeClient({ shawahid: [] }); /* غير موجود بالقاعدة */
  const app = appFor(client, SHAHID_CODE);
  await app.deleteRecord('s1');
  assert.deepEqual(client.removed, [], 'لا مسح لصور سلة جهاز آخر');
  assert.equal(client.items.length, 0, 'ولا عنصر سلة مكرر');
});

test('استرجاع المسؤول لعنصر معلم: لا تحديثات محلية على حساب غيره، ويصل للقاعدة', async () => {
  const client = makeClient({}, { restoreData: { kind: 'shahid', rows: 1, meta: { programSession: { programId: 'P', sessionNo: 1 }, shahidId: 's1' } } });
  const app = appFor(client, `window.__marked = 0; markProgramSessionDone = async () => { window.__marked++; };`, { id: 'admin1' });
  await app.trashRestoreItem('T5', 'u7');
  assert.equal(client.rpcCalls.length, 1);
  assert.equal(runInAppContext(app, 'window.__marked'), 0);
  await app.trashRestoreItem('T6', 'admin1');
  assert.equal(runInAppContext(app, 'window.__marked'), 1, 'استرجاع صاحب العنصر يعيد ربط حصة البرنامج');
});

test('حذف شاهد يوثّق حصة برنامج: تاريخ التوثيق الأصلي يُحفظ بالسلة لإعادة الربط', async () => {
  const seed = { shawahid: [{ id: 's1', user_id: 'u1', lesson_title: 'درس', photo_urls: [], program_id: 'P', program_session_no: 2, program_section_id: null }],
    activity_programs: [{ id: 'P', sessions: [{ session_no: 2, done: true, done_date: '2026-10-01', shahid_id: 's1' }] }] };
  const client = makeClient(seed);
  const app = appFor(client, `myRecords = [{ id: 's1', user_id: 'u1', lesson_title: 'درس', photo_urls: [], program_id: 'P', program_session_no: 2, program_section_id: null }];
    filterMyShawahid = () => {}; clearProgramSessionLink = async () => null; activityPrograms = [];`);
  await app.deleteRecord('s1');
  const meta = client.items[0].payload.meta;
  assert.equal(meta.programSession.programId, 'P');
  assert.equal(meta.programSession.doneDate, '2026-10-01');
});

test('الحذف النهائي من السلة يمسح الصور ثم العنصر، وإن فشل مسح الصور يبقى العنصر', async () => {
  const client = makeClient({});
  client.items.push({ id: 'T1', teacher_id: 'u1', label: 'شاهد', photo_paths: ['u1/p1.jpg'] });
  const app = appFor(client, `trashItems = [{ id: 'T1', label: 'شاهد', photo_paths: ['u1/p1.jpg'] }]; loadTrash = async () => {}; trashSetRowBusy = () => {};`);
  await app.purgeTrashItem('T1');
  assert.deepEqual(client.events.slice(0, 2), ['photos-removed', 'snapshot-discarded']);

  const bad = makeClient({}, { failPhotos: true });
  bad.items.push({ id: 'T1', teacher_id: 'u1', photo_paths: ['u1/p1.jpg'] });
  const app2 = appFor(bad, `trashItems = [{ id: 'T1', label: 'شاهد', photo_paths: ['u1/p1.jpg'] }]; loadTrash = async () => {}; trashSetRowBusy = () => {};`);
  await app2.purgeTrashItem('T1');
  assert.equal(bad.items.length, 1, 'لا نُيتّم الصور بحذف العنصر قبل مسحها');
});

test('تنظيف المنتهي: يمسح صور المنتهي ثم عنصره، ويتخطى ما تعذّر مسح صوره', async () => {
  const client = makeClient({});
  client.items.push({ id: 'T1', teacher_id: 'u1', photo_paths: ['u1/a.jpg'], expires_at: '2020-01-01T00:00:00Z' });
  // المحاكاة تُرجع كل عناصر المالك؛ المهم ترتيب العمليات
  const app = appFor(client);
  const n = await app.trashPurgeExpired();
  assert.equal(n, 1);
  assert.deepEqual(client.events.slice(0, 2), ['photos-removed', 'snapshot-discarded']);
});

/* ============ حذف المسؤول: اللقطة باسم صاحب الشاهد ============ */
test('حذف المسؤول لشاهد معلم: اللقطة teacher_id = صاحب الشاهد، لا المسؤول', async () => {
  const client = makeClient({ shawahid: [{ id: 's9', user_id: 'u7', lesson_title: 'ش', photo_urls: [] }] });
  const app = appFor(client, `adminAllRecords = [{ id: 's9', user_id: 'u7' }]; showAdminPanel = async () => {};`, { id: 'admin1' });
  await app.adminDeleteRecord('s9');
  assert.equal(client.items[0].teacher_id, 'u7');
  assert.deepEqual(client.events.slice(0, 2), ['snapshot', 'delete:shawahid']);
});

/* ============ البرنامج والهدف: إعادة الربط ============ */
test('حذف برنامج: اللقطة تحفظ روابط شواهده ومهامه لإعادة ربطها', async () => {
  const seed = {
    activity_programs: [{ id: 'P', user_id: 'u1', name: 'برنامج' }],
    program_sections: [{ id: 'ps1', teacher_id: 'u1', program_id: 'P', section_id: 'S' }],
    shawahid: [{ id: 's1', user_id: 'u1', program_id: 'P' }, { id: 's2', user_id: 'u1', program_id: 'Q' }],
    tasks: [{ id: 't1', user_id: 'u1', linked_program_id: 'P' }],
  };
  const client = makeClient(seed);
  const app = appFor(client, `activityPrograms = []; showPrograms = async () => {};`);
  await app.deleteActivityProgram('P');
  const payload = client.items[0].payload;
  assert.deepEqual(plain(payload.relinks).map(r => [r.t, r.col, r.ids, r.val]), [['shawahid', 'program_id', ['s1'], 'P'], ['tasks', 'linked_program_id', ['t1'], 'P']]);
  assert.deepEqual(plain(payload.tables).map(t => t.t), ['activity_programs', 'program_sections']);
});

/* ============ الدرجات والأدوات ============ */
test('حذف أداة مخصصة: اللقطة تحوي الأداة وأعمدتها ودرجاتها ورصدها بترتيب الاسترجاع', async () => {
  const seed = {
    classroom_custom_tools: [{ id: 'TL', teacher_id: 'u1', name: 'قراءة' }],
    classroom_grade_columns: [{ id: 'c1', teacher_id: 'u1', tool_id: 'TL' }],
    classroom_grade_scores: [{ id: 'g1', teacher_id: 'u1', column_id: 'c1' }],
    classroom_grade_period_scores: [],
    classroom_tool_marks: [{ id: 'm1', teacher_id: 'u1', tool_id: 'TL' }, { id: 'mx', teacher_id: 'u2', tool_id: 'TL' }],
  };
  const client = makeClient(seed);
  const app = appFor(client, `customToolById = id => ({ id, name: 'قراءة' }); closeCrmModal = () => {}; afterCustomToolsChanged = async () => {};`);
  await app.deleteCustomTool('TL');
  const item = client.items[0];
  assert.deepEqual(plain(item.payload.tables).map(t => t.t), ['classroom_custom_tools', 'classroom_grade_columns', 'classroom_grade_scores', 'classroom_tool_marks'], 'الفارغ لا يُحفظ');
  assert.deepEqual(plain(item.payload.tables[3].rows).map(r => r.id), ['m1']);
});

/* ============ الشاشة ============ */
test('شاشة المحذوفات: النصوص القادمة من القاعدة تمرّ عبر escapeHtml (اسم طالب خبيث)', async () => {
  const client = makeClient({});
  const app = appFor(client, `trashItems = [{ id: 'T1"><script>x()</script>', teacher_id: 'u1', kind: 'student', label: '<img src=x onerror=alert(1)>', deleted_at: '2026-10-20T00:00:00Z', expires_at: '2026-11-19T00:00:00Z', photo_paths: [] }]; trashScope = 'mine';`);
  runInAppContext(app, 'renderTrashList({})');
  const html = app.document.getElementById('trashList').innerHTML;
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('شاشة المحذوفات: «حذف نهائي» لعناصري فقط (ليس في تبويب محذوفات المعلمين)', async () => {
  const client = makeClient({});
  const app = appFor(client, `trashItems = [{ id: 'T1', teacher_id: 'u2', kind: 'student', label: 'ط', deleted_at: '2026-10-20T00:00:00Z', expires_at: '2026-11-19T00:00:00Z', photo_paths: [] }]; trashScope = 'others';`);
  runInAppContext(app, 'renderTrashList({ u2: "معلم" })');
  const html = app.document.getElementById('trashList').innerHTML;
  assert.match(html, /data-trash-restore/);
  assert.doesNotMatch(html, /data-trash-purge/);
});

test('شاشة المحذوفات: غير المسؤول لا يستطيع تبديل النطاق إلى «محذوفات المعلمين»', async () => {
  const client = makeClient({});
  const app = appFor(client, `isAdmin = false; trashScope = 'mine'; loadTrash = async () => {};`);
  runInAppContext(app, `setTrashScope('others')`);
  assert.equal(runInAppContext(app, 'trashScope'), 'mine');
});

/* ============ حارس: كل موضع حذف لجدول محمي يمرّ عبر السلة ============ */
test('حارس: كل .delete() لجدول محمي داخل دالة تستدعي trashProtect (أو مستثناة بسبب مكتوب)', () => {
  const dir = path.join(__dirname, '..', 'app');
  const PROTECTED = ['classroom_students', 'shawahid', 'activity_programs', 'performance_goals', 'tasks', 'academic_cases', 'classroom_incidents',
    'classroom_positive_notes', 'classroom_private_notes', 'classroom_grade_columns', 'classroom_custom_tools', 'classroom_tasks',
    'classroom_homework', 'classroom_lessons'];
  /* مستثنى عمدًا (الدالة : السبب) */
  const EXEMPT = {
    offerCrmIncidentUndo: 'تراجع عن تسجيل مخالفة أُنشئت قبل ثوانٍ، لا حذف لبيانات قديمة',
    trashDiscard: 'حذف عنصر السلة نفسه',
    saveCrmTask: 'تراجع عن مهمة أُنشئت للتوّ لو فشل تكليف طلابها (تُزال ليعيد المعلم المحاولة نظيفة)',
  };
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/\.from\('([a-z_]+)'\)\.delete\(/) || (/\.from\('([a-z_]+)'\)\s*$/.test(l) && /^\s*\.delete\(/.test(lines[i + 1] || '') ? l.match(/\.from\('([a-z_]+)'\)/) : null);
      if (!m || !PROTECTED.includes(m[1])) return;
      let s = i; while (s > 0 && !/^(async )?function /.test(lines[s])) s--;
      let e = i; while (e < lines.length - 1 && !/^}/.test(lines[e])) e++;
      const fn = (lines[s].match(/function (\w+)/) || [])[1];
      const body = lines.slice(s, e + 1).join('\n');
      if (EXEMPT[fn]) return;
      if (!/trashProtect\(/.test(body)) offenders.push(`${file}:${i + 1} ${fn} يحذف ${m[1]} بلا trashProtect`);
    });
  }
  assert.deepEqual(offenders, []);
});

/* ============ SQL والنسخ الاحتياطي ============ */
test('SQL: جدول deleted_items وRLS ودالة الاسترجاع موجودة في المخطط وملف التحديثات، ولا ثقة بمالك اللقطة', () => {
  const root = path.join(__dirname, '..');
  const upd = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
  const schema = loadApp().buildSchemaSql();
  for (const sql of [upd, schema]) {
    assert.match(sql, /create table if not exists public\.deleted_items/);
    assert.match(sql, /alter table public\.deleted_items enable row level security/);
    assert.match(sql, /create or replace function public\.restore_deleted_item/);
    assert.match(sql, /expires_at timestamptz not null default now\(\) \+ interval '30 days'/);
    /* المالك يُفرض من سجل السلة لا من اللقطة */
    assert.match(sql, /jsonb_build_object\(v_owner, v_item\.teacher_id\)/);
    /* قائمة جداول مسموحة، ولا admins ولا auth */
    assert.match(sql, /v_allowed text\[\] := array\[/);
    assert.doesNotMatch(sql.match(/v_allowed text\[\] := array\[[\s\S]*?\];/)[0], /admins|profiles|audit_log/);
    assert.match(sql, /revoke execute on function public\.restore_deleted_item\(uuid\) from public, anon/);
  }
  /* أسماء السياسات العربية أقصر من حد 63 بايت لـ PostgreSQL (وإلا تُقطع وتتصادم بصمت) */
  for (const m of schema.matchAll(/create policy "([^"]+)"\s+on public\.deleted_items/g)) {
    assert.ok(Buffer.byteLength(m[1], 'utf8') <= 63, 'اسم سياسة أطول من 63 بايت: ' + m[1]);
  }
});

test('النسخ الاحتياطي يشمل deleted_items (الشاملة والشخصية) ودليل الاستعادة', () => {
  const root = path.join(__dirname, '..', 'app');
  assert.match(fs.readFileSync(path.join(root, 'app-07-backup-export.js'), 'utf8'), /'classroom_tool_marks', 'deleted_items'\]/);
  assert.match(fs.readFileSync(path.join(root, 'app-07-backup-export.js'), 'utf8'), /41\. deleted_items\.csv/);
  const a08 = fs.readFileSync(path.join(root, 'app-08-admin.js'), 'utf8');
  assert.match(a08, /sb\.from\('deleted_items'\)\.select\('\*'\)\.eq\('teacher_id', uid\)/);
  assert.match(a08, /deleted_items: deletedItemsRes\.data/);
});

test('الملف الجديد في index.html وAPP_SHELL، وإصدارات الإصدار متطابقة', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-32-trash\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /\.\/app\/app-32-trash\.js/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /id="settingsTrashBody"/);
  assert.match(fs.readFileSync(path.join(root, 'app', 'app-03-auth-home-risk.js'), 'utf8'), /trash: 'settingsTrashBody'/);
});

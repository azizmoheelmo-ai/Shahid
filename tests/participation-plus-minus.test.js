'use strict';
/* ============================================================
   المشاركة والعدّادات: زرّا + و − داخل مستطيل كل طالب (بطلب صاحب التطبيق).
   - + يزيد و − ينقص في الوضعين (يبدأ من 0 أو من الكاملة)، ولا تحت الصفر ولا فوق الكاملة.
   - "ما تغيّر اليوم" صافٍ (+2 أو −1)، والتراجع يعكس اتجاه آخر نقرة بدقة.
   - سجل الأجهزة القديم (نقرات باتجاه الوضع فقط) يُقرأ كما هو.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

function client(log, opts){
  opts = opts || {};
  return {
    from(){ const a = { select: () => a, eq: () => a, in: () => a, order: () => a, limit: () => a, upsert: () => a,
      then: (r) => Promise.resolve({ data: [], error: null }).then(r) }; return a; },
    rpc(name, args){ log.push({ name, args }); return Promise.resolve(opts.fail ? { data: null, error: { message: 'offline' } } : { data: opts.value !== undefined ? opts.value : 0, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
}
const get = (app, e) => runInAppContext(app, e);

function sheet(opts){
  const log = [];
  const app = loadApp({ supabaseClient: client(log, opts), currentUser: { id: 'u1' } });
  const full = !!(opts && opts.full);
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__tiles = {};
    const _g = document.getElementById;
    document.getElementById = id => {
      if(id.indexOf('crmPart_') !== 0) return _g(id);
      if(!window.__tiles[id]){
        const val = { innerHTML: '' }, chip = { innerHTML: '' }, cls = new Set();
        window.__tiles[id] = { val, chip, classList: { toggle: (c, on) => on ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) },
          querySelector: q => q === '.crm-part-val' ? val : q === '.crm-part-chip' ? chip : null };
      }
      return window.__tiles[id];
    };
    crmSheet = { sectionId: 'S', dateIso: '2026-10-20', period: 1, states: {}, token: 1, mode: 'participation',
      part: { column: { id: 'C', name: 'مشاركة', max_score: 10 }, scores: new Map(${JSON.stringify((opts && opts.scores) || [['a', 5]])}),
        today: ${JSON.stringify((opts && opts.today) || {})}, undo: ${JSON.stringify((opts && opts.undo) || [])}, queue: new Map(), toolId: null, full: ${full}, step: ${full ? -1 : 1} } };`);
  return { app, log };
}
const chip = (app, id) => get(app, `window.__tiles['crmPart_${id}'] ? window.__tiles['crmPart_${id}'].chip.innerHTML : ''`);
const settle = app => get(app, 'Promise.all([...crmSheet.part.queue.values()])');

test('يبدأ من 0 — زر − ينقص درجة (−1 صافٍ اليوم)، والتراجع يعيدها (+1)', async () => {
  const { app, log } = sheet({ value: 4 });
  app.tapCrmParticipation('a', -1);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 4, 'عرض فوري');
  assert.match(chip(app, 'a'), /class="crm-part-today is-minus" dir="ltr">−1</);
  await settle(app);
  assert.deepEqual(JSON.parse(JSON.stringify(log[0].args)), { p_column_id: 'C', p_student_id: 'a', p_delta: -1 });
  assert.deepEqual([...get(app, 'crmSheet.part.undo')], ['~a']);
  app.tapCrmParticipation('a', 1);
  app.tapCrmParticipation('a', 1);
  assert.match(chip(app, 'a'), /dir="ltr">\+1</, 'صافي اليوم: −1 +1 +1 = +1');
  app.undoCrmParticipation();
  app.undoCrmParticipation();
  app.undoCrmParticipation();
  await settle(app);
  assert.deepEqual(log.map(l => l.args.p_delta), [-1, 1, 1, -1, -1, 1], 'كل تراجع يعكس نقرته');
  assert.equal(chip(app, 'a'), '', 'لا تغيّر اليوم');
  assert.equal(get(app, 'crmSheet.part.undo.length'), 0);
});

test('يبدأ من الكاملة — زر + يزيد (والصفر يبقى درجة حقيقية)، و− ينقص', async () => {
  const { app, log } = sheet({ full: true, scores: [['a', 6]], value: 7 });
  app.tapCrmParticipation('a', 1);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 7);
  assert.match(chip(app, 'a'), /dir="ltr">\+1</);
  await settle(app);
  assert.deepEqual(JSON.parse(JSON.stringify(log[0].args)), { p_column_id: 'C', p_student_id: 'a', p_delta: 1, p_keep_zero: true });
  assert.deepEqual([...get(app, 'crmSheet.part.undo')], ['~a']);
  app.tapCrmParticipation('a', -1);
  app.tapCrmParticipation('a', -1);
  assert.match(chip(app, 'a'), /is-minus" dir="ltr">−1</);
  assert.deepEqual([...get(app, 'crmSheet.part.undo')], ['~a', 'a', 'a']);
});

test('لا تحت الصفر ولا فوق الكاملة — لا نقرة تُرسل', async () => {
  const { app, log } = sheet({ scores: [['a', 10]] });
  app.tapCrmParticipation('a', 1);
  app.tapCrmParticipation('b', -1);
  assert.equal(log.length, 0);
  assert.match(get(app, 'window.__toasts.join("|")'), /اكتملت/);
  assert.match(get(app, 'window.__toasts.join("|")'), /صفر/);
});

test('سجل الجهاز القديم (يبدأ من الكاملة: عدّاد موجب ونقرات بلا "~") يُقرأ صحيحًا: −2، والتراجع +1', async () => {
  const { app, log } = sheet({ full: true, scores: [['a', 8]], today: { a: 2 }, undo: ['a', 'a'], value: 9 });
  app.paintCrmParticipation('a');
  assert.match(chip(app, 'a'), /is-minus" dir="ltr">−2</);
  app.undoCrmParticipation();
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 9);
  await settle(app);
  assert.equal(log[0].args.p_delta, 1);
  assert.match(chip(app, 'a'), /−1</);
});

test('انحدار: نقرة − فشل حفظها تعود في العرض والعدّاد وسجل التراجع', async () => {
  const { app } = sheet({ fail: true });
  app.tapCrmParticipation('a', 1);
  app.tapCrmParticipation('a', -1);
  await settle(app);
  await settle(app);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 5);
  assert.equal(get(app, 'crmSheet.part.undo.length'), 0);
  assert.equal(get(app, 'crmSheet.part.today.a'), 0);
});

test('المستطيل: زرّا + و − بالطالب نفسه (الاسم مُهرَّب)، و"ما تغيّر اليوم" بجانب الاسم', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: client(log), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    appFeatures = { sections: {}, tools: {} };
    crmStudents = [{ id: 'a', full_name: 'سامي <b>علي</b>', section_id: 'S' }];
    findKindColumn = async () => ({ id: 'C', name: 'مشاركة', max_score: 10 });
    crmSheet = { sectionId: 'S', dateIso: '2026-10-20', period: 1, states: {}, token: 1, mode: 'participation' };`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  const h = get(app, `document.getElementById('crmLessonSheetBody').innerHTML`);
  assert.match(h, /<span class="crm-att-name">سامي &lt;b&gt;علي&lt;\/b&gt;<span class="crm-part-chip"><\/span><\/span>/);
  assert.match(h, /aria-label="\+1 سامي &lt;b&gt;علي&lt;\/b&gt;" onclick="tapCrmParticipation\('a', 1\)">\+<\/button>/);
  assert.match(h, /onclick="tapCrmParticipation\('a', -1\)">−<\/button>/);
  assert.doesNotMatch(h, /<b>علي<\/b>/);
});

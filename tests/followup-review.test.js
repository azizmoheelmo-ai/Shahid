'use strict';
/* نافذة مراجعة المتابعة المبسَّطة (قرار واحد) + شاشة الاتفاق بلا زر «إغلاق» كبير (3.36). */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const ROW = { id: 'f1', teacher_id: 'u1', student_id: 's1', reason_type: 'other', reason_text: 'واجبات', review_date: '2026-11-10', status: 'open', group_id: null, agreement: null, created_at: '2026-10-20T10:00:00Z', baseline: null };

function make(row){
  const log = { updates: [], inserts: [] };
  const client = {
    from(table){
      const filters = []; let op = 'select', payload = null;
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; }, in(){ return api; },
        update(p){ op = 'update'; payload = p; return api; }, insert(p){ op = 'insert'; payload = p; return api; },
        eq(c, v){ filters.push([c, v]); return api; },
        maybeSingle: async () => ({ data: table === 'classroom_followups' ? row : null, error: null }),
        then(res){
          if(op === 'update'){ log.updates.push({ table, payload, filters }); return Promise.resolve({ data: row.status === 'open' ? [{ id: row.id }] : [], error: null }).then(res); }
          if(op === 'insert'){ log.inserts.push({ table, payload }); return Promise.resolve({ data: null, error: null }).then(res); }
          return Promise.resolve({ data: [], error: null }).then(res);
        }
      };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m); refreshAttentionViews = async () => {}; crmStudents = [{ id: 's1', full_name: 'سالم بن أحمد' }];
    document.getElementById('crmFollowupsBody'); `);
  return { app, log };
}
const msg = (app) => app.document.getElementById('confirmMsg').innerHTML;

test('نافذة المراجعة: قرار واحد (3 نتائج)، والتمديد والإجراءات مطويان، ولا قائمة منسدلة للقرار التالي', async () => {
  const { app } = make({ ...ROW });
  await app.openCrmReviewModal('f1');
  const h = msg(app);
  assert.match(h, /ما نتيجة المتابعة؟/);
  assert.equal((h.match(/class="btn [^"]*rv-out"/g) || []).length, 3);
  assert.equal((h.match(/rv-next/g) || []).length, 3, 'ثلاثة أزرار قرار تالٍ');
  assert.equal((h.match(/<details/g) || []).length, 2);
  assert.doesNotMatch(h, /id="crmNextStep"/);
  assert.match(h, /openFollowupAgreement\('f1'\)/);
});

test('«لم يتحسّن»: لا يُغلق قبل اختيار القرار التالي، ثم يُغلق به مقيَّدًا بالمعلم والمفتوحة', async () => {
  const { app, log } = make({ ...ROW });
  await app.openCrmReviewModal('f1');
  runInAppContext(app, `document.getElementById('crmNextStepBox').style.display = 'none'`);
  await app.closeCrmFollowup('not_improved');
  assert.equal(log.updates.length, 0);
  assert.equal(app.document.getElementById('crmNextStepBox').style.display, 'block');
  await app.closeCrmFollowup('not_improved', true, 'bogus');
  assert.equal(log.updates.length, 0, 'قرار غير معروف لا يُحفظ');
  await app.closeCrmFollowup('not_improved', true, 'no_action');
  assert.equal(log.updates.length, 1);
  assert.equal(log.updates[0].payload.next_step, 'no_action');
  assert.equal(log.updates[0].payload.outcome, 'not_improved');
  assert.ok(log.updates[0].filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'));
  assert.ok(log.updates[0].filters.some(([c, v]) => c === 'status' && v === 'open'));
});

test('تحسّن: يُغلق بلا قرار تالٍ', async () => {
  const { app, log } = make({ ...ROW });
  await app.openCrmReviewModal('f1');
  await app.closeCrmFollowup('improved');
  assert.equal(log.updates[0].payload.next_step, null);
});

test('التمديد: يحدّث الموعد وحده (لا إجراء)، ومتابعة أُغلقت لا تُمدَّد', async () => {
  const { app, log } = make({ ...ROW });
  await app.openCrmReviewModal('f1');
  app.document.getElementById('crmRvDate').value = '2099-01-01';
  await app.extendCrmFollowup();
  assert.deepEqual(Object.keys(log.updates[0].payload), ['review_date']);
  assert.equal(log.inserts.length, 0);
  assert.ok(log.updates[0].filters.some(([c, v]) => c === 'status' && v === 'open'));

  const closed = make({ ...ROW, status: 'closed' });
  await closed.app.openCrmReviewModal('f1');
  closed.app.document.getElementById('crmRvDate').value = '2099-01-01';
  await closed.app.extendCrmFollowup();
  assert.ok(runInAppContext(closed.app, 'window.__toasts').some(t => /أُغلقت/.test(t)));
});

test('إضافة إجراء: إدراج واحد بمعرّف المعلم، والنقرة المزدوجة لا تكرّره', async () => {
  const { app, log } = make({ ...ROW });
  await app.openCrmReviewModal('f1');
  app.document.getElementById('crmRvAction').value = 'reteach';
  await Promise.all([app.addCrmFollowupAction(), app.addCrmFollowupAction()]);
  assert.equal(log.inserts.length, 1);
  assert.equal(log.inserts[0].payload.teacher_id, 'u1');
  assert.equal(log.inserts[0].payload.action_type, 'reteach');
});

test('شاشة الاتفاق: بلا زر «إغلاق» العام، بنقاط تقدّم، وخروج خافت، ونوافذ المشروع الأخرى تستعيد الزر', async () => {
  const { app } = make({ ...ROW });
  await app.openFollowupAgreement('f1');
  assert.equal(app.document.getElementById('confirmCancelBtn').style.display, 'none');
  const h = app.document.getElementById('faRoot').innerHTML;
  assert.match(h, /fa-dots/);
  assert.doesNotMatch(h, /من ٣|fa-prog/);
  assert.match(h, /faExit\(\)/);
  app.faExit();
  assert.equal(runInAppContext(app, 'faDraft'), null);
  app.showInfoModal('x');
  assert.equal(app.document.getElementById('confirmCancelBtn').style.display, '');
});

/* ===== حذف المتابعة عبر سلة المحذوفات ===== */
function makeTrash(opts){
  opts = opts || {};
  const ev = [];
  const seed = {
    classroom_followups: [{ ...ROW }, { ...ROW, id: 'other', teacher_id: 'u2' }],
    classroom_followup_actions: [{ id: 'a1', followup_id: 'f1', teacher_id: 'u1' }, { id: 'a9', followup_id: 'f1', teacher_id: 'u2' }]
  };
  const client = {
    from(table){
      const f = []; let op = 'select', values = null, single = false;
      const run = () => {
        if(table === 'deleted_items' && op === 'insert'){ ev.push({ k: 'snapshot', values }); return { data: { id: 'T1' }, error: null }; }
        if(table === 'deleted_items' && op === 'delete'){ ev.push({ k: 'discard' }); return { data: null, error: null }; }
        if(op === 'delete'){ ev.push({ k: 'delete', table, f: f.slice() }); return opts.failDelete ? { data: null, error: { message: 'boom' } } : { data: null, error: null }; }
        const rows = (seed[table] || []).filter(r => f.every(([c, v]) => r[c] === v));
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; }, range(){ return api; }, in(){ return api; },
        eq(c, v){ f.push([c, v]); return api; },
        insert(v){ op = 'insert'; values = v; return api; }, delete(){ op = 'delete'; return api; },
        single(){ single = true; return Promise.resolve(run()); }, maybeSingle(){ single = true; return Promise.resolve(run()); },
        then(res){ return Promise.resolve(run()).then(res); }
      };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m); refreshAttentionViews = async () => {};
    showConfirm = async () => ${opts.cancel ? 'false' : 'true'}; window.__undo = []; trashOfferUndo = (m, id) => window.__undo.push(id);
    crmStudents = [{ id: 's1', full_name: 'سالم' }];`);
  return { app, ev };
}

test('حذف المتابعة: لقطة (المتابعة وإجراءات المعلم وحده) قبل الحذف، والحذف مقيَّد بالمعلم، وعرض «تراجع»', async () => {
  const { app, ev } = makeTrash();
  await app.deleteCrmFollowup('f1');
  assert.deepEqual(ev.map(e => e.k), ['snapshot', 'delete']);
  const snap = ev[0].values;
  assert.equal(snap.kind, 'followup');
  assert.equal(snap.teacher_id, 'u1');
  const t = Object.fromEntries(snap.payload.tables.map(x => [x.t, x.rows.map(r => r.id)]));
  assert.deepEqual(JSON.parse(JSON.stringify(t)), { classroom_followups: ['f1'], classroom_followup_actions: ['a1'] });
  assert.deepEqual(JSON.parse(JSON.stringify(ev[1].f)), [['id', 'f1'], ['teacher_id', 'u1']]);
  assert.deepEqual([...runInAppContext(app, 'window.__undo')], ['T1']);
});

test('حذف المتابعة: إلغاء التأكيد لا يغيّر شيئًا، والنقرة المزدوجة حذف واحد، وفشل الحذف يزيل اللقطة', async () => {
  const c = makeTrash({ cancel: true });
  await c.app.deleteCrmFollowup('f1');
  assert.equal(c.ev.length, 0);

  const d = makeTrash();
  await Promise.all([d.app.deleteCrmFollowup('f1'), d.app.deleteCrmFollowup('f1')]);
  assert.equal(d.ev.filter(e => e.k === 'delete').length, 1);

  const f = makeTrash({ failDelete: true });
  await f.app.deleteCrmFollowup('f1');
  assert.deepEqual(f.ev.map(e => e.k), ['snapshot', 'delete', 'discard']);
  assert.ok(runInAppContext(f.app, 'window.__toasts').some(x => /تعذّر الحذف/.test(x)));
});

test('نافذة المراجعة: رأس بالاسم والسبب المختصر، سطر اتفاق مضغوط، المقترح تلميح لا داخل الزر، وزر حذف', async () => {
  const { app } = make({ ...ROW, reason_type: 'absence', reason_text: 'غاب 3 من آخر 8 حصص: الاثنين 28/9' });
  await app.openCrmReviewModal('f1');
  const h = msg(app);
  assert.match(h, /class="rv-name">سالم بن أحمد</);
  assert.match(h, /غياب · غاب 3 من آخر 8 حصص · فُتحت/);
  assert.doesNotMatch(h, /الاثنين 28\/9/, 'قائمة التواريخ لا تظهر في الرأس');
  assert.doesNotMatch(h, /\(مقترحة\)/);
  assert.match(h, /لم يتم اتفاق مع الطالب بعد/);
  assert.match(h, /deleteCrmFollowup\('f1'\)/);
});

test('انحدار: تأكيد فوق نافذة معلومات يعرض زرّيه (كان يظهر «إغلاق» وحده فيستحيل الحذف)', async () => {
  const app = loadApp();
  app.showInfoModal('نافذة مراجعة');
  assert.equal(app.document.getElementById('confirmOkBtn').style.display, 'none');
  const p = app.showConfirm('حذف؟');
  assert.notEqual(app.document.getElementById('confirmOkBtn').style.display, 'none');
  assert.equal(app.document.getElementById('confirmCancelBtn').textContent, 'إلغاء');
  void p;
});

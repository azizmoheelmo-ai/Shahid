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

'use strict';
/* التنبيهات موقوفة مؤقتًا بطلب صاحب التطبيق (التركيز على الدرجات):
   لا "يحتاج انتباهي" في اليوم ولا في المتابعات، ولا شارة، ولا فحص يُحمَّل أصلًا. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

test('التنبيهات موقوفة: لا قسم، ولا شارة، ولا تحميل بيانات الفحص', async () => {
  const calls = [];
  const client = { from(t){ calls.push(t); const a = { select: () => a, eq: () => a, in: () => a, gte: () => a, lte: () => a, order: () => a, limit: () => a, then: (r) => Promise.resolve({ data: [], error: null }).then(r) }; return a; },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) } };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  assert.equal(runInAppContext(app, 'ATTENTION_ALERTS_ON'), false);
  assert.equal(app.attentionTodaySectionHtml({ cards: [{ priority: 'urgent' }] }), '');
  assert.equal(app.attentionTodaySectionHtml(null), '', 'ولا "تعذّر الفحص"');
  runInAppContext(app, `window.__badge = { style: { display: 'block' }, textContent: '9+' }; const _g = document.getElementById; document.getElementById = id => id === 'classroomNavBadge' ? window.__badge : _g(id);`);
  assert.equal(await app.refreshAttention(), null);
  assert.equal(await app.getAttentionFresh(), null);
  assert.equal(runInAppContext(app, 'window.__badge.style.display'), 'none', 'الشارة تُخفى');
  assert.equal(calls.length, 0, 'لا قراءة لبيانات الفحص');
});

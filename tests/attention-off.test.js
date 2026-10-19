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

test('تبويب اليوم — بلا "حضور لم يُرصد" ولا "شعبي"، و"خططي" لمن فعّل الشواهد فقط', async () => {
  const client = { from(){ const a = { select: () => a, eq: () => a, in: () => a, gte: () => a, lte: () => a, order: () => a, limit: () => a, then: (r) => Promise.resolve({ data: [], error: null }).then(r) }; return a; },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) } };
  const render = async shahidOn => {
    const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
    runInAppContext(app, `
      appFeatures = { sections: { shahid: ${shahidOn} }, tools: {} };
      loadCrmTimetable = async () => true; crmHolidayChecker = async () => ({ nameFor: () => null });
      window.__plansLoaded = 0; loadLessonPlans = async () => { window.__plansLoaded++; return []; }; lessonPlansTodayHtml = () => '<div>خططي</div>';
      crmSections = [{ id: 'S', name: '٦' }]; crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];
      crmTimetableSlots = [0, 1, 2, 3, 4, 5, 6].map(d => ({ section_id: 'S', weekday: d, period: 1, created_at: '2020-01-01' }));
      window.__box = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'crmTodayBody' ? window.__box : _g(id);`);
    await app.renderCrmToday();
    return { html: runInAppContext(app, 'window.__box.innerHTML'), plans: runInAppContext(app, 'window.__plansLoaded') };
  };
  const off = await render(false);
  assert.match(off.html, /حصص اليوم/);
  assert.doesNotMatch(off.html, /لم يُرصد/);
  assert.doesNotMatch(off.html, /شعبي/);
  assert.doesNotMatch(off.html, /خططي/);
  assert.equal(off.plans, 0, 'لا تُحمَّل الخطط لمن لم يفعّل الشواهد');
  const on = await render(true);
  assert.match(on.html, /خططي/);
});

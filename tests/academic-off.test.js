'use strict';
/* المتابعة الأكاديمية موقوفة بالكامل (ACADEMIC_ON = false): لا شاشة، ولا خطاب،
   ولا قراءة لجدولها، ولا بطاقات انتباه منها — والجدول والكود باقيان. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const get = (app, e) => runInAppContext(app, e);

function client(log){
  return { from(t){ log.push(t); const a = { select: () => a, eq: () => a, in: () => a, gte: () => a, order: () => a, range: () => a, maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (r) => Promise.resolve({ data: [], error: null }).then(r) }; return a; },
    rpc(){ return Promise.resolve({ data: null, error: null }); }, auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) } };
}

test('الشاشة والخطاب والشارات: لا تُفتح ولا تقرأ جدولها', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: client(log), currentUser: { id: 'u1' } });
  assert.equal(get(app, 'ACADEMIC_ON'), false);
  runInAppContext(app, `window.__crm = 0; showClassroomManagement = () => { window.__crm++; }; document.getElementById('academicView').style.display = 'none';`);
  await app.showAcademicTracking();
  assert.equal(get(app, 'window.__crm'), 1, 'يُحوَّل لإدارة الصف');
  assert.equal(get(app, `document.getElementById('academicView').style.display`), 'none');
  await app.openAcLetter('X');
  await app.refreshAcBadges();
  assert.ok(!log.includes('academic_cases'), 'لا قراءة للجدول');
});

test('الانتباه يتجاهل الحالات الأكاديمية', () => {
  const app = loadApp({ supabaseClient: client([]), currentUser: { id: 'u1' } });
  const items = app.computeAttentionItems({ students: [{ id: 's', full_name: 'س', is_active: true }], sections: [], lessons: [], attendance: [], incidents: [],
    academicCases: [{ student_id: 's', status: 'referred', referral_letter_generated: false, created_at: new Date().toISOString() }],
    followups: [], dismissals: [], todayIso: '2026-10-22', nowMs: Date.now() });
  assert.equal(items.length, 0);
});

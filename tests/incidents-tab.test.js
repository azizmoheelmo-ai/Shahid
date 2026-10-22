'use strict';
/* ============================================================
   تبويب المخالفات (v2.4): ملخص يعمل كفلتر (الكل/هذا الأسبوع/بانتظار التحويل)،
   "+ تسجيل مخالفة" بلوحة 3 خطوات، الحذف داخل ⋯، وإلغاء "توثيق التسليم"
   من المتابعة. وكل استعلام مقيّد بالمعلم.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const get = (app, e) => runInAppContext(app, e);

function client(tables, log){
  return {
    from(t){
      const q = { table: t, eqs: [], gtes: [], op: 'select' };
      if(log) log.push(q);
      const a = { select: () => a, eq: (k, v) => { q.eqs.push([k, v]); return a; }, in: () => a, gte: (k, v) => { q.gtes.push([k, v]); return a; }, lte: () => a, is: () => a,
        order: () => a, limit: () => a, range: () => a, delete: () => { q.op = 'delete'; return a; }, insert: () => { q.op = 'insert'; return a; },
        maybeSingle: () => Promise.resolve({ data: ((tables && tables[t]) || [])[0] || null, error: null }),
        then: (r) => Promise.resolve({ data: q.op === 'select' ? ((tables && tables[t]) || []) : null, error: null }).then(r) };
      return a;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
}

test('الواجهة: مربعات الملخص وزر التسجيل، بلا "غير موثّق" ولا شريط وردي ولا "حالة التحويلات"', () => {
  const tab = html.slice(html.indexOf('id="crmTabRecord"'), html.indexOf('<!-- ============ تبويب: الطلاب'));
  for(const id of ['crmFilterBtn_all', 'crmFilterBtn_week', 'crmFilterBtn_pending', 'crmPendingReferralCount', 'crmIncidentSheet', 'crmIncidentSaveBtn']) assert.match(tab, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(tab, /غير موثّق|توثيق تسليم|crmUndocumented|crmPendingReferralBanner|حالة التحويلات|حالة بانتظار/);
});

test('crmWeekStartIso = الأحد من الأسبوع نفسه، و"غير موثّق" يرجع للكل', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: client({}, log), currentUser: { id: 'u1' } });
  assert.equal(app.crmWeekStartIso('2026-10-22'), '2026-10-18');
  assert.equal(app.crmWeekStartIso('2026-10-18'), '2026-10-18');
  runInAppContext(app, `{ const _l = localIsoDate; localIsoDate = d => d ? _l(d) : '2026-10-22'; }`);
  app.setCrmIncidentFilter('undocumented');
  assert.equal(get(app, 'crmIncidentFilter'), 'all');
  runInAppContext(app, `window.__r = renderCrmRecentIncidents(); setListFilter = (cfg, m) => { cfg.setValue(m); };`);
  app.setCrmIncidentFilter('week');
  await app.renderCrmRecentIncidents();
  const q = log.filter(x => x.table === 'classroom_incidents' && x.gtes.length);
  assert.ok(q.some(x => x.gtes.some(([k, v]) => k === 'incident_date' && v === '2026-10-18')), 'فلتر الأسبوع');
});

test('القائمة: بطاقة لكل طالب، الحذف داخل ⋯ لا سلة ظاهرة، بلا "توثيق التسليم"، والنصوص مهرّبة', async () => {
  const incidents = [
    { id: 'I1', incident_date: '2026-10-15', occurrence_number: 3, current_stage: 'referred', notes: '<img src=x>', student_id: 'A', incident_type_id: 'T', referral_letter_generated: false },
    { id: 'I2', incident_date: '2026-10-10', occurrence_number: 2, current_stage: 'referred', notes: null, student_id: 'A', incident_type_id: 'T', referral_letter_generated: true, referral_receipt_photo_url: null }
  ];
  const app = loadApp({ supabaseClient: client({ classroom_incidents: incidents }), currentUser: { id: 'u1' } });
  runInAppContext(app, `crmStudents = [{ id: 'A', full_name: '<b>حسام</b>' }]; crmIncidentTypes = [{ id: 'T', problem_name: 'إثارة الفوضى' }];
    window.__box = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'crmRecentIncidents' ? window.__box : _g(id);
    document.getElementById('crmIncidentsSearch').value = '';`);
  await app.renderCrmRecentIncidents();
  const out = get(app, 'window.__box.innerHTML');
  assert.match(out, /&lt;b&gt;حسام&lt;\/b&gt;/);
  assert.doesNotMatch(out, /<img src=x>/);
  assert.match(out, /مخالفتان/);
  assert.match(out, /بانتظار التحويل/);
  assert.match(out, /onclick="openCrmIncidentActions\('I1'\)"/);
  assert.doesNotMatch(out, /🗑|deleteCrmIncident/, 'الحذف ليس في القائمة');
  assert.doesNotMatch(out, /توثيق التسليم|غير موثّق|موثّق/);
  assert.match(out, /إصدار خطاب التحويل/);
});

test('شارة المخالفات = بانتظار التحويل فقط (خطاب بلا صورة تسليم لا يُعدّ)', async () => {
  const rows = [{ referral_letter_generated: true, referral_receipt_photo_url: null }];
  const app = loadApp({ supabaseClient: client({ classroom_incidents: rows }), currentUser: { id: 'u1' } });
  runInAppContext(app, `refreshAttention = () => {}; document.getElementById('classroomHomeBadge').style.display = 'inline-block';`);
  await app.refreshCrmPendingBadges();
  assert.equal(get(app, `document.getElementById('classroomHomeBadge').style.display`), 'none');
  assert.equal(String(get(app, `document.getElementById('crmPendingReferralCount').textContent`)), '0');
});

test('الحذف والخطاب وجلب الطالب: كل استعلام مقيّد بالمعلم', async () => {
  const log = [];
  const inc = { id: 'I1', student_id: 'A', incident_type_id: 'T', semester_label: 'x', occurrence_number: 2 };
  const app = loadApp({ supabaseClient: client({ classroom_incidents: [inc], classroom_students: [] }, log), currentUser: { id: 'u1' } });
  runInAppContext(app, `showConfirm = async () => true; showUndoToast = async () => true; renderCrmRecentIncidents = async () => {}; refreshCrmPendingBadges = async () => {};
    crmStudents = []; crmIncidentTypes = []; showToast = () => {};`);
  await app.deleteCrmIncident('I1');
  await app.fetchCrmStudentById('A');
  await app.openReferralLetter('I1');
  const qs = log.filter(q => q.table === 'classroom_incidents' || q.table === 'classroom_students');
  assert.ok(qs.length >= 4);
  qs.forEach(q => assert.ok(q.eqs.some(([k, v]) => k === 'teacher_id' && v === 'u1'), q.table + ' ' + q.op + ' بلا teacher_id'));
});

test('لوحة التسجيل: شرائح الأكثر استخدامًا + "غيرها…"، والشريحة تختار النوع', async () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  runInAppContext(app, `crmIncidentTypes = Array.from({ length: 9 }, (_, i) => ({ id: 'T' + i, problem_name: 'نوع ' + i }));
    loadCrmIncidentTypeUsage = async () => new Map([['T3', 5], ['T1', 2], ['T8', 1]]);
    window.__chips = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'crmIncidentTypeChips' ? window.__chips : _g(id);
    refreshOccurrencePreview = () => {};`);
  await app.openCrmIncidentSheet();
  const chips = get(app, 'window.__chips.innerHTML');
  assert.deepEqual([...chips.matchAll(/data-type="(T\d)"/g)].map(m => m[1]), ['T3', 'T1', 'T8']);
  assert.match(chips, /غيرها…/);
  assert.equal(get(app, `document.getElementById('crmIncidentSheet').style.display`), 'flex');
  app.pickCrmIncidentType('T1');
  assert.equal(get(app, `document.getElementById('crmIncidentType').value`), 'T1');
});

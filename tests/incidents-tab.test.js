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
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const get = (app, e) => runInAppContext(app, e);

function client(tables, log){
  return {
    from(t){
      const q = { table: t, eqs: [], gtes: [], op: 'select' };
      if(log) log.push(q);
      const a = { select: () => a, eq: (k, v) => { q.eqs.push([k, v]); return a; }, in: () => a, gte: (k, v) => { q.gtes.push([k, v]); return a; }, lte: () => a, is: () => a,
        order: () => a, limit: () => a, range: () => a, delete: () => { q.op = 'delete'; return a; }, insert: () => { q.op = 'insert'; return a; }, update: () => { q.op = 'update'; return a; },
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
  /* الفلتر يُطبَّق بعد الجلب (المراحل تحتاج كل مرّات الفصل): ما قبل الأحد لا يظهر */
  const incidents = [
    { id: 'W1', incident_date: '2026-10-20', occurrence_number: 1, current_stage: 'warning_1', student_id: 'A', incident_type_id: 'T' },
    { id: 'W0', incident_date: '2026-10-17', occurrence_number: 1, current_stage: 'warning_1', student_id: 'B', incident_type_id: 'T' }
  ];
  const app2 = loadApp({ supabaseClient: client({ classroom_incidents: incidents }, log), currentUser: { id: 'u1' } });
  runInAppContext(app2, `{ const _l = localIsoDate; localIsoDate = d => d ? _l(d) : '2026-10-22'; } setListFilter = (cfg, m) => { cfg.setValue(m); };
    crmStudents = [{ id: 'A', full_name: 'أحمد' }, { id: 'B', full_name: 'بدر' }]; crmIncidentTypes = [{ id: 'T', problem_name: 'تأخر' }];
    window.__box = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'crmRecentIncidents' ? window.__box : _g(id);
    document.getElementById('crmIncidentsSearch').value = '';`);
  app2.setCrmIncidentFilter('week');
  await app2.renderCrmRecentIncidents();
  const out = get(app2, 'window.__box.innerHTML');
  assert.match(out, /أحمد/);
  assert.doesNotMatch(out, /بدر/, 'فلتر الأسبوع');
  assert.ok(log.filter(x => x.table === 'classroom_incidents').every(x => x.eqs.some(([k, v]) => k === 'teacher_id' && v === 'u1')), 'مقيّد بالمعلم');
});

/* ============ لمسات البطاقة (3.73): المراحل، دمج التكرار، الأزرار السريعة ============ */
function renderWith(incidents, setup){
  const log = [];
  const app = loadApp({ supabaseClient: client({ classroom_incidents: incidents }, log), currentUser: { id: 'u1' } });
  runInAppContext(app, `getCrmSemesterLabel = () => 'الأول 1448';
    window.__box = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'crmRecentIncidents' ? window.__box : _g(id);
    document.getElementById('crmIncidentsSearch').value = ''; ${setup}`);
  return { app, log, run: async () => { await app.renderCrmRecentIncidents(); return get(app, 'window.__box.innerHTML'); } };
}
const LONG = 'إعاقة سير الحصة (حديث جانبي/مقاطعة/أكل أثناء الدرس)';

test('crmSplitTypeName: عنوان قصير + تفصيل، والاسم بلا قوسين يبقى كما هو', () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  const a = app.crmSplitTypeName(LONG);
  assert.equal(a.title, 'إعاقة سير الحصة');
  assert.equal(a.detail, 'حديث جانبي/مقاطعة/أكل أثناء الدرس');
  assert.equal(app.crmSplitTypeName('تأخر').title, 'تأخر');
  assert.equal(app.crmSplitTypeName('تأخر').detail, '');
});

test('crmIncidentLadder: يتبع incidentStageFor — لا سلّم للتحويل الفوري ولا بلا مرات', () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  const t = { id: 'T', stage_1_label: 'أ', stage_2_label: 'ب' };
  assert.equal(app.crmIncidentLadder(t, 0), null);
  assert.equal(app.crmIncidentLadder({ ...t, action_sequence: 'immediate_referral' }, 1), null);
  const two = app.crmIncidentLadder(t, 2);
  assert.deepEqual(Array.from(two.steps, s => s.state), ['done', 'done', 'next']);
  assert.equal(two.nextStage, 'referred');
  assert.equal(app.crmIncidentLadder(t, 1).nextStage, 'warning_2');
});

test('البطاقة: الاسم الطويل مرة واحدة مع ×2، والمراحل والتنبيه من مرّات هذا الفصل فقط', async () => {
  const incidents = [
    { id: 'I2', incident_date: '2026-11-09', occurrence_number: 2, current_stage: 'warning_2', student_id: 'A', incident_type_id: 'T', semester_label: 'الأول 1448' },
    { id: 'I1', incident_date: '2026-09-30', occurrence_number: 1, current_stage: 'warning_1', notes: 'حديث جانبي', student_id: 'A', incident_type_id: 'T', semester_label: 'الأول 1448' },
    { id: 'J1', incident_date: '2026-09-01', occurrence_number: 1, current_stage: 'warning_1', student_id: 'B', incident_type_id: 'T', semester_label: 'الثاني 1447' }
  ];
  const { run } = renderWith(incidents, `crmStudents = [{ id: 'A', full_name: 'بشار' }, { id: 'B', full_name: 'حسام' }]; crmIncidentTypes = [{ id: 'T', problem_name: '${LONG}' }];`);
  const out = await run();
  const bashar = out.split('class="crm-inc-card"')[1];
  assert.equal(bashar.split('أكل أثناء الدرس').length - 1, 1, 'الاسم الطويل مرة واحدة لا مع كل مرة');
  assert.match(out, /×2/);
  assert.match(out, /تنبيه ثانٍ ✓/);
  assert.match(out, /crm-ladder-st is-next is-ref/);
  assert.match(out, /المرة القادمة من «إعاقة سير الحصة» = تحويل/);
  /* حسام: مخالفته من فصل سابق — لا سلّم ولا تنبيه له */
  const hossam = out.slice(out.indexOf('حسام'));
  assert.doesNotMatch(hossam, /crm-ladder|المرة القادمة/);
  assert.match(out, /onclick="openCrmIncidentActions\('I1'\)"/);
});

test('المراحل تُحسب من كل السجلات حتى بفلتر «هذا الأسبوع»', async () => {
  const incidents = [
    { id: 'I2', incident_date: '2026-10-20', occurrence_number: 2, current_stage: 'warning_2', student_id: 'A', incident_type_id: 'T', semester_label: 'الأول 1448' },
    { id: 'I1', incident_date: '2026-09-30', occurrence_number: 1, current_stage: 'warning_1', student_id: 'A', incident_type_id: 'T', semester_label: 'الأول 1448' }
  ];
  const { app, run } = renderWith(incidents, `{ const _l = localIsoDate; localIsoDate = d => d ? _l(d) : '2026-10-22'; } setListFilter = (cfg, m) => { cfg.setValue(m); };
    crmStudents = [{ id: 'A', full_name: 'بشار' }]; crmIncidentTypes = [{ id: 'T', problem_name: 'تأخر' }];`);
  app.setCrmIncidentFilter('week');
  const out = await run();
  assert.doesNotMatch(out, /2026-09-30/, 'القديمة لا تظهر بالأسبوع');
  assert.match(out, /المرة القادمة من «تأخر» = تحويل/, 'لكنها تُحسب بالمراحل');
});

test('الأزرار السريعة: تكرار/أخرى للطالب الحالي، واتساب برقم فقط، ولا شيء للطالب المحذوف', async () => {
  const incidents = [
    { id: 'I1', incident_date: '2026-11-09', occurrence_number: 1, current_stage: 'warning_1', student_id: 'A', incident_type_id: 'T', semester_label: 'الأول 1448' },
    { id: 'K1', incident_date: '2026-11-08', occurrence_number: 1, current_stage: 'warning_1', student_id: 'B', incident_type_id: 'T', semester_label: 'الأول 1448' },
    { id: 'Z1', incident_date: '2026-11-07', occurrence_number: 1, current_stage: 'warning_1', student_id: 'GONE', incident_type_id: 'T', semester_label: 'الأول 1448' }
  ];
  const { run } = renderWith(incidents, `crmStudents = [{ id: 'A', full_name: 'بشار', guardian_phone: '966500000000' }, { id: 'B', full_name: 'حسام' }]; crmIncidentTypes = [{ id: 'T', problem_name: '${LONG}' }];`);
  const out = await run();
  const cards = out.split('class="crm-inc-card"').slice(1);
  assert.match(cards[0], /aria-label="تكرار: إعاقة سير الحصة" onclick="openCrmIncidentRepeat\('A','T'\)">↻ تكرار</);
  assert.match(cards[0], /openCrmIncidentRepeat\('A'\)/);
  assert.match(cards[0], /openCrmIncidentWa\('I1'\)/);
  assert.doesNotMatch(cards[1], /openCrmIncidentWa/, 'بلا رقم = بلا واتساب');
  assert.match(cards[1], /openCrmIncidentRepeat\('B','T'\)/);
  assert.doesNotMatch(cards[2], /openCrmIncidentRepeat|openCrmIncidentWa/, 'طالب محذوف');
});

test('openCrmIncidentRepeat: يصفّر النموذج ثم يفتح اللوحة بالطالب والنوع جاهزين', async () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  runInAppContext(app, `crmStudents = [{ id: 'A', full_name: 'بشار' }]; crmIncidentTypes = [{ id: 'T', problem_name: 'تأخر' }];
    window.__calls = []; resetCrmIncidentForm = () => { window.__calls.push('reset'); document.getElementById('crmIncidentType').value = ''; };
    openCrmIncidentSheet = async (sid) => { window.__calls.push('open:' + sid + ':' + document.getElementById('crmIncidentType').value); };`);
  await app.openCrmIncidentRepeat('A', 'T');
  assert.deepEqual(Array.from(get(app, 'window.__calls')), ['reset', 'open:A:T']);
  await app.openCrmIncidentRepeat('NOPE', 'T');
  assert.equal(get(app, 'window.__calls.length'), 2, 'طالب غير موجود: لا شيء');
});

test('openCrmIncidentWa: نص جاهز لولي الأمر باسم الطالب والمخالفة القصيرة والتاريخ', async () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  runInAppContext(app, `crmStudents = [{ id: 'A', full_name: 'بشار', guardian_phone: '966500000000' }]; crmIncidentTypes = [{ id: 'T', problem_name: '${LONG}' }];
    crmIncidentsShown = [{ id: 'I1', student_id: 'A', incident_type_id: 'T', incident_date: '2026-11-09' }];
    openCrmWaNote = (sid, who, draft) => { window.__wa = [sid, who, draft]; };`);
  app.openCrmIncidentWa('I1');
  const [sid, who, draft] = get(app, 'window.__wa');
  assert.equal(sid, 'A'); assert.equal(who, 'guardian');
  assert.match(draft, /بشار/); assert.match(draft, /إعاقة سير الحصة بتاريخ 2026-11-09/);
  assert.doesNotMatch(draft, /أكل أثناء الدرس/);
});

test('رسم أحدث فقط: نتيجة طلب أقدم لا تُكتب فوق أحدث', async () => {
  const { app, run } = renderWith([], `crmStudents = [{ id: 'X', full_name: 'قديم' }]; crmIncidentTypes = [];
    refreshCrmIncidentCounts = () => {}; window.__gate = new Promise(r => { window.__release = r; });
    { let n = 0; fetchAllRows = async () => { n++; if(n === 1){ await window.__gate; return { data: [{ id: 'OLD', student_id: 'X', incident_type_id: 'T', incident_date: '2026-01-01' }], error: null }; } return { data: [], error: null }; }; }`);
  const first = app.renderCrmRecentIncidents();
  const afterSecond = await run();
  runInAppContext(app, 'window.__release()');
  await first;
  assert.match(afterSecond, /لا مخالفات مسجّلة بعد/);
  assert.equal(get(app, 'window.__box.innerHTML'), afterSecond, 'الأقدم لا يكتب فوق الأحدث');
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

/* DOM بسيط بحالة حقيقية لعناصر اللوحة (القيمة والمحتوى والنمط وclassList) */
function stubSheetDom(app){
  runInAppContext(app, `window.__els = {}; const _g = document.getElementById;
    document.getElementById = id => window.__els[id] || (window.__els[id] = {
      id, value: '', innerHTML: '', textContent: '', disabled: false, style: {}, dataset: {},
      classList: { _s: new Set(), toggle(c, on){ on === false || (on === undefined && this._s.has(c)) ? this._s.delete(c) : this._s.add(c); }, contains(c){ return this._s.has(c); } },
      querySelectorAll: () => [], focus(){}, setAttribute(){}
    });`);
}

test('لوحة التسجيل: أكثر الأنواع استخدامًا كصفوف بعرض كامل + "كل المخالفات"، والصف يختار النوع', async () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  stubSheetDom(app);
  runInAppContext(app, `crmIncidentTypes = Array.from({ length: 9 }, (_, i) => ({ id: 'T' + i, problem_name: 'نوع <' + i + '>', problem_degree: 1 + (i % 2) }));
    loadCrmIncidentTypeUsage = async () => new Map([['T3', 5], ['T1', 2], ['T8', 1]]);
    refreshOccurrencePreview = () => {};`);
  await app.openCrmIncidentSheet();
  const rows = get(app, `document.getElementById('crmIncidentTypeChips').innerHTML`);
  assert.deepEqual([...rows.matchAll(/data-type="(T\d)"/g)].map(m => m[1]), ['T3', 'T1', 'T8']);
  assert.match(rows, /كل المخالفات \(9\) وبحث/);
  assert.match(rows, /د٢/, 'الدرجة بأرقام عربية');
  assert.match(rows, /نوع &lt;3&gt;/, 'اسم النوع مهرَّب');
  assert.doesNotMatch(rows, /نوع <3>/);
  assert.equal(get(app, `document.getElementById('crmIncidentSheet').style.display`), 'flex');
  app.pickCrmIncidentType('T1');
  assert.equal(get(app, `document.getElementById('crmIncidentType').value`), 'T1');
});

test('ورقة كل المخالفات: بحث وتصفية بالدرجة، والاختيار منها يظهر أول الصفوف', async () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  stubSheetDom(app);
  runInAppContext(app, `crmIncidentTypes = [
      { id: 'A', problem_name: 'النوم داخل الفصل', problem_degree: 1, regulation_article: 'م4' },
      { id: 'B', problem_name: 'التأخر عن الحصة', problem_degree: 2, regulation_article: 'م11' },
      { id: 'C', problem_name: 'نوم خارج الفصل', problem_degree: 2, regulation_article: '<x>' }];
    loadCrmIncidentTypeUsage = async () => new Map([['A', 3]]); refreshOccurrencePreview = () => {};`);
  await app.openCrmIncidentSheet();
  app.openCrmTypePicker();
  const list = () => get(app, `document.getElementById('crmTypePickerList').innerHTML`);
  assert.equal([...list().matchAll(/pickCrmIncidentTypeFromPicker/g)].length, 3);
  app.setCrmTypePickerDegree(2);
  assert.deepEqual([...list().matchAll(/pickCrmIncidentTypeFromPicker\('(\w)'\)/g)].map(m => m[1]), ['B', 'C']);
  assert.match(list(), /&lt;x&gt;/, 'رقم المادة مهرَّب');
  runInAppContext(app, `document.getElementById('crmTypePickerSearch').value = 'نوم'`);
  app.renderCrmTypePicker();
  assert.deepEqual([...list().matchAll(/pickCrmIncidentTypeFromPicker\('(\w)'\)/g)].map(m => m[1]), ['C']);
  app.pickCrmIncidentTypeFromPicker('C');
  assert.equal(get(app, `document.getElementById('crmTypePicker').style.display`), 'none');
  assert.equal(get(app, `document.getElementById('crmIncidentType').value`), 'C');
  await new Promise(r => setTimeout(r, 10));
  const rows = get(app, `document.getElementById('crmIncidentTypeChips').innerHTML`);
  assert.deepEqual([...rows.matchAll(/data-type="(\w)"/g)].map(m => m[1]), ['C', 'A'], 'المختار من الورقة أول الصفوف');
});

test('زر الحفظ معطّل ونصه يقول ما ينقص، ويتحول لأحمر عند التحويل', () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  stubSheetDom(app);
  const btn = () => get(app, `document.getElementById('crmIncidentSaveBtn')`);
  app.updateCrmIncidentSaveState();
  assert.equal(btn().disabled, true);
  assert.equal(btn().textContent, 'اختر الطالب والمخالفة');
  runInAppContext(app, `document.getElementById('crmIncidentStudentId').value = 's1'`);
  app.updateCrmIncidentSaveState();
  assert.equal(btn().textContent, 'اختر المخالفة');
  runInAppContext(app, `document.getElementById('crmIncidentStudentId').value = ''; document.getElementById('crmIncidentType').value = 't1'`);
  app.updateCrmIncidentSaveState();
  assert.equal(btn().textContent, 'اختر الطالب');
  runInAppContext(app, `document.getElementById('crmIncidentStudentId').value = 's1'`);
  app.updateCrmIncidentSaveState();
  assert.equal(btn().disabled, false);
  assert.equal(btn().textContent, 'حفظ المخالفة');
  runInAppContext(app, `{ const b = document.getElementById('crmOccurrencePreview'); b.style.display = 'block'; b.dataset.stage = 'referred'; }`);
  app.updateCrmIncidentSaveState();
  assert.equal(btn().textContent, 'حفظ — يلزم خطاب تحويل');
  assert.ok(btn().classList.contains('is-referral'));
});

test('بطاقة الطالب: عدد مخالفاته من سجلات المعلم وفصله فقط، والاسم مهرَّب، ✕ يصفّرها', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: client({ classroom_incidents: [{ id: 'a' }, { id: 'b' }] }, log), currentUser: { id: 'u1' } });
  stubSheetDom(app);
  runInAppContext(app, `crmStudents = [{ id: 'S', full_name: '<b>سعد</b>', grade_level: 'ثالث', section_number: '3' }]; crmIncidentTypes = []; refreshOccurrencePreview = () => {};
    getCrmSemesterLabel = () => 'الفصل الأول';`);
  app.selectCrmIncidentStudent('S');
  await new Promise(r => setTimeout(r, 10));
  const card = get(app, `document.getElementById('crmIncidentStudentCard')`);
  assert.match(card.innerHTML, /&lt;b&gt;سعد&lt;\/b&gt;/);
  assert.doesNotMatch(card.innerHTML, /<b>سعد<\/b>/);
  assert.equal(get(app, `document.getElementById('crmIncidentStudentStat').textContent`), 'لديه مخالفتان هذا الفصل');
  const q = log.find(x => x.table === 'classroom_incidents');
  for(const kv of [['teacher_id', 'u1'], ['student_id', 'S'], ['semester_label', 'الفصل الأول']]) assert.ok(q.eqs.some(([k, v]) => k === kv[0] && v === kv[1]), kv[0]);
  app.clearCrmIncidentStudent(false);
  assert.equal(get(app, `document.getElementById('crmIncidentStudentId').value`), '');
  assert.equal(get(app, `document.getElementById('crmIncidentStudentCard').style.display`), 'none');
  assert.equal(get(app, `document.getElementById('crmIncidentStudentBox').style.display`), 'block');
});

test('سباق: إحصاء الطالب الأول يصل متأخرًا بعد اختيار الثاني فلا يكتب فوق بطاقته', async () => {
  const gates = {};
  const rowsBy = { S1: [{ id: 'a' }], S2: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const slow = client({});
  slow.from = () => {
    let sid; const a = { select: () => a, eq: (k, v) => { if(k === 'student_id') sid = v; return a; },
      then: r => new Promise(res => { gates[sid] = () => res({ data: rowsBy[sid], error: null }); }).then(r) };
    return a;
  };
  const app = loadApp({ supabaseClient: slow, currentUser: { id: 'u1' } });
  stubSheetDom(app);
  runInAppContext(app, `crmStudents = [{ id: 'S1', full_name: 'أ' }, { id: 'S2', full_name: 'ب' }]; refreshOccurrencePreview = () => {}; getCrmSemesterLabel = () => 'x';`);
  app.selectCrmIncidentStudent('S1');
  app.clearCrmIncidentStudent(false);
  app.selectCrmIncidentStudent('S2');
  await new Promise(r => setTimeout(r, 5));
  gates.S2(); await new Promise(r => setTimeout(r, 5));
  gates.S1(); await new Promise(r => setTimeout(r, 5));
  assert.equal(get(app, `document.getElementById('crmIncidentStudentStat').textContent`), 'لديه 3 مخالفات هذا الفصل');
});

test('سباق: معاينة التكرار القديمة لا تُعرض بعد تغيير النوع', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const c = client({ classroom_incidents: [] });
  const _from = c.from.bind(c);
  c.from = t => { const a = _from(t); const _then = a.then; a.then = r => gate.then(() => _then(r)); return a; };
  const app = loadApp({ supabaseClient: c, currentUser: { id: 'u1' } });
  stubSheetDom(app);
  runInAppContext(app, `crmIncidentTypes = [{ id: 'T1', problem_name: 'x', action_sequence: 'immediate_referral', regulation_article: 'م1' }];
    getCrmSemesterLabel = () => 'x';
    document.getElementById('crmIncidentStudentId').value = 'S'; document.getElementById('crmIncidentType').value = 'T1';`);
  const p = app.refreshOccurrencePreview();
  runInAppContext(app, `document.getElementById('crmIncidentType').value = ''`);
  release();
  await p;
  assert.equal(get(app, `document.getElementById('crmOccurrencePreview').style.display`), undefined);
  assert.equal(get(app, `document.getElementById('crmOccurrencePreview').innerHTML`), '');
});

test('المعاينة: التحويل بصندوق أحمر، والإجراء مهرَّب', async () => {
  const app = loadApp({ supabaseClient: client({ classroom_incidents: [] }), currentUser: { id: 'u1' } });
  stubSheetDom(app);
  runInAppContext(app, `crmIncidentTypes = [{ id: 'T1', problem_name: 'x', action_sequence: 'immediate_referral', regulation_article: '<م1>' }];
    getCrmSemesterLabel = () => 'x';
    document.getElementById('crmIncidentStudentId').value = 'S'; document.getElementById('crmIncidentType').value = 'T1';`);
  await app.refreshOccurrencePreview();
  const html2 = get(app, `document.getElementById('crmOccurrencePreview').innerHTML`);
  assert.match(html2, /crm-prev is-ref/);
  assert.match(html2, /يلزم إصدار خطاب تحويل/);
  assert.match(html2, /&lt;م1&gt;/);
  assert.equal(get(app, `document.getElementById('crmOccurrencePreview').dataset.stage`), 'referred');
});

test('الواجهة: العنوان والحفظ خارج منطقة التمرير، والزر معطّل مبدئيًا، والقائمة الأصلية مخفية دائمًا', () => {
  const sheet = html.slice(html.indexOf('id="crmIncidentSheet"'), html.indexOf('id="crmTypePicker"'));
  assert.ok(sheet.indexOf('class="crm-bsheet-body"') < sheet.indexOf('id="crmIncidentSaveBtn"'));
  assert.ok(sheet.indexOf('class="crm-bsheet-foot"') < sheet.indexOf('id="crmIncidentSaveBtn"'));
  assert.ok(sheet.indexOf('id="crmIncidentSaveBtn"') > sheet.indexOf('</textarea>'));
  assert.match(sheet, /id="crmIncidentSaveBtn"[^>]*disabled/);
  assert.match(sheet, /<select id="crmIncidentType" style="display:none;"/);
  assert.match(sheet, /<textarea[^>]*crm-bsheet-notes/);
  assert.match(html, /id="crmTypePickerSearch"/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  assert.match(css, /\.crm-bsheet-notes\{[^}]*resize:none/);
});

test('المتابعة الأكاديمية والخطابات: لا توثيق تسليم (بلا فلتر ولا وسم ولا قسم رفع)، والصورة القديمة تبقى ظاهرة', async () => {
  assert.doesNotMatch(html, /acUndocumented|acFilterBtn_undocumented/);
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  assert.equal(get(app, 'RECEIPT_DOCS_ON'), false);
  assert.equal(app.receiptSectionVisible(true, null), false, 'لا قسم رفع لخطاب بلا صورة');
  assert.equal(app.receiptSectionVisible(true, 'https://x/y.jpg'), true, 'صورة قديمة تبقى قابلة للعرض والحذف');
  assert.equal(app.receiptSectionVisible(false, 'https://x/y.jpg'), false);
  runInAppContext(app, `renderAcCases = () => {};`);
  app.setAcFilter('undocumented');
  assert.equal(get(app, 'acFilter'), 'all');
});

test('حالات المتابعة الأكاديمية: القائمة بلا "غير موثّق"، والتحديث والحذف مقيّدان بالمعلم', async () => {
  const log = [];
  const cases = [{ id: 'C1', student_id: 'S', subject: 'رياضيات', weakness_description: 'x', plan_started_at: '2026-10-01', status: 'referred', referral_letter_generated: true, referral_receipt_photo_url: null }];
  const app = loadApp({ supabaseClient: client({ academic_cases: cases }, log), currentUser: { id: 'u1' } });
  runInAppContext(app, `acStudents = [{ id: 'S', full_name: 'طالب' }];
    window.__box = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'acCasesList' ? window.__box : _g(id);
    document.getElementById('acCasesSearch').value = ''; showConfirm = async () => true; showUndoToast = async () => true; refreshAcBadges = async () => {}; showToast = () => {}; openAcLetter = () => {};`);
  await app.renderAcCases();
  assert.doesNotMatch(get(app, 'window.__box.innerHTML'), /موثّق/);
  await app.referAcademicCase('C1');
  await app.deleteAcademicCase('C1');
  const writes = log.filter(q => q.table === 'academic_cases' && q.op !== 'select');
  assert.ok(writes.length >= 1);
  log.filter(q => q.table === 'academic_cases').forEach(q => assert.ok(q.eqs.some(([k, v]) => k === 'teacher_id' && v === 'u1'), q.op + ' بلا teacher_id'));
});

test('التراجع بعد الحفظ: يحذف سجل المخالفة الجديدة فقط بمعلمها وبلا خطاب، ولا حذف إن لم يُضغط تراجع', async () => {
  for(const undo of [true, false]){
    const log = [];
    const app = loadApp({ supabaseClient: client({}, log), currentUser: { id: 'u1' } });
    runInAppContext(app, `showUndoToast = async () => ${undo ? 'false' : 'true'}; renderCrmRecentIncidents = async () => {}; refreshCrmPendingBadges = async () => {}; showToast = () => {};`);
    await app.offerCrmIncidentUndo('NEW1', 'تم حفظ التنبيه');
    const del = log.filter(q => q.table === 'classroom_incidents' && q.op === 'delete');
    if(!undo){ assert.equal(del.length, 0, 'بلا تراجع لا حذف'); continue; }
    assert.equal(del.length, 1);
    for(const kv of [['teacher_id', 'u1'], ['id', 'NEW1'], ['referral_letter_generated', false]]) assert.ok(del[0].eqs.some(([k, v]) => k === kv[0] && v === kv[1]), kv[0]);
  }
});

test('الحفظ يمرّر معرّف السجل الجديد لإشعار التراجع', async () => {
  const app = loadApp({ supabaseClient: { ...client({}), from: () => { const a = { select: () => a, eq: () => a, order: () => a, range: () => a, insert: () => a, maybeSingle: () => a, then: r => Promise.resolve({ data: { id: 'NEW9' }, error: null }).then(r) }; return a; } }, currentUser: { id: 'u1' } });
  runInAppContext(app, `crmIncidentTypes = [{ id: 'T', problem_name: 'x', action_sequence: 'immediate_referral', regulation_article: 'م1' }]; crmStudents = [{ id: 'S', full_name: 'أ', section_id: 'sec' }];
    getCrmSemesterLabel = () => 'x'; invalidateAttention = () => {}; refreshAttention = () => {};`);
  const r = await app.insertClassroomIncident({ studentId: 'S', typeId: 'T', notes: '' });
  assert.equal(r.id, 'NEW9');
});

test('انحدار: بطاقة المرحلة داخل الجزء الثابت فوق زر الحفظ (لا تختفي أسفل القائمة الطويلة)، وتاريخ الفصل لا ينكسر', async () => {
  const sheet = html.slice(html.indexOf('id="crmIncidentSheet"'), html.indexOf('id="crmTypePicker"'));
  const foot = sheet.indexOf('class="crm-bsheet-foot"');
  const prev = sheet.indexOf('id="crmOccurrencePreview"');
  assert.ok(prev > foot && prev < sheet.indexOf('id="crmIncidentSaveBtn"'), 'البطاقة في الجزء الثابت قبل الحفظ');
  assert.match(css, /\.crm-prev-sem\{white-space:nowrap/);
});

test('3.74: كل البطاقات مطويّة (حتى بانتظار التحويل)، والمراحل والتنبيه داخلها لا برأسها', async () => {
  const incidents = [
    { id: 'P1', incident_date: '2026-11-09', occurrence_number: 3, current_stage: 'referred', referral_letter_generated: false, student_id: 'A', incident_type_id: 'T', semester_label: 'الأول 1448' },
    { id: 'P0', incident_date: '2026-11-01', occurrence_number: 2, current_stage: 'warning_2', student_id: 'A', incident_type_id: 'T', semester_label: 'الأول 1448' },
    { id: 'Q1', incident_date: '2026-11-08', occurrence_number: 2, current_stage: 'warning_2', student_id: 'B', incident_type_id: 'T', semester_label: 'الأول 1448' },
    { id: 'Q0', incident_date: '2026-11-02', occurrence_number: 1, current_stage: 'warning_1', student_id: 'B', incident_type_id: 'T', semester_label: 'الأول 1448' }
  ];
  const { run } = renderWith(incidents, `crmStudents = [{ id: 'A', full_name: 'بشار' }, { id: 'B', full_name: 'حسام' }]; crmIncidentTypes = [{ id: 'T', problem_name: 'تأخر' }];`);
  const out = await run();
  assert.doesNotMatch(out, /style="display:block;"/, 'لا بطاقة مفتوحة تلقائيًا');
  assert.doesNotMatch(out, /▾/);
  for(const card of out.split('class="crm-inc-card"').slice(1)){
    const head = card.slice(0, card.indexOf('</button>'));
    assert.doesNotMatch(head, /crm-ladder|crm-inc-warn|قريب من التحويل/, 'الرأس: الاسم وآخرها والشارات فقط');
  }
  assert.match(out, /بانتظار التحويل/);
  assert.match(out, /crm-inc-state"><span class="crm-ladder/);
  assert.match(out, /المرة القادمة من «تأخر» = تحويل/);
});

/* ============ 3.75: السلوك الدقيق داخل المخالفة ============ */
test('crmIncidentDetailOptions: يفصل ما بين القوسين، ولا أزرار لخيار واحد أو بلا قوسين', () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  assert.deepEqual(Array.from(app.crmIncidentDetailOptions({ problem_name: LONG })), ['حديث جانبي', 'مقاطعة', 'أكل أثناء الدرس']);
  assert.equal(app.crmIncidentDetailOptions({ problem_name: 'النوم داخل الفصل' }).length, 0);
  assert.equal(app.crmIncidentDetailOptions({ problem_name: 'تأخر (بدون عذر)' }).length, 0);
  assert.equal(app.crmIncidentDetailOptions(null).length, 0);
});

test('crmComposeDetailNotes: يستبدل اختيار التطبيق السابق ويُبقي ما كتبه المعلم', () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  assert.equal(app.crmComposeDetailNotes('', '', 'مقاطعة'), 'مقاطعة');
  assert.equal(app.crmComposeDetailNotes('مقاطعة — تكرر مرتين', 'مقاطعة', 'مقاطعة، أكل'), 'مقاطعة، أكل — تكرر مرتين');
  assert.equal(app.crmComposeDetailNotes('مقاطعة — تكرر', 'مقاطعة', ''), 'تكرر');
  assert.equal(app.crmComposeDetailNotes('نص المعلم', '', 'مقاطعة'), 'مقاطعة — نص المعلم');
  assert.equal(app.crmComposeDetailNotes('مقاطعة', 'مقاطعة', ''), '');
});

test('الأزرار: اختيار/إلغاء يكتب الملاحظة بترتيب اللائحة، وتغيير المخالفة يمسح اختيار السابقة', () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  runInAppContext(app, `crmIncidentTypes = [{ id: 'T', problem_name: '${LONG}' }, { id: 'U', problem_name: 'النوم داخل الفصل' }];
    document.getElementById('crmIncidentType').value = 'T'; document.getElementById('crmIncidentNotes').value = '';`);
  app.renderCrmIncidentDetailChips();
  const box = () => get(app, `document.getElementById('crmIncidentDetailBox')`);
  assert.equal(box().style.display, 'block');
  assert.match(box().innerHTML, /حديث جانبي/);
  app.toggleCrmIncidentDetail(2); app.toggleCrmIncidentDetail(0);
  const notes = () => get(app, `document.getElementById('crmIncidentNotes').value`);
  assert.equal(notes(), 'حديث جانبي، أكل أثناء الدرس');
  runInAppContext(app, `document.getElementById('crmIncidentNotes').value += ' — في آخر الحصة';`);
  app.toggleCrmIncidentDetail(0);
  assert.equal(notes(), 'أكل أثناء الدرس — في آخر الحصة');
  assert.match(box().innerHTML, /aria-pressed="true"[^>]*>أكل أثناء الدرس ✓/);
  runInAppContext(app, `document.getElementById('crmIncidentType').value = 'U';`);
  app.renderCrmIncidentDetailChips();
  assert.equal(notes(), 'في آخر الحصة', 'اختيار المخالفة السابقة لا يبقى');
  assert.equal(box().style.display, 'none');
});

test('الأزرار تُهرَّب (اسم النوع من القاعدة)', () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  runInAppContext(app, `crmIncidentTypes = [{ id: 'T', problem_name: 'س (<img src=x>/ب)' }]; document.getElementById('crmIncidentType').value = 'T';`);
  app.renderCrmIncidentDetailChips();
  const h = get(app, `document.getElementById('crmIncidentDetailBox').innerHTML`);
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});

/* ============ 3.76 ============ */
test('الأزرار تحت المخالفة المختارة مباشرة (لا بعد القائمة كلها فتختفي تحت حافة اللوحة)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'app-04-academic-crm.js'), 'utf8');
  const fn = src.slice(src.indexOf('function renderCrmIncidentDetailChips'), src.indexOf('function toggleCrmIncidentDetail'));
  assert.match(fn, /placeCrmIncidentDetailBox\(box\)/);
  assert.match(src, /querySelector\('\.crm-type-row\.is-on'\)[\s\S]{0,120}row\.after\(box\)/);
  const rc = src.slice(src.indexOf('async function renderCrmIncidentTypeChips'), src.indexOf('function revealCrmPickedType'));
  assert.ok(rc.indexOf('parkCrmIncidentDetailBox()') > -1 && rc.indexOf('parkCrmIncidentDetailBox()') < rc.indexOf('box.innerHTML ='), 'يُخرج الصندوق قبل مسح الصفوف');
  assert.match(rc, /renderCrmIncidentDetailChips\(\);/);
});

test('«موقف رسمي» (ورقة الحصة/ملف الطالب): نفس أزرار السلوك، متعدد، وتغيير المخالفة يمسح السابق', () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  runInAppContext(app, `crmIncidentTypes = [{ id: 'T', problem_name: '${LONG}' }, { id: 'U', problem_name: 'النوم داخل الفصل' }];
    document.getElementById('crmQiType').value = 'T'; document.getElementById('crmQiNotes').value = '';`);
  app.renderCrmQiDetailChips();
  const box = () => get(app, `document.getElementById('crmQiDetailBox')`);
  const notes = () => get(app, `document.getElementById('crmQiNotes').value`);
  assert.equal(box().style.display, 'block');
  app.toggleCrmQiDetail(1); app.toggleCrmQiDetail(0);
  assert.equal(notes(), 'حديث جانبي، مقاطعة');
  runInAppContext(app, `document.getElementById('crmQiType').value = 'U';`);
  app.renderCrmQiDetailChips();
  assert.equal(notes(), '');
  assert.equal(box().style.display, 'none');
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'app-15-student-profile.js'), 'utf8');
  assert.match(src, /id="crmQiType"[^>]*onchange="previewCrmQuickIncident\(\);renderCrmQiDetailChips\(\)"/);
  assert.match(src, /id="crmQiDetailBox"/);
});

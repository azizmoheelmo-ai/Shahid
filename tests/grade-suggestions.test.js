'use strict';
/* «مقترحون من الدرجات» (app-49، FOLLOWUP-AGREEMENT.md §10). القاعدة الحاكمة: ما يُقترح = تشخيص التقرير التحليلي (srDiagnose) حرفيًا. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const R = { pass: 50, edge: 10, top: 90, severe: 30 };
const J = v => JSON.parse(JSON.stringify(v));
const row = (id, score, max, o) => Object.assign({ id, name: id, label: id, score, max, pct: 100 * score / max, row: 'item', kind: 'manual', domain: 'tahsili', category: 'tests', classPct: null }, o || {});
const HW = (score) => row('واجبات', score, 10, { kind: 'homework', domain: 'taalumi', category: 'performance' });

function entry(app, studentId, rows, extra){
  const dx = app.srDiagnose(Object.assign({ rows, rules: R, homework: null, lessonsHeld: 9, overall: { pct: 70, incomplete: false }, testGroups: [] }, extra || {}));
  return { studentId, rows, dx };
}
const run = (app, entries, o) => app.gsSuggestionsFor(entries, Object.assign({ rules: R, sectionId: 'S', nameOf: id => id }, o || {}));

test('ضعف تحصيلي مثبت يُقترح، ودليله = توصية التقرير نفسها', () => {
  const app = loadApp();
  const e = entry(app, 'a', [row('اختبار1', 3, 10), row('اختبار2', 4, 10), row('اختبار3', 9, 10)]);
  const r = run(app, [e]);
  assert.equal(r.people.length, 1);
  const p = r.people[0];
  assert.equal(p.tag, 'tahsili');
  assert.equal(p.focus, 'tahsili');
  assert.deepEqual(J(p.focusRowIds), ['اختبار1', 'اختبار2']);
  const recEv = e.dx.recommendations.filter(x => !x.parent).map(x => x.evidence);
  assert.deepEqual(J(p.evidence), J(recEv), 'لا محرك ثانٍ: الدليل من srDiagnose');
});

test('لا يُقترح: نتيجة منخفضة في بند واحد، ولا بيانات كافية، ولا من له متابعة مفتوحة، ولا المُخفى', () => {
  const app = loadApp();
  const one = entry(app, 'b', [row('ا1', 3, 10), row('ا2', 8, 10), row('ا3', 9, 10)]);
  const few = entry(app, 'c', [row('ا1', 2, 10)]);
  assert.equal(run(app, [one, few]).people.length, 0);
  const weak = entry(app, 'd', [row('ا1', 3, 10), row('ا2', 4, 10)]);
  assert.equal(run(app, [weak], { openGrades: new Set(['d']) }).people.length, 0);
  const now = Date.now();
  assert.equal(run(app, [weak], { nowMs: now, dismissals: [{ rule_key: 'grade_suggest', subject_key: 'd', dismissed_at: new Date(now - 86400000).toISOString() }] }).people.length, 0);
  assert.equal(run(app, [weak], { nowMs: now, dismissals: [{ rule_key: 'grade_suggest', subject_key: 'd', dismissed_at: new Date(now - 15 * 86400000).toISOString() }] }).people.length, 1, 'بعد 14 يومًا يعود');
});

test('ضعف تعلّمي (واجبات ببيانات كافية) يُقترح بمكتبة الواجبات وبنده وحده', () => {
  const app = loadApp();
  const e = entry(app, 'h', [HW(3), row('ا1', 8, 10), row('ا2', 9, 10)], { homework: { total: 6, submitted: 2, partial: 0, late: 0, missing: 4 } });
  const p = run(app, [e]).people[0];
  assert.equal(p.tag, 'taalumi');
  assert.equal(p.focus, 'homework');
  assert.deepEqual(J(p.focusRowIds), ['واجبات']);
  const nodata = entry(app, 'h2', [HW(3), row('ا1', 8, 10), row('ا2', 9, 10)], { homework: { total: 2, submitted: 0, partial: 0, late: 0, missing: 2 } });
  assert.equal(run(app, [nodata]).people.length, 0, 'أقل من 3 واجبات محسوبة: لا حكم');
});

test('«يستدعي التواصل مع ولي الأمر» أولًا', () => {
  const app = loadApp();
  const weak = entry(app, 'z', [row('ا1', 3, 10), row('ا2', 4, 10)]);
  const parent = entry(app, 'a', [row('ا1', 3, 10), row('ا2', 4, 10), HW(2)], { homework: { total: 6, submitted: 1, partial: 0, late: 0, missing: 5 } });
  assert.equal(parent.dx.parentContact, true);
  const r = run(app, [weak, parent]);
  assert.deepEqual(J(r.people.map(p => [p.studentId, p.tag])), [['a', 'parent'], ['z', 'tahsili']]);
});

test('الضعف الجماعي: 30% فأكثر (و3 على الأقل) دون الحد في البند ← بطاقة، ولا يتكرر أصحابها أفرادًا', () => {
  const app = loadApp();
  const es = [
    entry(app, 'a', [row('ق', 2, 10), row('م', 3, 10)]),  /* كل ضعفه... م فردي وق جماعي ← يبقى فردًا (م ليس جماعيًا) */
    entry(app, 'b', [row('ق', 3, 10), row('م', 8, 10)]),
    entry(app, 'c', [row('ق', 4, 10), row('م', 8, 10)]),
    entry(app, 'd', [row('ق', 9, 10), row('م', 9, 10)]),
    entry(app, 'e', [row('ق', 9, 10), row('م', 9, 10)])
  ];
  const r = run(app, es, { openGrades: new Set(['c']) });
  assert.equal(r.groups.length, 1);
  const g = r.groups[0];
  assert.deepEqual([g.key, g.name, g.recorded], ['S|ق', 'ق', 5]);
  assert.deepEqual(J(g.members.map(m => [m.studentId, m.open])), [['a', false], ['b', false], ['c', true]]);
  assert.deepEqual(J(r.people.map(p => p.studentId)), ['a'], 'b وc لا ضعف مثبت لهما فرديًا، وa ضعفه في «م» أيضًا');
  const es2 = es.slice(1).concat([entry(app, 'a', [row('ق', 2, 10), row('ق2', 3, 10)]), entry(app, 'f', [row('ق2', 2, 10)]), entry(app, 'g', [row('ق2', 3, 10)])]);
  const r2 = run(app, es2);
  assert.ok(r2.groups.some(x => x.itemId === 'ق2'));
  assert.ok(!r2.people.some(p => p.studentId === 'a'), 'كل ضعف a في بنود جماعية: يُتابَع ضمن المجموعة');
  const two = run(app, es.slice(0, 2).concat(es.slice(3)));
  assert.equal(two.groups.length, 0, 'طالبان فقط دون الحد: لا بطاقة جماعية');
});

test('gsBaseline: نسبة البنود المحددة وحدها، والاسم للبند الواحد', () => {
  const app = loadApp();
  const cols = [{ id: 'h', name: 'واجبات', category: 'performance', max_score: 10 }, { id: 't', name: 'اختبار', category: 'tests', max_score: 20 }];
  const sc = [{ column_id: 'h', student_id: 's', score: 4 }, { column_id: 't', student_id: 's', score: 20 }, { column_id: 'h', student_id: 'x', score: 10 }];
  assert.deepEqual(J(app.gsBaseline(cols, sc, 's', ['h'], 'homework')), { category: 'performance', columnIds: ['h'], label: 'واجبات', focus: 'homework', pct: 40, sum: 4, max: 10 });
  assert.equal(app.gsBaseline(cols, sc, 's', ['h', 't'], 'tahsili').label, 'اختبارات ومهام');
  assert.equal(app.gsBaseline(cols, sc, 's', ['nope'], 'tahsili'), null);
});

test('نتيجة المتابعة تُقاس على البند الضعيف نفسه (columnIds) لا الفئة كلها', () => {
  const app = loadApp();
  const cols = [{ id: 'h', category: 'performance', max_score: 10 }, { id: 'p', category: 'performance', max_score: 10 }];
  const fu = { student_id: 's', created_at: '2026-11-01T00:00:00Z', baseline: { category: 'performance', columnIds: ['h'] } };
  const sc = [{ column_id: 'h', student_id: 's', score: 8, updated_at: '2026-11-05T00:00:00Z' }, { column_id: 'p', student_id: 's', score: 0, updated_at: '2026-11-05T00:00:00Z' }];
  assert.deepEqual(J(app.computeGradeFollowupResult(fu, cols, sc)), { sufficient: true, pct: 80, of: 1, current: true });
  const old = { ...fu, baseline: { category: 'performance' } };
  assert.equal(app.computeGradeFollowupResult(old, cols, sc).pct, 40, 'المتابعات القديمة بلا columnIds كما كانت');
});

test('مكتبة الاتفاق بحسب نوع الضعف', () => {
  const app = loadApp();
  assert.match(app.faLibraryFor('grades', 'homework').commitments[0], /واجب/);
  assert.match(app.faLibraryFor('grades', 'participation').commitments[0], /أشارك/);
  assert.match(app.faLibraryFor('grades', 'tahsili').commitments[0], /أراجع/);
  assert.equal(app.faLibraryFor('grades', null), app.faLibraryFor('grades'));
  assert.equal(app.faLibraryFor('absence', 'homework'), app.faLibraryFor('absence'), 'التركيز للتحصيل فقط');
  const a = app.faBuildAgreement('grades', { status: 'agreed', commit: 0, support: 0 }, 'd', 'homework');
  assert.equal(a.commitment, 'أسلّم كل واجب في موعده');
});

test('srHomeworkCountsFrom: عدّاد واجبات طالب من واجبات شعبة محمَّلة', () => {
  const app = loadApp();
  const hw = { homeworks: [{ id: 'w1', due_date: '2026-10-01' }, { id: 'w2', due_date: '2026-10-08' }, { id: 'w3', due_date: '2099-01-01' }],
    statusRows: [{ homework_id: 'w1', student_id: 's', status: 'submitted' }] };
  const c = J(app.srHomeworkCountsFrom(hw, 's', '2026-11-10'));
  assert.equal(c.total, 2);
  assert.equal(c.submitted, 1);
  assert.equal(c.missing, 1);
});

/* ===== الواجهة: البطاقة الجماعية ونافذتها والحفظ ===== */
function appWithGroup(){
  const log = { inserts: [], upserts: [] };
  const client = {
    from(table){
      let op = 'select', payload = null; const f = [];
      const api = {
        select(){ return api; }, eq(c, v){ f.push([c, v]); return api; }, in(){ return api; }, order(){ return api; }, limit(){ return api; },
        insert(p){ op = 'insert'; payload = p; return api; }, upsert(p){ op = 'upsert'; payload = p; return api; },
        then(res){
          if(op === 'insert'){ log.inserts.push({ table, payload }); return new Promise(r => setTimeout(r, 5)).then(() => ({ data: (Array.isArray(payload) ? payload : [payload]).map((_, i) => ({ id: 'F' + i })), error: null })).then(res); }
          if(op === 'upsert'){ log.upserts.push({ table, payload }); return Promise.resolve({ data: null, error: null }).then(res); }
          return Promise.resolve({ data: [], error: null }).then(res);
        }
      };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m); refreshAttentionViews = async () => {}; renderCrmFollowups = () => {};
    crmGradeLevels = [{ id: 'g', name: 'ثاني' }]; crmSections = [{ id: 'S', name: '6', grade_level_id: 'g' }];
    crmStudents = [{ id: 'a', full_name: 'أوس', section_id: 'S' }, { id: 'b', full_name: 'بدر', section_id: 'S' }, { id: 'c', full_name: 'سالم', section_id: 'S' }, { id: 'd', full_name: 'داود', section_id: 'S' }];
    gsState.status = 'ready';
    gsState.bySection = new Map([['S', { people: [], groups: [{ key: 'S|q', sectionId: 'S', itemId: 'q', name: '<img src=x>قصير', kind: 'manual', domain: 'tahsili', category: 'tests', classPct: 41, recorded: 4,
      members: [{ studentId: 'a', pct: 20, open: false }, { studentId: 'b', pct: 30, open: false }, { studentId: 'c', pct: 40, open: true }] }],
      g: { columns: [{ id: 'q', name: 'قصير', category: 'tests', max_score: 10 }], scores: [{ column_id: 'q', student_id: 'a', score: 2 }, { column_id: 'q', student_id: 'b', score: 3 }] } }]]);
    window.__root = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'gsGroupRoot' ? window.__root : _g(id);`);
  return { app, log };
}

test('البطاقة الجماعية: اسم البند مهرَّب، ونافذتها تختار من دون الحد إلا صاحب المتابعة المفتوحة', () => {
  const { app } = appWithGroup();
  const card = app.gsBodyHtml();
  assert.doesNotMatch(card, /<img/);
  assert.match(card, /gsOpenGroup\('S\|q'\)/);
  app.gsOpenGroup('S|q');
  const h = runInAppContext(app, 'window.__root.innerHTML');
  assert.match(h, /المختارون: 2/);
  assert.match(h, /له متابعة مفتوحة/);
  assert.match(h, /ابدأ المتابعة الجماعية \(طالبان\)/);
  assert.match(h, /إضافة طالب آخر من الشعبة/);
  app.gsGroupExtra();
  assert.match(runInAppContext(app, 'window.__root.innerHTML'), /داود/, 'بعد «إضافة طالب آخر»: بقية الشعبة تظهر');
  app.gsGroupToggle('a');
  assert.match(runInAppContext(app, 'window.__root.innerHTML'), /disabled[^>]*>اختر طالبين على الأقل/);
  app.gsGroupAll();
  assert.match(runInAppContext(app, 'window.__root.innerHTML'), /المختارون: 3/);
});

test('حفظ الجماعية: صف لكل طالب بمعرّف مجموعة واحد وبالمعلم، وخط أساس بالبند نفسه، والنقرة المزدوجة مرة', async () => {
  const { app, log } = appWithGroup();
  app.gsOpenGroup('S|q');
  await Promise.all([app.gsGroupSave(), app.gsGroupSave()]);
  const fu = log.inserts.filter(i => i.table === 'classroom_followups');
  assert.equal(fu.length, 1);
  const rows = fu[0].payload;
  assert.deepEqual(J(rows.map(r => r.student_id)).sort(), ['a', 'b']);
  assert.equal(new Set(rows.map(r => r.group_id)).size, 1);
  rows.forEach(r => { assert.equal(r.teacher_id, 'u1'); assert.equal(r.reason_type, 'grades'); assert.deepEqual(J(r.baseline.columnIds), ['q']); });
  assert.equal(rows[0].baseline.pct, 20);
  assert.equal(log.inserts.filter(i => i.table === 'classroom_followup_actions').length, 1);
});

test('«ليس الآن»: حفظ بالمعلم ومفتاح القاعدة، وإزالة محلية', async () => {
  const { app, log } = appWithGroup();
  runInAppContext(app, 'fuTabPaint = () => {}');
  await app.gsDismiss('grade_suggest_group', 'S|q');
  assert.deepEqual(J(log.upserts[0].payload).teacher_id, 'u1');
  assert.equal(log.upserts[0].payload.rule_key, 'grade_suggest_group');
  assert.equal(runInAppContext(app, `gsState.bySection.get('S').groups.length`), 0);
});

test('كل استعلام في app-49 مقيَّد بالمعلم، والملف مسجَّل بالصفحة والكاش', () => {
  const root = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'app/app-49-grade-suggestions.js'), 'utf8');
  const reads = src.match(/sb\.from\('[a-z_]+'\)\.select\([^;]*;/g) || [];
  assert.ok(reads.length >= 3);
  reads.forEach(q => assert.match(q, /\.eq\('teacher_id', currentUser\.id\)/, q));
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-49-grade-suggestions\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-49-grade-suggestions\.js/);
});

test('تغيّر الفصل الدراسي يلغي المقترحات المحفوظة للجلسة', async () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `crmSections = []; let __t = { year: '1448', semester: 'الأول' }; crmCurrentTerm = () => __t;
    gsState.status = 'ready'; gsState.termKey = gsTermKey(); gsState.bySection = new Map([['S', { people: [{}], groups: [] }]]);
    __t = { year: '1448', semester: 'الثاني' };`);
  await app.gsEnsureLoaded();
  assert.equal(runInAppContext(app, 'gsState.bySection.size'), 0);
});

/* ===== إصلاحات المراجعة الشاملة (3.41) ===== */

test('إصلاح: متابعة الاختبارات تُقاس بكل تحصيلي رُصد بعد الفتح (الاختبار القديم لا تُعاد درجته)', () => {
  const app = loadApp();
  const cols = [{ id: 't1', category: 'tests', max_score: 10 }, { id: 't2', category: 'tests', max_score: 10 }, { id: 'k', category: 'performance', kind: 'task', max_score: 20 }, { id: 'h', category: 'performance', kind: 'homework', max_score: 10 }];
  const base = app.gsBaseline(cols, [{ column_id: 't1', student_id: 's', score: 3 }], 's', ['t1'], 'tahsili');
  assert.equal(base.measure, 'tahsili');
  const fu = { student_id: 's', created_at: '2026-11-01T00:00:00Z', baseline: base };
  const sc = [
    { column_id: 't1', student_id: 's', score: 3, updated_at: '2026-10-20T00:00:00Z' },  /* الاختبار الضعيف القديم */
    { column_id: 't2', student_id: 's', score: 8, updated_at: '2026-11-05T00:00:00Z' },  /* اختبار جديد بعد الفتح */
    { column_id: 'k', student_id: 's', score: 14, updated_at: '2026-11-06T00:00:00Z' },  /* مهمة أدائية */
    { column_id: 'h', student_id: 's', score: 0, updated_at: '2026-11-06T00:00:00Z' }    /* الواجبات ليست تحصيلًا */
  ];
  const r = J(app.computeGradeFollowupResult(fu, cols, sc));
  assert.deepEqual(r, { sufficient: true, pct: 73, of: 2 }, 'كان قبل الإصلاح: «لا بيانات كافية» دائمًا');
  assert.equal(app.suggestFollowupOutcome({ reason_type: 'grades', baseline: base }, r), 'improved');
});

test('إصلاح: الواجبات تُقاس بما انقضى موعده منذ الفتح فقط، و«قبل» بالعدد', () => {
  const app = loadApp();
  const fu = { student_id: 's', created_at: '2026-11-01T09:00:00Z', baseline: { category: 'performance', focus: 'homework', pct: 40, hw: { submitted: 4, total: 9 } } };
  const hw = { homeworks: [{ id: 'old', due_date: '2026-10-20' }, { id: 'w1', due_date: '2026-11-03' }, { id: 'w2', due_date: '2026-11-06' }, { id: 'future', due_date: '2099-01-01' }],
    statusRows: [{ homework_id: 'w1', student_id: 's', status: 'submitted' }, { homework_id: 'old', student_id: 's', status: 'submitted' }] };
  const r = J(app.computeHomeworkFollowupResult(fu, hw, '2026-11-10'));
  assert.deepEqual([r.sufficient, r.of, r.submitted], [true, 2, 1]);
  assert.match(app.gradeAfterText(r), /سلّم 1 من 2 واجبات منذ الفتح/);
  assert.match(app.gradeBeforeText(fu.baseline), /سلّم 4 من 9 واجبات/);
  const notYet = { homeworks: hw.homeworks, statusRows: [{ homework_id: 'old', student_id: 's', status: 'submitted' }] };
  assert.equal(app.computeHomeworkFollowupResult(fu, notYet, '2026-11-02').sufficient, false, 'لا واجب انقضى (أو بدأ رصده) بعد الفتح');
});

test('إصلاح: «يريد الحديث معك» يبقى في «تحتاجك الآن»', () => {
  const app = loadApp();
  const st = J(app.fuRowState({ review_date: '2026-11-30', agreement: { status: 'wants_talk' } }, '2026-11-10'));
  assert.deepEqual(st, { need: true, due: false, chip: 'يريد الحديث معك', action: 'agree' });
  assert.equal(app.fuRowState({ review_date: '2026-11-30', agreement: { status: 'agreed' } }, '2026-11-10').need, false);
});

test('إصلاح: المتابعة التالية بعد «لم يتحسّن» تحمل البند ونوع القياس ومكتبة الاتفاق بأرقام اليوم', () => {
  const app = loadApp();
  const cols = [{ id: 'h', category: 'performance', kind: 'homework', max_score: 10 }, { id: 'p', category: 'performance', max_score: 10 }];
  const old = { category: 'performance', columnIds: ['h'], focus: 'homework', label: 'واجبات', pct: 30, hw: { submitted: 3, total: 10 } };
  const nb = J(app.refreshGradeBaseline(old, cols, [{ column_id: 'h', student_id: 's', score: 5 }, { column_id: 'p', student_id: 's', score: 0 }], 's'));
  assert.deepEqual(nb, { category: 'performance', columnIds: ['h'], focus: 'homework', label: 'واجبات', pct: 50, sum: 5, max: 10 });
  const t = J(app.refreshGradeBaseline({ category: 'tests', measure: 'tahsili', focus: 'tahsili', columnIds: ['t1'], label: 'ق', pct: 20 },
    [{ id: 't1', category: 'tests', max_score: 10 }, { id: 't2', category: 'tests', max_score: 10 }], [{ column_id: 't1', student_id: 's', score: 2 }, { column_id: 't2', student_id: 's', score: 8 }], 's'));
  assert.deepEqual([t.pct, t.measure, t.label], [50, 'tahsili', 'الاختبارات والمهام']);
  assert.equal(app.refreshGradeBaseline(old, cols, [], 's'), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'app/app-16-attention-followups.js'), 'utf8');
  assert.match(src, /baseline = refreshGradeBaseline\(f\.baseline, g\.columns, g\.scores, f\.student_id\)/);
  assert.match(src, /openCrmFollowupModal\(f\.student_id, \{ reasonType: f\.reason_type, reasonText: f\.reason_text, baseline \}\)/);
});

/* ===== تحسينات 3.44 ===== */
function gsApp(){
  const log = { deletes: [], upserts: [] };
  const client = {
    from(table){
      let op = 'select'; const f = [];
      const api = { select: () => api, in: () => api, order: () => api, eq(c, v){ f.push([c, v]); return api; },
        upsert(p){ op = 'upsert'; log.upserts.push(p); return api; }, delete(){ op = 'delete'; return api; },
        then(res){ if(op === 'delete') log.deletes.push({ table, f: f.slice() }); return Promise.resolve({ data: [], error: null }).then(res); } };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `fuTabPaint = () => {}; window.__undo = null; showUndoToast = () => new Promise(r => { window.__undo = r; });
    crmGradeLevels = [{ id: 'g', name: 'ثاني' }]; crmSections = [{ id: 'S', name: '6', grade_level_id: 'g' }];
    crmStudents = [{ id: 'a', full_name: 'أوس الوادعي', section_id: 'S', guardian_phone: '966500000000' }, { id: 'b', full_name: 'بدر', section_id: 'S' }];
    gsState.status = 'ready';
    gsState.bySection = new Map([['S', { groups: [{ key: 'S|q', sectionId: 'S', itemId: 'q', name: 'ق', members: [{ studentId: 'a', pct: 20, open: false }, { studentId: 'b', pct: 30, open: false }], classPct: 40, recorded: 5 }],
      people: [{ studentId: 'a', parent: true, tag: 'parent', evidence: ['دليل أول', '<b>دليل ثانٍ</b>'], focus: 'tahsili', focusRowIds: [], weakRowIds: [] },
               { studentId: 'b', parent: false, tag: 'tahsili', evidence: ['د'], focus: 'tahsili', focusRowIds: [], weakRowIds: [] }], g: { columns: [], scores: [] } }]]);`);
  return { app, log };
}

test('فتح متابعة تحصيل يزيل الطالب محليًا بلا إعادة قراءة الكشوف، ويعلّمه في البطاقة الجماعية', () => {
  const { app } = gsApp();
  const token = runInAppContext(app, 'gsState.token');
  app.gsAfterOpen('a', 'absence');
  assert.equal(runInAppContext(app, `gsState.bySection.get('S').people.length`), 2, 'سبب غير التحصيل لا يمسّ المقترحات');
  app.gsAfterOpen('a', 'grades');
  assert.deepEqual(J(runInAppContext(app, `gsState.bySection.get('S').people.map(p => p.studentId)`)), ['b']);
  assert.equal(runInAppContext(app, `gsState.bySection.get('S').groups[0].members[0].open`), true);
  assert.equal(runInAppContext(app, 'gsState.status'), 'ready');
  assert.equal(runInAppContext(app, 'gsState.token'), token, 'لا إعادة تحميل');
  const src = fs.readFileSync(path.join(__dirname, '..', 'app/app-16-attention-followups.js'), 'utf8');
  assert.match(src, /gsAfterOpen\(d\.studentId, reasonType\)/);
  assert.match(src, /if\(f\.reason_type === 'grades' && typeof gsInvalidate === 'function'\) gsInvalidate\(\);/, 'الإغلاق يعيد حساب المقترحات');
});

test('سطر المقترح: كل الأدلة ظاهرة ومهرَّبة، وواتساب ولي الأمر لمن يستدعيه وله رقم فقط', () => {
  const { app } = gsApp();
  const h = app.gsBodyHtml();
  assert.match(h, /دليل أول/);
  assert.match(h, /&lt;b&gt;دليل ثانٍ&lt;\/b&gt;/);
  assert.doesNotMatch(h, /\(\+1\)/);
  assert.equal((h.match(/gsWaGuardian\(/g) || []).length, 1);
  assert.match(h, /gsWaGuardian\('a'\)/);
});

test('واتساب ولي الأمر: مسودة بالاسم الأول وبلا أي رقم أو درجة', () => {
  const { app } = gsApp();
  runInAppContext(app, `window.__wa = null; openCrmWaNote = (id, who, draft) => { window.__wa = { id, who, draft }; };`);
  app.gsWaGuardian('a');
  const wa = J(runInAppContext(app, 'window.__wa'));
  assert.deepEqual([wa.id, wa.who], ['a', 'guardian']);
  assert.match(wa.draft, /ولي أمر الطالب أوس الكريم/);
  assert.doesNotMatch(wa.draft, /\d|%|الوادعي/);
});

test('«ليس الآن» ثم «تراجع»: تُحذف علامة الإخفاء للمعلم وحده ويعود الاقتراح مكانه', async () => {
  const { app, log } = gsApp();
  await app.gsDismiss('grade_suggest', 'a');
  assert.deepEqual(J(runInAppContext(app, `gsState.bySection.get('S').people.map(p => p.studentId)`)), ['b']);
  runInAppContext(app, 'window.__undo(false)'); /* ضغط «تراجع» */
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(J(log.deletes[0]), { table: 'classroom_attention_dismissals', f: [['teacher_id', 'u1'], ['rule_key', 'grade_suggest'], ['subject_key', 'a']] });
  assert.deepEqual(J(runInAppContext(app, `gsState.bySection.get('S').people.map(p => p.studentId)`)), ['a', 'b'], 'يعود في موضعه');
  assert.equal(runInAppContext(app, 'gsState.dismissals.length'), 0);
  await app.gsDismiss('grade_suggest', 'b');
  runInAppContext(app, 'window.__undo(true)'); /* انتهت المهلة بلا تراجع */
  await new Promise(r => setTimeout(r, 10));
  assert.equal(log.deletes.length, 1);
});

test('فشل قراءة كشف شعبة لا يُسقط البقية ويُذكر مع إعادة المحاولة', async () => {
  const { app } = gsApp();
  runInAppContext(app, `crmSections = [{ id: 'S', name: '6', grade_level_id: 'g' }, { id: 'T', name: '7', grade_level_id: 'g' }];
    crmStudents.push({ id: 'c', full_name: 'ج', section_id: 'T' });
    gsLoadDismissals = async () => []; gsLoadOpenGrades = async () => new Set();
    gsLoadSection = async (id) => { if(id === 'T') throw new Error('x'); return { people: [{ studentId: 'b', parent: false, tag: 'tahsili', evidence: ['د'] }], groups: [] }; };
    gsInvalidate();`);
  await app.gsEnsureLoaded();
  assert.equal(runInAppContext(app, 'gsState.status'), 'ready');
  assert.deepEqual(J(runInAppContext(app, 'gsState.failed')), ['T']);
  const h = app.gsBodyHtml();
  assert.match(h, /تعذّرت قراءة <bdi>ثاني\/7<\/bdi>/);
  assert.match(h, /ضعف مثبت \(1\)/);
});

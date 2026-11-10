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
  assert.deepEqual(J(app.computeGradeFollowupResult(fu, cols, sc)), { sufficient: true, pct: 80, of: 1 });
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

'use strict';
/* تبويب «متابعة» (app-48 + renderCrmFollowups بـapp-16): بحث بالاسم، اختيار الفصل، تصنيف بالحالة، زر واحد لكل صف. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TODAY = '2026-11-10';
const plain = (v) => JSON.parse(JSON.stringify(v));

test('fuShortFact: بلا قائمة التواريخ، وبلا تكرار اسم السبب', () => {
  const app = loadApp();
  assert.equal(app.fuShortFact({ reason_type: 'absence', reason_text: 'غاب 5 من آخر 8 حصص: الأحد 13/9، الأربعاء 16/9' }), 'غياب · غاب 5 من آخر 8 حصص');
  assert.equal(app.fuShortFact({ reason_type: 'absence', reason_text: 'غياب' }), 'غياب');
  assert.equal(app.fuShortFact({ reason_type: 'other', reason_text: 'لا يحضر كتابه' }), 'لا يحضر كتابه');
});

test('fuRowState: موعد حان ← مراجعة؛ بلا اتفاق ← اتفاق؛ غير ذلك ← فتح مع عدد الأيام', () => {
  const app = loadApp();
  assert.deepEqual(plain(app.fuRowState({ review_date: TODAY, agreement: { status: 'agreed' } }, TODAY)), { need: true, due: true, chip: 'حان وقت المراجعة', action: 'review' });
  assert.equal(app.fuRowState({ review_date: '2026-11-20', agreement: null }, TODAY).action, 'agree');
  const calm = app.fuRowState({ review_date: '2026-11-15', agreement: { status: 'agreed' } }, TODAY);
  assert.equal(calm.need, false);
  assert.equal(calm.chip, 'بعد 5 أيام');
  assert.equal(app.fuRowState({ review_date: '2026-11-11', agreement: {} }, TODAY).chip, 'غدًا');
  assert.equal(app.fuRowState({ review_date: '2026-11-12', agreement: {} }, TODAY).chip, 'بعد يومين');
  assert.equal(app.fuRowState({ review_date: '2026-11-25', agreement: {} }, TODAY).chip, 'بعد 15 يومًا');
  assert.equal(app.fuRowState({ review_date: '2026-11-20', members: [{}, {}] }, TODAY).need, false, 'الجماعية لا اتفاق لها فلا تُطلب به');
});

const ROWS = [
  { id: 'a', student_id: 's1', section_id: 'A', review_date: '2026-11-20', agreement: { status: 'agreed' } },
  { id: 'b', student_id: 's2', section_id: 'A', review_date: '2026-11-01', agreement: { status: 'agreed' } },
  { id: 'c', student_id: 's3', section_id: 'B', review_date: '2026-11-18', agreement: null },
  { id: 'd', student_id: 's4', section_id: 'B', review_date: '2026-11-12', agreement: { status: 'agreed' } }
];
const NAMES = { s1: 'أحمد علي', s2: 'سالم فهد', s3: 'خالد عمر', s4: 'مُعاذ سعد' };
const info = (f) => ({ names: [NAMES[f.student_id]], sectionId: f.section_id });

test('fuTabGroups: المستحق أولًا ثم بلا اتفاق، والجارية بالأقرب موعدًا؛ والفلترة بالفصل والاسم', () => {
  const app = loadApp();
  const ids = (l) => plain(l.map(x => x.f.id));
  const g = app.fuTabGroups(ROWS, TODAY, {}, info);
  assert.deepEqual(ids(g.need), ['b', 'c']);
  assert.deepEqual(ids(g.ongoing), ['d', 'a']);
  const sec = app.fuTabGroups(ROWS, TODAY, { section: 'B' }, info);
  assert.deepEqual([ids(sec.need), ids(sec.ongoing)], [['c'], ['d']]);
  assert.deepEqual(ids(app.fuTabGroups(ROWS, TODAY, { q: 'احمد' }, info).ongoing), ['a'], 'بلا همزة');
  assert.deepEqual(ids(app.fuTabGroups(ROWS, TODAY, { q: 'معاذ' }, info).ongoing), ['d'], 'بلا تشكيل');
  assert.deepEqual(plain(app.fuSectionCounts(ROWS, info)), [{ id: 'A', n: 2 }, { id: 'B', n: 2 }]);
});

test('fuPickStudents: النشطون فقط، ضمن الفصل، بالاسم، وبحدّ', () => {
  const app = loadApp();
  const st = [{ id: '1', full_name: 'أحمد', section_id: 'A' }, { id: '2', full_name: 'أحمد منقول', section_id: 'A', is_active: false }, { id: '3', full_name: 'أحمد ب', section_id: 'B' }];
  assert.deepEqual(plain(app.fuPickStudents(st, 'احمد', '', 25).map(x => x.id)), ['1', '3']);
  assert.deepEqual(plain(app.fuPickStudents(st, '', 'B', 25).map(x => x.id)), ['3']);
  assert.equal(app.fuPickStudents(st, '', '', 1).length, 1);
});

function appWithTab(open, closed){
  const calls = [];
  const client = {
    from(table){
      const filters = [];
      const api = { select(){ return api; }, eq(c, v){ filters.push([c, v]); return api; }, order(){ return api; }, limit(){ return api; }, in(){ return api; }, gte(){ return api; }, lte(){ return api; },
        then(res){ calls.push({ table, filters: filters.slice() });
          const isClosed = filters.some(([c, v]) => c === 'status' && v === 'closed');
          return Promise.resolve({ data: table === 'classroom_followups' ? (isClosed ? closed : open) : [], error: null }).then(res); } };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `
    localIsoDate = () => '${TODAY}'; getAttentionFresh = async () => null; followupVisible = () => true;
    crmGradeLevels = [{ id: 'g', name: '2' }]; crmSections = [{ id: 'A', name: '1', grade_level_id: 'g' }, { id: 'B', name: '3', grade_level_id: 'g' }];
    crmStudents = ${JSON.stringify(Object.keys(NAMES).map(id => ({ id, full_name: NAMES[id], section_id: 'A' })))};
    window.__box = { innerHTML: '' }; window.__list = { innerHTML: '' };
    const _g = document.getElementById; document.getElementById = id => id === 'crmFollowupsBody' ? window.__box : id === 'fuTabList' ? window.__list : _g(id);`);
  return { app, calls };
}
const full = (r) => ({ reason_type: 'absence', reason_text: 'غاب 3 من آخر 8 حصص: الأحد', group_id: null, ...r });

test('الرسم: الاستعلامان مقيَّدان بالمعلم، المجموعتان بالترتيب، زر واحد لكل صف، والمنتهية مطوية', async () => {
  const { app, calls } = appWithTab(ROWS.map(full), [full({ id: 'z', student_id: 's1', outcome: 'improved' })]);
  await app.renderCrmFollowups();
  const fu = calls.filter(c => c.table === 'classroom_followups');
  assert.equal(fu.length, 2);
  fu.forEach(c => assert.ok(c.filters.some(([k, v]) => k === 'teacher_id' && v === 'u1')));
  const h = runInAppContext(app, 'window.__box.innerHTML');
  assert.match(h, /أتابعهم الآن \(4\)/);
  assert.match(h, /fuNewFollowup\(\)/);
  assert.match(h, /id="fuTabSearch"/);
  assert.match(h, /كل الفصول/);
  assert.match(h, /<bdi>2\/1<\/bdi> \(2\)/);
  assert.ok(h.indexOf('تحتاجك الآن (2)') < h.indexOf('جارية — لا شيء مطلوب الآن (2)'));
  assert.equal((h.match(/class="fu-row"/g) || []).length, 4, 'المنتهية مطوية');
  assert.equal((h.match(/fu-b"/g) || []).length, 4, 'زر واحد لكل صف');
  assert.match(h, /openFollowupAgreement\('c'\)[^>]*>🤝 اتفاق</);
  assert.match(h, /openCrmReviewModal\('b'\)[^>]*>مراجعة</);
  assert.doesNotMatch(h, /الأحد/, 'قائمة التواريخ لا تظهر في السطر');
  assert.match(h, /المتابعات المنتهية \(1\)/);
  app.fuTabSet('closed', true);
  assert.match(runInAppContext(app, 'window.__box.innerHTML'), /تحسّن/);
});

test('البحث يعيد رسم القائمة وحدها (لا الحقل)، وأكثر من 5 جارية تُطوى بزر «عرض الباقي»', async () => {
  const many = Array.from({ length: 8 }, (_, i) => full({ id: 'm' + i, student_id: 's1', section_id: 'A', review_date: '2026-11-2' + i, agreement: { status: 'agreed' } }));
  const { app } = appWithTab(many, []);
  await app.renderCrmFollowups();
  const h = runInAppContext(app, 'window.__box.innerHTML');
  assert.equal((h.match(/class="fu-row"/g) || []).length, 5);
  assert.match(h, /عرض الباقي \(3\)/);
  runInAppContext(app, 'window.__box.innerHTML = "KEEP"');
  app.fuTabSearch('لا أحد');
  assert.equal(runInAppContext(app, 'window.__box.innerHTML'), 'KEEP');
  assert.match(runInAppContext(app, 'window.__list.innerHTML'), /لا نتائج/);
  app.fuTabSearch('أحمد');
  assert.equal((runInAppContext(app, 'window.__list.innerHTML').match(/class="fu-row"/g) || []).length, 8, 'عند البحث يظهر الكل');
});

test('XSS: اسم الطالب ونص السبب مهرَّبان', async () => {
  const { app } = appWithTab([full({ id: 'x', student_id: 's1', section_id: 'A', review_date: TODAY, reason_text: '<img src=x onerror=1>' })], []);
  runInAppContext(app, `crmStudents = [{ id: 's1', full_name: '<script>alert(1)</script>', section_id: 'A' }];`);
  await app.renderCrmFollowups();
  assert.doesNotMatch(runInAppContext(app, 'window.__box.innerHTML'), /<script>|<img/);
});

test('اسم التبويب «متابعة» (نص ظاهر فقط؛ المعرّفات كما هي)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="crmTabBtnFollowups" onclick="switchCrmTab\('followups'\)">متابعة</);
});

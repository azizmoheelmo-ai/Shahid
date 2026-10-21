'use strict';
/* ============================================================
   تبويب "اليوم" (v2.1):
   - "الحصة الآن" تُتعلَّم من وقت رصد المعلم المعتاد لكل حصة — بلا أوقات يُدخلها.
   - بدون تعلّم كافٍ: أول حصة لم تُرصد بعد آخر حصة رُصدت (الحصة الأولى المنسية لا تعلق).
   - "ليست هي؟" تصحّح اليوم بنقرة (تزيح كل الأوقات — رمضان).
   - مربّعات الأدوات تفتح ورقة الحصة على الأداة مباشرة.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

function client(tables, log){
  return {
    from(t){
      const q = { table: t, eqs: [] };
      if(log) log.push(q);
      const a = { select: () => a, eq: (k, v) => { q.eqs.push([k, v]); return a; }, in: () => a, gte: () => a, lte: () => a, is: () => a, order: () => a, limit: () => a,
        then: (r) => Promise.resolve({ data: (tables && tables[t]) || [], error: null }).then(r) };
      return a;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
}
const get = (app, e) => runInAppContext(app, e);

/* رصدة حصة p في يوم d الساعة hh:mm بتوقيت الجهاز */
function rec(app, p, d, hhmm){
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, da] = d.split('-').map(Number);
  return { period: p, lesson_date: d, created_at: new Date(y, mo - 1, da, h, m).toISOString() };
}

test('learnPeriodTimes — الوسيط لكل حصة، ويتجاهل الرصد الليلي والرصد في يوم آخر', () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  const L = [
    rec(app, 1, '2026-10-05', '23:20'), rec(app, 1, '2026-10-06', '07:19'), rec(app, 1, '2026-10-07', '07:21'), rec(app, 1, '2026-10-08', '07:37'),
    rec(app, 2, '2026-10-06', '08:37'), rec(app, 2, '2026-10-07', '08:19'), rec(app, 2, '2026-10-08', '10:44'), rec(app, 2, '2026-10-12', '08:30'),
    rec(app, 5, '2026-10-07', '11:24'), rec(app, 5, '2026-10-08', '11:03'), rec(app, 5, '2026-10-12', '10:49'),
    rec(app, 7, '2026-10-12', '12:41'), /* رصدة واحدة — لا تكفي */
    { period: 4, lesson_date: '2026-10-05', created_at: new Date(2026, 9, 9, 10, 30).toISOString() }, /* رُصدت بعد أيام */
    { period: 4, lesson_date: '2026-10-06', created_at: new Date(2026, 9, 6, 10, 31).toISOString() }
  ];
  const t = app.learnPeriodTimes(L);
  assert.deepEqual({ ...t }, { 1: 7 * 60 + 21, 2: 8 * 60 + 34, 5: 11 * 60 + 3 });
  assert.equal(app.learnPeriodTimes(L.filter(x => x.period === 1)), null, 'حصة واحدة معروفة لا تكفي');
  assert.equal(app.learnPeriodTimes([]), null);
});

test('learnPeriodTimes — آخر 8 رصدات فقط (يتكيّف مع تغيّر الجدول)', () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  const L = [];
  for(let i = 1; i <= 10; i++) L.push(rec(app, 1, `2026-09-${String(i).padStart(2, '0')}`, '07:00'));
  for(let i = 1; i <= 8; i++) L.push(rec(app, 1, `2026-10-${String(i).padStart(2, '0')}`, '08:00'));
  for(let i = 1; i <= 8; i++) L.push(rec(app, 2, `2026-10-${String(i).padStart(2, '0')}`, '09:00'));
  assert.equal(app.learnPeriodTimes(L)[1], 8 * 60);
});

test('estimatePeriodMinutes — بين جارتيها، ومن الطرف بمتوسط طول الحصة', () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  const learned = { 1: 420, 2: 470, 4: 570 };
  assert.equal(app.estimatePeriodMinutes(2, learned), 470);
  assert.equal(app.estimatePeriodMinutes(3, learned), 520);
  assert.equal(app.estimatePeriodMinutes(6, learned), 570 + 2 * 50);
  assert.equal(app.estimatePeriodMinutes(1, null), null);
});

test('pickTodayFocus — بالساعة: أول حصة / الآن / انتهى اليوم، و"لم أحضر" لا تُعرض', () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  const learned = { 1: 447, 2: 512, 4: 631, 5: 666 };
  const rows = [1, 2, 4, 5].map(p => ({ period: p, section_id: 'S' + p, recorded: false, skip: null }));
  assert.equal(app.pickTodayFocus(rows, 6 * 60, learned, null).state, 'first');
  const f = app.pickTodayFocus(rows, 11 * 60 + 5, learned, null);
  assert.deepEqual([f.index, f.state, f.byClock], [3, 'now', true]);
  /* الحصة الحالية رُصدت = تبقى المعروضة (تظهر أدواتها: المشاركة، الواجب…) */
  rows[3].recorded = true;
  assert.equal(app.pickTodayFocus(rows, 11 * 60 + 5, learned, null).index, 3);
  assert.equal(app.pickTodayFocus(rows, 13 * 60, learned, null).state, 'over');
  rows[3].skip = { id: 'k' }; rows[3].recorded = false;
  assert.equal(app.pickTodayFocus(rows, 11 * 60 + 5, learned, null).index, 2, 'التي لم يحضرها تُتخطّى');
});

test('pickTodayFocus — "ليست هي؟" تزيح اليوم كله (رمضان: الحصص أبطأ)', () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  const learned = { 1: 420, 2: 470, 3: 520, 4: 570 };
  const rows = [1, 2, 3, 4].map(p => ({ period: p, section_id: 'S', recorded: false, skip: null }));
  /* الساعة 9:35 = الحصة 4 بالمعتاد، لكن المعلم قال إنها الثانية الآن */
  assert.equal(app.pickTodayFocus(rows, 575, learned, null).index, 3);
  const pick = { period: 2, atMin: 575 };
  assert.equal(app.pickTodayFocus(rows, 575, learned, pick).index, 1);
  assert.equal(app.pickTodayFocus(rows, 625, learned, pick).index, 2, 'بعد 50 دقيقة: الثالثة');
  assert.equal(app.pickTodayFocus(rows, 575, learned, { period: 9, atMin: 575 }).index, 3, 'تصحيح لحصة ليست اليوم يُهمل');
});

test('pickTodayFocus — بلا تعلّم: أول غير مرصودة بعد آخر مرصودة (الأولى المنسية لا تعلق)', () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  const rows = [1, 3, 5, 6].map(p => ({ period: p, section_id: 'S', recorded: p === 3, skip: null }));
  const f = app.pickTodayFocus(rows, 600, null, null);
  assert.deepEqual([f.index, f.state, f.byClock], [2, 'next', false]);
  rows[2].recorded = true; rows[3].recorded = true;
  assert.equal(app.pickTodayFocus(rows, 600, null, null).index, 0, 'لا شيء بعدها = أول غير مرصودة');
  rows[0].skip = { id: 'k' };
  assert.equal(app.pickTodayFocus(rows, 600, null, null).state, 'done');
  /* التثبيت اليدوي حتى تُرصد */
  const rows2 = [1, 2, 3].map(p => ({ period: p, section_id: 'S', recorded: false, skip: null }));
  assert.equal(app.pickTodayFocus(rows2, 600, null, { period: 3, atMin: 600 }).index, 2);
  rows2[2].recorded = true;
  assert.equal(app.pickTodayFocus(rows2, 600, null, { period: 3, atMin: 600 }).index, 0);
});

test('todayToolTiles — 4 مربّعات على الأكثر، والذهبي من أين يبدأ', () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  const t1 = app.todayToolTiles(['attendance', 'participation', 'homework'], false);
  assert.deepEqual(t1.map(t => [t.mode, t.gold, t.done]), [['attendance', true, false], ['participation', false, false], ['homework', false, false]]);
  const t2 = app.todayToolTiles(['attendance', 'participation', 'homework'], true);
  assert.deepEqual(t2.map(t => [t.gold, t.done]), [[false, true], [true, false], [false, false]]);
  const t3 = app.todayToolTiles(['attendance', 'participation', 'homework', 'task', 'tool:x'], false);
  assert.equal(t3.length, 4);
  assert.equal(t3[3].more, true);
  assert.deepEqual([...t3[3].rest], ['task', 'tool:x']);
  const t4 = app.todayToolTiles(['participation', 'homework'], false);
  assert.equal(t4.some(t => t.gold), false, 'الحضور مخفي: لا "ابدأ هنا"');
});

function renderApp(opts){
  const log = [];
  const today = '2026-10-21';
  const lessons = (opts.lessons || []).map(l => Object.assign({ lesson_date: today }, l));
  const app = loadApp({ supabaseClient: client({ classroom_lessons: lessons }, log), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    localIsoDate = (d) => d ? (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) : '${today}';
    appFeatures = { sections: { shahid: false }, tools: ${JSON.stringify(opts.tools || {})} };
    crmCustomTools = ${JSON.stringify(opts.customTools || [])};
    loadCrmTimetable = async () => true; crmHolidayChecker = async () => ({ nameFor: () => null });
    crmSections = [{ id: 'S1', name: ${JSON.stringify(opts.sectionName || '١')} }, { id: 'S2', name: '٢' }];
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S1' }];
    crmTimetableSlots = [{ section_id: 'S1', weekday: 3, period: 1, created_at: '2020-01-01' }, { section_id: 'S2', weekday: 3, period: 2, created_at: '2020-01-01' }];
    window.__box = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'crmTodayBody' ? window.__box : _g(id);`);
  return { app, log };
}

test('البطاقة الكبيرة: مربّع لكل أداة يفتح الورقة على أداته — والأسماء مُهرَّبة', async () => {
  const { app } = renderApp({ sectionName: '<img src=x onerror=alert(1)>', tools: { homework: false, tasks: false, tests: false },
    customTools: [{ id: 'T1', name: '<b>قراءة</b>', tool_type: 'counter', hidden: false }] });
  await app.renderCrmToday();
  const html = get(app, 'window.__box.innerHTML');
  assert.match(html, /class="crm-hero"/);
  assert.match(html, /الحصة التالية: 1/);
  assert.match(html, /onclick="openCrmLessonSheet\('S1','2026-10-21',1,'participation'\)"/);
  assert.match(html, /class="crm-tile is-gold"[^>]*>\s*<span class="crm-tile-ic">👥<\/span>\s*<b>الحضور<\/b><small>ابدأ هنا<\/small>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /<span class="crm-tile-ic">🔢<\/span>\s*<b>&lt;b&gt;قراءة&lt;\/b&gt;<\/b>/, 'مربّع الأداة الخاصة باسمها مهرّبًا');
  assert.match(html, /onclick="openCrmLessonSheet\('S1','2026-10-21',1,'tool:T1'\)"/);
  assert.match(html, /المتبقية \(2\)/);
  assert.match(html, /المنجزة \(0\)/);
  assert.doesNotMatch(html, /لم يُرصد|ناقص/, 'بلا تنبيهات');
});

test('أداة واحدة مفعّلة = زر عريض واحد بدل المربّعات', async () => {
  const { app } = renderApp({ tools: { participation: false, homework: false, tasks: false, tests: false } });
  await app.renderCrmToday();
  const html = get(app, 'window.__box.innerHTML');
  assert.match(html, /class="crm-hero-go" onclick="openCrmLessonSheet\('S1','2026-10-21',1,'attendance'\)">👥 رصد الحضور ←/);
  assert.doesNotMatch(html, /crm-tiles/);
});

test('رُصدت الأولى: البطاقة على الثانية، والأولى في "المنجزة" — وكل استعلام مقيّد بالمعلم', async () => {
  const { app, log } = renderApp({ lessons: [{ id: 'L1', section_id: 'S1', period: 1 }] });
  await app.renderCrmToday();
  const html = get(app, 'window.__box.innerHTML');
  assert.match(html, /الحصة التالية: 2/);
  assert.match(html, /1\/2 ✓/);
  assert.match(html, /المتبقية \(1\)/);
  assert.match(html, /المنجزة \(1\)/);
  const lessonQs = log.filter(q => q.table === 'classroom_lessons' || q.table === 'classroom_lesson_skips');
  assert.ok(lessonQs.length >= 3);
  lessonQs.forEach(q => assert.ok(q.eqs.some(([k, v]) => k === 'teacher_id' && v === 'u1'), q.table + ' بلا teacher_id'));
});

test('"ليست هي؟" تحفظ التصحيح لهذا المستخدم ولهذا اليوم فقط، و"تلقائي" تلغيه', async () => {
  const { app } = renderApp({});
  await app.renderCrmToday();
  app.pickCrmNowPeriod(2);
  assert.match(get(app, 'window.__box.innerHTML'), /الحصة التالية: 2/);
  assert.equal(get(app, `JSON.parse(localStorage.getItem('crm_now_pick:u1:2026-10-21')).period`), 2);
  runInAppContext(app, `crmNowPickMemo = null; currentUser = { id: 'u2' };`);
  assert.equal(get(app, `currentCrmNowPick('2026-10-21')`), null, 'مستخدم آخر على نفس الجهاز');
  runInAppContext(app, `currentUser = { id: 'u1' };`);
  app.pickCrmNowPeriod(null);
  assert.equal(get(app, `localStorage.getItem('crm_now_pick:u1:2026-10-21')`), null);
  assert.match(get(app, 'window.__box.innerHTML'), /الحصة التالية: 1/);
});

test('openCrmLessonSheet(mode) يفتح الأداة مباشرة — إلا مع مسودة حضور مستعادة', async () => {
  const app = loadApp({ supabaseClient: client({}), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    appFeatures = { sections: {}, tools: {} };
    document.getElementById('classroomView').style.display = 'block';
    crmSections = [{ id: 'S', name: '٦' }]; crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];
    getAttentionFresh = async () => null;
    window.__modes = []; setCrmSheetMode = m => window.__modes.push(m); renderCrmLessonSheet = () => window.__modes.push('attendance-render');`);
  await app.openCrmLessonSheet('S', '2026-10-01', 1, 'participation');
  assert.deepEqual([...get(app, 'window.__modes')], ['participation']);
  runInAppContext(app, `window.__modes = []; writeLessonDraft('S', '2026-10-01', 1, { a: 'absent' });`);
  await app.openCrmLessonSheet('S', '2026-10-01', 1, 'participation');
  assert.deepEqual([...get(app, 'window.__modes')], ['attendance-render'], 'المسودة تُعرض أولًا');
});

test('تحديث الدقيقة لا يرسم بيانات قديمة فوق تحميل أحدث جارٍ', async () => {
  const { app } = renderApp({});
  await app.renderCrmToday();
  runInAppContext(app, `crmTodayRenderToken++; window.__box.innerHTML = 'LOADING';`);
  app.paintCrmToday();
  assert.equal(get(app, 'window.__box.innerHTML'), 'LOADING');
});

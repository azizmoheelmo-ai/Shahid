'use strict';
/* ============================================================
   الغائب في المشاركة والأدوات (بطلب صاحب التطبيق):
   - باهت وعليه "غائب".
   - الضغط على + أو − (أو على الأداة) لا يُحسب — نافذة بخيارين: "حضر" / "تجاوز".
   - حضر: يُحفظ حاضرًا في حضور الحصة (من القاعدة مباشرة، هذا الطالب وحده) وتروح "غائب".
   - تجاوز: يبقى غائبًا، ويعمل له + و− بلا سؤال في هذه الورقة.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

function client(log, opts){
  opts = opts || {};
  return {
    from(table){ const f = []; const a = { select: () => a, eq: (c, v) => { f.push([c, v]); return a; }, in: () => a, order: () => a, limit: () => a, upsert: () => a,
      then: (r, j) => { log.push({ table, filters: f.slice() }); return Promise.resolve({ data: (opts.tables && opts.tables[table]) || [], error: null }).then(r, j); } }; return a; },
    rpc(name, args){ log.push({ rpc: name, args }); return new Promise(res => setTimeout(() => res(opts.fail === name ? { data: null, error: { message: 'offline' } } : { data: name === 'save_lesson_attendance' ? 'L1' : 4, error: null }), opts.delay || 0)); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
}
const get = (app, e) => runInAppContext(app, e);

function sheet(opts){
  opts = opts || {};
  const log = [];
  const app = loadApp({ supabaseClient: client(log, opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__modal = []; showInfoModal = h => window.__modal.push(h); window.__closed = 0; closeCrmModal = () => { window.__closed++; };
    window.__drafts = []; writeLessonDraft = (a, b, c, st) => window.__drafts.push(JSON.stringify(st));
    window.__tiles = {};
    const _g = document.getElementById;
    document.getElementById = id => {
      if(id.indexOf('crmPart_') !== 0) return _g(id);
      if(!window.__tiles[id]){
        const cls = new Set();
        window.__tiles[id] = { cls, classList: { toggle: (c, on) => on ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) },
          querySelector: () => ({ innerHTML: '' }) };
      }
      return window.__tiles[id];
    };
    crmStudents = [{ id: 'a', full_name: 'عاصم <b>خالد</b> باقص', section_id: 'S' }, { id: 'b', full_name: 'خليل', section_id: 'S' }, { id: 'c', full_name: 'حمود', section_id: 'S' }];
    crmSheet = { sectionId: 'S', dateIso: '2026-10-20', period: 2, token: 1, mode: 'participation', lessonId: ${JSON.stringify(opts.lessonId === undefined ? 'L1' : opts.lessonId)},
      dirty: ${!!opts.dirty}, states: ${JSON.stringify(opts.states || { a: 'absent', b: 'present', c: 'absent' })},
      part: { column: { id: 'C', name: 'مشاركة', max_score: 10 }, scores: new Map([['a', 3], ['b', 6]]), today: {}, undo: [], queue: new Map(), toolId: null, full: false, step: 1 } };`);
  return { app, log };
}
const tileCls = (app, id) => [...get(app, `window.__tiles['crmPart_${id}'] ? [...window.__tiles['crmPart_${id}'].cls] : []`)];
const settle = app => get(app, 'Promise.all([...crmSheet.part.queue.values()])');

test('الغائب: + أو − لا يُحسب — نافذة "حضر" / "تجاوز" (الاسم مُهرَّب)، والحاضر يُرصد عاديًا', async () => {
  const { app, log } = sheet();
  app.tapCrmParticipation('a', 1);
  app.tapCrmParticipation('a', -1);
  assert.equal(log.filter(l => l.rpc).length, 0, 'لا نقرة محسوبة');
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 3);
  const m = get(app, 'window.__modal[0]');
  assert.match(m, /عاصم &lt;b&gt;خالد&lt;\/b&gt; باقص/);
  assert.match(m, /مسجّل غائب في هذه الحصة/);
  assert.match(m, /chooseCrmAbsent\('present'\)">حضر<small>تروح كلمة «غائب»/);
  assert.match(m, /chooseCrmAbsent\('skip'\)">تجاوز<small>يبقى غائبًا/);
  assert.equal(get(app, `document.getElementById('confirmCancelBtn').style.display`), 'none', 'خياران فقط بلا "إغلاق"');
  app.tapCrmParticipation('b', 1);
  await settle(app);
  assert.equal(log.filter(l => l.rpc === 'increment_grade_score').length, 1);
});

test('تجاوز: يبقى "غائب" (بلون أوضح) ويُرصد له + و− بلا سؤال، ولا يُمسّ الحضور', async () => {
  const { app, log } = sheet();
  app.tapCrmParticipation('a', 1);
  app.chooseCrmAbsent('skip');
  assert.deepEqual(tileCls(app, 'a').sort(), ['is-absent-ok']);
  assert.equal(get(app, 'crmSheet.states.a'), 'absent');
  assert.equal(get(app, 'window.__modal.length'), 1);
  app.tapCrmParticipation('a', 1);
  await settle(app);
  assert.equal(get(app, 'window.__modal.length'), 1, 'لا سؤال مرة أخرى');
  assert.equal(log.filter(l => l.rpc === 'increment_grade_score').length, 1);
  assert.equal(log.filter(l => l.rpc === 'save_lesson_attendance').length, 0);
  app.tapCrmParticipation('c', 1);
  assert.equal(get(app, 'window.__modal.length'), 2, 'التجاوز لطالب واحد فقط');
});

test('حضر (الحصة محفوظة): يُقرأ حضورها من القاعدة باسم المعلم ويُحفظ بلا هذا الطالب — لا تُحفظ تغييرات غير محفوظة لغيره', async () => {
  const tables = { classroom_attendance: [{ student_id: 'a', status: 'absent' }, { student_id: 'c', status: 'late' }] };
  const { app, log } = sheet({ tables, dirty: true, states: { a: 'absent', b: 'absent', c: 'late' } });
  app.tapCrmParticipation('a', 1);
  await app.chooseCrmAbsent('present');
  const read = log.find(l => l.table === 'classroom_attendance');
  assert.deepEqual(Object.fromEntries(read.filters), { teacher_id: 'u1', lesson_id: 'L1' });
  const save = log.find(l => l.rpc === 'save_lesson_attendance');
  assert.deepEqual(JSON.parse(JSON.stringify(save.args)), { p_section_id: 'S', p_lesson_date: '2026-10-20', p_period: 2, p_exceptions: [{ student_id: 'c', status: 'late' }] },
    '"ب" غائب في مسودة غير محفوظة فلا يُحفظ ضمنًا');
  assert.equal(get(app, 'crmSheet.states.a'), 'present');
  assert.deepEqual(tileCls(app, 'a'), [], 'راحت "غائب"');
  assert.match(get(app, 'window.__toasts.join("|")'), /ok:«عاصم» صار حاضرًا ✓/);
  assert.match(get(app, 'window.__drafts[0]'), /"a":"present"/, 'المسودة القائمة لا تعيده غائبًا');
  assert.equal(log.filter(l => l.rpc === 'increment_grade_score').length, 0, 'النقرة لا تُحسب تلقائيًا');
});

test('حضر (الحضور لم يُحفظ بعد): يتغيّر في الورقة والمسودة فقط، مع تذكير بحفظ الحضور', async () => {
  const { app, log } = sheet({ lessonId: null, dirty: true });
  app.tapCrmParticipation('a', 1);
  await app.chooseCrmAbsent('present');
  assert.equal(log.filter(l => l.rpc || l.table).length, 0);
  assert.equal(get(app, 'crmSheet.states.a'), 'present');
  assert.match(get(app, 'window.__toasts.join("|")'), /احفظ الحضور من تبويب "حضور"/);
});

test('حضر: فشل الحفظ يبقيه غائبًا مع رسالة، ونقرتان = حفظ واحد', async () => {
  const fail = sheet({ fail: 'save_lesson_attendance' });
  fail.app.tapCrmParticipation('a', 1);
  await fail.app.chooseCrmAbsent('present');
  assert.equal(get(fail.app, 'crmSheet.states.a'), 'absent');
  assert.match(get(fail.app, 'window.__toasts.join("|")'), /error:تعذّر تسجيله حاضرًا/);
  const { app, log } = sheet({ delay: 20 });
  runInAppContext(app, `crmSheet.absentAsk = 'a';`);
  await Promise.all([app.markCrmStudentPresent(get(app, 'crmSheet'), 'a'), app.markCrmStudentPresent(get(app, 'crmSheet'), 'a')]);
  assert.equal(log.filter(l => l.rpc === 'save_lesson_attendance').length, 1);
});

test('الأدوات الخاصة (حالة/درجة): الغائب معلَّم والضغط عليه يسأل أولًا', async () => {
  const { app } = sheet();
  runInAppContext(app, `
    crmCustomTools = [{ id: 'T', name: 'إحضار الكتاب', tool_type: 'status', category: 'performance', max_score: 2, hidden: false }];
    window.__set = 0; setCrmToolValue = () => { window.__set++; };
    crmSheet.tool = { tool: crmCustomTools[0], values: new Map(), queue: new Map() };`);
  app.tapCrmTool('a');
  assert.equal(get(app, 'window.__set'), 0);
  assert.equal(get(app, 'window.__modal.length'), 1);
  app.tapCrmTool('b');
  assert.equal(get(app, 'window.__set'), 1);
  assert.equal(get(app, 'crmAbsentClass(crmSheet, "a")'), ' is-absent');
  assert.equal(get(app, 'crmAbsentClass(crmSheet, "b")'), '');
});

test('انحدار: "إغلاق" يعود ظاهرًا في النوافذ الأخرى بعد نافذة حضر/تجاوز', async () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `document.getElementById('confirmCancelBtn').style.display = 'none';`);
  app.showConfirm('سؤال؟');
  assert.equal(get(app, `document.getElementById('confirmCancelBtn').style.display`), '');
});

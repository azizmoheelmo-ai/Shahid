'use strict';
/* ============================================================
   ورقة الحصة ← "اختبار" (app-24-tests-sheet.js)
   - اختبار جديد من الورقة (اسم ودرجة كاملة) بلا سقف، باسم المعلم.
   - خانة لكل طالب تُحفظ فورًا؛ الفارغة = لم يُرصد (حذف)؛ غير الصالحة لا تُحفظ.
   - الفشل يعيد الخانة ويُعلّم الورقة (فلا يقول زر "حفظ": تم).
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };

function fakeClient(seed, log, opts){
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table){
      const f = [];
      let op = 'select', values = null, single = false, onConflict = null;
      const result = () => {
        if(opts.fail && opts.fail(table, op)) return { data: null, error: { message: 'boom' } };
        if(op === 'insert'){
          const rows = Array.isArray(values) ? values : [values];
          log.push({ table, op, rows });
          const out = rows.map((r, i) => Object.assign({ id: 'NEW' + i }, r));
          return { data: single ? out[0] : out, error: null };
        }
        if(op === 'upsert'){ log.push({ table, op, rows: [values], onConflict }); return { data: null, error: null }; }
        if(op === 'delete'){ log.push({ table, op, filters: f.slice() }); return { data: null, error: null }; }
        log.push({ table, op: 'select', filters: f.slice() });
        const rows = match(seed[table], f);
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; },
        eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; },
        insert(r){ op = 'insert'; values = r; return api; }, upsert(r, o){ op = 'upsert'; values = r; onConflict = o && o.onConflict; return api; },
        delete(){ op = 'delete'; return api; },
        single(){ single = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(opts.delay ? opts.delay(table, op) : null).then(() => result()).then(res, rej); },
      };
      return api;
    },
    rpc(){ return Promise.resolve({ data: null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
}

const col = (id, name, max, extra) => Object.assign({ id, teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, category: 'tests', kind: 'manual', tool_id: null, name, max_score: max, position: 0 }, extra || {});

function appWith(seed, log, opts){
  const app = loadApp({ supabaseClient: fakeClient(seed || {}, log || [], opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__modal = []; showInfoModal = h => window.__modal.push(h); closeCrmModal = () => {};
    afterCrmGradesChanged = () => {}; crmSectionLabel = () => 'ثاني/٦';
    crmCurrentTerm = () => (${JSON.stringify(TERM)});
    crmStudents = [{ id: 'a', full_name: 'أحمد <i>x</i>', section_id: 'S' }, { id: 'b', full_name: 'خالد', section_id: 'S' }];
    crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 1, token: 1, mode: 'test', states: { b: 'absent' } };`);
  return app;
}
const get = (app, e) => runInAppContext(app, e);
const body = app => get(app, `document.getElementById('crmLessonSheetBody').innerHTML`);
const writes = (log, op) => log.filter(l => l.table === 'classroom_grade_scores' && l.op === op);
const filters = e => Object.fromEntries(e.filters.map(([c, v]) => [c, v]));

test('sheetTestColumns / defaultSheetTestId — الاختبارات اليدوية فقط، والافتراضي آخر ما أُضيف', async () => {
  const app = loadApp();
  const cols = [col('t1', 'أ', 20, { created_at: '2026-10-01' }), col('t2', 'ب', 10, { created_at: '2026-10-09' }),
    col('tool', 'أداة', 5, { tool_id: 'T' }), col('p', 'مشاركة', 10, { category: 'performance' })];
  assert.deepEqual([...app.sheetTestColumns(cols)].map(c => c.id), ['t1', 't2']);
  assert.equal(app.defaultSheetTestId(app.sheetTestColumns(cols)), 't2');
  assert.equal(app.defaultSheetTestId([]), null);
});

test('تبويب الاختبار — يقرأ باسم المعلم، ويعرض الخانات بالدرجات والغائب، والأسماء مُهرَّبة', async () => {
  const log = [];
  const app = appWith({ classroom_grade_columns: [col('t1', 'الفترة <b>1</b>', 20, { created_at: '2026-10-01' })],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 't1', student_id: 'a', score: 17 }] }, log);
  await app.renderCrmTestMode(get(app, 'crmStudentsOfSection("S")'));
  const sel = log.filter(l => l.op === 'select');
  assert.equal(filters(sel[0]).teacher_id, 'u1');
  assert.equal(filters(sel[0]).category, 'tests');
  assert.equal(filters(sel[1]).teacher_id, 'u1');
  const html = body(app);
  assert.match(html, /data-student="a"[^>]*value="17"/);
  assert.match(html, /رُصد 1 من 2|crmTestCounts/);
  assert.match(html, /الفترة &lt;b&gt;1&lt;\/b&gt; · من 20/);
  assert.match(html, /أحمد &lt;i&gt;x&lt;\/i&gt;/);
  assert.match(html, /خالد <small[^>]*>غائب<\/small>/);
  assert.match(html, /finishCrmLessonSheet\(\)/, 'زر حفظ');
});

test('بلا اختبارات — رسالة و"+ اختبار"', async () => {
  const app = appWith({ classroom_grade_columns: [] }, []);
  await app.renderCrmTestMode([]);
  assert.match(body(app), /لا اختبارات لهذه الشعبة بعد/);
  assert.match(body(app), /openCrmSheetTestModal\(\)/);
});

async function ready(seedScores, opts, log){
  log = log || [];
  const app = appWith({ classroom_grade_columns: [col('t1', 'قصير', 20)], classroom_grade_scores: seedScores || [] }, log, opts);
  await app.renderCrmTestMode(get(app, 'crmStudentsOfSection("S")'));
  /* خانة بأقل ما تحتاجه الدالة (DOM الاختبارات وهمي) */
  const input = id => {
    const set = new Set();
    return { value: '', dataset: { student: id }, isConnected: true,
      classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) } };
  };
  return { app, log, input };
}

test('خانة الطالب — درجة تُحفظ باسم المعلم، والفارغة تحذف (لم يُرصد)، وغير الصالحة لا تُحفظ', async () => {
  const { app, log, input } = await ready([{ teacher_id: 'u1', column_id: 't1', student_id: 'b', score: 9 }]);
  const a = input('a'); a.value = '١٨٫٥';
  await app.saveCrmTestInput(a);
  const up = writes(log, 'upsert')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(up.rows[0])), { teacher_id: 'u1', column_id: 't1', student_id: 'a', score: 18.5 });
  assert.equal(up.onConflict, 'column_id,student_id');
  const b = input('b'); b.value = '';
  await app.saveCrmTestInput(b);
  assert.deepEqual(filters(writes(log, 'delete')[0]), { teacher_id: 'u1', column_id: 't1', student_id: 'b' });
  a.value = '25';
  const r = app.saveCrmTestInput(a);
  assert.equal(r, undefined);
  assert.equal(writes(log, 'upsert').length, 1, 'أكبر من الكاملة لا يُحفظ');
  assert.ok(a.classList.contains('is-invalid'));
  assert.match(get(app, 'window.__toasts.join("|")'), /أكبر من 20/);
});

test('فشل الحفظ يعيد الخانة لما كانت ويُعلّم الورقة بالفشل', async () => {
  const { app, input } = await ready([{ teacher_id: 'u1', column_id: 't1', student_id: 'a', score: 12 }], { fail: (t, op) => t === 'classroom_grade_scores' && op === 'upsert' });
  const a = input('a'); a.value = '15';
  assert.equal(get(app, 'crmSheet.test.values.get("a")'), 12);
  await app.saveCrmTestInput(a);
  assert.equal(a.value, '12');
  assert.equal(get(app, 'crmSheet.test.values.get("a")'), 12);
  assert.equal(get(app, 'crmSheet.failed'), true);
  assert.match(get(app, 'window.__toasts.join("|")'), /لم تُحفظ الدرجة/);
});

test('انحدار: تبدّل الاختبار قبل فشل حفظ قديم — لا يُكتب الرجوع على الاختبار الآخر', async () => {
  const later = ms => new Promise(r => setTimeout(r, ms));
  const { app, input } = await ready([], { fail: (t, op) => t === 'classroom_grade_scores' && op === 'upsert', delay: (t, op) => (op === 'upsert' ? later(20) : null) });
  const a = input('a'); a.value = '15';
  const p = app.saveCrmTestInput(a);
  /* المعلم بدّل الاختبار (إعادة رسم = حالة جديدة) وكتب للطالب نفسه 15 في الاختبار الآخر */
  runInAppContext(app, `crmSheet.test = Object.assign({}, crmSheet.test, { selectedId: 'other', values: new Map([['a', 15]]) });`);
  await p;
  assert.equal(get(app, 'crmSheet.test.values.get("a")'), 15, 'لم يُرجَع لـ"لم يُرصد" في الاختبار الآخر');
});

test('زر "حفظ" ينتظر حفظ خانات الاختبار المعلّقة', async () => {
  const later = ms => new Promise(r => setTimeout(r, ms));
  const { app, log, input } = await ready([], { delay: (t, op) => (op === 'upsert' ? later(25) : null) });
  runInAppContext(app, `window.__closed = 0; closeCrmLessonSheet = () => { window.__closed++; };`);
  const a = input('a'); a.value = '20';
  app.saveCrmTestInput(a);
  await app.finishCrmLessonSheet();
  assert.equal(writes(log, 'upsert').length, 1, 'اكتمل الحفظ قبل الإغلاق');
  assert.equal(get(app, 'window.__closed'), 1);
});

test('+ اختبار من الورقة — باسم المعلم في فئة الاختبارات للشعبة والفصل، ويُرفض الفارغ والأكبر من 40، ولا يتكرر بنقرتين', async () => {
  const log = [];
  const app = appWith({ classroom_grade_columns: [] }, log);
  app.openCrmSheetTestModal();
  const set = (n, m) => runInAppContext(app, `document.getElementById('crmSheetTestName').value = ${JSON.stringify(n)}; document.getElementById('crmSheetTestMax').value = ${JSON.stringify(m)};`);
  set('', '20'); await app.saveCrmSheetTest();
  set('نهائي', '50'); await app.saveCrmSheetTest();
  assert.equal(log.filter(l => l.op === 'insert').length, 0);
  set('الفترة الأولى', '٢٠');
  runInAppContext(app, `{ const _g = document.getElementById; document.getElementById = id => id === 'crmSheetTestAll' ? { checked: false } : _g(id); }`);
  await Promise.all([app.saveCrmSheetTest(), app.saveCrmSheetTest()]);
  const ins = log.filter(l => l.op === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].rows.length, 1, 'الشعبة الحالية فقط');
  const r = ins[0].rows[0];
  assert.deepEqual({ t: r.teacher_id, s: r.section_id, y: r.academic_year, sem: r.semester, c: r.category, k: r.kind, n: r.name, m: r.max_score },
    { t: 'u1', s: 'S', y: TERM.year, sem: 1, c: 'tests', k: 'manual', n: 'الفترة الأولى', m: 20 });
});

test('+ اختبار "لكل شعبي" — يُضاف لكل شعبة لها كشف هذا الفصل فقط (لا لشعبة بلا كشف ولا لمعلم آخر)', async () => {
  const log = [];
  const base = (id, s, extra) => Object.assign({ id, teacher_id: 'u1', section_id: s, academic_year: TERM.year, semester: 1, category: 'performance', kind: 'participation', tool_id: null, name: 'مشاركة', max_score: 10 }, extra || {});
  /* S9: عمود أداة فقط (لا كشف بعد) — لا يُضاف لها */
  const app = appWith({ classroom_grade_columns: [base('p1', 'S'), base('p2', 'S2'), base('px', 'S3', { teacher_id: 'u2' }), base('t9', 'S9', { kind: 'manual', tool_id: 'T' })] }, log);
  runInAppContext(app, `crmSections = [{ id: 'S' }, { id: 'S2' }, { id: 'E' }, { id: 'S9' }];`);
  app.openCrmSheetTestModal();
  runInAppContext(app, `document.getElementById('crmSheetTestName').value = 'قصير'; document.getElementById('crmSheetTestMax').value = '10';
    { const _g = document.getElementById; document.getElementById = id => id === 'crmSheetTestAll' ? { checked: true } : _g(id); }`);
  await app.saveCrmSheetTest();
  const rows = log.filter(l => l.op === 'insert')[0].rows;
  assert.deepEqual([...rows].map(r => r.section_id).sort(), ['S', 'S2']);
  assert.ok([...rows].every(r => r.teacher_id === 'u1'));
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /لـ2 شعب/);
});

'use strict';
/* ============================================================
   أعمال تنتظر التوثيق (app-51) — من العمل إلى الشاهد
   ------------------------------------------------------------
   باتفاق مع المعلم: التطبيق يجمع ما نفّذه (خطة، حصة برنامج، مهمة مرصودة، متابعة
   تحسّنت) ويعبّئ شاهده من بياناته، ويسأله عن الأثر والصورة فقط، والحفظ بموافقته.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const J = x => JSON.parse(JSON.stringify(x)); /* مصفوفات سياق vm لها نموذج أولي مختلف */

/* عميل وهمي: فلاتر eq/in/is/not/gte/lte، ويسجّل كل استعلام وكتابة */
function fakeClient(seed, log, opts){
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([op, c, v]) => {
    if(op === 'eq') return r[c] === v;
    if(op === 'in') return v.includes(r[c]);
    if(op === 'is') return r[c] === v || (v === null && r[c] === undefined);
    if(op === 'not') return !(r[c] === null || r[c] === undefined);
    if(op === 'gte') return String(r[c]) >= String(v);
    if(op === 'lte') return String(r[c]) <= String(v);
    return true;
  }));
  return {
    from(table){
      const f = [];
      let op = 'select', values = null, single = false, maybe = false;
      const result = () => {
        const forced = opts.fail ? opts.fail(table, op, values) : null;
        if(forced) return forced;
        if(op === 'insert'){
          const rows = Array.isArray(values) ? values : [values];
          log.push({ table, op, rows });
          const out = rows.map(r => Object.assign({ ref_number: 'SH-1' }, r));
          return { data: single ? out[0] : out, error: null };
        }
        if(op === 'upsert'){ log.push({ table, op, rows: [values] }); return { data: null, error: null }; }
        const rows = match(seed[table], f);
        if(op === 'update' || op === 'delete'){ log.push({ table, op, filters: f.slice(), values }); return { data: rows, error: null }; }
        log.push({ table, op: 'select', filters: f.slice() });
        if(single || maybe) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      };
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; }, range(){ return api; },
        eq(c, v){ f.push(['eq', c, v]); return api; }, in(c, v){ f.push(['in', c, v]); return api; },
        is(c, v){ f.push(['is', c, v]); return api; }, not(c){ f.push(['not', c]); return api; },
        gte(c, v){ f.push(['gte', c, v]); return api; }, lte(c, v){ f.push(['lte', c, v]); return api; },
        insert(r){ op = 'insert'; values = r; return api; },
        upsert(r){ op = 'upsert'; values = r; return api; },
        update(r){ op = 'update'; values = r; return api; },
        delete(){ op = 'delete'; return api; },
        single(){ single = true; return Promise.resolve(result()); },
        maybeSingle(){ maybe = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(result()).then(res, rej); },
      };
      return api;
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: p => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/shawahid-photos/' + p } }), remove: async () => ({}) }) },
  };
}

const TODAY = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function inboxApp(seed, log, opts){
  const app = loadApp({ supabaseClient: fakeClient(seed, log, opts), currentUser: { id: 'u1', email: 't@x', user_metadata: { full_name: 'معلم' } } });
  runInAppContext(app, `
    window.__toasts = [];
    showToast = (m, k) => window.__toasts.push(k + ':' + m);
    showConfirm = async () => true;
    appSectionOn = () => true;
    appToolOn = () => true;
    followupsOn = () => true;
    calendarRegion = null;
    getElementsOrder = () => [{ key: 'تنوع أساليب التقويم', label: 'تنوع أساليب التقويم (10%)' }, { key: 'الإدارة الصفية', label: 'الإدارة الصفية (5%)' }, { key: 'نشاط', label: 'نشاط (10%)' }];
    getProfileSchool = () => 'مدرسة'; getProfileSubject = () => 'مادة';
    loadPlan = async () => ({ ok: true });
    myPlan = {}; planShahidCounts = {};
  `);
  return app;
}

const SEED = () => ({
  classroom_attention_dismissals: [
    { teacher_id: 'u1', rule_key: 'shahid_inbox', subject_key: 'task:t-hidden' },
    { teacher_id: 'u2', rule_key: 'shahid_inbox', subject_key: 'task:t1' }
  ],
  lesson_plans: [
    { id: 'p1', user_id: 'u1', status: 'planned', planned_date: daysAgo(2), title: 'خطة الكسور', element_key: 'تنوع أساليب التقويم', steps: ['أ'], created_at: daysAgo(9) + 'T08:00:00Z' },
    { id: 'p-future', user_id: 'u1', status: 'planned', planned_date: '2999-01-01', title: 'قادمة', element_key: 'x' },
    { id: 'p-other', user_id: 'u2', status: 'planned', planned_date: daysAgo(1), title: 'لغيري', element_key: 'x' }
  ],
  classroom_tasks: [
    { id: 't1', teacher_id: 'u1', section_id: 'S', title: 'مشروع', max_score: 10, due_date: daysAgo(3), shahid_id: null, created_at: daysAgo(10) + 'T00:00:00Z' },
    { id: 't-unscored', teacher_id: 'u1', section_id: 'S', title: 'بلا رصد', max_score: 10, shahid_id: null, created_at: daysAgo(10) + 'T00:00:00Z' },
    { id: 't-hidden', teacher_id: 'u1', section_id: 'S', title: 'مخفية', max_score: 10, shahid_id: null, created_at: daysAgo(10) + 'T00:00:00Z' },
    { id: 't-done', teacher_id: 'u1', section_id: 'S', title: 'موثّقة', max_score: 10, shahid_id: 'sh', created_at: daysAgo(10) + 'T00:00:00Z' }
  ],
  classroom_task_students: [
    { teacher_id: 'u1', task_id: 't1', student_id: 'a', score: 8, group_no: null },
    { teacher_id: 'u1', task_id: 't1', student_id: 'b', score: null, group_no: null },
    { teacher_id: 'u1', task_id: 't-unscored', student_id: 'a', score: null },
    { teacher_id: 'u1', task_id: 't-hidden', student_id: 'a', score: 5 }
  ],
  classroom_followups: [
    { id: 'f1', teacher_id: 'u1', group_id: 'g1', section_id: 'S', reason_type: 'grades', reason_text: 'ضعف القراءة', status: 'closed', outcome: 'improved', closed_at: daysAgo(5) + 'T00:00:00Z', created_at: daysAgo(30) + 'T00:00:00Z', shahid_id: null, student_id: 'a' },
    { id: 'f2', teacher_id: 'u1', group_id: 'g1', section_id: 'S', reason_type: 'grades', reason_text: 'ضعف القراءة', status: 'closed', outcome: 'improved', closed_at: daysAgo(5) + 'T00:00:00Z', created_at: daysAgo(30) + 'T00:00:00Z', shahid_id: null, student_id: 'b' }
  ],
  classroom_sections: [{ id: 'S', teacher_id: 'u1', name: '2', grade_level_id: 'G' }],
  classroom_grade_levels: [{ id: 'G', teacher_id: 'u1', name: 'الرابع' }],
  activity_programs: [{ id: 'PR', user_id: 'u1', name: 'نادي القراءة', element_key: 'نشاط', total_sessions: 3, student_count: 12,
    sessions: [{ session_no: 1, done: true, week_label: 'الأسبوع 1' }, { session_no: 2, done: false, week_label: 'الأسبوع 2' }, { session_no: 3, done: false, week_label: 'الأسبوع 3' }] }],
  program_sections: [],
  classroom_students: [{ id: 'a', teacher_id: 'u1', full_name: 'سالم' }, { id: 'b', teacher_id: 'u1', full_name: 'فهد' }],
  classroom_followup_actions: []
});

/* ============ دوال صرفة ============ */

test('inboxElementGap: النقص عن مستهدف الخطة فقط', () => {
  const app = loadApp();
  assert.equal(app.inboxElementGap('a', { a: { target_count: 3 } }, { a: 1 }), 2);
  assert.equal(app.inboxElementGap('a', { a: { target_count: 3 } }, { a: 5 }), 0);
  assert.equal(app.inboxElementGap('b', { a: { target_count: 3 } }, {}), 0, 'بلا مستهدف = لا نقص');
});

test('sortInboxItems: ما ينقص الخطة أولًا (الأكبر نقصًا)، ثم الأحدث', () => {
  const app = loadApp();
  const gaps = { A: 0, B: 2, C: 1 };
  const out = app.sortInboxItems([
    { key: 'old', elementKey: 'A', date: '2026-01-01' }, { key: 'new', elementKey: 'A', date: '2026-02-01' },
    { key: 'c', elementKey: 'C', date: '2026-01-05' }, { key: 'b', elementKey: 'B', date: '2025-01-01' }
  ], k => gaps[k]);
  assert.deepEqual(J(out.map(x => x.key)), ['b', 'c', 'new', 'old']);
  assert.equal(out[0].gap, 2);
});

test('inboxDueProgramSessions: ما حلّ أسبوعه فقط، وكل شعبة فتحة مستقلة', async (t) => {
  const app = loadApp();
  const p = { id: 'P', sessions: [
    { session_no: 2, week_label: 'و2', section_status: { s1: { done: true } } },
    { session_no: 1, week_label: 'و1' }, { session_no: 3, week_label: 'و3' }, { session_no: 4 }
  ] };
  const idx = { 'و1': '2026-09-01', 'و2': '2026-09-08', 'و3': '2026-09-15' };
  await t.test('بلا شعب: الحصص التي بدأ أسبوعها وغير الموثّقة، مرتبة', () => {
    const out = app.inboxDueProgramSessions([p], new Map(), idx, '2026-09-10');
    assert.deepEqual(J(out.map(x => x.sessionNo)), [1, 2]);
    assert.equal(out[0].weekStart, '2026-09-01');
  });
  await t.test('بشعب: الحصة الموثّقة لشعبة تبقى ناقصة للأخرى', () => {
    const out = app.inboxDueProgramSessions([p], new Map([['P', ['s1', 's2']]]), idx, '2026-09-10');
    assert.deepEqual(J(out.map(x => x.sessionNo + x.sectionId)), ['1s1', '1s2', '2s2']);
  });
  await t.test('بلا تقويم: أول حصة ناقصة فقط (لا نعرف ما حلّ غيرها)', () => {
    const out = app.inboxDueProgramSessions([p], new Map(), null, '2026-09-10');
    assert.deepEqual(J(out.map(x => x.sessionNo)), [1]);
  });
});

test('buildProgramSessionShahidDraft: من بيانات البرنامج فقط، والتاريخ أول أسبوع منتهٍ', () => {
  const app = loadApp();
  const program = { name: 'نادي القراءة', element_key: 'نشاط', total_sessions: 4, student_count: 12,
    sessions: [{ session_no: 1, done: true }, { session_no: 2 }] };
  const d = app.buildProgramSessionShahidDraft({ program, sessionNo: 2, sectionLabel: 'الرابع — الشعبة 2', weekStart: '2026-09-01', todayIso: '2026-09-20' });
  assert.equal(d.title, 'نادي القراءة — الحصة 2 من 4 — الرابع — الشعبة 2');
  assert.equal(d.date, '2026-09-01');
  assert.match(d.description, /12 طالبًا/);
  assert.match(d.quant, /يكتمل توثيق 2 من 4/);
  assert.equal(d.steps.length, 0, 'لا خطوات مخترعة');
  const cur = app.buildProgramSessionShahidDraft({ program, sessionNo: 2, weekStart: '2026-09-15', todayIso: '2026-09-17' });
  assert.equal(cur.date, '2026-09-17', 'الأسبوع الجاري = اليوم');
});

test('buildInboxShahidRecord: نفس حقول الشاهد + ختم المصدر + ربط البرنامج', () => {
  const app = loadApp();
  const rec = app.buildInboxShahidRecord({
    id: 'ID', userId: 'u1', email: 'e', teacherName: 'م', school: 'س', subject: 'ع',
    draft: { title: 'ع', classLabel: 'ش', date: '2026-10-01', description: 'و', goal: 'ه', steps: ['أ', '', 'ب'], quant: 'ك', reflection: 'ت', sourceNote: 'x'.repeat(300) },
    qual: '  أثر  ', elementKey: 'k', elementLabel: 'k (10%)', photoUrls: ['u'], sourceType: 'program_session',
    program: { programId: 'P', sessionNo: 2, sectionId: 'S' }
  });
  assert.equal(rec.id, 'ID');
  assert.equal(rec.user_id, 'u1');
  assert.deepEqual([...rec.steps], ['أ', 'ب']);
  assert.equal(rec.qual_impact, 'أثر');
  assert.equal(rec.source_type, 'program_session');
  assert.equal(rec.source_note.length, 200, 'يطابق قيد القاعدة (200)');
  assert.equal(rec.program_id, 'P');
  assert.equal(rec.program_session_no, 2);
  assert.equal(rec.program_section_id, 'S');
  assert.equal(rec.lesson_date, '2026-10-01');
  assert.ok(rec.cycle_year && rec.cycle_stage);
});

test('ختم المصدر: نصه، وظهوره مهرّبًا بالبطاقة والـPDF، ولا شيء بلا مصدر', () => {
  const app = loadApp();
  assert.equal(app.shahidSourceStamp({ source_type: 'task', source_note: 'رُصدت درجات 3 من 4' }), 'مهمة أدائية مرصودة في التطبيق — رُصدت درجات 3 من 4');
  assert.equal(app.shahidSourceStamp({ source_type: 'evil' }), '');
  assert.equal(app.shahidSourceStamp({}), '');
  const rec = { id: '1', source_type: 'followup', source_note: '<img src=x onerror=1>', steps: [], photo_urls: [] };
  const card = app.renderRecCard(rec);
  assert.match(card, /rec-source/);
  assert.doesNotMatch(card, /<img src=x/);
  const pdf = app.buildPdfHtml(rec, []);
  assert.match(pdf, /مصدر الشاهد/);
  assert.doesNotMatch(pdf, /<img src=x/);
  assert.doesNotMatch(app.buildPdfHtml({ id: '2', steps: [], photo_urls: [] }, []), /مصدر الشاهد/);
});

test('isMissingSourceColumnError: يميّز غياب عمودي المصدر فقط', () => {
  const app = loadApp();
  assert.equal(app.isMissingSourceColumnError({ code: 'PGRST204', message: "Could not find the 'source_type' column of 'shawahid' in the schema cache" }), true);
  assert.equal(app.isMissingSourceColumnError({ code: 'PGRST204', message: "Could not find the 'goal' column" }), false);
  assert.equal(app.isMissingSourceColumnError({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(app.isMissingSourceColumnError(null), false);
});

test('insertShahidWithSource: قبل تشغيل SQL الأعمدة يُحفظ الشاهد بلا ختم (لا يتعطل الحفظ)', async () => {
  const log = [];
  let calls = 0;
  const app = inboxApp({}, log, { fail: (table, op, values) => {
    if(table !== 'shawahid' || op !== 'insert') return null;
    calls++;
    return values.source_type ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'source_type' column of 'shawahid' in the schema cache" } } : null;
  } });
  const res = await app.insertShahidWithSource({ id: 'x', user_id: 'u1', source_type: 'task', source_note: 'n', element_key: 'k' });
  assert.equal(res.error, null);
  assert.equal(calls, 2);
  const ins = log.filter(l => l.table === 'shawahid' && l.op === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].rows[0].source_type, undefined);
  assert.equal(ins[0].rows[0].element_key, 'k');
});

/* ============ جمع الأعمال ============ */

test('loadInboxItems: المصادر الأربعة، بتصفية المعلم صراحةً، وبلا المخفي والموثّق وغير المرصود', async () => {
  const log = [];
  const app = inboxApp(SEED(), log);
  const res = await runInAppContext(app, 'loadInboxItems()');
  const keys = res.items.map(i => i.key);
  assert.ok(keys.includes('plan:p1'));
  assert.ok(!keys.includes('plan:p-future'), 'خطة لم يحلّ موعدها');
  assert.ok(!keys.includes('plan:p-other'), 'خطة معلم آخر');
  assert.ok(keys.includes('task:t1'));
  assert.ok(!keys.includes('task:t-unscored'), 'مهمة بلا درجة مرصودة');
  assert.ok(!keys.includes('task:t-hidden'), 'أخفاها المعلم');
  assert.ok(!keys.includes('task:t-done'), 'موثّقة مسبقًا');
  assert.ok(keys.includes('followup:g1'), 'المتابعة الجماعية بند واحد');
  assert.equal(keys.filter(k => k.startsWith('followup:')).length, 1);
  assert.ok(keys.includes('program:PR:2:-'), 'بلا تقويم: أول حصة ناقصة');
  assert.equal(res.items.find(i => i.key === 'task:t1').sub, 'رُصدت درجاتها · الرابع — الشعبة 2');
  /* CLAUDE.md §1: كل قراءة من جدول شخصي تحمل تصفية المعلم */
  const owner = { lesson_plans: 'user_id', activity_programs: 'user_id' };
  log.filter(l => l.op === 'select').forEach(l => {
    const col = owner[l.table] || 'teacher_id';
    assert.ok(l.filters.some(([op, c, v]) => op === 'eq' && c === col && v === 'u1'), 'تصفية المعلم: ' + l.table);
  });
});

test('loadInboxItems: الترتيب بنواقص الخطة، وفشل استعلام = null لا «لا شيء»', async () => {
  const app = inboxApp(SEED(), []);
  runInAppContext(app, `myPlan = { 'تحسين نتائج المتعلمين': { target_count: 4 } }; planShahidCounts = { 'تحسين نتائج المتعلمين': 1 };`);
  const res = await runInAppContext(app, 'loadInboxItems()');
  assert.equal(res.items[0].key, 'followup:g1');
  assert.equal(res.items[0].gap, 3);
  const bad = inboxApp(SEED(), [], { fail: (table) => table === 'classroom_tasks' ? { data: null, error: { message: 'x' } } : null });
  assert.equal(await runInAppContext(bad, 'loadInboxItems()'), null);
});

test('loadInboxItems: قسم الشواهد مخفي = لا أعمال ولا استعلامات', async () => {
  const log = [];
  const app = inboxApp(SEED(), log);
  runInAppContext(app, `appSectionOn = k => k !== 'shahid';`);
  const res = await runInAppContext(app, 'loadInboxItems()');
  assert.equal(res.items.length, 0);
  assert.equal(log.length, 0);
});

/* ============ الحفظ ============ */

async function openTaskSheet(app){
  await runInAppContext(app, `(async () => { const r = await loadInboxItems(); inboxItems = r.items; document.getElementById('inboxView').style.display = 'block'; await inboxOpen(inboxItems.findIndex(i => i.key === 'task:t1')); document.getElementById('inboxElement').value = inboxSheet.elementKey; })()`);
}

test('inboxSave: يحفظ بموافقة المعلم، بالأثر المطلوب، ويربط المهمة بالشاهد', async () => {
  const log = [];
  const app = inboxApp(SEED(), log);
  await openTaskSheet(app);
  assert.ok(runInAppContext(app, 'inboxSheet && inboxSheet.draft.title'), 'الورقة مفتوحة');
  /* بلا أثر: لا حفظ */
  await runInAppContext(app, `document.getElementById('inboxQual').value = ''; inboxSave()`);
  assert.equal(log.filter(l => l.table === 'shawahid' && l.op === 'insert').length, 0);
  assert.ok(app.__toasts.some(t => /الأثر/.test(t)));
  await runInAppContext(app, `document.getElementById('inboxQual').value = 'تفاعل الطلاب'; inboxSave()`);
  const ins = log.filter(l => l.table === 'shawahid' && l.op === 'insert');
  assert.equal(ins.length, 1);
  const rec = ins[0].rows[0];
  assert.equal(rec.user_id, 'u1');
  assert.equal(rec.source_type, 'task');
  assert.equal(rec.qual_impact, 'تفاعل الطلاب');
  assert.equal(rec.element_key, 'تنوع أساليب التقويم');
  assert.match(rec.source_note, /رُصدت درجات 1 من 2/);
  const link = log.find(l => l.table === 'classroom_tasks' && l.op === 'update');
  assert.equal(link.values.shahid_id, rec.id);
  assert.ok(link.filters.some(([op, c, v]) => op === 'eq' && c === 'teacher_id' && v === 'u1'));
});

test('inboxSave: نقرتان متتاليتان = إدراج واحد، و23505 (حُفظ من تبويب آخر) يكمل الربط بلا تكرار', async () => {
  const log = [];
  const app = inboxApp(SEED(), log);
  await openTaskSheet(app);
  await runInAppContext(app, `document.getElementById('inboxQual').value = 'أثر'; Promise.all([inboxSave(), inboxSave()])`);
  assert.equal(log.filter(l => l.table === 'shawahid' && l.op === 'insert').length, 1, 'الحارس inboxBusy');

  const log2 = [];
  const seed = SEED();
  seed.shawahid = [];
  const app2 = inboxApp(seed, log2, { fail: (table, op, values) => {
    if(table === 'shawahid' && op === 'insert'){ seed.shawahid.push(Object.assign({}, values)); return { data: null, error: { code: '23505', message: 'duplicate key' } }; }
    return null;
  } });
  await openTaskSheet(app2);
  await runInAppContext(app2, `document.getElementById('inboxQual').value = 'أثر'; inboxSave()`);
  const read = log2.find(l => l.table === 'shawahid' && l.op === 'select');
  assert.ok(read && read.filters.some(([op, c, v]) => op === 'eq' && c === 'user_id' && v === 'u1'), 'قراءة الموجود بتصفية المعلم');
  assert.ok(log2.some(l => l.table === 'classroom_tasks' && l.op === 'update'), 'الربط اكتمل على الشاهد الموجود');
});

test('إخفاء عمل: يُحفظ بجدول التجاهل باسم المعلم وبمفتاح البند', async () => {
  const log = [];
  const app = inboxApp(SEED(), log);
  await openTaskSheet(app);
  await runInAppContext(app, 'inboxDismiss()');
  const up = log.find(l => l.table === 'classroom_attention_dismissals' && l.op === 'upsert');
  assert.deepEqual({ t: up.rows[0].teacher_id, r: up.rows[0].rule_key, s: up.rows[0].subject_key }, { t: 'u1', r: 'shahid_inbox', s: 'task:t1' });
});

/* ============ الشاشة والتكامل ============ */

test('الشاشة: hideAllMainViews وإظهار حاويتها صراحةً، ومسجّلة بالعنوان والإخفاء', () => {
  const src = read('app/app-51-shahid-inbox.js');
  const show = src.slice(src.indexOf('async function showInbox'), src.indexOf('function inboxRowHtml'));
  assert.match(show, /hideAllMainViews\(\)/);
  assert.match(show, /getElementById\('inboxView'\)\.style\.display = 'block'/);
  assert.match(read('app/app-04-academic-crm.js'), /getElementById\('inboxView'\)\.style\.display = 'none'/);
  assert.match(read('app/app-03-auth-home-risk.js'), /TOP_TITLE_VIEWS = \[[^\]]*'inboxView'/);
  assert.match(read('app/app-03-auth-home-risk.js'), /inboxResetState\(\)/, 'تصفير عند دخول حساب');
  assert.match(read('index.html'), /id="inboxView"/);
});

test('saveShahid: الشاهد المفتوح من عمل (المسارات الأربعة) يحمل نوع مصدره', () => {
  const src = read('app/app-09-shahid-form.js');
  assert.match(src, /programSessionContext \? 'program_session' : planShahidContext \? 'lesson_plan'\s*: taskShahidContext \? 'task' : followupShahidContext \? 'followup'/);
  assert.match(src, /insertShahidWithSource\(record\)/);
});

test('SQL: عمودا المصدر بقيدهما في ملف التحديثات ومرآة buildSchemaSql', () => {
  const sql = read('sql-updates-run-in-supabase.sql');
  const blk = sql.slice(sql.indexOf('-- ============ ختم مصدر الشاهد'), sql.indexOf('-- ============ استبانة رضا المستفيدين'));
  assert.match(blk, /add column if not exists source_type text/);
  assert.match(blk, /source_type in \('lesson_plan', 'program_session', 'task', 'followup'\)/);
  assert.match(blk, /char_length\(source_note\) <= 200/);
  const app = loadApp();
  assert.ok(app.buildSchemaSql().includes(blk.trim()), 'المرآة حرفية');
  /* القيد يطابق ما يكتبه التطبيق */
  const types = Object.keys(runInAppContext(app, 'SHAHID_SOURCE_LABELS'));
  types.forEach(t => assert.match(blk, new RegExp(`'${t}'`)));
});

test('سباق: عمل وُثّق من جهاز آخر أثناء فتح الورقة = لا شاهد مكرر (قراءة أحدث حالة قبل الحفظ)', async () => {
  const log = [];
  const seed = SEED();
  const app = inboxApp(seed, log);
  await openTaskSheet(app);
  seed.classroom_tasks.find(t => t.id === 't1').shahid_id = 'from-other-device';
  await runInAppContext(app, `document.getElementById('inboxQual').value = 'أثر'; inboxSave()`);
  assert.equal(log.filter(l => l.table === 'shawahid' && l.op === 'insert').length, 0);
  assert.ok(app.__toasts.some(t => /وُثّق من قبل/.test(t)));
});

test('سباق: تحميل بطاقة الدخول المتأخر لا يبدّل بنود القائمة المرسومة', async () => {
  const app = inboxApp(SEED(), []);
  await runInAppContext(app, `(async () => { inboxItems = [{ key: 'drawn' }]; await refreshInboxEntries(); })()`);
  assert.equal(runInAppContext(app, 'inboxItems.length === 1 && inboxItems[0].key'), 'drawn');
  assert.equal(runInAppContext(app, `document.getElementById('homeInboxCard').style.display`), 'block', 'البطاقة نفسها تُرسم');
});

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
    if(op === 'lt') return String(r[c]) < String(v);
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
        gte(c, v){ f.push(['gte', c, v]); return api; }, lte(c, v){ f.push(['lte', c, v]); return api; }, lt(c, v){ f.push(['lt', c, v]); return api; },
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
  const p = { id: 'P', created_at: '2026-08-20T00:00:00Z', sessions: [
    { session_no: 2, week_label: 'و2', section_status: { s1: { done: true } } },
    { session_no: 1, week_label: 'و1' }, { session_no: 3, week_label: 'و3' }, { session_no: 4 }
  ] };
  const occ = { 'و1': ['2026-09-01'], 'و2': ['2026-09-08'], 'و3': ['2026-09-15'] };
  await t.test('بلا شعب: الحصص التي بدأ أسبوعها وغير الموثّقة، مرتبة', () => {
    const out = app.inboxDueProgramSessions([p], new Map(), occ, '2026-09-10');
    assert.deepEqual(J(out.map(x => x.sessionNo)), [1, 2]);
    assert.equal(out[0].weekStart, '2026-09-01');
  });
  await t.test('بشعب: الحصة الموثّقة لشعبة تبقى ناقصة للأخرى', () => {
    const out = app.inboxDueProgramSessions([p], new Map([['P', ['s1', 's2']]]), occ, '2026-09-10');
    assert.deepEqual(J(out.map(x => x.sessionNo + x.sectionId)), ['1s1', '1s2', '2s2']);
  });
  await t.test('بلا تقويم: أول حصة ناقصة فقط (لا نعرف ما حلّ غيرها)', () => {
    const out = app.inboxDueProgramSessions([p], new Map(), null, '2026-09-10');
    assert.deepEqual(J(out.map(x => x.sessionNo)), [1]);
  });
});

/* المراجع المستقل (2): اسم الأسبوع يتكرر بالفصلين؛ أول ظهوره وحده جعل حصص برنامج الفصل الثاني «حلّت»
   فورًا بتاريخ قبل إنشاء البرنامج، ونسب للمعلم «نفّذتُ» حصصًا لم تأتِ بعد */
test('inboxWeekOccurrences + inboxDueProgramSessions: الاسم المكرر بالفصلين يُحسب من ظهوره بعد إنشاء البرنامج', () => {
  const app = loadApp();
  const weeks = [
    { week_label: 'الأسبوع الأول', gregorian_date: '2026-08-23' }, { week_label: 'الأسبوع الأول', gregorian_date: '2026-08-24' },
    { week_label: 'الأسبوع الثاني', gregorian_date: '2026-08-30' }, { week_label: 'الأسبوع الثالث', gregorian_date: '2026-09-06' },
    { week_label: 'الأسبوع الأول', gregorian_date: '2027-01-10' }, { week_label: 'الأسبوع الثاني', gregorian_date: '2027-01-17' },
    { week_label: 'الأسبوع الثالث', gregorian_date: '2027-01-24' }
  ];
  const occ = app.inboxWeekOccurrences(weeks);
  assert.deepEqual(J(occ['الأسبوع الأول']), ['2026-08-23', '2027-01-10'], 'الصفوف المتتالية ظهور واحد');
  const p = { id: 'P', created_at: '2027-01-05T08:00:00Z', cycle_year: '2026/2027', sessions: [
    { session_no: 1, week_label: 'الأسبوع الأول' }, { session_no: 2, week_label: 'الأسبوع الثاني' }, { session_no: 3, week_label: 'الأسبوع الثالث' }] };
  const out = app.inboxDueProgramSessions([p], new Map(), occ, '2027-01-11', '2026/2027');
  assert.deepEqual(J(out.map(x => [x.sessionNo, x.weekStart])), [[1, '2027-01-10']]);
});

test('inboxDueProgramSessions: برامج الدورات السابقة لا تُقترح، والاسم غير المطابق للتقويم = أول حصة ناقصة فقط', () => {
  const app = loadApp();
  const occ = { 'و1': ['2026-09-01'] };
  const old = { id: 'O', cycle_year: '2025/2026', created_at: '2025-09-01', sessions: [{ session_no: 1, week_label: 'و1' }] };
  const odd = { id: 'X', cycle_year: '2026/2027', created_at: '2026-08-20', sessions: [{ session_no: 1, week_label: 'الاسبوع الاول' }, { session_no: 2, week_label: 'غيره' }] };
  const out = app.inboxDueProgramSessions([old, odd], new Map(), occ, '2026-10-01', '2026/2027');
  assert.deepEqual(J(out.map(x => x.programId + x.sessionNo)), ['X1']);
});

test('buildProgramSessionShahidDraft: من بيانات البرنامج فقط، والتاريخ أول أسبوع منتهٍ', () => {
  const app = loadApp();
  const program = { name: 'نادي القراءة', element_key: 'نشاط', total_sessions: 4, student_count: 12,
    sessions: [{ session_no: 1, done: true }, { session_no: 2 }] };
  const d = app.buildProgramSessionShahidDraft({ program, sessionNo: 2, sectionLabel: 'الرابع — الشعبة 2', weekStart: '2026-09-01', todayIso: '2026-09-20' });
  assert.equal(d.title, 'نادي القراءة — الحصة 2 من 4 — الرابع — الشعبة 2');
  assert.equal(d.date, '2026-09-01');
  assert.doesNotMatch(d.description, /12 طالبًا/, 'عدد طلاب البرنامج كله لا يُنسب لشعبة واحدة');
  assert.match(app.buildProgramSessionShahidDraft({ program, sessionNo: 2, weekStart: '2026-09-01', todayIso: '2026-09-20' }).description, /12 طالبًا/);
  assert.equal(app.buildProgramSessionShahidDraft({ program, sessionNo: 2, weekStart: '2026-09-01', createdIso: '2026-09-03', todayIso: '2026-09-20' }).date, '2026-09-03', 'لا تاريخ قبل إنشاء البرنامج');
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
  assert.match(pdf, /الدليل من بيانات التطبيق/, 'بلا صور: المصدر في قسم الدليل (ق31)');
  assert.doesNotMatch(pdf, /مصدر الشاهد/, 'لا تكرار في صف البيانات');
  assert.doesNotMatch(pdf, /<img src=x/);
  const withPhoto = app.buildPdfHtml(Object.assign({}, rec, { photo_urls: ['https://x.supabase.co/storage/v1/object/public/shawahid-photos/u/a.jpg'] }), ['data:image/jpeg;base64,AA']);
  assert.match(withPhoto, /مصدر الشاهد/);
  assert.doesNotMatch(withPhoto, /الدليل من بيانات التطبيق/);
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
  const owner = { lesson_plans: 'user_id', activity_programs: 'user_id', shawahid: 'user_id' };
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
  assert.match(blk, /source_type in \('lesson_plan', 'program_session', 'task', 'followup', 'survey', 'lessons_month', 'test_analysis', 'rubric_test'\)/);
  assert.match(blk, /create unique index if not exists shawahid_source_ref_key on public\.shawahid\(user_id, source_ref\) where source_ref is not null/);
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

/* ============ المرحلة الثانية: مصادر بمرجع (استبانة، شهر رصد، تحليل اختبار، سلّم تقدير) ============ */

test('inboxLessonMonths: الأشهر المنتهية فقط وبحدّ أدنى من الحصص', () => {
  const app = loadApp();
  const ls = [];
  for(let i = 1; i <= 12; i++) ls.push({ section_id: 'S', lesson_date: '2026-09-' + String(i).padStart(2, '0') });
  for(let i = 1; i <= 4; i++) ls.push({ section_id: 'S', lesson_date: '2026-10-0' + i });
  for(let i = 1; i <= 15; i++) ls.push({ section_id: 'S', lesson_date: '2026-11-' + String(i).padStart(2, '0') });
  const out = app.inboxLessonMonths(ls, '2026-11-16', 10);
  assert.deepEqual(J(out.map(m => m.month)), ['2026-09'], 'أكتوبر أقل من الحد، ونوفمبر لم ينتهِ');
});

test('buildLessonsMonthShahidDraft: أرقام الرصد فقط، بلا إجراء غير مسجّل', () => {
  const app = loadApp();
  const d = app.buildLessonsMonthShahidDraft({ month: '2026-09', lessons: [
    { section_id: 'A', lesson_date: '2026-09-01' }, { section_id: 'A', lesson_date: '2026-09-02' }, { section_id: 'B', lesson_date: '2026-09-02' }
  ], sectionLabel: id => 'ش' + id });
  assert.match(d.title, /سبتمبر 2026/);
  assert.match(d.description, /3 حصة.*في 2 يومًا.*2 شعب/);
  assert.match(d.quant, /شA: 2 حصة/);
  assert.equal(d.date, '2026-09-02');
  assert.equal(d.steps.length, 0);
});

test('buildTestAnalysisShahidDraft: التصنيف بحدود المعلم، والفارغ لا يُحسب صفرًا', () => {
  const app = loadApp();
  const d = app.buildTestAnalysisShahidDraft({ column: { name: 'اختبار 1', max_score: 10, measures: 'القراءة' },
    scores: [2, 5, 6, 9, 10, null], rules: { pass: 60, top: 90 }, sectionLabel: 'ش', date: '2026-10-01' });
  assert.match(d.description, /لـ5 طلاب/);
  assert.match(d.description, /يقيس: القراءة/);
  assert.match(d.quant, /ضعاف: 2 · متوسطون: 1 · متفوقون: 2/);
  assert.match(d.quant, /المتوسط 6.4 من 10 \(64%\)/);
  assert.equal(d.reflection, '', 'لا تفسير ولا توصية مخترعة');
});

test('buildRubricTestShahidDraft: الإتقان لكل معيار (كامل أو كبير) وأضعف معيار', () => {
  const app = loadApp();
  const d = app.buildRubricTestShahidDraft({ column: { name: 'قراءة' }, criteria: [{ id: 'k1', name: 'الطلاقة', points: 2, position: 1 }, { id: 'k2', name: 'الدقة', points: 1, position: 0 }],
    marks: [{ criterion_id: 'k1', student_id: 'a', level: 0 }, { criterion_id: 'k1', student_id: 'b', level: 1 }, { criterion_id: 'k2', student_id: 'a', level: 3 }, { criterion_id: 'k2', student_id: 'b', level: 0 }] });
  assert.deepEqual(J(d.steps), ['الدقة (1 درجة)', 'الطلاقة (2 درجات)']);
  assert.match(d.quant, /الطلاقة: أتقنه 2 من 2/);
  assert.match(d.reflection, /«الدقة» \(أتقنه 1 من 2\)/);
});

test('buildSurveyShahidDraft: من التحليل نفسه (svAnalyze)، والعنصر بحسب الجهة', () => {
  const app = loadApp();
  const questions = [{ id: 'q1', type: 'rating', label: 'التواصل' }, { id: 'q2', type: 'rating', label: 'الواجبات' }];
  const an = { ok: true, valid: 6, invalid: 0, items: [
    { id: 'q1', type: 'rating', label: 'التواصل', n: 6, avg: 4.5 }, { id: 'q2', type: 'rating', label: 'الواجبات', n: 6, avg: 3.2 }] };
  const d = app.buildSurveyShahidDraft({ campaign: { title: 'رضا الفصل الأول', audience: 'guardian', questions }, analysis: an, sent: 20, sections: 2, date: '2026-10-05' });
  assert.equal(d.elementKey, 'التفاعل مع أولياء الأمور');
  assert.match(d.quant, /6 ردًا من 20 رابطًا أُرسل \(30%\)/);
  assert.match(d.quant, /التواصل: 4.5 من 5/);
  assert.match(d.reflection, /«الواجبات» \(3.2 من 5\)/);
  assert.match(d.description, /لا تُربط بأسماء/);
});

function seedPhase2(){
  const s = SEED();
  s.shawahid = [{ user_id: 'u1', source_ref: 'survey:old' }, { user_id: 'u2', source_ref: 'survey:c1' }];
  const Q = [{ id: 'q1', type: 'rating', label: 'التواصل', required: true }];
  s.survey_campaigns = [
    { id: 'c1', teacher_id: 'u1', title: 'رضا', audience: 'guardian', questions: Q, min_results: 3, created_at: '2026-10-01T00:00:00Z' },
    { id: 'old', teacher_id: 'u1', title: 'موثّقة', audience: 'guardian', questions: Q, min_results: 1, created_at: '2026-09-01T00:00:00Z' },
    { id: 'few', teacher_id: 'u1', title: 'قليلة', audience: 'guardian', questions: Q, min_results: 5, created_at: '2026-09-01T00:00:00Z' },
    { id: 'bad', teacher_id: 'u1', title: 'ردود غير صالحة', audience: 'guardian', questions: Q, min_results: 3, created_at: '2026-09-01T00:00:00Z' }
  ];
  s.survey_responses = [1, 2, 3].map(i => ({ id: 'r' + i, teacher_id: 'u1', campaign_id: 'c1', answers: { q1: 4 } }))
    .concat([{ id: 'r9', teacher_id: 'u1', campaign_id: 'old', answers: { q1: 5 } }, { id: 'r8', teacher_id: 'u1', campaign_id: 'few', answers: { q1: 5 } }])
    .concat([1, 2, 3].map(i => ({ id: 'b' + i, teacher_id: 'u1', campaign_id: 'bad', answers: { q1: 9 } })));
  s.classroom_lessons = [];
  const last = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d; })();
  const ym = last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0');
  for(let i = 1; i <= 10; i++) s.classroom_lessons.push({ id: 'l' + i, teacher_id: 'u1', section_id: 'S', lesson_date: ym + '-' + String(i).padStart(2, '0') });
  s.classroom_grade_columns = [
    { id: 'T1', teacher_id: 'u1', section_id: 'S', academic_year: '1448-1449', semester: 1, category: 'tests', name: 'اختبار', max_score: 10, tool_id: null, created_at: '2026-10-01T00:00:00Z' },
    { id: 'T2', teacher_id: 'u1', section_id: 'S', academic_year: '1448-1449', semester: 1, category: 'tests', name: 'قليل', max_score: 10, tool_id: null }
  ];
  s.classroom_grade_scores = [1, 2, 3, 4, 5].map(i => ({ id: 'g' + i, teacher_id: 'u1', column_id: 'T1', student_id: 's' + i, score: i * 2 }))
    .concat([{ id: 'g9', teacher_id: 'u1', column_id: 'T2', student_id: 's1', score: 5 }]);
  s.classroom_rubric_criteria = [{ id: 'k1', teacher_id: 'u1', column_id: 'T1', name: 'الدقة', points: 10 }];
  return { s, ym };
}

function phase2App(seed, log, opts){
  const app = inboxApp(seed, log, opts);
  runInAppContext(app, `crmAttentionTerm = () => ({ year: '1448-1449', semester: 1 }); gradeColumnVisible = () => true;
    const els = getElementsOrder(); getElementsOrder = () => els.concat([{ key: 'تحليل نتائج المتعلمين وتشخيص مستوياتهم', label: 'تحليل النتائج (10%)' }]);`);
  return app;
}

test('المرحلة الثانية: الاستبانة المكتملة، الشهر المنتهي، الاختبار وسلّمه — والموثّق بمرجعه يُستبعد', async () => {
  const log = [];
  const { s, ym } = seedPhase2();
  const app = phase2App(s, log);
  const res = await runInAppContext(app, 'loadInboxItems()');
  const keys = J(res.items.map(i => i.key));
  assert.ok(keys.includes('survey:c1'), 'وصلت ردودها للحد');
  assert.ok(!keys.includes('survey:old'), 'موثّقة بمرجعها');
  assert.ok(!keys.includes('survey:few'), 'لم تبلغ الحد');
  assert.ok(!keys.includes('survey:bad'), 'المراجع المستقل (3): ثلاثة ردود غير صالحة لا تُحسب — وإلا ظهرت استبانة لا تُفتح ورقتها');
  assert.ok(keys.includes('lessons_month:' + ym));
  assert.ok(keys.includes('test_analysis:T1'));
  assert.ok(keys.includes('rubric_test:T1'));
  assert.ok(!keys.includes('test_analysis:T2'), 'أقل من 5 طلاب');
  const owner = { lesson_plans: 'user_id', activity_programs: 'user_id', shawahid: 'user_id' };
  log.filter(l => l.op === 'select').forEach(l => {
    const col = owner[l.table] || 'teacher_id';
    assert.ok(l.filters.some(([op, c, v]) => op === 'eq' && c === col && v === 'u1'), 'تصفية المعلم: ' + l.table);
  });
});

test('المرحلة الثانية: قبل إضافة عمود المرجع لا تُقترح مصادرها (لا تكرار) وتبقى المصادر الأربعة', async () => {
  const { s } = seedPhase2();
  const app = phase2App(s, [], { fail: (table, op) => table === 'shawahid' && op === 'select' ? { data: null, error: { code: '42703', message: 'column shawahid.source_ref does not exist' } } : null });
  const res = await runInAppContext(app, 'loadInboxItems()');
  const keys = J(res.items.map(i => i.key));
  assert.ok(!keys.some(k => /^(survey|lessons_month|test_analysis|rubric_test):/.test(k)));
  assert.ok(keys.includes('task:t1'));
});

test('حفظ مصدر بمرجع: source_ref = مفتاح البند، والموثّق من جهاز آخر لا يُكرَّر', async () => {
  const log = [];
  const { s } = seedPhase2();
  const app = phase2App(s, log);
  await runInAppContext(app, `(async () => { const r = await loadInboxItems(); inboxItems = r.items; document.getElementById('inboxView').style.display = 'block';
    await inboxOpen(inboxItems.findIndex(i => i.key === 'test_analysis:T1')); document.getElementById('inboxElement').value = inboxSheet.elementKey; })()`);
  assert.ok(runInAppContext(app, 'inboxSheet && inboxSheet.draft.title'), 'الورقة مفتوحة');
  await runInAppContext(app, `document.getElementById('inboxQual').value = 'أثر'; inboxSave()`);
  const ins = log.filter(l => l.table === 'shawahid' && l.op === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].rows[0].source_ref, 'test_analysis:T1');
  assert.equal(ins[0].rows[0].source_type, 'test_analysis');

  const log2 = [];
  const p2 = seedPhase2();
  const app2 = phase2App(p2.s, log2);
  await runInAppContext(app2, `(async () => { const r = await loadInboxItems(); inboxItems = r.items; document.getElementById('inboxView').style.display = 'block';
    await inboxOpen(inboxItems.findIndex(i => i.key === 'test_analysis:T1')); document.getElementById('inboxElement').value = inboxSheet.elementKey; })()`);
  p2.s.shawahid.push({ id: 'other', user_id: 'u1', source_ref: 'test_analysis:T1' });
  await runInAppContext(app2, `document.getElementById('inboxQual').value = 'أثر'; inboxSave()`);
  assert.equal(log2.filter(l => l.table === 'shawahid' && l.op === 'insert').length, 0);
});

test('«تعديل كامل» لمصدر بمرجع: saveShahid يحمل المرجع ويُصفَّر مع شاهد جديد', () => {
  const src = read('app/app-09-shahid-form.js');
  assert.match(src, /record\.source_ref = inboxRefContext\.sourceRef/);
  const start = src.slice(src.indexOf('function startNewShahid'), src.indexOf('function addShahidForElement'));
  assert.match(start, /inboxRefContext = null/);
});


/* ============ إصلاحات المراجعة المستقلة ============ */

test('مراجعة (2): نص النموذج الجاهز لا يُعبَّأ في ورقة الخطة، والأثر يبدأ فارغًا لكل مصدر', async () => {
  const seed = SEED();
  seed.lesson_plans[0].template_name = 'تصحيح الأعمال ورصد الدرجات في وقتها';
  seed.lesson_plans[0].element_key = 'أداء الواجبات الوظيفية';
  const app = inboxApp(seed, []);
  runInAppContext(app, `SHAHID_TEMPLATES['أداء الواجبات الوظيفية'] = [{ name: 'تصحيح الأعمال ورصد الدرجات في وقتها', quant: 'رصد 35 طالبًا', qual: 'لا استفسارات', reflection: 'مثال' }];`);
  const sheet = await runInAppContext(app, `(async () => { const r = await loadInboxItems(); return inboxPrepareSheet(r.items.find(i => i.key === 'plan:p1')); })()`);
  assert.equal(sheet.draft.quant, '');
  assert.equal(sheet.draft.qual, '');
  assert.equal(sheet.draft.reflection, '');
  assert.equal(sheet.qual, '');
  const fsheet = await runInAppContext(app, `(async () => { const r = await loadInboxItems(); return inboxPrepareSheet(r.items.find(i => i.key === 'followup:g1')); })()`);
  assert.equal(fsheet.qual, '', 'لا «النتيجة بحكم المعلم» تغني عن كتابة الأثر');
});

test('مراجعة (9): متابعة فردية لطالب غير نشط لا تُقترح، كبطاقة الانتباه', async () => {
  const seed = SEED();
  seed.classroom_followups.push({ id: 'f9', teacher_id: 'u1', group_id: null, section_id: 'S', reason_type: 'absence', reason_text: 'غياب', status: 'closed', outcome: 'improved', closed_at: daysAgo(3) + 'T00:00:00Z', shahid_id: null, student_id: 'gone' });
  seed.classroom_followups.push({ id: 'f8', teacher_id: 'u1', group_id: null, section_id: 'S', reason_type: 'absence', reason_text: 'غياب', status: 'closed', outcome: 'improved', closed_at: daysAgo(3) + 'T00:00:00Z', shahid_id: null, student_id: 'a' });
  seed.classroom_students.push({ id: 'gone', teacher_id: 'u1', full_name: 'منقول', is_active: false });
  const app = inboxApp(seed, []);
  const keys = J((await runInAppContext(app, 'loadInboxItems()')).items.map(i => i.key));
  assert.ok(!keys.includes('followup:f9'));
  assert.ok(keys.includes('followup:f8'));
});

test('مراجعة (3): عمل لا تُفتح ورقته يُعرض إخفاؤه (لا يبقى عالقًا)', async () => {
  const log = [];
  const seed = SEED();
  const app = inboxApp(seed, log);
  await runInAppContext(app, `(async () => { const r = await loadInboxItems(); inboxItems = r.items; document.getElementById('inboxView').style.display = 'block'; })()`);
  seed.classroom_tasks = seed.classroom_tasks.filter(t => t.id !== 't1'); /* حُذفت المهمة بعد عرض القائمة */
  await runInAppContext(app, `inboxOpen(inboxItems.findIndex(i => i.key === 'task:t1'))`);
  const up = log.find(l => l.table === 'classroom_attention_dismissals' && l.op === 'upsert');
  assert.ok(up && up.rows[0].subject_key === 'task:t1' && up.rows[0].teacher_id === 'u1');
  assert.equal(runInAppContext(app, 'inboxSheet'), null);
});

test('مراجعة (5): خطأ شبكة بعد حفظ فعلي = لا حذف للصور المرفوعة، ويُكمل الربط', async () => {
  const log = [];
  const seed = SEED();
  seed.shawahid = [];
  const removed = [];
  const app = inboxApp(seed, log, { fail: (table, op, values) => {
    if(table === 'shawahid' && op === 'insert'){ seed.shawahid.push(Object.assign({}, values)); return { data: null, error: { message: 'Failed to fetch' } }; }
    return null;
  } });
  runInAppContext(app, `compressImage = async f => f;`);
  const sb = runInAppContext(app, 'sb');
  sb.storage.from = () => ({ upload: async () => ({ error: null }), getPublicUrl: p => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/shawahid-photos/' + p } }), remove: async (paths) => { removed.push(...paths); return {}; } });
  await openTaskSheet(app);
  await runInAppContext(app, `inboxSheet.files.push({ name: 'a.jpg', type: 'image/jpeg', size: 10 }); document.getElementById('inboxQual').value = 'أثر'; inboxSave()`);
  assert.equal(removed.length, 0, 'الصور لشاهد محفوظ فعلًا');
  assert.ok(log.some(l => l.table === 'classroom_tasks' && l.op === 'update'), 'الربط اكتمل');
});

test('مراجعة (6): لا إرفاق ولا تبديل ولا رجوع أثناء الحفظ', () => {
  const app = inboxApp(SEED(), []);
  runInAppContext(app, `inboxSheet = { item: { type: 'followup', key: 'k' }, files: [], draft: { title: 't', steps: [] }, showNames: false, members: [], actions: [] }; inboxBusy = true;`);
  runInAppContext(app, `inboxAddFiles({ files: [{ name: 'x.jpg', type: 'image/jpeg', size: 1 }], value: 'x' }); inboxSetNames(true); inboxBackToList();`);
  assert.equal(runInAppContext(app, 'inboxSheet.files.length'), 0);
  assert.equal(runInAppContext(app, 'inboxSheet.showNames'), false);
  assert.ok(runInAppContext(app, 'inboxSheet !== null'));
});

test('مراجعة (7): «تعديل كامل» للمتابعة يحمل اختيار الأسماء، والمرجع يُحفظ مع مسودة النموذج ويُستعاد', () => {
  assert.match(read('app/app-51-shahid-inbox.js'), /openShahidDraftFromFollowups\(it\.ref\.followupIds, it\.ref\.groupId, s\.showNames === true\)/);
  assert.match(read('app/app-16-attention-followups.js'), /const showNames = forceShowNames === true \|\|/);
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `inboxRefContext = { sourceType: 'survey', sourceRef: 'survey:c1', sourceNote: 'n' };`);
  const d = runInAppContext(app, 'collectFormDraft()');
  assert.equal(d.inbox_ref.sourceRef, 'survey:c1');
  runInAppContext(app, `inboxRefContext = null; applyDraft(${JSON.stringify({ steps: [], inbox_ref: { sourceType: 'survey', sourceRef: 'survey:c1' } })});`);
  assert.equal(runInAppContext(app, 'inboxRefContext && inboxRefContext.sourceRef'), 'survey:c1');
  runInAppContext(app, `inboxRefContext = null; applyDraft(${JSON.stringify({ steps: [], inbox_ref: { sourceType: 'evil', sourceRef: 'x' } })});`);
  assert.equal(runInAppContext(app, 'inboxRefContext'), null, 'نوع غير معروف لا يُقبل من التخزين المحلي');
});

test('مراجعة (أ4): تبديل الحساب يفرّغ بطاقات المستخدم السابق فورًا', () => {
  const app = inboxApp(SEED(), []);
  runInAppContext(app, `document.getElementById('homeInboxCard').innerHTML = 'عمل سابق'; document.getElementById('homeInboxCard').style.display = 'block'; inboxResetState();`);
  assert.equal(runInAppContext(app, `document.getElementById('homeInboxCard').innerHTML`), '');
  assert.equal(runInAppContext(app, `document.getElementById('homeInboxCard').style.display`), 'none');
});

test('مراجعة (4): استرجاع شاهد وُثّق عمله ثانيةً يقول السبب الحقيقي', () => {
  const app = loadApp();
  assert.match(app.trashRestoreErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "shawahid_source_ref_key"' }), /وُثّق بشاهد آخر بعد الحذف/);
  assert.match(app.trashRestoreErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "shawahid_pkey"' }), /بنفس المعرّف/);
});

test('مراجعة (أ3): حلقة «تعطيل الحساب» في buildSchemaSql بعد إنشاء كل جداولها (التثبيت الجديد)', () => {
  const sql = loadApp().buildSchemaSql();
  const blkAt = sql.indexOf('-- فرض «تعطيل الحساب» من القاعدة نفسها');
  const loopAt = sql.indexOf("execute format('create policy %I on public.%I as restrictive", blkAt);
  const list = [...(/foreach v_t in array array\[([\s\S]*?)\] loop/.exec(sql.slice(blkAt))[1]).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(blkAt > 0 && loopAt > blkAt && list.includes('portfolio_shares'));
  list.forEach(t => {
    const at = sql.indexOf('create table if not exists public.' + t + ' ');
    const at2 = sql.indexOf('create table if not exists public.' + t + '(');
    const created = Math.max(at, at2);
    if(created >= 0) assert.ok(created < loopAt, t + ' يُنشأ قبل الحلقة');
  });
});

/* ============ الأعمال المخفية: الإعادة ============ */

test('الأعمال المخفية: المخفي القائم يُعاد بقائمته، ولا يظهر بالقائمة الرئيسية', async () => {
  const seed = SEED();
  seed.classroom_attention_dismissals.push({ teacher_id: 'u1', rule_key: 'shahid_inbox', subject_key: 'plan:p1' });
  const app = inboxApp(seed, []);
  const res = await runInAppContext(app, 'loadInboxItems()');
  assert.ok(!J(res.items.map(i => i.key)).includes('plan:p1'));
  assert.deepEqual(J(res.hidden.map(i => i.key)).sort(), ['plan:p1', 'task:t-hidden'], 'المخفيان قائمان (المهمة مرصودة)');
});

test('إعادة عمل مخفي: حذف الإخفاء باسم المعلم وبمفتاحه، ويرجع للقائمة؛ ونقرتان = طلب واحد', async () => {
  const log = [];
  const seed = SEED();
  seed.classroom_attention_dismissals.push({ teacher_id: 'u1', rule_key: 'shahid_inbox', subject_key: 'plan:p1' });
  const app = inboxApp(seed, log);
  await runInAppContext(app, `(async () => { const r = await loadInboxItems(); inboxItems = r.items; inboxHidden = r.hidden; document.getElementById('inboxView').style.display = 'block'; })()`);
  await runInAppContext(app, `Promise.all([inboxRestoreHidden(0), inboxRestoreHidden(0)])`);
  const dels = log.filter(l => l.table === 'classroom_attention_dismissals' && l.op === 'delete');
  assert.equal(dels.length, 1);
  const f = dels[0].filters;
  [['teacher_id', 'u1'], ['rule_key', 'shahid_inbox'], ['subject_key', 'plan:p1']].forEach(([c, v]) =>
    assert.ok(f.some(([op, cc, vv]) => op === 'eq' && cc === c && vv === v), c));
  assert.ok(J(runInAppContext(app, 'inboxItems.map(i => i.key)')).includes('plan:p1'));
  assert.deepEqual(J(runInAppContext(app, 'inboxHidden.map(i => i.key)')), ['task:t-hidden'], 'المعاد وحده يخرج');
});

test('الإخفاء ينقل العمل لقائمة «الأعمال المخفية» فورًا (يمكن إعادته بلا إعادة تحميل)', async () => {
  const app = inboxApp(SEED(), []);
  await openTaskSheet(app);
  await runInAppContext(app, 'inboxDismiss()');
  assert.ok(J(runInAppContext(app, 'inboxHidden.map(i => i.key)')).includes('task:t1'));
  assert.ok(!J(runInAppContext(app, 'inboxItems.map(i => i.key)')).includes('task:t1'));
});

/* ============ بطاقة الدليل في الحفظ ============ */

async function saveWithCard(setup){
  const log = [];
  const uploads = [];
  const app = inboxApp(SEED(), log);
  runInAppContext(app, `compressImage = async f => f;`);
  const sbo = runInAppContext(app, 'sb');
  sbo.storage.from = () => ({ upload: async (path, file) => { uploads.push(file.name); return { error: null }; }, getPublicUrl: p => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/shawahid-photos/' + p } }), remove: async () => ({}) });
  await openTaskSheet(app);
  runInAppContext(app, setup);
  await runInAppContext(app, `document.getElementById('inboxQual').value = 'أثر'; inboxSave()`);
  return { app, log, uploads };
}

test('بطاقة الدليل: تُرفق افتراضيًا أول صورة', async () => {
  const { uploads, log, app } = await saveWithCard(`renderEvidenceCardFile = async () => ({ name: 'evidence-card.jpg', type: 'image/jpeg' }); inboxSheet.files.push({ name: 'mine.jpg', type: 'image/jpeg', size: 1 });`);
  assert.deepEqual(uploads, ['evidence-card.jpg', 'mine.jpg']);
  assert.equal(log.filter(l => l.table === 'shawahid' && l.op === 'insert')[0].rows[0].photo_urls.length, 2);
  assert.equal(runInAppContext(app, 'true'), true);
});

test('بطاقة الدليل: إزالتها = لا تُرفع، وفشل رسمها لا يمنع الحفظ', async () => {
  const off = await saveWithCard(`renderEvidenceCardFile = async () => ({ name: 'evidence-card.jpg' }); inboxBusy = false; inboxToggleCard();`);
  assert.deepEqual(off.uploads, []);
  assert.equal(off.log.filter(l => l.table === 'shawahid' && l.op === 'insert').length, 1);
  const bad = await saveWithCard(`renderEvidenceCardFile = async () => { throw new Error('no canvas'); };`);
  assert.equal(bad.log.filter(l => l.table === 'shawahid' && l.op === 'insert').length, 1, 'الشاهد حُفظ');
  assert.ok(bad.app.__toasts.some(t => /تعذّر رسم بطاقة الدليل/.test(t)));
});

test('بطاقة الدليل: لكل مصدر بطاقة، ومفعّلة افتراضيًا', async () => {
  const app = inboxApp(SEED(), []);
  const kinds = await runInAppContext(app, `(async () => { const r = await loadInboxItems(); const out = {};
    for(const it of r.items){ const s = await inboxPrepareSheet(it); out[it.type] = !!(s.card && s.cardOn); } return out; })()`);
  assert.deepEqual(J(kinds), { task: true, lesson_plan: true, followup: true, program_session: true });
});

test('صفحة التقرير: غير مُرفقة افتراضيًا، وعند اختيارها تأتي بعد البطاقة وقبل صور المعلم، وفشلها لا يمنع الحفظ', async () => {
  const log = [];
  const uploads = [];
  const { s } = seedPhase2();
  const app = phase2App(s, log);
  runInAppContext(app, `compressImage = async f => f; renderEvidenceCardFile = async () => ({ name: 'evidence-card.jpg' }); renderInboxReportFile = async () => ({ name: 'report-page.jpg' });`);
  const sbo = runInAppContext(app, 'sb');
  sbo.storage.from = () => ({ upload: async (p, f) => { uploads.push(f.name); return { error: null }; }, getPublicUrl: p => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/shawahid-photos/' + p } }), remove: async () => ({}) });
  await runInAppContext(app, `(async () => { const r = await loadInboxItems(); inboxItems = r.items; document.getElementById('inboxView').style.display = 'block';
    await inboxOpen(inboxItems.findIndex(i => i.key === 'test_analysis:T1')); document.getElementById('inboxElement').value = inboxSheet.elementKey; })()`);
  assert.equal(runInAppContext(app, 'inboxSheet.report.kind'), 'section');
  assert.equal(runInAppContext(app, 'inboxSheet.reportOn'), false, 'باختيار المعلم');
  assert.ok(J(runInAppContext(app, 'inboxSheet.report.students.map(x => x.full_name)')).every(n => n === 'طالب'), 'لا أسماء تصل للتقرير');
  runInAppContext(app, `inboxToggleReport(); inboxSheet.files.push({ name: 'mine.jpg', type: 'image/jpeg', size: 1 });`);
  await runInAppContext(app, `document.getElementById('inboxQual').value = 'أثر'; inboxSave()`);
  assert.deepEqual(uploads, ['evidence-card.jpg', 'report-page.jpg', 'mine.jpg']);

  const log2 = [];
  const p2 = seedPhase2();
  const app2 = phase2App(p2.s, log2);
  runInAppContext(app2, `renderEvidenceCardFile = async () => { throw new Error('x'); }; renderInboxReportFile = async () => { throw new Error('x'); };`);
  await runInAppContext(app2, `(async () => { const r = await loadInboxItems(); inboxItems = r.items; document.getElementById('inboxView').style.display = 'block';
    await inboxOpen(inboxItems.findIndex(i => i.key === 'test_analysis:T1')); document.getElementById('inboxElement').value = inboxSheet.elementKey; inboxToggleReport(); })()`);
  await runInAppContext(app2, `document.getElementById('inboxQual').value = 'أثر'; inboxSave()`);
  assert.equal(log2.filter(l => l.table === 'shawahid' && l.op === 'insert').length, 1);
  assert.ok(app2.__toasts.some(t => /تعذّر تجهيز صفحة التقرير/.test(t)));
});

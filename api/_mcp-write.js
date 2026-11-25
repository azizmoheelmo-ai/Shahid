/* ============================================================
   أدوات التعديل بموصل الذكاء الاصطناعي (المرحلة 2) — لا تُسجَّل إلا لرمز
   "قراءة وتعديل" (shahid_rw_…). رمز "القراءة" العادي (shahid_pat_…) لا يرى
   هذه الأدوات أصلًا بقائمة الأدوات.
   ============================================================
   الضوابط (قرار الخطر الأحمر — بيانات طلاب قاصرين):
   1. تعديلات محدّدة الشكل فقط (حضور، درجات، تسليم واجبات، ملاحظة إيجابية،
      مهام شخصية). لا SQL حر ولا حذف إطلاقًا — الحذف يبقى من التطبيق عبر سلة
      المحذوفات (DELETE-POLICY.md).
   2. معاينة ثم حفظ بالإلزام من الخادم: الاستدعاء الأول (بلا save) يرجع معاينة
      (قبل ← بعد) ومعها confirm_token موقَّع HMAC مرتبط بالمدخلات نفسها ومدته
      10 دقائق؛ الحفظ يشترط save:true مع التوكن نفسه والمدخلات نفسها بالحرف.
   3. كل حفظ يُسجَّل بـaudit_log (القيم القديمة والجديدة) **قبل** التنفيذ؛
      إن تعذّر التسجيل لا يُنفَّذ شيء.
   4. حد أقصى 20 عملية حفظ لكل 5 دقائق لكل معلم (عدّ من audit_log نفسه).
   5. كل قراءة/كتابة مقيّدة صراحة بـteacher_id/user_id صاحب الرمز؛ الطالب/الشعبة/
      العمود يُحلّ دائمًا من قوائم هذا المعلم فقط.
   6. لا يُعدَّل أي عمود درجات محسوب (واجبات/مهام/أدوات/فترات) — يُحسب
      تلقائيًا من مصدره ويُرفض تعديله هنا.
   7. تحسين الدرجات (app-56): إنشاء نشاط وتعديل اسمه/درجته الكاملة ورصد درجات المشاركين بالقواعد نفسها
      التي يفرضها التطبيق (لا نشاط بلا اختبار/مهمة قائمة، الإعادة بدرجة الأصل، الفترة لزيادة مجموع المهام فقط،
      لا رصد في فترة مقفلة). لا حذف نشاط ولا مسح درجة (من التطبيق عبر السلة). */

const crypto = require('crypto');

const MAX_ENTRIES = 60;
const WRITE_LIMIT = 20;
const WRITE_WINDOW_SECONDS = 300;
const CONFIRM_TTL_SECONDS = 600;
const PROCESS_SECRET = crypto.randomBytes(32).toString('hex');

function stableStringify(v){
  if(Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if(v && typeof v === 'object'){
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

function signConfirm(key, userId, tool, args, ts){
  return crypto.createHmac('sha256', key).update([userId, tool, ts, stableStringify(args)].join('|')).digest('hex');
}
function makeConfirmToken(key, userId, tool, args){
  const ts = Math.floor(Date.now() / 1000);
  return ts + '.' + signConfirm(key, userId, tool, args, ts);
}
function checkConfirmToken(key, userId, tool, args, token){
  const m = /^(\d{9,12})\.([0-9a-f]{64})$/.exec(String(token || ''));
  if(!m) return false;
  const ts = Number(m[1]);
  if(Math.floor(Date.now() / 1000) - ts > CONFIRM_TTL_SECONDS || ts > Math.floor(Date.now() / 1000) + 5) return false;
  const expected = Buffer.from(signConfirm(key, userId, tool, args, ts), 'hex');
  const given = Buffer.from(m[2], 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

class PlanError extends Error {}
const fail = msg => { throw new PlanError(msg); };

function registerWriteTools(server, ctx){
  const { userId, supabase, z, textResult, fetchAll, loadRoster, normalizeAr, sectionLabel, signKey } = ctx;
  const fetchImprovements = ctx.fetchImprovements || (async () => []);
  const key = signKey || PROCESS_SECRET;

  /* ---------- حلّ الأسماء إلى معرّفات، من قوائم هذا المعلم فقط ---------- */
  function resolveSection(roster, sectionId){
    const sec = roster.sectionById.get(sectionId);
    if(!sec) fail('الشعبة غير موجودة لدى هذا المعلم: استعمل section_id من list_my_sections');
    return sec;
  }
  function resolveStudent(roster, name, sectionId){
    const pool = roster.students.filter(st => st.is_active !== false && (!sectionId || st.section_id === sectionId));
    const q = normalizeAr(name);
    if(!q) fail('اسم الطالب فارغ');
    let hits = pool.filter(st => normalizeAr(st.full_name) === q);
    if(!hits.length) hits = pool.filter(st => normalizeAr(st.full_name).includes(q));
    if(!hits.length) fail('لا طالب باسم «' + name + '»' + (sectionId ? ' بهذه الشعبة' : ''));
    if(hits.length > 1) fail('الاسم «' + name + '» يطابق أكثر من طالب (' + hits.slice(0, 5).map(h => h.full_name).join('، ') + ') — اكتب الاسم كاملًا');
    return hits[0];
  }
  function pickUnique(rows, field, wanted, what){
    const q = normalizeAr(wanted);
    let hits = rows.filter(r => normalizeAr(r[field]) === q);
    if(!hits.length) hits = rows.filter(r => normalizeAr(r[field]).includes(q));
    if(!hits.length) fail('لا ' + what + ' باسم «' + wanted + '»');
    if(hits.length > 1) fail('«' + wanted + '» يطابق أكثر من ' + what + ' — اكتب الاسم كاملًا أو حدّد الشعبة');
    return hits[0];
  }
  function checkDuplicates(entries){
    const seen = new Set();
    for(const e of entries){
      const k = normalizeAr(e.student_name);
      if(seen.has(k)) fail('الطالب «' + e.student_name + '» مكرَّر في نفس الطلب');
      seen.add(k);
    }
  }

  async function writesInWindow(){
    const since = new Date(Date.now() - WRITE_WINDOW_SECONDS * 1000).toISOString();
    const { count, error } = await supabase.from('audit_log').select('*', { count: 'exact', head: true })
      .eq('action', 'mcp_write').eq('performed_by', userId).gte('created_at', since);
    if(error) throw new PlanError('تعذّر التحقق من حد التعديلات — لم يُنفَّذ شيء');
    return count || 0;
  }

  /* ---------- المحرّك المشترك: معاينة ← تأكيد ← تدقيق ← تنفيذ ---------- */
  async function runWrite(tool, args, plan){
    const { save, confirm_token, ...inputs } = args;
    try{
      const changes = await plan(inputs);
      const actual = changes.filter(c => !c.noop);
      const view = changes.map(c => ({ what: c.what, before: c.before, after: c.after, change: c.noop ? 'بلا تغيير' : (c.op === 'insert' ? 'إضافة' : 'تعديل') }));

      if(!save){
        return textResult({
          preview: true, saved: false, tool,
          changes_count: actual.length, changes: view,
          confirm_token: actual.length ? makeConfirmToken(key, userId, tool, inputs) : undefined,
          next_step: actual.length
            ? 'اعرض هذه المعاينة على المعلم واطلب موافقته الصريحة. بعد موافقته أعد الاستدعاء بنفس المدخلات بالحرف مع save:true وconfirm_token أعلاه (صالح 10 دقائق).'
            : 'لا شيء يحتاج حفظًا — كل القيم مطابقة لما هو مسجَّل.'
        });
      }

      if(!checkConfirmToken(key, userId, tool, inputs, confirm_token)){
        return textResult({ saved: false, error: 'لا حفظ بلا معاينة: أعد الاستدعاء بلا save لتحصل على confirm_token جديد، ثم أرسله مع المدخلات نفسها بالحرف (صالح 10 دقائق).' });
      }
      if(!actual.length) return textResult({ saved: false, applied_count: 0, note: 'لا تغييرات للحفظ.' });
      if(await writesInWindow() >= WRITE_LIMIT){
        return textResult({ saved: false, error: 'تجاوزت حد التعديلات (' + WRITE_LIMIT + ' عمليات حفظ كل ' + (WRITE_WINDOW_SECONDS / 60) + ' دقائق) — حاول بعد قليل.' });
      }

      /* التدقيق أولًا: بلا سجل لا تنفيذ */
      const { error: aErr } = await supabase.from('audit_log').insert({
        action: 'mcp_write', table_name: tool, performed_by: userId,
        details: { tool, changes: actual.map(c => ({ what: c.what, op: c.op, before: c.before, after: c.after })) }
      });
      if(aErr) return textResult({ saved: false, error: 'تعذّر تسجيل التدقيق — لم يُنفَّذ أي تعديل.' });

      let applied = 0;
      const ctxApply = {};
      for(const c of actual){
        try{ await c.apply(ctxApply); applied++; }
        catch(err){ return textResult({ saved: false, partial: applied > 0, applied_count: applied, total: actual.length, error: 'توقّف التنفيذ عند «' + c.what + '»: ' + err.message + (applied ? ' — نُفِّذ ' + applied + ' فقط، راجع التطبيق.' : '') }); }
      }
      return textResult({ saved: true, applied_count: applied, changes: view });
    } catch(err){
      if(err instanceof PlanError) return textResult({ saved: false, error: err.message });
      return textResult({ saved: false, error: 'خطأ غير متوقع: ' + err.message });
    }
  }

  const saveFields = {
    save: z.boolean().optional().describe('false/غير مضبوط = معاينة فقط. true = حفظ (يشترط confirm_token من المعاينة).'),
    confirm_token: z.string().optional().describe('الرمز الذي أعادته المعاينة — مطلوب مع save:true')
  };
  const WRITE_NOTE = ' أداة تعديل: استدعها أولًا بلا save لتعرض المعاينة على المعلم، ولا تحفظ إلا بعد موافقته الصريحة. بيانات طلاب قاصرين.';

  /* ============ 1) تسجيل الحضور/الغياب ============ */
  server.registerTool('record_attendance', {
    title: 'تسجيل غياب/تأخر/استئذان',
    description: 'يسجّل حالة غياب أو تأخر أو استئذان لطلاب شعبة في حصة معيّنة (تُنشأ الحصة إن لم تكن موجودة). الطالب بلا سجل = حاضر. لا يمكن "إلغاء" سجل من هنا (تعديل الحالة بين الثلاث فقط) — الإلغاء من التطبيق.' + WRITE_NOTE,
    inputSchema: {
      section_id: z.string().describe('معرّف الشعبة من list_my_sections'),
      lesson_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('تاريخ الحصة YYYY-MM-DD'),
      period: z.number().int().min(1).max(12).describe('رقم الحصة 1-12'),
      entries: z.array(z.object({ student_name: z.string().min(1).max(120), status: z.enum(['absent', 'late', 'permitted_exit']) })).min(1).max(MAX_ENTRIES),
      ...saveFields
    }
  }, args => runWrite('record_attendance', args, async ({ section_id, lesson_date, period, entries }) => {
    const roster = await loadRoster(supabase, userId);
    resolveSection(roster, section_id);
    checkDuplicates(entries);
    const students = entries.map(e => ({ st: resolveStudent(roster, e.student_name, section_id), status: e.status }));

    const lessons = (await fetchAll(supabase, 'classroom_lessons', 'id, section_id, lesson_date, period', 'teacher_id', userId))
      .filter(l => l.section_id === section_id && l.lesson_date === lesson_date && Number(l.period) === period);
    const lesson = lessons[0] || null;
    const existing = lesson
      ? (await fetchAll(supabase, 'classroom_attendance', 'id, lesson_id, student_id, status', 'teacher_id', userId)).filter(a => a.lesson_id === lesson.id)
      : [];

    const label = sectionLabel(roster, section_id);
    const changes = [];
    if(!lesson){
      changes.push({ what: 'إنشاء حصة ' + label + ' — ' + lesson_date + ' / الحصة ' + period, op: 'insert', before: null, after: 'حصة جديدة',
        apply: async cx => {
          const { data, error } = await supabase.from('classroom_lessons').insert({ teacher_id: userId, section_id, lesson_date, period }).select('id').maybeSingle();
          if(error || !data) throw new Error('تعذّر إنشاء الحصة');
          cx.lessonId = data.id;
        } });
    }
    for(const { st, status } of students){
      const cur = existing.find(a => a.student_id === st.id);
      const what = 'حضور ' + st.full_name + ' (' + label + ' ' + lesson_date + ' ح' + period + ')';
      if(cur && cur.status === status){ changes.push({ what, op: 'update', before: cur.status, after: status, noop: true }); continue; }
      changes.push({ what, op: cur ? 'update' : 'insert', before: cur ? cur.status : 'حاضر (لا سجل)', after: status,
        apply: async cx => {
          if(cur){
            const { error } = await supabase.from('classroom_attendance').update({ status }).eq('teacher_id', userId).eq('id', cur.id);
            if(error) throw new Error(error.message);
          } else {
            const lessonId = lesson ? lesson.id : cx.lessonId;
            if(!lessonId) throw new Error('الحصة غير جاهزة');
            const { error } = await supabase.from('classroom_attendance').insert({ teacher_id: userId, lesson_id: lessonId, student_id: st.id, status });
            if(error) throw new Error(error.message);
          }
        } });
    }
    return changes;
  }));

  /* ============ 2) رصد درجات عمود يدوي ============ */
  server.registerTool('set_grades', {
    title: 'رصد درجات عمود',
    description: 'يرصد أو يعدّل درجات طلاب في عمود درجات يدوي (اختبار قصير، مثلًا) بالاسم. يرفض الأعمدة المحسوبة تلقائيًا (واجبات، مهام، أدوات، أو أعمدة بفترات) — تُعدَّل من التطبيق. الدرجة بين 0 والدرجة العظمى للعمود. لا مسح لدرجة من هنا.' + WRITE_NOTE,
    inputSchema: {
      section_id: z.string().describe('معرّف الشعبة'),
      column_name: z.string().min(1).max(120).describe('اسم عمود الدرجات كما في list_my_grades'),
      semester: z.string().optional().describe('الفصل — يلزم لو تكرّر اسم العمود بفصلين'),
      entries: z.array(z.object({ student_name: z.string().min(1).max(120), score: z.number().min(0) })).min(1).max(MAX_ENTRIES),
      ...saveFields
    }
  }, args => runWrite('set_grades', args, async ({ section_id, column_name, semester, entries }) => {
    const roster = await loadRoster(supabase, userId);
    resolveSection(roster, section_id);
    checkDuplicates(entries);
    let cols = (await fetchAll(supabase, 'classroom_grade_columns', 'id, section_id, semester, name, max_score, kind, tool_id', 'teacher_id', userId))
      .filter(c => c.section_id === section_id);
    if(semester) cols = cols.filter(c => String(c.semester) === String(semester));
    const col = pickUnique(cols, 'name', column_name, 'عمود درجات');
    if(col.tool_id || (col.kind && col.kind !== 'manual')) fail('العمود «' + col.name + '» محسوب تلقائيًا (' + (col.tool_id ? 'من أداة تقويم' : col.kind) + ') — لا يُعدَّل من الموصل');
    const periods = (await fetchAll(supabase, 'classroom_grade_period_scores', 'id, column_id', 'teacher_id', userId)).filter(r => r.column_id === col.id);
    if(periods.length) fail('العمود «' + col.name + '» يُحسب من درجات الفترات — يُعدَّل من التطبيق');

    const max = Number(col.max_score);
    const scores = (await fetchAll(supabase, 'classroom_grade_scores', 'id, column_id, student_id, score', 'teacher_id', userId)).filter(r => r.column_id === col.id);
    const changes = [];
    for(const e of entries){
      const st = resolveStudent(roster, e.student_name, section_id);
      if(e.score > max) fail('درجة ' + st.full_name + ' (' + e.score + ') أكبر من الدرجة العظمى للعمود (' + max + ')');
      const cur = scores.find(r => r.student_id === st.id);
      const what = 'درجة ' + st.full_name + ' في «' + col.name + '»';
      if(cur && Number(cur.score) === e.score){ changes.push({ what, op: 'update', before: cur.score, after: e.score, noop: true }); continue; }
      changes.push({ what, op: cur ? 'update' : 'insert', before: cur ? Number(cur.score) : null, after: e.score,
        apply: async () => {
          const { error } = cur
            ? await supabase.from('classroom_grade_scores').update({ score: e.score, updated_at: new Date().toISOString() }).eq('teacher_id', userId).eq('id', cur.id)
            : await supabase.from('classroom_grade_scores').insert({ teacher_id: userId, column_id: col.id, student_id: st.id, score: e.score });
          if(error) throw new Error(error.message);
        } });
    }
    return changes;
  }));

  /* ============ 3) تسليم الواجبات ============ */
  server.registerTool('set_homework_status', {
    title: 'تسليم واجب',
    description: 'يسجّل حالة تسليم طلاب لواجب (submitted تم / partial ناقص / late متأخر). لا يمكن مسح حالة من هنا. درجة الواجبات تُحسب تلقائيًا من هذه الحالات.' + WRITE_NOTE,
    inputSchema: {
      section_id: z.string().describe('معرّف الشعبة'),
      homework_title: z.string().min(1).max(200).describe('عنوان الواجب كما في list_my_homework'),
      entries: z.array(z.object({ student_name: z.string().min(1).max(120), status: z.enum(['submitted', 'partial', 'late']) })).min(1).max(MAX_ENTRIES),
      ...saveFields
    }
  }, args => runWrite('set_homework_status', args, async ({ section_id, homework_title, entries }) => {
    const roster = await loadRoster(supabase, userId);
    resolveSection(roster, section_id);
    checkDuplicates(entries);
    const hws = (await fetchAll(supabase, 'classroom_homework', 'id, section_id, title', 'teacher_id', userId)).filter(h => h.section_id === section_id);
    const hw = pickUnique(hws, 'title', homework_title, 'واجب');
    const rows = (await fetchAll(supabase, 'classroom_homework_status', 'id, homework_id, student_id, status', 'teacher_id', userId)).filter(r => r.homework_id === hw.id);
    const changes = [];
    for(const e of entries){
      const st = resolveStudent(roster, e.student_name, section_id);
      const cur = rows.find(r => r.student_id === st.id);
      const what = 'تسليم ' + st.full_name + ' لواجب «' + hw.title + '»';
      if(cur && cur.status === e.status){ changes.push({ what, op: 'update', before: cur.status, after: e.status, noop: true }); continue; }
      changes.push({ what, op: cur ? 'update' : 'insert', before: cur ? cur.status : 'لم يُسلَّم (لا سجل)', after: e.status,
        apply: async () => {
          const { error } = cur
            ? await supabase.from('classroom_homework_status').update({ status: e.status, updated_at: new Date().toISOString() }).eq('teacher_id', userId).eq('id', cur.id)
            : await supabase.from('classroom_homework_status').insert({ teacher_id: userId, homework_id: hw.id, student_id: st.id, status: e.status });
          if(error) throw new Error(error.message);
        } });
    }
    return changes;
  }));

  /* ============ 4) درجات مهمة أدائية صفية (لطلاب مضافين لها أصلًا) ============ */
  server.registerTool('set_class_task_scores', {
    title: 'رصد درجات مهمة أدائية',
    description: 'يرصد درجات طلاب مضافين فعلًا إلى مهمة أدائية صفية (لا يضيف طلابًا للمهمة ولا يزيلهم). الدرجة بين 0 والدرجة العظمى للمهمة.' + WRITE_NOTE,
    inputSchema: {
      section_id: z.string().describe('معرّف الشعبة'),
      task_title: z.string().min(1).max(200).describe('عنوان المهمة كما في list_my_class_tasks'),
      entries: z.array(z.object({ student_name: z.string().min(1).max(120), score: z.number().min(0) })).min(1).max(MAX_ENTRIES),
      ...saveFields
    }
  }, args => runWrite('set_class_task_scores', args, async ({ section_id, task_title, entries }) => {
    const roster = await loadRoster(supabase, userId);
    resolveSection(roster, section_id);
    checkDuplicates(entries);
    const tasks = (await fetchAll(supabase, 'classroom_tasks', 'id, section_id, title, max_score', 'teacher_id', userId)).filter(t => t.section_id === section_id);
    const task = pickUnique(tasks, 'title', task_title, 'مهمة أدائية');
    const max = Number(task.max_score);
    const rows = (await fetchAll(supabase, 'classroom_task_students', 'id, task_id, student_id, score', 'teacher_id', userId)).filter(r => r.task_id === task.id);
    const changes = [];
    for(const e of entries){
      const st = resolveStudent(roster, e.student_name, section_id);
      const cur = rows.find(r => r.student_id === st.id);
      if(!cur) fail('الطالب «' + st.full_name + '» غير مضاف إلى المهمة «' + task.title + '» — أضفه من التطبيق أولًا');
      if(e.score > max) fail('درجة ' + st.full_name + ' (' + e.score + ') أكبر من الدرجة العظمى للمهمة (' + max + ')');
      const what = 'درجة ' + st.full_name + ' في مهمة «' + task.title + '»';
      if(cur.score != null && Number(cur.score) === e.score){ changes.push({ what, op: 'update', before: cur.score, after: e.score, noop: true }); continue; }
      changes.push({ what, op: 'update', before: cur.score == null ? null : Number(cur.score), after: e.score,
        apply: async () => {
          const { error } = await supabase.from('classroom_task_students').update({ score: e.score, updated_at: new Date().toISOString() }).eq('teacher_id', userId).eq('id', cur.id);
          if(error) throw new Error(error.message);
        } });
    }
    return changes;
  }));

  /* ============ 4ب) تحسين الدرجات (app-56): إنشاء، تعديل، رصد ============ */
  const IMP_TARGET_AR = { tests: 'الاختبارات', task: 'المهام الأدائية' };
  const scoreOk = n => Number.isFinite(n) && n > 0 && n <= 40 && Math.round(n * 100) === n * 100;

  /* عناصر الشعبة لهذا الفصل: الاختبارات الظاهرة، وعمود المهام، والمهام — من قوائم هذا المعلم فقط */
  async function improveSectionItems(sectionId, year, semester){
    const sameTerm = r => r.section_id === sectionId && String(r.semester) === String(semester) && (!year || !r.academic_year || r.academic_year === year);
    const [cols, tools, tasks] = await Promise.all([
      fetchAll(supabase, 'classroom_grade_columns', 'id, section_id, academic_year, semester, name, category, kind, tool_id, max_score', 'teacher_id', userId),
      fetchAll(supabase, 'classroom_custom_tools', 'id, hidden', 'teacher_id', userId).catch(() => []),
      fetchAll(supabase, 'classroom_tasks', 'id, section_id, academic_year, semester, title, max_score, grade_period, due_date, created_at', 'teacher_id', userId)
    ]);
    const hidden = new Set(tools.filter(t => t.hidden).map(t => t.id));
    const mine = cols.filter(c => sameTerm(c) && !(c.tool_id && hidden.has(c.tool_id)));
    return {
      tests: mine.filter(c => c.category === 'tests').map(c => ({ id: c.id, name: c.name, max: Number(c.max_score) })),
      taskCol: mine.some(c => c.kind === 'task' && !c.tool_id),
      tasks: tasks.filter(sameTerm).map(t => ({ id: t.id, name: t.title, max: Number(t.max_score), grade_period: t.grade_period, date: t.due_date || String(t.created_at || '').slice(0, 10) }))
    };
  }

  /* هل الفترة p لمكوّن المهام مقفلة لهذا الفصل؟ (user_app_settings.period_locks، الشكلان الجديد والقديم) */
  async function taskPeriodLocked(year, semester, p){
    if(!p) return false;
    const { data } = await supabase.from('user_app_settings').select('period_locks').eq('user_id', userId).maybeSingle();
    const l = data && data.period_locks && data.period_locks[year + '|' + semester] && data.period_locks[year + '|' + semester]['kind:task'];
    if(!l || typeof l !== 'object') return false;
    if(l.periods && typeof l.periods === 'object') return Object.prototype.hasOwnProperty.call(l.periods, String(p));
    return Number(l.p) >= Number(p);
  }

  async function resolveImprovement(sectionId, name, semester){
    let imps = (await fetchImprovements(supabase, userId)).filter(i => i.section_id === sectionId);
    if(semester) imps = imps.filter(i => String(i.semester) === String(semester));
    return pickUnique(imps, 'name', name, 'نشاط تحسين');
  }

  server.registerTool('create_improvement', {
    title: 'إنشاء نشاط تحسين درجات',
    description: 'ينشئ نشاط تحسين اختياريًا لشعبة: kind=add زيادة بدرجة مستقلة (max_score) تُضاف على مجموع البند أو على اختبار/مهمة item_name بسقفها؛ kind=retake إعادة الاختبار/المهمة item_name بالكامل بدرجته الكاملة نفسها، وretake_rule: max (يُعتمد الأعلى) أو replace (تحلّ محل القديمة ولو أقل). يُرفض إن لم يكن في الشعبة اختبار (أو عمود مهام ومهمة) بعد. period (1-3) لزيادة على مجموع المهام فقط. ثم ارصد الدرجات بـset_improvement_scores.' + WRITE_NOTE,
    inputSchema: {
      section_id: z.string().describe('معرّف الشعبة من list_my_sections'),
      semester: z.enum(['1', '2']).describe('الفصل الدراسي'),
      target: z.enum(['tests', 'task']).describe('tests = الاختبارات، task = المهام الأدائية'),
      kind: z.enum(['add', 'retake']).describe('add = زيادة، retake = إعادة كاملة'),
      name: z.string().min(1).max(100).describe('اسم النشاط'),
      item_name: z.string().min(1).max(200).optional().describe('اسم الاختبار/المهمة (إلزامي للإعادة، واختياري للزيادة — بدونه تُضاف على المجموع)'),
      retake_rule: z.enum(['max', 'replace']).optional().describe('للإعادة: max الأعلى منهما، replace تحلّ محل القديمة'),
      max_score: z.number().optional().describe('للزيادة: الدرجة الكاملة للنشاط (أكبر من 0 حتى 40). الإعادة تأخذ درجة الأصل'),
      period: z.number().int().min(1).max(3).optional().describe('لزيادة على مجموع المهام: فترة بعينها (بدونه = على المجموع)'),
      ...saveFields
    }
  }, args => runWrite('create_improvement', args, async ({ section_id, semester, target, kind, name, item_name, retake_rule, max_score, period }) => {
    const roster = await loadRoster(supabase, userId);
    const sec = resolveSection(roster, section_id);
    const year = sec.academic_year || null;
    const items = await improveSectionItems(section_id, year, semester);
    const what = target === 'tests' ? 'اختبار' : 'مهمة';
    if(target === 'tests' && !items.tests.length) fail('لا اختبارات في هذه الشعبة بعد — التحسين يُضاف على درجة قائمة، أنشئ اختبارًا أولًا');
    if(target === 'task' && !items.taskCol) fail('لا عمود «مهام أدائية» في كشف هذه الشعبة');
    if(target === 'task' && !items.tasks.length) fail('لا مهام أدائية في هذه الشعبة بعد — أنشئ مهمة أولًا');
    if(kind === 'retake' && !item_name) fail('الإعادة تحتاج item_name: ال' + what + ' الذي يُعاد');
    if(kind === 'retake' && !retake_rule) fail('حدّد retake_rule: max (الأعلى منهما) أو replace (تحلّ محل القديمة)');
    if(kind === 'add' && retake_rule) fail('retake_rule للإعادة فقط');
    const item = item_name ? pickUnique(target === 'tests' ? items.tests : items.tasks, 'name', item_name, what) : null;
    let max;
    if(kind === 'retake'){
      if(max_score !== undefined && Number(max_score) !== item.max) fail('درجة الإعادة الكاملة كدرجة الأصل (' + item.max + ') — لا تُحدَّد');
      max = item.max;
    } else {
      if(!scoreOk(Number(max_score))) fail('max_score للزيادة: رقم أكبر من 0 حتى 40 بمنزلتين عشريتين كحد أقصى');
      max = Number(max_score);
    }
    if(period !== undefined){
      if(target !== 'task' || kind !== 'add' || item) fail('period لزيادة على مجموع المهام فقط');
      if(await taskPeriodLocked(year, semester, period)) fail('الفترة ' + period + ' مقفلة — افتحها من التطبيق أولًا');
    }
    const dup = (await fetchImprovements(supabase, userId)).find(i => i.section_id === section_id && String(i.semester) === String(semester) && normalizeAr(i.name) === normalizeAr(name));
    const after = { name, section: sectionLabel(roster, section_id), target: IMP_TARGET_AR[target],
      type: kind === 'retake' ? 'إعادة «' + item.name + '» — ' + (retake_rule === 'max' ? 'الأعلى منهما' : 'تحلّ محل القديمة') : (item ? 'زيادة على «' + item.name + '»' : 'زيادة على المجموع' + (period ? ' (الفترة ' + period + ')' : '')),
      max_score: max };
    const label = 'نشاط تحسين «' + name + '»';
    if(dup) return [{ what: label, op: 'insert', before: 'نشاط بالاسم نفسه موجود في الشعبة', after, noop: true }];
    return [{ what: label, op: 'insert', before: null, after,
      apply: async () => {
        const row = { teacher_id: userId, section_id, academic_year: year, semester: Number(semester), target, mode: kind === 'retake' ? 'retake' : 'new',
          rule: 'add', name: name.trim(), max_score: max, source_name: item ? String(item.name).slice(0, 200) : null,
          grade_period: period && target === 'task' && kind === 'add' && !item ? period : null };
        if(kind === 'retake') row.retake = retake_rule;
        if(item) row[target === 'tests' ? 'column_id' : 'task_id'] = item.id;
        const { error } = await supabase.from('classroom_improvements').insert(row);
        if(error) throw new Error(error.message);
      } }];
  }));

  server.registerTool('update_improvement', {
    title: 'تعديل نشاط تحسين',
    description: 'يعدّل اسم نشاط تحسين أو درجته الكاملة (للزيادة فقط — الإعادة بدرجة الأصل). لا تُخفَض الدرجة الكاملة تحت درجة مرصودة. البند والنوع والربط ثابتة. لا يحذف.' + WRITE_NOTE,
    inputSchema: {
      section_id: z.string().describe('معرّف الشعبة'),
      improvement_name: z.string().min(1).max(100).describe('اسم النشاط كما في list_my_improvements'),
      semester: z.enum(['1', '2']).optional().describe('يلزم لو تكرّر الاسم في الفصلين'),
      new_name: z.string().min(1).max(100).optional(),
      max_score: z.number().optional(),
      ...saveFields
    }
  }, args => runWrite('update_improvement', args, async ({ section_id, improvement_name, semester, new_name, max_score }) => {
    const roster = await loadRoster(supabase, userId);
    resolveSection(roster, section_id);
    if(new_name === undefined && max_score === undefined) fail('حدّد ما تريد تعديله: new_name أو max_score');
    const imp = await resolveImprovement(section_id, improvement_name, semester);
    const patch = {}, before = {}, after = {};
    if(new_name !== undefined && new_name.trim() !== imp.name){ patch.name = new_name.trim(); before.name = imp.name; after.name = patch.name; }
    if(max_score !== undefined && Number(max_score) !== Number(imp.max_score)){
      if(imp.retake) fail('درجة الإعادة الكاملة كدرجة الأصل — لا تُعدَّل');
      if(!scoreOk(Number(max_score))) fail('max_score: رقم أكبر من 0 حتى 40 بمنزلتين عشريتين كحد أقصى');
      const over = (await fetchAll(supabase, 'classroom_improvement_scores', 'id, improvement_id, score', 'teacher_id', userId)).filter(r => r.improvement_id === imp.id && Number(r.score) > Number(max_score)).length;
      if(over) fail('لا يمكن خفضها إلى ' + max_score + ': ' + over + ' درجة مرصودة أعلى منها — عدّلها أولًا');
      patch.max_score = Number(max_score); before.max_score = Number(imp.max_score); after.max_score = patch.max_score;
    }
    const what = 'نشاط تحسين «' + imp.name + '»';
    if(!Object.keys(patch).length) return [{ what, op: 'update', before, after, noop: true }];
    return [{ what, op: 'update', before, after,
      apply: async () => {
        const { error } = await supabase.from('classroom_improvements').update(patch).eq('teacher_id', userId).eq('id', imp.id);
        if(error) throw new Error(error.message);
      } }];
  }));

  server.registerTool('set_improvement_scores', {
    title: 'رصد درجات نشاط تحسين',
    description: 'يرصد أو يعدّل درجات من شارك في نشاط تحسين (من لم يشارك يُترك ولا يتأثر). الدرجة بين 0 ودرجة النشاط الكاملة. يرفض الرصد في فترة مقفلة. لا مسح لدرجة من هنا. أثر الزيادة/الإعادة: الاختبارات تُحسب فورًا، وعمود المهام يُحدَّث عند فتح كشف الشعبة في التطبيق.' + WRITE_NOTE,
    inputSchema: {
      section_id: z.string().describe('معرّف الشعبة'),
      improvement_name: z.string().min(1).max(100).describe('اسم النشاط كما في list_my_improvements'),
      semester: z.enum(['1', '2']).optional().describe('يلزم لو تكرّر الاسم في الفصلين'),
      entries: z.array(z.object({ student_name: z.string().min(1).max(120), score: z.number().min(0) })).min(1).max(MAX_ENTRIES),
      ...saveFields
    }
  }, args => runWrite('set_improvement_scores', args, async ({ section_id, improvement_name, semester, entries }) => {
    const roster = await loadRoster(supabase, userId);
    resolveSection(roster, section_id);
    checkDuplicates(entries);
    const imp = await resolveImprovement(section_id, improvement_name, semester);
    if(imp.retake && !imp.column_id && !imp.task_id) fail('النشاط «' + imp.name + '» متوقف: ' + (imp.target === 'tests' ? 'الاختبار' : 'المهمة') + ' المُعاد محذوف');
    /* قفل الفترات: زيادة على فترة بعينها، أو على مهمة معيّنة (فترتها) */
    if(imp.target === 'task'){
      let p = imp.grade_period || null;
      if(!p && imp.task_id){
        const t = (await fetchAll(supabase, 'classroom_tasks', 'id, grade_period', 'teacher_id', userId)).find(x => x.id === imp.task_id);
        p = t && t.grade_period;
      }
      if(p && await taskPeriodLocked(imp.academic_year, imp.semester, p)) fail('الفترة ' + p + ' مقفلة — افتحها من التطبيق أولًا');
    }
    const max = Number(imp.max_score);
    const rows = (await fetchAll(supabase, 'classroom_improvement_scores', 'id, improvement_id, student_id, score', 'teacher_id', userId)).filter(r => r.improvement_id === imp.id);
    const changes = [];
    for(const e of entries){
      const st = resolveStudent(roster, e.student_name, section_id);
      if(e.score > max) fail('درجة ' + st.full_name + ' (' + e.score + ') أكبر من درجة النشاط الكاملة (' + max + ')');
      const cur = rows.find(r => r.student_id === st.id);
      const what = 'درجة ' + st.full_name + ' في نشاط التحسين «' + imp.name + '»';
      if(cur && Number(cur.score) === e.score){ changes.push({ what, op: 'update', before: Number(cur.score), after: e.score, noop: true }); continue; }
      changes.push({ what, op: cur ? 'update' : 'insert', before: cur ? Number(cur.score) : 'لم يشارك', after: e.score,
        apply: async () => {
          const { error } = cur
            ? await supabase.from('classroom_improvement_scores').update({ score: e.score, updated_at: new Date().toISOString() }).eq('teacher_id', userId).eq('id', cur.id)
            : await supabase.from('classroom_improvement_scores').insert({ teacher_id: userId, improvement_id: imp.id, student_id: st.id, score: e.score });
          if(error) throw new Error(error.message);
        } });
    }
    return changes;
  }));

  /* ============ 5) ملاحظة إيجابية على طالب ============ */
  server.registerTool('add_positive_note', {
    title: 'إضافة ملاحظة إيجابية',
    description: 'يضيف ملاحظة إيجابية (حتى 300 حرف) على طالب. إضافة فقط — لا تعديل ولا حذف لملاحظات موجودة.' + WRITE_NOTE,
    inputSchema: {
      student_name: z.string().min(1).max(120),
      section_id: z.string().optional().describe('معرّف الشعبة لتضييق مطابقة الاسم (اختياري)'),
      note_text: z.string().min(1).max(300),
      note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('تاريخ الملاحظة، افتراضيًا اليوم'),
      ...saveFields
    }
  }, args => runWrite('add_positive_note', args, async ({ student_name, section_id, note_text, note_date }) => {
    const roster = await loadRoster(supabase, userId);
    if(section_id) resolveSection(roster, section_id);
    const st = resolveStudent(roster, student_name, section_id);
    const date = note_date || new Date().toISOString().slice(0, 10);
    const dup = (await fetchAll(supabase, 'classroom_positive_notes', 'id, student_id, note_date, note_text', 'teacher_id', userId))
      .find(n => n.student_id === st.id && n.note_date === date && n.note_text === note_text);
    const what = 'ملاحظة إيجابية على ' + st.full_name + ' (' + date + ')';
    if(dup) return [{ what, op: 'insert', before: 'مسجَّلة سابقًا', after: note_text, noop: true }];
    return [{ what, op: 'insert', before: null, after: note_text,
      apply: async () => {
        const { error } = await supabase.from('classroom_positive_notes').insert({ teacher_id: userId, student_id: st.id, section_id: st.section_id || null, note_date: date, note_text });
        if(error) throw new Error(error.message);
      } }];
  }));

  /* ============ 6) مهام المعلم الشخصية ============ */
  server.registerTool('add_personal_task', {
    title: 'إضافة مهمة شخصية',
    description: 'يضيف مهمة شخصية لقائمة مهام المعلم.' + ' أداة تعديل: استدعها أولًا بلا save لتعرض المعاينة على المعلم.',
    inputSchema: {
      title: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ...saveFields
    }
  }, args => runWrite('add_personal_task', args, async ({ title, description, priority, due_date }) => {
    const dup = (await fetchAll(supabase, 'tasks', 'id, title, done', 'user_id', userId)).find(t => !t.done && normalizeAr(t.title) === normalizeAr(title));
    const what = 'مهمة شخصية «' + title + '»';
    if(dup) return [{ what, op: 'insert', before: 'مهمة مفتوحة بنفس العنوان موجودة', after: title, noop: true }];
    return [{ what, op: 'insert', before: null, after: { title, priority: priority || 'medium', due_date: due_date || null },
      apply: async () => {
        const row = { user_id: userId, title, priority: priority || 'medium' };
        if(description) row.description = description;
        if(due_date) row.due_date = due_date;
        const { error } = await supabase.from('tasks').insert(row);
        if(error) throw new Error(error.message);
      } }];
  }));

  server.registerTool('update_personal_task', {
    title: 'تعديل مهمة شخصية',
    description: 'يعدّل مهمة شخصية موجودة (إنجازها، موعدها، أولويتها). لا يحذف.' + ' أداة تعديل: استدعها أولًا بلا save لتعرض المعاينة على المعلم.',
    inputSchema: {
      match_title: z.string().min(1).max(200).describe('عنوان المهمة الحالي (يجب أن يطابق مهمة واحدة)'),
      done: z.boolean().optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      ...saveFields
    }
  }, args => runWrite('update_personal_task', args, async ({ match_title, done, due_date, priority }) => {
    if(done === undefined && !due_date && !priority) fail('حدّد ما تريد تعديله: done أو due_date أو priority');
    const tasks = await fetchAll(supabase, 'tasks', 'id, title, done, due_date, priority', 'user_id', userId);
    const t = pickUnique(tasks, 'title', match_title, 'مهمة شخصية');
    const patch = {}, before = {}, after = {};
    if(done !== undefined && done !== t.done){ patch.done = done; before.done = t.done; after.done = done; }
    if(due_date && due_date !== t.due_date){ patch.due_date = due_date; before.due_date = t.due_date; after.due_date = due_date; }
    if(priority && priority !== t.priority){ patch.priority = priority; before.priority = t.priority; after.priority = priority; }
    const what = 'مهمة شخصية «' + t.title + '»';
    if(!Object.keys(patch).length) return [{ what, op: 'update', before, after, noop: true }];
    return [{ what, op: 'update', before, after,
      apply: async () => {
        const { error } = await supabase.from('tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', t.id);
        if(error) throw new Error(error.message);
      } }];
  }));
}

module.exports = { registerWriteTools, makeConfirmToken, checkConfirmToken, stableStringify, WRITE_LIMIT, MAX_ENTRIES };

/* ============================================================
   تحسين الدرجات — نشاط اختياري يرفع درجة بند الاختبارات أو المهام الأدائية
   ------------------------------------------------------------
   باتفاق مع المعلم:
   - النشاط ليس إلزاميًا: مفتوح لكل طلاب الشعبة، ويُرصد من شارك فقط. الفارغ = لم يشارك (لا يتأثر).
   - المعلم يختار نوعه: إعادة لاختبار/مهمة سابقة، أو نشاط جديد. وله درجة كاملة مستقلة (مثل 5).
   - القاعدة الأولى (add): درجة الطالب في النشاط تُضاف فوق درجة البند، بسقف الدرجة العظمى للبند —
     مثال: بند من 20 درجته 16 وأخذ 5 في النشاط ← 20 (يُضاف 4 والزائد يسقط).
   - الاختبارات بلا فترات: الزيادة على محصلة الاختبارات. المهام: المعلم يختار «على المجموع» (بعد معدّل
     الفترات) أو فترة بعينها (تُضاف لدرجة تلك الفترة بسقفها، ثم يُحسب المعدّل).
   - لا نشاط تحسين لبند لم يُنشئ فيه المعلم اختبارًا/مهمة بعد (يُمنع الإنشاء مع ذكر السبب) — 3.78.
   - من درجته في البند فارغة (غائب، لم يُرصد): تُحسب درجة التحسين وحدها، مع تنبيه في ورقة الرصد وعلامة
     «كانت فارغة» في الكشف والتقرير. الصفر درجة عادية تُضاف فوقها — 3.78.
   - النشاط لشعبة أو لعدة شعب دفعة واحدة (نشاط مستقل لكل شعبة، ورصد كل شعبة وحدها).
   - تظهر الزيادة داخل المجموع بعلامة «↑ +n»، وفي تقرير الطالب التحليلي.

   قواعد:
   - كل استعلام يحمل .eq('teacher_id', currentUser.id) صراحةً (لا اعتماد على RLS وحدها).
   - كل نص من المستخدم أو القاعدة يمرّ بـescapeHtml.
   - أزرار الحفظ/الحذف تتعطّل أثناء العملية. الحذف يمرّ بسلة المحذوفات.
   - بعد أي await: لا رسم ولا كتابة إن تغيّر النشاط/الشعبة المعروضة (improveCtx).
   - قبل تشغيل ملف تحديث القاعدة: التطبيق يعمل كأن لا أنشطة (الجدول غير موجود = قائمة فارغة).
   ============================================================ */

const IMPROVE_TARGET_LABELS = { tests: 'الاختبارات', task: 'المهام الأدائية' };
const IMPROVE_MODE_LABELS = { new: 'نشاط جديد', retake: 'إعادة' };
const IMPROVE_DEFAULT_MAX = 5;
const IMPROVE_NAME_MAX = 100;

let improveCtx = null;   /* { sectionId, term, list, counts } — الشاشة الظاهرة */
let improveDraft = null; /* نموذج الإنشاء */
let improveSheet = null; /* { id, imp, sectionId, term, values: Map } — ورقة رصد نشاط */
let improveBusy = false;

/* ============ دوال صرفة ============ */
const improveR2 = n => Math.round(Number(n) * 100) / 100;

/* درجة البند بعد الزيادة بسقفه. base فارغ (لم يُرصد: غائب مثلًا) + زيادة = الزيادة وحدها (قرار المستخدم 3.78)،
   ويُنبَّه المعلم بأن الأصل كان فارغًا. بلا زيادة: الفارغ يبقى فارغًا */
function improveAddCapped(base, bonus, cap){
  const b = Number(bonus) || 0;
  const empty = base === null || base === undefined;
  if(!(b > 0)) return empty ? null : base;
  return improveR2(Math.min(Number(cap), (empty ? 0 : Number(base)) + b));
}

/* فهرس الزيادات الخام لكل طالب: { tests, taskFinal, taskPeriods: {1,2,3}, items: [{ imp, score }] } */
function improveIndex(list, scores){
  const byId = new Map((list || []).map(i => [i.id, i]));
  const idx = new Map();
  (scores || []).forEach(r => {
    const imp = byId.get(r.improvement_id);
    if(!imp || r.score === null || r.score === undefined) return;
    const v = Number(r.score);
    if(!(v >= 0)) return;
    if(!idx.has(r.student_id)) idx.set(r.student_id, { tests: 0, taskFinal: 0, taskPeriods: {}, items: [] });
    const e = idx.get(r.student_id);
    if(imp.target === 'tests') e.tests = improveR2(e.tests + v);
    else if(imp.target === 'task'){
      const p = imp.grade_period ? Number(imp.grade_period) : null;
      if(p) e.taskPeriods[p] = improveR2((e.taskPeriods[p] || 0) + v);
      else e.taskFinal = improveR2(e.taskFinal + v);
    }
    e.items.push({ imp, score: v });
  });
  return idx;
}

/* زيادة الطالب في المهام بشكل taskPeriodScores: { periods, final } أو null */
function improveTaskOf(idx, studentId){
  const e = idx && idx.get(studentId);
  if(!e || (!e.taskFinal && !Object.keys(e.taskPeriods).length)) return null;
  return { periods: e.taskPeriods, final: e.taskFinal };
}

function improveTestsOf(idx, studentId){
  const e = idx && idx.get(studentId);
  return e ? e.tests : 0;
}

/* نص الإدخال → { error } أو { value } (رقم بمنزلتين، > 0، حتى 40) */
function parseImproveMax(text){
  const raw = String(text == null ? '' : text).trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/g, '.');
  if(!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: 'الدرجة الكاملة رقم (بمنزلتين عشريتين كحد أقصى)' };
  const v = Number(raw);
  if(!(v > 0)) return { error: 'الدرجة الكاملة أكبر من صفر' };
  if(v > 40) return { error: 'الدرجة الكاملة 40 كحد أقصى' };
  return { value: v };
}

/* ما يمكن تحسينه في كل شعبة (قرار المستخدم 3.78: لا نشاط تحسين بلا اختبار/مهمة أنشأها المعلم):
   Map(شعبة → { tests, taskCol, taskAny }). cols = أعمدة الكشف الظاهرة، tasks = مهام الفصل */
function improveAvailability(cols, tasks){
  const out = new Map();
  const at = id => { if(!out.has(id)) out.set(id, { tests: false, taskCol: false, taskAny: false }); return out.get(id); };
  (cols || []).forEach(c => {
    if(c.category === 'tests') at(c.section_id).tests = true;
    if(c.kind === 'task' && !c.tool_id) at(c.section_id).taskCol = true;
  });
  (tasks || []).forEach(t => { at(t.section_id).taskAny = true; });
  return out;
}

/* لماذا لا يمكن تحسين هذا البند في هذه الشعبة؟ نص أو null (ممكن) */
function improveBlockReason(avail, sectionId, target){
  const a = (avail && avail.get(sectionId)) || { tests: false, taskCol: false, taskAny: false };
  if(target === 'tests') return a.tests ? null : 'لا اختبارات في هذه الشعبة بعد';
  if(!a.taskCol) return 'لا عمود «مهام أدائية» في كشف هذه الشعبة';
  return a.taskAny ? null : 'لا مهام أدائية في هذه الشعبة بعد';
}

/* خطأ نصي أو null. draft = { target, mode, sourceName, name, max, period, sectionIds, avail? } */
function validateImproveDraft(d){
  if(!d || !IMPROVE_TARGET_LABELS[d.target]) return 'اختر البند';
  if(!IMPROVE_MODE_LABELS[d.mode]) return 'اختر النوع';
  if(d.mode === 'retake' && !String(d.sourceName || '').trim()) return 'اختر ما يُعاد';
  const name = String(d.name || '').trim();
  if(!name) return 'اكتب اسم النشاط';
  if(name.length > IMPROVE_NAME_MAX) return `الاسم طويل (${IMPROVE_NAME_MAX} حرفًا كحد أقصى)`;
  const m = parseImproveMax(d.max);
  if(m.error) return m.error;
  if(d.period !== null && d.period !== undefined && (d.target !== 'task' || ![1, 2, 3].includes(Number(d.period)))) return 'الفترة للمهام فقط';
  if(!(d.sectionIds || []).length) return 'اختر شعبة واحدة على الأقل';
  /* avail: null = لم يُتحقق بعد، 'error' = تعذّر التحقق، Map = ما يمكن تحسينه (undefined = بلا فحص، للاختبار الصرف) */
  if(d.avail === null) return 'انتظر حتى يكتمل التحقق من الاختبارات والمهام';
  if(d.avail === 'error') return 'تعذّر التحقق من الاختبارات والمهام — أغلق النموذج وأعد فتحه';
  if(d.avail instanceof Map){
    const blocked = d.sectionIds.find(id => improveBlockReason(d.avail, id, d.target));
    if(blocked) return 'لا يوجد ما يُحسَّن في إحدى الشعب المختارة: ' + improveBlockReason(d.avail, blocked, d.target);
  }
  return null;
}

/* صفوف الإدراج: نشاط مستقل لكل شعبة */
function improveInsertRows(d, term, uid){
  const max = parseImproveMax(d.max).value;
  return (d.sectionIds || []).map(sid => ({
    teacher_id: uid, section_id: sid, academic_year: term.year, semester: term.semester,
    target: d.target, mode: d.mode, source_name: d.mode === 'retake' ? String(d.sourceName).trim().slice(0, 200) : null,
    name: String(d.name).trim(), max_score: max, rule: 'add', grade_period: d.target === 'task' && d.period ? Number(d.period) : null
  }));
}

/* تغييرات ورقة الرصد: entries = [{ student_id, text }]، previous = Map(student → درجة) */
function planImproveScoreChanges(entries, previous, max){
  const upserts = [], deletes = [], errors = [];
  (entries || []).forEach(e => {
    const p = parseScoreInput(e.text, max);
    if(!p.ok){ errors.push({ student_id: e.student_id, error: p.error }); return; }
    const had = previous.has(e.student_id) ? Number(previous.get(e.student_id)) : null;
    if(p.value === null){ if(had !== null) deletes.push(e.student_id); return; }
    if(had === null || Math.abs(had - p.value) > 0.001) upserts.push({ student_id: e.student_id, score: p.value });
  });
  return { upserts, deletes, errors };
}

function improveTableMissing(error){
  const code = error && (error.code || '');
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST200' || code === 'PGRST202';
}

function improveDbErrorMessage(error){
  const msg = String((error && error.message) || '');
  if(improveTableMissing(error)) return 'تحسين الدرجات يحتاج تحديث قاعدة البيانات أولًا (ملف التحديثات).';
  if(msg.includes('improvement_score_above_max')) return 'درجة أكبر من الدرجة الكاملة للنشاط';
  if(msg.includes('improvement_max_below_scores')) return 'لا يمكن خفض الدرجة الكاملة تحت درجات مرصودة — عدّلها أولًا';
  if(msg.includes('grade_period_locked')) return 'الفترة مقفلة — افتحها للتعديل من نافذة الفترات';
  if(msg.includes('improvement_fixed')) return 'البند والفترة ثابتان بعد الإنشاء';
  return msg || 'خطأ غير معروف';
}

/* علامة الدرجة المحسّنة داخل المجموع. empty: الأصل كان فارغًا (لم يُرصد) فالدرجة من التحسين وحده — تنبيه بلون مختلف */
function improveMarkHtml(applied, empty){
  const n = Number(applied) || 0;
  if(empty) return ` <span class="imp-mark is-empty" title="لم تكن له درجة في هذا البند (فارغة)، فحُسبت درجة التحسين وحدها">↑ <bdi dir="ltr">+${formatScore(n)}</bdi> · كانت فارغة</span>`;
  if(!(n > 0)) return '';
  return ` <span class="imp-mark" title="منها ${formatScore(n)} من نشاط تحسين">↑ <bdi dir="ltr">+${formatScore(n)}</bdi></span>`;
}

/* علامة بند الاختبارات من نتيجة studentGradeResult */
function improveTestsMarkHtml(t){
  return t ? improveMarkHtml(t.bonus, t.fromEmpty) : '';
}

/* علامة عمود المهام لطالب في كشف محمّل */
function improveTaskMarkHtml(g, studentId){
  return improveMarkHtml(gradeImproveTaskApplied(g, studentId), gradeImproveTaskEmpty(g, studentId));
}

function improvePeriodLabel(imp){
  if(!imp || imp.target !== 'task') return '';
  return imp.grade_period ? (typeof PERIOD_NAMES !== 'undefined' ? PERIOD_NAMES[imp.grade_period] : 'الفترة ' + imp.grade_period) : 'على المجموع';
}

/* ============ التحميل ============ */
/* أنشطة الفصل ودرجات هؤلاء الطلاب فيها (ولو في شعبة سابقة لهم، كالمهام). الجدول غير موجود = لا شيء */
async function loadImprovementsForStudents(studentIds, term){
  const empty = { list: [], scores: [] };
  if(typeof currentUser === 'undefined' || !currentUser || !(studentIds || []).length) return empty;
  const uid = currentUser.id;
  const { data: list, error } = await sb.from('classroom_improvements')
    .select('id, section_id, target, mode, source_name, name, max_score, rule, grade_period, created_at')
    .eq('teacher_id', uid).eq('academic_year', term.year).eq('semester', term.semester);
  if(error){ if(improveTableMissing(error)) return empty; throw error; }
  if(!(list || []).length) return empty;
  const ids = list.map(i => i.id);
  const want = new Set(studentIds);
  let scores = [];
  for(let i = 0; i < ids.length; i += 100){
    const chunk = ids.slice(i, i + 100);
    const res = await fetchAllRows((a, b) => sb.from('classroom_improvement_scores').select('id, improvement_id, student_id, score')
      .eq('teacher_id', uid).in('improvement_id', chunk).order('id', { ascending: true }).range(a, b));
    if(res.error) throw res.error;
    scores = scores.concat((res.data || []).filter(r => want.has(r.student_id)));
  }
  return { list, scores };
}

/* زيادة الاختبارات لطالب في كشف محمّل (0 إن لا أنشطة) */
function gradeImproveTests(g, studentId){
  return g && g.improve ? improveTestsOf(g.improve.idx, studentId) : 0;
}

/* ما أُضيف فعلًا لعمود المهام (بعد السقف) */
function gradeImproveTaskApplied(g, studentId){
  const x = g && g.improve && g.improve.taskApplied ? g.improve.taskApplied.get(studentId) : null;
  return x ? x.add : 0;
}

/* هل أُضيفت زيادة المهام على درجة فارغة (لم يُرصد له شيء في المجموع أو في الفترة المختارة) */
function gradeImproveTaskEmpty(g, studentId){
  const x = g && g.improve && g.improve.taskApplied ? g.improve.taskApplied.get(studentId) : null;
  return !!(x && x.empty);
}

/* ============ الشاشة: قائمة أنشطة الشعبة ============ */
/* target (اختياري): البند المقترح لـ«＋ نشاط تحسين» حين تُفتح من ورقة الاختبار أو المهمة */
async function openGradeImprove(sectionIdArg, target){
  const sectionId = sectionIdArg || (improveCtx && improveCtx.sectionId) || (crmGrades && crmGrades.sectionId) || (crmSheet && crmSheet.sectionId);
  if(!sectionId || !currentUser) return;
  const term = crmCurrentTerm();
  const keep = improveCtx && improveCtx.sectionId === sectionId ? improveCtx.presetTarget : null;
  const ctx = { sectionId, term, list: [], counts: new Map(), presetTarget: IMPROVE_TARGET_LABELS[target] ? target : keep };
  improveCtx = ctx;
  improveSheet = null;
  const head = improveHeadHtml(sectionId, term);
  showInfoModal(`<div style="text-align:right;">${head}<div class="loading-state">جارٍ التحميل...</div></div>`, '460px');
  const uid = currentUser.id;
  try{
    const { data, error } = await sb.from('classroom_improvements')
      .select('id, section_id, target, mode, source_name, name, max_score, rule, grade_period, created_at')
      .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester)
      .order('created_at', { ascending: true });
    if(error) throw error;
    ctx.list = data || [];
    if(ctx.list.length){
      const res = await fetchAllRows((a, b) => sb.from('classroom_improvement_scores').select('id, improvement_id')
        .eq('teacher_id', uid).in('improvement_id', ctx.list.map(i => i.id)).order('id', { ascending: true }).range(a, b));
      if(res.error) throw res.error;
      (res.data || []).forEach(r => ctx.counts.set(r.improvement_id, (ctx.counts.get(r.improvement_id) || 0) + 1));
    }
  } catch(e){
    if(improveCtx !== ctx) return;
    showInfoModal(`<div style="text-align:right;">${head}<p class="tlx-note">${escapeHtml(improveTableMissing(e) ? improveDbErrorMessage(e) : 'تعذّر التحميل — أعد المحاولة')}</p></div>`, '460px');
    return;
  }
  if(improveCtx !== ctx) return; /* فُتحت شعبة أخرى أثناء التحميل */
  showInfoModal(`<div style="text-align:right;">${head}${improveListHtml(ctx)}</div>`, '460px');
}

function improveHeadHtml(sectionId, term){
  return `<h3 style="margin:0 0 2px;font-size:16px;color:var(--navy);">تحسين الدرجات</h3>
    <div class="crm-gs-sub" style="margin-bottom:8px;">${escapeHtml(crmSectionLabel(sectionId))} · ${escapeHtml(getCrmSemesterLabel())}</div>`;
}

function improveListHtml(ctx){
  const intro = `<p class="tlx-note" style="margin:0 0 10px;">نشاط اختياري لمن يريد التحسين: درجة الطالب فيه تُضاف فوق درجة البند، ولا تتجاوز الدرجة العظمى للبند. من لم يشارك لا يتأثر.</p>`;
  const add = `<button type="button" class="tlx-btn is-navy" onclick="openImproveForm({ target: '${ctx.presetTarget || ''}' })">＋ نشاط تحسين</button>`;
  if(!ctx.list.length){
    return intro + `<div class="tlx-box tlx-empty" style="padding:14px;text-align:center;margin-bottom:10px;"><b>لا أنشطة تحسين لهذه الشعبة بعد</b>
      <small style="display:block;color:var(--ui-body);margin-top:4px;">أنشئ اختبارًا أو مهمة تحسينية، ثم ارصد من شارك.</small></div>` + add;
  }
  const rows = ctx.list.map(i => {
    const n = ctx.counts.get(i.id) || 0;
    const per = improvePeriodLabel(i);
    const src = i.mode === 'retake' && i.source_name ? ` · إعادة: ${escapeHtml(i.source_name)}` : '';
    return `<button type="button" class="tlx-row" onclick="openImproveSheet('${escapeHtml(i.id)}')">
      <span class="tlx-row-main"><b>${escapeHtml(i.name)}</b><small>${escapeHtml(IMPROVE_TARGET_LABELS[i.target] || '')}${per ? ' · ' + escapeHtml(per) : ''} · من ${formatScore(i.max_score)}${src}</small></span>
      <span class="tlx-pill ${n ? 'is-ok' : 'is-gold'}">${n ? 'شارك ' + n : 'لم يُرصد'}</span><span class="tlx-chev" aria-hidden="true">‹</span></button>`;
  }).join('');
  return intro + `<div class="tlx-sec" style="margin-top:0;">الأنشطة (${ctx.list.length})</div><div class="tlx-box" style="margin-bottom:10px;">${rows}</div>` + add;
}

/* ============ الإنشاء ============ */
/* preset: { target } من اختصار ورقة الاختبار/المهمة */
async function openImproveForm(preset){
  preset = preset || {};
  const sectionId = (improveCtx && improveCtx.sectionId) || (crmGrades && crmGrades.sectionId) || (crmSheet && crmSheet.sectionId);
  if(!sectionId || !currentUser) return;
  const term = crmCurrentTerm();
  if(!improveCtx || improveCtx.sectionId !== sectionId) improveCtx = { sectionId, term, list: [], counts: new Map(), presetTarget: null };
  const testsOn = appToolOn('tests');
  const target = IMPROVE_TARGET_LABELS[preset.target] && (preset.target !== 'tests' || testsOn) ? preset.target : (testsOn ? 'tests' : 'task');
  improveDraft = { target, mode: 'new', sourceName: '', name: '', max: String(IMPROVE_DEFAULT_MAX), period: null,
    sectionIds: [sectionId], sources: { tests: [], task: [] }, saving: false, nameTouched: false, ctx: improveCtx, avail: null };
  const d = improveDraft;
  paintImproveForm();
  /* ما يمكن تحسينه في كل شعب الفصل (الإنشاء ممنوع حتى يكتمل)، وما يُعاد في هذه الشعبة */
  try{
    const uid = currentUser.id;
    const [cols, tasks] = await Promise.all([
      sb.from('classroom_grade_columns').select('id, section_id, name, category, kind, tool_id').eq('teacher_id', uid)
        .eq('academic_year', term.year).eq('semester', term.semester),
      sb.from('classroom_tasks').select('id, section_id, title').eq('teacher_id', uid)
        .eq('academic_year', term.year).eq('semester', term.semester)]);
    if(cols.error) throw cols.error;
    if(tasks.error) throw tasks.error;
    if(improveDraft !== d) return;
    const visible = (cols.data || []).filter(c => typeof gradeColumnVisible !== 'function' || gradeColumnVisible(c));
    d.avail = improveAvailability(visible, tasks.data || []);
    d.sources.tests = visible.filter(c => c.section_id === sectionId && c.category === 'tests' && !c.tool_id).map(c => c.name);
    d.sources.task = (tasks.data || []).filter(t => t.section_id === sectionId).map(t => t.title);
    /* البند المقترح غير ممكن هنا والآخر ممكن: ينتقل إليه */
    const other = d.target === 'tests' ? 'task' : 'tests';
    if(improveBlockReason(d.avail, sectionId, d.target) && (other !== 'tests' || testsOn) && !improveBlockReason(d.avail, sectionId, other)) d.target = other;
  } catch(e){
    if(improveDraft !== d) return;
    d.avail = 'error';
  }
  readImproveInputs();
  paintImproveForm();
}

function setImproveDraft(field, value){
  const d = improveDraft;
  if(!d || d.saving) return;
  if(field === 'target'){
    if(d.avail instanceof Map && improveBlockReason(d.avail, d.ctx.sectionId, value)) return;
    d.target = value; d.sourceName = ''; d.period = null;
    /* الشعب التي لا يوجد فيها هذا البند تُستبعد (الحالية تبقى) */
    if(d.avail instanceof Map) d.sectionIds = d.sectionIds.filter(id => id === d.ctx.sectionId || !improveBlockReason(d.avail, id, value));
  }
  else if(field === 'mode'){ d.mode = value; if(value === 'new') d.sourceName = ''; }
  else if(field === 'period') d.period = value ? Number(value) : null;
  else if(field === 'source'){ d.sourceName = value; if(!d.nameTouched) d.name = value ? 'تحسين: ' + value : ''; }
  paintImproveForm();
}

function toggleImproveSection(id){
  const d = improveDraft;
  if(!d || d.saving) return;
  const i = d.sectionIds.indexOf(id);
  if(i > -1){ if(d.sectionIds.length > 1) d.sectionIds.splice(i, 1); }
  else if(!(d.avail instanceof Map) || !improveBlockReason(d.avail, id, d.target)) d.sectionIds.push(id);
  paintImproveForm();
}

function readImproveInputs(){
  const d = improveDraft;
  if(!d) return;
  const n = document.getElementById('impName');
  const m = document.getElementById('impMax');
  if(n){ if(n.value !== d.name) d.nameTouched = true; d.name = n.value; }
  if(m) d.max = m.value;
}

function paintImproveForm(){
  const d = improveDraft;
  if(!d) return;
  readImproveInputs();
  const term = d.ctx.term;
  const testsOn = appToolOn('tests');
  const crumb = `<button type="button" class="tlx-crumb" style="border:0;background:none;padding:0;cursor:pointer;font-family:inherit;" onclick="openGradeImprove()">› تحسين الدرجات</button>
    <h3 style="margin:4px 0 2px;font-size:16px;color:var(--navy);">نشاط تحسين جديد</h3>`;
  /* لا إنشاء قبل التحقق، ولا نشاط تحسين بلا اختبار/مهمة أنشأها المعلم (قرار المستخدم 3.78) */
  if(d.avail === null){ showInfoModal(`<div style="text-align:right;">${crumb}<div class="loading-state">جارٍ التحقق من اختبارات الشعبة ومهامها...</div></div>`, '460px'); return; }
  if(d.avail === 'error'){ showInfoModal(`<div style="text-align:right;">${crumb}<p class="tlx-note">تعذّر التحقق من اختبارات الشعبة ومهامها — أعد المحاولة.</p>
    <button type="button" class="tlx-btn is-ghost" onclick="openImproveForm({ target: '${d.target}' })">إعادة المحاولة</button></div>`, '460px'); return; }
  const allTargets = testsOn ? ['tests', 'task'] : ['task'];
  const reasons = allTargets.map(t => [t, improveBlockReason(d.avail, d.ctx.sectionId, t)]);
  if(reasons.every(([, r]) => r)){
    showInfoModal(`<div style="text-align:right;">${crumb}
      <div class="tlx-box tlx-empty" style="padding:14px;text-align:center;margin:10px 0;"><b>لا يوجد ما يُحسَّن بعد</b>
        <small style="display:block;color:var(--ui-body);margin-top:6px;line-height:1.8;">${reasons.map(([t, r]) => `${escapeHtml(IMPROVE_TARGET_LABELS[t])}: ${escapeHtml(r)}`).join('<br>')}</small></div>
      <p class="tlx-note">التحسين يُضاف على درجة قائمة: أنشئ اختبارًا أو مهمة أدائية أولًا، ثم أنشئ نشاط التحسين عليها.</p></div>`, '460px');
    return;
  }
  const chip = (on, label, onclick, extra) => `<button type="button" class="tlx-chip${on ? ' is-on' : ''}" aria-pressed="${on}" onclick="${onclick}"${extra || ''}>${escapeHtml(label)}</button>`;
  const offChip = (label, why) => `<button type="button" class="tlx-chip" disabled title="${escapeHtml(why)}">${escapeHtml(label)}</button>`;
  const targets = reasons.map(([t, r]) => r ? offChip(IMPROVE_TARGET_LABELS[t], r) : chip(d.target === t, IMPROVE_TARGET_LABELS[t], `readImproveInputs();setImproveDraft('target','${t}')`)).join('');
  const targetWhy = reasons.filter(([, r]) => r).map(([t, r]) => `${escapeHtml(IMPROVE_TARGET_LABELS[t])}: ${escapeHtml(r)}`).join(' · ');
  const modes = ['new', 'retake'].map(m => chip(d.mode === m, m === 'new' ? 'نشاط جديد' : (d.target === 'tests' ? 'إعادة اختبار سابق' : 'إعادة مهمة سابقة'), `readImproveInputs();setImproveDraft('mode','${m}')`)).join('');
  const srcList = d.sources[d.target] || [];
  const srcHtml = d.mode === 'retake' ? `<div class="tlx-lbl">ما يُعاد</div>${srcList.length
    ? `<select class="tlx-inp" onchange="readImproveInputs();setImproveDraft('source', this.value)"><option value="">— اختر —</option>${srcList.map(s => `<option value="${escapeHtml(s)}"${s === d.sourceName ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>`
    : `<p class="tlx-note" style="margin:0;">لا ${d.target === 'tests' ? 'اختبارات' : 'مهام'} في هذه الشعبة بعد.</p>`}` : '';
  /* الفترة: للمهام بأكثر من فترة فقط؛ المقفلة لا تُختار */
  let perHtml = '';
  if(d.target === 'task'){
    const cfg = typeof periodCfg === 'function' ? periodCfg(term, 'kind:task') : { n: 1 };
    if(cfg.n > 1){
      const locked = typeof lockedPeriodsOf === 'function' ? lockedPeriodsOf(term, 'kind:task') : new Set();
      const opts = [chip(!d.period, 'على المجموع', `readImproveInputs();setImproveDraft('period','')`)];
      for(let p = 1; p <= cfg.n; p++){
        opts.push(locked.has(p) ? `<button type="button" class="tlx-chip" disabled title="مقفلة">${escapeHtml(PERIOD_NAMES[p])} (مقفلة)</button>`
          : chip(d.period === p, PERIOD_NAMES[p], `readImproveInputs();setImproveDraft('period','${p}')`));
      }
      perHtml = `<div class="tlx-lbl">تُضاف الزيادة على <small>المجموع = بعد معدّل الفترات</small></div><div class="tlx-chips">${opts.join('')}</div>`;
    }
  }
  /* الشعب: شعب السنة المعروضة (الحالية مختارة) */
  const secs = (typeof crmSections !== 'undefined' ? crmSections : []).slice()
    .sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar'));
  const secHtml = secs.length > 1 ? `<div class="tlx-lbl">الشعب <small>نشاط مستقل لكل شعبة</small></div><div class="tlx-chips">${secs.map(s =>
    improveBlockReason(d.avail, s.id, d.target) ? offChip(crmSectionOptionLabel(s) + ' — لا يوجد ما يُحسَّن', improveBlockReason(d.avail, s.id, d.target))
      : chip(d.sectionIds.includes(s.id), crmSectionOptionLabel(s), `readImproveInputs();toggleImproveSection('${escapeHtml(s.id)}')`)).join('')}</div>` : '';
  const body = `<div style="text-align:right;">
    ${crumb}
    <div class="tlx-lbl">البند الذي يُحسَّن</div><div class="tlx-chips">${targets}</div>
    ${targetWhy ? `<small style="display:block;color:var(--muted);font-size:12px;margin-top:4px;">${targetWhy}</small>` : ''}
    <div class="tlx-lbl">النوع</div><div class="tlx-chips">${modes}</div>
    ${srcHtml}
    <div class="tlx-two"><div><div class="tlx-lbl">اسم النشاط</div><input class="tlx-inp" id="impName" maxlength="${IMPROVE_NAME_MAX}" value="${escapeHtml(d.name)}" placeholder="مثال: اختبار تحسيني"></div>
      <div><div class="tlx-lbl">الدرجة الكاملة</div><input class="tlx-inp" id="impMax" inputmode="decimal" value="${escapeHtml(d.max)}"></div></div>
    ${perHtml}${secHtml}
    <p class="tlx-note" style="margin:12px 0;">درجة الطالب في النشاط تُضاف فوق درجة ${escapeHtml(IMPROVE_TARGET_LABELS[d.target])}، ولا يتجاوز المجموع الدرجة العظمى للبند. من لم يشارك لا يتأثر.</p>
    <p id="impErr" class="tlx-note" style="display:none;color:var(--ui-danger);"></p>
    <button type="button" class="tlx-btn is-navy" id="impSaveBtn" onclick="saveImproveForm()"${d.saving ? ' disabled' : ''}>${d.saving ? 'جارٍ الإنشاء...' : 'إنشاء'}</button></div>`;
  showInfoModal(body, '460px');
}

async function saveImproveForm(){
  const d = improveDraft;
  if(!d || d.saving || improveBusy) return;
  readImproveInputs();
  const err = validateImproveDraft(d);
  const errEl = document.getElementById('impErr');
  if(err){ if(errEl){ errEl.textContent = err; errEl.style.display = 'block'; } return; }
  d.saving = true; improveBusy = true;
  const btn = document.getElementById('impSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الإنشاء...'; }
  const term = d.ctx.term;
  let created = [];
  try{
    const { data, error } = await sb.from('classroom_improvements').insert(improveInsertRows(d, term, currentUser.id)).select('id, section_id');
    if(error) throw error;
    created = data || [];
  } catch(e){
    d.saving = false; improveBusy = false;
    if(improveDraft !== d) return;
    if(btn){ btn.disabled = false; btn.textContent = 'إنشاء'; }
    if(errEl){ errEl.textContent = 'تعذّر الإنشاء: ' + improveDbErrorMessage(e); errEl.style.display = 'block'; }
    return;
  }
  d.saving = false; improveBusy = false;
  improveDraft = null;
  showToast(created.length > 1 ? `أُنشئ النشاط في ${created.length} شعب ✓` : 'أُنشئ النشاط ✓', 'ok');
  const mine = created.find(r => r.section_id === d.ctx.sectionId) || created[0];
  if(mine && improveCtx === d.ctx) await openImproveSheet(mine.id);
}

/* ============ ورقة رصد نشاط ============ */
async function openImproveSheet(id){
  if(!id || !currentUser) return;
  const uid = currentUser.id;
  const sh = { id, imp: null, values: new Map(), saving: false };
  improveSheet = sh;
  showInfoModal('<div style="text-align:right;"><div class="loading-state">جارٍ التحميل...</div></div>', '460px');
  try{
    const [impRes, scRes] = await Promise.all([
      sb.from('classroom_improvements').select('*').eq('teacher_id', uid).eq('id', id).maybeSingle(),
      fetchAllRows((a, b) => sb.from('classroom_improvement_scores').select('id, student_id, score')
        .eq('teacher_id', uid).eq('improvement_id', id).order('id', { ascending: true }).range(a, b))]);
    if(impRes.error) throw impRes.error;
    if(scRes.error) throw scRes.error;
    if(improveSheet !== sh) return;
    if(!impRes.data){ showToast('النشاط محذوف', 'error'); await openGradeImprove(); return; }
    sh.imp = impRes.data;
    sh.term = { year: sh.imp.academic_year, semester: Number(sh.imp.semester) };
    (scRes.data || []).forEach(r => sh.values.set(r.student_id, Number(r.score)));
    /* من لا درجة له في البند (فارغة): تنبيه بجانب اسمه — فشل الفحص لا يمنع الرصد */
    try{ sh.empty = await improveEmptyBase(sh.imp, crmStudentsOfSection(sh.imp.section_id).map(st => st.id), sh.term); }
    catch(e){ sh.empty = null; }
    if(improveSheet !== sh) return;
  } catch(e){
    if(improveSheet !== sh) return;
    showInfoModal(`<div style="text-align:right;"><p class="tlx-note">${escapeHtml('تعذّر التحميل: ' + improveDbErrorMessage(e))}</p>
      <button type="button" class="tlx-btn is-ghost" onclick="openGradeImprove()">→ رجوع</button></div>`, '460px');
    return;
  }
  paintImproveSheet();
}

/* طلاب درجتهم في البند فارغة (لم يُرصد لهم شيء؛ الصفر ليس فارغًا): Set. للمهام بفترة: الفارغ في تلك الفترة */
async function improveEmptyBase(imp, studentIds, term){
  const out = new Set();
  if(!imp || !(studentIds || []).length) return out;
  const uid = currentUser.id;
  if(imp.target === 'tests'){
    const { data: cols, error } = await sb.from('classroom_grade_columns').select('id, category, tool_id, kind, name')
      .eq('teacher_id', uid).eq('section_id', imp.section_id).eq('academic_year', term.year).eq('semester', term.semester).eq('category', 'tests');
    if(error) throw error;
    const ids = (cols || []).filter(c => typeof gradeColumnVisible !== 'function' || gradeColumnVisible(c)).map(c => c.id);
    const has = new Set();
    if(ids.length){
      const res = await fetchAllRows((a, b) => sb.from('classroom_grade_scores').select('id, student_id')
        .eq('teacher_id', uid).in('column_id', ids).order('id', { ascending: true }).range(a, b));
      if(res.error) throw res.error;
      (res.data || []).forEach(r => has.add(r.student_id));
    }
    studentIds.forEach(id => { if(!has.has(id)) out.add(id); });
    return out;
  }
  const { tasks, rows } = await loadTaskScoresForStudents(studentIds, term);
  const cfg = periodCfg(term, 'kind:task');
  studentIds.forEach(id => {
    const ps = taskPeriodScores(tasks, rows, id, 1, cfg);
    const v = imp.grade_period ? ps['p' + imp.grade_period] : ps.final;
    if(v === null || v === undefined) out.add(id);
  });
  return out;
}

function improveEmptyNote(imp){
  const where = imp.target === 'tests' ? 'الاختبارات' : (imp.grade_period ? 'المهام في ' + improvePeriodLabel(imp) : 'المهام الأدائية');
  return `لا درجة له في ${where} (فارغة) — إن رُصد تُحسب درجة التحسين وحدها`;
}

function improveSheetLocked(sh){
  const i = sh && sh.imp;
  if(!i || i.target !== 'task' || !i.grade_period || typeof isPeriodLocked !== 'function') return false;
  return isPeriodLocked(sh.term, 'kind:task', { period: i.grade_period });
}

function paintImproveSheet(){
  const sh = improveSheet;
  if(!sh || !sh.imp) return;
  const i = sh.imp;
  const students = crmStudentsOfSection(i.section_id);
  const locked = improveSheetLocked(sh);
  const per = improvePeriodLabel(i);
  const n = students.filter(st => sh.values.has(st.id)).length;
  const rows = students.length ? students.map((st, k) => `<label class="crm-grade-entry-row">
      <span>${escapeHtml(st.full_name)}${sh.empty && sh.empty.has(st.id) ? `<small class="imp-empty-note">${escapeHtml(improveEmptyNote(i))}</small>` : ''}</span>
      <input class="goal-input crm-grade-input imp-input" inputmode="decimal" autocomplete="off" data-student="${escapeHtml(st.id)}" data-index="${k}"
        value="${sh.values.has(st.id) ? formatScore(sh.values.get(st.id)) : ''}"${locked ? ' disabled' : ''} onkeydown="onImproveInputKey(event, ${k})" oninput="this.classList.remove('is-invalid')">
    </label>`).join('') : '<div class="crm-today-empty">لا طلاب مربوطون بهذه الشعبة.</div>';
  const src = i.mode === 'retake' && i.source_name ? ` · إعادة: ${escapeHtml(i.source_name)}` : '';
  showInfoModal(`<div style="text-align:right;">
    <button type="button" class="tlx-crumb" style="border:0;background:none;padding:0;cursor:pointer;font-family:inherit;" onclick="openGradeImprove('${escapeHtml(i.section_id)}')">› تحسين الدرجات</button>
    <h3 style="margin:4px 0 2px;font-size:16px;color:var(--navy);">${escapeHtml(i.name)}</h3>
    <div class="crm-gs-sub" style="margin-bottom:8px;">${escapeHtml(crmSectionLabel(i.section_id))} · ${escapeHtml(IMPROVE_TARGET_LABELS[i.target] || '')}${per ? ' · ' + escapeHtml(per) : ''} · من ${formatScore(i.max_score)}${src} · شارك ${n}</div>
    ${locked ? '<p class="tlx-note">الفترة مقفلة — للعرض فقط. افتحها للتعديل من نافذة الفترات.</p>' : `<p class="tlx-note" style="margin:0 0 8px;">اكتب درجة من شارك فقط (من ${formatScore(i.max_score)}). اترك من لم يشارك فارغًا فلا يتأثر. تُضاف درجته فوق درجة ${escapeHtml(IMPROVE_TARGET_LABELS[i.target] || 'البند')} بحد الدرجة العظمى.</p>`}
    <div class="crm-grade-entry">${rows}</div>
    <p id="impSheetErr" class="tlx-note" style="display:none;color:var(--ui-danger);"></p>
    ${locked || !students.length ? '' : `<button type="button" class="tlx-btn is-navy" id="impSheetSave" style="margin-top:10px;" onclick="saveImproveSheet()">حفظ الدرجات</button>`}
    <div class="tlx-box" style="margin-top:12px;">
      <button type="button" class="tlx-mi" onclick="openImproveEdit()"${locked ? ' disabled' : ''}><i aria-hidden="true">✎</i><span>تعديل الاسم أو الدرجة الكاملة</span></button>
      <button type="button" class="tlx-mi is-danger" id="impDelBtn" onclick="deleteImprovement('${escapeHtml(i.id)}')"${locked ? ' disabled' : ''}><i aria-hidden="true">🗑</i><span>حذف النشاط</span></button>
    </div></div>`, '460px');
}

function onImproveInputKey(e, index){
  if(e.key !== 'Enter') return;
  e.preventDefault();
  const next = document.querySelector(`.imp-input[data-index="${index + 1}"]`);
  if(next) next.focus(); else { const b = document.getElementById('impSheetSave'); if(b) b.focus(); }
}

async function saveImproveSheet(){
  const sh = improveSheet;
  if(!sh || !sh.imp || sh.saving || improveBusy) return;
  if(improveSheetLocked(sh)) return;
  const entries = [...document.querySelectorAll('.imp-input')].map(el => ({ student_id: el.dataset.student, text: el.value, el }));
  const plan = planImproveScoreChanges(entries, sh.values, sh.imp.max_score);
  const errEl = document.getElementById('impSheetErr');
  if(plan.errors.length){
    plan.errors.forEach(x => { const e = entries.find(y => y.student_id === x.student_id); if(e && e.el) e.el.classList.add('is-invalid'); });
    if(errEl){ errEl.textContent = 'صحّح الخانات المعلَّمة: ' + plan.errors[0].error; errEl.style.display = 'block'; }
    return;
  }
  if(!plan.upserts.length && !plan.deletes.length){ showToast('لا تغيير', 'ok'); return; }
  sh.saving = true; improveBusy = true;
  const btn = document.getElementById('impSheetSave');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الحفظ...'; }
  const uid = currentUser.id, imp = sh.imp;
  let failed = null;
  try{
    if(plan.upserts.length){
      const { error } = await sb.from('classroom_improvement_scores').upsert(
        plan.upserts.map(u => ({ teacher_id: uid, improvement_id: imp.id, student_id: u.student_id, score: u.score })),
        { onConflict: 'improvement_id,student_id' });
      if(error) throw error;
      plan.upserts.forEach(u => sh.values.set(u.student_id, u.score));
    }
    if(plan.deletes.length){
      const { error } = await sb.from('classroom_improvement_scores').delete()
        .eq('teacher_id', uid).eq('improvement_id', imp.id).in('student_id', plan.deletes);
      if(error) throw error;
      plan.deletes.forEach(id => sh.values.delete(id));
    }
  } catch(e){ failed = e; }
  sh.saving = false; improveBusy = false;
  await improveAfterChange(imp.section_id, sh.term, imp.target);
  if(improveSheet !== sh) return; /* فُتح غيره أثناء الحفظ */
  if(failed){
    if(btn){ btn.disabled = false; btn.textContent = 'حفظ الدرجات'; }
    if(errEl){ errEl.textContent = 'تعذّر الحفظ: ' + improveDbErrorMessage(failed); errEl.style.display = 'block'; }
    return;
  }
  const fromEmpty = sh.empty ? plan.upserts.filter(u => sh.empty.has(u.student_id)).length : 0;
  showToast(fromEmpty ? `حُفظت ✓ — تنبيه: ${fromEmpty} ${fromEmpty === 1 ? 'طالب درجته فارغة في البند فحُسبت له' : 'طلاب درجاتهم فارغة في البند فحُسبت لهم'} درجة التحسين وحدها` : 'حُفظت درجات التحسين ✓', fromEmpty ? 'error' : 'ok');
  paintImproveSheet();
}

/* بعد أي تغيير: عمود المهام يُعاد حسابه (الزيادة داخله محفوظة)، والكشف الظاهر لنفس الشعبة يُعاد رسمه */
async function improveAfterChange(sectionId, term, target){
  if(target === 'task' && typeof syncTaskColumn === 'function'){
    try{
      const col = await findKindColumn(sectionId, term, 'task');
      if(col) await syncTaskColumn(col, sectionId, term);
    } catch(e){ /* يُعاد عند فتح الكشف */ }
  }
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  if(typeof crmGrades !== 'undefined' && crmGrades && crmGrades.sectionId === sectionId && typeof renderCrmGrades === 'function'){
    try{ await renderCrmGrades(); } catch(e){}
  }
}

/* ============ تعديل الاسم والدرجة الكاملة ============ */
function openImproveEdit(){
  const sh = improveSheet;
  if(!sh || !sh.imp || improveSheetLocked(sh)) return;
  const i = sh.imp;
  showInfoModal(`<div style="text-align:right;">
    <button type="button" class="tlx-crumb" style="border:0;background:none;padding:0;cursor:pointer;font-family:inherit;" onclick="paintImproveSheet()">› ${escapeHtml(i.name)}</button>
    <h3 style="margin:4px 0 8px;font-size:16px;color:var(--navy);">تعديل النشاط</h3>
    <div class="tlx-two"><div><div class="tlx-lbl">اسم النشاط</div><input class="tlx-inp" id="impEditName" maxlength="${IMPROVE_NAME_MAX}" value="${escapeHtml(i.name)}"></div>
      <div><div class="tlx-lbl">الدرجة الكاملة</div><input class="tlx-inp" id="impEditMax" inputmode="decimal" value="${escapeHtml(formatScore(i.max_score))}"></div></div>
    <p class="tlx-note" style="margin:10px 0;">البند والفترة والشعبة ثابتة بعد الإنشاء.</p>
    <p id="impEditErr" class="tlx-note" style="display:none;color:var(--ui-danger);"></p>
    <button type="button" class="tlx-btn is-navy" id="impEditBtn" onclick="saveImproveEdit()">حفظ</button></div>`, '460px');
}

async function saveImproveEdit(){
  const sh = improveSheet;
  if(!sh || !sh.imp || improveBusy) return;
  const name = String((document.getElementById('impEditName') || {}).value || '').trim();
  const m = parseImproveMax((document.getElementById('impEditMax') || {}).value);
  const errEl = document.getElementById('impEditErr');
  const show = t => { if(errEl){ errEl.textContent = t; errEl.style.display = 'block'; } };
  if(!name) return show('اكتب اسم النشاط');
  if(m.error) return show(m.error);
  const over = [...sh.values.values()].filter(v => v > m.value).length;
  if(over) return show(`لا يمكن خفضها إلى ${formatScore(m.value)}: ${over} ${over === 1 ? 'درجة أعلى' : 'درجات أعلى'} منها. عدّلها أولًا.`);
  improveBusy = true;
  const btn = document.getElementById('impEditBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الحفظ...'; }
  let data = null, error = null;
  try{
    ({ data, error } = await sb.from('classroom_improvements').update({ name, max_score: m.value })
      .eq('teacher_id', currentUser.id).eq('id', sh.imp.id).select('*'));
  } catch(e){ error = e; }
  finally { improveBusy = false; }
  if(improveSheet !== sh) return;
  if(error || !(data || []).length){
    if(btn){ btn.disabled = false; btn.textContent = 'حفظ'; }
    return show('تعذّر الحفظ: ' + (error ? improveDbErrorMessage(error) : 'النشاط محذوف'));
  }
  sh.imp = data[0];
  showToast('حُفظ ✓', 'ok');
  paintImproveSheet();
}

/* ============ الحذف (عبر السلة) ============ */
async function deleteImprovement(id){
  const sh = improveSheet;
  if(!id || !sh || !sh.imp || sh.imp.id !== id || improveBusy) return;
  const imp = sh.imp, term = sh.term;
  const n = sh.values.size;
  closeCrmModal();
  const ok = await showConfirm(`حذف نشاط «${imp.name}»؟ ${n ? `تُحذف معه درجات ${n} ${n === 1 ? 'طالب' : 'طلاب'} فيه، وتعود درجة البند كما كانت قبله. ` : ''}يبقى في «المحذوفات» ${TRASH_DAYS} يومًا.`);
  if(!ok){ if(improveSheet === sh) paintImproveSheet(); return; }
  await trashRunOnce('improvement:' + id, async () => {
    improveBusy = true;
    try{
      const uid = currentUser.id;
      const prot = await trashProtect(() => trashCaptureImprovement(id, uid));
      if(!prot) return;
      const { data, error } = await sb.from('classroom_improvements').delete().eq('teacher_id', uid).eq('id', id).select('id');
      if(error){ await trashDiscard(prot.id); throw error; }
      if((data || []).length) trashOfferUndo('حُذف نشاط التحسين', prot.id, async () => { await improveAfterChange(imp.section_id, term, imp.target); });
      else { await trashDiscard(prot.id); showToast('النشاط محذوف مسبقًا', 'ok'); }
    } catch(e){
      showToast('تعذّر الحذف: ' + improveDbErrorMessage(e), 'error');
      return;
    } finally {
      improveBusy = false;
    }
    if(improveSheet === sh) improveSheet = null;
    await improveAfterChange(imp.section_id, term, imp.target);
    await openGradeImprove(imp.section_id);
  });
}

/* ============ تقرير الطالب التحليلي ============ */
/* أنشطة التحسين التي شارك فيها الطالب: [{ name, target, period, score, max }] */
function improveStudentItems(g, studentId){
  const e = g && g.improve && g.improve.idx && g.improve.idx.get(studentId);
  if(!e) return [];
  return e.items.map(x => ({ name: x.imp.name, target: x.imp.target, period: improvePeriodLabel(x.imp), score: x.score, max: Number(x.imp.max_score) }));
}

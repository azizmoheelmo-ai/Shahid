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
const IMPROVE_DEFAULT_MAX = 5;
const IMPROVE_NAME_MAX = 100;
const IMPROVE_COLS = 'id, section_id, target, mode, source_name, name, max_score, rule, retake, grade_period, column_id, task_id, created_at';
/* قبل تحديث القاعدة 3.80 (لا column_id/task_id/retake): كل الأنشطة «زيادة على المجموع» كما كانت */
const IMPROVE_COLS_OLD = 'id, section_id, target, mode, source_name, name, max_score, rule, grade_period, created_at';
function improveColMissing(error){ const c = error && error.code; return c === '42703' || c === 'PGRST204'; }
/* build(cols) → استعلام؛ يعيد المحاولة بالأعمدة القديمة إن لم يُشغَّل تحديث 3.80 بعد */
async function improveSelect(build){
  const res = await build(IMPROVE_COLS);
  return res.error && improveColMissing(res.error) ? build(IMPROVE_COLS_OLD) : res;
}
const IMPROVE_RETAKE_LABELS = { replace: 'إعادة — تحلّ محلها', max: 'إعادة — الأعلى منهما' };

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

/* أنواع النشاط (3.80): retake فارغ = زيادة (على المجموع إن لم يُربط بعنصر، أو على اختبار/مهمة معيّنة)،
   replace = إعادة كاملة تحلّ محل الأصلية أيًّا كانت، max = إعادة كاملة يُعتمد الأعلى منهما */
function improveIsRetake(imp){ return !!imp && (imp.retake === 'replace' || imp.retake === 'max'); }
function improveItemId(imp){ return !imp ? null : (imp.target === 'tests' ? imp.column_id : imp.task_id) || null; }
function improveIsTotal(imp){ return !!imp && !improveIsRetake(imp) && !improveItemId(imp); }

/* درجة عنصر (اختبار/مهمة) بعد تحسيناته: الإعادات أولًا بترتيب إنشائها، ثم الزيادات بسقف العنصر.
   درجة الإعادة تُحوَّل بالنسبة إن تغيّرت الدرجة الكاملة للعنصر بعد إنشائها. base فارغ = لم يُرصد (تُحسب درجة التحسين وحدها).
   ترجع { score, orig, retake, add, empty } — retake: الطريقة المعتمدة ('replace'|'max') أو null، add: ما أضافته الزيادات فعلًا */
function improveApplyItem(base, ops, itemMax){
  const max = Number(itemMax);
  const orig = base === null || base === undefined ? null : Number(base);
  const sorted = (ops || []).slice().sort((a, b) => String(a.imp.created_at || '').localeCompare(String(b.imp.created_at || '')));
  let v = orig, retake = null, add = 0;
  sorted.filter(o => improveIsRetake(o.imp)).forEach(o => {
    const im = Number(o.imp.max_score);
    const s = im > 0 && max > 0 ? improveR2(Math.min(max, o.score / im * max)) : o.score;
    v = o.imp.retake === 'max' && v !== null ? Math.max(v, s) : s;
    retake = o.imp.retake;
  });
  sorted.filter(o => !improveIsRetake(o.imp)).forEach(o => {
    const before = v === null ? 0 : v;
    v = improveAddCapped(v, o.score, max);
    if(v !== null) add = improveR2(add + v - before);
  });
  return { score: v, orig, retake, add, empty: orig === null && v !== null };
}

/* عمليات التحسين على العناصر: Map("عنصر|طالب" → [{ imp, score }]) لأنشطة البند المربوطة بعنصر موجود في items */
function improveItemOps(list, impScores, target, itemIds){
  const imps = new Map((list || []).filter(i => i.target === target && improveItemId(i) && itemIds.has(improveItemId(i))).map(i => [i.id, i]));
  const ops = new Map();
  if(!imps.size) return ops;
  (impScores || []).forEach(r => {
    const imp = imps.get(r.improvement_id);
    if(!imp || r.score === null || r.score === undefined || !(Number(r.score) >= 0)) return;
    const k = improveItemId(imp) + '|' + r.student_id;
    if(!ops.has(k)) ops.set(k, []);
    ops.get(k).push({ imp, score: Number(r.score) });
  });
  return ops;
}

/* درجات الاختبارات الفعلية: rawScores [{ column_id, student_id, score }] بعد الإعادة والزيادة على اختبار معيّن.
   الصف المتأثر نسخة جديدة فيها imp: { orig, retake, add } للعرض؛ وغير المتأثر كما هو (لا تعديل على الخام) */
function improveEffectiveScores(columns, rawScores, list, impScores){
  const cols = new Map((columns || []).filter(c => c.category === 'tests').map(c => [c.id, c]));
  const ops = improveItemOps(list, impScores, 'tests', new Set(cols.keys()));
  if(!ops.size) return rawScores || [];
  const out = (rawScores || []).filter(s => !ops.has(s.column_id + '|' + s.student_id));
  const raw = new Map((rawScores || []).map(s => [s.column_id + '|' + s.student_id, s]));
  ops.forEach((o, k) => {
    const [cid, sid] = k.split('|');
    const r = raw.get(k);
    const res = improveApplyItem(r ? Number(r.score) : null, o, cols.get(cid).max_score);
    if(res.score === null){ if(r) out.push(r); return; }
    out.push(Object.assign({}, r || { id: null, column_id: cid, student_id: sid }, { score: res.score, imp: { orig: res.orig, retake: res.retake, add: res.add } }));
  });
  return out;
}

/* صفوف المهام الفعلية: rows [{ task_id, student_id, score }] بعد الإعادة والزيادة على مهمة معيّنة.
   طالب غير مكلَّف بالمهمة وشارك في تحسينها = خانة فارغة (تُحسب درجة التحسين وحدها) */
function improveEffectiveTaskRows(tasks, rows, list, impScores){
  const byId = new Map((tasks || []).map(t => [t.id, t]));
  const ops = improveItemOps(list, impScores, 'task', new Set(byId.keys()));
  if(!ops.size) return rows || [];
  const out = (rows || []).filter(r => !ops.has(r.task_id + '|' + r.student_id));
  const raw = new Map((rows || []).map(r => [r.task_id + '|' + r.student_id, r]));
  ops.forEach((o, k) => {
    const [tid, sid] = k.split('|');
    const r = raw.get(k);
    const base = r && r.score !== null && r.score !== undefined ? Number(r.score) : null;
    const res = improveApplyItem(base, o, byId.get(tid).max_score);
    if(res.score === null){ if(r) out.push(r); return; }
    out.push(Object.assign({}, r || { task_id: tid, student_id: sid }, { score: res.score, imp: { orig: res.orig, retake: res.retake, add: res.add } }));
  });
  return out;
}

/* فهرس الزيادات على **مجموع** البند لكل طالب: { tests, taskFinal, taskPeriods: {1,2,3}, items: [{ imp, score }] }.
   items تشمل كل أنشطته (للتقرير)، والمجاميع للزيادة بلا عنصر فقط (العنصر المعيّن يُحسب في درجته نفسها) */
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
    e.items.push({ imp, score: v });
    if(!improveIsTotal(imp)) return;
    if(imp.target === 'tests') e.tests = improveR2(e.tests + v);
    else if(imp.target === 'task'){
      const p = imp.grade_period ? Number(imp.grade_period) : null;
      if(p) e.taskPeriods[p] = improveR2((e.taskPeriods[p] || 0) + v);
      else e.taskFinal = improveR2(e.taskFinal + v);
    }
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

/* مفتاح مطابقة العنصر بين الشعب: الاسم (مطبّعًا) والدرجة الكاملة — كحذف/إضافة الاختبار لكل الشعب */
function improveItemKey(name, max){ return improveNameKey(name) + '|' + Number(max); }

/* عنصر الشعبة المطابق للمفتاح، أو null. items = [{ id, section_id, name, max }] */
function improveItemFor(items, sectionId, key){
  return (items || []).find(x => x.section_id === sectionId && improveItemKey(x.name, x.max) === key) || null;
}

/* خطأ نصي أو null. draft = { target, kind ('add'|'retake'), itemKey ('' = على المجموع), retake ('replace'|'max'),
   name, max, period, sectionIds, items: { tests: [...], task: [...] }, avail? } */
function validateImproveDraft(d){
  if(!d || !IMPROVE_TARGET_LABELS[d.target]) return 'اختر البند';
  if(d.kind !== 'add' && d.kind !== 'retake') return 'اختر النوع';
  const what = d.target === 'tests' ? 'الاختبار' : 'المهمة';
  if(d.kind === 'retake'){
    if(!d.itemKey) return 'اختر ' + what + ' الذي يُعاد';
    if(!IMPROVE_RETAKE_LABELS[d.retake]) return 'اختر طريقة احتساب الإعادة';
  }
  const name = String(d.name || '').trim();
  if(!name) return 'اكتب اسم النشاط';
  if(name.length > IMPROVE_NAME_MAX) return `الاسم طويل (${IMPROVE_NAME_MAX} حرفًا كحد أقصى)`;
  if(d.kind === 'add'){ const m = parseImproveMax(d.max); if(m.error) return m.error; }
  if(d.period !== null && d.period !== undefined){
    if(d.target !== 'task' || ![1, 2, 3].includes(Number(d.period))) return 'الفترة للمهام فقط';
    if(d.kind !== 'add' || d.itemKey) return 'الفترة للزيادة على مجموع المهام فقط';
  }
  if(!(d.sectionIds || []).length) return 'اختر شعبة واحدة على الأقل';
  /* avail: null = لم يُتحقق بعد، 'error' = تعذّر التحقق، Map = ما يمكن تحسينه (undefined = بلا فحص، للاختبار الصرف) */
  if(d.avail === null) return 'انتظر حتى يكتمل التحقق من الاختبارات والمهام';
  if(d.avail === 'error') return 'تعذّر التحقق من الاختبارات والمهام — أغلق النموذج وأعد فتحه';
  if(d.avail instanceof Map){
    const blocked = d.sectionIds.find(id => improveBlockReason(d.avail, id, d.target));
    if(blocked) return 'لا يوجد ما يُحسَّن في إحدى الشعب المختارة: ' + improveBlockReason(d.avail, blocked, d.target);
  }
  if(d.itemKey && d.items){
    const list = d.items[d.target] || [];
    const missing = d.sectionIds.find(id => !improveItemFor(list, id, d.itemKey));
    if(missing) return `${what} المختار غير موجود (بالاسم والدرجة نفسيهما) في إحدى الشعب المختارة`;
  }
  return null;
}

/* صفوف الإدراج: نشاط مستقل لكل شعبة، مربوط بعنصر شعبته نفسها */
function improveInsertRows(d, term, uid){
  const retake = d.kind === 'retake';
  const list = (d.items && d.items[d.target]) || [];
  return (d.sectionIds || []).map(sid => {
    const item = d.itemKey ? improveItemFor(list, sid, d.itemKey) : null;
    return {
      teacher_id: uid, section_id: sid, academic_year: term.year, semester: term.semester,
      target: d.target, mode: retake ? 'retake' : 'new', rule: 'add', retake: retake ? d.retake : null,
      column_id: d.target === 'tests' && item ? item.id : null, task_id: d.target === 'task' && item ? item.id : null,
      source_name: item ? String(item.name).slice(0, 200) : null,
      name: String(d.name).trim(), max_score: retake && item ? Number(item.max) : parseImproveMax(d.max).value,
      grade_period: d.target === 'task' && !retake && !item && d.period ? Number(d.period) : null
    };
  });
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
  if(improveTableMissing(error) || improveColMissing(error)) return 'تحسين الدرجات يحتاج تحديث قاعدة البيانات أولًا (ملف التحديثات).';
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
  if(n < 0) return ` <span class="imp-mark is-down" title="إعادة «تحلّ محلها» أقل من الأصلية">↓ <bdi dir="ltr">${formatScore(n)}</bdi></span>`;
  if(!(n > 0)) return '';
  return ` <span class="imp-mark" title="منها ${formatScore(n)} من نشاط تحسين">↑ <bdi dir="ltr">+${formatScore(n)}</bdi></span>`;
}

/* علامة خانة اختبار/مهمة عليها تحسين (imp من improveEffectiveScores): «إعادة، كانت 12» و/أو «↑ +n» */
function improveCellNoteHtml(imp){
  if(!imp) return '';
  let h = '';
  if(imp.retake) h += `<small class="imp-was">إعادة، كانت ${imp.orig === null || imp.orig === undefined ? 'فارغة' : formatScore(imp.orig)}</small>`;
  if(imp.add) h += improveMarkHtml(imp.add, !imp.retake && (imp.orig === null || imp.orig === undefined));
  return h;
}

/* علامة بند الاختبارات من نتيجة studentGradeResult */
function improveTestsMarkHtml(t){
  return t ? improveMarkHtml(t.bonus, t.fromEmpty) : '';
}

/* علامة عمود المهام لطالب في كشف محمّل */
function improveTaskMarkHtml(g, studentId){
  return improveMarkHtml(gradeImproveTaskApplied(g, studentId), gradeImproveTaskEmpty(g, studentId));
}

/* وصف نوع النشاط للمعلم: «زيادة على المجموع»، «زيادة على «اختبار 1»»، «إعادة «اختبار 1» — الأعلى منهما» */
function improveTypeLabel(imp){
  if(!imp) return '';
  const item = imp.source_name ? '«' + imp.source_name + '»' : (imp.target === 'tests' ? 'اختبار محذوف' : 'مهمة محذوفة');
  if(improveIsRetake(imp)) return 'إعادة ' + item + ' — ' + (imp.retake === 'max' ? 'الأعلى منهما' : 'تحلّ محلها');
  if(improveItemId(imp)) return 'زيادة على ' + item;
  const per = improvePeriodLabel(imp);
  return 'زيادة على مجموع ' + (IMPROVE_TARGET_LABELS[imp.target] || '') + (per && imp.grade_period ? ' · ' + per : '');
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
  const { data: list, error } = await improveSelect(cols => sb.from('classroom_improvements').select(cols)
    .eq('teacher_id', uid).eq('academic_year', term.year).eq('semester', term.semester));
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
    const { data, error } = await improveSelect(cols => sb.from('classroom_improvements').select(cols)
      .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester)
      .order('created_at', { ascending: true }));
    if(error) throw error;
    ctx.list = data || [];
    if(ctx.list.length){
      const res = await fetchAllRows((a, b) => sb.from('classroom_improvement_scores').select('id, improvement_id')
        .eq('teacher_id', uid).in('improvement_id', ctx.list.map(i => i.id)).order('id', { ascending: true }).range(a, b));
      if(res.error) throw res.error;
      (res.data || []).forEach(r => ctx.counts.set(r.improvement_id, (ctx.counts.get(r.improvement_id) || 0) + 1));
      ctx.avail = await improveSectionAvail(sectionId, term);
    }
  } catch(e){
    if(improveCtx !== ctx) return;
    showInfoModal(`<div style="text-align:right;">${head}<p class="tlx-note">${escapeHtml(improveTableMissing(e) ? improveDbErrorMessage(e) : 'تعذّر التحميل — أعد المحاولة')}</p></div>`, '460px');
    return;
  }
  if(improveCtx !== ctx) return; /* فُتحت شعبة أخرى أثناء التحميل */
  showInfoModal(`<div style="text-align:right;">${head}${improveListHtml(ctx)}</div>`, '460px');
}

/* ما يمكن تحسينه في شعبة واحدة (لشارة «متوقف مؤقتًا»). فشل الفحص = null (بلا شارة) */
async function improveSectionAvail(sectionId, term){
  try{
    const uid = currentUser.id;
    const [cols, tasks] = await Promise.all([
      sb.from('classroom_grade_columns').select('id, section_id, category, kind, tool_id').eq('teacher_id', uid).eq('section_id', sectionId)
        .eq('academic_year', term.year).eq('semester', term.semester),
      sb.from('classroom_tasks').select('id, section_id').eq('teacher_id', uid).eq('section_id', sectionId)
        .eq('academic_year', term.year).eq('semester', term.semester)]);
    if(cols.error || tasks.error) return null;
    return improveAvailability((cols.data || []).filter(c => typeof gradeColumnVisible !== 'function' || gradeColumnVisible(c)), tasks.data || []);
  } catch(e){ return null; }
}

/* سبب توقف النشاط مؤقتًا (لا اختبار/مهمة/عمود مهام في شعبته)، أو null */
function improveSuspendReason(avail, imp){
  if(improveIsRetake(imp) && !improveItemId(imp)) return imp.target === 'tests' ? 'الاختبار المُعاد محذوف' : 'المهمة المُعادة محذوفة';
  if(!(avail instanceof Map) || !imp) return null;
  return improveBlockReason(avail, imp.section_id, imp.target);
}

function improveHeadHtml(sectionId, term){
  return `<h3 style="margin:0 0 2px;font-size:16px;color:var(--navy);">تحسين الدرجات</h3>
    <div class="crm-gs-sub" style="margin-bottom:8px;">${escapeHtml(crmSectionLabel(sectionId))} · ${escapeHtml(getCrmSemesterLabel())}</div>`;
}

function improveListHtml(ctx){
  const intro = `<p class="tlx-note" style="margin:0 0 10px;">نشاط اختياري لمن يريد التحسين: زيادة تُضاف فوق الدرجة، أو إعادة اختبار/مهمة بالكامل. من لم يشارك لا يتأثر.</p>`;
  const add = `<button type="button" class="tlx-btn is-navy" onclick="openImproveForm({ target: '${ctx.presetTarget || ''}' })">＋ نشاط تحسين</button>`;
  if(!ctx.list.length){
    return intro + `<div class="tlx-box tlx-empty" style="padding:14px;text-align:center;margin-bottom:10px;"><b>لا أنشطة تحسين لهذه الشعبة بعد</b>
      <small style="display:block;color:var(--ui-body);margin-top:4px;">أنشئ اختبارًا أو مهمة تحسينية، ثم ارصد من شارك.</small></div>` + add;
  }
  const rows = ctx.list.map(i => {
    const n = ctx.counts.get(i.id) || 0;
    const off = improveSuspendReason(ctx.avail, i);
    return `<button type="button" class="tlx-row" onclick="openImproveSheet('${escapeHtml(i.id)}')">
      <span class="tlx-row-main"><b>${escapeHtml(i.name)}</b><small>${escapeHtml(improveTypeLabel(i))} · من ${formatScore(i.max_score)}${off ? ' · ' + escapeHtml(off) : ''}</small></span>
      ${off ? '<span class="tlx-pill is-gold">متوقف مؤقتًا</span>' : `<span class="tlx-pill ${n ? 'is-ok' : 'is-gold'}">${n ? 'شارك ' + n : 'لم يُرصد'}</span>`}<span class="tlx-chev" aria-hidden="true">‹</span></button>`;
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
  improveDraft = { target, kind: 'add', itemKey: '', retake: 'max', name: '', max: String(IMPROVE_DEFAULT_MAX), period: null,
    sectionIds: [sectionId], items: { tests: [], task: [] }, saving: false, nameTouched: false, ctx: improveCtx, avail: null };
  const d = improveDraft;
  paintImproveForm();
  /* ما يمكن تحسينه في كل شعب الفصل (الإنشاء ممنوع حتى يكتمل)، واختبارات/مهام كل شعبة للربط */
  try{
    const uid = currentUser.id;
    const [cols, tasks] = await Promise.all([
      sb.from('classroom_grade_columns').select('id, section_id, name, category, kind, tool_id, max_score').eq('teacher_id', uid)
        .eq('academic_year', term.year).eq('semester', term.semester),
      sb.from('classroom_tasks').select('id, section_id, title, max_score').eq('teacher_id', uid)
        .eq('academic_year', term.year).eq('semester', term.semester)]);
    if(cols.error) throw cols.error;
    if(tasks.error) throw tasks.error;
    if(improveDraft !== d) return;
    const visible = (cols.data || []).filter(c => typeof gradeColumnVisible !== 'function' || gradeColumnVisible(c));
    d.avail = improveAvailability(visible, tasks.data || []);
    d.items.tests = visible.filter(c => c.category === 'tests').map(c => ({ id: c.id, section_id: c.section_id, name: c.name, max: Number(c.max_score) }));
    d.items.task = (tasks.data || []).map(t => ({ id: t.id, section_id: t.section_id, name: t.title, max: Number(t.max_score) }));
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

/* الاسم المقترح ما لم يكتب المعلم اسمًا بنفسه */
function improveSuggestName(d){
  if(d.nameTouched) return;
  const item = d.itemKey ? improveItemFor(d.items[d.target], d.ctx.sectionId, d.itemKey) : null;
  d.name = d.kind === 'retake' ? (item ? 'إعادة: ' + item.name : '') : (item ? 'زيادة: ' + item.name : '');
}

/* الشعب المختارة التي لا يوجد فيها البند أو العنصر المختار تُستبعد (الحالية تبقى) */
function improveKeepValidSections(d){
  d.sectionIds = d.sectionIds.filter(id => id === d.ctx.sectionId || !improveSectionBlock(d, id));
}

/* لماذا لا تُختار هذه الشعبة للنشاط الحالي؟ نص أو null */
function improveSectionBlock(d, sectionId){
  const r = d.avail instanceof Map ? improveBlockReason(d.avail, sectionId, d.target) : null;
  if(r) return r;
  if(d.itemKey && !improveItemFor(d.items[d.target], sectionId, d.itemKey)) return `لا يوجد «${(improveItemFor(d.items[d.target], d.ctx.sectionId, d.itemKey) || {}).name || ''}» بالدرجة نفسها في هذه الشعبة`;
  return null;
}

function setImproveDraft(field, value){
  const d = improveDraft;
  if(!d || d.saving) return;
  if(field === 'target'){
    if(d.avail instanceof Map && improveBlockReason(d.avail, d.ctx.sectionId, value)) return;
    d.target = value; d.itemKey = ''; d.period = null;
  }
  else if(field === 'kind'){ d.kind = value === 'retake' ? 'retake' : 'add'; if(d.kind === 'retake') d.period = null; }
  else if(field === 'item'){ d.itemKey = value || ''; if(d.itemKey) d.period = null; }
  else if(field === 'retake'){ if(IMPROVE_RETAKE_LABELS[value]) d.retake = value; }
  else if(field === 'period') d.period = value ? Number(value) : null;
  improveKeepValidSections(d);
  improveSuggestName(d);
  paintImproveForm();
}

function toggleImproveSection(id){
  const d = improveDraft;
  if(!d || d.saving) return;
  const i = d.sectionIds.indexOf(id);
  if(i > -1){ if(d.sectionIds.length > 1) d.sectionIds.splice(i, 1); }
  else if(!improveSectionBlock(d, id)) d.sectionIds.push(id);
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
  const isTests = d.target === 'tests';
  const what = isTests ? 'الاختبار' : 'المهمة';
  const kinds = chip(d.kind === 'add', 'زيادة', `readImproveInputs();setImproveDraft('kind','add')`)
    + chip(d.kind === 'retake', isTests ? 'إعادة اختبار بالكامل' : 'إعادة مهمة بالكامل', `readImproveInputs();setImproveDraft('kind','retake')`);
  const kindNote = d.kind === 'add'
    ? 'نشاط بدرجة مستقلة تُضاف فوق الدرجة، ولا تتجاوز الدرجة العظمى.'
    : `يُعاد ${what} بدرجته الكاملة نفسها، وتُقارن الدرجة الجديدة بالقديمة.`;
  /* العنصر: اختبارات/مهام الشعبة الحالية (الاسم والدرجة الكاملة) */
  const mine = (d.items[d.target] || []).filter(x => x.section_id === d.ctx.sectionId);
  const opt = x => { const k = improveItemKey(x.name, x.max); return `<option value="${escapeHtml(k)}"${k === d.itemKey ? ' selected' : ''}>${escapeHtml(x.name)} · من ${formatScore(x.max)}</option>`; };
  const itemSelect = `<select class="tlx-inp" onchange="readImproveInputs();setImproveDraft('item', this.value)">${d.kind === 'add' ? `<option value=""${!d.itemKey ? ' selected' : ''}>مجموع ${escapeHtml(IMPROVE_TARGET_LABELS[d.target])}</option>` : `<option value=""${!d.itemKey ? ' selected' : ''}>— اختر ${what} —</option>`}${mine.map(opt).join('')}</select>`;
  const whereHtml = d.kind === 'add'
    ? `<div class="tlx-lbl">تُضاف الزيادة على</div>${itemSelect}`
    : `<div class="tlx-lbl">${what} الذي يُعاد</div>${itemSelect}
       <div class="tlx-lbl">تُحتسب درجة الإعادة</div><div class="tlx-chips">${chip(d.retake === 'max', 'الأعلى منهما', `readImproveInputs();setImproveDraft('retake','max')`)}${chip(d.retake === 'replace', 'تحلّ محل القديمة', `readImproveInputs();setImproveDraft('retake','replace')`)}</div>
       ${d.retake === 'replace' ? `<p class="tlx-note" style="margin:6px 0 0;color:var(--ui-warn);">تحلّ محل القديمة أيًّا كانت: إن كانت الإعادة أقل تنزل درجة الطالب.</p>` : `<small style="display:block;color:var(--muted);font-size:12px;margin-top:4px;">يُعتمد الأعلى، فلا تنزل درجة أحد.</small>`}`;
  const item = d.itemKey ? improveItemFor(d.items[d.target], d.ctx.sectionId, d.itemKey) : null;
  const maxHtml = d.kind === 'add'
    ? `<div><div class="tlx-lbl">الدرجة الكاملة</div><input class="tlx-inp" id="impMax" inputmode="decimal" value="${escapeHtml(d.max)}"></div>`
    : `<div><div class="tlx-lbl">الدرجة الكاملة</div><div class="tlx-inp" style="background:var(--ui-track);color:var(--ui-body);">${item ? 'من ' + formatScore(item.max) + ' (كالأصل)' : '—'}</div></div>`;
  /* الفترة: لزيادة على مجموع المهام بأكثر من فترة فقط؛ المقفلة لا تُختار */
  let perHtml = '';
  if(d.target === 'task' && d.kind === 'add' && !d.itemKey){
    const cfg = typeof periodCfg === 'function' ? periodCfg(term, 'kind:task') : { n: 1 };
    if(cfg.n > 1){
      const locked = typeof lockedPeriodsOf === 'function' ? lockedPeriodsOf(term, 'kind:task') : new Set();
      const opts = [chip(!d.period, 'على المجموع', `readImproveInputs();setImproveDraft('period','')`)];
      for(let p = 1; p <= cfg.n; p++){
        opts.push(locked.has(p) ? `<button type="button" class="tlx-chip" disabled title="مقفلة">${escapeHtml(PERIOD_NAMES[p])} (مقفلة)</button>`
          : chip(d.period === p, PERIOD_NAMES[p], `readImproveInputs();setImproveDraft('period','${p}')`));
      }
      perHtml = `<div class="tlx-lbl">على المجموع أم فترة <small>المجموع = بعد معدّل الفترات</small></div><div class="tlx-chips">${opts.join('')}</div>`;
    }
  }
  /* الشعب: شعب السنة المعروضة (الحالية مختارة)؛ الممنوعة معطّلة بسببها */
  const secs = (typeof crmSections !== 'undefined' ? crmSections : []).slice()
    .sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar'));
  const secHtml = secs.length > 1 ? `<div class="tlx-lbl">الشعب <small>نشاط مستقل لكل شعبة</small></div><div class="tlx-chips">${secs.map(s => {
    const why = s.id === d.ctx.sectionId ? null : improveSectionBlock(d, s.id);
    return why ? offChip(crmSectionOptionLabel(s) + ' — لا يوجد ما يُحسَّن', why)
      : chip(d.sectionIds.includes(s.id), crmSectionOptionLabel(s), `readImproveInputs();toggleImproveSection('${escapeHtml(s.id)}')`);
  }).join('')}</div>` : '';
  const body = `<div style="text-align:right;">
    ${crumb}
    <div class="tlx-lbl">البند الذي يُحسَّن</div><div class="tlx-chips">${targets}</div>
    ${targetWhy ? `<small style="display:block;color:var(--muted);font-size:12px;margin-top:4px;">${targetWhy}</small>` : ''}
    <div class="tlx-lbl">النوع</div><div class="tlx-chips">${kinds}</div>
    <small style="display:block;color:var(--muted);font-size:12px;margin-top:4px;">${kindNote}</small>
    ${whereHtml}
    <div class="tlx-two"><div><div class="tlx-lbl">اسم النشاط</div><input class="tlx-inp" id="impName" maxlength="${IMPROVE_NAME_MAX}" value="${escapeHtml(d.name)}" placeholder="مثال: اختبار تحسيني"></div>
      ${maxHtml}</div>
    ${perHtml}${secHtml}
    <p class="tlx-note" style="margin:12px 0;">من لم يشارك لا يتأثر، ومن كانت خانته فارغة تُحسب له درجة التحسين وحدها.</p>
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
    /* الدرجة الأصلية بجانب كل طالب (عنصر معيّن)، أو تنبيه من درجته في البند فارغة — فشل الفحص لا يمنع الرصد */
    const ids = crmStudentsOfSection(sh.imp.section_id).map(st => st.id);
    try{
      if(improveItemId(sh.imp)){
        sh.orig = await improveItemOriginals(sh.imp, ids);
        sh.empty = new Set(ids.filter(id => !sh.orig.has(id)));
      } else sh.empty = await improveEmptyBase(sh.imp, ids, sh.term);
    } catch(e){ sh.empty = null; sh.orig = null; }
    sh.avail = await improveSectionAvail(sh.imp.section_id, sh.term);
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

/* الدرجة الأصلية لكل طالب في العنصر المعيّن (كما رُصدت): Map(طالب → درجة)؛ الغائب عنه ليس فيها */
async function improveItemOriginals(imp, studentIds){
  const uid = currentUser.id;
  const want = new Set(studentIds || []);
  const out = new Map();
  const res = imp.target === 'tests'
    ? await fetchAllRows((a, b) => sb.from('classroom_grade_scores').select('id, student_id, score').eq('teacher_id', uid).eq('column_id', imp.column_id).order('id', { ascending: true }).range(a, b))
    : await fetchAllRows((a, b) => sb.from('classroom_task_students').select('id, student_id, score').eq('teacher_id', uid).eq('task_id', imp.task_id).order('id', { ascending: true }).range(a, b));
  if(res.error) throw res.error;
  (res.data || []).forEach(r => { if(want.has(r.student_id) && r.score !== null && r.score !== undefined) out.set(r.student_id, Number(r.score)); });
  return out;
}

function improveEmptyNote(imp){
  if(improveItemId(imp)) return `لا درجة له في «${imp.source_name || ''}» (فارغة) — إن رُصد تُحسب درجة ${improveIsRetake(imp) ? 'الإعادة' : 'التحسين'} وحدها`;
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
  const n = students.filter(st => sh.values.has(st.id)).length;
  const off = improveSuspendReason(sh.avail, i);
  const note = st => sh.orig && sh.orig.has(st.id) ? `<small class="imp-orig">الأصلية: ${formatScore(sh.orig.get(st.id))}</small>`
    : sh.empty && !off && sh.empty.has(st.id) ? `<small class="imp-empty-note">${escapeHtml(improveEmptyNote(i))}</small>` : '';
  const rows = students.length ? students.map((st, k) => `<label class="crm-grade-entry-row">
      <span>${escapeHtml(st.full_name)}${note(st)}</span>
      <input class="goal-input crm-grade-input imp-input" inputmode="decimal" autocomplete="off" data-student="${escapeHtml(st.id)}" data-index="${k}"
        value="${sh.values.has(st.id) ? formatScore(sh.values.get(st.id)) : ''}"${locked ? ' disabled' : ''} onkeydown="onImproveInputKey(event, ${k})" oninput="this.classList.remove('is-invalid')">
    </label>`).join('') : '<div class="crm-today-empty">لا طلاب مربوطون بهذه الشعبة.</div>';
  const how = improveIsRetake(i)
    ? (i.retake === 'max' ? 'يُعتمد الأعلى من الأصلية والإعادة، فلا تنزل درجة أحد.' : 'درجة الإعادة تحلّ محل الأصلية أيًّا كانت — إن كانت أقل تنزل درجته.')
    : improveItemId(i) ? `تُضاف درجته فوق درجته في «${i.source_name || ''}» بحد درجته الكاملة.`
    : `تُضاف درجته فوق درجة ${IMPROVE_TARGET_LABELS[i.target] || 'البند'} بحد الدرجة العظمى.`;
  showInfoModal(`<div style="text-align:right;">
    <button type="button" class="tlx-crumb" style="border:0;background:none;padding:0;cursor:pointer;font-family:inherit;" onclick="openGradeImprove('${escapeHtml(i.section_id)}')">› تحسين الدرجات</button>
    <h3 style="margin:4px 0 2px;font-size:16px;color:var(--navy);">${escapeHtml(i.name)}</h3>
    <div class="crm-gs-sub" style="margin-bottom:8px;">${escapeHtml(crmSectionLabel(i.section_id))} · ${escapeHtml(improveTypeLabel(i))} · من ${formatScore(i.max_score)} · شارك ${n}</div>
    ${off ? `<p class="tlx-note" style="margin:0 0 8px;color:var(--ui-warn);"><b>متوقف مؤقتًا:</b> ${escapeHtml(off)}. الدرجات هنا محفوظة ولا تُحسب${improveIsRetake(i) ? '' : ` حتى ${i.target === 'tests' ? 'تضيف اختبارًا' : 'تضيف مهمة أدائية'}`}.</p>` : ''}
    ${locked ? '<p class="tlx-note">الفترة مقفلة — للعرض فقط. افتحها للتعديل من نافذة الفترات.</p>' : `<p class="tlx-note" style="margin:0 0 8px;">اكتب درجة من شارك فقط (من ${formatScore(i.max_score)})، واترك من لم يشارك فارغًا فلا يتأثر. ${escapeHtml(how)}</p>`}
    <div class="crm-grade-entry">${rows}</div>
    <p id="impSheetErr" class="tlx-note" style="display:none;color:var(--ui-danger);"></p>
    ${locked || !students.length ? '' : `<button type="button" class="tlx-btn is-navy" id="impSheetSave" style="margin-top:10px;" onclick="saveImproveSheet()">حفظ الدرجات</button>`}
    <div class="tlx-box" style="margin-top:12px;">
      <button type="button" class="tlx-mi" onclick="openImproveEdit()"${locked ? ' disabled' : ''}><i aria-hidden="true">✎</i><span>${improveIsRetake(i) ? 'تعديل الاسم' : 'تعديل الاسم أو الدرجة الكاملة'}</span></button>
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
      ${improveIsRetake(i) ? '' : `<div><div class="tlx-lbl">الدرجة الكاملة</div><input class="tlx-inp" id="impEditMax" inputmode="decimal" value="${escapeHtml(formatScore(i.max_score))}"></div>`}</div>
    <p class="tlx-note" style="margin:10px 0;">البند والنوع والشعبة ثابتة بعد الإنشاء${improveIsRetake(i) ? '، ودرجة الإعادة الكاملة كدرجة الأصل' : ''}.</p>
    <p id="impEditErr" class="tlx-note" style="display:none;color:var(--ui-danger);"></p>
    <button type="button" class="tlx-btn is-navy" id="impEditBtn" onclick="saveImproveEdit()">حفظ</button></div>`, '460px');
}

async function saveImproveEdit(){
  const sh = improveSheet;
  if(!sh || !sh.imp || improveBusy) return;
  const name = String((document.getElementById('impEditName') || {}).value || '').trim();
  /* الإعادة: درجتها الكاملة كالأصل (لا تُعدَّل) */
  const m = improveIsRetake(sh.imp) ? { value: Number(sh.imp.max_score) } : parseImproveMax((document.getElementById('impEditMax') || {}).value);
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

/* ============ حذف اختبار/مهمة عليها تحسين (3.79، قرار المستخدم) ============ */
/* - حذف اختبار/مهمة هو مصدر نشاط «إعادة»: يختار المعلم — احذفهما معًا (عبر السلة، والتراجع يعيدهما)،
     أو احذف الاختبار وأبقِ التحسين على البند عامة (يصير «نشاط جديد»).
   - حذف آخر اختبار/مهمة في الشعبة: التحسين يتوقف مؤقتًا (محفوظ، لا يُحسب حتى يُضاف غيره) — تنبيه في التأكيد.
   - غير ذلك: لا تنبيه (الزيادة تُعاد على المحصلة الجديدة تلقائيًا). */

function improveNameKey(t){ return String(t || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

/* أنشطة البند في شعبة واحدة مصنّفة لحذف عناصر (deletedIds): { linked: المربوطة بها بالمعرّف، others، isLast } (دالة صرفة) */
function improveDeleteLinks(list, target, deletedIds, remainingCount){
  const gone = deletedIds instanceof Set ? deletedIds : new Set([].concat(deletedIds || []));
  const mine = (list || []).filter(i => i.target === target);
  const linked = mine.filter(i => improveItemId(i) && gone.has(improveItemId(i)));
  return { linked, others: mine.filter(i => !linked.includes(i)), isLast: remainingCount === 0 };
}

/* target: 'tests' (أعمدة) أو 'task' (مهام)؛ itemIds: عنصر أو أكثر (حذف اختبار من كل الشعب). يقرأ العناصر وما بقي
   وأنشطة شعبها من القاعدة (teacher_id صريح). يرجع { linked, suspend, lastFor } — linked: المربوطة بالعناصر المحذوفة،
   suspend: أنشطة على المجموع في شعب لا يبقى فيها شيء. null = لا أنشطة أو تعذّر الفحص (الحذف يسير كما كان) */
async function improveLinksForDelete(target, itemIds){
  const ids = [].concat(itemIds || []).filter(Boolean);
  if(!currentUser || !ids.length) return null;
  const uid = currentUser.id;
  const tbl = target === 'tests' ? 'classroom_grade_columns' : 'classroom_tasks';
  try{
    const { data: items, error } = await sb.from(tbl).select('id, section_id, academic_year, semester').eq('teacher_id', uid).in('id', ids);
    if(error || !(items || []).length) return null;
    const term = { year: items[0].academic_year, semester: Number(items[0].semester) };
    const secs = [...new Set(items.map(i => i.section_id))];
    const { data: list, error: lErr } = await improveSelect(cols => sb.from('classroom_improvements').select(cols)
      .eq('teacher_id', uid).eq('academic_year', term.year).eq('semester', term.semester).eq('target', target).in('section_id', secs));
    if(lErr || !(list || []).length) return null;
    let q = sb.from(tbl).select('id, section_id' + (target === 'tests' ? ', category, tool_id, kind' : '')).eq('teacher_id', uid)
      .eq('academic_year', term.year).eq('semester', term.semester).in('section_id', secs);
    if(target === 'tests') q = q.eq('category', 'tests');
    const { data: rest, error: rErr } = await q;
    if(rErr) return null;
    const gone = new Set(ids);
    const out = { linked: [], suspend: [], lastFor: new Set() };
    secs.forEach(sid => {
      const remaining = (rest || []).filter(r => r.section_id === sid && !gone.has(r.id) && (target !== 'tests' || typeof gradeColumnVisible !== 'function' || gradeColumnVisible(r))).length;
      const l = improveDeleteLinks(list.filter(i => i.section_id === sid), target, gone, remaining);
      out.linked = out.linked.concat(l.linked);
      if(l.isLast){ out.suspend = out.suspend.concat(l.others.filter(i => !improveIsRetake(i))); out.lastFor.add(sid); }
    });
    return out.linked.length || out.suspend.length ? out : null;
  } catch(e){ return null; }
}

function improveSuspendText(target, list){
  const what = target === 'tests' ? 'اختبارًا' : 'مهمة أدائية';
  const names = list.map(i => '«' + i.name + '»').join('، ');
  return `لا ${target === 'tests' ? 'اختبار' : 'مهمة'} يبقى في الشعبة بعد الحذف، فنشاط التحسين ${names} سيتوقف مؤقتًا: درجات الطلاب فيه محفوظة، ولا تُحسب حتى تضيف ${what} جديدًا.`;
}

/* نافذة اختيار بأزرار: ترجع مفتاح الزر أو null (إغلاق) */
let improveChoiceResolver = null;
function improveAskChoice(bodyHtml, choices){
  return new Promise(resolve => {
    if(improveChoiceResolver) improveChoiceResolver(null);
    improveChoiceResolver = resolve;
    showInfoModal(`<div style="text-align:right;">${bodyHtml}${choices.map(c =>
      `<button type="button" class="tlx-btn ${c.cls || 'is-ghost'}" style="margin-top:8px;" onclick="improveChoiceResolve('${c.key}')">${escapeHtml(c.label)}</button>`).join('')}</div>`, '440px');
    const cancel = document.getElementById('confirmCancelBtn');
    if(cancel && cancel.addEventListener){
      const h = () => { cancel.removeEventListener('click', h); if(improveChoiceResolver === resolve) improveChoiceResolve(null); };
      cancel.addEventListener('click', h);
    }
  });
}
function improveChoiceResolve(key){
  const r = improveChoiceResolver;
  improveChoiceResolver = null;
  if(key !== null && typeof closeCrmModal === 'function') closeCrmModal();
  if(r) r(key);
}

/* القرار قبل حذف اختبار/مهمة: { ok, withImps: [ids تُحذف معه], keepIds: [ids تصير على المجموع] } أو { ok: false }.
   - عليه إعادة كاملة: «احذفهما معًا» فقط (الإعادة لا تبقى بلا أصلها) — أو إلغاء الحذف.
   - عليه زيادة على هذا العنصر فقط: «احذفهما معًا» أو «أبقِ الزيادة على مجموع البند».
   - آخر عنصر في الشعبة: تنبيه بتوقف أنشطة المجموع مؤقتًا. baseMsg = نص التأكيد المعتاد (الحذف والسلة) */
async function improveConfirmDelete(target, itemIds, label, baseMsg){
  const links = await improveLinksForDelete(target, itemIds);
  if(!links) return { ok: await showConfirm(baseMsg), withImps: [], keepIds: [] };
  if(links.linked.length){
    const what = target === 'tests' ? 'الاختبار' : 'المهمة';
    const names = links.linked.map(i => '«' + i.name + '»').join('، ');
    const retakes = links.linked.filter(improveIsRetake);
    const later = links.suspend.length ? `<p class="tlx-note" style="margin:8px 0 0;">${escapeHtml(improveSuspendText(target, links.suspend))}</p>` : '';
    const keepLast = !retakes.length && links.lastFor && links.linked.some(i => links.lastFor.has(i.section_id));
    const why = retakes.length
      ? `عليه نشاط تحسين مرتبط به: ${names}. الإعادة لا تبقى بلا ${what} الأصلي، فتُحذف معه (ويعودان معًا بالتراجع).`
      : `عليه زيادة مرتبطة به: ${names}. ماذا تريد؟${keepLast ? ' (إن أبقيتها على المجموع تتوقف مؤقتًا حتى تضيف ' + (target === 'tests' ? 'اختبارًا' : 'مهمة') + ' جديدة)' : ''}`;
    const choices = [{ key: 'both', label: `احذف ${what} ونشاط التحسين معًا`, cls: 'is-navy' }];
    if(!retakes.length) choices.push({ key: 'keep', label: `احذف ${what} وأبقِ الزيادة على المجموع` });
    const ch = await improveAskChoice(`<h3 style="margin:0 0 6px;font-size:15px;color:var(--navy);">حذف ${escapeHtml(label)}</h3>
      <p style="font-size:13px;line-height:1.9;margin:0;">${escapeHtml(baseMsg)}</p>
      <p class="tlx-note" style="margin:8px 0 0;">${escapeHtml(why)}</p>${later}`, choices);
    if(!ch) return { ok: false, withImps: [], keepIds: [] };
    const ids = links.linked.map(i => i.id);
    return { ok: true, withImps: ch === 'both' ? ids : [], keepIds: ch === 'keep' ? ids : [] };
  }
  const msg = links.suspend.length ? baseMsg + '\n\n' + improveSuspendText(target, links.suspend) : baseMsg;
  return { ok: await showConfirm(msg), withImps: [], keepIds: [] };
}

/* حذف مكوّن «مهام أدائية» من الكشف: نص تنبيه إن كان على المهام تحسين في هذه الشعب (يتوقف مؤقتًا حتى يعود العمود)، وإلا '' */
async function improveTaskColumnDeleteNote(sectionIds, term){
  if(!currentUser || !(sectionIds || []).length) return '';
  try{
    const { data, error } = await sb.from('classroom_improvements').select('id, name').eq('teacher_id', currentUser.id)
      .eq('academic_year', term.year).eq('semester', term.semester).eq('target', 'task').in('section_id', sectionIds);
    if(error || !(data || []).length) return '';
    return ' ونشاط التحسين ' + data.map(i => '«' + i.name + '»').join('، ') + ' على المهام يتوقف مؤقتًا: درجاته محفوظة، ويعود حسابه إن أرجعت عمود المهام.';
  } catch(e){ return ''; }
}

/* يضيف أنشطة التحسين ودرجاتها للقطة السلة نفسها (فالتراجع يعيد الاختبار وتحسينه معًا) */
async function improveCaptureWith(cap, impIds, ownerId){
  if(!cap || !(impIds || []).length) return cap;
  const imps = await trashRows('classroom_improvements', [['eq', 'teacher_id', ownerId], ['in', 'id', impIds]]);
  const sc = imps.length ? await trashRows('classroom_improvement_scores', [['eq', 'teacher_id', ownerId], ['in', 'improvement_id', trashIds(imps)]]) : [];
  cap.tables = cap.tables.concat([{ t: 'classroom_improvements', rows: imps }, { t: 'classroom_improvement_scores', rows: sc }]);
  return cap;
}

/* بعد الحذف: حذف الأنشطة المختارة معه، أو تحويل «الإعادة» إلى نشاط عام. الفشل يُذكر ولا يُعيد الحذف */
async function improveAfterItemDelete(choice){
  if(!choice || !currentUser) return;
  const uid = currentUser.id;
  if(choice.withImps.length){
    const { error } = await sb.from('classroom_improvements').delete().eq('teacher_id', uid).in('id', choice.withImps);
    if(error) showToast('حُذف العنصر وتعذّر حذف نشاط التحسين معه: ' + improveDbErrorMessage(error), 'error');
  }
  if(choice.keepIds.length){
    /* تصير زيادة على مجموع البند (الربط إلى فارغ — الحذف نفسه يفرّغه أيضًا في القاعدة) */
    const { error } = await sb.from('classroom_improvements').update({ mode: 'new', source_name: null, column_id: null, task_id: null }).eq('teacher_id', uid).in('id', choice.keepIds);
    if(error) showToast('حُذف العنصر وتعذّر تحويل نشاط التحسين لعام: ' + improveDbErrorMessage(error), 'error');
  }
}

/* ============ تقرير الطالب التحليلي ============ */
/* أنشطة التحسين التي شارك فيها الطالب: [{ name, target, period, score, max }] */
function improveStudentItems(g, studentId){
  const e = g && g.improve && g.improve.idx && g.improve.idx.get(studentId);
  if(!e) return [];
  return e.items.map(x => ({ name: x.imp.name, target: x.imp.target, period: improvePeriodLabel(x.imp), type: improveTypeLabel(x.imp),
    retake: improveIsRetake(x.imp), suspended: improveIsRetake(x.imp) && !improveItemId(x.imp), score: x.score, max: Number(x.imp.max_score) }));
}

/* ============================================================
   الفترات — لكل مكوّن أداء إعداده الخاص (١ إلى ٣ فترات)
   ------------------------------------------------------------
   - الأصل فترة واحدة لكل مكوّن. المعلم يختار لأي مكوّن ٢ أو ٣ فترات، ومتى
     أراد يضغط "ابدأ الفترة التالية" (يدوي، بلا تاريخ يُطلب — يوم الضغط
     يُحفظ داخليًا ليعرف كل رصد مؤرَّخ فترته).
   - المكوّن المرصود مباشرة (المشاركة، العدّاد، العمود اليدوي): درجة لكل فترة
     في classroom_grade_period_scores، والقاعدة تكتب في الكشف معدّل ما رُصد.
     يُرصد دائمًا بدرجة فترة (بفترة واحدة: الأولى) فتبقى البيانات متّسقة.
   - المكوّن المحسوب (الواجبات بموعدها، المهام بموعدها، أداة الحالة/الدرجة
     بتاريخ رصدها): درجة كل فترة من رصدها، والعمود = معدّل الفترات.
   - الإعداد في user_app_settings.features.periods["سنة|فصل"][هوية المكوّن]
     = { n: 1..3, starts: [يوم بدء الثانية، يوم بدء الثالثة], ended?: true }.
   - الفترة الجارية لا تدخل المعدّل حتى تنتهي (لا هبوط مفاجئ عند بدء فترة):
     في الأولى تُحسب الأولى؛ بعدها تُحسب الفترات المنتهية فقط، والأخيرة عند
     "أنهِ الفترة". للمرصود مباشرة: classroom_grade_columns.counted_periods.
     («يبدأ من الكاملة» وحسابها الفوري أُلغيا في 3.61: لا قاعدة خفية تكتب درجات. التعبئة بأزرار صريحة.)
   - تقليل الفترات يحذف رصد ما بعدها فقط (ترجع الدرجة لما قبلها)، مع "تراجع".
     هوية المكوّن كما في إعداد الدرجات: kind:participation، tool:<id>، name:<اسم>.
   - الاختبارات بلا فترات (كل اختبار عمود مستقل أصلًا).
   ============================================================ */

const PERIOD_NAMES = { 1: 'الفترة الأولى', 2: 'الفترة الثانية', 3: 'الفترة الثالثة' };
const PERIOD_COUNT_MAX = 3;
const PERIOD_COUNT_LABELS = { 1: 'فترة واحدة', 2: 'فترتان', 3: 'ثلاث فترات' };

/* ============ دوال صرفة ============ */
function termPeriodKey(term){ return term.year + '|' + term.semester; }

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPeriodCompKey(k){
  return typeof k === 'string' && (/^kind:(participation|homework|task)$/.test(k) || /^tool:[0-9a-f-]{36}$/i.test(k) || /^name:.{1,60}$/.test(k));
}

/* { n, starts, ended? } صالح، أو null (= فترة واحدة). ended: الفترة الأخيرة انتهت (تُحسب) */
function normalizePeriodCfg(raw){
  if(!raw || typeof raw !== 'object') return null;
  const n = Number(raw.n);
  if(!Number.isInteger(n) || n < 2 || n > PERIOD_COUNT_MAX) return null;
  const starts = (Array.isArray(raw.starts) ? raw.starts : []).filter(d => typeof d === 'string' && ISO_DATE_RE.test(d)).sort().slice(0, n - 1);
  const out = raw.ended === true && starts.length === n - 1 ? { n, starts, ended: true } : { n, starts };
  if(raw.live === true) out.live = true; /* «احسب الفترة الجارية في الكشف» (اختياري، مطفأ في الأصل) */
  return out;
}

/* كم فترة تُحسب في الدرجة: null = الكل (فترة واحدة)؛ في الأولى: الأولى؛ بعدها: المنتهية فقط؛
   وبعد "أنهِ الفترة الأخيرة": كلها */
function countedPeriodsOf(cfg){
  if(!cfg || cfg.n < 2) return null;
  if(cfg.ended) return cfg.n;
  const cur = currentPeriodOf(cfg);
  if(cfg.live) return cur; /* الخيار: الجارية تُحسب فورًا (قد يهبط المعدّل عند بدء فترة) */
  return cur === 1 ? 1 : cur - 1;
}


/* القيمة القديمة (الإصدار 1.5: "later" أو تاريخ لكل فصل) = المشاركة والواجبات بفترتين */
function normalizeTermPeriods(v){
  if(v === 'later' || (typeof v === 'string' && ISO_DATE_RE.test(v))){
    const starts = v === 'later' ? [] : [v];
    return { 'kind:participation': { n: 2, starts }, 'kind:homework': { n: 2, starts: starts.slice() } };
  }
  if(!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  Object.keys(v).forEach(k => { const c = isPeriodCompKey(k) && normalizePeriodCfg(v[k]); if(c) out[k] = c; });
  return Object.keys(out).length ? out : null;
}

function normalizePeriodsFeature(raw){
  if(!raw || typeof raw !== 'object') return null;
  const out = {};
  Object.keys(raw).forEach(t => {
    if(!/^[0-9٠-٩\-\/ ]{1,20}\|[12]$/.test(t)) return;
    const v = normalizeTermPeriods(raw[t]);
    if(v) out[t] = v;
  });
  return Object.keys(out).length ? out : null;
}

/* إعداد مكوّن: { n, starts } — الأصل فترة واحدة */
function periodCfgOf(features, term, key){
  const t = features && features.periods && features.periods[termPeriodKey(term)];
  const c = t && normalizePeriodCfg(t[key]);
  return c || { n: 1, starts: [] };
}

function currentPeriodOf(cfg){ return Math.min(cfg.n, (cfg.starts || []).length + 1); }

/* فترة تاريخ: ١ + عدد الفترات التي بدأت في هذا اليوم أو قبله */
function periodOfDateFor(iso, starts){
  return 1 + (starts || []).filter(d => iso && d <= iso).length;
}

/* هوية المكوّن لعمود أداء (كما في إعداد الدرجات) */
function periodCompKeyOfColumn(c){
  if(!c || c.category === 'tests') return null;
  if(c.tool_id) return 'tool:' + c.tool_id;
  if(c.kind && c.kind !== 'manual') return 'kind:' + c.kind;
  return 'name:' + normalizeGradeColumnName(c.name);
}

/* وضع ورقة الحصة → هوية المكوّن */
function periodCompKeyOfMode(mode){
  if(mode === 'participation' || mode === 'homework' || mode === 'task') return 'kind:' + mode;
  if(typeof mode === 'string' && mode.indexOf('tool:') === 0) return mode;
  return null;
}

/* عمود يُرصد مباشرة (درجة لكل فترة في القاعدة): المشاركة، العدّاد، اليدوي */
function isDirectPeriodColumn(c){
  if(!c || c.category === 'tests') return false;
  if(c.tool_id){
    const t = typeof customToolById === 'function' ? customToolById(c.tool_id) : null;
    return !!t && t.tool_type === 'counter';
  }
  return !c.kind || c.kind === 'manual' || c.kind === 'participation';
}

/* عمود له فترات (أي مكوّن أداء) */
function isPeriodColumn(c){ return !!c && c.category !== 'tests'; }

/* درجات فترة واحدة في ورقة الحصة. طالب بلا صفوف فترات (رصد قديم) = درجته في الكشف هي الأولى */
function currentPeriodScores(mainScores, periodRows, period){
  const hasRows = new Set((periodRows || []).map(r => r.student_id));
  const out = new Map();
  (periodRows || []).forEach(r => { if(Number(r.period) === period) out.set(r.student_id, Number(r.score)); });
  if(period === 1){
    (mainScores || new Map()).forEach((v, id) => { if(!hasRows.has(id)) out.set(id, Number(v)); });
  }
  return out;
}

/* درجات الفترات لكل طالب في عمود مرصود مباشرة: { p1, p2, p3 } (null = لم تُرصد) */
function participationPeriodBreakdown(mainScores, periodRows){
  const out = new Map();
  const get = id => { if(!out.has(id)) out.set(id, { p1: null, p2: null, p3: null }); return out.get(id); };
  (periodRows || []).forEach(r => { get(r.student_id)['p' + Number(r.period)] = Number(r.score); });
  (mainScores || new Map()).forEach((v, id) => { if(!out.has(id)) get(id).p1 = Number(v); });
  return out;
}

/* معدّل ما رُصد من الفترات (كما تحسبه القاعدة للمرصود مباشرة) */
function periodAverage(...vals){
  const rec = vals.flat().filter(v => v !== null && v !== undefined);
  if(!rec.length) return null;
  return Math.round(100 * rec.reduce((a, b) => a + Number(b), 0) / rec.length) / 100;
}

/* مكوّن محسوب: درجة كل فترة من عناصرها (بتاريخها)، والنهائية = معدّل الفترات المحسوبة المرصودة.
   cfg: إعداد المكوّن (أو قائمة starts = كل الفترات محسوبة). بلا فترات بدأت = حساب واحد على الكل */
function periodSplitScores(items, dateOf, scoreOf, cfg, adjust){
  const c = Array.isArray(cfg) || !cfg ? { n: (cfg || []).length + 1, starts: cfg || [], ended: true } : cfg;
  const starts = c.starts || [];
  const out = { p1: null, p2: null, p3: null, final: null };
  const k = starts.length + 1;
  for(let p = 1; p <= k; p++){
    const v = scoreOf((items || []).filter(it => itemPeriodFor(it, dateOf, c) === p));
    out['p' + p] = adjust ? adjust(p, v) : v; /* adjust: زيادة تحسين على فترة بعينها (app-56) */
  }
  const counted = countedPeriodsOf(c) || k;
  out.final = periodAverage([out.p1, out.p2, out.p3].slice(0, counted));
  return out;
}

/* ============ فترة الواجب/المهمة ثابتة (3.66) ============
   كل واجب ومهمة يحمل فترته (grade_period) منذ إنشائه: بدء فترة جديدة لا ينقل شيئًا، والفترات مستقلة.
   القديم بلا فترة (null): فترته من تاريخه كما كان، ويُثبَّت على ذلك قبل بدء أي فترة جديدة (freezeItemPeriods).
   لا تتجاوز الفترة الجارية (تراجع عن بدء فترة، أو تقليل عدد الفترات): تُعرض في آخر فترة بدأت.
   (grade_period لا period: period في جداول أخرى = رقم الحصة) */
function itemPeriodFor(it, dateOf, cfg){
  const c = cfg || { n: 1, starts: [] };
  const now = Math.min(c.n || PERIOD_COUNT_MAX, (c.starts || []).length + 1);
  const g = Number(it && it.grade_period);
  const p = Number.isInteger(g) && g >= 1 && g <= PERIOD_COUNT_MAX ? g : periodOfDateFor(dateOf(it), c.starts);
  return Math.max(1, Math.min(p, now));
}

/* قبل تشغيل ملف تحديث القاعدة (لا عمود grade_period): القراءة والحفظ بدونه، ولا يتعطّل شيء */
let gradePeriodColMissing = false;
function gradePeriodColError(e){
  if(!e || isGradeLockedError(e)) return false; /* «grade_period_locked» = قفل حقيقي، لا عمود مفقود (كان يُخفي الخطأ ويحفظ بدون الفترة) */
  const t = String((e.message || '') + ' ' + (e.details || '') + ' ' + (e.hint || ''));
  return /\bgrade_period\b/.test(t) && (e.code === '42703' || e.code === 'PGRST204' || /does not exist|could not find|schema cache/i.test(t));
}
async function withGradePeriodCol(run){
  if(!gradePeriodColMissing){
    const r = await run(true);
    if(!(r && r.error && gradePeriodColError(r.error))) return r;
    gradePeriodColMissing = true;
  }
  return run(false);
}

/* فترة واجب/مهمة جديدة: الفترة المعروضة (ورقة الحصة أو الكشف) إن بدأت ولم تُقفل، وإلا الجارية */
function newItemPeriod(key){
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  const now = currentPeriodOf(cfg);
  const open = p => p >= 1 && p <= now && !isPeriodLocked(term, key, { period: p });
  const sheet = typeof crmSheet !== 'undefined' && crmSheet && periodCompKeyOfMode(crmSheet.mode) === key ? sheetPeriodInfo(crmSheet) : null;
  if(sheet && open(sheet.period)) return sheet.period;
  const vp = typeof gradeEditPeriod !== 'undefined' && gradeEditPeriod && gradeEditPeriod.term === termPeriodKey(term) ? gradeEditPeriod.period : null;
  if(vp && open(vp)) return vp;
  return now;
}

/* حقل «الفترة» في نافذة الواجب/المهمة (بفترات فقط). kind: 'homework' | 'task' */
function itemPeriodFieldHtml(kind, period, original){
  if(gradePeriodColMissing) return '';
  const key = 'kind:' + kind;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  if(cfg.n < 2) return '';
  const now = currentPeriodOf(cfg);
  if(original && isPeriodLocked(term, key, { period: original })){
    return `<label class="crm-field-label">الفترة</label><p class="tlx-note" style="margin:0 0 10px;">🔒 في ${PERIOD_NAMES[original]} (مقفلة) — افتحها أولًا لنقله لفترة أخرى.</p>`;
  }
  const btn = p => {
    const off = p > now || isPeriodLocked(term, key, { period: p });
    return `<button type="button" class="${p === period ? 'is-on' : ''}" aria-pressed="${p === period}"${off ? ' disabled' : ` onclick="setCrmItemPeriod('${kind}', ${p})"`}>${PERIOD_NAMES[p].replace('الفترة ', '')}${p > now ? '<small>لم تبدأ</small>' : isPeriodLocked(term, key, { period: p }) ? '<small>🔒</small>' : ''}</button>`;
  };
  return `<label class="crm-field-label">الفترة</label><div class="tlx-seg crm-per-seg crm-item-per" id="crmItemPer_${kind}" style="margin-bottom:10px;">${[1, 2, 3].slice(0, cfg.n).map(btn).join('')}</div>`;
}

function setCrmItemPeriod(kind, p){
  const d = kind === 'homework' ? (typeof crmHomeworkDraft !== 'undefined' ? crmHomeworkDraft : null) : (typeof crmTaskDraft !== 'undefined' ? crmTaskDraft : null);
  p = Number(p);
  const key = 'kind:' + kind, term = crmCurrentTerm(), cfg = periodCfg(term, key);
  if(!d || d.saving || !(p >= 1 && p <= currentPeriodOf(cfg)) || isPeriodLocked(term, key, { period: p })) return;
  d.gradePeriod = p;
  const box = document.getElementById('crmItemPer_' + kind);
  if(box) box.outerHTML = itemPeriodFieldHtml(kind, p, d.originalPeriod).replace(/^<label[^>]*>الفترة<\/label>/, '');
}

/* قبل بدء فترة جديدة للواجبات/المهام: ما بلا فترة يُثبَّت على فترته الحالية (بتاريخه) فلا ينتقل للجديدة */
async function freezeItemPeriods(key, term, cfg){
  const table = key === 'kind:homework' ? 'classroom_homework' : key === 'kind:task' ? 'classroom_tasks' : null;
  if(!table || gradePeriodColMissing || !currentUser) return;
  const dateOf = key === 'kind:homework' ? (h => h.due_date) : taskDateOf;
  const { data, error } = await sb.from(table).select('id, due_date, created_at, grade_period')
    .eq('teacher_id', currentUser.id).eq('academic_year', term.year).eq('semester', term.semester);
  if(error){ if(gradePeriodColError(error)) gradePeriodColMissing = true; return; }
  const byP = new Map();
  (data || []).filter(it => it.grade_period == null).forEach(it => {
    const p = itemPeriodFor(it, dateOf, cfg);
    if(!byP.has(p)) byP.set(p, []);
    byP.get(p).push(it.id);
  });
  for(const [p, ids] of byP){
    for(const part of chunkArray(ids, 100)){
      const { error: uErr } = await sb.from(table).update({ grade_period: p }).eq('teacher_id', currentUser.id).in('id', part);
      if(uErr) throw uErr; /* لا تبدأ الفترة الجديدة وفي القديم ما لم يُثبَّت (وإلا انتقل إليها بتاريخه) */
    }
  }
}

/* كم واجبًا/مهمة فترتها بعد p (بفترتها المحفوظة أو بتاريخها) — لا تُلغى فترة فيها واجبات أو مهام */
async function itemsAfterPeriod(key, term, cfg, p){
  const table = key === 'kind:homework' ? 'classroom_homework' : key === 'kind:task' ? 'classroom_tasks' : null;
  if(!table || !currentUser) return 0;
  const dateOf = key === 'kind:homework' ? (h => h.due_date) : taskDateOf;
  const { data, error } = await withGradePeriodCol(col => sb.from(table).select('id, due_date, created_at' + (col ? ', grade_period' : ''))
    .eq('teacher_id', currentUser.id).eq('academic_year', term.year).eq('semester', term.semester));
  if(error) throw error;
  return (data || []).filter(it => itemPeriodFor(it, dateOf, cfg) > p).length;
}
function itemsWord(key, k){
  const hw = key === 'kind:homework';
  return k === 1 ? (hw ? 'واجب واحد' : 'مهمة واحدة') : k === 2 ? (hw ? 'واجبان' : 'مهمتان') : k + (hw ? ' واجبات' : ' مهام');
}

/* ============ الإعداد (يتبع حساب المعلم على كل أجهزته) ============ */
function periodCfg(term, key){ return periodCfgOf(appFeatures, term, key); }

let gradePeriodSaving = false;
async function savePeriodCfg(term, key, cfg){
  const next = normalizeFeatures(appFeatures);
  const all = Object.assign({}, next.periods);
  const t = Object.assign({}, all[termPeriodKey(term)]);
  if(cfg && cfg.n > 1) t[key] = Object.assign({ n: cfg.n, starts: cfg.starts.slice(0, cfg.n - 1) }, cfg.ended && cfg.starts.length >= cfg.n - 1 ? { ended: true } : {}, cfg.live ? { live: true } : {}); else delete t[key];
  if(Object.keys(t).length) all[termPeriodKey(term)] = t; else delete all[termPeriodKey(term)];
  if(Object.keys(all).length) next.periods = all; else delete next.periods;
  appFeatures = next;
  await saveAppFeatures();
  const saved = periodCfg(term, key);
  const want = normalizePeriodCfg(cfg) || { n: 1, starts: [] };
  if(saved.n !== want.n || saved.starts.join() !== want.starts.join() || !!saved.ended !== !!want.ended || !!saved.live !== !!want.live) return false; /* فشل الحفظ: أُعيد المحفوظ */
  await applyCountedPeriods(term, key, saved);
  await resyncPeriodComponent(term, key);
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  return true;
}

/* المحسوب يتوزّع على الفترات بتاريخه — يُعاد حساب عموده في كل الشعب */
async function resyncPeriodComponent(term, key){
  if(typeof resyncStartModeColumns !== 'function') return;
  try{
    if(key === 'kind:homework') await resyncStartModeColumns('homework', null, term);
    else if(key === 'kind:task') await resyncStartModeColumns('task', null, term);
    else if(key.indexOf('tool:') === 0){
      const tool = typeof customToolById === 'function' ? customToolById(key.slice(5)) : null;
      if(tool && tool.tool_type !== 'counter') await resyncStartModeColumns(key, tool, term);
    }
  } catch(e){} /* يُعاد حسابه عند فتح الكشف */
}

/* المرصود مباشرة: عدد الفترات المحسوبة في كل أعمدة المكوّن (القاعدة تعيد حساب الدرجات) */
async function applyCountedPeriods(term, key, cfg){
  if(!periodKeyIsDirect(key) || typeof termColumnsMatching !== 'function') return;
  const want = countedPeriodsOf(cfg);
  const cols = await termColumnsMatching(c => periodCompKeyOfColumn(c) === key && isDirectPeriodColumn(c));
  for(const c of cols){
    if((c.counted_periods == null ? null : Number(c.counted_periods)) === want) continue;
    const { error } = await sb.rpc('set_column_counted_periods', { p_column_id: c.id, p_counted: want });
    if(error) throw error;
  }
}

/* رصد الفترات بعد n في أعمدة مكوّن مرصود مباشرة (للحذف مع إمكانية التراجع) */
async function laterPeriodRows(key, n){
  const cols = await termColumnsMatching(c => periodCompKeyOfColumn(c) === key && isDirectPeriodColumn(c));
  if(!cols.length) return [];
  const { data, error } = await sb.from('classroom_grade_period_scores').select('*')
    .eq('teacher_id', currentUser.id).in('column_id', cols.map(c => c.id)).in('period', [1, 2, 3].filter(p => p > n));
  if(error) throw error;
  return data || [];
}

function periodKeyIsDirect(key){
  if(key === 'kind:participation' || key.indexOf('name:') === 0) return true;
  if(key.indexOf('tool:') === 0){
    const t = typeof customToolById === 'function' ? customToolById(key.slice(5)) : null;
    return !!t && t.tool_type === 'counter';
  }
  return false;
}

/* من إعداد الدرجات (نادر): التراجع عن «أنهِ الفترة الأخيرة» — تعود جارية. لا يُحذف رصد؛ وإن كانت مقفلة تُفتح
   (كالتراجع عن بدء فترة: يعيد الحال كما كانت قبل الإنهاء). الأثر الوحيد على الكشف: لا تُحسب حتى تنتهي (إلا مع «احسب الجارية») */
async function reopenLastPeriod(key){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  if(cfg.n < 2 || !cfg.ended || currentPeriodOf(cfg) !== cfg.n) return false;
  const last = PERIOD_NAMES[cfg.n], name = periodCompName(key);
  const lock = periodLockOf(term, key);
  closeCrmModal();
  const effect = cfg.live ? 'تبقى محسوبة في الكشف (خيار «احسب الفترة الجارية» مفعّل).'
    : `لن تُحسب في الكشف حتى تنهيها — الدرجة الآن = ${cfg.n === 2 ? PERIOD_NAMES[1] + ' وحدها' : 'الفترات المنتهية قبلها'}.`;
  if(!(await showConfirm(`اجعل ${last} جارية من جديد في «${name}»؟ لا يُحذف أي رصد، وتستطيع الرصد فيها كالمعتاد. ${effect}${lock && lock.set.has(cfg.n) ? ' وتُفتح لأنها مقفلة.' : ''}`))) return false;
  const again = periodCfg(term, key);
  if(gradePeriodSaving || !again.ended || again.starts.join() !== cfg.starts.join()){ showToast('تغيّرت الفترات — أعد المحاولة', 'error'); return false; }
  const next = Object.assign({}, again);
  delete next.ended;
  return withPeriodBusy(async () => {
    const ok = await savePeriodCfg(term, key, next);
    if(ok && isPeriodLocked(term, key, { period: again.n })) await setPeriodLockOne(term, key, again.n, false);
    return ok;
  }, `${last} جارية من جديد ✓`);
}

/* من إعداد الدرجات: «احسب الفترة الجارية في الكشف» لمكوّن واحد (حساب فقط: لا يكتب رصدًا ولا يحذفه، وإطفاؤه يعيد الحساب كما كان) */
async function setComponentPeriodLive(key, on){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  if(cfg.n < 2 || !!cfg.live === !!on) return false;
  const next = Object.assign({}, cfg, { live: !!on });
  if(!on) delete next.live;
  return withPeriodBusy(() => savePeriodCfg(term, key, next),
    on ? `«${periodCompName(key)}»: الفترة الجارية تُحسب في الكشف الآن ✓` : `«${periodCompName(key)}»: الفترة تُحسب عند انتهائها ✓`);
}

/* من إعداد الدرجات: عدد فترات مكوّن (١–٣).
   التقليل (3.62) مسموح بسؤال واضح: رصد الفترات المحذوفة يُحفظ في «المحذوفات» 30 يومًا قبل حذفه (trashProtect)،
   وما كان مقفلًا منها يُفتح؛ ثم «تراجع» يعيد الرصد والفترات والقفل كما كانت. المحسوب (الواجبات/المهام) لا يُحذف منه شيء:
   يُعاد توزيعه بتاريخه. */
async function setComponentPeriodCount(key, n){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  n = Number(n);
  if(!(n >= 1 && n <= PERIOD_COUNT_MAX)) return false;
  const term = crmCurrentTerm();
  const cur = periodCfg(term, key);
  if(cur.n === n) return false;
  const next = Object.assign({ n, starts: cur.starts.slice(0, n - 1) }, cur.live ? { live: true } : {});
  if(n > cur.n) return withPeriodBusy(() => savePeriodCfg(term, key, next), `صار "${periodCompName(key)}" ${PERIOD_COUNT_LABELS[n]} ✓`);

  const name = periodCompName(key);
  const now = currentPeriodOf(cur);
  const lock = periodLockOf(term, key);
  const keepLocks = new Set([...(lock ? lock.set : [])].filter(p => p <= n - 1)); /* الفترة n تعود جارية، وما بعدها يُلغى */
  const locksChange = !!lock && keepLocks.size !== lock.set.size;
  let later = [];
  if(periodKeyIsDirect(key)){
    try{ later = await laterPeriodRows(key, n); } catch(e){ showToast('تعذّر الفحص — أعد المحاولة', 'error'); return false; }
  } else if(key === 'kind:homework' || key === 'kind:task'){
    /* لا تُلغى فترة فيها واجبات/مهام (لا دمج صامت في فترة أخرى) */
    let k = 0;
    try{ k = await itemsAfterPeriod(key, term, cur, n); } catch(e){ showToast('تعذّر الفحص — أعد المحاولة', 'error'); return false; }
    if(k){ showToast(`لا تقليل: بعد ${PERIOD_NAMES[n]} ${itemsWord(key, k)} — انقلها لفترة أخرى أو احذفها أولًا`, 'error'); return false; }
  }
  const gone = [1, 2, 3].filter(p => p > n && p <= cur.n);
  const names = gone.map(p => PERIOD_NAMES[p]).join(' و');
  const students = new Set(later.map(r => r.student_id)).size;
  const parts = [];
  if(later.length) parts.push(`يُحذف رصد ${names} (${students === 1 ? 'طالب واحد' : students === 2 ? 'طالبان' : students + ' طلاب'}) ويبقى في «المحذوفات» ${TRASH_DAYS} يومًا تستطيع استرجاعه.`);
  else if(!periodKeyIsDirect(key) && key !== 'kind:homework' && key !== 'kind:task' && now > n) parts.push(`ما رُصد في ${names} يعود لـ${PERIOD_NAMES[n]} بتاريخه (لا يُحذف شيء).`);
  if(now > n || (now === n && cur.ended)) parts.push(`${PERIOD_NAMES[n]} تعود جارية.`);
  if(locksChange) parts.push('وتُفتح الفترات المقفلة التي تتغيّر.');
  if(parts.length && !(await showConfirm(`تقليل فترات «${name}» إلى ${PERIOD_COUNT_LABELS[n]}؟ ${parts.join(' ')}`))) return false;
  /* تغيّر شيء أثناء السؤال (جهاز آخر/نقرة أخرى): لا نبني على نسخة قديمة */
  const again = periodCfg(term, key);
  if(gradePeriodSaving || again.n !== cur.n || again.starts.join() !== cur.starts.join() || !!again.ended !== !!cur.ended){ showToast('تغيّرت الفترات — أعد المحاولة', 'error'); return false; }

  let trash = { id: null };
  if(later.length){
    trash = await trashProtect(async () => ({ kind: 'period_scores', label: `رصد ${names} — ${name}`, ownerId: currentUser.id,
      meta: { key, term: termPeriodKey(term) }, tables: [{ t: 'classroom_grade_period_scores', rows: later }] }));
    if(!trash) return false; /* ألغى المعلم الحذف بلا سلة */
  }
  const ok = await withPeriodBusy(async () => {
    if(locksChange) await setPeriodLocks(term, key, keepLocks);
    if(later.length){
      const { error } = await sb.from('classroom_grade_period_scores').delete()
        .eq('teacher_id', currentUser.id).in('id', later.map(r => r.id));
      if(error){ await trashDiscard(trash.id); throw error; }
    }
    return savePeriodCfg(term, key, next);
  }, `صار "${name}" ${PERIOD_COUNT_LABELS[n]} ✓`);
  if(ok && later.length) trashOfferUndo(`حُذف رصد ${names}`, trash.id, async () => {
    await withPeriodBusy(async () => {
      if(!(await savePeriodCfg(term, key, cur))) return false;
      if(lock) await setPeriodLocks(term, key, lock.set);
      return true;
    }, 'عادت الفترات والرصد كما كانت ✓');
  });
  return ok;
}

/* إنهاء الفترة الأخيرة (فتُحسب في الدرجة). التراجع عن الإنهاء فقط وهي غير مقفلة (فالقفل يُفتح أولًا) */
async function endComponentPeriods(key, ended){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  if(cfg.n < 2 || currentPeriodOf(cfg) !== cfg.n || !!cfg.ended === !!ended) return false;
  const lock = periodLockOf(term, key);
  if(!ended && lock && lock.set.has(cfg.n)){ crmLockedToast(); return false; }
  return withPeriodBusy(() => savePeriodCfg(term, key, Object.assign({}, cfg, { ended: !!ended })),
    ended ? `انتهت ${PERIOD_NAMES[cfg.n]} — صارت تُحسب في الدرجة ✓` : `${PERIOD_NAMES[cfg.n]} جارية من جديد`);
}

/* الفترات بعد الانتقال لفترة: بعد الجارية = تبدأ الآن، وقبلها = رجوع */
function periodStartsFor(cfg, target, dateIso){
  if(target <= currentPeriodOf(cfg)) return cfg.starts.slice(0, target - 1);
  const starts = cfg.starts.slice();
  const last = starts.length ? starts[starts.length - 1] : '';
  const day = dateIso > last ? dateIso : last;
  while(starts.length < target - 1) starts.push(day);
  return starts;
}

/* الانتقال لفترة لاحقة. الرجوع (3.61) فقط خطوة واحدة للتراجع عن بدء فترة خطأً: والفترة الجارية بلا رصد
   (فلا يختفي شيء)، والسابقة غير مقفلة */
async function goToComponentPeriod(key, target, dateIso){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  const now = currentPeriodOf(cfg);
  if(!(target >= 1 && target <= cfg.n) || (target === now && !cfg.ended)) return false;
  if(target < now || (target === now && cfg.ended)){
    if(target !== now - 1 || cfg.ended){ showToast('لا رجوع لفترات سابقة — افتح الفترة للتعديل من نافذة الفترات', 'error'); return false; }
    if(isPeriodLocked(term, key, { period: now })){ showToast(`${PERIOD_NAMES[now]} مقفلة — افتحها للتعديل أولًا`, 'error'); return false; }
    if(periodKeyIsDirect(key)){
      let later = [];
      try{ later = await laterPeriodRows(key, target); } catch(e){ showToast('تعذّر الفحص — أعد المحاولة', 'error'); return false; }
      if(later.length){ showToast(`لا رجوع: في ${PERIOD_NAMES[now]} رصد محفوظ`, 'error'); return false; }
    } else if(key === 'kind:homework' || key === 'kind:task'){
      /* واجبات/مهام الفترة لا تُدمج في السابقة بصمت */
      let k = 0;
      try{ k = await itemsAfterPeriod(key, term, cfg, target); } catch(e){ showToast('تعذّر الفحص — أعد المحاولة', 'error'); return false; }
      if(k){ showToast(`لا رجوع: في ${PERIOD_NAMES[now]} ${itemsWord(key, k)} — انقلها لفترة أخرى أو احذفها أولًا`, 'error'); return false; }
    }
  }
  const lockBefore = periodLockOf(term, key);
  return withPeriodBusy(async () => {
    if(target > now) await freezeItemPeriods(key, term, cfg); /* واجبات/مهام ما قبلها تبقى في فترتها */
    const ok = await savePeriodCfg(term, key, Object.assign({ n: cfg.n, starts: periodStartsFor(cfg, target, dateIso || localIsoDate()) }, cfg.live ? { live: true } : {}));
    /* التراجع عن بدء فترة يعيد الحال كما كانت قبل البدء: السابقة جارية ومفتوحة (البدء هو الذي أقفلها) */
    if(ok && target < now && lockBefore && lockBefore.set.has(target)) await setPeriodLockOne(term, key, target, false);
    return ok;
  }, /* الانتقال يلغي "انتهت" */
    target > now ? `بدأت ${PERIOD_NAMES[target]} في "${periodCompName(key)}" ✓` : `رجعت إلى ${PERIOD_NAMES[target]} في "${periodCompName(key)}"`);
}

/* من نافذة الفترات: تراجع عن بدء الفترة الجارية (بدأت خطأً) */
async function undoPeriodStart(){
  const key = periodWinCtx && periodWinCtx.key;
  if(!key) return;
  const cfg = periodCfg(crmCurrentTerm(), key);
  const now = currentPeriodOf(cfg);
  if(now < 2 || cfg.ended) return;
  closeCrmModal();
  if(!(await showConfirm(`تراجع عن بدء ${PERIOD_NAMES[now]} في «${periodCompName(key)}»؟ تعود ${PERIOD_NAMES[now - 1]} جارية ومفتوحة (يُسمح فقط إن لم تَرصد في ${PERIOD_NAMES[now]} شيئًا).`))) return;
  await undoComponentPeriodStart(key, now);
}

function periodCompName(key){
  if(key.indexOf('tool:') === 0){
    const t = typeof customToolById === 'function' ? customToolById(key.slice(5)) : null;
    return t ? t.name : 'المكوّن';
  }
  if(key.indexOf('name:') === 0) return key.slice(5);
  return { 'kind:participation': 'المشاركة', 'kind:homework': 'الواجبات', 'kind:task': 'المهام الأدائية' }[key] || 'المكوّن';
}

/* تعطيل أزرار الفترات أثناء الحفظ (لا نقرة مزدوجة)، ثم رسالة وإعادة رسم الكشف الظاهر */
async function withPeriodBusy(fn, okMsg){
  gradePeriodSaving = true;
  document.querySelectorAll('.gs-period-btn, .crm-period-opt').forEach(b => { b.disabled = true; });
  let ok = false;
  try{ ok = await fn(); } catch(e){ ok = false; }
  finally { gradePeriodSaving = false; }
  if(!ok || okMsg !== null) showToast(ok ? okMsg : 'تعذّر الحفظ — أعد المحاولة', ok ? 'ok' : 'error');
  const tab = document.getElementById('crmTabGrades');
  if(tab && tab.style.display !== 'none' && typeof renderCrmGrades === 'function') renderCrmGrades();
  return ok;
}

/* ============ مبدّل الفترة في ورقة الحصة (للمكوّن الذي له أكثر من فترة) ============
   الأصل: فترة تاريخ الحصة. والمعلم يبدّل بنقرة لأي فترة بدأت (لعرضها ورصدها) — العرض فقط، لا يغيّر إعداد الفترات
   (الرجوع القديم كان يغيّر بدايات الفترات فيُخفي رصد ما بعدها؛ هذا لا يمسّ شيئًا محفوظًا).
   المرصود بفترة (المشاركة/العدّاد): الرصد يذهب للفترة المعروضة (والمقفلة للعرض فقط).
   الواجبات/المهام: القائمة تُفلتر بفترة موعدها. أداة الحالة/الدرجة: مؤرَّخة بالحصة، فلا تبديل (شارة فقط). */
function sheetPeriodSwitchable(key){
  return !!key && (key === 'kind:homework' || key === 'kind:task' || periodKeyIsDirect(key));
}

function sheetPeriodInfo(s){
  const key = s && periodCompKeyOfMode(s.mode);
  if(!key) return null;
  const cfg = periodCfg(crmCurrentTerm(), key);
  const now = currentPeriodOf(cfg);
  const datePeriod = Math.min(cfg.n, periodOfDateFor(s.dateIso, cfg.starts));
  const v = s.viewPeriods && Number(s.viewPeriods[key]);
  const period = cfg.n > 1 && sheetPeriodSwitchable(key) && v >= 1 && v <= now ? v : datePeriod;
  return { key, cfg, period, datePeriod, now };
}

/* extra: زر يُلحق بآخر السطر (مثل «؟» في ورقة الواجب/المهمة). ⚙ لم يعد هنا: «إدارة الفترات» داخل «؟» */
function crmPeriodChipHtml(s, extra){
  if(s) s.perExtra = extra || ''; /* لإعادة رسم المبدّل وحده بعد فتح/قفل (بلا تحميل) */
  const info = sheetPeriodInfo(s);
  if(!info || info.cfg.n < 2) return '';
  if(!sheetPeriodSwitchable(info.key)){
    return `<button type="button" class="crm-period-chip${info.period > 1 ? ' is-p2' : ''}" onclick="openCrmPeriodPicker()" aria-label="الفترات">📅 ${PERIOD_NAMES[info.period]}${info.cfg.ended ? ' ✓' : ''}</button>`;
  }
  const term = crmCurrentTerm();
  const btn = p => {
    const started = p <= info.now;
    /* الفترة التالية مباشرة: «＋ ابدأ» يفتح لوحة البدء داخل الورقة (لا نافذة) */
    if(!started && p === info.now + 1 && !info.cfg.ended){
      return `<button type="button" class="is-next${s.startPanel === info.key ? ' is-open' : ''}" aria-expanded="${s.startPanel === info.key}" onclick="openCrmStartNext()">${PERIOD_NAMES[p].replace('الفترة ', '')}<small>＋ ابدأ</small></button>`;
    }
    const locked = started && isLockableKey(info.key) && isPeriodLocked(term, info.key, { period: p });
    const tag = !started ? 'لم تبدأ' : locked ? '🔒' : p === info.now && !info.cfg.ended ? 'جارية' : 'منتهية';
    return `<button type="button" class="${p === info.period ? 'is-on' : ''}" aria-pressed="${p === info.period}"${started ? ` onclick="setCrmSheetPeriod(${p})"` : ' disabled'}>${PERIOD_NAMES[p].replace('الفترة ', '')}<small>${tag}</small></button>`;
  };
  return `<div class="crm-per-bar" id="crmPerBar"><div class="tlx-seg crm-per-seg" role="group" aria-label="الفترة">${[1, 2, 3].slice(0, info.cfg.n).map(btn).join('')}</div>${extra || ''}</div>`;
}

/* تحت المبدّل: مكان لوحة «ابدأ الفترة التالية»، ورابط «تراجع عن بدء…» — في نفس جلسة الورقة التي بدأت فيها الفترة فقط
   (s.justStarted): يختفي بإغلاق الورقة، أو بأول رصد في الجديدة، أو بـ✕. بعدها التراجع من ⚙ */
function crmStartSlotHtml(s){
  const info = sheetPeriodInfo(s);
  if(!info || info.cfg.n < 2 || !sheetPeriodSwitchable(info.key)) return '';
  const undo = s.justStarted === info.key && info.now > 1 && !info.cfg.ended && info.period === info.now
    ? `<div class="crm-per-undo-row" id="crmPerUndoRow"><button type="button" class="crm-per-undo gs-period-btn" onclick="undoCrmSheetPeriodStart()">↶ تراجع عن بدء ${PERIOD_NAMES[info.now]}</button>
      <button type="button" class="crm-per-undo-x" aria-label="إخفاء" onclick="dismissCrmJustStarted()">✕</button></div>` : '';
  return `<div id="crmStartPanelSlot"></div>${undo}`;
}

/* أول رصد في الفترة الجديدة، أو ✕: يختفي رابط التراجع (التراجع بعد الرصد مرفوض أصلًا) */
function dismissCrmJustStarted(s){
  s = s || (typeof crmSheet === 'undefined' ? null : crmSheet);
  if(!s || !s.justStarted) return;
  s.justStarted = null;
  const row = document.getElementById('crmPerUndoRow');
  if(row) row.innerHTML = '';
}

function crmStartPanelHtml(d, sum){
  const next = PERIOD_NAMES[d.now + 1].replace('الفترة ', ''), cur = PERIOD_NAMES[d.now].replace('الفترة ', '');
  const seg = `<div class="tlx-seg pt-seg" data-f="start">${PERIOD_TRANS_START.map(([v, l]) =>
    `<button type="button" class="${d.start === v ? 'is-on' : ''}" aria-pressed="${d.start === v}" onclick="setPeriodTrans('start', '${v}')">${l}</button>`).join('')}</div>`;
  return `<div class="crm-start-panel" role="region" aria-label="ابدأ ${PERIOD_NAMES[d.now + 1]}">
    <b>ابدأ ${PERIOD_NAMES[d.now + 1]}؟</b>
    <div id="ptSummary">${periodTransSummaryHtml(d, sum)}</div>
    ${periodKeyIsDirect(d.key) ? `<div class="crm-start-q">كيف تبدأ ${next}؟</div>${seg}` : ''}
    <button type="button" class="tlx-btn is-navy gs-period-btn" onclick="applyCrmStartNext()">${isLockableKey(d.key) ? 'أقفل' : 'أنهِ'} ${cur} وابدأ ${next}</button>
    <button type="button" class="tlx-btn is-ghost" onclick="closeCrmStartNext()">إلغاء</button></div>`;
}

/* ملخص الفترة التي تُغلق (المرصود بفترة: كم رُصد عبر الشعب) — للنافذة وللوحة الورقة */
async function loadPeriodTransSummary(d){
  if(!periodKeyIsDirect(d.key)) return;
  try{
    const cols = await directPeriodColumns(d.key);
    const stats = await directPeriodStats(cols);
    const st = stats[d.now] || { n: 0, pct: 0 };
    const sum = { n: st.n, pct: st.pct, total: cols.reduce((t, c) => t + crmStudentsOfSection(c.section_id).length, 0) };
    const el = periodTransDraft === d && document.getElementById('ptSummary');
    if(el) el.innerHTML = periodTransSummaryHtml(d, sum);
  } catch(e){
    const el = periodTransDraft === d && document.getElementById('ptSummary');
    if(el) el.innerHTML = '<div class="pt-sum">تعذّر الإحصاء — راجع الكشف</div>';
  }
}

/* «＋ ابدأ» على الفترة التالية: لوحة صغيرة داخل الورقة (نقرة ثانية تغلقها) */
function openCrmStartNext(){
  const s = crmSheet;
  const info = sheetPeriodInfo(s);
  if(!info || gradePeriodSaving || info.cfg.ended || info.now >= info.cfg.n || !sheetPeriodSwitchable(info.key)) return;
  if(s.startPanel === info.key) return closeCrmStartNext();
  s.startPanel = info.key;
  periodWinCtx = { key: info.key };
  const d = { key: info.key, now: info.now, last: false, start: 'empty', sheet: s };
  periodTransDraft = d;
  const slot = document.getElementById('crmStartPanelSlot');
  if(slot) slot.innerHTML = crmStartPanelHtml(d, null);
  document.querySelectorAll('.crm-per-seg button.is-next').forEach(b => { b.classList.add('is-open'); b.setAttribute('aria-expanded', 'true'); });
  loadPeriodTransSummary(d);
}

function closeCrmStartNext(){
  const s = crmSheet;
  if(s) s.startPanel = null;
  periodTransDraft = null;
  const slot = document.getElementById('crmStartPanelSlot');
  if(slot) slot.innerHTML = '';
  document.querySelectorAll('.crm-per-seg button.is-next').forEach(b => { b.classList.remove('is-open'); b.setAttribute('aria-expanded', 'false'); });
}

async function applyCrmStartNext(){
  const d = periodTransDraft;
  if(!d || !d.sheet || gradePeriodSaving) return false;
  const key = d.key, started = d.now + 1, start = d.start, sheet = d.sheet;
  if(sheet === crmSheet){ sheet.startPanel = null; sheet.justStarted = key; } /* قبل إعادة الرسم: رابط التراجع يظهر في هذه الجلسة */
  const ok = await applyPeriodTransition({ quiet: true });
  if(!ok){ if(sheet) sheet.justStarted = null; return false; }
  const msg = `${isLockableKey(key) ? 'أُقفلت' : 'انتهت'} ${PERIOD_NAMES[started - 1]} وبدأت ${PERIOD_NAMES[started]} ✓`;
  /* «تراجع» فوري فقط إن بدأت فارغة (البداية بالكاملة/0 رصدٌ يمنع التراجع — لا حذف صامت) */
  if(start !== 'empty' || typeof showUndoToast !== 'function'){ showToast(msg, 'ok'); return true; }
  Promise.resolve(showUndoToast(msg, 8)).then(async finalize => {
    if(finalize !== false) return;
    await undoComponentPeriodStart(key, started);
  }).catch(() => {});
  return true;
}

/* التراجع عن بدء الفترة الجارية (من التوست أو الرابط): يُرفض إن كان فيها رصد/واجبات (لا دمج صامت) */
async function undoComponentPeriodStart(key, started){
  const cfg = periodCfg(crmCurrentTerm(), key);
  if(currentPeriodOf(cfg) !== started || cfg.ended) return false; /* تغيّر شيء منذ البدء */
  const s = typeof crmSheet === 'undefined' ? null : crmSheet;
  const ok = await goToComponentPeriod(key, started - 1);
  if(ok && s) s.justStarted = null;
  if(ok && s && crmSheet === s && s.mode) await setCrmSheetMode(s.mode);
  return ok;
}

async function undoCrmSheetPeriodStart(){
  const info = sheetPeriodInfo(crmSheet);
  if(!info || gradePeriodSaving || info.now < 2 || info.cfg.ended) return;
  if(!(await showConfirm(`تراجع عن بدء ${PERIOD_NAMES[info.now]} في «${periodCompName(info.key)}»؟ تعود ${PERIOD_NAMES[info.now - 1]} جارية ومفتوحة كما كانت (يُسمح فقط إن لم يُرصد في ${PERIOD_NAMES[info.now]} شيء).`))) return;
  await undoComponentPeriodStart(info.key, info.now);
}

/* تبديل الفترة المعروضة في الورقة: يعيد رسم الوضع نفسه */
function setCrmSheetPeriod(p){
  const s = crmSheet;
  const info = sheetPeriodInfo(s);
  p = Number(p);
  if(!info || info.cfg.n < 2 || !sheetPeriodSwitchable(info.key) || !(p >= 1 && p <= info.now)) return;
  s.viewPeriods = Object.assign({}, s.viewPeriods);
  if(p === info.datePeriod) delete s.viewPeriods[info.key]; else s.viewPeriods[info.key] = p;
  if(p === info.period) return;
  return setCrmSheetMode(s.mode);
}

/* قائمة مؤرَّخة (واجبات/مهام) بالفترة المعروضة في الورقة. عنصر مختار صراحةً (أو أُنشئ للتو) في فترة أخرى: تنتقل الورقة لفترته.
   ترجع { on, period, list, periodOf } — on=false لفترة واحدة (القائمة كما هي) */
function sheetPeriodFilter(s, key, items, dateOf, selectId){
  const cfg = periodCfg(crmCurrentTerm(), key);
  const all = items || [];
  if(cfg.n < 2) return { on: false, period: 1, list: all, periodOf: () => 1 };
  const periodOf = it => itemPeriodFor(it, dateOf, cfg);
  const sel = selectId && all.find(it => it.id === selectId);
  const info0 = sheetPeriodInfo(s);
  if(sel && info0 && periodOf(sel) !== info0.period && periodOf(sel) <= info0.now){
    s.viewPeriods = Object.assign({}, s.viewPeriods);
    if(periodOf(sel) === info0.datePeriod) delete s.viewPeriods[key]; else s.viewPeriods[key] = periodOf(sel);
  }
  const period = (sheetPeriodInfo(s) || { period: 1 }).period;
  return { on: true, period, list: all.filter(it => periodOf(it) === period), periodOf };
}

/* قوائم إدارة الواجبات/المهام: بفترات تُجمَّع تحت عنوان كل فترة (الأحدث أولًا)، وبفترة واحدة كما هي */
function periodGroupedListHtml(key, items, dateOf, rowHtml){
  const cfg = periodCfg(crmCurrentTerm(), key);
  if(cfg.n < 2) return items.map(rowHtml).join('');
  const now = currentPeriodOf(cfg);
  const pOf = it => itemPeriodFor(it, dateOf, cfg);
  let html = '';
  for(let p = now; p >= 1; p--){
    const grp = items.filter(it => pOf(it) === p);
    if(!grp.length) continue;
    const st = p === now && !cfg.ended ? 'جارية' : 'منتهية';
    html += `<div class="tlx-sec crm-per-grp">${PERIOD_NAMES[p]} · ${st} (${grp.length})</div>` + grp.map(rowHtml).join('');
  }
  return html;
}

/* رابط «إدارة الفترات» في آخر شرح «؟» (عدد الفترات، إنهاء الأخيرة، التراجع لاحقًا) — للمكوّن الذي له أكثر من فترة */
function crmHelpPeriodsLinkHtml(s){
  const info = sheetPeriodInfo(s);
  if(!info || info.cfg.n < 2) return '';
  return `<button type="button" class="csc-help-link" onclick="openCrmPeriodPicker()">⚙ إدارة الفترات (العدد، إنهاء الأخيرة، التراجع) ←</button>`;
}

/* «إدارة الفترات» (داخل «؟») يفتح نافذة «الفترات» (إنهاء الفترة، القفل، الفتح للتعديل) */
function openCrmPeriodPicker(){
  const info = sheetPeriodInfo(crmSheet);
  if(!info || info.cfg.n < 2) return;
  openPeriodsWindow(info.key);
}

/* من نافذة الفترات إلى إعداد الدرجات مباشرة (تُغلق ورقة الحصة والمسودة محفوظة) */
async function openGradeSettingsFromPeriodPicker(){
  closeCrmModal();
  await openGradeSettingsFromAnywhere();
}

/* ============ قفل الفترات المنتهية (3.61) ============
   الفترة التي أنهاها المعلم تُقفل في القاعدة نفسها (grade_lock_guard): لا رصد ولا تعديل ولا حذف فيها حتى «فتح للتعديل».
   الحالة في user_app_settings.period_locks (عمود مستقل لا يكتبه حفظ الإعدادات): {"سنة|فصل": {"<مكوّن>": {periods: {p: {from, before}}}}}.
   لكل فترة قفل مستقل (3.71؛ PERIODS.md قاعدة 6). المرصود بفترة: بالفترة؛ المؤرَّخ (واجب/مهمة/حصة أداة): بمدى تواريخ الفترة المقفلة. */
let gradePeriodLocks = {};

async function loadPeriodLocks(uid){
  gradePeriodLocks = {};
  try{ /* قبل تشغيل ملف التحديثات (لا عمود): بلا قفل، ولا يتعطّل شيء */
    const { data, error } = await sb.from('user_app_settings').select('period_locks').eq('user_id', uid).maybeSingle();
    if(!error && data && data.period_locks && typeof data.period_locks === 'object') gradePeriodLocks = data.period_locks;
  } catch(e){}
}

function isLockableKey(key){ return /^(kind:(participation|homework|task)|tool:[0-9a-f-]{36})$/i.test(String(key || '')); }

/* القفل لكل فترة مستقل (3.71): {"periods": {"1": {from, before}, "2": {...}}} — فتح الأولى لا يمسّ الثانية.
   الشكل القديم {p, before} («مقفلة حتى p») يُقرأ كما هو (لا ترحيل): الفترات 1..p، والمؤرَّخ بما قبل before.
   ترجع { set: Set الفترات المقفلة، ranges: {p: {from, before}} | null، oldBefore } أو null */
function periodLockOf(term, key){
  const t = gradePeriodLocks && gradePeriodLocks[termPeriodKey(term)];
  const l = t && t[key];
  if(!l || typeof l !== 'object') return null;
  if(l.periods && typeof l.periods === 'object'){
    const ranges = {};
    Object.keys(l.periods).forEach(k => {
      const n = Number(k), r = l.periods[k];
      if(Number.isInteger(n) && n >= 1 && n <= PERIOD_COUNT_MAX && r && typeof r === 'object') ranges[n] = { from: r.from || null, before: r.before || null };
    });
    const set = new Set(Object.keys(ranges).map(Number));
    return set.size ? { set, ranges, oldBefore: null } : null;
  }
  const p = Number(l.p);
  return p > 0 ? { set: new Set([1, 2, 3].filter(x => x <= p)), ranges: null, oldBefore: l.before || null } : null;
}

function lockedPeriodsOf(term, key){ const l = periodLockOf(term, key); return l ? l.set : new Set(); }

/* opts: { period } للمرصود بفترة، أو { date } للمؤرَّخ */
function isPeriodLocked(term, key, opts){
  const l = periodLockOf(term, key);
  if(!l || !opts) return false;
  if(opts.period) return l.set.has(Number(opts.period));
  if(!opts.date) return false;
  if(!l.ranges) return !!(l.oldBefore && opts.date < l.oldBefore);
  return Object.values(l.ranges).some(r => r.before && (!r.from || opts.date >= r.from) && opts.date < r.before);
}

/* يوم بداية الفترة التالية لـ p (ما قبله مقفل). الأخيرة المنتهية: كل ما مضى */
function lockBeforeFor(cfg, p){
  return p < cfg.n ? (cfg.starts[p - 1] || null) : '9999-12-31';
}

/* مدى تواريخ الفترة p (للمؤرَّخ: واجب/مهمة قديمة بلا فترة، رصد أداة الحالة بيوم الحصة) */
function periodRangeFor(cfg, p){
  return { from: p > 1 ? (cfg.starts[p - 2] || null) : null, before: lockBeforeFor(cfg, p) || '9999-12-31' };
}

/* يحفظ مجموعة الفترات المقفلة لمكوّن (كلها معًا، ذرّيًا في القاعدة). المدى من إعداد الفترات الحالي */
async function setPeriodLocks(term, key, set){
  const cfg = periodCfg(term, key);
  const periods = {};
  [...set].map(Number).filter(p => p >= 1 && p <= PERIOD_COUNT_MAX).sort().forEach(p => { periods[p] = periodRangeFor(cfg, p); });
  const { data, error } = await sb.rpc('set_period_lock_v2', { p_term: termPeriodKey(term), p_key: key, p_value: Object.keys(periods).length ? { periods } : {} });
  if(error) throw error;
  if(data && typeof data === 'object') gradePeriodLocks = data;
}

/* قفل/فتح فترة واحدة فقط (لا تمسّ غيرها) */
async function setPeriodLockOne(term, key, p, locked){
  const set = new Set(lockedPeriodsOf(term, key));
  if(locked) set.add(Number(p)); else set.delete(Number(p));
  return setPeriodLocks(term, key, set);
}

/* ورقة الحصة: هل رصدها داخل فترة مقفلة؟ (المرصود بفترة: بالفترة، والمؤرَّخ: بيوم الحصة) */
function crmSheetLockedKey(s, period){
  const key = s && periodCompKeyOfMode(s.mode);
  if(!key || !isLockableKey(key)) return null;
  const term = crmCurrentTerm();
  return (periodKeyIsDirect(key) ? isPeriodLocked(term, key, { period }) : isPeriodLocked(term, key, { date: s.dateIso })) ? key : null;
}
const periodKeyAttr = key => escapeHtml(key).replace(/'/g, '&#39;');

/* شريط الفترة المقفلة: للمرصود بفترة زر «فتح للتعديل» مباشرة (بلا نافذة)، وإلا زر «الفترات» */
function crmLockBannerHtml(key, period){
  const k = periodKeyAttr(key);
  const act = period && isLockableKey(key) && isPeriodLocked(crmCurrentTerm(), key, { period })
    ? `<button type="button" class="tlx-btn is-navy gs-period-btn" onclick="quickUnlockPeriod('${k}', ${period})">فتح للتعديل</button>`
    : `<button type="button" class="tlx-btn is-ghost" onclick="openPeriodsWindow('${k}')">الفترات</button>`;
  return `<div class="crm-lock-banner" role="status">🔒 ${period ? PERIOD_NAMES[period] : 'هذه الفترة'} مقفلة — للعرض فقط.${act}</div>`;
}

/* شريط الفترة المنتهية المفتوحة: «🔒 أقفلها» بنقرة */
function crmOpenBannerHtml(key, period, label){
  return `<div class="crm-open-banner" role="status">✏️ ${label || PERIOD_NAMES[period]} مفتوحة للتعديل
    <button type="button" class="tlx-btn is-navy gs-period-btn" onclick="quickLockPeriod('${periodKeyAttr(key)}', ${period})">🔒 أقفلها</button></div>`;
}

function periodIsEnded(cfg, p){ const now = currentPeriodOf(cfg); return p < now || (p === now && !!cfg.ended); }

/* ورقة الحصة: المعروضة فترة منتهية غير مقفلة لمكوّن يُقفل؟ */
function crmSheetOpenBannerHtml(s){
  const info = sheetPeriodInfo(s);
  if(!info || info.cfg.n < 2 || !isLockableKey(info.key) || !sheetPeriodSwitchable(info.key) || !periodIsEnded(info.cfg, info.period)) return '';
  if(isPeriodLocked(crmCurrentTerm(), info.key, { period: info.period })) return '';
  return crmOpenBannerHtml(info.key, info.period);
}

/* ورقة الواجب/المهمة: الفترة المعروضة مقفلة (فتح بنقرة) أو منتهية مفتوحة (قفل بنقرة) */
function crmSheetPeriodStateHtml(s){
  return `<div id="crmPerState">${crmSheetPeriodStateInner(s)}</div>`;
}
function crmSheetPeriodStateInner(s){
  const info = sheetPeriodInfo(s);
  if(!info || info.cfg.n < 2 || !isLockableKey(info.key) || !sheetPeriodSwitchable(info.key)) return '';
  if(isPeriodLocked(crmCurrentTerm(), info.key, { period: info.period })) return crmLockBannerHtml(info.key, info.period);
  return crmSheetOpenBannerHtml(s);
}

/* ============ فتح/قفل سريع من الورقة والكشف (بلا نافذة الفترات) ============
   كل فترة وحدها (3.71). periodReopened["سنة|فصل|مكوّن"] = Set الفترات التي فُتحت سريعًا — للتذكير بقفلها عند إغلاق الورقة. */
let periodReopened = {};
const reopenKey = (term, key) => termPeriodKey(term) + '|' + key;

async function quickUnlockPeriod(key, p){
  p = Number(p);
  if(gradePeriodSaving || !currentUser || !isLockableKey(key)) return false;
  const term = crmCurrentTerm();
  if(!isPeriodLocked(term, key, { period: p })) return false;
  const ok = await quickSetPeriodLock(term, key, p, false, `فُتحت ${PERIOD_NAMES[p]} للتعديل ✓`);
  if(ok){ const rk = reopenKey(term, key); (periodReopened[rk] = periodReopened[rk] || new Set()).add(p); }
  return ok;
}

async function quickLockPeriod(key, p){
  p = Number(p);
  if(gradePeriodSaving || !currentUser || !isLockableKey(key)) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key); /* أحدث إعداد: لو تراجع عن الفترة من جهاز آخر لا تُقفل جارية */
  if(!periodIsEnded(cfg, p)) return false;
  const rk = reopenKey(term, key);
  const done = () => { if(periodReopened[rk]){ periodReopened[rk].delete(p); if(!periodReopened[rk].size) delete periodReopened[rk]; } };
  if(isPeriodLocked(term, key, { period: p })){ done(); return true; }
  const ok = await quickSetPeriodLock(term, key, p, true, `أُقفلت ${PERIOD_NAMES[p]} ✓`);
  if(ok) done();
  return ok;
}

/* فتح/قفل فوري (3.71): الشاشة تتغيّر لحظة الضغط، والحفظ في الخلفية؛ لا يُعاد تحميل الورقة (القفل لا يغيّر درجة).
   فشل الحفظ: تعود الشاشة كما كانت ورسالة. القاعدة تبقى الحَكَم (grade_lock_guard). */
async function quickSetPeriodLock(term, key, p, locked, okMsg){
  const prev = gradePeriodLocks;
  const set = new Set(lockedPeriodsOf(term, key));
  if(locked) set.add(p); else set.delete(p);
  gradePeriodLocks = localLocksWith(term, key, set);
  gradePeriodSaving = true;
  repaintPeriodLockUi();
  let ok = false;
  try{ await setPeriodLocks(term, key, set); ok = true; }
  catch(e){ gradePeriodLocks = prev; }
  finally { gradePeriodSaving = false; }
  repaintPeriodLockUi();
  showToast(ok ? okMsg : 'تعذّر الحفظ — أعد المحاولة', ok ? 'ok' : 'error');
  return ok;
}

/* نسخة محلية من الأقفال بعد التغيير (كما ستكتبها القاعدة) */
function localLocksWith(term, key, set){
  const cfg = periodCfg(term, key), tk = termPeriodKey(term);
  const all = Object.assign({}, gradePeriodLocks), t = Object.assign({}, all[tk]);
  const periods = {};
  [...set].sort().forEach(p => { periods[p] = periodRangeFor(cfg, p); });
  if(Object.keys(periods).length) t[key] = { periods }; else delete t[key];
  all[tk] = t;
  return all;
}

/* يعيد رسم ما يتعلّق بالقفل فقط من الذاكرة: المبدّل، وشريط مقفلة/مفتوحة، وأزرار التعبئة، والكشف بفترة — بلا طلب للقاعدة */
function repaintPeriodLockUi(){
  const s = typeof crmSheet === 'undefined' ? null : crmSheet;
  if(s && s.mode){
    const bar = document.getElementById('crmPerBar');
    const html = crmPeriodChipHtml(s, s.perExtra);
    if(bar && html) bar.outerHTML = html;
    const st = document.getElementById('crmPerState');
    if(st) st.innerHTML = crmSheetPeriodStateInner(s);
    if(s.part){ s.part.locked = !!crmSheetLockedKey(s, s.part.period); if(typeof crmPartCardPaint === 'function') crmPartCardPaint(); }
  }
  document.querySelectorAll('.gs-period-btn').forEach(b => { b.disabled = gradePeriodSaving; });
  const tab = document.getElementById('crmTabGrades');
  if(tab && tab.style.display !== 'none' && typeof paintCrmGradesCached === 'function' && typeof crmGrades !== 'undefined' && crmGrades) paintCrmGradesCached();
}


/* عند إغلاق ورقة الحصة: فترة فُتحت سريعًا وما زالت مفتوحة ← سؤال واحد «أقفلها؟» لكل فترة (مرة واحدة لا يتكرر) */
async function remindReopenedPeriods(){
  const term = crmCurrentTerm();
  const pref = termPeriodKey(term) + '|';
  for(const rk of Object.keys(periodReopened)){
    if(rk.indexOf(pref) !== 0) continue;
    const key = rk.slice(pref.length), ps = [...periodReopened[rk]].sort();
    delete periodReopened[rk];
    for(const p of ps){
      if(isPeriodLocked(term, key, { period: p }) || !periodIsEnded(periodCfg(term, key), p)) continue;
      if(!(await showConfirm(`${PERIOD_NAMES[p]} في «${periodCompName(key)}» ما زالت مفتوحة للتعديل — أقفلها الآن؟`))) continue;
      await quickLockPeriod(key, p);
    }
  }
}

function crmLockedToast(){ showToast('الفترة مقفلة — اضغط «فتح للتعديل» أعلى الورقة', 'error'); }

/* ============ الكشف بفترة واحدة (مبدّل «الكل / الأولى / الثانية…» أعلى الكشف) ============
   الأصل «الكل»: قائمة المجاميع، و«رصد» يذهب للفترة الجارية. اختيار فترة يعرض درجاتها وحدها لكل مكوّن بفترات،
   و«رصد» والخانة (للمرصود بفترة) يكتبان فيها — والمقفلة للعرض فقط. في الذاكرة فقط (لا يبقى بعد إعادة الفتح).
   key: جاء من «عدّل درجات … في الكشف» بنافذة الفترات (فيظهر زر «انتهيت — أقفلها» لذلك المكوّن). */
let gradeEditPeriod = null; /* { key|null, period, term } */

function gradeEditPeriodOf(c){
  const m = gradeEditPeriod;
  if(!m || !c || !isDirectPeriodColumn(c)) return null;
  const key = periodCompKeyOfColumn(c);
  if(!key || termPeriodKey({ year: c.academic_year, semester: c.semester }) !== m.term) return null;
  const cfg = periodCfg(crmCurrentTerm(), key);
  if(cfg.n < 2 || m.period > currentPeriodOf(cfg)) return null; /* لا فترات له، أو الفترة لم تبدأ (أو تراجع من جهاز آخر) */
  return m.period;
}

/* أعمدة الكشف التي لها أكثر من فترة، والفترة الأبعد التي بدأت فيها */
function gradePeriodColumns(g){
  return (g && g.columns || []).filter(c => isPeriodColumn(c) && gradeColumnPeriodCfg(g, c).n > 1);
}
function gradeMaxStartedPeriod(g){
  return gradePeriodColumns(g).reduce((m, c) => Math.max(m, currentPeriodOf(gradeColumnPeriodCfg(g, c))), 1);
}
function gradeMaxPeriodCount(g){
  return gradePeriodColumns(g).reduce((m, c) => Math.max(m, gradeColumnPeriodCfg(g, c).n), 1);
}

/* الفترة المعروضة في الكشف الآن (null = الكل) — تُبطَل إن تغيّر الفصل */
function crmGradesViewPeriod(g){
  const m = gradeEditPeriod;
  if(!m) return null;
  if(termPeriodKey(crmCurrentTerm()) !== m.term){ gradeEditPeriod = null; return null; }
  if(g && (!gradePeriodColumns(g).length || m.period > gradeMaxStartedPeriod(g))) return null;
  return m.period;
}

function setCrmGradesPeriod(p){
  p = Number(p) || 0;
  const g = crmGrades;
  if(!p) gradeEditPeriod = null;
  else {
    if(!g || p > gradeMaxStartedPeriod(g)) return;
    const m = gradeEditPeriod;
    gradeEditPeriod = { key: m && m.period === p ? m.key : null, period: p, term: termPeriodKey(crmCurrentTerm()) };
  }
  crmGradeStudentId = null;
  if(typeof paintCrmGradesCached === 'function') paintCrmGradesCached();
}

/* المبدّل أعلى الكشف — يظهر فقط إن كان لمكوّن أكثر من فترة */
function crmGradesPeriodBarHtml(g){
  if(!g || !gradePeriodColumns(g).length || crmGradeStudentId) return '';
  const cur = crmGradesViewPeriod(g);
  const started = gradeMaxStartedPeriod(g);
  const btn = (p, label, sub) => `<button type="button" class="${cur === p ? 'is-on' : ''}" aria-pressed="${cur === p}"${p && p > started ? ' disabled' : ` onclick="setCrmGradesPeriod(${p || 0})"`}>${label}<small>${sub}</small></button>`;
  const segs = [btn(null, 'الكل', 'المجموع')].concat([1, 2, 3].slice(0, gradeMaxPeriodCount(g))
    .map(p => btn(p, PERIOD_NAMES[p].replace('الفترة ', ''), p > started ? 'لم تبدأ' : p === started ? 'جارية' : 'منتهية')));
  return `<div class="crm-per-bar crm-gs-perbar"><div class="tlx-seg crm-per-seg" role="group" aria-label="الفترة المعروضة">${segs.join('')}</div></div>${gradeEditBannerHtml()}`;
}

/* سطر تحت المبدّل حين تُعرض فترة: أين يذهب الرصد، وزر «انتهيت — أقفلها» إن جاء من نافذة الفترات */
function gradeEditBannerHtml(){
  const p = crmGradesViewPeriod(typeof crmGrades === 'undefined' ? null : crmGrades);
  if(!p) return '';
  const m = gradeEditPeriod;
  const term = crmCurrentTerm();
  const name = m.key ? escapeHtml(periodCompName(m.key)) : '';
  const locked = !!m.key && isPeriodLocked(term, m.key, { period: p });
  return `<div class="pt-edit-banner" role="status"><b>تعرض درجات ${PERIOD_NAMES[p]} فقط</b>
    <small>${locked ? `${PERIOD_NAMES[p]} مقفلة في «${name}» — افتحها بزر «فتح للتعديل» أدناه.` : `ما ترصده هنا يُحفظ في ${PERIOD_NAMES[p]}. الواجبات والمهام تُحسب من رصدها بتواريخه.`}</small>
    <div class="pt-edit-acts"><button type="button" class="tlx-btn is-ghost gs-period-btn" onclick="finishGradeEditPeriod(false)">عرض الكل</button></div></div>`;
}

/* الكشف بفترة واحدة: طالب × مكوّن بفترات، درجة الفترة وحدها. المرصود بفترة يُعدَّل بالضغط (إلا المقفلة) */
function crmGradePeriodViewHtml(g, p){
  const term = { year: g.year, semester: g.semester };
  const students = crmStudentsOfSection(g.sectionId);
  const cols = gradePeriodColumns(g).filter(c => { const cfg = gradeColumnPeriodCfg(g, c); return cfg.n >= p && p <= currentPeriodOf(cfg); });
  if(!cols.length) return `<div class="empty-state">لا مكوّن له ${PERIOD_NAMES[p]}.</div>`;
  if(!students.length) return '<div class="empty-state">لا طلاب مربوطون بهذه الشعبة.</div>';
  const info = cols.map(c => {
    const key = periodCompKeyOfColumn(c);
    const locked = isLockableKey(key) && isPeriodLocked(term, key, { period: p });
    const edit = !locked && isDirectPeriodColumn(c) && crmGradeColumnEditable(c) && !!(g.breakdown && g.breakdown.has(c.id));
    const per = g.breakdown && g.breakdown.get(c.id);
    const val = id => { const b = per && per.get(id); const v = b ? b['p' + p] : null; return v === null || v === undefined ? null : Number(v); };
    return { c, key, locked, edit, val };
  });
  const k = x => escapeHtml(x.key).replace(/'/g, '&#39;');
  const rec = info.filter(x => x.edit);
  /* فتح/قفل كل مكوّن بنقرة (للفترة المنتهية) */
  let html = info.filter(x => isLockableKey(x.key) && periodIsEnded(gradeColumnPeriodCfg(g, x.c), p)).map(x => {
    const nm = `${PERIOD_NAMES[p]} في «${escapeHtml(x.c.name)}»`;
    if(!x.locked) return crmOpenBannerHtml(x.key, p, nm);
    return `<div class="crm-lock-banner" role="status">🔒 ${nm} مقفلة.<button type="button" class="tlx-btn is-navy gs-period-btn" onclick="quickUnlockPeriod('${k(x)}', ${p})">فتح للتعديل</button></div>`;
  }).join('');
  html += rec.length ? `<div class="crm-gs-rec"><span>رصد ${PERIOD_NAMES[p].replace('الفترة ', '')}:</span>${rec.map(x =>
    `<button type="button" class="crm-gs-recchip" onclick="openCrmGradeEntry('${x.c.id}')">${escapeHtml(x.c.name)}</button>`).join('')}</div>` : '';
  html += '<div class="crm-grade-holder"><div class="crm-grade-wrap"><table class="crm-grade-table crm-per-table"><thead><tr><th class="crm-grade-name">الطالب</th>';
  info.forEach(x => {
    const tag = x.locked ? `<button type="button" class="crm-per-lock" aria-label="${PERIOD_NAMES[p]} مقفلة — الفترات" onclick="openPeriodsWindow('${k(x)}')">🔒</button>`
      : x.edit ? '' : ' <span title="محسوب تلقائيًا من رصده">⚙</span>';
    html += `<th class="crm-grade-col cat-${x.c.category}">${escapeHtml(x.c.name)}${tag}<span class="crm-grade-max">من ${formatScore(x.c.max_score)}</span></th>`;
  });
  html += '</tr></thead><tbody>';
  students.forEach(st => {
    html += `<tr><td class="crm-grade-name" onclick="openCrmGradeStudentDetail('${st.id}')">${escapeHtml(st.full_name)}</td>`;
    info.forEach(x => {
      const v = x.val(st.id);
      html += `<td class="crm-grade-cell${v === null ? '' : ' gc-' + gradeTone(v, x.c.max_score)}"${x.edit ? ` data-edit="1" onclick="openCrmGradeCell('${x.c.id}', '${st.id}')"` : ''}>${v === null ? '<span class="crm-grade-empty">—</span>' : formatScore(v)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody><tfoot><tr class="crm-grade-avg"><td class="crm-grade-name">متوسط الشعبة</td>';
  info.forEach(x => { const a = periodAverage(students.map(st => x.val(st.id))); html += `<td>${a === null ? '—' : formatScore(a)}</td>`; });
  html += '</tr></tfoot></table></div></div>';
  html += `<p class="crm-gs-note">"—" = لم يُرصد في ${PERIOD_NAMES[p]} (لا يُحسب صفرًا). اضغط اسم الطالب لكل فتراته ومعدّله.${info.some(x => x.edit) ? ' اضغط خانة لتعديلها.' : ''}</p>`;
  return html;
}

/* من نافذة الفترات: يفتح كشف الشعبة الحالية على رصد هذا المكوّن في الفترة المختارة */
async function startGradeEditPeriod(p){
  const key = periodWinCtx && periodWinCtx.key;
  if(!key || !periodKeyIsDirect(key)) return;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  const now = currentPeriodOf(cfg);
  p = Number(p);
  if(!(p >= 1 && (p < now || (p === now && cfg.ended)))) return;
  if(isPeriodLocked(term, key, { period: p })){ crmLockedToast(); return; }
  gradeEditPeriod = { key, period: p, term: termPeriodKey(term) };
  closeCrmModal();
  if(typeof switchCrmTab === 'function' && document.getElementById('crmTabGrades')) switchCrmTab('grades');
  else if(typeof renderCrmGrades === 'function') await renderCrmGrades();
  showToast(`الكشف يعرض ${PERIOD_NAMES[p]} — اضغط «${periodCompName(key)}» للرصد`, 'ok');
}

async function finishGradeEditPeriod(lock){
  const m = gradeEditPeriod;
  if(!m || gradePeriodSaving) return;
  if(lock && isLockableKey(m.key)){
    const term = crmCurrentTerm();
    if(!isPeriodLocked(term, m.key, { period: m.period })){
      const ok = await withPeriodBusy(async () => { await setPeriodLockOne(term, m.key, m.period, true); return true; }, `أُقفلت ${PERIOD_NAMES[m.period]} ✓`);
      if(!ok) return;
    }
  }
  gradeEditPeriod = null;
  if(typeof renderCrmGrades === 'function') renderCrmGrades();
}

/* ============ نافذة «الفترات» ============ */
let periodWinCtx = null;      /* { key } */
let periodTransDraft = null;  /* { key, now, last, start: 'empty'|'full'|'zero' } */

/* أعمدة المكوّن المرصود بفترة في كل الشعب */
async function directPeriodColumns(key){
  return periodKeyIsDirect(key) && typeof termColumnsMatching === 'function'
    ? termColumnsMatching(c => periodCompKeyOfColumn(c) === key && isDirectPeriodColumn(c)) : [];
}

/* إحصاء كل فترة للمرصود بفترة: { [p]: { n, avg } } عبر الشعب */
async function directPeriodStats(cols){
  const out = {};
  if(!cols.length) return out;
  const { data, error } = await sb.from('classroom_grade_period_scores').select('column_id, period, score')
    .eq('teacher_id', currentUser.id).in('column_id', cols.map(c => c.id));
  if(error) throw error;
  const maxOf = new Map(cols.map(c => [c.id, Number(c.max_score) || 1]));
  (data || []).forEach(r => {
    const o = out[r.period] || (out[r.period] = { n: 0, pct: 0 });
    o.n++; o.pct += Number(r.score) / maxOf.get(r.column_id);
  });
  Object.values(out).forEach(o => { o.pct = Math.round(100 * o.pct / o.n); });
  return out;
}

function periodCardsHtml(key, cfg, lock, stats, total){
  const now = currentPeriodOf(cfg);
  return [1, 2, 3].slice(0, cfg.n).map(p => {
    const ended = p < now || (p === now && cfg.ended);
    const locked = ended && !!lock && lock.set.has(p);
    const pill = locked ? '<span class="tlx-pill">🔒 مقفلة</span>'
      : ended ? `<span class="tlx-pill is-gold">${isLockableKey(key) ? 'مفتوحة للتعديل' : 'منتهية'}</span>`
      : p === now ? '<span class="tlx-pill is-gold">جارية</span>' : '<span class="tlx-pill is-blue">لم تبدأ</span>';
    const st = stats && stats[p];
    const meta = p > now ? '—' : stats ? (st ? `رُصد ${st.n}${total ? ' من ' + total : ''} · المتوسط ${st.pct}٪` : 'لا رصد بعد')
      : (p > 1 && cfg.starts[p - 2] ? 'بدأت ' + shortDateAr(cfg.starts[p - 2]) : p === 1 ? 'من بداية الفصل' : '');
    let acts = '';
    if(p === now && !cfg.ended) acts = `<button type="button" class="tlx-btn is-navy gs-period-btn" onclick="openPeriodTransition()">${p < cfg.n ? `أنهِ ${PERIOD_NAMES[p]} وأقفلها ← ابدأ ${PERIOD_NAMES[p + 1]}` : `أنهِ ${PERIOD_NAMES[p]} وأقفلها`}</button>`;
    if(p === now && !cfg.ended && p > 1 && !(stats && stats[p])) acts += '<button type="button" class="tlx-btn is-ghost gs-period-btn" onclick="undoPeriodStart()">تراجع عن بدئها</button>';
    else if(locked) acts = `<button type="button" class="tlx-btn is-ghost gs-period-btn" onclick="unlockLatestPeriod(${p})">فتح للتعديل</button>`;
    else if(ended && !locked){
      if(periodKeyIsDirect(key)) acts += `<button type="button" class="tlx-btn is-navy gs-period-btn" onclick="startGradeEditPeriod(${p})">✏️ عدّل درجات ${PERIOD_NAMES[p].replace('الفترة ', '')} في الكشف ←</button>`;
      if(isLockableKey(key)) acts += `<button type="button" class="tlx-btn is-ghost gs-period-btn" onclick="lockNextEndedPeriod(${p})">🔒 أقفلها</button>`;
    }
    return `<div class="pw-card${p === now && !cfg.ended ? ' is-cur' : ''}"><div class="pw-top"><b>${PERIOD_NAMES[p]}</b>${pill}</div>
      <div class="pw-meta">${escapeHtml(meta)}</div>${acts ? `<div class="pw-acts">${acts}</div>` : ''}</div>`;
  }).join('');
}

async function openPeriodsWindow(key){
  if(!isPeriodCompKey(key) || !currentUser) return;
  const ctx = { key };
  periodWinCtx = ctx;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  const head = `<h3 style="margin:0 0 2px;font-size:16px;color:var(--navy);">فترات «${escapeHtml(periodCompName(key))}»</h3>
    <p style="font-size:12px;color:var(--ui-body);line-height:1.8;margin:0 0 10px;">الدرجة في الكشف = معدّل الفترات المنتهية (الجارية تُحسب عند انتهائها). الفترة المنتهية مقفلة: لا يتغيّر فيها شيء إلا بـ«فتح للتعديل».</p>`;
  const foot = `<button type="button" class="tlx-btn is-ghost" style="margin-top:8px;" onclick="openGradeSettingsFromPeriodPicker()">⚙ عدد الفترات والإعدادات</button>`;
  if(cfg.n < 2){
    showInfoModal(`<div style="text-align:right;">${head}<p class="tlx-note">«${escapeHtml(periodCompName(key))}» فترة واحدة. اختر عدد الفترات من الإعدادات.</p>${foot}</div>`, '440px');
    return;
  }
  const lock = periodLockOf(term, key);
  showInfoModal(`<div style="text-align:right;">${head}${periodCardsHtml(key, cfg, lock, null, 0)}${foot}</div>`, '440px');
  try{
    const cols = await directPeriodColumns(key);
    if(!cols.length || periodWinCtx !== ctx) return;
    const stats = await directPeriodStats(cols);
    const total = cols.reduce((n, c) => n + crmStudentsOfSection(c.section_id).length, 0);
    if(periodWinCtx !== ctx) return;
    showInfoModal(`<div style="text-align:right;">${head}${periodCardsHtml(key, cfg, periodLockOf(term, key), stats, total)}${foot}</div>`, '440px');
  } catch(e){} /* الإحصاء تكميلي */
}

const PERIOD_TRANS_START = [['empty', 'فارغة'], ['full', 'الجميع درجة كاملة'], ['zero', 'الجميع 0']];

/* الخطوة ١: ملخص الفترة التي تُغلق — تبليغ فقط، لا يُكتب لمن بلا درجة شيء (يرصده المعلم بيده من الكشف إن شاء) */
function periodTransSummaryHtml(d, sum){
  const now = PERIOD_NAMES[d.now];
  const lockTxt = isLockableKey(d.key) ? 'تُقفل كما هي' : 'تبقى كما هي';
  if(!periodKeyIsDirect(d.key)) return `<div class="pt-sum">${escapeHtml(`ما تاريخه قبل اليوم يبقى في ${now} — ${lockTxt}.`)}</div>`;
  if(!sum) return '<div class="pt-sum">…</div>';
  const missing = sum.total - sum.n;
  const head = `${missing ? '' : '✓ '}رُصد ${sum.n} من ${sum.total}${sum.n ? ` · المتوسط ${sum.pct}٪` : ''}`;
  return `<div class="pt-sum${missing ? '' : ' is-ok'}"><b>${head}</b><small>${missing ? 'التطبيق لا يكتب لهم شيئًا' : 'لا أحد بلا درجة'} — ${lockTxt}.</small></div>
    ${missing ? `<div class="pt-warn"><b>⚠ ${missing === 1 ? 'طالب واحد' : missing === 2 ? 'طالبان' : missing + ' طلاب'} بلا درجة في ${now}</b><small>تبقى بلا درجة — إن أردت رصدها فارجع للكشف قبل القفل.</small></div>` : ''}`;
}

function periodTransHtml(d, sum){
  const name = escapeHtml(periodCompName(d.key));
  const seg = (field, opts) => `<div class="tlx-seg pt-seg" data-f="${field}">${opts.map(([v, l]) =>
    `<button type="button" class="${d[field] === v ? 'is-on' : ''}" aria-pressed="${d[field] === v}" onclick="setPeriodTrans('${field}', '${v}')">${l}</button>`).join('')}</div>`;
  const direct = periodKeyIsDirect(d.key);
  const step = (n, t) => `<div class="pt-step"><i>${n}</i>${t}</div>`;
  return `<div style="text-align:right;">
    <h3 style="margin:0 0 4px;font-size:16px;color:var(--navy);">${d.last ? `إنهاء ${PERIOD_NAMES[d.now]}` : `من ${PERIOD_NAMES[d.now]} إلى ${PERIOD_NAMES[d.now + 1]}`}</h3>
    <div style="font-size:12px;color:var(--muted);">«${name}» · في كل شعبك</div>
    ${step('١', `${PERIOD_NAMES[d.now]} — ${isLockableKey(d.key) ? 'تُغلق وتُقفل' : 'تُغلق'}`)}
    <div id="ptSummary">${periodTransSummaryHtml(d, sum)}</div>
    <a href="#" class="pt-link" onclick="event.preventDefault();reviewPeriodInSheet()">راجع درجات ${PERIOD_NAMES[d.now].replace('الفترة ', '')} في الكشف ←</a>
    ${direct && !d.last ? `${step('٢', `كيف تبدأ ${PERIOD_NAMES[d.now + 1]}؟`)}${seg('start', PERIOD_TRANS_START)}` : ''}
    ${isLockableKey(d.key) ? `<p class="tlx-note" style="margin:12px 0 10px;">بعد القفل لا يتغيّر في ${PERIOD_NAMES[d.now]} شيء إلا بـ«فتح للتعديل».</p>` : '<div style="height:12px;"></div>'}
    <button type="button" class="tlx-btn is-navy" id="ptGoBtn" onclick="applyPeriodTransition()">${d.last ? `أنهِ ${isLockableKey(d.key) ? 'وأقفل ' : ''}${PERIOD_NAMES[d.now]}` : `${isLockableKey(d.key) ? 'أقفل' : 'أنهِ'} ${PERIOD_NAMES[d.now]} وابدأ ${PERIOD_NAMES[d.now + 1]}`}</button>
    <button type="button" class="tlx-btn is-ghost" style="margin-top:8px;" onclick="openPeriodsWindow(periodTransDraft && periodTransDraft.key)">→ رجوع</button>
  </div>`;
}

/* من الانتقال إلى الكشف (قبل القفل) — المسودة تُلغى ويعود المعلم للنافذة متى شاء */
function reviewPeriodInSheet(){
  periodTransDraft = null;
  closeCrmModal();
  if(typeof switchCrmTab === 'function' && document.getElementById('crmTabGrades')) switchCrmTab('grades');
}

async function openPeriodTransition(){
  const key = periodWinCtx && periodWinCtx.key;
  if(!key || gradePeriodSaving) return;
  const cfg = periodCfg(crmCurrentTerm(), key);
  const now = currentPeriodOf(cfg);
  if(cfg.n < 2 || cfg.ended) return;
  const d = { key, now, last: now === cfg.n, start: 'empty' };
  periodTransDraft = d;
  showInfoModal(periodTransHtml(d, null), '440px');
  await loadPeriodTransSummary(d);
}

function setPeriodTrans(field, v){
  const d = periodTransDraft;
  const opts = field === 'start' ? PERIOD_TRANS_START : null;
  if(!d || !opts || !opts.some(o => o[0] === v)) return;
  d[field] = v;
  document.querySelectorAll(`.pt-seg[data-f="${field}"] button`).forEach((b, i) => {
    const on = opts[i][0] === v;
    b.className = on ? 'is-on' : '';
    b.setAttribute('aria-pressed', String(on));
  });
}

/* الانتقال بالترتيب: حفظ الفترات ← القفل ← بداية الجديدة (إن اختارها المعلم، كرصد يدوي في سجل الدرجات).
   المنتهية لا يُكتب فيها شيء: من بلا درجة يبقى بلا درجة (تبليغ فقط) */
async function applyPeriodTransition(opts){
  const d = periodTransDraft;
  if(!d || gradePeriodSaving || !currentUser) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, d.key);
  if(currentPeriodOf(cfg) !== d.now || cfg.ended || cfg.n < 2){ closeCrmModal(); showToast('تغيّرت الفترات من جهاز آخر — افتح النافذة من جديد', 'error'); return false; }
  closeCrmModal();
  periodTransDraft = null;
  const valueOf = (c, how) => how === 'full' ? Number(c.max_score) : 0;
  let lockFailed = false;
  const ok = await withPeriodBusy(async () => {
    const cols = await directPeriodColumns(d.key);
    const next = d.last ? Object.assign({}, cfg, { ended: true }) : Object.assign({ n: cfg.n, starts: periodStartsFor(cfg, d.now + 1, localIsoDate()) }, cfg.live ? { live: true } : {});
    if(!d.last) await freezeItemPeriods(d.key, term, cfg); /* واجبات/مهام الفترة المنتهية تبقى فيها */
    if(!(await savePeriodCfg(term, d.key, next))) return false;
    if(isLockableKey(d.key)){
      try{ await setPeriodLockOne(term, d.key, d.now, true); }
      catch(e){ lockFailed = true; } /* الانتقال تمّ؛ القفل يحتاج تحديث القاعدة */
    }
    if(!d.last && d.start !== 'empty'){
      for(const c of cols) await fillPeriodScoresMissing(c, crmStudentsOfSection(c.section_id).map(st => st.id), d.now + 1, valueOf(c, d.start));
    }
    return true;
  }, opts && opts.quiet ? null : d.last ? `انتهت ${PERIOD_NAMES[d.now]} وأُقفلت ✓` : `أُقفلت ${PERIOD_NAMES[d.now]} وبدأت ${PERIOD_NAMES[d.now + 1]} ✓`);
  if(ok && lockFailed) showToast('تمّ الانتقال، وتعذّر القفل — يحتاج تحديث قاعدة البيانات', 'error');
  if(ok && crmSheet && crmSheet.mode && periodCompKeyOfMode(crmSheet.mode) === d.key) await setCrmSheetMode(crmSheet.mode);
  return ok;
}

/* من نافذة الفترات: فتح فترة مقفلة بعينها (p؛ بلا p: آخر مقفلة) — لا تمسّ غيرها */
async function unlockLatestPeriod(p){
  const key = periodWinCtx && periodWinCtx.key;
  if(!key || gradePeriodSaving) return;
  const term = crmCurrentTerm();
  const set = lockedPeriodsOf(term, key);
  p = Number(p) || Math.max(0, ...set);
  if(!set.has(p)) return;
  closeCrmModal();
  if(!(await showConfirm(`فتح ${PERIOD_NAMES[p]} في «${periodCompName(key)}» للتعديل؟ تستطيع تعديل رصدها، ثم أقفلها من جديد.`))) return;
  await withPeriodBusy(async () => { await setPeriodLockOne(term, key, p, false); return true; },
    `${PERIOD_NAMES[p]} مفتوحة للتعديل — أقفلها بعد الانتهاء`);
  openPeriodsWindow(key);
}

/* من نافذة الفترات: قفل فترة منتهية بعينها (p؛ بلا p: أول منتهية غير مقفلة) */
async function lockNextEndedPeriod(p){
  const key = periodWinCtx && periodWinCtx.key;
  if(!key || gradePeriodSaving || !isLockableKey(key)) return;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  p = Number(p) || [1, 2, 3].find(x => x <= cfg.n && periodIsEnded(cfg, x) && !isPeriodLocked(term, key, { period: x }));
  if(!p || !periodIsEnded(cfg, p) || isPeriodLocked(term, key, { period: p })) return;
  await withPeriodBusy(async () => { await setPeriodLockOne(term, key, p, true); return true; }, `أُقفلت ${PERIOD_NAMES[p]} ✓`);
  openPeriodsWindow(key);
}

/* ============ علامة «؟» في ترويسة عمود الكشف: كيف تُحسب الفترات (شرح فقط، لا يغيّر حسابًا) ============ */
const PERIOD_HELP_STATE_TEXT = { on: 'تُحسب', cur: 'تُحسب (جارية)', wip: 'جارية — لا تُحسب بعد', off: 'لم تبدأ' };

/* حالة كل فترة من إعداد المكوّن: on محسوبة، cur محسوبة وجارية، wip جارية ولا تُحسب بعد، off لم تبدأ */
function periodHelpState(cfg){
  const now = currentPeriodOf(cfg);
  const counted = countedPeriodsOf(cfg) || cfg.n;
  const rows = [];
  for(let p = 1; p <= cfg.n; p++){
    rows.push({ p, state: p > now ? 'off' : p <= counted ? (p === now && !cfg.ended ? 'cur' : 'on') : 'wip' });
  }
  return { rows, now, counted, pending: !cfg.ended && now > counted };
}

function periodHelpNote(cfg, st){
  if(cfg.ended) return 'انتهت كل الفترات — الدرجة = معدّل الفترات كلها.';
  if(cfg.live) return 'الخيار مفعّل: الفترة الجارية تُحسب في الدرجة فورًا (من إعداد الدرجات).';
  if(st.pending) return `الدرجة الآن = معدّل الفترات المنتهية فقط. تدخل ${PERIOD_NAMES[st.now]} ${st.now === cfg.n ? 'حين تنهيها' : 'حين تبدأ ' + PERIOD_NAMES[st.now + 1]}.`;
  return 'الدرجة = الفترة الأولى (الجارية). وكل فترة تدخل الدرجة بعد انتهائها.';
}

function periodHelpHtml(name, key, cfg){
  const st = periodHelpState(cfg);
  const k = escapeHtml(key).replace(/'/g, '&#39;');
  const act = `<button type="button" class="tlx-btn is-navy" onclick="openPeriodsWindow('${k}')">الفترات ←</button>`;
  return `<div class="pq-sheet" style="text-align:right;">
    <h3 style="margin:0 0 10px;font-size:15px;color:var(--navy);">كيف تُحسب «${escapeHtml(name)}»؟</h3>
    ${st.rows.map(r => `<div class="pq-row is-${r.state}"><span>${PERIOD_NAMES[r.p]}</span><span>${PERIOD_HELP_STATE_TEXT[r.state]}</span></div>`).join('')}
    <p class="tlx-note" style="margin:10px 0;">${escapeHtml(periodHelpNote(cfg, st))}</p>
    ${act}
  </div>`;
}

/* الزر داخل ترويسة العمود: للمكوّن الذي له أكثر من فترة فقط */
function periodHelpBtnHtml(g, c){
  if(!isPeriodColumn(c) || gradeColumnPeriodCfg(g, c).n < 2) return '';
  return ` <button type="button" class="crm-period-q" aria-label="كيف تُحسب ${escapeHtml(c.name)}؟" onclick="event.stopPropagation();openCrmPeriodHelp('${c.id}')">؟</button>`;
}

function openCrmPeriodHelp(columnId){
  const g = crmGrades;
  const c = g && (g.columns || []).find(x => x.id === columnId);
  const key = c && periodCompKeyOfColumn(c);
  if(!key) return;
  const cfg = gradeColumnPeriodCfg(g, c);
  if(cfg.n < 2) return;
  showInfoModal(periodHelpHtml(c.name, key, cfg), '420px');
}

/* ============ تعبئة صريحة (بدل «يبدأ من» الملغى): من لا درجة له في الفترة يأخذ value ============ */
/* لا تكتب فوق رصد قائم أو متزامن (only_missing بالقاعدة). ترجع من كُتبت لهم. يرمي عند الفشل (ومنه الفترة المقفلة) */
async function fillPeriodScoresMissing(column, studentIds, period, value){
  const ids = studentIds || [];
  if(!ids.length) return [];
  const res = await Promise.all(ids.map(id => sb.rpc('set_period_score',
    { p_column_id: column.id, p_student_id: id, p_period: period, p_score: Number(value), p_only_missing: true })));
  const err = res.find(r => r.error);
  if(err) throw err.error;
  return ids;
}

/* رسالة خطأ الحفظ: الفترة المقفلة (grade_lock_guard بالقاعدة) بلغة المعلم */
function isGradeLockedError(e){
  return /grade_period_locked/.test(String((e && (e.message || e.details || e.hint)) || e || ''));
}
function gradeSaveErrorText(e){
  return isGradeLockedError(e) ? 'الفترة مقفلة — اضغط «فتح للتعديل» ثم أعد الرصد' : ((e && e.message) || 'خطأ بالاتصال');
}

async function loadPeriodRows(columnId){
  const { data, error } = await sb.from('classroom_grade_period_scores').select('student_id, period, score')
    .eq('teacher_id', currentUser.id).eq('column_id', columnId);
  if(error) throw error;
  return data || [];
}

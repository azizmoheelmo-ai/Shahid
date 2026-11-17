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
  return raw.ended === true && starts.length === n - 1 ? { n, starts, ended: true } : { n, starts };
}

/* كم فترة تُحسب في الدرجة: null = الكل (فترة واحدة)؛ في الأولى: الأولى؛ بعدها: المنتهية فقط؛
   وبعد "أنهِ الفترة الأخيرة": كلها */
function countedPeriodsOf(cfg){
  if(!cfg || cfg.n < 2) return null;
  if(cfg.ended) return cfg.n;
  const cur = currentPeriodOf(cfg);
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
function periodSplitScores(items, dateOf, scoreOf, cfg){
  const c = Array.isArray(cfg) || !cfg ? { n: (cfg || []).length + 1, starts: cfg || [], ended: true } : cfg;
  const starts = c.starts || [];
  const out = { p1: null, p2: null, p3: null, final: null };
  const k = starts.length + 1;
  for(let p = 1; p <= k; p++) out['p' + p] = scoreOf((items || []).filter(it => periodOfDateFor(dateOf(it), starts) === p));
  const counted = countedPeriodsOf(c) || k;
  out.final = periodAverage([out.p1, out.p2, out.p3].slice(0, counted));
  return out;
}

/* ============ الإعداد (يتبع حساب المعلم على كل أجهزته) ============ */
function periodCfg(term, key){ return periodCfgOf(appFeatures, term, key); }

let gradePeriodSaving = false;
async function savePeriodCfg(term, key, cfg){
  const next = normalizeFeatures(appFeatures);
  const all = Object.assign({}, next.periods);
  const t = Object.assign({}, all[termPeriodKey(term)]);
  if(cfg && cfg.n > 1) t[key] = Object.assign({ n: cfg.n, starts: cfg.starts.slice(0, cfg.n - 1) }, cfg.ended && cfg.starts.length >= cfg.n - 1 ? { ended: true } : {}); else delete t[key];
  if(Object.keys(t).length) all[termPeriodKey(term)] = t; else delete all[termPeriodKey(term)];
  if(Object.keys(all).length) next.periods = all; else delete next.periods;
  appFeatures = next;
  await saveAppFeatures();
  const saved = periodCfg(term, key);
  const want = normalizePeriodCfg(cfg) || { n: 1, starts: [] };
  if(saved.n !== want.n || saved.starts.join() !== want.starts.join() || !!saved.ended !== !!want.ended) return false; /* فشل الحفظ: أُعيد المحفوظ */
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

/* من إعداد الدرجات: عدد فترات مكوّن (١–٣). لا يحذف رصدًا أبدًا (3.61): لا تقليل تحت الفترة الجارية،
   ولا تقليل يُخفي فترة فيها رصد */
async function setComponentPeriodCount(key, n){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  n = Number(n);
  if(!(n >= 1 && n <= PERIOD_COUNT_MAX)) return false;
  const term = crmCurrentTerm();
  const cur = periodCfg(term, key);
  if(cur.n === n) return false;
  if(n < cur.n){
    const now = currentPeriodOf(cur);
    if(n < now || (n === now && cur.ended && now === cur.n)){
      showToast(`لا يمكن: ${PERIOD_NAMES[now]} ${cur.ended ? 'انتهت' : 'بدأت'}. الفترات التي بدأت تبقى كما هي`, 'error');
      return false;
    }
    const lock = periodLockOf(term, key);
    if(lock && lock.p > n){ showToast('لا يمكن: فيها فترة مقفلة', 'error'); return false; }
    if(periodKeyIsDirect(key)){
      let later = [];
      try{ later = await laterPeriodRows(key, n); } catch(e){ showToast('تعذّر الفحص — أعد المحاولة', 'error'); return false; }
      if(later.length){ showToast(`لا يمكن: في ${PERIOD_NAMES[n + 1]} رصد محفوظ`, 'error'); return false; }
    }
  }
  return withPeriodBusy(() => savePeriodCfg(term, key, { n, starts: cur.starts.slice(0, n - 1) }),
    `صار "${periodCompName(key)}" ${PERIOD_COUNT_LABELS[n]} ✓`);
}

/* إنهاء الفترة الأخيرة (فتُحسب في الدرجة). التراجع عن الإنهاء فقط وهي غير مقفلة (فالقفل يُفتح أولًا) */
async function endComponentPeriods(key, ended){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  if(cfg.n < 2 || currentPeriodOf(cfg) !== cfg.n || !!cfg.ended === !!ended) return false;
  const lock = periodLockOf(term, key);
  if(!ended && lock && lock.p >= cfg.n){ crmLockedToast(); return false; }
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
    const lock = periodLockOf(term, key);
    if(lock && lock.p >= target){ showToast(`${PERIOD_NAMES[target]} مقفلة — افتحها للتعديل أولًا`, 'error'); return false; }
    if(periodKeyIsDirect(key)){
      let later = [];
      try{ later = await laterPeriodRows(key, target); } catch(e){ showToast('تعذّر الفحص — أعد المحاولة', 'error'); return false; }
      if(later.length){ showToast(`لا رجوع: في ${PERIOD_NAMES[now]} رصد محفوظ`, 'error'); return false; }
    }
  }
  return withPeriodBusy(() => savePeriodCfg(term, key, { n: cfg.n, starts: periodStartsFor(cfg, target, dateIso || localIsoDate()) }), /* الانتقال يلغي "انتهت" */
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
  if(!(await showConfirm(`تراجع عن بدء ${PERIOD_NAMES[now]} في «${periodCompName(key)}»؟ تعود ${PERIOD_NAMES[now - 1]} جارية (يُسمح فقط إن لم تَرصد في ${PERIOD_NAMES[now]} شيئًا).`))) return;
  await goToComponentPeriod(key, now - 1);
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
  showToast(ok ? okMsg : 'تعذّر الحفظ — أعد المحاولة', ok ? 'ok' : 'error');
  const tab = document.getElementById('crmTabGrades');
  if(tab && tab.style.display !== 'none' && typeof renderCrmGrades === 'function') renderCrmGrades();
  return ok;
}

/* ============ شارة الفترة في ورقة الحصة (للمكوّن الذي له أكثر من فترة) ============ */
function sheetPeriodInfo(s){
  const key = s && periodCompKeyOfMode(s.mode);
  if(!key) return null;
  const cfg = periodCfg(crmCurrentTerm(), key);
  return { key, cfg, period: Math.min(cfg.n, periodOfDateFor(s.dateIso, cfg.starts)) };
}

function crmPeriodChipHtml(s){
  const info = sheetPeriodInfo(s);
  if(!info || info.cfg.n < 2) return '';
  return `<button type="button" class="crm-period-chip${info.period > 1 ? ' is-p2' : ''}" onclick="openCrmPeriodPicker()" aria-label="تغيير الفترة">📅 ${PERIOD_NAMES[info.period]} من ${info.cfg.n}${info.cfg.ended ? ' ✓' : ''} ▾</button>`;
}

/* شارة الفترة في ورقة الحصة تفتح نافذة «الفترات» (لا رجوع بنقرة: الرجوع كان يُخفي رصد ما بعدها) */
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
   الحالة في user_app_settings.period_locks (عمود مستقل لا يكتبه حفظ الإعدادات): {"سنة|فصل": {"<مكوّن>": {p, before}}}.
   المرصود بفترة: يُقفل حتى الفترة p. المؤرَّخ (واجب/مهمة/حصة أداة): ما تاريخه قبل before. */
let gradePeriodLocks = {};

async function loadPeriodLocks(uid){
  gradePeriodLocks = {};
  try{ /* قبل تشغيل ملف التحديثات (لا عمود): بلا قفل، ولا يتعطّل شيء */
    const { data, error } = await sb.from('user_app_settings').select('period_locks').eq('user_id', uid).maybeSingle();
    if(!error && data && data.period_locks && typeof data.period_locks === 'object') gradePeriodLocks = data.period_locks;
  } catch(e){}
}

function isLockableKey(key){ return /^(kind:(participation|homework|task)|tool:[0-9a-f-]{36})$/i.test(String(key || '')); }

function periodLockOf(term, key){
  const t = gradePeriodLocks && gradePeriodLocks[termPeriodKey(term)];
  const l = t && t[key];
  return l && Number(l.p) > 0 ? { p: Number(l.p), before: l.before || null } : null;
}

/* opts: { period } للمرصود بفترة، أو { date } للمؤرَّخ */
function isPeriodLocked(term, key, opts){
  const l = periodLockOf(term, key);
  if(!l || !opts) return false;
  if(opts.period) return Number(opts.period) <= l.p;
  return !!(opts.date && l.before && opts.date < l.before);
}

/* يوم بداية الفترة التالية لـ p (ما قبله مقفل). الأخيرة المنتهية: كل ما مضى */
function lockBeforeFor(cfg, p){
  return p < cfg.n ? (cfg.starts[p - 1] || null) : '9999-12-31';
}

async function setPeriodLock(term, key, p, before){
  const { data, error } = await sb.rpc('set_period_lock', { p_term: termPeriodKey(term), p_key: key, p_period: p, p_before: p > 0 ? before : null });
  if(error) throw error;
  if(data && typeof data === 'object') gradePeriodLocks = data;
}

/* ورقة الحصة: هل رصدها داخل فترة مقفلة؟ (المرصود بفترة: بالفترة، والمؤرَّخ: بيوم الحصة) */
function crmSheetLockedKey(s, period){
  const key = s && periodCompKeyOfMode(s.mode);
  if(!key || !isLockableKey(key)) return null;
  const term = crmCurrentTerm();
  return (periodKeyIsDirect(key) ? isPeriodLocked(term, key, { period }) : isPeriodLocked(term, key, { date: s.dateIso })) ? key : null;
}
function crmLockBannerHtml(key, period){
  return `<div class="crm-lock-banner" role="status">🔒 ${period ? PERIOD_NAMES[period] : 'هذه الفترة'} مقفلة — للعرض فقط.
    <button type="button" class="tlx-btn is-ghost" onclick="openPeriodsWindow('${escapeHtml(key).replace(/'/g, '&#39;')}')">الفترات</button></div>`;
}
function crmLockedToast(){ showToast('الفترة مقفلة — افتحها للتعديل من نافذة الفترات', 'error'); }

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
    const locked = ended && lock && p <= lock.p;
    const pill = locked ? '<span class="tlx-pill">🔒 مقفلة</span>'
      : ended ? '<span class="tlx-pill is-gold">منتهية — غير مقفلة</span>'
      : p === now ? '<span class="tlx-pill is-gold">جارية</span>' : '<span class="tlx-pill is-blue">لم تبدأ</span>';
    const st = stats && stats[p];
    const meta = p > now ? '—' : stats ? (st ? `رُصد ${st.n}${total ? ' من ' + total : ''} · المتوسط ${st.pct}٪` : 'لا رصد بعد')
      : (p > 1 && cfg.starts[p - 2] ? 'بدأت ' + shortDateAr(cfg.starts[p - 2]) : p === 1 ? 'من بداية الفصل' : '');
    let acts = '';
    if(p === now && !cfg.ended) acts = `<button type="button" class="tlx-btn is-navy gs-period-btn" onclick="openPeriodTransition()">${p < cfg.n ? `أنهِ ${PERIOD_NAMES[p]} وأقفلها ← ابدأ ${PERIOD_NAMES[p + 1]}` : `أنهِ ${PERIOD_NAMES[p]} وأقفلها`}</button>`;
    if(p === now && !cfg.ended && p > 1 && !(stats && stats[p])) acts += '<button type="button" class="tlx-btn is-ghost gs-period-btn" onclick="undoPeriodStart()">تراجع عن بدئها</button>';
    else if(locked && p === lock.p) acts = '<button type="button" class="tlx-btn is-ghost gs-period-btn" onclick="unlockLatestPeriod()">فتح للتعديل</button>';
    else if(ended && !locked && isLockableKey(key) && p === (lock ? lock.p : 0) + 1) acts = '<button type="button" class="tlx-btn is-ghost gs-period-btn" onclick="lockNextEndedPeriod()">🔒 أقفلها</button>';
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
  if(!periodKeyIsDirect(key)) return;
  try{
    const cols = await directPeriodColumns(key);
    const stats = await directPeriodStats(cols);
    const st = stats[now] || { n: 0, pct: 0 };
    const sum = { n: st.n, pct: st.pct, total: cols.reduce((t, c) => t + crmStudentsOfSection(c.section_id).length, 0) };
    const el = periodTransDraft === d && document.getElementById('ptSummary');
    if(el) el.innerHTML = periodTransSummaryHtml(d, sum);
  } catch(e){
    const el = periodTransDraft === d && document.getElementById('ptSummary');
    if(el) el.innerHTML = '<div class="pt-sum">تعذّر الإحصاء — راجع الكشف</div>';
  }
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
async function applyPeriodTransition(){
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
    const next = d.last ? Object.assign({}, cfg, { ended: true }) : { n: cfg.n, starts: periodStartsFor(cfg, d.now + 1, localIsoDate()) };
    if(!(await savePeriodCfg(term, d.key, next))) return false;
    if(isLockableKey(d.key)){
      try{ await setPeriodLock(term, d.key, d.now, lockBeforeFor(periodCfg(term, d.key), d.now)); }
      catch(e){ lockFailed = true; } /* الانتقال تمّ؛ القفل يحتاج تحديث القاعدة */
    }
    if(!d.last && d.start !== 'empty'){
      for(const c of cols) await fillPeriodScoresMissing(c, crmStudentsOfSection(c.section_id).map(st => st.id), d.now + 1, valueOf(c, d.start));
    }
    return true;
  }, d.last ? `انتهت ${PERIOD_NAMES[d.now]} وأُقفلت ✓` : `أُقفلت ${PERIOD_NAMES[d.now]} وبدأت ${PERIOD_NAMES[d.now + 1]} ✓`);
  if(ok && lockFailed) showToast('تمّ الانتقال، وتعذّر القفل — يحتاج تحديث قاعدة البيانات', 'error');
  if(ok && crmSheet && crmSheet.mode && periodCompKeyOfMode(crmSheet.mode) === d.key) await setCrmSheetMode(crmSheet.mode);
  return ok;
}

async function unlockLatestPeriod(){
  const key = periodWinCtx && periodWinCtx.key;
  if(!key || gradePeriodSaving) return;
  const term = crmCurrentTerm();
  const lock = periodLockOf(term, key);
  if(!lock) return;
  closeCrmModal();
  if(!(await showConfirm(`فتح ${PERIOD_NAMES[lock.p]} في «${periodCompName(key)}» للتعديل؟ تستطيع تعديل رصدها، ثم أقفلها من جديد من نافذة الفترات.`))) return;
  const cfg = periodCfg(term, key);
  const p = lock.p - 1;
  await withPeriodBusy(async () => { await setPeriodLock(term, key, p, p > 0 ? lockBeforeFor(cfg, p) : null); return true; },
    `${PERIOD_NAMES[lock.p]} مفتوحة للتعديل — أقفلها بعد الانتهاء`);
  openPeriodsWindow(key);
}

async function lockNextEndedPeriod(){
  const key = periodWinCtx && periodWinCtx.key;
  if(!key || gradePeriodSaving || !isLockableKey(key)) return;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  const lock = periodLockOf(term, key);
  const p = (lock ? lock.p : 0) + 1;
  const now = currentPeriodOf(cfg);
  if(!(p < now || (p === now && cfg.ended))) return;
  await withPeriodBusy(async () => { await setPeriodLock(term, key, p, lockBeforeFor(cfg, p)); return true; }, `أُقفلت ${PERIOD_NAMES[p]} ✓`);
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
  return isGradeLockedError(e) ? 'الفترة مقفلة — افتحها للتعديل من نافذة الفترات' : ((e && e.message) || 'خطأ بالاتصال');
}

async function loadPeriodRows(columnId){
  const { data, error } = await sb.from('classroom_grade_period_scores').select('student_id, period, score')
    .eq('teacher_id', currentUser.id).eq('column_id', columnId);
  if(error) throw error;
  return data || [];
}

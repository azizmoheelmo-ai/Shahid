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

/* من إعداد الدرجات: عدد فترات مكوّن (١–٣) */
async function setComponentPeriodCount(key, n){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  n = Number(n);
  if(!(n >= 1 && n <= PERIOD_COUNT_MAX)) return false;
  const term = crmCurrentTerm();
  const cur = periodCfg(term, key);
  if(cur.n === n) return false;
  const next = { n, starts: cur.starts.slice(0, n - 1) };
  /* أقل من الفترات: المرصود مباشرة يُحذف رصد ما بعدها فقط (بتأكيد وتراجع) — ترجع الدرجة لما قبلها،
     والمحسوب يُعاد توزيعه بتاريخه (لا شيء يُحذف) */
  let later = [];
  if(n < cur.n && periodKeyIsDirect(key)){
    try{ later = await laterPeriodRows(key, n); } catch(e){ showToast('تعذّر الفحص — أعد المحاولة', 'error'); return false; }
    if(later.length){
      const students = new Set(later.map(r => r.student_id)).size;
      const names = [1, 2, 3].filter(p => p > n && later.some(r => Number(r.period) === p)).map(p => PERIOD_NAMES[p]).join(' و');
      if(!(await showConfirm(`تقليل فترات "${periodCompName(key)}" إلى ${PERIOD_COUNT_LABELS[n]}؟ يُحذف رصد ${names} (${students === 1 ? 'لطالب واحد' : students === 2 ? 'لطالبين' : 'لـ ' + students + ' طلاب'})، وترجع درجاتهم لما قبلها.`))) return false;
    }
  }
  const ok = await withPeriodBusy(async () => {
    if(later.length){
      const { error } = await sb.from('classroom_grade_period_scores').delete()
        .eq('teacher_id', currentUser.id).in('id', later.map(r => r.id));
      if(error) throw error;
    }
    return savePeriodCfg(term, key, next);
  }, `صار "${periodCompName(key)}" ${PERIOD_COUNT_LABELS[n]} ✓`);
  if(ok && later.length && typeof showUndoToast === 'function'){
    const keep = await showUndoToast('حُذف رصد الفترات الزائدة', 6);
    if(!keep) await undoPeriodReduce(term, key, cur, later);
  }
  return ok;
}

/* تراجع: يعود الرصد المحذوف والإعداد كما كانا */
async function undoPeriodReduce(term, key, prevCfg, rows){
  await withPeriodBusy(async () => {
    const { error } = await sb.from('classroom_grade_period_scores').insert(rows);
    if(error) throw error;
    return savePeriodCfg(term, key, prevCfg);
  }, 'عاد الرصد كما كان ✓');
}

/* إنهاء الفترة الأخيرة (فتُحسب في الدرجة)، أو التراجع عن إنهائها */
async function endComponentPeriods(key, ended){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  if(cfg.n < 2 || currentPeriodOf(cfg) !== cfg.n || !!cfg.ended === !!ended) return false;
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

async function goToComponentPeriod(key, target, dateIso){
  if(gradePeriodSaving || !currentUser || !isPeriodCompKey(key)) return false;
  const term = crmCurrentTerm();
  const cfg = periodCfg(term, key);
  const now = currentPeriodOf(cfg);
  if(!(target >= 1 && target <= cfg.n) || (target === now && !cfg.ended)) return false;
  return withPeriodBusy(() => savePeriodCfg(term, key, { n: cfg.n, starts: periodStartsFor(cfg, target, dateIso || localIsoDate()) }), /* الانتقال يلغي "انتهت" */
    target > now ? `بدأت ${PERIOD_NAMES[target]} في "${periodCompName(key)}" ✓` : `رجعت إلى ${PERIOD_NAMES[target]} في "${periodCompName(key)}"`);
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

function openCrmPeriodPicker(){
  const info = sheetPeriodInfo(crmSheet);
  if(!info || info.cfg.n < 2) return;
  const now = currentPeriodOf(info.cfg);
  const sub = p => p === info.period ? 'الجارية الآن' : p < now ? 'رجوع إليها' : p === now + 1 ? 'ابدأها الآن' : 'لم تبدأ';
  const opts = [1, 2, 3].slice(0, info.cfg.n).map(p => `<button type="button" class="crm-period-opt${p === info.period ? ' is-on' : ''}" onclick="pickCrmPeriod(${p})">
      <span><b>${PERIOD_NAMES[p]}</b><small>${sub(p)}</small></span><span class="crm-period-ck">${p === info.period ? '✓' : ''}</span></button>`).join('');
  showInfoModal(`<div style="text-align:right;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 4px;">
      <h3 style="margin:0;font-size:15px;color:var(--navy);">فترات "${escapeHtml(periodCompName(info.key))}"</h3>
      <button type="button" class="crm-ic-btn" aria-label="إعداد الدرجات" title="إعداد الدرجات: التوزيع والفترات" onclick="openGradeSettingsFromPeriodPicker()">⚙</button>
    </div>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.7;">الدرجة في الكشف = معدّل الفترات المنتهية (الجارية تُحسب عند انتهائها). ما رصدته سابقًا يبقى في فترته.</p>
    ${opts}
    ${now === info.cfg.n ? `<button type="button" class="crm-period-opt" onclick="closeCrmModal();endComponentPeriods('${escapeHtml(info.key).replace(/'/g, '&#39;')}', ${!info.cfg.ended})">
      <span><b>${info.cfg.ended ? '↺ ' + PERIOD_NAMES[now] + ' جارية من جديد' : '✓ أنهِ ' + PERIOD_NAMES[now]}</b><small>${info.cfg.ended ? 'لا تُحسب حتى تنهيها' : 'فتُحسب في الدرجة'}</small></span></button>` : ''}
  </div>`, '420px');
}

/* من نافذة الفترات إلى إعداد الدرجات مباشرة (تُغلق ورقة الحصة والمسودة محفوظة) */
async function openGradeSettingsFromPeriodPicker(){
  closeCrmModal();
  await openGradeSettingsFromAnywhere();
}

async function pickCrmPeriod(p){
  const s = crmSheet;
  const info = sheetPeriodInfo(s);
  if(!info || gradePeriodSaving) return;
  if(p === info.period){ closeCrmModal(); return; }
  /* بدء فترة من حصة سابقة: تبدأ من تاريخ تلك الحصة (فتُرصد هي فيها) */
  const today = localIsoDate();
  const ok = await goToComponentPeriod(info.key, p, s.dateIso < today ? s.dateIso : today);
  closeCrmModal();
  if(!ok || crmSheet !== s) return; /* فشل، أو أُغلقت الورقة أثناء الحفظ */
  await setCrmSheetMode(s.mode);
}

/* ============ "يبدأ من الدرجة كاملة": من لا درجة له في الفترة يأخذ الكاملة ============ */
async function fillStartFullPeriodScores(column, studentIds, period, current){
  const missing = (studentIds || []).filter(id => !current.has(id));
  if(!missing.length) return [];
  const res = await Promise.all(missing.map(id => sb.rpc('set_period_score',
    { p_column_id: column.id, p_student_id: id, p_period: period, p_score: Number(column.max_score), p_only_missing: true })));
  const err = res.find(r => r.error);
  if(err) throw err.error;
  return missing;
}

async function loadPeriodRows(columnId){
  const { data, error } = await sb.from('classroom_grade_period_scores').select('student_id, period, score')
    .eq('teacher_id', currentUser.id).eq('column_id', columnId);
  if(error) throw error;
  return data || [];
}

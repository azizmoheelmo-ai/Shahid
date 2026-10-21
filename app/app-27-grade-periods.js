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
     = { n: 1..3, starts: [يوم بدء الثانية، يوم بدء الثالثة] }.
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

/* { n, starts } صالح، أو null (= فترة واحدة) */
function normalizePeriodCfg(raw){
  if(!raw || typeof raw !== 'object') return null;
  const n = Number(raw.n);
  if(!Number.isInteger(n) || n < 2 || n > PERIOD_COUNT_MAX) return null;
  const starts = (Array.isArray(raw.starts) ? raw.starts : []).filter(d => typeof d === 'string' && ISO_DATE_RE.test(d)).sort().slice(0, n - 1);
  return { n, starts };
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

/* مكوّن محسوب: درجة كل فترة من عناصرها (بتاريخها)، والنهائية = معدّل الفترات المرصودة.
   بلا فترات بدأت = حساب واحد على الكل (كالسابق تمامًا) */
function periodSplitScores(items, dateOf, scoreOf, starts){
  const out = { p1: null, p2: null, p3: null, final: null };
  const k = (starts || []).length + 1;
  for(let p = 1; p <= k; p++) out['p' + p] = scoreOf((items || []).filter(it => periodOfDateFor(dateOf(it), starts) === p));
  out.final = periodAverage(out.p1, out.p2, out.p3);
  return out;
}

/* ============ الإعداد (يتبع حساب المعلم على كل أجهزته) ============ */
function periodCfg(term, key){ return periodCfgOf(appFeatures, term, key); }

let gradePeriodSaving = false;
async function savePeriodCfg(term, key, cfg){
  const next = normalizeFeatures(appFeatures);
  const all = Object.assign({}, next.periods);
  const t = Object.assign({}, all[termPeriodKey(term)]);
  if(cfg && cfg.n > 1) t[key] = { n: cfg.n, starts: cfg.starts.slice(0, cfg.n - 1) }; else delete t[key];
  if(Object.keys(t).length) all[termPeriodKey(term)] = t; else delete all[termPeriodKey(term)];
  if(Object.keys(all).length) next.periods = all; else delete next.periods;
  appFeatures = next;
  await saveAppFeatures();
  const saved = periodCfg(term, key);
  const want = cfg && cfg.n > 1 ? { n: cfg.n, starts: cfg.starts.slice(0, cfg.n - 1) } : { n: 1, starts: [] };
  if(saved.n !== want.n || saved.starts.join() !== want.starts.join()) return false; /* فشل الحفظ: أُعيد المحفوظ */
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

/* المرصود مباشرة: دمج كل الفترات في الأولى بمعدّلها الحالي (درجة الكشف لا تتغيّر).
   الأولى = المعدّل ثم حذف ما بعدها. يرمي عند الفشل (يُعاد بأمان) */
async function mergeDirectPeriods(key){
  const uid = currentUser.id;
  const cols = await termColumnsMatching(c => periodCompKeyOfColumn(c) === key && isDirectPeriodColumn(c));
  for(const c of cols){
    const { data: later, error } = await sb.from('classroom_grade_period_scores').select('student_id')
      .eq('teacher_id', uid).eq('column_id', c.id).in('period', [2, 3]);
    if(error) throw error;
    const ids = [...new Set((later || []).map(r => r.student_id))];
    if(!ids.length) continue;
    const { data: main, error: mErr } = await sb.from('classroom_grade_scores').select('student_id, score')
      .eq('teacher_id', uid).eq('column_id', c.id).in('student_id', ids);
    if(mErr) throw mErr;
    const res = await Promise.all((main || []).map(m => sb.rpc('set_period_score',
      { p_column_id: c.id, p_student_id: m.student_id, p_period: 1, p_score: Number(m.score), p_only_missing: false })));
    const bad = res.find(r => r.error);
    if(bad) throw bad.error;
    const { error: dErr } = await sb.from('classroom_grade_period_scores').delete()
      .eq('teacher_id', uid).eq('column_id', c.id).in('period', [2, 3]);
    if(dErr) throw dErr;
  }
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
  /* أقل من الفترة الجارية: المرصود مباشرة يُدمج (بتأكيد)، والمحسوب يُعاد توزيعه بتاريخه */
  const merge = n < currentPeriodOf(cur) && periodKeyIsDirect(key);
  if(merge && !(await showConfirm(`تقليل فترات "${periodCompName(key)}" إلى ${PERIOD_COUNT_LABELS[n]}؟ تُدمج الفترات في الأولى: درجة كل طالب تبقى معدّله الحالي، ثم تبدأ من الفترة الأولى.`))) return false;
  return withPeriodBusy(async () => {
    if(merge) await mergeDirectPeriods(key);
    return savePeriodCfg(term, key, { n, starts: merge ? [] : cur.starts.slice(0, n - 1) });
  }, `صار "${periodCompName(key)}" ${PERIOD_COUNT_LABELS[n]} ✓`);
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
  if(!(target >= 1 && target <= cfg.n) || target === now) return false;
  return withPeriodBusy(() => savePeriodCfg(term, key, { n: cfg.n, starts: periodStartsFor(cfg, target, dateIso || localIsoDate()) }),
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

/* ============ إعداد الدرجات: سطر الفترات تحت كل مكوّن ============ */
function componentPeriodsHtml(key){
  if(!isPeriodCompKey(key)) return '';
  const cfg = periodCfg(crmCurrentTerm(), key);
  const now = currentPeriodOf(cfg);
  const k = escapeHtml(key).replace(/'/g, '&#39;');
  const seg = [1, 2, 3].map(n => `<button type="button" class="gs-period-btn${cfg.n === n ? ' is-on' : ''}" aria-pressed="${cfg.n === n}" onclick="setComponentPeriodCount('${k}', ${n})">${cfg.n === n ? '✓ ' : ''}${n}</button>`).join('');
  return `<span class="gs-start gs-periods-line" data-period-key="${escapeHtml(key)}">الفترات <span class="gs-seg">${seg}</span></span>
    ${cfg.n > 1 ? `<span class="gs-period-now"><span class="gs-pdots">${[1, 2, 3].slice(0, cfg.n).map(p => `<i class="${p < now ? 'done' : p === now ? 'cur' : ''}"></i>`).join('')}</span>
      الآن: <b>${PERIOD_NAMES[now]}</b>
      ${now < cfg.n ? `<button type="button" class="gs-period-btn gs-period-go" onclick="goToComponentPeriod('${k}', ${now + 1})">ابدأ ${PERIOD_NAMES[now + 1]} ←</button>` : ''}
      ${now > 1 ? `<button type="button" class="gs-period-btn gs-period-back" onclick="goToComponentPeriod('${k}', ${now - 1})">→ رجوع</button>` : ''}</span>` : ''}`;
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
  return `<button type="button" class="crm-period-chip${info.period > 1 ? ' is-p2' : ''}" onclick="openCrmPeriodPicker()" aria-label="تغيير الفترة">📅 ${PERIOD_NAMES[info.period]} من ${info.cfg.n} ▾</button>`;
}

function openCrmPeriodPicker(){
  const info = sheetPeriodInfo(crmSheet);
  if(!info || info.cfg.n < 2) return;
  const now = currentPeriodOf(info.cfg);
  const sub = p => p === info.period ? 'الجارية الآن' : p < now ? 'رجوع إليها' : p === now + 1 ? 'ابدأها الآن' : 'لم تبدأ';
  const opts = [1, 2, 3].slice(0, info.cfg.n).map(p => `<button type="button" class="crm-period-opt${p === info.period ? ' is-on' : ''}" onclick="pickCrmPeriod(${p})">
      <span><b>${PERIOD_NAMES[p]}</b><small>${sub(p)}</small></span><span class="crm-period-ck">${p === info.period ? '✓' : ''}</span></button>`).join('');
  showInfoModal(`<div style="text-align:right;">
    <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">فترات "${escapeHtml(periodCompName(info.key))}"</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.7;">الدرجة في الكشف = معدّل الفترات. ما رصدته سابقًا يبقى في فترته.</p>
    ${opts}
  </div>`, '420px');
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

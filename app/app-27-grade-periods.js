/* ============================================================
   فترتا المشاركة والواجبات
   ------------------------------------------------------------
   - الفصل فترتان. الثانية تبدأ من أول "الأسبوع العاشر" في التقويم الدراسي
     (نطاق المعلم، وإلا "بقية المناطق")، أو من تاريخ يختاره المعلم.
   - المشاركة: درجة لكل فترة (classroom_grade_period_scores)، والقاعدة تكتب
     بمشغّل في الكشف معدّل ما رُصد منهما — فكل ما يقرأ الكشف يرى المعدّل.
     الدرجة القديمة بلا فترات = الفترة الأولى (تُنسخ في القاعدة عند أول رصد بفترة).
   - الواجبات: كل واجب في فترة موعد تسليمه، ودرجة كل فترة من واجباتها،
     والعمود = معدّل الفترتين اللتين فيهما واجبات محسوبة.
   - اختيار المعلم في user_app_settings.features.periods لكل فصل ("سنة|فصل"):
     تاريخ بداية الثانية، أو "later" (الثانية لم تبدأ بعد). غيابه = التقويم.
   ============================================================ */

const PERIOD2_WEEK_LABEL = 'الأسبوع العاشر';
const PERIOD_NAMES = { 1: 'الفترة الأولى', 2: 'الفترة الثانية' };

/* ============ دوال صرفة ============ */
function termPeriodKey(term){ return term.year + '|' + term.semester; }

function isPeriodOverrideValue(v){
  return v === 'later' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
}

/* أول يوم من "الأسبوع العاشر" في الفصل (الصفوف مرتّبة تصاعديًا بالتاريخ) */
function autoPeriod2Start(weekRows, semester){
  const row = (weekRows || []).find(w => w && Number(w.semester) === Number(semester) && w.week_label === PERIOD2_WEEK_LABEL);
  return row ? row.gregorian_date : null;
}

function periodOverrideOf(features, term){
  const p = features && features.periods;
  const v = p && p[termPeriodKey(term)];
  return isPeriodOverrideValue(v) ? v : null;
}

/* تاريخ بداية الثانية الفعلي، أو null = لم تبدأ (أو لا تقويم) */
function effectivePeriod2Start(auto, override){
  if(override === 'later') return null;
  return override || auto || null;
}

function periodOfDate(iso, start){
  return start && iso && iso >= start ? 2 : 1;
}

/* عمود له فترتان: المشاركة والواجبات (لا أدوات المعلم الخاصة) */
function isPeriodColumn(c){
  return !!c && !c.tool_id && (c.kind === 'participation' || c.kind === 'homework');
}

/* درجات الفترة الحالية في ورقة الحصة. صفوف الفترات لها الأولوية؛ طالب بلا
   صفوف فترات (رصد قديم) = درجته في الكشف هي الفترة الأولى */
function currentPeriodScores(mainScores, periodRows, period){
  const hasRows = new Set((periodRows || []).map(r => r.student_id));
  const out = new Map();
  (periodRows || []).forEach(r => { if(Number(r.period) === period) out.set(r.student_id, Number(r.score)); });
  if(period === 1){
    (mainScores || new Map()).forEach((v, id) => { if(!hasRows.has(id)) out.set(id, Number(v)); });
  }
  return out;
}

/* درجتا الفترتين لكل طالب في عمود مشاركة: { p1, p2 } (null = لم تُرصد) */
function participationPeriodBreakdown(mainScores, periodRows){
  const out = new Map();
  const get = id => { if(!out.has(id)) out.set(id, { p1: null, p2: null }); return out.get(id); };
  (periodRows || []).forEach(r => { get(r.student_id)['p' + Number(r.period)] = Number(r.score); });
  (mainScores || new Map()).forEach((v, id) => { if(!out.has(id)) get(id).p1 = Number(v); });
  return out;
}

/* معدّل ما رُصد من الفترتين (كما تحسبه القاعدة للمشاركة) */
function periodAverage(p1, p2){
  const vals = [p1, p2].filter(v => v !== null && v !== undefined);
  if(!vals.length) return null;
  return Math.round(100 * vals.reduce((a, b) => a + Number(b), 0) / vals.length) / 100;
}

/* ============ تحميل الفترات ============ */
const gradePeriodAutoCache = new Map(); /* region|year|semester → تاريخ أو null */

async function loadPeriod2AutoStart(term){
  if(typeof CALENDAR_ACADEMIC_YEAR === 'undefined' || term.year !== CALENDAR_ACADEMIC_YEAR || typeof loadCalendarData !== 'function') return null;
  const region = (typeof calendarRegion !== 'undefined' && calendarRegion) || 'other_regions';
  const key = region + '|' + term.year + '|' + term.semester;
  if(gradePeriodAutoCache.has(key)) return gradePeriodAutoCache.get(key);
  try{
    const { weeks } = await loadCalendarData(region);
    const start = autoPeriod2Start(weeks, term.semester);
    gradePeriodAutoCache.set(key, start);
    return start;
  } catch(e){ return null; } /* بلا تقويم: الفترة الأولى، ويُعاد المحاولة لاحقًا */
}

/* { auto, override, start } لفصل */
async function loadGradePeriods(term){
  const auto = await loadPeriod2AutoStart(term);
  const override = periodOverrideOf(appFeatures, term);
  return { auto, override, start: effectivePeriod2Start(auto, override) };
}

/* ============ اختيار المعلم (يتبع حسابه على كل أجهزته) ============ */
let gradePeriodSaving = false;
async function setGradePeriodOverride(term, value){
  if(gradePeriodSaving || !currentUser) return false;
  if(value !== null && !isPeriodOverrideValue(value)) return false;
  gradePeriodSaving = true;
  try{
    const next = normalizeFeatures(appFeatures);
    const periods = Object.assign({}, next.periods);
    if(value === null) delete periods[termPeriodKey(term)]; else periods[termPeriodKey(term)] = value;
    if(Object.keys(periods).length) next.periods = periods; else delete next.periods;
    appFeatures = next;
    await saveAppFeatures();
    if(periodOverrideOf(appFeatures, term) !== value) return false; /* فشل الحفظ: أُعيد المحفوظ */
    /* الواجبات تتوزّع على الفترتين بموعدها — يُعاد حساب عمودها في كل الشعب */
    if(typeof resyncStartModeColumns === 'function'){
      try{ await resyncStartModeColumns('homework', null, term); } catch(e){}
    }
    if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
    return true;
  } finally {
    gradePeriodSaving = false;
  }
}

function shortPeriodDate(iso){
  return typeof shortDateAr === 'function' ? shortDateAr(iso) : iso;
}

/* ============ شارة الفترة في ورقة الحصة ============ */
function crmPeriodChipHtml(s){
  if(!s || !s.periods) return '';
  const p = periodOfDate(s.dateIso, s.periods.start);
  const manual = !!s.periods.override;
  return `<button type="button" class="crm-period-chip${manual ? ' is-manual' : ''}" onclick="openCrmPeriodPicker()" aria-label="تغيير الفترة">📅 ${PERIOD_NAMES[p]}${manual ? ' · يدوي' : ''} ▾</button>`;
}

function openCrmPeriodPicker(){
  const s = crmSheet;
  if(!s || !s.periods) return;
  const cur = periodOfDate(s.dateIso, s.periods.start);
  const { auto, override, start } = s.periods;
  const opt = (n, sub) => `<button type="button" class="crm-period-opt${cur === n ? ' is-on' : ''}" onclick="pickCrmPeriod(${n})">
      <span><b>${PERIOD_NAMES[n]}</b><small>${sub}</small></span><span class="crm-period-ck">${cur === n ? '✓' : ''}</span></button>`;
  showInfoModal(`<div style="text-align:right;">
    <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">الفترة</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.7;">المشاركة والواجبات لهما فترتان، والدرجة في الكشف = معدّلهما. الرصد يذهب للفترة المختارة، وما رصدته سابقًا يبقى في فترته.</p>
    ${opt(1, start ? 'حتى ' + escapeHtml(shortPeriodDate(addDaysIso(start, -1))) : 'الفترة الحالية')}
    ${opt(2, start ? 'من ' + escapeHtml(shortPeriodDate(start)) : 'لم تبدأ بعد')}
    ${override ? `<button type="button" class="crm-period-auto" id="crmPeriodAutoBtn" onclick="pickCrmPeriod(0)">↺ رجوع للتلقائي${auto ? ' (من التقويم: ' + escapeHtml(shortPeriodDate(auto)) + ')' : ''}</button>` : ''}
  </div>`, '420px');
}

/* n: 1 أو 2، أو 0 = رجوع للتقويم */
async function pickCrmPeriod(n){
  const s = crmSheet;
  if(!s || !s.periods || gradePeriodSaving) return;
  const cur = periodOfDate(s.dateIso, s.periods.start);
  let value;
  if(n === 0) value = null;
  else if(n === cur){ closeCrmModal(); return; }
  else if(n === 2) value = s.dateIso;   /* الثانية تبدأ من تاريخ هذه الحصة */
  else value = 'later';                 /* الثانية لم تبدأ بعد */
  document.querySelectorAll('.crm-period-opt, .crm-period-auto').forEach(b => { b.disabled = true; });
  const term = crmCurrentTerm();
  const ok = await setGradePeriodOverride(term, value);
  closeCrmModal();
  if(!ok){ showToast('تعذّر تغيير الفترة', 'error'); return; }
  if(crmSheet !== s) return; /* أُغلقت الورقة أثناء الحفظ */
  s.periods = await loadGradePeriods(term);
  if(crmSheet !== s) return;
  showToast('الرصد الآن في ' + PERIOD_NAMES[periodOfDate(s.dateIso, s.periods.start)], 'ok');
  await setCrmSheetMode(s.mode);
}

/* ============ "يبدأ من الكاملة": من لا درجة له في الفترة الحالية يأخذ الكاملة ============ */
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

/* ============ إعداد الدرجات: سطر الفترتين ============ */
function crmPeriodSettingsHtml(periods){
  if(!periods) return '';
  const { auto, override, start } = periods;
  const today = localIsoDate();
  const when = start ? (start <= today ? 'بدأت الفترة الثانية: ' : 'تبدأ الفترة الثانية: ') + `<b>${escapeHtml(shortPeriodDate(start))}</b>` : '<b>الفترة الثانية لم تبدأ بعد</b>';
  const src = override ? 'اخترته أنت' : (auto ? 'من التقويم الدراسي' : 'لا تقويم لهذا الفصل');
  return `<div class="gs-periods">
    <div>📅 المشاركة والواجبات بفترتين، ودرجتهما في الكشف = معدّل الفترتين.</div>
    <div>${when} <small>(${src})</small></div>
    <button type="button" class="gs-period-edit" onclick="openCrmPeriodDateEditor()">تعديل التاريخ</button>
  </div>`;
}

async function openCrmPeriodDateEditor(){
  const term = crmCurrentTerm();
  const p = await loadGradePeriods(term);
  showInfoModal(`<div style="text-align:right;">
    <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">بداية الفترة الثانية</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.7;">لكل شعبك في ${escapeHtml(typeof getCrmSemesterLabel === 'function' ? getCrmSemesterLabel() : 'هذا الفصل')}. الرصد قبل هذا التاريخ للفترة الأولى، ومن بعده للثانية.${p.auto ? ' التقويم الدراسي: ' + escapeHtml(shortPeriodDate(p.auto)) + '.' : ''}</p>
    <input type="date" class="goal-input" id="crmPeriodDate" value="${escapeHtml(p.start || p.auto || localIsoDate())}" style="margin-bottom:10px;">
    <button class="btn btn-primary crm-period-btn" style="width:100%;justify-content:center;" onclick="saveCrmPeriodDate('date')">حفظ التاريخ</button>
    ${p.override ? `<button class="btn btn-outline crm-period-btn" style="width:100%;justify-content:center;margin-top:8px;" onclick="saveCrmPeriodDate('auto')">↺ رجوع للتقويم الدراسي</button>` : ''}
  </div>`, '420px');
}

async function saveCrmPeriodDate(how){
  if(gradePeriodSaving) return;
  let value = null;
  if(how === 'date'){
    const el = document.getElementById('crmPeriodDate');
    value = el && el.value;
    if(!isPeriodOverrideValue(value) || value === 'later'){ showToast('اختر تاريخًا', 'error'); return; }
  }
  document.querySelectorAll('.crm-period-btn').forEach(b => { b.disabled = true; });
  const ok = await setGradePeriodOverride(crmCurrentTerm(), value);
  closeCrmModal();
  showToast(ok ? 'حُفظ تاريخ الفترة الثانية ✓' : 'تعذّر الحفظ', ok ? 'ok' : 'error');
  if(ok && typeof renderCrmGrades === 'function') renderCrmGrades();
}

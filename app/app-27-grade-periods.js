/* ============================================================
   فترتا المشاركة والواجبات — اختيار المعلم، ويدوي بالكامل
   ------------------------------------------------------------
   - الأصل: فترة واحدة (كما كان). المعلم يفعّل "فترتان" من إعداد الدرجات،
     فيبدأ في الفترة الأولى، ومتى أراد يضغط "ابدأ الفترة الثانية". لا تقويم
     ولا تاريخ يُطلب منه — يوم الضغط يُحفظ داخليًا فقط ليعرف كل واجب فترته.
   - المشاركة: درجة لكل فترة (classroom_grade_period_scores)، والقاعدة تكتب
     بمشغّل في الكشف معدّل ما رُصد منهما. بفترة واحدة: كل الرصد في الأولى،
     فدرجة الكشف = درجتها (لا فرق يراه المعلم). الرصد القديم = الأولى.
   - الواجبات: كل واجب في فترة موعد تسليمه (قبل يوم البدء = الأولى)،
     والعمود = معدّل الفترتين.
   - الحالة في user_app_settings.features.periods لكل فصل ("سنة|فصل"):
     غيابها = فترة واحدة، "later" = فترتان والأولى جارية، تاريخ = الثانية بدأت.
   - الإيقاف بعد بدء الثانية يدمجهما: درجة كل طالب تبقى معدّله الحالي.
   ============================================================ */

const PERIOD_NAMES = { 1: 'الفترة الأولى', 2: 'الفترة الثانية' };

/* ============ دوال صرفة ============ */
function termPeriodKey(term){ return term.year + '|' + term.semester; }

function isPeriodOverrideValue(v){
  return v === 'later' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
}

function periodOverrideOf(features, term){
  const p = features && features.periods;
  const v = p && p[termPeriodKey(term)];
  return isPeriodOverrideValue(v) ? v : null;
}

/* { on, override, start }: start = يوم بدء الثانية، أو null (لم تبدأ / فترة واحدة) */
function gradePeriodsState(override){
  return { on: !!override, override: override || null, start: override && override !== 'later' ? override : null };
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

/* ============ الحالة ============ */
/* async ليبقى توقيع المستدعين كما هو (لا تحميل من الشبكة) */
async function loadGradePeriods(term){
  return gradePeriodsState(periodOverrideOf(appFeatures, term));
}

/* ============ اختيار المعلم (يتبع حسابه على كل أجهزته) ============ */
let gradePeriodSaving = false;
async function setGradePeriodOverride(term, value){
  if(gradePeriodSaving || !currentUser) return false;
  if(value !== null && !isPeriodOverrideValue(value)) return false;
  gradePeriodSaving = true;
  try{
    return await saveGradePeriodValue(term, value);
  } finally {
    gradePeriodSaving = false;
  }
}

async function saveGradePeriodValue(term, value){
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
}

/* إيقاف الفترتين بعد بدء الثانية: درجة الكشف (المعدّل) تصير درجة الأولى، ويُحذف رصد الثانية.
   الترتيب: الأولى = المعدّل ثم حذف الثانية — فتبقى درجة الكشف كما هي. يرمي عند الفشل (يُعاد بأمان) */
async function mergeGradePeriods(){
  const uid = currentUser.id;
  const cols = await termColumnsMatching(c => c.kind === 'participation' && !c.tool_id);
  for(const c of cols){
    const { data: p2, error } = await sb.from('classroom_grade_period_scores').select('student_id')
      .eq('teacher_id', uid).eq('column_id', c.id).eq('period', 2);
    if(error) throw error;
    const ids = (p2 || []).map(r => r.student_id);
    if(!ids.length) continue;
    const { data: main, error: mErr } = await sb.from('classroom_grade_scores').select('student_id, score')
      .eq('teacher_id', uid).eq('column_id', c.id).in('student_id', ids);
    if(mErr) throw mErr;
    const res = await Promise.all((main || []).map(m => sb.rpc('set_period_score',
      { p_column_id: c.id, p_student_id: m.student_id, p_period: 1, p_score: Number(m.score), p_only_missing: false })));
    const bad = res.find(r => r.error);
    if(bad) throw bad.error;
    const { error: dErr } = await sb.from('classroom_grade_period_scores').delete()
      .eq('teacher_id', uid).eq('column_id', c.id).eq('period', 2);
    if(dErr) throw dErr;
  }
}

/* من إعداد الدرجات: "فترة واحدة / فترتان"، و"ابدأ الفترة الثانية" / "رجوع للأولى" */
async function setCrmGradePeriods(action){
  if(gradePeriodSaving || !currentUser) return;
  const term = crmCurrentTerm();
  const cur = gradePeriodsState(periodOverrideOf(appFeatures, term));
  let value;
  if(action === 'on') value = cur.on ? cur.override : 'later';
  else if(action === 'start2') value = localIsoDate();
  else if(action === 'back1') value = 'later';
  else value = null;
  if(value === cur.override) return;
  if(action === 'off' && cur.start && !(await showConfirm('إيقاف الفترتين؟ تُدمج الفترتان: درجة كل طالب في المشاركة تبقى معدّله الحالي، والواجبات تُحسب كلها فترة واحدة.'))) return;
  gradePeriodSaving = true;
  document.querySelectorAll('.gs-period-btn').forEach(b => { b.disabled = true; });
  let ok = false;
  try{
    if(action === 'off' && cur.start) await mergeGradePeriods();
    ok = await saveGradePeriodValue(term, value);
  } catch(e){
    ok = false;
  } finally {
    gradePeriodSaving = false;
  }
  if(!ok){ showToast('تعذّر الحفظ — أعد المحاولة', 'error'); if(typeof renderCrmGrades === 'function') renderCrmGrades(); return; }
  showToast({ on: 'فعّلت الفترتين — أنت الآن في الفترة الأولى', start2: 'بدأت الفترة الثانية ✓', back1: 'رجعت للفترة الأولى', off: 'رجعت لفترة واحدة' }[action], 'ok');
  if(typeof renderCrmGrades === 'function') renderCrmGrades();
}

/* ============ شارة الفترة في ورقة الحصة (لمن فعّل الفترتين فقط) ============ */
function crmPeriodChipHtml(s){
  if(!s || !s.periods || !s.periods.on) return '';
  const p = periodOfDate(s.dateIso, s.periods.start);
  return `<button type="button" class="crm-period-chip${p === 2 ? ' is-p2' : ''}" onclick="openCrmPeriodPicker()" aria-label="تغيير الفترة">📅 ${PERIOD_NAMES[p]} ▾</button>`;
}

function openCrmPeriodPicker(){
  const s = crmSheet;
  if(!s || !s.periods || !s.periods.on) return;
  const cur = periodOfDate(s.dateIso, s.periods.start);
  const opt = (n, sub) => `<button type="button" class="crm-period-opt${cur === n ? ' is-on' : ''}" onclick="pickCrmPeriod(${n})">
      <span><b>${PERIOD_NAMES[n]}</b><small>${sub}</small></span><span class="crm-period-ck">${cur === n ? '✓' : ''}</span></button>`;
  showInfoModal(`<div style="text-align:right;">
    <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">الفترة</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.7;">الدرجة في الكشف = معدّل الفترتين. الرصد يذهب للفترة المختارة، وما رصدته سابقًا يبقى في فترته.</p>
    ${opt(1, cur === 1 ? 'الجارية الآن' : 'رجوع إليها')}
    ${opt(2, cur === 2 ? 'الجارية الآن' : 'ابدأها الآن')}
  </div>`, '420px');
}

async function pickCrmPeriod(n){
  const s = crmSheet;
  if(!s || !s.periods || gradePeriodSaving) return;
  const cur = periodOfDate(s.dateIso, s.periods.start);
  if(n === cur){ closeCrmModal(); return; }
  /* الثانية تبدأ من اليوم (أو من تاريخ هذه الحصة إن كانت أقدم، فتُرصد هي فيها) */
  const today = localIsoDate();
  const value = n === 2 ? (s.dateIso < today ? s.dateIso : today) : 'later';
  document.querySelectorAll('.crm-period-opt').forEach(b => { b.disabled = true; });
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

/* ============ إعداد الدرجات: "فترة واحدة / فترتان" ============ */
function crmPeriodSettingsHtml(periods){
  if(!periods) return '';
  const cur = periodOfDate(localIsoDate(), periods.start);
  return `<div class="gs-periods">
    <div class="gs-periods-row"><b>📅 المشاركة والواجبات</b>
      <span class="gs-seg"><button type="button" class="gs-period-btn${periods.on ? '' : ' is-on'}" aria-pressed="${!periods.on}" onclick="setCrmGradePeriods('off')">${periods.on ? '' : '✓ '}فترة واحدة</button><button type="button" class="gs-period-btn${periods.on ? ' is-on' : ''}" aria-pressed="${periods.on}" onclick="setCrmGradePeriods('on')">${periods.on ? '✓ ' : ''}فترتان</button></span></div>
    ${periods.on ? `<div class="gs-periods-now">الآن: <b>${PERIOD_NAMES[cur]}</b> — الدرجة في الكشف = معدّل الفترتين</div>
      ${cur === 1 ? '<button type="button" class="gs-period-btn gs-period-go" onclick="setCrmGradePeriods(\'start2\')">ابدأ الفترة الثانية ←</button>'
        : '<button type="button" class="gs-period-btn gs-period-back" onclick="setCrmGradePeriods(\'back1\')">→ رجوع للفترة الأولى</button>'}` : ''}
  </div>`;
}

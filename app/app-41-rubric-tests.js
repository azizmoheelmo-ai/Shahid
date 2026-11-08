/* ============================================================
   اختبار بسلّم تقدير (معايير) — تجربة على حساب المعلم المفعَّل له فقط
   ------------------------------------------------------------
   - الاختبار العادي = عمود بفئة الاختبارات ودرجة لكل طالب. الاختبار بسلّم تقدير
     هو نفسه (عمود + درجة الطالب في classroom_grade_scores)، لكن درجته تُحسب
     من معايير يختارها المعلم: كل معيار له درجة ومستوى إنجاز (كامل/كبير/جزئي/بداية/صفر).
   - المعايير في classroom_rubric_criteria، ورصد كل طالب لكل معيار في
     classroom_rubric_marks (المستوى فقط)؛ والدرجة الكلية تبقى في
     classroom_grade_scores كما هي، فلا يتغيّر أي كشف ولا تقرير قائم.
   - يُعرف الاختبار بالسلّم بوجود معاييره (لا نوع جديد للعمود: قيد kind في القاعدة).
   - المفتاح: user_app_settings.features.rubricTests === true (حسابات تجريبية فقط).
   - هذا الملف: الدوال الصرفة أولًا، ثم الواجهة (تُضاف تباعًا).
   ============================================================ */

const RUBRIC_LEVELS = [
  { level: 0, label: 'كامل', pct: 1 },
  { level: 1, label: 'كبير', pct: 0.75 },
  { level: 2, label: 'جزئي', pct: 0.5 },
  { level: 3, label: 'بداية', pct: 0.25 },
  { level: 4, label: 'صفر', pct: 0 }
];
/* أشهر معايير تقييم القراءة (مقترحات للاختيار منها، لا قوالب جاهزة): الدقة، النطق، الطلاقة، السرعة، التعبير، الوقف، التصحيح الذاتي، الفهم */
const RUBRIC_POOL = ['الدقة', 'النطق ومخارج الحروف', 'الطلاقة والسلاسة', 'السرعة المناسبة', 'التعبير والنبرة', 'الوقف وعلامات الترقيم', 'التصحيح الذاتي', 'فهم المقروء'];
const RUBRIC_MAX_CRITERIA = 10;

/* ============ دوال صرفة ============ */
function rubricOn(){ return !!(typeof appFeatures !== 'undefined' && appFeatures && appFeatures.rubricTests === true); }

function rubricRound(x){ return Math.round(Number(x) * 100) / 100; }

function rubricNormalizeName(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 60); }

/* توزيع الدرجة الكلية على n معيار بأرقام صحيحة قدر الإمكان (الباقي للأوائل):
   5 على 3 → 2 و2 و1. إن قلّت الدرجة عن عدد المعايير: بالنصف ثم بالربع */
function rubricDistribute(total, n){
  const t = Number(total), k = Number(n);
  if(!(t > 0) || !(k >= 1)) return [];
  let unit = 1;
  if(t < k) unit = 0.5;
  if(t * 2 < k) unit = 0.25;
  const units = Math.round(t / unit);
  const base = Math.floor(units / k), rem = units - base * k;
  return Array.from({ length: k }, (_, i) => (base + (i < rem ? 1 : 0)) * unit);
}

/* درجة المعيار عند مستوى معيّن */
function rubricPointsAt(points, level){
  const lv = RUBRIC_LEVELS[level];
  return lv ? rubricRound(Number(points) * lv.pct) : 0;
}

/* درجة الطالب: مجموع (درجة المعيار × نسبة مستواه). levelOf(criterionId) → 0..4 أو null (لم يُرصد = 0) */
function rubricTotal(criteria, levelOf){
  let sum = 0;
  (criteria || []).forEach(c => {
    const lv = levelOf(c.id);
    if(lv === null || lv === undefined) return;
    sum += Number(c.points) * (RUBRIC_LEVELS[lv] ? RUBRIC_LEVELS[lv].pct : 0);
  });
  return rubricRound(sum);
}

function rubricIsComplete(criteria, levelOf){
  return (criteria || []).length > 0 && criteria.every(c => {
    const lv = levelOf(c.id);
    return lv !== null && lv !== undefined && RUBRIC_LEVELS[lv] !== undefined;
  });
}

/* مسودة المعايير عند إنشاء اختبار: names بترتيب الاختيار، total الدرجة الكاملة. يعيد { error } أو { rows: [{ name, points, position }] } */
function rubricBuildCriteria(names, total){
  const clean = (names || []).map(rubricNormalizeName).filter(Boolean);
  if(!clean.length) return { error: 'اختر معيارًا واحدًا على الأقل، أو أطفئ «رصد بسلّم تقدير»' };
  if(new Set(clean).size !== clean.length) return { error: 'يوجد معيار مكرر' };
  if(clean.length > RUBRIC_MAX_CRITERIA) return { error: `الحد الأقصى ${RUBRIC_MAX_CRITERIA} معايير` };
  const points = rubricDistribute(total, clean.length);
  if(!points.length || points.some(p => !(p > 0))) return { error: 'الدرجة الكاملة صغيرة على هذا العدد من المعايير' };
  return { rows: clean.map((name, i) => ({ name, points: points[i], position: i })) };
}

/* ============ تحميل المعايير ============ */
const rubricCache = new Map(); /* معرّف العمود → [{ id, name, points, position }] مرتبة؛ [] = اختبار عادي */
function rubricCriteriaOf(columnId){ return rubricCache.get(columnId) || []; }
function rubricIsColumn(columnId){ return rubricCriteriaOf(columnId).length > 0; }

/* يعيد Map(معرّف العمود → المعايير). مغلق = بلا استعلام. الفشل (جداول غير جاهزة/اتصال) يُعامل الاختبارات كعادية */
async function rubricLoadCriteria(columnIds){
  const out = new Map();
  if(!rubricOn() || !currentUser || !(columnIds || []).length) return out;
  try{
    const { data, error } = await sb.from('classroom_rubric_criteria').select('id, column_id, name, points, position')
      .eq('teacher_id', currentUser.id).in('column_id', columnIds);
    if(error) throw error;
    columnIds.forEach(id => out.set(id, []));
    (data || []).forEach(r => { if(out.has(r.column_id)) out.get(r.column_id).push({ id: r.id, name: r.name, points: Number(r.points), position: Number(r.position) }); });
    out.forEach((list, id) => { list.sort((a, b) => a.position - b.position); rubricCache.set(id, list); });
  } catch(e){ /* لا نكسر الكشف */ }
  return out;
}

/* ============ إنشاء اختبار بسلّم (يُضمَّن في نافذتي «اختبار جديد») ============ */
let rubricDraft = { on: false, sel: [], pool: RUBRIC_POOL.slice() };
function rubricDraftReset(){ rubricDraft = { on: false, sel: [], pool: RUBRIC_POOL.slice() }; }

function rubricReadNumber(v){
  const t = String(v == null ? '' : v).trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/g, '.');
  return t === '' ? NaN : Number(t);
}

function rubricFormHtml(){
  if(!rubricOn()) return '';
  return `<label class="crm-switch"><input type="checkbox" id="rubricOnChk" onchange="rubricDraftToggle(this.checked)"><span class="crm-sw" aria-hidden="true"></span><span>🎯 رصد بسلّم تقدير (معايير)</span></label>
    <div id="rubricFormBox" class="rb-form" hidden></div>`;
}

function rubricDraftToggle(on){ rubricDraft.on = !!on; rubricPaintForm(); }

function rubricPaintForm(){
  const box = document.getElementById('rubricFormBox');
  if(!box) return;
  const d = rubricDraft;
  box.hidden = !d.on;
  if(!d.on){ box.innerHTML = ''; return; }
  const keep = document.getElementById('rubricCustomName');
  const typed = keep ? keep.value : '';
  const maxEl = document.getElementById('crmGradeColMax') || document.getElementById('crmSheetTestMax');
  if(maxEl && !maxEl.dataset.rbBound){ maxEl.dataset.rbBound = '1'; maxEl.addEventListener('input', rubricPaintForm); }
  const total = maxEl ? rubricReadNumber(maxEl.value) : NaN;
  const pts = (total > 0 && d.sel.length) ? rubricDistribute(total, d.sel.length) : [];
  const chips = d.pool.map((n, i) => {
    const k = d.sel.indexOf(n);
    return `<button type="button" class="rb-chip${k >= 0 ? ' on' : ''}" aria-pressed="${k >= 0}" onclick="rubricDraftPick(${i})">${k >= 0 ? `<i>${k + 1}</i>` : ''}${escapeHtml(n)}</button>`;
  }).join('');
  box.innerHTML = `<div class="rb-lbl">اختر المعايير بالترتيب الذي تريده</div>
    <div class="rb-chips">${chips}</div>
    <div class="rb-add"><input class="goal-input" id="rubricCustomName" maxlength="60" placeholder="معيار من عندي" onkeydown="if(event.key==='Enter'){event.preventDefault();rubricDraftAddCustom();}"><button type="button" class="btn btn-outline crm-mini-btn" onclick="rubricDraftAddCustom()">إضافة</button></div>
    <div class="rb-note">${pts.length ? 'درجة كل معيار: ' + d.sel.map((n, i) => `${escapeHtml(n)} ${formatScore(pts[i])}`).join(' · ') : 'تُوزَّع الدرجة الكاملة على المعايير تلقائيًا.'}</div>`;
  const again = document.getElementById('rubricCustomName');
  if(again) again.value = typed;
}

function rubricDraftPick(i){
  const d = rubricDraft, n = d.pool[i];
  if(n === undefined) return;
  const k = d.sel.indexOf(n);
  if(k >= 0) d.sel.splice(k, 1);
  else if(d.sel.length < RUBRIC_MAX_CRITERIA) d.sel.push(n);
  else showToast(`الحد الأقصى ${RUBRIC_MAX_CRITERIA} معايير`, 'error');
  rubricPaintForm();
}

function rubricDraftAddCustom(){
  const el = document.getElementById('rubricCustomName');
  if(!el) return;
  const n = rubricNormalizeName(el.value);
  if(!n) return;
  const d = rubricDraft;
  if(d.pool.indexOf(n) < 0) d.pool.push(n);
  if(d.sel.indexOf(n) < 0){
    if(d.sel.length < RUBRIC_MAX_CRITERIA) d.sel.push(n);
    else showToast(`الحد الأقصى ${RUBRIC_MAX_CRITERIA} معايير`, 'error');
  }
  el.value = '';
  rubricPaintForm();
  const again = document.getElementById('rubricCustomName');
  if(again) again.focus();
}

/* قبل الحفظ: null = اختبار عادي، وإلا { error } أو { rows } */
function rubricDraftRows(total){
  if(!rubricOn() || !rubricDraft.on) return null;
  return rubricBuildCriteria(rubricDraft.sel, total);
}

/* بعد إنشاء الأعمدة: يضيف معاييرها. الفشل = لا نترك اختبارًا بلا معاييره، فيُحذف ما أُنشئ للتو (فارغ بلا درجات) ويُعاد الخطأ */
async function rubricCreateForColumns(columns, rows){
  const uid = currentUser.id;
  const payload = [];
  (columns || []).forEach(c => rows.forEach(r => payload.push({ teacher_id: uid, column_id: c.id, name: r.name, points: r.points, position: r.position })));
  const { error } = await sb.from('classroom_rubric_criteria').insert(payload);
  if(!error) return null;
  await rubricDropFreshColumns((columns || []).map(c => c.id));
  return error;
}

async function rubricDropFreshColumns(ids){
  if(!ids.length) return;
  try{ await sb.from('classroom_grade_columns').delete().eq('teacher_id', currentUser.id).in('id', ids); } catch(e){}
}

/* ============ الرصد في ورقة الحصة ← اختبار ============ */
function rubricModeGet(){ try{ return localStorage.getItem('shahid_rubric_mode') === 'up' ? 'up' : 'down'; } catch(e){ return 'down'; } }
function rubricModeSave(m){ try{ localStorage.setItem('shahid_rubric_mode', m); } catch(e){} }

/* حالة الرصد لاختبار واحد: marks = ما حُفظ، picks = نسخة العمل (غير المعتمدة)، done = من لهم درجة محفوظة، dirty = من عُدّلت اختياراتهم بعد الاعتماد */
function rubricInitState(test, criteria, marksRows, scoreValues, students){
  const marks = new Map();
  (marksRows || []).forEach(r => {
    if(!marks.has(r.student_id)) marks.set(r.student_id, new Map());
    marks.get(r.student_id).set(r.criterion_id, Number(r.level));
  });
  const done = new Set();
  (students || []).forEach(st => { if(scoreValues.has(st.id)) done.add(st.id); });
  const first = (students || []).find(st => !done.has(st.id)) || (students || [])[0];
  return { testId: test.id, max: Number(test.max_score), criteria, marks, done, picks: new Map(), dirty: new Set(), cur: first ? first.id : null, mode: rubricModeGet(), busy: false, showSet: false };
}

function rubricPicksOf(R, studentId){
  if(!R.picks.has(studentId)){
    const saved = R.marks.get(studentId);
    const m = new Map();
    R.criteria.forEach(c => {
      if(saved && saved.has(c.id)) m.set(c.id, saved.get(c.id));
      else if(R.mode === 'down' && !R.done.has(studentId)) m.set(c.id, 0);
    });
    R.picks.set(studentId, m);
  }
  return R.picks.get(studentId);
}

function rubricStudents(){ return crmSheet ? crmStudentsOfSection(crmSheet.sectionId) : []; }

function rubricBodyHtml(R, students){
  const cur = students.find(st => st.id === R.cur);
  if(!cur) return '<div class="empty-state">لا طلاب في هذه الشعبة.</div>';
  const picks = rubricPicksOf(R, cur.id);
  const lv = id => (picks.has(id) ? picks.get(id) : null);
  const total = rubricTotal(R.criteria, lv);
  const rated = R.criteria.filter(c => picks.has(c.id)).length;
  const complete = rubricIsComplete(R.criteria, lv);
  const absent = st => crmSheet && crmSheet.states && crmSheet.states[st.id] === 'absent';
  const chips = students.map((st, i) => {
    const saved = R.done.has(st.id) && !R.dirty.has(st.id);
    const sc = saved && crmSheet.test.values.has(st.id) ? formatScore(crmSheet.test.values.get(st.id)) : '';
    return `<button type="button" class="rb-stu${st.id === R.cur ? ' on' : ''}" aria-pressed="${st.id === R.cur}" onclick="rubricSelectStudent(${i})">${escapeHtml(st.full_name)}<small>${saved ? `<b class="rb-ok">✓ ${sc}</b>` : (absent(st) ? 'غائب' : 'لم يُرصد')}</small></button>`;
  }).join('');
  const tiles = R.criteria.map((c, ci) => {
    const cur2 = lv(c.id);
    const btns = RUBRIC_LEVELS.map(l => `<button type="button" class="rb-lv" data-l="${l.level}" aria-pressed="${cur2 === l.level}" onclick="rubricPickLevel(${ci}, ${l.level})"><b>${formatScore(rubricPointsAt(c.points, l.level))}</b><span>${l.label}</span></button>`).join('');
    const pend = (R.mode === 'up' && cur2 === null) ? ' <em class="rb-pend">لم يُرصد</em>' : '';
    return `<div class="rb-crit"><div class="rb-crit-h"><b>${escapeHtml(c.name)}</b><small>من ${formatScore(c.points)}${pend}</small></div><div class="rb-lvs">${btns}</div></div>`;
  }).join('');
  const hint = R.mode === 'down' ? 'كل معيار يبدأ بكامل درجته — انقر مستوى أقل عند الحاجة' : `رُصد ${rated} من ${R.criteria.length} معايير`;
  const settings = R.showSet ? `<div class="rb-set"><span>يبدأ كل معيار من</span><div class="rb-seg"><button type="button" aria-pressed="${R.mode === 'down'}" onclick="rubricSetMode('down')">كامل الدرجة</button><button type="button" aria-pressed="${R.mode === 'up'}" onclick="rubricSetMode('up')">صفر</button></div></div>` : '';
  return `<div class="rb-stus" role="group" aria-label="الطلاب">${chips}</div>
    <div class="rb-total" aria-live="polite"><div class="rb-total-r"><span>${escapeHtml(cur.full_name)}${R.done.has(cur.id) && !R.dirty.has(cur.id) ? ' — معتمد' : ''}</span><b>${formatScore(total)} من ${formatScore(R.max)}</b></div>
      <div class="rb-bar"><i style="width:${R.max > 0 ? Math.min(100, total / R.max * 100) : 0}%"></i></div>
      <div class="rb-total-r"><small>${hint}</small><button type="button" class="rb-link" onclick="rubricToggleSet()">${R.showSet ? 'إخفاء' : 'إعدادات'}</button></div></div>
    ${settings}${tiles}
    <div class="rb-actions">${!complete ? '<span class="rb-warn">أكمل رصد كل المعايير ليُفعَّل الاعتماد</span>' : ''}
      <button type="button" class="btn btn-primary" id="rubricApproveBtn" onclick="rubricApprove()"${(!complete || R.busy) ? ' disabled' : ''}>${R.busy ? 'جارٍ الحفظ…' : (students.findIndex(st => st.id === R.cur) < students.length - 1 ? 'اعتماد والانتقال للتالي' : 'اعتماد الدرجة')}</button>
      ${R.done.has(cur.id) ? `<button type="button" class="btn btn-outline" onclick="rubricClearStudent()"${R.busy ? ' disabled' : ''}>مسح رصد هذا الطالب</button>` : ''}</div>`;
}

function rubricPaint(){
  const box = document.getElementById('rubricSheetBox');
  const R = crmSheet && crmSheet.rubric;
  if(!box || !R) return;
  box.innerHTML = rubricBodyHtml(R, rubricStudents());
}

function rubricSelectStudent(i){
  const R = crmSheet && crmSheet.rubric;
  const st = rubricStudents()[i];
  if(!R || R.busy || !st) return;
  R.cur = st.id;
  rubricPaint();
}

function rubricPickLevel(ci, level){
  const R = crmSheet && crmSheet.rubric;
  if(!R || R.busy || !R.cur || !R.criteria[ci] || !RUBRIC_LEVELS[level]) return;
  rubricPicksOf(R, R.cur).set(R.criteria[ci].id, level);
  if(R.done.has(R.cur)) R.dirty.add(R.cur);
  rubricPaint();
}

function rubricToggleSet(){
  const R = crmSheet && crmSheet.rubric;
  if(!R) return;
  R.showSet = !R.showSet;
  rubricPaint();
}

function rubricSetMode(m){
  const R = crmSheet && crmSheet.rubric;
  if(!R || R.busy || (m !== 'up' && m !== 'down')) return;
  R.mode = m;
  rubricModeSave(m);
  /* من لم يُعتمد ولم يلمس شيئًا يعاد بناء اختياراته على الطريقة الجديدة */
  [...R.picks.keys()].forEach(id => { if(!R.done.has(id)) R.picks.delete(id); });
  rubricPaint();
}

/* اعتماد الطالب: رصد المعايير ثم الدرجة الكلية (بالتتابع؛ الفشل يترك الطالب غير معتمد وإعادة المحاولة آمنة) */
async function rubricApprove(){
  const s = crmSheet, R = s && s.rubric;
  if(!R || R.busy || !R.cur) return;
  const studentId = R.cur, testId = R.testId, token = s.token;
  const picks = rubricPicksOf(R, studentId);
  const lv = id => (picks.has(id) ? picks.get(id) : null);
  if(!rubricIsComplete(R.criteria, lv)){ showToast('أكمل رصد كل المعايير أولًا', 'error'); return; }
  const total = rubricTotal(R.criteria, lv);
  R.busy = true;
  rubricPaint();
  const uid = currentUser.id;
  const rows = R.criteria.map(c => ({ teacher_id: uid, column_id: testId, criterion_id: c.id, student_id: studentId, level: picks.get(c.id) }));
  let err = null;
  try{
    const r1 = await sb.from('classroom_rubric_marks').upsert(rows, { onConflict: 'criterion_id,student_id' });
    if(r1.error) throw r1.error;
    const r2 = await sb.from('classroom_grade_scores').upsert({ teacher_id: uid, column_id: testId, student_id: studentId, score: total }, { onConflict: 'column_id,student_id' });
    if(r2.error) throw r2.error;
  } catch(e){ err = e; }
  R.busy = false;
  /* المعلم انتقل لاختبار/شعبة أخرى أثناء الحفظ: لا نكتب فوق الشاشة الجديدة */
  if(crmSheet !== s || s.token !== token || s.rubric !== R || s.test.selectedId !== testId) return;
  if(err){
    showToast('لم يُحفظ الرصد: ' + (typeof gradeDbErrorMessage === 'function' ? gradeDbErrorMessage(err) : (err.message || 'خطأ بالاتصال')), 'error');
    rubricPaint();
    return;
  }
  R.marks.set(studentId, new Map(picks));
  R.done.add(studentId);
  R.dirty.delete(studentId);
  s.test.values.set(studentId, total);
  const students = rubricStudents();
  const idx = students.findIndex(st => st.id === studentId);
  const next = students.slice(idx + 1).find(st => !R.done.has(st.id)) || students[idx + 1];
  if(next) R.cur = next.id;
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  rubricPaint();
}

async function rubricClearStudent(){
  const s = crmSheet, R = s && s.rubric;
  if(!R || R.busy || !R.cur || !R.done.has(R.cur)) return;
  const studentId = R.cur, testId = R.testId, token = s.token;
  const st = rubricStudents().find(x => x.id === studentId);
  const ok = await showConfirm(`مسح رصد ${st ? st.full_name : 'الطالب'} (معاييره ودرجته الكلية) من هذا الاختبار؟`);
  if(!ok || crmSheet !== s || s.rubric !== R || R.busy) return;
  R.busy = true;
  rubricPaint();
  const uid = currentUser.id;
  let err = null;
  try{
    const r1 = await sb.from('classroom_grade_scores').delete().eq('teacher_id', uid).eq('column_id', testId).eq('student_id', studentId);
    if(r1.error) throw r1.error;
    const r2 = await sb.from('classroom_rubric_marks').delete().eq('teacher_id', uid).eq('column_id', testId).eq('student_id', studentId);
    if(r2.error) throw r2.error;
  } catch(e){ err = e; }
  R.busy = false;
  if(crmSheet !== s || s.token !== token || s.rubric !== R || s.test.selectedId !== testId) return;
  if(err){ showToast('تعذّر المسح: ' + (err.message || 'خطأ بالاتصال'), 'error'); rubricPaint(); return; }
  R.marks.delete(studentId); R.picks.delete(studentId); R.done.delete(studentId); R.dirty.delete(studentId);
  s.test.values.delete(studentId);
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  rubricPaint();
}

/* ============ تقرير الطالب التحليلي ============ */
/* لكل اختبار بسلّم رُصد فيه الطالب: { name, max, score, items: [{ name, points, level }] }. الفشل لا يمنع التقرير */
async function rubricReportRows(g, studentId){
  if(!rubricOn() || !g || !currentUser) return [];
  const tests = (g.columns || []).filter(c => c.category === 'tests' && !c.tool_id && rubricIsColumn(c.id));
  if(!tests.length) return [];
  try{
    const { data, error } = await sb.from('classroom_rubric_marks').select('column_id, criterion_id, level')
      .eq('teacher_id', currentUser.id).eq('student_id', studentId).in('column_id', tests.map(c => c.id));
    if(error) throw error;
    const out = [];
    tests.forEach(c => {
      const mine = new Map((data || []).filter(r => r.column_id === c.id).map(r => [r.criterion_id, Number(r.level)]));
      const sc = (g.scores || []).find(s => s.column_id === c.id && s.student_id === studentId);
      if(!sc || !mine.size) return;
      out.push({ name: c.name, max: Number(c.max_score), score: Number(sc.score),
        items: rubricCriteriaOf(c.id).filter(k => mine.has(k.id)).map(k => ({ name: k.name, points: k.points, level: mine.get(k.id) })) });
    });
    return out;
  } catch(e){ return []; }
}

function rubricReportHtml(list){
  const e = escapeHtml;
  const n = typeof srNum === 'function' ? srNum : String;
  return `<div class="sec long"><h2>معايير الاختبارات</h2>${list.map(t => `<table><thead><tr><th>${e(t.name)}</th><th class="n">الدرجة</th><th class="n">المستوى</th></tr></thead><tbody>${t.items.map(it => {
      const lv = RUBRIC_LEVELS[it.level];
      return `<tr><td>${e(it.name)}</td><td class="n">${n(formatScore(rubricPointsAt(it.points, it.level)))} من ${n(formatScore(it.points))}</td><td class="n">${lv ? lv.label : ''}</td></tr>`;
    }).join('')}<tr><td><b>المجموع</b></td><td class="n"><b>${n(formatScore(t.score))} من ${n(formatScore(t.max))}</b></td><td></td></tr></tbody></table>`).join('')}<div class="fn">تفصيل درجة الاختبار بحسب معاييره، وقائع من رصد المعلم دون حكم.</div></div>`;
}

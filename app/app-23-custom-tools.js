/* ============================================================
   "أضف أداة بنفسك" — أدوات يصنعها المعلم لورقة الحصة
   ------------------------------------------------------------
   باتفاق مع المعلم، ثلاثة أنواع (نفس محرّكات الأدوات المبنية):
   - عدّاد (+1): كالمشاركة — نقرة = +1 في عمود الأداة (حتى حدّه).
   - حالة (تمّ / لم يتمّ): رصد لكل حصة؛ العمود = نسبة "تمّ" × حدّه.
   - درجة: درجة لكل حصة من درجة الأداة؛ العمود = متوسط النسب × حدّه.
   - ما لم يُرصد لا يُحسب (لا صفر صامت). الطالب يُحسب على رصده في الفصل
     الدراسي ولو في شعبة سابقة.
   - عمود الأداة في الكشف يُنشأ تلقائيًا عند أول رصد في الشعبة (kind يبقى
     'manual' ورابطه tool_id)، ضمن سقف فئته.
   - الإخفاء من شاشة التخصيص (hidden) يُبقي البيانات ولا يحسبها؛ الحذف يحذف
     الأداة وأعمدتها ورصدها (بتأكيد صريح).
   ============================================================ */

const CUSTOM_TOOL_TYPES = {
  counter: { label: 'عدّاد (+1)', sub: 'نقرة = +1 حتى درجة العمود — مثل: القراءة الجهرية، الإجابات الصحيحة', icon: '➕' },
  status: { label: 'حالة (تمّ / لم يتمّ)', sub: 'رصد لكل حصة، والدرجة نسبة "تمّ" — مثل: إحضار الكتاب، الدفتر', icon: '☑️' },
  score: { label: 'درجة', sub: 'درجة لكل حصة، والعمود متوسطها — مثل: تقويم شفهي قصير', icon: '🔢' }
};
const CUSTOM_TOOL_MAX = 6;

let crmCustomTools = [];
let crmCustomToolsLoaded = false;

/* ============ دوال صرفة ============ */
function customToolById(id){ return crmCustomTools.find(t => t.id === id) || null; }

function customToolVisible(tool){ return !!tool && !tool.hidden && appSectionOn('classroom'); }

/* عمود أداة: ظاهر ويُحسب؟ أداة لم تُحمَّل بعد = ظاهر (لا نُخفي بالخطأ) */
function toolColumnVisible(c){
  const t = customToolById(c.tool_id);
  if(!t) return !crmCustomToolsLoaded;
  return customToolVisible(t) && (c.category !== 'tests' || appToolOn('tests'));
}

/* عمود محسوب (لا يُرصد يدويًا): الواجبات والمهام، وأدوات الحالة والدرجة */
function isComputedGradeColumn(c){
  if(!c) return false;
  if(c.tool_id){
    const t = customToolById(c.tool_id);
    return !!t && t.tool_type !== 'counter';
  }
  return isComputedGradeKind(c.kind);
}

/* درجة الطالب في عمود أداة الحالة/الدرجة: متوسط نسب رصده × حد العمود؛ لا رصد = null */
function toolColumnScoreFor(tool, values, colMax){
  const vals = (values || []).map(Number).filter(v => Number.isFinite(v));
  if(!vals.length) return null;
  const toRatio = tool.tool_type === 'status' ? (v => (v >= 1 ? 1 : 0)) : (v => Math.min(1, v / Number(tool.max_score)));
  const avg = vals.reduce((s, v) => s + toRatio(v), 0) / vals.length;
  return Math.round(100 * avg * Number(colMax)) / 100;
}

function nextToolStatus(v){
  return v === undefined || v === null ? 1 : (v >= 1 ? 0 : null); /* لم يُرصد ← تمّ ← لم يتمّ ← لم يُرصد */
}

function sheetModeLabel(mode){
  if(String(mode).indexOf('tool:') === 0){
    const t = customToolById(mode.slice(5));
    return t ? t.name : 'أداة';
  }
  return CRM_SHEET_MODE_LABELS[mode] || mode;
}

function enabledCustomToolModes(){
  return crmCustomTools.filter(customToolVisible).map(t => 'tool:' + t.id);
}

function toolDbErrorMessage(error){
  const msg = (error && error.message) || '';
  if(msg.indexOf('tool_mark_above_max') !== -1) return 'الدرجة أكبر من درجة الأداة — ربما عُدّلت من جهاز آخر';
  if(msg.indexOf('tool_max_below_marks') !== -1) return 'توجد درجات مرصودة أعلى من الدرجة الجديدة';
  if(msg.indexOf('tool_type_locked') !== -1) return 'لا يمكن تغيير نوع الأداة بعد إنشائها';
  return msg || 'خطأ بالاتصال';
}

/* شرح كيف تُحسب الأداة في الكشف — يظهر في نافذة الأداة قبل الحفظ */
function customToolHintText(type, max, category){
  const m = Number(max);
  if(!(m > 0)) return '';
  const f = formatScore;
  if(type === 'counter') return `كل نقرة = +1 للطالب حتى ${f(m)}، وعمود الكشف مجموع نقراته (من ${f(m)}).`;
  if(type === 'status') return `تضغط لكل طالب "تمّ" أو "لم يتمّ" في كل حصة. عمود الكشف = نسبة مرات "تمّ" × ${f(m)}. مثال: تمّ في 3 من 4 مرات = ${f(0.75 * m)} من ${f(m)}.`;
  return `لكل طالب درجة من ${f(m)} في كل مرة ترصد فيها. عمود الكشف = متوسط درجاته (تُجمع الدرجات وتُقسم على عدد مرات الرصد). مثال: ${f(m)} ثم ${f(m / 2)} = ${f(0.75 * m)} من ${f(m)}. ومن لم يُرصد له شيء لا يُحسب عليه.`;
}

/* أضيق مساحة متبقية في فئة عبر كشوف الفصل: أعمدة كل شعبة تُجمع (بدون أعمدة هذه الأداة نفسها) */
function toolCapRoom(columns, category, cap, ownToolId){
  const bySection = new Map();
  (columns || []).forEach(c => {
    if(c.category !== category || (ownToolId && c.tool_id === ownToolId)) return;
    if(!bySection.has(c.section_id)) bySection.set(c.section_id, []);
    bySection.get(c.section_id).push(c);
  });
  let worst = null;
  bySection.forEach(cols => {
    const used = cols.reduce((n, c) => n + Number(c.max_score), 0);
    if(!worst || used > worst.used) worst = { used, names: cols.map(c => c.name) };
  });
  if(!worst) return { remaining: cap, names: [] };
  return { remaining: Math.round((cap - worst.used) * 100) / 100, names: worst.names };
}

/* ============ التحميل ============ */
async function loadCustomTools(uid){
  crmCustomTools = [];
  crmCustomToolsLoaded = false;
  const { data, error } = await sb.from('classroom_custom_tools').select('id, name, tool_type, category, max_score, hidden, position, created_at')
    .eq('teacher_id', uid).order('position', { ascending: true }).order('created_at', { ascending: true });
  if(error) throw error;
  if(!currentUser || currentUser.id !== uid) return;
  crmCustomTools = (data || []).map(t => Object.assign({}, t, { max_score: Number(t.max_score) }));
  crmCustomToolsLoaded = true;
}

/* عمود الأداة في كشف الشعبة للفصل: يُعاد إن وُجد، ويُنشأ ضمن سقف فئته إن لم يوجد.
   { column } أو { error: 'cap', remaining } */
async function ensureToolColumn(tool, sectionId, term){
  const uid = currentUser.id;
  const find = () => sb.from('classroom_grade_columns').select('id, name, max_score, kind, category, tool_id')
    .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester).eq('tool_id', tool.id).limit(1);
  const { data: found, error: fErr } = await find();
  if(fErr) throw fErr;
  if((found || [])[0]) return { column: found[0] };
  const { data: cols, error: cErr } = await sb.from('classroom_grade_columns').select('category, max_score')
    .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester);
  if(cErr) throw cErr;
  const used = (cols || []).filter(c => c.category === tool.category).reduce((s, c) => s + Number(c.max_score), 0);
  const remaining = Math.round((gradeCap(tool.category) - used) * 100) / 100;
  if(tool.max_score > remaining) return { error: 'cap', remaining };
  const { data: created, error } = await sb.from('classroom_grade_columns').insert({
    teacher_id: uid, section_id: sectionId, academic_year: term.year, semester: term.semester,
    category: tool.category, name: tool.name, max_score: tool.max_score, kind: 'manual', tool_id: tool.id,
    position: (cols || []).filter(c => c.category === tool.category).length
  }).select('id, name, max_score, kind, category, tool_id').single();
  if(error){
    if(error.code === '23505'){ /* أُنشئ من جهاز آخر للتو */
      const { data: again } = await find();
      if((again || [])[0]) return { column: again[0] };
    }
    if(String(error.message || '').indexOf('grade_cap_exceeded') !== -1) return { error: 'cap', remaining };
    throw error;
  }
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  return { column: created };
}

/* يكتب درجات عمود أداة الحالة/الدرجة لطلاب الشعبة (أو studentIds). يرمي عند الفشل. */
async function syncToolColumn(column, tool, sectionId, term, studentIds){
  if(!column || !tool || tool.tool_type === 'counter') return;
  const uid = currentUser.id;
  const ids = studentIds || crmStudentsOfSection(sectionId).map(s => s.id);
  if(!ids.length) return;
  let marks = [];
  for(const chunk of chunkArray(ids, 100)){
    const { data, error } = await sb.from('classroom_tool_marks').select('student_id, value')
      .eq('teacher_id', uid).eq('tool_id', tool.id).eq('academic_year', term.year).eq('semester', term.semester).in('student_id', chunk);
    if(error) throw error;
    marks = marks.concat(data || []);
  }
  const byStudent = new Map();
  marks.forEach(m => { if(!byStudent.has(m.student_id)) byStudent.set(m.student_id, []); byStudent.get(m.student_id).push(m.value); });
  const { data: rows, error: sErr } = await sb.from('classroom_grade_scores').select('student_id, score').eq('teacher_id', uid).eq('column_id', column.id);
  if(sErr) throw sErr;
  const existing = new Map((rows || []).map(r => [r.student_id, Number(r.score)]));
  const plan = planComputedScoreSync(ids, id => toolColumnScoreFor(tool, byStudent.get(id), column.max_score), existing);
  if(plan.upserts.length){
    const { error: uErr } = await sb.from('classroom_grade_scores').upsert(
      plan.upserts.map(u => ({ teacher_id: uid, column_id: column.id, student_id: u.student_id, score: u.score })),
      { onConflict: 'column_id,student_id' });
    if(uErr) throw uErr;
  }
  if(plan.deletes.length){
    const { error: dErr } = await sb.from('classroom_grade_scores').delete()
      .eq('teacher_id', uid).eq('column_id', column.id).in('student_id', plan.deletes);
    if(dErr) throw dErr;
  }
  if((plan.upserts.length || plan.deletes.length) && typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
}

/* ============ ورقة الحصة: وضع أداة الحالة/الدرجة ============ */
function toolCapMessage(tool, remaining){
  return `لا متسع في سقف "${escapeHtml(GRADE_CATEGORY_LABELS[tool.category])}" لعمود "${escapeHtml(tool.name)}" (المتبقي ${formatScore(Math.max(0, remaining))} والأداة من ${formatScore(tool.max_score)}) — الرصد يُحفظ ولا يُحسب في الكشف حتى تعدّل الأعمدة أو درجة الأداة.`;
}

async function renderCrmToolMode(students, tool){
  if(tool.tool_type === 'counter') return renderCrmParticipation(students, tool);
  const s = crmSheet;
  const mode = 'tool:' + tool.id;
  const body = document.getElementById('crmLessonSheetBody');
  const head = `<div class="crm-sheet-head">${crmSheetHeaderText(s)}</div>${crmSheetModeSwitchHtml()}`;
  body.innerHTML = head + '<div class="loading-state">جارٍ التحميل...</div>';
  const token = s.token;
  const term = crmCurrentTerm();
  const period = s.period || 0;
  let colRes, marks;
  try{
    [colRes, marks] = await Promise.all([
      ensureToolColumn(tool, s.sectionId, term),
      sb.from('classroom_tool_marks').select('student_id, value').eq('teacher_id', currentUser.id).eq('tool_id', tool.id)
        .eq('section_id', s.sectionId).eq('mark_date', s.dateIso).eq('period', period)
    ]);
    if(marks.error) throw marks.error;
  } catch(e){
    if(crmSheet !== s || s.token !== token || s.mode !== mode) return;
    body.innerHTML = head + `<div class="empty-state">تعذّر التحميل. <button class="btn btn-outline crm-mini-btn" onclick="setCrmSheetMode('${mode}')">إعادة المحاولة</button></div>`;
    return;
  }
  if(crmSheet !== s || s.token !== token || s.mode !== mode) return;
  s.tool = { tool, column: colRes.column || null, values: new Map((marks.data || []).map(m => [m.student_id, Number(m.value)])), queue: new Map(), term, period };
  const status = tool.tool_type === 'status';
  body.innerHTML = head + `
    ${colRes.error ? `<div class="cust-sheet-hidden">${toolCapMessage(tool, colRes.remaining)}</div>` : ''}
    <div id="crmToolCounts" class="crm-sheet-counts"></div>
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">${status
      ? 'اضغط: تمّ ← لم يتمّ ← لم يُرصد. يُحفظ فورًا، و"لم يُرصد" لا يُحسب.'
      : `اضغط على الطالب لرصد درجته من ${formatScore(tool.max_score)}. ما لم يُرصد لا يُحسب.`}${s.tool.column ? ' يُحسب في عمود "' + escapeHtml(s.tool.column.name) + '".' : ''}</p>
    <div class="crm-att-grid">
      ${students.map(st => `<div class="crm-att-cell">
        <button type="button" class="crm-att-btn${s.states && s.states[st.id] === 'absent' ? ' is-absent' : ''}" id="crmTool_${st.id}" onclick="tapCrmTool('${st.id}')">
          <span class="crm-att-name">${escapeHtml(st.full_name)}</span><span class="crm-att-state"></span></button>
      </div>`).join('')}
    </div>
    <div class="crm-sheet-bar">
      ${status ? '<button class="btn btn-outline" style="flex:1;" onclick="markAllCrmToolDone()">الكل تمّ</button>' : ''}
      <button class="btn btn-outline"${status ? '' : ' style="flex:1;"'} onclick="closeCrmLessonSheet()">رجوع</button>
    </div>`;
  students.forEach(st => paintCrmTool(st.id));
  paintCrmToolCounts();
}

function paintCrmTool(studentId){
  const t = crmSheet && crmSheet.tool;
  const btn = document.getElementById('crmTool_' + studentId);
  if(!btn || !t) return;
  const v = t.values.has(studentId) ? t.values.get(studentId) : null;
  const absent = btn.classList.contains('is-absent') ? ' is-absent' : '';
  let cls, text;
  if(t.tool.tool_type === 'status'){
    cls = v === null ? 'tk-none' : (v >= 1 ? 'tk-high' : 'tk-low');
    text = v === null ? 'لم يُرصد' : (v >= 1 ? 'تمّ' : 'لم يتمّ');
  } else {
    cls = taskScoreTone(v, t.tool.max_score);
    text = v === null ? 'لم يُرصد' : `${formatScore(v)} / ${formatScore(t.tool.max_score)}`;
  }
  btn.className = 'crm-att-btn ' + cls + absent;
  btn.querySelector('.crm-att-state').textContent = text;
}

function paintCrmToolCounts(){
  const el = document.getElementById('crmToolCounts');
  const t = crmSheet && crmSheet.tool;
  if(!el || !t) return;
  const ids = crmStudentsOfSection(crmSheet.sectionId).map(x => x.id);
  const vals = ids.filter(id => t.values.has(id)).map(id => t.values.get(id));
  if(t.tool.tool_type === 'status'){
    const done = vals.filter(v => v >= 1).length;
    el.textContent = `تمّ ${done} · لم يتمّ ${vals.length - done} · لم يُرصد ${ids.length - vals.length}`;
  } else {
    const avg = vals.length ? Math.round(100 * vals.reduce((a, b) => a + b, 0) / vals.length) / 100 : null;
    el.textContent = `رُصد ${vals.length} من ${ids.length}` + (avg === null ? '' : ` · المتوسط ${formatScore(avg)} من ${formatScore(t.tool.max_score)}`);
  }
}

function tapCrmTool(studentId){
  const t = crmSheet && crmSheet.tool;
  if(!t) return;
  if(t.tool.tool_type === 'status'){
    const prev = t.values.has(studentId) ? t.values.get(studentId) : null;
    setCrmToolValue(studentId, nextToolStatus(prev));
  } else {
    openCrmToolScorePicker(studentId);
  }
}

function openCrmToolScorePicker(studentId){
  const t = crmSheet && crmSheet.tool;
  if(!t) return;
  const st = crmStudents.find(x => x.id === studentId);
  const cur = t.values.has(studentId) ? t.values.get(studentId) : null;
  t.pick = { toolId: t.tool.id, studentId };
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${escapeHtml(st ? st.full_name : '')}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(t.tool.name)} · من ${formatScore(t.tool.max_score)}</div>
      <div class="crm-task-chips">
        ${taskQuickScores(t.tool.max_score).map(q => `<button type="button" class="btn btn-outline${cur === q.value ? ' is-on' : ''}" onclick="applyCrmToolScore(${q.value})">${q.label}<small>${formatScore(q.value)}</small></button>`).join('')}
      </div>
      <label class="crm-field-label">أو درجة دقيقة</label>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <input class="goal-input" id="crmToolScoreInput" inputmode="decimal" style="margin:0;flex:1;" value="${cur === null ? '' : formatScore(cur)}" placeholder="من ${formatScore(t.tool.max_score)}">
        <button class="btn btn-primary" onclick="saveCrmToolScoreInput()">حفظ</button>
      </div>
      <div id="crmToolScoreError" style="display:none;color:#8A2C2C;font-size:12px;margin-bottom:6px;"></div>
      ${cur === null ? '' : '<button class="btn btn-outline" style="width:100%;justify-content:center;" onclick="applyCrmToolScore(null)">مسح الرصد (لم يُرصد)</button>'}
    </div>`, '400px');
}

function saveCrmToolScoreInput(){
  const t = crmSheet && crmSheet.tool;
  if(!t) return;
  const r = parseTaskScore(document.getElementById('crmToolScoreInput').value, t.tool.max_score);
  if(r.error){
    const box = document.getElementById('crmToolScoreError');
    box.textContent = r.error;
    box.style.display = 'block';
    return;
  }
  applyCrmToolScore(r.value);
}

function applyCrmToolScore(value){
  const t = crmSheet && crmSheet.tool;
  const p = t && t.pick;
  closeCrmModal();
  /* الأداة المعروضة تغيّرت بعد فتح النافذة: لا نكتب على أداة أخرى */
  if(!p || t.tool.id !== p.toolId) return;
  t.pick = null;
  setCrmToolValue(p.studentId, value);
}

/* عرض فوري ثم حفظ بالتتابع لكل طالب، ثم إعادة حساب عموده؛ الفشل يعيد العرض */
function setCrmToolValue(studentId, value){
  const s = crmSheet;
  const t = s && s.tool;
  if(!t) return;
  const prev = t.values.has(studentId) ? t.values.get(studentId) : null;
  if(prev === value) return;
  if(value === null) t.values.delete(studentId); else t.values.set(studentId, value);
  paintCrmTool(studentId);
  paintCrmToolCounts();
  const toolId = t.tool.id;
  const before = t.queue.get(studentId) || Promise.resolve();
  const next = before.then(async () => {
    const uid = currentUser.id;
    try{
      const q = value === null
        ? sb.from('classroom_tool_marks').delete().eq('teacher_id', uid).eq('tool_id', toolId).eq('student_id', studentId).eq('mark_date', s.dateIso).eq('period', t.period)
        : sb.from('classroom_tool_marks').upsert({
            teacher_id: uid, tool_id: toolId, student_id: studentId, section_id: s.sectionId, academic_year: t.term.year, semester: t.term.semester,
            mark_date: s.dateIso, period: t.period, value
          }, { onConflict: 'tool_id,student_id,mark_date,period' });
      const { error } = await q;
      if(error) throw error;
    } catch(e){
      if(crmSheet === s && s.tool === t && (t.values.has(studentId) ? t.values.get(studentId) : null) === value){
        if(prev === null) t.values.delete(studentId); else t.values.set(studentId, prev);
        paintCrmTool(studentId);
        paintCrmToolCounts();
      }
      showToast('لم يُحفظ الرصد: ' + toolDbErrorMessage(e), 'error');
      return;
    }
    try{ await syncToolColumn(t.column, t.tool, s.sectionId, t.term, [studentId]); }
    catch(e){ showToast('حُفظ الرصد، وتعذّر تحديث عموده — يُحدَّث عند فتح الكشف', 'error'); }
  });
  t.queue.set(studentId, next);
  return next;
}

let crmToolBulkBusy = false;
async function markAllCrmToolDone(){
  const s = crmSheet;
  const t = s && s.tool;
  if(!t || t.tool.tool_type !== 'status' || crmToolBulkBusy) return;
  const ids = crmStudentsOfSection(s.sectionId).map(x => x.id).filter(id => !t.values.has(id));
  if(!ids.length) return;
  crmToolBulkBusy = true;
  ids.forEach(id => { t.values.set(id, 1); paintCrmTool(id); });
  paintCrmToolCounts();
  const uid = currentUser.id;
  /* حفظ فردي معلّق لنفس الطالب (كمسح رصده) يسبق الحفظ الجماعي، ونقرة فردية بعده تنتظره — وإلا سبق أحدهما الآخر وخالف المحفوظُ المعروض */
  const pending = ids.map(id => t.queue.get(id)).filter(Boolean);
  const bulk = (async () => {
    try{
      await Promise.all(pending);
      const { error } = await sb.from('classroom_tool_marks').upsert(ids.map(id => ({
        teacher_id: uid, tool_id: t.tool.id, student_id: id, section_id: s.sectionId, academic_year: t.term.year, semester: t.term.semester,
        mark_date: s.dateIso, period: t.period, value: 1
      })), { onConflict: 'tool_id,student_id,mark_date,period' });
      if(error) throw error;
      await syncToolColumn(t.column, t.tool, s.sectionId, t.term, ids);
      showToast('سُجّل "تمّ" للباقين — اضغط على من لم يتمّ لتعديله', 'ok');
    } catch(e){
      showToast('تعذّر الحفظ: ' + toolDbErrorMessage(e), 'error');
      if(crmSheet === s) setCrmSheetMode('tool:' + t.tool.id);
    }
  })();
  ids.forEach(id => t.queue.set(id, bulk));
  try{ await bulk; } finally { crmToolBulkBusy = false; }
}

/* ============ تخصيص التطبيق ← أدواتك الخاصة ============ */
function customToolsSectionHtml(){
  const rows = crmCustomTools.map(t => `<div class="cust-row${t.hidden ? ' is-off' : ''}">
    <div class="cust-text">
      <b>🧩 ${escapeHtml(t.name)}</b>
      <small>${CUSTOM_TOOL_TYPES[t.tool_type].label} · ${escapeHtml(GRADE_CATEGORY_LABELS[t.category])} · من ${formatScore(t.max_score)}</small>
      ${t.hidden ? '<small class="cust-hidden">👁 مخفية — بياناتها محفوظة</small>' : ''}
      <a href="#" style="font-size:11.5px;" onclick="event.preventDefault();openCustomToolEditor('${t.id}')">تعديل</a>
    </div>
    <button type="button" class="cust-switch${t.hidden ? '' : ' is-on'}" role="switch" aria-checked="${!t.hidden}" aria-label="${escapeHtml(t.name)}" onclick="toggleCustomToolHidden('${t.id}')"><span></span></button>
  </div>`).join('');
  return `<h3 class="cust-h">أدواتك الخاصة</h3>
    ${rows || '<p class="cust-note">أضف أداة بنفسك تظهر في ورقة الحصة ولها عمود في الكشف.</p>'}
    ${crmCustomTools.length < CUSTOM_TOOL_MAX ? '<button class="btn btn-outline crm-mini-btn" onclick="openCustomToolEditor(null)">+ أضف أداة</button>' : ''}`;
}

let customToolDraft = null; /* { id?, type, saving } */

function openCustomToolEditor(id){
  const t = id ? customToolById(id) : null;
  if(id && !t) return;
  customToolDraft = { id: id || null, type: t ? t.tool_type : 'counter', saving: false };
  showInfoModal(`<div id="custToolBody" style="text-align:right;"></div>`, '460px');
  renderCustomToolEditor(t);
}

function renderCustomToolEditor(t){
  const d = customToolDraft, box = document.getElementById('custToolBody');
  if(!d || !box) return;
  const name = document.getElementById('custToolName');
  const keepName = name ? name.value : (t ? t.name : '');
  const maxEl = document.getElementById('custToolMax');
  const keepMax = maxEl ? maxEl.value : (t ? formatScore(t.max_score) : '10');
  const catEl = document.getElementById('custToolCat');
  const keepCat = catEl ? catEl.value : (t ? t.category : 'performance');
  box.innerHTML = `
    <h3 class="cust-wiz-h">${d.id ? 'تعديل الأداة' : 'أداة جديدة'}</h3>
    <label class="crm-field-label">اسم الأداة (يظهر في ورقة الحصة والكشف)</label>
    <input class="goal-input" id="custToolName" maxlength="40" placeholder="مثال: القراءة الجهرية" value="${escapeHtml(keepName)}" style="margin-bottom:8px;">
    <label class="crm-field-label">النوع${d.id ? ' (لا يتغيّر بعد الإنشاء)' : ''}</label>
    <div class="cust-cards" style="margin-bottom:8px;">
      ${Object.keys(CUSTOM_TOOL_TYPES).map(k => `<button type="button" class="cust-card${d.type === k ? ' is-on' : ''}"${d.id ? ' disabled' : ''} onclick="pickCustomToolType('${k}')">
        <b>${CUSTOM_TOOL_TYPES[k].icon} ${CUSTOM_TOOL_TYPES[k].label}</b><small>${CUSTOM_TOOL_TYPES[k].sub}</small></button>`).join('')}
    </div>
    <div style="display:flex;gap:8px;">
      <div style="flex:1;"><label class="crm-field-label">${d.type === 'score' ? 'درجة كل رصد وعموده' : 'درجة العمود'}</label>
        <input class="goal-input" id="custToolMax" inputmode="decimal" value="${escapeHtml(keepMax)}" oninput="refreshCustomToolHint()" style="margin-bottom:8px;"></div>
      <div style="flex:1;"><label class="crm-field-label">تُحسب ضمن</label>
        <select class="goal-input" id="custToolCat" onchange="refreshCustomToolHint()" style="margin-bottom:8px;"${d.id ? ' disabled' : ''}>
          ${['performance', 'tests'].map(c => `<option value="${c}"${keepCat === c ? ' selected' : ''}>${escapeHtml(GRADE_CATEGORY_LABELS[c])}</option>`).join('')}
        </select></div>
    </div>
    ${d.id ? '<p class="cust-note" style="margin:0 0 6px;">تعديل الدرجة يُطبَّق على أعمدة الشعب الجديدة؛ عدّل الأعمدة القائمة من الكشف.</p>' : ''}
    <p id="custToolHint" class="cust-note" style="margin:0 0 6px;"></p>
    <p id="custToolRoom" class="cust-note" style="margin:0 0 6px;"></p>
    <div id="custToolErr" class="cust-caps-msg" style="display:none;"></div>
    <button class="btn btn-primary" id="custToolSaveBtn" style="width:100%;justify-content:center;margin-top:6px;" onclick="saveCustomTool()">${d.id ? 'حفظ التعديل' : 'إضافة الأداة'}</button>
    ${d.id ? `<button class="btn btn-outline" id="custToolDeleteBtn" style="width:100%;justify-content:center;margin-top:8px;color:#8A2C2C;" onclick="deleteCustomTool('${d.id}')">حذف الأداة</button>` : ''}`;
  refreshCustomToolHint();
}

let customToolRoomSeq = 0;
/* الشرح يتبع النوع والدرجة والفئة؛ ثم تنبيه السقف من كشوف المعلم (قراءة فقط، تُهمل إن تغيّرت النافذة) */
async function refreshCustomToolHint(){
  const d = customToolDraft;
  const hint = document.getElementById('custToolHint'), room = document.getElementById('custToolRoom');
  if(!d || !hint || !room || !currentUser) return;
  const max = parseCapInput(document.getElementById('custToolMax').value);
  const category = document.getElementById('custToolCat').value === 'tests' ? 'tests' : 'performance';
  hint.textContent = customToolHintText(d.type, max, category);
  const cap = gradeCap(category);
  room.textContent = `سقف "${GRADE_CATEGORY_LABELS[category]}" عندك ${formatScore(cap)} درجة.`;
  room.style.color = '';
  const seq = ++customToolRoomSeq;
  const uid = currentUser.id;
  let term;
  try{ term = crmCurrentTerm(); } catch(e){ return; }
  const { data, error } = await sb.from('classroom_grade_columns').select('section_id, category, name, max_score, tool_id')
    .eq('teacher_id', uid).eq('academic_year', term.year).eq('semester', term.semester).eq('category', category);
  if(error || seq !== customToolRoomSeq || customToolDraft !== d || !currentUser || currentUser.id !== uid) return;
  const r = toolCapRoom(data, category, cap, d.id);
  if(max > 0 && r.names.length && max > r.remaining){
    room.style.color = '#8A2C2C';
    room.textContent = `تنبيه: في أحد كشوفك المتبقي من سقف "${GRADE_CATEGORY_LABELS[category]}" ${formatScore(Math.max(0, r.remaining))} فقط، وهذه الأداة من ${formatScore(max)} — لن يُنشأ عمودها هناك حتى تعدّل أو تحذف أعمدة قائمة (${r.names.slice(0, 4).join('، ')}). الرصد لا يضيع.`;
  }
}

function pickCustomToolType(k){
  if(!customToolDraft || customToolDraft.id || customToolDraft.saving) return;
  customToolDraft.type = k;
  renderCustomToolEditor(null);
}

async function saveCustomTool(){
  const d = customToolDraft;
  if(!d || d.saving || !currentUser) return;
  const err = document.getElementById('custToolErr');
  const fail = m => { err.textContent = m; err.style.display = 'block'; err.style.color = '#8A2C2C'; };
  const name = document.getElementById('custToolName').value.trim();
  const max = parseCapInput(document.getElementById('custToolMax').value);
  const category = document.getElementById('custToolCat').value === 'tests' ? 'tests' : 'performance';
  if(!name) return fail('اكتب اسم الأداة');
  if(name.length > 40) return fail('الاسم 40 حرفًا كحد أقصى');
  if(crmCustomTools.some(t => t.id !== d.id && t.name.trim() === name)) return fail('لديك أداة بنفس الاسم');
  if(!(max > 0) || max > GRADE_COLUMN_MAX || Math.round(max * 2) !== max * 2) return fail(`الدرجة رقم بمنازل 0.5 أكبر من صفر وحتى ${GRADE_COLUMN_MAX}`);
  d.saving = true;
  const btns = ['custToolSaveBtn', 'custToolDeleteBtn'].map(i => document.getElementById(i)).filter(Boolean);
  btns.forEach(b => { b.disabled = true; });
  const uid = currentUser.id;
  const res = d.id
    ? await sb.from('classroom_custom_tools').update({ name, max_score: max }).eq('teacher_id', uid).eq('id', d.id).select('id')
    : await sb.from('classroom_custom_tools').insert({ teacher_id: uid, name, tool_type: d.type, category, max_score: max, position: crmCustomTools.length }).select('id');
  if(!currentUser || currentUser.id !== uid) return;
  if(res.error || !(res.data || []).length){
    d.saving = false;
    btns.forEach(b => { b.disabled = false; });
    return fail('تعذّر الحفظ: ' + (res.error ? toolDbErrorMessage(res.error) : 'الأداة غير موجودة — ربما حُذفت'));
  }
  customToolDraft = null;
  closeCrmModal();
  showToast(d.id ? 'عُدّلت الأداة' : 'أُضيفت الأداة — تجدها في ورقة الحصة', 'ok');
  await afterCustomToolsChanged(uid);
}

let customToolHiddenBusy = false;
async function toggleCustomToolHidden(id){
  const t = customToolById(id);
  if(!t || customToolHiddenBusy || !currentUser) return;
  customToolHiddenBusy = true;
  const uid = currentUser.id;
  try{
    const { error } = await sb.from('classroom_custom_tools').update({ hidden: !t.hidden }).eq('teacher_id', uid).eq('id', id);
    if(error) throw error;
    await afterCustomToolsChanged(uid);
  } catch(e){
    showToast('تعذّر الحفظ: ' + toolDbErrorMessage(e), 'error');
  } finally {
    customToolHiddenBusy = false;
  }
}

let customToolDeleting = false;
async function deleteCustomTool(id){
  const t = customToolById(id);
  if(!t || customToolDeleting || !currentUser) return;
  closeCrmModal();
  const ok = await showConfirm(`حذف أداة "${t.name}" نهائيًا؟ تُحذف معها أعمدتها في كل الكشوف وكل رصدها. إن أردت إيقافها مؤقتًا فأخفِها بدل حذفها.`);
  if(!ok || customToolDeleting) return;
  customToolDeleting = true;
  const uid = currentUser.id;
  try{
    const { error } = await sb.from('classroom_custom_tools').delete().eq('teacher_id', uid).eq('id', id);
    if(error) throw error;
    showToast('حُذفت الأداة', 'ok');
    await afterCustomToolsChanged(uid);
  } catch(e){
    showToast('تعذّر الحذف: ' + toolDbErrorMessage(e), 'error');
  } finally {
    customToolDeleting = false;
  }
}

/* بعد أي تغيير في الأدوات: إعادة التحميل ثم إعادة رسم ما يتأثر */
async function afterCustomToolsChanged(uid){
  try{ await loadCustomTools(uid); } catch(e){ showToast('تعذّر تحديث قائمة الأدوات', 'error'); }
  afterAppFeaturesChanged();
  if(document.getElementById('crmTabGrades') && document.getElementById('crmTabGrades').style.display !== 'none' && typeof renderCrmGrades === 'function') renderCrmGrades();
}

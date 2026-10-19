/* ============================================================
   "⚙ إعداد الدرجات" — المكان الواحد لضبط الدرجات
   ------------------------------------------------------------
   القاعدة: الإعداد هنا، والرصد في ورقة الحصة. شاشة من ثلاث خطوات:
   ① التوزيع (الأداء + الاختبارات = 60)، ② مكوّنات الأداء وأوزانها و"+ مكوّن"،
   ③ اختبارات الشعبة و"+ اختبار". الحفظ يُطبَّق على كل شعب المعلم لهذا الفصل.
   ------------------------------------------------------------
   - الأداء (40) مكوّنات: مشاركة، واجبات، مهام، وأدوات المعلم الخاصة في
     الأداء. وزن كل مكوّن = درجته في الكشف، والمجموع لا يتجاوز وزن الأداء.
   - الأداة الخاصة تصير مكوّنًا بإعطائها وزنًا هنا (يُنشأ عمودها)، بدل رسالة
     "لا متسع" عند أول رصد.
   - تغيير الوزن لا يغيّر نسبة الطالب: المرصود يدويًا (مشاركة، عدّاد، يدوي)
     يُضرب بنسبة الوزن الجديد، والمحسوب (واجبات، مهام، حالة/درجة) يُعاد حسابه.
   - يُطبَّق على الشعبة الحالية أو على كل شعب المعلم لهذا الفصل (افتراضيًا).
   ============================================================ */

const GRADE_WEIGHT_STEP = 0.5;

/* مكوّنات الأداء: أعمدة الشعبة، ثم أدوات الأداء الظاهرة التي لا عمود لها بعد (وزن 0) */
function perfComponentsFor(columns, tools){
  const cols = sortGradeColumns((columns || []).filter(c => c.category === 'performance'));
  const have = new Set(cols.filter(c => c.tool_id).map(c => c.tool_id));
  const out = cols.map(c => ({ key: 'c:' + c.id, name: c.name, max: Number(c.max_score), column: c, tool: null }));
  (tools || []).filter(t => t.category === 'performance' && !t.hidden && !have.has(t.id))
    .forEach(t => out.push({ key: 't:' + t.id, name: t.name, max: 0, column: null, tool: t }));
  return out;
}

/* هوية المكوّن لمطابقته في شعب أخرى: الأداة، أو النوع (مشاركة/واجبات/مهام)، أو اسم العمود اليدوي */
function perfComponentIdentity(comp){
  const c = comp.column;
  if(comp.tool) return 'tool:' + comp.tool.id;
  if(c.tool_id) return 'tool:' + c.tool_id;
  if(c.kind && c.kind !== 'manual') return 'kind:' + c.kind;
  return 'name:' + normalizeGradeColumnName(c.name);
}

/* weights: Map(key → نص الإدخال). يعيد { error } أو { weights: Map(key → رقم), total } */
function validatePerfWeights(components, weights, cap){
  const out = new Map();
  let total = 0;
  for(const comp of components){
    const raw = String(weights.has(comp.key) ? weights.get(comp.key) : comp.max).trim()
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/g, '.');
    const v = raw === '' ? 0 : Number(raw);
    if(!Number.isFinite(v) || v < 0 || Math.round(v / GRADE_WEIGHT_STEP) * GRADE_WEIGHT_STEP !== v) return { error: `وزن "${comp.name}" رقم بمنازل ${GRADE_WEIGHT_STEP}` };
    if(v > GRADE_COLUMN_MAX) return { error: `وزن "${comp.name}" ${GRADE_COLUMN_MAX} كحد أقصى` };
    if(comp.column && v === 0) return { error: `"${comp.name}" مكوّن قائم — أقل وزن له ${GRADE_WEIGHT_STEP} (لإيقافه أخفِ أداته من التخصيص)` };
    out.set(comp.key, v);
    total += v;
  }
  total = Math.round(total * 100) / 100;
  if(total > cap + 0.001) return { error: `المجموع ${formatScore(total)} يتجاوز وزن الأداء (${formatScore(cap)}) — أنقص ${formatScore(total - cap)}` };
  return { weights: out, total };
}

/* درجة يدوية بعد تغيير الوزن: نفس النسبة من الوزن الجديد */
function scaleGradeScore(score, oldMax, newMax){
  if(!(Number(oldMax) > 0)) return Number(score);
  return Math.min(Number(newMax), Math.round(Number(score) * Number(newMax) / Number(oldMax) * 100) / 100);
}

/* خطة شعبة: ما يُخفَّض أولًا ثم ما يُرفع ثم ما يُنشأ (لا يتجاوز السقف في أي لحظة) */
function planSectionWeights(sectionColumns, desired){
  const cols = (sectionColumns || []).filter(c => c.category === 'performance');
  const byId = new Map(cols.map(c => [perfComponentIdentity({ column: c }), c]));
  const decrease = [], increase = [], create = [];
  desired.forEach(d => {
    const c = byId.get(d.identity);
    if(c){
      const old = Number(c.max_score);
      if(Math.abs(old - d.max) < 0.001) return;
      (d.max < old ? decrease : increase).push({ column: c, old, max: d.max });
    } else if(d.tool && d.max > 0){
      create.push({ tool: d.tool, max: d.max });
    }
  });
  return { decrease, increase, create };
}

/* ============ الشاشة ============ */
let crmGradesSettingsOpen = false;
let crmWeightsDraft = null; /* { sectionId, components, saving } */

function openCrmGradeSettings(){
  crmGradesSettingsOpen = true;
  crmGradesDetail = false;
  renderCrmGrades();
}

function closeCrmGradeSettings(){
  crmGradesSettingsOpen = false;
  crmWeightsDraft = null;
  renderCrmGrades();
}

function crmGradeSettingsHtml(g){
  const back = `<p class="crm-gs-note" style="margin:0 0 8px;"><a href="#" onclick="event.preventDefault();closeCrmGradeSettings()">→ الكشف</a></p>`;
  if(!hasBaseGradeColumns(g.allColumns || g.columns)) return back + crmGradeCreateCardHtml();
  const caps = appGradeCaps();
  const comps = perfComponentsFor(g.allColumns || g.columns, typeof crmCustomTools !== 'undefined' ? crmCustomTools : []);
  crmWeightsDraft = { sectionId: g.sectionId, components: comps, saving: false };
  const hidden = new Set((g.hiddenColumns || []).map(c => c.id));
  const typeOf = c => {
    const tool = c.tool || (c.column && c.column.tool_id ? customToolById(c.column.tool_id) : null);
    if(tool) return { tool, sub: CUSTOM_TOOL_TYPES[tool.tool_type] ? CUSTOM_TOOL_TYPES[tool.tool_type].label : '' };
    return { tool: null, sub: { participation: '+1 بنقرة', homework: 'سلّم / لم يسلّم', task: 'درجة لكل مهمة' }[c.column.kind] || 'يدوي' };
  };
  const compRows = comps.map(c => {
    const t = typeOf(c);
    const value = c.tool ? formatScore(c.tool.max_score) : formatScore(c.max);
    return `<div class="crm-gs-line">
      <span>${escapeHtml(c.name)}${t.tool ? ' 🧩' : ''} <small style="color:var(--muted);">${escapeHtml(t.sub)}${c.column && hidden.has(c.column.id) ? ' · مخفي' : ''}${c.tool ? ' · جديد' : ''}</small>
        ${t.tool ? `<a href="#" style="font-size:11px;" onclick="event.preventDefault();openCustomToolEditor('${t.tool.id}')">تعديل</a>` : ''}</span>
      <input class="goal-input crm-weight-input" inputmode="decimal" data-key="${c.key}" value="${value}" oninput="paintCrmGradeSettings()" style="width:70px;margin:0;text-align:center;">
    </div>`;
  }).join('');
  const testsOn = appToolOn('tests');
  const ids = crmStudentsOfSection(g.sectionId).map(s => s.id);
  const testRows = g.columns.filter(c => c.category === 'tests').map(c => {
    const st = gradeColumnStats(c.id, g.scores, ids);
    return `<div class="crm-lesson-row" style="cursor:pointer;" onclick="openCrmGradeColumnMenu('${c.id}')">
      <span><b>${escapeHtml(c.name)}</b> · من ${formatScore(c.max_score)}${c.tool_id ? ' 🧩' : ''}</span>
      <span style="font-size:11.5px;color:var(--muted);">رُصد ${ids.length - st.missing} من ${ids.length}</span></div>`;
  }).join('');
  return back + `<div class="crm-today-card">
    <div class="crm-today-title">⚙ إعداد الدرجات</div>
    <p class="crm-gs-note" style="margin:0 0 8px;">الإعداد هنا، والرصد في ورقة الحصة. الحفظ يُطبَّق على كل شعبك لهذا الفصل.</p>

    <h4 class="crm-gs-step">① التوزيع (المجموع ${GRADE_CAPS_TOTAL})</h4>
    <div class="crm-gs-line"><span>الأداء</span><input class="goal-input" id="gsCapPerf" inputmode="decimal" value="${formatScore(caps.performance)}" oninput="syncGradeCapInputs('gs', 'performance');paintCrmGradeSettings()" style="width:70px;margin:0;text-align:center;"></div>
    <div class="crm-gs-line"><span>الاختبارات</span><input class="goal-input" id="gsCapTests" inputmode="decimal" value="${formatScore(caps.tests)}" oninput="syncGradeCapInputs('gs', 'tests');paintCrmGradeSettings()" style="width:70px;margin:0;text-align:center;"></div>
    <p class="crm-gs-note">الرسمي ${GRADE_CAPS_DEFAULT.performance} و${GRADE_CAPS_DEFAULT.tests}. اكتب إحداهما والأخرى تُكمَل.</p>

    <h4 class="crm-gs-step">② مكوّنات الأداء</h4>
    ${compRows}
    <div id="crmWeightsTotal" style="font-size:13px;font-weight:700;margin:8px 0;"></div>
    ${(typeof crmCustomTools !== 'undefined' ? crmCustomTools.length : 0) < CUSTOM_TOOL_MAX ? '<button class="btn btn-outline" style="width:100%;justify-content:center;" onclick="openCustomToolEditor(null)">+ مكوّن (مثل: بحوث، قراءة، مشروع)</button>' : ''}

    ${testsOn ? `<h4 class="crm-gs-step">③ الاختبارات — ${escapeHtml(crmSectionLabel(g.sectionId))} (محصلتها من ${formatScore(caps.tests)})</h4>
    ${testRows || '<div class="crm-today-empty">لا اختبارات بعد.</div>'}
    <button class="btn btn-outline" style="width:100%;justify-content:center;margin-top:6px;" onclick="openCrmGradeColumnEditor('tests', null)">+ اختبار</button>
    ${testRows ? '<p class="crm-gs-note">اضغط على اختبار لرصد درجاته أو تعديله أو حذفه.</p>' : ''}` : ''}

    <div id="crmGradeSettingsError" style="display:none;color:#8A2C2C;font-size:12px;margin:10px 0 0;line-height:1.7;"></div>
    <button class="btn btn-primary" id="crmGradeSettingsSaveBtn" style="width:100%;justify-content:center;margin-top:12px;" onclick="saveCrmGradeSettings()">حفظ — يُطبَّق على كل شعبي</button>
  </div>`;
}

function readCrmWeightInputs(){
  const m = new Map();
  document.querySelectorAll('.crm-weight-input').forEach(i => m.set(i.dataset.key, i.value));
  return m;
}

/* السطر الحي: مجموع المكوّنات من وزن الأداء الجديد */
function paintCrmGradeSettings(){
  const d = crmWeightsDraft, el = document.getElementById('crmWeightsTotal');
  if(!d || !el) return;
  const c = readGradeCapInputs('gs');
  const cap = c.caps ? c.caps.performance : gradeCap('performance');
  const r = validatePerfWeights(d.components, readCrmWeightInputs(), cap);
  if(r.error){ el.textContent = r.error; el.style.color = '#8A2C2C'; return; }
  el.style.color = r.total === cap ? '#12796A' : 'var(--navy)';
  el.textContent = `المجموع ${formatScore(r.total)} من ${formatScore(cap)}` + (r.total < cap ? ` — الأداء سيكون من ${formatScore(r.total)}` : ' ✓');
}

/* يطبّق أوزان المكوّنات على شعب المعلم (التي لها كشف هذا الفصل) */
async function applyPerfWeightsToSections(desired, sectionIds){
  const uid = currentUser.id;
  const term = crmCurrentTerm();
  const failed = [];
  let applied = 0;
  for(const sectionId of sectionIds){
    try{
      const { data: cols, error } = await sb.from('classroom_grade_columns').select('*')
        .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester);
      if(error) throw error;
      if(!hasBaseGradeColumns(cols)) continue; /* شعبة بلا كشف لهذا الفصل */
      await applySectionWeights(sectionId, term, cols, planSectionWeights(cols, desired));
      applied++;
    } catch(e){
      failed.push(crmSectionLabel(sectionId) + ': ' + gradeDbErrorMessage(e));
    }
    if(!currentUser || currentUser.id !== uid) return null;
  }
  return { applied, failed };
}

async function saveCrmGradeSettings(){
  const d = crmWeightsDraft;
  if(!d || d.saving || !currentUser) return;
  const err = document.getElementById('crmGradeSettingsError');
  const fail = m => { err.textContent = m; err.style.display = 'block'; };
  const c = readGradeCapInputs('gs');
  if(c.error) return fail(c.error);
  const r = validatePerfWeights(d.components, readCrmWeightInputs(), c.caps.performance);
  if(r.error) return fail(r.error);
  const desired = d.components.map(x => ({ identity: perfComponentIdentity(x), tool: x.tool || (x.column && x.column.tool_id ? customToolById(x.column.tool_id) : null), max: r.weights.get(x.key) }));
  const old = appGradeCaps();
  const capsChanged = old.performance !== c.caps.performance || old.tests !== c.caps.tests;
  d.saving = true;
  const btn = document.getElementById('crmGradeSettingsSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الحفظ...'; }
  const done = () => { d.saving = false; if(btn){ btn.disabled = false; btn.textContent = 'حفظ — يُطبَّق على كل شعبي'; } };
  const uid = currentUser.id;
  try{
    /* وزن أداء أصغر: تُصغَّر المكوّنات أولًا ثم يُحفظ التوزيع؛ وأكبر: العكس — فلا يرفض السقف خطوة في الوسط */
    if(capsChanged && c.caps.performance > old.performance){
      const e = await persistGradeCaps(c.caps);
      if(e){ done(); return fail(e); }
    }
    const res = await applyPerfWeightsToSections(desired, crmSections.map(s => s.id));
    if(!res || !currentUser || currentUser.id !== uid) return;
    if(res.failed.length){ done(); return fail('لم يكتمل في: ' + res.failed.join(' — ') + '. أعد الحفظ لإكماله.'); }
    if(capsChanged && c.caps.performance <= old.performance){
      const e = await persistGradeCaps(c.caps);
      if(e){ done(); return fail(e); }
    }
  } catch(e){
    done();
    return fail('تعذّر الحفظ: ' + (e.message || ''));
  }
  done();
  crmWeightsDraft = null;
  showToast('حُفظ إعداد الدرجات لكل شعبك ✓', 'ok');
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  closeCrmGradeSettings();
}

/* تنفيذ خطة شعبة. المحسوب: تُحذف درجاته ثم يُعاد حسابه بالوزن الجديد؛ اليدوي: تُحوَّل درجاته بالنسبة */
async function applySectionWeights(sectionId, term, cols, plan){
  const uid = currentUser.id;
  const loadScores = async colId => {
    const { data, error } = await sb.from('classroom_grade_scores').select('student_id, score').eq('teacher_id', uid).eq('column_id', colId);
    if(error) throw error;
    return data || [];
  };
  const rescale = async (ch, rows) => {
    if(!rows.length) return;
    const { error } = await sb.from('classroom_grade_scores').upsert(
      rows.map(r => ({ teacher_id: uid, column_id: ch.column.id, student_id: r.student_id, score: scaleGradeScore(r.score, ch.old, ch.max) })),
      { onConflict: 'column_id,student_id' });
    if(error) throw error;
  };
  const setMax = async ch => {
    const { error } = await sb.from('classroom_grade_columns').update({ max_score: ch.max }).eq('teacher_id', uid).eq('id', ch.column.id);
    if(error) throw error;
  };
  /* خفض: الدرجات أولًا (لا تبقى فوق الحد الجديد) ثم الحد */
  for(const ch of plan.decrease){
    if(isComputedGradeColumn(ch.column)){
      const { error } = await sb.from('classroom_grade_scores').delete().eq('teacher_id', uid).eq('column_id', ch.column.id);
      if(error) throw error;
    } else {
      await rescale(ch, await loadScores(ch.column.id));
    }
    await setMax(ch);
  }
  /* رفع: الحد أولًا ثم الدرجات */
  for(const ch of plan.increase){
    const rows = isComputedGradeColumn(ch.column) ? [] : await loadScores(ch.column.id);
    await setMax(ch);
    await rescale(ch, rows);
  }
  for(const cr of plan.create){
    const { error } = await sb.from('classroom_grade_columns').insert({
      teacher_id: uid, section_id: sectionId, academic_year: term.year, semester: term.semester,
      category: 'performance', name: cr.tool.name, max_score: cr.max, kind: 'manual', tool_id: cr.tool.id,
      position: cols.filter(c => c.category === 'performance').length
    });
    if(error && error.code !== '23505') throw error; /* أُنشئ من جهاز آخر للتو */
  }
  /* إعادة حساب المحسوب (واجبات/مهام/أدوات الحالة والدرجة) بالأوزان الجديدة */
  if(plan.decrease.length || plan.increase.length || plan.create.length) await loadCrmGradeSheet(sectionId);
}

/* من ورقة الحصة (رسالة "لا متسع") إلى إعداد الدرجات لنفس الشعبة */
async function openCrmWeightsFor(sectionId){
  try{ localStorage.setItem('crm_grades_section', sectionId); localStorage.setItem('crm_grades_view', 'sheet'); } catch(e){}
  if(crmSheet) closeCrmLessonSheet();
  crmGradesSettingsOpen = true;
  crmGradesDetail = false;
  switchCrmTab('grades');
}

/* من أي شاشة (مثل تخصيص التطبيق) إلى إعداد الدرجات */
async function openGradeSettingsFromAnywhere(){
  crmGradesSettingsOpen = true;
  crmGradesDetail = false;
  try{ localStorage.setItem('crm_grades_view', 'sheet'); } catch(e){}
  if(document.getElementById('classroomView').style.display === 'none') await showClassroomManagement();
  switchCrmTab('grades');
}

/* ============================================================
   "توزيع الأداء" (الكشف الثابت — الدفعة 3)
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

/* ============ الواجهة ============ */
let crmWeightsDraft = null; /* { sectionId, components, saving } */

function openCrmWeightsEditor(){
  const g = crmGrades;
  if(!g) return;
  const comps = perfComponentsFor(g.allColumns || g.columns, typeof crmCustomTools !== 'undefined' ? crmCustomTools : []);
  if(!comps.length) return;
  crmWeightsDraft = { sectionId: g.sectionId, components: comps, saving: false };
  const cap = gradeCap('performance');
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">توزيع الأداء (${formatScore(cap)})</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.7;">وزن كل مكوّن = درجته في الكشف. تغيير الوزن لا يغيّر نسبة الطالب: درجته تُحوَّل للوزن الجديد بنفس النسبة.${comps.some(c => c.tool) ? ' أعطِ أداتك الخاصة وزنًا لتدخل الكشف.' : ''}</div>
      ${comps.map(c => `<div class="crm-gs-line">
        <span>${escapeHtml(c.name)}${c.tool || (c.column && c.column.tool_id) ? ' 🧩' : ''}${c.tool ? ' <small style="color:var(--muted);">(ليست في الكشف بعد)</small>' : ''}</span>
        <input class="goal-input crm-weight-input" inputmode="decimal" data-key="${c.key}" value="${formatScore(c.max)}" oninput="paintCrmWeightsTotal()" style="width:70px;margin:0;text-align:center;">
      </div>`).join('')}
      <div id="crmWeightsTotal" style="font-size:13px;font-weight:700;margin:8px 0;"></div>
      <label style="display:flex;gap:6px;align-items:center;font-size:12.5px;margin-bottom:8px;"><input type="checkbox" id="crmWeightsAll" checked> طبّقه على كل شعبي لهذا الفصل</label>
      <div id="crmWeightsError" style="display:none;color:#8A2C2C;font-size:12px;margin-bottom:8px;line-height:1.7;"></div>
      <button class="btn btn-primary" id="crmWeightsSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmWeights()">حفظ التوزيع</button>
    </div>`, '420px');
  paintCrmWeightsTotal();
}

function readCrmWeightInputs(){
  const m = new Map();
  document.querySelectorAll('.crm-weight-input').forEach(i => m.set(i.dataset.key, i.value));
  return m;
}

function paintCrmWeightsTotal(){
  const d = crmWeightsDraft, el = document.getElementById('crmWeightsTotal');
  if(!d || !el) return;
  const cap = gradeCap('performance');
  const r = validatePerfWeights(d.components, readCrmWeightInputs(), cap);
  if(r.error){ el.textContent = r.error; el.style.color = '#8A2C2C'; return; }
  el.style.color = r.total === cap ? '#12796A' : 'var(--navy)';
  el.textContent = `المجموع ${formatScore(r.total)} من ${formatScore(cap)}` + (r.total < cap ? ` — الأداء سيكون من ${formatScore(r.total)}` : ' ✓');
}

async function saveCrmWeights(){
  const d = crmWeightsDraft;
  if(!d || d.saving || !currentUser) return;
  const err = document.getElementById('crmWeightsError');
  const fail = m => { err.textContent = m; err.style.display = 'block'; };
  const cap = gradeCap('performance');
  const r = validatePerfWeights(d.components, readCrmWeightInputs(), cap);
  if(r.error) return fail(r.error);
  const all = !!(document.getElementById('crmWeightsAll') || {}).checked;
  const desired = d.components.map(c => ({ identity: perfComponentIdentity(c), tool: c.tool || (c.column && c.column.tool_id ? customToolById(c.column.tool_id) : null), max: r.weights.get(c.key) }));
  d.saving = true;
  const btn = document.getElementById('crmWeightsSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الحفظ...'; }
  const uid = currentUser.id;
  const term = crmCurrentTerm();
  const sectionIds = all ? crmSections.map(s => s.id) : [d.sectionId];
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
    if(!currentUser || currentUser.id !== uid) return;
  }
  d.saving = false;
  if(btn){ btn.disabled = false; btn.textContent = 'حفظ التوزيع'; }
  if(failed.length) return fail('لم يكتمل في: ' + failed.join(' — ') + '. أعد الحفظ لإكماله.');
  crmWeightsDraft = null;
  closeCrmModal();
  showToast(applied > 1 ? `حُفظ التوزيع في ${applied} شعب` : 'حُفظ التوزيع', 'ok');
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  renderCrmGrades();
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

/* من ورقة الحصة (رسالة "لا متسع") إلى توزيع الأداء لنفس الشعبة */
async function openCrmWeightsFor(sectionId){
  try{ localStorage.setItem('crm_grades_section', sectionId); localStorage.setItem('crm_grades_view', 'sheet'); } catch(e){}
  crmGradesDetail = false;
  if(crmSheet) closeCrmLessonSheet();
  switchCrmTab('grades');
  await renderCrmGrades();
  if(crmGrades && crmGrades.sectionId === sectionId && hasBaseGradeColumns(crmGrades.allColumns || crmGrades.columns)) openCrmWeightsEditor();
}

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
  Object.keys(crmGsOpen).forEach(k => { crmGsOpen[k] = false; }); /* تُفتح الشاشة وأقسامها مطوية */
  crmGradesDetail = false;
  resetCrmGradeStudent();
  renderCrmGrades();
}

function closeCrmGradeSettings(){
  crmGradesSettingsOpen = false;
  crmWeightsDraft = null;
  renderCrmGrades();
}

function crmGradeSettingsHtml(g){
  const back = `<div style="margin:0 0 10px;"><button type="button" class="gs-back-btn" onclick="closeCrmGradeSettings()">→ الرجوع إلى الكشف</button></div>`;
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
  const compRows = comps.map(c => gsCompCardHtml(c, hidden.has(c.column && c.column.id))).join('');
  const have = new Set((g.allColumns || g.columns).map(c => c.kind));
  const missing = BUILTIN_GRADE_COMPONENTS.filter(b => !have.has(b.kind));
  const testsOn = appToolOn('tests');
  const ids = crmStudentsOfSection(g.sectionId).map(s => s.id);
  const testRows = g.columns.filter(c => c.category === 'tests').map(c => {
    const st = gradeColumnStats(c.id, g.scores, ids);
    return `<div class="crm-gs-line">
      <a href="#" class="gs-test" onclick="event.preventDefault();openCrmGradeColumnMenu('${c.id}')"><b>${escapeHtml(c.name)}</b> · من ${formatScore(c.max_score)}${c.tool_id ? ' 🧩' : ''}
        <small style="color:var(--muted);">رُصد ${ids.length - st.missing} من ${ids.length}</small></a>
      ${c.tool_id ? '' : `<button type="button" class="gs-del" title="حذف" aria-label="حذف ${escapeHtml(c.name)}" onclick="deleteGradeTestEverywhere('${c.id}')">🗑</button>`}</div>`;
  }).join('');
  return back + `<div class="crm-today-card gs-panel">
    <div class="crm-today-title">⚙ إعداد الدرجات</div>
    <p class="crm-gs-note" style="margin:0 0 8px;">الإعداد هنا، والرصد في ورقة الحصة. الحفظ يُطبَّق على كل شعبك لهذا الفصل.</p>

    ${gsSectionHtml('dist', `① التوزيع (المجموع ${GRADE_CAPS_TOTAL})`, `الأداء ${formatScore(caps.performance)} · الاختبارات ${formatScore(caps.tests)}`, `
    <div class="crm-gs-line"><span>الأداء</span><input class="goal-input gs-num" id="gsCapPerf" inputmode="decimal" value="${formatScore(caps.performance)}" oninput="syncGradeCapInputs('gs', 'performance');paintCrmGradeSettings()"></div>
    <div class="crm-gs-line"><span>الاختبارات</span><input class="goal-input gs-num" id="gsCapTests" inputmode="decimal" value="${formatScore(caps.tests)}" oninput="syncGradeCapInputs('gs', 'tests');paintCrmGradeSettings()"></div>
    <p class="crm-gs-note">الرسمي ${GRADE_CAPS_DEFAULT.performance} و${GRADE_CAPS_DEFAULT.tests}. اكتب إحداهما والأخرى تُكمَل.</p>`)}

    ${gsSectionHtml('comps', '② مكوّنات الأداء', comps.map(c => `${c.name} ${formatScore(c.tool ? c.tool.max_score : c.max)}`).join(' · '), `
    <div class="gs-tot"><span class="gs-ring" id="crmWeightsRing"><i>${formatScore(caps.performance)}</i></span><span><b id="crmWeightsTotal">${(() => { const t = Math.round(100 * comps.reduce((a, c) => a + Number(c.tool ? 0 : c.max), 0)) / 100; return `الأداء — ${formatScore(t)} من ${formatScore(caps.performance)}${t === caps.performance ? ' ✓' : ''}`; })()}</b><small>اضغط على أي مكوّن لتعديل إعداده</small></span></div>
    ${compRows}
    ${missing.length ? `<div class="crm-gs-note">محذوف من الكشف: ${missing.map(b => `<button type="button" class="gs-add gs-add-sm" onclick="addBuiltinGradeComponent('${b.kind}')">↩ ${b.name}</button>`).join(' ')}</div>` : ''}
    ${(typeof crmCustomTools !== 'undefined' ? crmCustomTools.length : 0) < CUSTOM_TOOL_MAX ? '<button class="gs-add" onclick="openCustomToolEditor(null)">+ مكوّن (مثل: بحوث، قراءة، مشروع)</button>' : ''}`)}

    ${testsOn ? gsSectionHtml('tests', `③ الاختبارات — ${escapeHtml(crmSectionLabel(g.sectionId))}`, `${g.columns.filter(c => c.category === 'tests').length} · محصلتها من ${formatScore(caps.tests)}`, `
    ${testRows || '<div class="crm-today-empty">لا اختبارات بعد.</div>'}
    <button class="gs-add" style="margin-top:6px;" onclick="openCrmGradeColumnEditor('tests', null)">+ اختبار</button>
    ${testRows ? '<p class="crm-gs-note">اضغط على اسم الاختبار لرصد درجاته أو تعديله، و🗑 يحذفه من كل شعبك.</p>' : ''}`) : ''}


    <div id="crmGradeSettingsError" style="display:none;color:#8A2C2C;font-size:12px;margin:10px 0 0;line-height:1.7;"></div>
    <button class="gs-save" id="crmGradeSettingsSaveBtn" onclick="saveCrmGradeSettings()">💾 حفظ — يُطبَّق على كل شعبي</button>
  </div>`;
}

/* أقسام "إعداد الدرجات" مطوية افتراضيًا: العنوان وتحته ملخص سطر، والنقر يفتح/يطوي.
   المفتوح يبقى مفتوحًا عند إعادة الرسم (الحقول داخل المطوي موجودة، فالحفظ يقرؤها) */
const crmGsOpen = { dist: false, comps: false, tests: false };
function gsSectionHtml(key, title, summary, body){
  return `<details class="gs-acc" data-gs="${key}"${crmGsOpen[key] ? ' open' : ''} ontoggle="crmGsOpen['${key}'] = this.open">
    <summary class="crm-gs-step"><span class="gs-acc-t">${title}</span><small class="gs-acc-s">${escapeHtml(summary)}</small></summary>
    <div class="gs-acc-b">${body}</div></details>`;
}

/* ============ بطاقة المكوّن ونافذة إعداده ============ */
const GS_COMP_ICONS = { participation: '👆', homework: '📝', task: '🎯', counter: '🔢', status: '✅', score: '💯', manual: '✏️' };

function gsCompTool(c){ return c.tool || (c.column && c.column.tool_id ? customToolById(c.column.tool_id) : null); }

/* مفتاح "يبدأ من" للمكوّن (أو null لليدوي) */
function gsCompStartKey(c){ return c.tool ? 'tool:' + c.tool.id : startFullKeyOfColumn(c.column); }

/* مفتاح الإظهار: أداة التخصيص (المشاركة/الواجبات/المهام) أو أداة المعلم الخاصة؛ اليدوي دائمًا ظاهر */
function gsCompVisibility(c){
  const tool = gsCompTool(c);
  if(tool) return { type: 'tool', id: tool.id, on: !tool.hidden };
  const k = c.column && GRADE_KIND_TOOL[c.column.kind];
  return k ? { type: 'app', id: k, on: appToolOn(k) } : null;
}

function gsCompSubtitle(c){
  const tool = gsCompTool(c);
  if(tool) return 'مكوّن خاص · ' + (CUSTOM_TOOL_TYPES[tool.tool_type] ? CUSTOM_TOOL_TYPES[tool.tool_type].label : '');
  return { participation: '+ و − في نافذة الرصد', homework: 'سلّم / لم يسلّم', task: 'درجة لكل مهمة' }[c.column.kind] || 'يدوي';
}

function gsCompIcon(c){
  const tool = gsCompTool(c);
  return GS_COMP_ICONS[tool ? tool.tool_type : (c.column.kind || 'manual')] || '✏️';
}

function gsCompCardHtml(c, hiddenCol){
  const value = c.tool ? formatScore(c.tool.max_score) : formatScore(c.max);
  const cfg = typeof periodCfg === 'function' ? periodCfg(crmCurrentTerm(), perfComponentIdentity(c)) : { n: 1, starts: [] };
  const sk = gsCompStartKey(c);
  const vis = gsCompVisibility(c);
  const chips = [];
  if(cfg.n > 1) chips.push(`<span class="gs-chip per">📅 ${PERIOD_COUNT_LABELS[cfg.n]}</span><span class="gs-chip now">${cfg.ended ? 'انتهت كلها ✓' : 'الآن: ' + PERIOD_NAMES[currentPeriodOf(cfg)].replace('الفترة ', '')}</span>`);
  if(sk && gradeStartsFull(sk)) chips.push('<span class="gs-chip full">يبدأ من الدرجة كاملة</span>');
  if(hiddenCol || (vis && !vis.on)) chips.push('<span class="gs-chip off">مخفي — بياناته محفوظة</span>');
  if(c.tool) chips.push('<span class="gs-chip">جديد — أعطه درجة</span>');
  return `<div class="gs-card${hiddenCol || (vis && !vis.on) ? ' is-off' : ''}" role="button" tabindex="0" data-comp="${escapeHtml(c.key)}" onclick="openGsCompSheet('${c.key}')">
    <span class="gs-card-ico">${gsCompIcon(c)}</span>
    <span class="gs-card-main"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(gsCompSubtitle(c))}</small>${chips.length ? `<span class="gs-chips">${chips.join('')}</span>` : ''}</span>
    <span class="gs-card-pts"><b id="gsPts_${c.key.replace(/[^\w-]/g, '_')}">${value}</b><small>درجة</small><i aria-hidden="true">‹</i></span>
    <input type="hidden" class="crm-weight-input" data-key="${c.key}" value="${value}">
  </div>`;
}

/* المسودة: لا يُحفظ شيء حتى "حفظ"؛ الانتقال بين الفترات وحده فوري (حدث لا إعداد) */
let gsCompDraft = null; /* { key, comp, weight, n, full, visible, orig } */

function openGsCompSheet(key){
  const d = crmWeightsDraft;
  const c = d && d.components.find(x => x.key === key);
  if(!c) return;
  const inp = document.querySelector(`.crm-weight-input[data-key="${key}"]`);
  const raw = inp && inp.value !== '' && inp.value !== undefined ? inp.value : (c.tool ? c.tool.max_score : c.max);
  const weight = Number(String(raw).replace(/[٠-٩]/g, x => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[٫,]/g, '.')) || 0;
  const id = perfComponentIdentity(c);
  const cfg = periodCfg(crmCurrentTerm(), id);
  const sk = gsCompStartKey(c);
  const vis = gsCompVisibility(c);
  const orig = { weight, n: cfg.n, full: sk ? gradeStartsFull(sk) : false, visible: vis ? vis.on : true };
  gsCompDraft = Object.assign({ key, comp: c, id, orig }, orig);
  paintGsCompSheet();
}

/* حد الدرجة: ما يتسع في وزن الأداء بعد المكوّنات الأخرى */
function gsCompWeightRoom(key){
  const cap = gradeCap('performance');
  const others = [...document.querySelectorAll('.crm-weight-input')].filter(i => i.dataset.key !== key)
    .reduce((s, i) => s + (Number(String(i.value).replace(/[٠-٩]/g, x => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[٫,]/g, '.')) || 0), 0);
  return Math.max(0, Math.round((cap - others) * 100) / 100);
}

function paintGsCompSheet(){
  const d = gsCompDraft;
  if(!d) return;
  const c = d.comp;
  const room = gsCompWeightRoom(d.key);
  const min = c.column ? GRADE_WEIGHT_STEP : 0;
  const sk = gsCompStartKey(c);
  const vis = gsCompVisibility(c);
  const cfg = periodCfg(crmCurrentTerm(), d.id);
  const now = currentPeriodOf(cfg);
  const id = escapeHtml(d.id).replace(/'/g, '&#39;');
  const seg = (items, cur, fn) => `<div class="gs-sheet-seg">${items.map(([v, label]) => `<button type="button" class="${cur === v ? 'is-on' : ''}" aria-pressed="${cur === v}" onclick="${fn}(${JSON.stringify(v)})">${label}</button>`).join('')}</div>`;
  const tool = gsCompTool(c);
  showInfoModal(`<div class="gs-sheet">
    <div class="gs-sheet-h"><span class="gs-card-ico">${gsCompIcon(c)}</span><b>${escapeHtml(c.name)}</b>
      ${tool ? `<a href="#" class="gs-sheet-edit" onclick="event.preventDefault();closeCrmModal();openCustomToolEditor('${tool.id}')">تعديل الاسم</a>` : ''}</div>
    <div class="gs-sheet-sec"><div class="gs-sheet-lb"><span>الدرجة</span><span>المتاح ${formatScore(room)} من ${formatScore(gradeCap('performance'))}</span></div>
      <div class="gs-step"><button type="button" onclick="stepGsCompWeight(-1)" ${d.weight - GRADE_WEIGHT_STEP < min ? 'disabled' : ''} aria-label="أنقص">−</button><b>${formatScore(d.weight)}</b><button type="button" onclick="stepGsCompWeight(1)" ${d.weight + GRADE_WEIGHT_STEP > room ? 'disabled' : ''} aria-label="زد">+</button></div></div>
    <div class="gs-sheet-sec"><div class="gs-sheet-lb"><span>عدد الفترات</span><span>الدرجة = معدّل الفترات المنتهية</span></div>
      ${seg([[1, '1'], [2, '2'], [3, '3']], d.n, 'setGsCompPeriods')}
      ${d.n === cfg.n && cfg.n > 1 ? `<div class="gs-period-now"><span class="gs-pdots">${[1, 2, 3].slice(0, cfg.n).map(p => `<i class="${p < now || cfg.ended ? 'done' : p === now ? 'cur' : ''}"></i>`).join('')}</span>
        ${cfg.ended ? '<b>انتهت كل الفترات — كلها محسوبة ✓</b>' : `الآن: <b>${PERIOD_NAMES[now]}</b>${now > 1 ? ' <small>(تُحسب عند انتهائها)</small>' : ''}`}
        ${now < cfg.n ? `<button type="button" class="gs-period-btn gs-period-go" onclick="closeCrmModal();goToComponentPeriod('${id}', ${now + 1})">ابدأ ${PERIOD_NAMES[now + 1]} ←</button>` : ''}
        ${now === cfg.n && !cfg.ended ? `<button type="button" class="gs-period-btn gs-period-go" onclick="closeCrmModal();endComponentPeriods('${id}', true)">✓ أنهِ ${PERIOD_NAMES[now]}</button>` : ''}
        ${cfg.ended ? `<button type="button" class="gs-period-btn gs-period-back" onclick="closeCrmModal();endComponentPeriods('${id}', false)">→ رجوع</button>`
          : now > 1 ? `<button type="button" class="gs-period-btn gs-period-back" onclick="closeCrmModal();goToComponentPeriod('${id}', ${now - 1})">→ رجوع</button>` : ''}</div>` : ''}</div>
    ${sk ? `<div class="gs-sheet-sec"><div class="gs-sheet-lb"><span>يبدأ الطالب من</span></div>${seg([[false, '0'], [true, 'الدرجة كاملة']], d.full, 'setGsCompFull')}</div>` : ''}
    ${vis ? `<div class="gs-sheet-sec gs-sheet-sw"><span>ظاهر في الكشف ونافذة الرصد</span>
      <button type="button" class="cust-switch${d.visible ? ' is-on' : ''}" role="switch" aria-checked="${d.visible}" onclick="toggleGsCompVisible()"><span></span></button></div>` : ''}
    <button type="button" class="gs-save" id="gsCompSaveBtn" onclick="saveGsComp()">حفظ</button>
    <button type="button" class="gs-sheet-del" onclick="closeCrmModal();deleteGradeComponent('${d.key}')">🗑 حذف المكوّن</button>
  </div>`, '440px');
}

function stepGsCompWeight(dir){
  const d = gsCompDraft;
  if(!d) return;
  const min = d.comp.column ? GRADE_WEIGHT_STEP : 0;
  const next = Math.round((d.weight + dir * GRADE_WEIGHT_STEP) * 100) / 100;
  if(next < min || next > Math.min(GRADE_COLUMN_MAX, gsCompWeightRoom(d.key))) return;
  d.weight = next;
  paintGsCompSheet();
}
function setGsCompPeriods(n){ if(gsCompDraft){ gsCompDraft.n = n; paintGsCompSheet(); } }
function setGsCompFull(full){ if(gsCompDraft){ gsCompDraft.full = !!full; paintGsCompSheet(); } }
function toggleGsCompVisible(){ if(gsCompDraft){ gsCompDraft.visible = !gsCompDraft.visible; paintGsCompSheet(); } }

/* حفظ ما تغيّر فقط، كلٌّ بمساره القائم: الدرجة (كل الشعب) ← الإظهار ← "يبدأ من" (بتأكيده) ← الفترات */
let gsCompSaving = false;
async function saveGsComp(){
  const d = gsCompDraft;
  if(!d || gsCompSaving || !currentUser) return;
  gsCompSaving = true;
  const btn = document.getElementById('gsCompSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الحفظ...'; }
  closeCrmModal(); /* نافذة التأكيد هي نفسها نافذة المعلومات */
  gsCompDraft = null;
  let rerender = true;
  try{
    if(d.weight !== d.orig.weight){
      const inp = document.querySelector(`.crm-weight-input[data-key="${d.key}"]`);
      if(inp) inp.value = formatScore(d.weight);
      if(!(await saveCrmGradeSettings({ stay: true }))){
        /* الخطأ ظاهر في الصفحة — لا إعادة رسم تمحوه، والوزن يعود كما كان */
        if(inp) inp.value = formatScore(d.orig.weight);
        rerender = false;
        return;
      }
    }
    const vis = gsCompVisibility(d.comp);
    if(vis && d.visible !== d.orig.visible){
      if(vis.type === 'app') await setAppToolOn(vis.id, d.visible); else await toggleCustomToolHidden(vis.id);
    }
    const sk = gsCompStartKey(d.comp);
    if(sk && d.full !== d.orig.full) await setGradeStartMode(sk, d.full);
    if(d.n !== d.orig.n) await setComponentPeriodCount(d.id, d.n);
  } finally {
    gsCompSaving = false;
    if(rerender) renderCrmGrades();
  }
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
  const ring = document.getElementById('crmWeightsRing');
  if(r.error){ el.textContent = r.error; el.style.color = '#8A2C2C'; return; }
  el.style.color = r.total === cap ? '#12796A' : 'var(--navy)';
  el.textContent = `الأداء — ${formatScore(r.total)} من ${formatScore(cap)}` + (r.total < cap ? ` (المتبقي ${formatScore(cap - r.total)})` : ' ✓');
  if(ring){
    const pct = cap > 0 ? Math.min(100, Math.round(100 * r.total / cap)) : 0;
    ring.style.background = `conic-gradient(${r.total === cap ? '#1F7A6A' : 'var(--gold)'} 0 ${pct}%, #E5E0D4 0)`;
    ring.firstElementChild && (ring.firstElementChild.textContent = formatScore(r.total));
  }
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

/* opts.stay: من نافذة المكوّن — يبقى في الإعداد بعد الحفظ. يعيد true عند النجاح */
async function saveCrmGradeSettings(opts){
  const d = crmWeightsDraft;
  if(!d || d.saving || !currentUser) return false;
  const err = document.getElementById('crmGradeSettingsError');
  /* الخطأ في التوزيع أو الأوزان: يُفتح قسماهما ليرى المعلم الحقل */
  const fail = m => { err.textContent = m; err.style.display = 'block'; document.querySelectorAll('.gs-acc[data-gs="dist"], .gs-acc[data-gs="comps"]').forEach(d => { d.open = true; }); };
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
  const done = () => { d.saving = false; if(btn){ btn.disabled = false; btn.textContent = '💾 حفظ — يُطبَّق على كل شعبي'; } };
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
  if(opts && opts.stay) renderCrmGrades(); else closeCrmGradeSettings();
  return true;
}

/* تنفيذ خطة شعبة. المحسوب: تُحذف درجاته ثم يُعاد حسابه بالوزن الجديد؛ اليدوي: تُحوَّل درجاته بالنسبة */
async function applySectionWeights(sectionId, term, cols, plan){
  const uid = currentUser.id;
  const loadScores = async colId => {
    const { data, error } = await sb.from('classroom_grade_scores').select('student_id, score').eq('teacher_id', uid).eq('column_id', colId);
    if(error) throw error;
    return data || [];
  };
  /* المشاركة بفترتين: درجتا الفترتين تُحوَّلان (والقاعدة تحدّث المعدّل)، ودرجة الكشف لمن لا فترات له فقط */
  const loadPeriodScores = async c => isDirectPeriodColumn(c) ? await loadPeriodRows(c.id) : [];
  const rescale = async (ch, rows, perRows) => {
    if((perRows || []).length){
      const { error } = await sb.from('classroom_grade_period_scores').upsert(
        perRows.map(r => ({ teacher_id: uid, column_id: ch.column.id, student_id: r.student_id, period: r.period, score: scaleGradeScore(r.score, ch.old, ch.max) })),
        { onConflict: 'column_id,student_id,period' });
      if(error) throw error;
    }
    const withPer = new Set((perRows || []).map(r => r.student_id));
    const direct = rows.filter(r => !withPer.has(r.student_id));
    if(!direct.length) return;
    const { error } = await sb.from('classroom_grade_scores').upsert(
      direct.map(r => ({ teacher_id: uid, column_id: ch.column.id, student_id: r.student_id, score: scaleGradeScore(r.score, ch.old, ch.max) })),
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
      await rescale(ch, await loadScores(ch.column.id), await loadPeriodScores(ch.column));
    }
    await setMax(ch);
  }
  /* رفع: الحد أولًا ثم الدرجات */
  for(const ch of plan.increase){
    const rows = isComputedGradeColumn(ch.column) ? [] : await loadScores(ch.column.id);
    const perRows = isComputedGradeColumn(ch.column) ? [] : await loadPeriodScores(ch.column);
    await setMax(ch);
    await rescale(ch, rows, perRows);
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

/* ============ حذف المكوّنات والاختبارات (من إعداد الدرجات) ============ */
const BUILTIN_GRADE_COMPONENTS = [
  { kind: 'participation', name: 'مشاركة', max: 10 },
  { kind: 'homework', name: 'واجبات', max: 10 },
  { kind: 'task', name: 'مهام أدائية', max: 20 }
];

/* أعمدة هذا الفصل (كل شعب المعلم) المطابقة لمكوّن */
async function termColumnsMatching(match){
  const term = crmCurrentTerm();
  const { data, error } = await sb.from('classroom_grade_columns').select('id, section_id, category, kind, tool_id, name, max_score, counted_periods')
    .eq('teacher_id', currentUser.id).eq('academic_year', term.year).eq('semester', term.semester);
  if(error) throw error;
  const mine = new Set(crmSections.map(s => s.id));
  return (data || []).filter(c => mine.has(c.section_id) && match(c));
}

async function countScoresOf(columnIds){
  if(!columnIds.length) return 0;
  const { data, error } = await sb.from('classroom_grade_scores').select('id').eq('teacher_id', currentUser.id).in('column_id', columnIds);
  if(error) throw error;
  return (data || []).length;
}

async function setAppToolOn(key, on){
  const next = normalizeFeatures(appFeatures);
  next.tools = Object.assign({}, next.tools, { [key]: on });
  appFeatures = next;
  afterAppFeaturesChanged();
  await saveAppFeatures();
}

let gradeComponentBusy = false;
async function withGradeComponentBusy(fn){
  if(gradeComponentBusy || !currentUser) return;
  gradeComponentBusy = true;
  try{ await fn(); }
  catch(e){ showToast('تعذّر: ' + gradeDbErrorMessage(e), 'error'); }
  finally { gradeComponentBusy = false; }
}

/* حذف مكوّن أداء من كشوف كل الشعب لهذا الفصل. الأداة الخاصة تُحذف كلها (بتأكيدها)؛
   والأساسي (مشاركة/واجبات/مهام) يُحذف عموده وتُخفى أداته من ورقة الحصة */
function deleteGradeComponent(key){
  const d = crmWeightsDraft;
  const comp = d && d.components.find(c => c.key === key);
  if(!comp) return;
  const toolId = comp.tool ? comp.tool.id : (comp.column && comp.column.tool_id);
  if(toolId) return deleteCustomTool(toolId);
  return withGradeComponentBusy(async () => {
    const identity = perfComponentIdentity(comp);
    const cols = await termColumnsMatching(c => c.category === 'performance' && perfComponentIdentity({ column: c }) === identity);
    const n = await countScoresOf(cols.map(c => c.id));
    const kind = comp.column.kind;
    const toolKey = GRADE_KIND_TOOL[kind];
    const ok = await showConfirm(`حذف "${comp.name}" من كشوف كل شعبك لهذا الفصل؟` +
      (n ? ` تُحذف معه ${n} درجة مرصودة فيه.` : '') +
      (kind === 'homework' || kind === 'task' ? ' رصد التسليم/المهام نفسه يبقى، ويعود حسابه إن أرجعته.' : '') +
      (toolKey ? ` وتُخفى "${CRM_SHEET_MODE_LABELS[kind]}" من ورقة الحصة.` : ''));
    if(!ok || !cols.length) return;
    const { error } = await sb.from('classroom_grade_columns').delete().eq('teacher_id', currentUser.id).in('id', cols.map(c => c.id));
    if(error) throw error;
    if(toolKey && appToolOn(toolKey)) await setAppToolOn(toolKey, false);
    showToast(`حُذف "${comp.name}"`, 'ok');
    if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
    renderCrmGrades();
  });
}

/* إرجاع مكوّن أساسي محذوف: يُنشأ عموده في كل شعبة لها كشف (بوزنه أو ما يتسع)، وتُظهر أداته */
function addBuiltinGradeComponent(kind){
  const b = BUILTIN_GRADE_COMPONENTS.find(x => x.kind === kind);
  if(!b) return;
  return withGradeComponentBusy(async () => {
    const term = crmCurrentTerm();
    const all = await termColumnsMatching(() => true);
    const bySection = new Map();
    all.forEach(c => { if(!bySection.has(c.section_id)) bySection.set(c.section_id, []); bySection.get(c.section_id).push(c); });
    const cap = gradeCap('performance');
    const rows = [], full = [];
    bySection.forEach((cols, sectionId) => {
      if(!hasBaseGradeColumns(cols) || cols.some(c => c.kind === kind)) return;
      const used = cols.filter(c => c.category === 'performance').reduce((a, c) => a + Number(c.max_score), 0);
      const room = Math.floor((cap - used) / GRADE_WEIGHT_STEP) * GRADE_WEIGHT_STEP;
      if(room < GRADE_WEIGHT_STEP){ full.push(sectionId); return; }
      rows.push({ teacher_id: currentUser.id, section_id: sectionId, academic_year: term.year, semester: term.semester,
        category: 'performance', kind, name: b.name, max_score: Math.min(b.max, room), position: cols.filter(c => c.category === 'performance').length });
    });
    if(full.length && !rows.length){ showToast(`لا متسع في الأداء لـ"${b.name}" — أنقص وزن مكوّن آخر واحفظ، ثم أرجعه`, 'error'); return; }
    if(rows.length){
      const { error } = await sb.from('classroom_grade_columns').insert(rows);
      if(error) throw error;
    }
    const toolKey = GRADE_KIND_TOOL[kind];
    if(toolKey && !appToolOn(toolKey)) await setAppToolOn(toolKey, true);
    showToast(`أُرجع "${b.name}" — راجع وزنه ثم احفظ` + (full.length ? ` (${full.length} شعبة بلا متسع)` : ''), full.length ? 'error' : 'ok');
    if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
    renderCrmGrades();
  });
}

/* حذف اختبار من كل الشعب (نفس الاسم والدرجة الكاملة — أُضيف لها معًا) */
function deleteGradeTestEverywhere(columnId){
  const g = crmGrades;
  const t = g && (g.allColumns || g.columns).find(c => c.id === columnId);
  if(!t) return;
  return withGradeComponentBusy(async () => {
    const name = normalizeGradeColumnName(t.name);
    const cols = await termColumnsMatching(c => c.category === 'tests' && !c.tool_id && normalizeGradeColumnName(c.name) === name && Number(c.max_score) === Number(t.max_score));
    const n = await countScoresOf(cols.map(c => c.id));
    const ok = await showConfirm(`حذف اختبار "${t.name}" (من ${formatScore(t.max_score)})` + (cols.length > 1 ? ` من ${cols.length} شعب` : '') + '؟' + (n ? ` تُحذف معه ${n} درجة مرصودة نهائيًا.` : ''));
    if(!ok || !cols.length) return;
    const { error } = await sb.from('classroom_grade_columns').delete().eq('teacher_id', currentUser.id).in('id', cols.map(c => c.id));
    if(error) throw error;
    showToast(`حُذف "${t.name}"`, 'ok');
    if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
    renderCrmGrades();
  });
}

/* ============ "يبدأ من": 0 (الأصل) أو الكاملة ============ */
/* مفتاح الخيار لعمود أداء: المشاركة، والواجبات، والمهام، وكل مكوّن خاص (عدّاد/حالة/درجة) */
function startFullKeyOfColumn(c){
  if(!c) return null;
  if(c.tool_id){
    const t = typeof customToolById === 'function' ? customToolById(c.tool_id) : null;
    return t ? 'tool:' + t.id : null;
  }
  return c.kind === 'participation' || c.kind === 'homework' || c.kind === 'task' ? c.kind : null;
}

/* عمود تُكتب فيه الكاملة مباشرة (المشاركة والعدّاد). المحسوب (واجبات/مهام/حالة/درجة)
   يمتلئ من رصده نفسه — الكتابة فيه مباشرة تُمحى عند المزامنة وتعطي من لا رصد له الكاملة */
function directStartFullKey(c){
  return c && !isComputedGradeColumn(c) ? startFullKeyOfColumn(c) : null;
}

/* قيمة "الكاملة" لرصد أداة حالة/درجة في حصة */
function toolFullValue(tool){
  return tool.tool_type === 'status' ? 1 : Number(tool.max_score);
}

function startModeToggleHtml(key){
  const full = gradeStartsFull(key);
  return `<span class="gs-start" role="group" aria-label="تبدأ الدرجة من" data-start-key="${key}">يبدأ من
    <span class="gs-seg"><button type="button" class="${full ? '' : 'is-on'}" aria-pressed="${!full}" onclick="setGradeStartMode('${key}', false)">${full ? '' : '✓ '}0</button><button type="button" class="${full ? 'is-on' : ''}" aria-pressed="${full}" onclick="setGradeStartMode('${key}', true)">${full ? '✓ ' : ''}الدرجة كاملة</button></span>
    <small class="gs-start-busy"></small></span>`;
}

/* أثناء التطبيق: الزرّان معطّلان ورسالة ظاهرة (التطبيق على كل الشعب قد يأخذ ثواني) */
function setStartModeBusy(key, on){
  const el = document.querySelector(`[data-start-key="${key}"]`);
  if(!el) return;
  el.querySelectorAll('button').forEach(b => { b.disabled = on; });
  const note = el.querySelector('.gs-start-busy');
  if(note) note.textContent = on ? '⏳ جارٍ التطبيق على شعبك…' : '';
}

/* نص تأكيد تغيير "يبدأ من" — يقول بوضوح ما يُمسح وما يصير */
function startModeConfirmText(key, full){
  const toolId = key.indexOf('tool:') === 0 ? key.slice(5) : null;
  const tool = toolId ? customToolById(toolId) : null;
  const kind = toolId ? (tool ? tool.tool_type : 'counter') : key;
  const name = toolId ? ((tool || {}).name || 'المكوّن') : { participation: 'المشاركة', homework: 'الواجبات', task: 'المهام الأدائية' }[key];
  const where = 'في كل شعبك لهذا الفصل';
  const text = {
    homework: full ? `يصير كل الطلاب "سلّم" في كل الواجبات ${where}، ويُمسح ما رصدته من تسليم. بعدها تضغط على من لم يسلّم.`
                   : `يصير كل الطلاب "لم يسلّم" في كل الواجبات ${where}، ويُمسح ما رصدته من تسليم.`,
    task: full ? `يأخذ كل المكلَّفين الدرجة الكاملة في كل المهام ${where}، ويُمسح ما رصدته. وكل مهمة جديدة تبدأ كاملة، فتُنقص للمقصّر فقط.`
               : `يرجع كل المكلَّفين "لم يُقيَّم" في كل المهام ${where}، ويُمسح ما رصدته.`,
    status: full ? `يصير كل الطلاب "تمّ" في كل حصة رُصدت ${where}، ويُمسح ما رصدته. وكل حصة جديدة تبدأ "تمّ" للجميع، فتضغط على من لم يتمّ فقط.`
                 : `يرجع كل الطلاب "لم يُرصد" في كل الحصص ${where}، ويُمسح ما رصدته.`,
    score: full ? `يأخذ كل الطلاب الدرجة الكاملة في كل حصة رُصدت ${where}، ويُمسح ما رصدته. وكل حصة جديدة تبدأ كاملة، فتُنقص للمقصّر فقط.`
                : `يرجع كل الطلاب "لم يُرصد" في كل الحصص ${where}، ويُمسح ما رصدته.`
  }[kind] || (full ? `يأخذ كل الطلاب الدرجة الكاملة الآن ${where}، ويُمسح ما رصدته حتى الآن. بعدها كل نقرة تُنقص درجة.`
                   : `يرجع كل الطلاب بلا درجة الآن ${where}، ويُمسح ما رصدته حتى الآن. بعدها كل نقرة تزيد درجة.`);
  return { name, text: `"${name}" تبدأ من ${full ? 'الدرجة كاملة' : '0'}؟ ${text}` };
}

async function resetHomeworkStart(uid, term, sectionIds, full){
  const { data: hws, error } = await sb.from('classroom_homework').select('id, section_id')
    .eq('teacher_id', uid).eq('academic_year', term.year).eq('semester', term.semester).in('section_id', sectionIds);
  if(error) throw error;
  const hwIds = (hws || []).map(h => h.id);
  if(!hwIds.length) return false;
  for(const ids of chunkArray(hwIds, 100)){
    const { error: dErr } = await sb.from('classroom_homework_status').delete().eq('teacher_id', uid).in('homework_id', ids);
    if(dErr) throw dErr;
  }
  if(!full) return true;
  const rows = [];
  (hws || []).forEach(h => crmStudentsOfSection(h.section_id).forEach(st => rows.push({ teacher_id: uid, homework_id: h.id, student_id: st.id, status: 'submitted', updated_at: new Date().toISOString() })));
  for(const part of chunkArray(rows, 500)){
    const { error: uErr } = await sb.from('classroom_homework_status').upsert(part, { onConflict: 'homework_id,student_id' });
    if(uErr) throw uErr;
  }
  return true;
}

/* المهام: درجة كل المكلَّفين = كاملة المهمة (أو "لم يُقيَّم")، مجمّعة حسب درجة المهمة */
async function resetTaskStart(uid, term, sectionIds, full){
  const { data: tasks, error } = await sb.from('classroom_tasks').select('id, max_score')
    .eq('teacher_id', uid).eq('academic_year', term.year).eq('semester', term.semester).in('section_id', sectionIds);
  if(error) throw error;
  if(!(tasks || []).length) return false;
  const byScore = new Map();
  (tasks || []).forEach(t => {
    const k = full ? Number(t.max_score) : null;
    if(!byScore.has(k)) byScore.set(k, []);
    byScore.get(k).push(t.id);
  });
  for(const [score, ids] of byScore){
    for(const part of chunkArray(ids, 100)){
      const { error: uErr } = await sb.from('classroom_task_students').update({ score }).eq('teacher_id', uid).in('task_id', part);
      if(uErr) throw uErr;
    }
  }
  return true;
}

/* أداة حالة/درجة: يُمسح رصدها؛ ومن الكاملة يأخذ كل طلاب الشعبة الكاملة في كل حصة سبق رصدها */
async function resetToolMarksStart(uid, term, sectionIds, tool, full){
  const { data: marks, error } = await fetchAllRows((from, to) => sb.from('classroom_tool_marks').select('id, section_id, mark_date, period')
    .eq('teacher_id', uid).eq('tool_id', tool.id).eq('academic_year', term.year).eq('semester', term.semester).in('section_id', sectionIds)
    .order('id', { ascending: true }).range(from, to));
  if(error) throw error;
  if(!(marks || []).length) return false; /* لا رصد سابق: لا شيء يُمسح أو يُعاد حسابه */
  const lessons = new Map();
  (marks || []).forEach(m => lessons.set(m.section_id + '|' + m.mark_date + '|' + m.period, m));
  for(const ids of chunkArray((marks || []).map(m => m.id), 200)){
    const { error: dErr } = await sb.from('classroom_tool_marks').delete().eq('teacher_id', uid).eq('tool_id', tool.id).in('id', ids);
    if(dErr) throw dErr;
  }
  if(!full) return true;
  const rows = [];
  lessons.forEach(m => crmStudentsOfSection(m.section_id).forEach(st => rows.push({
    teacher_id: uid, tool_id: tool.id, student_id: st.id, section_id: m.section_id, academic_year: term.year, semester: term.semester,
    mark_date: m.mark_date, period: m.period, value: toolFullValue(tool)
  })));
  for(const part of chunkArray(rows, 500)){
    const { error: uErr } = await sb.from('classroom_tool_marks').upsert(part, { onConflict: 'tool_id,student_id,mark_date,period' });
    if(uErr) throw uErr;
  }
  return true;
}

/* إعادة حساب عمود المكوّن الذي تغيّر فقط، في كل الشعب معًا (لا الكشف كله شعبةً شعبة).
   المشاركة والعدّاد: لا عمود محسوب — كُتبت درجاتهما مباشرة */
async function resyncStartModeColumns(key, tool, term){
  const kind = key === 'homework' || key === 'task' ? key : null;
  if(!kind && !(tool && tool.tool_type !== 'counter')) return;
  const cols = await termColumnsMatching(c => kind ? (!c.tool_id && c.kind === kind) : c.tool_id === tool.id);
  await Promise.all(cols.map(async c => {
    try{
      if(kind === 'homework') await syncHomeworkColumn(c, c.section_id, await loadSectionHomework(c.section_id, term));
      else if(kind === 'task') await syncTaskColumn(c, c.section_id, term);
      else await syncToolColumn(c, tool, c.section_id, term);
    } catch(e){} /* يُعاد حسابه عند فتح كشف الشعبة */
  }));
}

/* المشاركة والعدّاد: الدرجة نفسها تُمسح، ومن الكاملة تُكتب الكاملة */
async function resetDirectScoresStart(uid, key, full){
  const cols = await termColumnsMatching(c => directStartFullKey(c) === key);
  /* درجات الفترات تُمسح أولًا (وإلا عادت درجة الكشف منها) */
  const perCols = cols.filter(isDirectPeriodColumn);
  if(perCols.length){
    const { error: pErr } = await sb.from('classroom_grade_period_scores').delete().eq('teacher_id', uid).in('column_id', perCols.map(c => c.id));
    if(pErr) throw pErr;
  }
  if(cols.length){
    const { error: dErr } = await sb.from('classroom_grade_scores').delete().eq('teacher_id', uid).in('column_id', cols.map(c => c.id));
    if(dErr) throw dErr;
  }
  if(!full) return;
  const rows = [];
  cols.forEach(c => crmStudentsOfSection(c.section_id).forEach(st => rows.push({ teacher_id: uid, column_id: c.id, student_id: st.id, score: Number(c.max_score) })));
  for(const part of chunkArray(rows, 500)){
    const { error: uErr } = await sb.from('classroom_grade_scores').upsert(part, { onConflict: 'column_id,student_id' });
    if(uErr) throw uErr;
  }
}

/* تغيير "يبدأ من" يعيد كل الطلاب لنقطة البداية في كل الشعب لهذا الفصل — بعد تأكيد صريح */
function setGradeStartMode(key, full){
  if(!isStartFullKey(key) || gradeStartsFull(key) === full) return;
  return withGradeComponentBusy(async () => {
    const toolId = key.indexOf('tool:') === 0 ? key.slice(5) : null;
    const tool = toolId ? customToolById(toolId) : null;
    if(toolId && !tool) return;
    const { name, text } = startModeConfirmText(key, full);
    if(!(await showConfirm(text))) return;
    setStartModeBusy(key, true);
    try{ await applyGradeStartMode(key, tool, name, full); }
    finally { setStartModeBusy(key, false); }
  });
}

async function applyGradeStartMode(key, tool, name, full){
  const uid = currentUser.id;
  const term = crmCurrentTerm();
  const sectionIds = crmSections.map(s => s.id);
  let changed = true;
  if(key === 'homework') changed = await resetHomeworkStart(uid, term, sectionIds, full);
  else if(key === 'task') changed = await resetTaskStart(uid, term, sectionIds, full);
  else if(tool && tool.tool_type !== 'counter') changed = await resetToolMarksStart(uid, term, sectionIds, tool, full);
  else await resetDirectScoresStart(uid, key, full);
  if(!currentUser || currentUser.id !== uid) return;
  const next = normalizeFeatures(appFeatures);
  const sf = Object.assign({}, next.startFull);
  if(full) sf[key] = true; else delete sf[key];
  next.startFull = sf;
  appFeatures = next;
  afterAppFeaturesChanged();
  await saveAppFeatures();
  if(changed) await resyncStartModeColumns(key, tool, term);
  showToast(`"${name}" تبدأ الآن من ${full ? 'الدرجة كاملة' : '0'} ✓`, 'ok');
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  renderCrmGrades();
}

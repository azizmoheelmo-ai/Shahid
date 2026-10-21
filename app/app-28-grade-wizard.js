/* ============================================================
   معالج البداية — أول مرة لكل فصل (لا كشف للشعبة بعد)
   ------------------------------------------------------------
   ثلاث خطوات بلا تعليمات: ① الأداء (ماذا أقيس؟ ودرجة كل مكوّن بـ − و +)
   ② الاختبارات (كم اختبارًا؟ الأصل اختباران) ③ الفترات لكل مكوّن (الأصل ١)،
   ثم ملخص وزر واحد يُنشئ الكشف لكل شعب المعلم التي لا كشف لها هذا الفصل.
   - المكوّن الأساسي غير المختار تُخفى أداته (من الكشف ونافذة الرصد)، والمختار تظهر.
   - المقترح: هيكل الفصل السابق لهذه الشعبة إن وُجد، وإلا الافتراضي (40 = 10 + 10 + 20).
   ============================================================ */

const GRADE_WIZARD_TEST_NAMES = ['الاختبار الأول', 'الاختبار الثاني', 'الاختبار الثالث', 'الاختبار الرابع'];
const GRADE_WIZARD_TESTS_DEFAULT = 2;
const GRADE_WIZARD_KIND_SUB = { participation: '+ و − في نافذة الرصد', homework: 'سلّم / لم يسلّم', task: 'درجة لكل مهمة' };

/* ============ دوال صرفة ============ */
/* المكوّنات المقترحة: الهيكل (السابق أو الافتراضي) مختار، ثم أدوات الأداء الخاصة غير مختارة */
function gradeWizardComponents(seed, tools){
  const out = (seed || []).filter(c => c.category === 'performance').map(c => ({
    id: c.tool_id ? 'tool:' + c.tool_id : (c.kind && c.kind !== 'manual' ? 'kind:' + c.kind : 'name:' + normalizeGradeColumnName(c.name)),
    name: c.name, kind: c.kind || 'manual', tool_id: c.tool_id || null, max: Number(c.max_score), on: true
  }));
  const have = new Set(out.map(c => c.id));
  (tools || []).filter(t => t.category === 'performance' && !t.hidden && !have.has('tool:' + t.id))
    .forEach(t => out.push({ id: 'tool:' + t.id, name: t.name, kind: 'manual', tool_id: t.id, max: Math.min(Number(t.max_score) || 5, 10), on: false }));
  return out;
}

function gradeWizardTotal(comps){
  return Math.round(100 * (comps || []).filter(c => c.on).reduce((a, c) => a + Number(c.max), 0)) / 100;
}

/* أعمدة الشعبة من المعالج (أعمدة أدوات قائمة لا تتكرر، والأداء يُصغَّر فقط إن تجاوز المتبقي) */
function gradeWizardColumns(w, existing){
  const haveTool = new Set((existing || []).filter(c => c.tool_id).map(c => c.tool_id));
  const perf = w.comps.filter(c => c.on && !(c.tool_id && haveTool.has(c.tool_id)))
    .map((c, i) => ({ category: 'performance', name: c.name, max_score: Number(c.max), measures: null, position: i, kind: c.tool_id ? 'manual' : c.kind, tool_id: c.tool_id || null }));
  const tests = Array.from({ length: w.tests }, (_, i) => ({ category: 'tests', name: GRADE_WIZARD_TEST_NAMES[i] || ('اختبار ' + (i + 1)), max_score: GRADE_TEST_DEFAULT_MAX, measures: null, position: i, kind: 'manual', tool_id: null }));
  return fitColumnsToCaps(perf, capsAfterColumns(existing), false).concat(tests);
}

/* ============ الحالة ============ */
let crmGradeWizard = null; /* { key, sectionId, step, comps, tests, periods: {id: n}, saving } */

function gradeWizardKey(sectionId){
  const t = crmCurrentTerm();
  return sectionId + '|' + t.year + '|' + t.semester;
}

function ensureGradeWizard(){
  const sectionId = crmGradesSectionId();
  const key = gradeWizardKey(sectionId);
  if(crmGradeWizard && crmGradeWizard.key === key) return crmGradeWizard;
  const tools = typeof crmCustomTools !== 'undefined' ? crmCustomTools : [];
  crmGradeWizard = { key, sectionId, step: 1, comps: gradeWizardComponents(gradeSheetSeed([]), tools), tests: appToolOn('tests') ? GRADE_WIZARD_TESTS_DEFAULT : 0, periods: {}, saving: false };
  prefillGradeWizardFromPrevious(crmGradeWizard); /* لا ننتظره: يحدّث المقترح متى وصل */
  return crmGradeWizard;
}

/* هيكل الفصل السابق لهذه الشعبة (إن وُجد) يحلّ محل الافتراضي — ما لم يبدأ المعلم التعديل */
async function prefillGradeWizardFromPrevious(w){
  const t = crmCurrentTerm();
  const prev = previousGradeTerm(t.year, t.semester);
  if(!prev || !currentUser) return;
  try{
    const { data, error } = await sb.from('classroom_grade_columns').select('category, name, max_score, measures, position, kind, tool_id')
      .eq('teacher_id', currentUser.id).eq('section_id', w.sectionId).eq('academic_year', prev.year).eq('semester', prev.semester);
    if(error || !(data || []).some(c => c.category === 'performance')) return;
    if(crmGradeWizard !== w || w.touched) return; /* تغيّرت الشعبة/الفصل، أو بدأ التعديل */
    w.comps = gradeWizardComponents(gradeSheetSeed(data), typeof crmCustomTools !== 'undefined' ? crmCustomTools : []);
    paintGradeWizard();
  } catch(e){} /* يبقى المقترح الافتراضي */
}

function paintGradeWizard(){
  const box = document.getElementById('crmGradeWizard');
  if(box) box.outerHTML = crmGradeWizardHtml();
}

/* ============ الواجهة ============ */
function gradeWizardIcon(c){
  const tool = c.tool_id && typeof customToolById === 'function' ? customToolById(c.tool_id) : null;
  return (typeof GS_COMP_ICONS !== 'undefined' && GS_COMP_ICONS[tool ? tool.tool_type : c.kind]) || '✏️';
}

function gradeWizardSub(c){
  const tool = c.tool_id && typeof customToolById === 'function' ? customToolById(c.tool_id) : null;
  if(tool) return 'مكوّن خاص · ' + (CUSTOM_TOOL_TYPES[tool.tool_type] ? CUSTOM_TOOL_TYPES[tool.tool_type].label : '');
  return GRADE_WIZARD_KIND_SUB[c.kind] || 'يدوي';
}

function crmGradeWizardHtml(){
  const w = ensureGradeWizard();
  const cap = gradeCap('performance');
  const total = gradeWizardTotal(w.comps);
  const testsOn = appToolOn('tests');
  const bar = `<div class="gw-steps">${[1, 2, 3].map(n => `<i class="${n < w.step ? 'done' : n === w.step ? 'cur' : ''}"></i>`).join('')}</div>`;
  const head = (title, sub) => `${bar}<div class="gw-head"><b>${title}</b><span>إنشاء الكشف — الخطوة ${w.step} من 3</span></div><p class="gw-sub">${sub}</p>`;
  let body = '';
  if(w.step === 1){
    const over = total > cap, ok = total > 0 && !over;
    body = head(`الأداء — من ${formatScore(cap)}`, 'اختر ما تقيسه، والأرقام مقترحة وتقدر تغيّرها') +
      w.comps.map((c, i) => `<div class="gw-comp${c.on ? ' is-on' : ''}">
        <button type="button" class="gw-check" role="checkbox" aria-checked="${c.on}" onclick="toggleGradeWizardComp(${i})"><span class="gw-box">${c.on ? '✓' : ''}</span>
          <span class="gs-card-ico">${gradeWizardIcon(c)}</span><span class="gw-name"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(gradeWizardSub(c))}</small></span></button>
        ${c.on ? `<span class="gs-step gw-step"><button type="button" onclick="stepGradeWizardComp(${i}, -1)" ${c.max <= GRADE_WEIGHT_STEP ? 'disabled' : ''} aria-label="أنقص">−</button><b>${formatScore(c.max)}</b><button type="button" onclick="stepGradeWizardComp(${i}, 1)" ${total + GRADE_WEIGHT_STEP > cap || c.max + GRADE_WEIGHT_STEP > GRADE_COLUMN_MAX ? 'disabled' : ''} aria-label="زد">+</button></span>` : ''}
      </div>`).join('') +
      `<div class="gw-sum"><i style="width:${Math.min(100, Math.round(100 * total / (cap || 1)))}%" class="${total === cap ? 'full' : over ? 'over' : ''}"></i></div>
       <div class="gw-sumtxt${total === cap ? ' full' : ''}"><span>المجموع</span><span>${formatScore(total)} من ${formatScore(cap)}${total === cap ? ' ✓' : total < cap ? ` — المتبقي ${formatScore(cap - total)}` : ''}</span></div>
       <button type="button" class="gw-next" onclick="gradeWizardGo(${testsOn ? 2 : 3})" ${ok ? '' : 'disabled'}>التالي: ${testsOn ? 'الاختبارات' : 'الفترات'} ←</button>`;
  } else if(w.step === 2){
    body = head(`الاختبارات — من ${formatScore(gradeCap('tests'))}`, 'كم اختبارًا ستعطي في هذا الفصل؟') +
      `<div class="gw-pick">${[1, 2, 3, 4].map(n => `<button type="button" class="${w.tests === n ? 'is-on' : ''}" aria-pressed="${w.tests === n}" onclick="setGradeWizardTests(${n})"><b>${n}</b><small>${w.tests === n ? '✓ ' : ''}${n === 1 ? 'اختبار' : n === 2 ? 'اختباران' : 'اختبارات'}</small></button>`).join('')}</div>
      ${Array.from({ length: w.tests }, (_, i) => `<div class="gw-test"><b>${GRADE_WIZARD_TEST_NAMES[i]}</b><span>من ${formatScore(GRADE_TEST_DEFAULT_MAX)}</span></div>`).join('')}
      <div class="gw-hint">📐 درجة الاختبارات = متوسط ما رُصد × ${formatScore(gradeCap('tests'))} — مهما كان عددها. الاسم والدرجة يُعدَّلان لاحقًا.</div>
      <div class="gw-nav"><button type="button" class="gw-back" onclick="gradeWizardGo(1)">→ رجوع</button><button type="button" class="gw-next" onclick="gradeWizardGo(3)">التالي: الفترات ←</button></div>`;
  } else {
    const on = w.comps.filter(c => c.on);
    body = head('الفترات لكل مكوّن', 'المكوّن بأكثر من فترة يُرصد من جديد في كل فترة، ودرجته = معدّل فتراته.') +
      on.map(c => {
        const n = w.periods[c.id] || 1;
        const k = escapeHtml(c.id).replace(/'/g, '&#39;');
        return `<div class="gw-per"><span class="gw-name"><span class="gs-card-ico">${gradeWizardIcon(c)}</span><b>${escapeHtml(c.name)}</b></span>
          <span class="gs-sheet-seg gw-seg">${[1, 2, 3].map(p => `<button type="button" class="${n === p ? 'is-on' : ''}" aria-pressed="${n === p}" onclick="setGradeWizardPeriods('${k}', ${p})">${p}</button>`).join('')}</span></div>`;
      }).join('') +
      `<div class="gw-hint gw-ex">مثال: مشاركة من 10 بفترتين — <bdi dir="ltr"><b>(9 + 4) ÷ 2 = 6.5</b></bdi></div>
      <div class="gw-summary"><b>ملخص كشفك</b>
        <div><span>الأداء ${formatScore(cap)}</span><span>${on.map(c => `${escapeHtml(c.name)} ${formatScore(c.max)}`).join(' · ')}</span></div>
        <div><span>الاختبارات ${formatScore(gradeCap('tests'))}</span><span>${w.tests ? ({ 1: 'اختبار واحد', 2: 'اختباران' }[w.tests] || w.tests + ' اختبارات') : 'لا اختبارات'}</span></div>
        <div><span>الفترات</span><span>${on.some(c => (w.periods[c.id] || 1) > 1) ? on.filter(c => (w.periods[c.id] || 1) > 1).map(c => `${escapeHtml(c.name)}: ${PERIOD_COUNT_LABELS[w.periods[c.id]]}`).join(' · ') : 'فترة واحدة لكل مكوّن'}</span></div></div>
      <div class="gw-nav"><button type="button" class="gw-back" onclick="gradeWizardGo(${testsOn ? 2 : 1})">→ رجوع</button>
        <button type="button" class="gw-next gw-create" id="crmGradeWizardCreateBtn" onclick="createGradeSheetFromWizard()" ${w.saving ? 'disabled' : ''}>${w.saving ? 'جارٍ الإنشاء...' : '✓ إنشاء الكشف لكل شعبي'}</button></div>`;
  }
  return `<div class="crm-today-card gw" id="crmGradeWizard">${body}</div>`;
}

/* ============ الأفعال ============ */
function toggleGradeWizardComp(i){
  const w = crmGradeWizard;
  if(!w || !w.comps[i] || w.saving) return;
  w.touched = true;
  const c = w.comps[i];
  if(!c.on){
    /* يدخل بما يتسع (وإلا نصف درجة، فيُنقص المعلم غيره) */
    const room = gradeCap('performance') - gradeWizardTotal(w.comps);
    if(room < GRADE_WEIGHT_STEP){ showToast('المجموع مكتمل — أنقص مكوّنًا آخر أولًا', 'error'); return; }
    c.max = Math.max(GRADE_WEIGHT_STEP, Math.min(c.max, Math.floor(room / GRADE_WEIGHT_STEP) * GRADE_WEIGHT_STEP));
  }
  c.on = !c.on;
  paintGradeWizard();
}

function stepGradeWizardComp(i, dir){
  const w = crmGradeWizard;
  const c = w && w.comps[i];
  if(!c || !c.on || w.saving) return;
  const next = Math.round((c.max + dir * GRADE_WEIGHT_STEP) * 100) / 100;
  if(next < GRADE_WEIGHT_STEP || next > GRADE_COLUMN_MAX || (dir > 0 && gradeWizardTotal(w.comps) + GRADE_WEIGHT_STEP > gradeCap('performance'))) return;
  w.touched = true;
  c.max = next;
  paintGradeWizard();
}

function setGradeWizardTests(n){
  const w = crmGradeWizard;
  if(!w || w.saving || !(n >= 1 && n <= GRADE_WIZARD_TEST_NAMES.length)) return;
  w.tests = n;
  paintGradeWizard();
}

function setGradeWizardPeriods(id, n){
  const w = crmGradeWizard;
  if(!w || w.saving || !(n >= 1 && n <= PERIOD_COUNT_MAX)) return;
  if(n > 1) w.periods[id] = n; else delete w.periods[id];
  paintGradeWizard();
}

function gradeWizardGo(step){
  const w = crmGradeWizard;
  if(!w || w.saving) return;
  if(step > 1){
    const total = gradeWizardTotal(w.comps);
    if(!(total > 0) || total > gradeCap('performance')) return;
  }
  w.step = step;
  paintGradeWizard();
}

/* ============ الإنشاء ============ */
/* ١) الإعدادات (إظهار الأدوات + الفترات) بحفظ واحد ٢) أعمدة كل شعبة بلا كشف لهذا الفصل */
async function createGradeSheetFromWizard(){
  const w = crmGradeWizard;
  if(!w || w.saving || !currentUser || w.step !== 3) return;
  const total = gradeWizardTotal(w.comps);
  if(!(total > 0) || total > gradeCap('performance')) return;
  const uid = currentUser.id;
  const term = crmCurrentTerm();
  w.saving = true;
  paintGradeWizard();
  try{
    const next = normalizeFeatures(appFeatures);
    next.tools = Object.assign({}, next.tools);
    w.comps.filter(c => !c.tool_id && GRADE_KIND_TOOL[c.kind]).forEach(c => {
      if(c.on) delete next.tools[GRADE_KIND_TOOL[c.kind]]; else next.tools[GRADE_KIND_TOOL[c.kind]] = false;
    });
    const all = Object.assign({}, next.periods);
    const t = Object.assign({}, all[termPeriodKey(term)]);
    w.comps.forEach(c => { const n = c.on && w.periods[c.id]; if(n > 1) t[c.id] = { n, starts: [] }; else delete t[c.id]; });
    if(Object.keys(t).length) all[termPeriodKey(term)] = t; else delete all[termPeriodKey(term)];
    if(Object.keys(all).length) next.periods = all; else delete next.periods;
    appFeatures = next;
    if(typeof afterAppFeaturesChanged === 'function') afterAppFeaturesChanged();
    await saveAppFeatures();
    if(!currentUser || currentUser.id !== uid) return;
    if(appFeatures !== next){ /* فشل حفظ الإعدادات (أُعيد المحفوظ): لا أعمدة بلا إعدادها */
      w.saving = false;
      paintGradeWizard();
      return;
    }
    const failed = [];
    let created = 0;
    for(const sec of crmSections){
      try{
        const { data: existing, error } = await sb.from('classroom_grade_columns').select('id, category, max_score, tool_id')
          .eq('teacher_id', uid).eq('section_id', sec.id).eq('academic_year', term.year).eq('semester', term.semester);
        if(error) throw error;
        if(hasBaseGradeColumns(existing)) continue; /* للشعبة كشف (أو أُنشئ من جهاز آخر للتو) */
        const rows = gradeWizardColumns(w, existing).map(c => Object.assign({ teacher_id: uid, section_id: sec.id, academic_year: term.year, semester: term.semester }, c));
        const { error: iErr } = await sb.from('classroom_grade_columns').insert(rows);
        if(iErr) throw iErr;
        created++;
      } catch(e){
        failed.push(crmSectionLabel(sec.id) + ': ' + gradeDbErrorMessage(e));
      }
      if(!currentUser || currentUser.id !== uid) return;
    }
    if(failed.length){
      showToast('لم يكتمل الإنشاء في: ' + failed.join(' — ') + '. أعد المحاولة.', 'error');
      w.saving = false;
      paintGradeWizard();
      return;
    }
    crmGradeWizard = null;
    showToast(created > 1 ? `أُنشئ الكشف لـ ${created} شعب ✓` : 'أُنشئ الكشف ✓', 'ok');
    if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  } catch(e){
    showToast('تعذّر الإنشاء: ' + (e.message || ''), 'error');
    w.saving = false;
    paintGradeWizard();
    return;
  }
  renderCrmGrades();
}

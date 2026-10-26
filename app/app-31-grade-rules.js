/* ============================================================
   حدود تحليل الدرجات بيد المعلم (⚙ بجانب «من هم؟» في نافذة التحليل)
   ------------------------------------------------------------
   - ثلاثة حدود: يحتاج دعمًا (أقل من س%) · على الحافة (حتى +ص فوق ذلك) · متفوق (من ع%).
   - خيار: إن لم يبلغ أحد حدّ المتفوق تُعرض أعلى 3 باسم «الأعلى درجات».
   - تُحفظ في user_app_settings.features.analysisRules (مثل تقديرات الحروف) وتُطبَّق على كل
     شعب المعلم؛ غياب المفتاح = الافتراضي (50 · +10 · 90).
   - للتحليل فقط: لا تغيّر ألوان الكشف ولا تنبيهات المتابعة (حدّها 50 في app-16).
   ============================================================ */

const GRADE_RULES_DEFAULT = { pass: 50, edge: 10, top: 90, fallback: false };
const GRADE_RULES_BOUNDS = { pass: [1, 99], edge: [1, 30], top: [50, 100] };
const GRADE_RULES_LABELS = { pass: 'يحتاج دعمًا: أقل من', edge: 'على الحافة: حتى', top: 'متفوقون: من' };
const GRADE_RULES_UNITS = { pass: '%', edge: '% فوق ذلك', top: '%' };
const GRADE_TOP_PRESETS = [80, 85, 90, 95];

/* ============ دوال صرفة ============ */

/* خطأ نصي أو null */
function validateGradeRules(r){
  if(!r || typeof r !== 'object') return 'حدود غير صالحة';
  for(const k of ['pass', 'edge', 'top']){
    const v = Number(r[k]);
    const [lo, hi] = GRADE_RULES_BOUNDS[k];
    if(r[k] === '' || r[k] === null || !Number.isInteger(v) || v < lo || v > hi) return `${GRADE_RULES_LABELS[k]} — رقم صحيح من ${lo} إلى ${hi}`;
  }
  if(Number(r.pass) + Number(r.edge) > Number(r.top)) return 'حدّ المتفوق يجب ألا يقلّ عن حدّ النجاح + الحافة';
  return null;
}

/* ما يُقرأ من القاعدة لا يُوثق بشكله */
function normalizeGradeRules(raw){
  if(!raw || typeof raw !== 'object') return null;
  const r = { pass: Number(raw.pass), edge: Number(raw.edge), top: Number(raw.top), fallback: raw.fallback === true };
  return validateGradeRules(r) ? null : r;
}

function gradeRulesNow(){
  return (typeof appFeatures !== 'undefined' && appFeatures && appFeatures.analysisRules) || GRADE_RULES_DEFAULT;
}

/* ============ المحرّر ============ */
function openCrmGaRulesEditor(){
  const a = crmGradeAnalysis;
  if(!a) return;
  const r = gradeRulesNow();
  a.rulesEdit = { draft: { pass: r.pass, edge: r.edge, top: r.top, fallback: !!r.fallback }, error: '', saving: false };
  paintCrmGradeAnalysis();
}

function gaRulesEditorHtml(a){
  const e = a.rulesEdit;
  const d = e.draft;
  const row = k => `<div class="crm-ga-rrow"><span class="crm-ga-rl">${GRADE_RULES_LABELS[k]}</span>
    <span class="crm-ga-stp"><button type="button" aria-label="زيادة" onclick="crmGaRuleStep('${k}', 1)">+</button>
    <input type="number" inputmode="numeric" id="crmGaRule_${k}" min="${GRADE_RULES_BOUNDS[k][0]}" max="${GRADE_RULES_BOUNDS[k][1]}" value="${escapeHtml(String(d[k]))}" aria-label="${GRADE_RULES_LABELS[k]}" oninput="crmGaRuleSet('${k}', this.value)">
    <button type="button" aria-label="إنقاص" onclick="crmGaRuleStep('${k}', -1)">−</button></span><span class="crm-ga-ru">${GRADE_RULES_UNITS[k]}</span></div>`;
  return `<div class="crm-ga-sec">حدود التحليل</div>
    <p class="crm-ga-fine" style="margin-top:0">تُطبَّق على كل شعبك، وللتحليل فقط — ألوان الكشف وتنبيهاته كما هي.</p>
    ${row('pass')}${row('edge')}${row('top')}
    <div class="crm-ga-pre">${GRADE_TOP_PRESETS.map(p => `<button type="button" class="${Number(d.top) === p ? 'is-on' : ''}" onclick="crmGaRulePreset(${p})">${p}</button>`).join('')}</div>
    <label class="crm-ga-chk"><input type="checkbox"${d.fallback ? ' checked' : ''} onchange="crmGaRuleFallback(this.checked)"> إن لم يبلغ أحد حدّ المتفوق، اعرض أعلى 3 في الشعبة</label>
    <div class="crm-ga-err" id="crmGaRulesErr">${escapeHtml(e.error)}</div>
    <button type="button" class="btn btn-primary" id="crmGaRulesSave" style="width:100%" ${e.saving ? 'disabled' : ''} onclick="saveCrmGaRules()">حفظ</button>
    <div class="crm-ga-eacts"><button type="button" class="crm-ga-link" onclick="crmGaRulesReset()">الافتراضي</button><button type="button" class="crm-ga-link" onclick="crmGaRulesCancel()">إلغاء</button></div>`;
}

function crmGaRuleSet(k, value){
  const e = crmGradeAnalysis && crmGradeAnalysis.rulesEdit;
  if(e) e.draft[k] = value === '' ? '' : Number(value);
}

function crmGaRuleStep(k, delta){
  const e = crmGradeAnalysis && crmGradeAnalysis.rulesEdit;
  if(!e) return;
  const [lo, hi] = GRADE_RULES_BOUNDS[k];
  const cur = Number(e.draft[k]);
  e.draft[k] = Math.max(lo, Math.min(hi, (Number.isFinite(cur) ? cur : lo) + delta));
  const input = document.getElementById('crmGaRule_' + k);
  if(input) input.value = e.draft[k];
  if(k === 'top') paintCrmGradeAnalysis();
}

function crmGaRulePreset(p){
  const e = crmGradeAnalysis && crmGradeAnalysis.rulesEdit;
  if(!e) return;
  e.draft.top = p;
  paintCrmGradeAnalysis();
}

function crmGaRuleFallback(on){
  const e = crmGradeAnalysis && crmGradeAnalysis.rulesEdit;
  if(e) e.draft.fallback = !!on;
}

function crmGaRulesReset(){
  const a = crmGradeAnalysis;
  if(!a || !a.rulesEdit) return;
  a.rulesEdit.draft = Object.assign({}, GRADE_RULES_DEFAULT);
  a.rulesEdit.error = '';
  paintCrmGradeAnalysis();
}

function crmGaRulesCancel(){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.rulesEdit = null;
  paintCrmGradeAnalysis();
}

async function persistGradeRules(rules){
  const uid = currentUser.id;
  const next = normalizeFeatures(appFeatures);
  /* الافتراضي لا يُخزَّن: غياب المفتاح = الافتراضي */
  if(JSON.stringify(rules) === JSON.stringify(GRADE_RULES_DEFAULT)) delete next.analysisRules; else next.analysisRules = rules;
  appFeatures = next;
  await saveAppFeatures();
  if(!currentUser || currentUser.id !== uid) return 'تغيّر الحساب';
  const saved = appFeaturesSaved.analysisRules || GRADE_RULES_DEFAULT;
  return JSON.stringify(saved) === JSON.stringify(rules) ? null : 'تعذّر حفظ الحدود';
}

async function saveCrmGaRules(){
  const a = crmGradeAnalysis;
  const e = a && a.rulesEdit;
  if(!e || e.saving) return;
  const bad = validateGradeRules(e.draft);
  if(bad){ e.error = bad; paintCrmGradeAnalysis(); return; }
  const rules = { pass: Number(e.draft.pass), edge: Number(e.draft.edge), top: Number(e.draft.top), fallback: !!e.draft.fallback };
  e.saving = true;
  const btn = document.getElementById('crmGaRulesSave');
  if(btn) btn.disabled = true;
  const err = await persistGradeRules(rules);
  if(crmGradeAnalysis !== a) return;
  e.saving = false;
  if(err){ e.error = err; paintCrmGradeAnalysis(); return; }
  a.rulesEdit = null;
  a.open = gradeAnalysisDefaultOpen(a);
  paintCrmGradeAnalysis();
  showToast('حُفظت الحدود', 'ok');
}

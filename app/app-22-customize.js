/* ============================================================
   تخصيص التطبيق — المعلم يختار ما يظهر له
   ------------------------------------------------------------
   باتفاق مع المعلم:
   - أربعة أقسام (الشواهد، أدائي، أعمالي، إدارة الصف) لا يُفرض أي منها،
     بشرط قسم واحد على الأقل.
   - أدوات إدارة الصف (الحضور، المشاركة، الواجبات، المهام الأدائية،
     الاختبارات، السلوك والمخالفات) لكلٍّ مفتاحه.
   - الإيقاف يُخفي فقط: البيانات تبقى كاملة، ودرجات المخفي لا تُحسب في
     أي مجموع أو تنبيه، والإظهار يعيد كل شيء كما كان.
   - مكان المخفي: الإعدادات ← "تخصيص التطبيق" (مع ما حُفظ له)، وتذكير في
     كشف الدرجات وحده (لأن مجموع الموزّع ينقص فيه).
   - المصدر الوحيد للحقيقة: appSectionOn/appToolOn — كل جزء في التطبيق
     يسألهما، فلا ينسى جزء احترام اختيار المعلم.
   - الحفظ في جدول user_app_settings (لكل معلم صفّه، RLS للمالك)، فيتبع
     الاختيار حسابه على كل أجهزته. غياب المفتاح = ظاهر (المعلمون الحاليون
     لا يتغيّر عليهم شيء).
   ============================================================ */

const APP_SECTIONS = [
  { key: 'shahid', icon: '📑', label: 'الشواهد', sub: 'توثيق الشواهد وملف الإنجاز' },
  { key: 'plan', icon: '📋', label: 'أدائي', sub: 'خطة الأداء والتقييم الذاتي' },
  { key: 'work', icon: '✅', label: 'أعمالي', sub: 'المهام والبرامج' },
  { key: 'classroom', icon: '🏫', label: 'إدارة الصف', sub: 'الطلاب والحصص والدرجات' }
];
const APP_TOOLS = [
  { key: 'attendance', icon: '🙋', label: 'الحضور', sub: 'الغياب والتأخر والاستئذان في ورقة الحصة وتنبيهاتها' },
  { key: 'participation', icon: '👆', label: 'المشاركة', sub: '+1 بنقرة، وعمود المشاركة في الكشف' },
  { key: 'homework', icon: '📝', label: 'الواجبات', sub: 'رصد التسليم، وعمود الواجبات المحسوب' },
  { key: 'tasks', icon: '🎯', label: 'المهام الأدائية', sub: 'المهام الفردية والجماعية، وعمودها المحسوب' },
  { key: 'tests', icon: '🧾', label: 'الاختبارات', sub: 'أعمدة التقويمات الشفهية والتحريرية في الكشف' },
  { key: 'behavior', icon: '⚠️', label: 'السلوك والمخالفات', sub: 'تبويب المخالفات، والمواقف الرسمية وتنبيهاتها' }
];

let appFeatures = {};       /* { sections: {key: bool}, tools: {key: bool}, grades?: {performance, tests} } — غياب المفتاح = ظاهر */
let appFeaturesRowExists = false; /* للمعلم صف إعدادات؟ (لا = لم يُسأل بعد) */
let appFeaturesSaved = {};  /* آخر نسخة أكّدت القاعدة حفظها (للتراجع عند فشل الحفظ) */

/* ============ دوال صرفة ============ */
function featureFlag(features, group, key){
  const g = features && features[group];
  return !(g && g[key] === false);
}

function appSectionOn(key){ return featureFlag(appFeatures, 'sections', key); }

/* الأداة تتبع قسمها: إدارة الصف موقوفة = كل أدواتها موقوفة */
function appToolOn(key){ return appSectionOn('classroom') && featureFlag(appFeatures, 'tools', key); }

/* توزيع الدرجات صالح؟ رقمان غير سالبين بمنازل 0.5 مجموعهما 60 */
function validGradeCaps(g){
  if(!g) return false;
  const ok = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.round(v * 2) === v * 2;
  return ok(g.performance) && ok(g.tests) && g.performance + g.tests === GRADE_CAPS_TOTAL;
}

/* يُبقي فقط المفاتيح المعروفة وقيمها المنطقية — ما يُقرأ من القاعدة لا يُوثق بشكله */
function normalizeFeatures(raw){
  const out = { sections: {}, tools: {} };
  const pick = (list, group) => list.forEach(x => {
    const v = raw && raw[group] && raw[group][x.key];
    if(v === false) out[group][x.key] = false;
  });
  pick(APP_SECTIONS, 'sections');
  pick(APP_TOOLS, 'tools');
  if(raw && validGradeCaps(raw.grades)) out.grades = { performance: raw.grades.performance, tests: raw.grades.tests };
  /* "يبدأ من الكاملة" لمكوّنات الأداء (المشاركة، الواجبات، المهام، المكوّنات الخاصة) — الأصل من 0 */
  const sf = raw && raw.startFull;
  if(sf && typeof sf === 'object'){
    const keys = Object.keys(sf).filter(k => sf[k] === true && isStartFullKey(k));
    if(keys.length) out.startFull = Object.fromEntries(keys.map(k => [k, true]));
  }
  /* الفترات لكل مكوّن في كل فصل (app-27) */
  const pr = typeof normalizePeriodsFeature === 'function' ? normalizePeriodsFeature(raw && raw.periods) : null;
  if(pr) out.periods = pr;
  /* تقديرات الحروف التي عدّلها المعلم (app-30) */
  const gl = typeof normalizeGradeLetters === 'function' ? normalizeGradeLetters(raw && raw.gradeLetters) : null;
  if(gl) out.gradeLetters = gl;
  return out;
}

function isStartFullKey(k){
  return k === 'participation' || k === 'homework' || k === 'task' || /^tool:[0-9a-f-]{36}$/i.test(k);
}

function gradeStartsFull(key){
  return !!(appFeatures && appFeatures.startFull && appFeatures.startFull[key] === true);
}

/* توزيع المعلم، وإلا الرسمي 40/20 */
function appGradeCaps(){
  return (appFeatures && validGradeCaps(appFeatures.grades)) ? appFeatures.grades : GRADE_CAPS_DEFAULT;
}

/* أعمدة أداء تتجاوز وزنه الجديد (أي فصل) — لا يُحفظ توزيع يجعل كشفًا قائمًا مخالفًا.
   الاختبارات بلا سقف (محصلتها متوسط يُقاس على وزنها) فلا تتعارض أبدًا */
function gradeCapsConflicts(columns, caps){
  const totals = new Map();
  (columns || []).filter(c => c.category === 'performance').forEach(c => {
    const k = [c.section_id, c.academic_year, c.semester, c.category].join('|');
    totals.set(k, (totals.get(k) || 0) + Number(c.max_score));
  });
  const out = [];
  totals.forEach((total, k) => {
    const [section_id, academic_year, semester, category] = k.split('|');
    if(total > caps[category] + 0.001) out.push({ section_id, academic_year, semester: Number(semester), category, total });
  });
  return out;
}

function parseCapInput(v){
  const t = String(v === null || v === undefined ? '' : v).trim().replace(/[٠-٩]/g, x => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[٫,]/g, '.');
  return t === '' ? NaN : Number(t);
}

function withFeatureToggled(features, group, key){
  const next = normalizeFeatures(features);
  if(featureFlag(next, group, key)) next[group][key] = false; else delete next[group][key];
  return next;
}

function enabledSectionKeys(features){
  return APP_SECTIONS.map(s => s.key).filter(k => featureFlag(features, 'sections', k));
}

/* عمود الدرجات ظاهر ويُحسب؟ الاختبارات بفئتها، والمحسوبة/المشاركة بأداتها، واليدوي الأدائي دائمًا */
const GRADE_KIND_TOOL = { participation: 'participation', homework: 'homework', task: 'tasks' };
function gradeColumnVisible(c){
  if(!c) return false;
  if(c.tool_id) return toolColumnVisible(c); /* عمود أداة خاصة: يتبع إخفاء الأداة (app-23) */
  if(c.category === 'tests') return appToolOn('tests');
  const tool = GRADE_KIND_TOOL[c.kind];
  return tool ? appToolOn(tool) : true;
}

/* أوضاع ورقة الحصة المفعّلة بالترتيب */
const SHEET_MODE_TOOL = { attendance: 'attendance', participation: 'participation', homework: 'homework', task: 'tasks', test: 'tests' };
function enabledSheetModes(){
  const builtIn = Object.keys(SHEET_MODE_TOOL).filter(m => appToolOn(SHEET_MODE_TOOL[m]));
  return builtIn.concat(typeof enabledCustomToolModes === 'function' ? enabledCustomToolModes() : []);
}

/* متابعة أداتها مخفية لا تظهر ولا تنبّه */
const FOLLOWUP_REASON_TOOL = { absence: 'attendance', lateness: 'attendance', exits: 'attendance', behavior: 'behavior' };
function followupVisible(f){
  const tool = f && FOLLOWUP_REASON_TOOL[f.reason_type];
  return tool ? appToolOn(tool) : true;
}

/* ============ التحميل والحفظ ============ */
async function loadAppFeatures(uid){
  appFeatures = {};
  appFeaturesSaved = {};
  appFeaturesRowExists = false;
  const { data, error } = await sb.from('user_app_settings').select('features').eq('user_id', uid).maybeSingle();
  if(error) throw error;
  if(!currentUser || currentUser.id !== uid) return;
  appFeaturesRowExists = !!data;
  appFeatures = normalizeFeatures(data && data.features);
  appFeaturesSaved = appFeatures;
}

let appFeaturesSaveChain = Promise.resolve();
function saveAppFeatures(){
  const uid = currentUser.id;
  appFeaturesSaveChain = appFeaturesSaveChain.then(async () => {
    if(!currentUser || currentUser.id !== uid) return;
    const snapshot = appFeatures; /* أحدث اختيار وقت الإرسال، لا وقت النقر */
    const { error } = await sb.from('user_app_settings').upsert(
      { user_id: uid, features: snapshot, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if(!currentUser || currentUser.id !== uid) return;
    if(error){
      appFeatures = appFeaturesSaved;
      showToast('تعذّر حفظ التخصيص — أُعيد آخر اختيار محفوظ', 'error');
      afterAppFeaturesChanged();
      return;
    }
    appFeaturesSaved = snapshot;
    appFeaturesRowExists = true;
  });
  return appFeaturesSaveChain;
}

function toggleAppFeature(group, key){
  if(!currentUser) return;
  const next = withFeatureToggled(appFeatures, group, key);
  if(group === 'sections' && !enabledSectionKeys(next).length){
    showToast('يلزم قسم واحد على الأقل', 'error');
    return;
  }
  appFeatures = next;
  afterAppFeaturesChanged();
  return saveAppFeatures();
}

/* كل ما يتأثر بالاختيار يُعاد رسمه */
function afterAppFeaturesChanged(){
  applyAppFeatures();
  if(typeof invalidateAttention === 'function'){ invalidateAttention(); refreshAttention(); }
  renderAppCustomize();
}

/* ============ تطبيق الاختيار على الواجهة ============ */
function setShown(el, on){ if(el) el.style.display = on ? '' : 'none'; }

function applyAppFeatures(){
  const standalone = typeof STANDALONE_ROLES !== 'undefined' && STANDALONE_ROLES.includes(dutyType);
  const shahid = appSectionOn('shahid'), plan = appSectionOn('plan'), work = appSectionOn('work');
  const classroom = !standalone && appSectionOn('classroom');
  setShown(document.querySelector('.bottom-tab-btn[data-tab="shahid"]'), shahid);
  setShown(document.getElementById('workNavTab'), work);
  setShown(document.getElementById('classroomNavTab'), classroom);
  setShown(document.getElementById('homeNewShahidBtn'), shahid);
  setShown(document.getElementById('homeExportPortfolioBtn'), shahid);
  setShown(document.getElementById('homeExportPortfolioSep'), shahid);
  setShown(document.getElementById('planHomeBtn'), plan);
  setShown(document.getElementById('workHomeBtn'), work);
  /* بلا قسم الشواهد تصبح الرئيسية شبه فارغة — بلاطة إدارة الصف تملؤها */
  setShown(document.getElementById('classroomHomeBtn'), classroom && !shahid);
  setShown(document.getElementById('homeTiles'), plan || work || (classroom && !shahid));
  if(!shahid) setShown(document.getElementById('homeProgressCard'), false);
  setShown(document.getElementById('crmTabBtnRecord'), appToolOn('behavior'));
  setShown(document.getElementById('crmTabBtnFollowups'), typeof followupsOn !== 'function' || followupsOn());
  if(!classroom){
    const badge = document.getElementById('classroomNavBadge');
    if(badge) badge.style.display = 'none';
  }
  renderCustomizeIntroCard();
}

/* قسم واحد مفعّل = التطبيق يفتح عليه مباشرة */
const SECTION_OPENERS = { shahid: 'showList', plan: 'showPlan', work: 'showTasks', classroom: 'showClassroomManagement' };
function landingSection(features){
  const on = enabledSectionKeys(features);
  return on.length === 1 ? on[0] : null;
}

/* ============ الإعدادات ← تخصيص التطبيق ============ */
function showAppCustomize(){
  showSettingsSection('customize');
  renderAppCustomize();
}

function customizeRowHtml(group, item){
  const on = featureFlag(appFeatures, group, item.key);
  return `<div class="cust-row${on ? '' : ' is-off'}">
    <div class="cust-text">
      <b>${item.icon} ${escapeHtml(item.label)}</b>
      <small>${escapeHtml(item.sub)}</small>
      ${on ? '' : `<small class="cust-hidden" id="custSaved_${group}_${item.key}">👁 مخفي — بياناته محفوظة</small>`}
    </div>
    <button type="button" class="cust-switch${on ? ' is-on' : ''}" role="switch" aria-checked="${on}" aria-label="${escapeHtml(item.label)}" onclick="toggleAppFeature('${group}', '${item.key}')"><span></span></button>
  </div>`;
}

let appCustomizeToken = 0;
function renderAppCustomize(){
  const box = document.getElementById('appCustomizeBody');
  if(!box || !currentUser) return;
  const classroom = appSectionOn('classroom');
  box.innerHTML = `
    <p class="cust-note">الإيقاف يُخفي فقط: البيانات تبقى محفوظة كاملة، ودرجات المخفي لا تُحسب، والإظهار يعيد كل شيء كما كان.</p>
    <h3 class="cust-h">الأقسام</h3>
    ${APP_SECTIONS.map(s => customizeRowHtml('sections', s)).join('')}
    <h3 class="cust-h">أدوات إدارة الصف</h3>
    ${classroom ? APP_TOOLS.map(t => customizeRowHtml('tools', t)).join('') : '<p class="cust-note">فعّل قسم "إدارة الصف" لاختيار أدواته.</p>'}
    ${classroom ? `<h3 class="cust-h">الدرجات</h3>
      <p class="cust-note">توزيع الدرجات، ومكوّنات الأداء (مثل البحوث)، والاختبارات — كلها في مكان واحد:</p>
      <button class="btn btn-outline crm-mini-btn" onclick="openGradeSettingsFromAnywhere()">⚙ إعداد الدرجات</button>` : ''}`;
  fillHiddenSavedCounts(++appCustomizeToken);
}

/* ما حُفظ للمخفي — يطمئن المعلم أن الإخفاء لم يحذف شيئًا */
const HIDDEN_COUNT_QUERIES = {
  sections: {
    shahid: uid => [['shawahid', q => q.eq('user_id', uid), 'شاهد', 'شواهد']],
    plan: uid => [['performance_goals', q => q.eq('user_id', uid), 'مستهدف', 'مستهدفات']],
    work: uid => [['tasks', q => q.eq('user_id', uid), 'مهمة', 'مهام']],
    classroom: uid => [['classroom_students', q => q.eq('teacher_id', uid), 'طالب', 'طلاب']]
  },
  tools: {
    attendance: uid => [['classroom_attendance', q => q.eq('teacher_id', uid), 'رصد غياب/تأخر', 'رصد غياب/تأخر']],
    homework: uid => [['classroom_homework', q => q.eq('teacher_id', uid), 'واجب', 'واجبات'], ['classroom_homework_status', q => q.eq('teacher_id', uid), 'رصد تسليم', 'رصد تسليم']],
    tasks: uid => [['classroom_tasks', q => q.eq('teacher_id', uid), 'مهمة', 'مهام'], ['classroom_task_students', q => q.eq('teacher_id', uid).not('score', 'is', null), 'درجة', 'درجات']],
    behavior: uid => [['classroom_incidents', q => q.eq('teacher_id', uid), 'موقف', 'مواقف']]
  }
};

async function fillHiddenSavedCounts(token){
  const uid = currentUser.id;
  for(const group of ['sections', 'tools']){
    const list = group === 'sections' ? APP_SECTIONS : APP_TOOLS;
    for(const item of list){
      if(featureFlag(appFeatures, group, item.key)) continue;
      const build = HIDDEN_COUNT_QUERIES[group][item.key];
      if(!build) continue;
      try{
        const parts = [];
        for(const [table, filter, one, many] of build(uid)){
          const { count, error } = await filter(sb.from(table).select('id', { count: 'exact', head: true }));
          if(error) throw error;
          if(count) parts.push(`${count} ${count === 1 ? one : many}`);
        }
        if(token !== appCustomizeToken) return;
        const el = document.getElementById(`custSaved_${group}_${item.key}`);
        if(el && parts.length) el.textContent = '👁 مخفي · محفوظ: ' + parts.join(' و');
      } catch(e){ /* السطر العام "بياناته محفوظة" يكفي */ }
    }
  }
}

/* ============ تذكير المخفي في كشف الدرجات ============ */
function hiddenGradeColumnsLineHtml(hidden){
  if(!(hidden || []).length) return '';
  const list = hidden.map(c => `${escapeHtml(c.name)} (${formatScore(c.max_score)})`).join('، ');
  return `<div class="cust-sheet-hidden">👁 مخفي ولا يُحسب: ${list} · <a href="#" onclick="event.preventDefault();showSettings();showAppCustomize();">إظهار</a></div>`;
}

/* ============ بطاقة "جديد: خصّص التطبيق" (مرة واحدة للمعلمين الحاليين) ============ */
const CUSTOMIZE_INTRO_KEY = 'shahid_customize_intro_seen';
function renderCustomizeIntroCard(){
  const card = document.getElementById('homeCustomizeIntro');
  if(!card) return;
  let seen = false;
  try{ seen = !!localStorage.getItem(CUSTOMIZE_INTRO_KEY); } catch(e){}
  card.style.display = seen ? 'none' : '';
}

function dismissCustomizeIntro(open){
  try{ localStorage.setItem(CUSTOMIZE_INTRO_KEY, '1'); } catch(e){}
  renderCustomizeIntroCard();
  if(open){ showSettings(); showAppCustomize(); }
}

/* ============ توزيع الدرجات (المجموع 60) ============ */
function gradeCapsEditorHtml(prefix){
  const caps = appGradeCaps();
  return `<h3 class="cust-h">توزيع الدرجات (المجموع ${GRADE_CAPS_TOTAL})</h3>
    <div class="cust-caps">
      <label class="cust-cap"><span>${GRADE_CATEGORY_LABELS.performance}</span>
        <input class="goal-input" id="${prefix}CapPerf" inputmode="decimal" value="${formatScore(caps.performance)}" oninput="syncGradeCapInputs('${prefix}', 'performance')"></label>
      <label class="cust-cap"><span>${GRADE_CATEGORY_LABELS.tests}</span>
        <input class="goal-input" id="${prefix}CapTests" inputmode="decimal" value="${formatScore(caps.tests)}" oninput="syncGradeCapInputs('${prefix}', 'tests')"></label>
      <small class="cust-note" style="margin:0;">الافتراضي في النظام ${GRADE_CAPS_DEFAULT.performance} و${GRADE_CAPS_DEFAULT.tests}. اكتب إحداهما والأخرى تُكمَل تلقائيًا.</small>
      ${prefix === 'cust' ? `<div style="display:flex;gap:6px;margin-top:8px;">
        <button class="btn btn-primary crm-mini-btn" id="custCapsSaveBtn" onclick="saveGradeCaps()">حفظ التوزيع</button>
        <button class="btn btn-outline crm-mini-btn" onclick="resetGradeCapInputs('cust')">الافتراضي (${GRADE_CAPS_DEFAULT.performance}/${GRADE_CAPS_DEFAULT.tests})</button>
      </div>` : ''}
      <div id="${prefix}CapsMsg" class="cust-caps-msg" style="display:none;"></div>
    </div>`;
}

/* اكتب إحدى الفئتين والأخرى = 60 − هي */
function syncGradeCapInputs(prefix, changed){
  const perf = document.getElementById(prefix + 'CapPerf'), tests = document.getElementById(prefix + 'CapTests');
  if(!perf || !tests) return;
  const src = changed === 'performance' ? perf : tests, dst = changed === 'performance' ? tests : perf;
  const v = parseCapInput(src.value);
  if(Number.isFinite(v) && v >= 0 && v <= GRADE_CAPS_TOTAL) dst.value = formatScore(Math.round((GRADE_CAPS_TOTAL - v) * 100) / 100);
}

function resetGradeCapInputs(prefix){
  const perf = document.getElementById(prefix + 'CapPerf'), tests = document.getElementById(prefix + 'CapTests');
  if(perf) perf.value = String(GRADE_CAPS_DEFAULT.performance);
  if(tests) tests.value = String(GRADE_CAPS_DEFAULT.tests);
}

/* يقرأ الحقلين؛ { caps } أو { error } */
function readGradeCapInputs(prefix){
  const caps = {
    performance: parseCapInput((document.getElementById(prefix + 'CapPerf') || {}).value),
    tests: parseCapInput((document.getElementById(prefix + 'CapTests') || {}).value)
  };
  if(!validGradeCaps(caps)) return { error: `اكتب رقمين (بمنازل 0.5) مجموعهما ${GRADE_CAPS_TOTAL}` };
  return { caps };
}

function showGradeCapsMsg(prefix, text, ok){
  const box = document.getElementById(prefix + 'CapsMsg');
  if(!box) return;
  box.textContent = text;
  box.style.display = text ? 'block' : 'none';
  box.style.color = ok ? '#215C34' : '#8A2C2C';
}

/* يحفظ التوزيع بعد التأكد أن لا كشف قائمًا (أي فصل) يتجاوز وزن الأداء الجديد.
   null = حُفظ، وإلا نص الخطأ للمعلم */
async function persistGradeCaps(caps){
  const uid = currentUser.id;
  const { data: cols, error } = await sb.from('classroom_grade_columns').select('section_id, academic_year, semester, category, max_score').eq('teacher_id', uid);
  if(error) return 'تعذّر الحفظ: ' + (error.message || '');
  const conflicts = gradeCapsConflicts(cols, caps);
  if(conflicts.length){
    const label = c => (typeof crmSectionById === 'function' && crmSectionById(c.section_id) ? crmSectionLabel(c.section_id) : 'شعبة') + ' (' + c.academic_year + ')';
    return 'كشوف قائمة تتجاوز السقف الجديد — قلّل أعمدتها أولًا: ' + conflicts.map(c => `${label(c)}: ${GRADE_CATEGORY_LABELS[c.category]} موزّع ${formatScore(c.total)} والسقف ${formatScore(caps[c.category])}`).join(' · ');
  }
  if(!currentUser || currentUser.id !== uid) return 'تغيّر الحساب';
  appFeatures = Object.assign(normalizeFeatures(appFeatures), { grades: caps });
  afterAppFeaturesChanged();
  await saveAppFeatures();
  if(!(appFeaturesSaved.grades && appFeaturesSaved.grades.performance === caps.performance && appFeaturesSaved.grades.tests === caps.tests)) return 'تعذّر حفظ التوزيع';
  return null;
}

let gradeCapsSaving = false;
async function saveGradeCaps(){
  if(gradeCapsSaving || !currentUser) return;
  const r = readGradeCapInputs('cust');
  if(r.error){ showGradeCapsMsg('cust', r.error, false); return; }
  gradeCapsSaving = true;
  const btn = document.getElementById('custCapsSaveBtn');
  if(btn) btn.disabled = true;
  try{
    const e = await persistGradeCaps(r.caps);
    if(e){ showGradeCapsMsg('cust', e, false); return; }
    showGradeCapsMsg('cust', 'حُفظ التوزيع ✓', true);
    if(document.getElementById('crmTabGrades') && document.getElementById('crmTabGrades').style.display !== 'none' && typeof renderCrmGrades === 'function') renderCrmGrades();
  } catch(e){
    showGradeCapsMsg('cust', 'تعذّر الحفظ: ' + (e.message || ''), false);
  } finally {
    gradeCapsSaving = false;
    const b = document.getElementById('custCapsSaveBtn');
    if(b) b.disabled = false;
  }
}

/* ============ أول دخول: المعلم يختار (للحسابات الجديدة فقط) ============ */
const CUSTOMIZE_WIZARD_SINCE = '2026-10-19T00:00:00Z';
const GRADED_TOOLS = ['participation', 'homework', 'tasks', 'tests'];
let custWizard = null; /* { step, sections: Set, tools: Set, saving } */

function needsCustomizeWizard(user){
  return !appFeaturesRowExists && !!user && !!user.created_at && user.created_at >= CUSTOMIZE_WIZARD_SINCE;
}

/* الخطوات بحسب الاختيار: الأقسام، ثم الأدوات (إن اختار إدارة الصف)، ثم التوزيع (إن اختار أداة لها درجات) */
function wizardSteps(w){
  const steps = ['sections'];
  if(w.sections.has('classroom')) steps.push('tools');
  if(w.sections.has('classroom') && GRADED_TOOLS.some(t => w.tools.has(t))) steps.push('grades');
  return steps;
}

/* الاختيار ← إعدادات تُحفظ: ما لم يُختر = مخفي */
function featuresFromWizard(w, caps){
  const f = { sections: {}, tools: {} };
  APP_SECTIONS.forEach(s => { if(!w.sections.has(s.key)) f.sections[s.key] = false; });
  if(w.sections.has('classroom')) APP_TOOLS.forEach(t => { if(!w.tools.has(t.key)) f.tools[t.key] = false; });
  if(caps) f.grades = caps;
  return f;
}

function openCustomizeWizard(){
  custWizard = { step: 'sections', sections: new Set(), tools: new Set(), saving: false };
  showInfoModal('<div id="custWizBody" style="text-align:right;"></div>', '480px');
  renderCustomizeWizard();
}

function wizardCardHtml(kind, item, on){
  return `<button type="button" class="cust-card${on ? ' is-on' : ''}" onclick="toggleWizardPick('${kind}', '${item.key}')">
    <b>${item.icon} ${escapeHtml(item.label)}</b><small>${escapeHtml(item.sub)}</small></button>`;
}

function renderCustomizeWizard(){
  const w = custWizard, box = document.getElementById('custWizBody');
  if(!w || !box) return;
  const steps = wizardSteps(w);
  const i = steps.indexOf(w.step);
  const last = i === steps.length - 1;
  const back = i > 0 ? `<button class="btn btn-outline" onclick="moveCustomizeWizard(-1)">رجوع</button>` : '';
  let body = '', canNext = true;
  if(w.step === 'sections'){
    canNext = w.sections.size > 0;
    body = `<h3 class="cust-wiz-h">أهلًا بك! ماذا تريد من التطبيق؟</h3>
      <p class="cust-note">اختر ما تستخدمه فقط — يمكنك التغيير متى شئت من الإعدادات ← تخصيص التطبيق.</p>
      <div class="cust-cards">${APP_SECTIONS.map(s => wizardCardHtml('sections', s, w.sections.has(s.key))).join('')}</div>`;
  } else if(w.step === 'tools'){
    body = `<h3 class="cust-wiz-h">ما أدواتك في إدارة الصف؟</h3>
      <p class="cust-note">الطلاب والحصص موجودة دائمًا؛ اختر الأدوات التي ترصدها. <a href="#" onclick="event.preventDefault();pickAllWizardTools()">اختر الكل</a></p>
      <div class="cust-cards">${APP_TOOLS.map(t => wizardCardHtml('tools', t, w.tools.has(t.key))).join('')}</div>`;
  } else {
    body = `<h3 class="cust-wiz-h">كيف توزّع درجاتك؟</h3>${gradeCapsEditorHtml('wiz')}`;
  }
  box.innerHTML = body + `<div id="custWizErr" class="cust-caps-msg" style="display:none;"></div>
    <div class="cust-wiz-bar">${back}
      <button class="btn btn-primary" id="custWizNext" ${canNext ? '' : 'disabled'} onclick="${last ? 'finishCustomizeWizard()' : 'moveCustomizeWizard(1)'}">${last ? 'ابدأ' : 'التالي'}</button></div>
    <div class="cust-wiz-steps">${steps.map((st, k) => `<span class="${k === i ? 'is-on' : ''}"></span>`).join('')}</div>`;
}

function toggleWizardPick(kind, key){
  const w = custWizard;
  if(!w || w.saving) return;
  const set = kind === 'sections' ? w.sections : w.tools;
  if(set.has(key)) set.delete(key); else set.add(key);
  renderCustomizeWizard();
}

function pickAllWizardTools(){
  if(!custWizard || custWizard.saving) return;
  APP_TOOLS.forEach(t => custWizard.tools.add(t.key));
  renderCustomizeWizard();
}

function moveCustomizeWizard(delta){
  const w = custWizard;
  if(!w || w.saving) return;
  const steps = wizardSteps(w);
  const i = steps.indexOf(w.step);
  w.step = steps[Math.max(0, Math.min(steps.length - 1, i + delta))];
  renderCustomizeWizard();
}

async function finishCustomizeWizard(){
  const w = custWizard;
  if(!w || w.saving || !currentUser) return;
  let caps = null;
  if(w.step === 'grades'){
    const r = readGradeCapInputs('wiz');
    if(r.error){ showGradeCapsMsg('wiz', r.error, false); return; }
    caps = r.caps;
  }
  const features = featuresFromWizard(w, caps);
  if(!enabledSectionKeys(features).length) return;
  w.saving = true;
  const btn = document.getElementById('custWizNext');
  if(btn) btn.disabled = true;
  const uid = currentUser.id;
  const { error } = await sb.from('user_app_settings').upsert({ user_id: uid, features, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if(!currentUser || currentUser.id !== uid) return;
  if(error){
    w.saving = false;
    if(btn) btn.disabled = false;
    const box = document.getElementById('custWizErr');
    if(box){ box.textContent = 'تعذّر الحفظ: ' + (error.message || '') + ' — حاول مرة أخرى'; box.style.display = 'block'; }
    return;
  }
  appFeatures = normalizeFeatures(features);
  appFeaturesSaved = appFeatures;
  appFeaturesRowExists = true;
  custWizard = null;
  try{ localStorage.setItem(CUSTOMIZE_INTRO_KEY, '1'); } catch(e){} /* اختار للتو — لا داعي لبطاقة "جديد" */
  closeCrmModal();
  afterAppFeaturesChanged();
  await openAppLanding();
}

/* أول شاشة بعد الدخول (أو بعد إنهاء الأسئلة): قسم واحد مفعّل = يفتح عليه */
async function openAppLanding(){
  const only = landingSection(appFeatures);
  if(only && only !== 'shahid' && typeof window[SECTION_OPENERS[only]] === 'function'){
    await window[SECTION_OPENERS[only]]();
  } else {
    await showHome();
    if(appSectionOn('shahid') && typeof offerDraftRestore === 'function') offerDraftRestore();
  }
}

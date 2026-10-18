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
  { key: 'classroom', icon: '🏫', label: 'إدارة الصف', sub: 'الطلاب والحصص والدرجات والمتابعات' }
];
const APP_TOOLS = [
  { key: 'attendance', icon: '🙋', label: 'الحضور', sub: 'الغياب والتأخر والاستئذان في ورقة الحصة وتنبيهاتها' },
  { key: 'participation', icon: '👆', label: 'المشاركة', sub: '+1 بنقرة، وعمود المشاركة في الكشف' },
  { key: 'homework', icon: '📝', label: 'الواجبات', sub: 'رصد التسليم، وعمود الواجبات المحسوب' },
  { key: 'tasks', icon: '🎯', label: 'المهام الأدائية', sub: 'المهام الفردية والجماعية، وعمودها المحسوب' },
  { key: 'tests', icon: '🧾', label: 'الاختبارات', sub: 'أعمدة التقويمات الشفهية والتحريرية في الكشف' },
  { key: 'behavior', icon: '⚠️', label: 'السلوك والمخالفات', sub: 'تبويب المخالفات، والمواقف الرسمية وتنبيهاتها' }
];

let appFeatures = {};       /* { sections: {key: bool}, tools: {key: bool} } — غياب المفتاح = ظاهر */
let appFeaturesSaved = {};  /* آخر نسخة أكّدت القاعدة حفظها (للتراجع عند فشل الحفظ) */

/* ============ دوال صرفة ============ */
function featureFlag(features, group, key){
  const g = features && features[group];
  return !(g && g[key] === false);
}

function appSectionOn(key){ return featureFlag(appFeatures, 'sections', key); }

/* الأداة تتبع قسمها: إدارة الصف موقوفة = كل أدواتها موقوفة */
function appToolOn(key){ return appSectionOn('classroom') && featureFlag(appFeatures, 'tools', key); }

/* يُبقي فقط المفاتيح المعروفة وقيمها المنطقية — ما يُقرأ من القاعدة لا يُوثق بشكله */
function normalizeFeatures(raw){
  const out = { sections: {}, tools: {} };
  const pick = (list, group) => list.forEach(x => {
    const v = raw && raw[group] && raw[group][x.key];
    if(v === false) out[group][x.key] = false;
  });
  pick(APP_SECTIONS, 'sections');
  pick(APP_TOOLS, 'tools');
  return out;
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
  if(c.category === 'tests') return appToolOn('tests');
  const tool = GRADE_KIND_TOOL[c.kind];
  return tool ? appToolOn(tool) : true;
}

/* أوضاع ورقة الحصة المفعّلة بالترتيب */
const SHEET_MODE_TOOL = { attendance: 'attendance', participation: 'participation', homework: 'homework', task: 'tasks' };
function enabledSheetModes(){
  return Object.keys(SHEET_MODE_TOOL).filter(m => appToolOn(SHEET_MODE_TOOL[m]));
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
  const { data, error } = await sb.from('user_app_settings').select('features').eq('user_id', uid).maybeSingle();
  if(error) throw error;
  if(!currentUser || currentUser.id !== uid) return;
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
    ${classroom ? APP_TOOLS.map(t => customizeRowHtml('tools', t)).join('') : '<p class="cust-note">فعّل قسم "إدارة الصف" لاختيار أدواته.</p>'}`;
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

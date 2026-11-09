/* ============================================================
   الأدوات — مكان لأدوات قليلة الاستعمال (اليوم: الاستبانات؛ وأي أداة قادمة تُضاف هنا ببلاطتها)
   ------------------------------------------------------------
   - الدخول: «🧰 الأدوات» بقائمة الحساب (لا بلاطة بالرئيسية ولا تبويب سفلي: الاستعمال مرة أو مرتين بالسنة).
   - toolsView شاشة رئيسية كاملة: showTools() تستدعي hideAllMainViews() وتُظهر حاويتها صراحةً (CLAUDE.md §2)،
     ومسجَّلة بـhideAllMainViews وTOP_TITLE_VIEWS؛ التنقل بين «الأدوات / الاستبانات / استبانة جديدة» داخل الحاوية نفسها.
   - الاستبانات مصنّفة بجهتها (أولياء الأمور / الطلاب / مخصّصة)، وكل استبانة بلاطة طويلة صغيرة، والمعلم يرتّبها بنفسه
     (survey_campaigns.sort_order، بحسابه وحده) بسهمين ▲▼ داخل تصنيفها.
   - كل استبانة مستقلة: عنوان، جهة واحدة، شعب مختارة، وأسئلتها محفوظة داخلها (لقطة من القالب الجاهز).
   - كل استعلام بتصفية .eq('teacher_id') صريحة (RLS وحدها لا تكفي بالشاشات الشخصية).
   - تفاصيل الاستبانة (الإرسال والنتائج) بنافذة ملء الشاشة: app-44-satisfaction.js.
   ============================================================ */

const TOOLS_AUDIENCES = {
  guardian: { label: 'أولياء الأمور', group: 'لأولياء الأمور', color: '#1B3245', template: 'guardian_v1', who: 'أولياء الأمور', to: 'لأولياء الأمور' },
  student: { label: 'الطلاب', group: 'للطلاب', color: '#876A25', template: 'student_v1', who: 'الطلاب', to: 'للطلاب' },
  custom: { label: 'مخصّصة', group: 'مخصّصة', color: '#2A7048', template: 'blank', who: 'المحدَّدين', to: 'للمحدَّدين' }
};
const TOOLS_DAYS = [7, 14, 30];
const TOOLS_SECTION_FORMS = { one: 'شعبة واحدة', two: 'شعبتان', few: '{n} شعب', many: '{n} شعبة' };

let toolsState = { screen: 'home', filter: 'all', sorting: false, busy: false, loading: false, list: null, create: null, token: 0 };

/* ============ دوال صرفة ============ */

/* التصنيفات بالترتيب الثابت، وداخل كل تصنيف حسب sort_order ثم الأحدث */
function toolsGroupCampaigns(campaigns){
  const sorted = campaigns.slice().sort((a, b) => (a.sort_order - b.sort_order) || String(b.created_at).localeCompare(String(a.created_at)));
  return ['guardian', 'student', 'custom'].map(k => ({ key: k, items: sorted.filter(c => c.audience === k) })).filter(g => g.items.length);
}

/* تحريك استبانة خطوة داخل تصنيفها: يُرجع ترتيب كل الاستبانات الجديد كمصفوفة معرّفات، أو null إن لم يمكن */
function toolsMoveInOrder(campaigns, id, dir){
  const groups = toolsGroupCampaigns(campaigns);
  const g = groups.find(x => x.items.some(c => c.id === id));
  if(!g) return null;
  const i = g.items.findIndex(c => c.id === id), j = i + dir;
  if(j < 0 || j >= g.items.length) return null;
  const ids = g.items.map(c => c.id);
  const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  g.items = ids.map(x => g.items.find(c => c.id === x));
  return groups.reduce((all, x) => all.concat(x.items.map(c => c.id)), []);
}

/* عدد الروابط المتوقعة: طلاب نشطون بالشعب المختارة لهم رقم الجهة */
function toolsExpectedLinks(students, sectionIds, audience){
  const set = new Set(sectionIds);
  return students.filter(s => s.is_active !== false && set.has(s.section_id) && (audience === 'student' ? s.student_phone : s.guardian_phone)).length;
}

function toolsDefaultTitle(audience){
  const t = typeof SURVEY_READY_TEMPLATES === 'object' ? SURVEY_READY_TEMPLATES[(TOOLS_AUDIENCES[audience] || TOOLS_AUDIENCES.guardian).template] : null;
  return t && t.title ? t.title : 'استبانة جديدة';
}

function toolsCampaignMeta(c, stats){
  const st = stats[c.id] || { sections: 0, total: 0, answered: 0 };
  const secs = st.sections ? arabicCountPhrase(st.sections, TOOLS_SECTION_FORMS) : 'بلا شعب';
  return secs + ' · ' + (st.total ? `ردّ ${st.answered} من ${st.total}` : 'لم يُرسل بعد');
}

/* ============ الدخول والتنقل ============ */

function showTools(screen){
  hideAllMainViews();
  setActiveBottomTab(null);
  document.getElementById('toolsView').style.display = 'block';
  toolsState.token++;
  toolsState.sorting = false;
  toolsGo(screen === 'surveys' ? 'list' : 'home');
}

function toolsGo(screen){
  toolsState.token++;
  toolsState.screen = screen;
  toolsState.sorting = false;
  if(screen === 'list') toolsLoadList();
  else if(screen === 'create') toolsInitCreate();
  else renderTools();
}

/* الرجوع من قائمة الاستبانات (يُستدعى من تفاصيل الاستبانة بعد إغلاقها لتتحدّث الأعداد) */
function toolsRefreshIfVisible(){
  const v = document.getElementById('toolsView');
  if(v && v.style.display === 'block' && toolsState.screen === 'list') toolsLoadList();
}

function toolsStillHere(token, screen){
  const v = document.getElementById('toolsView');
  return !!v && v.style.display === 'block' && toolsState.token === token && toolsState.screen === screen;
}

/* ============ التحميل ============ */

async function toolsLoadList(){
  const token = toolsState.token;
  toolsState.loading = true;
  renderTools();
  const uid = currentUser.id;
  try{
    const [camps, secs, invs] = await Promise.all([
      sb.from('survey_campaigns').select('id, title, audience, status, closes_at, sort_order, min_results, created_at').eq('teacher_id', uid).order('sort_order', { ascending: true }),
      fetchAllRows((from, to) => sb.from('survey_campaign_sections').select('campaign_id, section_id').eq('teacher_id', uid).order('campaign_id', { ascending: true }).range(from, to)),
      fetchAllRows((from, to) => sb.from('survey_invites').select('id, campaign_id, answered_on').eq('teacher_id', uid).order('id', { ascending: true }).range(from, to))
    ]);
    if(camps.error) throw camps.error;
    if(secs.error) throw secs.error;
    if(invs.error) throw invs.error;
    if(!toolsStillHere(token, 'list')) return;
    const stats = {};
    const stat = id => (stats[id] = stats[id] || { sections: 0, total: 0, answered: 0 });
    (secs.data || []).forEach(r => { stat(r.campaign_id).sections++; });
    (invs.data || []).forEach(r => { const s = stat(r.campaign_id); s.total++; if(r.answered_on) s.answered++; });
    toolsState.list = { campaigns: camps.data || [], stats };
  } catch(err){
    if(!toolsStillHere(token, 'list')) return;
    toolsState.list = toolsState.list || { campaigns: [], stats: {} };
    showToast('تعذّر تحميل الاستبانات: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  } finally {
    if(toolsStillHere(token, 'list')){ toolsState.loading = false; renderTools(); }
  }
}

/* الشعب والطلاب لازمان للإنشاء وللتفاصيل، وقد لا يكونان محمَّلين إن لم تُفتح إدارة الصف بهذه الجلسة */
async function toolsEnsureStructure(){
  await Promise.all([loadCrmGradesAndSections(), loadCrmStudents()]);
}

/* ============ الرسم ============ */

function toolsSetTitle(t){
  const h = document.getElementById('toolsTitle');
  if(h) h.textContent = t;
  if(typeof syncTopTitle === 'function') syncTopTitle();
}

function toolsBackLink(label, target){
  return `<button type="button" class="tl-back" onclick="toolsGo('${target}')"><span aria-hidden="true">›</span> ${escapeHtml(label)}</button>`;
}

function renderTools(){
  const body = document.getElementById('toolsBody');
  if(!body) return;
  const s = toolsState.screen;
  if(s === 'list'){ toolsSetTitle('الاستبانات'); body.innerHTML = toolsListHtml(); }
  else if(s === 'create'){ toolsSetTitle('استبانة جديدة'); body.innerHTML = toolsCreateHtml(); }
  else { toolsSetTitle('الأدوات'); body.innerHTML = toolsHomeHtml(); }
}

function toolsHomeHtml(){
  return `<div class="home-actions">
    <button class="home-btn" style="grid-column:1/-1;" onclick="toolsGo('list')">
      <span class="hb-title">📊 الاستبانات</span>
      <span class="hb-sub">رضا أولياء الأمور والطلاب</span>
    </button>
  </div>
  <p class="tl-note">أي أداة جديدة تُضاف هنا لاحقًا ببلاطة خاصة بها.</p>`;
}

function toolsListHtml(){
  const st = toolsState;
  if(st.loading && !st.list) return toolsBackLink('الأدوات', 'home') + '<div class="sv-empty">جارٍ التحميل…</div>';
  const list = st.list || { campaigns: [], stats: {} };
  const groups = toolsGroupCampaigns(list.campaigns);
  const counts = { all: list.campaigns.length, guardian: 0, student: 0, custom: 0 };
  list.campaigns.forEach(c => { if(counts[c.audience] != null) counts[c.audience]++; });
  const tabs = [['all', 'الكل']].concat(['guardian', 'student', 'custom'].filter(k => k !== 'custom' || counts.custom).map(k => [k, TOOLS_AUDIENCES[k].label]));
  const filter = tabs.some(t => t[0] === st.filter) ? st.filter : 'all';
  const tabsHtml = `<div class="tl-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" aria-selected="${filter === t[0]}" class="tl-tab${filter === t[0] ? ' is-on' : ''}" onclick="toolsSetFilter('${t[0]}')">${escapeHtml(t[1])} <span>${counts[t[0]]}</span></button>`).join('')}</div>`;
  const shown = groups.filter(g => filter === 'all' || g.key === filter);
  let body;
  if(!list.campaigns.length){
    body = `<div class="sv-card sv-center"><div class="sv-ico" aria-hidden="true">★</div><h2>لا توجد استبانات بعد</h2><p>أنشئ استبانة لأولياء الأمور أو للطلاب، وتصلك نتائجها تلقائيًا.</p></div>`;
  } else {
    body = shown.map(g => `<div class="tl-group"><div class="tl-group-head" style="color:${TOOLS_AUDIENCES[g.key].color}"><i style="background:${TOOLS_AUDIENCES[g.key].color}"></i>${escapeHtml(TOOLS_AUDIENCES[g.key].group)}<span>${g.items.length}</span></div>${g.items.map((c, i) => toolsTileHtml(c, list.stats, g, i)).join('')}</div>`).join('');
  }
  const sortBtn = list.campaigns.length > 1 ? `<button type="button" class="btn btn-outline tl-sort" onclick="toolsToggleSort()"${st.busy ? ' disabled' : ''}>${st.sorting ? 'تم' : 'ترتيب'}</button>` : '';
  return `${toolsBackLink('الأدوات', 'home')}${tabsHtml}${st.sorting ? '<div class="tl-hint">حرّك الاستبانة بالسهمين داخل تصنيفها، ثم اضغط «تم».</div>' : ''}${body}
    <div class="tl-actions"><button type="button" class="btn btn-primary tl-new" onclick="toolsGo('create')">＋ استبانة جديدة</button>${sortBtn}</div>`;
}

function toolsTileHtml(c, stats, group, idx){
  const color = TOOLS_AUDIENCES[c.audience] ? TOOLS_AUDIENCES[c.audience].color : '#6B6659';
  const open = svCampaignOpen(c);
  const chip = `<span class="tl-chip ${open ? 'is-open' : 'is-closed'}">${open ? 'مفتوحة' : 'مغلقة'}</span>`;
  const main = `<span class="tl-tile-main"><b>${escapeHtml(c.title)}</b><small>${escapeHtml(toolsCampaignMeta(c, stats))}</small></span>`;
  if(toolsState.sorting){
    return `<div class="tl-tile is-sorting" style="border-right-color:${color}">${main}
      <button type="button" class="tl-mv" aria-label="للأعلى" onclick="toolsMove('${escapeHtml(c.id)}',-1)"${idx === 0 || toolsState.busy ? ' disabled' : ''}>▲</button>
      <button type="button" class="tl-mv" aria-label="للأسفل" onclick="toolsMove('${escapeHtml(c.id)}',1)"${idx === group.items.length - 1 || toolsState.busy ? ' disabled' : ''}>▼</button></div>`;
  }
  return `<button type="button" class="tl-tile" style="border-right-color:${color}" onclick="openSurvey('${escapeHtml(c.id)}')">${main}${chip}<span class="tl-chev" aria-hidden="true">‹</span></button>`;
}

function toolsSetFilter(f){ toolsState.filter = f; renderTools(); }
function toolsToggleSort(){ if(toolsState.busy) return; toolsState.sorting = !toolsState.sorting; renderTools(); }

/* ============ الترتيب (يُحفظ بحساب المعلم وحده) ============ */

async function toolsMove(id, dir){
  const st = toolsState;
  if(st.busy || !st.list) return;
  const order = toolsMoveInOrder(st.list.campaigns, id, dir);
  if(!order) return;
  const token = st.token;
  st.busy = true;
  const before = st.list.campaigns.map(c => ({ id: c.id, sort_order: c.sort_order }));
  const changed = [];
  order.forEach((cid, i) => { const c = st.list.campaigns.find(x => x.id === cid); if(c && c.sort_order !== i){ changed.push({ id: cid, sort_order: i }); c.sort_order = i; } });
  renderTools();
  try{
    const results = await Promise.all(changed.map(r => sb.from('survey_campaigns').update({ sort_order: r.sort_order }).eq('teacher_id', currentUser.id).eq('id', r.id)));
    const bad = results.find(r => r && r.error);
    if(bad) throw bad.error;
  } catch(err){
    /* فشل الحفظ: نرجع الترتيب كما كان بدل أن يبدو محفوظًا وهو ليس كذلك */
    if(st.list) before.forEach(b => { const c = st.list.campaigns.find(x => x.id === b.id); if(c) c.sort_order = b.sort_order; });
    showToast('تعذّر حفظ الترتيب: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  } finally {
    st.busy = false;
    if(toolsStillHere(token, 'list')) renderTools();
  }
}

/* ============ إنشاء استبانة ============ */

async function toolsInitCreate(){
  const token = toolsState.token;
  toolsState.create = { audience: 'guardian', title: toolsDefaultTitle('guardian'), titleTouched: false, sectionIds: new Set(), days: 14, loading: true };
  renderTools();
  try{
    await toolsEnsureStructure();
  } catch(err){
    showToast('تعذّر تحميل الشعب: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  }
  if(!toolsStillHere(token, 'create')) return;
  toolsState.create.loading = false;
  /* الافتراضي: كل شعبي */
  crmSections.forEach(s => toolsState.create.sectionIds.add(s.id));
  renderTools();
}

function toolsCreateHtml(){
  const c = toolsState.create;
  if(!c || c.loading) return toolsBackLink('الاستبانات', 'list') + '<div class="sv-empty">جارٍ التحميل…</div>';
  if(!crmSections.length) return toolsBackLink('الاستبانات', 'list') + `<div class="sv-card sv-center"><h2>لا شعب بعد</h2><p>أضف شعبك وطلابك من «إدارة الصف» أولًا، ثم أنشئ الاستبانة.</p></div>`;
  const who = ['guardian', 'student'].map(k => {
    const on = c.audience === k, a = TOOLS_AUDIENCES[k];
    return `<button type="button" class="tl-opt${on ? ' is-on' : ''}" aria-pressed="${on}" onclick="toolsPickAudience('${k}')"><b>${escapeHtml(a.label)}</b><small>${k === 'guardian' ? 'أسئلة بصيغة «ابنكم»' : 'أسئلة بصيغة «أنت»'}</small></button>`;
  }).join('');
  const allOn = crmSections.every(s => c.sectionIds.has(s.id));
  const secs = `<button type="button" class="tl-chip-btn${allOn ? ' is-on' : ''}" aria-pressed="${allOn}" onclick="toolsToggleAllSections()">كل شعبي</button>` + crmSections.slice().sort((a, b) => crmByArabic(crmSectionOptionLabel(a), crmSectionOptionLabel(b))).map(s => {
    const on = c.sectionIds.has(s.id);
    return `<button type="button" class="tl-chip-btn${on ? ' is-on' : ''}" aria-pressed="${on}" onclick="toolsToggleSection('${escapeHtml(s.id)}')">${escapeHtml(crmSectionOptionLabel(s))}</button>`;
  }).join('');
  const days = TOOLS_DAYS.map(d => `<button type="button" class="tl-day${c.days === d ? ' is-on' : ''}" aria-pressed="${c.days === d}" onclick="toolsPickDays(${d})">${d === 7 ? '7 أيام' : d + ' يومًا'}</button>`).join('');
  const links = toolsExpectedLinks(crmStudents, [...c.sectionIds], c.audience);
  const qn = (SURVEY_READY_TEMPLATES[TOOLS_AUDIENCES[c.audience].template] || { questions: [] }).questions.length;
  const ready = c.sectionIds.size > 0 && c.title.trim().length > 0 && !c.busy;
  return `${toolsBackLink('الاستبانات', 'list')}
    <div class="tl-field"><label for="toolsTitleInput">اسم الاستبانة</label><input id="toolsTitleInput" class="goal-input" type="text" maxlength="${SURVEY_LIMITS.maxTitle}" value="${escapeHtml(c.title)}" oninput="toolsSetTitleText(this.value)"></div>
    <div class="tl-field"><span class="tl-label">لمن؟</span><div class="tl-opts">${who}</div></div>
    <div class="tl-field"><span class="tl-label">الشعب</span><div class="tl-chips">${secs}</div></div>
    <div class="tl-field"><span class="tl-label">الأسئلة</span><div class="tl-info"><b>${qn} أسئلة جاهزة</b><small>تقييم، صح/خطأ، اختيار، وتعليق حر — بصيغة ${escapeHtml(TOOLS_AUDIENCES[c.audience].who)}</small></div></div>
    <div class="tl-field"><span class="tl-label">ينتهي الرابط بعد</span><div class="tl-days">${days}</div></div>
    <button type="button" class="btn btn-primary tl-create" id="toolsCreateBtn" onclick="toolsCreate()"${ready ? '' : ' disabled'}>إنشاء الاستبانة</button>
    <p class="tl-note">${links} ${links === 1 ? 'رابط' : 'روابط'} ${escapeHtml(TOOLS_AUDIENCES[c.audience].to)} بالشعب المختارة · لا يُرسل شيء حتى تضغط واتساب بنفسك</p>`;
}

function toolsSetTitleText(v){
  const c = toolsState.create; if(!c) return;
  c.title = String(v).slice(0, SURVEY_LIMITS.maxTitle);
  c.titleTouched = true;
  const btn = document.getElementById('toolsCreateBtn');
  if(btn) btn.disabled = !(c.sectionIds.size > 0 && c.title.trim().length > 0 && !c.busy);
}
function toolsPickAudience(k){
  const c = toolsState.create; if(!c || !TOOLS_AUDIENCES[k]) return;
  c.audience = k;
  if(!c.titleTouched) c.title = toolsDefaultTitle(k);
  renderTools();
}
function toolsToggleSection(id){
  const c = toolsState.create; if(!c) return;
  if(c.sectionIds.has(id)) c.sectionIds.delete(id); else c.sectionIds.add(id);
  renderTools();
}
function toolsToggleAllSections(){
  const c = toolsState.create; if(!c) return;
  if(crmSections.every(s => c.sectionIds.has(s.id))) c.sectionIds.clear(); else crmSections.forEach(s => c.sectionIds.add(s.id));
  renderTools();
}
function toolsPickDays(d){ const c = toolsState.create; if(!c || TOOLS_DAYS.indexOf(d) < 0) return; c.days = d; renderTools(); }

async function toolsCreate(){
  const c = toolsState.create;
  if(!c || c.busy || !currentUser) return;
  const title = c.title.trim();
  if(!title || !c.sectionIds.size || !TOOLS_AUDIENCES[c.audience]) return;
  const token = toolsState.token;
  const tpl = SURVEY_READY_TEMPLATES[TOOLS_AUDIENCES[c.audience].template];
  const secIds = [...c.sectionIds].filter(id => crmSections.some(s => s.id === id));
  if(!tpl || !secIds.length) return;
  c.busy = true;
  const btn = document.getElementById('toolsCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الإنشاء…'; }
  const uid = currentUser.id;
  let createdId = null;
  try{
    const { data, error } = await sb.from('survey_campaigns').insert({
      teacher_id: uid, title, audience: c.audience, template: TOOLS_AUDIENCES[c.audience].template,
      questions: JSON.parse(JSON.stringify(tpl.questions)),
      closes_at: new Date(Date.now() + c.days * 86400000).toISOString(),
      sort_order: -Math.floor(Date.now() / 60000) /* الأحدث يتصدّر تصنيفه، والمعلم يعيد ترتيبه كما يشاء */
    }).select('id').single();
    if(error) throw error;
    createdId = data.id;
    const ins = await sb.from('survey_campaign_sections').insert(secIds.map(sid => ({ teacher_id: uid, campaign_id: createdId, section_id: sid })));
    if(ins.error) throw ins.error;
  } catch(err){
    /* استبانة بلا شعب لا تنفع: نزيلها بدل تركها يتيمة (لا ردود عليها بعد) */
    if(createdId) await sb.from('survey_campaigns').delete().eq('teacher_id', uid).eq('id', createdId);
    c.busy = false;
    showToast('تعذّر إنشاء الاستبانة: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    if(toolsStillHere(token, 'create')) renderTools();
    return;
  }
  c.busy = false;
  /* السباق: لو غادر المعلم الشاشة أثناء الإنشاء لا نفتح له نافذة فجأة، والاستبانة تظهر بقائمته */
  if(!toolsStillHere(token, 'create')) return;
  toolsGo('list');
  openSurvey(createdId);
}

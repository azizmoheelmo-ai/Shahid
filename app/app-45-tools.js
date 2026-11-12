/* ============================================================
   الأدوات — مكان لأدوات قليلة الاستعمال (اليوم: الاستبانات ومتابعة المؤشرات app-50؛ وأي أداة قادمة تُضاف هنا ببلاطتها)
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

/* نقل استبانة إلى موضع داخل تصنيفها: يُرجع ترتيب كل الاستبانات الجديد كمصفوفة معرّفات، أو null إن لم يتغيّر شيء */
function toolsReorderInOrder(campaigns, id, toIdx){
  const groups = toolsGroupCampaigns(campaigns);
  const g = groups.find(x => x.items.some(c => c.id === id));
  if(!g) return null;
  const i = g.items.findIndex(c => c.id === id);
  const j = Math.max(0, Math.min(g.items.length - 1, toIdx));
  if(!(j >= 0) || j === i) return null;
  const ids = g.items.map(c => c.id);
  ids.splice(i, 1); ids.splice(j, 0, id);
  g.items = ids.map(x => g.items.find(c => c.id === x));
  return groups.reduce((all, x) => all.concat(x.items.map(c => c.id)), []);
}

/* تحريك استبانة خطوة (سهم ▲▼) */
function toolsMoveInOrder(campaigns, id, dir){
  const g = toolsGroupCampaigns(campaigns).find(x => x.items.some(c => c.id === id));
  if(!g) return null;
  const i = g.items.findIndex(c => c.id === id), j = i + dir;
  if(j < 0 || j >= g.items.length) return null;
  return toolsReorderInOrder(campaigns, id, j);
}

/* موضع الإفلات: عدد منتصفات البلاطات الأخرى (بترتيبها) الواقعة فوق المؤشر */
function toolsDropIndex(otherMids, y){
  let n = 0;
  otherMids.forEach(m => { if(m < y) n++; });
  return n;
}

/* عدد الروابط المتوقعة: طلاب نشطون بالشعب المختارة لهم رقم الجهة */
function toolsExpectedLinks(students, sectionIds, audience){
  const set = new Set(sectionIds);
  return students.filter(s => s.is_active !== false && set.has(s.section_id) && (audience === 'student' ? s.student_phone : s.guardian_phone)).length;
}

/* أسئلة القالب الجاهز للجهة (نسخة عميقة؛ المخصّصة تبدأ فارغة) */
function toolsReadyQuestions(audience){
  const t = typeof SURVEY_READY_TEMPLATES === 'object' ? SURVEY_READY_TEMPLATES[(TOOLS_AUDIENCES[audience] || TOOLS_AUDIENCES.guardian).template] : null;
  return t ? JSON.parse(JSON.stringify(t.questions)) : [];
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
  if(screen === 'list' || screen === 'home'){ toolsState.create = null; toolsState.qed = null; toolsState.recipsUi = null; toolsState.addR = null; }
  if(typeof lfResetScreen === 'function') lfResetScreen(screen); /* متابعة المؤشرات (app-50) */
  if(screen === 'leaders') lfLoadList();
  else if(screen === 'list') toolsLoadList();
  else if(screen === 'create' && !toolsState.create) toolsInitCreate(); /* العودة من المحرّر/المستلمين تُبقي حالة الإنشاء */
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
  else if(s === 'questions'){ toolsSetTitle('أسئلة الاستبانة'); body.innerHTML = toolsQuestionsHtml(); }
  else if(s === 'qedit'){ toolsSetTitle('سؤال'); body.innerHTML = toolsQeditHtml(); }
  else if(s === 'recips'){ toolsSetTitle('المستلمون'); body.innerHTML = toolsRecipsHtml(); }
  else if(s === 'leaders' || s === 'lcreate' || s === 'ldetail') lfRender(s);
  else { toolsSetTitle('الأدوات'); body.innerHTML = toolsHomeHtml(); }
}

function toolsHomeHtml(){
  /* هوية الأدوات الموحّدة (tlx-): بطاقتان بأيقونة خطية؛ شارة المتابعة = إجابات لم تُشاهَد (refreshLeaderBadge) */
  const n = typeof lfState === 'object' && lfState.unseen > 0 ? lfState.unseen : 0;
  return `<div class="tlx-grid">
    <button type="button" class="tlx-card" onclick="toolsGo('list')">
      <span class="tlx-card-top"><span class="tlx-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></span></span>
      <b>الاستبانات</b><small>رضا أولياء الأمور والطلاب</small>
    </button>
    <button type="button" class="tlx-card" onclick="toolsGo('leaders')">
      <span class="tlx-card-top"><span class="tlx-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg></span><span class="tlx-pill is-red" id="lfHomeBadge" title="إجابات جديدة" style="display:${n ? 'inline-flex' : 'none'};">${n > 9 ? '9+' : n}</span></span>
      <b>متابعة المؤشرات</b><small>مؤشرات المدير والوكلاء بروابط مؤقتة ومواعيد لقاء</small>
    </button>
  </div>
  <p class="tlx-foot">أي أداة جديدة تُضاف هنا لاحقًا ببطاقة خاصة بها.</p>`;
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
  return `${toolsBackLink('الأدوات', 'home')}${tabsHtml}${st.sorting ? '<div class="tl-hint">اسحب ⠿ (أو استخدم السهمين) داخل تصنيف الاستبانة، ثم اضغط «تم».</div>' : ''}${body}
    <div class="tl-actions"><button type="button" class="btn btn-primary tl-new" onclick="toolsGo('create')">＋ استبانة جديدة</button>${sortBtn}</div>`;
}

function toolsTileHtml(c, stats, group, idx){
  const color = TOOLS_AUDIENCES[c.audience] ? TOOLS_AUDIENCES[c.audience].color : '#6B6659';
  const open = svCampaignOpen(c);
  const chip = `<span class="tl-chip ${open ? 'is-open' : 'is-closed'}">${open ? 'مفتوحة' : 'مغلقة'}</span>`;
  const main = `<span class="tl-tile-main"><b>${escapeHtml(c.title)}</b><small>${escapeHtml(toolsCampaignMeta(c, stats))}</small></span>`;
  if(toolsState.sorting){
    return `<div class="tl-tile is-sorting" data-tid="${escapeHtml(c.id)}" style="border-right-color:${color}"><span class="tl-grip" role="button" aria-label="اسحب لإعادة الترتيب" onpointerdown="toolsDragStart(event,'${escapeHtml(c.id)}')">⠿</span>${main}
      <button type="button" class="tl-mv" aria-label="للأعلى" onclick="toolsMove('${escapeHtml(c.id)}',-1)"${idx === 0 || toolsState.busy ? ' disabled' : ''}>▲</button>
      <button type="button" class="tl-mv" aria-label="للأسفل" onclick="toolsMove('${escapeHtml(c.id)}',1)"${idx === group.items.length - 1 || toolsState.busy ? ' disabled' : ''}>▼</button></div>`;
  }
  return `<button type="button" class="tl-tile" style="border-right-color:${color}" onclick="openSurvey('${escapeHtml(c.id)}')">${main}${chip}<span class="tl-chev" aria-hidden="true">‹</span></button>`;
}

function toolsSetFilter(f){ toolsState.filter = f; renderTools(); }
function toolsToggleSort(){ if(toolsState.busy) return; toolsState.sorting = !toolsState.sorting; renderTools(); }

/* ============ الترتيب (يُحفظ بحساب المعلم وحده) ============ */

function toolsMove(id, dir){
  const st = toolsState;
  if(st.busy || !st.list) return;
  return toolsCommitOrder(toolsMoveInOrder(st.list.campaigns, id, dir));
}

/* سحب وإفلات: المقبض ⠿ وحده يلتقط المؤشر (يعمل باللمس والفأرة)، ولا يُحفظ إلا عند الإفلات */
let toolsDrag = null;
function toolsDragStart(e, id){
  const st = toolsState;
  if(st.busy || toolsDrag || !st.list || !e.currentTarget) return;
  const tile = e.currentTarget.closest ? e.currentTarget.closest('.tl-tile') : null;
  if(!tile || !tile.parentNode) return;
  const group = Array.prototype.slice.call(tile.parentNode.querySelectorAll('.tl-tile'));
  if(group.length < 2) return;
  if(e.preventDefault) e.preventDefault();
  try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){}
  toolsDrag = { id, tile, group, y0: e.clientY, grip: e.currentTarget, pid: e.pointerId, token: st.token };
  tile.classList.add('is-dragging');
  const g = toolsDrag.grip;
  g.onpointermove = toolsDragMove; g.onpointerup = ev => toolsDragEnd(ev, true); g.onpointercancel = ev => toolsDragEnd(ev, false);
}
function toolsDragMove(e){
  const d = toolsDrag; if(!d) return;
  d.tile.style.transform = 'translateY(' + (e.clientY - d.y0) + 'px)';
}
function toolsDragEnd(e, drop){
  const d = toolsDrag; if(!d) return;
  toolsDrag = null;
  d.grip.onpointermove = d.grip.onpointerup = d.grip.onpointercancel = null;
  d.tile.classList.remove('is-dragging'); d.tile.style.transform = '';
  if(!drop || !toolsStillHere(d.token, 'list') || toolsState.busy || !toolsState.list) return;
  const others = d.group.filter(t => t !== d.tile).map(t => { const r = t.getBoundingClientRect(); return r.top + r.height / 2; });
  toolsCommitOrder(toolsReorderInOrder(toolsState.list.campaigns, d.id, toolsDropIndex(others, e.clientY)));
}

async function toolsCommitOrder(order){
  const st = toolsState;
  if(st.busy || !st.list || !order) return;
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
  toolsState.create = { audience: 'guardian', title: toolsDefaultTitle('guardian'), titleTouched: false, sectionIds: new Set(), days: 14, loading: true,
    questions: toolsReadyQuestions('guardian'), qTouched: false, recips: { students: {}, others: [] } };
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

/* جاهزية الإنشاء: عنوان وأسئلة صالحة، والمستلمون: شعب مختارة (أولياء الأمور/الطلاب) أو روابط محدَّدة (المخصّصة) */
function toolsCreateReady(c){
  if(!c || c.busy || !c.title.trim().length) return false;
  if(!surveyValidateQuestions(c.questions).ok) return false;
  return c.audience === 'custom' ? toolsRecipCount(c.recips, crmStudents).links > 0 : c.sectionIds.size > 0;
}

function toolsCreateHtml(){
  const c = toolsState.create;
  if(!c || c.loading) return toolsBackLink('الاستبانات', 'list') + '<div class="sv-empty">جارٍ التحميل…</div>';
  const custom = c.audience === 'custom';
  if(!custom && !crmSections.length) return toolsBackLink('الاستبانات', 'list') + `<div class="sv-card sv-center"><h2>لا شعب بعد</h2><p>أضف شعبك وطلابك من «إدارة الصف» أولًا، أو أنشئ استبانة مخصّصة تختار مستلميها بنفسك.</p><button type="button" class="btn btn-outline" onclick="toolsPickAudience('custom')">استبانة مخصّصة</button></div>`;
  const hints = { guardian: 'أسئلة بصيغة «ابنكم»', student: 'أسئلة بصيغة «أنت»', custom: 'بأسئلتك ومستلميك' };
  const who = ['guardian', 'student', 'custom'].map(k => {
    const on = c.audience === k, a = TOOLS_AUDIENCES[k];
    return `<button type="button" class="tl-opt${on ? ' is-on' : ''}" aria-pressed="${on}" onclick="toolsPickAudience('${k}')"><b>${escapeHtml(a.label)}</b><small>${hints[k]}</small></button>`;
  }).join('');
  const allOn = crmSections.every(s => c.sectionIds.has(s.id));
  const secs = `<button type="button" class="tl-chip-btn${allOn ? ' is-on' : ''}" aria-pressed="${allOn}" onclick="toolsToggleAllSections()">كل شعبي</button>` + crmSections.slice().sort((a, b) => crmByArabic(crmSectionOptionLabel(a), crmSectionOptionLabel(b))).map(s => {
    const on = c.sectionIds.has(s.id);
    return `<button type="button" class="tl-chip-btn${on ? ' is-on' : ''}" aria-pressed="${on}" onclick="toolsToggleSection('${escapeHtml(s.id)}')">${escapeHtml(crmSectionOptionLabel(s))}</button>`;
  }).join('');
  const days = TOOLS_DAYS.map(d => `<button type="button" class="tl-day${c.days === d ? ' is-on' : ''}" aria-pressed="${c.days === d}" onclick="toolsPickDays(${d})">${d === 7 ? '7 أيام' : d + ' يومًا'}</button>`).join('');
  const qn = c.questions.length;
  const qInfo = `<button type="button" class="tl-info tl-info-btn" onclick="toolsEditQuestions('create')"><span><b>${qn ? qn + ' ' + (qn === 1 ? 'سؤال' : 'أسئلة') : 'لا أسئلة بعد'}</b><small>${qn ? (c.qTouched ? 'عدّلتها بنفسك' : 'جاهزة بصيغة ' + escapeHtml(TOOLS_AUDIENCES[c.audience].who) + '، تعدّلها كما تشاء') : 'أضف سؤالك الأول'}</small></span><span class="tl-edit">تعديل ‹</span></button>`;
  let target, note;
  if(custom){
    const cnt = toolsRecipCount(c.recips, crmStudents);
    target = `<div class="tl-field"><span class="tl-label">المستلمون</span><button type="button" class="tl-info tl-info-btn" onclick="toolsEditRecips()"><span><b>${cnt.links ? cnt.links + ' ' + (cnt.links === 1 ? 'رابط' : 'روابط') : 'اختر المستلمين'}</b><small>${cnt.links ? cnt.students + ' ' + (cnt.students === 1 ? 'طالب' : 'طلاب') + ' · ' + cnt.others + ' ' + (cnt.others === 1 ? 'جهة أخرى' : 'جهات أخرى') : 'طلاب بأعينهم أو جهات أخرى بالاسم والرقم'}</small></span><span class="tl-edit">اختيار ‹</span></button></div>`;
    note = `${cnt.links} ${cnt.links === 1 ? 'رابط' : 'روابط'} · تظهر النتائج من أول ردّ، وتُنبَّه صفحة المستفيد أن العدد قليل · لا يُرسل شيء حتى تضغط واتساب بنفسك`;
  } else {
    const links = toolsExpectedLinks(crmStudents, [...c.sectionIds], c.audience);
    target = `<div class="tl-field"><span class="tl-label">الشعب</span><div class="tl-chips">${secs}</div></div>`;
    note = `${links} ${links === 1 ? 'رابط' : 'روابط'} ${escapeHtml(TOOLS_AUDIENCES[c.audience].to)} بالشعب المختارة · لا يُرسل شيء حتى تضغط واتساب بنفسك`;
  }
  return `${toolsBackLink('الاستبانات', 'list')}
    <div class="tl-field"><label for="toolsTitleInput">اسم الاستبانة</label><input id="toolsTitleInput" class="goal-input" type="text" maxlength="${SURVEY_LIMITS.maxTitle}" value="${escapeHtml(c.title)}" oninput="toolsSetTitleText(this.value)"></div>
    <div class="tl-field"><span class="tl-label">لمن؟</span><div class="tl-opts tl-opts3">${who}</div></div>
    ${target}
    <div class="tl-field"><span class="tl-label">الأسئلة</span>${qInfo}</div>
    <div class="tl-field"><span class="tl-label">ينتهي الرابط بعد</span><div class="tl-days">${days}</div></div>
    <button type="button" class="btn btn-primary tl-create" id="toolsCreateBtn" onclick="toolsCreate()"${toolsCreateReady(c) ? '' : ' disabled'}>إنشاء الاستبانة</button>
    <p class="tl-note">${note}</p>`;
}

function toolsSetTitleText(v){
  const c = toolsState.create; if(!c) return;
  c.title = String(v).slice(0, SURVEY_LIMITS.maxTitle);
  c.titleTouched = true;
  const btn = document.getElementById('toolsCreateBtn');
  if(btn) btn.disabled = !toolsCreateReady(c);
}
function toolsPickAudience(k){
  const c = toolsState.create; if(!c || !TOOLS_AUDIENCES[k]) return;
  c.audience = k;
  if(!c.titleTouched) c.title = toolsDefaultTitle(k);
  if(!c.qTouched) c.questions = toolsReadyQuestions(k); /* ما لم يعدّل المعلم الأسئلة بنفسه */
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
  if(!toolsCreateReady(c) || !TOOLS_AUDIENCES[c.audience]) return;
  const token = toolsState.token;
  const custom = c.audience === 'custom';
  const qv = surveyValidateQuestions(c.questions);
  if(!qv.ok){ showToast(toolsQuestionErrorText(qv.error), 'error'); return; }
  const secIds = custom ? [] : [...c.sectionIds].filter(id => crmSections.some(s => s.id === id));
  if(!custom && !secIds.length) return;
  const title = c.title.trim();
  c.busy = true;
  const btn = document.getElementById('toolsCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الإنشاء…'; }
  const uid = currentUser.id;
  let createdId = null;
  try{
    const { data, error } = await sb.from('survey_campaigns').insert({
      teacher_id: uid, title, audience: c.audience, template: TOOLS_AUDIENCES[c.audience].template,
      questions: qv.value,
      closes_at: new Date(Date.now() + c.days * 86400000).toISOString(),
      min_results: custom ? 1 : 5, /* المخصّصة: عدد المستلمين قليل غالبًا فتظهر النتائج من أول ردّ (وصفحة المستفيد تنبّه لذلك) */
      sort_order: -Math.floor(Date.now() / 60000) /* الأحدث يتصدّر تصنيفه، والمعلم يعيد ترتيبه كما يشاء */
    }).select('id').single();
    if(error) throw error;
    createdId = data.id;
    if(custom){
      const rows = toolsCustomInviteRows(c.recips, uid, createdId);
      if(rows.length){
        const ins = await sb.from('survey_invites').insert(rows);
        if(ins.error) throw ins.error;
      }
    } else {
      const ins = await sb.from('survey_campaign_sections').insert(secIds.map(sid => ({ teacher_id: uid, campaign_id: createdId, section_id: sid })));
      if(ins.error) throw ins.error;
    }
  } catch(err){
    /* استبانة بلا شعب/مستلمين لا تنفع: نزيلها بدل تركها يتيمة (لا ردود عليها بعد) */
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

/* تذاكر الاستبانة المخصّصة: طالب بجهة (ولي أمر/طالب) له رقمها، وجهة أخرى بالاسم والرقم */
function toolsCustomInviteRows(recips, uid, campaignId){
  const rows = [];
  Object.keys(recips.students).forEach(sid => {
    const st = crmStudents.find(s => s.id === sid);
    if(!st) return;
    const r = recips.students[sid];
    if(r.guardian && st.guardian_phone) rows.push({ teacher_id: uid, campaign_id: campaignId, student_id: sid, recipient: 'guardian', code: surveyNewCode() });
    if(r.student && st.student_phone) rows.push({ teacher_id: uid, campaign_id: campaignId, student_id: sid, recipient: 'student', code: surveyNewCode() });
  });
  recips.others.forEach(o => rows.push({ teacher_id: uid, campaign_id: campaignId, student_id: null, recipient: 'other', contact_label: o.label, contact_phone: o.phone, code: surveyNewCode() }));
  return rows;
}

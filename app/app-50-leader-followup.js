/* ============================================================
   متابعة مؤشرات القيادة (الأدوات) — شاشات المعلم  (التصميم: LEADER-FOLLOWUP.md)
   ------------------------------------------------------------
   - طلب متابعة لمسؤول (مدير/وكيل): مؤشرات يكتبها المعلم + أوقات لقاء مقترحة، برابط /f/<رمز> يُستعمل مرة واحدة
     (الصفحة العامة api/f.js). المسؤول يجيب: منفذ / قيد التنفيذ / لم ينفذ + السبب، ويختار موعدًا.
   - شاشات داخل toolsView (app-45): 'leaders' (القائمة) و'lcreate' (طلب جديد/الدورة التالية) و'ldetail' (التفاصيل والنتائج).
     التنقل بـtoolsGo(...) فتبقى الحاوية الرئيسية هي نفسها (CLAUDE.md §2).
   - كل استعلام بتصفية .eq('teacher_id', currentUser.id) صريحة (RLS وحدها لا تكفي).
   - المعلم لا يكتب الإجابة ولا الموعد ولا المسودة (صلاحيات أعمدة بالقاعدة)؛ وطلب أُجيب عنه لا يتغيّر.
   - الحذف (المجاب عنه وغيره) يمرّ بسلة المحذوفات 30 يومًا مع «تراجع» (DELETE-POLICY.md)، والرابط لا يعود صالحًا بالاسترجاع.
   - مسودة المسؤول (يحفظها من الرابط ليكمل لاحقًا): المعلم يرى تقدّمها فقط (كم مؤشرًا حُدّد) لا محتواها.
   - التنبيه بدرج الحساب: شارة على «الأدوات» + نقطة على دائرة الحساب = عدد إجابات لم تُشاهَد (seen_at).
   - الإرسال يدوي دائمًا: رابط واتساب حقيقي (<a href>) أو نسخ الرابط، ولا يُرسل شيء من الخادم.
   ============================================================ */

const LF_DAYS = [7, 14, 30];
const LF_CRIT_FORMS = { one: 'معيار واحد', two: 'معياران', few: '{n} معايير', many: '{n} معيارًا' };
const LF_STATUS_LABELS = { answered: 'أُجيب', sent: 'أُرسل', ready: 'لم يُرسل', expired: 'انتهت مدته', revoked: 'رابطه مُلغى' };
const LF_COLS = 'id, series_id, leader_role, leader_name, cycle_label, sender_name, indicators, slots, code, closes_at, sent_at, answered_at, seen_at, answers, chosen_slot, proposed_slot, proposed_note, draft, draft_saved_at, created_at';

let lfState = { list: null, templates: [], loading: false, sel: null, create: null, busy: false, meet: null, confirmed: null };

/* ============ دوال صرفة ============ */

/* حالة الطلب: أُجيب / مُلغى (بلا رابط) / منتهٍ / أُرسل / لم يُرسل */
function lfStatus(r, nowMs){
  if(r.answered_at) return 'answered';
  if(!r.code) return 'revoked';
  if(!(new Date(r.closes_at).getTime() > (nowMs == null ? Date.now() : nowMs))) return 'expired';
  return r.sent_at ? 'sent' : 'ready';
}

/* عدّ الحالات بين إجابات الطلب */
function lfCounts(r){
  const out = { done: 0, wip: 0, no: 0 };
  const a = r && r.answers && typeof r.answers === 'object' ? r.answers : {};
  (r.indicators || []).forEach(ind => { const x = a[ind.id]; if(x && out[x.s] != null) out[x.s]++; });
  return out;
}

/* سلاسل الدورات: لكل مسؤول (series_id) دوراته الأحدث أولًا، والسلاسل بحسب أحدث دورة */
function lfGroupSeries(list){
  const by = {};
  list.forEach(r => { (by[r.series_id] = by[r.series_id] || []).push(r); });
  const series = Object.keys(by).map(k => ({ id: k, items: by[k].slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) }));
  return series.sort((a, b) => String(b.items[0].created_at).localeCompare(String(a.items[0].created_at)));
}

function lfLeaderTitle(r){
  const role = leaderRoleLabel(r.leader_role) || 'مسؤول';
  return r.leader_name ? role + ' — ' + r.leader_name : role;
}

/* حالة المؤشر نفسه (بالنص) في أقرب دورة أقدم مُجاب عنها بالسلسلة نفسها: لمقارنة التقدّم بين الدورات */
function lfPrevStates(list, r){
  const older = list.filter(x => x.series_id === r.series_id && x.answered_at && String(x.created_at) < String(r.created_at))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const out = {};
  if(!older || !older.answers) return out;
  (older.indicators || []).forEach(ind => { const x = older.answers[ind.id]; if(x) out[ind.label] = x.s; });
  return out;
}

/* عدد المعايير المتحقَّقة لكل مؤشر (بالنص) في الدورة السابقة نفسها: { label: { n, t } } (3.50) */
function lfPrevCrit(list, r){
  const older = list.filter(x => x.series_id === r.series_id && x.answered_at && String(x.created_at) < String(r.created_at))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const out = {};
  if(!older || !older.answers) return out;
  (older.indicators || []).forEach(ind => {
    const x = older.answers[ind.id];
    if(x && (ind.criteria || []).length) out[ind.label] = { n: Array.isArray(x.c) ? x.c.length : 0, t: ind.criteria.length };
  });
  return out;
}

/* تقدّم مسودة المسؤول: كم مؤشرًا حدّد حالته من الكل (null إن لم يحفظ شيئًا) */
function lfDraftProgress(r){
  if(!r || r.answered_at || !r.draft || typeof r.draft !== 'object' || !r.draft.a) return null;
  const ids = (r.indicators || []).map(i => i.id);
  return { done: ids.filter(id => r.draft.a[id] && r.draft.a[id].s).length, total: ids.length };
}

function lfLink(code, origin){ return origin + '/f/' + code; }

function lfWaText(r, link){
  return 'السلام عليكم، أرجو تحديث حالة مؤشرات المتابعة (' + r.cycle_label + ') واختيار وقت للقاء عبر الرابط التالي. الرابط يقبل إجابة واحدة وينتهي بعدها:\n' + link;
}

/* اسم المعلم للصفحة العامة: الاسم المسجَّل فقط (لا البريد أبدًا) */
function lfSenderName(){
  const n = String(((currentUser && currentUser.user_metadata) || {}).full_name || '').trim();
  return n && n.length <= 60 && !/[\u0000-\u001F\u007F-\u009F@]/.test(n) ? n : null;
}

/* حالة شاشة الإنشاء. mode: 'new' (جديد)، 'next' (الدورة التالية لنفس المسؤول)، 'copy' (نفس المؤشرات لمسؤول آخر)، 'edit' (تعديل قبل التسليم).
   ids موازية لـindicators: معرّف المؤشر القائم (يُحفظ عند التعديل فلا تختلط مسودة المسؤول) أو null للجديد. */
function lfNewCreate(from, mode){
  mode = mode || (from ? 'next' : 'new');
  const inds = from ? (from.indicators || []) : [];
  const c = { mode, editId: null, series_id: mode === 'next' || mode === 'edit' ? from.series_id : null,
    role: from && mode !== 'copy' ? from.leader_role : 'principal', name: from && mode !== 'copy' && from.leader_name ? from.leader_name : '',
    cycle: mode === 'edit' ? from.cycle_label : '', indicators: inds.length ? inds.map(i => i.label) : [''],
    ids: inds.length && mode === 'edit' ? inds.map(i => i.id) : (inds.length ? inds.map(() => null) : [null]),
    slots: mode === 'edit' ? (from.slots || []).slice() : [], days: 7, busy: false, locked: [], maxId: 0, tplName: null,
    crit: inds.length ? inds.map(i => lfCritState(i.criteria, mode === 'edit')) : [lfCritState(null, false)] };
  if(mode === 'edit'){
    c.editId = from.id;
    c.locked = from.draft && from.draft.a ? Object.keys(from.draft.a) : [];
    c.maxId = inds.reduce((m, i) => Math.max(m, parseInt(String(i.id).slice(1), 10) || 0), 0);
  }
  return c;
}

/* معايير مؤشر في حالة الإنشاء (3.50): { max, items: [{ id|null, label }] }. keepIds (التعديل): المعرّفات القائمة تبقى،
   وmax = أكبر رقم سابق فلا يُعاد استعمال معرّف معيار حُذف (وإلا قد تظهر مسودة المسؤول محدِّدةً معيارًا جديدًا لم يره) */
function lfCritState(criteria, keepIds){
  const list = Array.isArray(criteria) ? criteria : [];
  return { max: keepIds ? list.reduce((m, x) => Math.max(m, parseInt(String(x.id).slice(1), 10) || 0), 0) : 0,
    items: list.map(x => ({ id: keepIds ? x.id : null, label: x.label })) };
}

/* معايير المؤشر النهائية: النص الفارغ يُسقط، والجديد يأخذ رقمًا بعد أكبر رقم سابق. يرجع مصفوفة (قد تكون فارغة) */
function lfAssignCritIds(cs){
  const items = (cs && cs.items || []).map(x => ({ id: x.id, label: String(x.label).trim() })).filter(x => x.label);
  let next = Math.max(cs && cs.max || 0, ...items.filter(x => x.id).map(x => parseInt(String(x.id).slice(1), 10) || 0));
  return items.map(x => ({ id: x.id || ('c' + (++next)), label: x.label }));
}

/* معرّفات المؤشرات: القائم يبقى كما هو، والجديد يأخذ رقمًا بعد أكبر رقم سابق (لا يُعاد استعمال معرّف حُذف) */
function lfAssignIds(labels, ids, maxId){
  let next = Math.max(maxId || 0, ...ids.filter(Boolean).map(x => parseInt(String(x).slice(1), 10) || 0));
  return labels.map((label, i) => ({ id: ids[i] || ('i' + (++next)), label }));
}

/* يُرجع { ok, indicators, slots } بعد إسقاط الفارغ والتحقق بمدقق leader-kit.js، أو { ok:false, msg } */
function lfValidateCreate(c){
  const keep = c.indicators.map((x, i) => ({ label: String(x).trim(), id: (c.ids || [])[i] || null, crit: lfAssignCritIds((c.crit || [])[i]) })).filter(x => x.label);
  const labels = keep.map(x => x.label);
  const missingLocked = (c.locked || []).filter(id => !keep.some(x => x.id === id));
  if(missingLocked.length) return { ok: false, msg: 'لا تحذف مؤشرًا بدأ المسؤول إجابته (أو اترك نصه).' };
  if(keep.some(x => x.crit.length > LEADER_LIMITS.maxCriteria)) return { ok: false, msg: 'حتى ' + LEADER_LIMITS.maxCriteria + ' معايير لكل مؤشر.' };
  const withCrit = lfAssignIds(labels, keep.map(x => x.id), c.maxId).map((ind, i) => keep[i].crit.length ? Object.assign(ind, { criteria: keep[i].crit }) : ind);
  const iv = leaderValidateIndicators(withCrit);
  if(!iv.ok) return { ok: false, msg: labels.length ? 'تحقق من نص المؤشرات ومعاييرها (حتى 150 حرفًا لكل نص، وحتى ' + LEADER_LIMITS.maxIndicators + ' مؤشرًا).' : 'أضف مؤشرًا واحدًا على الأقل.' };
  const slots = c.slots.map(x => String(x).trim()).filter(Boolean);
  const sv = leaderValidateSlots(slots);
  if(!sv.ok) return { ok: false, msg: 'أوقات اللقاء: حتى 6 أوقات بلا تكرار.' };
  if(!String(c.cycle).trim() || String(c.cycle).trim().length > LEADER_LIMITS.maxCycle) return { ok: false, msg: 'اكتب اسم الدورة (مثل: الفصل الأول).' };
  if(String(c.name).trim().length > LEADER_LIMITS.maxName) return { ok: false, msg: 'اسم المسؤول أطول من المسموح.' };
  return { ok: true, indicators: iv.value, slots: sv.value };
}

function lfCreateReady(c){
  return !!c && !c.busy && lfValidateCreate(c).ok;
}

/* ============ التنقل والتحميل ============ */

function lfResetScreen(screen){
  if(screen === 'home' || screen === 'list' || screen === 'leaders'){ lfState.create = null; lfState.sel = null; lfState.meet = null; lfState.confirmed = null; }
  if(screen === 'leaders' || screen === 'home') lfState.busy = false;
}

async function lfLoadList(){
  const token = toolsState.token;
  lfState.loading = true;
  renderTools();
  try{
    const res = await fetchAllRows((from, to) => sb.from('leader_followups').select(LF_COLS).eq('teacher_id', currentUser.id).order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to));
    if(res.error) throw res.error;
    if(!toolsStillHere(token, 'leaders')) return;
    lfState.list = res.data || [];
    lfLoadTemplates();
  } catch(err){
    if(!toolsStillHere(token, 'leaders')) return;
    lfState.list = lfState.list || [];
    showToast('تعذّر تحميل طلبات المتابعة: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  } finally {
    if(toolsStillHere(token, 'leaders')){ lfState.loading = false; renderTools(); }
  }
  refreshLeaderBadge();
}

function lfOpen(id){
  const r = lfState.list && lfState.list.find(x => x.id === id);
  if(!r) return;
  lfState.sel = id;
  lfState.allInds = false;
  toolsGo('ldetail');
  lfMarkSeen(id);
}

/* قوالب المعلم المحفوظة (leader_templates). الفشل صامت: الجدول قد لا يكون منشأً بعد، والقوالب الجاهزة تبقى متاحة */
async function lfLoadTemplates(){
  if(!currentUser) return;
  try{
    const { data, error } = await sb.from('leader_templates').select('id, name, indicators, created_at').eq('teacher_id', currentUser.id).order('created_at', { ascending: true });
    if(error) throw error;
    lfState.templates = data || [];
  } catch(_){ lfState.templates = lfState.templates || []; }
  if(toolsState.screen === 'lcreate' && toolsStillHere(toolsState.token, 'lcreate')) renderTools();
}

/* mode: 'next' (الافتراضي مع طلب) أو 'copy' (لمسؤول آخر) */
function lfStartCreate(fromId, mode){
  const from = fromId && lfState.list ? lfState.list.find(x => x.id === fromId) : null;
  lfState.create = lfNewCreate(from, from ? (mode || 'next') : 'new');
  toolsGo('lcreate');
}

/* تعديل طلب لم يُسلَّم بعد: من أحدث نسخة بالقاعدة (قد يكون المسؤول حفظ مسودة للتو) */
async function lfStartEdit(id){
  if(lfState.busy) return;
  const token = toolsState.token;
  lfState.busy = true; renderTools();
  try{ await lfReloadOne(id); } catch(err){ showToast('تعذّر فتح التعديل: ' + (err && err.message ? err.message : 'خطأ'), 'error'); }
  lfState.busy = false;
  if(!toolsStillHere(token, 'ldetail')) return;
  const r = lfState.list && lfState.list.find(x => x.id === id);
  if(!r || r.answered_at){ if(r) showToast('أرسل المسؤول إجابته؛ لا يُعدَّل الطلب بعد التسليم.', 'error'); renderTools(); return; }
  lfState.create = lfNewCreate(r, 'edit');
  toolsGo('lcreate');
}

/* ============ الرسم ============ */

function lfRender(screen){
  const body = document.getElementById('toolsBody');
  if(!body) return;
  if(screen === 'lcreate'){ const m = lfState.create && lfState.create.mode; toolsSetTitle(m === 'edit' ? 'تعديل الطلب' : m === 'next' ? 'الدورة التالية' : m === 'copy' ? 'نسخ لمسؤول آخر' : 'طلب متابعة جديد'); body.innerHTML = lfCreateHtml(); }
  else if(screen === 'ldetail'){ toolsSetTitle('طلب المتابعة'); body.innerHTML = lfDetailHtml(); }
  else { toolsSetTitle('متابعة المؤشرات'); body.innerHTML = lfListHtml(); }
}

/* الشارة بلون الحالة (هوية الأدوات: tlx-pill) */
const LF_STATUS_TONES = { answered: 'is-ok', sent: 'is-gold', ready: 'is-blue', expired: 'is-red', revoked: 'is-red' };
const LF_ANSWER_TONES = { done: 'is-ok', wip: 'is-gold', no: 'is-red' };

function lfChip(status){
  return `<span class="tlx-pill ${LF_STATUS_TONES[status] || ''}">${escapeHtml(LF_STATUS_LABELS[status])}</span>`;
}

function lfCrumb(label, target){ return toolsBackLink(label, target); }

/* هل يحتاج الطلب تدخّل المعلم الآن؟ إجابة لم تُشاهَد، أو موعد لقاء لم يُحسم بعد الإجابة */
function lfNeedsYou(r, list){
  if(!r.answered_at) return false;
  if(list.some(x => x.series_id === r.series_id && x.answered_at && !x.seen_at)) return true;
  return !!((r.slots || []).length || r.proposed_slot) && (!r.chosen_slot || r.chosen_slot === 'none');
}

/* تجميع القائمة بالأولوية: تحتاجك الآن، بانتظار الإجابة، مكتملة، منتهية (أحدث دورة لكل مسؤول) */
function lfListGroups(list){
  const g = { needs: [], waiting: [], done: [], ended: [] };
  lfGroupSeries(list).forEach(s => {
    const r = s.items[0], st = lfStatus(r);
    if(st === 'answered') (lfNeedsYou(r, list) ? g.needs : g.done).push(s);
    else if(st === 'ready' || st === 'sent') g.waiting.push(s);
    else g.ended.push(s);
  });
  return g;
}

function lfListRowHtml(s, list){
  const r = s.items[0], st = lfStatus(r);
  const fresh = list.some(x => x.series_id === s.id && x.answered_at && !x.seen_at);
  const c = lfCounts(r);
  const dp = lfDraftProgress(r);
  let meta, bar = '';
  if(st === 'answered'){
    meta = `${c.done} منفذ · ${c.wip} قيد التنفيذ · ${c.no} لم ينفذ` + (r.chosen_slot === 'none' ? (r.proposed_slot ? ' · اقترح موعدًا' : ' · بلا موعد') : '');
    const tot = (c.done + c.wip + c.no) || 1;
    bar = `<span class="tlx-mini" aria-hidden="true"><i class="m-ok" style="width:${(c.done / tot * 100).toFixed(1)}%"></i><i class="m-wip" style="width:${(c.wip / tot * 100).toFixed(1)}%"></i><i class="m-no" style="width:${(c.no / tot * 100).toFixed(1)}%"></i></span>`;
  } else if(dp) meta = `بدأ الإجابة: ${dp.done} من ${dp.total} (لم يُسلِّم بعد)`;
  else if(st === 'ready' || st === 'sent') meta = (r.indicators || []).length + ' مؤشرًا · ' + (s.items.length > 1 ? 'الدورة الحالية بانتظار الإجابة' : 'بانتظار الإجابة');
  else meta = st === 'expired' ? 'انتهت مدة الرابط قبل الإجابة' : 'أُلغي الرابط';
  return `<button type="button" class="tlx-row" onclick="lfOpen('${escapeHtml(r.id)}')"><span class="tlx-row-main"><b>${escapeHtml(lfLeaderTitle(r))}${fresh ? '<span class="tlx-pill is-new">جديد</span>' : ''}</b><small>${escapeHtml(r.cycle_label)} · ${escapeHtml(meta)}</small>${bar}</span>${lfChip(st)}<span class="tlx-chev" aria-hidden="true">‹</span></button>`;
}

function lfListHtml(){
  if(lfState.loading && !lfState.list) return lfCrumb('الأدوات', 'home') + '<div class="sv-empty">جارٍ التحميل…</div>';
  const list = lfState.list || [];
  const head = `<div class="tlx-head"><b>طلباتي</b><button type="button" class="tlx-new" onclick="lfStartCreate(null)">＋ طلب جديد</button></div>`;
  if(!list.length){
    return `${lfCrumb('الأدوات', 'home')}${head}<div class="tlx-box tlx-empty"><span class="tlx-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg></span><b>لا توجد طلبات متابعة بعد</b><small>أنشئ طلبًا لمدير المدرسة أو أحد الوكلاء بمؤشراتك، وأرسل له رابطًا يجيب منه مرة واحدة ويختار موعد اللقاء.</small></div>`;
  }
  const g = lfListGroups(list);
  const sect = (items, title, calm) => items.length ? `<div class="tlx-grp${calm ? ' is-calm' : ''}">${title} (${items.length})</div><div class="tlx-box">${items.map(s => lfListRowHtml(s, list)).join('')}</div>` : '';
  return `${lfCrumb('الأدوات', 'home')}${head}${sect(g.needs, 'تحتاجك الآن')}${sect(g.waiting, 'بانتظار الإجابة', true)}${sect(g.done, 'مكتملة', true)}${sect(g.ended, 'منتهية', true)}`;
}

/* «ابدأ من…»: القوالب (الجاهزة ثم قوالبي) كبسولات، والطلبات السابقة قائمة منسدلة. القيم r:/t:/f: (المعرّفات مهرَّبة) */
function lfStartFromHtml(c){
  if(c.mode === 'edit' || c.mode === 'next') return '';
  const chip = (v, label) => `<button type="button" class="tlx-chip${c.tplSel === v ? ' is-on' : ''}" aria-pressed="${c.tplSel === v}" onclick="lfStartFrom('${escapeHtml(v)}')">${escapeHtml(label)}</button>`;
  const ready = LEADER_READY_TEMPLATES.map(t => chip('r:' + t.key, t.name + ' (' + t.indicators.length + ')')).join('');
  const mine = (lfState.templates || []).map(t => chip('t:' + t.id, t.name + ' (' + (t.indicators || []).length + ')')).join('');
  const prev = (lfState.list || []).map(r => `<option value="f:${escapeHtml(r.id)}"${c.tplSel === 'f:' + r.id ? ' selected' : ''}>${escapeHtml(lfLeaderTitle(r) + ' · ' + r.cycle_label)}</option>`).join('');
  const delBtn = c.tplSel && c.tplSel.indexOf('t:') === 0 ? `<button type="button" class="tlx-link-text" onclick="lfDeleteTemplate('${escapeHtml(c.tplSel.slice(2))}')"${lfState.busy ? ' disabled' : ''}>حذف هذا القالب</button>` : '';
  return `<div class="tlx-lbl">ابدأ من قالب (اختياري)</div><div class="tlx-chips">${ready}${mine}</div>${delBtn}`
    + (prev ? `<label class="tlx-lbl" for="lfStartFrom">أو انسخ مؤشرات طلب سابق</label><select id="lfStartFrom" class="tlx-inp" onchange="lfStartFrom(this.value)"><option value="">—</option>${prev}</select>` : '');
}

/* معايير المؤشر i تحت سطره في نموذج الإنشاء (3.50): أسطر صغيرة بنقطة، و«＋ معيار» */
function lfCritEditHtml(c, i){
  const cs = (c.crit || [])[i] || { items: [] };
  const rows = cs.items.map((x, j) => `<div class="tlx-crit"><i aria-hidden="true"></i><input type="text" maxlength="${LEADER_LIMITS.maxLabel}" aria-label="معيار ${j + 1} للمؤشر ${i + 1}" value="${escapeHtml(x.label)}" placeholder="اكتب المعيار…" oninput="lfSetCrit(${i}, ${j}, this.value)"><button type="button" class="tlx-x" aria-label="حذف المعيار" onclick="lfRemoveCrit(${i}, ${j})">✕</button></div>`).join('');
  const full = cs.items.length >= LEADER_LIMITS.maxCriteria;
  return `${rows}<button type="button" class="tlx-critadd" onclick="lfAddCrit(${i})"${full ? ' disabled' : ''}>＋ معيار${cs.items.length ? '' : ' (اختياري)'}</button>`;
}

function lfCreateHtml(){
  const c = lfState.create;
  if(!c) return lfCrumb('المتابعة', 'leaders');
  const edit = c.mode === 'edit';
  const roles = Object.keys(LEADER_ROLES).map(k => `<button type="button" class="tlx-chip${c.role === k ? ' is-on' : ''}" aria-pressed="${c.role === k}" onclick="lfPickRole('${k}')">${escapeHtml(LEADER_ROLES[k])}</button>`).join('');
  const inds = c.indicators.map((t, i) => {
    const locked = c.ids[i] && c.locked.indexOf(c.ids[i]) >= 0;
    return `<div class="tlx-ind"><span class="tlx-n">${i + 1}</span><input type="text" maxlength="${LEADER_LIMITS.maxLabel}" aria-label="المؤشر ${i + 1}" value="${escapeHtml(t)}" placeholder="اكتب المؤشر…" oninput="lfSetInd(${i}, this.value)"><button type="button" class="tlx-x" aria-label="${locked ? 'بدأ المسؤول إجابته: لا يُحذف' : 'حذف المؤشر'}" onclick="lfRemoveInd(${i})"${c.indicators.length < 2 || locked ? ' disabled' : ''}>✕</button></div>`
      + lfCritEditHtml(c, i);
  }).join('');
  const slots = c.slots.map((t, i) => `<div class="tlx-ind"><span class="tlx-n">${i + 1}</span><input type="datetime-local" aria-label="الموعد ${i + 1}" value="${escapeHtml(t)}" oninput="lfSetSlot(${i}, this.value)"><button type="button" class="tlx-x" aria-label="حذف الموعد" onclick="lfRemoveSlot(${i})">✕</button></div>`).join('');
  const days = LF_DAYS.map(d => `<button type="button" class="${c.days === d ? 'is-on' : ''}" aria-pressed="${c.days === d}" onclick="lfPickDays(${d})">${d === 7 ? '7 أيام' : d + ' يومًا'}</button>`).join('');
  const back = edit || c.mode === 'next' ? lfCrumb('الطلب', 'ldetail') : lfCrumb('المتابعة', 'leaders');
  const lockNote = edit && c.locked.length ? `<div class="tlx-note"><b>بدأ المسؤول الإجابة (حفظ ${c.locked.length})</b>تقدر تضيف مؤشرات وتصحّح النصوص وتغيّر المواعيد، لكن لا تحذف مؤشرًا أجاب عنه. الرابط نفسه يبقى صالحًا ويرى التعديل عند فتحه.</div>` : '';
  const addInd = `<button type="button" onclick="lfAddInd()"${c.indicators.length >= LEADER_LIMITS.maxIndicators ? ' disabled' : ''}>＋ مؤشر</button>`;
  const tools = edit ? `<div class="tlx-add">${addInd}</div>`
    : c.tplName === null
      ? `<div class="tlx-add">${addInd}<button type="button" onclick="lfTemplateNameStart()">حفظ كقالب</button></div>`
      : `<div class="tlx-add"><input id="lfTplName" type="text" maxlength="${LEADER_LIMITS.maxTemplate}" placeholder="اسم القالب (مثل: سجلات وكيل الطلاب)" value="${escapeHtml(c.tplName)}" oninput="lfState.create.tplName = this.value"><button type="button" class="is-save" onclick="lfSaveTemplate()"${lfState.busy ? ' disabled' : ''}>حفظ</button></div>`;
  const filled = c.indicators.filter(x => String(x).trim()).length;
  return `${back}${lockNote}
    <div class="tlx-lbl">المسؤول</div><div class="tlx-chips">${roles}</div>
    <div class="tlx-two"><div><label class="tlx-lbl" for="lfName">اسمه (اختياري)</label><input id="lfName" class="tlx-inp" type="text" maxlength="${LEADER_LIMITS.maxName}" placeholder="أ. …" value="${escapeHtml(c.name)}" oninput="lfSetField('name', this.value)"></div>
      <div><label class="tlx-lbl" for="lfCycle">الدورة</label><input id="lfCycle" class="tlx-inp" type="text" maxlength="${LEADER_LIMITS.maxCycle}" placeholder="الفصل الأول" value="${escapeHtml(c.cycle)}" oninput="lfSetField('cycle', this.value)"></div></div>
    ${lfStartFromHtml(c)}
    <div class="tlx-lbl">المؤشرات <small>${filled} من ${LEADER_LIMITS.maxIndicators}</small></div>
    <div class="tlx-box">${inds}${tools}</div>
    <div class="tlx-lbl">أوقات مقترحة للقاء <small>يختار منها أو يقترح غيرها</small></div>
    <div class="tlx-box">${slots}<div class="tlx-add"><button type="button" onclick="lfAddSlot()"${c.slots.length >= LEADER_LIMITS.maxSlots ? ' disabled' : ''}>＋ موعد</button></div></div>
    ${edit ? '' : `<div class="tlx-lbl">ينتهي الرابط بعد</div><div class="tlx-seg" role="group" aria-label="مدة الرابط">${days}</div>`}
    <p class="tlx-foot">${edit ? 'يبقى الرابط نفسه؛ لا تحتاج إعادة إرسال.' : 'لا يُرسل شيء حتى تضغط واتساب أو نسخ الرابط بنفسك. تقدر تعدّل الطلب لاحقًا ما دام المسؤول لم يُرسل إجابته.'}</p>
    <div class="tlx-cta"><button type="button" class="tlx-btn is-navy" id="lfCreateBtn" onclick="lfCreate()"${lfCreateReady(c) ? '' : ' disabled'}>${edit ? 'حفظ التعديل' : 'إنشاء الطلب وتجهيز الرابط'}</button></div>`;
}

function lfAnswersHtml(r){
  const prev = lfPrevStates(lfState.list || [], r);
  const prevC = lfPrevCrit(lfState.list || [], r);
  const a = r.answers || {};
  let met = 0, all = 0;
  const rows = (r.indicators || []).map(ind => {
    const x = a[ind.id] || {};
    const was = prev[ind.label];
    const crit = ind.criteria || [];
    const got = new Set(Array.isArray(x.c) ? x.c : []);
    met += crit.filter(c => got.has(c.id)).length; all += crit.length;
    const pc = prevC[ind.label];
    const trendTxt = [was && was !== x.s ? escapeHtml(LEADER_ANSWER_STATES[was] || '') : '', pc && crit.length ? pc.n + ' من ' + pc.t + ' معايير' : ''].filter(Boolean).join(' · ');
    const trend = trendTxt ? `<small class="tlx-trend">الدورة السابقة: ${trendTxt}</small>` : '';
    /* المعايير: المتحقَّق ✓ والناقص بالأحمر (3.50) */
    const crl = crit.length ? `<ul class="tlx-crl">${crit.map(c => got.has(c.id)
      ? `<li class="is-ok"><b aria-hidden="true">✓</b><span>${escapeHtml(c.label)}</span></li>`
      : `<li class="is-miss"><b aria-hidden="true"></b><span>${escapeHtml(c.label)} — ناقص</span></li>`).join('')}</ul>` : '';
    return `<div class="tlx-ans"><div class="tlx-ans-top"><span>${escapeHtml(ind.label)}${crit.length ? ` <small class="tlx-cc">${got.size} من ${crit.length}</small>` : ''}</span><span class="tlx-pill ${LF_ANSWER_TONES[x.s] || ''}">${escapeHtml(LEADER_ANSWER_STATES[x.s] || '—')}</span></div>${x.r ? `<small>${escapeHtml(x.r)}</small>` : ''}${crl}${trend}</div>`;
  }).join('');
  return `${lfMeetingHtml(r)}<div class="tlx-sec">الإجابات (${(r.indicators || []).length})${all ? ` · المعايير المتحقَّقة ${met} من ${all}` : ''}</div><div class="tlx-box">${rows}</div>`;
}

/* عنصر بقائمة الإجراءات */
function lfMenuItem(label, icon, onclick, opts){
  const o = opts || {};
  return `<button type="button" class="tlx-mi${o.danger ? ' is-danger' : ''}" onclick="${onclick}"${lfState.busy ? ' disabled' : ''}><i aria-hidden="true">${icon}</i><span>${escapeHtml(label)}</span>${o.chev ? '<span class="tlx-chev" aria-hidden="true">‹</span>' : ''}</button>`;
}

function lfToggleAllInds(){ lfState.allInds = !lfState.allInds; renderTools(); }

function lfDetailHtml(){
  const r = lfState.list && lfState.list.find(x => x.id === lfState.sel);
  if(!r) return lfCrumb('المتابعة', 'leaders') + '<div class="sv-empty">الطلب غير موجود.</div>';
  const st = lfStatus(r), busy = lfState.busy ? ' disabled' : '';
  const id = escapeHtml(r.id);
  const live = st === 'ready' || st === 'sent';
  const closes = new Date(r.closes_at);
  const closesTxt = live && !isNaN(closes) ? ' · ينتهي ' + closes.toLocaleDateString('ar', { day: 'numeric', month: 'long' }) : '';
  let heroBody = '';
  if(st === 'answered'){
    const c = lfCounts(r);
    heroBody = `<div class="tlx-strip"><span>منفذ<b class="lf-ok">${c.done}</b></span><span>قيد التنفيذ<b class="lf-wip">${c.wip}</b></span><span>لم ينفذ<b class="lf-no">${c.no}</b></span></div>`;
  } else if(live){
    const link = r.code ? lfLink(r.code, location.origin) : '';
    heroBody = `<div class="tlx-link"><span dir="ltr" title="رابط شخصي يقبل إجابة واحدة">${escapeHtml(link)}</span><button type="button" onclick="lfCopyLink('${id}')"${busy}>نسخ</button></div>
      <a class="tlx-btn is-wa" href="${escapeHtml('https://wa.me/?text=' + encodeURIComponent(lfWaText(r, link)))}" target="_blank" rel="noopener" onclick="lfMarkSent('${id}')">إرسال عبر واتساب</a>`;
  } else {
    heroBody = `<div class="tlx-note"><b>${st === 'expired' ? 'انتهت مدة الرابط' : 'أُلغي الرابط'}</b>أصدر رابطًا جديدًا إن أردت إرساله مرة أخرى.</div>
      <button type="button" class="tlx-btn is-navy" onclick="lfReissue('${id}')"${busy}>إصدار رابط جديد (7 أيام)</button>`;
  }
  const hero = `<div class="tlx-hero"><div class="tlx-hero-top"><div><b>${escapeHtml(lfLeaderTitle(r))}</b><small>${escapeHtml(r.cycle_label)}${escapeHtml(closesTxt)}</small></div>${lfChip(st)}</div>${heroBody}</div>`;

  let main = '';
  if(st === 'answered'){
    main = lfAnswersHtml(r);
  } else {
    const dp = lfDraftProgress(r);
    const draft = dp ? `<div class="tlx-note"><b>بدأ المسؤول الإجابة ولم يُسلِّم بعد</b>حدّد ${dp.done} من ${dp.total} مؤشرات${r.draft_saved_at ? ' · آخر حفظ ' + escapeHtml(leaderDateLabel(r.draft_saved_at)) : ''}. تصلك النتيجة عند التسليم.</div>` : '';
    const all = r.indicators || [];
    const LIMIT = 4;
    const shown = lfState.allInds || all.length <= LIMIT + 1 ? all : all.slice(0, LIMIT);
    const more = shown.length < all.length ? `<button type="button" class="tlx-more" onclick="lfToggleAllInds()">عرض الكل (${all.length}) ▾</button>`
      : (all.length > LIMIT + 1 ? `<button type="button" class="tlx-more" onclick="lfToggleAllInds()">عرض أقل ▴</button>` : '');
    const inds = `<div class="tlx-sec">المؤشرات (${all.length})</div><div class="tlx-box">${shown.map((i, n) => `<div class="tlx-ind"><span class="tlx-n">${n + 1}</span><span>${escapeHtml(i.label)}</span>${(i.criteria || []).length ? `<small class="tlx-cc">${escapeHtml(arabicCountPhrase(i.criteria.length, LF_CRIT_FORMS))}</small>` : ''}</div>`).join('')}${more}</div>`;
    const slots = (r.slots || []).length ? `<div class="tlx-sec">أوقات اللقاء المقترحة</div><div class="tlx-box">${r.slots.map(s => `<div class="tlx-ind"><span>${escapeHtml(leaderSlotLabel(s))}</span></div>`).join('')}</div>` : '';
    main = draft + inds + slots;
  }

  const acts = [];
  if(st !== 'answered') acts.push(lfMenuItem('تعديل الطلب (المؤشرات والمواعيد)', '✎', `lfStartEdit('${id}')`, { chev: true }));
  if(live) acts.push(lfMenuItem('تمديد 7 أيام', '⟳', `lfExtend('${id}')`));
  acts.push(lfMenuItem('الدورة التالية لنفس المسؤول', '↻', `lfStartCreate('${id}', 'next')`, { chev: true }));
  acts.push(lfMenuItem('نسخ لمسؤول آخر', '⧉', `lfStartCreate('${id}', 'copy')`, { chev: true }));
  if(live) acts.push(lfMenuItem('إلغاء الرابط', '⊘', `lfRevoke('${id}')`, { danger: true }));
  acts.push(lfMenuItem('حذف الطلب', '✕', `lfDelete('${id}')`, { danger: true }));

  const history = lfGroupSeries(lfState.list).find(s => s.id === r.series_id).items.filter(x => x.id !== r.id)
    .map(x => `<button type="button" class="tlx-row" onclick="lfOpen('${escapeHtml(x.id)}')"><span class="tlx-row-main"><b>${escapeHtml(x.cycle_label)}</b></span>${lfChip(lfStatus(x))}<span class="tlx-chev" aria-hidden="true">‹</span></button>`).join('');

  return `${lfCrumb('المتابعة', 'leaders')}${hero}${main}
    <div class="tlx-sec">إجراءات</div><div class="tlx-box">${acts.join('')}</div>
    ${history ? `<div class="tlx-sec">الدورات الأخرى</div><div class="tlx-box">${history}</div>` : ''}`;
}

/* ============ تحرير نموذج الإنشاء (بلا إعادة رسم أثناء الكتابة حتى لا يفقد الحقل تركيزه) ============ */

function lfSyncCreateBtn(){
  const btn = document.getElementById('lfCreateBtn');
  if(btn) btn.disabled = !lfCreateReady(lfState.create);
}
function lfSetField(k, v){ const c = lfState.create; if(!c) return; c[k] = String(v); lfSyncCreateBtn(); }
function lfSetInd(i, v){ const c = lfState.create; if(!c || i >= c.indicators.length) return; c.indicators[i] = String(v); lfSyncCreateBtn(); }
function lfSetSlot(i, v){ const c = lfState.create; if(!c || i >= c.slots.length) return; c.slots[i] = String(v); lfSyncCreateBtn(); }
function lfAddInd(){ const c = lfState.create; if(!c || c.indicators.length >= LEADER_LIMITS.maxIndicators) return; c.indicators.push(''); c.ids.push(null); c.crit.push(lfCritState(null, false)); renderTools(); }
function lfRemoveInd(i){ const c = lfState.create; if(!c || c.indicators.length < 2 || (c.ids[i] && c.locked.indexOf(c.ids[i]) >= 0)) return; c.indicators.splice(i, 1); c.ids.splice(i, 1); c.crit.splice(i, 1); renderTools(); }
/* معايير المؤشر i (3.50) */
function lfAddCrit(i){ const c = lfState.create; const cs = c && c.crit[i]; if(!cs || cs.items.length >= LEADER_LIMITS.maxCriteria) return; cs.items.push({ id: null, label: '' }); renderTools(); }
function lfRemoveCrit(i, j){ const c = lfState.create; const cs = c && c.crit[i]; if(!cs || j < 0 || j >= cs.items.length) return; cs.items.splice(j, 1); renderTools(); }
function lfSetCrit(i, j, v){ const c = lfState.create; const cs = c && c.crit[i]; if(!cs || j < 0 || j >= cs.items.length) return; cs.items[j].label = String(v); lfSyncCreateBtn(); }
function lfAddSlot(){ const c = lfState.create; if(!c || c.slots.length >= LEADER_LIMITS.maxSlots) return; c.slots.push(''); renderTools(); }
function lfRemoveSlot(i){ const c = lfState.create; if(!c) return; c.slots.splice(i, 1); renderTools(); }
function lfPickRole(k){ const c = lfState.create; if(!c || !LEADER_ROLES[k]) return; c.role = k; renderTools(); }
function lfPickDays(d){ const c = lfState.create; if(!c || LF_DAYS.indexOf(d) < 0) return; c.days = d; renderTools(); }
/* «ابدأ من…»: يعبّئ المؤشرات (وجهة القالب الجاهز إن وُجدت). لا يمسّ وضع التعديل */
function lfStartFrom(v){
  const c = lfState.create; if(!c || c.mode === 'edit' || !v) return;
  let inds = null; /* [{ label, criteria? }] — القوالب والطلبات السابقة تحمل معاييرها (3.50) */
  if(v.indexOf('r:') === 0){ const t = LEADER_READY_TEMPLATES.find(x => x.key === v.slice(2)); if(t){ inds = t.indicators.map(label => ({ label })); if(t.role && LEADER_ROLES[t.role]) c.role = t.role; } }
  else if(v.indexOf('t:') === 0){ const t = (lfState.templates || []).find(x => x.id === v.slice(2)); if(t) inds = t.indicators || []; }
  else if(v.indexOf('f:') === 0){ const r = (lfState.list || []).find(x => x.id === v.slice(2)); if(r) inds = r.indicators || []; }
  if(!inds || !inds.length) return;
  inds = inds.slice(0, LEADER_LIMITS.maxIndicators);
  c.indicators = inds.map(i => i.label); c.ids = c.indicators.map(() => null); c.crit = inds.map(i => lfCritState(i.criteria, false)); c.tplSel = v;
  renderTools();
}
function lfCopyFrom(id){ return lfStartFrom('f:' + id); } /* توافق */

function lfTemplateNameStart(){ const c = lfState.create; if(!c) return; c.tplName = ''; renderTools(); }

/* حفظ مؤشرات الشاشة الحالية كقالب باسم (لحساب المعلم وحده) */
async function lfSaveTemplate(){
  const c = lfState.create; if(!c || lfState.busy || !currentUser) return;
  const name = String(c.tplName || '').trim();
  if(!name || name.length > LEADER_LIMITS.maxTemplate || /[\u0000-\u001F\u007F-\u009F]/.test(name)){ showToast('اكتب اسمًا للقالب (حتى ' + LEADER_LIMITS.maxTemplate + ' حرفًا).', 'error'); return; }
  const rows = c.indicators.map((x, i) => ({ label: String(x).trim(), crit: lfAssignCritIds(lfCritState((c.crit[i] || {}).items, false)) })).filter(x => x.label);
  const iv = leaderValidateIndicators(rows.map((x, i) => x.crit.length ? { id: 'i' + (i + 1), label: x.label, criteria: x.crit } : { id: 'i' + (i + 1), label: x.label }));
  if(!iv.ok){ showToast('أضف مؤشرات صالحة أولًا.', 'error'); return; }
  lfState.busy = true; renderTools();
  try{
    const { data, error } = await sb.from('leader_templates').insert({ teacher_id: currentUser.id, name, indicators: iv.value }).select('id, name, indicators, created_at').single();
    if(error) throw error;
    lfState.templates = (lfState.templates || []).concat([data]);
    if(lfState.create === c){ c.tplName = null; c.tplSel = 't:' + data.id; }
    showToast('حُفظ القالب «' + name + '»', 'ok');
  } catch(err){ showToast('تعذّر حفظ القالب: ' + (err && err.message ? err.message : 'خطأ'), 'error'); }
  finally { lfState.busy = false; if(toolsStillHere(toolsState.token, 'lcreate')) renderTools(); }
}

/* حذف قالب محفوظ: نص فقط بلا توابع (لا سلة، بتأكيد) — DELETE-POLICY.md */
async function lfDeleteTemplate(id){
  if(lfState.busy || !currentUser) return;
  const t = (lfState.templates || []).find(x => x.id === id); if(!t) return;
  if(!await showConfirm('حذف القالب «' + t.name + '»؟ لا يتأثر أي طلب أُنشئ منه.')) return;
  lfState.busy = true; renderTools();
  try{
    const { error } = await sb.from('leader_templates').delete().eq('teacher_id', currentUser.id).eq('id', id);
    if(error) throw error;
    lfState.templates = (lfState.templates || []).filter(x => x.id !== id);
    if(lfState.create && lfState.create.tplSel === 't:' + id) lfState.create.tplSel = null;
    showToast('حُذف القالب', 'ok');
  } catch(err){ showToast('تعذّر حذف القالب: ' + (err && err.message ? err.message : 'خطأ'), 'error'); }
  finally { lfState.busy = false; if(toolsStillHere(toolsState.token, 'lcreate')) renderTools(); }
}

/* ============ الإنشاء ============ */

async function lfCreate(){
  const c = lfState.create;
  if(!c || c.busy || !currentUser) return;
  const v = lfValidateCreate(c);
  if(!v.ok){ showToast(v.msg, 'error'); return; }
  const token = toolsState.token;
  if(c.mode === 'edit') return lfSaveEdit(c, v, token);
  c.busy = true;
  const btn = document.getElementById('lfCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الإنشاء…'; }
  const row = {
    teacher_id: currentUser.id, leader_role: c.role, leader_name: String(c.name).trim() || null, cycle_label: String(c.cycle).trim(),
    sender_name: lfSenderName(), indicators: v.indicators, slots: v.slots, code: surveyNewCode(),
    closes_at: new Date(Date.now() + c.days * 86400000).toISOString()
  };
  if(c.series_id) row.series_id = c.series_id;
  let created = null;
  try{
    const { data, error } = await sb.from('leader_followups').insert(row).select(LF_COLS).single();
    if(error) throw error;
    created = data;
  } catch(err){
    c.busy = false;
    showToast('تعذّر إنشاء الطلب: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    if(toolsStillHere(token, 'lcreate')) renderTools();
    return;
  }
  c.busy = false;
  lfState.list = [created].concat(lfState.list || []);
  /* السباق: لو غادر المعلم الشاشة أثناء الإنشاء لا نفتح له تفاصيل فجأة؛ الطلب يظهر بقائمته */
  if(!toolsStillHere(token, 'lcreate')) return;
  lfState.create = null;
  lfState.sel = created.id;
  toolsGo('ldetail');
}

/* حفظ تعديل طلب لم يُسلَّم: بنفس الرابط. الشرط .is('answered_at', null) يمنع تعديل ما سُلِّم للتو، والقاعدة ترفض
   حذف مؤشر في مسودة المسؤول (لو حفظها بعد فتح شاشة التعديل) فتظهر رسالتها ويُعاد فتح الطلب بأحدث نسخة. */
async function lfSaveEdit(c, v, token){
  c.busy = true;
  const btn = document.getElementById('lfCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الحفظ…'; }
  const id = c.editId;
  let saved = null, err = null;
  try{
    const { data, error } = await sb.from('leader_followups').update({
      leader_role: c.role, leader_name: String(c.name).trim() || null, cycle_label: String(c.cycle).trim(), indicators: v.indicators, slots: v.slots
    }).eq('teacher_id', currentUser.id).eq('id', id).is('answered_at', null).select(LF_COLS);
    if(error) throw error;
    saved = data && data[0];
  } catch(e){ err = e; }
  c.busy = false;
  if(saved){
    const i = (lfState.list || []).findIndex(x => x.id === id);
    if(i >= 0) lfState.list[i] = saved;
    showToast('حُفظ التعديل. الرابط نفسه يبقى صالحًا.', 'ok');
    if(!toolsStillHere(token, 'lcreate')) return;
    lfState.create = null; lfState.sel = id; toolsGo('ldetail');
    return;
  }
  showToast(err ? 'تعذّر حفظ التعديل: ' + (err.message || 'خطأ') : 'لم يُحفظ: أرسل المسؤول إجابته للتو.', 'error');
  try{ await lfReloadOne(id); }catch(_){}
  if(!toolsStillHere(token, 'lcreate')) return;
  const r = (lfState.list || []).find(x => x.id === id);
  if(!r || r.answered_at){ lfState.create = null; lfState.sel = id; toolsGo('ldetail'); return; }
  /* أعِد قائمة المؤشرات المقفلة من أحدث مسودة (حفظ المسؤول بعد فتح الشاشة) مع إبقاء ما كتبه المعلم */
  c.locked = r.draft && r.draft.a ? Object.keys(r.draft.a) : [];
  renderTools();
}

/* ============ موعد اللقاء بعد التسليم ============ */

function lfMeetWaText(r, slot, kind){
  const who = r.leader_name ? 'أستاذ ' + r.leader_name : '';
  /* نص رسالة واتساب (يُرمَّز بـencodeURIComponent داخل الرابط ثم يُهرَّب بالسمة؛ لا يُدرج بالصفحة) */
  const hi = 'السلام عليكم' + (who ? ' ' + who : '') + '، ';
  return kind === 'confirm'
    ? hi + 'تم تأكيد موعد لقائنا لمتابعة المؤشرات (' + r.cycle_label + '): ' + leaderSlotLabel(slot) + '. شكرًا لك.'
    : hi + 'بخصوص موعد لقاء متابعة المؤشرات (' + r.cycle_label + '): هل يناسبك ' + leaderSlotLabel(slot) + '؟';
}
function lfWaUrl(text){ return 'https://wa.me/?text=' + encodeURIComponent(text); }

function lfMeetOpen(id){ lfState.meet = { id, value: '' }; lfState.confirmed = null; renderTools(); }
function lfMeetClose(){ lfState.meet = null; renderTools(); }
/* أثناء الكتابة: يُحدَّث رابط واتساب وحالة زر التثبيت فقط (بلا إعادة رسم تُفقد الحقل تركيزه) */
function lfMeetInput(v){
  const m = lfState.meet; if(!m) return;
  m.value = String(v || '');
  const r = (lfState.list || []).find(x => x.id === m.id);
  const ok = LEADER_SLOT_RE.test(m.value);
  const a = document.getElementById('lfMeetWa'), b = document.getElementById('lfMeetSet');
  if(a){ a.href = ok && r ? lfWaUrl(lfMeetWaText(r, m.value, 'propose')) : '#'; a.setAttribute('aria-disabled', ok ? 'false' : 'true'); a.style.pointerEvents = ok ? '' : 'none'; a.style.opacity = ok ? '' : '.5'; }
  if(b) b.disabled = !ok || lfState.busy;
}

/* تثبيت موعد (موافقة على اقتراح المسؤول، أو موعد اتفقتما عليه): set_leader_meeting بالقاعدة تفحص المالك والتعارض */
async function lfSetMeeting(id, slot){
  if(lfState.busy || !LEADER_SLOT_RE.test(String(slot || ''))) return;
  const token = toolsState.token;
  lfState.busy = true; renderTools();
  let res = null;
  try{
    const { data, error } = await sb.rpc('set_leader_meeting', { p_id: id, p_slot: slot });
    if(error) throw error;
    res = data;
    if(res === 'ok'){ lfState.meet = null; lfState.confirmed = { id, slot }; }
    else if(res === 'slot_taken') showToast('هذا الموعد محجوز لمسؤول آخر. اختر غيره.', 'error');
    else showToast('تعذّر تثبيت الموعد.', 'error');
    await lfReloadOne(id);
  } catch(err){ showToast('تعذّر تثبيت الموعد: ' + (err && err.message ? err.message : 'خطأ'), 'error'); }
  finally { lfState.busy = false; if(toolsStillHere(token, 'ldetail')) renderTools(); }
}

function lfMeetingHtml(r){
  if(!r.slots || !r.slots.length){
    if(!r.chosen_slot || r.chosen_slot === 'none') return '';
  }
  const busy = lfState.busy ? ' disabled' : '';
  const set = r.chosen_slot && r.chosen_slot !== 'none';
  let head;
  if(set) head = `<b>موعد اللقاء: ${escapeHtml(leaderSlotLabel(r.chosen_slot))}</b>`;
  else if(r.proposed_slot) head = `<b>اقترح المسؤول موعدًا آخر: ${escapeHtml(leaderSlotLabel(r.proposed_slot))}</b>${r.proposed_note ? `<small>«${escapeHtml(r.proposed_note)}»</small>` : ''}`;
  else head = `<b>لم يناسبه أي موعد من المقترحة</b>${r.proposed_note ? `<small>«${escapeHtml(r.proposed_note)}»</small>` : ''}<small>حدّد معه موعدًا ثم ثبّته هنا.</small>`;
  const conf = lfState.confirmed && lfState.confirmed.id === r.id
    ? `<a class="tlx-btn is-wa" href="${escapeHtml(lfWaUrl(lfMeetWaText(r, lfState.confirmed.slot, 'confirm')))}" target="_blank" rel="noopener">أرسل له التأكيد عبر واتساب</a>` : '';
  let actions = '';
  if(lfState.meet && lfState.meet.id === r.id){
    actions = `<label class="tlx-lbl" for="lfMeetInput">موعد آخر</label><input id="lfMeetInput" class="tlx-inp" type="datetime-local" value="${escapeHtml(lfState.meet.value)}" oninput="lfMeetInput(this.value)">
      <a id="lfMeetWa" class="tlx-btn is-ghost" href="#" target="_blank" rel="noopener" style="pointer-events:none;opacity:.5" aria-disabled="true">اقترحه عليه عبر واتساب</a>
      <button id="lfMeetSet" type="button" class="tlx-btn is-navy" onclick="lfSetMeeting('${escapeHtml(r.id)}', lfState.meet && lfState.meet.value)" disabled>ثبّت هذا الموعد (بعد اتفاقكما)</button>
      <button type="button" class="tlx-crumb" onclick="lfMeetClose()">إلغاء</button>`;
  } else if(!set && r.proposed_slot){
    actions = `<div class="tlx-btns"><button type="button" class="tlx-btn is-navy" onclick="lfSetMeeting('${escapeHtml(r.id)}', '${escapeHtml(r.proposed_slot)}')"${busy}>موافقة</button><button type="button" class="tlx-btn is-ghost" onclick="lfMeetOpen('${escapeHtml(r.id)}')"${busy}>اقتراح موعد آخر</button></div>`;
  } else {
    actions = `<button type="button" class="tlx-btn is-ghost" onclick="lfMeetOpen('${escapeHtml(r.id)}')"${busy}>${set ? 'تغيير الموعد' : 'تحديد موعد'}</button>`;
  }
  return `<div class="tlx-sec">موعد اللقاء</div><div class="tlx-box tlx-meet">${head}${conf}${actions}</div>`;
}

/* ============ إجراءات الطلب ============ */

/* تنفيذ إجراء كتابة واحد في كل مرة: الأزرار تتعطّل أثناءه (لا نقرة مزدوجة)، ثم إعادة قراءة الصف من القاعدة */
async function lfRun(id, fn, okMsg){
  if(lfState.busy) return;
  const token = toolsState.token;
  lfState.busy = true;
  if(toolsStillHere(token, 'ldetail')) renderTools();
  try{
    await fn();
    await lfReloadOne(id);
    if(okMsg) showToast(okMsg, 'ok');
  } catch(err){
    showToast('تعذّر التنفيذ: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    try{ await lfReloadOne(id); }catch(_){}
  } finally {
    lfState.busy = false;
    if(toolsStillHere(token, 'ldetail')) renderTools();
  }
}

/* أحدث نسخة من القاعدة (لا النسخة المحلية القديمة): قد يكون المسؤول أجاب من جهازه أثناء عمل المعلم */
async function lfReloadOne(id){
  const { data, error } = await sb.from('leader_followups').select(LF_COLS).eq('teacher_id', currentUser.id).eq('id', id).maybeSingle();
  if(error) throw error;
  if(!lfState.list) return;
  const i = lfState.list.findIndex(x => x.id === id);
  if(!data){ if(i >= 0) lfState.list.splice(i, 1); return; }
  if(i >= 0) lfState.list[i] = data; else lfState.list.unshift(data);
}

/* أول إرسال: تُعلَّم «أُرسل» وتبدأ المدة من لحظته. شرط .is('sent_at', null) فلا نقرة ثانية ولا جهاز آخر يعيد ضبطها. */
async function lfMarkSent(id){
  const r = lfState.list && lfState.list.find(x => x.id === id);
  if(!r || r.sent_at || !currentUser) return;
  const days = Math.max(1, Math.round((new Date(r.closes_at).getTime() - new Date(r.created_at).getTime()) / 86400000)) || 7;
  const now = new Date();
  r.sent_at = now.toISOString(); /* تحديث محلي فوري، يُصحَّح بإعادة القراءة */
  const { error } = await sb.from('leader_followups').update({ sent_at: now.toISOString(), closes_at: new Date(now.getTime() + days * 86400000).toISOString() })
    .eq('teacher_id', currentUser.id).eq('id', id).is('sent_at', null).is('answered_at', null);
  if(error) showToast('تعذّر تسجيل الإرسال: ' + error.message, 'error');
  try{ await lfReloadOne(id); }catch(_){}
  if(toolsStillHere(toolsState.token, 'ldetail')) renderTools();
}

async function lfCopyLink(id){
  const r = lfState.list && lfState.list.find(x => x.id === id);
  if(!r || !r.code) return;
  const link = lfLink(r.code, location.origin);
  try{ await navigator.clipboard.writeText(link); showToast('تم نسخ الرابط', 'ok'); }
  catch(_){ showToast('حدّد الرابط وانسخه بيدك', 'error'); }
  lfMarkSent(id);
}

function lfExtend(id){
  const r = lfState.list && lfState.list.find(x => x.id === id);
  if(!r) return;
  const base = Math.max(Date.now(), new Date(r.closes_at).getTime());
  return lfRun(id, async () => {
    const { error } = await sb.from('leader_followups').update({ closes_at: new Date(base + 7 * 86400000).toISOString() })
      .eq('teacher_id', currentUser.id).eq('id', id).is('answered_at', null);
    if(error) throw error;
  }, 'تم التمديد 7 أيام');
}

async function lfRevoke(id){
  if(lfState.busy) return;
  if(!await showConfirm('إلغاء الرابط؟ لن يقبل المسؤول الإجابة منه، ويمكنك إصدار رابط جديد لاحقًا.')) return;
  return lfRun(id, async () => {
    const { error } = await sb.from('leader_followups').update({ code: null })
      .eq('teacher_id', currentUser.id).eq('id', id).is('answered_at', null);
    if(error) throw error;
  }, 'أُلغي الرابط');
}

function lfReissue(id){
  return lfRun(id, async () => {
    const { error } = await sb.from('leader_followups').update({ code: surveyNewCode(), closes_at: new Date(Date.now() + 7 * 86400000).toISOString() })
      .eq('teacher_id', currentUser.id).eq('id', id).is('answered_at', null);
    if(error) throw error;
  }, 'صدر رابط جديد');
}

/* حذف طلب (المجاب عنه أيضًا) عبر سلة المحذوفات: لقطة أولًا (trashProtect) ثم الحذف، ثم «تراجع» 8 ثوانٍ.
   السباق: الحذف مشروط بحالة اللقطة نفسها — لو أجاب المسؤول بعد أخذ لقطة «لم يُجب» لا يُحذف شيء (فلا تضيع إجابته
   خارج السلة)، وتُزال اللقطة ويُعاد قراءة الطلب. */
async function lfDelete(id){
  if(lfState.busy || !currentUser) return;
  const r = lfState.list && lfState.list.find(x => x.id === id);
  if(!r) return;
  const msg = r.answered_at
    ? 'حذف هذا الطلب وإجابة المسؤول عليه؟ يبقى في «المحذوفات» 30 يومًا ويمكنك استرجاعه.'
    : 'حذف هذا الطلب؟ سيتوقف رابطه عن العمل، ويبقى في «المحذوفات» 30 يومًا (يُسترجع برابط ملغى تصدر له رابطًا جديدًا).';
  if(!await showConfirm(msg)) return;
  return trashRunOnce('leader_followup:' + id, async () => {
    const token = toolsState.token;
    const uid = currentUser.id;
    lfState.busy = true;
    if(toolsStillHere(token, 'ldetail')) renderTools();
    let removed = false, trashId = null;
    try{
      const prot = await trashProtect(() => trashCaptureLeaderFollowup(id, uid));
      if(!prot){ return; } /* رفض المعلم الحذف بلا سلة */
      trashId = prot.id;
      if(prot.gone){ await lfReloadOne(id); return; }
      const wasAnswered = prot.cap ? !!prot.cap.tables[0].rows[0].answered_at : !!r.answered_at;
      let q = sb.from('leader_followups').delete().eq('teacher_id', uid).eq('id', id);
      if(!wasAnswered) q = q.is('answered_at', null);
      const { data, error } = await q.select('id');
      if(error) throw error;
      removed = !!(data && data.length);
      if(!removed){
        await trashDiscard(trashId); trashId = null;
        showToast('لم يُحذف الطلب: ربما أجاب المسؤول للتو. راجع إجابته ثم احذفه إن شئت.', 'error');
      }
      await lfReloadOne(id);
    } catch(err){
      if(trashId){ await trashDiscard(trashId); trashId = null; }
      showToast('تعذّر الحذف: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    } finally {
      lfState.busy = false;
    }
    if(removed){
      trashOfferUndo('حُذف الطلب', trashId, lfAfterRestore);
      refreshLeaderBadge();
      if(toolsStillHere(token, 'ldetail')) toolsGo('leaders');
    } else if(toolsStillHere(token, 'ldetail')) renderTools();
  });
}

/* بعد الاسترجاع من السلة (تراجع أو من «المحذوفات»): تحديث القائمة إن كانت ظاهرة، والشارة */
async function lfAfterRestore(){
  refreshLeaderBadge();
  const v = document.getElementById('toolsView');
  if(v && v.style.display === 'block' && toolsState.screen === 'leaders') lfLoadList();
}

/* ============ التنبيه بدرج الحساب ============ */

/* تُعلَّم الإجابة «شوهدت» عند فتح تفاصيلها: .is('seen_at', null) فلا تكرار، والخطأ هنا لا يوقف العرض */
async function lfMarkSeen(id){
  const r = lfState.list && lfState.list.find(x => x.id === id);
  if(!r || !r.answered_at || r.seen_at || !currentUser) return;
  r.seen_at = new Date().toISOString();
  try{
    await sb.from('leader_followups').update({ seen_at: r.seen_at }).eq('teacher_id', currentUser.id).eq('id', id).is('seen_at', null);
  } catch(_){}
  refreshLeaderBadge();
}

/* شارة «الأدوات» بقائمة الحساب = عدد إجابات المسؤولين التي لم تُشاهَد بعد، ونقطة على دائرة الحساب (syncAcctDot) */
async function refreshLeaderBadge(){
  const badge = document.getElementById('toolsNavBadge');
  if(!badge || !currentUser) return;
  let n = 0;
  try{
    const { count, error } = await sb.from('leader_followups').select('id', { count: 'exact', head: true })
      .eq('teacher_id', currentUser.id).not('answered_at', 'is', null).is('seen_at', null);
    if(error) throw error;
    n = count || 0;
  } catch(_){ n = 0; }
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.style.display = n > 0 ? 'flex' : 'none';
  lfState.unseen = n;
  if(typeof syncAcctDot === 'function') syncAcctDot();
  const tile = document.getElementById('lfHomeBadge');
  if(tile){ tile.textContent = badge.textContent; tile.style.display = n > 0 ? 'inline-flex' : 'none'; }
}

if(typeof document.addEventListener === 'function'){
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') refreshLeaderBadge(); });
}

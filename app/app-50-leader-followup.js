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
const LF_STATUS_LABELS = { answered: 'أُجيب', sent: 'أُرسل', ready: 'لم يُرسل', expired: 'انتهت مدته', revoked: 'رابطه مُلغى' };
const LF_COLS = 'id, series_id, leader_role, leader_name, cycle_label, sender_name, indicators, slots, code, closes_at, sent_at, answered_at, seen_at, answers, chosen_slot, draft, draft_saved_at, created_at';

let lfState = { list: null, loading: false, sel: null, create: null, busy: false };

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

function lfNewCreate(from){
  return { series_id: from ? from.series_id : null, role: from ? from.leader_role : 'principal', name: from && from.leader_name ? from.leader_name : '',
    cycle: '', indicators: from ? (from.indicators || []).map(i => i.label) : [''], slots: [], days: 7, busy: false };
}

/* يُرجع { ok, indicators, slots } بعد إسقاط الفارغ والتحقق بمدقق leader-kit.js، أو { ok:false, msg } */
function lfValidateCreate(c){
  const labels = c.indicators.map(x => String(x).trim()).filter(Boolean);
  const iv = leaderValidateIndicators(labels.map((label, i) => ({ id: 'i' + (i + 1), label })));
  if(!iv.ok) return { ok: false, msg: labels.length ? 'تحقق من نص المؤشرات (حتى 150 حرفًا لكل مؤشر، وحتى 15 مؤشرًا).' : 'أضف مؤشرًا واحدًا على الأقل.' };
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
  if(screen === 'home' || screen === 'list' || screen === 'leaders'){ lfState.create = null; lfState.sel = null; }
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
  toolsGo('ldetail');
  lfMarkSeen(id);
}

function lfStartCreate(fromId){
  const from = fromId && lfState.list ? lfState.list.find(x => x.id === fromId) : null;
  lfState.create = lfNewCreate(from);
  toolsGo('lcreate');
}

/* ============ الرسم ============ */

function lfRender(screen){
  const body = document.getElementById('toolsBody');
  if(!body) return;
  if(screen === 'lcreate'){ toolsSetTitle(lfState.create && lfState.create.series_id ? 'الدورة التالية' : 'طلب متابعة جديد'); body.innerHTML = lfCreateHtml(); }
  else if(screen === 'ldetail'){ toolsSetTitle('طلب المتابعة'); body.innerHTML = lfDetailHtml(); }
  else { toolsSetTitle('متابعة المؤشرات'); body.innerHTML = lfListHtml(); }
}

function lfChip(status){
  return `<span class="lf-chip lf-${status}">${escapeHtml(LF_STATUS_LABELS[status])}</span>`;
}

function lfListHtml(){
  if(lfState.loading && !lfState.list) return toolsBackLink('الأدوات', 'home') + '<div class="sv-empty">جارٍ التحميل…</div>';
  const list = lfState.list || [];
  let body;
  if(!list.length){
    body = `<div class="sv-card sv-center"><div class="sv-ico" aria-hidden="true">★</div><h2>لا توجد طلبات متابعة بعد</h2><p>أنشئ طلبًا لمدير المدرسة أو أحد الوكلاء بمؤشراتك، وأرسل له رابطًا يجيب منه مرة واحدة ويختار موعد اللقاء.</p></div>`;
  } else {
    body = lfGroupSeries(list).map(s => {
      const r = s.items[0], st = lfStatus(r);
      const fresh = list.some(x => x.series_id === s.id && x.answered_at && !x.seen_at);
      const c = lfCounts(r);
      const meta = st === 'answered'
        ? `${c.done} منفذ · ${c.wip} قيد التنفيذ · ${c.no} لم ينفذ`
        : (lfDraftProgress(r) ? `بدأ الإجابة: ${lfDraftProgress(r).done} من ${lfDraftProgress(r).total} (لم يُسلِّم بعد)` : (s.items.length > 1 ? 'الدورة الحالية بانتظار الإجابة' : 'بانتظار الإجابة'));
      return `<button type="button" class="tl-tile" style="border-right-color:#876A25" onclick="lfOpen('${escapeHtml(r.id)}')"><span class="tl-tile-main"><b>${escapeHtml(lfLeaderTitle(r))}${fresh ? ' <span class="lf-new">جديد</span>' : ''}</b><small>${escapeHtml(r.cycle_label)} · ${escapeHtml(meta)}</small></span>${lfChip(st)}<span class="tl-chev" aria-hidden="true">‹</span></button>`;
    }).join('');
  }
  return `${toolsBackLink('الأدوات', 'home')}${body}
    <div class="tl-actions"><button type="button" class="btn btn-primary tl-new" onclick="lfStartCreate(null)">＋ طلب متابعة جديد</button></div>`;
}

function lfCreateHtml(){
  const c = lfState.create;
  if(!c) return toolsBackLink('المتابعة', 'leaders');
  const roles = Object.keys(LEADER_ROLES).map(k => `<button type="button" class="tl-chip-btn${c.role === k ? ' is-on' : ''}" aria-pressed="${c.role === k}" onclick="lfPickRole('${k}')">${escapeHtml(LEADER_ROLES[k])}</button>`).join('');
  const inds = c.indicators.map((t, i) => `<div class="lf-row"><input class="goal-input" type="text" maxlength="${LEADER_LIMITS.maxLabel}" aria-label="المؤشر ${i + 1}" value="${escapeHtml(t)}" placeholder="نص المؤشر" oninput="lfSetInd(${i}, this.value)"><button type="button" class="tl-mv" aria-label="حذف المؤشر" onclick="lfRemoveInd(${i})"${c.indicators.length < 2 ? ' disabled' : ''}>✕</button></div>`).join('');
  const slots = c.slots.map((t, i) => `<div class="lf-row"><input class="goal-input" type="datetime-local" aria-label="الموعد ${i + 1}" value="${escapeHtml(t)}" oninput="lfSetSlot(${i}, this.value)"><button type="button" class="tl-mv" aria-label="حذف الموعد" onclick="lfRemoveSlot(${i})">✕</button></div>`).join('');
  const days = LF_DAYS.map(d => `<button type="button" class="tl-day${c.days === d ? ' is-on' : ''}" aria-pressed="${c.days === d}" onclick="lfPickDays(${d})">${d === 7 ? '7 أيام' : d + ' يومًا'}</button>`).join('');
  const prev = lfState.list && lfState.list.length && !c.series_id
    ? `<div class="tl-field"><label for="lfCopyFrom">نسخ المؤشرات من طلب سابق (اختياري)</label><select id="lfCopyFrom" class="goal-input" onchange="lfCopyFrom(this.value)"><option value="">—</option>${lfState.list.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(lfLeaderTitle(r) + ' · ' + r.cycle_label)}</option>`).join('')}</select></div>` : '';
  return `${toolsBackLink(c.series_id ? 'الطلب' : 'المتابعة', c.series_id ? 'ldetail' : 'leaders')}
    <div class="tl-field"><span class="tl-label">المسؤول</span><div class="tl-chips">${roles}</div></div>
    <div class="tl-field"><label for="lfName">اسمه (اختياري)</label><input id="lfName" class="goal-input" type="text" maxlength="${LEADER_LIMITS.maxName}" value="${escapeHtml(c.name)}" oninput="lfSetField('name', this.value)"></div>
    <div class="tl-field"><label for="lfCycle">الدورة</label><input id="lfCycle" class="goal-input" type="text" maxlength="${LEADER_LIMITS.maxCycle}" placeholder="مثل: الفصل الدراسي الأول" value="${escapeHtml(c.cycle)}" oninput="lfSetField('cycle', this.value)"></div>
    ${prev}
    <div class="tl-field"><span class="tl-label">المؤشرات</span>${inds}<button type="button" class="btn btn-outline lf-full" onclick="lfAddInd()"${c.indicators.length >= LEADER_LIMITS.maxIndicators ? ' disabled' : ''}>＋ مؤشر</button></div>
    <div class="tl-field"><span class="tl-label">أوقات مقترحة للقاء (يختار منها)</span>${slots}<button type="button" class="btn btn-outline lf-full" onclick="lfAddSlot()"${c.slots.length >= LEADER_LIMITS.maxSlots ? ' disabled' : ''}>＋ موعد</button></div>
    <div class="tl-field"><span class="tl-label">ينتهي الرابط بعد</span><div class="tl-days">${days}</div></div>
    <button type="button" class="btn btn-primary tl-create" id="lfCreateBtn" onclick="lfCreate()"${lfCreateReady(c) ? '' : ' disabled'}>إنشاء الطلب وتجهيز الرابط</button>
    <p class="tl-note">لا يُرسل شيء حتى تضغط واتساب أو نسخ الرابط بنفسك. المؤشرات والأوقات تتجمّد بعد أول إرسال.</p>`;
}

function lfAnswersHtml(r){
  const prev = lfPrevStates(lfState.list || [], r);
  const a = r.answers || {};
  const rows = (r.indicators || []).map(ind => {
    const x = a[ind.id] || {};
    const was = prev[ind.label];
    const trend = was && was !== x.s ? `<small class="lf-trend">الدورة السابقة: ${escapeHtml(LEADER_ANSWER_STATES[was] || '')}</small>` : '';
    return `<div class="lf-ans"><div class="lf-ans-head"><span>${escapeHtml(ind.label)}</span><span class="lf-chip lf-s-${escapeHtml(x.s || 'none')}">${escapeHtml(LEADER_ANSWER_STATES[x.s] || '—')}</span></div>${x.r ? `<small>${escapeHtml(x.r)}</small>` : ''}${trend}</div>`;
  }).join('');
  const c = lfCounts(r);
  let slot = '';
  if(r.slots && r.slots.length){
    slot = r.chosen_slot === 'none' ? 'لم يناسبه أي موعد من المقترحة — حدّد معه موعدًا آخر' : (r.chosen_slot ? 'موعد اللقاء: ' + leaderSlotLabel(r.chosen_slot) : '');
  }
  return `<div class="lf-sum"><div><b class="lf-ok">${c.done}</b><small>منفذ</small></div><div><b class="lf-wip">${c.wip}</b><small>قيد التنفيذ</small></div><div><b class="lf-no">${c.no}</b><small>لم ينفذ</small></div></div>
    ${rows}${slot ? `<div class="tl-info"><b>${escapeHtml(slot)}</b></div>` : ''}`;
}

function lfDetailHtml(){
  const r = lfState.list && lfState.list.find(x => x.id === lfState.sel);
  if(!r) return toolsBackLink('المتابعة', 'leaders') + '<div class="sv-empty">الطلب غير موجود.</div>';
  const st = lfStatus(r), busy = lfState.busy ? ' disabled' : '';
  const history = lfGroupSeries(lfState.list).find(s => s.id === r.series_id).items.filter(x => x.id !== r.id)
    .map(x => `<button type="button" class="tl-tile" style="border-right-color:#D8D2C4" onclick="lfOpen('${escapeHtml(x.id)}')"><span class="tl-tile-main"><b>${escapeHtml(x.cycle_label)}</b></span>${lfChip(lfStatus(x))}<span class="tl-chev" aria-hidden="true">‹</span></button>`).join('');
  let main;
  const del = `<button type="button" class="btn btn-outline lf-full lf-del" onclick="lfDelete('${escapeHtml(r.id)}')"${busy}>حذف الطلب</button>`;
  if(st === 'answered'){
    main = lfAnswersHtml(r) + del;
  } else {
    const live = st === 'ready' || st === 'sent';
    const link = r.code ? lfLink(r.code, location.origin) : '';
    const closes = new Date(r.closes_at);
    const linkBox = live ? `<div class="tl-info"><small>رابط شخصي يقبل إجابة واحدة${r.sent_at ? ' · أُرسل' : ''}</small><div class="lf-link" dir="ltr">${escapeHtml(link)}</div></div>
      <a class="btn btn-primary lf-wa lf-full" href="${escapeHtml('https://wa.me/?text=' + encodeURIComponent(lfWaText(r, link)))}" target="_blank" rel="noopener" onclick="lfMarkSent('${escapeHtml(r.id)}')">إرسال عبر واتساب</a>
      <button type="button" class="btn btn-outline lf-full" onclick="lfCopyLink('${escapeHtml(r.id)}')"${busy}>نسخ الرابط</button>
      <div class="lf-btns"><button type="button" class="btn btn-outline" onclick="lfExtend('${escapeHtml(r.id)}')"${busy}>تمديد 7 أيام</button><button type="button" class="btn btn-outline" onclick="lfRevoke('${escapeHtml(r.id)}')"${busy}>إلغاء الرابط</button></div>` : `<div class="tl-info"><b>${st === 'expired' ? 'انتهت مدة الرابط' : 'أُلغي الرابط'}</b><small>أصدر رابطًا جديدًا إن أردت إرساله مرة أخرى.</small></div>
      <button type="button" class="btn btn-primary lf-full" onclick="lfReissue('${escapeHtml(r.id)}')"${busy}>إصدار رابط جديد (7 أيام)</button>`;
    const inds = `<div class="tl-info"><b>المؤشرات (${(r.indicators || []).length})</b><small>${(r.indicators || []).map(i => escapeHtml(i.label)).join('<br>')}</small></div>`;
    const slots = (r.slots || []).length ? `<div class="tl-info"><b>أوقات اللقاء المقترحة</b><small>${r.slots.map(s => escapeHtml(leaderSlotLabel(s))).join('<br>')}</small></div>` : '';
    const dp = lfDraftProgress(r);
    const draft = dp ? `<div class="tl-info lf-draft"><b>بدأ المسؤول الإجابة ولم يُسلِّم بعد</b><small>حدّد ${dp.done} من ${dp.total} مؤشرات${r.draft_saved_at ? ' · آخر حفظ ' + escapeHtml(leaderDateLabel(r.draft_saved_at)) : ''}. تصلك النتيجة عند التسليم.</small></div>` : '';
    main = `${draft}${inds}${slots}${linkBox}<small class="tl-note">ينتهي ${escapeHtml(isNaN(closes) ? '' : closes.toLocaleDateString('ar', { day: 'numeric', month: 'long' }))}</small>${del}`;
  }
  return `${toolsBackLink('المتابعة', 'leaders')}
    <div class="tl-info lf-head"><b>${escapeHtml(lfLeaderTitle(r))}</b><small>${escapeHtml(r.cycle_label)}</small>${lfChip(st)}</div>
    ${main}
    <button type="button" class="btn btn-outline lf-full" onclick="lfStartCreate('${escapeHtml(r.id)}')">إصدار الدورة التالية لنفس المسؤول</button>
    ${history ? `<div class="tl-group"><div class="tl-group-head">الدورات الأخرى</div>${history}</div>` : ''}`;
}

/* ============ تحرير نموذج الإنشاء (بلا إعادة رسم أثناء الكتابة حتى لا يفقد الحقل تركيزه) ============ */

function lfSyncCreateBtn(){
  const btn = document.getElementById('lfCreateBtn');
  if(btn) btn.disabled = !lfCreateReady(lfState.create);
}
function lfSetField(k, v){ const c = lfState.create; if(!c) return; c[k] = String(v); lfSyncCreateBtn(); }
function lfSetInd(i, v){ const c = lfState.create; if(!c || i >= c.indicators.length) return; c.indicators[i] = String(v); lfSyncCreateBtn(); }
function lfSetSlot(i, v){ const c = lfState.create; if(!c || i >= c.slots.length) return; c.slots[i] = String(v); lfSyncCreateBtn(); }
function lfAddInd(){ const c = lfState.create; if(!c || c.indicators.length >= LEADER_LIMITS.maxIndicators) return; c.indicators.push(''); renderTools(); }
function lfRemoveInd(i){ const c = lfState.create; if(!c || c.indicators.length < 2) return; c.indicators.splice(i, 1); renderTools(); }
function lfAddSlot(){ const c = lfState.create; if(!c || c.slots.length >= LEADER_LIMITS.maxSlots) return; c.slots.push(''); renderTools(); }
function lfRemoveSlot(i){ const c = lfState.create; if(!c) return; c.slots.splice(i, 1); renderTools(); }
function lfPickRole(k){ const c = lfState.create; if(!c || !LEADER_ROLES[k]) return; c.role = k; renderTools(); }
function lfPickDays(d){ const c = lfState.create; if(!c || LF_DAYS.indexOf(d) < 0) return; c.days = d; renderTools(); }
function lfCopyFrom(id){
  const c = lfState.create; const r = lfState.list && lfState.list.find(x => x.id === id);
  if(!c || !r) return;
  c.indicators = (r.indicators || []).map(i => i.label);
  renderTools();
}

/* ============ الإنشاء ============ */

async function lfCreate(){
  const c = lfState.create;
  if(!c || c.busy || !currentUser) return;
  const v = lfValidateCreate(c);
  if(!v.ok){ showToast(v.msg, 'error'); return; }
  const token = toolsState.token;
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

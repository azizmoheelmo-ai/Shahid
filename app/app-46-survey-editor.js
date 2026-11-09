/* ============================================================
   محرّر أسئلة الاستبانة + اختيار مستلمي الاستبانة المخصّصة (المرحلة 2 — SURVEYS.md)
   ------------------------------------------------------------
   - شاشات داخل toolsView (app-45): «الأسئلة» (بلاطة لكل سؤال: تحريك/تعديل/حذف) و«إضافة/تعديل سؤال» (النوع ببلاطات)
     و«المستلمون» (طلاب بأعينهم + جهة أخرى بالاسم والرقم).
   - أربعة أنواع: تقييم 1–5، صح/خطأ، اختيار من خيارات، نص حر. الحدود (12 سؤالًا، 120 حرفًا، 2–8 خيارات) من
     SURVEY_LIMITS، والحَكَم الوحيد على صحة الأسئلة surveyValidateQuestions (نفسه بالخادم): لا مدقّق ثانٍ هنا.
   - الأسئلة تتجمّد بعد أول إرسال (تريجر بالقاعدة)؛ التعديل بعد الإنشاء مسموح قبل الإرسال فقط، وخطأ القاعدة يُعرض نصه.
   - الأسئلة هنا نسخة عمل (qed.questions) لا تُكتب لقاعدة البيانات إلا عند «تم» (بوضع التعديل) أو عند إنشاء الاستبانة.
   - أرقام «الجهة الأخرى» تُطبَّع بـnormalizePhone (app-42)، وتُحفظ بتذكرة الاستبانة وحدها وبنسخة المعلم الاحتياطية.
   ============================================================ */

const TQ_TYPES = {
  rating: { label: 'تقييم', hint: 'من 1 إلى 5' },
  truefalse: { label: 'صح / خطأ', hint: 'زرّان كبيران' },
  choice: { label: 'اختيار', hint: 'من خيارات تكتبها' },
  text: { label: 'نص حر', hint: 'يكتب ما يشاء' }
};
const TQ_ERRORS = {
  count: 'من 1 إلى 12 سؤالًا',
  bad_label: 'نص السؤال مطلوب (حتى 120 حرفًا، بلا رموز تحكم)',
  bad_options: 'الاختيار يحتاج من 2 إلى 8 خيارات، كل خيار حتى 40 حرفًا',
  options_not_allowed: 'الخيارات للاختيار فقط'
};
const TQ_OTHER_MAX = 200; /* سقف الجهات الأخرى بالاستبانة الواحدة */
const TQ_RECIP_LIST_MAX = 40;

/* ============ دوال صرفة ============ */

function toolsNextQuestionId(list){
  const used = new Set(list.map(q => q.id));
  for(let n = 1; n <= 99; n++){ if(!used.has('q' + n)) return 'q' + n; }
  return null;
}

/* تحريك سؤال خطوة (نسخة جديدة، والأصلية لا تتغيّر)؛ null إن لم يمكن */
function toolsMoveQuestion(list, i, dir){
  const j = i + dir;
  if(i < 0 || i >= list.length || j < 0 || j >= list.length) return null;
  const out = list.slice();
  const t = out[i]; out[i] = out[j]; out[j] = t;
  return out;
}

function toolsQuestionErrorText(code){
  const key = String(code || '').split(':')[0];
  return TQ_ERRORS[key] || 'الأسئلة غير صالحة — راجع النص والخيارات';
}

/* السؤال من المسودة بالصيغة التي يقبلها المدقّق: نصوص مقصوصة، وخيارات فارغة تُهمل، وخيارات للاختيار وحده */
function toolsBuildQuestion(draft, id){
  const q = { id, type: draft.type, label: String(draft.label || '').trim(), required: !!draft.required };
  if(draft.type === 'choice') q.options = (draft.options || []).map(o => String(o || '').trim()).filter(Boolean);
  return q;
}

function toolsRecipCount(recips, students){
  let links = 0, picked = 0;
  Object.keys(recips.students).forEach(sid => {
    const st = students.find(s => s.id === sid);
    if(!st) return;
    const r = recips.students[sid];
    const n = (r.guardian && st.guardian_phone ? 1 : 0) + (r.student && st.student_phone ? 1 : 0);
    if(n){ picked++; links += n; }
  });
  return { students: picked, others: recips.others.length, links: links + recips.others.length };
}

/* ============ الأسئلة ============ */

/* mode: 'create' (نسخة العمل تعود لشاشة الإنشاء) أو 'edit' (تُحفظ بالاستبانة القائمة قبل أول إرسال) */
function toolsEditQuestions(mode, campaignId, questions, title){
  const src = mode === 'create' ? (toolsState.create ? toolsState.create.questions : []) : (questions || []);
  toolsState.qed = { mode, campaignId: campaignId || null, title: title || '', questions: JSON.parse(JSON.stringify(src)), draft: null, error: '', busy: false };
  toolsState.token++;
  toolsState.screen = 'questions';
  renderTools();
}

function toolsQuestionsHtml(){
  const e = toolsState.qed;
  if(!e) return toolsBackLink('الاستبانات', 'list');
  const lim = SURVEY_LIMITS;
  const tiles = e.questions.length ? e.questions.map((q, i) => {
    const t = TQ_TYPES[q.type] || { label: q.type };
    return `<div class="tq-tile"><div class="tq-n" aria-hidden="true">${i + 1}</div>
      <div class="tq-main"><span class="tq-label">${escapeHtml(q.label)}</span><span class="tq-chip tq-${escapeHtml(q.type)}">${escapeHtml(t.label)}${q.required ? '' : ' · اختياري'}</span></div>
      <div class="tq-acts">
        <button type="button" class="tl-mv" aria-label="للأعلى" onclick="toolsQMove(${i},-1)"${i === 0 ? ' disabled' : ''}>▲</button>
        <button type="button" class="tl-mv" aria-label="للأسفل" onclick="toolsQMove(${i},1)"${i === e.questions.length - 1 ? ' disabled' : ''}>▼</button>
        <button type="button" class="tl-mv tq-txt" onclick="toolsQEdit(${i})">تعديل</button>
        <button type="button" class="tl-mv tq-del" aria-label="حذف السؤال" onclick="toolsQDelete(${i})">✕</button>
      </div></div>`;
  }).join('') : '<div class="sv-empty">لا أسئلة بعد — أضف سؤالك الأول.</div>';
  const full = e.questions.length >= lim.maxQuestions;
  return `${toolsBackLink('رجوع بلا حفظ', e.mode === 'create' ? 'create' : 'list')}
    <div class="tl-hint">تتجمّد الأسئلة عند أول إرسال حتى لا تختلط الردود. لتغييرها بعدها انسخ الاستبانة وعدّل النسخة.</div>
    <div class="tq-count">${e.questions.length} من ${lim.maxQuestions}</div>
    <div class="tq-list">${tiles}</div>
    ${e.error ? `<p class="tq-err" role="alert">${escapeHtml(e.error)}</p>` : ''}
    <div class="tl-actions"><button type="button" class="btn btn-outline tl-new" onclick="toolsQAdd()"${full ? ' disabled' : ''}>＋ إضافة سؤال</button>
    <button type="button" class="btn btn-primary tl-sort" id="toolsQDoneBtn" onclick="toolsQuestionsDone()"${e.busy ? ' disabled' : ''}>تم</button></div>`;
}

function toolsQMove(i, dir){
  const e = toolsState.qed; if(!e) return;
  const out = toolsMoveQuestion(e.questions, i, dir);
  if(out){ e.questions = out; e.error = ''; renderTools(); }
}

function toolsQDelete(i){
  const e = toolsState.qed; if(!e || i < 0 || i >= e.questions.length) return;
  e.questions.splice(i, 1);
  e.error = '';
  renderTools();
}

function toolsQAdd(){
  const e = toolsState.qed; if(!e) return;
  if(e.questions.length >= SURVEY_LIMITS.maxQuestions){ showToast('الحد الأقصى ' + SURVEY_LIMITS.maxQuestions + ' سؤالًا', 'error'); return; }
  e.draft = { index: null, type: 'rating', label: '', required: true, options: ['', ''] };
  e.error = '';
  toolsState.screen = 'qedit';
  renderTools();
}

function toolsQEdit(i){
  const e = toolsState.qed; if(!e || i < 0 || i >= e.questions.length) return;
  const q = e.questions[i];
  e.draft = { index: i, type: q.type, label: q.label, required: !!q.required, options: q.type === 'choice' ? q.options.slice() : ['', ''] };
  e.error = '';
  toolsState.screen = 'qedit';
  renderTools();
}

function toolsQeditHtml(){
  const e = toolsState.qed;
  if(!e || !e.draft) return toolsBackLink('الأسئلة', 'questions');
  const d = e.draft;
  const types = Object.keys(TQ_TYPES).map(k => `<button type="button" class="tl-opt${d.type === k ? ' is-on' : ''}" aria-pressed="${d.type === k}" onclick="toolsQSetType('${k}')"><b>${escapeHtml(TQ_TYPES[k].label)}</b><small>${escapeHtml(TQ_TYPES[k].hint)}</small></button>`).join('');
  const opts = d.type === 'choice' ? `<div class="tl-field"><span class="tl-label">الخيارات</span>
    ${d.options.map((o, i) => `<div class="tq-opt"><input class="goal-input" type="text" maxlength="${SURVEY_LIMITS.maxOption}" value="${escapeHtml(o)}" aria-label="الخيار ${i + 1}" oninput="toolsQSetOption(${i},this.value)"><button type="button" class="tl-mv tq-del" aria-label="حذف الخيار" onclick="toolsQRemoveOption(${i})"${d.options.length <= 2 ? ' disabled' : ''}>✕</button></div>`).join('')}
    <button type="button" class="tl-chip-btn" onclick="toolsQAddOption()"${d.options.length >= SURVEY_LIMITS.maxOptions ? ' disabled' : ''}>＋ خيار</button></div>` : '';
  return `${toolsBackLink('رجوع بلا حفظ', 'questions')}
    <div class="tl-field"><span class="tl-label">نوع السؤال</span><div class="tl-opts">${types}</div></div>
    <div class="tl-field"><label for="tqLabel">نص السؤال</label><input id="tqLabel" class="goal-input" type="text" maxlength="${SURVEY_LIMITS.maxLabel}" value="${escapeHtml(d.label)}" oninput="toolsQSetLabel(this.value)"></div>
    ${opts}
    <button type="button" class="tq-req${d.required ? ' is-on' : ''}" role="switch" aria-checked="${d.required}" onclick="toolsQToggleRequired()"><span><b>إجباري</b><small>لا يُرسل الرد قبل الإجابة عنه</small></span><i aria-hidden="true"></i></button>
    ${e.error ? `<p class="tq-err" role="alert">${escapeHtml(e.error)}</p>` : ''}
    <div class="tl-actions"><button type="button" class="btn btn-primary tl-new" onclick="toolsQSave()">حفظ السؤال</button><button type="button" class="btn btn-outline tl-sort" onclick="toolsGo('questions')">إلغاء</button></div>`;
}

function toolsQSetType(t){
  const e = toolsState.qed; if(!e || !e.draft || !TQ_TYPES[t]) return;
  e.draft.type = t;
  e.draft.required = t !== 'text';
  if(t === 'choice' && e.draft.options.length < 2) e.draft.options = ['', ''];
  renderTools();
}
function toolsQSetLabel(v){ const e = toolsState.qed; if(e && e.draft) e.draft.label = String(v).slice(0, SURVEY_LIMITS.maxLabel); }
function toolsQSetOption(i, v){ const e = toolsState.qed; if(e && e.draft && i >= 0 && i < e.draft.options.length) e.draft.options[i] = String(v).slice(0, SURVEY_LIMITS.maxOption); }
function toolsQAddOption(){ const e = toolsState.qed; if(!e || !e.draft || e.draft.options.length >= SURVEY_LIMITS.maxOptions) return; e.draft.options.push(''); renderTools(); }
function toolsQRemoveOption(i){ const e = toolsState.qed; if(!e || !e.draft || e.draft.options.length <= 2) return; e.draft.options.splice(i, 1); renderTools(); }
function toolsQToggleRequired(){ const e = toolsState.qed; if(!e || !e.draft) return; e.draft.required = !e.draft.required; renderTools(); }

function toolsQSave(){
  const e = toolsState.qed; if(!e || !e.draft) return;
  const d = e.draft;
  const id = d.index == null ? toolsNextQuestionId(e.questions) : e.questions[d.index].id;
  if(!id){ e.error = 'لا مجال لسؤال جديد'; renderTools(); return; }
  const q = toolsBuildQuestion(d, id);
  const next = e.questions.slice();
  if(d.index == null) next.push(q); else next[d.index] = q;
  const v = surveyValidateQuestions(next);
  if(!v.ok){ e.error = toolsQuestionErrorText(v.error); renderTools(); return; }
  e.questions = v.value;
  e.draft = null;
  e.error = '';
  toolsGo('questions');
}

/* «تم»: بوضع الإنشاء تعود النسخة لحالة الإنشاء؛ وبوضع التعديل تُحفظ بالاستبانة (التريجر يمنع ما بعد أول إرسال) */
async function toolsQuestionsDone(){
  const e = toolsState.qed; if(!e || e.busy) return;
  const v = surveyValidateQuestions(e.questions);
  if(!v.ok){ e.error = toolsQuestionErrorText(v.error); renderTools(); return; }
  if(e.mode === 'create'){
    if(toolsState.create){ toolsState.create.questions = v.value; toolsState.create.qTouched = true; }
    toolsState.qed = null;
    toolsGo('create');
    return;
  }
  const token = toolsState.token;
  const cid = e.campaignId;
  e.busy = true;
  const btn = document.getElementById('toolsQDoneBtn');
  if(btn) btn.disabled = true;
  try{
    const { error } = await sb.from('survey_campaigns').update({ questions: v.value }).eq('teacher_id', currentUser.id).eq('id', cid);
    if(error) throw error;
  } catch(err){
    e.busy = false;
    e.error = err && err.message ? err.message : 'تعذّر الحفظ';
    if(toolsStillHere(token, 'questions')) renderTools();
    return;
  }
  e.busy = false;
  if(!toolsStillHere(token, 'questions')) return;
  toolsState.qed = null;
  showToast('حُفظت الأسئلة', 'ok');
  toolsGo('list');
  openSurvey(cid);
}

/* ============ المستلمون (للاستبانة المخصّصة) ============ */

/* الهدف الذي يُحرَّر: حالة الإنشاء (create) أو إضافة لاستبانة قائمة (add: التذاكر الموجودة مقفلة لا تُحذف) */
function toolsRecipsCtx(){
  const ui = toolsState.recipsUi;
  if(!ui) return null;
  return ui.mode === 'add' ? toolsState.addR : toolsState.create;
}

/* ما للاستبانة من تذاكر الآن: طالب بجهته، ورقم جهة أخرى (لا تُكرَّر ولا تُحذف من هنا) */
function toolsExistingRecips(invites){
  const students = new Set(), phones = new Set();
  (invites || []).forEach(i => {
    if(i.recipient === 'other') { if(i.contact_phone) phones.add(i.contact_phone); }
    else if(i.student_id) students.add(i.student_id + '|' + i.recipient);
  });
  return { students, phones };
}

function toolsEditRecips(){
  if(!toolsState.create) return;
  toolsState.recipsUi = { mode: 'create', query: '', sec: 'all', error: '' };
  toolsState.token++;
  toolsState.screen = 'recips';
  renderTools();
}

/* إضافة مستلمين لاستبانة مخصّصة قائمة (مفتوحة): تُضاف تذاكر جديدة فقط، والقديمة بحالتها وإرسالها كما هي */
function toolsAddRecipients(campaignId, title, invites){
  toolsState.addR = { campaignId, title: title || '', recips: { students: {}, others: [] }, existing: toolsExistingRecips(invites), busy: false };
  toolsState.recipsUi = { mode: 'add', query: '', sec: 'all', error: '' };
  toolsState.token++;
  toolsState.screen = 'recips';
  renderTools();
}

function toolsRecipsListHtml(){
  const c = toolsRecipsCtx(), ui = toolsState.recipsUi;
  const ex = ui.mode === 'add' ? c.existing : null;
  const q = String(ui.query || '').trim();
  let list = crmStudents.filter(s => s.is_active !== false && (ui.sec === 'all' || s.section_id === ui.sec) && (!q || String(s.full_name).indexOf(q) !== -1));
  list.sort((a, b) => crmByArabic(a.full_name, b.full_name));
  const total = list.length;
  list = list.slice(0, TQ_RECIP_LIST_MAX);
  if(!list.length) return '<div class="sv-empty">لا نتائج.</div>';
  const rows = list.map(s => {
    const r = c.recips.students[s.id] || {};
    const tog = (who, label, phone) => {
      const locked = !!(ex && ex.students.has(s.id + '|' + who));
      if(locked) return `<button type="button" class="tl-chip-btn tq-who is-on" aria-pressed="true" disabled>${label} ✓ مضاف</button>`;
      return `<button type="button" class="tl-chip-btn tq-who${r[who] ? ' is-on' : ''}" aria-pressed="${!!r[who]}" onclick="toolsRecipToggle('${escapeHtml(s.id)}','${who}')"${phone ? '' : ' disabled'}>${label}${phone ? '' : ' (بلا رقم)'}</button>`;
    };
    return `<div class="tq-stu"><span class="tq-stu-name"><b>${escapeHtml(s.full_name)}</b><small>${escapeHtml(s.section_id ? crmSectionLabel(s.section_id) : '')}</small></span><span class="tq-who-row">${tog('guardian', 'ولي الأمر', s.guardian_phone)}${tog('student', 'الطالب', s.student_phone)}</span></div>`;
  }).join('');
  return rows + (total > list.length ? `<p class="tl-note">يُعرض أول ${TQ_RECIP_LIST_MAX} من ${total} — ضيّق بالبحث أو بالشعبة.</p>` : '');
}

function toolsRecipsHtml(){
  const c = toolsRecipsCtx(), ui = toolsState.recipsUi;
  if(!c || !ui) return toolsBackLink('الاستبانات', 'list');
  const add = ui.mode === 'add';
  const cnt = toolsRecipCount(c.recips, crmStudents);
  const secs = [['all', 'كل الشعب']].concat(crmSections.slice().sort((a, b) => crmByArabic(crmSectionOptionLabel(a), crmSectionOptionLabel(b))).map(s => [s.id, crmSectionOptionLabel(s)]));
  const chips = secs.map(x => `<button type="button" class="sv-chip2${ui.sec === x[0] ? ' is-on' : ''}" onclick="toolsRecipsSec('${escapeHtml(x[0])}')">${escapeHtml(x[1])}</button>`).join('');
  const others = c.recips.others.map((o, i) => `<div class="tq-other"><span><b>${escapeHtml(o.label)}</b><small dir="ltr">${escapeHtml(typeof phoneDisplay === 'function' ? phoneDisplay(o.phone) : o.phone)}</small></span><button type="button" class="tl-mv tq-del" aria-label="حذف" onclick="toolsRecipRemoveOther(${i})">✕</button></div>`).join('');
  const back = add
    ? `<button type="button" class="tl-back" onclick="toolsCancelAddRecips()"><span aria-hidden="true">›</span> رجوع بلا إضافة</button>`
    : toolsBackLink('رجوع للإنشاء', 'create');
  const summary = add ? `${cnt.links} ${cnt.links === 1 ? 'رابط جديد' : 'روابط جديدة'}` : `${cnt.links} ${cnt.links === 1 ? 'رابط' : 'روابط'}`;
  const doneLabel = add ? 'إضافة المستلمين' : 'تم';
  const doneOn = add ? 'toolsRecipsDone()' : "toolsGo('create')";
  const doneDisabled = add && (cnt.links === 0 || c.busy) ? ' disabled' : '';
  return `${back}
    <div class="tl-info"><b>${summary}</b><small>${cnt.students} ${cnt.students === 1 ? 'طالب' : 'طلاب'} · ${cnt.others} ${cnt.others === 1 ? 'جهة أخرى' : 'جهات أخرى'}${add ? ' — التذاكر الموجودة بحالتها لا تتغيّر' : ''}</small></div>
    <div class="tl-field"><span class="tl-label">طلاب بأعينهم</span>
      <input class="goal-input" id="tqSearch" type="search" placeholder="ابحث بالاسم" value="${escapeHtml(ui.query)}" oninput="toolsRecipsSearch(this.value)">
      <div class="sv-chips">${chips}</div>
      <div id="tqRecList">${toolsRecipsListHtml()}</div></div>
    <div class="tl-field"><span class="tl-label">جهة أخرى</span>
      <input class="goal-input" id="tqOtherName" type="text" maxlength="60" placeholder="الاسم">
      <input class="goal-input" id="tqOtherPhone" type="tel" inputmode="tel" dir="ltr" maxlength="20" placeholder="0501234567" style="text-align:left;">
      ${ui.error ? `<p class="tq-err" role="alert">${escapeHtml(ui.error)}</p>` : ''}
      <button type="button" class="btn btn-outline" onclick="toolsRecipAddOther()"${c.recips.others.length >= TQ_OTHER_MAX ? ' disabled' : ''}>＋ إضافة</button>
      ${others}</div>
    <button type="button" class="btn btn-primary tl-create" id="toolsRecipsDoneBtn" onclick="${doneOn}"${doneDisabled}>${doneLabel}</button>`;
}

function toolsRecipsSearch(v){
  const ui = toolsState.recipsUi; if(!ui) return;
  ui.query = String(v);
  const box = document.getElementById('tqRecList');
  if(box) box.innerHTML = toolsRecipsListHtml(); /* القائمة وحدها: خانة البحث تبقى بتركيزها */
}
function toolsRecipsSec(id){ const ui = toolsState.recipsUi; if(!ui) return; ui.sec = id; renderTools(); }

function toolsRecipToggle(sid, who){
  const c = toolsRecipsCtx(); if(!c || (who !== 'guardian' && who !== 'student')) return;
  const st = crmStudents.find(s => s.id === sid);
  if(!st || !(who === 'guardian' ? st.guardian_phone : st.student_phone)) return;
  if(c.existing && c.existing.students.has(sid + '|' + who)) return; /* مضافة من قبل */
  const r = c.recips.students[sid] = c.recips.students[sid] || {};
  r[who] = !r[who];
  if(!r.guardian && !r.student) delete c.recips.students[sid];
  renderTools();
}

function toolsRecipAddOther(){
  const c = toolsRecipsCtx(), ui = toolsState.recipsUi; if(!c || !ui) return;
  const nameEl = document.getElementById('tqOtherName'), phoneEl = document.getElementById('tqOtherPhone');
  const label = String((nameEl || {}).value || '').trim();
  const p = normalizePhone((phoneEl || {}).value);
  ui.error = '';
  if(!label || label.length > 60) ui.error = 'اكتب الاسم (حتى 60 حرفًا)';
  else if(!p.ok || !p.value) ui.error = p.ok ? 'اكتب رقم الجوال' : p.error;
  else if(c.recips.others.some(o => o.phone === p.value) || (c.existing && c.existing.phones.has(p.value))) ui.error = 'هذا الرقم مضاف';
  else if(c.recips.others.length + (c.existing ? c.existing.phones.size : 0) >= TQ_OTHER_MAX) ui.error = 'بلغت الحد الأقصى';
  else c.recips.others.push({ label, phone: p.value });
  renderTools();
}
function toolsRecipRemoveOther(i){ const c = toolsRecipsCtx(); if(!c || i < 0 || i >= c.recips.others.length) return; c.recips.others.splice(i, 1); renderTools(); }

/* ============ إضافة مستلمين لاستبانة قائمة ============ */

function toolsCancelAddRecips(){
  const a = toolsState.addR;
  const cid = a ? a.campaignId : null;
  toolsState.addR = null;
  toolsGo('list');
  if(cid) openSurvey(cid);
}

async function toolsRecipsDone(){
  const ui = toolsState.recipsUi;
  const a = toolsState.addR;
  if(!ui || ui.mode !== 'add' || !a || a.busy || !currentUser) return;
  const token = toolsState.token;
  const uid = currentUser.id;
  const cid = a.campaignId;
  const rows = toolsCustomInviteRows(a.recips, uid, cid).filter(r => r.recipient === 'other'
    ? !a.existing.phones.has(r.contact_phone)
    : !a.existing.students.has(r.student_id + '|' + r.recipient)); /* لا تذكرة مكررة مهما حدث */
  if(!rows.length){ ui.error = 'لم تختر مستلمًا جديدًا'; renderTools(); return; }
  a.busy = true;
  const btn = document.getElementById('toolsRecipsDoneBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الإضافة…'; }
  try{
    const ins = await sb.from('survey_invites').insert(rows);
    if(ins.error) throw ins.error;
  } catch(err){
    a.busy = false;
    ui.error = err && err.message ? err.message : 'تعذّرت الإضافة';
    if(toolsStillHere(token, 'recips')) renderTools();
    return;
  }
  a.busy = false;
  if(!toolsStillHere(token, 'recips')) return;
  toolsState.addR = null;
  showToast(rows.length === 1 ? 'أُضيف مستلم واحد' : 'أُضيف ' + rows.length + ' مستلمين', 'ok');
  toolsGo('list');
  openSurvey(cid);
}

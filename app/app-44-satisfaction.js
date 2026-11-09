/* ============================================================
   استبانة رضا المستفيدين — شاشة المعلم (التصميم: SURVEYS.md)
   ------------------------------------------------------------
   - المستفيد: ولي الأمر أو الطالب. لكل رقم جوال محفوظ «تذكرة» خاصة به (رابط قصير /s/<رمز> يخدمه api/s.js)
     فيصير للطالب حتى تذكرتان: واحدة لرقم ولي الأمر وأخرى لرقمه هو (وإن تطابق الرقمان فتذكرة واحدة).
     التذكرة تُرسل بواتساب يدويًا وتقبل ردًّا واحدًا؛ والردّ يُحفظ بلا اسم الطالب ولا الجهة.
   - التطبيق يعمل عن المعلم: يبدأ الاستبانة بنقرة، يولّد التذاكر، ويضيف تلقائيًا من يُضاف للشعبة أو يُضاف رقمه لاحقًا،
     ويعلّم «أُرسل» عند فتح واتساب، ويُظهر النتائج وحدها بعد 5 ردود.
   - المعلم يرى من ردّ ومن لم يردّ (للتذكير) ولا يرى ما كتبه أحد: الإجابات بجدول منفصل بلا مرجع للطالب.
   - كل استعلام هنا بتصفية صريحة .eq('teacher_id') (السياسة وحدها لا تكفي بالشاشات الشخصية).
   - لا حذف لحملة فيها ردود: «إغلاق» فقط.
   - الأسئلة ومدقّق الإجابات ومولّد الرمز من ملف واحد مشترك مع الخادم: survey-templates.js (لا نسخة ثانية تنحرف بصمت).
     والقالب يُقرأ من campaign.template: نسخة مجهولة تُعلَن صراحةً ولا تُقرأ خطأً.
   - الشاشة نافذة ملء الشاشة (ليست «عرضًا رئيسيًا»): لا تمسّ hideAllMainViews ولا تتعارض مع الشاشات.
   ============================================================ */

const SURVEY_MIN_RESULTS = 5;
const SV_WHO = { guardian: 'ولي الأمر', student: 'الطالب' };

let svState = null; /* { token, sectionId, campaign, invites, responses, tab, filter, loading, busy, noPhoneOpen } */
let svToken = 0;
let svKeyHandler = null;

/* ============ دوال صرفة ============ */

/* الجهات التي تُرسل إليها تذاكر الطالب: ولي الأمر ثم الطالب؛ وإن تطابق الرقمان فتذكرة واحدة (لولي الأمر) */
function svRecipientsFor(student){
  if(!student) return [];
  const out = [];
  if(student.guardian_phone) out.push({ recipient: 'guardian', phone: student.guardian_phone });
  if(student.student_phone && student.student_phone !== student.guardian_phone) out.push({ recipient: 'student', phone: student.student_phone });
  return out;
}

function svPhoneOfInvite(student, invite){
  if(!student || !invite) return null;
  return (invite.recipient === 'student' ? student.student_phone : student.guardian_phone) || null;
}

function svCampaignOpen(c, nowMs){
  return !!c && c.status === 'open' && new Date(c.closes_at).getTime() > (nowMs == null ? Date.now() : nowMs);
}

function svCounts(invites){
  let answered = 0, sent = 0, unsent = 0;
  invites.forEach(i => { if(i.answered_on) answered++; else if(i.sent_at) sent++; else unsent++; });
  return { total: invites.length, answered, sent, unsent };
}

function svWaMessage(studentName, code, origin, reminder, recipient){
  const url = origin + '/s/' + code;
  const lead = reminder ? 'السلام عليكم، تذكير لطيف بالاستبانة' : 'السلام عليكم، نرجو مشاركتنا رأيكم';
  const about = recipient === 'student' ? 'في تعليمك' : `في تعليم الطالب ${studentName}`;
  return `${lead} ${about} (دقيقتان):\n${url}\nالردّ لا يُربط باسمك، وشكرًا لتعاونكم.`;
}

/* تجميع الإجابات الصالحة حسب القالب. النص يُخلط ترتيبه فلا يدلّ ترتيب الرد على صاحبه. */
function svAggregate(answersList, template, rand){
  const rnd = rand || Math.random;
  return template.questions.map(q => {
    const vals = answersList.map(a => a ? a[q.id] : undefined).filter(v => v !== undefined && v !== null && v !== '');
    const out = { id: q.id, type: q.type, label: q.label, n: vals.length };
    if(q.type === 'rating'){
      out.avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    } else if(q.type === 'truefalse'){
      out.yes = vals.filter(Boolean).length;
      out.pct = vals.length ? Math.round(100 * out.yes / vals.length) : null;
    } else if(q.type === 'choice'){
      out.counts = q.options.map((label, i) => ({ label, count: vals.filter(v => v === i).length }));
    } else if(q.type === 'text'){
      const ts = vals.map(v => String(v).trim()).filter(Boolean);
      for(let i = ts.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); const t = ts[i]; ts[i] = ts[j]; ts[j] = t; }
      out.texts = ts;
      out.n = ts.length;
    }
    return out;
  });
}

/* الردود → { ok, valid, invalid, items } بالمدقّق المشترك نفسه الذي يقبل به الخادم. لا إسقاط صامت: غير الصالح يُعدّ ويُعلَن. */
function svAnalyze(responses, templateKey, rand){
  const tpl = typeof SURVEY_TEMPLATES === 'object' && SURVEY_TEMPLATES ? SURVEY_TEMPLATES[templateKey] : null;
  if(!tpl) return { ok: false, reason: 'unknown-template', valid: 0, invalid: responses.length, items: [] };
  const good = [];
  let invalid = 0;
  responses.forEach(r => {
    const v = r && r.answers ? surveyValidateAnswers(templateKey, r.answers) : { ok: false };
    if(v.ok) good.push(v.value); else invalid++;
  });
  return { ok: true, valid: good.length, invalid, items: svAggregate(good, tpl, rand) };
}

/* أضعف محور تقييم (إن وُجد أكثر من واحد) */
function svWeakestRating(items){
  const rs = items.filter(a => a.type === 'rating' && a.avg != null);
  if(rs.length < 2) return null;
  return rs.reduce((m, a) => a.avg < m.avg ? a : m, rs[0]);
}

function svFmtAvg(v){ return v == null ? '—' : v.toFixed(1); }

/* ============ فتح وإغلاق ============ */

function svStillOpen(token){
  return !!svState && svState.token === token && !!document.getElementById('svBack');
}

async function openSurvey(sectionId){
  if(!currentUser || !sectionId || typeof sectionId !== 'string') return;
  const token = ++svToken;
  svState = { token, sectionId, campaign: null, invites: [], responses: [], tab: 'send', filter: 'all', loading: true, busy: false, noPhoneOpen: false };
  svMount();
  svPaint();
  try{
    await svLoad(token);
  } catch(err){
    if(svStillOpen(token)){ svState.loading = false; svPaint(); }
    showToast('تعذّر فتح الاستبانة: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  }
}

function svMount(){
  svUnmount();
  const back = document.createElement('div');
  back.id = 'svBack';
  back.className = 'sv-back';
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-label', 'استبانة رضا المستفيدين');
  back.innerHTML = '<div class="sv-sheet" id="svSheet"></div>';
  document.body.appendChild(back);
  svKeyHandler = e => { if(e.key === 'Escape' && !document.getElementById('confirmModal').style.display.includes('flex')) closeSurvey(); };
  document.addEventListener('keydown', svKeyHandler);
}

function svUnmount(){
  const el = document.getElementById('svBack');
  if(el && el.parentNode) el.parentNode.removeChild(el);
  if(svKeyHandler){ document.removeEventListener('keydown', svKeyHandler); svKeyHandler = null; }
}

function closeSurvey(){
  svToken++; /* أي استجابة متأخرة لا ترسم ولا تكتب بعد الإغلاق */
  svState = null;
  svUnmount();
}

/* ============ تحميل ومزامنة ============ */

async function svLoad(token){
  const uid = currentUser.id;
  const sectionId = svState.sectionId;
  const { data: camps, error } = await sb.from('survey_campaigns').select('*')
    .eq('teacher_id', uid).eq('section_id', sectionId).order('created_at', { ascending: false }).limit(1);
  if(error) throw error;
  if(!svStillOpen(token)) return;
  svState.campaign = camps && camps[0] ? camps[0] : null;
  if(svState.campaign){
    await svSyncInvites(token);
    if(!svStillOpen(token)) return;
    await svLoadResponses(token);
    if(!svStillOpen(token)) return;
  }
  svState.loading = false;
  svPaint();
}

/* الطلاب النشطون بالشعبة */
function svSectionStudents(){
  return crmStudentsOfSection(svState.sectionId).filter(s => s.is_active !== false);
}

async function svFetchInvites(campaignId){
  const { data, error } = await fetchAllRows((from, to) => sb.from('survey_invites')
    .select('id, student_id, recipient, code, sent_at, answered_on')
    .eq('teacher_id', currentUser.id).eq('campaign_id', campaignId).order('id', { ascending: true }).range(from, to));
  if(error) throw error;
  return data || [];
}

/* تذكرة لكل (طالب، جهة) له رقمها ولا تذكرة له بعد. تتكرر عند كل فتح فتلتقط الطلاب الجدد والأرقام المضافة لاحقًا تلقائيًا. */
async function svSyncInvites(token){
  const c = svState.campaign;
  let invites = await svFetchInvites(c.id);
  if(!svStillOpen(token)) return;
  if(svCampaignOpen(c)){
    const key = (sid, rec) => sid + '|' + rec;
    const have = new Set(invites.map(i => key(i.student_id, i.recipient)));
    const make = () => {
      const rows = [];
      svSectionStudents().forEach(s => svRecipientsFor(s).forEach(r => {
        if(!have.has(key(s.id, r.recipient))) rows.push({ teacher_id: currentUser.id, campaign_id: c.id, student_id: s.id, recipient: r.recipient, code: surveyNewCode() });
      }));
      return rows;
    };
    let rows = make();
    if(rows.length){
      let ins = await sb.from('survey_invites').insert(rows);
      if(ins.error && String(ins.error.code) === '23505'){
        /* سباق من جهاز آخر أو رمز مكرر نادر: نعيد القراءة ونكمل الناقص مرة واحدة */
        invites = await svFetchInvites(c.id);
        if(!svStillOpen(token)) return;
        have.clear(); invites.forEach(i => have.add(key(i.student_id, i.recipient)));
        rows = make();
        ins = rows.length ? await sb.from('survey_invites').insert(rows) : { error: null };
      }
      if(ins.error) throw ins.error;
      if(!svStillOpen(token)) return;
      invites = await svFetchInvites(c.id);
    }
  }
  if(!svStillOpen(token)) return;
  svState.invites = invites;
}

/* كل الردود بلا سقف صامت (صفحات) */
async function svLoadResponses(token){
  if(!svState.invites.some(i => i.answered_on)){ svState.responses = []; return; }
  const campaignId = svState.campaign.id;
  const { data, error } = await fetchAllRows((from, to) => sb.from('survey_responses').select('answers')
    .eq('teacher_id', currentUser.id).eq('campaign_id', campaignId).order('id', { ascending: true }).range(from, to));
  if(error) throw error;
  if(!svStillOpen(token)) return;
  svState.responses = data || [];
}

/* ============ الإجراءات ============ */

async function svStart(){
  if(!svState || svState.busy) return;
  const token = svState.token;
  const btn = document.getElementById('svStartBtn');
  svState.busy = true;
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ التجهيز…'; }
  try{
    const term = crmCurrentTerm();
    const { data, error } = await sb.from('survey_campaigns').insert({
      teacher_id: currentUser.id, section_id: svState.sectionId,
      academic_year: String(term.year || '').slice(0, 20) || getCycleYear(),
      semester_label: term.semester === 2 ? 'الفصل الثاني' : 'الفصل الأول'
    }).select('*').single();
    if(error) throw error;
    if(!svStillOpen(token)) return;
    svState.campaign = data;
    svState.tab = 'send'; svState.filter = 'all'; svState.responses = [];
    await svSyncInvites(token);
    if(!svStillOpen(token)) return;
  } catch(err){
    showToast('تعذّر بدء الاستبانة: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  } finally {
    if(svState && svState.token === token){ svState.busy = false; svPaint(); }
  }
}

/* فتح واتساب يعلّم «أُرسل» (مرة واحدة)؛ النقرة نفسها رابط حقيقي فلا يحجبها المتصفح */
async function svMarkSent(inviteId){
  if(!svState) return;
  const token = svState.token;
  const inv = svState.invites.find(i => i.id === inviteId);
  if(!inv || inv.sent_at || inv.answered_on) return;
  const nowIso = new Date().toISOString();
  inv.sent_at = nowIso; /* تفاؤلي: يتحدّث الشكل فورًا */
  try{
    const { error } = await sb.from('survey_invites').update({ sent_at: nowIso })
      .eq('teacher_id', currentUser.id).eq('id', inviteId).is('sent_at', null);
    if(error) throw error;
  } catch(err){
    inv.sent_at = null;
    showToast('تعذّر تسجيل الإرسال: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  }
  if(svStillOpen(token)) svPaint();
}

async function svClose(){
  if(!svState || svState.busy || !svState.campaign) return;
  const token = svState.token;
  const campaignId = svState.campaign.id;
  const ok = await showConfirm('إغلاق الاستبانة؟ ستتوقف الروابط عن العمل ولا يستطيع أحد الرد بعدها، وتبقى النتائج محفوظة.');
  if(!ok || !svStillOpen(token)) return;
  svState.busy = true; svPaint();
  try{
    const { error } = await sb.from('survey_campaigns').update({ status: 'closed' })
      .eq('teacher_id', currentUser.id).eq('id', campaignId);
    if(error) throw error;
    if(svStillOpen(token) && svState.campaign && svState.campaign.id === campaignId) svState.campaign.status = 'closed';
    showToast('أُغلقت الاستبانة', 'ok');
  } catch(err){
    showToast('تعذّر الإغلاق: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  } finally {
    if(svStillOpen(token)){ svState.busy = false; svPaint(); }
  }
}

function svSetTab(tab){ if(!svState) return; svState.tab = tab === 'results' ? 'results' : 'send'; svPaint(); }
function svSetFilter(f){ if(!svState) return; svState.filter = f === 'remind' ? 'remind' : 'all'; svPaint(); }
function svToggleNoPhone(){ if(!svState) return; svState.noPhoneOpen = !svState.noPhoneOpen; svPaint(); }

/* ============ الرسم ============ */

function svSectionTitle(){
  const sec = crmSectionById(svState.sectionId);
  return sec ? crmSectionOptionLabel(sec) : 'الشعبة';
}

/* التذاكر التي يتعامل معها المعلم الآن: لطلاب نشطين بالشعبة (من غادر لا يُحسب عليه إرسال ناقص) */
function svVisibleInvites(){
  const ids = new Set(svSectionStudents().map(s => s.id));
  return svState.invites.filter(i => ids.has(i.student_id));
}

function svHeaderHtml(counts){
  const c = svState.campaign;
  let progress = '';
  if(c && counts.total){
    const a = Math.round(100 * counts.answered / counts.total);
    const s = Math.round(100 * counts.sent / counts.total);
    progress = `<div class="sv-progress" role="img" aria-label="ردّ ${counts.answered} وأُرسل ${counts.sent} ولم يُرسل ${counts.unsent}"><i class="sv-p-done" style="width:${a}%"></i><i class="sv-p-sent" style="width:${s}%"></i></div>
      <div class="sv-legend"><span>ردّ ${counts.answered}</span><span>أُرسل ${counts.sent}</span><span>لم يُرسل ${counts.unsent}</span></div>`;
  }
  return `<div class="sv-head"><div class="sv-head-row"><button type="button" class="sv-back-btn" aria-label="رجوع" onclick="closeSurvey()">→</button><b class="sv-title">استبانة الرضا — ${escapeHtml(svSectionTitle())}</b></div>${progress}</div>`;
}

function svPaint(){
  const sheet = document.getElementById('svSheet');
  if(!sheet || !svState) return;
  const st = svState;
  if(st.loading){
    sheet.innerHTML = svHeaderHtml({ total: 0 }) + '<div class="sv-body"><div class="sv-empty">جارٍ التحميل…</div></div>';
    return;
  }
  if(!st.campaign){ sheet.innerHTML = svHeaderHtml({ total: 0 }) + svStartHtml(); return; }
  const counts = svCounts(svVisibleInvites());
  const open = svCampaignOpen(st.campaign);
  const tabs = `<div class="sv-tabs" role="tablist">
    <button type="button" role="tab" aria-selected="${st.tab === 'send'}" class="sv-tab${st.tab === 'send' ? ' is-on' : ''}" onclick="svSetTab('send')">الإرسال</button>
    <button type="button" role="tab" aria-selected="${st.tab === 'results'}" class="sv-tab${st.tab === 'results' ? ' is-on' : ''}" onclick="svSetTab('results')">النتائج${st.responses.length ? ` <span class="sv-badge">${st.responses.length}</span>` : ''}</button>
  </div>`;
  const body = st.tab === 'results' ? svResultsHtml(counts) : svSendHtml(counts, open);
  const foot = open
    ? `<div class="sv-foot"><button type="button" class="sv-ghost" id="svCloseBtn" onclick="svClose()"${st.busy ? ' disabled' : ''}>إغلاق الاستبانة</button><small>تنتهي ${escapeHtml(svDateAr(st.campaign.closes_at))}</small></div>`
    : `<div class="sv-foot"><span class="sv-closed-note">مغلقة</span><button type="button" class="sv-primary-sm" id="svStartBtn" onclick="svStart()"${st.busy ? ' disabled' : ''}>استبانة جديدة</button></div>`;
  sheet.innerHTML = svHeaderHtml(counts) + tabs + body + foot;
}

function svDateAr(iso){
  try{ return new Date(iso).toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' }); } catch(e){ return ''; }
}

function svStartHtml(){
  const students = svSectionStudents();
  const withPhone = students.filter(s => svRecipientsFor(s).length).length;
  const noPhone = students.length - withPhone;
  let guardians = 0, pupils = 0;
  students.forEach(s => svRecipientsFor(s).forEach(r => { if(r.recipient === 'guardian') guardians++; else pupils++; }));
  if(!students.length) return '<div class="sv-body"><div class="sv-empty">لا طلاب في هذه الشعبة بعد.</div></div>';
  if(!withPhone) return `<div class="sv-body"><div class="sv-card sv-center"><h2>أضف أرقام الجوال أولًا</h2><p>تُرسل الاستبانة بواتساب إلى ولي الأمر أو الطالب. افتح ملف أي طالب وأضف رقمه من بطاقة «التواصل».</p></div></div>`;
  return `<div class="sv-body">
    <div class="sv-card sv-center">
      <div class="sv-ico" aria-hidden="true">★</div>
      <h2>استبانة رضا المستفيدين</h2>
      <p>نرسل لولي أمر كل طالب وللطالب نفسه رابطًا خاصًّا بكلٍّ منهما عبر واتساب، فيجيب في دقيقتين، وتصلك النتائج تلقائيًا.</p>
    </div>
    <div class="sv-card sv-facts">
      <div><span>روابط ولي الأمر</span><b>${guardians}</b></div>
      <div><span>روابط الطالب</span><b>${pupils}</b></div>
      <div><span>ينتهي الرابط بعد</span><b>14 يومًا</b></div>
    </div>
    ${noPhone ? `<p class="sv-note">${noPhone} ${noPhone === 1 ? 'طالب' : 'طلاب'} بلا رقم جوال — أضف رقمه لاحقًا وسيُضاف تلقائيًا.</p>` : ''}
    <button type="button" class="sv-primary" id="svStartBtn" onclick="svStart()"${svState.busy ? ' disabled' : ''}>ابدأ الاستبانة</button>
    <p class="sv-note sv-center-t">الردّ لا يُربط باسم صاحبه، وتظهر النتائج بعد ${SURVEY_MIN_RESULTS} ردود على الأقل.</p>
  </div>`;
}

function svSendHtml(counts, open){
  const st = svState;
  const rows = [];
  const noPhone = [];
  svSectionStudents().forEach(s => {
    const invs = st.invites.filter(i => i.student_id === s.id).sort((a, b) => (a.recipient === 'guardian' ? 0 : 1) - (b.recipient === 'guardian' ? 0 : 1));
    if(!invs.length){ if(!svRecipientsFor(s).length) noPhone.push(s); return; }
    rows.push({ s, invs });
  });
  rows.sort((a, b) => crmByArabic(a.s.full_name, b.s.full_name));
  /* ما بقي من عمل يتصدّر القائمة: من عنده تذكرة لم تُرسل، ثم من أُرسلت له، ثم من ردّ كله */
  const rank = r => Math.min(...r.invs.map(i => i.answered_on ? 2 : (i.sent_at ? 1 : 0)));
  rows.sort((a, b) => rank(a) - rank(b));
  const remind = st.filter === 'remind';
  const shown = remind ? rows.filter(r => r.invs.some(i => i.sent_at && !i.answered_on)) : rows;
  const filters = `<div class="sv-filters"><button type="button" class="sv-chip${!remind ? ' is-on' : ''}" onclick="svSetFilter('all')">كل الطلاب</button><button type="button" class="sv-chip${remind ? ' is-on' : ''}" onclick="svSetFilter('remind')">ذكّر من لم يرد (${counts.sent})</button></div>`;
  const list = shown.length ? shown.map(r => svRowHtml(r.s, remind ? r.invs.filter(i => i.sent_at && !i.answered_on) : r.invs, open)).join('')
    : `<div class="sv-empty">${remind ? 'لا أحد بانتظار التذكير.' : 'لا طلاب بأرقام جوال.'}</div>`;
  const nop = noPhone.length ? `<div class="sv-nophone"><button type="button" class="sv-np-btn" aria-expanded="${st.noPhoneOpen}" onclick="svToggleNoPhone()">${noPhone.length} ${noPhone.length === 1 ? 'طالب' : 'طلاب'} بلا رقم جوال <span aria-hidden="true">${st.noPhoneOpen ? '▴' : '▾'}</span></button>${st.noPhoneOpen ? `<div class="sv-np-list">${noPhone.map(s => `<span>${escapeHtml(s.full_name)}</span>`).join('')}</div><small>أضف الرقم من ملف الطالب (بطاقة «التواصل») وسيُضاف هنا تلقائيًا.</small>` : ''}</div>` : '';
  return `<div class="sv-body">${filters}<div class="sv-list">${list}</div>${nop}</div>`;
}

/* زر واحد لكل جهة: واتساب (لم يُرسل) / أعد الإرسال (أُرسل) / ✓ ردّ */
function svActionHtml(s, inv, open){
  const who = SV_WHO[inv.recipient] || '';
  if(inv.answered_on) return `<span class="sv-act sv-act-done">${who} ✓ ردّ</span>`;
  if(!open || !inv.code) return '';
  const phone = svPhoneOfInvite(s, inv);
  const reminder = !!inv.sent_at;
  const wa = phone ? waChatUrl(phone, svWaMessage(s.full_name, inv.code, location.origin, reminder, inv.recipient)) : '';
  if(!wa) return `<span class="sv-act sv-act-none">${who} · بلا رقم</span>`;
  return `<a class="${reminder ? 'sv-act sv-wa sv-wa-again' : 'sv-act sv-wa'}" href="${escapeHtml(wa)}" target="_blank" rel="noopener" onclick="svMarkSent('${escapeHtml(inv.id)}')">${who} · ${reminder ? 'أعد الإرسال' : 'واتساب'}</a>`;
}

function svRowHtml(s, invs, open){
  const acts = invs.map(i => svActionHtml(s, i, open)).join('');
  const done = invs.length && invs.every(i => i.answered_on);
  const none = !invs.some(i => i.sent_at || i.answered_on);
  const hint = done ? '<small class="sv-st sv-st-done">✓ ردّوا جميعًا</small>' : (none ? '<small class="sv-st">لم يُرسل بعد</small>' : '');
  return `<div class="sv-row"><div class="sv-row-top"><b>${escapeHtml(s.full_name)}</b>${hint}</div><div class="sv-acts">${acts}</div></div>`;
}

function svResultsHtml(counts){
  const st = svState;
  const tplKey = st.campaign.template;
  const an = svAnalyze(st.responses, tplKey);
  if(!an.ok){
    return `<div class="sv-body"><div class="sv-card sv-center"><div class="sv-ico" aria-hidden="true">!</div><h2>نسخة أسئلة غير مدعومة</h2><p>هذه الاستبانة بنسخة أسئلة («${escapeHtml(tplKey || 'غير معروفة')}») لا يعرفها هذا الإصدار من التطبيق. حدّث التطبيق ثم أعد المحاولة، ولن تُعرض نتائج مضللة.</p></div></div>`;
  }
  const n = an.valid;
  const warn = an.invalid ? `<div class="sv-weak sv-warn"><b>تنبيه:</b> ${an.invalid} ${an.invalid === 1 ? 'رد' : 'ردود'} لا يطابق صيغة الأسئلة فاستُبعد من الحساب.</div>` : '';
  if(n < SURVEY_MIN_RESULTS){
    const left = SURVEY_MIN_RESULTS - n;
    return `<div class="sv-body">${warn}<div class="sv-card sv-center"><div class="sv-ico" aria-hidden="true">⏳</div><h2>ننتظر ردودًا أكثر</h2>
      <p>تظهر النتائج بعد ${SURVEY_MIN_RESULTS} ردود على الأقل حمايةً لخصوصية المستفيدين. وصلك حتى الآن ${n} ${n === 1 ? 'رد' : 'ردود'}${left > 0 ? `، وبقي ${left}` : ''}.</p>
      <div class="sv-meter" role="img" aria-label="${n} من ${SURVEY_MIN_RESULTS}"><i style="width:${Math.min(100, Math.round(100 * n / SURVEY_MIN_RESULTS))}%"></i></div></div></div>`;
  }
  const rate = counts.total ? Math.min(100, Math.round(100 * n / counts.total)) : 0;
  const overall = an.items.find(a => a.id === 'q7');
  const weak = svWeakestRating(an.items.filter(a => a.id !== 'q7'));
  const head = `<div class="sv-card sv-bigstat"><b>${overall && overall.avg != null ? Math.round(overall.avg / 5 * 100) + '%' : '—'}</b><span>نسبة الرضا العام<br><small>من ${n} ${n === 1 ? 'رد' : 'ردود'} (${rate}% من الروابط)</small></span></div>`;
  const weakNote = weak ? `<div class="sv-weak"><b>أضعف محور:</b> ${escapeHtml(weak.label)} (${svFmtAvg(weak.avg)} من 5)</div>` : '';
  const blocks = an.items.map(a => svAggBlockHtml(a, weak)).join('');
  return `<div class="sv-body">${warn}${head}${weakNote}${blocks}</div>`;
}

function svAggBlockHtml(a, weak){
  const lab = `<div class="sv-q-top"><span>${escapeHtml(a.label)}</span>`;
  if(a.type === 'rating'){
    const isWeak = weak && weak.id === a.id;
    return `<div class="sv-q">${lab}<b>${svFmtAvg(a.avg)}</b></div><div class="sv-bar"><i class="${isWeak ? 'is-weak' : ''}" style="width:${a.avg == null ? 0 : Math.round(a.avg / 5 * 100)}%"></i></div></div>`;
  }
  if(a.type === 'truefalse'){
    return `<div class="sv-q">${lab}<b>${a.pct == null ? '—' : `<bdi>${a.pct}%</bdi> صح`}</b></div><div class="sv-bar"><i style="width:${a.pct || 0}%"></i></div></div>`;
  }
  if(a.type === 'choice'){
    const max = Math.max(1, ...a.counts.map(c => c.count));
    return `<div class="sv-q">${lab}</div>${a.counts.map(c => `<div class="sv-opt"><span>${escapeHtml(c.label)}</span><div class="sv-bar sv-bar-s"><i style="width:${Math.round(100 * c.count / max)}%"></i></div><b>${c.count}</b></div>`).join('')}</div>`;
  }
  if(a.type === 'text'){
    return `<div class="sv-q">${lab}<small>${a.n}</small></div>${a.texts.length ? a.texts.map(t => `<p class="sv-comment">${escapeHtml(t)}</p>`).join('') : '<p class="sv-comment sv-muted">لا تعليقات.</p>'}</div>`;
  }
  return '';
}

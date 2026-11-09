/* ============================================================
   استبانة رضا المستفيدين — تفاصيل الاستبانة: الإرسال والنتائج (التصميم: SURVEYS.md)
   ------------------------------------------------------------
   - تُفتح من قائمة الاستبانات بالأدوات (app-45-tools.js) بمعرّف الاستبانة: openSurvey(campaignId).
   - الاستبانة مستقلة: عنوان، وجهة واحدة (ولي أمر أو طالب)، وشعب مختارة (survey_campaign_sections)،
     وأسئلتها محفوظة داخلها (survey_campaigns.questions: لقطة لا تتأثر بتعديل القوالب الجاهزة بعد ذلك).
   - لكل طالب نشط بالشعب المختارة له رقم الجهة: «تذكرة» (رابط قصير /s/<رمز> يخدمه api/s.js) تُرسل بواتساب يدويًا
     وتقبل ردًّا واحدًا؛ والردّ يُحفظ بلا اسم الطالب ولا رقم التذكرة.
   - التطبيق يعمل عن المعلم: يولّد التذاكر عند الفتح (ويلتقط الطلاب الجدد والأرقام المضافة لاحقًا)، يعلّم «أُرسل»
     عند فتح واتساب، ويُظهر النتائج وحدها بعد min_results ردود (الافتراضي 5).
   - المعلم يرى من ردّ ومن لم يردّ (للتذكير) ولا يرى ما كتبه أحد: الإجابات بجدول منفصل بلا مرجع للطالب.
   - كل استعلام هنا بتصفية صريحة .eq('teacher_id') (السياسة وحدها لا تكفي بالشاشات الشخصية).
   - لا حذف لاستبانة فيها ردود: «إغلاق» فقط، ويمكن «إعادة فتح» أو «نسخ».
   - المدقّق والقوالب ومولّد الرمز من ملف واحد مشترك مع الخادم: survey-templates.js؛ والنتائج تُقرأ بمدقّق الخادم نفسه
     على أسئلة الاستبانة نفسها: غير المطابق يُعدّ ويُعلَن لا يُسقَط بصمت.
   - الشاشة نافذة ملء الشاشة (ليست «عرضًا رئيسيًا»): لا تمسّ hideAllMainViews ولا تتعارض مع الشاشات.
   ============================================================ */

const SURVEY_DEFAULT_MIN_RESULTS = 5;
const SV_WHO = { guardian: 'ولي الأمر', student: 'الطالب' };
const SV_REOPEN_DAYS = 7;

let svState = null; /* { token, campaignId, campaign, sectionIds, invites, responses, tab, filter, secFilter, loading, busy, noPhoneOpen } */
let svToken = 0;
let svKeyHandler = null;

/* ============ دوال صرفة ============ */

/* التذكرة لجهة الاستبانة وحدها: ولي الأمر (جوال ولي الأمر) أو الطالب (جوال الطالب) */
function svRecipientsFor(student, audience){
  if(!student) return [];
  if(audience === 'guardian' && student.guardian_phone) return [{ recipient: 'guardian', phone: student.guardian_phone }];
  if(audience === 'student' && student.student_phone) return [{ recipient: 'student', phone: student.student_phone }];
  return [];
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

/* تجميع الإجابات الصالحة حسب أسئلة الاستبانة. النص يُخلط ترتيبه فلا يدلّ ترتيب الرد على صاحبه. */
function svAggregate(answersList, questions, rand){
  const rnd = rand || Math.random;
  return questions.map(q => {
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

/* الردود → { ok, valid, invalid, items } بالمدقّق المشترك نفسه الذي يقبل به الخادم على أسئلة الاستبانة نفسها.
   لا إسقاط صامت: غير الصالح يُعدّ ويُعلَن؛ وأسئلة تالفة تُعلَن ولا تُعرض أرقام مضللة. */
function svAnalyze(responses, questions, rand){
  const qv = typeof surveyValidateQuestions === 'function' ? surveyValidateQuestions(questions) : { ok: false };
  if(!qv.ok) return { ok: false, reason: 'bad-questions', valid: 0, invalid: responses.length, items: [] };
  const good = [];
  let invalid = 0;
  responses.forEach(r => {
    const v = r && r.answers ? surveyValidateAnswers(qv.value, r.answers) : { ok: false };
    if(v.ok) good.push(v.value); else invalid++;
  });
  return { ok: true, valid: good.length, invalid, items: svAggregate(good, qv.value, rand) };
}

/* أضعف محور تقييم (إن وُجد أكثر من واحد) */
function svWeakestRating(items){
  const rs = items.filter(a => a.type === 'rating' && a.avg != null);
  if(rs.length < 2) return null;
  return rs.reduce((m, a) => a.avg < m.avg ? a : m, rs[0]);
}

/* متوسط كل أسئلة التقييم كنسبة مئوية (بلا افتراض سؤال بعينه: الأسئلة قد تتغيّر) */
function svOverallPct(items){
  const rs = items.filter(a => a.type === 'rating' && a.avg != null);
  if(!rs.length) return null;
  return Math.round(rs.reduce((s, a) => s + a.avg, 0) / rs.length / 5 * 100);
}

function svMinResults(c){
  const n = c && Number(c.min_results);
  return Number.isInteger(n) && n >= 1 ? n : SURVEY_DEFAULT_MIN_RESULTS;
}

function svFmtAvg(v){ return v == null ? '—' : v.toFixed(1); }

/* ============ فتح وإغلاق ============ */

function svStillOpen(token){
  return !!svState && svState.token === token && !!document.getElementById('svBack');
}

async function openSurvey(campaignId){
  if(!currentUser || !campaignId || typeof campaignId !== 'string') return;
  const token = ++svToken;
  svState = { token, campaignId, campaign: null, sectionIds: [], invites: [], responses: [], tab: 'send', filter: 'all', secFilter: 'all', loading: true, busy: false, noPhoneOpen: false };
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
  back.setAttribute('aria-label', 'تفاصيل الاستبانة');
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
  if(typeof toolsRefreshIfVisible === 'function') toolsRefreshIfVisible();
}

/* ============ تحميل ومزامنة ============ */

async function svLoad(token){
  const uid = currentUser.id;
  const [camp, secs] = await Promise.all([
    sb.from('survey_campaigns').select('*').eq('teacher_id', uid).eq('id', svState.campaignId).maybeSingle(),
    sb.from('survey_campaign_sections').select('section_id').eq('teacher_id', uid).eq('campaign_id', svState.campaignId),
    toolsEnsureStructure()
  ]).then(r => [r[0], r[1]]);
  if(camp.error) throw camp.error;
  if(secs.error) throw secs.error;
  if(!svStillOpen(token)) return;
  if(!camp.data) throw new Error('الاستبانة غير موجودة');
  svState.campaign = camp.data;
  svState.sectionIds = (secs.data || []).map(r => r.section_id);
  await svSyncInvites(token);
  if(!svStillOpen(token)) return;
  await svLoadResponses(token);
  if(!svStillOpen(token)) return;
  svState.loading = false;
  svPaint();
}

/* الطلاب النشطون بشعب الاستبانة */
function svSectionStudents(){
  const set = new Set(svState.sectionIds);
  return crmStudents.filter(s => s.is_active !== false && set.has(s.section_id));
}

async function svFetchInvites(campaignId){
  const { data, error } = await fetchAllRows((from, to) => sb.from('survey_invites')
    .select('id, student_id, recipient, code, sent_at, answered_on')
    .eq('teacher_id', currentUser.id).eq('campaign_id', campaignId).order('id', { ascending: true }).range(from, to));
  if(error) throw error;
  return data || [];
}

/* تذكرة لكل طالب له رقم الجهة ولا تذكرة له بعد. تتكرر عند كل فتح فتلتقط الطلاب الجدد والأرقام المضافة لاحقًا تلقائيًا. */
async function svSyncInvites(token){
  const c = svState.campaign;
  let invites = await svFetchInvites(c.id);
  if(!svStillOpen(token)) return;
  if(svCampaignOpen(c) && (c.audience === 'guardian' || c.audience === 'student')){
    const key = (sid, rec) => sid + '|' + rec;
    const have = new Set(invites.map(i => key(i.student_id, i.recipient)));
    const make = () => {
      const rows = [];
      svSectionStudents().forEach(s => svRecipientsFor(s, c.audience).forEach(r => {
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
  const ok = await showConfirm('إغلاق الاستبانة؟ ستتوقف الروابط عن العمل ولا يستطيع أحد الرد بعدها، وتبقى النتائج محفوظة، ويمكنك إعادة فتحها لاحقًا.');
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

/* إعادة فتح مغلقة (أو منتهية) لمدة SV_REOPEN_DAYS: الروابط القديمة تعمل ثانية، ويُكمَّل الناقص من التذاكر */
async function svReopen(){
  if(!svState || svState.busy || !svState.campaign) return;
  const token = svState.token;
  const campaignId = svState.campaign.id;
  svState.busy = true; svPaint();
  try{
    const closesAt = new Date(Date.now() + SV_REOPEN_DAYS * 86400000).toISOString();
    const { error } = await sb.from('survey_campaigns').update({ status: 'open', closes_at: closesAt })
      .eq('teacher_id', currentUser.id).eq('id', campaignId);
    if(error) throw error;
    if(!svStillOpen(token)) return;
    svState.campaign.status = 'open';
    svState.campaign.closes_at = closesAt;
    await svSyncInvites(token);
    showToast('أُعيد فتح الاستبانة', 'ok');
  } catch(err){
    showToast('تعذّر إعادة الفتح: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  } finally {
    if(svStillOpen(token)){ svState.busy = false; svPaint(); }
  }
}

/* نسخ الاستبانة: عنوان جديد بالأسئلة والجهة والشعب نفسها، بلا إرسال ولا ردود، وتتصدّر تصنيفها */
async function svCopy(){
  if(!svState || svState.busy || !svState.campaign) return;
  const token = svState.token;
  const src = svState.campaign;
  const sectionIds = svState.sectionIds.slice();
  const uid = currentUser.id;
  svState.busy = true; svPaint();
  let createdId = null;
  try{
    const title = (src.title + ' (نسخة)').slice(0, SURVEY_LIMITS.maxTitle);
    const { data, error } = await sb.from('survey_campaigns').insert({
      teacher_id: uid, title, audience: src.audience, template: src.template,
      questions: JSON.parse(JSON.stringify(src.questions)), min_results: src.min_results,
      closes_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      sort_order: -Math.floor(Date.now() / 60000)
    }).select('id').single();
    if(error) throw error;
    createdId = data.id;
    if(sectionIds.length){
      const ins = await sb.from('survey_campaign_sections').insert(sectionIds.map(sid => ({ teacher_id: uid, campaign_id: createdId, section_id: sid })));
      if(ins.error) throw ins.error;
    }
  } catch(err){
    if(createdId) await sb.from('survey_campaigns').delete().eq('teacher_id', uid).eq('id', createdId);
    showToast('تعذّر نسخ الاستبانة: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    if(svStillOpen(token)){ svState.busy = false; svPaint(); }
    return;
  }
  if(!svStillOpen(token)) return;
  showToast('نُسخت الاستبانة', 'ok');
  openSurvey(createdId); /* يستبدل هذه النافذة بالنسخة الجديدة (نفس النافذة، رمز جديد) */
}

function svSetTab(tab){ if(!svState) return; svState.tab = tab === 'results' ? 'results' : 'send'; svPaint(); }
function svSetFilter(f){ if(!svState) return; svState.filter = f === 'remind' ? 'remind' : 'all'; svPaint(); }
function svSetSecFilter(id){ if(!svState) return; svState.secFilter = id === 'all' || svState.sectionIds.indexOf(id) >= 0 ? id : 'all'; svPaint(); }
function svToggleNoPhone(){ if(!svState) return; svState.noPhoneOpen = !svState.noPhoneOpen; svPaint(); }

/* ============ الرسم ============ */

/* التذاكر التي يتعامل معها المعلم الآن: لطلاب نشطين بشعب الاستبانة (من غادر لا يُحسب عليه إرسال ناقص) */
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
  const aud = c && TOOLS_AUDIENCES[c.audience] ? TOOLS_AUDIENCES[c.audience].group : '';
  const sub = c ? `${aud}${svCampaignOpen(c) ? ' · تنتهي ' + svDateAr(c.closes_at) : ''}` : '';
  return `<div class="sv-head"><div class="sv-head-row"><button type="button" class="sv-back-btn" aria-label="رجوع إلى الاستبانات" onclick="closeSurvey()">→</button><span class="sv-title-box"><b class="sv-title">${escapeHtml(c ? c.title : 'الاستبانة')}</b>${sub ? `<small class="sv-sub">${escapeHtml(sub)}</small>` : ''}</span></div>${progress}</div>`;
}

function svPaint(){
  const sheet = document.getElementById('svSheet');
  if(!sheet || !svState) return;
  const st = svState;
  if(st.loading){
    sheet.innerHTML = svHeaderHtml({ total: 0 }) + '<div class="sv-body"><div class="sv-empty">جارٍ التحميل…</div></div>';
    return;
  }
  if(!st.campaign){
    sheet.innerHTML = svHeaderHtml({ total: 0 }) + '<div class="sv-body"><div class="sv-card sv-center"><h2>الاستبانة غير موجودة</h2><p>ربما حُذفت من جهاز آخر. ارجع إلى قائمة الاستبانات.</p></div></div>';
    return;
  }
  const counts = svCounts(svVisibleInvites());
  const open = svCampaignOpen(st.campaign);
  const tabs = `<div class="sv-tabs" role="tablist">
    <button type="button" role="tab" aria-selected="${st.tab === 'send'}" class="sv-tab${st.tab === 'send' ? ' is-on' : ''}" onclick="svSetTab('send')">الإرسال</button>
    <button type="button" role="tab" aria-selected="${st.tab === 'results'}" class="sv-tab${st.tab === 'results' ? ' is-on' : ''}" onclick="svSetTab('results')">النتائج${st.responses.length ? ` <span class="sv-badge">${st.responses.length}</span>` : ''}</button>
  </div>`;
  const body = st.tab === 'results' ? svResultsHtml(counts) : svSendHtml(counts, open);
  const foot = open
    ? `<div class="sv-foot"><button type="button" class="sv-ghost" id="svCloseBtn" onclick="svClose()"${st.busy ? ' disabled' : ''}>إغلاق الاستبانة</button></div>`
    : '';
  sheet.innerHTML = svHeaderHtml(counts) + tabs + body + foot;
}

function svDateAr(iso){
  try{ return new Date(iso).toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' }); } catch(e){ return ''; }
}

/* حالة «مغلقة»: تقول ما حدث وتعطي بلاطتين: إعادة فتح ونسخ */
function svClosedHtml(){
  const st = svState;
  const c = st.campaign;
  const why = c.status === 'closed' ? 'أُغلقت هذه الاستبانة' : 'انتهت مدة هذه الاستبانة';
  return `<div class="sv-card sv-closed"><b>${why}</b><p>الروابط التي أُرسلت لم تعد تقبل ردودًا، ونتائجها محفوظة في قائمتك.</p></div>
    <div class="sv-tiles2">
      <button type="button" class="sv-tile2" onclick="svReopen()"${st.busy ? ' disabled' : ''}><b>إعادة فتح</b><small>لمدة ${SV_REOPEN_DAYS} أيام، وتعمل الروابط القديمة مجددًا</small></button>
      <button type="button" class="sv-tile2" onclick="svCopy()"${st.busy ? ' disabled' : ''}><b>نسخ الاستبانة</b><small>استبانة جديدة بالأسئلة نفسها دون ردود</small></button>
    </div>`;
}

function svSendHtml(counts, open){
  const st = svState;
  const c = st.campaign;
  if(c.audience !== 'guardian' && c.audience !== 'student'){
    return `<div class="sv-body"><div class="sv-card sv-center"><h2>الاستبانات المخصّصة</h2><p>هذا النوع يُضاف في تحديث قادم.</p></div></div>`;
  }
  if(!st.sectionIds.length) return `<div class="sv-body">${open ? '' : svClosedHtml()}<div class="sv-card sv-center"><h2>لا شعب لهذه الاستبانة</h2><p>الشعب التي أُنشئت لها حُذفت. انسخ الاستبانة واختر شعبًا جديدة.</p></div></div>`;
  const rows = [];
  const noPhone = [];
  svSectionStudents().forEach(s => {
    if(st.secFilter !== 'all' && s.section_id !== st.secFilter) return;
    const inv = st.invites.find(i => i.student_id === s.id);
    if(!inv){ if(!svRecipientsFor(s, c.audience).length) noPhone.push(s); return; }
    rows.push({ s, inv });
  });
  rows.sort((a, b) => crmByArabic(a.s.full_name, b.s.full_name));
  /* ما بقي من عمل يتصدّر القائمة: من لم يُرسل له، ثم من أُرسل له، ثم من ردّ */
  const rank = r => r.inv.answered_on ? 2 : (r.inv.sent_at ? 1 : 0);
  rows.sort((a, b) => rank(a) - rank(b));
  const remind = st.filter === 'remind';
  const shown = remind ? rows.filter(r => r.inv.sent_at && !r.inv.answered_on) : rows;
  const secChips = st.sectionIds.length > 1
    ? `<div class="sv-chips">${[['all', 'كل الشعب']].concat(st.sectionIds.map(id => [id, crmSectionLabel(id)])).map(x => `<button type="button" class="sv-chip2${st.secFilter === x[0] ? ' is-on' : ''}" onclick="svSetSecFilter('${escapeHtml(x[0])}')">${escapeHtml(x[1])}</button>`).join('')}</div>`
    : '';
  const filters = open ? `<button type="button" class="sv-chip${remind ? ' is-on' : ''}" onclick="svSetFilter('${remind ? 'all' : 'remind'}')">${remind ? 'عرض كل الطلاب' : `ذكّر من لم يرد (${counts.sent})`}</button>` : '';
  const list = shown.length ? shown.map(r => svRowHtml(r.s, r.inv, open)).join('')
    : (open || remind ? `<div class="sv-empty">${remind ? 'لا أحد بانتظار التذكير.' : 'لا طلاب بأرقام جوال.'}</div>` : '');
  const noPhoneWord = c.audience === 'guardian' ? 'رقم ولي أمر' : 'رقم جوال';
  const nop = noPhone.length ? `<div class="sv-nophone"><button type="button" class="sv-np-btn" aria-expanded="${st.noPhoneOpen}" onclick="svToggleNoPhone()">${noPhone.length} ${noPhone.length === 1 ? 'طالب' : 'طلاب'} بلا ${noPhoneWord} <span aria-hidden="true">${st.noPhoneOpen ? '▴' : '▾'}</span></button>${st.noPhoneOpen ? `<div class="sv-np-list">${noPhone.map(s => `<span>${escapeHtml(s.full_name)}</span>`).join('')}</div><small>أضف الرقم من ملف الطالب (بطاقة «التواصل») وسيُضاف هنا تلقائيًا عند فتح الاستبانة.</small>` : ''}</div>` : '';
  return `<div class="sv-body">${open ? '' : svClosedHtml()}${secChips}${filters}<div class="sv-list">${list}</div>${nop}</div>`;
}

/* زر واحد لكل طالب: واتساب (لم يُرسل) / أعد الإرسال (أُرسل) / ✓ ردّ */
function svActionHtml(s, inv, open){
  if(inv.answered_on) return `<span class="sv-act sv-act-done">✓ ردّ</span>`;
  if(!open || !inv.code) return '';
  const phone = svPhoneOfInvite(s, inv);
  const reminder = !!inv.sent_at;
  const wa = phone ? waChatUrl(phone, svWaMessage(s.full_name, inv.code, location.origin, reminder, inv.recipient)) : '';
  if(!wa) return `<span class="sv-act sv-act-none">بلا رقم</span>`;
  return `<a class="${reminder ? 'sv-act sv-wa sv-wa-again' : 'sv-act sv-wa'}" href="${escapeHtml(wa)}" target="_blank" rel="noopener" onclick="svMarkSent('${escapeHtml(inv.id)}')">${reminder ? 'أعد الإرسال' : 'واتساب'}</a>`;
}

function svRowHtml(s, inv, open){
  const state = inv.answered_on ? ['ردّ', 'sv-st-done'] : (inv.sent_at ? ['أُرسل — بانتظار الرد', 'sv-st-sent'] : ['لم يُرسل بعد', '']);
  const sec = s.section_id ? crmSectionLabel(s.section_id) : '';
  return `<div class="sv-row"><span class="sv-row-main"><b>${escapeHtml(s.full_name)}</b><small class="sv-st ${state[1]}">${escapeHtml(sec)}${sec ? ' · ' : ''}${state[0]}</small></span><div class="sv-acts">${svActionHtml(s, inv, open)}</div></div>`;
}

function svResultsHtml(counts){
  const st = svState;
  const c = st.campaign;
  const an = svAnalyze(st.responses, c.questions);
  if(!an.ok){
    return `<div class="sv-body"><div class="sv-card sv-center"><div class="sv-ico" aria-hidden="true">!</div><h2>أسئلة الاستبانة غير صالحة</h2><p>لا يمكن قراءة أسئلة هذه الاستبانة، فلن تُعرض نتائج مضللة. أرسل لنا ذلك عبر «تواصل معنا».</p></div></div>`;
  }
  const min = svMinResults(c);
  const n = an.valid;
  const warn = an.invalid ? `<div class="sv-weak sv-warn"><b>تنبيه:</b> ${an.invalid} ${an.invalid === 1 ? 'رد' : 'ردود'} لا يطابق صيغة الأسئلة فاستُبعد من الحساب.</div>` : '';
  if(n < min){
    const left = min - n;
    return `<div class="sv-body">${warn}<div class="sv-card sv-center"><div class="sv-ico" aria-hidden="true">⏳</div><h2>ننتظر ردودًا أكثر</h2>
      <p>تظهر النتائج بعد ${min} ${min === 1 ? 'رد' : 'ردود'} على الأقل حمايةً لخصوصية المستفيدين. وصلك حتى الآن ${n} ${n === 1 ? 'رد' : 'ردود'}${left > 0 ? `، وبقي ${left}` : ''}.</p>
      <div class="sv-meter" role="img" aria-label="${n} من ${min}"><i style="width:${Math.min(100, Math.round(100 * n / min))}%"></i></div></div></div>`;
  }
  const rate = counts.total ? Math.min(100, Math.round(100 * n / counts.total)) : 0;
  const pct = svOverallPct(an.items);
  const weak = svWeakestRating(an.items);
  const head = pct == null ? '' : `<div class="sv-card sv-bigstat"><b>${pct}%</b><span>متوسط التقييمات<br><small>من ${n} ${n === 1 ? 'رد' : 'ردود'} (${rate}% من الروابط)</small></span></div>`;
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

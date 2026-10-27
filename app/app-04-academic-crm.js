/* ============ المتابعة الأكاديمية ============ */
/* موقوفة بالكامل حاليًا بطلب صاحب التطبيق (لا حالات مسجّلة لأي معلم عند الإيقاف).
   الكود والجدول باقيان كما هما؛ إعادتها = true هنا. خطابات المخالفات لا تتأثر. */
let ACADEMIC_ON = false; /* let: اختبار العزل يشغّلها ليتحقق من تقييد استعلامها */
let acStudents = [];
let acCasesCache = [];
let acFilter = 'all';
let acCurrentCase = null;

async function showAcademicTracking(){
  if(!ACADEMIC_ON){ showClassroomManagement(); return; }
  hideAllMainViews();
  setActiveBottomTab('classroom'); /* لا تبويب سفلي خاص بها بعد الآن — تُفتح من إدارة الصف ← المتابعات */
  document.getElementById('academicView').style.display = 'block';
  document.getElementById('acYearInput').value = localStorage.getItem('ac_year_part') || '1448-1449';
  switchAcTab('cases');
  await loadAcStudents();
  loadAcSuggestionChips();
  setAcFilter('all');
  await refreshAcBadges();
}

function switchAcTab(tab){
  const registerBtn = document.getElementById('acTabBtnRegister');
  const casesBtn = document.getElementById('acTabBtnCases');
  const registerPane = document.getElementById('acTabRegister');
  const casesPane = document.getElementById('acTabCases');
  if(tab === 'register'){
    registerPane.style.display = 'block'; casesPane.style.display = 'none';
    registerBtn.className = 'btn btn-primary'; casesBtn.className = 'btn btn-outline';
    document.getElementById('acRegisterBody').style.display = 'none';
    document.getElementById('acRegisterBody_arrow').textContent = '▸';
  } else {
    registerPane.style.display = 'none'; casesPane.style.display = 'block';
    registerBtn.className = 'btn btn-outline'; casesBtn.className = 'btn btn-primary';
  }
}

async function onAcYearChange(){
  localStorage.setItem('ac_year_part', document.getElementById('acYearInput').value);
  document.getElementById('acStudentId').value = '';
  document.getElementById('acStudentSearch').value = '';
  await loadAcStudents();
  await renderAcCases();
}

async function loadAcStudents(){
  const { data, error } = await sb.from('classroom_students').select('*').eq('teacher_id', currentUser.id).eq('is_active', true).order('full_name');
  if(error){ showToast('تعذّر تحميل الطلاب: ' + error.message, 'error'); return; }
  acStudents = data || [];
}

/* اقتراحات ديناميكية — مبنية من إدخالات المعلم نفسه سابقًا، لا قائمة ثابتة مكتوبة مسبقًا (كل مادة وأسلوب مختلف) */
async function loadAcSuggestionChips(){
  const { data, error } = await sb.from('academic_cases')
    .select('weakness_description, plan_description')
    .eq('teacher_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(30);
  if(error) return;

  const uniqueRecent = (values, max) => {
    const seen = new Set();
    const out = [];
    for(const v of values){
      const t = (v || '').trim();
      if(!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if(out.length >= max) break;
    }
    return out;
  };

  const weaknessChips = uniqueRecent((data || []).map(r => r.weakness_description), 5);
  const planChips = uniqueRecent((data || []).map(r => r.plan_description), 5);

  renderAcChips('acWeaknessChips', weaknessChips, 'acWeakness');
  renderAcChips('acPlanChips', planChips, 'acPlan');
}

function renderAcChips(boxId, values, targetFieldId){
  const box = document.getElementById(boxId);
  if(!values.length){ box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = 'flex';
  box.innerHTML = values.map(v => `
    <span onclick="document.getElementById('${targetFieldId}').value = this.dataset.full" data-full="${escapeHtml(v)}"
      style="display:inline-block;background:#F0EEE6;border:1px solid var(--line);color:var(--navy);padding:3px 9px;font-size:10.5px;border-radius:12px;cursor:pointer;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
      ${escapeHtml(v.length > 28 ? v.slice(0, 28) + '…' : v)}
    </span>
  `).join('');
}

function renderAcStudentResults(){
  const q = document.getElementById('acStudentSearch').value.trim();
  const box = document.getElementById('acStudentResults');
  if(!q){ box.style.display = 'none'; box.innerHTML = ''; return; }
  const matches = acStudents.filter(s => s.full_name.includes(q)).slice(0, 20);
  if(!matches.length){ box.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--muted);">لا نتائج — أضِف الطالب أولًا من "إدارة الصف"</div>'; box.style.display = 'block'; return; }
  box.innerHTML = matches.map(s => `
    <div style="padding:8px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--line);" onclick="selectAcStudent('${s.id}')">
      ${escapeHtml(s.full_name)} <span style="color:var(--muted);font-size:11px;">— ${escapeHtml(s.grade_level || '')} / الشعبة ${escapeHtml(s.section_number || '')}</span>
    </div>
  `).join('');
  box.style.display = 'block';
}

function selectAcStudent(id){
  const s = acStudents.find(x => x.id === id);
  document.getElementById('acStudentId').value = id;
  document.getElementById('acStudentSearch').value = s ? s.full_name : '';
  document.getElementById('acStudentResults').style.display = 'none';
}

async function saveAcademicCase(){
  const studentId = document.getElementById('acStudentId').value;
  const subject = document.getElementById('acSubject').value.trim();
  const weakness = document.getElementById('acWeakness').value.trim();
  const plan = document.getElementById('acPlan').value.trim();
  const sessionType = document.getElementById('acSessionType').value;
  const committeeDate = document.getElementById('acCommitteeApprovedAt').value;
  if(!studentId || !subject || !weakness){ showToast('أكمل اختيار الطالب والمادة ووصف الضعف على الأقل', 'error'); return; }

  const { error } = await sb.from('academic_cases').insert({
    teacher_id: currentUser.id,
    student_id: studentId,
    subject, weakness_description: weakness,
    plan_description: plan || null,
    session_type: sessionType,
    committee_approved_at: committeeDate || null,
    academic_year: document.getElementById('acYearInput').value,
    status: 'plan_active'
  });
  if(error){ showToast('تعذّر الحفظ: ' + error.message, 'error'); return; }

  document.getElementById('acStudentId').value = '';
  document.getElementById('acStudentSearch').value = '';
  document.getElementById('acSubject').value = '';
  document.getElementById('acWeakness').value = '';
  document.getElementById('acPlan').value = '';
  document.getElementById('acCommitteeApprovedAt').value = '';
  document.getElementById('acRegisterBody').style.display = 'none';
  document.getElementById('acRegisterBody_arrow').textContent = '▸';
  showToast('تم تسجيل الحالة والخطة العلاجية', 'ok');
  switchAcTab('cases');
  await renderAcCases();
  loadAcSuggestionChips();
}

function jumpToAcFilter(mode){
  setAcFilter(mode);
  const el = document.getElementById('acTabCases');
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* منطق مشترك لتفعيل زر فلترة (الكل/معلّق/غير موثّق) — مكرر حرفيًا بين
   المتابعة الأكاديمية وإدارة الصف باستثناء المتغيّر المحفوظ، بادئة معرّف
   الزر، ودالة إعادة العرض. */
function setListFilter(cfg, mode){
  cfg.setValue(mode);
  ['all', 'week', 'pending', 'undocumented'].forEach(m => {
    const btn = document.getElementById(cfg.btnPrefix + m);
    if(!btn) return;
    /* مربعات ملخص المخالفات تتبدّل بعلامة، لا بلون زر */
    if(btn.classList && btn.classList.contains('crm-inc-stat')) btn.classList.toggle('is-on', m === mode);
    else btn.className = (m === mode) ? 'btn btn-primary' : 'btn btn-outline';
  });
  cfg.render();
}

/* توثيق تسليم الخطابات (صورة الخطاب الموقّع) أُلغي من المتابعة بطلب صاحب التطبيق:
   لا فلتر ولا تنبيه ولا قسم رفع. الصور المرفوعة سابقًا تبقى (تُعرض ويمكن حذفها). */
const RECEIPT_DOCS_ON = false;
function receiptSectionVisible(generated, photoUrl){
  return !!generated && (RECEIPT_DOCS_ON || !!photoUrl);
}

function setAcFilter(mode){
  if(mode === 'undocumented' && !RECEIPT_DOCS_ON) mode = 'all';
  setListFilter({ setValue: v => { acFilter = v; }, btnPrefix: 'acFilterBtn_', render: renderAcCases }, mode);
}

async function renderAcCases(){
  const box = document.getElementById('acCasesList');
  const searchQuery = (document.getElementById('acCasesSearch').value || '').trim();

  /* نبني الاستعلام من جديد بكل صفحة (بدل إعادة استخدام نفس الكائن) حتى
     تعمل fetchAllRows بشكل صحيح — وبهذا نلغي حد الـ 200 الثابت الذي كان
     يُسقط حالات قديمة بصمت لمعلم لديه أرشيف كبير */
  const buildQuery = (from, to) => {
    let q = sb.from('academic_cases').select('*').eq('teacher_id', currentUser.id);
    if(acFilter === 'pending') q = q.eq('status', 'referred').eq('referral_letter_generated', false);
    return q.order('created_at', { ascending: false }).range(from, to);
  };

  const { data, error } = await fetchAllRows(buildQuery);
  if(error){ box.innerHTML = '<div class="empty-state">تعذّر التحميل: ' + escapeHtml(error.message) + '</div>'; return; }
  acCasesCache = data || [];

  let filtered = acCasesCache;
  if(searchQuery){
    filtered = filtered.filter(c => {
      const student = acStudents.find(s => s.id === c.student_id);
      return student && student.full_name.includes(searchQuery);
    });
  }
  if(!filtered.length){ box.innerHTML = '<div class="empty-state">لا حالات مطابقة.</div>'; return; }

  const statusLabel = { plan_active: 'خطة علاجية جارية', referred: 'محال للموجه' };
  box.innerHTML = filtered.map(c => {
    const student = acStudents.find(s => s.id === c.student_id);
    const needsConfirm = c.status === 'referred' && !c.referral_letter_generated;
    const confirmed = c.status === 'referred' && c.referral_letter_generated;
    const color = c.status === 'plan_active' ? '#2C6E8E' : (needsConfirm ? '#C0392B' : '#C9A227');
    return `
      <div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px;">
        <div style="width:4px;border-radius:2px;background:${color};flex-shrink:0;align-self:stretch;"></div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <div><b>${student ? escapeHtml(student.full_name) : 'طالب'}</b> — ${escapeHtml(c.subject)}</div>
            <button style="border:none;background:none;color:var(--muted);font-size:14px;line-height:1;cursor:pointer;padding:0;" onclick="deleteAcademicCase('${c.id}')" title="حذف">🗑</button>
          </div>
          <div style="color:var(--muted);margin-top:2px;">${escapeHtml(c.weakness_description)}</div>
          <div style="color:var(--muted);margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span>${c.plan_started_at} • ${statusLabel[c.status]}${needsConfirm ? ' ⚠' : ''}${confirmed ? ' ✅ صدر الخطاب' : ''}</span>
            ${c.status === 'plan_active' ? `<button class="btn btn-primary" style="padding:2px 8px;font-size:10.5px;background:#8A2C2C;" onclick="referAcademicCase('${c.id}')">لم يتقن المهارة → إحالة للموجه</button>` : ''}
            ${needsConfirm ? `<button class="btn btn-primary" style="padding:2px 8px;font-size:10.5px;background:#8A2C2C;" onclick="openAcLetter('${c.id}')">إصدار خطاب 📄</button>` : ''}
            ${confirmed ? `<button class="btn btn-outline" style="padding:2px 8px;font-size:10.5px;" onclick="openAcLetter('${c.id}')">عرض الخطاب</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function referAcademicCase(id){
  const ok = await showConfirm('تأكيد أن الطالب لم يتقن المهارة (أو أكثر) رغم تنفيذ الخطة العلاجية، وتحويله للموجه الطلابي وفق الإجراء (1.9.2)؟');
  if(!ok) return;
  const { error } = await sb.from('academic_cases').update({ status: 'referred' }).eq('teacher_id', currentUser.id).eq('id', id);
  if(error){ showToast('تعذّر التحديث: ' + error.message, 'error'); return; }
  showToast('تم تحويل الحالة — جاهز لإصدار خطاب الإحالة', 'ok');
  await renderAcCases();
  await refreshAcBadges();
  openAcLetter(id);
}

async function deleteAcademicCase(id){
  return trashRunOnce('case:' + id, async () => {
    const ok = await showConfirm('حذف هذه الحالة؟ تبقى في «المحذوفات» ' + TRASH_DAYS + ' يومًا فتستطيع استرجاعها.');
    if(!ok || !currentUser) return;
    const uid = currentUser.id;
    const prot = await trashProtect(() => trashCaptureSingle('academic_case', 'academic_cases', 'teacher_id', id, uid, r => 'حالة: ' + (r.subject || '')));
    if(!prot) return;
    const { error } = await sb.from('academic_cases').delete().eq('teacher_id', uid).eq('id', id);
    if(error){ await trashDiscard(prot.id); showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
    await renderAcCases();
    await refreshAcBadges();
    trashOfferUndo('تم حذف الحالة', prot.id, async () => { await renderAcCases(); await refreshAcBadges(); });
  });
}

/* ============================================================
   منطق مشترك لعدّادات/شارات "المعلَّق والموثَّق" — مكرر حرفيًا بين مسار
   المتابعة الأكاديمية وإدارة الصف باستثناء اسم الجدول، عمود المرحلة،
   ومعرّفات عناصر DOM. موحَّد هنا بدالتين عامتين + كائنَي إعداد، مع إبقاء
   الأسماء الأصلية كأغلفة رقيقة (refreshAcBadges/refreshCrmPendingBadges
   لهما عشرات نقاط الاستدعاء بالملف). */
/* استعلام فاشل (خطأ شبكة، أو Supabase "بارد" لم يستيقظ بعد) كان يُرجَع كـ
   {pending:0, undocumented:0} — أي "لا شيء معلّق" خاطئة، فتُخفي الشارة أو
   تُصفّرها رغم وجود عناصر معلّقة فعلية. runQueriesWithRetry (app-03) تعيد
   المحاولة مرة تلقائيًا، ولو فشلت الثانية أيضًا نُرجع null ليُبقي
   refreshTransferBadges الشارة كما هي بدل إخفائها/تصفيرها خطأً. */
async function getTransferCounts(cfg){
  const { ok, results } = await runQueriesWithRetry([
    () => sb.from(cfg.table)
      .select('referral_letter_generated, referral_receipt_photo_url')
      .eq('teacher_id', currentUser.id)
      .eq(cfg.stageColumn, 'referred')
  ]);
  if(!ok) return null;
  const { data } = results[0];
  let pending = 0, undocumented = 0;
  (data || []).forEach(r => {
    if(!r.referral_letter_generated) pending++;
    else if(!r.referral_receipt_photo_url) undocumented++;
  });
  return { pending, undocumented };
}

async function refreshTransferBadges(cfg){
  const counts = await getTransferCounts(cfg);
  if(!counts) return; /* فشل الفحص مرتين — نُبقي الشارات المعروضة حاليًا كما هي */
  const { pending } = counts;
  /* إدارة الصف: توثيق تسليم الخطاب أُلغي من المتابعة (بطلب صاحب التطبيق) — المعلَّق = بانتظار التحويل فقط */
  const undocumented = cfg.countUndocumented === false ? 0 : counts.undocumented;
  const total = pending + undocumented;

  const navBadge = cfg.navBadgeId ? document.getElementById(cfg.navBadgeId) : null;
  if(navBadge){
    if(total > 0){ navBadge.style.display = 'block'; navBadge.textContent = total > 9 ? '9+' : String(total); }
    else { navBadge.style.display = 'none'; }
  }
  const homeBadge = document.getElementById(cfg.homeBadgeId);
  if(homeBadge){
    if(total > 0){ homeBadge.style.display = 'inline-block'; homeBadge.textContent = total > 9 ? '9+' : String(total); }
    else { homeBadge.style.display = 'none'; }
  }
  const countEl = cfg.pendingCountId ? document.getElementById(cfg.pendingCountId) : null;
  if(countEl) countEl.textContent = pending;
  const banner = cfg.pendingBannerId ? document.getElementById(cfg.pendingBannerId) : null;
  if(banner) banner.style.display = pending > 0 ? 'block' : 'none';
  const docBanner = cfg.undocumentedBannerId ? document.getElementById(cfg.undocumentedBannerId) : null;
  if(docBanner){
    if(undocumented > 0){ docBanner.style.display = 'block'; document.getElementById(cfg.undocumentedCountId).textContent = undocumented; }
    else { docBanner.style.display = 'none'; }
  }
  /* أي تغيير بالخطابات يغيّر بطاقات الانتباه وشارة إدارة الصف */
  if(typeof refreshAttention === 'function') refreshAttention();
}

const AC_TRANSFER_CFG = {
  table: 'academic_cases',
  stageColumn: 'status',
  navBadgeId: null, /* لا تبويب سفلي للمتابعة الأكاديمية بعد الآن — شارة إدارة الصف من محرك الانتباه */
  homeBadgeId: 'academicHomeBadge',
  pendingBannerId: 'acPendingBanner',
  pendingCountId: 'acPendingCount',
  undocumentedBannerId: null,
  undocumentedCountId: null,
  countUndocumented: false
};

const CRM_TRANSFER_CFG = {
  table: 'classroom_incidents',
  stageColumn: 'current_stage',
  navBadgeId: null, /* شارة تبويب إدارة الصف يحدّدها محرك الانتباه (app-16) لا عدد الخطابات وحده */
  homeBadgeId: 'classroomHomeBadge',
  pendingBannerId: null, /* العدد في مربع "بانتظار التحويل" نفسه */
  pendingCountId: 'crmPendingReferralCount',
  undocumentedBannerId: null,
  undocumentedCountId: null,
  countUndocumented: false
};

async function getAcTransferCounts(){
  return getTransferCounts(AC_TRANSFER_CFG);
}

async function refreshAcBadges(){
  if(!ACADEMIC_ON) return;
  return refreshTransferBadges(AC_TRANSFER_CFG);
}

/* ---- خطاب الإحالة الأكاديمية ---- */
async function openAcLetter(caseId){
  if(!ACADEMIC_ON) return;
  const { data: kase, error } = await sb.from('academic_cases').select('*').eq('teacher_id', currentUser.id).eq('id', caseId).maybeSingle();
  if(error || !kase){ showToast('تعذّر تحميل بيانات الحالة', 'error'); return; }

  let student = acStudents.find(s => s.id === kase.student_id);
  if(!student) student = await fetchCrmStudentById(kase.student_id);
  if(!student){ showToast('تعذّر تحميل بيانات الطالب', 'error'); return; }

  acCurrentCase = { case: kase, student };

  hideAllMainViews();
  document.getElementById('acLetterView').style.display = 'block';

  const meta = (currentUser && currentUser.user_metadata) || {};
  const missing = [];
  if(!meta.full_name) missing.push('اسم المعلم');
  const warnBox = document.getElementById('acLetterMissingWarning');
  if(missing.length){
    warnBox.style.display = 'block';
    warnBox.innerHTML = '⚠ بيانات ناقصة: ' + missing.join('، ') + ' — أكملها من الإعدادات قبل الإصدار النهائي.';
  } else { warnBox.style.display = 'none'; }

  let suggestedNumber = 1;
  const { data: counterRow } = await sb.from('classroom_letter_counters').select('next_number').eq('teacher_id', currentUser.id).maybeSingle();
  if(counterRow) suggestedNumber = counterRow.next_number;

  document.getElementById('acOutgoingNumber').value = kase.referral_letter_number || String(suggestedNumber);
  document.getElementById('acLetterDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('acLetterRecipient').value = 'الموجه الطلابي';

  const photoSection = document.getElementById('acPhotoUploadSection');
  const photoBox = document.getElementById('acPhotoPreviewBox');
  if(receiptSectionVisible(kase.referral_letter_generated, kase.referral_receipt_photo_url)){
    photoSection.style.display = 'block';
    if(kase.referral_receipt_photo_url){
      document.getElementById('acPhotoPreviewImg').src = kase.referral_receipt_photo_url;
      photoBox.style.display = 'block';
    } else { photoBox.style.display = 'none'; }
  } else {
    photoSection.style.display = 'none';
    photoBox.style.display = 'none';
  }

  renderAcLetterPreview();
}

function renderAcLetterPreview(){
  if(!acCurrentCase) return;
  const { case: kase, student } = acCurrentCase;
  const meta = (currentUser && currentUser.user_metadata) || {};
  const teacherName = meta.full_name || '__________';
  const school = (typeof getProfileSchool === 'function') ? getProfileSchool() : '';
  const num = document.getElementById('acOutgoingNumber').value.trim();
  const dateVal = document.getElementById('acLetterDate').value;
  let dateDisplay = '—';
  if(dateVal){
    try{ dateDisplay = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { year:'numeric', month:'long', day:'numeric' }).format(new Date(dateVal)); }
    catch(e){ dateDisplay = dateVal; }
  }
  const recipient = document.getElementById('acLetterRecipient').value.trim() || 'الموجه الطلابي';
  const sysRef = 'ACD-' + kase.id.replace(/-/g, '').slice(0, 6).toUpperCase();

  document.getElementById('acLetterPreview').innerHTML = `
    <div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:2px;">
      <span>الرقم: ${escapeHtml(num || '—')}</span>
      <span>التاريخ: ${escapeHtml(dateDisplay)}</span>
    </div>
    <div style="text-align:left;font-size:10.5px;color:#8A8A8A;margin-bottom:18px;">المرجع: ${escapeHtml(sysRef)}</div>
    ${school ? `<div style="text-align:center;font-weight:700;margin-bottom:10px;">${escapeHtml(school)}</div>` : ''}
    <p>سعادة/ ${escapeHtml(recipient)} المحترم</p>
    <p>السلام عليكم ورحمة الله وبركاته،</p>
    <p style="font-weight:700;text-decoration:underline;">الموضوع: إحالة طالب لمتابعة حالة ضعف أكاديمي</p>
    <p>يفيدكم المعلم/ ${escapeHtml(teacherName)} بأن الطالب/ ${escapeHtml(student.full_name)}
    من ${escapeHtml(student.grade_level || 'غير محدد')} - الشعبة ${escapeHtml(student.section_number || '—')}
    يعاني ضعفًا أكاديميًا في مادة ${escapeHtml(kase.subject)}، تحديدًا: ${escapeHtml(kase.weakness_description)}.</p>
    ${kase.plan_description ? `<p><b>الخطة العلاجية المُنفَّذة:</b> ${escapeHtml(kase.plan_description)}${kase.session_type ? ' — بأسلوب حصص ' + escapeHtml(kase.session_type) : ''} (بدأت بتاريخ ${escapeHtml(kase.plan_started_at)}).</p>` : ''}
    ${kase.committee_approved_at ? `<p>اعتُمدت الخطة العلاجية من لجنة التوجيه الطلابي بتاريخ ${escapeHtml(kase.committee_approved_at)}.</p>` : ''}
    <p>وقد تبيّن عدم إتقان الطالب للمهارة (أو المهارات) المستهدفة رغم تنفيذ الخطة العلاجية، وعليه نأمل من سعادتكم متابعة الحالة وفق الإجراء (1.9.2) "متابعة حالات تأخر التحصيل الدراسي".</p>
    ${kase.notes ? `<p>ملاحظة المعلم: ${escapeHtml(kase.notes)}</p>` : ''}
    <p>وتفضلوا بقبول فائق الاحترام والتقدير،</p>
    <div style="margin-top:30px;">
      <div>المعلم: ${escapeHtml(teacherName)}</div>
      <div style="margin-top:26px;">التوقيع: ................................</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:36px;font-size:12px;">
      <tr><td style="border:1px solid #999;padding:8px;font-weight:700;text-align:center;" colspan="3">إقرار التسليم والاستلام</td></tr>
      <tr>
        <td style="border:1px solid #999;padding:8px;text-align:center;">المستلم</td>
        <td style="border:1px solid #999;padding:8px;text-align:center;">التوقيع</td>
        <td style="border:1px solid #999;padding:8px;text-align:center;">التاريخ</td>
      </tr>
      <tr>
        <td style="border:1px solid #999;padding:18px;">&nbsp;</td>
        <td style="border:1px solid #999;padding:18px;">&nbsp;</td>
        <td style="border:1px solid #999;padding:18px;">&nbsp;</td>
      </tr>
    </table>
  `;
}

/* ============================================================
   منطق مشترك لخطابات الإحالة (المتابعة الأكاديمية / إدارة الصف)
   ------------------------------------------------------------
   الخطابان مختلفان بالمحتوى والنموذج القانوني (renderAcLetterPreview
   وrenderReferralLetterPreview يبقيان منفصلين لأن نص كل خطاب مختلف)،
   لكن آلية توليد PDF، الطباعة، المشاركة عبر واتساب، تصدير Word، تأكيد
   الإصدار، ورفع/حذف صورة إثبات التسليم كانت مكررة حرفيًا بين المسارين.
   تم توحيدها هنا بدوال عامة تأخذ إعدادات كل مسار عبر كائن تهيئة (cfg)،
   مع إبقاء أسماء الدوال الأصلية (printAcLetter, uploadReferralReceiptPhoto...)
   كأغلفة رقيقة (thin wrappers) حتى تبقى كل أزرار الواجهة (onclick) تعمل
   بلا أي تعديل عليها.
   ============================================================ */

async function buildLetterPdfBlob(previewElId, photoUrl){
  await ensurePdfLibs();
  const area = document.getElementById('pdfRenderArea');
  const letterHtml = document.getElementById(previewElId).innerHTML;

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageState = { firstPage: true };

  /* addPdfPage معرَّفة في app-08-admin.js — هامش صفحة حقيقي بدل الالتصاق
     بحافتها، لكل من صفحة نص الخطاب وصفحة صورة إثبات التسليم */
  const letterPageHtml = '<div dir="rtl" style="font-family:Arial;font-size:14px;line-height:2;padding:30px;background:#fff;">' + letterHtml + '</div>';
  await addPdfPage(pdf, area, letterPageHtml, pageState);

  if(photoUrl){
    const dataUrl = await toDataUrl(photoUrl);
    if(dataUrl){
      const photoPageHtml = '<div dir="rtl" style="font-family:Arial;padding:30px;background:#fff;text-align:center;">' +
        '<h3 style="margin-bottom:16px;">صورة إثبات التسليم الموقّع</h3>' +
        '<img src="' + escapeHtml(dataUrl) + '" style="max-width:60%;border:1px solid #999;">' +
        '</div>';
      await addPdfPage(pdf, area, photoPageHtml, pageState);
    }
  }
  area.innerHTML = '';
  return pdf.output('blob');
}

/* الطباعة المباشرة (window.print على HTML خام) لا "تُصغّر لتناسب الصفحة"
   كما يفعل تصدير PDF (الذي يرسم المحتوى صورةً ثم يقلّصها رياضيًا لتضبط
   بالضبط داخل صفحة A4) — فهامش المتصفح الافتراضي وتخطيط DOM الحقيقي قد
   يدفعان آخر سطر (الشريط السفلي مثلاً) لصفحة ثانية رغم أن نفس المحتوى
   يتسع بصفحة واحدة عند تصديره PDF. الحل الموثوق: "الطباعة" تُنتج نفس ملف
   الـPDF المُتحقَّق أصلاً من ضبطه على صفحة واحدة (buildBlobFn)، وتفتحه
   لتُطبَع من عارض PDF بالمتصفح مباشرة — بدل إعادة توليد تخطيط HTML مستقل
   عرضة لنفس مشكلة عدم التناسب. */
async function printLetterContent(buildBlobFn, evt){
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  let win = null;
  try{
    /* تُفتح النافذة فورًا وبشكل متزامن (قبل أي await) لتبقى مرتبطة بإيماءة
       المستخدم (نقرة الزر) — بعض المتصفحات (Safari خصوصًا) تمنع window.open
       لو جاءت بعد عملية غير متزامنة، حتى لو نتجت عن نفس النقرة أصلاً. هذا
       السطر يبقى أول شيء بالـtry فور دخوله (لا await قبله) فلا يتأثر ترتيبه. */
    win = window.open('', '_blank');
    showToast('جارٍ تجهيز الطباعة...', 'ok');
    const blob = await buildBlobFn();
    const url = URL.createObjectURL(blob);
    if(win){
      const triggerPrint = () => { try{ win.focus(); win.print(); }catch(e){} };
      win.addEventListener('load', triggerPrint);
      win.location.href = url;
      setTimeout(triggerPrint, 800); /* شبكة أمان لو لم يُطلق load بشكل موثوق */
    } else {
      const a = document.createElement('a');
      a.href = url; a.download = 'خطاب.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      showToast('نافذة الطباعة محظورة بالمتصفح — نزّلنا PDF بدلاً منها، افتحه واطبعه يدويًا', 'error');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch(err){
    if(win) win.close();
    showToast('تعذّر تجهيز الطباعة: ' + err.message, 'error');
  } finally {
    endExportBusy(btn);
  }
}

async function downloadLetterPdfFile(buildBlobFn, studentName, letterLabel, evt){
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    showToast('جارٍ تجهيز PDF...', 'ok');
    const blob = await buildBlobFn();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = letterLabel + ' - ' + studentName + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast('تم تنزيل PDF', 'ok');
  } catch(err){
    showToast('تعذّر إنشاء PDF: ' + err.message, 'error');
  } finally {
    endExportBusy(btn);
  }
}

async function shareLetterWhatsApp(buildBlobFn, studentName, letterLabel, evt){
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    showToast('جارٍ تجهيز الملف...', 'ok');
    const blob = await buildBlobFn();
    const fileName = letterLabel + ' - ' + studentName + '.pdf';
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if(navigator.canShare && navigator.canShare({ files: [file] })){
      await navigator.share({ files: [file], title: letterLabel, text: letterLabel + ' الطالب ' + studentName });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('تم تنزيل الملف — أرفقه يدويًا داخل واتساب', 'ok');
      window.open('https://wa.me/', '_blank');
    }
  } catch(err){
    if(err.name !== 'AbortError') showToast('تعذّر المشاركة: ' + err.message, 'error');
  } finally {
    endExportBusy(btn);
  }
}

async function downloadLetterWordFile(previewElId, photoUrl, studentName, letterLabel, evt){
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    const content = document.getElementById(previewElId).innerHTML;
    let photoHtml = '';
    if(photoUrl){
      showToast('جارٍ تجهيز الملف...', 'ok');
      const dataUrl = await toDataUrl(photoUrl);
      if(dataUrl){
        photoHtml = '<br clear="all" style="page-break-before:always;">' +
          '<h3 style="text-align:center;margin-bottom:14px;">صورة إثبات التسليم الموقّع</h3>' +
          '<img src="' + escapeHtml(dataUrl) + '" width="170" style="width:45mm;max-width:45%;display:block;margin:0 auto;border:1px solid #999;">';
      } else {
        showToast('تعذّر تضمين الصورة — سيُنزَّل الخطاب بدونها', 'error');
      }
    }
    const fullHtml = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>" + letterLabel + "</title></head><body dir='rtl' style='font-family:Arial;font-size:13pt;line-height:2;'>" + content + photoHtml + "</body></html>";
    const blob2 = new Blob(['﻿', fullHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob2);
    const a = document.createElement('a');
    a.href = url; a.download = letterLabel + ' - ' + studentName + '.doc';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } finally {
    endExportBusy(btn);
  }
}

async function confirmLetterIssued(cfg){
  const ref = cfg.currentRef();
  if(!ref) return;
  const entity = ref[cfg.entityKey];
  const num = document.getElementById(cfg.outgoingNumberId).value.trim();
  if(!num){ showToast('أدخل الرقم الصادر أولًا', 'error'); return; }
  const { error } = await sb.from(cfg.table).update({
    referral_letter_generated: true,
    referral_letter_number: num
  }).eq('teacher_id', currentUser.id).eq('id', entity.id);
  if(error){ showToast('تعذّر الحفظ: ' + error.message, 'error'); return; }

  const nextNum = (parseInt(num, 10) || 0) + 1;
  await sb.from('classroom_letter_counters').upsert({ teacher_id: currentUser.id, next_number: nextNum, updated_at: new Date().toISOString() });

  entity.referral_letter_generated = true;
  entity.referral_letter_number = num;
  await cfg.refreshBadges();

  if(RECEIPT_DOCS_ON){
    showToast('تم تأكيد إصدار الخطاب — الآن ارفع صورة التوقيع بعد الطباعة', 'ok');
    document.getElementById(cfg.uploadSectionId).style.display = 'block';
  } else {
    showToast('تم تأكيد إصدار الخطاب ✓', 'ok');
  }
}

async function uploadLetterReceiptPhoto(event, cfg){
  const file = event.target.files[0];
  const ref = cfg.currentRef();
  if(!file || !ref) return;
  const entity = ref[cfg.entityKey];

  /* لم يكن هذا المسار (صورة إثبات التسليم) يفحص حجم الملف إطلاقًا قبل
     محاولة قراءته وضغطه بالكامل داخل المتصفح — على عكس مسار رفع صور
     الشاهد العادي (راجع MAX_UPLOAD_MB بـapp-09). ملف كبير جدًا (فيديو
     بامتداد صورة بالخطأ مثلاً) قد يُجمّد التبويب لثوانٍ طويلة أثناء
     قراءته/رسمه على Canvas، ثم يُرفض على أي حال من حد حجم حاوية
     "shawahid-photos" (8MB) بعد كل هذا الانتظار. */
  if(file.size > MAX_UPLOAD_MB * 1024 * 1024){
    showToast(`حجم الملف كبير جدًا (الحد ${MAX_UPLOAD_MB} ميجابايت).`, 'error');
    event.target.value = '';
    return;
  }

  try{
    showToast('جارٍ ضغط الصورة...', 'ok');
    const compressed = await compressImageFile(file, 1280, 0.72);
    showToast('جارٍ رفع الصورة (' + Math.round(compressed.size / 1024) + ' كيلوبايت)...', 'ok');
    const path = currentUser.id + '/' + cfg.pathSegment + '/' + entity.id + '_' + Date.now() + '.jpg';
    const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, compressed, { contentType: 'image/jpeg' });
    if(upErr) throw upErr;
    const { data: pub } = sb.storage.from('shawahid-photos').getPublicUrl(path);

    const { error } = await sb.from(cfg.table).update({ referral_receipt_photo_url: pub.publicUrl }).eq('teacher_id', currentUser.id).eq('id', entity.id);
    if(error) throw error;

    entity.referral_receipt_photo_url = pub.publicUrl;
    document.getElementById(cfg.previewImgId).src = pub.publicUrl;
    document.getElementById(cfg.previewBoxId).style.display = 'block';
    showToast(cfg.successUploadMsg, 'ok');
    await cfg.refreshBadges();
  } catch(err){
    showToast('تعذّر رفع الصورة: ' + err.message, 'error');
  }
  event.target.value = '';
}

async function deleteLetterReceiptPhoto(cfg){
  const ref = cfg.currentRef();
  if(!ref) return;
  const entity = ref[cfg.entityKey];
  const ok = await showConfirm('حذف صورة إثبات التسليم؟');
  if(!ok) return;
  const { error } = await sb.from(cfg.table).update({ referral_receipt_photo_url: null }).eq('teacher_id', currentUser.id).eq('id', entity.id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  entity.referral_receipt_photo_url = null;
  document.getElementById(cfg.previewBoxId).style.display = 'none';
  showToast('تم حذف الصورة', 'ok');
  await cfg.refreshBadges();
}

/* إعدادات مسار "المتابعة الأكاديمية" */
const AC_LETTER_CFG = {
  table: 'academic_cases',
  currentRef: () => acCurrentCase,
  entityKey: 'case',
  pathSegment: 'academic',
  previewImgId: 'acPhotoPreviewImg',
  previewBoxId: 'acPhotoPreviewBox',
  uploadSectionId: 'acPhotoUploadSection',
  outgoingNumberId: 'acOutgoingNumber',
  successUploadMsg: 'تم رفع الصورة وحفظها كشاهد على الإحالة',
  refreshBadges: () => refreshAcBadges()
};

/* إعدادات مسار "إدارة الصف" (خطاب التحويل السلوكي) */
const RL_LETTER_CFG = {
  table: 'classroom_incidents',
  currentRef: () => rlCurrentIncident,
  entityKey: 'incident',
  pathSegment: 'referrals',
  previewImgId: 'rlPhotoPreviewImg',
  previewBoxId: 'rlPhotoPreviewBox',
  uploadSectionId: 'rlPhotoUploadSection',
  outgoingNumberId: 'rlOutgoingNumber',
  successUploadMsg: 'تم رفع الصورة وحفظها كشاهد على التحويل',
  refreshBadges: () => refreshCrmPendingBadges()
};

async function printAcLetter(evt){
  return printLetterContent(buildAcLetterPdfBlob, evt);
}

async function buildAcLetterPdfBlob(){
  return buildLetterPdfBlob('acLetterPreview', acCurrentCase && acCurrentCase.case.referral_receipt_photo_url);
}

async function downloadAcLetterPDF(evt){
  const studentName = acCurrentCase ? acCurrentCase.student.full_name : 'خطاب';
  return downloadLetterPdfFile(buildAcLetterPdfBlob, studentName, 'خطاب إحالة', evt);
}

async function shareAcLetterWhatsApp(evt){
  const studentName = acCurrentCase ? acCurrentCase.student.full_name : 'خطاب';
  return shareLetterWhatsApp(buildAcLetterPdfBlob, studentName, 'خطاب إحالة', evt);
}

async function downloadAcLetterWordFile(evt){
  const studentName = acCurrentCase ? acCurrentCase.student.full_name : 'خطاب';
  return downloadLetterWordFile('acLetterPreview', acCurrentCase && acCurrentCase.case.referral_receipt_photo_url, studentName, 'خطاب إحالة', evt);
}

async function confirmAcLetterIssued(){
  return confirmLetterIssued(AC_LETTER_CFG);
}

async function uploadAcReceiptPhoto(event){
  return uploadLetterReceiptPhoto(event, AC_LETTER_CFG);
}

async function deleteAcReceiptPhoto(){
  return deleteLetterReceiptPhoto(AC_LETTER_CFG);
}

/* رسم الحقول المرنة داخل صندوق التعديل */
function renderCustomFields(fields){
  const box = document.getElementById('peCustomFields');
  box.innerHTML = (fields || []).map((f, i) => `
    <div class="pe-field" data-idx="${i}">
      <div class="pe-field-head">
        <input type="text" class="pe-label" maxlength="100" value="${escapeHtml(f.label || '')}" placeholder="اسم المعلومة (مثال: المدرسة)">
        <button type="button" class="pe-remove" title="حذف هذه المعلومة" onclick="removeCustomField(this)">×</button>
      </div>
      <input type="text" class="goal-input pe-value" maxlength="300" value="${escapeHtml(f.value || '')}" placeholder="القيمة">
    </div>`).join('');
}

function addCustomField(){
  const box = document.getElementById('peCustomFields');
  const div = document.createElement('div');
  div.className = 'pe-field';
  div.innerHTML = `
    <div class="pe-field-head">
      <input type="text" class="pe-label" maxlength="100" placeholder="اسم المعلومة (مثال: رقم الجوال)">
      <button type="button" class="pe-remove" title="حذف هذه المعلومة" onclick="removeCustomField(this)">×</button>
    </div>
    <input type="text" class="goal-input pe-value" maxlength="300" placeholder="القيمة">`;
  box.appendChild(div);
  div.querySelector('.pe-label').focus();
}

function removeCustomField(btn){
  btn.closest('.pe-field').remove();
}

async function changeEmail(){
  const newEmail = document.getElementById('peNewEmail').value.trim();
  const msg = document.getElementById('emailChangeMsg');
  if(!newEmail){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'اكتب البريد الإلكتروني الجديد أولًا.';
    return;
  }
  msg.style.color = 'var(--muted)';
  msg.textContent = 'جارٍ التحديث...';
  try{
    const { error } = await sb.auth.updateUser({ email: newEmail });
    if(error) throw error;
    msg.style.color = '#215C34';
    msg.textContent = 'تم إرسال رابط تأكيد إلى البريد الجديد (والقديم أحيانًا). افتح بريدك واضغط رابط التأكيد ليكتمل التغيير.';
    showToast('تحقق من بريدك لتأكيد التغيير', 'ok');
  } catch(err){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'خطأ: ' + translateAuthError(err.message);
  }
}

/* هل لحساب المستخدم كلمة مرور فعلًا؟ حساب Google فقط ليس له هوية «email» —
   فلا توجد «كلمة مرور حالية» يُتحقَّق منها. عند غياب معلومات الهويات نفترض
   وجودها (السلوك القديم الأكثر تحفظًا). */
function userHasPasswordLogin(user){
  if(!user) return true;
  if(Array.isArray(user.identities)) return user.identities.some(i => i && i.provider === 'email');
  const providers = user.app_metadata && user.app_metadata.providers;
  if(Array.isArray(providers)) return providers.includes('email');
  return true;
}

/* يبدّل نموذج كلمة المرور بين «تغيير» (له كلمة حالية) و«تعيين» (حساب Google فقط) */
function applyPasswordSectionMode(){
  const hasPw = userHasPasswordLogin(currentUser);
  document.getElementById('pePwLabel').textContent = hasPw ? 'تغيير كلمة المرور' : 'تعيين كلمة مرور';
  document.getElementById('pePwGoogleNote').style.display = hasPw ? 'none' : 'block';
  document.getElementById('peCurrentPassword').style.display = hasPw ? '' : 'none';
  document.getElementById('pePwBtn').textContent = hasPw ? 'تحديث كلمة المرور' : 'تعيين كلمة المرور';
}

async function changePassword(){
  const hasPw = userHasPasswordLogin(currentUser);
  const currentPw = document.getElementById('peCurrentPassword').value;
  const p1 = document.getElementById('peNewPassword').value;
  const p2 = document.getElementById('peNewPassword2').value;
  const msg = document.getElementById('passwordChangeMsg');
  const btn = document.getElementById('pePwBtn');

  if(hasPw && !currentPw){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'أدخل كلمة المرور الحالية أولًا للتأكيد.';
    return;
  }
  if(!p1 || p1.length < 6){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
    return;
  }
  const pwErr = passwordStrengthError(p1);
  if(pwErr){
    msg.style.color = '#8A2C2C';
    msg.textContent = pwErr;
    return;
  }
  if(p1 !== p2){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'كلمتا المرور غير متطابقتين.';
    return;
  }
  if(hasPw && currentPw === p1){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.';
    return;
  }

  btn.disabled = true;
  msg.style.color = 'var(--muted)';
  try{
    if(hasPw){
      msg.textContent = 'جارٍ التحقق من كلمة المرور الحالية...';
      const { error: verifyError } = await sb.auth.signInWithPassword({ email: currentUser.email, password: currentPw });
      if(verifyError){
        msg.style.color = '#8A2C2C';
        msg.textContent = 'كلمة المرور الحالية غير صحيحة.';
        return;
      }
    }

    msg.textContent = 'جارٍ التحديث...';
    const { data, error } = await sb.auth.updateUser({ password: p1 });
    if(error) throw error;
    /* تحديث المستخدم المحلي: صار له هوية «email» فيتحوّل النموذج لوضع «تغيير» */
    if(data && data.user) currentUser = data.user;
    msg.style.color = '#215C34';
    msg.textContent = hasPw ? 'تم تحديث كلمة المرور بنجاح ✓' : 'تم تعيين كلمة المرور بنجاح ✓ يمكنك الدخول بها (مع بريدك) في «مُصحّح» أيضًا.';
    document.getElementById('peCurrentPassword').value = '';
    document.getElementById('peNewPassword').value = '';
    document.getElementById('peNewPassword2').value = '';
    document.getElementById('peNewPwBox').style.display = 'none';
    applyPasswordSectionMode();
    showToast(hasPw ? 'تم تحديث كلمة المرور' : 'تم تعيين كلمة المرور', 'ok');
  } catch(err){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'خطأ: ' + translateAuthError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function saveProfile(){
  const full_name = document.getElementById('peName').value.trim();
  const msg = document.getElementById('profileMsg');

  if(!full_name){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'الاسم مطلوب ولا يمكن تركه فارغًا.';
    return;
  }

  /* جمع الحقول المرنة (نتجاهل ما ليس له اسم) */
  const custom_fields = Array.from(document.querySelectorAll('#peCustomFields .pe-field'))
    .map(el => ({
      label: el.querySelector('.pe-label').value.trim(),
      value: el.querySelector('.pe-value').value.trim()
    }))
    .filter(f => f.label);

  msg.style.color = 'var(--muted)';
  msg.textContent = 'جارٍ الحفظ...';

  try{
    /* نحفظ الحقول المرنة، مع مزامنة الحقول الشائعة للتوافق مع باقي أجزاء النظام */
    const findVal = (keys) => {
      const f = custom_fields.find(x => keys.some(k => x.label.includes(k)));
      return f ? f.value : '';
    };

    const { data, error } = await sb.auth.updateUser({
      data: {
        full_name,
        custom_fields,
        school: findVal(['مدرسة', 'المدرسة']),
        subject: findVal(['مادة', 'المادة', 'تخصص']),
        default_class: findVal(['فصل', 'الفصل', 'صف'])
      }
    });
    if(error) throw error;

    currentUser = data.user;
    document.getElementById('whoName').textContent = full_name || currentUser.email;
    updateAcctInitial();
    msg.style.color = '#215C34';
    msg.textContent = 'تم الحفظ ✓';
    setTimeout(() => {
      showSettingsSection('menu');
    }, 900);
  } catch(err){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'خطأ: ' + err.message;
  }
}

/* ============ تبديل الرئيسية/نموذج/قائمة ============ */
function setActiveBottomTab(tab){
  document.querySelectorAll('.bottom-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

function hideAllMainViews(){
  document.getElementById('homeView').style.display = 'none';
  document.getElementById('formView').style.display = 'none';
  document.getElementById('listView').style.display = 'none';
  document.getElementById('adminView').style.display = 'none';
  document.getElementById('planView').style.display = 'none';
  document.getElementById('selfView').style.display = 'none';
  document.getElementById('classroomView').style.display = 'none';
  document.getElementById('referralLetterView').style.display = 'none';
  document.getElementById('settingsView').style.display = 'none';
  document.getElementById('riskView').style.display = 'none';
  document.getElementById('academicView').style.display = 'none';
  document.getElementById('acLetterView').style.display = 'none';
  document.getElementById('programsView').style.display = 'none';
  document.getElementById('calendarView').style.display = 'none';
  document.getElementById('tasksView').style.display = 'none';
  document.getElementById('batchView').style.display = 'none';
}
/* المصدر الوحيد لتبويبات إدارة الصف: زر + لوحة. كل من يُخفي التبويبات أو
   يكتشف المفتوح منها يقرأ من هنا — قوائم مكررة نسيت تبويبًا جديدًا فظهر
   ملف الطالب تحت تبويب "المتابعات"/"الدرجات" المفتوح. */
const CRM_TAB_PANES = { today: ['crmTabBtnToday', 'crmTabToday'], followups: ['crmTabBtnFollowups', 'crmTabFollowups'], grades: ['crmTabBtnGrades', 'crmTabGrades'], record: ['crmTabBtnRecord', 'crmTabRecord'], students: ['crmTabBtnStudents', 'crmTabStudents'] };

function switchCrmTab(tab){
  const tabs = CRM_TAB_PANES;
  if(!tabs[tab]) tab = 'today';
  if(tab === 'record' && typeof appToolOn === 'function' && !appToolOn('behavior')) tab = 'today'; /* السلوك مخفي */
  if(tab === 'followups' && typeof followupsOn === 'function' && !followupsOn()) tab = 'today'; /* المتابعات مخفية */
  /* ورقة رصد مفتوحة تُغلق عند الانتقال لأي تبويب (المسودة تبقى محفوظة) */
  const sheet = document.getElementById('crmLessonSheet');
  if(sheet && sheet.style.display !== 'none' && typeof closeCrmLessonSheet === 'function' && tab !== 'today'){
    closeCrmLessonSheet();
  }
  /* وملف طالب مفتوح يُغلق أيضًا — لا تبقى لوحتان ظاهرتين معًا */
  const profile = document.getElementById('crmStudentProfile');
  if(profile && profile.style.display !== 'none' && typeof resetCrmStudentProfile === 'function'){
    resetCrmStudentProfile();
  }
  if(typeof showCrmOverlayPane === 'function') showCrmOverlayPane(null);
  if(typeof renderCrmLinkBanner === 'function') renderCrmLinkBanner();
  Object.keys(tabs).forEach(k => {
    const [btnId, paneId] = tabs[k];
    document.getElementById(btnId).className = 'btn crm-tab-btn ' + (k === tab ? 'btn-primary' : 'btn-outline');
    document.getElementById(paneId).style.display = k === tab ? 'block' : 'none';
  });
  if(tab === 'today') renderCrmToday();
  if(tab === 'followups') renderCrmFollowups();
  if(tab === 'grades'){
    if(typeof resetCrmGradeStudent === 'function') resetCrmGradeStudent(); /* العودة للتبويب = قائمة الطلاب */
    renderCrmGrades();
  }
}

function collapseAllCrmSections(){
  const pairs = [];
  pairs.forEach(id => {
    const body = document.getElementById(id);
    const arrow = document.getElementById(id + '_arrow');
    if(body) body.style.display = 'none';
    if(arrow) arrow.textContent = '▸';
  });
  const timetable = document.getElementById('crmTimetableSection'); /* يُفتح من مربّع "جدولي" */
  if(timetable) timetable.style.display = 'none';
}

async function showClassroomManagement(){
  hideAllMainViews();
  setActiveBottomTab('classroom');
  document.getElementById('classroomView').style.display = 'block';
  document.getElementById('crmSemesterSelect').value = localStorage.getItem('crm_semester_part') || 'الفصل الأول';
  document.getElementById('crmYearInput').value = localStorage.getItem('crm_year_part') || '1448-1449';
  updateCrmTermChip();
  pruneLessonDrafts();
  if(typeof pruneParticipationStates === 'function') pruneParticipationStates();
  resetCrmLessonSheet();
  resetCrmStudentProfile();
  showCrmLessonSheetPane(false);
  collapseAllCrmSections();

  await Promise.all([
    loadCrmIncidentTypes(),
    loadCrmGradesAndSections(),
    loadCrmStudents()
  ]);

  crmStuView = { mode: 'home', sectionId: null };
  renderCrmStudentsList();
  renderCrmLinkBanner();
  document.getElementById('crmLinkReviewBox').style.display = 'none';
  renderCrmIncidentTypeSelect();
  setCrmIncidentFilter('all');
  refreshCrmPendingBadges();
  /* "اليوم" هو نقطة البداية — بعد تحميل الشعب والطلاب (يعتمد عليهما) */
  switchCrmTab('today');
  renderCrmTimetableEditor();
}

function saveCrmSemester(){
  localStorage.setItem('crm_semester_part', document.getElementById('crmSemesterSelect').value);
  localStorage.setItem('crm_year_part', document.getElementById('crmYearInput').value);
}

/* شارة "السنة · الفصل" أعلى إدارة الصف — الاختيار نفسه مطوي تحتها */
function updateCrmTermChip(){
  const el = document.getElementById('crmTermChipText');
  if(el) el.textContent = document.getElementById('crmYearInput').value + ' · ' + document.getElementById('crmSemesterSelect').value;
}

function toggleCrmTermRow(){
  const row = document.getElementById('crmTermRow');
  if(!row) return;
  const open = row.style.display === 'none';
  row.style.display = open ? 'block' : 'none';
  const chip = document.getElementById('crmTermChip');
  if(chip) chip.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/* تغيير الفصل الدراسي يغيّر الجدول المعروض (لكل فصل جدوله) */
function onCrmSemesterChange(){
  saveCrmSemester();
  updateCrmTermChip();
  renderCrmTimetableEditor();
  if(document.getElementById('crmTabToday').style.display !== 'none') renderCrmToday();
  if(document.getElementById('crmTabGrades').style.display !== 'none') renderCrmGrades();
}

async function onCrmYearChange(){
  saveCrmSemester();
  updateCrmTermChip();
  resetCrmIncidentForm();
  document.getElementById('crmLinkReviewBox').style.display = 'none';
  await refreshCrmStructureAndStudents();
  renderCrmTimetableEditor();
  if(document.getElementById('crmTabToday').style.display !== 'none') renderCrmToday();
  if(document.getElementById('crmTabGrades').style.display !== 'none') renderCrmGrades();
  await renderCrmRecentIncidents();
}

function getCrmSemesterLabel(){
  const part = document.getElementById('crmSemesterSelect').value;
  const year = document.getElementById('crmYearInput').value.trim();
  return year ? (part + ' ' + year) : part;
}

function toggleAddStudentForm(){
  const box = document.getElementById('addStudentBox');
  box.style.display = (box.style.display === 'none') ? 'block' : 'none';
  document.getElementById('crmImportBox').style.display = 'none';
  if(box.style.display === 'block') document.getElementById('newStudentName').focus();
}

let crmIncidentTypes = [];
let crmStudents = [];

async function loadCrmIncidentTypes(){
  if(crmIncidentTypes.length) return;
  const { data, error } = await sb.from('classroom_incident_types').select('*').eq('active', true).order('problem_degree').order('problem_name');
  if(error){ showToast('تعذّر تحميل أنواع المخالفات: ' + error.message, 'error'); return; }
  crmIncidentTypes = data || [];
}

let crmArchivedStudents = []; /* نُقلوا خارج المدرسة: مخفيون من القوائم والرصد، وسجلهم محفوظ */

async function loadCrmStudents(){
  const year = document.getElementById('crmYearInput').value;
  const [{ data, error }, { data: archived }] = await Promise.all([
    sb.from('classroom_students').select('*').eq('teacher_id', currentUser.id).eq('is_active', true).eq('academic_year', year).order('grade_level').order('section_number').order('full_name'),
    sb.from('classroom_students').select('*').eq('teacher_id', currentUser.id).eq('is_active', false).eq('academic_year', year).order('full_name')
  ]);
  if(error){ showToast('تعذّر تحميل الطلاب: ' + error.message, 'error'); return; }
  crmStudents = data || [];
  crmArchivedStudents = archived || [];
}

/* ============ تبويب الطلاب: "شعبي" ← صفحة الشعبة، و"⚙ المراحل والشعب" ============ */
let crmStuView = { mode: 'home', sectionId: null }; /* mode: home | section | structure */
const CRM_UNLINKED = '__unlinked'; /* طلاب بلا شعبة (حُذفت شعبتهم مثلًا) */

const crmByArabic = (a, b) => String(a).localeCompare(String(b), 'ar', { numeric: true });

/* ترتيب المراحل بمعناها لا أبجديًا (أبجديًا "ثالث" قبل "ثاني"): المرحلة الدراسية ثم الصف */
const CRM_GRADE_ORDINALS = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس'];
const CRM_GRADE_STAGES = ['ابتدائ', 'متوسط', 'ثانو'];
function crmGradeOrderKey(name){
  const n = String(name || '').replace(/[أإآ]/g, 'ا');
  const stage = CRM_GRADE_STAGES.findIndex(w => n.includes(w.replace(/[أإآ]/g, 'ا')));
  const ord = CRM_GRADE_ORDINALS.findIndex(w => n.includes(w.replace(/[أإآ]/g, 'ا')));
  return [stage === -1 ? 9 : stage, ord === -1 ? 9 : ord];
}
function crmCompareGrades(a, b){
  const ka = crmGradeOrderKey(a.name), kb = crmGradeOrderKey(b.name);
  return (ka[0] - kb[0]) || (ka[1] - kb[1]) || crmByArabic(a.name, b.name);
}

function crmSectionsOfGrade(gradeId){
  return crmSections.filter(s => s.grade_level_id === gradeId).sort((a, b) => crmByArabic(a.name, b.name));
}

function crmUnlinkedStudents(){
  const ids = new Set(crmSections.map(s => s.id));
  return crmStudents.filter(s => !s.section_id || !ids.has(s.section_id));
}

function openCrmStuSection(sectionId){
  crmStuView = { mode: 'section', sectionId };
  crmStuSel = { on: false, ids: new Set() };
  ['addStudentBox', 'crmImportBox', 'crmStuAddMenu'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
  /* الشعبة المفتوحة هنا هي نفسها التي يفتحها تبويب الدرجات (اختيار واحد لا اثنان) */
  if(sectionId !== CRM_UNLINKED){ try{ localStorage.setItem('crm_grades_section', sectionId); } catch(e){} }
  renderCrmStudentsList();
  const box = document.getElementById('crmStuSection');
  if(box && box.scrollIntoView) box.scrollIntoView({ block: 'start' });
}

function closeCrmStuSection(){
  crmStuView = { mode: 'home', sectionId: null };
  crmStuSel = { on: false, ids: new Set() };
  renderCrmStudentsList();
}

function openCrmStructure(){
  crmStuView = { mode: 'structure', sectionId: null };
  crmStuSel = { on: false, ids: new Set() };
  crmStructAdd = null;
  renderCrmStudentsList();
}

function closeCrmStructure(){ closeCrmStuSection(); }

/* حالة التحديد المتعدد في صفحة الشعبة (للنقل الجماعي فقط) */
let crmStuSel = { on: false, ids: new Set() };

/* سطر طالب: الاسم يفتح ملفه (ومنه النقل والحذف — بعيدًا عن النقرة الخاطئة)؛
   وفي وضع التحديد يصير الضغط تحديدًا لا فتحًا للملف */
function crmStudentRowHtml(s, sub, selectable){
  const label = `<span class="crm-stu-lbl">${escapeHtml(s.full_name)}${s.student_number ? ` <span class="crm-stu-num">#${escapeHtml(s.student_number)}</span>` : ''}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>`;
  if(selectable && crmStuSel.on){
    const on = crmStuSel.ids.has(s.id);
    return `<div class="crm-stu-row${on ? ' is-sel' : ''}">
    <button type="button" class="crm-stu-name crm-stu-pick" aria-pressed="${on}" onclick="crmStuToggleStudent('${s.id}')"><span class="crm-stu-box" aria-hidden="true">${on ? '☑' : '☐'}</span>${label}</button>
  </div>`;
  }
  return `<div class="crm-stu-row">
    <button type="button" class="crm-stu-name" onclick="openCrmStudentProfile('${s.id}', { type: 'tab', tab: 'students' })">${label}<span class="crm-stu-chev" aria-hidden="true">‹</span></button>
  </div>`;
}

function crmStuSectionStudentIds(){
  const id = crmStuView.sectionId;
  return (id === CRM_UNLINKED ? crmUnlinkedStudents() : crmStudents.filter(x => x.section_id === id)).map(x => x.id);
}

function toggleCrmStuAddMenu(){
  const menu = document.getElementById('crmStuAddMenu');
  const open = menu.style.display === 'none';
  menu.style.display = open ? 'flex' : 'none';
  document.getElementById('crmStuAddBtn').setAttribute('aria-expanded', String(open));
  if(!open){ ['addStudentBox', 'crmImportBox'].forEach(id => { document.getElementById(id).style.display = 'none'; }); }
}

function toggleCrmStuSelect(){
  if(crmStuView.mode !== 'section') return;
  crmStuSel = { on: !crmStuSel.on, ids: new Set() };
  if(crmStuSel.on){ /* لا تحديد مع نموذج إضافة مفتوح */
    ['addStudentBox', 'crmImportBox', 'crmStuAddMenu'].forEach(id => { document.getElementById(id).style.display = 'none'; });
  }
  renderCrmStuSectionPage();
}

function crmStuToggleStudent(id){
  if(!crmStuSel.on) return;
  if(!crmStuSectionStudentIds().includes(id)) return;
  if(crmStuSel.ids.has(id)) crmStuSel.ids.delete(id); else crmStuSel.ids.add(id);
  renderCrmStuSectionPage();
}

function crmStuSelectAll(){
  if(!crmStuSel.on) return;
  const all = crmStuSectionStudentIds();
  crmStuSel.ids = crmStuSel.ids.size === all.length ? new Set() : new Set(all);
  renderCrmStuSectionPage();
}

function renderCrmStudentsList(){
  const v = crmStuView;
  /* شعبة الصفحة حُذفت أو تغيّرت السنة، أو لم يبقَ غير مربوط: العودة لشعبي */
  if(v.mode === 'section' && (v.sectionId === CRM_UNLINKED ? !crmUnlinkedStudents().length : !crmSectionById(v.sectionId))){
    crmStuView = { mode: 'home', sectionId: null };
  }
  const mode = crmStuView.mode;
  document.getElementById('crmStuHome').style.display = mode === 'home' ? 'block' : 'none';
  document.getElementById('crmStuSection').style.display = mode === 'section' ? 'block' : 'none';
  document.getElementById('crmStuStructure').style.display = mode === 'structure' ? 'block' : 'none';
  if(mode === 'section') return renderCrmStuSectionPage();
  if(mode === 'structure') return renderCrmGradesList();
  renderCrmStuHome();
}

function renderCrmStuHome(){
  const box = document.getElementById('crmStudentsList');
  const query = (document.getElementById('crmStudentSearch').value || '').trim();
  const archived = query ? crmArchivedStudents.filter(s => s.full_name.includes(query)) : crmArchivedStudents;
  if(query){
    const found = crmStudents.filter(s => s.full_name.includes(query)).sort((a, b) => crmByArabic(a.full_name, b.full_name));
    const labelOf = s => { const sec = crmSectionById(s.section_id); return sec ? crmSectionOptionLabel(sec) : 'غير مربوط بشعبة'; };
    box.innerHTML = (found.length
      ? `<div class="crm-stu-gh">${arabicCountPhrase(found.length, CRM_STUDENT_COUNT_FORMS)}</div><div class="crm-stu-list">${found.map(s => crmStudentRowHtml(s, labelOf(s))).join('')}</div>`
      : '<div class="empty-state">لا يوجد طلاب مطابقون.</div>') + crmArchivedListHtml(archived, query);
    return;
  }
  if(!crmGradeLevels.length){
    box.innerHTML = `<div class="crm-stu-empty"><b>ابدأ من هنا</b>أضف مراحلك وشعبك، ثم طلاب كل شعبة.
      <button type="button" class="btn btn-primary" onclick="openCrmStructure()">⚙ إضافة المراحل والشعب</button></div>` + crmArchivedListHtml(archived, query);
    return;
  }
  let html = '';
  crmGradeLevels.slice().sort(crmCompareGrades).forEach(g => {
    const secs = crmSectionsOfGrade(g.id);
    html += `<div class="crm-stu-gh">${escapeHtml(g.name)}</div>`;
    if(!secs.length){ html += '<div class="crm-stu-none">لا شعب بعد — أضفها من "⚙ المراحل والشعب" أدناه.</div>'; return; }
    secs.forEach(sec => {
      const n = crmStudents.filter(s => s.section_id === sec.id).length;
      html += `<button type="button" class="crm-stu-card" onclick="openCrmStuSection('${sec.id}')">
        <span><b>الشعبة ${escapeHtml(crmDigits(sec.name))}</b> <small>· ${n ? arabicCountPhrase(n, CRM_STUDENT_COUNT_FORMS) : 'لا طلاب بعد — أضفهم'}</small></span><span class="crm-stu-chev" aria-hidden="true">‹</span></button>`;
    });
  });
  const unlinked = crmUnlinkedStudents();
  if(unlinked.length){
    html += `<button type="button" class="crm-stu-card is-warn" onclick="openCrmStuSection('${CRM_UNLINKED}')">
      <span><b>غير مربوطين بشعبة</b> <small>· ${arabicCountPhrase(unlinked.length, CRM_STUDENT_COUNT_FORMS)}</small></span><span class="crm-stu-chev" aria-hidden="true">‹</span></button>`;
  }
  box.innerHTML = html + crmArchivedListHtml(archived, query);
}

function renderCrmStuSectionPage(){
  const id = crmStuView.sectionId;
  const unlinked = id === CRM_UNLINKED;
  const sec = unlinked ? null : crmSectionById(id);
  const list = (unlinked ? crmUnlinkedStudents() : crmStudents.filter(s => s.section_id === id)).slice().sort((a, b) => crmByArabic(a.full_name, b.full_name));
  /* من اختفى من الشعبة (نُقل/حُذف من جهاز آخر) يسقط من التحديد */
  const here = new Set(list.map(s => s.id));
  crmStuSel.ids = new Set([...crmStuSel.ids].filter(x => here.has(x)));
  if(!list.length) crmStuSel.on = false;
  document.getElementById('crmStuSectionTitle').textContent = unlinked ? 'طلاب غير مربوطين بشعبة' : crmSectionOptionLabel(sec);
  document.getElementById('crmStuSectionCount').textContent = list.length ? arabicCountPhrase(list.length, CRM_STUDENT_COUNT_FORMS) : '';
  /* الإضافة والاستيراد لشعبة حقيقية فقط؛ والتحديد (للنقل) يخدم "غير المربوطين" أيضًا */
  document.getElementById('crmStuAddBtn').style.display = unlinked ? 'none' : '';
  document.getElementById('crmStuSelectBtn').style.display = list.length ? '' : 'none';
  document.getElementById('crmStuSelectBtn').setAttribute('aria-pressed', String(crmStuSel.on));
  document.getElementById('crmStuSelectBtn').classList.toggle('is-on', crmStuSel.on);
  document.getElementById('crmStuSectionActions').style.display = 'flex';
  const bar = document.getElementById('crmStuSelectBar');
  bar.style.display = crmStuSel.on ? 'flex' : 'none';
  const n = crmStuSel.ids.size;
  document.getElementById('crmStuSelectCount').textContent = n ? arabicCountPhrase(n, CRM_STUDENT_COUNT_FORMS) + ' محدّد' : 'اضغط الطلاب لتحديدهم';
  document.getElementById('crmStuBulkMoveBtn').disabled = !n;
  const box = document.getElementById('crmSectionStudentsList');
  box.innerHTML = list.length
    ? (unlinked ? '<div class="crm-stu-none">حُذفت شعبتهم أو لم تُحدَّد — افتح ملف الطالب لنقله، أو حدّد عدة طلاب (☑) وانقلهم معًا.</div>' : '') + `<div class="crm-stu-list">${list.map(s => crmStudentRowHtml(s, undefined, true)).join('')}</div>`
    : '<div class="empty-state">لا طلاب في هذه الشعبة بعد — أضفهم بـ«＋» أعلاه (طالب أو استيراد Excel).</div>';
}

/* الطلاب المنقولون خارج المدرسة: قائمة مطوية أسفل الطلاب، مع "إعادة" لمن عاد */
function crmArchivedListHtml(archived, query){
  if(!archived.length) return '';
  const open = query ? 'block' : 'none';
  return `<div style="border:1px dashed var(--line);margin-top:14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;cursor:pointer;" onclick="toggleCrmGroup('crmArchivedBody')">
      <span style="font-weight:700;font-size:12.5px;color:var(--muted);">نُقلوا خارج المدرسة (${archived.length}) — سجلهم محفوظ</span>
      <span id="crmArchivedBody_arrow" style="font-size:11px;color:var(--muted);">${open === 'block' ? '▾' : '▸'}</span>
    </div>
    <div id="crmArchivedBody" style="display:${open};padding:0 10px 8px;">
      ${archived.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 4px;border-top:1px solid var(--line);">
        <span style="font-size:12.5px;color:var(--muted);cursor:pointer;" onclick="openCrmStudentProfile('${s.id}', { type: 'tab', tab: 'students' })">${escapeHtml(s.full_name)} <span style="font-size:11px;">— كان في ${escapeHtml(studentClassLabel(s, crmGradeLevels, crmSections).grade)} / ${escapeHtml(studentClassLabel(s, crmGradeLevels, crmSections).section)}</span></span>
        <button class="crm-transfer-btn" onclick="restoreCrmStudent('${s.id}')">إعادة</button>
      </div>`).join('')}
    </div>
  </div>`;
}

/* ============ ربط الطالب بشعبته بالمعرّف (section_id) ============ */
/* الأصل: classroom_students كان يربط الطالب بشعبته بنصّين حرّين فقط
   (grade_level/section_number) يُملآن من ملف Excel كما هما. فعليًا هذا انكسر:
   ملف يكتب "ثاني" وآخر "ثاني ثانوي"، وملف يكتب "3" وقائمة الشعب "٣" — فيظهر
   الطلاب كمجموعات منفصلة، ولا يُعدّون ضمن شعبتهم بعدّ طلبة البرامج. الآن
   section_id هو المرجع الوحيد للشعبة؛ والنصّان يبقيان مكتوبين بالاسم
   الرسمي للمرحلة/الشعبة (كتابة مزدوجة) لكل كود قديم ما زال يقرؤهما
   (الخطابات، تصدير المسؤول، موصل الذكاء الاصطناعي). */

/* دالة صرفة: توحيد كتابة اسم مرحلة/شعبة للمقارنة فقط (لا للعرض) — أرقام
   عربية/فارسية ← لاتينية، الهمزات والتاء المربوطة والألف المقصورة، المسافات،
   وكلمة "الشعبة" البادئة. */
function normalizeClassLabel(s){
  return normalizeStudentName(s).replace(/^(ال)?شعبه\s*/, '').trim();
}

/* دالة صرفة: توحيد كتابة الاسم للمقارنة (كشف التكرار عند الاستيراد) */
function normalizeStudentName(s){
  return String(s == null ? '' : s)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/* دالة صرفة: هل نص المرحلة المكتوب للطالب يطابق اسم مرحلة بالقائمة؟
   تطابق تام بعد التوحيد، أو أحدهما بداية الآخر بكلمات كاملة ("ثاني" ↔
   "ثاني ثانوي") — لا "ثا" ↔ "ثاني". */
function gradeTextMatches(studentGradeText, gradeName){
  const a = normalizeClassLabel(studentGradeText);
  const b = normalizeClassLabel(gradeName);
  if(!a || !b) return false;
  if(a === b) return true;
  const at = a.split(' ');
  const bt = b.split(' ');
  const [shorter, longer] = at.length <= bt.length ? [at, bt] : [bt, at];
  return shorter.every((w, i) => w === longer[i]);
}

/* دالة صرفة: يجمّع الطلاب غير المربوطين بمجموعات حسب نصّي المرحلة/الشعبة،
   ويقترح لكل مجموعة شعبة واحدة فقط لو كانت المطابقة وحيدة. أكثر من شعبة
   مطابقة (مثل "ثاني" مع "ثاني ثانوي" و"ثاني متوسط") أو لا شعبة = بلا اقتراح،
   والمعلم يختار بنفسه — لا تخمين. */
function proposeSectionLinks(students, gradeLevels, sections){
  const groups = new Map();
  (students || []).forEach(s => {
    if(s.section_id) return;
    const key = (s.academic_year || '') + '|' + normalizeClassLabel(s.grade_level) + '|' + normalizeClassLabel(s.section_number);
    if(!groups.has(key)){
      groups.set(key, { key, academicYear: s.academic_year || '', gradeText: s.grade_level || '', sectionText: s.section_number || '', studentIds: [], names: [] });
    }
    const g = groups.get(key);
    g.studentIds.push(s.id);
    g.names.push(s.full_name);
  });
  return [...groups.values()].map(g => {
    const candidates = (sections || []).filter(sec => {
      if(g.academicYear && sec.academic_year && sec.academic_year !== g.academicYear) return false;
      if(!normalizeClassLabel(g.sectionText) || normalizeClassLabel(sec.name) !== normalizeClassLabel(g.sectionText)) return false;
      const grade = (gradeLevels || []).find(x => x.id === sec.grade_level_id);
      return !!grade && gradeTextMatches(g.gradeText, grade.name);
    });
    return Object.assign({}, g, {
      proposedSectionId: candidates.length === 1 ? candidates[0].id : '',
      candidateCount: candidates.length
    });
  }).sort((x, y) => (x.gradeText + ' ' + x.sectionText).localeCompare(y.gradeText + ' ' + y.sectionText, 'ar', { numeric: true }));
}

/* دالة صرفة: اسم المرحلة والشعبة للعرض — من الشعبة المربوطة بالمعرّف أولًا،
   وإلا النص القديم كما هو (طالب لم يُربط بعد). */
function studentClassLabel(student, gradeLevels, sections){
  const sec = student && student.section_id ? (sections || []).find(x => x.id === student.section_id) : null;
  if(sec){
    const grade = (gradeLevels || []).find(g => g.id === sec.grade_level_id);
    return { grade: grade ? grade.name : 'غير محدد', section: sec.name, linked: true };
  }
  return { grade: (student && student.grade_level) || 'غير محدد', section: (student && student.section_number) || '—', linked: false };
}

/* دالة صرفة: خطة استيراد أسماء إلى شعبة محدّدة — تتخطى المكرر داخل الملف
   نفسه والموجود أصلًا بنفس الشعبة (إعادة رفع نفس الملف لا تُنشئ نسخًا
   مكررة). الاسم الموجود بشعبة أخرى بسجل واحد فقط = مرشّح "نقل" (غالبًا طالب
   نُقل بين شعبتين): نقل سجله القائم يحفظ مخالفاته وتاريخه، بدل سجل جديد
   مكرر بلا تاريخ. القرار للمعلم دائمًا (قد يكونان طالبين بنفس الاسم). أكثر
   من سجل بنفس الاسم بشعب أخرى = غامض، فيُضاف كطالب جديد بلا تخمين. */
function planStudentImport(rows, existingStudents, sectionId){
  const inSection = new Set();
  const elsewhere = new Map();
  (existingStudents || []).forEach(s => {
    const k = normalizeStudentName(s.full_name);
    if(s.section_id && s.section_id === sectionId){ inSection.add(k); return; }
    if(!elsewhere.has(k)) elsewhere.set(k, []);
    elsewhere.get(k).push(s.id);
  });
  const seen = new Set();
  const toInsert = [];
  const moveCandidates = [];
  let duplicates = 0;
  (rows || []).forEach(r => {
    const name = String(r.full_name || '').replace(/\s+/g, ' ').trim();
    const k = normalizeStudentName(name);
    if(!k) return;
    if(seen.has(k) || inSection.has(k)){ duplicates++; return; }
    seen.add(k);
    const others = elsewhere.get(k) || [];
    if(others.length === 1) moveCandidates.push({ full_name: name, existingId: others[0] });
    else toInsert.push({ full_name: name, student_number: r.student_number || '' });
  });
  return { toInsert, moveCandidates, duplicates };
}

/* ---- مراجعة ربط الطلاب القدامى بشعبهم (مرة واحدة لكل طالب) ---- */
let crmLinkGroups = [];
const CRM_STUDENT_COUNT_FORMS = { one: 'طالب واحد', two: 'طالبان', few: '{n} طلاب', many: '{n} طالبًا' };

/* دالة صرفة: أرقام عربية/فارسية ← لاتينية للعرض فقط (المخزَّن لا يُمسّ) — فلا يختلط "الشعبة ٦" مع "33 طالبًا" */
function crmDigits(v){
  return String(v == null ? '' : v)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

function crmSectionOptionLabel(sec){
  const grade = crmGradeLevels.find(g => g.id === sec.grade_level_id);
  return (grade ? grade.name + ' — ' : '') + 'الشعبة ' + crmDigits(sec.name);
}

function renderCrmLinkBanner(){
  const banner = document.getElementById('crmLinkBanner');
  if(!banner) return;
  const count = crmStudents.filter(s => !s.section_id).length;
  document.getElementById('crmLinkCount').textContent = arabicCountPhrase(count, CRM_STUDENT_COUNT_FORMS);
  banner.style.display = count ? 'block' : 'none';
  if(!count) document.getElementById('crmLinkReviewBox').style.display = 'none';
}

function openCrmLinkReview(){
  switchCrmTab('students');
  renderCrmLinkReview();
  const box = document.getElementById('crmLinkReviewBox');
  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCrmLinkReview(){
  const box = document.getElementById('crmLinkReviewBox');
  crmLinkGroups = proposeSectionLinks(crmStudents, crmGradeLevels, crmSections);
  if(!crmLinkGroups.length){ box.innerHTML = '<div class="empty-state">كل الطلاب مربوطون بشعبهم ✓</div>'; return; }
  if(!crmSections.length){
    box.innerHTML = '<div class="empty-state">أضف المراحل والشعب أولًا من "⚙ المراحل والشعب" أدناه، ثم ارجع هنا لربط الطلاب بها.</div>';
    return;
  }
  const sortedSections = crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }));
  const rows = crmLinkGroups.map((g, i) => {
    const note = g.proposedSectionId ? ''
      : (g.candidateCount > 1 ? 'أكثر من شعبة تطابق هذا الاسم — اختر الصحيحة'
        : 'لا توجد شعبة بهذا الاسم — اخترها، أو أضفها من "⚙ المراحل والشعب" أولًا');
    const sample = g.names.slice(0, 3).map(escapeHtml).join('، ') + (g.names.length > 3 ? '…' : '');
    return `<div style="border-bottom:1px solid var(--line);padding:10px 0;">
      <div style="font-size:12.5px;font-weight:700;">مكتوب: ${escapeHtml(g.gradeText || 'بلا مرحلة')} / ${escapeHtml(g.sectionText || 'بلا شعبة')}
        <span style="font-weight:400;color:var(--muted);">(${arabicCountPhrase(g.studentIds.length, CRM_STUDENT_COUNT_FORMS)})</span></div>
      <div style="font-size:11px;color:var(--muted);margin:2px 0 6px;">${sample}</div>
      <select class="goal-input" id="crmLinkSel_${i}" style="margin:0;">
        <option value="">— لا تربط الآن —</option>
        ${sortedSections.map(sec => `<option value="${sec.id}"${sec.id === g.proposedSectionId ? ' selected' : ''}>${escapeHtml(crmSectionOptionLabel(sec))}</option>`).join('')}
      </select>
      ${note ? `<div style="font-size:11px;color:#8A6D1F;margin-top:4px;">⚠ ${note}</div>` : ''}
    </div>`;
  }).join('');
  box.innerHTML = `
    <h2 style="margin:0 0 4px;">ربط الطلاب بشعبهم</h2>
    <p style="font-size:11.5px;color:var(--muted);margin:0 0 6px;line-height:1.8;">راجع الشعبة المقترحة لكل مجموعة ثم أكّد. سيُكتب اسم المرحلة والشعبة لهؤلاء الطلاب كما في قائمة الشعب، وتُربط مخالفاتهم المسجّلة بنفس الشعبة. لا يُحذف أي طالب.</p>
    ${rows}
    <button class="btn btn-primary" id="crmLinkConfirmBtn" style="margin-top:12px;" onclick="confirmCrmLinks()">تأكيد الربط</button>`;
}

/* .in() بقائمة طويلة يطوّل رابط الطلب — نقسّمها دفعات آمنة */
function chunkArray(arr, size){
  const out = [];
  for(let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function confirmCrmLinks(){
  const btn = document.getElementById('crmLinkConfirmBtn');
  const chosen = crmLinkGroups.map((g, i) => {
    const sel = document.getElementById('crmLinkSel_' + i);
    const sec = sel && sel.value ? crmSections.find(s => s.id === sel.value) : null;
    return sec ? { group: g, sec } : null;
  }).filter(Boolean);
  if(!chosen.length){ showToast('لم تختر شعبة لأي مجموعة', 'error'); return; }

  btn.disabled = true;
  btn.textContent = 'جارٍ الربط...';
  let linked = 0;
  const failed = [];
  try{
    for(const { group, sec } of chosen){
      const grade = crmGradeLevels.find(g => g.id === sec.grade_level_id);
      try{
        for(const ids of chunkArray(group.studentIds, 100)){
          /* .is('section_id', null): لو رُبط بعضهم من تبويب/جهاز آخر أثناء
             المراجعة، لا نكتب فوق ربطه الأحدث */
          const { data, error } = await sb.from('classroom_students')
            .update({ section_id: sec.id, grade_level: grade ? grade.name : group.gradeText, section_number: sec.name })
            .eq('teacher_id', currentUser.id).in('id', ids).is('section_id', null)
            .select('id');
          if(error) throw error;
          linked += (data || []).length;
          const { error: iErr } = await sb.from('classroom_incidents')
            .update({ section_id: sec.id })
            .eq('teacher_id', currentUser.id).in('student_id', ids).is('section_id', null);
          if(iErr) throw iErr;
        }
      } catch(e){
        failed.push((group.gradeText || '—') + ' / ' + (group.sectionText || '—'));
      }
    }
  } finally {
    await loadCrmStudents();
    renderCrmStudentsList();
    renderCrmLinkBanner();
    renderCrmLinkReview();
  }
  if(failed.length) showToast('رُبط ' + linked + ' — تعذّر ربط: ' + failed.join('، ') + '. أعد المحاولة.', 'error');
  else showToast('تم ربط ' + arabicCountPhrase(linked, CRM_STUDENT_COUNT_FORMS) + ' بشعبهم ✓', 'ok');
}

/* ============ إدارة المراحل والشعب ============ */
let crmGradeLevels = [];
let crmSections = [];

async function loadCrmGradesAndSections(){
  const year = document.getElementById('crmYearInput').value;
  const [{ data: grades, error: gErr }, { data: sections, error: sErr }] = await Promise.all([
    sb.from('classroom_grade_levels').select('*').eq('teacher_id', currentUser.id).eq('academic_year', year).order('created_at'),
    sb.from('classroom_sections').select('*').eq('teacher_id', currentUser.id).eq('academic_year', year).order('created_at')
  ]);
  if(gErr){ showToast('تعذّر تحميل المراحل: ' + gErr.message, 'error'); }
  if(sErr){ showToast('تعذّر تحميل الشعب: ' + sErr.message, 'error'); }
  crmGradeLevels = grades || [];
  crmSections = sections || [];
}

/* "⚙ المراحل والشعب": كل مرحلة بطاقة، وشعبها أزرار، والإضافة بخانة داخل الصفحة */
let crmStructAdd = null; /* { kind: 'grade' } أو { kind: 'section', gradeId } */
let crmStructBusy = false;

function crmStructAddFormHtml(placeholder){
  return `<div class="crm-struct-add">
    <input class="goal-input" id="crmStructAddInput" maxlength="60" placeholder="${placeholder}" onkeydown="if(event.key==='Enter')saveCrmStructAdd();if(event.key==='Escape')setCrmStructAdd(null)">
    <button type="button" class="btn btn-primary crm-mini-btn" id="crmStructAddBtn" onclick="saveCrmStructAdd()">حفظ</button>
    <button type="button" class="btn btn-outline crm-mini-btn" onclick="setCrmStructAdd(null)">إلغاء</button>
  </div>`;
}

function renderCrmGradesList(){
  const box = document.getElementById('crmGradesList');
  const a = crmStructAdd;
  const grades = crmGradeLevels.slice().sort(crmCompareGrades);
  const cards = grades.map(g => {
    const secs = crmSectionsOfGrade(g.id);
    const adding = a && a.kind === 'section' && a.gradeId === g.id;
    return `<div class="crm-struct-card">
      <div class="crm-struct-head"><b>${escapeHtml(g.name)}</b>
        <button type="button" class="crm-struct-del" onclick="deleteCrmGradeLevel('${g.id}')">🗑 حذف المرحلة</button></div>
      <div class="crm-struct-chips">
        ${secs.map(s => `<span class="crm-struct-chip">الشعبة ${escapeHtml(s.name)}<button type="button" aria-label="حذف الشعبة ${escapeHtml(s.name)}" onclick="deleteCrmSection('${s.id}')">✕</button></span>`).join('')}
        ${adding ? '' : `<button type="button" class="crm-struct-chip is-add" onclick="setCrmStructAdd({ kind: 'section', gradeId: '${g.id}' })">+ شعبة</button>`}
      </div>
      ${adding ? crmStructAddFormHtml('رقم الشعبة، مثل: 8') : ''}
    </div>`;
  }).join('');
  const addingGrade = a && a.kind === 'grade';
  box.innerHTML = (grades.length ? cards : '<div class="crm-stu-none">لا مراحل بعد لهذه السنة — ابدأ بإضافة مرحلة.</div>') +
    (addingGrade
      ? `<div class="crm-struct-card">${crmStructAddFormHtml('مثل: أول ثانوي')}</div>`
      : `<button type="button" class="crm-struct-card is-add" onclick="setCrmStructAdd({ kind: 'grade' })">+ مرحلة جديدة</button>`);
  const input = document.getElementById('crmStructAddInput');
  if(a && input && input.focus) input.focus();
}

function setCrmStructAdd(v){
  if(crmStructBusy) return;
  crmStructAdd = v;
  renderCrmGradesList();
}

/* حفظ مرحلة/شعبة جديدة — معطّل أثناء الحفظ (لا تُضاف مرتين بنقرتين أو Enter مزدوج) */
async function saveCrmStructAdd(){
  const a = crmStructAdd;
  const input = document.getElementById('crmStructAddInput');
  if(!a || crmStructBusy || !input) return;
  const name = (input.value || '').trim();
  if(!name){ showToast(a.kind === 'grade' ? 'اكتب اسم المرحلة' : 'اكتب رقم الشعبة', 'error'); return; }
  const year = document.getElementById('crmYearInput').value;
  crmStructBusy = true;
  const btn = document.getElementById('crmStructAddBtn');
  if(btn) btn.disabled = true;
  let ok = false;
  try{
    const { error } = a.kind === 'grade'
      ? await sb.from('classroom_grade_levels').insert({ teacher_id: currentUser.id, academic_year: year, name })
      : await sb.from('classroom_sections').insert({ teacher_id: currentUser.id, grade_level_id: a.gradeId, academic_year: year, name });
    if(error){ showToast('تعذّر الإضافة: ' + error.message, 'error'); return; }
    ok = true;
    showToast(a.kind === 'grade' ? 'تمت إضافة المرحلة' : 'تمت إضافة الشعبة', 'ok');
    crmStructAdd = null;
  } finally {
    crmStructBusy = false;
    if(!ok && btn) btn.disabled = false;
  }
  await refreshCrmStructureAndStudents();
}

async function deleteCrmGradeLevel(id){
  const sectionIds = crmSections.filter(s => s.grade_level_id === id).map(s => s.id);
  const linkedCount = crmStudents.filter(s => sectionIds.includes(s.section_id)).length;
  const ok = await showConfirm('حذف هذه المرحلة وكل شعبها؟' + (linkedCount
    ? ' ' + arabicCountPhrase(linkedCount, CRM_STUDENT_COUNT_FORMS) + ' مربوطون بشعبها سيصبحون "غير مربوطين بشعبة" (لن يُحذفوا، ويمكن ربطهم من جديد).'
    : ''));
  if(!ok) return;
  const { error } = await sb.from('classroom_grade_levels').delete().eq('id', id).eq('teacher_id', currentUser.id);
  if(error){ showToast(crmDeleteErrorMessage(error), 'error'); return; }
  showToast('تم الحذف', 'ok');
  await refreshCrmStructureAndStudents();
}

/* شعبة لها حصص مرصودة لا تُحذف (قيد بالقاعدة): حذفها كان سيمسح سجل حضور
   فصل كامل بنقرة خاطئة واحدة */
function crmDeleteErrorMessage(error){
  if(error && error.code === '23503') return 'لا يمكن الحذف: توجد حصص مرصودة أو كشف درجات أو واجبات أو مهام أدائية أو رصد أدوات لهذه الشعبة (أو لإحدى شعب المرحلة). احذفها أولًا إن كنت متأكدًا.';
  return 'تعذّر الحذف: ' + ((error && error.message) || '');
}

/* بعد أي تغيير بالمراحل/الشعب: حذف شعبة يفكّ ربط طلابها بقاعدة البيانات
   (on delete set null)، فنعيد تحميل الطلاب أيضًا لا الشعب وحدها */
async function refreshCrmStructureAndStudents(){
  await Promise.all([loadCrmGradesAndSections(), loadCrmStudents()]);
  renderCrmStudentsList();
  renderCrmLinkBanner();
  if(document.getElementById('crmLinkReviewBox').style.display !== 'none') renderCrmLinkReview();
}

async function deleteCrmSection(id){
  const linkedCount = crmStudents.filter(s => s.section_id === id).length;
  const ok = await showConfirm('حذف هذه الشعبة؟' + (linkedCount
    ? ' ' + arabicCountPhrase(linkedCount, CRM_STUDENT_COUNT_FORMS) + ' مربوطون بها سيصبحون "غير مربوطين بشعبة" (لن يُحذفوا، ويمكن ربطهم من جديد).'
    : ''));
  if(!ok) return;
  const { error } = await sb.from('classroom_sections').delete().eq('id', id).eq('teacher_id', currentUser.id);
  if(error){ showToast(crmDeleteErrorMessage(error), 'error'); return; }
  showToast('تم الحذف', 'ok');
  await refreshCrmStructureAndStudents();
}

function toggleCrmImportBox(){
  const box = document.getElementById('crmImportBox');
  box.style.display = (box.style.display === 'none') ? 'block' : 'none';
  document.getElementById('addStudentBox').style.display = 'none';
}

/* استيراد ثانٍ يبدأ قبل اكتمال الأول يقارن بقائمة طلاب قديمة لم تتضمن
   دفعة الأول بعد، فيُدرج نفس الأسماء مرتين — نمنعه طوال العملية */
let crmImportBusy = false;

/* الشعبة = صفحة الشعبة المفتوحة، تُثبَّت عند اختيار الملف (لا تتغيّر لو تنقّل المعلم أثناء القراءة) */
let crmImportTargetSectionId = null;
function startCrmImport(){
  if(crmImportBusy){ showToast('جارٍ استيراد ملف سابق — انتظر اكتماله', 'error'); return; }
  const sec = crmStuView.mode === 'section' ? crmSectionById(crmStuView.sectionId) : null;
  if(!sec){ showToast('افتح الشعبة التي تستورد إليها أولًا', 'error'); return; }
  crmImportTargetSectionId = sec.id;
  document.getElementById('crmExcelInput').click();
}

/* ============ إدارة الطلاب ============ */
/* يُضاف لشعبة الصفحة المفتوحة — الزر معطّل أثناء الحفظ (لا يتكرر بنقرتين) */
let crmAddStudentBusy = false;
async function addClassroomStudent(){
  if(crmAddStudentBusy) return;
  const name = document.getElementById('newStudentName').value.trim();
  const num = document.getElementById('newStudentNumber').value.trim();
  const section = crmStuView.mode === 'section' ? crmSectionById(crmStuView.sectionId) : null;
  if(!section){ showToast('افتح شعبة الطالب أولًا', 'error'); return; }
  if(!name){ showToast('اكتب اسم الطالب', 'error'); return; }
  const grade = crmGradeLevels.find(g => g.id === section.grade_level_id);
  crmAddStudentBusy = true;
  const btn = document.getElementById('newStudentSaveBtn');
  if(btn) btn.disabled = true;
  try{
    const { error } = await sb.from('classroom_students').insert({
      teacher_id: currentUser.id,
      full_name: name,
      grade_level: grade ? grade.name : '',
      section_number: section.name,
      section_id: section.id,
      student_number: num || null,
      academic_year: document.getElementById('crmYearInput').value
    });
    if(error){ showToast('تعذّر الحفظ: ' + error.message, 'error'); return; }
    document.getElementById('newStudentName').value = '';
    document.getElementById('newStudentNumber').value = '';
    showToast('تمت إضافة "' + name + '" — أضف التالي أو أغلق النموذج', 'ok');
    await loadCrmStudents();
    renderCrmStudentsList();
    renderCrmLinkBanner();
    document.getElementById('newStudentName').focus();
  } finally {
    crmAddStudentBusy = false;
    if(btn) btn.disabled = false;
  }
}

/* حذف الطالب يحذف معه (cascade) حوادثه وحالاته وحضوره وملاحظاته ومتابعاته ودرجاته وواجباته
   ومهامه ورصد أدواته. قبل الحذف نحفظ لقطة كاملة بسلة المحذوفات (30 يومًا)، ومنها يكون
   «تراجع» والاسترجاع لاحقًا — لا نسخة ذاكرة. */
async function deleteCrmStudent(id){
  return trashRunOnce('student:' + id, async () => {
    const ok = await showConfirm('حذف هذا الطالب؟ سيُحذف معه أيضًا كل حوادثه وحالاته الأكاديمية وسجل حضوره وملاحظاته ودرجاته. يبقى في «المحذوفات» ' + TRASH_DAYS + ' يومًا فتستطيع استرجاعه.');
    if(!ok || !currentUser) return;
    const uid = currentUser.id;
    const prot = await trashProtect(() => trashCaptureStudent(id, uid));
    if(!prot) return;
    const { error } = await sb.from('classroom_students').delete().eq('id', id).eq('teacher_id', uid);
    if(error){ await trashDiscard(prot.id); showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
    await loadCrmStudents();
    renderCrmStudentsList();
    if(typeof invalidateAttention === 'function'){ invalidateAttention(); refreshAttention(); }
    /* حُذف من داخل ملفه: لا يبقى ملف طالب غير موجود مفتوحًا أمام المعلم */
    if(typeof crmProfile !== 'undefined' && crmProfile && String(crmProfile.studentId) === String(id)) closeCrmStudentProfile();
    trashOfferUndo('تم حذف الطالب وسجلاته المرتبطة', prot.id, async () => {
      await loadCrmStudents();
      renderCrmStudentsList();
      await refreshCrmPendingBadges();
      await refreshAcBadges();
    });
  });
}

async function importStudentsExcel(event){
  const file = event.target.files[0];
  if(!file) return;
  if(crmImportBusy){ event.target.value = ''; return; }
  crmImportBusy = true;
  try{ await importStudentsExcelInner(event, file); }
  finally { crmImportBusy = false; }
}

async function importStudentsExcelInner(event, file){
  /* الشعبة تُختار من القائمة لا من الملف: نص "المرحلة/الشعبة" داخل ملفات
     Excel يختلف بين ملف وآخر ("ثاني" مقابل "ثاني ثانوي") فيُنشئ مجموعات
     منفصلة لنفس الصف — هذا بالضبط ما حصل فعليًا قبل هذا التعديل. */
  const sectionId = crmImportTargetSectionId;
  const section = crmSections.find(s => s.id === sectionId);
  if(!section){ showToast('افتح الشعبة التي تستورد إليها أولًا', 'error'); event.target.value = ''; return; }
  const grade = crmGradeLevels.find(g => g.id === section.grade_level_id);
  const label = crmSectionOptionLabel(section);
  try{
    showToast('جارٍ قراءة الملف...', 'ok');
    await ensureXlsxLib();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if(!rows.length){ showToast('الملف فارغ', 'error'); event.target.value=''; return; }

    const norm = (s) => String(s || '').trim();
    const records = rows.map(r => {
      const keys = Object.keys(r);
      const findCol = (...names) => {
        const k = keys.find(k => names.some(n => norm(k).includes(n)));
        return k ? norm(r[k]) : '';
      };
      return {
        full_name: findCol('اسم', 'الاسم', 'name'),
        student_number: findCol('رقم', 'number')
      };
    }).filter(r => r.full_name);

    if(!records.length){ showToast('تعذّر التعرف على الأسماء — تأكد من وجود عمود باسم "الاسم"', 'error'); event.target.value=''; return; }

    const plan = planStudentImport(records, crmStudents, section.id);
    if(!plan.toInsert.length && !plan.moveCandidates.length){
      showToast('كل الأسماء موجودة أصلًا في ' + label + ' — لا جديد للاستيراد', 'ok');
      event.target.value = '';
      return;
    }

    let summary = 'استيراد إلى ' + label + ' — جديد: ' + plan.toInsert.length;
    if(plan.duplicates) summary += ' · مكرر أو موجود أصلًا بهذه الشعبة (سيُتخطّى): ' + plan.duplicates;
    if(plan.moveCandidates.length) summary += ' · موجود في شعبة أخرى: ' + plan.moveCandidates.length + ' (ستُسأل عنهم بعد هذه الخطوة)';
    const ok = await showConfirm(summary + '. متابعة؟');
    if(!ok){ event.target.value=''; return; }

    /* نقل طالب قائم يحفظ مخالفاته وتاريخه — بدل سجل جديد مكرر بلا تاريخ.
       القرار للمعلم: قد يكونان طالبين مختلفين بنفس الاسم. */
    let moveIds = [];
    if(plan.moveCandidates.length){
      const names = plan.moveCandidates.slice(0, 8).map(m => m.full_name).join('، ') + (plan.moveCandidates.length > 8 ? '…' : '');
      const move = await showConfirm('هؤلاء مسجّلون في شعبة أخرى: ' + names + ' — هل نُقلوا إلى ' + label + '؟ "تأكيد" ينقل سجلهم الحالي (تبقى مخالفاتهم معهم). "إلغاء" يضيفهم كطلاب جدد ويُبقي السجل القديم كما هو.');
      if(move) moveIds = plan.moveCandidates.map(m => m.existingId);
      else plan.moveCandidates.forEach(m => plan.toInsert.push({ full_name: m.full_name, student_number: '' }));
    }

    const yearVal = section.academic_year || document.getElementById('crmYearInput').value.trim();
    const canonical = { grade_level: grade ? grade.name : '', section_number: section.name, section_id: section.id };
    if(plan.toInsert.length){
      const payload = plan.toInsert.map(r => Object.assign({
        teacher_id: currentUser.id,
        full_name: r.full_name,
        student_number: r.student_number || null,
        academic_year: yearVal
      }, canonical));
      const { error } = await sb.from('classroom_students').insert(payload);
      if(error){ showToast('تعذّر الاستيراد: ' + error.message, 'error'); event.target.value=''; return; }
    }
    if(moveIds.length){
      const { error: mErr } = await sb.from('classroom_students').update(canonical)
        .eq('teacher_id', currentUser.id).in('id', moveIds);
      if(mErr){ showToast('أُضيف الجدد، لكن تعذّر نقل الموجودين: ' + mErr.message, 'error'); }
    }
    showToast('تم: ' + plan.toInsert.length + ' جديد' + (moveIds.length ? '، ونُقل ' + moveIds.length : '') + ' إلى ' + label, 'ok');
    event.target.value = '';
    await loadCrmStudents();
    renderCrmStudentsList();
    renderCrmLinkBanner();
  } catch(err){
    showToast('خطأ في قراءة الملف: ' + err.message, 'error');
    event.target.value = '';
  }
}

function renderCrmIncidentStudentResults(){
  const q = document.getElementById('crmIncidentStudentSearch').value.trim();
  const box = document.getElementById('crmIncidentStudentResults');
  if(!q){ box.style.display = 'none'; box.innerHTML=''; return; }
  const matches = crmStudents.filter(s => s.full_name.includes(q)).slice(0, 20);
  if(!matches.length){ box.innerHTML = '<div style="padding:10px 12px;font-size:12.5px;color:var(--muted);">لا نتائج</div>'; box.style.display='block'; return; }
  box.innerHTML = matches.map(s => `
    <button type="button" class="crm-stu-res" onclick="selectCrmIncidentStudent('${s.id}')">
      ${escapeHtml(s.full_name)}<small>${escapeHtml(s.grade_level || '')} / الشعبة ${escapeHtml(s.section_number || '')}</small>
    </button>
  `).join('');
  box.style.display = 'block';
}

/* "مخالفة واحدة / مخالفتان / 3 مخالفات / 11 مخالفة" — للقائمة وبطاقة الطالب */
function crmIncidentCountText(n){
  return n === 1 ? 'مخالفة واحدة' : n === 2 ? 'مخالفتان' : n <= 10 ? n + ' مخالفات' : n + ' مخالفة';
}

function selectCrmIncidentStudent(id){
  const s = crmStudents.find(x => x.id === id);
  if(!s) return;
  document.getElementById('crmIncidentStudentId').value = id;
  document.getElementById('crmIncidentStudentSearch').value = '';
  document.getElementById('crmIncidentStudentResults').style.display = 'none';
  document.getElementById('crmIncidentStudentBox').style.display = 'none';
  const card = document.getElementById('crmIncidentStudentCard');
  card.style.display = 'flex';
  card.innerHTML = `<span class="crm-stu-av" aria-hidden="true">${escapeHtml((s.full_name || '؟').trim().charAt(0))}</span>
    <span class="crm-stu-main"><b>${escapeHtml(s.full_name)}</b>
      <small>${escapeHtml(s.grade_level || '')} / الشعبة ${escapeHtml(s.section_number || '')}</small>
      <small id="crmIncidentStudentStat"></small></span>
    <button type="button" class="crm-stu-clear" aria-label="تغيير الطالب" onclick="clearCrmIncidentStudent(true)">✕</button>`;
  loadCrmIncidentStudentStat(id);
  refreshOccurrencePreview();
  updateCrmIncidentSaveState();
}

/* بطاقة الطالب: عدد مخالفاته بهذا الفصل — من سجلات هذا المعلم فقط */
async function loadCrmIncidentStudentStat(studentId){
  const semester = getCrmSemesterLabel();
  const { data, error } = await sb.from('classroom_incidents')
    .select('id')
    .eq('teacher_id', currentUser.id)
    .eq('student_id', studentId)
    .eq('semester_label', semester);
  /* المعلم غيّر الطالب أثناء الانتظار: لا نكتب إحصاء طالب على بطاقة آخر */
  if(error || document.getElementById('crmIncidentStudentId').value !== studentId) return;
  const el = document.getElementById('crmIncidentStudentStat');
  if(!el) return;
  const n = (data || []).length;
  el.textContent = n ? 'لديه ' + crmIncidentCountText(n) + ' هذا الفصل' : 'لا مخالفات له هذا الفصل';
  el.classList.toggle('is-warn', n > 0);
}

function clearCrmIncidentStudent(focusSearch){
  document.getElementById('crmIncidentStudentId').value = '';
  document.getElementById('crmIncidentStudentSearch').value = '';
  document.getElementById('crmIncidentStudentResults').style.display = 'none';
  document.getElementById('crmIncidentStudentCard').style.display = 'none';
  document.getElementById('crmIncidentStudentBox').style.display = 'block';
  refreshOccurrencePreview();
  updateCrmIncidentSaveState();
  if(focusSearch){ const inp = document.getElementById('crmIncidentStudentSearch'); if(inp && inp.focus) inp.focus(); }
}

const CRM_DEGREE_LABELS = { 1: 'الدرجة الأولى', 2: 'الدرجة الثانية', 3: 'الدرجة الثالثة', 4: 'الدرجة الرابعة', 5: 'الدرجة الخامسة' };

function renderCrmIncidentTypeSelect(){
  const sel = document.getElementById('crmIncidentType');
  const degreeLabels = CRM_DEGREE_LABELS;
  const groups = {};
  crmIncidentTypes.forEach(t => {
    groups[t.problem_degree] = groups[t.problem_degree] || [];
    groups[t.problem_degree].push(t);
  });
  let html = '<option value="">اختر نوع المخالفة</option>';
  Object.keys(groups).sort((a,b)=>a-b).forEach(deg => {
    html += `<optgroup label="${degreeLabels[deg] || ('الدرجة ' + deg)} (${groups[deg].length})">`;
    html += groups[deg].map(t => `<option value="${t.id}">${escapeHtml(t.problem_name)} — ${t.regulation_article}</option>`).join('');
    html += '</optgroup>';
  });
  sel.innerHTML = html;
}

/* دالة صرفة: مرحلة المخالفة والإجراء من نوعها ورقم تكرارها بالفصل —
   اللائحة هي المرجع (الدرجة والتسلسل من نوع المخالفة)، لا رأي المعلم */
function incidentStageFor(type, occurrence){
  if(!type) return { stage: 'warning_1', actionText: '' };
  if(type.action_sequence === 'immediate_referral'){
    return { stage: 'referred', actionText: 'تحويل فوري لوكيل شؤون الطلاب (من أول حادثة حسب ' + type.regulation_article + ')' };
  }
  if(occurrence === 1) return { stage: 'warning_1', actionText: type.stage_1_label };
  if(occurrence === 2) return { stage: 'warning_2', actionText: type.stage_2_label };
  return { stage: 'referred', actionText: 'تحويل لوكيل شؤون الطلاب — هذه المرة رقم ' + occurrence + ' لنفس المخالفة' };
}

/* رقم تكرار نفس المخالفة لنفس الطالب بهذا الفصل (التالية) */
async function computeIncidentOccurrence(studentId, typeId, semester){
  const { data, error } = await sb.from('classroom_incidents')
    .select('id')
    .eq('teacher_id', currentUser.id)
    .eq('student_id', studentId)
    .eq('incident_type_id', typeId)
    .eq('semester_label', semester);
  if(error) throw error;
  return (data ? data.length : 0) + 1;
}

/* تسجيل مخالفة رسمية — مسار واحد لكل الشاشات (تبويب "تسجيل مخالفة" وورقة
   الحصة وملف الطالب). رقم التكرار يُعاد حسابه لحظة الحفظ لا وقت المعاينة:
   لو سُجّلت مخالفة أخرى بينهما (تبويب/جهاز آخر) لا نحفظ مرحلة قديمة. */
async function insertClassroomIncident({ studentId, typeId, notes, incidentDate }){
  const semester = getCrmSemesterLabel();
  const occurrence = await computeIncidentOccurrence(studentId, typeId, semester);
  const type = crmIncidentTypes.find(t => t.id === typeId);
  const { stage } = incidentStageFor(type, occurrence);
  /* الشعبة وقت الحدث (لا شعبة الطالب الحالية لاحقًا): لو نُقل الطالب بعد
     ذلك، تبقى المخالفة منسوبة للشعبة التي وقعت فيها فعلًا */
  const student = crmStudents.find(s => s.id === studentId);
  const row = {
    teacher_id: currentUser.id,
    student_id: studentId,
    section_id: (student && student.section_id) || null,
    incident_type_id: typeId,
    semester_label: semester,
    occurrence_number: occurrence,
    current_stage: stage,
    notes: notes || null,
    referral_letter_generated: false
  };
  if(incidentDate) row.incident_date = incidentDate;
  const { data: created, error } = await sb.from('classroom_incidents').insert(row).select('id').maybeSingle();
  if(error) throw error;
  crmIncidentTypeUsage = null; /* "الأكثر استخدامًا" تُعاد قراءتها */
  if(typeof invalidateAttention === 'function'){ invalidateAttention(); refreshAttention(); }
  return { stage, occurrence, id: created && created.id };
}

async function refreshOccurrencePreview(){
  const studentId = document.getElementById('crmIncidentStudentId').value;
  const typeId = document.getElementById('crmIncidentType').value;
  const box = document.getElementById('crmOccurrencePreview');
  if(!studentId || !typeId){ box.style.display = 'none'; delete box.dataset.stage; updateCrmIncidentSaveState(); return; }
  const semester = getCrmSemesterLabel();

  let occurrence;
  try{ occurrence = await computeIncidentOccurrence(studentId, typeId, semester); }
  catch(error){ showToast('خطأ في الحساب: ' + error.message, 'error'); return; }
  /* تغيّر الاختيار أثناء الحساب: نتيجة قديمة لا تُعرض ولا تُكتب فوق الأحدث */
  if(document.getElementById('crmIncidentStudentId').value !== studentId || document.getElementById('crmIncidentType').value !== typeId) return;
  const type = crmIncidentTypes.find(t => t.id === typeId);
  const { stage, actionText } = incidentStageFor(type, occurrence);
  const referred = stage === 'referred';

  box.style.display = 'block';
  box.dataset.occurrence = occurrence;
  box.dataset.stage = stage;
  box.innerHTML = `
    <div class="crm-prev${referred ? ' is-ref' : ''}">
      <div class="crm-prev-k">المرة رقم ${occurrence} لهذه المخالفة هذا الفصل <span class="crm-prev-sem">(${escapeHtml(semester)})</span></div>
      <div class="crm-prev-v">${escapeHtml(actionText)}</div>
      ${referred ? '<div class="crm-prev-w">⚠ يلزم إصدار خطاب تحويل بعد الحفظ</div>' : ''}
    </div>
  `;
  updateCrmIncidentSaveState();
}

/* الزر معطّل حتى يكتمل الاختيار، ونصه يقول ما ينقص */
function updateCrmIncidentSaveState(){
  const btn = document.getElementById('crmIncidentSaveBtn');
  if(!btn) return;
  const hasStudent = !!document.getElementById('crmIncidentStudentId').value;
  const hasType = !!document.getElementById('crmIncidentType').value;
  const box = document.getElementById('crmOccurrencePreview');
  const referred = hasStudent && hasType && box.style.display !== 'none' && box.dataset.stage === 'referred';
  btn.disabled = crmIncidentSaving || !hasStudent || !hasType;
  btn.textContent = crmIncidentSaving ? 'جارٍ الحفظ…'
    : !hasStudent && !hasType ? 'اختر الطالب والمخالفة'
    : !hasStudent ? 'اختر الطالب'
    : !hasType ? 'اختر المخالفة'
    : referred ? 'حفظ — يلزم خطاب تحويل' : 'حفظ المخالفة';
  btn.classList.toggle('is-referral', !!referred);
}

function autoGrowCrmIncidentNotes(el){
  if(!el || !el.style) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight || 0, 140) + 'px';
}

let crmIncidentSaving = false;

async function saveClassroomIncident(){
  const studentId = document.getElementById('crmIncidentStudentId').value;
  const typeId = document.getElementById('crmIncidentType').value;
  const notes = document.getElementById('crmIncidentNotes').value.trim();
  const box = document.getElementById('crmOccurrencePreview');
  if(!studentId || !typeId){ showToast('أكمل اختيار الطالب ونوع المخالفة', 'error'); return; }
  /* نقرة مزدوجة كانت تُسجّل نفس المخالفة مرتين (وترفع رقم التكرار خطأً) */
  if(crmIncidentSaving) return;
  crmIncidentSaving = true;
  updateCrmIncidentSaveState();
  let result;
  try{
    result = await insertClassroomIncident({ studentId, typeId, notes });
  } catch(error){
    showToast('تعذّر الحفظ: ' + error.message, 'error');
    return;
  } finally {
    crmIncidentSaving = false;
    updateCrmIncidentSaveState();
  }
  resetCrmIncidentForm();
  closeCrmIncidentSheet();
  if(result.id){
    /* الإشعار نفسه يحمل "تراجع" لبضع ثوانٍ؛ لا ننتظره حتى تتحدّث القائمة فورًا */
    offerCrmIncidentUndo(result.id, result.stage === 'referred' ? 'تم الحفظ — الحالة تتطلب تحويل' : 'تم حفظ التنبيه');
  } else {
    showToast(result.stage === 'referred' ? 'تم الحفظ — الحالة تتطلب تحويل' : 'تم حفظ التنبيه', 'ok');
  }
  await renderCrmRecentIncidents();
  await refreshCrmPendingBadges();
}

/* تراجع عن مخالفة سُجّلت للتوّ: يحذف سجلها هي فقط (بمعلمها)، ولا يحذف إن صدر لها خطاب */
async function offerCrmIncidentUndo(incidentId, msg){
  let keep = true;
  try{ keep = await showUndoToast(msg, 6); }
  catch(e){ return; }
  if(keep) return;
  const { error } = await sb.from('classroom_incidents').delete()
    .eq('teacher_id', currentUser.id).eq('id', incidentId).eq('referral_letter_generated', false);
  if(error){ showToast('تعذّر التراجع: ' + error.message, 'error'); return; }
  crmIncidentTypeUsage = null;
  if(typeof invalidateAttention === 'function'){ invalidateAttention(); refreshAttention(); }
  await renderCrmRecentIncidents();
  await refreshCrmPendingBadges();
  showToast('تم التراجع عن التسجيل', 'ok');
}

async function getCrmTransferCounts(){
  return getTransferCounts(CRM_TRANSFER_CFG);
}

async function refreshCrmPendingBadges(){
  return refreshTransferBadges(CRM_TRANSFER_CFG);
}

async function fetchCrmStudentById(id){
  const { data } = await sb.from('classroom_students').select('*').eq('teacher_id', currentUser.id).eq('id', id).maybeSingle();
  return data;
}

let rlCurrentIncident = null;

async function openReferralLetter(incidentId){
  const { data: inc, error } = await sb.from('classroom_incidents').select('*').eq('teacher_id', currentUser.id).eq('id', incidentId).maybeSingle();
  if(error || !inc){ showToast('تعذّر تحميل بيانات الحادثة', 'error'); return; }

  let student = crmStudents.find(s => s.id === inc.student_id);
  if(!student) student = await fetchCrmStudentById(inc.student_id);
  const type = crmIncidentTypes.find(t => t.id === inc.incident_type_id);
  if(!student || !type){ showToast('تعذّر تحميل بيانات الطالب أو نوع المخالفة', 'error'); return; }

  const { data: priorList } = await sb.from('classroom_incidents')
    .select('incident_date, occurrence_number')
    .eq('teacher_id', currentUser.id)
    .eq('student_id', inc.student_id)
    .eq('incident_type_id', inc.incident_type_id)
    .eq('semester_label', inc.semester_label)
    .lt('occurrence_number', inc.occurrence_number)
    .order('occurrence_number');

  rlCurrentIncident = { incident: inc, student, type, priorList: priorList || [] };

  hideAllMainViews();
  document.getElementById('referralLetterView').style.display = 'block';

  const meta = (currentUser && currentUser.user_metadata) || {};
  const missing = [];
  if(!meta.full_name) missing.push('اسم المعلم');
  const warnBox = document.getElementById('rlMissingWarning');
  if(missing.length){
    warnBox.style.display = 'block';
    warnBox.innerHTML = '⚠ بيانات ناقصة: ' + missing.join('، ') + ' — أكملها من الصفحة الرئيسية (الملف الشخصي) قبل الإصدار النهائي.';
  } else {
    warnBox.style.display = 'none';
  }

  let suggestedNumber = 1;
  const { data: counterRow } = await sb.from('classroom_letter_counters').select('next_number').eq('teacher_id', currentUser.id).maybeSingle();
  if(counterRow) suggestedNumber = counterRow.next_number;

  document.getElementById('rlOutgoingNumber').value = inc.referral_letter_number || String(suggestedNumber);
  document.getElementById('rlDate').value = new Date().toISOString().slice(0,10);

  const photoSection = document.getElementById('rlPhotoUploadSection');
  const photoBox = document.getElementById('rlPhotoPreviewBox');
  if(receiptSectionVisible(inc.referral_letter_generated, inc.referral_receipt_photo_url)){
    photoSection.style.display = 'block';
    if(inc.referral_receipt_photo_url){
      document.getElementById('rlPhotoPreviewImg').src = inc.referral_receipt_photo_url;
      photoBox.style.display = 'block';
    } else {
      photoBox.style.display = 'none';
    }
  } else {
    photoSection.style.display = 'none';
    photoBox.style.display = 'none';
  }

  renderReferralLetterPreview();
}

/* شعار وزارة التعليم — مقصوص من نموذج "إحالة طالب/ة" الرسمي (وزارة التعليم)
   ومُضمَّن مباشرة (WebP) بدل ملف صورة منفصل، ليعمل النموذج بلا اتصال
   ويظهر بشكل متطابق بالطباعة المباشرة وPDF وWord على حدٍّ سواء. */
const MOE_LOGO_DATA_URI = 'data:image/webp;base64,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';

/* نموذج "إحالة طالب/ة" الرسمي (وزارة التعليم) بنص وترتيب مطابقين تمامًا
   للنموذج المعتمد — يملأ فقط الحقول الفعلية الموجودة فيه (لا رقم صادر ولا
   جهة توجيه مخصّصة، فالنموذج الرسمي ثابت الصياغة). حقل "المنطقة/المحافظة"
   يُملأ تلقائيًا من الملف الشخصي (افتراضيًا "جدة" لو لم يُضِف المعلم حقلًا
   مخصصًا باسم "المنطقة/المحافظة")، وباقي التوقيع/الختم تُترك فارغة للتعبئة
   اليدوية بعد الطباعة كما بالنموذج الأصلي (وكيل شؤون الطلبة شخص آخر غير
   المعلم، والختم لا يُنتَج إلكترونيًا). */
function buildOfficialReferralLetterHtml(){
  const { incident, student, type } = rlCurrentIncident;
  const school = (typeof getProfileSchool === 'function') ? getProfileSchool() : '';
  const region = (typeof getProfileRegion === 'function') ? getProfileRegion() : 'جدة';
  const dateVal = document.getElementById('rlDate').value;
  let dateDisplay = '';
  if(dateVal){
    try{ dateDisplay = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { year:'numeric', month:'long', day:'numeric' }).format(new Date(dateVal)); }
    catch(e){ dateDisplay = dateVal; }
  }
  const classLine = [student.grade_level, student.section_number ? ('الشعبة ' + student.section_number) : '']
    .filter(Boolean).join(' — ') || '—';

  return `
    <div dir="rtl" style="width:794px;max-width:100%;background:#fff;color:#003744;font-family:'Amiri','Traditional Arabic','Times New Roman',serif;padding:46px 54px 34px;box-sizing:border-box;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;">
        <div style="display:flex;flex-direction:column;gap:14px;min-width:0;">
          <img src="${MOE_LOGO_DATA_URI}" alt="وزارة التعليم" style="height:78px;width:auto;">
          <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;">
            <div style="display:flex;align-items:baseline;gap:6px;white-space:nowrap;">
              <span>المنطقة/المحافظة</span>
              <span style="flex:1;min-width:90px;border-bottom:1px dotted #9FB3B8;padding-bottom:2px;color:#3C5A63;font-size:12.5px;">${escapeHtml(region)}</span>
            </div>
            <div style="display:flex;align-items:baseline;gap:6px;white-space:nowrap;">
              <span>المدرسة</span>
              <span style="flex:1;min-width:90px;border-bottom:1px dotted #9FB3B8;padding-bottom:2px;color:#3C5A63;font-size:12.5px;">${escapeHtml(school)}</span>
            </div>
          </div>
        </div>
        <div style="text-align:right;font-size:14.5px;font-weight:700;line-height:2;white-space:nowrap;">
          <div>المملكة العربية السعودية</div>
          <div>وزارة التعليـــــــم</div>
        </div>
      </div>

      <div style="display:flex;justify-content:center;margin:20px 0 8px;">
        <img src="${MOE_LOGO_DATA_URI}" alt="" style="height:112px;width:auto;">
      </div>

      <div style="text-align:center;margin:14px 0 26px;">
        <div style="font-size:17px;font-weight:700;margin-bottom:10px;">سري</div>
        <div style="font-size:23px;font-weight:700;">إحالة طالب/ة</div>
      </div>

      <div style="font-size:15px;line-height:2.3;">
        <p style="font-weight:700;margin:0 0 14px;">المكرم الموجه الطلابي / الموجهة الطلابية</p>
        <p style="text-align:center;margin:0 0 20px;">السلام عليكم ورحمة الله وبركاته</p>
        <p style="margin:0 0 14px;">نحيل إليكم الطالب/الطالبة
          <span style="border-bottom:1.5px solid #003744;padding:0 4px 1px;font-weight:700;display:inline-block;min-width:220px;text-align:center;">${escapeHtml(student.full_name)}</span>
        </p>
        <p style="margin:0 0 14px;">بالصف:
          <span style="border-bottom:1.5px solid #003744;padding:0 4px 1px;font-weight:700;display:inline-block;min-width:64px;text-align:center;">${escapeHtml(classLine)}</span>
          ذي المشكلة السلوكية من الدرجة
          <span style="border-bottom:1.5px solid #003744;padding:0 4px 1px;font-weight:700;display:inline-block;min-width:64px;text-align:center;">${escapeHtml(String(type.problem_degree))}</span>
          وهي:
          <span style="border-bottom:1.5px solid #003744;padding:0 4px 1px;font-weight:700;display:inline-block;min-width:220px;text-align:center;">${escapeHtml(type.problem_name)}</span>
        </p>
        <p style="margin:22px 0 0;">يرجى منكم متابعة الطالب/الطالبة ودراسة حالته/حالتها، ووضع الحلول التربوية والعلاجية المناسبة.</p>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:60px;gap:24px;">
        <div style="font-size:14px;font-weight:700;">الختم</div>
        <div style="font-size:13.5px;line-height:2.1;">
          <div style="font-weight:700;margin-bottom:6px;">وكيل/وكيلة شؤون الطلبة</div>
          <div style="display:flex;gap:6px;align-items:baseline;white-space:nowrap;">الاسم: <span style="flex:1;min-width:120px;border-bottom:1px dotted #9FB3B8;height:1px;align-self:center;"></span></div>
          <div style="display:flex;gap:6px;align-items:baseline;white-space:nowrap;">التوقيع: <span style="flex:1;min-width:120px;border-bottom:1px dotted #9FB3B8;height:1px;align-self:center;"></span></div>
          <div style="display:flex;gap:6px;align-items:baseline;white-space:nowrap;">التاريخ: <span style="border-bottom:1px dotted #9FB3B8;min-width:120px;padding-bottom:2px;font-weight:700;">${escapeHtml(dateDisplay)}</span></div>
        </div>
      </div>

      <div dir="ltr" style="margin-top:22px;height:30px;border-radius:15px;background:linear-gradient(to right, #4EBA7A, #3985B9);display:flex;align-items:center;justify-content:center;gap:8px;color:#fff;font-family:'Cairo',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;">
        <span>🌐</span><span>WWW.MOE.GOV.SA</span>
      </div>
    </div>`;
}

function renderReferralLetterPreview(){
  if(!rlCurrentIncident) return;
  document.getElementById('rlPreview').innerHTML = buildOfficialReferralLetterHtml();
}

async function buildReferralLetterPdfBlob(){
  return buildLetterPdfBlob('rlPreview', rlCurrentIncident && rlCurrentIncident.incident.referral_receipt_photo_url);
}

async function downloadReferralLetterPDF(evt){
  const studentName = rlCurrentIncident ? rlCurrentIncident.student.full_name : 'خطاب';
  return downloadLetterPdfFile(buildReferralLetterPdfBlob, studentName, 'خطاب تحويل', evt);
}

async function shareReferralLetterWhatsApp(evt){
  const studentName = rlCurrentIncident ? rlCurrentIncident.student.full_name : 'خطاب';
  return shareLetterWhatsApp(buildReferralLetterPdfBlob, studentName, 'خطاب تحويل', evt);
}

async function printReferralLetter(evt){
  return printLetterContent(buildReferralLetterPdfBlob, evt);
}

async function downloadReferralLetterWordFile(evt){
  const studentName = rlCurrentIncident ? rlCurrentIncident.student.full_name : 'خطاب';
  return downloadLetterWordFile('rlPreview', rlCurrentIncident && rlCurrentIncident.incident.referral_receipt_photo_url, studentName, 'خطاب تحويل', evt);
}

async function confirmReferralLetterIssued(){
  return confirmLetterIssued(RL_LETTER_CFG);
}

function compressImageFile(file, maxDim, quality){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('تعذّر فتح الصورة'));
      img.onload = () => {
        let width = img.width, height = img.height;
        if(width > maxDim || height > maxDim){
          if(width > height){ height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if(blob) resolve(blob); else reject(new Error('تعذّر ضغط الصورة'));
        }, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadReferralReceiptPhoto(event){
  return uploadLetterReceiptPhoto(event, RL_LETTER_CFG);
}

async function deleteReferralReceiptPhoto(){
  return deleteLetterReceiptPhoto(RL_LETTER_CFG);
}

async function deleteCrmIncident(id){
  return trashRunOnce('incident:' + id, async () => {
    const ok = await showConfirm('حذف هذه المخالفة؟ سيُعاد حساب رقم التكرار تلقائيًا للمخالفات المتبقية من نفس النوع مستقبلًا. تبقى في «المحذوفات» ' + TRASH_DAYS + ' يومًا فتستطيع استرجاعها.');
    if(!ok || !currentUser) return;
    const uid = currentUser.id;
    const prot = await trashProtect(() => trashCaptureSingle('incident', 'classroom_incidents', 'teacher_id', id, uid, r => 'مخالفة ' + (r.incident_date || '')));
    if(!prot) return;
    const { error } = await sb.from('classroom_incidents').delete().eq('teacher_id', uid).eq('id', id);
    if(error){ await trashDiscard(prot.id); showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
    crmIncidentTypeUsage = null;
    await renderCrmRecentIncidents();
    await refreshCrmPendingBadges();
    trashOfferUndo('تم حذف المخالفة', prot.id, async () => {
      crmIncidentTypeUsage = null;
      if(typeof invalidateAttention === 'function'){ invalidateAttention(); refreshAttention(); }
      await renderCrmRecentIncidents();
      await refreshCrmPendingBadges();
    });
  });
}

let crmIncidentFilter = 'all';
const CRM_INCIDENT_FILTERS = ['all', 'week', 'pending'];

function jumpToCrmFilter(mode){
  setCrmIncidentFilter(mode);
  const el = document.getElementById('crmIncidentsListSection');
  if(el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setCrmIncidentFilter(mode){
  if(!CRM_INCIDENT_FILTERS.includes(mode)) mode = 'all'; /* "غير موثّق" أُلغي */
  setListFilter({ setValue: v => { crmIncidentFilter = v; }, btnPrefix: 'crmFilterBtn_', render: renderCrmRecentIncidents }, mode);
}

/* بداية الأسبوع الدراسي (الأحد) لتاريخ محلي */
function crmWeekStartIso(todayIso){
  return addDaysIso(todayIso, -weekdayOfIso(todayIso));
}

/* عدّا "الكل" و"هذا الأسبوع" في مربعات الملخص — فشلها يُبقي "—" ولا يعطّل القائمة */
async function refreshCrmIncidentCounts(){
  const uid = currentUser && currentUser.id;
  if(!uid) return;
  const { data, error } = await fetchAllRows((from, to) => sb.from('classroom_incidents').select('incident_date')
    .eq('teacher_id', uid).order('created_at', { ascending: false }).range(from, to));
  if(error || !currentUser || currentUser.id !== uid) return;
  const weekStart = crmWeekStartIso(localIsoDate());
  const all = (data || []).length;
  const week = (data || []).filter(r => r.incident_date && r.incident_date >= weekStart).length;
  const a = document.getElementById('crmIncAllCount'); if(a) a.textContent = all;
  const w = document.getElementById('crmIncWeekCount'); if(w) w.textContent = week;
}

/* ============ لوحة "تسجيل مخالفة" (3 خطوات) ============ */
async function openCrmIncidentSheet(studentId){
  const ov = document.getElementById('crmIncidentSheet');
  if(!ov) return;
  ov.style.display = 'flex';
  if(studentId) selectCrmIncidentStudent(studentId);
  updateCrmIncidentSaveState();
  await renderCrmIncidentTypeChips();
}

function closeCrmIncidentSheet(){
  const ov = document.getElementById('crmIncidentSheet');
  if(ov) ov.style.display = 'none';
  const res = document.getElementById('crmIncidentStudentResults');
  if(res) res.style.display = 'none';
  closeCrmTypePicker();
}

/* تصفير النموذج كله (بعد الحفظ أو تغيير السنة) */
function resetCrmIncidentForm(){
  const notes = document.getElementById('crmIncidentNotes');
  notes.value = '';
  if(notes.style) notes.style.height = '';
  document.getElementById('crmIncidentType').value = '';
  const box = document.getElementById('crmOccurrencePreview');
  box.style.display = 'none';
  delete box.dataset.stage;
  clearCrmIncidentStudent(false);
  markCrmIncidentTypeChips();
}

const crmDegDigits = '٠١٢٣٤٥٦٧٨٩';
function crmDegreeBadge(type){
  const d = Number(type && type.problem_degree);
  if(!d) return '';
  const ar = String(d).replace(/\d/g, c => crmDegDigits[c]);
  return `<span class="crm-type-deg"><i class="crm-dot${d >= 1 && d <= 5 ? ' d' + d : ''}"></i>د${ar}</span>`;
}

/* أكثر 6 مخالفات استخدامًا لدى المعلم كصفوف بعرض كامل + "كل المخالفات" تفتح ورقة
   البحث. بلا سجل سابق: زر "كل المخالفات" وحده */
async function renderCrmIncidentTypeChips(){
  const box = document.getElementById('crmIncidentTypeChips');
  const sel = document.getElementById('crmIncidentType');
  if(!box || !sel) return;
  if(!crmIncidentTypes.length && typeof loadCrmIncidentTypes === 'function') await loadCrmIncidentTypes();
  const usage = typeof loadCrmIncidentTypeUsage === 'function' ? await loadCrmIncidentTypeUsage() : null;
  const top = typeof topIncidentTypes === 'function' ? topIncidentTypes(crmIncidentTypes, usage, 6) : [];
  const hint = document.getElementById('crmIncidentTypeHint');
  if(hint) hint.textContent = top.length ? '· الأكثر استخدامًا' : '';
  const cur = sel.value;
  /* المختار من ورقة البحث وليس من الأكثر استخدامًا: يظهر أول القائمة */
  const picked = cur && !top.some(t => t.id === cur) ? crmIncidentTypes.find(t => t.id === cur) : null;
  const rows = (picked ? [picked] : []).concat(top);
  box.innerHTML = rows.map(t => {
    const on = cur === t.id;
    return `<button type="button" class="crm-type-row${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" data-type="${t.id}" onclick="pickCrmIncidentType('${t.id}')"><span class="crm-type-rad" aria-hidden="true"></span><span class="crm-type-t">${escapeHtml(t.problem_name)}</span>${crmDegreeBadge(t)}</button>`;
  }).join('')
    + `<button type="button" class="crm-type-row is-more" onclick="openCrmTypePicker()"><span>كل المخالفات (${crmIncidentTypes.length}) وبحث</span><span aria-hidden="true">‹</span></button>`;
  revealCrmPickedType();
}

/* الخيار المحدَّد يبقى ظاهرًا كاملًا (لا مقصوصًا تحت العنوان) ويومض لحظة */
function revealCrmPickedType(){
  const box = document.getElementById('crmIncidentTypeChips');
  const row = box && box.querySelector ? box.querySelector('.crm-type-row.is-on') : null;
  if(!row || !row.scrollIntoView) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  row.classList.remove('is-flash'); void row.offsetWidth; row.classList.add('is-flash');
}

function pickCrmIncidentType(id){
  const sel = document.getElementById('crmIncidentType');
  if(!sel) return;
  sel.value = id;
  markCrmIncidentTypeChips();
  revealCrmPickedType();
  refreshOccurrencePreview();
  updateCrmIncidentSaveState();
}

function onCrmIncidentTypeSelect(){
  markCrmIncidentTypeChips();
  refreshOccurrencePreview();
  updateCrmIncidentSaveState();
}

function markCrmIncidentTypeChips(){
  const sel = document.getElementById('crmIncidentType');
  const box = document.getElementById('crmIncidentTypeChips');
  if(!sel || !box || !box.querySelectorAll) return;
  const rows = [...box.querySelectorAll('.crm-type-row[data-type]')];
  /* اختيار من خارج الصفوف الحالية (ورقة البحث) أو ما زال المحدد القديم ظاهرًا: نعيد الرسم */
  if(sel.value && !rows.some(b => b.dataset.type === sel.value)){ renderCrmIncidentTypeChips(); return; }
  rows.forEach(b => {
    const on = b.dataset.type === sel.value;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

/* ============ ورقة "كل المخالفات": بحث + تصفية بالدرجة ============ */
let crmTypePickerDegree = 0;

function openCrmTypePicker(){
  const ov = document.getElementById('crmTypePicker');
  if(!ov) return;
  crmTypePickerDegree = 0;
  document.getElementById('crmTypePickerSearch').value = '';
  ov.style.display = 'flex';
  renderCrmTypePicker();
  const inp = document.getElementById('crmTypePickerSearch');
  if(inp && inp.focus) inp.focus();
}

function closeCrmTypePicker(){
  const ov = document.getElementById('crmTypePicker');
  if(ov) ov.style.display = 'none';
}

function setCrmTypePickerDegree(d){
  crmTypePickerDegree = Number(d) || 0;
  renderCrmTypePicker();
}

function renderCrmTypePicker(){
  const list = document.getElementById('crmTypePickerList');
  const pills = document.getElementById('crmTypePickerPills');
  if(!list || !pills) return;
  const q = (document.getElementById('crmTypePickerSearch').value || '').trim();
  const cur = document.getElementById('crmIncidentType').value;
  const degrees = [...new Set(crmIncidentTypes.map(t => Number(t.problem_degree)).filter(Boolean))].sort((a, b) => a - b);
  pills.innerHTML = [`<button type="button" class="crm-pill${crmTypePickerDegree === 0 ? ' is-on' : ''}" onclick="setCrmTypePickerDegree(0)">الكل</button>`]
    .concat(degrees.map(d => `<button type="button" class="crm-pill${crmTypePickerDegree === d ? ' is-on' : ''}" onclick="setCrmTypePickerDegree(${d})">${escapeHtml(CRM_DEGREE_LABELS[d] || ('الدرجة ' + d))}</button>`)).join('');
  const shown = crmIncidentTypes.filter(t => (!crmTypePickerDegree || Number(t.problem_degree) === crmTypePickerDegree) && (!q || String(t.problem_name || '').includes(q)));
  if(!shown.length){ list.innerHTML = '<div class="empty-state">لا مخالفات مطابقة.</div>'; return; }
  const groups = {};
  shown.forEach(t => { (groups[t.problem_degree] = groups[t.problem_degree] || []).push(t); });
  list.innerHTML = Object.keys(groups).sort((a, b) => a - b).map(deg =>
    `<div class="crm-picker-grp"><i class="crm-dot${Number(deg) >= 1 && Number(deg) <= 5 ? ' d' + Number(deg) : ''}"></i>${escapeHtml(CRM_DEGREE_LABELS[deg] || ('الدرجة ' + deg))}</div>`
    + groups[deg].map(t => `<button type="button" class="crm-picker-item${t.id === cur ? ' is-on' : ''}" onclick="pickCrmIncidentTypeFromPicker('${t.id}')"><span>${escapeHtml(t.problem_name)}</span>${t.regulation_article ? `<small>${escapeHtml(String(t.regulation_article))}</small>` : ''}</button>`).join('')
  ).join('');
}

function pickCrmIncidentTypeFromPicker(id){
  pickCrmIncidentType(id);
  closeCrmTypePicker();
}

/* خيارات مخالفة (⋯): الخطاب والحذف — الحذف بعيد عن القائمة وبتأكيد وتراجع */
function openCrmIncidentActions(id){
  const inc = (crmIncidentsShown || []).find(x => x.id === id);
  if(!inc) return;
  const type = crmIncidentTypes.find(t => t.id === inc.incident_type_id);
  const needsLetter = inc.current_stage === 'referred' && !inc.referral_letter_generated;
  const hasLetter = inc.current_stage === 'referred' && inc.referral_letter_generated;
  const opt = (ico, title, onclick, cls) => `<button type="button" class="crm-act-opt${cls ? ' ' + cls : ''}" onclick="${onclick}"><span class="crm-act-ic">${ico}</span><span><b>${title}</b></span></button>`;
  showInfoModal(`<div style="text-align:right;">
      <h3 style="margin:0 0 2px;font-size:15px;color:var(--navy);">${type ? escapeHtml(type.problem_name) : 'مخالفة'}</h3>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">${escapeHtml(inc.incident_date || '')} · المرة ${inc.occurrence_number}</div>
      ${needsLetter ? opt('📄', 'إصدار خطاب التحويل', `closeCrmModal();openReferralLetter('${inc.id}')`) : ''}
      ${hasLetter ? opt('📄', 'عرض الخطاب', `closeCrmModal();openReferralLetter('${inc.id}')`) : ''}
      ${opt('🗑', 'حذف المخالفة', `closeCrmModal();deleteCrmIncident('${inc.id}')`, 'is-red')}
    </div>`, '400px');
}

let crmIncidentsShown = [];

async function renderCrmRecentIncidents(){
  const box = document.getElementById('crmRecentIncidents');
  const searchQuery = (document.getElementById('crmIncidentsSearch').value || '').trim();

  /* نبني الاستعلام من جديد بكل صفحة حتى تعمل fetchAllRows بشكل صحيح — وبهذا
     نلغي الحد الثابت (100/200) الذي كان يُسقط حوادث بانتظار المتابعة بصمت
     لمعلم لديه أرشيف كبير */
  const buildQuery = (from, to) => {
    let q = sb.from('classroom_incidents')
      .select('id, incident_date, occurrence_number, current_stage, notes, student_id, incident_type_id, referral_letter_generated, referral_letter_number, referral_receipt_photo_url')
      .eq('teacher_id', currentUser.id);
    if(crmIncidentFilter === 'pending'){
      q = q.eq('current_stage', 'referred').eq('referral_letter_generated', false);
    } else if(crmIncidentFilter === 'week'){
      q = q.gte('incident_date', crmWeekStartIso(localIsoDate()));
    }
    return q.order('created_at', { ascending: false }).range(from, to);
  };

  refreshCrmIncidentCounts();
  const { data, error } = await fetchAllRows(buildQuery);
  if(error){ box.innerHTML = '<div class="empty-state">تعذّر التحميل: ' + escapeHtml(error.message) + '</div>'; return; }
  crmIncidentsShown = data || [];

  const emptyMsg = {
    all: 'لا مخالفات مسجّلة بعد.',
    week: 'لا مخالفات هذا الأسبوع.',
    pending: 'لا مخالفات بانتظار التحويل.'
  };
  if(!data || !data.length){ box.innerHTML = '<div class="empty-state">' + emptyMsg[crmIncidentFilter] + '</div>'; return; }

  let filtered = data;
  if(searchQuery){
    filtered = data.filter(inc => {
      const student = crmStudents.find(s => s.id === inc.student_id);
      return student && student.full_name.includes(searchQuery);
    });
  }
  if(!filtered.length){ box.innerHTML = '<div class="empty-state">لا نتائج مطابقة.</div>'; return; }

  const stageLabel = { warning_1: 'تنبيه أول', warning_2: 'تنبيه ثانٍ', referred: 'محال' };

  const groups = {};
  const order = [];
  filtered.forEach(inc => {
    const sid = inc.student_id;
    if(!groups[sid]){ groups[sid] = []; order.push(sid); }
    groups[sid].push(inc);
  });

  /* بطاقة لكل طالب: عدده وآخر مخالفة وحالتها؛ المخالفات تحتها والإجراءات في ⋯ */
  box.innerHTML = order.map((sid, gi) => {
    const list = groups[sid];
    const student = crmStudents.find(s => s.id === sid);
    const hasPending = list.some(i => i.current_stage === 'referred' && !i.referral_letter_generated);
    const groupId = 'crmGroup' + gi;
    const latest = list[0];
    const latestType = crmIncidentTypes.find(t => t.id === latest.incident_type_id);
    const countText = crmIncidentCountText(list.length);

    const itemsHtml = list.map(inc => {
      const type = crmIncidentTypes.find(t => t.id === inc.incident_type_id);
      const needsLetter = inc.current_stage === 'referred' && !inc.referral_letter_generated;
      const hasLetter = inc.current_stage === 'referred' && inc.referral_letter_generated;
      return `<div class="crm-inc-item">
          <div class="crm-inc-item-main">
            <b>${type ? escapeHtml(type.problem_name) : '—'}</b>
            <small>${escapeHtml(inc.incident_date || '')} · المرة ${inc.occurrence_number} · ${stageLabel[inc.current_stage] || escapeHtml(inc.current_stage || '')}${hasLetter && inc.referral_letter_number ? ' · خطاب رقم ' + escapeHtml(inc.referral_letter_number) : ''}</small>
            ${inc.notes ? `<small class="crm-inc-note">${escapeHtml(inc.notes)}</small>` : ''}
            ${needsLetter ? `<button type="button" class="btn btn-primary crm-mini-btn crm-inc-letter" onclick="openReferralLetter('${inc.id}')">📄 إصدار خطاب التحويل</button>` : ''}
          </div>
          <button type="button" class="crm-lrow-more" aria-label="خيارات المخالفة" onclick="openCrmIncidentActions('${inc.id}')">⋯</button>
        </div>`;
    }).join('');

    return `<div class="crm-inc-card">
        <button type="button" class="crm-inc-card-head" onclick="toggleCrmGroup('${groupId}')">
          <span class="crm-inc-card-main"><b>${student ? escapeHtml(student.full_name) : 'طالب محذوف'}</b>
            <small>آخرها: ${latestType ? escapeHtml(latestType.problem_name) : '—'} · ${escapeHtml(latest.incident_date || '')}</small></span>
          <span class="gs-chip">${countText}</span>${hasPending ? '<span class="gs-chip now">بانتظار التحويل</span>' : ''}
          <span id="${groupId}_arrow" class="crm-inc-arrow">${hasPending ? '▾' : '▸'}</span>
        </button>
        <div id="${groupId}" style="display:${hasPending ? 'block' : 'none'};">${itemsHtml}</div>
      </div>`;
  }).join('');
}

function toggleCrmGroup(id){
  const el = document.getElementById(id);
  const arrow = document.getElementById(id + '_arrow');
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if(arrow) arrow.textContent = open ? '▸' : '▾';
}
async function showHome(){
  hideAllMainViews();
  setActiveBottomTab('home');
  document.getElementById('homeView').style.display = 'block';
  renderDateInfoBar();
  await refreshPlanSummary();
  renderServiceAlert();
  renderHomeProgressCard();
  renderCurrentWeekWidget();
  loadAndRenderHomeDashboardExtras();
  maybeShowOnboardingTour();
}

/* ============================================
   بطاقة التقدّم بالرئيسية — بسيطة باتفاق صريح مع المستخدم: النسبة الموزونة
   + شريط + شارة صغيرة لمرحلة دورة الأداء الحالية، بلا نصوص شرح. التفاصيل
   (حالة كل عنصر) بالضغط على البطاقة، وشرح المرحلة الرسمي بالضغط على الشارة.
   ============================================ */
function renderHomeProgressCard(){
  const card = document.getElementById('homeProgressCard');
  if(!card) return;

  if(!getElementsOrder().length || !appSectionOn('shahid')){ card.style.display = 'none'; return; }

  const wp = computeWeightedProgress();
  const barColor = wp.pct >= 80 ? '#215C34' : (wp.pct >= 40 ? 'var(--gold)' : '#B23A3A');
  const pctColor = wp.pct >= 80 ? '#215C34' : (wp.pct >= 40 ? 'var(--gold-text)' : '#B23A3A');
  const stage = CYCLE_STAGES[getCycleStageKey()];

  card.innerHTML = `
    <div class="home-progress-top">
      <span class="home-progress-label">
        الاكتمال الموزون لعناصر الأداء
        <button type="button" class="home-stage-chip" onclick="event.stopPropagation();showPhaseInfoModal()">${escapeHtml(stage.label)}</button>
      </span>
      <span class="home-progress-pct" style="color:${pctColor};">${wp.pct}%</span>
    </div>
    <div class="home-progress-track"><div class="home-progress-fill" style="background:${barColor};width:${wp.pct}%;"></div></div>`;

  card.style.display = 'block';
}

/* ============================================
   بطاقة "يحتاج إجراء الآن" + ملخّص "أعمالي" بالرئيسية
   ------------------------------------------------------------
   تُستدعى من showHome بلا await (fire-and-forget)، بنفس نمط
   renderCurrentWeekWidget تمامًا: تجلب مهامّي وبرامجي (غير محمَّلة أصلًا
   عند showHome، فقط عند زيارة "أعمالي" فعليًا)، ثم تتحقق أن المستخدم لا
   يزال فعليًا بالرئيسية (stillOnHome) بعد كل await قبل أي كتابة بالـDOM —
   لو انتقل لشاشة أخرى أثناء انتظار الشبكة، نتجاهل النتيجة بصمت بدل كتابة
   بيانات على بطاقة لم تعد ظاهرة أصلًا.
   ============================================ */
function stillOnHome(){
  const el = document.getElementById('homeView');
  return !!el && el.style.display === 'block';
}

async function loadAndRenderHomeDashboardExtras(){
  const hasClassroom = !(typeof STANDALONE_ROLES !== 'undefined' && STANDALONE_ROLES.includes(dutyType)) && appSectionOn('classroom');
  const hasWork = appSectionOn('work');
  const [tasksOk, programsOk, attention] = await Promise.all([
    hasWork ? loadMyTasks() : Promise.resolve(true), hasWork ? loadActivityPrograms() : Promise.resolve(true),
    hasClassroom && typeof getAttentionFresh === 'function' ? getAttentionFresh() : Promise.resolve(undefined)
  ]);
  if(!stillOnHome()) return;
  /* معلم بلا فصل (دور مستقل) = لا شيء من إدارة الصف (0)؛ فشل الفحص = null */
  const classroomUrgent = (!hasClassroom || (typeof ATTENTION_ALERTS_ON !== 'undefined' && !ATTENTION_ALERTS_ON)) ? 0 : (attention ? attentionUrgentCount(attention.cards) : null);

  const todayIso = new Date().toISOString().slice(0, 10);
  const cutoffIso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const tasksNeedingAttention = hasWork ? countTasksNeedingAttention(myTasks, cutoffIso) : 0;

  /* sessionsStatus: 'ok' (فُحصت حصص الأسبوع، أو لا برامج أصلًا)،
     'no_region' (لا نطاق جغرافي = لا نعرف الأسبوع الحالي — إجراء مطلوب
     بحد ذاته)، 'failed' (تعذّر جلب التقويم). */
  let sessionsThisWeek = 0;
  let sessionsStatus = 'ok';
  if(hasWork && activityPrograms.length){
    if(!calendarRegion){
      sessionsStatus = 'no_region';
    } else {
      try{
        const { weeks, holidays } = await loadCalendarData(calendarRegion);
        if(!stillOnHome()) return;
        const info = resolveCurrentWeekInfo(weeks, holidays, todayIso);
        if(info.status === 'ok'){
          sessionsThisWeek = countUndocumentedSessionsForWeek(activityPrograms, programSectionIdsMap, info.weekLabel);
        }
      } catch(e){ sessionsStatus = 'failed'; }
    }
  }
  if(!stillOnHome()) return;

  renderHomeActionCard(tasksNeedingAttention, sessionsThisWeek, sessionsStatus, tasksOk && programsOk, classroomUrgent);
  if(hasWork && tasksOk && programsOk) renderWorkHomeSummary();
}

/* دالة صرفة: حالة بطاقة "يحتاج إجراء الآن".
   mode: 'items' (بنود تحتاج إجراء) | 'clear' ("لا إجراء عاجل") | 'hidden'.
   لا تُرجَع 'clear' إلا بعد فحص مكتمل فعلًا — رسالة "كل شيء تمام" مبنية
   على فحص فاشل أخطر من غيابها (نفس المبدأ المتّبع بمركز التنبيهات/
   runQueriesWithRetry). */
/* classroomUrgent: عدد بطاقات الانتباه "العاجلة" فقط بإدارة الصف (مهم/للمراجعة
   لا يصل للرئيسية عمدًا — ضجيج)؛ null = فشل فحصها، فلا نقول "لا إجراء عاجل" */
function homeActionCardState(tasksCount, sessionsCount, sessionsStatus, loadedOk, classroomUrgent){
  const items = [];
  if(classroomUrgent){
    items.push({ kind: 'classroom', text: arabicCountPhrase(classroomUrgent, {
      one: 'إدارة الصف: طالب يحتاج إجراءً عاجلًا', two: 'إدارة الصف: طالبان يحتاجان إجراءً عاجلًا',
      few: 'إدارة الصف: {n} طلاب يحتاجون إجراءً عاجلًا', many: 'إدارة الصف: {n} طالبًا يحتاجون إجراءً عاجلًا',
    }) });
  }
  if(tasksCount){
    items.push({ kind: 'tasks', text: arabicCountPhrase(tasksCount, {
      one: 'مهمة مستحقة هذا الأسبوع', two: 'مهمتان مستحقتان هذا الأسبوع',
      few: '{n} مهام مستحقة هذا الأسبوع', many: '{n} مهمة مستحقة هذا الأسبوع',
    }) });
  }
  if(sessionsCount){
    items.push({ kind: 'sessions', text: arabicCountPhrase(sessionsCount, {
      one: 'حصة برنامج غير موثّقة', two: 'حصتا برنامج غير موثّقتين',
      few: '{n} حصص برامج غير موثّقة', many: '{n} حصة برنامج غير موثّقة',
    }) });
  }
  if(sessionsStatus === 'no_region'){
    items.push({ kind: 'region', text: 'حدّد نطاقك الجغرافي لمتابعة حصص برامجك' });
  }
  if(items.length) return { mode: 'items', items };
  if(!loadedOk || sessionsStatus !== 'ok' || classroomUrgent === null) return { mode: 'hidden', items };
  return { mode: 'clear', items };
}

const HOME_ACTION_HANDLERS = { tasks: 'showTasks()', sessions: 'showPrograms()', region: "showSettings('profile')", classroom: 'showClassroomFollowups()' };

function renderHomeActionCard(tasksCount, sessionsCount, sessionsStatus, loadedOk, classroomUrgent){
  const card = document.getElementById('homeActionCard');
  if(!card) return;

  const state = homeActionCardState(tasksCount, sessionsCount, sessionsStatus, loadedOk, classroomUrgent);
  if(state.mode === 'hidden'){ card.style.display = 'none'; return; }
  if(state.mode === 'clear'){
    card.innerHTML = '<div class="home-action-none">✓ لا إجراء عاجل</div>';
  } else {
    const lines = state.items.map(it => `<div class="home-action-line" onclick="${HOME_ACTION_HANDLERS[it.kind]}">• ${escapeHtml(it.text)}</div>`).join('');
    card.innerHTML = `<div class="home-action-title">⚡ يحتاج إجراء الآن</div><div class="home-action-lines">${lines}</div>`;
  }
  card.style.display = 'block';
}

function renderWorkHomeSummary(){
  const sub = document.getElementById('workHomeSub');
  if(!sub) return;

  const openTasks = myTasks.filter(t => !t.done).length;
  let pendingSessions = 0;
  activityPrograms.forEach(p => {
    const prog = programProgress(p, programSectionIdsMap.get(p.id));
    pendingSessions += Math.max(0, prog.total - prog.done);
  });

  const parts = [];
  if(openTasks) parts.push(arabicCountPhrase(openTasks, { one: 'مهمة واحدة', two: 'مهمتان', few: '{n} مهام', many: '{n} مهمة' }));
  if(pendingSessions) parts.push(arabicCountPhrase(pendingSessions, { one: 'حصة واحدة', two: 'حصتان', few: '{n} حصص', many: '{n} حصة' }));
  sub.textContent = parts.length ? parts.join(' · ') : 'لا شيء معلّق';
}

/* ============================================
   (2) حماية استمرارية الخدمة
   مشروع Supabase المجاني يتوقف تلقائيًا بعد 7 أيام بلا نشاط.
   كل فتح للتطبيق يُعدّ نشاطًا — لكن في الإجازات قد يمر أسبوع بلا استخدام.
   هذا التنبيه يذكّر المسؤول بفتح التطبيق دوريًا للحفاظ على المشروع نشطًا.
   ============================================ */
const LAST_SEEN_KEY = 'shahid_last_seen';

function renderServiceAlert(){
  const box = document.getElementById('serviceAlert');
  if(!box) return;

  const now = Date.now();
  let lastSeen = null;
  try{
    const raw = localStorage.getItem(LAST_SEEN_KEY);
    if(raw) lastSeen = Number(raw);
    localStorage.setItem(LAST_SEEN_KEY, String(now));
  } catch(e){ /* تجاهل */ }

  /* التنبيه للمسؤول فقط — هو المسؤول عن استمرارية المشروع */
  if(!isAdmin){ box.style.display = 'none'; return; }

  const daysSince = lastSeen ? Math.floor((now - lastSeen) / (1000*60*60*24)) : 0;

  /* تحذير إن اقترب المشروع من حد الخمول (7 أيام) */
  if(daysSince >= 5){
    box.style.display = 'block';
    box.style.background = '#FBEAEA';
    box.style.border = '1px solid #D89A9A';
    box.style.borderRight = '4px solid #B23A3A';
    box.style.color = '#8A2C2C';
    box.innerHTML = `<b>تنبيه استمرارية:</b> مرّ <b>${daysSince}</b> يومًا منذ آخر فتح للتطبيق. مشروع قاعدة البيانات المجاني يتوقف بعد 7 أيام خمول — افتح التطبيق مرة أسبوعيًا على الأقل، أو تحقق من لوحة Supabase لإعادة تشغيله عند الحاجة.`;
    return;
  }

  /* تذكير هادئ في الأوقات الطويلة بلا دراسة (الإجازة الصيفية) */
  const stage = getCycleStageKey();
  if(stage === 'summer'){
    box.style.display = 'block';
    box.style.background = '#F4F0E4';
    box.style.border = '1px solid #E0C48A';
    box.style.borderRight = '4px solid var(--gold)';
    box.style.color = '#6B5420';
    box.innerHTML = `<b>ملاحظة للمسؤول:</b> خلال الإجازة، افتح التطبيق مرة كل أسبوع للحفاظ على مشروع قاعدة البيانات نشطًا (يتوقف تلقائيًا بعد 7 أيام خمول).`;
    return;
  }

  box.style.display = 'none';
}
function showForm(){
  hideAllMainViews();
  setActiveBottomTab('shahid');
  document.getElementById('formView').style.display = 'block';
  /* saveShahid (app-09) تتعمّد ترك saveBtn معطَّلاً بعد نجاح الحفظ (حتى
     ينتقل المستخدم فعليًا للشاشة التالية دون فرصة نقرة "حفظ" ثانية تُنشئ
     شاهدًا مكررًا) — showForm هي نقطة الدخول المشتركة لكل مسارات فتح
     النموذج (شاهد جديد/تعديل/نسخ/توثيق حصة برنامج)، فنعيد تفعيله هنا دومًا
     كي لا يبقى معطَّلاً بالخطأ في الجلسة التالية للنموذج. */
  document.getElementById('saveBtn').disabled = false;
}
async function showList(){
  hideAllMainViews();
  setActiveBottomTab('shahid');
  document.getElementById('listView').style.display = 'block';
  refreshBatchEntry(); /* زر «تجهيز دفعة» — بالخلفية دون تعطيل عرض القائمة */
  await loadMyShawahid();
}

/* ============================================
   خطة الأداء السنوية (مرحلة التخطيط)
   ============================================ */
let myPlan = {};          // مشتقة تلقائيًا من myPlanGoals لأغراض التوافق (المستوى الأعلى + مجموع الأعداد)
let myPlanGoals = {};     // { element_key: [ {id, target_level, target_count, ...}, ... ] } — المصدر الحقيقي للبيانات
let planShahidCounts = {}; // { element_key: إجمالي عدد الشواهد الموثقة في العنصر (بصرف النظر عن ربطها بهدف) }
let goalShahidCounts = {}; // { goal_id: عدد الشواهد المرتبطة بهذا الهدف تحديدًا }

const LEVEL_NAMES = {
  5: 'مثالي',
  4: 'فاق التوقعات',
  3: 'وافق التوقعات',
  2: 'بحاجة إلى تطوير',
  1: 'غير مرضٍ'
};

/* دورة الأداء تُحسب حسب العام الدراسي (تبدأ سبتمبر) */
function getCycleYear(forDate){
  const d = forDate ? new Date(forDate) : new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return (m >= 8) ? `${y}/${y+1}` : `${y-1}/${y}`;
}

let planViewYear = null;

async function showPlan(){
  hideAllMainViews();
  setActiveBottomTab(null);
  document.getElementById('planView').style.display = 'block';
  planViewYear = getCycleYear();
  document.getElementById('planRows').innerHTML = '<div class="loading-state">جارِ التحميل...</div>';

  const years = await loadAvailableCycleYears();
  const sel = document.getElementById('planYearSelect');
  sel.innerHTML = years.map(y => `<option value="${y}" ${y === planViewYear ? 'selected' : ''}>${y}${y === getCycleYear() ? ' (الحالية)' : ''}</option>`).join('');

  await switchPlanYear(planViewYear);
}

async function switchPlanYear(year){
  planViewYear = year;
  document.getElementById('planCycleYear').textContent = year;
  const isCurrent = (year === getCycleYear());

  document.getElementById('planHistoryBanner').hidden = isCurrent;
  document.getElementById('planEditControls').style.display = isCurrent ? 'flex' : 'none';
  document.getElementById('planBulkControls').style.display = isCurrent ? 'flex' : 'none';
  document.getElementById('phRole').disabled = !isCurrent;
  document.getElementById('phStage').disabled = !isCurrent;
  document.getElementById('phExtra').disabled = !isCurrent;

  document.getElementById('planRows').innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  await loadPlan(year);
  applyPlanHeaderToUI();

  const wpBox = document.getElementById('planEditControls2');
  if(isCurrent){
    wpBox.style.display = 'flex';
    renderWeightedBar();
    renderCoverageAlert();
    renderPlanRows();
  } else {
    wpBox.style.display = 'none';
    renderPlanRowsReadOnly();
  }
}

/* عرض للقراءة فقط لدورة سابقة — بلا أي حقول قابلة للتعديل */
function renderPlanRowsReadOnly(){
  const box = document.getElementById('planRows');
  const elements = withOrphanPlanElements(getElementsOrder());
  const withGoals = elements.filter(el => (myPlanGoals[el.key] || []).length > 0);

  if(!withGoals.length){
    box.innerHTML = '<div class="empty-state">لا توجد خطة محفوظة لهذه الدورة.</div>';
    return;
  }

  box.innerHTML = withGoals.map((el, idx) => {
    const { name, weight } = splitLabel(el.label);
    const goals = myPlanGoals[el.key] || [];
    return `
      <div class="plan-row" style="background:#F7F5F0;">
        <div class="plan-row-head" style="cursor:default;">
          <span class="plan-elem-name">${idx+1}. ${escapeHtml(name)}</span>
          <span class="plan-elem-weight">${weight}</span>
        </div>
        <div class="plan-row-body" style="display:block;">
          ${goals.map((g, gi) => {
            const done = g.id ? (goalShahidCounts[g.id] || 0) : 0;
            const title = goalDisplayName(g, gi);
            return `
              <div class="goal-card" style="cursor:default;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                  <span style="font-size:13px;font-weight:800;color:var(--gold);">${escapeHtml(title)}</span>
                  <span style="font-size:11px;color:var(--muted);">${g.target_level ? 'مستوى ' + g.target_level : ''}${g.target_count ? ' • ' + done + '/' + g.target_count + ' شواهد' : ''}</span>
                </div>
                ${g.target_performance ? `<p style="font-size:12px;color:#3F3B31;margin:8px 0 0;line-height:1.8;">${escapeHtml(g.target_performance)}</p>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}


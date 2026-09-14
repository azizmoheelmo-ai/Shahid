/* ============ المتابعة الأكاديمية ============ */
let acStudents = [];
let acCasesCache = [];
let acFilter = 'all';
let acCurrentCase = null;

async function showAcademicTracking(){
  hideAllMainViews();
  setActiveBottomTab('academic');
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
  ['all', 'pending', 'undocumented'].forEach(m => {
    const btn = document.getElementById(cfg.btnPrefix + m);
    if(btn) btn.className = (m === mode) ? 'btn btn-primary' : 'btn btn-outline';
  });
  cfg.render();
}

function setAcFilter(mode){
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
    else if(acFilter === 'undocumented') q = q.eq('status', 'referred').eq('referral_letter_generated', true).is('referral_receipt_photo_url', null);
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
            <span>${c.plan_started_at} • ${statusLabel[c.status]}${needsConfirm ? ' ⚠' : ''}${confirmed ? (c.referral_receipt_photo_url ? ' ✅📷 موثّق' : ' ✅⚠ غير موثّق') : ''}</span>
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
  const { error } = await sb.from('academic_cases').update({ status: 'referred' }).eq('id', id);
  if(error){ showToast('تعذّر التحديث: ' + error.message, 'error'); return; }
  showToast('تم تحويل الحالة — جاهز لإصدار خطاب الإحالة', 'ok');
  await renderAcCases();
  await refreshAcBadges();
  openAcLetter(id);
}

async function deleteAcademicCase(id){
  const kase = acCasesCache.find(c => String(c.id) === String(id));
  const ok = await showConfirm('حذف هذه الحالة؟ يمكنك التراجع لبضع ثوانٍ من الإشعار الذي سيظهر بعد الحذف.');
  if(!ok) return;
  const { error } = await sb.from('academic_cases').delete().eq('id', id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  await renderAcCases();
  await refreshAcBadges();

  if(!kase) return; /* لم نلتقط نسخة محلية من الحالة — لا نعرض تراجعًا وهميًا */
  const shouldFinalize = await showUndoToast('تم حذف الحالة', 5);
  if(!shouldFinalize){
    try{
      const { error: restoreErr } = await sb.from('academic_cases').insert(kase);
      if(restoreErr) throw restoreErr;
      await renderAcCases();
      await refreshAcBadges();
      showToast('تم التراجع عن الحذف', 'ok');
    } catch(err){
      showToast('تعذّر التراجع: ' + err.message, 'error');
    }
  }
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
  const { pending, undocumented } = counts;
  const total = pending + undocumented;

  const navBadge = document.getElementById(cfg.navBadgeId);
  if(navBadge){
    if(total > 0){ navBadge.style.display = 'block'; navBadge.textContent = total > 9 ? '9+' : String(total); }
    else { navBadge.style.display = 'none'; }
  }
  const homeBadge = document.getElementById(cfg.homeBadgeId);
  if(homeBadge){
    if(total > 0){ homeBadge.style.display = 'inline-block'; homeBadge.textContent = total > 9 ? '9+' : String(total); }
    else { homeBadge.style.display = 'none'; }
  }
  const banner = document.getElementById(cfg.pendingBannerId);
  if(banner){
    if(pending > 0){ banner.style.display = 'block'; document.getElementById(cfg.pendingCountId).textContent = pending; }
    else { banner.style.display = 'none'; }
  }
  const docBanner = document.getElementById(cfg.undocumentedBannerId);
  if(docBanner){
    if(undocumented > 0){ docBanner.style.display = 'block'; document.getElementById(cfg.undocumentedCountId).textContent = undocumented; }
    else { docBanner.style.display = 'none'; }
  }
}

const AC_TRANSFER_CFG = {
  table: 'academic_cases',
  stageColumn: 'status',
  navBadgeId: 'academicNavBadge',
  homeBadgeId: 'academicHomeBadge',
  pendingBannerId: 'acPendingBanner',
  pendingCountId: 'acPendingCount',
  undocumentedBannerId: 'acUndocumentedBanner',
  undocumentedCountId: 'acUndocumentedCount'
};

const CRM_TRANSFER_CFG = {
  table: 'classroom_incidents',
  stageColumn: 'current_stage',
  navBadgeId: 'classroomNavBadge',
  homeBadgeId: 'classroomHomeBadge',
  pendingBannerId: 'crmPendingReferralBanner',
  pendingCountId: 'crmPendingReferralCount',
  undocumentedBannerId: 'crmUndocumentedBanner',
  undocumentedCountId: 'crmUndocumentedCount'
};

async function getAcTransferCounts(){
  return getTransferCounts(AC_TRANSFER_CFG);
}

async function refreshAcBadges(){
  return refreshTransferBadges(AC_TRANSFER_CFG);
}

/* ---- خطاب الإحالة الأكاديمية ---- */
async function openAcLetter(caseId){
  const { data: kase, error } = await sb.from('academic_cases').select('*').eq('id', caseId).maybeSingle();
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
  if(kase.referral_letter_generated){
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

async function printLetterContent(previewElId, photoUrl){
  const content = document.getElementById(previewElId).innerHTML;
  let photoHtml = '';
  if(photoUrl){
    showToast('جارٍ التجهيز للطباعة...', 'ok');
    const dataUrl = await toDataUrl(photoUrl);
    if(dataUrl){
      photoHtml = '<div style="page-break-before:always;padding-top:20px;text-align:center;">' +
        '<h3 style="margin-bottom:16px;">صورة إثبات التسليم الموقّع</h3>' +
        '<img src="' + escapeHtml(dataUrl) + '" style="max-width:45%;border:1px solid #999;">' +
        '</div>';
    }
  }
  document.getElementById('printArea').innerHTML = '<div dir="rtl" style="font-family:Arial;font-size:13pt;line-height:2;padding:10px;">' + content + photoHtml + '</div>';
  printNow();
}

async function downloadLetterPdfFile(buildBlobFn, studentName, letterLabel){
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
  }
}

async function shareLetterWhatsApp(buildBlobFn, studentName, letterLabel){
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
  }
}

async function downloadLetterWordFile(previewElId, photoUrl, studentName, letterLabel){
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
  }).eq('id', entity.id);
  if(error){ showToast('تعذّر الحفظ: ' + error.message, 'error'); return; }

  const nextNum = (parseInt(num, 10) || 0) + 1;
  await sb.from('classroom_letter_counters').upsert({ teacher_id: currentUser.id, next_number: nextNum, updated_at: new Date().toISOString() });

  entity.referral_letter_generated = true;
  entity.referral_letter_number = num;
  await cfg.refreshBadges();

  showToast('تم تأكيد إصدار الخطاب — الآن ارفع صورة التوقيع بعد الطباعة', 'ok');
  document.getElementById(cfg.uploadSectionId).style.display = 'block';
}

async function uploadLetterReceiptPhoto(event, cfg){
  const file = event.target.files[0];
  const ref = cfg.currentRef();
  if(!file || !ref) return;
  const entity = ref[cfg.entityKey];
  try{
    showToast('جارٍ ضغط الصورة...', 'ok');
    const compressed = await compressImageFile(file, 1280, 0.72);
    showToast('جارٍ رفع الصورة (' + Math.round(compressed.size / 1024) + ' كيلوبايت)...', 'ok');
    const path = currentUser.id + '/' + cfg.pathSegment + '/' + entity.id + '_' + Date.now() + '.jpg';
    const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, compressed, { contentType: 'image/jpeg' });
    if(upErr) throw upErr;
    const { data: pub } = sb.storage.from('shawahid-photos').getPublicUrl(path);

    const { error } = await sb.from(cfg.table).update({ referral_receipt_photo_url: pub.publicUrl }).eq('id', entity.id);
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
  const { error } = await sb.from(cfg.table).update({ referral_receipt_photo_url: null }).eq('id', entity.id);
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

async function printAcLetter(){
  return printLetterContent('acLetterPreview', acCurrentCase && acCurrentCase.case.referral_receipt_photo_url);
}

async function buildAcLetterPdfBlob(){
  return buildLetterPdfBlob('acLetterPreview', acCurrentCase && acCurrentCase.case.referral_receipt_photo_url);
}

async function downloadAcLetterPDF(){
  const studentName = acCurrentCase ? acCurrentCase.student.full_name : 'خطاب';
  return downloadLetterPdfFile(buildAcLetterPdfBlob, studentName, 'خطاب إحالة');
}

async function shareAcLetterWhatsApp(){
  const studentName = acCurrentCase ? acCurrentCase.student.full_name : 'خطاب';
  return shareLetterWhatsApp(buildAcLetterPdfBlob, studentName, 'خطاب إحالة');
}

async function downloadAcLetterWordFile(){
  const studentName = acCurrentCase ? acCurrentCase.student.full_name : 'خطاب';
  return downloadLetterWordFile('acLetterPreview', acCurrentCase && acCurrentCase.case.referral_receipt_photo_url, studentName, 'خطاب إحالة');
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

async function changePassword(){
  const currentPw = document.getElementById('peCurrentPassword').value;
  const p1 = document.getElementById('peNewPassword').value;
  const p2 = document.getElementById('peNewPassword2').value;
  const msg = document.getElementById('passwordChangeMsg');

  if(!currentPw){
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
  if(currentPw === p1){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.';
    return;
  }

  msg.style.color = 'var(--muted)';
  msg.textContent = 'جارٍ التحقق من كلمة المرور الحالية...';
  try{
    const { error: verifyError } = await sb.auth.signInWithPassword({ email: currentUser.email, password: currentPw });
    if(verifyError){
      msg.style.color = '#8A2C2C';
      msg.textContent = 'كلمة المرور الحالية غير صحيحة.';
      return;
    }

    msg.textContent = 'جارٍ التحديث...';
    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error) throw error;
    msg.style.color = '#215C34';
    msg.textContent = 'تم تحديث كلمة المرور بنجاح ✓';
    document.getElementById('peCurrentPassword').value = '';
    document.getElementById('peNewPassword').value = '';
    document.getElementById('peNewPassword2').value = '';
    document.getElementById('peNewPwBox').style.display = 'none';
    showToast('تم تحديث كلمة المرور', 'ok');
  } catch(err){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'خطأ: ' + translateAuthError(err.message);
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
    renderProfile();
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
}
function switchCrmTab(tab){
  const recordBtn = document.getElementById('crmTabBtnRecord');
  const studentsBtn = document.getElementById('crmTabBtnStudents');
  const recordPane = document.getElementById('crmTabRecord');
  const studentsPane = document.getElementById('crmTabStudents');
  if(tab === 'record'){
    recordPane.style.display = 'block'; studentsPane.style.display = 'none';
    recordBtn.className = 'btn btn-primary'; studentsBtn.className = 'btn btn-outline';
  } else {
    recordPane.style.display = 'none'; studentsPane.style.display = 'block';
    recordBtn.className = 'btn btn-outline'; studentsBtn.className = 'btn btn-primary';
  }
}

function collapseAllCrmSections(){
  const pairs = ['crmRegisterBody', 'crmIncidentsListBody'];
  pairs.forEach(id => {
    const body = document.getElementById(id);
    const arrow = document.getElementById(id + '_arrow');
    if(body) body.style.display = 'none';
    if(arrow) arrow.textContent = '▸';
  });
}

async function showClassroomManagement(){
  hideAllMainViews();
  setActiveBottomTab('classroom');
  document.getElementById('classroomView').style.display = 'block';
  document.getElementById('crmSemesterSelect').value = localStorage.getItem('crm_semester_part') || 'الفصل الأول';
  document.getElementById('crmYearInput').value = localStorage.getItem('crm_year_part') || '1448-1449';
  switchCrmTab('record');
  collapseAllCrmSections();

  await Promise.all([
    loadCrmIncidentTypes(),
    loadCrmGradesAndSections(),
    loadCrmStudents()
  ]);

  renderCrmGradesList();
  populateNewStudentGradeSelect();
  renderCrmStudentsList();
  renderCrmIncidentTypeSelect();
  setCrmIncidentFilter('all');
  refreshCrmPendingBadges();
}

function saveCrmSemester(){
  localStorage.setItem('crm_semester_part', document.getElementById('crmSemesterSelect').value);
  localStorage.setItem('crm_year_part', document.getElementById('crmYearInput').value);
}

async function onCrmYearChange(){
  saveCrmSemester();
  document.getElementById('crmIncidentStudentId').value = '';
  document.getElementById('crmIncidentStudentSearch').value = '';
  document.getElementById('crmOccurrencePreview').style.display = 'none';
  await loadCrmGradesAndSections();
  renderCrmGradesList();
  populateNewStudentGradeSelect();
  await loadCrmStudents();
  renderCrmStudentsList();
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
}

let crmIncidentTypes = [];
let crmStudents = [];

async function loadCrmIncidentTypes(){
  if(crmIncidentTypes.length) return;
  const { data, error } = await sb.from('classroom_incident_types').select('*').eq('active', true).order('problem_degree').order('problem_name');
  if(error){ showToast('تعذّر تحميل أنواع المخالفات: ' + error.message, 'error'); return; }
  crmIncidentTypes = data || [];
}

async function loadCrmStudents(){
  const year = document.getElementById('crmYearInput').value;
  const { data, error } = await sb.from('classroom_students').select('*').eq('teacher_id', currentUser.id).eq('is_active', true).eq('academic_year', year).order('grade_level').order('section_number').order('full_name');
  if(error){ showToast('تعذّر تحميل الطلاب: ' + error.message, 'error'); return; }
  crmStudents = data || [];
}

function renderCrmStudentsList(){
  const box = document.getElementById('crmStudentsList');
  const query = (document.getElementById('crmStudentSearch').value || '').trim();
  let list = crmStudents;
  if(query){ list = list.filter(s => s.full_name.includes(query)); }
  if(!list.length){ box.innerHTML = '<div class="empty-state">لا يوجد طلاب مطابقون.</div>'; return; }

  const groups = {};
  list.forEach(s => {
    const g = s.grade_level || 'غير محدد';
    const sec = s.section_number || '—';
    groups[g] = groups[g] || {};
    groups[g][sec] = groups[g][sec] || [];
    groups[g][sec].push(s);
  });

  const gradeKeys = Object.keys(groups).sort();
  let html = '';
  gradeKeys.forEach((g, gi) => {
    const gradeId = 'crmGrade' + gi;
    const startOpen = query.length > 0;
    html += `<div style="border:1px solid var(--line);margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#F0EEE6;cursor:pointer;" onclick="toggleCrmGroup('${gradeId}')">
        <span style="font-weight:700;font-size:13px;">${escapeHtml(g)}</span>
        <span id="${gradeId}_arrow" style="font-size:11px;color:var(--muted);">${startOpen ? '▾' : '▸'}</span>
      </div>
      <div id="${gradeId}" style="display:${startOpen ? 'block' : 'none'};padding:8px 10px;">`;

    Object.keys(groups[g]).sort().forEach((sec, si) => {
      const sectionId = gradeId + '_sec' + si;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px;cursor:pointer;background:#FAF9F6;margin-top:6px;" onclick="toggleCrmGroup('${sectionId}')">
        <span style="font-size:11px;color:var(--muted);font-weight:700;">الشعبة ${escapeHtml(sec)} <span style="font-weight:400;">(${groups[g][sec].length})</span></span>
        <span id="${sectionId}_arrow" style="font-size:10px;color:var(--muted);">▸</span>
      </div>
      <div id="${sectionId}" style="display:none;">`;
      groups[g][sec].forEach(s => {
        html += `
          <div style="border-bottom:1px solid var(--line);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 4px;cursor:pointer;" onclick="toggleCrmStudentHistory('${s.id}')">
              <span style="font-size:12.5px;">${escapeHtml(s.full_name)}${s.student_number ? ' <span style="color:var(--muted);font-size:11px;">#' + escapeHtml(s.student_number) + '</span>' : ''}</span>
              <button style="border:none;background:none;color:var(--muted);font-size:13px;padding:0;" onclick="event.stopPropagation();deleteCrmStudent('${s.id}')" title="حذف الطالب">🗑</button>
            </div>
            <div id="crmStudentHist_${s.id}" style="display:none;padding:6px 10px 10px;background:#FAF9F6;font-size:11.5px;"></div>
          </div>`;
      });
      html += `</div>`;
    });

    html += `</div></div>`;
  });
  box.innerHTML = html;
}

async function toggleCrmStudentHistory(studentId){
  const panel = document.getElementById('crmStudentHist_' + studentId);
  if(!panel) return;
  const isOpen = panel.style.display !== 'none';
  if(isOpen){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  panel.innerHTML = '<div style="color:var(--muted);">جارٍ التحميل...</div>';

  const { data, error } = await sb.from('classroom_incidents')
    .select('id, incident_date, occurrence_number, current_stage, incident_type_id, referral_letter_generated, referral_receipt_photo_url')
    .eq('student_id', studentId)
    .order('incident_date', { ascending: false });

  if(error){ panel.innerHTML = '<div style="color:#8A2C2C;">تعذّر التحميل</div>'; return; }
  if(!data || !data.length){ panel.innerHTML = '<div style="color:var(--muted);">لا توجد مخالفات مسجّلة لهذا الطالب.</div>'; return; }

  const stageLabel = { warning_1: 'تنبيه أول', warning_2: 'تنبيه ثانٍ', referred: 'محال' };
  panel.innerHTML = data.map(inc => {
    const type = crmIncidentTypes.find(t => t.id === inc.incident_type_id);
    const needsConfirm = inc.current_stage === 'referred' && !inc.referral_letter_generated;
    const confirmed = inc.current_stage === 'referred' && inc.referral_letter_generated;
    let statusExtra = '';
    if(needsConfirm) statusExtra = ' ⚠';
    else if(confirmed) statusExtra = inc.referral_receipt_photo_url ? ' ✅📷' : ' ✅⚠غير موثّق';
    return `<div style="padding:5px 0;border-bottom:1px dashed var(--line);">
      <div>${type ? escapeHtml(type.problem_name) : '—'}</div>
      <div style="color:var(--muted);">${inc.incident_date} • المرة ${inc.occurrence_number} • ${stageLabel[inc.current_stage] || inc.current_stage}${statusExtra}</div>
    </div>`;
  }).join('');
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

function renderCrmGradesList(){
  const box = document.getElementById('crmGradesList');
  if(!crmGradeLevels.length){ box.innerHTML = '<div class="empty-state">لا توجد مراحل مضافة بعد لهذه السنة — ابدأ بإضافة مرحلة.</div>'; return; }

  box.innerHTML = crmGradeLevels.map((g, gi) => {
    const gSections = crmSections.filter(s => s.grade_level_id === g.id);
    const bodyId = 'crmGradeBody' + gi;
    return `
      <div style="border:1px solid var(--line);margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#F0EEE6;cursor:pointer;" onclick="toggleCrmGroup('${bodyId}')">
          <span style="font-weight:700;font-size:13px;">${escapeHtml(g.name)} <span style="font-weight:400;color:var(--muted);font-size:11.5px;">(${gSections.length} ${gSections.length === 1 ? 'شعبة' : 'شعب'})</span></span>
          <div style="display:flex;align-items:center;gap:10px;">
            <button style="border:none;background:none;color:var(--muted);font-size:13px;padding:0;" onclick="event.stopPropagation();deleteCrmGradeLevel('${g.id}')" title="حذف المرحلة">🗑</button>
            <span id="${bodyId}_arrow" style="font-size:11px;color:var(--muted);">▸</span>
          </div>
        </div>
        <div id="${bodyId}" style="display:none;padding:10px 12px;">
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
            ${gSections.map(s => `
              <span style="display:inline-flex;align-items:center;gap:5px;background:#F7F5F0;border:1px solid var(--line);padding:4px 8px;font-size:11.5px;">
                الشعبة ${escapeHtml(s.name)}
                <span onclick="deleteCrmSection('${s.id}')" style="cursor:pointer;color:var(--muted);">✕</span>
              </span>
            `).join('') || '<span style="font-size:11.5px;color:var(--muted);">لا توجد شعب بعد</span>'}
          </div>
          <button class="btn btn-outline" style="padding:4px 10px;font-size:11.5px;" onclick="addCrmSection('${g.id}')">+ إضافة شعبة</button>
        </div>
      </div>
    `;
  }).join('');
}

async function addCrmGradeLevel(){
  const name = prompt('اسم المرحلة (مثال: أول ثانوي):');
  if(!name || !name.trim()) return;
  const year = document.getElementById('crmYearInput').value;
  const { error } = await sb.from('classroom_grade_levels').insert({
    teacher_id: currentUser.id, academic_year: year, name: name.trim()
  });
  if(error){ showToast('تعذّر الإضافة: ' + error.message, 'error'); return; }
  showToast('تمت إضافة المرحلة', 'ok');
  await loadCrmGradesAndSections();
  renderCrmGradesList();
  populateNewStudentGradeSelect();
}

async function deleteCrmGradeLevel(id){
  const ok = await showConfirm('حذف هذه المرحلة وكل شعبها؟ (لن يتأثر الطلاب المضافون مسبقًا بأسمائهم النصية)');
  if(!ok) return;
  const { error } = await sb.from('classroom_grade_levels').delete().eq('id', id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  showToast('تم الحذف', 'ok');
  await loadCrmGradesAndSections();
  renderCrmGradesList();
  populateNewStudentGradeSelect();
}

async function addCrmSection(gradeLevelId){
  const name = prompt('اسم/رقم الشعبة (مثال: 6):');
  if(!name || !name.trim()) return;
  const year = document.getElementById('crmYearInput').value;
  const { error } = await sb.from('classroom_sections').insert({
    teacher_id: currentUser.id, grade_level_id: gradeLevelId, academic_year: year, name: name.trim()
  });
  if(error){ showToast('تعذّر الإضافة: ' + error.message, 'error'); return; }
  showToast('تمت إضافة الشعبة', 'ok');
  await loadCrmGradesAndSections();
  renderCrmGradesList();
  populateNewStudentGradeSelect();
}

async function deleteCrmSection(id){
  const ok = await showConfirm('حذف هذه الشعبة؟');
  if(!ok) return;
  const { error } = await sb.from('classroom_sections').delete().eq('id', id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  showToast('تم الحذف', 'ok');
  await loadCrmGradesAndSections();
  renderCrmGradesList();
  populateNewStudentGradeSelect();
}

function populateNewStudentGradeSelect(){
  const sel = document.getElementById('newStudentGradeSelect');
  if(!sel) return;
  sel.innerHTML = '<option value="">اختر المرحلة</option>' +
    crmGradeLevels.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  onNewStudentGradeChange();
}

function onNewStudentGradeChange(){
  const gradeId = document.getElementById('newStudentGradeSelect').value;
  const sectionSel = document.getElementById('newStudentSectionSelect');
  const relevant = crmSections.filter(s => s.grade_level_id === gradeId);
  sectionSel.innerHTML = '<option value="">اختر الشعبة</option>' +
    relevant.map(s => `<option value="${s.id}">الشعبة ${escapeHtml(s.name)}</option>`).join('');
}

function toggleCrmExcelHelp(){
  const box = document.getElementById('crmExcelHelpBox');
  box.style.display = (box.style.display === 'none') ? 'block' : 'none';
}

/* ============ إدارة الطلاب ============ */
async function addClassroomStudent(){
  const name = document.getElementById('newStudentName').value.trim();
  const gradeId = document.getElementById('newStudentGradeSelect').value;
  const sectionId = document.getElementById('newStudentSectionSelect').value;
  const num = document.getElementById('newStudentNumber').value.trim();
  if(!name || !gradeId || !sectionId){ showToast('أدخل الاسم واختر المرحلة والشعبة', 'error'); return; }

  const grade = crmGradeLevels.find(g => g.id === gradeId);
  const section = crmSections.find(s => s.id === sectionId);

  const { error } = await sb.from('classroom_students').insert({
    teacher_id: currentUser.id,
    full_name: name,
    grade_level: grade ? grade.name : '',
    section_number: section ? section.name : '',
    student_number: num || null,
    academic_year: document.getElementById('crmYearInput').value
  });
  if(error){ showToast('تعذّر الحفظ: ' + error.message, 'error'); return; }
  document.getElementById('newStudentName').value = '';
  document.getElementById('newStudentNumber').value = '';
  document.getElementById('newStudentGradeSelect').value = '';
  onNewStudentGradeChange();
  document.getElementById('addStudentBox').style.display = 'none';
  showToast('تم إضافة الطالب', 'ok');
  await loadCrmStudents();
  renderCrmStudentsList();
}

async function deleteCrmStudent(id){
  /* تنبيه: student_id بجدولي classroom_incidents وacademic_cases معرَّف
     "on delete cascade" — حذف الطالب يحذف معه كل حوادثه وحالاته الأكاديمية
     المرتبطة، وليس فقط "فك الربط بالاسم". نلتقط الكل هنا قبل الحذف حتى
     يكون التراجع كاملاً وليس جزئيًا. */
  const student = crmStudents.find(s => String(s.id) === String(id));
  const ok = await showConfirm('حذف هذا الطالب؟ سيُحذف معه أيضًا كل حوادثه وحالاته الأكاديمية المسجّلة. يمكنك التراجع لبضع ثوانٍ من الإشعار الذي سيظهر بعد الحذف.');
  if(!ok) return;

  let relatedIncidents = [];
  let relatedCases = [];
  try{
    const [incRes, caseRes] = await Promise.all([
      sb.from('classroom_incidents').select('*').eq('student_id', id),
      sb.from('academic_cases').select('*').eq('student_id', id)
    ]);
    relatedIncidents = incRes.data || [];
    relatedCases = caseRes.data || [];
  } catch(e){ /* لو تعذّر الالتقاط، يبقى التراجع ممكنًا لبيانات الطالب نفسه فقط */ }

  const { error } = await sb.from('classroom_students').delete().eq('id', id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  await loadCrmStudents();
  renderCrmStudentsList();

  if(!student) return; /* لم نلتقط نسخة محلية من الطالب — لا نعرض تراجعًا وهميًا */
  const extraNote = (relatedIncidents.length || relatedCases.length) ? ' وسجلاته المرتبطة' : '';
  const shouldFinalize = await showUndoToast('تم حذف الطالب' + extraNote, 5);
  if(!shouldFinalize){
    try{
      /* ترتيب الإعادة مهم: الطالب أولاً (الحوادث/الحالات تشير إليه بمفتاح خارجي) */
      const { error: sErr } = await sb.from('classroom_students').insert(student);
      if(sErr) throw sErr;
      if(relatedIncidents.length){
        const { error: iErr } = await sb.from('classroom_incidents').insert(relatedIncidents);
        if(iErr) throw iErr;
      }
      if(relatedCases.length){
        const { error: cErr } = await sb.from('academic_cases').insert(relatedCases);
        if(cErr) throw cErr;
      }
      await loadCrmStudents();
      renderCrmStudentsList();
      await refreshCrmPendingBadges();
      await refreshAcBadges();
      showToast('تم التراجع عن الحذف', 'ok');
    } catch(err){
      showToast('تعذّر التراجع الكامل — قد تحتاج مراجعة يدوية: ' + err.message, 'error');
    }
  }
}

async function importStudentsExcel(event){
  const file = event.target.files[0];
  if(!file) return;
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
        grade_level: findCol('المرحلة', 'الصف', 'grade'),
        section_number: findCol('الشعبة', 'الفصل', 'section'),
        student_number: findCol('رقم', 'number')
      };
    }).filter(r => r.full_name);

    if(!records.length){ showToast('تعذّر التعرف على الأسماء — تأكد من وجود عمود باسم "الاسم"', 'error'); event.target.value=''; return; }

    const ok = await showConfirm('سيتم استيراد ' + records.length + ' طالبًا. متابعة؟');
    if(!ok){ event.target.value=''; return; }

    const yearVal = document.getElementById('crmYearInput').value.trim() || String(new Date().getFullYear());
    const payload = records.map(r => ({
      teacher_id: currentUser.id,
      full_name: r.full_name,
      grade_level: r.grade_level || 'غير محدد',
      section_number: r.section_number || '—',
      student_number: r.student_number || null,
      academic_year: yearVal
    }));

    const { error } = await sb.from('classroom_students').insert(payload);
    if(error){ showToast('تعذّر الاستيراد: ' + error.message, 'error'); event.target.value=''; return; }
    showToast('تم استيراد ' + payload.length + ' طالبًا', 'ok');
    event.target.value = '';
    await loadCrmStudents();
    renderCrmStudentsList();
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
  if(!matches.length){ box.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--muted);">لا نتائج</div>'; box.style.display='block'; return; }
  box.innerHTML = matches.map(s => `
    <div style="padding:8px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--line);" onclick="selectCrmIncidentStudent('${s.id}')">
      ${escapeHtml(s.full_name)} <span style="color:var(--muted);font-size:11px;">— ${escapeHtml(s.grade_level || '')} / الشعبة ${escapeHtml(s.section_number || '')}</span>
    </div>
  `).join('');
  box.style.display = 'block';
}

function selectCrmIncidentStudent(id){
  const s = crmStudents.find(x => x.id === id);
  document.getElementById('crmIncidentStudentId').value = id;
  document.getElementById('crmIncidentStudentSearch').value = s ? (s.full_name + ' — ' + (s.grade_level||'') + ' / الشعبة ' + (s.section_number||'')) : '';
  document.getElementById('crmIncidentStudentResults').style.display = 'none';
  refreshOccurrencePreview();
}

function renderCrmIncidentTypeSelect(){
  const sel = document.getElementById('crmIncidentType');
  const degreeLabels = { 1: 'الدرجة الأولى', 2: 'الدرجة الثانية', 3: 'الدرجة الثالثة', 4: 'الدرجة الرابعة', 5: 'الدرجة الخامسة' };
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

async function refreshOccurrencePreview(){
  const studentId = document.getElementById('crmIncidentStudentId').value;
  const typeId = document.getElementById('crmIncidentType').value;
  const box = document.getElementById('crmOccurrencePreview');
  if(!studentId || !typeId){ box.style.display = 'none'; return; }
  const semester = getCrmSemesterLabel();

  const { data, error } = await sb.from('classroom_incidents')
    .select('id')
    .eq('student_id', studentId)
    .eq('incident_type_id', typeId)
    .eq('semester_label', semester);
  if(error){ showToast('خطأ في الحساب: ' + error.message, 'error'); return; }

  const occurrence = (data ? data.length : 0) + 1;
  const type = crmIncidentTypes.find(t => t.id === typeId);
  let stage, actionText;
  if(type.action_sequence === 'immediate_referral'){
    stage = 'referred';
    actionText = 'تحويل فوري لوكيل شؤون الطلاب (من أول حادثة حسب ' + type.regulation_article + ')';
  } else if(occurrence === 1){
    stage = 'warning_1'; actionText = type.stage_1_label;
  } else if(occurrence === 2){
    stage = 'warning_2'; actionText = type.stage_2_label;
  } else {
    stage = 'referred'; actionText = 'تحويل لوكيل شؤون الطلاب — هذه المرة رقم ' + occurrence + ' لنفس المخالفة';
  }

  box.style.display = 'block';
  box.dataset.occurrence = occurrence;
  box.dataset.stage = stage;
  box.innerHTML = `
    <div style="background:#F7F5F0;border:1px solid var(--line);padding:10px 13px;font-size:12.5px;line-height:1.8;margin-top:2px;">
      <b>المرة رقم:</b> ${occurrence} لهذه المخالفة هذا الفصل (${escapeHtml(semester)})<br>
      <b>الإجراء المقترح:</b> ${escapeHtml(actionText)}
      ${stage === 'referred' ? '<div style="margin-top:6px;color:#8A2C2C;font-weight:700;">⚠ هذه الحادثة تتطلب إصدار خطاب تحويل</div>' : ''}
    </div>
  `;
}

async function saveClassroomIncident(){
  const studentId = document.getElementById('crmIncidentStudentId').value;
  const typeId = document.getElementById('crmIncidentType').value;
  const semester = getCrmSemesterLabel();
  const notes = document.getElementById('crmIncidentNotes').value.trim();
  const box = document.getElementById('crmOccurrencePreview');
  if(!studentId || !typeId){ showToast('أكمل اختيار الطالب ونوع المخالفة', 'error'); return; }
  if(box.style.display === 'none'){ await refreshOccurrencePreview(); }
  const occurrence = parseInt(box.dataset.occurrence, 10);
  const stage = box.dataset.stage;

  const { error } = await sb.from('classroom_incidents').insert({
    teacher_id: currentUser.id,
    student_id: studentId,
    incident_type_id: typeId,
    semester_label: semester,
    occurrence_number: occurrence,
    current_stage: stage,
    notes: notes || null,
    referral_letter_generated: false
  });
  if(error){ showToast('تعذّر الحفظ: ' + error.message, 'error'); return; }
  showToast(stage === 'referred' ? 'تم الحفظ — الحالة تتطلب تحويل' : 'تم حفظ التنبيه', 'ok');
  document.getElementById('crmIncidentNotes').value = '';
  box.style.display = 'none';
  document.getElementById('crmIncidentStudentId').value = '';
  document.getElementById('crmIncidentStudentSearch').value = '';
  document.getElementById('crmIncidentType').value = '';
  await renderCrmRecentIncidents();
  await refreshCrmPendingBadges();
}

async function getCrmTransferCounts(){
  return getTransferCounts(CRM_TRANSFER_CFG);
}

async function refreshCrmPendingBadges(){
  return refreshTransferBadges(CRM_TRANSFER_CFG);
}

async function fetchCrmStudentById(id){
  const { data } = await sb.from('classroom_students').select('*').eq('id', id).maybeSingle();
  return data;
}

let rlCurrentIncident = null;

async function openReferralLetter(incidentId){
  const { data: inc, error } = await sb.from('classroom_incidents').select('*').eq('id', incidentId).maybeSingle();
  if(error || !inc){ showToast('تعذّر تحميل بيانات الحادثة', 'error'); return; }

  let student = crmStudents.find(s => s.id === inc.student_id);
  if(!student) student = await fetchCrmStudentById(inc.student_id);
  const type = crmIncidentTypes.find(t => t.id === inc.incident_type_id);
  if(!student || !type){ showToast('تعذّر تحميل بيانات الطالب أو نوع المخالفة', 'error'); return; }

  const { data: priorList } = await sb.from('classroom_incidents')
    .select('incident_date, occurrence_number')
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
  if(inc.referral_letter_generated){
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

async function downloadReferralLetterPDF(){
  const studentName = rlCurrentIncident ? rlCurrentIncident.student.full_name : 'خطاب';
  return downloadLetterPdfFile(buildReferralLetterPdfBlob, studentName, 'خطاب تحويل');
}

async function shareReferralLetterWhatsApp(){
  const studentName = rlCurrentIncident ? rlCurrentIncident.student.full_name : 'خطاب';
  return shareLetterWhatsApp(buildReferralLetterPdfBlob, studentName, 'خطاب تحويل');
}

async function printReferralLetter(){
  return printLetterContent('rlPreview', rlCurrentIncident && rlCurrentIncident.incident.referral_receipt_photo_url);
}

async function downloadReferralLetterWordFile(){
  const studentName = rlCurrentIncident ? rlCurrentIncident.student.full_name : 'خطاب';
  return downloadLetterWordFile('rlPreview', rlCurrentIncident && rlCurrentIncident.incident.referral_receipt_photo_url, studentName, 'خطاب تحويل');
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
  const ok = await showConfirm('حذف هذه الحادثة؟ سيُعاد حساب رقم التكرار تلقائيًا للحوادث المتبقية من نفس النوع مستقبلًا. يمكنك التراجع لبضع ثوانٍ من الإشعار الذي سيظهر بعد الحذف.');
  if(!ok) return;

  /* نجلب نسخة كاملة من الحادثة قبل حذفها — لا تُحفَظ بقائمة محلية دائمة
     حتى نتمكن من إعادة إدراجها إن طُلب التراجع */
  const { data: incident } = await sb.from('classroom_incidents').select('*').eq('id', id).maybeSingle();

  const { error } = await sb.from('classroom_incidents').delete().eq('id', id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  await renderCrmRecentIncidents();
  await refreshCrmPendingBadges();

  if(!incident) return; /* لم نلتقط نسخة محلية من الحادثة — لا نعرض تراجعًا وهميًا */
  const shouldFinalize = await showUndoToast('تم حذف الحادثة', 5);
  if(!shouldFinalize){
    try{
      const { error: restoreErr } = await sb.from('classroom_incidents').insert(incident);
      if(restoreErr) throw restoreErr;
      await renderCrmRecentIncidents();
      await refreshCrmPendingBadges();
      showToast('تم التراجع عن الحذف', 'ok');
    } catch(err){
      showToast('تعذّر التراجع: ' + err.message, 'error');
    }
  }
}

let crmIncidentFilter = 'all';

function jumpToCrmFilter(mode){
  setCrmIncidentFilter(mode);
  const body = document.getElementById('crmIncidentsListBody');
  const arrow = document.getElementById('crmIncidentsListBody_arrow');
  if(body){ body.style.display = 'block'; }
  if(arrow){ arrow.textContent = '▾'; }
  const el = document.getElementById('crmIncidentsListSection');
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setCrmIncidentFilter(mode){
  setListFilter({ setValue: v => { crmIncidentFilter = v; }, btnPrefix: 'crmFilterBtn_', render: renderCrmRecentIncidents }, mode);
}

function goToCrmStudentFromModal(studentId){
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if(cancelBtn) cancelBtn.click();

  const student = crmStudents.find(s => s.id === studentId);
  document.getElementById('crmIncidentsSearch').value = student ? student.full_name : '';
  setCrmIncidentFilter('all');

  const body = document.getElementById('crmIncidentsListBody');
  const arrow = document.getElementById('crmIncidentsListBody_arrow');
  if(body) body.style.display = 'block';
  if(arrow) arrow.textContent = '▾';

  const el = document.getElementById('crmIncidentsListSection');
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function showCrmTransfersStatusModal(mode){
  const { data, error } = await sb.from('classroom_incidents')
    .select('id, student_id, incident_type_id, current_stage, referral_letter_generated, referral_receipt_photo_url')
    .eq('teacher_id', currentUser.id)
    .eq('current_stage', 'referred');

  if(error){ showToast('تعذّر التحميل: ' + error.message, 'error'); return; }

  const statusOf = (inc) => {
    if(!inc.referral_letter_generated) return { text: 'لم يُحوَّل', color: '#8A2C2C', bg: '#FBEAEA', rank: 0 };
    if(!inc.referral_receipt_photo_url) return { text: 'جارٍ', color: '#6B5420', bg: '#FBF3E6', rank: 1 };
    return { text: 'مكتمل', color: '#215C34', bg: '#EAF3EC', rank: 2 };
  };

  let rows = '';
  if(!data || !data.length){
    rows = '<div style="padding:14px;text-align:center;color:var(--muted);font-size:12.5px;">لا توجد حالات تحويل مسجّلة بعد.</div>';
  } else if(mode === 'student'){
    const byStudent = {};
    data.forEach(inc => {
      const st = statusOf(inc);
      if(!byStudent[inc.student_id] || st.rank < byStudent[inc.student_id].rank){
        byStudent[inc.student_id] = st;
      }
    });
    rows = Object.keys(byStudent).map(sid => {
      const student = crmStudents.find(s => s.id === sid);
      const st = byStudent[sid];
      return `<div style="padding:9px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px;background:${st.bg};">
        <span style="font-size:12.5px;color:var(--navy);font-weight:600;flex:1;text-decoration:underline;cursor:pointer;" onclick="goToCrmStudentFromModal('${sid}')">${student ? escapeHtml(student.full_name) : 'طالب محذوف'}</span>
        <span style="font-size:11px;color:${st.color};font-weight:700;white-space:nowrap;">${st.text}</span>
      </div>`;
    }).join('');
  } else {
    rows = data.map(inc => {
      const student = crmStudents.find(s => s.id === inc.student_id);
      const type = crmIncidentTypes.find(t => t.id === inc.incident_type_id);
      const st = statusOf(inc);
      return `<div style="padding:9px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px;background:${st.bg};">
        <span style="font-size:12.5px;color:var(--navy);font-weight:600;flex:1;"><span style="text-decoration:underline;cursor:pointer;" onclick="goToCrmStudentFromModal('${inc.student_id}')">${student ? escapeHtml(student.full_name) : 'طالب محذوف'}</span> <span style="font-size:10px;color:var(--muted);font-weight:400;">${type ? escapeHtml(type.problem_name) : ''}</span></span>
        <span style="font-size:11px;color:${st.color};font-weight:700;white-space:nowrap;">${st.text}</span>
      </div>`;
    }).join('');
  }

  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 6px;font-size:15px;color:var(--navy);">حالة التحويلات</h3>
      <p style="font-size:11.5px;color:var(--muted);margin:0 0 10px;line-height:1.8;">
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#8A2C2C;vertical-align:middle;"></span> "لم يُحوَّل" = مخالفة تستوجب تحويلًا ولم يُصدَر لها خطاب &nbsp;•&nbsp;
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#C9A227;vertical-align:middle;"></span> "جارٍ" = صدر الخطاب ولم تُوثَّق صورة التسليم &nbsp;•&nbsp;
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#215C34;vertical-align:middle;"></span> "مكتمل" = صدر الخطاب ووُثِّق
      </p>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <button class="btn ${mode === 'incident' ? 'btn-primary' : 'btn-outline'}" style="padding:4px 10px;font-size:11px;flex:1;" onclick="showCrmTransfersStatusModal('incident')">حسب الحادثة</button>
        <button class="btn ${mode === 'student' ? 'btn-primary' : 'btn-outline'}" style="padding:4px 10px;font-size:11px;flex:1;" onclick="showCrmTransfersStatusModal('student')">حسب الطالب</button>
      </div>
      <div style="border:1px solid var(--line);max-height:50vh;overflow:auto;">${rows}</div>
    </div>`, '430px');
}

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
    } else if(crmIncidentFilter === 'undocumented'){
      q = q.eq('current_stage', 'referred').eq('referral_letter_generated', true).is('referral_receipt_photo_url', null);
    }
    return q.order('created_at', { ascending: false }).range(from, to);
  };

  const { data, error } = await fetchAllRows(buildQuery);
  if(error){ box.innerHTML = '<div class="empty-state">تعذّر التحميل: ' + escapeHtml(error.message) + '</div>'; return; }

  const emptyMsg = {
    all: 'لا توجد حوادث مسجّلة بعد.',
    pending: 'لا توجد حالات بانتظار تأكيد التحويل حاليًا.',
    undocumented: 'لا توجد خطابات بدون توثيق تسليم حاليًا.'
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
  const stageColor = { warning_1: '#C9A227', warning_2: '#C9A227', referred: '#C0392B' };

  const groups = {};
  const order = [];
  filtered.forEach(inc => {
    const sid = inc.student_id;
    if(!groups[sid]){ groups[sid] = []; order.push(sid); }
    groups[sid].push(inc);
  });

  box.innerHTML = order.map((sid, gi) => {
    const list = groups[sid];
    const student = crmStudents.find(s => s.id === sid);
    const hasPending = list.some(i => i.current_stage === 'referred' && !i.referral_letter_generated);
    const groupId = 'crmGroup' + gi;
    const startOpen = hasPending;

    const itemsHtml = list.map(inc => {
      const type = crmIncidentTypes.find(t => t.id === inc.incident_type_id);
      const needsConfirm = inc.current_stage === 'referred' && !inc.referral_letter_generated;
      const confirmed = inc.current_stage === 'referred' && inc.referral_letter_generated;
      const color = stageColor[inc.current_stage] || '#999';
      return `
        <div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px;">
          <div style="width:4px;border-radius:2px;background:${color};flex-shrink:0;align-self:stretch;"></div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
              <div>${type ? escapeHtml(type.problem_name) : '—'}</div>
              <button style="border:none;background:none;color:var(--muted);font-size:14px;line-height:1;cursor:pointer;flex-shrink:0;padding:0;" onclick="deleteCrmIncident('${inc.id}')" title="حذف">🗑</button>
            </div>
            <div style="color:var(--muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px;">
              <span>${inc.incident_date} • المرة ${inc.occurrence_number} • ${stageLabel[inc.current_stage] || inc.current_stage}${needsConfirm ? ' ⚠' : ''}${confirmed ? ' ✅' + (inc.referral_letter_number ? ' رقم ' + escapeHtml(inc.referral_letter_number) : '') + (inc.referral_receipt_photo_url ? ' 📷 موثّق' : ' ⚠ غير موثّق') : ''}</span>
              ${needsConfirm ? `<button class="btn btn-primary" style="padding:2px 8px;font-size:10.5px;background:#8A2C2C;" onclick="openReferralLetter('${inc.id}')">إصدار خطاب 📄</button>` : ''}
              ${confirmed && inc.referral_receipt_photo_url ? `<button class="btn btn-outline" style="padding:2px 8px;font-size:10.5px;" onclick="openReferralLetter('${inc.id}')">عرض الخطاب</button>` : ''}
              ${confirmed && !inc.referral_receipt_photo_url ? `<button class="btn btn-primary" style="padding:2px 8px;font-size:10.5px;background:#8A6D1F;" onclick="openReferralLetter('${inc.id}')">📷 توثيق التسليم</button>` : ''}
            </div>
            ${inc.notes ? `<div style="color:var(--muted);font-size:11px;margin-top:2px;">${escapeHtml(inc.notes)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="border:1px solid var(--line);margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#F7F5F0;cursor:pointer;" onclick="toggleCrmGroup('${groupId}')">
          <span style="font-weight:700;font-size:13px;">${student ? escapeHtml(student.full_name) : 'طالب محذوف'} <span style="font-weight:400;color:var(--muted);font-size:11.5px;">(${list.length} ${list.length === 1 ? 'حادثة' : 'حوادث'})</span>${hasPending ? ' <span style="color:#C0392B;">⚠</span>' : ''}</span>
          <span id="${groupId}_arrow" style="font-size:11px;color:var(--muted);">${startOpen ? '▾' : '▸'}</span>
        </div>
        <div id="${groupId}" style="display:${startOpen ? 'block' : 'none'};padding:0 12px;">
          ${itemsHtml}
        </div>
      </div>
    `;
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
  renderProfile();
  renderCycleCountdown();
  await refreshPlanSummary();
  renderCycleCard();
  renderServiceAlert();
  renderHomeProgressCard();
  maybeShowOnboardingTour();
}

/* ============================================
   (3) اقتراح "التالي" — أقرب عنصر يحتاج توثيقًا
   ============================================ */
/* بطاقة واحدة موحّدة في الرئيسية تجمع: النسبة الموزونة + حالة التغطية + التالي المقترح */
function renderHomeProgressCard(){
  const card = document.getElementById('homeProgressCard');
  if(!card) return;

  const elements = getElementsOrder();
  if(!elements.length){ card.style.display = 'none'; return; }

  const wp = computeWeightedProgress();
  const missing = getUncoveredElements();
  const started = elements.length - missing.length;
  const barColor = wp.pct >= 80 ? '#215C34' : (wp.pct >= 40 ? 'var(--gold)' : '#B23A3A');

  let suggestionHtml = '';
  if(missing.length){
    const sorted = [...missing].sort((a, b) => getElementWeight(b.key) - getElementWeight(a.key));
    const next = sorted[0];
    const { name } = splitLabel(next.label);
    suggestionHtml = `
      <div class="home-progress-suggest" onclick="addShahidForElement('${escapeHtml(next.key)}')">
        <span>التالي المقترح: <b>${escapeHtml(name)}</b></span>
        <span class="hp-arrow">ابدأ الآن ←</span>
      </div>`;
  } else {
    suggestionHtml = `<div class="home-progress-suggest done">✓ وثّقت شواهد في كل عناصر الأداء الأحد عشر</div>`;
  }

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
      <span style="font-size:12px;color:var(--muted);">الاكتمال الموزون لعناصر الأداء</span>
      <span style="font-size:17px;font-weight:800;color:${barColor};">${wp.pct}%</span>
    </div>
    <div style="background:#F1EEE6;height:9px;margin-bottom:8px;">
      <div style="background:${barColor};height:100%;width:${wp.pct}%;transition:width .4s;"></div>
    </div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:12px;">
      بدأت التوثيق في <b style="color:var(--navy);">${started} من ${elements.length}</b> عنصرًا
      <span style="text-decoration:underline;cursor:pointer;margin-right:4px;" onclick="event.stopPropagation();showCoverageDetails()">(التفاصيل)</span>
    </div>
    ${suggestionHtml}`;

  card.style.display = 'block';
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
  setActiveBottomTab(null);
  document.getElementById('formView').style.display = 'block';
}
async function showList(){
  hideAllMainViews();
  setActiveBottomTab(null);
  document.getElementById('listView').style.display = 'block';
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
  setActiveBottomTab('plan');
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
  const elements = getElementsOrder();
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


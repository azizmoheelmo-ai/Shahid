'use strict';
/* ============================================================
   (15) إدارة الصف — ملف الطالب + الموقف السريع + ⭐ + ملاحظاتي
   ------------------------------------------------------------
   الدفعة 3 من إعادة تصميم إدارة الصف. الهدف: يفهم المعلم حال الطالب خلال
   30 ثانية من "بطاقة حال" قصيرة (وقائع لا أحكام)، والتفاصيل مطوية تحتها.

   ضوابط عدالة مقصودة:
   - لا ألوان تحذير على المواقف الرسمية في بطاقة الحال: إنذار أول واحد لا
     يجعل الطالب "مشكلة" (21 طالبًا فعليًا لدى المعلم الحالي بإنذار واحد).
   - الإيجابي والرسمي بنفس الخط الزمني وبنفس الوزن البصري.
   - "منذ آخر موقف X يومًا" ظاهر دائمًا — التحسّن واقعة تُرى لا تُستنتج.
   - "ملاحظاتي" رأي المعلم لا واقعة: منفصلة بصريًا، لا تدخل أي حساب، لا
     يراها المسؤول (لا سياسة RLS له) ولا تُعرض عبر موصل الذكاء الاصطناعي.

   كل استعلام هنا مُقيَّد صراحة بـ.eq('teacher_id', currentUser.id).
   ============================================================ */

let crmIncidentTypeUsage = null; /* Map<typeId, count> — يُصفَّر بعد تسجيل مخالفة */
let crmProfile = null; /* { studentId, returnTo, token } */
let crmProfileToken = 0;

/* ============================================================
   دوال صرفة
   ============================================================ */

/* الأنواع الأكثر استخدامًا لدى هذا المعلم أولًا (المعلم الحالي يستخدم 6 من
   51 نوعًا) — لاختيار المخالفة بنقرة بدل البحث في القائمة كاملة */
function topIncidentTypes(types, usage, limit){
  return (types || [])
    .filter(t => usage && usage.get(t.id))
    .sort((a, b) => usage.get(b.id) - usage.get(a.id) || a.problem_name.localeCompare(b.problem_name, 'ar'))
    .slice(0, limit || 5);
}

function daysBetweenIso(fromIso, toIso){
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/* بطاقة الحال: وقائع فقط، بلا تصنيف للطالب */
function buildStudentStatusLines(data, todayIso){
  const att = data.attendance || [];
  const counts = { absent: 0, late: 0, permitted_exit: 0 };
  att.forEach(a => { if(counts[a.status] !== undefined) counts[a.status]++; });
  const attendanceLine = data.recordedLessons
    ? `غاب ${counts.absent} · تأخر ${counts.late} · مستأذن ${counts.permitted_exit} — من ${data.recordedLessons} حصة مرصودة`
    : 'لا حصص مرصودة لشعبته بعد';

  const incidents = (data.incidents || []).slice().sort((a, b) => b.incident_date.localeCompare(a.incident_date));
  const positives = data.positives || [];
  let behaviorLine;
  if(incidents.length){
    const last = incidents[0];
    const since = daysBetweenIso(last.incident_date, todayIso);
    behaviorLine = `مواقف رسمية: ${incidents.length} · آخرها ${last.typeName || 'مخالفة'} (${last.incident_date}) · منذ ${since} ${since === 1 ? 'يوم' : 'يومًا'}`;
  } else {
    behaviorLine = 'لا مواقف رسمية';
  }
  behaviorLine += ` · ⭐ ${positives.length}`;

  const fus = data.followups || [];
  const open = fus.filter(f => f.status === 'open').sort((a, b) => a.review_date.localeCompare(b.review_date));
  const closed = fus.filter(f => f.status === 'closed').sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)));
  const outcomeLabels = { improved: 'تحسّن', partial: 'تحسّن جزئي', not_improved: 'لم يتحسّن' };
  let followupLine;
  if(open.length){
    followupLine = `مفتوحة: ${open[0].reason_text} — المراجعة ${open[0].review_date}${open.length > 1 ? ` (+${open.length - 1})` : ''}`;
  } else if(closed.length){
    followupLine = `آخر متابعة: ${closed[0].reason_text} — ${outcomeLabels[closed[0].outcome] || ''}`;
  } else {
    followupLine = 'لا متابعات';
  }
  return { attendanceLine, behaviorLine, followupLine };
}

/* خط زمني واحد للمواقف الرسمية والإيجابية، الأحدث أولًا */
function buildBehaviorTimeline(incidents, positives){
  const items = [];
  (incidents || []).forEach(i => items.push({ kind: 'incident', date: i.incident_date, ref: i }));
  (positives || []).forEach(p => items.push({ kind: 'positive', date: p.note_date, ref: p }));
  return items.sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'positive' ? -1 : 1));
}

/* ============================================================
   فتح/إغلاق ملف الطالب
   ============================================================ */
function showCrmOverlayPane(name){
  const panes = { sheet: 'crmLessonSheet', profile: 'crmStudentProfile' };
  Object.keys(panes).forEach(k => {
    const el = document.getElementById(panes[k]);
    if(el) el.style.display = k === name ? 'block' : 'none';
  });
  document.getElementById('crmTabsBar').style.display = name ? 'none' : '';
  if(name){
    ['crmTabToday', 'crmTabRecord', 'crmTabStudents', 'crmLinkBanner'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.style.display = 'none';
    });
  }
}

/* returnTo: { type:'sheet', sectionId, dateIso, period } أو { type:'tab', tab } */
async function openCrmStudentProfile(studentId, returnTo){
  if(document.getElementById('classroomView').style.display === 'none'){
    await showClassroomManagement();
  }
  const token = ++crmProfileToken;
  crmProfile = { studentId, returnTo: returnTo || { type: 'tab', tab: 'students' }, token };
  showCrmOverlayPane('profile');
  window.scrollTo(0, 0);
  await renderCrmStudentProfile();
}

/* تصفير حالة الملف دون رسم — عند فتح شاشة إدارة الصف من جديد */
function resetCrmStudentProfile(){
  crmProfileToken++;
  crmProfile = null;
}

function closeCrmStudentProfile(){
  const back = crmProfile ? crmProfile.returnTo : { type: 'tab', tab: 'students' };
  crmProfileToken++;
  crmProfile = null;
  showCrmOverlayPane(null);
  renderCrmLinkBanner();
  if(back.type === 'sheet'){
    openCrmLessonSheet(back.sectionId, back.dateIso, back.period);
  } else {
    switchCrmTab(back.tab || 'students');
  }
}

async function loadCrmStudentProfileData(student){
  const uid = currentUser.id;
  const queries = [
    sb.from('classroom_attendance').select('lesson_id, status').eq('teacher_id', uid).eq('student_id', student.id),
    sb.from('classroom_incidents').select('id, incident_date, occurrence_number, current_stage, incident_type_id, notes, referral_letter_generated, referral_receipt_photo_url')
      .eq('teacher_id', uid).eq('student_id', student.id),
    sb.from('classroom_positive_notes').select('id, note_date, note_text').eq('teacher_id', uid).eq('student_id', student.id),
    sb.from('classroom_private_notes').select('id, body, created_at, updated_at').eq('teacher_id', uid).eq('student_id', student.id).order('created_at', { ascending: false }),
    sb.from('classroom_followups').select('id, reason_type, reason_text, review_date, status, outcome, next_step, closed_at, created_at').eq('teacher_id', uid).eq('student_id', student.id),
    student.section_id
      ? sb.from('classroom_lessons').select('id', { count: 'exact', head: true }).eq('teacher_id', uid).eq('section_id', student.section_id)
      : Promise.resolve({ count: 0, error: null })
  ];
  const [attRes, incRes, posRes, privRes, fuRes, lessonsRes] = await Promise.all(queries);
  const failed = [attRes, incRes, posRes, privRes, fuRes, lessonsRes].find(r => r && r.error);
  if(failed) throw failed.error;

  const attendance = attRes.data || [];
  let lessonDates = new Map();
  if(attendance.length){
    const { data: lessons, error } = await sb.from('classroom_lessons').select('id, lesson_date, period')
      .eq('teacher_id', uid).in('id', [...new Set(attendance.map(a => a.lesson_id))]);
    if(error) throw error;
    lessonDates = new Map((lessons || []).map(l => [l.id, l]));
  }
  const incidents = (incRes.data || []).map(i => {
    const type = crmIncidentTypes.find(t => t.id === i.incident_type_id);
    return Object.assign({}, i, { typeName: type ? type.problem_name : 'مخالفة' });
  });
  return {
    attendance: attendance.map(a => Object.assign({}, a, { lesson: lessonDates.get(a.lesson_id) || null })),
    recordedLessons: lessonsRes.count || 0,
    incidents,
    positives: posRes.data || [],
    privateNotes: privRes.data || [],
    followups: fuRes.data || []
  };
}

async function renderCrmStudentProfile(){
  if(!crmProfile) return;
  const { studentId, token } = crmProfile;
  const body = document.getElementById('crmStudentProfileBody');
  const student = crmStudents.find(s => s.id === studentId);
  if(!student){
    body.innerHTML = '<div class="empty-state">الطالب غير موجود في السنة المعروضة.</div><button class="btn btn-outline" onclick="closeCrmStudentProfile()">رجوع</button>';
    return;
  }
  if(!body.innerHTML.trim() || !body.dataset.studentId || body.dataset.studentId !== studentId){
    body.innerHTML = '<div class="loading-state">جارٍ التحميل...</div>';
  }
  body.dataset.studentId = studentId;
  if(!crmIncidentTypes.length) await loadCrmIncidentTypes();

  let data;
  try{ data = await loadCrmStudentProfileData(student); }
  catch(e){
    if(!crmProfile || crmProfile.token !== token) return;
    body.innerHTML = `<div class="empty-state">تعذّر تحميل ملف الطالب: ${escapeHtml(e.message || '')} <button class="btn btn-outline crm-mini-btn" onclick="renderCrmStudentProfile()">إعادة المحاولة</button></div>
      <button class="btn btn-outline" onclick="closeCrmStudentProfile()">رجوع</button>`;
    return;
  }
  if(!crmProfile || crmProfile.token !== token) return; /* انتقل لطالب/شاشة أخرى أثناء التحميل */

  const label = studentClassLabel(student, crmGradeLevels, crmSections);
  const lines = buildStudentStatusLines(data, localIsoDate());
  const stageLabel = { warning_1: 'إنذار أول', warning_2: 'إنذار ثانٍ', referred: 'تحويل' };

  const attendanceRows = data.attendance
    .filter(a => a.lesson)
    .sort((a, b) => b.lesson.lesson_date.localeCompare(a.lesson.lesson_date))
    .map(a => `<div class="crm-tl-row"><span>${a.lesson.lesson_date}${a.lesson.period ? ' · الحصة ' + a.lesson.period : ''}</span><b>${ATTENDANCE_LABELS[a.status] || ''}</b></div>`)
    .join('') || '<div class="crm-today-empty">لا غياب ولا تأخر ولا استئذان مسجّل.</div>';

  const timeline = buildBehaviorTimeline(data.incidents, data.positives).map(item => {
    if(item.kind === 'positive'){
      const p = item.ref;
      return `<div class="crm-tl-row"><span>⭐ ${p.note_text ? escapeHtml(p.note_text) : 'ملاحظة إيجابية'}</span>
        <span class="crm-tl-meta">${p.note_date} <button class="crm-icon-btn" title="حذف" onclick="deleteCrmPositiveNote('${p.id}')">🗑</button></span></div>`;
    }
    const i = item.ref;
    const letter = i.current_stage === 'referred'
      ? (i.referral_letter_generated ? (i.referral_receipt_photo_url ? ' · خطاب ✓ موثّق' : ' · خطاب ✓ غير موثّق') : ' · بلا خطاب بعد')
      : '';
    return `<div class="crm-tl-row"><span>${escapeHtml(i.typeName)}${i.notes ? ' — ' + escapeHtml(i.notes) : ''}</span>
      <span class="crm-tl-meta">${i.incident_date} · ${stageLabel[i.current_stage] || ''}${letter}</span></div>`;
  }).join('') || '<div class="crm-today-empty">لا مواقف مسجّلة.</div>';

  const outcomeLabels = { improved: 'تحسّن', partial: 'تحسّن جزئي', not_improved: 'لم يتحسّن' };
  const followupsHtml = data.followups.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(f => `
    <div class="crm-tl-row"><span>${escapeHtml(f.reason_text)}</span>
      <span class="crm-tl-meta">${f.status === 'open'
        ? `مفتوحة · المراجعة ${f.review_date} <button class="btn btn-outline crm-mini-btn" style="min-height:28px;padding:2px 8px;" onclick="openCrmReviewModal('${f.id}')">مراجعة</button>`
        : (outcomeLabels[f.outcome] || '')}</span></div>`).join('') || '<div class="crm-today-empty">لا متابعات لهذا الطالب.</div>';

  const privateRows = data.privateNotes.map(n => `<div class="crm-private-note">
      <div style="white-space:pre-wrap;">${escapeHtml(n.body)}</div>
      <div class="crm-tl-meta" style="margin-top:4px;">${localIsoDate(new Date(n.updated_at || n.created_at))}
        <button class="crm-icon-btn" title="حذف" onclick="deleteCrmPrivateNote('${n.id}')">🗑</button></div>
    </div>`).join('');

  body.innerHTML = `
    <div class="crm-sheet-head">${escapeHtml(student.full_name)}</div>
    <div style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">${escapeHtml(label.grade)} — الشعبة ${escapeHtml(label.section)}</div>

    <div class="crm-today-card">
      <div class="crm-status-line"><span class="crm-status-key">الحضور</span><span>${lines.attendanceLine}</span></div>
      <div class="crm-status-line"><span class="crm-status-key">المواقف</span><span>${escapeHtml(lines.behaviorLine)}</span></div>
      <div class="crm-status-line"><span class="crm-status-key">المتابعة</span><span>${escapeHtml(lines.followupLine)}</span></div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
      <button class="btn btn-outline crm-mini-btn" onclick="openCrmIncidentModal('${student.id}')">موقف رسمي</button>
      <button class="btn btn-outline crm-mini-btn" onclick="openCrmPositiveModal('${student.id}')">⭐ ملاحظة إيجابية</button>
      <button class="btn btn-outline crm-mini-btn" onclick="openCrmFollowupModal('${student.id}')">فتح متابعة</button>
    </div>

    ${crmProfileSection('crmProfAtt', 'الحضور (الاستثناءات فقط)', attendanceRows)}
    ${crmProfileSection('crmProfBeh', 'المواقف', timeline)}
    ${crmProfileSection('crmProfFu', 'المتابعات', followupsHtml)}
    ${crmProfileSection('crmProfPriv', 'ملاحظاتي', `
      <p style="font-size:11px;color:var(--muted);margin:0 0 8px;line-height:1.7;">رأيك أنت لا واقعة — لا يراها غيرك (ولا المسؤول)، ولا تدخل في أي حساب أو تقرير.</p>
      <textarea class="goal-input" id="crmPrivateNoteInput" maxlength="2000" rows="2" placeholder="اكتب ملاحظة خاصة..." style="margin-bottom:6px;"></textarea>
      <button class="btn btn-outline crm-mini-btn" id="crmPrivateNoteBtn" onclick="saveCrmPrivateNote('${student.id}')">حفظ الملاحظة</button>
      <div style="margin-top:10px;">${privateRows}</div>`)}

    <div style="margin-top:12px;"><button class="btn btn-outline" onclick="closeCrmStudentProfile()">رجوع</button></div>`;
}

function crmProfileSection(id, title, inner){
  return `<div class="crm-today-card">
    <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="toggleCrmGroup('${id}')">
      <span class="crm-today-title" style="margin:0;">${title}</span>
      <span id="${id}_arrow" style="font-size:11px;color:var(--muted);">▸</span>
    </div>
    <div id="${id}" style="display:none;margin-top:8px;">${inner}</div>
  </div>`;
}

/* ============================================================
   نافذة الموقف الرسمي (من ورقة الحصة أو ملف الطالب)
   ============================================================ */
let crmQuickIncident = null; /* { studentId, incidentDate, saving } */

async function loadCrmIncidentTypeUsage(){
  if(crmIncidentTypeUsage) return crmIncidentTypeUsage;
  const { data, error } = await sb.from('classroom_incidents').select('incident_type_id').eq('teacher_id', currentUser.id);
  const usage = new Map();
  if(!error) (data || []).forEach(r => usage.set(r.incident_type_id, (usage.get(r.incident_type_id) || 0) + 1));
  crmIncidentTypeUsage = usage;
  return usage;
}

async function openCrmIncidentModal(studentId, incidentDate){
  const student = crmStudents.find(s => s.id === studentId);
  if(!student) return;
  if(!crmIncidentTypes.length) await loadCrmIncidentTypes();
  const usage = await loadCrmIncidentTypeUsage();
  const top = topIncidentTypes(crmIncidentTypes, usage, 5);
  const degreeLabels = { 1: 'الدرجة الأولى', 2: 'الدرجة الثانية', 3: 'الدرجة الثالثة', 4: 'الدرجة الرابعة', 5: 'الدرجة الخامسة' };
  const groups = {};
  crmIncidentTypes.forEach(t => { (groups[t.problem_degree] = groups[t.problem_degree] || []).push(t); });
  let options = '<option value="">اختر نوع المخالفة</option>';
  if(top.length){
    options += '<optgroup label="الأكثر استخدامًا لديك">' + top.map(t => `<option value="${t.id}">${escapeHtml(t.problem_name)}</option>`).join('') + '</optgroup>';
  }
  Object.keys(groups).sort((a, b) => a - b).forEach(deg => {
    options += `<optgroup label="${degreeLabels[deg] || ('الدرجة ' + deg)}">` +
      groups[deg].map(t => `<option value="${t.id}">${escapeHtml(t.problem_name)}</option>`).join('') + '</optgroup>';
  });
  crmQuickIncident = { studentId, incidentDate: incidentDate || localIsoDate(), saving: false };
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">موقف رسمي</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(student.full_name)} · ${crmQuickIncident.incidentDate}</div>
      <select class="goal-input" id="crmQiType" style="margin-bottom:8px;" onchange="previewCrmQuickIncident()">${options}</select>
      <div id="crmQiPreview" style="font-size:12px;line-height:1.8;margin-bottom:8px;"></div>
      <textarea class="goal-input" id="crmQiNotes" maxlength="2000" rows="2" placeholder="ملاحظة (اختياري)" style="margin-bottom:8px;"></textarea>
      <button class="btn btn-primary" id="crmQiSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmQuickIncident()">حفظ الموقف</button>
    </div>`, '440px');
}

async function previewCrmQuickIncident(){
  const qi = crmQuickIncident;
  const typeId = document.getElementById('crmQiType').value;
  const box = document.getElementById('crmQiPreview');
  if(!qi || !typeId){ box.textContent = ''; return; }
  try{
    const occurrence = await computeIncidentOccurrence(qi.studentId, typeId, getCrmSemesterLabel());
    if(crmQuickIncident !== qi || document.getElementById('crmQiType').value !== typeId) return;
    const { stage, actionText } = incidentStageFor(crmIncidentTypes.find(t => t.id === typeId), occurrence);
    box.innerHTML = `<b>المرة ${occurrence}</b> لهذه المخالفة هذا الفصل — ${escapeHtml(actionText || '')}` +
      (stage === 'referred' ? '<div style="color:#8A2C2C;font-weight:700;">تتطلب خطاب تحويل (من تبويب "تسجيل مخالفة")</div>' : '');
  } catch(e){ box.textContent = ''; }
}

async function saveCrmQuickIncident(){
  const qi = crmQuickIncident;
  if(!qi || qi.saving) return;
  const typeId = document.getElementById('crmQiType').value;
  if(!typeId){ showToast('اختر نوع المخالفة', 'error'); return; }
  const btn = document.getElementById('crmQiSaveBtn');
  qi.saving = true;
  btn.disabled = true;
  try{
    const { stage } = await insertClassroomIncident({ studentId: qi.studentId, typeId, notes: document.getElementById('crmQiNotes').value.trim(), incidentDate: qi.incidentDate });
    closeCrmModal();
    showToast(stage === 'referred' ? 'حُفظ الموقف — يتطلب خطاب تحويل' : 'حُفظ الموقف', 'ok');
    refreshCrmPendingBadges();
    if(crmProfile && crmProfile.studentId === qi.studentId) renderCrmStudentProfile();
  } catch(e){
    showToast('تعذّر الحفظ: ' + (e.message || ''), 'error');
    qi.saving = false;
    btn.disabled = false;
  }
}

function closeCrmModal(){
  crmQuickIncident = null;
  crmQuickPositive = null;
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if(cancelBtn) cancelBtn.click();
}

/* ============================================================
   ⭐ الملاحظة الإيجابية — نقرة واحدة، والنص اختياري
   ============================================================ */
let crmQuickPositive = null;

function openCrmPositiveModal(studentId, noteDate){
  const student = crmStudents.find(s => s.id === studentId);
  if(!student) return;
  crmQuickPositive = { studentId, noteDate: noteDate || localIsoDate(), saving: false };
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">⭐ ملاحظة إيجابية</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(student.full_name)} · ${crmQuickPositive.noteDate}</div>
      <input class="goal-input" id="crmQpText" maxlength="300" placeholder="ماذا فعل؟ (اختياري)" style="margin-bottom:8px;">
      <button class="btn btn-primary" id="crmQpSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmQuickPositive()">⭐ حفظ</button>
    </div>`, '400px');
}

async function saveCrmQuickPositive(){
  const qp = crmQuickPositive;
  if(!qp || qp.saving) return;
  const student = crmStudents.find(s => s.id === qp.studentId);
  const btn = document.getElementById('crmQpSaveBtn');
  qp.saving = true;
  btn.disabled = true;
  const text = document.getElementById('crmQpText').value.trim();
  const { error } = await sb.from('classroom_positive_notes').insert({
    teacher_id: currentUser.id,
    student_id: qp.studentId,
    section_id: (student && student.section_id) || null,
    note_date: qp.noteDate,
    note_text: text || null
  });
  if(error){
    showToast('تعذّر الحفظ: ' + error.message, 'error');
    qp.saving = false;
    btn.disabled = false;
    return;
  }
  closeCrmModal();
  showToast('⭐ حُفظت', 'ok');
  if(crmProfile && crmProfile.studentId === qp.studentId) renderCrmStudentProfile();
}

async function deleteCrmPositiveNote(id){
  const ok = await showConfirm('حذف هذه الملاحظة الإيجابية؟');
  if(!ok) return;
  const { error } = await sb.from('classroom_positive_notes').delete().eq('teacher_id', currentUser.id).eq('id', id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  renderCrmStudentProfile();
}

/* ============================================================
   ملاحظاتي (خاصة)
   ============================================================ */
let crmPrivateSaving = false;

async function saveCrmPrivateNote(studentId){
  const input = document.getElementById('crmPrivateNoteInput');
  const text = (input.value || '').trim();
  if(!text){ showToast('اكتب الملاحظة أولًا', 'error'); return; }
  if(crmPrivateSaving) return;
  crmPrivateSaving = true;
  const btn = document.getElementById('crmPrivateNoteBtn');
  if(btn) btn.disabled = true;
  const { error } = await sb.from('classroom_private_notes').insert({ teacher_id: currentUser.id, student_id: studentId, body: text });
  crmPrivateSaving = false;
  if(btn) btn.disabled = false;
  if(error){ showToast('تعذّر الحفظ: ' + error.message, 'error'); return; }
  showToast('حُفظت الملاحظة', 'ok');
  if(crmProfile && crmProfile.studentId === studentId){
    await renderCrmStudentProfile();
    const sec = document.getElementById('crmProfPriv');
    if(sec){ sec.style.display = 'block'; document.getElementById('crmProfPriv_arrow').textContent = '▾'; }
  }
}

async function deleteCrmPrivateNote(id){
  const ok = await showConfirm('حذف هذه الملاحظة الخاصة نهائيًا؟');
  if(!ok) return;
  const { error } = await sb.from('classroom_private_notes').delete().eq('teacher_id', currentUser.id).eq('id', id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  await renderCrmStudentProfile();
  const sec = document.getElementById('crmProfPriv');
  if(sec){ sec.style.display = 'block'; document.getElementById('crmProfPriv_arrow').textContent = '▾'; }
}

/* ============================================================
   قائمة ⋯ لطالب داخل ورقة الحصة
   ============================================================ */
function openCrmStudentActions(studentId){
  const student = crmStudents.find(s => s.id === studentId);
  if(!student || !crmSheet) return;
  const s = crmSheet;
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 10px;font-size:15px;color:var(--navy);">${escapeHtml(student.full_name)}</h3>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-outline" style="justify-content:center;" onclick="closeCrmModal();openCrmIncidentModal('${studentId}','${s.dateIso}')">موقف رسمي</button>
        <button class="btn btn-outline" style="justify-content:center;" onclick="closeCrmModal();openCrmPositiveModal('${studentId}','${s.dateIso}')">⭐ ملاحظة إيجابية</button>
        <button class="btn btn-outline" style="justify-content:center;" onclick="closeCrmModal();openCrmStudentProfileFromSheet('${studentId}')">ملف الطالب</button>
      </div>
    </div>`, '360px');
}

/* من الورقة إلى الملف ثم العودة لنفس الحصة: الحالات غير المحفوظة باقية
   كمسودة محلية وتُستعاد عند الرجوع */
function openCrmStudentProfileFromSheet(studentId){
  if(!crmSheet) return;
  const back = { type: 'sheet', sectionId: crmSheet.sectionId, dateIso: crmSheet.dateIso, period: crmSheet.period };
  resetCrmLessonSheet();
  openCrmStudentProfile(studentId, back);
}

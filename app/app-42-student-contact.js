/* ============================================================
   جوال الطالب وجوال ولي الأمر + ملاحظة سريعة بواتساب
   ------------------------------------------------------------
   - classroom_students.student_phone / guardian_phone: اختياريان، أرقام دولية فقط (966501234567).
   - الأرقام للتواصل فقط: لا تدخل أي تقرير أو PDF (قرار المستخدم)، ولا يقرؤها موصل الذكاء الاصطناعي.
   - «واتساب»: يفتح محادثة wa.me مع الرقم والنص جاهز، والمعلم يضغط إرسال بنفسه؛ لا يُحفظ النص ولا يُرسل شيء من الخادم.
   - الكتابة بتصفية المعلم: .eq('teacher_id') مع .eq('id') (السياسة وحدها لا تكفي بالشاشات الشخصية).
   ============================================================ */

const CRM_WA_NOTE_MAX = 500; /* الرابط يحمل النص مُرمَّزًا (العربية ≈ 6 أضعاف) فنقصّره لئلا يُرفض */

/* أي صيغة يكتبها المعلم → رقم دولي أرقامًا فقط، أو خطأ مفهوم. الفارغ صحيح (value: null). */
function normalizePhone(raw){
  let s = String(raw == null ? '' : raw);
  s = s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)).trim();
  if(!s) return { ok: true, value: null };
  const plus = s.charAt(0) === '+';
  s = s.replace(/[\s\-().‎‏‪-‮]/g, '');
  if(!/^\+?\d+$/.test(s)) return { ok: false, error: 'الرقم يحتوي حروفًا أو رموزًا غير مقبولة' };
  let d = s.replace(/^\+/, '');
  if(d.indexOf('00') === 0) d = d.slice(2);
  else if(!plus){
    if(/^05\d{8}$/.test(d)) d = '966' + d.slice(1);
    else if(/^5\d{8}$/.test(d)) d = '966' + d;
  }
  if(/^9660\d{9}$/.test(d)) d = '966' + d.slice(4); /* 966 05… خطأ شائع */
  if(!/^[1-9]\d{8,14}$/.test(d)) return { ok: false, error: 'رقم غير صالح — اكتبه مثل 0501234567 أو بصيغة دولية' };
  if(d.indexOf('966') === 0 && !/^9665\d{8}$/.test(d)) return { ok: false, error: 'الجوال السعودي يبدأ بـ 05 ويتكوّن من 10 أرقام' };
  return { ok: true, value: d };
}

/* القيمة داخل خانة التعديل: السعودي بصيغة 05… المألوفة، وغيره بصيغة دولية */
function phoneEditValue(p){
  const d = String(p || '');
  return /^9665\d{8}$/.test(d) ? '0' + d.slice(3) : (d ? '+' + d : '');
}

function phoneDisplay(p){
  const d = String(p || '');
  if(/^9665\d{8}$/.test(d)) return `+966 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d ? '+' + d : '';
}

/* رابط محادثة واتساب؛ النص يُرمَّز كاملًا فلا يخرج من وسيط الرابط */
function waChatUrl(phone, text){
  const d = String(phone || '');
  if(!/^[0-9]{9,15}$/.test(d)) return '';
  const t = String(text || '');
  return 'https://wa.me/' + d + (t ? '?text=' + encodeURIComponent(t) : '');
}

/* بطاقة «التواصل» في صفحة الطالب */
function crmContactCardHtml(student){
  const sid = escapeHtml(student.id);
  const row = (label, phone, who) => `<div class="crm-ct-row"><span>${label}<small dir="ltr">${phone ? escapeHtml(phoneDisplay(phone)) : 'لم يُضَف'}</small></span>${phone ? `<button type="button" class="crm-ct-wa" onclick="openCrmWaNote('${sid}','${who}')">واتساب</button>` : ''}</div>`;
  const editable = student.is_active !== false;
  return `<div class="crm-today-card crm-ct-card">
    <div class="crm-ct-head"><span class="crm-today-title" style="margin:0;">التواصل</span>${editable ? `<button type="button" class="crm-link-btn" onclick="openCrmContactEditor('${sid}')">${student.guardian_phone || student.student_phone ? 'تعديل الأرقام' : '+ إضافة رقم'}</button>` : ''}</div>
    ${row('ولي الأمر', student.guardian_phone, 'guardian')}${row('الطالب', student.student_phone, 'student')}
    ${(student.guardian_phone || student.student_phone) && typeof openReportShare === 'function' ? `<div class="crm-ct-send"><span>إرسال تقرير الطالب (رابط مؤقت)</span><div>${student.guardian_phone ? `<button type="button" class="crm-ct-wa crm-ct-wa-fill" onclick="openReportShare('${sid}','guardian')">إلى ولي الأمر</button>` : ''}${student.student_phone ? `<button type="button" class="crm-ct-wa crm-ct-wa-fill" onclick="openReportShare('${sid}','student')">إلى الطالب</button>` : ''}</div></div>` : ''}
  </div>`;
}

/* ============ تعديل الرقمين ============ */
let crmContactBusy = false;

function openCrmContactEditor(studentId){
  const st = crmStudents.find(x => x.id === studentId);
  if(!st) return;
  showInfoModal(`<div style="text-align:right;">
    <h3 style="margin:0 0 10px;font-size:15px;color:var(--navy);">أرقام ${escapeHtml(st.full_name)}</h3>
    <label class="crm-field-label">📱 جوال ولي الأمر</label>
    <input class="goal-input" id="crmCtGuardian" type="tel" inputmode="tel" dir="ltr" maxlength="20" placeholder="0501234567" value="${escapeHtml(phoneEditValue(st.guardian_phone))}" style="margin-bottom:8px;text-align:left;">
    <label class="crm-field-label">📱 جوال الطالب</label>
    <input class="goal-input" id="crmCtStudent" type="tel" inputmode="tel" dir="ltr" maxlength="20" placeholder="0551234567" value="${escapeHtml(phoneEditValue(st.student_phone))}" style="margin-bottom:6px;text-align:left;">
    <div id="crmCtErr" style="display:none;color:#8A2C2C;font-size:12px;margin-bottom:6px;"></div>
    <p style="font-size:11.5px;color:var(--muted);margin:0 0 10px;line-height:1.7;">للتواصل فقط — لا تظهر في أي تقرير أو PDF. اترك الخانة فارغة لحذف الرقم.</p>
    <button class="btn btn-primary" id="crmCtSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmStudentContact('${escapeHtml(st.id)}')">حفظ</button>
  </div>`, '380px');
}

async function saveCrmStudentContact(studentId){
  if(crmContactBusy) return;
  const g = normalizePhone((document.getElementById('crmCtGuardian') || {}).value);
  const s = normalizePhone((document.getElementById('crmCtStudent') || {}).value);
  const err = document.getElementById('crmCtErr');
  const bad = !g.ok ? 'جوال ولي الأمر: ' + g.error : !s.ok ? 'جوال الطالب: ' + s.error : '';
  if(bad){ if(err){ err.textContent = bad; err.style.display = 'block'; } return; }
  if(!currentUser) return;
  crmContactBusy = true;
  const btn = document.getElementById('crmCtSaveBtn');
  if(btn) btn.disabled = true;
  try{
    const { error } = await sb.from('classroom_students').update({ guardian_phone: g.value, student_phone: s.value })
      .eq('teacher_id', currentUser.id).eq('id', studentId);
    if(error){ showToast('تعذّر الحفظ: ' + error.message, 'error'); return; }
    const st = crmStudents.find(x => x.id === studentId);
    if(st){ st.guardian_phone = g.value; st.student_phone = s.value; }
    const close = document.getElementById('confirmCancelBtn');
    if(close && close.click) close.click();
    showToast('تم حفظ الأرقام', 'ok');
    /* لا نرسم فوق شاشة أخرى: المعلم قد يكون غادر صفحة هذا الطالب أثناء الحفظ */
    if(crmProfile && crmProfile.studentId === studentId) renderCrmStudentProfile();
  } finally {
    crmContactBusy = false;
    if(btn) btn.disabled = false;
  }
}

/* ============ ملاحظة سريعة بواتساب ============ */
function openCrmWaNote(studentId, who, draft){
  const st = crmStudents.find(x => x.id === studentId) || (typeof crmArchivedStudents !== 'undefined' ? crmArchivedStudents.find(x => x.id === studentId) : null);
  if(!st) return;
  const has = { guardian: !!st.guardian_phone, student: !!st.student_phone };
  if(!has.guardian && !has.student){ showToast('أضف رقمًا أولًا', 'error'); return; }
  const pick = has[who] ? who : (has.guardian ? 'guardian' : 'student');
  const radio = (k, label) => `<label class="crm-ct-pick${has[k] ? '' : ' is-off'}"><input type="radio" name="crmWaWho" value="${k}"${pick === k ? ' checked' : ''}${has[k] ? '' : ' disabled'} onchange="paintCrmWaTo('${escapeHtml(st.id)}')"><span>${label}</span></label>`;
  showInfoModal(`<div style="text-align:right;">
    <h3 style="margin:0 0 10px;font-size:15px;color:var(--navy);">ملاحظة سريعة — ${escapeHtml(st.full_name)}</h3>
    <div class="crm-ct-picks">${radio('guardian', 'ولي الأمر')}${radio('student', 'الطالب')}</div>
    <div id="crmWaTo" dir="ltr" style="text-align:right;font-size:12px;color:var(--muted);margin:6px 0;"></div>
    <textarea class="goal-input" id="crmWaText" rows="5" maxlength="${CRM_WA_NOTE_MAX}" placeholder="اكتب الملاحظة…" style="margin-bottom:6px;">${escapeHtml(String(draft || '').slice(0, CRM_WA_NOTE_MAX))}</textarea>
    <p style="font-size:11.5px;color:var(--muted);margin:0 0 10px;line-height:1.7;">تُفتح محادثة واتساب مع الرقم والنص جاهز، وتضغط إرسال بنفسك. لا يُحفظ شيء في التطبيق.</p>
    <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="sendCrmWaNote('${escapeHtml(st.id)}')">فتح واتساب ←</button>
  </div>`, '380px');
  paintCrmWaTo(st.id);
}

function crmWaChosen(){
  const el = typeof document.querySelector === 'function' ? document.querySelector('input[name="crmWaWho"]:checked') : null;
  return el && el.value === 'student' ? 'student' : 'guardian';
}

function paintCrmWaTo(studentId){
  const st = crmStudents.find(x => x.id === studentId);
  const el = document.getElementById('crmWaTo');
  if(!st || !el) return;
  el.textContent = 'إلى: ' + phoneDisplay(crmWaChosen() === 'student' ? st.student_phone : st.guardian_phone);
}

function sendCrmWaNote(studentId){
  const st = crmStudents.find(x => x.id === studentId) || (typeof crmArchivedStudents !== 'undefined' ? crmArchivedStudents.find(x => x.id === studentId) : null);
  if(!st) return;
  const text = String((document.getElementById('crmWaText') || {}).value || '').trim().slice(0, CRM_WA_NOTE_MAX);
  if(!text){ showToast('اكتب الملاحظة أولًا', 'error'); return; }
  const url = waChatUrl(crmWaChosen() === 'student' ? st.student_phone : st.guardian_phone, text);
  if(!url){ showToast('لا رقم صالح لهذا الاختيار', 'error'); return; }
  window.open(url, '_blank', 'noopener');
}

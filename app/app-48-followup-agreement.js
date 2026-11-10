'use strict';
/* ============================================================
   (48) اتفاق المتابعة مع الطالب — المرحلة 1 (وجهًا لوجه، بلا روابط)
   ------------------------------------------------------------
   التصميم والقرارات: FOLLOWUP-AGREEMENT.md.

   المعلم يجلس مع الطالب ويفتح هذه الشاشة على جواله ويناوله إياه؛ الطالب يمر بثلاث
   خطوات قصيرة (كل خطوة بطاقات قليلة كبيرة):
     1) ما الخطوة التي ستلتزم بها؟   2) ما الذي تحتاجه من معلمك؟   3) أوافق / أريد أن أتحدث أولًا.
   يُحفظ الاتفاق بعمود agreement على المتابعة نفسها (classroom_followups) — لا جدول جديد،
   فيرث RLS المالك والنسخ الاحتياطي وسلة المحذوفات وتعطيل الحساب.
   يُخزَّن نص الخيار نفسه لا رقمه، فلا يتغير معنى اتفاق قديم لو تعدّلت المكتبة لاحقًا.
   "أريد أن أتحدث أولًا" خيار دائم: الاتفاق ليس إملاءً، وعدمه لا يُحتسب حكمًا على الطالب.
   كل استعلام هنا مُقيَّد صراحة بـ.eq('teacher_id', currentUser.id).
   ============================================================ */

const FA_NO_SUPPORT = 'لا أحتاج شيئًا الآن';
/* مكتبة الخيارات: ثلاثة التزامات (بصوت الطالب) وخياران من المعلم + "لا أحتاج شيئًا الآن" */
const FA_LIBRARY = {
  grades: {
    commitments: ['أسلّم الواجبات في موعدها', 'أراجع الدرس عشر دقائق كل يوم', 'أسأل عمّا لا أفهمه أثناء الحصة'],
    supports: ['أن تعيد لي الشرح', 'أن تذكّرني قبل موعد التسليم', FA_NO_SUPPORT]
  },
  absence: {
    commitments: ['أحضر كل الحصص', 'أخبرك مسبقًا إن تعذّر حضوري', 'أحضر قبل بدء الحصة'],
    supports: ['أن نتحدث عن سبب الغياب', 'أن تذكّرني بلطف', FA_NO_SUPPORT]
  },
  lateness: {
    commitments: ['أصل قبل بدء الحصة', 'أنظّم وقتي لأصل في موعدي', 'أخبرك إن تأخرت لسبب'],
    supports: ['أن نتحدث عن سبب التأخر', 'أن تذكّرني بلطف', FA_NO_SUPPORT]
  },
  exits: {
    commitments: ['أجهّز أغراضي قبل الحصة', 'أستأذن مرة واحدة فقط في الحصة', 'أبقى في مكاني أثناء الشرح'],
    supports: ['أن نتحدث عن سبب خروجي', 'أن تذكّرني بلطف', FA_NO_SUPPORT]
  },
  behavior: {
    commitments: ['أنتبه لطريقة كلامي في الحصة', 'أستأذن قبل الكلام', 'أبقى في مكاني أثناء الشرح'],
    supports: ['أن تغيّر مكان جلوسي', 'أن تنبّهني بإشارة هادئة', FA_NO_SUPPORT]
  },
  other: {
    commitments: ['أحافظ على هدوئي وانتباهي في الحصة', 'أشارك في الحصة مرة على الأقل', 'أتواصل معك إن واجهتني صعوبة'],
    supports: ['أن نتحدث على انفراد', 'أن تتابعني بلطف', FA_NO_SUPPORT]
  }
};

/* ============================================================
   دوال صرفة
   ============================================================ */

function faLibraryFor(reasonType){
  return FA_LIBRARY[reasonType] || FA_LIBRARY.other;
}

/* يبني الاتفاق المحفوظ، أو null إن كان المُدخل غير صالح.
   input: { status: 'agreed' | 'wants_talk', commit: فهرس|null, support: فهرس|null }
   "أوافق" يتطلب الاختيارين معًا؛ "أريد أن أتحدث أولًا" يحفظ ما اختير حتى الآن (قد يكون لا شيء). */
function faBuildAgreement(reasonType, input, todayIso){
  const lib = faLibraryFor(reasonType);
  const i = input || {};
  if(i.status !== 'agreed' && i.status !== 'wants_talk') return null;
  const pick = (list, idx) => (Number.isInteger(idx) && idx >= 0 && idx < list.length) ? list[idx] : null;
  const commitment = pick(lib.commitments, i.commit);
  const support = pick(lib.supports, i.support);
  if(i.status === 'agreed' && (commitment === null || support === null)) return null;
  if(i.commit != null && commitment === null) return null;
  if(i.support != null && support === null) return null;
  return { v: 1, mode: 'in_person', status: i.status, commitment, support, agreed_on: todayIso };
}

/* سطر قصير للعرض بملف الطالب وشاشة المراجعة (النص يُهرَّب عند الإدراج) */
function faSummaryLine(a){
  if(!a || typeof a !== 'object') return '';
  if(a.status === 'wants_talk') return 'طلب الطالب أن يتحدث معك أولًا' + (a.commitment ? ' — مال إلى: ' + a.commitment : '');
  if(a.status !== 'agreed') return '';
  return 'اتفقنا: ' + a.commitment + (a.support && a.support !== FA_NO_SUPPORT ? ' — ودعمك له: ' + a.support : '');
}

function faFirstName(fullName){
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

/* ============================================================
   الشاشة (ثلاث خطوات)
   ============================================================ */
let faDraft = null; /* { followupId, studentId, reasonType, reasonText, reviewDate, name, step, commit, support, saving } */

async function openFollowupAgreement(followupId){
  /* إعادة قراءة المتابعة من القاعدة: قد تكون أُغلقت من جهاز/تبويب آخر قبل فتح الشاشة */
  const { data: f, error } = await sb.from('classroom_followups')
    .select('id, student_id, reason_type, reason_text, review_date, status, group_id, agreement')
    .eq('teacher_id', currentUser.id).eq('id', followupId).maybeSingle();
  if(error || !f){ showToast('تعذّر تحميل المتابعة', 'error'); return; }
  if(f.status !== 'open'){ showToast('هذه المتابعة مُغلقة', 'error'); return; }
  if(f.group_id){ showToast('الاتفاق للمتابعة الفردية فقط', 'error'); return; }
  faDraft = {
    followupId: f.id, studentId: f.student_id, reasonType: f.reason_type, reasonText: f.reason_text,
    reviewDate: f.review_date, name: faFirstName(attentionStudentName(f.student_id)),
    step: 1, commit: null, support: null, saving: false
  };
  showInfoModal('<div id="faRoot" class="fa-wrap"></div>', '460px');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if(cancelBtn) cancelBtn.addEventListener('click', () => { faDraft = null; }, { once: true });
  faPaint();
}

function faPaint(){
  const d = faDraft;
  const root = document.getElementById('faRoot');
  if(!d || !root) return;
  const lib = faLibraryFor(d.reasonType);
  const card = (kind, list, selected) => list.map((t, i) =>
    `<button type="button" class="fa-card${selected === i ? ' fa-sel' : ''}" onclick="faPick('${kind}', ${i})">${escapeHtml(t)}</button>`).join('');
  const back = d.step > 1 ? '<button type="button" class="fa-link" onclick="faBack()">رجوع</button>' : '';
  const talk = '<button type="button" class="fa-link" onclick="faSave(\'wants_talk\')">أريد أن أتحدث مع معلمي أولًا</button>';
  let inner;
  if(d.step === 1){
    inner = `<div class="fa-prog">١ من ٣</div>
      <div class="fa-q">${d.name ? escapeHtml(d.name) + '، ' : ''}ما الخطوة التي ستلتزم بها؟</div>
      ${card('commit', lib.commitments, d.commit)}
      <div class="fa-foot">${talk}</div>`;
  } else if(d.step === 2){
    inner = `<div class="fa-prog">٢ من ٣</div>
      <div class="fa-q">وما الذي تحتاجه من معلمك ليساعدك؟</div>
      ${card('support', lib.supports, d.support)}
      <div class="fa-foot">${back}${talk}</div>`;
  } else {
    inner = `<div class="fa-prog">٣ من ٣</div>
      <div class="fa-q">هذا اتفاقنا</div>
      <div class="fa-sum"><div><b>أنا:</b> ${escapeHtml(lib.commitments[d.commit])}</div>
        <div><b>معلمي:</b> ${escapeHtml(lib.supports[d.support])}</div>
        <div class="fa-when">نراجع معًا يوم ${escapeHtml(shortDateAr(d.reviewDate))}</div></div>
      <button type="button" class="btn btn-primary fa-agree" id="faAgreeBtn" onclick="faSave('agreed')">أوافق ✓</button>
      <div class="fa-foot">${back}${talk}</div>`;
  }
  root.innerHTML = inner;
}

function faPick(kind, i){
  const d = faDraft;
  if(!d || d.saving) return;
  if(kind === 'commit'){ d.commit = i; d.step = 2; }
  else if(kind === 'support'){ d.support = i; d.step = 3; }
  faPaint();
}

function faBack(){
  const d = faDraft;
  if(!d || d.saving || d.step <= 1) return;
  d.step -= 1;
  faPaint();
}

async function faSave(status){
  const d = faDraft;
  if(!d || d.saving) return;
  const agreement = faBuildAgreement(d.reasonType, { status, commit: d.commit, support: d.support }, localIsoDate());
  if(!agreement){ showToast('أكمل الاختيار أولًا', 'error'); return; }
  d.saving = true;
  document.querySelectorAll('#faRoot button').forEach(b => { b.disabled = true; });
  const { data, error } = await sb.from('classroom_followups').update({ agreement })
    .eq('teacher_id', currentUser.id).eq('id', d.followupId).eq('status', 'open').select('id');
  if(error){
    showToast('تعذّر الحفظ: ' + (error.message || ''), 'error');
    d.saving = false;
    document.querySelectorAll('#faRoot button').forEach(b => { b.disabled = false; });
    return;
  }
  const studentId = d.studentId;
  faDraft = null;
  closeFollowupModal();
  if(!data || !data.length){ showToast('المتابعة أُغلقت أو لم تعد موجودة — لم يُحفظ الاتفاق', 'error'); }
  else showToast(status === 'agreed' ? 'حُفظ الاتفاق ✓' : 'سُجّل أن الطالب يريد الحديث أولًا', 'ok');
  if(crmProfile && crmProfile.studentId === studentId) renderCrmStudentProfile();
}

/* سطر الاتفاق + زر البدء/التعديل لمتابعة مفتوحة فردية (بملف الطالب وشاشة المراجعة) */
function faInlineHtml(f){
  if(!f || f.status !== 'open' || f.group_id) return '';
  const line = faSummaryLine(f.agreement);
  return `${line ? `<div class="fa-line">🤝 ${escapeHtml(line)}</div>` : ''}
    <button type="button" class="btn btn-outline crm-mini-btn" onclick="openFollowupAgreement('${escapeHtml(f.id)}')">${f.agreement ? 'تعديل الاتفاق' : 'اتفاق مع الطالب'}</button>`;
}

/* بعد فتح متابعة فردية: عرض مباشر للاتفاق (قسم المتابعات بملف الطالب مطويّ فلا يُكتشف الزر وحده) */
function faOfferAfterOpen(followupId){
  showInfoModal(`<div class="fa-wrap">
    <div class="fa-q">فُتحت المتابعة ✓</div>
    <div style="font-size:14px;color:var(--muted);line-height:1.8;margin-bottom:12px;">هل الطالب معك الآن؟ يمكنك أن تتفق معه على خطوة بنفسه خلال دقيقة، أو تفعل ذلك لاحقًا من ملفه.</div>
    <button type="button" class="btn btn-primary fa-agree" onclick="openFollowupAgreement('${escapeHtml(followupId)}')">اتفاق مع الطالب الآن</button>
  </div>`, '420px');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if(cancelBtn) cancelBtn.textContent = 'لاحقًا';
}

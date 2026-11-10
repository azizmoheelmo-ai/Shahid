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
  /* زر «إغلاق» العام يُخفى: الشاشة للطالب وخياراتها هي المقصودة؛ الخروج برابط خافت «خروج» */
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if(cancelBtn){
    cancelBtn.style.display = 'none';
    cancelBtn.addEventListener('click', () => { faDraft = null; }, { once: true });
  }
  faPaint();
}

function faPaint(){
  const d = faDraft;
  const root = document.getElementById('faRoot');
  if(!d || !root) return;
  const lib = faLibraryFor(d.reasonType);
  const card = (kind, list, selected) => list.map((t, i) =>
    `<button type="button" class="fa-card${selected === i ? ' fa-sel' : ''}" onclick="faPick('${kind}', ${i})">${escapeHtml(t)}</button>`).join('');
  const dots = `<div class="fa-top"><span class="fa-dots" aria-label="الخطوة ${d.step} من 3">${[1, 2, 3].map(n => `<i class="${n <= d.step ? 'on' : ''}"></i>`).join('')}</span><button type="button" class="fa-link fa-exit" onclick="faExit()">خروج</button></div>`;
  const back = d.step > 1 ? '<button type="button" class="fa-link" onclick="faBack()">رجوع</button>' : '';
  const talk = '<button type="button" class="fa-link" onclick="faSave(\'wants_talk\')">أريد أن أتحدث مع معلمي أولًا</button>';
  let inner;
  if(d.step === 1){
    inner = `${dots}
      <div class="fa-q">${d.name ? escapeHtml(d.name) + '، ' : ''}ما الخطوة التي ستلتزم بها؟</div>
      ${card('commit', lib.commitments, d.commit)}
      <div class="fa-foot">${talk}</div>`;
  } else if(d.step === 2){
    inner = `${dots}
      <div class="fa-q">وما الذي تحتاجه من معلمك ليساعدك؟</div>
      ${card('support', lib.supports, d.support)}
      <div class="fa-foot">${back}${talk}</div>`;
  } else {
    inner = `${dots}
      <div class="fa-q">هذا اتفاقنا</div>
      <div class="fa-sum"><div><b>أنا:</b> ${escapeHtml(lib.commitments[d.commit])}</div>
        <div><b>معلمي:</b> ${escapeHtml(lib.supports[d.support])}</div>
        <div class="fa-when">نراجع معًا يوم ${escapeHtml(shortDateAr(d.reviewDate))}</div></div>
      <button type="button" class="btn btn-primary fa-agree" id="faAgreeBtn" onclick="faSave('agreed')">أوافق ✓</button>
      <div class="fa-foot">${back}${talk}</div>`;
  }
  root.innerHTML = inner;
}

function faExit(){
  const d = faDraft;
  if(d && d.saving) return;
  faDraft = null;
  closeFollowupModal();
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
  if(typeof crmActiveTab === 'function' && crmActiveTab() === 'followups') renderCrmFollowups();
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

/* ============================================================
   تبويب «متابعة» (إدارة الصف): بحث بالاسم + اختيار الفصل + تصنيف تلقائي بالحالة
   ------------------------------------------------------------
   «تحتاجك الآن» = حان موعد مراجعتها، أو فردية بلا اتفاق بعد. «جارية» = الباقي بالأقرب موعدًا.
   زر واحد لكل صف بحسب حالته. البيانات من renderCrmFollowups (app-16) المقيَّد بـteacher_id؛
   البحث والفلترة هنا على ما جُلب فقط (لا استعلام جديد).
   ============================================================ */
const FU_ONGOING_PREVIEW = 5;
let fuTabState = { q: '', section: '', more: false, closed: false };

/* سطر السبب المختصر: «غياب · غاب 5 من آخر 8 حصص» (بلا قائمة التواريخ التي بعد النقطتين) */
function fuShortFact(f){
  const label = FOLLOWUP_REASONS[f.reason_type] || '';
  const text = String(f.reason_text || '').split(':')[0].trim();
  if(!text || text === label) return label;
  return f.reason_type === 'other' || !label ? text : label + ' · ' + text;
}

/* توحيد للبحث: «احمد» تجد «أحمد»، وبلا تشكيل */
function fuNorm(t){
  return String(t || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
}

function fuDaysPhrase(n){
  if(n <= 1) return 'غدًا';
  if(n === 2) return 'بعد يومين';
  return n <= 10 ? `بعد ${n} أيام` : `بعد ${n} يومًا`;
}

/* حالة الصف: هل يحتاج المعلم الآن، وشارته، وزره الوحيد (review | agree | open) */
function fuRowState(f, todayIso){
  const due = f.review_date <= todayIso;
  const noAgreement = !f.members && !f.agreement;
  if(due) return { need: true, due: true, chip: 'حان وقت المراجعة', action: 'review' };
  if(noAgreement) return { need: true, due: false, chip: 'بلا اتفاق بعد', action: 'agree' };
  return { need: false, due: false, chip: fuDaysPhrase(daysBetweenIso(todayIso, f.review_date)), action: 'open' };
}

/* يفلتر (اسم/فصل) ويصنّف. info(f) → { names: [..], sectionId } */
function fuTabGroups(rows, todayIso, filter, info){
  const q = fuNorm(filter && filter.q);
  const section = (filter && filter.section) || '';
  const need = [], ongoing = [];
  (rows || []).forEach(f => {
    const meta = info(f);
    if(section && meta.sectionId !== section) return;
    if(q && !meta.names.some(n => fuNorm(n).includes(q))) return;
    const st = fuRowState(f, todayIso);
    (st.need ? need : ongoing).push({ f, st, meta });
  });
  const byDate = (a, b) => a.f.review_date.localeCompare(b.f.review_date);
  need.sort((a, b) => (b.st.due - a.st.due) || byDate(a, b));
  ongoing.sort(byDate);
  return { need, ongoing };
}

/* فصول فيها متابعات مفتوحة فقط، بعدد كل فصل */
function fuSectionCounts(rows, info){
  const counts = new Map();
  (rows || []).forEach(f => { const id = info(f).sectionId; if(id) counts.set(id, (counts.get(id) || 0) + 1); });
  return [...counts.entries()].map(([id, n]) => ({ id, n }));
}

function fuRowInfo(f){
  const student = id => (crmFuTab && crmFuTab.cache && crmFuTab.cache.data.students.find(x => x.id === id)) || crmStudents.find(x => x.id === id);
  if(f.members) return { names: f.members.map(m => attentionStudentName(m.student_id)), sectionId: f.section_id || '' };
  const st = student(f.student_id);
  return { names: [attentionStudentName(f.student_id)], sectionId: f.section_id || (st && st.section_id) || '', gone: !!(st && st.is_active === false) };
}

function fuShortSection(id){
  const sec = id && crmSectionById(id);
  if(!sec) return '';
  const grade = crmGradeLevels.find(g => g.id === sec.grade_level_id);
  return (grade ? grade.name + '/' : '') + crmDigits(sec.name);
}

function fuRowHtml(item){
  const { f, st, meta } = item;
  const sec = fuShortSection(meta.sectionId);
  const name = f.members
    ? `👥 ${escapeHtml(arabicCountPhrase(f.members.length, CRM_STUDENT_COUNT_FORMS))}`
    : `<a href="#" class="fu-name-link" onclick="event.preventDefault();openCrmStudentProfile('${escapeHtml(f.student_id)}', { type: 'tab', tab: 'followups' })">${escapeHtml(meta.names[0])}</a>`;
  const btn = f.members
    ? `<button type="button" class="btn ${st.due ? 'btn-primary' : 'btn-outline'} crm-mini-btn fu-b" onclick="openCrmGroupReviewModal('${escapeHtml(f.group_id)}')">${st.due ? 'مراجعة' : 'فتح'}</button>`
    : st.action === 'agree'
      ? `<button type="button" class="btn btn-primary crm-mini-btn fu-b" onclick="openFollowupAgreement('${escapeHtml(f.id)}')">🤝 اتفاق</button>`
      : `<button type="button" class="btn ${st.due ? 'btn-primary' : 'btn-outline'} crm-mini-btn fu-b" onclick="openCrmReviewModal('${escapeHtml(f.id)}')">${st.due ? 'مراجعة' : 'فتح'}</button>`;
  return `<div class="fu-row">
    <div class="fu-main"><div class="fu-name">${name}${sec ? ` <bdi class="fu-sec">${escapeHtml(sec)}</bdi>` : ''}${meta.gone ? ' <span class="fu-sec">(نُقل)</span>' : ''}${f.agreement && f.agreement.status === 'agreed' ? ' <span title="تم الاتفاق مع الطالب">🤝</span>' : ''}</div>
      <div class="fu-fact">${escapeHtml(fuShortFact(f))}</div></div>
    <div class="fu-side"><span class="fu-chip ${st.need ? 'fu-late' : 'fu-soon'}">${escapeHtml(st.chip)}</span>${btn}</div>
  </div>`;
}

function fuClosedRowHtml(f){
  if(f.members) return `<div class="fu-row"><div class="fu-main"><div class="fu-name">👥 ${escapeHtml(arabicCountPhrase(f.members.length, CRM_STUDENT_COUNT_FORMS))}</div>
      <div class="fu-fact">${escapeHtml(fuShortFact(f))}</div></div><span class="fu-out">${escapeHtml(groupOutcomeSummary(f.members))}</span></div>`;
  return `<div class="fu-row"><div class="fu-main"><div class="fu-name">${escapeHtml(attentionStudentName(f.student_id))}</div>
      <div class="fu-fact">${escapeHtml(fuShortFact(f))}</div></div><span class="fu-out">${escapeHtml(FOLLOWUP_OUTCOMES[f.outcome] || '')}</span></div>`;
}

/* القائمة وحدها (تُعاد عند كل حرف بحث، فلا يفقد حقل البحث تركيزه) */
function fuTabListHtml(){
  const t = crmFuTab;
  if(!t) return '';
  if(t.openError) return '<div class="crm-today-empty">تعذّر التحميل. <a href="#" onclick="event.preventDefault();renderCrmFollowups()">إعادة المحاولة</a></div>';
  const s = fuTabState;
  let html = '';
  if(!t.open.length){
    html += '<div class="crm-today-empty">لا متابعات جارية. اضغط «+ متابعة جديدة» لتبدأ مع طالب.</div>';
  } else {
    const g = fuTabGroups(t.open, localIsoDate(), s, fuRowInfo);
    const filtered = !!(s.q.trim() || s.section);
    if(!g.need.length && !g.ongoing.length) html += '<div class="crm-today-empty">لا نتائج لهذا البحث.</div>';
    if(g.need.length) html += `<div class="fu-grp">تحتاجك الآن (${g.need.length})</div><div class="fu-box">${g.need.map(fuRowHtml).join('')}</div>`;
    if(g.ongoing.length){
      const all = filtered || s.more || g.ongoing.length <= FU_ONGOING_PREVIEW;
      const shown = all ? g.ongoing : g.ongoing.slice(0, FU_ONGOING_PREVIEW);
      html += `<div class="fu-grp fu-calm">جارية — لا شيء مطلوب الآن (${g.ongoing.length})</div><div class="fu-box">${shown.map(fuRowHtml).join('')}
        ${all ? '' : `<button type="button" class="fu-more" onclick="fuTabSet('more', true)">عرض الباقي (${g.ongoing.length - shown.length}) ▾</button>`}</div>`;
    }
  }
  if(t.closed.length){
    html += `<button type="button" class="fu-closed" onclick="fuTabSet('closed', ${!s.closed})"><span>المتابعات المنتهية (${t.closed.length})</span><span>${s.closed ? 'إخفاء ▾' : 'عرض ▸'}</span></button>`;
    if(s.closed) html += `<div class="fu-box">${t.closed.map(fuClosedRowHtml).join('')}</div>`;
  }
  return html;
}

function fuTabPaint(){
  const box = document.getElementById('crmFollowupsBody');
  const t = crmFuTab;
  if(!box || !t) return;
  const s = fuTabState;
  const sections = fuSectionCounts(t.open, fuRowInfo);
  if(s.section && !sections.some(x => x.id === s.section)) s.section = '';
  let html = '';
  if(ATTENTION_ALERTS_ON){
    html += '<div class="crm-today-card"><div class="crm-today-title">يحتاج انتباهي' + (t.cache ? ` (${t.cache.cards.length})` : '') + '</div>';
    if(!t.cache) html += '<div class="crm-today-empty">تعذّر الفحص الآن. <a href="#" onclick="event.preventDefault();renderCrmFollowups()">إعادة المحاولة</a></div>';
    else if(!t.cache.cards.length) html += '<div class="crm-today-empty">لا شيء يستدعي انتباهك الآن ✓</div>';
    else html += t.cache.cards.map(attentionCardHtml).join('');
    html += '</div>';
  }
  html += `<div class="fu-h"><b>أتابعهم الآن (${t.open.length})</b><button type="button" class="btn btn-outline crm-mini-btn fu-new" onclick="fuNewFollowup()">+ متابعة جديدة</button></div>`;
  if(t.open.length > 3) html += `<input type="search" class="fu-search" id="fuTabSearch" maxlength="60" placeholder="🔍 ابحث باسم الطالب" value="${escapeHtml(s.q)}" oninput="fuTabSearch(this.value)">`;
  if(sections.length > 1){
    html += `<div class="fu-chips"><button type="button" class="fu-f${s.section ? '' : ' fu-on'}" onclick="fuTabSet('section', '')">كل الفصول</button>${
      sections.map(x => `<button type="button" class="fu-f${s.section === x.id ? ' fu-on' : ''}" onclick="fuTabSet('section', '${escapeHtml(x.id)}')"><bdi>${escapeHtml(fuShortSection(x.id) || 'شعبة')}</bdi> (${x.n})</button>`).join('')}</div>`;
  }
  html += `<div id="fuTabList">${fuTabListHtml()}</div>`;
  if(ACADEMIC_ON) html += `<div style="margin-top:6px;"><a href="#" style="font-size:12px;" onclick="event.preventDefault();showAcademicTracking()">الإحالات الأكاديمية (الشاشة السابقة) ←</a></div>`;
  box.innerHTML = html;
}

function fuTabSearch(value){
  fuTabState.q = String(value || '');
  const list = document.getElementById('fuTabList');
  if(list) list.innerHTML = fuTabListHtml();
}

function fuTabSet(key, value){
  if(!['section', 'more', 'closed'].includes(key)) return;
  fuTabState[key] = value;
  fuTabPaint();
}

/* «+ متابعة جديدة»: اختيار الطالب بالبحث (ضمن الفصل المختار إن وُجد) ثم نافذة فتح المتابعة المعتادة */
/* اختيار الطالب: الفصل أولًا (يظهر كل طلابه)، أو البحث بالاسم في كل الطلاب.
   لا قصّ صامت: إن زادت نتائج البحث عن الحد يُقال ذلك صراحةً. */
const FU_PICK_SEARCH_LIMIT = 40;
let fuPick = { q: '', section: '' };

function fuNewFollowup(){
  fuPick = { q: '', section: fuTabState.section || '' };
  showInfoModal(`<div class="fa-wrap">
    <h3 style="margin:0 0 8px;font-size:15px;color:var(--navy);">متابعة جديدة — اختر الطالب</h3>
    <input type="search" class="fu-search" id="fuPickSearch" maxlength="60" placeholder="🔍 ابحث باسم الطالب في كل الفصول" oninput="fuPickSearch(this.value)">
    <div id="fuPickBody"></div></div>`, '440px');
  fuPickPaint();
}

/* { rows, more }: البحث يشمل كل الطلاب النشطين (بحد معلَن)؛ وبلا بحث: كل طلاب الفصل المختار بلا حد */
function fuPickStudents(students, q, sectionId, limit){
  const query = fuNorm(q);
  if(!query && !sectionId) return { rows: [], more: 0 };
  const all = (students || [])
    .filter(st => st.is_active !== false && (query ? fuNorm(st.full_name).includes(query) : st.section_id === sectionId))
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ar'));
  if(!query) return { rows: all, more: 0 };
  const max = limit || FU_PICK_SEARCH_LIMIT;
  return { rows: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/* الفصول التي فيها طلاب نشطون، بعدد كل فصل، بترتيب الفصول نفسه */
function fuPickSections(sections, students){
  const n = new Map();
  (students || []).forEach(st => { if(st.is_active !== false && st.section_id) n.set(st.section_id, (n.get(st.section_id) || 0) + 1); });
  return (sections || []).filter(sec => n.has(sec.id)).map(sec => ({ id: sec.id, n: n.get(sec.id) }));
}

function fuPickSearch(value){
  fuPick.q = String(value || '');
  fuPickPaint();
}

function fuPickSection(id){
  fuPick.section = fuPick.section === id ? '' : id;
  fuPickPaint();
}

function fuPickPaint(){
  const body = document.getElementById('fuPickBody');
  if(!body) return;
  const searching = !!fuNorm(fuPick.q);
  let html = '';
  if(!searching){
    const secs = fuPickSections(crmSections, crmStudents);
    html += `<div class="crm-field-label">أو اختر الفصل</div><div class="fu-chips fu-wrap">${secs.map(x =>
      `<button type="button" class="fu-f${fuPick.section === x.id ? ' fu-on' : ''}" onclick="fuPickSection('${escapeHtml(x.id)}')"><bdi>${escapeHtml(fuShortSection(x.id) || 'شعبة')}</bdi> (${x.n})</button>`).join('')}</div>`;
  }
  const r = fuPickStudents(crmStudents, fuPick.q, searching ? '' : fuPick.section);
  if(!searching && !fuPick.section) html += '<div class="crm-today-empty">اختر فصلًا ليظهر كل طلابه، أو اكتب جزءًا من اسم الطالب.</div>';
  else if(!r.rows.length) html += '<div class="crm-today-empty">لا طالب بهذا الاسم.</div>';
  else {
    html += `<div class="fu-box fu-pick">${r.rows.map(st => `<button type="button" class="fu-pick-row" onclick="openCrmFollowupModal('${escapeHtml(st.id)}')">${escapeHtml(st.full_name)} <bdi class="fu-sec">${escapeHtml(fuShortSection(st.section_id))}</bdi></button>`).join('')}</div>`;
    if(r.more) html += `<div class="fu-pick-more">و${r.more} آخرون — اكتب جزءًا أطول من الاسم</div>`;
  }
  body.innerHTML = html;
}

/* سطر الاتفاق داخل نافذة المراجعة: مضغوط، برابط تعديل/بدء صغير بدل زر كبير */
function faReviewLineHtml(f){
  if(!f || f.status !== 'open' || f.group_id) return '';
  const line = faSummaryLine(f.agreement);
  const id = escapeHtml(f.id);
  return line
    ? `<div class="rv-ag"><span>🤝 ${escapeHtml(line)}</span><button type="button" class="rv-link" onclick="openFollowupAgreement('${id}')">تعديل</button></div>`
    : `<div class="rv-ag rv-ag-none"><span>لم يتم اتفاق مع الطالب بعد</span><button type="button" class="rv-link" onclick="openFollowupAgreement('${id}')">🤝 اتفاق الآن</button></div>`;
}

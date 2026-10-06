'use strict';
/* ============================================================
   (16) إدارة الصف — محرك الانتباه + المتابعات
   ------------------------------------------------------------
   الدفعة 4 من إعادة تصميم إدارة الصف.

   محرك الانتباه: لا جدول "تنبيهات" مخزّن — البطاقات تُحسب لحظيًا من البيانات
   الحالية (فلا تبقى تنبيهات قديمة عالقة)، ويُخزَّن "التجاهل" فقط. قواعده:
     عاجل:  مخالفة بلغت الإحالة بلا خطاب · إحالة أكاديمية بلا خطاب ·
            متابعة تجاوزت موعد مراجعتها بأكثر من 7 أيام
     مهم:   خطاب بلا توثيق تسليم منذ 3 أيام · متابعة حان موعد مراجعتها ·
            غياب 3 من آخر 8 حصص مرصودة (خلال 30 يومًا)
     للمراجعة: تأخر أو استئذان 3 من آخر 8 حصص
   آليات منع الضجيج (لو تجاهل المعلم أغلب البطاقات فالنظام فاشل):
   - بطاقة واحدة لكل طالب تجمع أسبابه بأعلى أولوية بينها.
   - متابعة مفتوحة لنفس السبب تُسكت قاعدته (التنبيه الوحيد: موعد مراجعتها).
   - "تجاهل" يُخفي البطاقة 14 يومًا ثم تُقيَّم من جديد. الالتزامات الرسمية
     (الخطابات) لا تُتجاهل — تختفي بتنفيذها فقط.
   - غياب جماعي (20% فأكثر من الشعبة بنفس الحصة) لا يُحتسب على أي طالب
     فيها: سببه غالبًا عام (رحلة، ظرف) لا فردي.
   - السبب يُكتب وقائع فقط ("غاب 3 من آخر 8 حصص: ...") — لا تفسير ولا حكم.
   - الشارة تعدّ العاجل والمهم فقط.

   المتابعة: سبب ← خط أساس يُجمَّد وقت الفتح ← إجراءات مؤرخة ← موعد مراجعة
   (14 يومًا افتراضيًا) ← نتيجة إلزامية عند الإغلاق، والبيانات قبل/بعد
   تُعرض بجانب حكم المعلم ("تغيّر بعد التدخل" لا "نجح التدخل" — لا مجموعة
   مقارنة). "لم يتحسّن" يتطلب قرارًا تاليًا عند الإغلاق نفسه.

   كل استعلام هنا مُقيَّد صراحة بـ.eq('teacher_id', currentUser.id).
   ============================================================ */

/* كل العتبات في مكان واحد — مراجعتها بعد شهر من الاستخدام الفعلي سطر واحد */
const ATTENTION_RULES = {
  window: 8,              /* آخر 8 حصص مرصودة لشعبة الطالب */
  windowDays: 30,         /* ...خلال 30 يومًا (مادة بحصتين أسبوعيًا لا تُبقي غيابًا قديمًا) */
  threshold: 3,           /* 3 من الثماني */
  groupAbsenceShare: 0.2, /* غياب جماعي: 20% فأكثر من الشعبة بنفس الحصة... */
  groupAbsenceMin: 3,     /* ...وبحد أدنى 3 غائبين (في شعبة صغيرة، غائب واحد قد يساوي 20%) */
  receiptDays: 3,         /* خطاب بلا توثيق تسليم بعد 3 أيام */
  overdueUrgentDays: 7,   /* متابعة متأخرة أكثر من 7 أيام = عاجل */
  dismissDays: 14,        /* التجاهل يُخفي 14 يومًا */
  reviewDays: 14,         /* موعد المراجعة الافتراضي */
  minLessonsForResult: 4  /* أقل من 4 حصص بعد الفتح = "لا بيانات كافية بعد" */
};

const PRIORITY_RANK = { urgent: 0, important: 1, review: 2 };
const FOLLOWUP_REASONS = {
  absence: 'غياب', lateness: 'تأخر', exits: 'استئذان متكرر', behavior: 'سلوك', grades: 'تحصيل', other: 'أخرى'
};
const FOLLOWUP_ACTIONS = {
  verbal_warning: 'تنبيه شفهي', individual_session: 'جلسة فردية', remedial_task: 'تكليف علاجي',
  reteach: 'إعادة شرح أو دعم', seat_change: 'تغيير مكان الجلوس', counselor: 'إشراك الموجه الطلابي',
  referral: 'إحالة رسمية', other: 'أخرى'
};
const FOLLOWUP_OUTCOMES = { improved: 'تحسّن', partial: 'تحسّن جزئي', not_improved: 'لم يتحسّن' };
const FOLLOWUP_NEXT_STEPS = { new_followup: 'متابعة جديدة', escalate: 'تصعيد (إحالة)', no_action: 'لا إجراء آخر' };
const ATTENDANCE_RULE_REASON = { absent: 'absence', late: 'lateness', permitted_exit: 'exits' };

/* ============================================================
   دوال صرفة
   ============================================================ */

function shortDateAr(iso){
  return CRM_WEEKDAY_NAMES[weekdayOfIso(iso)] + ' ' + Number(iso.slice(8, 10)) + '/' + Number(iso.slice(5, 7));
}

/* موعد المراجعة: بعد N يومًا، ولو وقع جمعة/سبت يُقدَّم للخميس — لا تصير
   متابعة "مستحقة" في يوم لا دوام فيه */
function defaultReviewDate(todayIso, days){
  let d = addDaysIso(todayIso, days == null ? ATTENTION_RULES.reviewDays : days);
  while(weekdayOfIso(d) === 5 || weekdayOfIso(d) === 6) d = addDaysIso(d, -1);
  return d;
}

/* إشارات حضور طالب: من آخر 8 حصص مرصودة لشعبته خلال 30 يومًا */
function attendanceSignals(sectionLessons, attendanceByLesson, studentId, sectionStudentCount, todayIso){
  const since = addDaysIso(todayIso, -ATTENTION_RULES.windowDays);
  const recent = (sectionLessons || [])
    .filter(l => l.lesson_date >= since && l.lesson_date <= todayIso)
    .sort((a, b) => b.lesson_date.localeCompare(a.lesson_date) || (b.period || 0) - (a.period || 0))
    .slice(0, ATTENTION_RULES.window);
  const out = { of: recent.length, absent: [], late: [], permitted_exit: [] };
  recent.forEach(l => {
    const rows = attendanceByLesson.get(l.id) || [];
    const mine = rows.find(r => r.student_id === studentId);
    if(!mine || !out[mine.status]) return;
    if(mine.status === 'absent'){
      const absentCount = rows.filter(r => r.status === 'absent').length;
      if(sectionStudentCount && absentCount >= ATTENTION_RULES.groupAbsenceMin &&
        absentCount / sectionStudentCount >= ATTENTION_RULES.groupAbsenceShare) return;
    }
    out[mine.status].push(l.lesson_date);
  });
  return out;
}

function isDismissed(dismissals, ruleKey, subjectKey, nowMs){
  return (dismissals || []).some(d => d.rule_key === ruleKey && d.subject_key === subjectKey &&
    nowMs - new Date(d.dismissed_at).getTime() < ATTENTION_RULES.dismissDays * 86400000);
}

/* البطاقات: واحدة لكل طالب، بأعلى أولوية بين أسبابه، مرتبة بالأولوية */
function computeAttentionItems(input){
  const { todayIso, students, sections, lessons, attendance, incidents, academicCases, followups, dismissals } = input;
  const nowMs = input.nowMs || Date.now();
  const byStudent = new Map();
  const studentMap = new Map((students || []).map(s => [s.id, s]));
  const add = (studentId, reason) => {
    /* المنقول خارج المدرسة: سجله محفوظ لكن لا تنبيهات عنه */
    if(!studentMap.has(studentId) || studentMap.get(studentId).is_active === false) return;
    if(!byStudent.has(studentId)) byStudent.set(studentId, []);
    byStudent.get(studentId).push(reason);
  };
  const ageDays = (ts) => Math.floor((nowMs - new Date(ts).getTime()) / 86400000);

  (incidents || []).forEach(i => {
    if(i.current_stage !== 'referred') return;
    if(!i.referral_letter_generated){
      add(i.student_id, { rule: 'referral_no_letter', priority: 'urgent', text: `بلغت الإحالة: ${i.typeName || 'مخالفة'} — لم يُصدَر خطاب التحويل`, action: { kind: 'crm_pending' } });
    } else if(!i.referral_receipt_photo_url && ageDays(i.created_at) >= ATTENTION_RULES.receiptDays){
      add(i.student_id, { rule: 'letter_no_receipt', priority: 'important', text: `خطاب تحويل (${i.typeName || 'مخالفة'}) بلا توثيق تسليم`, action: { kind: 'crm_undocumented' } });
    }
  });
  (academicCases || []).forEach(c => {
    if(c.status !== 'referred') return;
    if(!c.referral_letter_generated){
      add(c.student_id, { rule: 'academic_no_letter', priority: 'urgent', text: `إحالة أكاديمية (${c.subject || ''}) بلا خطاب`, action: { kind: 'ac_pending' } });
    } else if(!c.referral_receipt_photo_url && ageDays(c.created_at) >= ATTENTION_RULES.receiptDays){
      add(c.student_id, { rule: 'academic_no_receipt', priority: 'important', text: `خطاب إحالة أكاديمية بلا توثيق تسليم`, action: { kind: 'ac_undocumented' } });
    }
  });

  const openReasons = new Map(); /* studentId → Set(reason_type) */
  (followups || []).forEach(f => {
    if(f.status !== 'open') return;
    if(!openReasons.has(f.student_id)) openReasons.set(f.student_id, new Set());
    openReasons.get(f.student_id).add(f.reason_type);
    if(f.review_date <= todayIso){
      const late = daysBetweenIso(f.review_date, todayIso);
      add(f.student_id, {
        rule: 'followup_due', priority: late > ATTENTION_RULES.overdueUrgentDays ? 'urgent' : 'important',
        text: `متابعة "${f.reason_text}": ${late === 0 ? 'موعد مراجعتها اليوم' : 'موعد مراجعتها كان ' + shortDateAr(f.review_date)}`,
        action: { kind: 'review', followupId: f.id }
      });
    }
  });

  /* قواعد الحضور */
  const lessonsBySection = new Map();
  (lessons || []).forEach(l => {
    if(!lessonsBySection.has(l.section_id)) lessonsBySection.set(l.section_id, []);
    lessonsBySection.get(l.section_id).push(l);
  });
  const attendanceByLesson = new Map();
  (attendance || []).forEach(a => {
    if(!attendanceByLesson.has(a.lesson_id)) attendanceByLesson.set(a.lesson_id, []);
    attendanceByLesson.get(a.lesson_id).push(a);
  });
  const sectionCounts = new Map();
  (students || []).forEach(s => { if(s.section_id && s.is_active !== false) sectionCounts.set(s.section_id, (sectionCounts.get(s.section_id) || 0) + 1); });
  const sectionIds = new Set((sections || []).map(s => s.id));
  const ruleMeta = {
    absent: { rule: 'absence', priority: 'important', verb: 'غاب' },
    late: { rule: 'lateness', priority: 'review', verb: 'تأخر' },
    permitted_exit: { rule: 'exits', priority: 'review', verb: 'استأذن للخروج' }
  };
  (students || []).forEach(s => {
    if(!s.section_id || s.is_active === false || !sectionIds.has(s.section_id)) return;
    const sig = attendanceSignals(lessonsBySection.get(s.section_id), attendanceByLesson, s.id, sectionCounts.get(s.section_id), todayIso);
    Object.keys(ruleMeta).forEach(status => {
      const dates = sig[status];
      if(dates.length < ATTENTION_RULES.threshold) return;
      const meta = ruleMeta[status];
      const reasonType = ATTENDANCE_RULE_REASON[status];
      if(openReasons.has(s.id) && openReasons.get(s.id).has(reasonType)) return;
      if(isDismissed(dismissals, meta.rule, s.id, nowMs)) return;
      add(s.id, {
        rule: meta.rule, priority: meta.priority, dismissable: true,
        text: `${meta.verb} ${dates.length} من آخر ${sig.of} حصص: ${dates.slice().sort().map(shortDateAr).join('، ')}`,
        action: { kind: 'open_followup', reasonType },
        baseline: { count: dates.length, of: sig.of, dates: dates.slice().sort() }
      });
    });
  });

  const cards = [];
  byStudent.forEach((reasons, studentId) => {
    reasons.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    cards.push({ studentId, priority: reasons[0].priority, reasons });
  });
  const nameOf = id => (studentMap.get(id) || {}).full_name || '';
  return cards.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || nameOf(a.studentId).localeCompare(nameOf(b.studentId), 'ar'));
}

/* علامات ورقة الرصد: ما يحتاجه الطالب منك "داخل الفصل" فقط — الغياب/التأخر/
   الاستئذان المتكرر والمتابعات. الخطابات والتوثيق أعمال مكتبية فلا علامة لها
   هنا (تبقى في "يحتاج انتباهي" العامة). متابعة مفتوحة لم يحن موعدها = علامة
   رمادية للتذكير فقط. يُرجع Map(studentId → { priority, reasons }). */
const SHEET_MARK_RULES = new Set(['absence', 'lateness', 'exits', 'followup_due']);
const SHEET_MARK_RANK = { urgent: 0, important: 1, review: 2, info: 3 };

function sheetMarkersFor(cache, studentIds, todayIso){
  const out = new Map();
  if(!cache) return out;
  const wanted = new Set(studentIds || []);
  const add = (id, reason) => {
    if(!wanted.has(id)) return;
    if(!out.has(id)) out.set(id, { priority: reason.priority, reasons: [] });
    const m = out.get(id);
    m.reasons.push(reason);
    if(SHEET_MARK_RANK[reason.priority] < SHEET_MARK_RANK[m.priority]) m.priority = reason.priority;
  };
  (cache.cards || []).forEach(card => {
    card.reasons.forEach(r => { if(SHEET_MARK_RULES.has(r.rule)) add(card.studentId, r); });
  });
  ((cache.data && cache.data.followups) || []).forEach(f => {
    if(f.status !== 'open' || f.review_date <= todayIso) return; /* المستحقة جاءت أعلاه من البطاقات */
    add(f.student_id, {
      rule: 'followup_open', priority: 'info',
      text: `متابعة مفتوحة: ${f.reason_text} — المراجعة ${shortDateAr(f.review_date)}`,
      action: { kind: 'review', followupId: f.id }
    });
  });
  out.forEach(m => m.reasons.sort((a, b) => SHEET_MARK_RANK[a.priority] - SHEET_MARK_RANK[b.priority]));
  return out;
}

function attentionBadgeCount(cards){
  return (cards || []).filter(c => c.priority === 'urgent' || c.priority === 'important').length;
}

function attentionUrgentCount(cards){
  return (cards || []).filter(c => c.priority === 'urgent').length;
}

/* نتيجة المتابعة من البيانات: نفس مؤشر خط الأساس لكن من حصص ما بعد الفتح.
   أقل من 4 حصص = لا بيانات كافية (لا نخترع نتيجة). */
function computeFollowupResult(followup, sectionLessons, attendanceRows, incidentsAfter){
  const openedIso = followup.created_at ? localIsoDate(new Date(followup.created_at)) : '';
  const status = { absence: 'absent', lateness: 'late', exits: 'permitted_exit' }[followup.reason_type];
  if(status){
    const after = (sectionLessons || []).filter(l => l.lesson_date > openedIso);
    if(after.length < ATTENTION_RULES.minLessonsForResult) return { sufficient: false, of: after.length };
    const ids = new Set(after.map(l => l.id));
    const count = (attendanceRows || []).filter(a => ids.has(a.lesson_id) && a.student_id === followup.student_id && a.status === status).length;
    return { sufficient: true, count, of: after.length };
  }
  if(followup.reason_type === 'behavior'){
    const typeId = followup.baseline && followup.baseline.incident_type_id;
    const recurred = (incidentsAfter || []).filter(i => i.incident_date > openedIso && (!typeId || i.incident_type_id === typeId));
    return { sufficient: true, recurred: recurred.length };
  }
  return { sufficient: false };
}

/* اقتراح نتيجة (المعلم يقرر دائمًا) */
function suggestFollowupOutcome(followup, result){
  if(!result || !result.sufficient) return null;
  if(followup.reason_type === 'behavior') return result.recurred ? 'not_improved' : 'improved';
  const base = followup.baseline || {};
  const beforeRate = base.of ? base.count / base.of : null;
  const afterRate = result.of ? result.count / result.of : 0;
  if(result.count <= 1) return 'improved';
  if(beforeRate !== null && afterRate < beforeRate) return 'partial';
  return 'not_improved';
}

/* ============================================================
   تحميل البيانات وحساب البطاقات
   ============================================================ */
let crmAttentionCache = null; /* { cards, data, at } */
let crmAttentionLoading = null;
let crmAttentionLoadingGen = -1;
let crmAttentionGen = 0; /* يزيد مع كل تعديل يمسّ البطاقات */

async function loadAttentionData(){
  const uid = currentUser.id;
  const todayIso = localIsoDate();
  const since = addDaysIso(todayIso, -ATTENTION_RULES.windowDays);
  const { ok, results } = await runQueriesWithRetry([
    () => sb.from('classroom_students').select('id, full_name, section_id, is_active').eq('teacher_id', uid),
    () => sb.from('classroom_sections').select('id').eq('teacher_id', uid),
    () => sb.from('classroom_lessons').select('id, section_id, lesson_date, period').eq('teacher_id', uid).gte('lesson_date', since),
    () => sb.from('classroom_incidents').select('id, student_id, incident_type_id, current_stage, referral_letter_generated, referral_receipt_photo_url, created_at').eq('teacher_id', uid).eq('current_stage', 'referred'),
    () => sb.from('academic_cases').select('id, student_id, subject, status, referral_letter_generated, referral_receipt_photo_url, created_at').eq('teacher_id', uid).eq('status', 'referred'),
    () => sb.from('classroom_followups').select('id, student_id, section_id, reason_type, reason_text, review_date, status, baseline, created_at').eq('teacher_id', uid).eq('status', 'open'),
    () => sb.from('classroom_attention_dismissals').select('rule_key, subject_key, dismissed_at').eq('teacher_id', uid)
  ]);
  if(!ok) return null;
  const [students, sections, lessons, incidents, academicCases, followups, dismissals] = results.map(r => r.data || []);
  let attendance = [];
  const lessonIds = lessons.map(l => l.id);
  for(const ids of chunkArray(lessonIds, 100)){
    const { data, error } = await sb.from('classroom_attendance').select('lesson_id, student_id, status')
      .eq('teacher_id', uid).in('lesson_id', ids);
    if(error) return null;
    attendance = attendance.concat(data || []);
  }
  if(!crmIncidentTypes.length && typeof loadCrmIncidentTypes === 'function') await loadCrmIncidentTypes();
  incidents.forEach(i => {
    const t = crmIncidentTypes.find(x => x.id === i.incident_type_id);
    i.typeName = t ? t.problem_name : 'مخالفة';
  });
  return { todayIso, students, sections, lessons, attendance, incidents, academicCases, followups, dismissals };
}

/* يحسب البطاقات ويحدّث الشارة. null عند الفشل — المستدعي لا يعرض "لا شيء ✓"
   كاذبة بناءً على فحص فاشل */
async function refreshAttention(){
  if(!currentUser) return null;
  if(typeof STANDALONE_ROLES !== 'undefined' && STANDALONE_ROLES.includes(dutyType)) return null;
  /* تحميل جارٍ بدأ قبل آخر تعديل قد يقرأ بيانات ما قبل التعديل — لا نعيد
     استخدامه، بل نبدأ تحميلًا جديدًا، ولا يكتب القديم فوق الأحدث */
  if(crmAttentionLoading && crmAttentionLoadingGen === crmAttentionGen) return crmAttentionLoading;
  const userAtStart = currentUser.id;
  const gen = crmAttentionGen;
  const promise = (async () => {
    try{
      const data = await loadAttentionData();
      if(!currentUser || currentUser.id !== userAtStart) return null;
      if(gen !== crmAttentionGen) return refreshAttention(); /* عُدّلت البيانات أثناء التحميل — نتيجة أحدث */
      if(!data) return null;
      const cards = computeAttentionItems(data);
      crmAttentionCache = { cards, data, at: Date.now() };
      renderAttentionBadge(cards);
      return crmAttentionCache;
    } catch(e){ return null; }
    finally { if(crmAttentionLoading === promise) crmAttentionLoading = null; }
  })();
  crmAttentionLoading = promise;
  crmAttentionLoadingGen = gen;
  return promise;
}

/* نسخة حديثة (≤30 ثانية) تكفي للعرض؛ أي تعديل يمسّ البطاقات يُبطلها أولًا
   (invalidateAttention) فلا تُعرض بطاقة قديمة بعد رصد حصة أو تسجيل موقف */
async function getAttentionFresh(){
  if(crmAttentionCache && Date.now() - crmAttentionCache.at < 30000) return crmAttentionCache;
  return refreshAttention();
}

function invalidateAttention(){
  crmAttentionCache = null;
  crmAttentionGen++;
}

function renderAttentionBadge(cards){
  const badge = document.getElementById('classroomNavBadge');
  if(!badge) return;
  const n = attentionBadgeCount(cards);
  badge.style.display = n ? 'block' : 'none';
  badge.textContent = n > 9 ? '9+' : String(n);
}

/* ============================================================
   عرض البطاقات
   ============================================================ */
function attentionStudentName(id){
  const data = crmAttentionCache && crmAttentionCache.data;
  const s = (data && data.students.find(x => x.id === id)) || crmStudents.find(x => x.id === id);
  return s ? s.full_name : 'طالب';
}

function attentionCardHtml(card){
  const dot = { urgent: '🔴', important: '🟠', review: '🔵' }[card.priority];
  const s = (crmAttentionCache && crmAttentionCache.data.students.find(x => x.id === card.studentId)) || {};
  const secLabel = s.section_id && crmSectionById(s.section_id) ? ' · ' + escapeHtml(crmSectionLabel(s.section_id)) : '';
  const reasons = card.reasons.map((r, i) => `
    <div class="crm-att-reason">
      <div>${escapeHtml(r.text)}</div>
      <div class="crm-att-reason-actions">
        <button class="btn btn-outline crm-mini-btn" onclick="runAttentionAction('${card.studentId}', ${i})">${attentionActionLabel(r.action)}</button>
        ${r.dismissable ? `<a href="#" class="crm-dismiss-link" onclick="event.preventDefault();dismissAttention('${r.rule}','${card.studentId}')">تجاهل 14 يومًا</a>` : ''}
      </div>
    </div>`).join('');
  return `<div class="crm-attention-card prio-${card.priority}">
    <div class="crm-attention-head">${dot} <a href="#" onclick="event.preventDefault();openCrmStudentProfile('${card.studentId}', { type: 'tab', tab: crmActiveTab() })">${escapeHtml(attentionStudentName(card.studentId))}</a><span style="color:var(--muted);font-weight:400;">${secLabel}</span></div>
    ${reasons}
  </div>`;
}

function attentionActionLabel(action){
  return { crm_pending: 'إعداد خطاب التحويل', crm_undocumented: 'توثيق التسليم', ac_pending: 'إعداد الخطاب', ac_undocumented: 'توثيق التسليم',
    review: 'سجّل النتيجة', open_followup: 'فتح متابعة' }[action.kind] || 'فتح';
}

function crmActiveTab(){
  for(const [tab, [, pane]] of Object.entries(CRM_TAB_PANES)){
    const el = document.getElementById(pane);
    if(el && el.style.display !== 'none') return tab;
  }
  return 'today';
}

function findAttentionReason(studentId, index){
  const card = crmAttentionCache && crmAttentionCache.cards.find(c => c.studentId === studentId);
  return card ? card.reasons[index] : null;
}

function runAttentionAction(studentId, index){
  const r = findAttentionReason(studentId, index);
  if(!r) return;
  const a = r.action;
  if(a.kind === 'crm_pending' || a.kind === 'crm_undocumented'){
    switchCrmTab('record');
    jumpToCrmFilter(a.kind === 'crm_pending' ? 'pending' : 'undocumented');
  } else if(a.kind === 'ac_pending' || a.kind === 'ac_undocumented'){
    showAcademicTracking();
    setTimeout(() => jumpToAcFilter(a.kind === 'ac_pending' ? 'pending' : 'undocumented'), 250);
  } else if(a.kind === 'review'){
    openCrmReviewModal(a.followupId);
  } else if(a.kind === 'open_followup'){
    openCrmFollowupModal(studentId, { reasonType: a.reasonType, reasonText: r.text, baseline: r.baseline });
  }
}

let crmDismissing = false;
async function dismissAttention(ruleKey, studentId){
  if(crmDismissing) return;
  crmDismissing = true;
  const { error } = await sb.from('classroom_attention_dismissals').upsert(
    { teacher_id: currentUser.id, rule_key: ruleKey, subject_key: studentId, dismissed_at: new Date().toISOString() },
    { onConflict: 'teacher_id,rule_key,subject_key' });
  crmDismissing = false;
  if(error){ showToast('تعذّر التجاهل: ' + error.message, 'error'); return; }
  showToast('أُخفيت 14 يومًا', 'ok');
  await refreshAttentionViews();
}

/* يحدّث كل ما يعرض الانتباه (شارة + تبويب اليوم + تبويب المتابعات) */
async function refreshAttentionViews(){
  const cache = await refreshAttention();
  if(document.getElementById('classroomView').style.display === 'none') return;
  /* ورقة رصد مفتوحة: تتحدّث علاماتها فورًا (فتح متابعة من داخلها يحوّل علامة
     الغياب البرتقالية إلى رمادية) دون فقد ما رُصد ولم يُحفظ */
  if(typeof crmSheet !== 'undefined' && crmSheet && document.getElementById('crmLessonSheet').style.display !== 'none'){
    const students = crmStudentsOfSection(crmSheet.sectionId);
    crmSheet.markers = sheetMarkersFor(cache, students.map(st => st.id), localIsoDate());
    crmSheet.markersLoaded = !!cache;
    renderCrmLessonSheet(students, false);
    return;
  }
  const tab = crmActiveTab();
  if(tab === 'today') renderCrmToday();
  if(tab === 'followups') renderCrmFollowups();
}

/* جزء "يحتاج انتباهي" داخل تبويب اليوم (أعلى 5) — يُستدعى من renderCrmToday */
function attentionTodaySectionHtml(cache){
  if(!cache) return '<div class="crm-today-card"><div class="crm-today-title">يحتاج انتباهي</div><div class="crm-today-empty">تعذّر الفحص الآن. <a href="#" onclick="event.preventDefault();refreshAttentionViews()">إعادة المحاولة</a></div></div>';
  const cards = cache.cards;
  if(!cards.length) return '<div class="crm-today-card"><div class="crm-today-title">يحتاج انتباهي</div><div class="crm-today-empty">لا شيء يستدعي انتباهك الآن ✓</div></div>';
  const more = cards.length > 5 ? `<a href="#" style="font-size:12px;" onclick="event.preventDefault();switchCrmTab('followups')">عرض الكل (${cards.length})</a>` : '';
  return `<div class="crm-today-card"><div class="crm-today-title">يحتاج انتباهي (${cards.length})</div>
    ${cards.slice(0, 5).map(attentionCardHtml).join('')}${more}</div>`;
}

/* ============================================================
   تبويب "المتابعات"
   ============================================================ */
let crmFollowupsToken = 0;

async function renderCrmFollowups(){
  const box = document.getElementById('crmFollowupsBody');
  if(!box) return;
  const token = ++crmFollowupsToken;
  box.innerHTML = '<div class="loading-state">جارٍ التحميل...</div>';
  const [cache, openRes, closedRes] = await Promise.all([
    getAttentionFresh(),
    sb.from('classroom_followups').select('id, student_id, reason_type, reason_text, review_date, created_at').eq('teacher_id', currentUser.id).eq('status', 'open').order('review_date', { ascending: true }),
    sb.from('classroom_followups').select('id, student_id, reason_text, outcome, next_step, closed_at').eq('teacher_id', currentUser.id).eq('status', 'closed').order('closed_at', { ascending: false }).limit(20)
  ]);
  if(token !== crmFollowupsToken) return;
  const todayIso = localIsoDate();
  let html = '';

  html += '<div class="crm-today-card"><div class="crm-today-title">يحتاج انتباهي' + (cache ? ` (${cache.cards.length})` : '') + '</div>';
  if(!cache) html += '<div class="crm-today-empty">تعذّر الفحص الآن. <a href="#" onclick="event.preventDefault();renderCrmFollowups()">إعادة المحاولة</a></div>';
  else if(!cache.cards.length) html += '<div class="crm-today-empty">لا شيء يستدعي انتباهك الآن ✓ — تظهر هنا البطاقات عند غياب أو تأخر متكرر، أو خطاب معلّق، أو متابعة حان موعدها.</div>';
  else html += cache.cards.map(attentionCardHtml).join('');
  html += '</div>';

  html += '<div class="crm-today-card"><div class="crm-today-title">متابعات مفتوحة</div>';
  if(openRes.error) html += '<div class="crm-today-empty">تعذّر التحميل.</div>';
  else if(!(openRes.data || []).length) html += '<div class="crm-today-empty">لا متابعات مفتوحة. افتحها من بطاقة انتباه أو من ملف الطالب.</div>';
  else html += openRes.data.map(f => {
    const due = f.review_date <= todayIso;
    const st = cache && cache.data.students.find(x => x.id === f.student_id);
    const gone = st && st.is_active === false ? ' <span style="font-size:11px;color:var(--muted);">(نُقل خارج المدرسة)</span>' : '';
    return `<div class="crm-lesson-row">
      <span><a href="#" onclick="event.preventDefault();openCrmStudentProfile('${f.student_id}', { type: 'tab', tab: 'followups' })">${escapeHtml(attentionStudentName(f.student_id))}</a>${gone} · ${escapeHtml(f.reason_text)}
        <span style="font-size:11px;color:${due ? '#8A2C2C' : 'var(--muted)'};"> — المراجعة ${shortDateAr(f.review_date)}</span></span>
      <button class="btn ${due ? 'btn-primary' : 'btn-outline'} crm-mini-btn" onclick="openCrmReviewModal('${f.id}')">مراجعة</button>
    </div>`;
  }).join('');
  html += '</div>';

  html += '<div class="crm-today-card"><div class="crm-today-title">مغلقة (آخر 20)</div>';
  if(!(closedRes.data || []).length) html += '<div class="crm-today-empty">لا متابعات مغلقة بعد.</div>';
  else html += closedRes.data.map(f => `<div class="crm-lesson-row">
      <span>${escapeHtml(attentionStudentName(f.student_id))} · ${escapeHtml(f.reason_text)}</span>
      <span class="crm-tl-meta">${FOLLOWUP_OUTCOMES[f.outcome] || ''}${f.next_step ? ' ← ' + FOLLOWUP_NEXT_STEPS[f.next_step] : ''}</span>
    </div>`).join('');
  html += '</div>';

  html += `<div style="margin-top:6px;"><a href="#" style="font-size:12px;" onclick="event.preventDefault();showAcademicTracking()">الإحالات الأكاديمية (الشاشة السابقة) ←</a></div>`;
  box.innerHTML = html;
}

/* ============================================================
   نافذة فتح متابعة
   ============================================================ */
let crmFollowupDraft = null;

async function computeOpeningBaseline(studentId, reasonType){
  const status = { absence: 'absent', lateness: 'late', exits: 'permitted_exit' }[reasonType];
  if(!status) return null;
  const data = (crmAttentionCache && crmAttentionCache.data) || await loadAttentionData();
  if(!data) return null;
  const s = data.students.find(x => x.id === studentId);
  if(!s || !s.section_id) return null;
  const lessons = data.lessons.filter(l => l.section_id === s.section_id);
  const byLesson = new Map();
  data.attendance.forEach(a => { if(!byLesson.has(a.lesson_id)) byLesson.set(a.lesson_id, []); byLesson.get(a.lesson_id).push(a); });
  const count = data.students.filter(x => x.section_id === s.section_id && x.is_active !== false).length;
  const sig = attendanceSignals(lessons, byLesson, studentId, count, localIsoDate());
  return { count: sig[status].length, of: sig.of, dates: sig[status].slice().sort() };
}

function openCrmFollowupModal(studentId, prefill){
  const p = prefill || {};
  const name = attentionStudentName(studentId);
  const reasonType = p.reasonType || 'other';
  crmFollowupDraft = { studentId, baseline: p.baseline || null, prefillReason: reasonType, saving: false };
  const reasonOptions = Object.keys(FOLLOWUP_REASONS).map(k => `<option value="${k}"${k === reasonType ? ' selected' : ''}>${FOLLOWUP_REASONS[k]}</option>`).join('');
  const actionOptions = Object.keys(FOLLOWUP_ACTIONS).map(k => `<option value="${k}">${FOLLOWUP_ACTIONS[k]}</option>`).join('');
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">فتح متابعة</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(name)}</div>
      <label class="crm-field-label">السبب</label>
      <select class="goal-input" id="crmFuReason" style="margin-bottom:6px;">${reasonOptions}</select>
      <input class="goal-input" id="crmFuText" maxlength="500" value="${escapeHtml(p.reasonText || '')}" placeholder="الوقائع باختصار (مثال: غاب 3 من آخر 8 حصص)" style="margin-bottom:8px;">
      <label class="crm-field-label">الإجراء الأول</label>
      <select class="goal-input" id="crmFuAction" style="margin-bottom:6px;">${actionOptions}</select>
      <input class="goal-input" id="crmFuNote" maxlength="500" placeholder="ملاحظة على الإجراء (اختياري)" style="margin-bottom:8px;">
      <label class="crm-field-label">موعد المراجعة</label>
      <input type="date" class="goal-input" id="crmFuReview" value="${defaultReviewDate(localIsoDate())}" min="${localIsoDate()}" style="margin-bottom:10px;">
      <button class="btn btn-primary" id="crmFuSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmFollowup()">فتح المتابعة</button>
    </div>`, '440px');
}

async function saveCrmFollowup(){
  const d = crmFollowupDraft;
  if(!d || d.saving) return;
  const reasonType = document.getElementById('crmFuReason').value;
  const reasonText = document.getElementById('crmFuText').value.trim() || FOLLOWUP_REASONS[reasonType];
  const actionType = document.getElementById('crmFuAction').value;
  const note = document.getElementById('crmFuNote').value.trim();
  const reviewDate = document.getElementById('crmFuReview').value;
  if(!reviewDate || reviewDate < localIsoDate()){ showToast('موعد المراجعة لا يكون تاريخًا مضى', 'error'); return; }
  const btn = document.getElementById('crmFuSaveBtn');
  d.saving = true;
  btn.disabled = true;
  try{
    /* خط الأساس يُجمَّد الآن: القيمة التي تُقارن بها النتيجة لاحقًا */
    let baseline = (d.baseline && reasonType === d.prefillReason) ? d.baseline : null;
    if(!baseline){
      baseline = reasonType === 'behavior'
        ? await behaviorBaseline(d.studentId)
        : await computeOpeningBaseline(d.studentId, reasonType);
    }
    const student = (crmAttentionCache && crmAttentionCache.data.students.find(x => x.id === d.studentId)) || crmStudents.find(x => x.id === d.studentId) || {};
    const { data: fu, error } = await sb.from('classroom_followups').insert({
      teacher_id: currentUser.id, student_id: d.studentId, section_id: student.section_id || null,
      reason_type: reasonType, reason_text: reasonText, baseline: baseline || null, review_date: reviewDate
    }).select('id').single();
    if(error) throw error;
    const { error: aErr } = await sb.from('classroom_followup_actions').insert({
      followup_id: fu.id, teacher_id: currentUser.id, action_type: actionType, note: note || null, action_date: localIsoDate()
    });
    closeFollowupModal();
    showToast(aErr ? 'فُتحت المتابعة، لكن تعذّر حفظ الإجراء — أضفه من "مراجعة"' : 'فُتحت المتابعة ✓', aErr ? 'error' : 'ok');
    await refreshAttentionViews();
    if(crmProfile && crmProfile.studentId === d.studentId) renderCrmStudentProfile();
  } catch(e){
    showToast('تعذّر فتح المتابعة: ' + (e.message || ''), 'error');
    d.saving = false;
    btn.disabled = false;
  }
}

/* سلوك: خط الأساس = آخر نوع مخالفة للطالب وعدد مواقفه بهذا الفصل */
async function behaviorBaseline(studentId){
  const { data, error } = await sb.from('classroom_incidents').select('incident_type_id, incident_date')
    .eq('teacher_id', currentUser.id).eq('student_id', studentId).order('incident_date', { ascending: false });
  if(error || !data || !data.length) return { incidents: 0 };
  return { incidents: data.length, incident_type_id: data[0].incident_type_id, last_date: data[0].incident_date };
}

function closeFollowupModal(){
  crmFollowupDraft = null;
  crmReview = null;
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if(cancelBtn) cancelBtn.click();
}

/* ============================================================
   نافذة المراجعة والإغلاق
   ============================================================ */
let crmReview = null;

async function openCrmReviewModal(followupId){
  const uid = currentUser.id;
  const { data: f, error } = await sb.from('classroom_followups').select('*').eq('teacher_id', uid).eq('id', followupId).maybeSingle();
  if(error || !f){ showToast('تعذّر تحميل المتابعة', 'error'); return; }
  const { data: actions } = await sb.from('classroom_followup_actions').select('action_type, note, action_date')
    .eq('teacher_id', uid).eq('followup_id', followupId).order('action_date', { ascending: true });

  let result = { sufficient: false };
  try{
    if(['absence', 'lateness', 'exits'].includes(f.reason_type) && f.section_id){
      const openedIso = localIsoDate(new Date(f.created_at));
      const { data: lessons } = await sb.from('classroom_lessons').select('id, lesson_date').eq('teacher_id', uid).eq('section_id', f.section_id).gt('lesson_date', openedIso);
      let att = [];
      for(const ids of chunkArray((lessons || []).map(l => l.id), 100)){
        const { data } = await sb.from('classroom_attendance').select('lesson_id, student_id, status').eq('teacher_id', uid).eq('student_id', f.student_id).in('lesson_id', ids);
        att = att.concat(data || []);
      }
      result = computeFollowupResult(f, lessons || [], att, []);
    } else if(f.reason_type === 'behavior'){
      const { data: inc } = await sb.from('classroom_incidents').select('incident_type_id, incident_date').eq('teacher_id', uid).eq('student_id', f.student_id);
      result = computeFollowupResult(f, [], [], inc || []);
    }
  } catch(e){ result = { sufficient: false }; }

  const suggested = suggestFollowupOutcome(f, result);
  crmReview = { followup: f, result, saving: false };
  const base = f.baseline || {};
  let beforeAfter = '';
  if(['absence', 'lateness', 'exits'].includes(f.reason_type)){
    const verb = { absence: 'غاب', lateness: 'تأخر', exits: 'استأذن' }[f.reason_type];
    beforeAfter = `<div class="crm-ba-row"><span>قبل (وقت الفتح)</span><b>${base.of ? `${verb} ${base.count} من ${base.of} حصص` : '—'}</b></div>
      <div class="crm-ba-row"><span>بعد الفتح</span><b>${result.sufficient ? `${verb} ${result.count} من ${result.of} حصص` : `لا بيانات كافية بعد (${result.of || 0} من ${ATTENTION_RULES.minLessonsForResult} حصص مرصودة على الأقل)`}</b></div>`;
  } else if(f.reason_type === 'behavior'){
    beforeAfter = `<div class="crm-ba-row"><span>بعد الفتح</span><b>${result.recurred ? `تكررت المخالفة ${result.recurred} مرة` : 'لم تتكرر المخالفة'}</b></div>`;
  } else {
    beforeAfter = '<div class="crm-ba-row"><span>القياس</span><b>بحكمك (لا مؤشر رقمي لهذا السبب)</b></div>';
  }
  const actionsHtml = (actions || []).map(a => `<div class="crm-tl-row"><span>${FOLLOWUP_ACTIONS[a.action_type] || ''}${a.note ? ' — ' + escapeHtml(a.note) : ''}</span><span class="crm-tl-meta">${a.action_date}</span></div>`).join('') || '<div class="crm-today-empty">لا إجراءات مسجلة.</div>';
  const outcomeBtns = Object.keys(FOLLOWUP_OUTCOMES).map(k => `<button class="btn ${k === suggested ? 'btn-primary' : 'btn-outline'} crm-mini-btn" style="flex:1;" onclick="closeCrmFollowup('${k}')">${FOLLOWUP_OUTCOMES[k]}${k === suggested ? ' (مقترحة)' : ''}</button>`).join('');
  const actionOptions = Object.keys(FOLLOWUP_ACTIONS).map(k => `<option value="${k}">${FOLLOWUP_ACTIONS[k]}</option>`).join('');
  const nextOptions = Object.keys(FOLLOWUP_NEXT_STEPS).map(k => `<option value="${k}">${FOLLOWUP_NEXT_STEPS[k]}</option>`).join('');

  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">مراجعة متابعة</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">${escapeHtml(attentionStudentName(f.student_id))} · ${escapeHtml(f.reason_text)} · فُتحت ${localIsoDate(new Date(f.created_at))}</div>
      <div class="crm-ba-box">${beforeAfter}
        <div style="font-size:10.5px;color:var(--muted);margin-top:4px;">الأرقام تُظهر ما تغيّر بعد التدخل، لا أنه سبب التغيّر.</div></div>
      <div class="crm-field-label" style="margin-top:8px;">الإجراءات</div>
      ${actionsHtml}
      <div class="crm-field-label" style="margin-top:10px;">النتيجة</div>
      <div style="display:flex;gap:6px;margin-bottom:6px;">${outcomeBtns}</div>
      <div id="crmNextStepBox" style="display:none;margin-bottom:8px;">
        <label class="crm-field-label">لم يتحسّن — ما القرار التالي؟</label>
        <select class="goal-input" id="crmNextStep" style="margin-bottom:6px;">${nextOptions}</select>
        <button class="btn btn-primary crm-mini-btn" style="width:100%;justify-content:center;" onclick="closeCrmFollowup('not_improved', true)">إغلاق بهذا القرار</button>
      </div>
      <details style="margin-top:8px;"><summary style="font-size:12px;cursor:pointer;">إضافة إجراء أو تمديد الموعد</summary>
        <select class="goal-input" id="crmRvAction" style="margin:8px 0 6px;">${actionOptions}</select>
        <input class="goal-input" id="crmRvNote" maxlength="500" placeholder="ملاحظة (اختياري)" style="margin-bottom:6px;">
        <label class="crm-field-label">موعد المراجعة الجديد</label>
        <input type="date" class="goal-input" id="crmRvDate" value="${defaultReviewDate(localIsoDate())}" min="${localIsoDate()}" style="margin-bottom:6px;">
        <button class="btn btn-outline crm-mini-btn" style="width:100%;justify-content:center;" onclick="extendCrmFollowup()">حفظ الإجراء والتمديد</button>
      </details>
    </div>`, '460px');
}

async function closeCrmFollowup(outcome, confirmedNext){
  const rv = crmReview;
  if(!rv || rv.saving) return;
  if(outcome === 'not_improved' && !confirmedNext){
    document.getElementById('crmNextStepBox').style.display = 'block';
    return;
  }
  const nextStep = outcome === 'not_improved' ? document.getElementById('crmNextStep').value : null;
  rv.saving = true;
  const f = rv.followup;
  const { error } = await sb.from('classroom_followups').update({
    status: 'closed', outcome, next_step: nextStep, result: rv.result || null, closed_at: new Date().toISOString()
  }).eq('teacher_id', currentUser.id).eq('id', f.id).eq('status', 'open');
  if(error){ showToast('تعذّر الإغلاق: ' + error.message, 'error'); rv.saving = false; return; }
  closeFollowupModal();
  showToast('أُغلقت المتابعة: ' + FOLLOWUP_OUTCOMES[outcome], 'ok');
  await refreshAttentionViews();
  if(crmProfile && crmProfile.studentId === f.student_id) renderCrmStudentProfile();
  if(nextStep === 'new_followup'){
    openCrmFollowupModal(f.student_id, { reasonType: f.reason_type, reasonText: f.reason_text });
  } else if(nextStep === 'escalate'){
    showToast('للتصعيد: سجّل موقفًا رسميًا أو إحالة من ملف الطالب', 'ok');
  }
}

async function extendCrmFollowup(){
  const rv = crmReview;
  if(!rv || rv.saving) return;
  const reviewDate = document.getElementById('crmRvDate').value;
  if(!reviewDate || reviewDate < localIsoDate()){ showToast('الموعد الجديد لا يكون تاريخًا مضى', 'error'); return; }
  rv.saving = true;
  const f = rv.followup;
  const [{ error: aErr }, { error: uErr }] = await Promise.all([
    sb.from('classroom_followup_actions').insert({
      followup_id: f.id, teacher_id: currentUser.id, action_type: document.getElementById('crmRvAction').value,
      note: document.getElementById('crmRvNote').value.trim() || null, action_date: localIsoDate()
    }),
    sb.from('classroom_followups').update({ review_date: reviewDate }).eq('teacher_id', currentUser.id).eq('id', f.id).eq('status', 'open')
  ]);
  if(aErr || uErr){ showToast('تعذّر الحفظ: ' + ((aErr || uErr).message || ''), 'error'); rv.saving = false; return; }
  closeFollowupModal();
  showToast('حُفظ الإجراء ومُدّد الموعد', 'ok');
  await refreshAttentionViews();
  if(crmProfile && crmProfile.studentId === f.student_id) renderCrmStudentProfile();
}

/* من الرئيسية: "إجراء عاجل" ← تبويب المتابعات مباشرة */
async function showClassroomFollowups(){
  await showClassroomManagement();
  switchCrmTab('followups');
}

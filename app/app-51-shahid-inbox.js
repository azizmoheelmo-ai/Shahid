'use strict';
/* ============================================================
   أعمال تنتظر التوثيق — من العمل إلى الشاهد (المرحلة الأولى)
   ------------------------------------------------------------
   الفكرة (قرار المستخدم): المعلم لا يكتب الشاهد؛ ينفّذ العمل في التطبيق، والتطبيق
   يجمع ما نفّذه ويحوّله لشاهد معبّأ من بياناته، ويسأله فقط عما لا يعرفه:
   الأثر الذي لاحظه، والصورة (اختيارية)، وإظهار الأسماء (للمتابعات). الحفظ بموافقته دائمًا.

   - المصادر الأربعة القائمة كما هي (لا تغيير في منطقها): خطة درس حلّ موعدها،
     حصة برنامج نشاط حلّ أسبوعها، مهمة أدائية رُصدت درجاتها، متابعة أُغلقت بتحسّن.
     نستدعي دوالها نفسها (buildPlanShahidFields / buildTaskShahidDraft /
     buildFollowupShahidDraft) ودوال ربطها بعد الحفظ.
   - الترتيب بنواقص الخطة: العنصر الذي ينقصه شواهد عن مستهدفه أولًا.
   - «أخفِ هذا العمل»: يُحفظ بجدول التجاهل القائم (rule_key = 'shahid_inbox')، بلا مدة.
   - كل استعلام بتصفية المعلم صراحةً (CLAUDE.md §1) لا بالسياسات وحدها.
   - الحفظ بمعرّف يُولَّد عند فتح الورقة: نقرة ثانية أو تبويب آخر يصطدم بالمفتاح
     الأساسي (23505) بدل شاهد مكرر، ثم نكمل الربط على الشاهد الموجود.
   - ختم المصدر: source_type + source_note على الشاهد (يظهر بالبطاقة والـPDF).
     لو لم يُشغَّل SQL الأعمدة بعد، يُحفظ الشاهد بدونها (لا يتعطل الحفظ).
   ============================================================ */

const INBOX_RULE_KEY = 'shahid_inbox';
const INBOX_PLAN_DAYS = 30;       /* خطط حلّ موعدها خلال آخر 30 يومًا */
const INBOX_TASK_DAYS = 180;      /* مهام أُنشئت خلال آخر 180 يومًا */
const INBOX_FOLLOWUP_DAYS = 120;  /* متابعات أُغلقت بتحسّن خلال آخر 120 يومًا */
const INBOX_MAX_FILES = 4;
const INBOX_LIST_FIRST = 4;       /* DESIGN.md ق6: أول 4 + «عرض الكل» */
const INBOX_QUAL_MAX = 2000;

/* أسماء المصادر كما تظهر في ختم الشاهد (مفتاحها يُخزَّن في shawahid.source_type) */
const SHAHID_SOURCE_LABELS = {
  lesson_plan: 'خطة درس في التطبيق',
  program_session: 'برنامج نشاط في التطبيق',
  task: 'مهمة أدائية مرصودة في التطبيق',
  followup: 'متابعة طالب في التطبيق'
};

/* أيقونات خطية (DESIGN.md ق5) لكل مصدر */
const INBOX_ICONS = {
  lesson_plan: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM8.5 12l2 2 4-4"/></svg>',
  program_session: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  task: '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>',
  followup: '<svg viewBox="0 0 24 24"><path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/></svg>'
};

let inboxItems = [];          /* آخر قائمة محمّلة */
let inboxShowAll = false;     /* «عرض الكل» بمجموعة الأعمال الأخرى */
let inboxSheet = null;        /* الورقة المفتوحة: { id, item, draft, showNames, files, members, actions, sectionLabel } */
let inboxBusy = false;        /* حفظ/تحضير جارٍ — يعطّل الأزرار */
let inboxViewSeq = 0;         /* يلغي نتيجة تحميل قديم لو فُتحت الشاشة ثانية */
let inboxEntrySeq = 0;        /* يلغي نتيجة تحميل قديم لبطاقات الدخول */
let inboxAutoAll = false;     /* «عرض باقي ما عبّأه التطبيق» بالورقة */

/* التاريخ بصيغة التطبيق المختصرة («الخميس 13/11») — لا ينقلب اتجاهه وسط النص العربي */
function inboxDateText(iso){
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) && typeof shortDateAr === 'function' ? shortDateAr(iso) : '';
}

/* تصفير عند دخول حساب (onLoggedIn) — لا تبقى أعمال مستخدم سابق على نفس الصفحة */
function inboxResetState(){
  inboxItems = [];
  inboxShowAll = false;
  inboxSheet = null;
  inboxBusy = false;
  inboxViewSeq++;
  inboxEntrySeq++;
}

/* ============ دوال صرفة ============ */

/* كم شاهدًا ينقص العنصر عن مستهدفه بالخطة (0 = لا مستهدف أو مكتمل) */
function inboxElementGap(key, plan, counts){
  const target = Number(((plan || {})[key] || {}).target_count) || 0;
  const done = Number((counts || {})[key]) || 0;
  return Math.max(0, target - done);
}

/* الترتيب: ما ينقص الخطة أولًا (الأكبر نقصًا)، ثم الأحدث تاريخًا */
function sortInboxItems(items, gapOf){
  return (items || []).map(it => Object.assign({}, it, { gap: gapOf(it.elementKey) || 0 }))
    .sort((a, b) => (b.gap > 0) - (a.gap > 0) || b.gap - a.gap || String(b.date || '').localeCompare(String(a.date || '')));
}

function inboxIsDismissed(dismissals, key){
  return (dismissals || []).some(d => d.rule_key === INBOX_RULE_KEY && d.subject_key === key);
}

/* حصص البرامج غير الموثّقة التي حلّ أسبوعها (بداية أسبوعها ≤ اليوم).
   weekIndex: { اسم الأسبوع: تاريخ أوله } من التقويم الرسمي. بلا تقويم (null):
   أول حصة غير موثّقة فقط لكل برنامج (لكل شعبة) — لا نعرف ما حلّ من غيرها. */
function inboxDueProgramSessions(programs, sectionIdsMap, weekIndex, todayIso){
  const out = [];
  (programs || []).forEach(p => {
    const sectionIds = (sectionIdsMap && sectionIdsMap.get(p.id)) || [];
    const slots = sectionIds.length ? sectionIds : [null];
    const sessions = (p.sessions || []).slice().sort((x, y) => (x.session_no || 0) - (y.session_no || 0));
    slots.forEach(secId => {
      const pending = sessions.filter(s => secId
        ? !(s.section_status && s.section_status[secId] && s.section_status[secId].done)
        : !s.done);
      const due = weekIndex
        ? pending.filter(s => { const start = weekIndex[(s.week_label || '').trim()]; return !!start && start <= todayIso; })
        : pending.slice(0, 1);
      due.forEach(s => out.push({
        programId: p.id, sessionNo: s.session_no, sectionId: secId,
        weekStart: weekIndex ? weekIndex[(s.week_label || '').trim()] : null, weekLabel: s.week_label || ''
      }));
    });
  });
  return out;
}

/* كم فتحة توثيق اكتملت بالبرنامج (لشعبة بعينها أو بلا شعب) */
function inboxProgramDoneCount(program, sectionId){
  return (program.sessions || []).filter(s => sectionId
    ? !!(s.section_status && s.section_status[sectionId] && s.section_status[sectionId].done)
    : !!s.done).length;
}

/* مسودة شاهد حصة برنامج — من بيانات البرنامج وحدها (لا يُنسب للمعلم ما لم يسجّله) */
function buildProgramSessionShahidDraft(o){
  const p = o.program;
  const total = p.total_sessions || (p.sessions || []).length || 1;
  const n = o.sessionNo;
  const sec = o.sectionLabel || '';
  const done = inboxProgramDoneCount(p, o.sectionId || null);
  const students = Number(p.student_count) || 0;
  /* التاريخ: أسبوع الحصة إن انتهى (أوله)، وإلا اليوم */
  const date = o.weekStart && addDaysIso(o.weekStart, 6) < o.todayIso ? o.weekStart : o.todayIso;
  return {
    elementKey: p.element_key || '',
    title: `${p.name} — الحصة ${n} من ${total}${sec ? ' — ' + sec : ''}`,
    classLabel: sec,
    date,
    description: `نفّذتُ الحصة ${n} من ${total} في برنامج النشاط «${p.name}»`
      + (students ? ` مع ${arabicCountPhrase(students, CRM_STUDENT_COUNT_FORMS)}` : '') + (sec ? ` في ${sec}` : '') + '.',
    goal: '',
    steps: [],
    quant: `بهذه الحصة يكتمل توثيق ${done + 1} من ${total} من حصص البرنامج${sec ? ' لهذه الشعبة' : ''}.`,
    qual: '',
    reflection: '',
    sourceNote: `الحصة ${n} من ${total} في برنامج «${p.name}»`
  };
}

/* سجل الشاهد للإدراج — نفس حقول saveShahid (app-09) */
function buildInboxShahidRecord(o){
  const d = o.draft;
  const date = d.date || null;
  const rec = {
    id: o.id,
    user_id: o.userId,
    teacher_name: o.teacherName || '',
    teacher_email: o.email || '',
    school: o.school || '',
    subject: o.subject || '',
    class_name: d.classLabel || '',
    lesson_title: d.title || '',
    lesson_date: date,
    element_key: o.elementKey,
    element_label: o.elementLabel || o.elementKey,
    description: d.description || '',
    goal: d.goal || '',
    steps: Array.isArray(d.steps) ? d.steps.filter(Boolean) : [],
    photo_urls: o.photoUrls || [],
    quant_impact: d.quant || '',
    qual_impact: String(o.qual || '').trim(),
    reflection: d.reflection || '',
    goal_id: o.goalId || null,
    cycle_year: getCycleYear(date || undefined),
    cycle_stage: getCycleStageKey(date ? new Date(date) : new Date()),
    source_type: o.sourceType,
    source_note: String(d.sourceNote || '').slice(0, 200) || null
  };
  if(o.program){
    rec.program_id = o.program.programId;
    rec.program_session_no = o.program.sessionNo;
    rec.program_section_id = o.program.sectionId || null;
  }
  return rec;
}

/* هل فشل الإدراج لأن عمودي المصدر لم يُضافا بعد (SQL لم يُشغَّل)؟ */
function isMissingSourceColumnError(err){
  if(!err) return false;
  const msg = String(err.message || '');
  return /source_(type|note)/.test(msg) && (err.code === 'PGRST204' || err.code === '42703' || /schema cache|does not exist|column/i.test(msg));
}

/* إدراج شاهد مع ختم المصدر، وبدونه إن لم تُضف الأعمدة بعد */
async function insertShahidWithSource(record){
  let res = await sb.from('shawahid').insert(record).select().single();
  if(res.error && isMissingSourceColumnError(res.error)){
    const plain = Object.assign({}, record);
    delete plain.source_type;
    delete plain.source_note;
    res = await sb.from('shawahid').insert(plain).select().single();
  }
  return res;
}

/* نص الختم: «مهمة أدائية مرصودة في التطبيق — رُصدت درجات 26 من 28» ('' = بلا ختم) */
function shahidSourceStamp(rec){
  const label = rec && SHAHID_SOURCE_LABELS[rec.source_type];
  if(!label) return '';
  return label + (rec.source_note ? ' — ' + rec.source_note : '');
}

function inboxNewId(){
  if(typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function inboxSectionLabelFrom(sections, grades, id){
  const sec = (sections || []).find(s => s.id === id);
  if(!sec) return '';
  const g = (grades || []).find(x => x.id === sec.grade_level_id);
  return (g ? g.name + ' — ' : '') + 'الشعبة ' + (typeof crmDigits === 'function' ? crmDigits(sec.name) : sec.name);
}

/* ============ التحميل ============ */

function inboxFlags(){
  const standalone = typeof STANDALONE_ROLES !== 'undefined' && STANDALONE_ROLES.includes(dutyType);
  const classroom = !standalone && appSectionOn('classroom');
  return {
    shahid: appSectionOn('shahid'),
    plans: classroom,
    tasks: classroom && appToolOn('tasks'),
    followups: classroom && typeof followupsOn === 'function' && followupsOn(),
    programs: appSectionOn('work')
  };
}

/* يرجع { items, sections, grades } أو null عند الفشل (لا نقول «لا شيء» بناءً على فحص فاشل) */
async function loadInboxItems(){
  if(!currentUser) return null;
  const uid = currentUser.id;
  const f = inboxFlags();
  if(!f.shahid) return { items: [], sections: [], grades: [] };
  const todayIso = localIsoDate();
  const none = Promise.resolve({ data: [], error: null });
  const sinceIso = days => new Date(Date.now() - days * 86400000).toISOString();

  const [dRes, plRes, tRes, fRes, sRes, gRes, progOk] = await Promise.all([
    sb.from('classroom_attention_dismissals').select('rule_key, subject_key').eq('teacher_id', uid).eq('rule_key', INBOX_RULE_KEY),
    f.plans ? sb.from('lesson_plans').select('*').eq('user_id', uid).eq('status', 'planned')
      .lte('planned_date', todayIso).gte('planned_date', addDaysIso(todayIso, -INBOX_PLAN_DAYS)) : none,
    f.tasks ? sb.from('classroom_tasks').select('id, section_id, title, description, max_score, due_date, shahid_id, created_at')
      .eq('teacher_id', uid).is('shahid_id', null).gte('created_at', sinceIso(INBOX_TASK_DAYS)) : none,
    f.followups ? sb.from('classroom_followups').select('id, group_id, section_id, reason_type, reason_text, status, outcome, closed_at, shahid_id')
      .eq('teacher_id', uid).eq('status', 'closed').eq('outcome', 'improved').is('shahid_id', null).gte('closed_at', sinceIso(INBOX_FOLLOWUP_DAYS)) : none,
    (f.plans || f.tasks || f.followups || f.programs) ? sb.from('classroom_sections').select('id, name, grade_level_id').eq('teacher_id', uid) : none,
    (f.plans || f.tasks || f.followups || f.programs) ? sb.from('classroom_grade_levels').select('id, name').eq('teacher_id', uid) : none,
    f.programs ? loadActivityPrograms() : Promise.resolve(true)
  ]);
  if(dRes.error || plRes.error || tRes.error || fRes.error || !progOk) return null;
  /* الشعب للتسمية فقط — فشلها لا يُسقط القائمة */
  const sections = sRes.error ? [] : (sRes.data || []);
  const grades = gRes.error ? [] : (gRes.data || []);
  const secLabel = id => inboxSectionLabelFrom(sections, grades, id);
  const dismissals = dRes.data || [];
  const items = [];

  (plRes.data || []).forEach(p => items.push({
    key: 'plan:' + p.id, type: 'lesson_plan', ref: { plan: p }, elementKey: p.element_key,
    title: p.title, date: p.planned_date,
    sub: 'خطة درس حلّ موعدها' + (p.section_id && secLabel(p.section_id) ? ' · ' + secLabel(p.section_id) : '')
  }));

  /* المهمة لا تصير شاهدًا قبل رصد درجة واحدة على الأقل (نفس شرط openShahidDraftFromTask) */
  const tasks = tRes.data || [];
  if(tasks.length){
    const scored = new Set();
    for(const ids of chunkArray(tasks.map(t => t.id), 100)){
      const { data, error } = await sb.from('classroom_task_students').select('task_id')
        .eq('teacher_id', uid).in('task_id', ids).not('score', 'is', null);
      if(error) return null;
      (data || []).forEach(r => scored.add(r.task_id));
    }
    tasks.filter(t => scored.has(t.id)).forEach(t => items.push({
      key: 'task:' + t.id, type: 'task', ref: { taskId: t.id }, elementKey: 'تنوع أساليب التقويم',
      title: 'مهمة أدائية: ' + t.title, date: t.due_date || String(t.created_at || '').slice(0, 10),
      sub: 'رُصدت درجاتها' + (secLabel(t.section_id) ? ' · ' + secLabel(t.section_id) : '')
    }));
  }

  /* المتابعة الجماعية بند واحد (بمعرّف المجموعة) */
  const fGroups = new Map();
  (fRes.data || []).forEach(x => {
    const k = x.group_id || x.id;
    if(!fGroups.has(k)) fGroups.set(k, []);
    fGroups.get(k).push(x);
  });
  fGroups.forEach((list, k) => {
    const f0 = list[0];
    items.push({
      key: 'followup:' + k, type: 'followup', ref: { followupIds: list.map(x => x.id), groupId: f0.group_id || null },
      elementKey: f0.reason_type === 'grades' ? 'تحسين نتائج المتعلمين' : 'الإدارة الصفية',
      title: (f0.group_id ? 'متابعة جماعية: ' : 'متابعة طالب: ') + f0.reason_text,
      date: String(f0.closed_at || '').slice(0, 10),
      sub: 'أُغلقت بتحسّن' + (secLabel(f0.section_id) ? ' · ' + secLabel(f0.section_id) : '')
    });
  });

  if(f.programs && activityPrograms.length){
    let weekIndex = null;
    if(calendarRegion){
      try{
        const { weeks } = await loadCalendarData(calendarRegion);
        weekIndex = buildWeekLabelDateIndex(weeks);
      } catch(e){ weekIndex = null; }
    }
    inboxDueProgramSessions(activityPrograms, programSectionIdsMap, weekIndex, todayIso).forEach(s => {
      const p = activityPrograms.find(x => x.id === s.programId);
      const sl = s.sectionId ? secLabel(s.sectionId) : '';
      items.push({
        key: `program:${s.programId}:${s.sessionNo}:${s.sectionId || '-'}`, type: 'program_session',
        ref: { programId: s.programId, sessionNo: s.sessionNo, sectionId: s.sectionId, weekStart: s.weekStart, sectionLabel: sl },
        elementKey: p.element_key || '', title: `${p.name} — الحصة ${s.sessionNo}`,
        date: s.weekStart || todayIso,
        sub: 'حصة برنامج لم تُوثَّق' + (s.weekLabel ? ' · ' + s.weekLabel : '') + (sl ? ' · ' + sl : '')
      });
    });
  }

  const visible = items.filter(it => !inboxIsDismissed(dismissals, it.key));
  return {
    items: sortInboxItems(visible, key => inboxElementGap(key, myPlan, planShahidCounts)),
    sections, grades
  };
}

/* ============ بطاقات الدخول (الرئيسية + الشواهد) ============ */

function inboxEntryHtml(items){
  const n = items.length;
  const gapN = items.filter(it => it.gap > 0).length;
  const sub = gapN
    ? `${arabicCountPhrase(gapN, { one: 'عمل واحد', two: 'عملان', few: '{n} أعمال', many: '{n} عملًا' })} ${gapN === 1 ? 'يكمّل' : (gapN === 2 ? 'يكمّلان' : 'تكمّل')} نواقص خطتك`
    : 'أقربها: ' + items[0].title;
  return `<div class="tlx-box ibx-entry"><button type="button" class="tlx-row" onclick="showInbox()">
      <span class="tlx-ic">${INBOX_ICONS.task}</span>
      <span class="tlx-row-main"><b>${escapeHtml(arabicCountPhrase(n, { one: 'عمل واحد جاهز ليصير شاهدًا', two: 'عملان جاهزان ليصيرا شاهدين', few: '{n} أعمال جاهزة لتصير شواهد', many: '{n} عملًا جاهزًا لتصير شواهد' }))}</b>
      <small>${escapeHtml(sub)}</small></span>
      <span class="tlx-chev">‹</span></button></div>`;
}

/* تُستدعى بلا await من showHome وshowList؛ تكتب فقط لو بقيت الشاشة نفسها ظاهرة */
async function refreshInboxEntries(){
  const seq = ++inboxEntrySeq;
  const uid = currentUser && currentUser.id;
  const ids = ['homeInboxCard', 'inboxEntry'];
  const hideAll = () => ids.forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
  if(!uid || !appSectionOn('shahid')){ hideAll(); return; }
  let res = null;
  try{ res = await loadInboxItems(); } catch(e){ res = null; }
  if(seq !== inboxEntrySeq || !currentUser || currentUser.id !== uid) return;
  if(!res || !res.items.length){ hideAll(); return; }
  /* لا نكتب inboxItems هنا: الشاشة المفتوحة ترسم صفوفها بفهارسها، وتحميل بطاقة متأخر
     كان سيبدّل البنود تحتها فيفتح صفٌّ عملًا غير الذي ضغطه المعلم */
  const html = inboxEntryHtml(res.items);
  ids.forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = html;
    el.style.display = 'block';
  });
}

/* ============ الشاشة ============ */

function isInboxViewOpen(){
  const v = document.getElementById('inboxView');
  return !!v && v.style.display === 'block';
}

async function showInbox(){
  hideAllMainViews();
  setActiveBottomTab('shahid');
  document.getElementById('inboxView').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  inboxSheet = null;
  inboxShowAll = false;
  const body = document.getElementById('inboxBody');
  body.innerHTML = '<div class="loading-state">جارِ جمع أعمالك...</div>';
  const seq = ++inboxViewSeq;
  const uid = currentUser && currentUser.id;
  if(typeof loadPlan === 'function'){ try{ await loadPlan(); } catch(e){ /* الترتيب بالنواقص يتراجع للتاريخ */ } }
  let res = null;
  try{ res = await loadInboxItems(); } catch(e){ res = null; }
  if(seq !== inboxViewSeq || !isInboxViewOpen() || !currentUser || currentUser.id !== uid) return;
  if(!res){
    body.innerHTML = `<div class="tlx-box tlx-empty"><b>تعذّر جمع أعمالك</b><small>تحقق من الاتصال ثم أعد المحاولة.</small>
      <button type="button" class="tlx-btn is-ghost" onclick="showInbox()">إعادة المحاولة</button></div>`;
    return;
  }
  inboxItems = res.items;
  renderInboxList();
}

function inboxRowHtml(it, i){
  const el = ((typeof getElementsOrder === 'function' ? getElementsOrder() : []).find(e => e.key === it.elementKey) || {}).label;
  const pill = it.gap > 0 ? `<span class="tlx-pill is-gold">ينقصه ${it.gap}</span>` : '';
  return `<button type="button" class="tlx-row" onclick="inboxOpen(${i})">
      <span class="tlx-ic">${INBOX_ICONS[it.type] || ''}</span>
      <span class="tlx-row-main"><b>${escapeHtml(it.title)}</b>
        <small>${escapeHtml(it.sub)}${inboxDateText(it.date) ? ' · ' + escapeHtml(inboxDateText(it.date)) : ''}</small>
        <small class="ibx-el">${escapeHtml(el ? splitLabel(el).name : 'اختر له عنصرًا')}</small></span>
      ${pill}<span class="tlx-chev">‹</span></button>`;
}

function renderInboxList(){
  const body = document.getElementById('inboxBody');
  if(!body) return;
  const back = '<button type="button" class="tlx-crumb" onclick="showList()">› الشواهد</button>';
  const note = '<p class="tlx-note">أعمال نفّذتها في التطبيق ولم توثّقها بعد. اختر عملًا فيُعبَّأ شاهده من بياناته، وتضيف أنت الأثر الذي لاحظته وصورة إن وُجدت، ثم تحفظ.</p>';
  if(!inboxItems.length){
    body.innerHTML = back + `<div class="tlx-box tlx-empty"><span class="tlx-ic">${INBOX_ICONS.task}</span><b>لا أعمال تنتظر التوثيق</b>
      <small>تظهر هنا: الخطط التي حلّ موعدها، وحصص برامجك، والمهام الأدائية بعد رصد درجاتها، والمتابعات التي انتهت بتحسّن.</small></div>`;
    return;
  }
  const idx = inboxItems.map((it, i) => ({ it, i }));
  const gaps = idx.filter(x => x.it.gap > 0);
  const rest = idx.filter(x => !(x.it.gap > 0));
  const restShown = inboxShowAll ? rest : rest.slice(0, INBOX_LIST_FIRST);
  let html = back + note;
  if(gaps.length){
    html += `<div class="tlx-grp">تكمّل نواقص خطتك (${gaps.length})</div><div class="tlx-box">${gaps.map(x => inboxRowHtml(x.it, x.i)).join('')}</div>`;
  }
  if(rest.length){
    html += `<div class="tlx-grp is-calm">${gaps.length ? 'أعمال أخرى' : 'جاهزة للتوثيق'} (${rest.length})</div><div class="tlx-box">${restShown.map(x => inboxRowHtml(x.it, x.i)).join('')}`
      + (rest.length > restShown.length ? `<button type="button" class="tlx-more" onclick="inboxShowAll = true; renderInboxList();">عرض الكل (${rest.length})</button>` : '')
      + '</div>';
  }
  body.innerHTML = html;
}

/* ============ ورقة التوثيق السريع ============ */

/* يحمّل ما يلزم لمسودة البند ويبنيها بدوال المصادر القائمة. يرجع ورقة أو يرمي خطأ برسالة للمعلم */
async function inboxPrepareSheet(it){
  const uid = currentUser.id;
  const todayIso = localIsoDate();
  const sheet = { id: inboxNewId(), item: it, showNames: false, files: [] };
  if(it.type === 'lesson_plan'){
    const p = it.ref.plan;
    const tpl = p.template_name ? (SHAHID_TEMPLATES[p.element_key] || []).find(t => t.name === p.template_name) : null;
    const fl = buildPlanShahidFields(p, tpl, todayIso);
    const sl = p.section_id ? await inboxSectionLabel(p.section_id) : '';
    sheet.draft = Object.assign({ elementKey: p.element_key, title: p.title, classLabel: sl,
      sourceNote: 'خطة سُجّلت في ' + String(p.created_at || p.planned_date || '').slice(0, 10) + ' لموعد ' + p.planned_date }, fl);
  } else if(it.type === 'task'){
    const [tRes, rRes] = await Promise.all([
      sb.from('classroom_tasks').select('id, section_id, title, description, max_score, due_date, shahid_id').eq('teacher_id', uid).eq('id', it.ref.taskId).maybeSingle(),
      sb.from('classroom_task_students').select('student_id, score, group_no').eq('teacher_id', uid).eq('task_id', it.ref.taskId)
    ]);
    if(tRes.error || rRes.error) throw new Error('تعذّر تحميل المهمة');
    if(!tRes.data) throw new Error('المهمة غير موجودة — ربما حُذفت من جهاز آخر');
    if(tRes.data.shahid_id) throw new Error('هذه المهمة وُثّقت كشاهد من قبل');
    const rows = rRes.data || [];
    const graded = rows.filter(r => r.score !== null && r.score !== undefined).length;
    if(!graded) throw new Error('ارصد درجات المهمة أولًا — الشاهد يقوم على نتائجها');
    const sl = await inboxSectionLabel(tRes.data.section_id);
    sheet.draft = Object.assign(buildTaskShahidDraft({ task: tRes.data, rows, sectionLabel: sl, todayIso }),
      { sourceNote: `رُصدت درجات ${graded} من ${rows.length}` });
  } else if(it.type === 'followup'){
    const q = sb.from('classroom_followups').select('*').eq('teacher_id', uid).eq('status', 'closed');
    const { data: fus, error } = it.ref.groupId ? await q.eq('group_id', it.ref.groupId) : await q.in('id', it.ref.followupIds);
    if(error || !(fus || []).length) throw new Error('تعذّر تحميل المتابعة');
    if(!it.ref.groupId && fus.some(x => x.shahid_id)) throw new Error('هذه المتابعة وُثّقت كشاهد من قبل');
    const [aRes, stRes] = await Promise.all([
      sb.from('classroom_followup_actions').select('action_type, note, action_date').eq('teacher_id', uid).in('followup_id', fus.map(x => x.id)).order('action_date', { ascending: true }),
      sb.from('classroom_students').select('id, full_name').eq('teacher_id', uid).in('id', fus.map(x => x.student_id))
    ]);
    if(aRes.error) throw new Error('تعذّر تحميل إجراءات المتابعة');
    const names = new Map(((stRes && stRes.data) || []).map(s => [s.id, s.full_name]));
    sheet.members = fus.map(x => ({ followup: x, studentName: names.get(x.student_id) || 'طالب' }));
    sheet.actions = aRes.data || [];
    sheet.sectionLabel = fus[0].section_id ? await inboxSectionLabel(fus[0].section_id) : '';
    inboxRebuildFollowupDraft(sheet);
  } else if(it.type === 'program_session'){
    const p = activityPrograms.find(x => x.id === it.ref.programId);
    if(!p) throw new Error('البرنامج غير موجود — ربما حُذف');
    sheet.draft = buildProgramSessionShahidDraft({ program: p, sessionNo: it.ref.sessionNo, sectionId: it.ref.sectionId,
      sectionLabel: it.ref.sectionLabel, weekStart: it.ref.weekStart, todayIso });
  }
  sheet.qual = sheet.draft.qual || '';
  sheet.elementKey = sheet.draft.elementKey;
  return sheet;
}

function inboxRebuildFollowupDraft(sheet){
  const f0 = sheet.members[0].followup;
  const d = buildFollowupShahidDraft({ members: sheet.members, actions: sheet.actions, sectionLabel: sheet.sectionLabel,
    showNames: sheet.showNames, todayIso: localIsoDate() });
  d.sourceNote = `متابعة فُتحت في ${String(f0.created_at || '').slice(0, 10)} وأُغلقت بتحسّن في ${String(f0.closed_at || '').slice(0, 10)}`;
  sheet.draft = d;
}

async function inboxSectionLabel(sectionId){
  if(!sectionId) return '';
  if(typeof crmSectionById === 'function' && crmSectionById(sectionId)) return crmSectionLabel(sectionId);
  const uid = currentUser.id;
  const { data: sec } = await sb.from('classroom_sections').select('id, name, grade_level_id').eq('teacher_id', uid).eq('id', sectionId).maybeSingle();
  if(!sec) return '';
  const { data: g } = sec.grade_level_id
    ? await sb.from('classroom_grade_levels').select('id, name').eq('teacher_id', uid).eq('id', sec.grade_level_id).maybeSingle()
    : { data: null };
  return inboxSectionLabelFrom([sec], g ? [g] : [], sectionId);
}

async function inboxOpen(i){
  const it = inboxItems[i];
  if(!it || inboxBusy) return;
  inboxBusy = true;
  const uid = currentUser.id;
  const seq = inboxViewSeq;
  try{
    const sheet = await inboxPrepareSheet(it);
    if(seq !== inboxViewSeq || !isInboxViewOpen() || !currentUser || currentUser.id !== uid) return;
    inboxSheet = sheet;
    inboxAutoAll = false;
    renderInboxSheet();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch(e){
    showToast(e.message || 'تعذّر تجهيز الشاهد', 'error');
  } finally {
    inboxBusy = false;
  }
}

function inboxSyncInputs(){
  if(!inboxSheet) return;
  const q = document.getElementById('inboxQual');
  if(q) inboxSheet.qual = q.value;
  const el = document.getElementById('inboxElement');
  if(el) inboxSheet.elementKey = el.value;
}

function renderInboxSheet(){
  const body = document.getElementById('inboxBody');
  const s = inboxSheet;
  if(!body || !s) return;
  const d = s.draft;
  const elements = typeof getElementsOrder === 'function' ? getElementsOrder() : [];
  const hasEl = elements.some(e => e.key === s.elementKey);
  const opts = `<option value=""${hasEl ? '' : ' selected'}>— اختر عنصر الأداء —</option>`
    + elements.map(e => `<option value="${escapeHtml(e.key)}"${e.key === s.elementKey ? ' selected' : ''}>${escapeHtml(e.label)}</option>`).join('');
  const has = v => typeof v === 'string' && v.trim() !== '';
  const steps = (d.steps || []).filter(Boolean);
  const autoRows = [
    has(d.description) ? `<div class="tlx-ans"><small>الوصف</small><span>${escapeHtml(d.description)}</span></div>` : '',
    has(d.goal) ? `<div class="tlx-ans"><small>الهدف</small><span>${escapeHtml(d.goal)}</span></div>` : '',
    steps.length ? `<div class="tlx-ans"><small>الخطوات</small><ol class="ibx-steps">${steps.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol></div>` : '',
    has(d.quant) ? `<div class="tlx-ans"><small>الأثر الكمي</small><span class="ibx-pre">${escapeHtml(d.quant)}</span></div>` : '',
    has(d.reflection) ? `<div class="tlx-ans"><small>التأمل</small><span>${escapeHtml(d.reflection)}</span></div>` : ''
  ].filter(Boolean);
  /* أول بند ظاهر، والباقي بزر (DESIGN.md ق6: القوائم الطويلة تُختصر) */
  const autoShown = inboxAutoAll ? autoRows : autoRows.slice(0, 1);
  const auto = autoShown.join('') + (autoRows.length > autoShown.length
    ? `<button type="button" class="tlx-more" onclick="inboxSyncInputs(); inboxAutoAll = true; renderInboxSheet();">عرض باقي ما عبّأه (${autoRows.length - autoShown.length})</button>` : '');
  const names = s.item.type === 'followup' ? `
    <div class="tlx-lbl">أسماء الطلاب في الشاهد <small>يطّلع عليه المقيّم والمسؤول</small></div>
    <div class="tlx-seg"><button type="button" class="${s.showNames ? '' : 'is-on'}" onclick="inboxSetNames(false)">بلا أسماء</button><button type="button" class="${s.showNames ? 'is-on' : ''}" onclick="inboxSetNames(true)">بالأسماء</button></div>` : '';
  const files = s.files.map((f, i) => `<span class="tlx-chip ibx-file">${escapeHtml(shortName(f.name, 22))}<button type="button" class="tlx-x" aria-label="إزالة" onclick="inboxRemoveFile(${i})">✕</button></span>`).join('');
  body.innerHTML = `
    <button type="button" class="tlx-crumb" onclick="inboxBackToList()">› أعمال تنتظر التوثيق</button>
    <div class="tlx-hero"><div class="tlx-hero-top"><div><b>${escapeHtml(d.title)}</b>
      <small>${escapeHtml(SHAHID_SOURCE_LABELS[s.item.type] || '')}${inboxDateText(d.date) ? ' · ' + escapeHtml(inboxDateText(d.date)) : ''}${d.classLabel ? ' · ' + escapeHtml(d.classLabel) : ''}</small></div></div></div>
    <div class="tlx-lbl">عنصر الأداء</div>
    <select id="inboxElement" class="tlx-inp" onchange="inboxSyncInputs()">${opts}</select>
    <div class="tlx-lbl">ما عبّأه التطبيق من بياناتك <small>تعدّله من «تعديل كامل»</small></div>
    <div class="tlx-box">${auto || '<div class="tlx-ans"><small>لا تفاصيل مسجّلة لهذا العمل — اكتب الأثر أدناه، أو أكمل الوصف من «تعديل كامل».</small></div>'}</div>
    ${names}
    <div class="tlx-lbl">الأثر الذي لاحظته <small>مطلوب — سطر يكفي</small></div>
    <textarea id="inboxQual" class="tlx-inp" rows="3" maxlength="${INBOX_QUAL_MAX}" placeholder="مثال: تفاعل الطلاب أكثر، وتحسّنت مشاركة المجموعة الثالثة..." oninput="inboxSyncInputs()">${escapeHtml(s.qual || '')}</textarea>
    <div class="tlx-lbl">صور أو مستند <small>اختياري — حتى ${INBOX_MAX_FILES}، والصورة تقوّي الشاهد</small></div>
    <div class="tlx-chips">${files}${s.files.length < INBOX_MAX_FILES ? `<label class="tlx-chip ibx-add">＋ إرفاق<input type="file" accept="image/*,application/pdf" multiple hidden onchange="inboxAddFiles(this)"></label>` : ''}</div>
    <div class="tlx-sec">خيارات أخرى</div>
    <div class="tlx-box">
      <button type="button" id="inboxFullBtn" class="tlx-mi" onclick="inboxOpenFullForm()"><i><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></i><span>تعديل كامل في نموذج الشاهد</span></button>
      <button type="button" id="inboxHideBtn" class="tlx-mi is-danger" onclick="inboxDismiss()"><i><svg viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6c2 0 3.7.8 5 1.8M21 12s-3.5 6-9 6c-2 0-3.7-.8-5-1.8M4 4l16 16"/></svg></i><span>ليس عملًا يُوثَّق — أخفِه من القائمة</span></button>
    </div>
    <div class="tlx-cta"><button type="button" id="inboxSaveBtn" class="tlx-btn is-navy" onclick="inboxSave()">حفظ الشاهد</button></div>`;
}

function inboxBackToList(){
  inboxSheet = null;
  renderInboxList();
}

function inboxSetNames(on){
  if(!inboxSheet || inboxSheet.item.type !== 'followup') return;
  inboxSyncInputs();
  inboxSheet.showNames = !!on;
  inboxRebuildFollowupDraft(inboxSheet);
  renderInboxSheet();
}

function inboxAddFiles(input){
  if(!inboxSheet) return;
  inboxSyncInputs();
  const picked = Array.from(input.files || []);
  input.value = '';
  for(const f of picked){
    if(inboxSheet.files.length >= INBOX_MAX_FILES) break;
    if(!(f.type.startsWith('image/') || f.type === 'application/pdf')){ showToast('الصور وملفات PDF فقط هنا', 'error'); continue; }
    if(f.size > MAX_UPLOAD_MB * 1024 * 1024){ showToast(`حجم الملف كبير جدًا (الحد ${MAX_UPLOAD_MB} ميجابايت).`, 'error'); continue; }
    inboxSheet.files.push(f);
  }
  renderInboxSheet();
}

function inboxRemoveFile(i){
  if(!inboxSheet || inboxBusy) return;
  inboxSyncInputs();
  inboxSheet.files.splice(i, 1);
  renderInboxSheet();
}

function inboxSetButtons(disabled){
  ['inboxSaveBtn', 'inboxFullBtn', 'inboxHideBtn'].forEach(id => { const b = document.getElementById(id); if(b) b.disabled = disabled; });
}

/* هل ما زال العمل بانتظار التوثيق؟ قراءة أحدث حالة من القاعدة قبل الحفظ مباشرة
   (CLAUDE.md §4): ربما وثّقه المعلم من تبويب/جهاز آخر أثناء فتح الورقة — فلا شاهد مكرر. */
async function inboxStillPending(item){
  const uid = currentUser.id;
  if(item.type === 'lesson_plan'){
    const { data, error } = await sb.from('lesson_plans').select('status, shahid_id').eq('user_id', uid).eq('id', item.ref.plan.id).maybeSingle();
    if(error) throw error;
    return !!data && data.status === 'planned' && !data.shahid_id;
  }
  if(item.type === 'task'){
    const { data, error } = await sb.from('classroom_tasks').select('shahid_id').eq('teacher_id', uid).eq('id', item.ref.taskId).maybeSingle();
    if(error) throw error;
    return !!data && !data.shahid_id;
  }
  if(item.type === 'followup'){
    const { data, error } = await sb.from('classroom_followups').select('id, shahid_id').eq('teacher_id', uid).in('id', item.ref.followupIds);
    if(error) throw error;
    return (data || []).length > 0 && (data || []).every(x => !x.shahid_id);
  }
  if(item.type === 'program_session'){
    const { data, error } = await sb.from('activity_programs').select('sessions').eq('user_id', uid).eq('id', item.ref.programId).maybeSingle();
    if(error) throw error;
    const ses = data && (data.sessions || []).find(x => x.session_no === item.ref.sessionNo);
    if(!ses) return false;
    return item.ref.sectionId
      ? !(ses.section_status && ses.section_status[item.ref.sectionId] && ses.section_status[item.ref.sectionId].done)
      : !ses.done;
  }
  return false;
}

/* بعد الإدراج: نفس دوال الربط التي يستعملها نموذج الشاهد (app-09) */
async function inboxLinkSource(item, shahidId){
  if(item.type === 'lesson_plan') await markLessonPlanDone(item.ref.plan.id, shahidId);
  else if(item.type === 'task') await linkTaskToShahid(item.ref.taskId, shahidId);
  else if(item.type === 'followup'){
    const ids = (inboxSheet && inboxSheet.item === item && inboxSheet.members) ? inboxSheet.members.map(m => m.followup.id) : item.ref.followupIds;
    await linkFollowupsToShahid(ids, shahidId);
  } else if(item.type === 'program_session') await markProgramSessionDone(item.ref.programId, item.ref.sessionNo, shahidId, undefined, item.ref.sectionId || undefined);
}

async function inboxSave(){
  const s = inboxSheet;
  if(!s || inboxBusy) return;
  inboxSyncInputs();
  if(!currentUser){ showToast('يجب تسجيل الدخول أولًا', 'error'); return; }
  if(!navigator.onLine){ showToast('لا يوجد اتصال بالإنترنت', 'error'); return; }
  const el = (getElementsOrder() || []).find(e => e.key === s.elementKey);
  if(!el){ showToast('اختر عنصر الأداء أولًا', 'error'); return; }
  if(!String(s.qual || '').trim()){ showToast('اكتب الأثر الذي لاحظته (سطر يكفي)', 'error'); const q = document.getElementById('inboxQual'); if(q) q.focus(); return; }
  const uid = currentUser.id;
  /* التعطيل قبل أي await (CLAUDE.md §6) */
  inboxBusy = true;
  inboxSetButtons(true);
  const uploaded = [];
  const cleanup = () => { if(uploaded.length) sb.storage.from('shawahid-photos').remove(uploaded).catch(() => {}); };
  try{
    if(!(await inboxStillPending(s.item))){
      showToast('هذا العمل وُثّق من قبل (ربما من جهاز آخر) — لا شاهد مكرر', 'ok');
      if(isInboxViewOpen() && inboxSheet === s && currentUser && currentUser.id === uid){ inboxBusy = false; await showInbox(); }
      return;
    }
    const files = await Promise.all(s.files.map(compressImage));
    const urls = await Promise.all(files.map(async (file) => {
      const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const ext = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : 'jpg';
      const path = `${uid}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, file);
      if(upErr) throw upErr;
      uploaded.push(path);
      return sb.storage.from('shawahid-photos').getPublicUrl(path).data.publicUrl;
    }));
    /* هدف واحد للعنصر = يُربط تلقائيًا (نفس سلوك نموذج الشاهد: updateExample بـapp-09) */
    const goals = ((typeof myPlanGoals !== 'undefined' && myPlanGoals[el.key]) || []).filter(g => g.id);
    const meta = (currentUser && currentUser.user_metadata) || {};
    const record = buildInboxShahidRecord({
      id: s.id, userId: uid, email: currentUser.email, teacherName: meta.full_name || '',
      school: getProfileSchool(), subject: getProfileSubject(),
      draft: s.draft, qual: s.qual, elementKey: el.key, elementLabel: el.label,
      goalId: goals.length === 1 ? goals[0].id : null, photoUrls: urls, sourceType: s.item.type,
      program: s.item.type === 'program_session' ? s.item.ref : null
    });
    let { data: inserted, error } = await insertShahidWithSource(record);
    if(error && error.code === '23505'){
      /* حُفظ من قبل (نقرة/تبويب آخر): لا شاهد مكرر — نكمل الربط على الموجود */
      cleanup();
      const { data: existing } = await sb.from('shawahid').select('*').eq('id', s.id).eq('user_id', uid).maybeSingle();
      if(!existing) throw error;
      inserted = existing;
      error = null;
    }
    if(error) throw error;
    await inboxLinkSource(s.item, inserted.id);
    if(currentUser && currentUser.id === uid){
      if(typeof myRecords !== 'undefined' && Array.isArray(myRecords) && myRecords.length && !myRecords.some(r => String(r.id) === String(inserted.id))) myRecords.unshift(inserted);
      if(typeof loadPlan === 'function') loadPlan();
    }
    showToast('تم حفظ الشاهد ✓' + (inserted.ref_number ? ' — ' + inserted.ref_number : ''), 'ok');
    /* لو بقي على الشاشة نفسها: نعود للقائمة محدّثة */
    if(isInboxViewOpen() && inboxSheet === s && currentUser && currentUser.id === uid){
      inboxBusy = false;
      await showInbox();
    }
  } catch(err){
    cleanup();
    showToast('تعذّر الحفظ: ' + (err.message || err), 'error');
    if(inboxSheet === s) inboxSetButtons(false);
  } finally {
    inboxBusy = false;
  }
}

/* «تعديل كامل»: نفس مسارات التوثيق القائمة لكل مصدر (النموذج الكامل)، مع ما كتبه المعلم */
async function inboxOpenFullForm(){
  const s = inboxSheet;
  if(!s || inboxBusy) return;
  inboxSyncInputs();
  const it = s.item;
  inboxBusy = true;
  inboxSetButtons(true);
  try{
    if(it.type === 'lesson_plan'){
      if(!crmLessonPlans.some(p => p.id === it.ref.plan.id)) crmLessonPlans.push(it.ref.plan);
      documentLessonPlan(it.ref.plan.id);
    } else if(it.type === 'task'){
      await openShahidDraftFromTask(it.ref.taskId);
    } else if(it.type === 'followup'){
      await openShahidDraftFromFollowups(it.ref.followupIds, it.ref.groupId);
    } else if(it.type === 'program_session'){
      if(it.ref.sectionId){
        if(!programDetailSections.some(x => x.id === it.ref.sectionId)) programDetailSections = [{ id: it.ref.sectionId, label: it.ref.sectionLabel || '' }];
        documentProgramSessionForSection(it.ref.programId, it.ref.sessionNo, it.ref.sectionId);
      } else {
        documentProgramSession(it.ref.programId, it.ref.sessionNo);
      }
    }
    /* لو فُتح النموذج: نحمل ما اختاره المعلم وكتبه */
    const form = document.getElementById('formView');
    if(form && form.style.display === 'block'){
      if(s.elementKey && s.elementKey !== elementSelect.value && getElementsOrder().some(e => e.key === s.elementKey)){
        elementSelect.value = s.elementKey;
        updateExample();
      }
      if(String(s.qual || '').trim()) qualBox.value = s.qual;
      if(it.type === 'program_session' && !descBox.value.trim()){
        descBox.value = s.draft.description || '';
        quantBox.value = s.draft.quant || '';
      }
      inboxSheet = null;
    }
  } catch(e){
    showToast('تعذّر فتح النموذج: ' + (e.message || ''), 'error');
  } finally {
    inboxBusy = false;
    if(inboxSheet === s) inboxSetButtons(false);
  }
}

async function inboxDismiss(){
  const s = inboxSheet;
  if(!s || inboxBusy) return;
  const ok = await showConfirm('إخفاء هذا العمل من «أعمال تنتظر التوثيق»؟ لا يُحذف شيء من بياناتك.');
  if(!ok || inboxSheet !== s) return;
  inboxBusy = true;
  inboxSetButtons(true);
  const uid = currentUser.id;
  const { error } = await sb.from('classroom_attention_dismissals').upsert(
    { teacher_id: uid, rule_key: INBOX_RULE_KEY, subject_key: s.item.key, dismissed_at: new Date().toISOString() },
    { onConflict: 'teacher_id,rule_key,subject_key' });
  inboxBusy = false;
  if(error){ showToast('تعذّر الإخفاء: ' + error.message, 'error'); if(inboxSheet === s) inboxSetButtons(false); return; }
  showToast('أُخفي من القائمة', 'ok');
  if(isInboxViewOpen() && inboxSheet === s && currentUser && currentUser.id === uid){
    inboxItems = inboxItems.filter(x => x.key !== s.item.key);
    inboxSheet = null;
    renderInboxList();
  }
}

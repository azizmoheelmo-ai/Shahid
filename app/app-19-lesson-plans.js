/* ============================================================
   خطط الحصص القادمة: أخطط ← أنفّذ في الحصة ← أوثّق
   ------------------------------------------------------------
   - من نموذج الشاهد: "📅 احفظها كخطة لحصة قادمة" — نفس المحتوى (نموذج
     جاهز أو كتابة حرة) يُحفظ خطة بتاريخ وحصة اختيارية من الجدول، وخطة
     مستقلة لكل شعبة مختارة.
   - يوم الحصة: تظهر في "اليوم" بجانب حصتها، وفي التقويم بتاريخها.
   - بعد الحصة: "نفّذتها ← وثّقها" يفتح الشاهد معبّأً، والمعلم يضيف الأثر
     والصور ويحفظ — فتصير الخطة "منفّذة" ومربوطة بشاهدها.
   - جدول مستقل (lesson_plans) لا حالة داخل جدول الشواهد: خطة لم تُنفّذ لا
     تُحسب أبدًا في الإنجاز أو التغطية أو لوحة المسؤول أو التصدير. خاصة
     بالمعلم (لا سياسة للمسؤول).
   ============================================================ */

/* ============ دوال صرفة ============ */
function nextSchoolDay(todayIso){
  let d = addDaysIso(todayIso, 1);
  while(weekdayOfIso(d) === 5 || weekdayOfIso(d) === 6) d = addDaysIso(d, 1);
  return d;
}

function planLessonsForDay(slots, dateIso){
  const wd = weekdayOfIso(dateIso);
  return (slots || []).filter(s => s.weekday === wd)
    .map(s => ({ section_id: s.section_id, period: s.period }))
    .sort((a, b) => a.period - b.period);
}

function classifyPlans(plans, todayIso){
  const since = addDaysIso(todayIso, -7);
  const planned = (plans || []).filter(p => p.status === 'planned')
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || (a.period || 0) - (b.period || 0));
  return {
    today: planned.filter(p => p.planned_date === todayIso),
    upcoming: planned.filter(p => p.planned_date > todayIso),
    overdue: planned.filter(p => p.planned_date < todayIso && p.planned_date >= since)
  };
}

/* content: { element_key, template_name, title, description, goal, steps } ؛ targets: [{section_id, period}] */
function buildPlanRows(content, dateIso, targets, userId){
  const base = {
    user_id: userId, element_key: content.element_key, template_name: content.template_name || null,
    title: String(content.title || '').trim().slice(0, 200), description: content.description || null,
    goal: content.goal || null, steps: (content.steps || []).filter(Boolean), planned_date: dateIso, status: 'planned'
  };
  const list = (targets && targets.length) ? targets : [{ section_id: null, period: null }];
  return list.map(t => Object.assign({}, base, { section_id: t.section_id || null, period: t.period == null ? null : t.period }));
}

/* حقول الشاهد من خطة نُفّذت. التاريخ: موعد الخطة، أو اليوم إن نُفّذت قبله */
function buildPlanShahidFields(plan, template, todayIso){
  const date = plan.planned_date <= todayIso ? plan.planned_date : todayIso;
  const planned = String(plan.created_at || '').slice(0, 10);
  const note = planned ? `\n\n(خُطط لهذا الإجراء مسبقًا في ${planned} ونُفّذ في ${date}.)` : '';
  return {
    date,
    description: (plan.description || '') + note,
    goal: plan.goal || '',
    steps: Array.isArray(plan.steps) ? plan.steps : [],
    quant: (template && template.quant) || '',
    qual: (template && template.qual) || '',
    reflection: (template && template.reflection) || ''
  };
}

/* ============ تحميل ============ */
let crmLessonPlans = [];

async function loadLessonPlans(){
  const since = addDaysIso(localIsoDate(), -7);
  const { data, error } = await sb.from('lesson_plans').select('*')
    .eq('user_id', currentUser.id).eq('status', 'planned').gte('planned_date', since)
    .order('planned_date', { ascending: true });
  if(error) return null;
  crmLessonPlans = data || [];
  return crmLessonPlans;
}

/* الشعب والجدول قد لا تكون محمّلة إن لم تُفتح إدارة الصف في هذه الجلسة */
async function ensurePlanStructure(){
  if(!crmSections.length){
    let y = null, p = null;
    try{ y = localStorage.getItem('crm_year_part'); p = localStorage.getItem('crm_semester_part'); } catch(e){}
    if(y) document.getElementById('crmYearInput').value = y;
    if(p) document.getElementById('crmSemesterSelect').value = p;
    await loadCrmGradesAndSections();
  }
  if(!crmTimetableSlots.length) await loadCrmTimetable();
}

function planLessonLabel(p){
  if(!p.section_id) return 'بلا حصة محددة';
  return (p.period ? 'الحصة ' + p.period + ' · ' : '') + crmSectionLabel(p.section_id);
}

/* ============ إنشاء خطة من نموذج الشاهد ============ */
let crmPlanDraft = null;

async function openLessonPlanModal(){
  const opt = elementSelect.options[elementSelect.selectedIndex];
  if(!opt || !opt.value){ showToast('اختر عنصر الأداء أولًا', 'error'); return; }
  const steps = Array.from(stepsList.querySelectorAll('textarea')).map(t => t.value.trim()).filter(Boolean);
  const tplName = templateSelect.value !== '' ? templateSelect.options[templateSelect.selectedIndex].textContent.trim() : null;
  const description = descBox.value.trim();
  if(!description && !steps.length){ showToast('اختر نموذجًا أو اكتب وصف الخطة وخطواتها أولًا', 'error'); return; }
  try{ await ensurePlanStructure(); } catch(e){ /* بلا شعب: خطة بلا حصة */ }
  crmPlanDraft = {
    content: { element_key: opt.value, template_name: tplName, title: document.getElementById('mLesson').value.trim() || tplName || opt.textContent.trim(),
      description, goal: goalBox.value.trim(), steps },
    saving: false
  };
  const date = nextSchoolDay(localIsoDate());
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">📅 خطة لحصة قادمة</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">لا تُحسب شاهدًا حتى تنفّذها وتوثّقها.</div>
      <label class="crm-field-label">عنوان الخطة</label>
      <input class="goal-input" id="planTitle" maxlength="200" value="${escapeHtml(crmPlanDraft.content.title)}" style="margin-bottom:8px;">
      <label class="crm-field-label">التاريخ</label>
      <input type="date" class="goal-input" id="planDate" value="${date}" min="${localIsoDate()}" style="margin-bottom:8px;" onchange="renderPlanTargets()">
      <div class="crm-field-label">الحصة (اختياري — خطة لكل حصة تختارها)</div>
      <div id="planTargets"></div>
      <button class="btn btn-primary" id="planSaveBtn" style="width:100%;justify-content:center;margin-top:10px;" onclick="saveLessonPlan()">حفظ الخطة</button>
    </div>`, '440px');
  renderPlanTargets();
}

function renderPlanTargets(){
  const box = document.getElementById('planTargets');
  const dateEl = document.getElementById('planDate');
  if(!box || !dateEl) return;
  const date = dateEl.value;
  const lessons = date ? planLessonsForDay(crmTimetableSlots, date).filter(l => crmSectionById(l.section_id)) : [];
  if(lessons.length){
    box.innerHTML = lessons.map(l => `<label class="plan-target"><input type="checkbox" class="plan-target-cb" data-section="${l.section_id}" data-period="${l.period}">
      الحصة ${l.period} · ${escapeHtml(crmSectionLabel(l.section_id))}</label>`).join('');
  } else if(crmSections.length){
    box.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">لا حصص لك في جدول هذا اليوم — اختر الشعبة إن أردت:</div>' +
      crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }))
        .map(s => `<label class="plan-target"><input type="checkbox" class="plan-target-cb" data-section="${s.id}" data-period=""> ${escapeHtml(crmSectionOptionLabel(s))}</label>`).join('');
  } else {
    box.innerHTML = '<div style="font-size:11px;color:var(--muted);">بلا شعب مضافة — تُحفظ خطة بلا حصة محددة.</div>';
  }
}

async function saveLessonPlan(){
  const d = crmPlanDraft;
  if(!d || d.saving) return;
  const date = document.getElementById('planDate').value;
  if(!date || date < localIsoDate()){ showToast('اختر تاريخًا اليوم أو بعده', 'error'); return; }
  const title = document.getElementById('planTitle').value.trim();
  if(!title){ showToast('اكتب عنوان الخطة', 'error'); return; }
  const targets = [...document.querySelectorAll('.plan-target-cb')].filter(c => c.checked)
    .map(c => ({ section_id: c.dataset.section, period: c.dataset.period ? Number(c.dataset.period) : null }));
  d.saving = true;
  const btn = document.getElementById('planSaveBtn');
  if(btn) btn.disabled = true;
  const rows = buildPlanRows(Object.assign({}, d.content, { title }), date, targets, currentUser.id);
  const { error } = await sb.from('lesson_plans').insert(rows);
  if(error){
    showToast('تعذّر حفظ الخطة: ' + error.message, 'error');
    d.saving = false;
    if(btn) btn.disabled = false;
    return;
  }
  crmPlanDraft = null;
  closeCrmModal();
  formDirty = false;
  if(typeof clearDraft === 'function') clearDraft();
  showToast(rows.length > 1 ? `حُفظت ${rows.length} خطط ليوم ${date}` : `حُفظت الخطة ليوم ${date}`, 'ok');
  await showClassroomManagement(); /* تظهر في "اليوم" ضمن الخطط القادمة */
}

/* ============ العرض في "اليوم" ============ */
function lessonPlansTodayHtml(plans, todayIso){
  if(!plans) return '';
  const c = classifyPlans(plans, todayIso);
  if(!c.today.length && !c.upcoming.length && !c.overdue.length){
    return `<div class="crm-today-card"><div class="crm-today-title">📋 خططي</div>
      <div class="crm-today-empty">لا خطط قادمة. من نموذج الشاهد: اختر نموذجًا ثم "📅 احفظها كخطة لحصة قادمة". <a href="#" onclick="event.preventDefault();startNewShahid()">شاهد/خطة جديدة</a></div></div>`;
  }
  const row = (p, extra) => `<div class="crm-lesson-row"><span><a href="#" onclick="event.preventDefault();openLessonPlanView('${p.id}')">${escapeHtml(p.title)}</a>
      <span class="crm-tl-meta"> · ${escapeHtml(planLessonLabel(p))}${extra || ''}</span></span>
      <button class="btn btn-outline crm-mini-btn" onclick="openLessonPlanView('${p.id}')">فتح</button></div>`;
  let html = '<div class="crm-today-card"><div class="crm-today-title">📋 خططي</div>';
  if(c.overdue.length) html += `<div class="crm-field-label" style="color:#8A6D1F;">لم توثّق بعد (${c.overdue.length})</div>` + c.overdue.map(p => row(p, ' · ' + shortDateAr(p.planned_date))).join('');
  if(c.today.length) html += '<div class="crm-field-label">اليوم</div>' + c.today.map(p => row(p)).join('');
  if(c.upcoming.length) html += '<div class="crm-field-label">القادمة</div>' + c.upcoming.slice(0, 8).map(p => row(p, ' · ' + shortDateAr(p.planned_date))).join('');
  html += `<div style="margin-top:6px;"><a href="#" style="font-size:11.5px;" onclick="event.preventDefault();startNewShahid()">+ خطة جديدة</a></div></div>`;
  return html;
}

/* علامة الخطة تحت صف حصتها في "حصص اليوم" */
function planBadgeForLesson(plans, todayIso, sectionId, period){
  const p = (plans || []).find(x => x.status === 'planned' && x.planned_date === todayIso && x.section_id === sectionId && x.period === period);
  return p ? `<div class="crm-skip-note"><a href="#" onclick="event.preventDefault();openLessonPlanView('${p.id}')">📋 خطة: ${escapeHtml(p.title)}</a></div>` : '';
}

/* ============ عرض خطة / توثيقها / تأجيلها / إلغاؤها ============ */
let crmPlanBusy = false;

function openLessonPlanView(id){
  const p = crmLessonPlans.find(x => x.id === id);
  if(!p) return;
  const steps = Array.isArray(p.steps) ? p.steps : [];
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">📋 ${escapeHtml(p.title)}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${shortDateAr(p.planned_date)} · ${escapeHtml(planLessonLabel(p))} · ${escapeHtml(p.element_key)}</div>
      ${p.description ? `<div class="crm-field-label">الوصف</div><div class="plan-text">${escapeHtml(p.description)}</div>` : ''}
      ${p.goal ? `<div class="crm-field-label">الهدف</div><div class="plan-text">${escapeHtml(p.goal)}</div>` : ''}
      ${steps.length ? `<div class="crm-field-label">الخطوات</div><ol class="plan-steps">${steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin:10px 0 6px;" onclick="documentLessonPlan('${p.id}')">✅ نفّذتها ← وثّقها كشاهد</button>
      <details><summary style="font-size:12px;cursor:pointer;">لم أنفذها — تأجيل أو إلغاء</summary>
        <label class="crm-field-label" style="margin-top:8px;">موعد جديد</label>
        <input type="date" class="goal-input" id="planNewDate" value="${nextSchoolDay(localIsoDate())}" min="${localIsoDate()}" style="margin-bottom:6px;">
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline crm-mini-btn" style="flex:1;justify-content:center;" onclick="rescheduleLessonPlan('${p.id}')">تأجيل</button>
          <button class="btn btn-outline crm-mini-btn" style="flex:1;justify-content:center;color:#8A2C2C;" onclick="cancelLessonPlan('${p.id}')">إلغاء الخطة</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">التأجيل لا يربطها بحصة؛ أعد اختيار الحصة بإنشائها من جديد إن أردت.</div>
      </details>
    </div>`, '460px');
}

function documentLessonPlan(id){
  const p = crmLessonPlans.find(x => x.id === id);
  if(!p) return;
  const tpl = p.template_name ? (SHAHID_TEMPLATES[p.element_key] || []).find(t => t.name === p.template_name) : null;
  const f = buildPlanShahidFields(p, tpl, localIsoDate());
  closeCrmModal();
  startNewShahid();
  planShahidContext = { planId: p.id };
  document.getElementById('planBtn').style.display = 'none'; /* توثيق خطة — لا تُحفظ خطة مكررة منها */
  elementSelect.value = p.element_key;
  updateExample();
  document.getElementById('mLesson').value = p.title;
  document.getElementById('mDate').value = f.date;
  if(p.section_id && crmSectionById(p.section_id)) document.getElementById('mClass').value = crmSectionLabel(p.section_id);
  fillShahidFields({ description: f.description, goal: f.goal, steps: f.steps, quant: f.quant, qual: f.qual, reflection: f.reflection });
  formDirty = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('الخطة في نموذج الشاهد — أضف الأثر والصور ثم احفظ', 'ok');
}

async function rescheduleLessonPlan(id){
  if(crmPlanBusy) return;
  const date = (document.getElementById('planNewDate') || {}).value;
  if(!date || date < localIsoDate()){ showToast('اختر تاريخًا اليوم أو بعده', 'error'); return; }
  crmPlanBusy = true;
  const { error } = await sb.from('lesson_plans').update({ planned_date: date, period: null, updated_at: new Date().toISOString() })
    .eq('user_id', currentUser.id).eq('id', id).eq('status', 'planned');
  crmPlanBusy = false;
  if(error){ showToast('تعذّر التأجيل: ' + error.message, 'error'); return; }
  closeCrmModal();
  showToast('أُجّلت الخطة إلى ' + date, 'ok');
  renderCrmToday();
}

async function cancelLessonPlan(id){
  if(crmPlanBusy) return;
  closeCrmModal();
  const ok = await showConfirm('إلغاء هذه الخطة؟ لن تظهر في خططك بعد الآن.');
  if(!ok) return;
  crmPlanBusy = true;
  const { error } = await sb.from('lesson_plans').update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('user_id', currentUser.id).eq('id', id).eq('status', 'planned');
  crmPlanBusy = false;
  if(error){ showToast('تعذّر الإلغاء: ' + error.message, 'error'); return; }
  showToast('أُلغيت الخطة', 'ok');
  renderCrmToday();
}

/* من saveShahid بعد نجاح الحفظ: الخطة صارت "منفّذة" ومربوطة بشاهدها */
async function markLessonPlanDone(planId, shahidId){
  const { error } = await sb.from('lesson_plans').update({ status: 'done', shahid_id: shahidId, updated_at: new Date().toISOString() })
    .eq('user_id', currentUser.id).eq('id', planId);
  if(error) showToast('حُفظ الشاهد، لكن تعذّر تحديث حالة الخطة', 'error');
}

/* ============================================
   برامج الأنشطة الطلابية متعددة الحصص
   ============================================
   كيان خفيف يسمح للمعلم بتخطيط برنامج (مثل "الإسعافات الأولية") يُنفَّذ عبر
   عدة حصص موزّعة على أسابيع الفصل، ثم توثيق كل حصة تدريجيًا كشاهد مستقل —
   دون فقد تقدّم الحصص السابقة. البرنامج نفسه لا يُحسب كشاهد، فقط الحصص
   الموثَّقة فعليًا (عبر shawahid.program_id/program_session_no). */

let activityPrograms = [];
let currentProgramId = null;       // البرنامج المفتوح حاليًا في شاشة التفاصيل/تعديل الجدول
let editingProgramScheduleOnly = false; // true = نعدّل جدول برنامج موجود بدل إنشاء برنامج جديد

/* معرّفات الشُعب المرتبطة بكل برنامج (Map<programId, sectionId[]>) — محمَّلة
   هنا مرة واحدة مع كل البرامج، لا استعلام منفصل لكل برنامج بالقائمة (N+1).
   برنامج بلا شُعب مرتبطة (القيمة الافتراضية لأي برنامج قديم سابق لهذه
   الميزة) يحافظ على السلوك الأصلي بالكامل: شاهد واحد لكل حصة، بلا تغيير. */
let programSectionIdsMap = new Map();

async function loadActivityPrograms(){
  /* فلترة صريحة بمعرّف المستخدم ضرورية — نفس سبب فلترة loadMyShawahid */
  const [{ data, error }, linksRes] = await Promise.all([
    fetchAllRows((from, to) => sb
      .from('activity_programs')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .range(from, to)),
    sb.from('program_sections').select('program_id, section_id').eq('teacher_id', currentUser.id)
  ]);
  activityPrograms = error ? [] : (data || []);
  programSectionIdsMap = new Map();
  (linksRes.data || []).forEach(l => {
    if(!programSectionIdsMap.has(l.program_id)) programSectionIdsMap.set(l.program_id, []);
    programSectionIdsMap.get(l.program_id).push(l.section_id);
  });
  return !error;
}

async function showPrograms(){
  hideAllMainViews();
  setActiveBottomTab('work');
  document.getElementById('programsView').style.display = 'block';
  showProgramsSection('list');
  document.getElementById('programsListBody').innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  await loadActivityPrograms();
  renderProgramsList();
}

function showProgramsSection(section){
  document.getElementById('programsListSection').style.display = section === 'list' ? 'block' : 'none';
  document.getElementById('programsFormSection').style.display = section === 'form' ? 'block' : 'none';
  document.getElementById('programsDetailSection').style.display = section === 'detail' ? 'block' : 'none';
}

/* دالة صرفة: sectionIds فارغة (أو غير مُمرَّرة) = السلوك الأصلي بالكامل
   (قبل ميزة ربط الشُعب) — حصة واحدة = فتحة توثيق واحدة. لو البرنامج مرتبط
   بشُعب، كل حصة تحوي (عدد الشُعب) فتحات توثيق مستقلة (section_status)،
   فالإجمالي = عدد الحصص × عدد الشُعب — نسبة أدق تعكس التقدّم الحقيقي فورًا
   بدل انتظار اكتمال كل شُعب حصة واحدة (باتفاق صريح مع المستخدم). */
function programProgress(program, sectionIds){
  const sessions = program.sessions || [];
  const secCount = (sectionIds && sectionIds.length) || 0;
  if(!secCount){
    const total = program.total_sessions || sessions.length || 1;
    const done = sessions.filter(s => s.done).length;
    const pct = Math.round((done / total) * 100);
    return { done, total, pct, isDone: total > 0 && done >= total };
  }
  const total = (program.total_sessions || sessions.length || 1) * secCount;
  const done = sessions.reduce((sum, s) => sum + sectionIds.filter(id =>
    s.section_status && s.section_status[id] && s.section_status[id].done
  ).length, 0);
  const pct = Math.round((done / total) * 100);
  return { done, total, pct, isDone: total > 0 && done >= total };
}

/* عدد "فتحات التوثيق" غير المكتملة لحصص تقع تحديدًا بالأسبوع الحالي
   (مطابقة نصية لـweek_label — نفس تبسيط findSectionWeekConflicts المتفَق
   عليه مسبقًا)، لبطاقة "يحتاج إجراء الآن" بالرئيسية. برنامج بلا شُعب
   مرتبطة = فتحة واحدة لكل حصة غير موثَّقة؛ برنامج بشُعب = فتحة لكل شعبة
   غير موثَّقة ضمن الحصة. دالة صرفة: weekLabel فارغ (لم يُحدَّد النطاق
   الجغرافي بعد) = صفر بلا أي خطأ. */
function countUndocumentedSessionsForWeek(programs, sectionIdsMap, weekLabel){
  if(!weekLabel) return 0;
  let count = 0;
  (programs || []).forEach(p => {
    const sectionIds = (sectionIdsMap && sectionIdsMap.get(p.id)) || [];
    (p.sessions || []).forEach(s => {
      if((s.week_label || '').trim() !== weekLabel) return;
      if(sectionIds.length){
        count += sectionIds.filter(id => !(s.section_status && s.section_status[id] && s.section_status[id].done)).length;
      } else if(!s.done){
        count += 1;
      }
    });
  });
  return count;
}

function renderProgramsList(){
  const body = document.getElementById('programsListBody');
  if(!activityPrograms.length){
    body.innerHTML = '<div class="empty-state">لا توجد برامج بعد. أضف برنامجك الأول لتخطيط حصصه وتوثيقها تدريجيًا.</div>';
    return;
  }
  body.innerHTML = activityPrograms.map(p => {
    const { done, total, pct, isDone } = programProgress(p, programSectionIdsMap.get(p.id));
    const elLabel = (DB_ELEMENTS.find(e => e.key === p.element_key) || {}).label;
    return `<div class="rec">
      <div class="rec-top">
        <span class="rec-title">${escapeHtml(p.name)}</span>
        <span class="plan-badge-count ${isDone ? 'done' : ''}">${done}/${total}</span>
      </div>
      <div class="plan-progress-bar"><div class="plan-progress-fill ${isDone ? 'done' : ''}" style="width:${pct}%;"></div></div>
      <div class="plan-progress-text">
        <span>${elLabel ? 'مرتبط بعنصر: ' + escapeHtml(elLabel) : 'غير مرتبط بعنصر أداء'}</span>
        <span>${isDone ? '✓ اكتمل' : pct + '%'}</span>
      </div>
      <div class="rec-actions">
        <button class="btn btn-primary" onclick="showProgramDetail('${p.id}')">عرض</button>
        <button class="btn btn-outline" onclick="deleteActivityProgram('${p.id}')">حذف</button>
      </div>
    </div>`;
  }).join('');
}

/* ============ إنشاء برنامج جديد / تعديل جدول برنامج قائم ============ */
/* المسودة الحالية لحصص النموذج المفتوح (إنشاء أو تعديل جدول) — تبدأ بحصة
   واحدة فقط، والمعلم يضيف حصصًا أخرى براحته بزر "+ إضافة حصة" بدل إلزامه
   بعدد مسبق. session_no ثابت لكل حصة ولا يُعاد ترقيمه عند حذف حصة أخرى،
   حتى لا ينكسر ربط الحصص الموثَّقة فعليًا (shahid_id) بأرقامها. */
let pgSessionsDraft = [];

/* ============ ربط البرنامج بالشُعب (اختياري) ============
   استخدام فعلي للتخطيط لا مجرد توثيق: (1) عدّ الطلبة يُحسب تلقائيًا من
   عدد طلاب الشُعب المختارة النشطين، مع إمكانية التعديل اليدوي بعدها،
   (2) تحذير (لا منع) لو تكرر ربط نفس الشعبة ببرنامج آخر بنفس نص الأسبوع
   المخطَّط. الربط بمستوى البرنامج كاملاً (لا لكل حصة بمفردها) — نفس
   الشُعب تنطبق على كل حصصه عبر كل الأسابيع، باتفاق صريح مع المستخدم.
   لا نفلتر الشُعب بالسنة الدراسية هنا: classroom_sections.academic_year
   نص حر هجري ("1448-1449") يُدخله المعلم بنفسه، بينما activity_programs
   .cycle_year محسوب تلقائيًا بصيغة ميلادية مختلفة كليًا ("2026/2027") —
   مطابقتهما كانت ستُخفي شُعبًا حقيقية بصمت بسبب اختلاف الصيغة لا غيابها
   فعليًا، فنعرض كل شُعب المعلم بلا فلترة بالسنة. */
let pgCrmGradeLevels = [];
let pgCrmSections = [];
let pgSelectedSectionIds = [];

async function loadProgramFormSections(){
  const [{ data: grades, error: gErr }, { data: sections, error: sErr }] = await Promise.all([
    sb.from('classroom_grade_levels').select('*').eq('teacher_id', currentUser.id).order('created_at'),
    sb.from('classroom_sections').select('*').eq('teacher_id', currentUser.id).order('created_at')
  ]);
  pgCrmGradeLevels = gErr ? [] : (grades || []);
  pgCrmSections = sErr ? [] : (sections || []);
}

function renderProgramSectionPicker(){
  const box = document.getElementById('pgSectionsPicker');
  if(!box) return;
  if(!pgCrmSections.length){
    box.innerHTML = '<div style="font-size:11.5px;color:var(--muted);">لا توجد شُعب مسجَّلة بعد — يمكنك إضافتها من "إدارة الصف ← المراحل والشُعب"، أو تجاهل هذا الحقل والمتابعة بلا ربط.</div>';
    return;
  }
  box.innerHTML = pgCrmGradeLevels.map(g => {
    const secs = pgCrmSections.filter(s => s.grade_level_id === g.id);
    if(!secs.length) return '';
    return `<div style="margin-bottom:8px;">
      <div style="font-size:11.5px;font-weight:700;color:var(--navy);margin-bottom:4px;">${escapeHtml(g.name)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${secs.map(s => `<label style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;background:#F7F5F0;border:1px solid var(--line);padding:4px 8px;cursor:pointer;">
          <input type="checkbox" value="${s.id}" ${pgSelectedSectionIds.includes(s.id) ? 'checked' : ''} onchange="toggleProgramSection('${s.id}', this.checked)">
          الشعبة ${escapeHtml(s.name)}
        </label>`).join('')}
      </div>
    </div>`;
  }).join('') || '<div style="font-size:11.5px;color:var(--muted);">لا توجد شُعب مسجَّلة بعد.</div>';
}

async function toggleProgramSection(sectionId, checked){
  pgSelectedSectionIds = checked
    ? [...new Set([...pgSelectedSectionIds, sectionId])]
    : pgSelectedSectionIds.filter(id => id !== sectionId);
  await recomputeProgramStudentCountFromSections();
}

/* دالة صرفة: مطابقة نصية (grade_level/section_number) لا بمعرّف — نفس
   طريقة ربط الطالب بشعبته المستخدمة أصلًا بكل شاشات "إدارة الصف"
   (classroom_students لا يحمل عمود section_id، فقط نصًا حرًا يُملأ من
   اسم الشعبة وقت إضافة الطالب). */
function countActiveStudentsInSections(students, selectedSections){
  return (students || []).filter(s => s.is_active && (selectedSections || []).some(sel =>
    (s.grade_level || '') === sel.grade_level_name && (s.section_number || '') === sel.section_name
  )).length;
}

async function recomputeProgramStudentCountFromSections(){
  const input = document.getElementById('pgStudentCount');
  if(!input) return;
  if(!pgSelectedSectionIds.length) return; /* لا نمسح رقمًا أدخله المعلم يدويًا لو أزال آخر شعبة محدَّدة */
  const selectionAtCallTime = pgSelectedSectionIds; /* احتياطًا: لو بدّل المعلم الاختيار بسرعة قبل
    اكتمال هذا الاستعلام (نقر عدة مربّعات متتالية)، لا نطبّق نتيجة اختيار قديم فوق اختيار أحدث منه */
  const selectedSections = selectionAtCallTime.map(id => {
    const sec = pgCrmSections.find(s => s.id === id);
    const grade = sec ? pgCrmGradeLevels.find(g => g.id === sec.grade_level_id) : null;
    return { grade_level_name: grade ? grade.name : '', section_name: sec ? sec.name : '' };
  });
  const { data: students, error } = await sb.from('classroom_students').select('grade_level, section_number, is_active').eq('teacher_id', currentUser.id);
  if(error) return; /* فشل صامت — لا نمنع المتابعة، المعلم يقدر يُدخل الرقم يدويًا */
  if(pgSelectedSectionIds !== selectionAtCallTime) return; /* تغيّر الاختيار أثناء الانتظار — نداء أحدث سيتولى التحديث الصحيح */
  input.value = countActiveStudentsInSections(students || [], selectedSections);
}

/* دالة صرفة: تحذير فقط (لا منع حفظ) — مطابقة نصية مباشرة لـweek_label
   بين برامج مختلفة تشترك بنفس الشعبة. لا حل للتاريخ الفعلي عبر التقويم
   الرسمي عمدًا (تبسيط مقبول لتحذير استرشادي): لو برنامجان كتبا نفس نص
   الأسبوع ("الأسبوع الخامس") لنفس الشعبة، هذا تعارض محتمل يستحق تنبيهًا،
   بصرف النظر عن أي حل دقيق للتاريخ. */
function findSectionWeekConflicts(currentProgramId, currentSectionIds, currentWeekLabels, otherProgramsWithSections){
  const weekSet = new Set((currentWeekLabels || []).map(w => (w || '').trim()).filter(Boolean));
  const sectionSet = new Set(currentSectionIds || []);
  if(!weekSet.size || !sectionSet.size) return [];
  const conflicts = [];
  (otherProgramsWithSections || []).forEach(p => {
    if(String(p.id) === String(currentProgramId)) return;
    const sharedSection = (p.sectionIds || []).some(id => sectionSet.has(id));
    if(!sharedSection) return;
    const sharedWeeks = [...new Set((p.sessions || [])
      .map(s => (s.week_label || '').trim())
      .filter(w => w && weekSet.has(w)))];
    if(sharedWeeks.length) conflicts.push({ programName: p.name, weeks: sharedWeeks });
  });
  return conflicts;
}

/* يُستدعى قبل الحفظ مباشرة — يجلب روابط بقية برامج نفس المعلم بالشُعب
   (جدول program_sections) ليبني مدخلات findSectionWeekConflicts، ثم
   يعرض تحذيرًا (Toast) لو وُجد تعارض بلا أي منع للحفظ. */
async function warnOnSectionWeekConflicts(programId, sessionsPlan){
  if(!pgSelectedSectionIds.length) return;
  const { data: links, error } = await sb.from('program_sections').select('program_id, section_id').eq('teacher_id', currentUser.id);
  if(error) return; /* تحذير استرشادي فقط — فشل الفحص لا يوقف الحفظ */
  const sectionIdsByProgram = new Map();
  (links || []).forEach(l => {
    if(!sectionIdsByProgram.has(l.program_id)) sectionIdsByProgram.set(l.program_id, []);
    sectionIdsByProgram.get(l.program_id).push(l.section_id);
  });
  const otherProgramsWithSections = activityPrograms.map(p => ({
    id: p.id, name: p.name, sessions: p.sessions, sectionIds: sectionIdsByProgram.get(p.id) || []
  }));
  const conflicts = findSectionWeekConflicts(programId, pgSelectedSectionIds, sessionsPlan.map(s => s.week_label), otherProgramsWithSections);
  if(conflicts.length){
    const detail = conflicts.map(c => `"${c.programName}" (${c.weeks.join('، ')})`).join(' — ');
    showToast(`تنبيه تعارض جدولة: شعبة مرتبطة أيضًا ببرنامج آخر بنفس الأسبوع: ${detail}`, 'error');
  }
}

/* يحفظ ربط البرنامج بالشُعب فعليًا بعد نجاح حفظ البرنامج نفسه — حذف كامل
   ثم إعادة إدراج (بسيط وآمن لجدول ربط صغير)، بفلترة teacher_id صريحة
   إضافية رغم اعتماد RLS أصلًا (نفس نمط بقية حذف/إدراج هذا الملف). */
async function saveProgramSectionLinks(programId){
  const { error: delErr } = await sb.from('program_sections').delete().eq('program_id', programId).eq('teacher_id', currentUser.id);
  if(delErr) return; /* فشل تحديث الربط لا يجب أن يُفشل رسالة نجاح حفظ البرنامج نفسه */
  if(!pgSelectedSectionIds.length) return;
  await sb.from('program_sections').insert(
    pgSelectedSectionIds.map(sectionId => ({ teacher_id: currentUser.id, program_id: programId, section_id: sectionId }))
  );
}

function populateProgramElementSelect(){
  const select = document.getElementById('pgElementSelect');
  select.innerHTML = '<option value="">— بلا ربط —</option>' +
    DB_ELEMENTS.map(el => `<option value="${escapeHtml(el.key)}">${escapeHtml(el.label)} (${el.weight}%)</option>`).join('');
}

async function showNewProgramForm(){
  currentProgramId = null;
  editingProgramScheduleOnly = false;
  document.getElementById('programFormTitle').textContent = 'برنامج جديد';
  document.getElementById('pgName').value = '';
  document.getElementById('pgName').disabled = false;
  document.getElementById('pgStudentCount').value = '';
  populateProgramElementSelect();
  document.getElementById('pgElementSelect').disabled = false;
  document.getElementById('pgSaveMsg').textContent = '';
  document.getElementById('pgSaveMsg').className = 'save-msg';
  pgSessionsDraft = [{ session_no: 1, week_label: '', done: false, done_date: null, shahid_id: null }];
  renderProgramScheduleRows();
  pgSelectedSectionIds = [];
  document.getElementById('pgSectionsPicker').textContent = 'جارٍ التحميل...';
  showProgramsSection('form');
  await loadProgramFormSections();
  if(currentProgramId !== null) return; /* المعلم فتح برنامجًا آخر للتعديل أثناء الانتظار */
  renderProgramSectionPicker();
}

function cancelProgramForm(){
  showProgramsSection(currentProgramId ? 'detail' : 'list');
}

function renderProgramScheduleRows(){
  const rows = document.getElementById('pgScheduleRows');
  rows.innerHTML = pgSessionsDraft.map((s, i) => `
    <li>
      <span class="num">${s.session_no}</span>
      <input type="text" class="goal-input pg-week-input" placeholder="مثال: الأسبوع الأول" value="${escapeHtml(s.week_label || '')}" oninput="updateProgramSessionWeek(${i}, this.value)">
      ${s.done
        ? `<span class="plan-badge-count done" style="flex:0 0 auto;">✓ موثَّقة</span>`
        : (pgSessionsDraft.length > 1 ? `<button type="button" class="remove-step" title="حذف الحصة" onclick="removeProgramSessionRow(${i})">×</button>` : '')}
    </li>`).join('');
}

function updateProgramSessionWeek(idx, value){
  if(pgSessionsDraft[idx]) pgSessionsDraft[idx].week_label = value;
}

function addProgramSessionRow(){
  /* يطابق قيد قاعدة البيانات check(total_sessions between 1 and 30) — بدون
     هذا التحقق هنا، تجاوز الحد يفشل عند الحفظ برسالة قاعدة بيانات خام غير
     مفهومة بدل رسالة عربية واضحة */
  if(pgSessionsDraft.length >= 30){
    showToast('الحد الأقصى لعدد حصص البرنامج الواحد هو 30 حصة', 'error');
    return;
  }
  const nextNo = pgSessionsDraft.length ? Math.max(...pgSessionsDraft.map(s => s.session_no)) + 1 : 1;
  pgSessionsDraft.push({ session_no: nextNo, week_label: '', done: false, done_date: null, shahid_id: null });
  renderProgramScheduleRows();
  const inputs = document.querySelectorAll('.pg-week-input');
  if(inputs.length) inputs[inputs.length - 1].focus();
}

function removeProgramSessionRow(idx){
  const s = pgSessionsDraft[idx];
  if(!s || s.done) return; /* لا يمكن حذف حصة موثَّقة فعلاً بشاهد */
  if(pgSessionsDraft.length <= 1) return; /* يبقى حصة واحدة على الأقل */
  pgSessionsDraft.splice(idx, 1);
  renderProgramScheduleRows();
}

async function editProgramSchedule(programId){
  const p = activityPrograms.find(x => String(x.id) === String(programId));
  if(!p) return;

  currentProgramId = p.id;
  editingProgramScheduleOnly = true;
  document.getElementById('programFormTitle').textContent = 'تعديل جدول: ' + p.name;
  document.getElementById('pgName').value = p.name;
  document.getElementById('pgName').disabled = true;
  document.getElementById('pgStudentCount').value = p.student_count || '';
  populateProgramElementSelect();
  document.getElementById('pgElementSelect').value = p.element_key || '';
  document.getElementById('pgElementSelect').disabled = true;
  document.getElementById('pgSaveMsg').textContent = '';
  document.getElementById('pgSaveMsg').className = 'save-msg';
  pgSessionsDraft = (p.sessions || []).map(s => ({ ...s }));
  renderProgramScheduleRows();
  pgSelectedSectionIds = [];
  document.getElementById('pgSectionsPicker').textContent = 'جارٍ التحميل...';
  showProgramsSection('form');

  const [, { data: links }] = await Promise.all([
    loadProgramFormSections(),
    sb.from('program_sections').select('section_id').eq('program_id', p.id).eq('teacher_id', currentUser.id)
  ]);
  if(currentProgramId !== p.id) return; /* المعلم فتح برنامجًا آخر للتعديل أثناء الانتظار */
  pgSelectedSectionIds = (links || []).map(l => l.section_id);
  renderProgramSectionPicker();
}

async function saveProgramForm(){
  const msg = document.getElementById('pgSaveMsg');
  msg.className = 'save-msg';
  msg.textContent = '';

  const isScheduleEditOnly = editingProgramScheduleOnly && currentProgramId;

  if(!isScheduleEditOnly){
    const name = document.getElementById('pgName').value.trim();
    if(!name){ msg.textContent = 'الرجاء كتابة اسم البرنامج.'; msg.className = 'save-msg error'; return; }
  }

  if(pgSessionsDraft.some(s => !s.week_label || !s.week_label.trim())){
    msg.textContent = 'الرجاء تحديد الأسبوع المخطَّط لكل حصة.';
    msg.className = 'save-msg error';
    return;
  }

  const sessionsPlan = pgSessionsDraft.map(s => ({ ...s, week_label: s.week_label.trim() }));

  const btn = document.getElementById('pgSaveBtn');
  btn.disabled = true;

  try{
    if(isScheduleEditOnly){
      /* نعيد قراءة الحالة الحالية من القاعدة مباشرة قبل الحفظ — لا نعتمد على
         المسودة المحلية وحدها (pgSessionsDraft نسخة أُخذت وقت فتح "تعديل
         الجدول"): لو وُثّقت حصة من جهاز/تبويب آخر بعد فتح النموذج وقبل حفظه،
         الحفظ بالمسودة القديمة فقط كان سيُصفّر تلك الحصة الموثَّقة حديثًا
         ويفقد ربطها بشاهدها الفعلي (بيانات ضائعة صامتة). */
      const { data: freshProg, error: fetchErr } = await sb.from('activity_programs').select('sessions').eq('id', currentProgramId).maybeSingle();
      if(fetchErr) throw fetchErr;
      const freshSessions = (freshProg && freshProg.sessions) || [];
      const freshBySessionNo = new Map(freshSessions.map(s => [s.session_no, s]));
      /* أي تقدّم فعلي بالحصة — إما الشكل القديم (s.done، برنامج بلا شُعب
         مرتبطة) أو الجديد (section_status، لأي شعبة واحدة على الأقل).
         بدون تغطية section_status هنا، نفس حادثة "بيانات ضائعة صامتة"
         الموثَّقة أعلاه تتكرر فعليًا لكل برنامج مرتبط بشُعب. */
      const hasProgress = s => !!s.done || Object.values(s.section_status || {}).some(v => v && v.done);

      const merged = sessionsPlan.map(s => {
        const fresh = freshBySessionNo.get(s.session_no);
        if(!fresh) return s;
        if(fresh.done) return { ...s, done: fresh.done, done_date: fresh.done_date, shahid_id: fresh.shahid_id };
        if(fresh.section_status) return { ...s, section_status: { ...(s.section_status || {}), ...fresh.section_status } };
        return s;
      });

      /* لو وُثّقت حصة (أو شعبة منها) من مكان آخر ثم أزالها المستخدم من هذا
         الجدول قبل الحفظ (لم يكن يعلم بتوثيقها وقت فتح التعديل)، لا نفقدها
         بصمت — نُعيدها بنهاية القائمة بدل حذفها فعليًا */
      const mergedSessionNos = new Set(merged.map(s => s.session_no));
      const reintroduced = freshSessions.filter(s => hasProgress(s) && !mergedSessionNos.has(s.session_no));
      const finalSessions = merged.concat(reintroduced);
      if(reintroduced.length){
        showToast('تنبيه: حصة تم توثيقها حديثًا من مكان آخر — أُعيدت للجدول تلقائيًا كي لا تُفقد', 'error');
      }

      /* student_count يُحفظ هنا أيضًا — خلل حقيقي سابق: الحقل ظاهر وقابل
         للتعديل بشاشة "تعديل الجدول" لكن لم يكن يُحفَظ إطلاقًا (الحفظ هنا
         كان يحدِّث sessions/total_sessions فقط)، فأي تعديل يدوي عليه، أو
         القيمة المحسوبة تلقائيًا من الشُعب أدناه، كانت تُفقد بصمت. */
      const studentCount = document.getElementById('pgStudentCount').value ? Number(document.getElementById('pgStudentCount').value) : null;
      const { error } = await sb.from('activity_programs')
        .update({ sessions: finalSessions, total_sessions: finalSessions.length, student_count: studentCount })
        .eq('id', currentProgramId);
      if(error) throw error;
      await warnOnSectionWeekConflicts(currentProgramId, finalSessions);
      await saveProgramSectionLinks(currentProgramId);
      await loadActivityPrograms();
      msg.textContent = 'تم تحديث الجدول ✓';
      msg.className = 'save-msg ok';
      showToast('تم تحديث الجدول بنجاح', 'ok');
      setTimeout(() => showProgramDetail(currentProgramId), 600);
    } else {
      const record = {
        user_id: currentUser.id,
        name: document.getElementById('pgName').value.trim(),
        total_sessions: sessionsPlan.length,
        student_count: document.getElementById('pgStudentCount').value ? Number(document.getElementById('pgStudentCount').value) : null,
        element_key: document.getElementById('pgElementSelect').value || null,
        cycle_year: getCycleYear(),
        sessions: sessionsPlan
      };
      const { data: inserted, error } = await sb.from('activity_programs').insert(record).select().single();
      if(error) throw error;
      await warnOnSectionWeekConflicts(inserted.id, sessionsPlan);
      await saveProgramSectionLinks(inserted.id);
      await loadActivityPrograms();
      msg.textContent = 'تم إنشاء البرنامج ✓';
      msg.className = 'save-msg ok';
      showToast('تم إنشاء البرنامج بنجاح', 'ok');
      setTimeout(() => showProgramDetail(inserted.id), 600);
    }
  } catch(err){
    msg.textContent = 'حدث خطأ أثناء الحفظ: ' + err.message;
    msg.className = 'save-msg error';
    showToast('حدث خطأ أثناء الحفظ', 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ============ تفاصيل البرنامج ============ */
/* {id, label}[] — لا نكتفي بالتسمية النصية هنا (خلافًا للإصدار السابق)
   لأن توثيق كل شعبة بمفردها (documentProgramSessionForSection) يحتاج
   معرّف الشعبة الفعلي، لا نصًا فقط. */
let programDetailSections = [];

async function loadProgramDetailSections(programId){
  const [{ data: links }] = await Promise.all([
    sb.from('program_sections').select('section_id').eq('program_id', programId).eq('teacher_id', currentUser.id),
    pgCrmSections.length ? Promise.resolve() : loadProgramFormSections()
  ]);
  const ids = (links || []).map(l => l.section_id);
  programDetailSections = ids.map(id => {
    const sec = pgCrmSections.find(s => s.id === id);
    const grade = sec ? pgCrmGradeLevels.find(g => g.id === sec.grade_level_id) : null;
    return sec ? { id, label: `${grade ? grade.name + ' - ' : ''}شعبة ${sec.name}` } : null;
  }).filter(Boolean);
}

async function showProgramDetail(programId){
  /* لازم hideAllMainViews + إظهار #programsView هنا صراحة (مثل showPrograms
     تمامًا) — لا نعتمد على كون #programsView ظاهرة أصلًا: هذي الدالة تُستدعى
     أيضًا من نموذج الشاهد (بعد توثيق حصة) وهو شاشة مختلفة تمامًا (#formView).
     بدون هذا، يبقى نموذج الشاهد ظاهرًا كما هو رغم نجاح الحفظ فعليًا، فيظن
     المستخدم أن الحفظ لم يتم ويضغط "حفظ" مرة أخرى — يحفظ شاهدًا مكررًا. */
  hideAllMainViews();
  setActiveBottomTab('work');
  document.getElementById('programsView').style.display = 'block';
  currentProgramId = programId;
  showProgramsSection('detail');
  document.getElementById('programDetailBody').innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  /* استعلامات مستقلة — بالتوازي بدل التتابع لتقليل زمن الانتظار على جلسة باردة */
  await Promise.all([
    activityPrograms.length ? Promise.resolve() : loadActivityPrograms(),
    myRecords.length ? Promise.resolve() : loadMyShawahid(),
    loadProgramDetailSections(programId),
  ]);
  if(String(currentProgramId) !== String(programId)) return; /* انتقل المعلم لبرنامج آخر أثناء الانتظار */
  renderProgramDetail(programId);
}

function renderProgramDetail(programId){
  const p = activityPrograms.find(x => String(x.id) === String(programId));
  const body = document.getElementById('programDetailBody');
  if(!p){ body.innerHTML = '<div class="empty-state">تعذّر إيجاد هذا البرنامج.</div>'; return; }

  document.getElementById('programDetailTitle').textContent = p.name;
  const sectionIds = programDetailSections.map(sec => sec.id);
  const { done, total, pct, isDone } = programProgress(p, sectionIds);
  const elLabel = (DB_ELEMENTS.find(e => e.key === p.element_key) || {}).label;

  /* برنامج مرتبط بشُعب: كل حصة تعرض بطاقة توثيق مستقلة لكل شعبة (باتفاق
     صريح مع المستخدم — كل شعبة تُدرَّس بوقتها الخاص غالبًا، فتُوثَّق
     بوقتها الخاص أيضًا)، بدل شاهد واحد يمثّل الحصة كاملة. برنامج بلا شُعب
     مرتبطة (sectionIds فارغة) يحافظ على السلوك الأصلي بالضبط. */
  const sessionsHtml = (p.sessions || []).map(s => {
    if(sectionIds.length){
      const rowsHtml = programDetailSections.map(sec => {
        const st = (s.section_status && s.section_status[sec.id]) || {};
        const statusBadge = st.done
          ? `<span class="plan-badge-count done">✓ وُثّقت${st.done_date ? ' — ' + escapeHtml(st.done_date) : ''}</span>`
          : `<span class="plan-badge-count">لم تُوثَّق بعد</span>`;
        const actionBtn = st.done
          ? `<button class="btn btn-outline" onclick="viewProgramSessionShahid('${escapeHtml(String(st.shahid_id || ''))}')">عرض</button>
             <button class="btn btn-outline" onclick="deleteProgramSessionShahid('${escapeHtml(String(st.shahid_id || ''))}', '${p.id}')" style="color:#8A2C2C;border-color:#8A2C2C;">حذف</button>`
          : `<button class="btn btn-primary" onclick="documentProgramSessionForSection('${p.id}', ${s.session_no}, '${sec.id}')">توثيق</button>`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:7px 0;border-top:1px dashed var(--line);">
          <span style="font-size:11.5px;">${escapeHtml(sec.label)}</span>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${statusBadge}${actionBtn}</div>
        </div>`;
      }).join('');
      return `<div class="goal-card">
        <div class="goal-card-head-top"><span class="plan-elem-name">الحصة ${s.session_no} — ${escapeHtml(s.week_label || '')}</span></div>
        ${rowsHtml}
      </div>`;
    }
    const statusBadge = s.done
      ? `<span class="plan-badge-count done">✓ وُثّقت${s.done_date ? ' — ' + escapeHtml(s.done_date) : ''}</span>`
      : `<span class="plan-badge-count">لم تُوثَّق بعد</span>`;
    const actionBtn = s.done
      ? `<button class="btn btn-outline" onclick="viewProgramSessionShahid('${escapeHtml(String(s.shahid_id || ''))}')">عرض الشاهد</button>
         <button class="btn btn-outline" onclick="deleteProgramSessionShahid('${escapeHtml(String(s.shahid_id || ''))}', '${p.id}')" style="color:#8A2C2C;border-color:#8A2C2C;">حذف الشاهد</button>`
      : `<button class="btn btn-primary" onclick="documentProgramSession('${p.id}', ${s.session_no})">توثيق هذه الحصة</button>`;
    return `<div class="goal-card">
      <div class="goal-card-head-top">
        <span class="plan-elem-name">الحصة ${s.session_no} — ${escapeHtml(s.week_label || '')}</span>
        ${statusBadge}
      </div>
      <div class="rec-actions">${actionBtn}</div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="plan-progress-bar"><div class="plan-progress-fill ${isDone ? 'done' : ''}" style="width:${pct}%;"></div></div>
    <div class="plan-progress-text">
      <span>${sectionIds.length ? 'فتحات التوثيق المكتملة' : 'الحصص الموثَّقة'}: <b>${done}</b> من <b>${total}</b></span>
      <span>${isDone ? '✓ اكتمل البرنامج' : pct + '%'}</span>
    </div>
    <div style="margin:12px 0 18px;font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:14px;">
      ${p.student_count ? `<span>عدد الطلبة: <b style="color:var(--navy);">${p.student_count}</b></span>` : ''}
      ${elLabel ? `<span>مرتبط بعنصر: <b style="color:var(--navy);">${escapeHtml(elLabel)}</b></span>` : ''}
      ${p.cycle_year ? `<span>السنة: <b style="color:var(--navy);">${escapeHtml(p.cycle_year)}</b></span>` : ''}
      ${programDetailSections.length ? `<span>الشُعب: <b style="color:var(--navy);">${escapeHtml(programDetailSections.map(sec => sec.label).join('، '))}</b></span>` : ''}
    </div>
    <div class="plan-goals-list">${sessionsHtml}</div>
    <div class="rec-actions" style="margin-top:18px;flex-wrap:wrap;">
      <button class="btn btn-outline" onclick="editProgramSchedule('${p.id}')">تعديل الجدول</button>
      <button class="btn btn-outline" onclick="printProgramSummary('${p.id}', event)">طباعة الملخص</button>
      <button class="btn btn-outline" onclick="exportProgramSummaryPdf('${p.id}', event)">تصدير PDF</button>
      <button class="btn btn-outline" onclick="deleteActivityProgram('${p.id}')" style="color:#8A2C2C;border-color:#8A2C2C;">حذف البرنامج</button>
    </div>
  `;
}

/* ============ توثيق حصة من برنامج — يفتح نموذج الشاهد المعتاد مُعبَّأ مسبقًا ============ */
function documentProgramSession(programId, sessionNo){
  const p = activityPrograms.find(x => String(x.id) === String(programId));
  if(!p) return;

  startNewShahid();
  programSessionContext = { programId: p.id, sessionNo };
  document.getElementById('mLesson').value = `${p.name} — الحصة ${sessionNo} من ${p.total_sessions}`;
  if(p.element_key){
    elementSelect.value = p.element_key;
    updateExample();
  }
  formDirty = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* توثيق حصة لشعبة واحدة بعينها — لبرنامج مرتبط بأكثر من شعبة، حيث كل
   شعبة تُوثَّق بوقتها الخاص بشاهد مستقل (باتفاق صريح مع المستخدم). يملأ
   "الصف/الفصل" تلقائيًا باسم الشعبة المحدَّدة — بدل الصف الافتراضي
   بالإعدادات الشخصية الذي لا علاقة له بالشعبة الفعلية المُدرَّسة. */
function documentProgramSessionForSection(programId, sessionNo, sectionId){
  const p = activityPrograms.find(x => String(x.id) === String(programId));
  if(!p) return;
  const sec = programDetailSections.find(s => s.id === sectionId);

  startNewShahid();
  programSessionContext = { programId: p.id, sessionNo, sectionId };
  document.getElementById('mClass').value = sec ? sec.label : '';
  document.getElementById('mLesson').value = `${p.name} — الحصة ${sessionNo} من ${p.total_sessions}${sec ? ' — ' + sec.label : ''}`;
  if(p.element_key){
    elementSelect.value = p.element_key;
    updateExample();
  }
  formDirty = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* تُستدعى من saveShahid (app-09) بعد نجاح إدراج شاهد يوثّق حصة من برنامج،
   ومن التراجع عن حذف شاهد كان موثِّقًا لحصة (deleteRecord) — تُحدِّث حالة
   الحصة في activity_programs.sessions دون التأثير على غيرها. doneDate
   اختياري (لتاريخ اليوم افتراضيًا) — يُستخدم للتراجع عن الحذف بنفس تاريخ
   التوثيق الأصلي بدل تاريخ اليوم. sectionId اختياري: لو موجود (برنامج
   مرتبط بشُعب)، التحديث يذهب لـsection_status[sectionId] بدل الحقول
   العلوية للحصة — بلا أي أثر على برامج بلا شُعب مرتبطة (سلوك أصلي كامل).
   نقرأ الحالة الحالية من القاعدة مباشرة (لا من activityPrograms المحمَّلة
   بالذاكرة) حتى تعمل الدالة حتى لو لم تُفتح شاشة "برامجي" أصلًا بهذه
   الجلسة، وحتى لا تُكتب فوق أي تعديل حصل على الجدول من مكان آخر (تبويب/جهاز
   آخر) بين وقت تحميل البرنامج ووقت حفظ الشاهد. */
async function markProgramSessionDone(programId, sessionNo, shahidId, doneDate, sectionId){
  const { data: prog, error: fetchErr } = await sb.from('activity_programs').select('sessions').eq('id', programId).maybeSingle();
  if(fetchErr || !prog){
    showToast('تم حفظ الشاهد، لكن تعذّر تحديث تقدّم البرنامج.', 'error');
    return;
  }
  const resolvedDate = doneDate || new Date().toISOString().slice(0, 10);

  const sessions = (prog.sessions || []).map(s => {
    if(s.session_no !== sessionNo) return s;
    if(sectionId){
      const section_status = { ...(s.section_status || {}), [sectionId]: { done: true, done_date: resolvedDate, shahid_id: shahidId } };
      return { ...s, section_status };
    }
    return { ...s, done: true, done_date: resolvedDate, shahid_id: shahidId };
  });

  const { error } = await sb.from('activity_programs').update({ sessions }).eq('id', programId);
  if(error){
    showToast('تم حفظ الشاهد، لكن تعذّر تحديث تقدّم البرنامج: ' + error.message, 'error');
    return;
  }
  const local = activityPrograms.find(p => String(p.id) === String(programId));
  if(local) local.sessions = sessions;
}

/* تُستدعى من deleteRecord (app-09) عند حذف شاهد كان يوثّق حصة من برنامج —
   تُعيد تلك الحصة (أو شعبتها المحدَّدة، لو sectionId موجودة) لحالة "لم
   تُوثَّق بعد" حتى تبقى قابلة لإعادة التوثيق، بدل أن تبقى عالقة للأبد على
   أنها موثَّقة بشاهد لم يعد موجودًا. تُرجع {done, done_date, shahid_id}
   كما كانت قبل التفريغ (لاستخدامها بالتراجع عن الحذف إن حصل) — نفس الشكل
   بالحالتين (الحصة كاملة أو شعبة بعينها) حتى يبقى المستدعي (deleteRecord)
   موحَّدًا بلا تفرّع. */
async function clearProgramSessionLink(programId, sessionNo, sectionId){
  const { data: prog, error: fetchErr } = await sb.from('activity_programs').select('sessions').eq('id', programId).maybeSingle();
  if(fetchErr || !prog) return null;

  const sessions = prog.sessions || [];
  const session = sessions.find(s => s.session_no === sessionNo) || null;
  const previous = sectionId
    ? (session && session.section_status && session.section_status[sectionId]) || null
    : session;

  const updated = sessions.map(s => {
    if(s.session_no !== sessionNo) return s;
    if(sectionId){
      const section_status = { ...(s.section_status || {}) };
      delete section_status[sectionId];
      return { ...s, section_status };
    }
    return { ...s, done: false, done_date: null, shahid_id: null };
  });

  const { error } = await sb.from('activity_programs').update({ sessions: updated }).eq('id', programId);
  if(error) return previous; /* حتى لو فشل التحديث، previous معروفة فعلًا من الجلب أعلاه —
    تفيد المتصل (تراجع عن الحذف) باستعادة التاريخ الأصلي بدل تاريخ اليوم، حتى لو تعذّر
    تفريغ الحصة فعليًا بالقاعدة (فشل مستقل عن مجرد معرفة قيمتها السابقة) */

  const local = activityPrograms.find(p => String(p.id) === String(programId));
  if(local) local.sessions = updated;
  return previous;
}

function viewProgramSessionShahid(shahidId){
  if(!shahidId){ showToast('تعذّر إيجاد هذا الشاهد', 'error'); return; }
  const rec = myRecords.find(r => String(r.id) === String(shahidId));
  if(!rec){ showToast('تعذّر إيجاد هذا الشاهد', 'error'); return; }
  editRecord(shahidId);
}

/* حذف شاهد يوثّق حصة من برنامج، مباشرة من شاشة "برامجي" — بلا حاجة للذهاب
   إلى "شواهدي". تُعيد استخدام deleteRecord (app-09) بكل منطقها الحالي
   (تأكيد، تراجع لبضع ثوانٍ، تنظيف الصور) بدل تكرارها، مع afterDelete
   لإعادة رسم تفاصيل البرنامج فورًا فتظهر الحصة "لم تُوثَّق بعد" مباشرة —
   بدل انتظار انتهاء مهلة التراجع كاملة (٥ ثوانٍ). */
function deleteProgramSessionShahid(shahidId, programId){
  if(!shahidId){ showToast('تعذّر إيجاد هذا الشاهد', 'error'); return; }
  /* afterDelete قد يُستدعى بعد ثوانٍ (خصوصًا لو تراجع المستخدم خلال مهلة
     التراجع الخمس)، وخلالها قد يكون المستخدم انتقل لتفاصيل برنامج آخر —
     re-render بلا هذا التحقق يستبدل شاشة البرنامج المفتوحة فعليًا حاليًا
     ببيانات البرنامج القديم بالخطأ (نفس #programDetailBody للجميع). */
  return deleteRecord(shahidId, () => {
    if(String(currentProgramId) === String(programId)) renderProgramDetail(programId);
  });
}

async function deleteActivityProgram(id){
  const ok = await showConfirm('حذف هذا البرنامج؟ الشواهد المرتبطة بحصصه المُوثَّقة تبقى محفوظة في "الشواهد".');
  if(!ok) return;

  const { error } = await sb.from('activity_programs').delete().eq('id', id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }

  activityPrograms = activityPrograms.filter(p => String(p.id) !== String(id));
  showToast('تم حذف البرنامج', 'ok');
  showPrograms();
}

/* ============ تصدير ملخص البرنامج — تصميم أصلي خفيف واحترافي (ليس نسخة من النموذج الرسمي) ============ */
function metaCellProgram(label, value){
  return `<div style="flex:1 1 33%;padding:8px 12px;border-left:1px solid #D8D2C4;box-sizing:border-box;">
    <div style="font-size:8.5px;color:#6B6659;margin-bottom:3px;">${escapeHtml(label)}</div>
    <div style="font-size:11px;color:#232323;">${escapeHtml(value || '—')}</div>
  </div>`;
}
function sectionProgram(title, bodyHtml){
  return `<div style="padding:9px 28px;border-bottom:1px solid #D8D2C4;">
    <div style="font-size:11.5px;font-weight:700;color:#1B3245;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
      <span style="width:4px;height:12px;background:#A9852E;display:inline-block;"></span>${escapeHtml(title)}
    </div>
    ${bodyHtml}
  </div>`;
}
function buildProgramSummaryHtml(program){
  const sectionIds = programDetailSections.map(sec => sec.id);
  const { done, total, pct, isDone } = programProgress(program, sectionIds);
  const elLabel = (DB_ELEMENTS.find(e => e.key === program.element_key) || {}).label;
  const teacherName = (currentUser.user_metadata && currentUser.user_metadata.full_name) || '';

  const rowsHtml = sectionIds.length
    ? (program.sessions || []).flatMap(s => programDetailSections.map(sec => {
        const st = (s.section_status && s.section_status[sec.id]) || {};
        return `<tr style="border-bottom:1px solid #D8D2C4;">
          <td style="padding:8px 10px;font-size:10.5px;text-align:center;">${s.session_no}</td>
          <td style="padding:8px 10px;font-size:10.5px;">${escapeHtml(s.week_label || '—')}</td>
          <td style="padding:8px 10px;font-size:10.5px;">${escapeHtml(sec.label)}</td>
          <td style="padding:8px 10px;font-size:10.5px;text-align:center;">${st.done ? '✓ وُثّقت' : '—'}</td>
          <td style="padding:8px 10px;font-size:10.5px;text-align:center;">${escapeHtml(st.done_date || '—')}</td>
        </tr>`;
      })).join('')
    : (program.sessions || []).map(s => `
      <tr style="border-bottom:1px solid #D8D2C4;">
        <td style="padding:8px 10px;font-size:10.5px;text-align:center;">${s.session_no}</td>
        <td style="padding:8px 10px;font-size:10.5px;">${escapeHtml(s.week_label || '—')}</td>
        <td style="padding:8px 10px;font-size:10.5px;text-align:center;">${s.done ? '✓ وُثّقت' : '—'}</td>
        <td style="padding:8px 10px;font-size:10.5px;text-align:center;">${escapeHtml(s.done_date || '—')}</td>
      </tr>`).join('');

  return `
  <div dir="rtl" style="width:794px;background:#fff;font-family:'Cairo',sans-serif;color:#232323;box-sizing:border-box;">
    <div style="background:#1B3245;padding:18px 28px;border-bottom:4px solid #A9852E;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-family:'Amiri',serif;font-size:21px;color:#fff;font-weight:700;">ملخص برنامج نشاط طلابي</div>
      <div style="font-size:10.5px;color:#C9D2DA;">${isDone ? 'مكتمل ✓' : `${pct}% مكتمل`}</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;border-bottom:1px solid #D8D2C4;">
      ${metaCellProgram('اسم البرنامج', program.name)}
      ${metaCellProgram('المعلم', teacherName)}
      ${metaCellProgram('عدد الحصص', String(program.total_sessions))}
      ${metaCellProgram('عدد الطلبة', program.student_count ? String(program.student_count) : '—')}
      ${metaCellProgram('العنصر المرتبط', elLabel || '—')}
      ${metaCellProgram('السنة الدراسية', program.cycle_year || '—')}
      ${metaCellProgram('الشُعب', programDetailSections.length ? programDetailSections.map(sec => sec.label).join('، ') : '—')}
    </div>
    ${sectionProgram('جدول الحصص وحالة التوثيق', `
      <table style="width:100%;border-collapse:collapse;background:#F1EEE6;">
        <thead>
          <tr style="border-bottom:1px solid #D8D2C4;">
            <th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:center;">الحصة</th>
            <th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:right;">الأسبوع المخطَّط</th>
            ${sectionIds.length ? '<th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:right;">الشعبة</th>' : ''}
            <th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:center;">الحالة</th>
            <th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:center;">تاريخ التوثيق</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`)}
    ${sectionProgram('التقدّم الإجمالي', `<div style="font-size:11px;">تم توثيق <b>${done}</b> من إجمالي <b>${total}</b> ${sectionIds.length ? 'فتحة توثيق' : 'حصص'} (${pct}%).</div>`)}
    <div style="padding:16px 28px 18px;max-width:220px;">
      <div style="border-top:1px solid #232323;padding-top:6px;font-size:10px;color:#6B6659;">توقيع المعلم</div>
    </div>
  </div>`;
}

function printProgramSummary(programId, evt){
  const p = activityPrograms.find(x => String(x.id) === String(programId));
  if(!p) return;
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    document.getElementById('printArea').innerHTML = buildProgramSummaryHtml(p);
    printNow();
  } finally { endExportBusy(btn); }
}

async function exportProgramSummaryPdf(programId, evt){
  const p = activityPrograms.find(x => String(x.id) === String(programId));
  if(!p) return;
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    await ensurePdfLibs();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const area = document.getElementById('pdfRenderArea');
    /* addPdfPage معرَّفة في app-08-admin.js (تُحمَّل قبل هذا الملف) */
    await addPdfPage(pdf, area, buildProgramSummaryHtml(p), { firstPage: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save(`Program-${dateStr}.pdf`);
    showToast('تم تصدير ملخص البرنامج بنجاح', 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + err.message, 'error');
  } finally {
    endExportBusy(btn);
  }
}

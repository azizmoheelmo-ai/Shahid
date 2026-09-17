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

async function loadActivityPrograms(){
  /* فلترة صريحة بمعرّف المستخدم ضرورية — نفس سبب فلترة loadMyShawahid */
  const { data, error } = await fetchAllRows((from, to) => sb
    .from('activity_programs')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .range(from, to));
  activityPrograms = error ? [] : (data || []);
  return !error;
}

async function showPrograms(){
  hideAllMainViews();
  setActiveBottomTab(null);
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

function programProgress(program){
  const sessions = program.sessions || [];
  const total = program.total_sessions || sessions.length || 1;
  const done = sessions.filter(s => s.done).length;
  const pct = Math.round((done / total) * 100);
  return { done, total, pct, isDone: total > 0 && done >= total };
}

function renderProgramsList(){
  const body = document.getElementById('programsListBody');
  if(!activityPrograms.length){
    body.innerHTML = '<div class="empty-state">لا توجد برامج بعد. أضف برنامجك الأول لتخطيط حصصه وتوثيقها تدريجيًا.</div>';
    return;
  }
  body.innerHTML = activityPrograms.map(p => {
    const { done, total, pct, isDone } = programProgress(p);
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

function populateProgramElementSelect(){
  const select = document.getElementById('pgElementSelect');
  select.innerHTML = '<option value="">— بلا ربط —</option>' +
    DB_ELEMENTS.map(el => `<option value="${escapeHtml(el.key)}">${escapeHtml(el.label)} (${el.weight}%)</option>`).join('');
}

function showNewProgramForm(){
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
  showProgramsSection('form');
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

function editProgramSchedule(programId){
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
  showProgramsSection('form');
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
      const { error } = await sb.from('activity_programs')
        .update({ sessions: sessionsPlan, total_sessions: sessionsPlan.length })
        .eq('id', currentProgramId);
      if(error) throw error;
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
async function showProgramDetail(programId){
  /* لازم hideAllMainViews + إظهار #programsView هنا صراحة (مثل showPrograms
     تمامًا) — لا نعتمد على كون #programsView ظاهرة أصلًا: هذي الدالة تُستدعى
     أيضًا من نموذج الشاهد (بعد توثيق حصة) وهو شاشة مختلفة تمامًا (#formView).
     بدون هذا، يبقى نموذج الشاهد ظاهرًا كما هو رغم نجاح الحفظ فعليًا، فيظن
     المستخدم أن الحفظ لم يتم ويضغط "حفظ" مرة أخرى — يحفظ شاهدًا مكررًا. */
  hideAllMainViews();
  setActiveBottomTab(null);
  document.getElementById('programsView').style.display = 'block';
  currentProgramId = programId;
  showProgramsSection('detail');
  document.getElementById('programDetailBody').innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  if(!activityPrograms.length) await loadActivityPrograms();
  if(!myRecords.length) await loadMyShawahid();
  renderProgramDetail(programId);
}

function renderProgramDetail(programId){
  const p = activityPrograms.find(x => String(x.id) === String(programId));
  const body = document.getElementById('programDetailBody');
  if(!p){ body.innerHTML = '<div class="empty-state">تعذّر إيجاد هذا البرنامج.</div>'; return; }

  document.getElementById('programDetailTitle').textContent = p.name;
  const { done, total, pct, isDone } = programProgress(p);
  const elLabel = (DB_ELEMENTS.find(e => e.key === p.element_key) || {}).label;

  const sessionsHtml = (p.sessions || []).map(s => {
    const statusBadge = s.done
      ? `<span class="plan-badge-count done">✓ وُثّقت${s.done_date ? ' — ' + escapeHtml(s.done_date) : ''}</span>`
      : `<span class="plan-badge-count">لم تُوثَّق بعد</span>`;
    const actionBtn = s.done
      ? `<button class="btn btn-outline" onclick="viewProgramSessionShahid('${escapeHtml(String(s.shahid_id || ''))}')">عرض الشاهد</button>`
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
      <span>الحصص الموثَّقة: <b>${done}</b> من <b>${total}</b></span>
      <span>${isDone ? '✓ اكتمل البرنامج' : pct + '%'}</span>
    </div>
    <div style="margin:12px 0 18px;font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:14px;">
      ${p.student_count ? `<span>عدد الطلبة: <b style="color:var(--navy);">${p.student_count}</b></span>` : ''}
      ${elLabel ? `<span>مرتبط بعنصر: <b style="color:var(--navy);">${escapeHtml(elLabel)}</b></span>` : ''}
      ${p.cycle_year ? `<span>السنة: <b style="color:var(--navy);">${escapeHtml(p.cycle_year)}</b></span>` : ''}
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

/* تُستدعى من saveShahid (app-09) بعد نجاح إدراج شاهد يوثّق حصة من برنامج،
   ومن التراجع عن حذف شاهد كان موثِّقًا لحصة (deleteRecord) — تُحدِّث حالة
   الحصة في activity_programs.sessions دون التأثير على غيرها. doneDate
   اختياري (لتاريخ اليوم افتراضيًا) — يُستخدم للتراجع عن الحذف بنفس تاريخ
   التوثيق الأصلي بدل تاريخ اليوم.
   نقرأ الحالة الحالية من القاعدة مباشرة (لا من activityPrograms المحمَّلة
   بالذاكرة) حتى تعمل الدالة حتى لو لم تُفتح شاشة "برامجي" أصلًا بهذه
   الجلسة، وحتى لا تُكتب فوق أي تعديل حصل على الجدول من مكان آخر (تبويب/جهاز
   آخر) بين وقت تحميل البرنامج ووقت حفظ الشاهد. */
async function markProgramSessionDone(programId, sessionNo, shahidId, doneDate){
  const { data: prog, error: fetchErr } = await sb.from('activity_programs').select('sessions').eq('id', programId).maybeSingle();
  if(fetchErr || !prog){
    showToast('تم حفظ الشاهد، لكن تعذّر تحديث تقدّم البرنامج.', 'error');
    return;
  }

  const sessions = (prog.sessions || []).map(s => s.session_no === sessionNo
    ? { ...s, done: true, done_date: doneDate || new Date().toISOString().slice(0, 10), shahid_id: shahidId }
    : s);

  const { error } = await sb.from('activity_programs').update({ sessions }).eq('id', programId);
  if(error){
    showToast('تم حفظ الشاهد، لكن تعذّر تحديث تقدّم البرنامج: ' + error.message, 'error');
    return;
  }
  const local = activityPrograms.find(p => String(p.id) === String(programId));
  if(local) local.sessions = sessions;
}

/* تُستدعى من deleteRecord (app-09) عند حذف شاهد كان يوثّق حصة من برنامج —
   تُعيد تلك الحصة لحالة "لم تُوثَّق بعد" حتى تبقى قابلة لإعادة التوثيق، بدل
   أن تبقى عالقة للأبد على أنها موثَّقة بشاهد لم يعد موجودًا. تُرجع بيانات
   الحصة كما كانت قبل التفريغ (لاستخدامها في التراجع عن الحذف إن حصل). */
async function clearProgramSessionLink(programId, sessionNo){
  const { data: prog, error: fetchErr } = await sb.from('activity_programs').select('sessions').eq('id', programId).maybeSingle();
  if(fetchErr || !prog) return null;

  const sessions = prog.sessions || [];
  const previous = sessions.find(s => s.session_no === sessionNo) || null;
  const updated = sessions.map(s => s.session_no === sessionNo
    ? { ...s, done: false, done_date: null, shahid_id: null }
    : s);

  const { error } = await sb.from('activity_programs').update({ sessions: updated }).eq('id', programId);
  if(error) return null;

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

async function deleteActivityProgram(id){
  const ok = await showConfirm('حذف هذا البرنامج؟ الشواهد المرتبطة بحصصه المُوثَّقة تبقى محفوظة في "شواهدي".');
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
  const { done, total, pct, isDone } = programProgress(program);
  const elLabel = (DB_ELEMENTS.find(e => e.key === program.element_key) || {}).label;
  const teacherName = (currentUser.user_metadata && currentUser.user_metadata.full_name) || '';

  const rowsHtml = (program.sessions || []).map(s => `
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
    </div>
    ${sectionProgram('جدول الحصص وحالة التوثيق', `
      <table style="width:100%;border-collapse:collapse;background:#F1EEE6;">
        <thead>
          <tr style="border-bottom:1px solid #D8D2C4;">
            <th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:center;">الحصة</th>
            <th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:right;">الأسبوع المخطَّط</th>
            <th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:center;">الحالة</th>
            <th style="padding:8px 10px;font-size:9.5px;color:#6B6659;text-align:center;">تاريخ التوثيق</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`)}
    ${sectionProgram('التقدّم الإجمالي', `<div style="font-size:11px;">تم توثيق <b>${done}</b> من إجمالي <b>${total}</b> حصص (${pct}%).</div>`)}
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

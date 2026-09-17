/* ============ نشاط الحسابات (بلا تتبع IP) ============ */
function renderAdminActivity(){
  const box = document.getElementById('adminActivity');
  if(!box) return;
  if(!adminProfiles.length){
    box.innerHTML = '<div class="empty-state">لا يوجد معلمون مسجّلون بعد.</div>';
    return;
  }

  const now = Date.now();
  const rows = adminProfiles.map(p => {
    const lastLogin = p.last_login_at ? new Date(p.last_login_at) : null;
    const daysAgo = lastLogin ? Math.floor((now - lastLogin.getTime()) / (1000*60*60*24)) : null;

    /* آخر شاهد وثّقه */
    const recs = adminAllRecords.filter(r => r.user_id === p.id);
    const lastShahid = recs.length
      ? new Date(Math.max(...recs.map(r => new Date(r.created_at).getTime())))
      : null;

    let statusText, statusColor;
    if(daysAgo === null){ statusText = 'لم يدخل بعد'; statusColor = '#8A2C2C'; }
    else if(daysAgo === 0){ statusText = 'اليوم'; statusColor = '#215C34'; }
    else if(daysAgo <= 7){ statusText = `قبل ${daysAgo} يوم`; statusColor = '#215C34'; }
    else if(daysAgo <= 30){ statusText = `قبل ${daysAgo} يومًا`; statusColor = '#6B5420'; }
    else { statusText = `قبل ${Math.floor(daysAgo/30)} شهر`; statusColor = '#8A2C2C'; }

    return { p, daysAgo, statusText, statusColor, lastShahid };
  }).sort((a, b) => (a.daysAgo === null ? 9999 : a.daysAgo) - (b.daysAgo === null ? 9999 : b.daysAgo));

  const inactive = rows.filter(r => r.daysAgo === null || r.daysAgo > 30).length;

  box.innerHTML = `
    ${inactive ? `<div style="background:#FBF3E6;border-right:3px solid var(--gold);padding:9px 12px;margin-bottom:12px;font-size:12px;color:#6B5420;">
      <b>${inactive}</b> ${inactive === 1 ? 'حساب' : 'حسابات'} بلا نشاط منذ أكثر من شهر — قد تحتاج متابعة أو تعطيلًا.
    </div>` : ''}
    <div style="overflow-x:auto;">
      <table class="report-table">
        <thead><tr>
          <th>المعلم</th><th>آخر دخول</th><th>مرات الدخول</th><th>أيام نشطة</th><th>آخر شاهد</th>
        </tr></thead>
        <tbody>
          ${rows.map(({p, statusText, statusColor, lastShahid}) => `
            <tr>
              <td>${escapeHtml(p.full_name || p.email || 'بدون اسم')}</td>
              <td style="color:${statusColor};font-weight:700;">${statusText}</td>
              <td>${p.login_count || 0}</td>
              <td>${p.active_days || 0}</td>
              <td>${lastShahid ? lastShahid.toLocaleDateString('ar-SA') : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:10.5px;color:var(--muted);margin-top:8px;line-height:1.75;">
      بيانات استخدام أساسية تُجمع لأغراض المتابعة الإدارية وأمن الحسابات. لا يجمع النظام بيانات تتبّع للموقع الجغرافي أو الأجهزة.
    </p>`;
}

function renderAdminReadiness(){
  const box = document.getElementById('adminReadiness');
  if(!box) return;
  if(!adminProfiles.length){
    box.innerHTML = '<div class="empty-state">لا يوجد معلمون مسجّلون بعد.</div>';
    return;
  }

  const rows = adminProfiles.map(p => {
    const r = computeTeacherReadiness(p.id);
    const color = r.readiness >= 70 ? '#215C34' : (r.readiness >= 35 ? '#A9852E' : '#B23A3A');
    return { p, r, color };
  }).sort((a, b) => b.r.readiness - a.r.readiness);

  box.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="report-table">
        <thead><tr>
          <th>المعلم</th><th>الخطة</th><th>الشواهد</th><th>التوثيق الموزون</th><th>التقييم الذاتي</th><th>الجاهزية</th>
        </tr></thead>
        <tbody>
          ${rows.map(({p, r, color}) => `
            <tr>
              <td>${escapeHtml(p.full_name || p.email || 'بدون اسم')}</td>
              <td>${r.plannedCount}/${r.total}</td>
              <td>${r.shahidCount}</td>
              <td>${r.weightedPct}%</td>
              <td>${r.selfCount}/${r.total}</td>
              <td style="font-weight:800;color:${color};">${r.readiness}%</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:10.5px;color:var(--muted);margin-top:8px;line-height:1.75;">
      الجاهزية مؤشر مركّب = التخطيط (25%) + التوثيق الموزون (50%) + التقييم الذاتي (25%). يعكس مدى استعداد المعلم لجلسة التقييم، وليس درجة أداء رسمية.
    </p>`;
}

function renderAdminByElement(){
  const box = document.getElementById('adminByElement');
  if(!box) return;
  const elements = getElementsOrder();
  const counts = {};
  elements.forEach(e => counts[e.key] = 0);
  adminAllRecords.forEach(r => { if(counts[r.element_key] !== undefined) counts[r.element_key]++; });
  const max = Math.max(1, ...Object.values(counts));

  box.innerHTML = elements.map(e => {
    const { name } = splitLabel(e.label);
    const c = counts[e.key];
    const pct = Math.round((c / max) * 100);
    return `<div class="admin-elem-row">
      <span style="flex:0 0 170px;">${escapeHtml(name)}</span>
      <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%;"></div></div>
      <span style="flex:0 0 26px;text-align:left;font-weight:700;">${c}</span>
    </div>`;
  }).join('');
}

/* ============ إدارة المعلمين ============ */
function renderAdminProfiles(){
  const box = document.getElementById('adminProfilesList');
  if(!box) return;
  if(!adminProfiles.length){
    box.innerHTML = '<div class="empty-state">لا يوجد معلمون مسجّلون بعد.</div>';
    return;
  }
  box.innerHTML = adminProfiles.map(p => {
    const r = computeTeacherReadiness(p.id);
    return `
    <div class="profile-row ${p.disabled ? 'disabled-row' : ''}">
      <div>
        <div class="pr-name">${adminIds.has(p.id) ? '<span class="badge-admin">مسؤول</span>' : ''}${escapeHtml(p.full_name || 'بدون اسم')}</div>
        <div class="pr-sub">${escapeHtml(p.email || '')} — ${escapeHtml(p.school || '—')} — ${r.shahidCount} شاهد — جاهزية ${r.readiness}%</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-outline" style="padding:5px 10px;font-size:11px;" onclick="showTeacherDetail('${p.id}')">التفاصيل</button>
        <button class="btn btn-outline" style="padding:5px 10px;font-size:11px;" onclick="toggleTeacherDisabled('${p.id}', ${!p.disabled})">${p.disabled ? 'تفعيل' : 'تعطيل'}</button>
        ${adminIds.has(p.id)
          ? `<button class="btn btn-danger" style="padding:5px 10px;font-size:11px;" onclick="removeAdmin('${p.id}')">إزالة كمسؤول</button>`
          : ''}
      </div>
    </div>`;
  }).join('');
}

/* بطاقة تفصيلية لمعلم واحد: خطته وشواهده وتقييمه معًا */
function showTeacherDetail(uid){
  const p = adminProfiles.find(x => x.id === uid);
  if(!p) return;
  const elements = getElementsOrder();
  const plan = adminAllPlans[uid] || {};
  const self = adminAllSelf[uid] || {};
  const recs = adminAllRecords.filter(r => r.user_id === uid);
  const counts = {};
  recs.forEach(r => { counts[r.element_key] = (counts[r.element_key] || 0) + 1; });
  const r = computeTeacherReadiness(uid);

  const rows = elements.map(e => {
    const { name } = splitLabel(e.label);
    const pl = plan[e.key] || {};
    const sf = self[e.key] || {};
    const done = counts[e.key] || 0;
    const t = pl.target_count || 0;
    const statusColor = done === 0 ? '#B23A3A' : (t > 0 && done >= t ? '#215C34' : '#6B5420');
    return `<tr>
      <td style="padding:6px 8px;border:1px solid var(--line);font-size:11px;text-align:right;">${escapeHtml(name)}</td>
      <td style="padding:6px 8px;border:1px solid var(--line);font-size:11px;text-align:center;">${pl.target_level || '—'}</td>
      <td style="padding:6px 8px;border:1px solid var(--line);font-size:11px;text-align:center;color:${statusColor};font-weight:700;">${done}${t ? '/' + t : ''}</td>
      <td style="padding:6px 8px;border:1px solid var(--line);font-size:11px;text-align:center;">${sf.self_level || '—'}</td>
    </tr>`;
  }).join('');

  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${escapeHtml(p.full_name || p.email)}</h3>
      <p style="font-size:11.5px;color:var(--muted);margin:0 0 12px;">${escapeHtml(p.school || '—')} — ${escapeHtml(p.subject || '—')} • جاهزية ${r.readiness}%</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#F1EEE6;">
          <th style="padding:7px;border:1px solid var(--line);font-size:11px;">العنصر</th>
          <th style="padding:7px;border:1px solid var(--line);font-size:11px;">مستهدفه</th>
          <th style="padding:7px;border:1px solid var(--line);font-size:11px;">شواهده</th>
          <th style="padding:7px;border:1px solid var(--line);font-size:11px;">تقييمه</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`, '460px');
}

async function toggleTeacherDisabled(userId, disabledVal){
  try{
    const { error } = await sb.from('profiles').update({ disabled: disabledVal }).eq('id', userId);
    if(error) throw error;
    showToast(disabledVal ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب', 'ok');
    await showAdminPanel();
  } catch(err){
    showToast('تعذّر: ' + err.message, 'error');
  }
}

async function addAdminByEmail(){
  const email = document.getElementById('newAdminEmail').value.trim();
  const msg = document.getElementById('addAdminMsg');
  if(!email) return;
  msg.style.color = 'var(--muted)';
  msg.textContent = 'جارٍ البحث...';
  try{
    const { data: profile, error: pErr } = await sb.from('profiles').select('id').eq('email', email).maybeSingle();
    if(pErr) throw pErr;
    if(!profile){
      msg.style.color = '#8A2C2C';
      msg.textContent = 'ما فيه معلم مسجّل بهذا الإيميل. يجب أن ينشئ حسابًا أولًا.';
      return;
    }
    const { error } = await sb.from('admins').insert({ user_id: profile.id });
    if(error) throw error;
    msg.style.color = '#215C34';
    msg.textContent = 'تمت إضافته كمسؤول ✓';
    document.getElementById('newAdminEmail').value = '';
    showToast('تمت إضافة مسؤول جديد', 'ok');
    await showAdminPanel();
  } catch(err){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'خطأ: ' + err.message;
  }
}

async function removeAdmin(userId){
  if(userId === currentUser.id){
    showToast('لا يمكنك إزالة نفسك من المسؤولين.', 'error');
    return;
  }
  const ok = await showConfirm('إزالة هذا المستخدم من قائمة المسؤولين؟');
  if(!ok) return;
  try{
    const { error } = await sb.from('admins').delete().eq('user_id', userId);
    if(error) throw error;
    showToast('تمت الإزالة', 'ok');
    await showAdminPanel();
  } catch(err){
    showToast('تعذّر: ' + err.message, 'error');
  }
}

/* ============ كل الشواهد حسب المعلم ============ */
function renderAdminTeachers(){
  const box = document.getElementById('adminTeachersList');
  if(!box) return;
  if(!adminAllRecords.length){
    box.innerHTML = '<div class="empty-state">لا توجد شواهد بعد من أي معلم.</div>';
    return;
  }
  const groups = {};
  adminAllRecords.forEach(r => {
    const key = r.user_id;
    if(!groups[key]) groups[key] = { name: r.teacher_name || 'بدون اسم', email: r.teacher_email || '', items: [] };
    groups[key].items.push(r);
  });

  box.innerHTML = Object.entries(groups).map(([uid, g], idx) => `
    <div class="criterion-group" id="admgrp-${idx}">
      <div class="criterion-head" onclick="toggleGroup('admgrp-${idx}')">
        <div class="left">
          <span class="dot"></span>
          <span class="name">${escapeHtml(g.name)}</span>
          <span class="weight">${escapeHtml(g.email)}</span>
        </div>
        <div class="left">
          <span class="count">${g.items.length}</span>
          <span class="chevron">▾</span>
        </div>
      </div>
      <div class="criterion-body">${g.items.map(adminRenderRecCard).join('')}</div>
    </div>`).join('');
}

function adminRenderRecCard(r){
  const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-SA') : '';
  const photos = (r.photo_urls || []);
  const photosHtml = photos.length
    ? '<div class="rec-photos">' + photos.map(u => `<img src="${escapeHtml(u)}">`).join('') + '</div>' : '';
  const descSnippet = (r.description || '').slice(0, 140);
  const title = r.lesson_title || r.class_name || 'بدون عنوان';
  const refLine = r.ref_number ? `<div class="rec-ref">الرقم المرجعي: <b>${escapeHtml(r.ref_number)}</b></div>` : '';

  return `
    <div class="rec">
      ${refLine}
      <div class="rec-top">
        <span class="rec-title">${escapeHtml(r.element_label || '')} — ${escapeHtml(title)}</span>
        <span class="rec-date">${date}</span>
      </div>
      <div class="rec-desc">${escapeHtml(descSnippet)}${(r.description||'').length > 140 ? '…' : ''}</div>
      ${photosHtml}
      <div class="rec-actions">
        <button class="btn btn-outline" onclick="adminPrintRecord('${r.id}', event)">طباعة</button>
        <button class="btn btn-danger" onclick="adminDeleteRecord('${r.id}')">حذف</button>
      </div>
    </div>`;
}

function adminPrintRecord(id, evt){
  const rec = adminAllRecords.find(r => String(r.id) === String(id));
  if(!rec) return;
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    document.getElementById('printArea').innerHTML = buildPdfHtml(rec, rec.photo_urls || []);
    printNow();
  } finally { endExportBusy(btn); }
}

async function adminDeleteRecord(id){
  const ok = await showConfirm('حذف هذا الشاهد نهائيًا من حساب المعلم؟ لا يمكن التراجع.');
  if(!ok) return;
  try{
    const { error } = await sb.from('shawahid').delete().eq('id', id);
    if(error) throw error;
    showToast('تم حذف الشاهد', 'ok');
    await showAdminPanel();
  } catch(err){
    showToast('تعذّر الحذف: ' + err.message, 'error');
  }
}

/* ============ سجل النشاط ============ */
async function loadAuditLog(){
  const box = document.getElementById('auditLogList');
  if(!box) return;
  box.innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  const { data, error } = await sb.from('audit_log')
    .select('*').order('created_at', { ascending: false }).limit(50);
  if(error){
    box.innerHTML = '<div class="empty-state">تعذّر التحميل: ' + error.message + '</div>';
    return;
  }
  if(!data || !data.length){
    box.innerHTML = '<div class="empty-state">لا يوجد نشاط مسجّل بعد.</div>';
    return;
  }
  box.innerHTML = data.map(item => {
    const date = new Date(item.created_at).toLocaleString('ar-SA');
    const d = item.details || {};
    return `<div class="report-detail-item">
      <span><b>${escapeHtml(item.performed_by_email || 'غير معروف')}</b> حذف شاهدًا (${escapeHtml(d.element_label || '')}) للمعلم <b>${escapeHtml(d.teacher_name || '')}</b></span>
      <span style="color:var(--muted);">${date}</span>
    </div>`;
  }).join('');
}

/* ============ إدارة عناصر الأداء ============ */
async function loadElementsMgmt(){
  const box = document.getElementById('elementsMgmtList');
  if(!box) return;
  box.innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  const { data, error } = await sb.from('performance_elements').select('*').order('sort_order', { ascending: true });
  if(error){
    box.innerHTML = '<div class="empty-state">تعذّر التحميل: ' + error.message + '</div>';
    return;
  }
  box.innerHTML = (data || []).map(el => `
    <div class="elem-mgmt-row" data-id="${el.id}">
      <input type="text" class="goal-input" maxlength="150" value="${escapeHtml(el.label)}" id="elLabel-${el.id}">
      <input type="number" class="goal-input" value="${el.weight}" id="elWeight-${el.id}">
      <button class="btn btn-outline" style="padding:5px 10px;font-size:11px;" onclick="savePerformanceElement('${el.id}')">حفظ</button>
      <button class="btn btn-danger" style="padding:5px 10px;font-size:11px;" onclick="deletePerformanceElement('${el.id}')">حذف</button>
    </div>`).join('');
}

async function savePerformanceElement(id){
  const label = document.getElementById('elLabel-' + id).value.trim();
  const weight = Number(document.getElementById('elWeight-' + id).value) || 0;
  try{
    const { error } = await sb.from('performance_elements').update({ label, weight }).eq('id', id);
    if(error) throw error;
    showToast('تم الحفظ', 'ok');
    loadPerformanceElements();
  } catch(err){
    showToast('تعذّر الحفظ: ' + err.message, 'error');
  }
}

async function deletePerformanceElement(id){
  const ok = await showConfirm('حذف هذا العنصر من القائمة؟ الشواهد القديمة المرتبطة به تبقى محفوظة.');
  if(!ok) return;
  try{
    const { error } = await sb.from('performance_elements').delete().eq('id', id);
    if(error) throw error;
    showToast('تم الحذف', 'ok');
    loadElementsMgmt();
    loadPerformanceElements();
  } catch(err){
    showToast('تعذّر الحذف: ' + err.message, 'error');
  }
}

async function addPerformanceElement(){
  const label = document.getElementById('newElementLabel').value.trim();
  const weight = Number(document.getElementById('newElementWeight').value) || 10;
  if(!label){ showToast('اكتب اسم العنصر أولًا.', 'error'); return; }
  try{
    const { data: maxRow } = await sb.from('performance_elements').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const nextOrder = maxRow ? (maxRow.sort_order || 0) + 1 : 1;
    const { error } = await sb.from('performance_elements').insert({ key: label, label, weight, sort_order: nextOrder });
    if(error) throw error;
    document.getElementById('newElementLabel').value = '';
    document.getElementById('newElementWeight').value = '';
    showToast('تمت إضافة العنصر', 'ok');
    loadElementsMgmt();
    loadPerformanceElements();
  } catch(err){
    showToast('تعذّر الإضافة: ' + err.message, 'error');
  }
}


/* اسم تبويب Excel صالح: أقل من 31 حرفًا، وبلا رموز محظورة */
function safeSheetName(name){
  return name.replace(/[:\\\/\?\*\[\]]/g, '-').slice(0, 31);
}

/* هامش طباعة معقول بدل هوامش إكسل الافتراضية الواسعة — أقصى استفادة من عرض
   الورقة عند الطباعة (خصوصًا تبويبات "دورة" ذات العمود الواسع الواحد).
   ملاحظة: مكتبة XLSX (community) لا تكتب orientation/fitToWidth عند الحفظ،
   فتبقى هذه إعدادات يضبطها المستخدم يدويًا من مربع حوار الطباعة بإكسل لو
   احتاج ملاءمة العرض لصفحة واحدة. */
function setXlsxPrintMargins(ws){
  ws['!margins'] = { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };
}

/* يبني صفحة بيانات دورة واحدة: شواهدها، ثم خطتها، ثم تقييمها الذاتي — بجداول منفصلة داخل نفس التبويب */
/* أسماء ملفات الصور الفعلية المرتبطة بشاهد — بنفس منطق التسمية المستخدم فعليًا عند حفظها في مجلد "الصور/" */
function getPhotoFileNames(r){
  const names = [];
  (r.photo_urls || []).forEach((url, i) => {
    if(isImageUrl(url)){
      const ext = (url.split('.').pop() || 'jpg').split('?')[0].slice(0, 4);
      names.push(`${r.ref_number || String(r.id).slice(0, 8)}_${i + 1}.${ext}`);
    }
  });
  return names;
}

/* يبني صفحة الدورة عنصرًا بعنصر: كل هدف مع شواهده المرتبطة وصوره وتقييمه الذاتي —
   ويوضّح صراحة أي حقل غير معبَّأ بدل تركه فارغًا، لضمان فهم واضح لأي قارئ أو أداة ذكاء اصطناعي */
function buildCycleSheetAOA(year, shawahidYear, goalsYear, selfYear){
  const aoa = [];
  const NA = (v, fallback) => (v === null || v === undefined || v === '' ? fallback : v);
  const NAList = (arr, fallback) => (arr && arr.length ? arr.join(' | ') : fallback);

  aoa.push([`دورة الأداء ${year}`]);
  aoa.push(['هذا الملف مرتب حسب عناصر الأداء الأحد عشر. كل عنصر يعرض أهدافه، وتحت كل هدف الشواهد الموثّقة المرتبطة به تحديدًا، وأسماء صورها، ثم التقييم الذاتي للعنصر. أي حقل غير معبَّأ يظهر بوضوح ولا يُترك فارغًا.']);
  aoa.push([]);

  const elements = getElementsOrder();

  elements.forEach((el, idx) => {
    const { name, weight } = splitLabel(el.label);
    const elGoals = goalsYear.filter(g => g.element_key === el.key);
    const elShawahid = shawahidYear.filter(r => r.element_key === el.key);
    const elSelf = selfYear.find(s => s.element_key === el.key);

    aoa.push([`${idx + 1}. ${name} — الوزن: ${weight}`]);

    if(!elGoals.length){
      aoa.push(['  الأهداف: لا يوجد أي هدف محدد لهذا العنصر في الخطة.']);
    } else {
      elGoals.forEach((g, gi) => {
        const gShawahid = elShawahid.filter(r => r.goal_id === g.id);
        aoa.push([`  الهدف ${gi + 1}: ${NA(g.goal_name || g.template_name, 'بلا اسم محدد')}`]);
        aoa.push([`    المستوى المستهدف: ${NA(g.target_level, 'غير محدد')}`]);
        aoa.push([`    عدد الشواهد المستهدفة: ${g.target_count || 'غير محدد'}`]);
        aoa.push([`    الأداء المستهدف: ${NA(g.target_performance, 'لم يُكتب')}`]);
        aoa.push([`    مؤشرات النجاح: ${NAList(g.success_indicators, 'لم تُكتب')}`]);
        aoa.push([`    شواهد يوصى بتوثيقها: ${NAList(g.recommended_evidence, 'لم تُكتب')}`]);
        aoa.push([`    إجراء تنفيذي: ${NAList(g.action_steps, 'لم يُكتب')}`]);
        aoa.push([`    ملاحظة شخصية: ${NA(g.personal_note, 'لا توجد')}`]);
        aoa.push([`    الشواهد الموثّقة المرتبطة بهذا الهدف (${gShawahid.length}):`]);
        if(gShawahid.length){
          gShawahid.forEach(r => {
            const photos = getPhotoFileNames(r);
            aoa.push([`      • ${r.ref_number || ''} | ${r.lesson_date || 'بلا تاريخ'} | ${(r.description || 'بلا وصف').slice(0, 90)} | الصور: ${photos.length ? photos.join('، ') : 'لا توجد صور مرفقة'}`]);
          });
        } else {
          aoa.push(['      لا توجد شواهد مرتبطة بهذا الهدف بعد.']);
        }
      });
    }

    const unlinked = elShawahid.filter(r => !r.goal_id);
    aoa.push([`  شواهد هذا العنصر غير المرتبطة بهدف محدد (${unlinked.length}):`]);
    if(unlinked.length){
      unlinked.forEach(r => {
        const photos = getPhotoFileNames(r);
        aoa.push([`    • ${r.ref_number || ''} | ${r.lesson_date || 'بلا تاريخ'} | ${(r.description || 'بلا وصف').slice(0, 90)} | الصور: ${photos.length ? photos.join('، ') : 'لا توجد صور مرفقة'}`]);
      });
    } else {
      aoa.push(['    لا توجد.']);
    }

    aoa.push(['  التقييم الذاتي لهذا العنصر:']);
    if(elSelf && elSelf.self_level){
      aoa.push([`    المستوى الذاتي: ${elSelf.self_level} من 5`]);
      aoa.push([`    الملاحظة: ${NA(elSelf.self_note, 'لا توجد')}`]);
    } else {
      aoa.push(['    لم يُقيَّم هذا العنصر ذاتيًا بعد في هذه الدورة.']);
    }

    aoa.push([]);
    aoa.push(['─'.repeat(70)]);
    aoa.push([]);
  });

  return aoa;
}

async function exportBackup(evt){
  const btn = evt ? evt.target.closest('button') : null;
  /* بلا busyText: الزر "home-btn" له عنوان/وصف كعناصر فرعية، وأصلًا فيه
     شريط تقدّم حقيقي (personalBackupProgress) يظهر تحته أثناء العمل —
     التعطيل وحده كافٍ لمنع نقرة مكررة */
  beginExportBusy(btn);
  showToast('جارٍ تجهيز النسخة الاحتياطية...', 'ok');
  try{
    await ensureZipLib();
    await ensureXlsxLib();

    /* هذه نسخة احتياطية شخصية لبيانات المستخدم الحالي فقط (تظهر تحت
       "إعدادات ← نسخة احتياطية" لأي حساب، بما فيها حسابات المسؤول) — لازم
       فلترة صريحة بمعرّف المستخدم/المعلم على كل جدول، لا الاعتماد على RLS
       وحدها: نفس الجداول هنا لها صلاحية "المسؤول يشوف الكل"، فبدون هذا
       الفلتر يحصل حساب المسؤول على نسخة احتياطية تضم بيانات كل المعلمين
       مختلطة بدل بياناته الشخصية فقط (نفس فئة الخلل الذي عولج في loadPlan). */
    const uid = currentUser.id;
    const [shRes, goalsRes, selfRes, crmStudentsRes, crmGradesRes, crmSectionsRes, crmIncidentsRes, crmTypesRes, acCasesRes, programsRes, supportRes] = await Promise.all([
      fetchAllRows((from, to) => sb.from('shawahid').select('*').eq('user_id', uid).order('created_at', { ascending: false }).range(from, to)),
      sb.from('performance_goals').select('*').eq('user_id', uid).order('cycle_year', { ascending: false }),
      sb.from('self_assessment').select('*').eq('user_id', uid),
      sb.from('classroom_students').select('*').eq('teacher_id', uid),
      sb.from('classroom_grade_levels').select('*').eq('teacher_id', uid),
      sb.from('classroom_sections').select('*').eq('teacher_id', uid),
      fetchAllRows((from, to) => sb.from('classroom_incidents').select('*').eq('teacher_id', uid).order('created_at', { ascending: false }).range(from, to)),
      sb.from('classroom_incident_types').select('*'),
      fetchAllRows((from, to) => sb.from('academic_cases').select('*').eq('teacher_id', uid).order('created_at', { ascending: false }).range(from, to)),
      sb.from('activity_programs').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      sb.from('support_messages').select('*').eq('user_id', uid).order('created_at', { ascending: false })
    ]);

    const shawahid = shRes.data || [];
    const goals = goalsRes.data || [];
    const selfAssess = selfRes.data || [];
    const crmStudents = crmStudentsRes.data || [];
    const crmGrades = crmGradesRes.data || [];
    const crmSections = crmSectionsRes.data || [];
    const crmIncidents = crmIncidentsRes.data || [];
    const crmTypes = crmTypesRes.data || [];
    const acCases = acCasesRes.data || [];
    /* اسم مختلف عمدًا عن المتغيّر العام activityPrograms (app-10-programs.js) —
       نفس بيئة النطاق المشتركة بين كل ملفات JS بالتطبيق، فالإبقاء على الاسم
       نفسه هنا (كمتغيّر محلي داخل هذه الدالة فقط) قد يُربك قارئًا مستقبليًا
       رغم عدم وجود أي خلل فعلي (const محلية لا تمسّ let العامة). */
    const myPrograms = programsRes.data || [];
    const supportMsgs = supportRes.data || [];
    const meta = (currentUser && currentUser.user_metadata) || {};
    const teacherName = meta.full_name || '';
    const currentCycle = getCycleYear();

    /* تصنيف الشواهد القديمة بلا سنة محفوظة، وتجميع كل سنوات الدورة الموجودة فعليًا */
    shawahid.forEach(r => { if(!r.cycle_year) r.cycle_year = getCycleYear(r.lesson_date || r.created_at || undefined); });
    const years = Array.from(new Set([
      currentCycle,
      ...shawahid.map(r => r.cycle_year),
      ...goals.map(g => g.cycle_year),
      ...selfAssess.map(s => s.cycle_year)
    ].filter(Boolean))).sort().reverse();

    /* ============ بناء ملف Excel بتبويب "ملخص" + تبويب لكل دورة + تبويبات إدارة الصف ============ */
    const wb = XLSX.utils.book_new();
    /* كل محتوى الملف عربي — بدون هذا، إكسل يفتح كل تبويب باتجاه LTR افتراضيًا:
       يظهر العمود الأول (أ) على اليسار بدل اليمين، فينعكس ترتيب القراءة الطبيعي
       على الشاشة وعند الطباعة كذلك. */
    wb.Workbook = { Views: [{ RTL: true }] };

    const summaryAOA = [
      ['نسخة احتياطية — نظام شاهد الأداء الوظيفي'],
      [`المعلم: ${teacherName} (${currentUser.email})`],
      [`المدرسة: ${getProfileSchool() || '—'}    المادة: ${getProfileSubject() || '—'}`],
      [`تاريخ التصدير: ${new Date().toLocaleString('ar-SA')}`],
      [],
      ['في كل تبويب دورة: العناصر الأحد عشر، وتحت كل عنصر أهدافه، وتحت كل هدف شواهده المرتبطة به وصوره، ثم التقييم الذاتي. أي حقل فارغ يُذكر صراحة (مثل "لم يُكتب").'],
      [],
      ['دورة الأداء', 'عدد الشواهد', 'عدد الأهداف', 'عناصر مُقيَّمة ذاتيًا']
    ];
    years.forEach(y => {
      summaryAOA.push([
        y + (y === currentCycle ? ' (الحالية)' : ''),
        shawahid.filter(r => r.cycle_year === y).length,
        goals.filter(g => g.cycle_year === y).length,
        selfAssess.filter(s => s.cycle_year === y).length
      ]);
    });
    summaryAOA.push([], ['إدارة الصف', '', '', '']);
    summaryAOA.push(['عدد الطلاب المضافين', crmStudents.length]);
    summaryAOA.push(['عدد الحوادث السلوكية المسجّلة', crmIncidents.length]);
    summaryAOA.push(['عدد الحالات المحالة', crmIncidents.filter(i => i.current_stage === 'referred').length]);
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryAOA);
    wsSummary['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 18 }];
    setXlsxPrintMargins(wsSummary);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'الملخص');

    years.forEach(y => {
      const aoa = buildCycleSheetAOA(
        y,
        shawahid.filter(r => r.cycle_year === y),
        goals.filter(g => g.cycle_year === y),
        selfAssess.filter(s => s.cycle_year === y)
      );
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 130 }];
      setXlsxPrintMargins(ws);
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName('دورة ' + y.replace('/', '-')));
    });

    /* ---- تبويب: طلاب إدارة الصف ---- */
    if(crmStudents.length){
      const studentsAOA = [['الاسم', 'المرحلة', 'الشعبة', 'رقم الطالب', 'السنة الدراسية']];
      crmStudents
        .slice()
        .sort((a, b) => (a.grade_level || '').localeCompare(b.grade_level || '') || (a.section_number || '').localeCompare(b.section_number || ''))
        .forEach(s => {
          studentsAOA.push([s.full_name, s.grade_level || 'غير محدد', s.section_number || '—', s.student_number || '', s.academic_year || '']);
        });
      const wsStudents = XLSX.utils.aoa_to_sheet(studentsAOA);
      wsStudents['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
      setXlsxPrintMargins(wsStudents);
      XLSX.utils.book_append_sheet(wb, wsStudents, 'طلاب إدارة الصف');
    }

    /* ---- تبويب: حوادث إدارة الصف ---- */
    if(crmIncidents.length){
      const stageLabel = { warning_1: 'تنبيه أول', warning_2: 'تنبيه ثانٍ', referred: 'محال' };
      const incidentsAOA = [['الطالب', 'المخالفة', 'المادة النظامية', 'الدرجة', 'التاريخ', 'المرة', 'الحالة', 'رقم خطاب التحويل', 'صورة توثيق التسليم', 'ملاحظة']];
      crmIncidents.forEach(inc => {
        const student = crmStudents.find(s => s.id === inc.student_id);
        const type = crmTypes.find(t => t.id === inc.incident_type_id);
        incidentsAOA.push([
          student ? student.full_name : 'طالب محذوف',
          type ? type.problem_name : '—',
          type ? type.regulation_article : '—',
          type ? type.problem_degree : '',
          inc.incident_date,
          inc.occurrence_number,
          stageLabel[inc.current_stage] || inc.current_stage,
          inc.referral_letter_number || '',
          inc.referral_receipt_photo_url ? 'نعم' : (inc.current_stage === 'referred' && inc.referral_letter_generated ? 'لا' : '—'),
          inc.notes || ''
        ]);
      });
      const wsIncidents = XLSX.utils.aoa_to_sheet(incidentsAOA);
      wsIncidents['!cols'] = [{ wch: 22 }, { wch: 32 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 30 }];
      setXlsxPrintMargins(wsIncidents);
      XLSX.utils.book_append_sheet(wb, wsIncidents, 'حوادث إدارة الصف');
    }

    /* ---- تبويب: المتابعة الأكاديمية ---- */
    if(acCases.length){
      const acStatusLabel = { plan_active: 'خطة علاجية جارية', referred: 'محال للموجه الطلابي' };
      const acAOA = [['الطالب', 'المادة', 'وصف الضعف', 'نوع الحصص', 'تاريخ بدء الخطة', 'تاريخ اعتماد اللجنة', 'الحالة', 'رقم خطاب الإحالة', 'صورة توثيق التسليم', 'ملاحظة']];
      acCases.forEach(c => {
        const student = crmStudents.find(s => s.id === c.student_id);
        acAOA.push([
          student ? student.full_name : 'طالب محذوف',
          c.subject,
          c.weakness_description,
          c.session_type || '',
          c.plan_started_at,
          c.committee_approved_at || '',
          acStatusLabel[c.status] || c.status,
          c.referral_letter_number || '',
          c.referral_receipt_photo_url ? 'نعم' : (c.status === 'referred' && c.referral_letter_generated ? 'لا' : '—'),
          c.notes || ''
        ]);
      });
      const wsAcademic = XLSX.utils.aoa_to_sheet(acAOA);
      wsAcademic['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 30 }];
      setXlsxPrintMargins(wsAcademic);
      XLSX.utils.book_append_sheet(wb, wsAcademic, 'المتابعة الأكاديمية');
    }

    /* ---- تبويب: برامج الأنشطة الطلابية ---- */
    if(myPrograms.length){
      const progAOA = [['اسم البرنامج', 'الحصص الموثَّقة', 'إجمالي الحصص', 'عدد الطلبة', 'السنة', 'تفاصيل الحصص']];
      myPrograms.forEach(p => {
        const sessions = p.sessions || [];
        const done = sessions.filter(s => s.done).length;
        const sessionsDetail = sessions
          .map(s => `${s.session_no}: ${s.week_label || '—'} — ${s.done ? 'موثَّقة' + (s.done_date ? ' (' + s.done_date + ')' : '') : 'لم تُوثَّق بعد'}`)
          .join(' | ');
        progAOA.push([p.name, done, p.total_sessions, p.student_count || '—', p.cycle_year || '—', sessionsDetail]);
      });
      const wsPrograms = XLSX.utils.aoa_to_sheet(progAOA);
      wsPrograms['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 80 }];
      setXlsxPrintMargins(wsPrograms);
      XLSX.utils.book_append_sheet(wb, wsPrograms, 'برامج الأنشطة الطلابية');
    }

    /* ---- تبويب: رسائل الدعم ---- */
    if(supportMsgs.length){
      const supportAOA = [['التاريخ', 'الرسالة', 'الحالة', 'تاريخ الحل', 'صورة مرفقة']];
      supportMsgs.forEach(m => {
        supportAOA.push([
          m.created_at ? new Date(m.created_at).toLocaleString('ar-SA') : '',
          m.message,
          m.status === 'resolved' ? 'محلولة' : 'مفتوحة',
          m.resolved_at ? new Date(m.resolved_at).toLocaleString('ar-SA') : '—',
          m.photo_url ? 'نعم' : 'لا'
        ]);
      });
      const wsSupport = XLSX.utils.aoa_to_sheet(supportAOA);
      wsSupport['!cols'] = [{ wch: 20 }, { wch: 50 }, { wch: 10 }, { wch: 20 }, { wch: 12 }];
      setXlsxPrintMargins(wsSupport);
      XLSX.utils.book_append_sheet(wb, wsSupport, 'رسائل الدعم');
    }

    const xlsxArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    /* ============ تجميع الملف النهائي: Excel + مفكرة توضيحية + نسخة تقنية ============ */
    const zip = new JSZip();

    const summary = [
      'نسخة احتياطية — نظام شاهد الأداء الوظيفي',
      '='.repeat(45),
      `المعلم: ${teacherName} (${currentUser.email})`,
      `تاريخ التصدير: ${new Date().toLocaleString('ar-SA')}`,
      `دورة الأداء الحالية: ${currentCycle}`,
      '',
      `إجمالي الشواهد: ${shawahid.length}  —  عبر ${years.length} ${years.length === 1 ? 'دورة أداء' : 'دورات أداء'}`,
      `إجمالي طلاب إدارة الصف: ${crmStudents.length}  —  إجمالي الحوادث السلوكية: ${crmIncidents.length}`,
      `إجمالي الحالات الأكاديمية: ${acCases.length}  —  المُحالة منها للموجه: ${acCases.filter(c => c.status === 'referred').length}`,
      `إجمالي برامج الأنشطة الطلابية: ${myPrograms.length}  —  إجمالي رسائل الدعم: ${supportMsgs.length}`,
      '',
      'محتوى هذا الملف:',
      '  • نسخة-احتياطية.xlsx   الملف الرئيسي — افتحه في Excel أو Google Sheets',
      '      - تبويب "الملخص": نظرة عامة على كل دورة أداء وإدارة الصف',
      '      - تبويب لكل دورة: العناصر الأحد عشر بالترتيب، وتحت كل عنصر أهدافه،',
      '        وتحت كل هدف شواهده الموثّقة المرتبطة به تحديدًا مع أسماء صورها،',
      '        ثم التقييم الذاتي لذلك العنصر. أي حقل غير معبَّأ يُذكر صراحة',
      '        (مثل: "لم يُكتب" أو "لم يُقيَّم بعد") بدل تركه فارغًا.',
      '      - تبويب "طلاب إدارة الصف": كل طلابك مرتبين حسب المرحلة والشعبة',
      '      - تبويب "حوادث إدارة الصف": كل مخالفة مسجّلة، حالتها، وأرقام خطابات التحويل',
      '      - تبويب "المتابعة الأكاديمية": حالات الضعف الأكاديمي، الخطط العلاجية، والإحالات',
      '      - تبويب "برامج الأنشطة الطلابية": كل برنامج وجدول حصصه وحالة توثيقها',
      '      - تبويب "رسائل الدعم": كل رسالة أرسلتها عبر "تواصل معنا" وحالتها',
      '  • الصور/                 صور شواهد الأداء',
      '  • الصور/إدارة_الصف/      صور توثيق تسليم خطابات التحويل السلوكية',
      '  • الصور/المتابعة_الأكاديمية/  صور توثيق تسليم خطابات الإحالة الأكاديمية',
      '  • الصور/رسائل_الدعم/     صور رسائل الدعم المُرفَقة',
      '  • بيانات-كاملة.json    نسخة تقنية كاملة (لأغراض الاستعادة فقط، لا تحتاج فتحها بنفسك)',
      '',
      'خدمة إضافية: هذا الملف مصمَّم ليُفهم بسهولة من أي أداة ذكاء اصطناعي — ارفعه',
      '(وتقدر ترفق مجلد الصور معه) واطلب من الأداة تحليل تقدمك أو مراجعة عنصر معيّن',
      'أو حتى مقارنة دورتين. الربط بين الهدف وشواهده وصوره وتقييمه موجود صراحة',
      'داخل الملف، فلا تحتاج لأي تجهيز أو شرح إضافي قبل الرفع.',
      '',
      'نصيحة: احتفظ بهذا الملف في مكان آمن (جوجل درايف مثلًا) وكرّر التصدير شهريًا.'
    ].join('\n');
    zip.file('اقرأني.txt', '\uFEFF' + summary);
    zip.file('نسخة-احتياطية.xlsx', xlsxArray);

    const fullData = {
      exported_at: new Date().toISOString(),
      teacher: { name: teacherName, email: currentUser.email, school: getProfileSchool(), subject: getProfileSubject() },
      shawahid, performance_goals: goals, self_assessment: selfAssess,
      classroom_students: crmStudents,
      classroom_grade_levels: crmGrades,
      classroom_sections: crmSections,
      classroom_incidents: crmIncidents,
      classroom_incident_types_reference: crmTypes,
      academic_cases: acCases,
      activity_programs: myPrograms,
      support_messages: supportMsgs
    };
    zip.file('بيانات-كاملة.json', JSON.stringify(fullData, null, 2));

    /* ============ تحميل الصور الفعلية (لا مجرد عددها) ============ */
    const progBox = document.getElementById('personalBackupProgress');
    const progBar = document.getElementById('personalBackupBar');
    const progMsg = document.getElementById('personalBackupMsg');
    const setProgress = (pct, msg) => {
      if(progBox) progBox.style.display = 'block';
      if(progBar) progBar.style.width = pct + '%';
      if(progMsg) progMsg.textContent = msg;
    };

    const photosFolder = zip.folder('الصور');
    const crmPhotosFolder = photosFolder.folder('إدارة_الصف');
    const acPhotosFolder = photosFolder.folder('المتابعة_الأكاديمية');
    const allPhotos = [];
    shawahid.forEach(r => {
      (r.photo_urls || []).forEach((url, i) => {
        if(isImageUrl(url)) allPhotos.push({ url, ref: r.ref_number || String(r.id).slice(0, 8), idx: i + 1, target: photosFolder });
      });
    });
    crmIncidents.forEach(inc => {
      if(inc.referral_receipt_photo_url){
        const student = crmStudents.find(s => s.id === inc.student_id);
        allPhotos.push({
          url: inc.referral_receipt_photo_url,
          ref: (student ? student.full_name : 'طالب') + '_' + String(inc.id).slice(0, 8),
          idx: 1,
          target: crmPhotosFolder
        });
      }
    });
    acCases.forEach(c => {
      if(c.referral_receipt_photo_url){
        const student = crmStudents.find(s => s.id === c.student_id);
        allPhotos.push({
          url: c.referral_receipt_photo_url,
          ref: (student ? student.full_name : 'طالب') + '_' + String(c.id).slice(0, 8),
          idx: 1,
          target: acPhotosFolder
        });
      }
    });
    const supportPhotosFolder = photosFolder.folder('رسائل_الدعم');
    supportMsgs.forEach(m => {
      if(m.photo_url){
        allPhotos.push({
          url: m.photo_url,
          ref: 'رسالة_' + String(m.id).slice(0, 8),
          idx: 1,
          target: supportPhotosFolder
        });
      }
    });

    let photosDone = 0, photosFailed = 0;
    for(const p of allPhotos){
      photosDone++;
      setProgress(Math.round((photosDone / Math.max(1, allPhotos.length)) * 90), `جارٍ تحميل الصور (${photosDone} من ${allPhotos.length})...`);
      try{
        const res = await fetch(p.url);
        if(!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const ext = (p.url.split('.').pop() || 'jpg').split('?')[0].slice(0, 4);
        p.target.file(`${p.ref}_${p.idx}.${ext}`, blob);
      } catch(e){ photosFailed++; }
    }

    setProgress(95, 'جارٍ ضغط الملف النهائي...');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `نسخة-احتياطية-${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    setProgress(100, `تم بنجاح — ${shawahid.length} شاهد، ${crmIncidents.length} حادثة صف، ${allPhotos.length - photosFailed} صورة، الحجم ${sizeMb} م.ب${photosFailed ? ` (تعذّر تحميل ${photosFailed} صورة)` : ''}`);
    localStorage.setItem('last_personal_backup_ts:' + currentUser.id, new Date().toISOString());
    setTimeout(() => { if(progBox) progBox.style.display = 'none'; }, 6000);

    showToast(`تم تصدير ${shawahid.length} شاهدًا و${crmIncidents.length} حادثة صف و${acCases.length} حالة أكاديمية و${myPrograms.length} برنامج نشاط و${allPhotos.length} صورة`, 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + err.message, 'error');
  } finally {
    endExportBusy(btn);
  }
}

/* ============ (3) ملف الإنجاز الكامل ============ */
/* ============================================
   (5) تصدير التقييم الذاتي كملف مستقل
   ورقة جاهزة يحملها المعلم لجلسة التقييم مع مديره المباشر
   ============================================ */
/* ============================================
   تصدير خطة الأداء كملف رسمي
   وثيقة يحملها المعلم لجلسة التخطيط مع مديره المباشر
   ============================================ */
/* يبني قالب خطة الأداء من البيانات المعروضة حاليًا على الشاشة.
   asDraft (افتراضيًا true): يظهر عنوان "مسودة" وتنويه "مسودة نقاش" — مناسب
   لما تُطبع/تُنزَّل الخطة بمفردها (تُستخدم فعليًا كمسودة نقاش بجلسة التخطيط
   مع المدير). exportPortfolio يمرّر false لأن هذه الصفحة تُضمَّن داخل "ملف
   الإنجاز" النهائي، ووجود "مسودة" هناك مربك ومناقض لكونه ملفًا نهائيًا. */
function buildPlanHtml(asDraft){
  if(asDraft === undefined) asDraft = true;
  const elements = getElementsOrder();
  const anyFilled = elements.some(el => (myPlanGoals[el.key] || []).length > 0);
  if(!anyFilled) return null;

  const meta = (currentUser && currentUser.user_metadata) || {};
  const role = document.getElementById('phRole').value.trim() || (getProfileSubject() ? 'معلم ' + getProfileSubject() : 'معلم');
  const stage = document.getElementById('phStage').value.trim();
  const extra = document.getElementById('phExtra').value.trim() || 'لا يوجد مهام إضافية';

  const allLevels = elements.flatMap(el => (myPlanGoals[el.key] || []).map(g => g.target_level)).filter(Boolean);
  const topLevel = allLevels.length ? Math.max(...allLevels) : null;

  const bulletList = (arr) => (arr && arr.length)
    ? '<ul style="margin:4px 0 0;padding-right:16px;font-size:10px;line-height:1.85;color:#3F3B31;">' +
      arr.map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul>'
    : '<div style="font-size:10px;color:#9A9484;margin-top:3px;">—</div>';

  /* class="pdf-avoid-break" تُستخدم لاحقًا عند تصدير PDF متعدد الصفحات لمعرفة
     أين تسمح نقاط القطع الآمنة بين الصفحات — حتى لا يُقطع هدف أو قسم عنصر
     كامل في منتصفه بين صفحة وأخرى */
  const goalBlock = (g, gi) => `
    <div class="pdf-avoid-break" style="border-top:1px dashed #D8D2C4;padding-top:8px;margin-top:8px;">
      <div style="font-size:10px;font-weight:800;color:#A9852E;margin-bottom:5px;">
        ${escapeHtml(goalDisplayName(g, gi))}${g.target_level ? ' — المستهدف: ' + g.target_level + ' ' + LEVEL_NAMES[g.target_level] : ''}${g.target_count ? ' — عدد الشواهد: ' + g.target_count : ''}
      </div>
      <div style="margin-bottom:6px;">
        <span style="font-size:10.5px;font-weight:700;color:#1B3245;">الأداء المستهدف:</span>
        <span style="font-size:10px;color:#3F3B31;line-height:1.8;">${g.target_performance ? escapeHtml(g.target_performance) : '—'}</span>
      </div>
      <div style="margin-bottom:6px;">
        <div style="font-size:10.5px;font-weight:700;color:#1B3245;">مؤشرات النجاح:</div>
        ${bulletList(g.success_indicators)}
      </div>
      <div style="margin-bottom:6px;">
        <div style="font-size:10.5px;font-weight:700;color:#1B3245;">شواهد يوصى بتوثيقها:</div>
        ${bulletList(g.recommended_evidence)}
      </div>
      <div>
        <div style="font-size:10.5px;font-weight:700;color:#1B3245;">إجراء تنفيذي:</div>
        ${bulletList(g.action_steps)}
      </div>
    </div>`;

  const sections = elements.map((el, i) => {
    const { name } = splitLabel(el.label);
    const w = getElementWeight(el.key);
    const goals = myPlanGoals[el.key] || [];
    if(!goals.length) return '';

    return `
      <div class="pdf-avoid-break" style="margin-bottom:14px;page-break-inside:avoid;">
        <div style="background:#1B3245;color:#fff;padding:7px 12px;font-size:11.5px;font-weight:700;">
          ${i+1}. ${escapeHtml(name)} (وزن ${w}%) — ${goals.length} ${goals.length === 1 ? 'هدف' : 'أهداف'}
        </div>
        <div style="border:1px solid #D8D2C4;border-top:none;padding:10px 12px;">
          ${goals.map(goalBlock).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    <div dir="rtl" style="width:794px;background:#fff;font-family:'Cairo',sans-serif;color:#232323;padding-bottom:16px;">
      <div style="padding:20px 26px 0;">
        <div style="font-family:'Amiri',serif;font-size:20px;font-weight:700;color:#1B3245;">${asDraft ? 'مسودة أهداف الأداء الوظيفي' : 'أهداف الأداء الوظيفي'} — دورة الأداء ${escapeHtml(getCycleYear())}</div>
        <div style="height:2px;background:#1B3245;margin:8px 0 10px;"></div>
        <div style="font-size:11px;font-weight:700;color:#1B3245;">
          ${escapeHtml(role)}${stage ? ' — ' + escapeHtml(stage) : ''} | ${topLevel ? 'أعلى مستوى مستهدف: ' + LEVEL_NAMES[topLevel] + ' (' + topLevel + ')' : ''} | ${escapeHtml(extra)}
        </div>

        ${asDraft ? `<div style="background:#FBF3E6;border-right:3px solid #A9852E;padding:9px 12px;margin:10px 0;font-size:9.5px;color:#6B5420;line-height:1.85;">
          هذه مسودة نقاش تُعرض على المدير المباشر في جلسة التخطيط، وليست نموذجًا رسميًا يُدخل في نظام فارس. الصياغة النهائية للأهداف تتم بالاتفاق المشترك بين المعلم والمدير وفق نموذج التقييم المعتمد في النظام التقني.
        </div>` : ''}

        <div style="font-size:9.5px;color:#6B6659;margin-bottom:14px;">
          المصدر: عناصر التقييم الأحد عشر لنموذج (معلم) — الدليل الإرشادي لإدارة الأداء الوظيفي، الإصدار الثاني.
        </div>

        ${sections}

        <div style="display:flex;gap:40px;margin-top:20px;">
          <div style="flex:1;border-top:1px solid #232323;padding-top:6px;font-size:10px;color:#6B6659;">توقيع المعلم</div>
          <div style="flex:1;border-top:1px solid #232323;padding-top:6px;font-size:10px;color:#6B6659;">اطّلاع المدير المباشر</div>
        </div>
      </div>
    </div>`;
}

/* طباعة الخطة مباشرة عبر نافذة الطباعة */
function printPlan(evt){
  const html = buildPlanHtml();
  if(!html){
    showToast('لم تحدد أي مستهدف بعد — عبّئ خطتك أولًا.', 'error');
    return;
  }
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    document.getElementById('printArea').innerHTML = html;
    printNow();
  } finally { endExportBusy(btn); }
}

/* ============ أدوات مشتركة لبناء صفحات PDF (تُستخدم في تحميل الخطة وملف الإنجاز) ============ */

/* هامش حقيقي حول كل صفحة بدل لصق المحتوى بحافة الورقة تمامًا — أغلب الطابعات
   أصلًا لا تطبع لحافة الورقة، وبدون هامش يلتصق النص بحافة الصفحة عند الطباعة
   أو التجليد. */
const PDF_MARGIN_PT = 28;

/* يضيف صفحة PDF واحدة تحتوي HTML، مُصغّرًا بالتناسب ليتسع كاملًا ضمن هامش
   الصفحة (لا يُقطع ولا يتجاوزها). state.firstPage تتحكم هل تُستهل صفحة جديدة
   أو تُستخدم الصفحة الأولى الفارغة أصلًا في مستند jsPDF. */
async function addPdfPage(pdf, area, html, state){
  area.innerHTML = html;
  await new Promise(r => setTimeout(r, 100));

  const canvas = await html2canvas(area, { scale: 2, backgroundColor: '#ffffff' });
  const imgData = canvas.toDataURL('image/jpeg', 0.95);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const boxW = pageWidth - PDF_MARGIN_PT * 2;
  const boxH = pageHeight - PDF_MARGIN_PT * 2;
  const ratio = Math.min(boxW / canvas.width, boxH / canvas.height);
  const w = canvas.width * ratio;
  const h = canvas.height * ratio;

  if(!state.firstPage) pdf.addPage();
  pdf.addImage(imgData, 'JPEG', (pageWidth - w) / 2, PDF_MARGIN_PT, w, h);
  state.firstPage = false;
}

/* يوزّع محتوى HTML طويلًا على عدة صفحات بعرض كامل (ضمن الهامش)، مع الحرص على
   عدم قطع أي عنصر عليه class="pdf-avoid-break" (قسم عنصر أداء كامل، أو هدف
   واحد ضمن عنصر متعدد الأهداف) بين صفحتين. نقيس مواضع نهاية هذه العناصر قبل
   تصوير المحتوى، ثم نقسّم الصورة الملتقطة عند أقرب نقطة آمنة لا تتجاوز سعة
   الصفحة — بدل التقسيم الآلي كل ارتفاع صفحة بلا وعي بالمحتوى (وهو ما كان
   يقطع الأقسام والجداول في منتصفها بين صفحة وأخرى). */
/* الجزء الحسابي البحت من التقسيم (لا يلمس DOM ولا Canvas) — معزول في دالة
   مستقلة ليسهل اختباره: يُرجع نقاط [بداية، نهاية] كل صفحة بوحدة px CSS، بدون
   قطع أي مدى يتجاوز أقرب نقطة قطع آمنة ≤ سعة الصفحة. */
function computePdfSliceBoundaries(cssHeight, maxSliceCssPx, breakPoints){
  const slices = [];
  let cursor = 0;
  while(cursor < cssHeight - 0.5){
    const target = Math.min(cursor + maxSliceCssPx, cssHeight);
    let sliceEnd = target;
    if(target < cssHeight){
      const candidates = breakPoints.filter(bp => bp > cursor + 1 && bp <= target);
      if(candidates.length) sliceEnd = candidates[candidates.length - 1];
    }
    slices.push([cursor, sliceEnd]);
    cursor = sliceEnd;
  }
  return slices;
}

async function addPdfPagesMulti(pdf, area, html, state){
  area.innerHTML = html;
  await new Promise(r => setTimeout(r, 100));

  const cssWidth = area.offsetWidth;
  const cssHeight = area.offsetHeight;

  const areaTop = area.getBoundingClientRect().top;
  const breakPoints = Array.from(area.querySelectorAll('.pdf-avoid-break'))
    .map(el => el.getBoundingClientRect().bottom - areaTop)
    .filter(y => y > 0 && y <= cssHeight)
    .sort((a, b) => a - b);

  const canvas = await html2canvas(area, { scale: 2, backgroundColor: '#ffffff' });
  const canvasScaleY = canvas.height / cssHeight;

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const boxW = pageWidth - PDF_MARGIN_PT * 2;
  const boxH = pageHeight - PDF_MARGIN_PT * 2;
  const ptPerCssPx = boxW / cssWidth;
  const maxSliceCssPx = boxH / ptPerCssPx;

  const slices = computePdfSliceBoundaries(cssHeight, maxSliceCssPx, breakPoints);
  for(const [start, end] of slices){
    const sy = Math.round(start * canvasScaleY);
    const sh = Math.max(1, Math.round((end - start) * canvasScaleY));

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sh;
    sliceCanvas.getContext('2d').drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
    const h = (sh / canvasScaleY) * ptPerCssPx;

    if(!state.firstPage) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', PDF_MARGIN_PT, PDF_MARGIN_PT, boxW, h);
    state.firstPage = false;
  }
}

/* تحميل الخطة كملف PDF على الجهاز */
async function exportPlanPdf(evt){
  const html = buildPlanHtml();
  if(!html){
    showToast('لم تحدد أي مستهدف بعد — عبّئ خطتك أولًا.', 'error');
    return;
  }
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  showToast('جارٍ تجهيز ملف الخطة...', 'ok');
  try{
    await ensurePdfLibs();

    const area = document.getElementById('pdfRenderArea');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    await addPdfPagesMulti(pdf, area, html, { firstPage: true });

    pdf.save(`Performance-Plan-${new Date().toISOString().slice(0,10)}.pdf`);
    showToast('تم تحميل ملف الخطة', 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + err.message, 'error');
  } finally {
    endExportBusy(btn);
  }
}

/* يبني قالب ورقة التقييم الذاتي — يُستخدم للتحميل والطباعة معًا */
async function buildSelfAssessmentHtml(){
  await loadPlan();
  await loadSelfAssessment();

  const elements = getElementsOrder();
  const meta = (currentUser && currentUser.user_metadata) || {};
  const wp = computeWeightedProgress();

  const filled = elements.filter(e => (mySelfAssessment[e.key] || {}).self_level);
  if(!filled.length) return null;

  {
    const rows = elements.map(e => {
      const { name } = splitLabel(e.label);
      const w = getElementWeight(e.key);
      const p = myPlan[e.key] || {};
      const s = mySelfAssessment[e.key] || {};
      const done = planShahidCounts[e.key] || 0;

      const noteHtml = s.self_note
        ? `<div style="font-size:9.5px;color:#5A5648;margin-top:3px;line-height:1.65;">${escapeHtml(s.self_note)}</div>`
        : '';

      /* class="pdf-avoid-break" + page-break-inside:avoid: يمنعان قطع صف
         معلم واحد في منتصفه بين صفحتين — عند التصدير PDF (متعدد الصفحات
         الآن) وعند الطباعة المباشرة على السواء */
      return `<tr class="pdf-avoid-break" style="page-break-inside:avoid;">
        <td style="padding:7px 9px;border:1px solid #D8D2C4;text-align:right;vertical-align:top;">
          <div style="font-size:11px;font-weight:700;color:#1B3245;">${escapeHtml(name)}</div>
          ${noteHtml}
        </td>
        <td style="padding:7px 6px;border:1px solid #D8D2C4;text-align:center;font-size:10.5px;vertical-align:top;">${w}%</td>
        <td style="padding:7px 6px;border:1px solid #D8D2C4;text-align:center;font-size:10.5px;vertical-align:top;">${p.target_level || '—'}</td>
        <td style="padding:7px 6px;border:1px solid #D8D2C4;text-align:center;font-size:10.5px;vertical-align:top;">${done}${p.target_count ? '/' + p.target_count : ''}</td>
        <td style="padding:7px 6px;border:1px solid #D8D2C4;text-align:center;font-size:11px;font-weight:800;color:#1B3245;vertical-align:top;">${s.self_level || '—'}</td>
      </tr>`;
    }).join('');

    const avgSelf = filled.length
      ? (filled.reduce((sum, e) => sum + mySelfAssessment[e.key].self_level, 0) / filled.length).toFixed(1)
      : '—';

    const html = `
      <div dir="rtl" style="width:794px;background:#fff;font-family:'Cairo',sans-serif;color:#232323;">
        <div style="background:#1B3245;padding:18px 26px;border-bottom:4px solid #A9852E;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-family:'Amiri',serif;font-size:20px;color:#fff;font-weight:700;">ورقة التقييم الذاتي</div>
            <div style="font-size:10.5px;color:#C9D2DA;margin-top:3px;">دورة الأداء ${escapeHtml(getCycleYear())}</div>
          </div>
          <div style="font-size:10.5px;color:#C9D2DA;text-align:left;">
            <div>${escapeHtml(meta.full_name || '')}</div>
            <div>${escapeHtml(getProfileSchool())} — ${escapeHtml(getProfileSubject())}</div>
          </div>
        </div>

        <div style="padding:14px 26px 8px;">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
            <div style="flex:1;min-width:150px;border:1px solid #D8D2C4;padding:9px 12px;background:#F7F5F0;">
              <div style="font-size:9.5px;color:#6B6659;">متوسط التقييم الذاتي</div>
              <div style="font-size:17px;font-weight:800;color:#1B3245;">${avgSelf} / 5</div>
            </div>
            <div style="flex:1;min-width:150px;border:1px solid #D8D2C4;padding:9px 12px;background:#F7F5F0;">
              <div style="font-size:9.5px;color:#6B6659;">الاكتمال الموزون للتوثيق</div>
              <div style="font-size:17px;font-weight:800;color:#1B3245;">${wp.pct}%</div>
            </div>
            <div style="flex:1;min-width:150px;border:1px solid #D8D2C4;padding:9px 12px;background:#F7F5F0;">
              <div style="font-size:9.5px;color:#6B6659;">عناصر مُقيَّمة</div>
              <div style="font-size:17px;font-weight:800;color:#1B3245;">${filled.length} / ${elements.length}</div>
            </div>
          </div>

          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#F1EEE6;">
              <th style="padding:7px;border:1px solid #D8D2C4;font-size:10.5px;">عنصر الأداء ومبرراتي</th>
              <th style="padding:7px;border:1px solid #D8D2C4;font-size:10.5px;">الوزن</th>
              <th style="padding:7px;border:1px solid #D8D2C4;font-size:10.5px;">المستهدف</th>
              <th style="padding:7px;border:1px solid #D8D2C4;font-size:10.5px;">الشواهد</th>
              <th style="padding:7px;border:1px solid #D8D2C4;font-size:10.5px;">تقييمي</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>

          <p style="font-size:9.5px;color:#6B6659;margin-top:10px;line-height:1.7;">
            سلم التقدير: 5 مثالي — 4 فاق التوقعات — 3 وافق التوقعات — 2 بحاجة إلى تطوير — 1 غير مرضٍ<br>
            وفقًا للدليل الإرشادي لإدارة الأداء الوظيفي: التقييم الذاتي لا يدخل في احتساب الدرجة النهائية، ويُستخدم أساسًا للمناقشة الموضوعية في جلسة التقييم.
          </p>

          <div style="display:flex;gap:40px;margin-top:22px;padding-bottom:14px;">
            <div style="flex:1;border-top:1px solid #232323;padding-top:6px;font-size:10px;color:#6B6659;">توقيع المعلم</div>
            <div style="flex:1;border-top:1px solid #232323;padding-top:6px;font-size:10px;color:#6B6659;">توقيع المدير المباشر</div>
          </div>
        </div>
      </div>`;

    return html;
  }
}

/* طباعة ورقة التقييم الذاتي */
async function printSelfAssessment(evt){
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    const html = await buildSelfAssessmentHtml();
    if(!html){
      showToast('لم تُقيّم أي عنصر بعد — عبّئ التقييم الذاتي أولًا.', 'error');
      return;
    }
    document.getElementById('printArea').innerHTML = html;
    printNow();
  } finally { endExportBusy(btn); }
}

/* تحميل ورقة التقييم الذاتي كملف PDF */
async function exportSelfAssessment(evt){
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  const html = await buildSelfAssessmentHtml();
  if(!html){
    showToast('لم تُقيّم أي عنصر بعد — عبّئ التقييم الذاتي أولًا.', 'error');
    endExportBusy(btn);
    return;
  }
  showToast('جارٍ تجهيز ورقة التقييم الذاتي...', 'ok');
  try{
    await ensurePdfLibs();

    const area = document.getElementById('pdfRenderArea');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    await addPdfPagesMulti(pdf, area, html, { firstPage: true });

    pdf.save(`Self-Assessment-${new Date().toISOString().slice(0,10)}.pdf`);
    showToast('تم تحميل ورقة التقييم الذاتي', 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + err.message, 'error');
  } finally {
    endExportBusy(btn);
  }
}

async function exportPortfolio(evt){
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  showToast('جارٍ تجهيز ملف الإنجاز...', 'ok');
  try{
    await ensurePdfLibs();
    await loadPlan();
    await loadSelfAssessment();

    /* ملف الإنجاز شخصي لحساب المستخدم الحالي — فلترة صريحة بمعرّف المستخدم
       ضرورية هنا لنفس سبب exportBackup أعلاه (صلاحية "المسؤول يشوف الكل"
       على هذا الجدول)، وإلا يضم ملف إنجاز حساب المسؤول شواهد كل المعلمين. */
    const { data: allRecs } = await sb.from('shawahid').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true });
    const records = allRecs || [];
    const elements = getElementsOrder();
    const meta = (currentUser && currentUser.user_metadata) || {};

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const area = document.getElementById('pdfRenderArea');
    const pageState = { firstPage: true };
    const addHtmlPage = (html) => addPdfPage(pdf, area, html, pageState);
    const addHtmlPageMultiPage = (html) => addPdfPagesMulti(pdf, area, html, pageState);

    /* صفحة الغلاف */
    await addHtmlPage(`
      <div dir="rtl" style="width:794px;height:1000px;background:#fff;font-family:'Cairo',sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">
        <div style="width:100%;background:#1B3245;padding:40px 0;border-bottom:6px solid #A9852E;">
          <div style="font-family:'Amiri',serif;font-size:34px;color:#fff;font-weight:700;">ملف الإنجاز الوظيفي</div>
          <div style="font-size:15px;color:#C9D2DA;margin-top:8px;">شواهد الأداء الوظيفي — دورة ${escapeHtml(getCycleYear())}</div>
        </div>
        <div style="margin-top:70px;font-size:17px;line-height:2.6;color:#232323;">
          <div><span style="color:#6B6659;">المعلم:</span> <b>${escapeHtml(meta.full_name || '')}</b></div>
          <div><span style="color:#6B6659;">المدرسة:</span> <b>${escapeHtml(getProfileSchool() || '—')}</b></div>
          <div><span style="color:#6B6659;">المادة:</span> <b>${escapeHtml(getProfileSubject() || '—')}</b></div>
          <div style="margin-top:20px;font-size:14px;color:#6B6659;">إجمالي الشواهد الموثّقة: <b style="color:#1B3245;">${records.length}</b></div>
          <div style="font-size:13px;color:#6B6659;">تاريخ الإصدار: ${new Date().toLocaleDateString('ar-SA')}</div>
        </div>
      </div>`);

    /* صفحة الخطة والتقييم الذاتي */
    const summaryRows = elements.map(el => {
      const { name, weight } = splitLabel(el.label);
      const p = myPlan[el.key] || {};
      const s = mySelfAssessment[el.key] || {};
      const done = records.filter(r => r.element_key === el.key).length;
      return `<tr>
        <td style="padding:7px 9px;border:1px solid #D8D2C4;text-align:right;font-size:11px;">${escapeHtml(name)}</td>
        <td style="padding:7px 9px;border:1px solid #D8D2C4;text-align:center;font-size:11px;">${weight}</td>
        <td style="padding:7px 9px;border:1px solid #D8D2C4;text-align:center;font-size:11px;">${p.target_level || '—'}</td>
        <td style="padding:7px 9px;border:1px solid #D8D2C4;text-align:center;font-size:11px;">${done}${p.target_count ? ' / ' + p.target_count : ''}</td>
        <td style="padding:7px 9px;border:1px solid #D8D2C4;text-align:center;font-size:11px;">${s.self_level || '—'}</td>
      </tr>`;
    }).join('');

    await addHtmlPage(`
      <div dir="rtl" style="width:794px;background:#fff;font-family:'Cairo',sans-serif;color:#232323;">
        <div style="background:#1B3245;padding:18px 28px;border-bottom:4px solid #A9852E;">
          <div style="font-family:'Amiri',serif;font-size:20px;color:#fff;font-weight:700;">ملخص الخطة والتقييم الذاتي</div>
        </div>
        <div style="padding:20px 28px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#F1EEE6;">
              <th style="padding:8px;border:1px solid #D8D2C4;font-size:11px;">عنصر الأداء</th>
              <th style="padding:8px;border:1px solid #D8D2C4;font-size:11px;">الوزن</th>
              <th style="padding:8px;border:1px solid #D8D2C4;font-size:11px;">المستهدف</th>
              <th style="padding:8px;border:1px solid #D8D2C4;font-size:11px;">الشواهد</th>
              <th style="padding:8px;border:1px solid #D8D2C4;font-size:11px;">التقييم الذاتي</th>
            </tr></thead>
            <tbody>${summaryRows}</tbody>
          </table>
          <p style="font-size:10.5px;color:#6B6659;margin-top:14px;line-height:1.8;">
            سلم التقدير: 5 مثالي — 4 فاق التوقعات — 3 وافق التوقعات — 2 بحاجة إلى تطوير — 1 غير مرضٍ
          </p>
        </div>
      </div>`);

    /* صفحات تفاصيل الخطة الكاملة — كل هدف بكل تفاصيله (الأداء المستهدف، المؤشرات، الشواهد الموصى بها، الإجراء)،
       بما يشمل أكثر من هدف واحد للعنصر الواحد إن وُجد — لا مجرد سطر ملخّص واحد */
    const planDetailHtml = buildPlanHtml(false);
    if(planDetailHtml){
      await addHtmlPageMultiPage(planDetailHtml);
    }

    /* صفحات الشواهد مصنّفة حسب العنصر */
    let recDone = 0;
    for(const el of elements){
      const recs = records.filter(r => r.element_key === el.key);
      if(!recs.length) continue;
      for(const rec of recs){
        recDone++;
        setExportBusyText(btn, `جارٍ التجهيز (${recDone}/${records.length})...`);
        let photoDataUrls = [];
        if(rec.photo_urls && rec.photo_urls.length){
          const results = await Promise.all(rec.photo_urls.filter(isImageUrl).map(toDataUrl));
          photoDataUrls = results.filter(Boolean);
        }
        await addHtmlPage(buildPdfHtml(rec, photoDataUrls));
      }
    }

    pdf.save(`Portfolio-${new Date().toISOString().slice(0,10)}.pdf`);
    showToast('تم تجهيز ملف الإنجاز بنجاح', 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + err.message, 'error');
  } finally {
    endExportBusy(btn);
  }
}


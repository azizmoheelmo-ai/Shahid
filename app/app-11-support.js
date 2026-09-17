/* ============================================
   تواصل معنا (رسائل الدعم الفني)
   ============================================
   المعلم يرسل رسالة نصية + صورة اختيارية من زر ثابت بأعلى الصفحة. تُحفظ
   الرسالة بجدول support_messages ويراجعها المسؤول من لوحة تحكمه. الصورة
   (لو أُرفقت) تُرفع بنفس حاوية shawahid-photos ضمن مجلد المستخدم الخاص
   (user_id/support/...)، فتشملها سياسات الحاوية الحالية دون أي إعداد جديد. */

let supportPhotoBlob = null; // صورة مضغوطة جاهزة للرفع، أو null

function showSupportModal(){
  document.getElementById('supportMsgBox').value = '';
  removeSupportPhoto();
  document.getElementById('supportMsgFeedback').className = 'save-msg';
  document.getElementById('supportMsgFeedback').textContent = '';
  document.getElementById('supportModal').style.display = 'flex';
}
function closeSupportModal(){
  document.getElementById('supportModal').style.display = 'none';
}

function showSupportPhotoSourcePicker(){
  document.getElementById('supportPhotoSourceModal').style.display = 'flex';
}
function closeSupportPhotoSourcePicker(){
  document.getElementById('supportPhotoSourceModal').style.display = 'none';
}
function pickSupportPhotoSource(source){
  closeSupportPhotoSourcePicker();
  const input = document.getElementById('supportPhotoInput');
  if(source === 'camera'){ input.setAttribute('capture', 'environment'); }
  else { input.removeAttribute('capture'); }
  input.value = '';
  input.click();
}

document.getElementById('supportPhotoInput').addEventListener('change', async () => {
  const input = document.getElementById('supportPhotoInput');
  const file = input.files && input.files[0];
  if(!file) return;

  if(file.size > MAX_UPLOAD_MB * 1024 * 1024){
    showToast(`حجم الصورة كبير جدًا (الحد ${MAX_UPLOAD_MB} ميجابايت).`, 'error');
    input.value = '';
    return;
  }

  try{
    const compressed = await compressImageFile(file, 1280, 0.72);
    supportPhotoBlob = compressed;
    document.getElementById('supportPhotoPreviewImg').src = URL.createObjectURL(compressed);
    document.getElementById('supportPhotoPreviewWrap').style.display = 'block';
    document.getElementById('supportAddPhotoBtn').style.display = 'none';
  } catch(err){
    showToast('تعذّر معالجة الصورة: ' + err.message, 'error');
  }
  input.value = '';
});

function removeSupportPhoto(){
  supportPhotoBlob = null;
  document.getElementById('supportPhotoPreviewImg').src = '';
  document.getElementById('supportPhotoPreviewWrap').style.display = 'none';
  document.getElementById('supportAddPhotoBtn').style.display = 'inline-flex';
}

async function submitSupportMessage(){
  const msgBox = document.getElementById('supportMsgBox');
  const feedback = document.getElementById('supportMsgFeedback');
  const message = msgBox.value.trim();

  if(!message){
    feedback.className = 'save-msg error';
    feedback.textContent = 'الرجاء كتابة وصف المشكلة أولًا.';
    return;
  }
  if(!currentUser){
    feedback.className = 'save-msg error';
    feedback.textContent = 'يجب تسجيل الدخول أولًا.';
    return;
  }

  const btn = document.getElementById('supportSendBtn');
  beginExportBusy(btn, 'جارٍ الإرسال...');
  feedback.className = 'save-msg';
  feedback.textContent = '';

  try{
    let photoUrl = null;
    if(supportPhotoBlob){
      const path = `${currentUser.id}/support/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, supportPhotoBlob, { contentType: 'image/jpeg' });
      if(upErr) throw upErr;
      const { data: pub } = sb.storage.from('shawahid-photos').getPublicUrl(path);
      photoUrl = pub.publicUrl;
    }

    const meta = currentUser.user_metadata || {};
    const { error } = await sb.from('support_messages').insert({
      user_id: currentUser.id,
      teacher_name: meta.full_name || '',
      teacher_email: currentUser.email,
      message,
      photo_url: photoUrl
    });
    if(error) throw error;

    closeSupportModal();
    showToast('تم إرسال رسالتك بنجاح — سنتواصل معك قريبًا', 'ok');
  } catch(err){
    feedback.className = 'save-msg error';
    feedback.textContent = 'تعذّر الإرسال: ' + err.message;
  } finally {
    endExportBusy(btn);
  }
}

/* ============ إدارة رسائل الدعم (لوحة تحكم المسؤول) ============ */
let supportMessages = [];
let supportMessagesFilterStatus = '';

async function loadSupportMessages(){
  if(!isAdmin) return;
  const list = document.getElementById('supportMessagesList');
  if(list) list.innerHTML = '<div class="loading-state">جارِ التحميل...</div>';

  const { data, error } = await fetchAllRows((from, to) => sb
    .from('support_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .range(from, to));

  if(error){
    if(list) list.innerHTML = '<div class="empty-state">تعذّر تحميل الرسائل: ' + error.message + '</div>';
    return;
  }

  supportMessages = data || [];
  renderSupportMessages();
  refreshSupportMessagesBadge();
}

function setSupportMessagesFilter(status, btnEl){
  supportMessagesFilterStatus = status;
  document.querySelectorAll('#supportMessagesBox .stage-filter button').forEach(b => b.classList.toggle('active', b === btnEl));
  renderSupportMessages();
}

function renderSupportMessages(){
  const list = document.getElementById('supportMessagesList');
  if(!list) return;

  const filtered = supportMessagesFilterStatus
    ? supportMessages.filter(m => m.status === supportMessagesFilterStatus)
    : supportMessages;

  if(!filtered.length){
    list.innerHTML = '<div class="empty-state">لا توجد رسائل.</div>';
    return;
  }

  list.innerHTML = filtered.map(m => {
    const dateStr = m.created_at ? new Date(m.created_at).toLocaleString('ar-SA') : '';
    const isOpen = m.status !== 'resolved';
    return `<div class="rec">
      <div class="rec-top">
        <span class="rec-title">${escapeHtml(m.teacher_name || m.teacher_email || 'معلم')}</span>
        <span class="plan-badge-count ${isOpen ? '' : 'done'}">${isOpen ? 'مفتوحة' : 'محلولة'}</span>
      </div>
      <div class="rec-date">${escapeHtml(m.teacher_email || '')} — ${escapeHtml(dateStr)}</div>
      <div class="rec-desc">${escapeHtml(m.message)}</div>
      ${m.photo_url ? `<div class="rec-photos"><a href="${escapeHtml(m.photo_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(m.photo_url)}"></a></div>` : ''}
      <div class="rec-actions">
        ${m.teacher_email ? `<a class="btn btn-outline" href="mailto:${encodeURIComponent(m.teacher_email)}?subject=${encodeURIComponent('بخصوص رسالتك في شاهد الأداء الوظيفي')}">الرد بالبريد</a>` : ''}
        ${isOpen
          ? `<button class="btn btn-primary" onclick="resolveSupportMessage('${m.id}')">تمييز كمحلولة</button>`
          : `<button class="btn btn-outline" onclick="reopenSupportMessage('${m.id}')">إعادة فتحها</button>`}
      </div>
    </div>`;
  }).join('');
}

async function resolveSupportMessage(id){
  const { error } = await sb.from('support_messages').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
  if(error){ showToast('تعذّر التحديث: ' + error.message, 'error'); return; }
  const m = supportMessages.find(x => String(x.id) === String(id));
  if(m){ m.status = 'resolved'; m.resolved_at = new Date().toISOString(); }
  renderSupportMessages();
  refreshSupportMessagesBadge();
  showToast('تم تمييز الرسالة كمحلولة', 'ok');
}

async function reopenSupportMessage(id){
  const { error } = await sb.from('support_messages').update({ status: 'open', resolved_at: null }).eq('id', id);
  if(error){ showToast('تعذّر التحديث: ' + error.message, 'error'); return; }
  const m = supportMessages.find(x => String(x.id) === String(id));
  if(m){ m.status = 'open'; m.resolved_at = null; }
  renderSupportMessages();
  refreshSupportMessagesBadge();
  showToast('تمت إعادة فتح الرسالة', 'ok');
}

/* شارة صغيرة بجانب "لوحة التحكم" بعدد الرسائل المفتوحة — تُحدَّث عند تسجيل
   الدخول (قبل حتى فتح لوحة التحكم) وبعد أي تغيير بحالة رسالة */
async function refreshSupportMessagesBadge(){
  if(!isAdmin) return;
  const badge = document.getElementById('supportMsgNavBadge');
  if(!badge) return;
  try{
    const { count, error } = await sb.from('support_messages').select('id', { count: 'exact', head: true }).eq('status', 'open');
    if(error) throw error;
    if(count > 0){
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch(e){ badge.style.display = 'none'; }
}

/* ============ (4) عدّاد دورة الأداء ============ */
function getCycleEndDate(){
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  /* نهاية الدورة تقريبًا نهاية يونيو من سنة انتهاء العام الدراسي */
  const endYear = (m >= 9) ? y + 1 : y;
  return new Date(endYear, 5, 30); // 30 يونيو
}

function renderCycleCountdown(){
  const box = document.getElementById('cycleCountdown');
  if(!box) return;
  const end = getCycleEndDate();
  const now = new Date();
  const days = Math.ceil((end - now) / (1000 * 60 * 60 * 24));

  if(days < 0){
    box.innerHTML = 'انتهت دورة الأداء الحالية — استعد لدورة العام القادم.';
    return;
  }
  const color = days <= 30 ? '#8A2C2C' : (days <= 90 ? '#6B5420' : 'var(--navy)');
  box.innerHTML = `<span style="color:${color};">متبقٍ <b>${days}</b> يومًا على انتهاء دورة الأداء (${end.toLocaleDateString('ar-SA')})</span>`;
}

/* ============ (2) تنبيه التغطية الناقصة ============ */
function getUncoveredElements(){
  const elements = getElementsOrder();
  return elements.filter(e => !(planShahidCounts[e.key] > 0));
}

function renderCoverageAlert(){
  const box = document.getElementById('coverageAlert');
  if(!box) return;
  const elements = getElementsOrder();
  const total = elements.length;
  if(!total){ box.style.display = 'none'; return; }

  const missing = getUncoveredElements();
  const started = total - missing.length;

  /* العناصر التي اكتمل مستهدفها من الخطة فعليًا */
  const completed = elements.filter(e => {
    const t = (myPlan[e.key] || {}).target_count || 0;
    return t > 0 && (planShahidCounts[e.key] || 0) >= t;
  }).length;

  box.style.display = 'block';

  if(!missing.length){
    box.style.background = '#EAF3EC';
    box.style.borderColor = '#3E8A57';
    box.style.borderRightColor = '#3E8A57';
    box.style.color = '#215C34';
    box.innerHTML = `✓ بدأت التوثيق في جميع العناصر (<b>${total} من ${total}</b>)` +
      (completed ? ` — واكتمل مستهدف <b>${completed}</b> منها.` : '.');
    return;
  }

  box.style.background = '';
  box.style.borderColor = '';
  box.style.borderRightColor = '';
  box.style.color = '';
  box.innerHTML =
    `بدأت التوثيق في <b>${started} من ${total}</b> عنصرًا` +
    (completed ? ` (اكتمل مستهدف <b>${completed}</b>)` : '') +
    ` — و<b>${missing.length}</b> ${missing.length === 1 ? 'عنصر' : 'عناصر'} بلا أي شاهد. اضغط لعرضها.`;
}

function showCoverageDetails(){
  const elements = getElementsOrder();
  if(!elements.length) return;

  const rows = elements.map(e => {
    const { name, weight } = splitLabel(e.label);
    const done = planShahidCounts[e.key] || 0;
    const target = (myPlan[e.key] || {}).target_count || 0;

    let statusText, statusColor, bg;
    if(done === 0){
      statusText = 'لم يبدأ';
      statusColor = '#8A2C2C';
      bg = '#FBEAEA';
    } else if(target > 0 && done >= target){
      statusText = `مكتمل (${done}/${target})`;
      statusColor = '#215C34';
      bg = '#EAF3EC';
    } else if(target > 0){
      statusText = `جارٍ (${done}/${target})`;
      statusColor = '#6B5420';
      bg = '#FBF3E6';
    } else {
      statusText = `${done} شاهد (بلا مستهدف)`;
      statusColor = '#2C4A72';
      bg = '#EDF1F7';
    }

    return `<div style="padding:9px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px;background:${bg};">
      <span style="font-size:12.5px;color:var(--navy);font-weight:600;flex:1;">${escapeHtml(name)} <span style="font-size:10px;color:var(--muted);font-weight:400;">${weight}</span></span>
      <span style="font-size:11px;color:${statusColor};font-weight:700;white-space:nowrap;">${statusText}</span>
    </div>`;
  }).join('');

  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 6px;font-size:15px;color:var(--navy);">حالة التوثيق لكل عنصر</h3>
      <p style="font-size:11.5px;color:var(--muted);margin:0 0 12px;line-height:1.8;">
        "لم يبدأ" = لا يوجد أي شاهد &nbsp;•&nbsp; "جارٍ" = وثّقت بعض الشواهد ولم تصل لمستهدفك &nbsp;•&nbsp; "مكتمل" = بلغت العدد المخطط له
      </p>
      <div style="border:1px solid var(--line);">${rows}</div>
    </div>`, '430px');
}

/* ============ (1) التقييم الذاتي ============ */
let mySelfAssessment = {};

let selfViewYear = null;

async function showSelfAssessment(){
  hideAllMainViews();
  setActiveBottomTab(null);
  document.getElementById('selfView').style.display = 'block';
  selfViewYear = getCycleYear();
  document.getElementById('selfRows').innerHTML = '<div class="loading-state">جارِ التحميل...</div>';

  const years = await loadAvailableCycleYears();
  const sel = document.getElementById('selfYearSelect');
  sel.innerHTML = years.map(y => `<option value="${y}" ${y === selfViewYear ? 'selected' : ''}>${y}${y === getCycleYear() ? ' (الحالية)' : ''}</option>`).join('');

  await switchSelfYear(selfViewYear);
}

async function switchSelfYear(year){
  selfViewYear = year;
  document.getElementById('selfCycleYear').textContent = year;
  const isCurrent = (year === getCycleYear());

  document.getElementById('selfHistoryBanner').hidden = isCurrent;
  document.getElementById('selfEditControls').style.display = isCurrent ? 'flex' : 'none';
  document.getElementById('selfBulkControls').style.display = isCurrent ? 'flex' : 'none';

  document.getElementById('selfRows').innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  await loadPlan(year);
  await loadSelfAssessment(year);

  if(isCurrent){
    renderSelfRows();
  } else {
    renderSelfRowsReadOnly();
  }
}

let _loadSelfToken = 0;

async function loadSelfAssessment(year){
  const myToken = ++_loadSelfToken;
  const y = year || getCycleYear();
  const _mySelfAssessment = {};
  try{
    /* .eq('user_id', ...) ضروري: self_assessment له صلاحية "المسؤول يشوف كل
       التقييمات الذاتية" — بدون هذا الفلتر، حساب مسؤول يرى تقييمات كل
       المعلمين مختلطة ببعضها بمجرد وجود معلم آخر له تقييم بنفس عنصر الأداء
       ونفس الدورة (يُستبدل تقييمه بتقييم زميله بصمت، لا خطأ ولا تحذير) */
    const { data } = await sb.from('self_assessment')
      .select('*').eq('user_id', currentUser.id).eq('cycle_year', y);
    (data || []).forEach(s => {
      _mySelfAssessment[s.element_key] = { self_level: s.self_level, self_note: s.self_note, element_label: s.element_label || s.element_key };
    });
  } catch(e){ /* تجاهل */ }

  if(myToken !== _loadSelfToken) return;
  mySelfAssessment = _mySelfAssessment;
}

/* عرض للقراءة فقط لتقييم ذاتي من دورة سابقة */
function renderSelfRowsReadOnly(){
  const box = document.getElementById('selfRows');
  const elements = withOrphanSelfElements(getElementsOrder());
  const rated = elements.filter(el => mySelfAssessment[el.key] && mySelfAssessment[el.key].self_level);

  if(!rated.length){
    box.innerHTML = '<div class="empty-state">لا يوجد تقييم ذاتي محفوظ لهذه الدورة.</div>';
    return;
  }

  box.innerHTML = rated.map((el, idx) => {
    const { name, weight } = splitLabel(el.label);
    const s = mySelfAssessment[el.key];
    return `
      <div class="self-row" style="background:#F7F5F0;">
        <div class="self-row-head" style="cursor:default;">
          <span class="self-elem-name">${idx+1}. ${escapeHtml(name)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="plan-badge-level">${s.self_level}</span>
            <span class="plan-elem-weight">${weight}</span>
          </div>
        </div>
        <div class="self-row-body" style="display:block;">
          ${s.self_note ? `<p style="font-size:12px;color:#3F3B31;line-height:1.8;margin:0;">${escapeHtml(s.self_note)}</p>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* عناصر لها تقييم ذاتي محفوظ لكنها لم تعد ضمن قالب التقييم الحالي (نفس حالة
   renderShawahidGroups/renderPlanRows — أشهرها: إلغاء تفعيل "نشاط طلابي" بعد
   تقييم عناصره). التقييم نفسه لا يُحذف من القاعدة؛ نعرضه بعنوانه المحفوظ
   وقته (element_label بكل صف) بدل إخفائه كليًا. */
function withOrphanSelfElements(elements){
  const activeKeys = new Set(elements.map(e => e.key));
  const orphanElements = Object.keys(mySelfAssessment)
    .filter(k => !activeKeys.has(k) && mySelfAssessment[k])
    .map(key => ({ key, label: mySelfAssessment[key].element_label || key, active: false }));
  return elements.map(e => Object.assign({ active: true }, e)).concat(orphanElements);
}

function renderSelfRows(){
  const box = document.getElementById('selfRows');
  const elements = withOrphanSelfElements(getElementsOrder());
  if(!elements.length){
    box.innerHTML = '<div class="empty-state">لم يتم تحميل عناصر الأداء بعد.</div>';
    return;
  }

  /* حفظ حالة الطي الحالية قبل إعادة الرسم */
  const openState = {};
  document.querySelectorAll('#selfRows .self-row').forEach((r, i) => {
    openState[i] = !r.classList.contains('self-collapsed');
  });

  box.innerHTML = elements.map((el, idx) => {
    const { name, weight } = splitLabel(el.label);
    const plan = myPlan[el.key] || {};
    const self = mySelfAssessment[el.key] || {};
    const done = planShahidCounts[el.key] || 0;

    const levelOpts = [5,4,3,2,1].map(lv =>
      `<option value="${lv}" ${self.self_level === lv ? 'selected' : ''}>${lv} — ${LEVEL_NAMES[lv]}</option>`
    ).join('');

    let gapHtml = '';
    let gapBadge = '';
    if(plan.target_level && self.self_level){
      if(self.self_level === plan.target_level){
        gapHtml = `<div class="self-gap match">✓ تقييمك الذاتي مطابق لما خططت له</div>`;
        gapBadge = `<span class="self-badge-gap match">✓</span>`;
      } else if(self.self_level < plan.target_level){
        gapHtml = `<div class="self-gap below">تقييمك أقل من مستهدفك بـ ${plan.target_level - self.self_level} درجة — وضّح السبب في ملاحظتك.</div>`;
        gapBadge = `<span class="self-badge-gap below">-${plan.target_level - self.self_level}</span>`;
      } else {
        gapHtml = `<div class="self-gap above">تقييمك أعلى من مستهدفك بـ ${self.self_level - plan.target_level} درجة — تأكد أن شواهدك تدعم ذلك.</div>`;
        gapBadge = `<span class="self-badge-gap above">+${self.self_level - plan.target_level}</span>`;
      }
    }

    const collapsed = openState[idx] === true ? '' : 'self-collapsed';

    return `
      <div class="self-row ${collapsed}" id="selfRow-${idx}" data-key="${escapeHtml(el.key)}" data-label="${escapeHtml(el.label)}">
        <div class="self-row-head" onclick="toggleSelfRow(${idx})">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            <span class="plan-row-chev" id="selfRowChev-${idx}">${collapsed ? '▾' : '▴'}</span>
            <span class="self-elem-name">${idx+1}. ${escapeHtml(name)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${self.self_level ? `<span class="plan-badge-level">${self.self_level}</span>` : ''}
            ${gapBadge}
            <span class="plan-elem-weight">${weight}</span>
          </div>
        </div>

        <div class="self-row-body">
          <div class="self-context">
            <span>خططت لمستوى: <b>${plan.target_level ? plan.target_level + ' — ' + LEVEL_NAMES[plan.target_level] : '—'}</b></span>
            <span>وثّقت: <b>${done}</b>${plan.target_count ? ' من ' + plan.target_count : ''} شاهد</span>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--muted);margin-bottom:4px;">تقييمك الذاتي</label>
            <select class="goal-input self-level" onchange="renderSelfRowsPreserve()">
              <option value="">— اختر —</option>
              ${levelOpts}
            </select>
          </div>
          <div style="margin-top:10px;">
            <label style="display:block;font-size:11px;color:var(--muted);margin-bottom:4px;">مبرراتك وأبرز إنجازاتك في هذا العنصر</label>
            <textarea rows="2" class="self-note" maxlength="2000" placeholder="اكتب ما يدعم تقييمك: أبرز شاهد، أثر ملموس، أو تحدٍّ واجهك...">${escapeHtml(self.self_note || '')}</textarea>
          </div>
          ${gapHtml}
        </div>
      </div>`;
  }).join('');
}

/* فتح/طي بطاقة عنصر في التقييم الذاتي */
function toggleSelfRow(idx){
  const row = document.getElementById('selfRow-' + idx);
  const chev = document.getElementById('selfRowChev-' + idx);
  if(!row) return;
  const opening = row.classList.contains('self-collapsed');
  row.classList.toggle('self-collapsed', !opening);
  if(chev) chev.textContent = opening ? '▴' : '▾';
}

/* فتح أو طي جميع عناصر التقييم الذاتي */
function toggleSelfAll(expand){
  document.querySelectorAll('#selfRows .self-row').forEach((row, i) => {
    row.classList.toggle('self-collapsed', !expand);
    const chev = document.getElementById('selfRowChev-' + i);
    if(chev) chev.textContent = expand ? '▴' : '▾';
  });
}

/* إعادة الرسم مع الحفاظ على ما كتبه المستخدم (لتحديث رسالة الفجوة فورًا) */
function renderSelfRowsPreserve(){
  document.querySelectorAll('#selfRows .self-row').forEach(row => {
    const key = row.dataset.key;
    const lv = row.querySelector('.self-level').value;
    mySelfAssessment[key] = mySelfAssessment[key] || {};
    mySelfAssessment[key].self_level = lv ? Number(lv) : null;
    mySelfAssessment[key].self_note = row.querySelector('.self-note').value;
  });
  renderSelfRows();
}

async function saveSelfAssessment(){
  const msg = document.getElementById('selfMsg');
  msg.style.color = 'var(--muted)';
  msg.textContent = 'جارٍ الحفظ...';

  try{
    const rows = Array.from(document.querySelectorAll('#selfRows .self-row'));
    const records = rows.map(row => {
      const lv = row.querySelector('.self-level').value;
      return {
        user_id: currentUser.id,
        cycle_year: getCycleYear(),
        element_key: row.dataset.key,
        element_label: row.dataset.label,
        self_level: lv ? Number(lv) : null,
        self_note: row.querySelector('.self-note').value.trim()
      };
    });

    const { error } = await sb.from('self_assessment')
      .upsert(records, { onConflict: 'user_id,cycle_year,element_key' });
    if(error) throw error;

    msg.style.color = '#215C34';
    msg.textContent = 'تم حفظ تقييمك الذاتي ✓';
    showToast('تم حفظ التقييم الذاتي', 'ok');
    await loadSelfAssessment();
    renderSelfRows();
  } catch(err){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'خطأ: ' + err.message;
  }
}


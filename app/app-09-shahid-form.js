/* ============================================
   (4) مؤشر الاكتمال الموزون
   يحسب التقدم وفق الوزن النسبي لكل عنصر (10% أو 5%)
   بدل معاملة كل العناصر بالتساوي
   ============================================ */
function getElementWeight(key){
  const el = DB_ELEMENTS.find(e => e.key === key);
  return el ? (Number(el.weight) || 0) : 0;
}

function computeWeightedProgress(){
  const elements = getElementsOrder();
  let weightedDone = 0;
  let totalWeight = 0;

  elements.forEach(e => {
    const w = getElementWeight(e.key);
    if(!w) return;
    totalWeight += w;

    const target = (myPlan[e.key] || {}).target_count || 0;
    const done = planShahidCounts[e.key] || 0;

    /* نسبة إنجاز العنصر: إن لم يُحدَّد مستهدف، يُعدّ منجزًا بمجرد وجود شاهد */
    let ratio;
    if(target > 0) ratio = Math.min(1, done / target);
    else ratio = done > 0 ? 1 : 0;

    weightedDone += w * ratio;
  });

  const pct = totalWeight ? Math.round((weightedDone / totalWeight) * 100) : 0;
  return { pct, weightedDone: Math.round(weightedDone * 10) / 10, totalWeight };
}

async function refreshPlanSummary(){
  const sub = document.getElementById('planHomeSub');
  if(!sub) return;
  try{
    await loadPlan();
    const planned = Object.values(myPlan).filter(p => p.target_count > 0);
    if(!planned.length){
      sub.textContent = 'لم تضع خطتك بعد — ابدأ بتحديد مستهدفاتك لهذا العام';
    } else {
      const totalTarget = planned.reduce((s, p) => s + (p.target_count || 0), 0);
      let totalDone = 0;
      Object.keys(myPlan).forEach(k => {
        const t = myPlan[k].target_count || 0;
        if(t > 0) totalDone += Math.min(t, planShahidCounts[k] || 0);
      });
      const pct = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0;
      const wp = computeWeightedProgress();
      sub.textContent = `وثّقت ${totalDone} من ${totalTarget} شاهد — بحسب وزن كل عنصر: ${wp.pct}% إجمالًا`;
    }
  } catch(e){
    sub.textContent = 'حدّد مستهدفاتك لعناصر الأداء قبل بدء التوثيق';
  }

  /* ملخص التقييم الذاتي */
  const selfSub = document.getElementById('selfHomeSub');
  if(selfSub){
    try{
      await loadSelfAssessment();
      const filled = Object.values(mySelfAssessment).filter(s => s.self_level).length;
      const total = getElementsOrder().length;
      selfSub.textContent = filled
        ? `قيّمت ${filled} من ${total} عنصرًا`
        : 'قيّم أداءك استعدادًا لجلسة التقييم النهائية';
    } catch(e){ /* تجاهل */ }
  }
}

function renderWeightedBar(){
  const box = document.getElementById('weightedProgress');
  if(!box) return;
  const wp = computeWeightedProgress();
  if(!wp.totalWeight){ box.style.display = 'none'; return; }

  const color = wp.pct >= 80 ? '#215C34' : (wp.pct >= 40 ? 'var(--gold)' : '#B23A3A');
  box.style.display = 'block';
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
      <span style="font-size:12px;color:var(--muted);">الاكتمال الموزون لعناصر الأداء</span>
      <span style="font-size:15px;font-weight:800;color:${color};">${wp.pct}%</span>
    </div>
    <div style="background:#F1EEE6;height:10px;">
      <div style="background:${color};height:100%;width:${wp.pct}%;transition:width .4s;"></div>
    </div>
    <div style="font-size:10.5px;color:var(--muted);margin-top:5px;cursor:pointer;text-decoration:underline;" onclick="showWeightedInfo()">
      ما معنى "الاكتمال الموزون"؟
    </div>`;
}

/* ثلاث حالات فقط بألوان خفيفة هادئة (لا تدرّج متعدد الدرجات): أحمر فاتح
   (٠٪ — لم يبدأ)، برتقالي فاتح (بين ٠ و١٠٠٪ — قيد التقدم)، أخضر فاتح
   (١٠٠٪ — مكتمل). تُطبَّق على خلفية الصف كاملاً لا على لون النص (يبقى
   النص أسود عاديًا). */
function ratioToBgColor(ratio){
  if(ratio <= 0) return '#F7D8D6';
  if(ratio >= 1) return '#D7EFDD';
  return '#FBE4C6';
}

function showWeightedInfo(){
  const elements = getElementsOrder();
  const rows = elements.map(e => {
    const { name } = splitLabel(e.label);
    const w = getElementWeight(e.key);
    const target = (myPlan[e.key] || {}).target_count || 0;
    const done = planShahidCounts[e.key] || 0;
    const ratio = target > 0 ? Math.min(1, done / target) : (done > 0 ? 1 : 0);
    const contributed = Math.round(w * ratio * 10) / 10;
    const bg = ratioToBgColor(ratio);
    return `<tr style="background:${bg};">
      <td style="padding:6px 9px;border:1px solid var(--line);font-size:11.5px;text-align:right;color:#1A1A1A;">${escapeHtml(name)}</td>
      <td style="padding:6px 9px;border:1px solid var(--line);font-size:11.5px;text-align:center;color:#1A1A1A;">${w}%</td>
      <td style="padding:6px 9px;border:1px solid var(--line);font-size:11.5px;text-align:center;font-weight:700;color:#1A1A1A;">${Math.round(ratio*100)}%</td>
      <td style="padding:6px 9px;border:1px solid var(--line);font-size:11.5px;text-align:center;font-weight:700;color:#1A1A1A;">${contributed}</td>
    </tr>`;
  }).join('');

  const wp = computeWeightedProgress();

  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 8px;font-size:15px;color:var(--navy);">الاكتمال الموزون</h3>
      <p style="font-size:12.5px;line-height:1.9;color:#413D33;margin:0 0 12px;">
        ليست كل العناصر متساوية: بعضها بوزن <b>10%</b> وبعضها <b>5%</b>. المؤشر العادي يعاملها بالتساوي، أما الموزون فيحسب مساهمة كل عنصر بحسب وزنه الفعلي — فيعطيك صورة أقرب لواقع التقييم الرسمي.
      </p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#F1EEE6;">
          <th style="padding:7px;border:1px solid var(--line);font-size:11px;">العنصر</th>
          <th style="padding:7px;border:1px solid var(--line);font-size:11px;">وزنه</th>
          <th style="padding:7px;border:1px solid var(--line);font-size:11px;">إنجازك</th>
          <th style="padding:7px;border:1px solid var(--line);font-size:11px;">المحقق</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:${ratioToBgColor(wp.pct/100)};">
          <td colspan="3" style="padding:8px;border:1px solid var(--line);font-size:12px;font-weight:700;text-align:right;color:#1A1A1A;">الإجمالي الموزون</td>
          <td style="padding:8px;border:1px solid var(--line);font-size:12.5px;font-weight:800;text-align:center;color:#1A1A1A;">${wp.weightedDone} / ${wp.totalWeight}</td>
        </tr></tfoot>
      </table>
      <p style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.8;">
        هذا مؤشر شخصي لمتابعة توثيقك — وليس درجة رسمية. الدرجة النهائية يحددها مديرك المباشر وفق النموذج المعتمد.
      </p>
    </div>`, '470px');
}

function splitLabel(label){
  const m = label.match(/^(.*)\((\d+%)\)\s*$/);
  if(m) return { name: m[1].trim(), weight: m[2] };
  return { name: label, weight: '' };
}
function getElementsOrder(){
  return Array.from(elementSelect.options)
    .filter(o => o.value)
    .map(o => ({ key: o.value, label: o.textContent.trim() }));
}

async function loadMyShawahid(){
  const body = document.getElementById('listBody');
  body.innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  /* فلترة صريحة بمعرّف المستخدم ضرورية هنا: shawahid له صلاحية "المسؤول
     يشوف الكل" أيضًا، فبدونها تظهر شواهد كل المعلمين مختلطة في قائمة
     "شواهدي" الخاصة بحساب المسؤول بدل شواهده هو فقط. */
  const { data, error } = await fetchAllRows((from, to) => sb
    .from('shawahid')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .range(from, to));

  if(error){
    body.innerHTML = '<div class="empty-state">تعذّر تحميل الشواهد: ' + error.message + '</div>';
    myRecords = [];
    return;
  }

  myRecords = data || [];

  /* تصنيف تلقائي للشواهد القديمة التي أُنشئت قبل إضافة ميزتي تصنيف المرحلة وسنة الدورة */
  myRecords.forEach(r => {
    if(!r.cycle_stage){
      r.cycle_stage = getCycleStageKey(new Date(r.lesson_date || r.created_at || Date.now()));
    }
    if(!r.cycle_year){
      r.cycle_year = getCycleYear(r.lesson_date || r.created_at || undefined);
    }
  });

  document.getElementById('shahidSearch').value = '';
  currentStageFilter = '';
  document.querySelectorAll('.stage-filter button').forEach(b => b.classList.toggle('active', b.dataset.stage === ''));
  document.getElementById('listTitle').textContent = `شواهدي المحفوظة (${myRecords.length})`;
  updateFilterSummary();
  document.getElementById('filterPanel').style.display = 'none';
  document.getElementById('filterChevron').textContent = '▾ عرض';
  renderShawahidGroups(myRecords, false);
}

let currentStageFilter = '';
/* (5) طي/فتح لوحة البحث والفلترة، مع ملخص للحالة النشطة */
function toggleFilterPanel(){
  const panel = document.getElementById('filterPanel');
  const chev = document.getElementById('filterChevron');
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  chev.textContent = opening ? '▴ إخفاء' : '▾ عرض';
}

function updateFilterSummary(){
  const el = document.getElementById('filterSummary');
  if(!el) return;
  const q = (document.getElementById('shahidSearch') || {}).value || '';
  const stageLabels = { planning: 'التخطيط', midreview: 'المراجعة نصف السنوية', evaluation: 'التقييم' };
  const parts = [];
  if(currentStageFilter) parts.push(stageLabels[currentStageFilter] || currentStageFilter);
  if(q.trim()) parts.push(`بحث: "${q.trim()}"`);
  el.textContent = parts.length ? `فلترة وبحث — ${parts.join(' • ')}` : 'فلترة وبحث';
}

function setStageFilter(stage, btnEl){
  currentStageFilter = stage;
  document.querySelectorAll('.stage-filter button').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  filterMyShawahid();
  updateFilterSummary();
}

function filterMyShawahid(){
  const q = document.getElementById('shahidSearch').value.trim().toLowerCase();
  updateFilterSummary();
  let filtered = myRecords;

  if(currentStageFilter){
    filtered = filtered.filter(r => r.cycle_stage === currentStageFilter);
  }
  if(q){
    filtered = filtered.filter(r =>
      (r.lesson_title || '').toLowerCase().includes(q) ||
      (r.class_name || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.element_label || '').toLowerCase().includes(q) ||
      (r.ref_number || '').toLowerCase().includes(q)
    );
  }

  const isFiltering = !!(q || currentStageFilter);
  document.getElementById('listTitle').textContent = isFiltering
    ? `نتائج (${filtered.length})`
    : `شواهدي المحفوظة (${myRecords.length})`;
  renderShawahidGroups(filtered, isFiltering);
}

function renderShawahidGroups(records, autoOpen){
  const body = document.getElementById('listBody');
  if(records.length === 0){
    if(myRecords.length === 0){
      /* (6) لا يوجد أي شاهد بعد — شاشة ترحيبية بدعوة واضحة للبدء */
      body.innerHTML = `
        <div class="friendly-empty">
          <div class="fe-icon">📝</div>
          <div class="fe-title">لسه ما وثّقت أي شاهد</div>
          <p class="fe-sub">ابدأ بتوثيق أول شاهد أداء لك — تقدر تختار من نماذج جاهزة توفّر عليك الوقت.</p>
          <button class="btn btn-primary" onclick="startNewShahid()">+ أضف أول شاهد</button>
        </div>`;
    } else {
      body.innerHTML = `
        <div class="friendly-empty">
          <div class="fe-icon">🔍</div>
          <div class="fe-title">لا توجد نتائج مطابقة</div>
          <p class="fe-sub">جرّب تعديل كلمة البحث أو الفلتر المختار.</p>
        </div>`;
    }
    return;
  }

  const elements = getElementsOrder();
  const grouped = {};
  elements.forEach(e => grouped[e.key] = []);
  records.forEach(r => {
    if(!grouped[r.element_key]) grouped[r.element_key] = [];
    grouped[r.element_key].push(r);
  });

  body.innerHTML = elements.map((el, idx) => {
    const { name, weight } = splitLabel(el.label);
    const recs = grouped[el.key] || [];
    const count = recs.length;
    const recsHtml = count
      ? recs.map(renderRecCard).join('')
      : '<div class="criterion-empty">لا توجد شواهد لهذا العنصر بعد.</div>';
    return `
      <div class="criterion-group ${autoOpen && count > 0 ? 'open' : ''}" id="grp-${idx}">
        <div class="criterion-head" onclick="toggleGroup('grp-${idx}')">
          <div class="left">
            <span class="dot"></span>
            <span class="name">${escapeHtml(name)}</span>
            <span class="weight">${weight}</span>
          </div>
          <div class="left">
            <span class="count ${count === 0 ? 'zero' : ''}">${count}</span>
            <span class="chevron">▾</span>
          </div>
        </div>
        <div class="criterion-body">
          <div class="criterion-actions">
            <button class="btn btn-outline" style="padding:5px 12px;font-size:11px;" onclick="addShahidForElement('${escapeHtml(el.key)}')">+ إضافة شاهد لهذا العنصر</button>
            <button class="btn btn-outline" style="padding:5px 12px;font-size:11px;" onclick="goToPlanForElement('${escapeHtml(el.key)}')">عرض في الخطة</button>
          </div>
          ${recsHtml}
        </div>
      </div>`;
  }).join('');
}

function toggleGroup(id){
  document.getElementById(id).classList.toggle('open');
}

function renderRecCard(r){
  const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-SA') : '';
  const photos = (r.photo_urls || []);
  const photosHtml = photos.length
    ? '<div class="rec-photos">' + photos.map(u => `<img src="${escapeHtml(u)}">`).join('') + '</div>'
    : '';
  const descSnippet = (r.description || '').slice(0, 160);
  const title = r.lesson_title || r.class_name || 'بدون عنوان';

  const editedLater = r.updated_at && r.created_at &&
    (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60000);
  const refLine = `<div class="rec-ref">${r.ref_number ? `الرقم المرجعي: <b>${escapeHtml(r.ref_number)}</b>` : ''}${editedLater ? ` — آخر تعديل: ${new Date(r.updated_at).toLocaleDateString('ar-SA')}` : ''}</div>`;
  const stageTag = r.cycle_stage && CYCLE_STAGES[r.cycle_stage]
    ? `<span class="stage-tag">${CYCLE_STAGES[r.cycle_stage].label}</span>`
    : '';

  return `
    <div class="rec">
      ${refLine}
      ${stageTag}
      <div class="rec-top">
        <span class="rec-title">${escapeHtml(title)}</span>
        <span class="rec-date">${date}</span>
      </div>
      <div class="rec-desc">${escapeHtml(descSnippet)}${(r.description||'').length > 160 ? '…' : ''}</div>
      ${photosHtml}
      <div class="rec-actions">
        <button class="btn btn-outline" onclick="editRecord('${r.id}')">تعديل</button>
        <button class="btn btn-outline" onclick="duplicateRecord('${r.id}')">نسخ</button>
        <button class="btn btn-outline" onclick="printRecord('${r.id}', event)">طباعة</button>
        <button class="btn btn-danger" onclick="deleteRecord('${r.id}')">حذف</button>
        <button class="btn btn-whatsapp" onclick="shareWhatsApp('${r.id}', event)">إرسال واتساب</button>
      </div>
    </div>`;
}

function escapeHtml(str){
  /* تهريب كامل يشمل علامتي الاقتباس (المفردة والمزدوجة) لأن الدالة تُستخدم
     داخل نصوص HTML وداخل قيم الخصائص (attributes) على حد سواء — النسخة
     السابقة (المعتمدة على textContent/innerHTML) كانت تهرّب < > & فقط،
     فأي قيمة تحتوي على " كانت تكسر خصائص مثل value="..." أو src="..." */
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============ الخطوات ============ */
const stepsList = document.getElementById('stepsList');
function renumberSteps(){
  stepsList.querySelectorAll('li .num').forEach((el, i) => { el.textContent = i + 1; });
}
function addStep(){
  const li = document.createElement('li');
  const n = stepsList.children.length + 1;
  li.innerHTML = `<span class="num">${n}</span><textarea rows="1" maxlength="500" placeholder="اكتب الخطوة..."></textarea><button class="remove-step" title="حذف الخطوة" onclick="removeStep(this)">×</button>`;
  stepsList.appendChild(li);
  li.querySelector('textarea').focus();
}
function removeStep(btn){
  const li = btn.closest('li');
  if(stepsList.children.length > 1){ li.remove(); renumberSteps(); }
  else { li.querySelector('textarea').value = ''; }
}

/* ============ عنصر الأداء ============ */
const elementSelect = document.getElementById('elementSelect');
const elementExample = document.getElementById('elementExample');
const elementExampleWrap = document.getElementById('elementExampleWrap');
const restSections = document.getElementById('restSections');
const descHeading = document.getElementById('descHeading');
const descBox = document.getElementById('descBox');
const goalBox = document.getElementById('goalBox');
const quantBox = document.getElementById('quantBox');
const qualBox = document.getElementById('qualBox');
const reflectionBox = document.getElementById('reflectionBox');
const templatePickerWrap = document.getElementById('templatePickerWrap');
const templateSelect = document.getElementById('templateSelect');

function populateTemplateOptions(elementKey){
  templateSelect.innerHTML = '<option value="">— أكتب بنفسي (بدون نموذج) —</option>';
  const list = SHAHID_TEMPLATES[elementKey];
  if(!list || !list.length){
    templatePickerWrap.hidden = true;
    return;
  }
  list.forEach((tpl, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = tpl.name;
    templateSelect.appendChild(o);
  });
  templateSelect.value = '';
  templatePickerWrap.hidden = false;
  updateTemplateHint();
}

/* هل توجد كتابة فعلية في حقول الشاهد الآن (بصرف النظر عن مصدرها)؟ */
function hasExistingShahidContent(){
  const stepsText = Array.from(stepsList.querySelectorAll('textarea')).map(t => t.value.trim()).join('');
  return !!(descBox.value.trim() || goalBox.value.trim() || quantBox.value.trim() ||
            qualBox.value.trim() || reflectionBox.value.trim() || stepsText);
}

/* تعبئة كل حقول الشاهد (الوصف/الهدف/الخطوات/الأثر/التأمل) من نموذج مُعطى،
   أو من نموذج فارغ بالكامل لو تُرك بلا وسيط — يشترك فيها كل من applyTemplate
   (اختيار نموذج جاهز) والتفريغ عند اختيار "أكتب بنفسي". */
function fillShahidFields(tpl){
  descBox.value = (tpl && tpl.description) || '';
  goalBox.value = (tpl && tpl.goal) || '';
  quantBox.value = (tpl && tpl.quant) || '';
  qualBox.value = (tpl && tpl.qual) || '';
  reflectionBox.value = (tpl && tpl.reflection) || '';

  stepsList.innerHTML = '';
  const steps = (tpl && tpl.steps && tpl.steps.length) ? tpl.steps : [''];
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${i+1}</span><textarea rows="1" maxlength="500" placeholder="اكتب الخطوة..."></textarea><button class="remove-step" title="حذف الخطوة" onclick="removeStep(this)">×</button>`;
    li.querySelector('textarea').value = s;
    stepsList.appendChild(li);
  });
}

function applyTemplate(){
  const elementKey = elementSelect.value;
  const idx = templateSelect.value;
  const prevValue = applyTemplate._lastValue || '';

  if(idx === ''){
    /* "أكتب بنفسي" تعني صفحة فارغة فعلاً لأكتب فيها — لا الإبقاء الصامت
       على نص نموذج سابق كما كان يحدث سابقًا (وهذا بالضبط ما كان يجعل
       المعلم يشعر أنه "لا يقدر يكتب": الحقول تبقى معبأة بنص النموذج
       القديم بصمت، ولازم يمسحه هو بنفسه أولًا قبل ما يقدر يكتب مكانه). */
    if(prevValue !== '' && hasExistingShahidContent()){
      const ok = window.confirm('اخترت "أكتب بنفسي" — سيُفرَّغ محتوى النموذج الحالي من كل الحقول أدناه لتبدأ من صفحة فارغة.\n\nهل تريد المتابعة؟');
      if(!ok){
        templateSelect.value = prevValue;
        updateTemplateHint();
        return;
      }
    }
    fillShahidFields(null);
    applyTemplate._lastValue = '';
    formDirty = true;
    scheduleDraftSave();
    updateTemplateHint();
    return;
  }

  const tpl = (SHAHID_TEMPLATES[elementKey] || [])[Number(idx)];
  if(!tpl) return;

  if(hasExistingShahidContent()){
    /* نافذة تأكيد النظام الأساسية في المتصفح — لا تعتمد على أي حالة مشتركة قد تتعارض */
    const ok = window.confirm('عندك محتوى مكتوب في هذا الشاهد.\nاختيار نموذج جديد سيستبدل كل الحقول أدناه بمحتوى النموذج، وتفقد ما كتبته.\n\nهل تريد المتابعة؟');
    if(!ok){
      templateSelect.value = prevValue;
      updateTemplateHint();
      return;
    }
  }

  fillShahidFields(tpl);

  applyTemplate._lastValue = idx;
  formDirty = true;
  scheduleDraftSave();
  updateTemplateHint();
  showToast('تم تطبيق النموذج', 'ok');
}
templateSelect.addEventListener('change', applyTemplate);

async function loadPerformanceElements(){
  try{
    const { data, error } = await sb.from('performance_elements')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if(error || !data || !data.length){
      DB_ELEMENTS = Object.keys(ELEMENT_META).map((key, i) => ({ key, label: key, weight: 10, sort_order: i }));
    } else {
      DB_ELEMENTS = data;
    }
  } catch(e){
    DB_ELEMENTS = Object.keys(ELEMENT_META).map((key, i) => ({ key, label: key, weight: 10, sort_order: i }));
  }
  populateElementSelect();
}

function populateElementSelect(){
  const select = document.getElementById('elementSelect');
  if(!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="" selected>— اختر عنصر الأداء —</option>';
  DB_ELEMENTS.forEach(el => {
    const meta = ELEMENT_META[el.key] || {};
    const opt = document.createElement('option');
    opt.value = el.key;
    opt.textContent = `${el.label} (${el.weight}%)`;
    opt.setAttribute('data-example', meta.example || '');
    opt.setAttribute('data-heading', meta.heading || 'وصف الإجراء / الممارسة');
    opt.setAttribute('data-placeholder', meta.placeholder || 'اكتب وصفًا تفصيليًا للإجراء أو الممارسة المرتبطة بهذا العنصر...');
    opt.setAttribute('data-goal', meta.goal || 'اكتب الهدف الذي تسعى لتحقيقه من هذا الإجراء...');
    opt.setAttribute('data-quant', meta.quant || 'مثال: نسبة أو عدد يوضح الأثر الكمي');
    opt.setAttribute('data-qual', meta.qual || 'مثال: ملاحظة نوعية توضح الأثر');
    opt.setAttribute('data-reflection', meta.reflection || 'ما الذي نجح في هذا الإجراء؟ وما الذي سأطوّره لاحقًا؟');
    select.appendChild(opt);
  });
  if(currentVal){ select.value = currentVal; }
}

function updateExample(){
  const opt = elementSelect.options[elementSelect.selectedIndex];
  const text = opt.getAttribute('data-example') || '';
  const heading = opt.getAttribute('data-heading') || '';
  const placeholder = opt.getAttribute('data-placeholder') || '';
  const goal = opt.getAttribute('data-goal') || '';
  const quant = opt.getAttribute('data-quant') || '';
  const qual = opt.getAttribute('data-qual') || '';
  const reflection = opt.getAttribute('data-reflection') || '';

  if(text){ elementExample.textContent = text; elementExampleWrap.hidden = false; }
  else { elementExample.textContent = ''; elementExampleWrap.hidden = true; }

  if(opt.value){
    restSections.hidden = false;
    descHeading.textContent = heading;
    descBox.placeholder = placeholder;
    goalBox.placeholder = goal;
    quantBox.placeholder = quant;
    qualBox.placeholder = qual;
    reflectionBox.placeholder = reflection;
    populateTemplateOptions(opt.value);
    showPlanReminder(opt.value);
  } else {
    restSections.hidden = true;
    templatePickerWrap.hidden = true;
    document.getElementById('planReminder').hidden = true;
    document.getElementById('goalPickerWrap').hidden = true;
  }
}

function showPlanReminder(elementKey){
  const box = document.getElementById('planReminder');
  const plan = myPlan[elementKey];
  if(!plan || (!plan.target_level && !plan.target_count)){
    box.hidden = true;
  } else {
    const done = planShahidCounts[elementKey] || 0;
    const target = plan.target_count || 0;
    const parts = [];
    if(plan.target_level) parts.push(`مستهدفك: <b>${plan.target_level} — ${LEVEL_NAMES[plan.target_level]}</b>`);
    if(target > 0) parts.push(`وثّقت <b>${done}</b> من <b>${target}</b> شاهد`);
    let html = 'من خطتك: ' + parts.join(' — ');
    if(plan.personal_note){
      html += `<div style="margin-top:5px;font-size:11.5px;color:#3E6B4A;">${escapeHtml(plan.personal_note)}</div>`;
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  /* تعبئة قائمة الأهداف المتاحة لهذا العنصر، إن وُجدت */
  const wrap = document.getElementById('goalPickerWrap');
  const picker = document.getElementById('goalPicker');
  const goals = (myPlanGoals[elementKey] || []).filter(g => g.id);
  if(!goals.length){
    wrap.hidden = true;
    picker.innerHTML = '<option value="">— بدون تحديد —</option>';
    return;
  }
  picker.innerHTML = '<option value="">— بدون تحديد —</option>' + goals.map((g, i) => {
    const done = goalShahidCounts[g.id] || 0;
    const lvl = g.target_level ? `مستوى ${g.target_level}` : 'بلا مستوى محدد';
    const cnt = g.target_count ? ` — ${done}/${g.target_count} شواهد` : '';
    const label = goalDisplayName(g, i);
    return `<option value="${g.id}">${escapeHtml(label)} (${lvl}${cnt})</option>`;
  }).join('');
  wrap.hidden = false;

  /* لو الهدف واحد بس لهذا العنصر، نختاره تلقائيًا بدل ما نضيف خطوة يدوية */
  if(goals.length === 1){
    picker.value = goals[0].id;
  }
  updateGoalPickerHint();
}

/* توضيح مكان الكتابة اليدوية عند اختيار "بدون تحديد"/"أكتب بنفسي" — لا
   تعطيل أي حقل، فقط إشارة صريحة لمكان الحقل الحر الموجود أصلاً بالأسفل،
   لأن غياب هذا التوضيح كان يوهم بعض المعلمين أن لا مجال للكتابة اليدوية
   إطلاقًا هنا رغم أن الحقول الفعلية بالأسفل تقبل الكتابة دائمًا. */
function updateGoalPickerHint(){
  const hint = document.getElementById('goalPickerHint');
  if(hint) hint.hidden = !!document.getElementById('goalPicker').value;
}
function updateTemplateHint(){
  const hint = document.getElementById('templateSelectHint');
  if(hint) hint.hidden = !!templateSelect.value;
}
document.getElementById('goalPicker').addEventListener('change', updateGoalPickerHint);

elementSelect.addEventListener('change', updateExample);
updateExample();

/* ============ الصور (مع ضغط تلقائي قبل الرفع لتوفير المساحة) ============ */
const grid = document.getElementById('photoGrid');
const selectedPhotoFiles = [];

/* أقصى حجم ملف مقبول قبل الضغط — مطابق فعليًا لحد حجم الملف المضبوط على
   حاوية "shawahid-photos" بلوحة Supabase (تحقّقنا منه مباشرة: 8MB)، لا رقم
   افتراضي عشوائي. كان مضبوطًا هنا على 15 سابقًا رغم أن الحاوية تحدّه فعليًا
   بـ8 — فارق يعني أن ملفًا بين 8 و15 ميجا يمر من فحص التطبيق، يُعرض
   "جارٍ الرفع"، ثم يُرفَض من الخادم في اللحظة الأخيرة برسالة أقل وضوحًا. */
const MAX_UPLOAD_MB = 8;
const MAX_IMAGE_DIM = 1600;    // أقصى بُعد للصورة بعد الضغط (بكسل)
const JPEG_QUALITY = 0.82;

/* يضغط الصورة داخل المتصفح: يصغّر الأبعاد ويحوّلها JPEG */
function compressImage(file){
  return new Promise((resolve) => {
    if(!file.type.startsWith('image/')) return resolve(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if(width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM){
          const scale = MAX_IMAGE_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if(!blob || blob.size >= file.size) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', JPEG_QUALITY);
      };
      img.onerror = () => resolve(file);
      img.src = ev.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

/* أيقونة معبّرة حسب نوع الملف */
function fileTypeIcon(type, name){
  const n = (name || '').toLowerCase();
  if(type === 'application/pdf' || n.endsWith('.pdf')) return '📕';
  if(/word|document/.test(type) || /\.(doc|docx)$/.test(n)) return '📘';
  if(/sheet|excel/.test(type) || /\.(xls|xlsx|csv)$/.test(n)) return '📗';
  if(/presentation|powerpoint/.test(type) || /\.(ppt|pptx)$/.test(n)) return '📙';
  return '📄';
}
function shortName(name, max = 22){
  if(!name) return 'ملف';
  if(name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > -1 ? name.slice(dot) : '';
  return name.slice(0, max - ext.length - 2) + '…' + ext;
}
function humanSize(bytes){
  if(bytes < 1024) return bytes + ' بايت';
  if(bytes < 1024*1024) return Math.round(bytes/1024) + ' ك.ب';
  return (bytes/(1024*1024)).toFixed(1) + ' م.ب';
}

function makeSlot(source){
  const label = document.createElement('label');
  label.className = 'photo-slot';

  /* مصادر المرفق الثلاثة:
     camera → الكاميرا | gallery → ألبوم الصور | file → أي مستند (PDF، Word، Excel...) */
  let attrs = 'accept="image/*"';
  let hint = '+ إضافة صورة';
  if(source === 'camera'){
    attrs += ' capture="environment"';
  } else if(source === 'file'){
    attrs = 'accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"';
    hint = '+ إضافة مرفق';
  }

  label.innerHTML = `<span class="ph-text">${hint}</span><button type="button" class="remove" title="إلغاء">×</button><input type="file" ${attrs}>`;
  const input = label.querySelector('input');

  /* زر حذف متاح من اللحظة الأولى — يعالج حالة إلغاء المستخدم لمربع اختيار الصور
     دون اختيار شيء، فلا تبقى خانة فارغة عالقة بلا طريقة لإزالتها */
  label.querySelector('.remove').addEventListener('click', (ev2) => {
    ev2.preventDefault();
    ev2.stopPropagation();
    const idx = selectedPhotoFiles.findIndex(p => p.slot === label);
    if(idx > -1) selectedPhotoFiles.splice(idx, 1);
    label.remove();
  });

  input.addEventListener('change', async () => {
    const original = input.files && input.files[0];
    if(!original) return;

    if(original.size > MAX_UPLOAD_MB * 1024 * 1024){
      showToast(`حجم الملف كبير جدًا (الحد ${MAX_UPLOAD_MB} ميجابايت).`, 'error');
      return;
    }

    const isImage = original.type.startsWith('image/');

    /* ── مستند غير صورة: يُرفع كما هو ويُعرض ببطاقة ── */
    if(!isImage){
      label.classList.add('filled', 'is-doc');
      label.innerHTML = `
        <div class="doc-card">
          <div class="doc-icon">${fileTypeIcon(original.type, original.name)}</div>
          <div class="doc-name">${escapeHtml(shortName(original.name))}</div>
          <div class="doc-size">${humanSize(original.size)}</div>
        </div>
        <button type="button" class="remove" title="حذف">×</button>`;
      label._file = original;
      selectedPhotoFiles.push({ slot: label, file: original });
      label.querySelector('.remove').addEventListener('click', (ev2) => {
        ev2.preventDefault();
        ev2.stopPropagation();
        const idx = selectedPhotoFiles.findIndex(p => p.slot === label);
        if(idx > -1) selectedPhotoFiles.splice(idx, 1);
        label.remove();
      });
      showToast('تم إرفاق الملف', 'ok');
      return;
    }

    /* ── صورة: تُضغط ثم تُعرض ── */
    label.querySelector('.ph-text').textContent = 'جارٍ المعالجة...';
    const file = await compressImage(original);

    const savedPct = original.size > file.size
      ? Math.round((1 - file.size / original.size) * 100) : 0;

    const reader = new FileReader();
    reader.onload = (ev) => {
      label.classList.add('filled');
      label.innerHTML = `<img src="${escapeHtml(ev.target.result)}"><button type="button" class="remove" title="حذف">×</button>`;
      label._file = file;
      selectedPhotoFiles.push({ slot: label, file });
      label.querySelector('.remove').addEventListener('click', (ev2) => {
        ev2.preventDefault();
        ev2.stopPropagation();
        const idx = selectedPhotoFiles.findIndex(p => p.slot === label);
        if(idx > -1) selectedPhotoFiles.splice(idx, 1);
        label.remove();
      });
      if(savedPct >= 15){
        showToast(`تم ضغط الصورة (توفير ${savedPct}% من الحجم)`, 'ok');
      }
    };
    reader.readAsDataURL(file);
  });
  return label;
}
/* نافذة اختيار مصدر الصورة: ألبوم / كاميرا */
function showPhotoSourcePicker(){
  const box = document.getElementById('photoSourceModal');
  box.style.display = 'flex';
}
function closePhotoSourcePicker(){
  document.getElementById('photoSourceModal').style.display = 'none';
}
function pickPhotoSource(source){
  closePhotoSourcePicker();
  const slot = makeSlot(source);
  grid.appendChild(slot);
  /* فتح مربع الاختيار مباشرة دون أن يضغط المستخدم مرة أخرى */
  setTimeout(() => {
    const input = slot.querySelector('input[type=file]');
    if(input) input.click();
  }, 60);
}

/* مراقبة أي تعديل داخل نموذج الشاهد لتفعيل تحذير المغادرة والحفظ التلقائي */
document.getElementById('formView').addEventListener('input', () => { formDirty = true; scheduleDraftSave(); });
document.getElementById('formView').addEventListener('change', () => { formDirty = true; scheduleDraftSave(); });

function isImageUrl(url){
  return /\.(jpe?g|png|gif|webp|heic|bmp)(\?|$)/i.test(url || '');
}

function makeExistingSlot(url){
  const label = document.createElement('label');
  label.className = 'photo-slot filled';
  label.dataset.existingUrl = url;

  if(isImageUrl(url)){
    label.innerHTML = `<img src="${escapeHtml(url)}"><button type="button" class="remove" title="حذف">×</button>`;
  } else {
    /* مستند محفوظ سابقًا: يُعرض كبطاقة قابلة للفتح */
    const name = decodeURIComponent((url.split('/').pop() || 'ملف').split('?')[0]);
    label.classList.add('is-doc');
    label.innerHTML = `
      <div class="doc-card">
        <div class="doc-icon">${fileTypeIcon('', name)}</div>
        <div class="doc-name">${escapeHtml(shortName(name))}</div>
        <a href="${url}" target="_blank" class="doc-open" onclick="event.stopPropagation();">فتح الملف</a>
      </div>
      <button type="button" class="remove" title="حذف">×</button>`;
  }

  label.querySelector('.remove').addEventListener('click', (ev2) => {
    ev2.preventDefault();
    ev2.stopPropagation();
    label.remove();
  });
  return label;
}

/* ============ حفظ الشاهد ============ */
function showSaveMsg(text, type){
  const el = document.getElementById('saveMsg');
  el.textContent = text;
  el.className = 'save-msg ' + type;
}

async function saveShahid(){
  if(!currentUser){ showSaveMsg('يجب تسجيل الدخول أولًا.', 'error'); return; }

  if(!navigator.onLine){
    showSaveMsg('لا يوجد اتصال بالإنترنت — بياناتك لم تُفقد، أعد المحاولة بعد عودة الاتصال.', 'error');
    showToast('لا يوجد اتصال بالإنترنت', 'error');
    return;
  }

  const opt = elementSelect.options[elementSelect.selectedIndex];
  if(!opt.value){ showSaveMsg('الرجاء اختيار عنصر الأداء أولًا.', 'error'); return; }

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  showSaveMsg('جارٍ الحفظ...', 'ok');

  try{
    /* الصور المحفوظة سابقًا والباقية بعد أي حذف */
    const existingUrls = Array.from(grid.querySelectorAll('.photo-slot[data-existing-url]'))
      .map(el => el.dataset.existingUrl);

    /* رفع الصور الجديدة فقط — بالتوازي بدل التتابع لتسريع الحفظ عند إرفاق
       أكثر من صورة (المسارات فريدة أصلاً عبر الوقت + رقم عشوائي فلا خطر تعارض) */
    const newUrls = await Promise.all(selectedPhotoFiles.map(async (item) => {
      const ext = item.file.name.split('.').pop() || 'jpg';
      const path = `${currentUser.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, item.file);
      if(upErr) throw upErr;
      const { data: pub } = sb.storage.from('shawahid-photos').getPublicUrl(path);
      return pub.publicUrl;
    }));
    const photoUrls = existingUrls.concat(newUrls);

    /* جمع الخطوات */
    const steps = Array.from(stepsList.querySelectorAll('textarea'))
      .map(t => t.value.trim())
      .filter(Boolean);

    const record = {
      user_id: currentUser.id,
      teacher_name: document.getElementById('mTeacher').value.trim(),
      teacher_email: currentUser.email,
      school: document.getElementById('mSchool').value.trim(),
      subject: document.getElementById('mSubject').value.trim(),
      class_name: document.getElementById('mClass').value.trim(),
      lesson_title: document.getElementById('mLesson').value.trim(),
      lesson_date: document.getElementById('mDate').value || null,
      element_key: opt.value,
      element_label: opt.textContent.trim(),
      description: descBox.value.trim(),
      goal: goalBox.value.trim(),
      steps: steps,
      photo_urls: photoUrls,
      quant_impact: quantBox.value.trim(),
      qual_impact: qualBox.value.trim(),
      reflection: reflectionBox.value.trim(),
      goal_id: document.getElementById('goalPicker').value || null,
      cycle_year: getCycleYear(document.getElementById('mDate').value || undefined)
    };

    /* لو هذا الشاهد يوثّق حصة من برنامج نشاط طلابي متعدد الحصص، نربطه بالبرنامج
       وبرقم الحصة — يُستخدم بعد الحفظ لتحديث تقدّم البرنامج (انظر أسفل) */
    if(programSessionContext){
      record.program_id = programSessionContext.programId;
      record.program_session_no = programSessionContext.sessionNo;
    }

    if(!editingId){
      const dateForStage = record.lesson_date ? new Date(record.lesson_date) : new Date();
      record.cycle_stage = getCycleStageKey(dateForStage);
    }

    if(editingId){
      const { error } = await sb.from('shawahid').update(record).eq('id', editingId);
      if(error) throw error;
      formDirty = false;
      clearDraft();
      showSaveMsg('تم تحديث الشاهد بنجاح ✓', 'ok');
      showToast('تم تحديث الشاهد بنجاح', 'ok');
      setTimeout(() => { showList(); }, 700);
    } else {
      const { data: inserted, error } = await sb.from('shawahid').insert(record).select().single();
      if(error) throw error;
      formDirty = false;
      clearDraft();
      const refText = inserted && inserted.ref_number ? ` — الرقم المرجعي: ${inserted.ref_number}` : '';
      showSaveMsg('تم حفظ الشاهد بنجاح ✓' + refText, 'ok');
      showToast('تم حفظ الشاهد بنجاح' + refText, 'ok');
      loadPlan();
      if(programSessionContext){
        const ctx = programSessionContext;
        programSessionContext = null;
        /* أضفه فورًا لقائمة myRecords المحمَّلة بالذاكرة — لو تركناها كما هي،
           showProgramDetail لا يُعيد تحميلها إلا لو كانت فارغة، فيفشل زر
           "عرض الشاهد" بحثه عن هذا الشاهد المُنشأ للتو (myRecords.find) رغم
           نجاح الحفظ فعليًا بقاعدة البيانات. */
        myRecords.unshift(inserted);
        await markProgramSessionDone(ctx.programId, ctx.sessionNo, inserted.id);
        setTimeout(() => { showProgramDetail(ctx.programId); }, 900);
      } else {
        setTimeout(() => { showList(); }, 900);
      }
    }
  } catch(err){
    showSaveMsg('حدث خطأ أثناء الحفظ: ' + err.message, 'error');
    showToast('حدث خطأ أثناء الحفظ', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

/* ============ حذف شاهد محفوظ ============ */
async function deleteRecord(id){
  const rec = myRecords.find(r => String(r.id) === String(id));
  if(!rec) return;

  const ok = await showConfirm('حذف هذا الشاهد؟ يمكنك التراجع لبضع ثوانٍ من الإشعار الذي سيظهر بعد الحذف.');
  if(!ok) return;

  /* الحذف الفعلي يتم فورًا هنا (كما كان قبل إضافة ميزة التراجع) — هذا مهم
     للموثوقية: لا نعتمد على بقاء الصفحة مفتوحة لتنفيذ حذف مؤجَّل، فلو أغلق
     المستخدم التبويب أثناء نافذة التراجع لا يبقى أي سجل "معلّق" في القاعدة.
     "التراجع" هنا يعني إعادة إدراج نفس السجل (بنفس المعرّف) إن طُلب خلال
     المهلة، وليس تأجيل الحذف نفسه. */
  try{
    const { error } = await sb.from('shawahid').delete().eq('id', id);
    if(error) throw error;
  } catch(err){
    showToast('تعذّر حذف الشاهد: ' + err.message, 'error');
    return;
  }

  /* لو هذا الشاهد كان يوثّق حصة من برنامج نشاط طلابي، لازم نُفرغ ربطها
     بالبرنامج (نعيدها لحالة "لم تُوثَّق بعد") — وإلا تبقى الحصة عالقة للأبد
     على أنها "موثَّقة" بشاهد لم يعد موجودًا، بلا أي طريقة لإعادة توثيقها
     من واجهة البرنامج (best-effort: فشل هذا لا يجب أن يمنع إتمام الحذف
     نفسه، فهو أصلاً منجَز أعلاه). */
  let clearedProgramSessionMeta = null;
  if(rec.program_id && rec.program_session_no != null){
    try{ clearedProgramSessionMeta = await clearProgramSessionLink(rec.program_id, rec.program_session_no); } catch(e){ /* غير حرج */ }
  }

  const originalIndex = myRecords.findIndex(r => String(r.id) === String(id));
  if(originalIndex > -1) myRecords.splice(originalIndex, 1);
  if(editingId === id){ startNewShahid(); }
  filterMyShawahid();

  let shouldCleanupPhotos = true;
  try{
    shouldCleanupPhotos = await showUndoToast('تم حذف الشاهد', 5);
  } catch(err){
    /* أي خلل غير متوقع بعرض نافذة التراجع لا يجب أن يمنع تنظيف الصور لاحقًا،
       ولا يعتبر بحد ذاته فشلًا بالحذف نفسه (الحذف من القاعدة تم أعلاه بنجاح) */
    shouldCleanupPhotos = true;
  }

  if(!shouldCleanupPhotos){
    /* تراجع: أعد إدراج نفس السجل بنفس المعرّف والبيانات (الصور لم تُحذف بعد) */
    try{
      const { error: restoreErr } = await sb.from('shawahid').insert(rec);
      if(restoreErr) throw restoreErr;
      myRecords.splice(originalIndex > -1 ? originalIndex : myRecords.length, 0, rec);
      filterMyShawahid();
      /* أعد ربط الحصة ببرنامجها كما كانت قبل الحذف تمامًا (بنفس تاريخ التوثيق
         الأصلي لا تاريخ اليوم) — عكس التفريغ أعلاه */
      if(rec.program_id && rec.program_session_no != null){
        const originalDoneDate = clearedProgramSessionMeta && clearedProgramSessionMeta.done_date;
        try{ await markProgramSessionDone(rec.program_id, rec.program_session_no, rec.id, originalDoneDate); } catch(e){ /* غير حرج */ }
      }
      showToast('تم التراجع عن الحذف', 'ok');
    } catch(err){
      showToast('تعذّر التراجع — قد تحتاج لإعادة إنشاء الشاهد يدويًا: ' + err.message, 'error');
    }
    return;
  }

  /* لم يتراجع المستخدم: نظّف صور الشاهد من مساحة التخزين لتوفير المساحة */
  if(rec.photo_urls && rec.photo_urls.length){
    const paths = rec.photo_urls.map(url => {
      const idx = url.indexOf('/shawahid-photos/');
      return idx > -1 ? url.slice(idx + '/shawahid-photos/'.length) : null;
    }).filter(Boolean);
    if(paths.length){
      try{ await sb.storage.from('shawahid-photos').remove(paths); } catch(e){ /* تنظيف غير حرج */ }
    }
  }
}

/* ============ التعديل على شاهد محفوظ ============ */
function editRecord(id){
  const rec = myRecords.find(r => String(r.id) === String(id));
  if(!rec) return;

  editingId = rec.id;
  /* لو كان فيه سياق "توثيق حصة برنامج" معلَّق من قبل (مثلًا المستخدم فتح
     "توثيق هذه الحصة" ثم غادر النموذج دون حفظ وفتح شاهدًا آخر للتعديل)،
     يجب إلغاؤه هنا — وإلا سيُنسب هذا الشاهد المختلف تمامًا لتلك الحصة عن
     طريق الخطأ عند الحفظ (انظر saveShahid). */
  programSessionContext = null;
  document.getElementById('saveBtn').textContent = 'تحديث الشاهد';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';

  document.getElementById('mSchool').value = rec.school || '';
  document.getElementById('mSubject').value = rec.subject || '';
  document.getElementById('mTeacher').value = rec.teacher_name || '';
  document.getElementById('mClass').value = rec.class_name || '';
  document.getElementById('mDate').value = rec.lesson_date || '';
  document.getElementById('mLesson').value = rec.lesson_title || '';

  elementSelect.value = rec.element_key || '';
  updateExample();
  document.getElementById('goalPicker').value = rec.goal_id || '';

  descBox.value = rec.description || '';
  goalBox.value = rec.goal || '';
  quantBox.value = rec.quant_impact || '';
  qualBox.value = rec.qual_impact || '';
  reflectionBox.value = rec.reflection || '';

  stepsList.innerHTML = '';
  const steps = (rec.steps && rec.steps.length) ? rec.steps : [''];
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${i+1}</span><textarea rows="1" maxlength="500" placeholder="اكتب الخطوة..."></textarea><button class="remove-step" title="حذف الخطوة" onclick="removeStep(this)">×</button>`;
    li.querySelector('textarea').value = s;
    stepsList.appendChild(li);
  });

  grid.innerHTML = '';
  selectedPhotoFiles.length = 0;
  (rec.photo_urls || []).forEach(url => grid.appendChild(makeExistingSlot(url)));

  showSaveMsg('', '');
  document.getElementById('saveMsg').className = 'save-msg';
  showForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============ نسخ شاهد كنقطة بداية لشاهد جديد ============ */
function duplicateRecord(id){
  const rec = myRecords.find(r => String(r.id) === String(id));
  if(!rec) return;

  /* شاهد جديد تمامًا — لا نرث المعرّف ولا الصور ولا التاريخ */
  editingId = null;
  programSessionContext = null; /* نفس سبب إلغائه في editRecord أعلاه */
  formDirty = true;
  document.getElementById('saveBtn').textContent = 'حفظ الشاهد';
  document.getElementById('cancelEditBtn').style.display = 'none';

  document.getElementById('mSchool').value = rec.school || '';
  document.getElementById('mSubject').value = rec.subject || '';
  document.getElementById('mTeacher').value = rec.teacher_name || '';
  document.getElementById('mClass').value = '';   // يُتوقع تغيير الفصل
  document.getElementById('mDate').value = '';    // تاريخ جديد
  document.getElementById('mLesson').value = rec.lesson_title || '';

  elementSelect.value = rec.element_key || '';
  updateExample();

  descBox.value = rec.description || '';
  goalBox.value = rec.goal || '';
  quantBox.value = rec.quant_impact || '';
  qualBox.value = rec.qual_impact || '';
  reflectionBox.value = rec.reflection || '';

  stepsList.innerHTML = '';
  const steps = (rec.steps && rec.steps.length) ? rec.steps : [''];
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${i+1}</span><textarea rows="1" maxlength="500" placeholder="اكتب الخطوة..."></textarea><button class="remove-step" title="حذف الخطوة" onclick="removeStep(this)">×</button>`;
    li.querySelector('textarea').value = s;
    stepsList.appendChild(li);
  });

  /* الصور لا تُنسخ — كل شاهد له شواهده المصورة الخاصة */
  grid.innerHTML = '';
  selectedPhotoFiles.length = 0;

  document.getElementById('saveMsg').className = 'save-msg';
  document.getElementById('saveMsg').textContent = '';
  showForm();
  saveDraftNow();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('نُسخ الشاهد — عدّل الفصل والتاريخ وأضف صوره ثم احفظ.', 'ok');
}

/* ============ بدء شاهد جديد (إلغاء وضع التعديل) ============ */
/* ============ إلغاء النموذج والخروج بدون حفظ ============ */
async function cancelForm(){
  const draft = collectFormDraft();
  const hasContent = !isDraftEmpty(draft);

  if(hasContent){
    const ok = await showConfirm('سيتم إلغاء ما كتبته دون حفظه. هل أنت متأكد؟');
    if(!ok) return;
  }

  editingId = null;
  formDirty = false;
  clearDraft();

  document.getElementById('saveBtn').textContent = 'حفظ الشاهد';
  document.getElementById('cancelEditBtn').style.display = 'none';

  elementSelect.value = '';
  updateExample();

  descBox.value = '';
  goalBox.value = '';
  quantBox.value = '';
  qualBox.value = '';
  reflectionBox.value = '';
  document.getElementById('mClass').value = '';
  document.getElementById('mDate').value = '';
  document.getElementById('mLesson').value = '';

  stepsList.innerHTML = '<li><span class="num">1</span><textarea rows="1" maxlength="500" placeholder="اكتب الخطوة الأولى..."></textarea><button class="remove-step" title="حذف الخطوة" onclick="removeStep(this)">×</button></li>';

  grid.innerHTML = '';
  selectedPhotoFiles.length = 0;

  document.getElementById('saveMsg').className = 'save-msg';
  document.getElementById('saveMsg').textContent = '';
  document.getElementById('draftIndicator').textContent = '';

  showList();
}

function startNewShahid(){
  editingId = null;
  formDirty = false;
  programSessionContext = null;
  clearDraft();
  document.getElementById('saveBtn').textContent = 'حفظ الشاهد';
  document.getElementById('cancelEditBtn').style.display = 'none';

  const meta = (currentUser && currentUser.user_metadata) || {};
  document.getElementById('mTeacher').value = meta.full_name || '';
  document.getElementById('mSchool').value = getProfileSchool();
  document.getElementById('mSubject').value = getProfileSubject();
  document.getElementById('mClass').value = getProfileClass();
  document.getElementById('mDate').value = '';
  document.getElementById('mLesson').value = '';

  elementSelect.value = '';
  updateExample();

  descBox.value = '';
  goalBox.value = '';
  quantBox.value = '';
  qualBox.value = '';
  reflectionBox.value = '';

  stepsList.innerHTML = '<li><span class="num">1</span><textarea rows="1" maxlength="500" placeholder="اكتب الخطوة الأولى..."></textarea><button class="remove-step" title="حذف الخطوة" onclick="removeStep(this)">×</button></li>';

  grid.innerHTML = '';
  selectedPhotoFiles.length = 0;

  document.getElementById('saveMsg').className = 'save-msg';
  document.getElementById('saveMsg').textContent = '';

  showForm();
}

/* فتح "شاهد جديد" مع تعبئة عنصر الأداء مسبقًا — يُستخدم من زر "+" داخل مجموعة عنصر معيّن في شواهدي */
function addShahidForElement(elementKey){
  startNewShahid();
  elementSelect.value = elementKey;
  updateExample();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* الانتقال من مجموعة شواهد عنصر معيّن إلى بطاقة نفس العنصر في خطتي (عكس goToShahidForElement) */
async function goToPlanForElement(elementKey){
  await showPlan();
  const elements = getElementsOrder();
  const idx = elements.findIndex(e => e.key === elementKey);
  if(idx > -1){
    const row = document.getElementById('planRow-' + idx);
    if(row){
      row.classList.remove('plan-collapsed');
      const chev = document.getElementById('planRowChev-' + idx);
      if(chev) chev.textContent = '▴';
      setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }
}

/* ============ طباعة شاهد محفوظ بعينه ============ */
function printCurrentForm(evt){
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
  const opt = elementSelect.options[elementSelect.selectedIndex];
  const steps = Array.from(stepsList.querySelectorAll('textarea'))
    .map(t => t.value.trim())
    .filter(Boolean);
  const photoSrcs = Array.from(grid.querySelectorAll('.photo-slot img')).map(img => img.src);

  const draft = {
    teacher_name: document.getElementById('mTeacher').value.trim(),
    school: document.getElementById('mSchool').value.trim(),
    subject: document.getElementById('mSubject').value.trim(),
    class_name: document.getElementById('mClass').value.trim(),
    lesson_title: document.getElementById('mLesson').value.trim(),
    lesson_date: document.getElementById('mDate').value || '',
    element_key: opt.value,
    element_label: opt.value ? opt.textContent.trim() : '',
    description: descBox.value.trim(),
    goal: goalBox.value.trim(),
    steps: steps,
    quant_impact: quantBox.value.trim(),
    qual_impact: qualBox.value.trim(),
    reflection: reflectionBox.value.trim()
  };

  document.getElementById('printArea').innerHTML = buildPdfHtml(draft, photoSrcs);
  printNow();
  } finally { endExportBusy(btn); }
}

function printRecord(id, evt){
  const rec = myRecords.find(r => String(r.id) === String(id));
  if(!rec) return;
  const btn = evt ? evt.target.closest('button') : null;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    document.getElementById('printArea').innerHTML = buildPdfHtml(rec, rec.photo_urls || []);
    printNow();
  } finally { endExportBusy(btn); }
}
window.addEventListener('afterprint', () => {
  document.body.classList.remove('printing-record');
});

/* ============ تحويل رابط صورة إلى Data URL (لتفادي مشاكل CORS داخل PDF) ============ */
async function toDataUrl(url){
  try{
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch(e){
    return null;
  }
}

/* ============ قالب PDF مضغوط مصمم خصيصًا ليدخل صفحة A4 واحدة ============ */
function metaCellPdf(label, value){
  return `<div style="flex:1 1 33%;padding:8px 12px;border-left:1px solid #D8D2C4;box-sizing:border-box;">
    <div style="font-size:8.5px;color:#6B6659;margin-bottom:3px;">${escapeHtml(label)}</div>
    <div style="font-size:11px;color:#232323;">${escapeHtml(value || '—')}</div>
  </div>`;
}
function sectionPdf(title, bodyHtml){
  return `<div style="padding:9px 28px;border-bottom:1px solid #D8D2C4;">
    <div style="font-size:11.5px;font-weight:700;color:#1B3245;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
      <span style="width:4px;height:12px;background:#A9852E;display:inline-block;"></span>${escapeHtml(title)}
    </div>
    ${bodyHtml}
  </div>`;
}
function buildPdfHtml(rec, photoDataUrls){
  const dateDisplay = rec.lesson_date || (rec.created_at ? new Date(rec.created_at).toLocaleDateString('ar-SA') : '');
  const stepsHtml = (rec.steps && rec.steps.length)
    ? rec.steps.map((s, i) => `
        <div style="display:flex;gap:6px;margin-bottom:4px;align-items:flex-start;">
          <span style="flex:0 0 15px;height:15px;border-radius:50%;background:#1B3245;color:#fff;font-size:8.5px;display:flex;align-items:center;justify-content:center;">${i+1}</span>
          <span style="flex:1;font-size:10.5px;line-height:1.6;">${escapeHtml(s)}</span>
        </div>`).join('')
    : '<div style="font-size:10.5px;color:#6B6659;">—</div>';
  /* الصور تُعرض كمصغّرات، والمستندات تُذكر بأسمائها */
  const imgItems = photoDataUrls.filter(u => typeof u === 'string' && (u.startsWith('data:image') || isImageUrl(u)));
  const docItems = (rec.photo_urls || []).filter(u => !isImageUrl(u));
  const photosHtml = (imgItems.length || docItems.length)
    ? `${imgItems.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">${imgItems.map(u => `<img src="${escapeHtml(u)}" style="width:92px;height:68px;object-fit:cover;border:1px solid #D8D2C4;">`).join('')}</div>` : ''}
       ${docItems.length ? `<div style="margin-top:${imgItems.length ? '6px' : '0'};font-size:10px;color:#3F3B31;">
          <b>مستندات مرفقة:</b> ${docItems.map(u => escapeHtml(decodeURIComponent((u.split('/').pop()||'ملف').split('?')[0]))).join(' • ')}
       </div>` : ''}`
    : '<div style="font-size:10.5px;color:#6B6659;">لا توجد مرفقات</div>';

  return `
  <div dir="rtl" style="width:794px;background:#fff;font-family:'Cairo',sans-serif;color:#232323;box-sizing:border-box;">
    <div style="background:#1B3245;padding:18px 28px;border-bottom:4px solid #A9852E;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-family:'Amiri',serif;font-size:21px;color:#fff;font-weight:700;">شاهد الأداء الوظيفي</div>
      ${rec.ref_number ? `<div style="font-size:10.5px;color:#C9D2DA;">رقم مرجعي: ${escapeHtml(rec.ref_number)}</div>` : ''}
    </div>
    <div style="display:flex;flex-wrap:wrap;border-bottom:1px solid #D8D2C4;">
      ${metaCellPdf('المدرسة', rec.school)}
      ${metaCellPdf('المادة', rec.subject)}
      ${metaCellPdf('المعلم', rec.teacher_name)}
      ${metaCellPdf('الصف / الفصل', rec.class_name)}
      ${metaCellPdf('التاريخ', dateDisplay)}
      ${metaCellPdf('عنوان الدرس / الوحدة', rec.lesson_title)}
    </div>
    ${sectionPdf('عنصر الأداء المرتبط', `<div style="font-size:11px;">${escapeHtml(rec.element_label || '—')}</div>`)}
    ${sectionPdf('الوصف', `<div style="font-size:10.5px;line-height:1.7;background:#F1EEE6;border:1px solid #D8D2C4;padding:8px 10px;">${escapeHtml(rec.description || '—')}</div>`)}
    ${sectionPdf('الهدف من هذا الإجراء', `<div style="font-size:10.5px;">${escapeHtml(rec.goal || '—')}</div>`)}
    ${sectionPdf('خطوات التنفيذ الفعلية', stepsHtml)}
    ${sectionPdf('الشاهد المصوّر', photosHtml)}
    ${sectionPdf('الأثر / النتيجة الملاحظة', `
      <div style="display:flex;gap:16px;">
        <div style="flex:1;"><div style="font-size:8.5px;color:#6B6659;margin-bottom:3px;">مؤشر كمي</div><div style="font-size:10.5px;">${escapeHtml(rec.quant_impact || '—')}</div></div>
        <div style="flex:1;"><div style="font-size:8.5px;color:#6B6659;margin-bottom:3px;">ملاحظة نوعية</div><div style="font-size:10.5px;">${escapeHtml(rec.qual_impact || '—')}</div></div>
      </div>`)}
    ${sectionPdf('تأمل المعلم', `<div style="font-size:10.5px;line-height:1.7;background:#F1EEE6;border:1px solid #D8D2C4;padding:8px 10px;">${escapeHtml(rec.reflection || '—')}</div>`)}
    <div style="padding:16px 28px 18px;max-width:220px;">
      <div style="border-top:1px solid #232323;padding-top:6px;font-size:10px;color:#6B6659;">توقيع المعلم</div>
    </div>
  </div>`;
}

/* ============ توليد PDF للشاهد (لاستخدامه في المشاركة) ============ */
async function buildRecordPdfBlob(rec){
  await ensurePdfLibs();
  const area = document.getElementById('pdfRenderArea');

  let photoDataUrls = [];
  if(rec.photo_urls && rec.photo_urls.length){
    const results = await Promise.all(rec.photo_urls.filter(isImageUrl).map(toDataUrl));
    photoDataUrls = results.filter(Boolean);
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  /* addPdfPage معرَّفة في app-08-admin.js (تُحمَّل قبل هذا الملف) — تضيف
     هامش صفحة حقيقي بدل لصق المحتوى بحافة الورقة تمامًا */
  await addPdfPage(pdf, area, buildPdfHtml(rec, photoDataUrls), { firstPage: true });
  return pdf.output('blob');
}

/* ============ تصدير كل الشواهد المحفوظة كملف PDF واحد ============ */
async function exportAllShawahid(){
  if(!myRecords.length){
    showToast('لا توجد شواهد محفوظة للتصدير بعد.', 'error');
    return;
  }

  const btn = document.getElementById('exportAllBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  activeExportCount++;

  try{
    await ensurePdfLibs();
    const elements = getElementsOrder();
    const orderIndex = {};
    elements.forEach((e, i) => orderIndex[e.key] = i);

    const sorted = [...myRecords].sort((a, b) => {
      const oa = orderIndex[a.element_key] ?? 999;
      const ob = orderIndex[b.element_key] ?? 999;
      if(oa !== ob) return oa - ob;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const area = document.getElementById('pdfRenderArea');
    const pageState = { firstPage: true };

    for(let i = 0; i < sorted.length; i++){
      const rec = sorted[i];
      btn.textContent = `جارٍ التجهيز (${i+1}/${sorted.length})...`;

      let photoDataUrls = [];
      if(rec.photo_urls && rec.photo_urls.length){
        const results = await Promise.all(rec.photo_urls.filter(isImageUrl).map(toDataUrl));
        photoDataUrls = results.filter(Boolean);
      }

      /* addPdfPage معرَّفة في app-08-admin.js — هامش صفحة حقيقي بدل الالتصاق بحافتها */
      await addPdfPage(pdf, area, buildPdfHtml(rec, photoDataUrls), pageState);
    }

    const teacherName = (currentUser.user_metadata && currentUser.user_metadata.full_name) || 'Teacher';
    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save(`All-Shawahid-${dateStr}.pdf`);
    showToast(`تم تصدير ${sorted.length} شاهدًا بنجاح`, 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + err.message, 'error');
  } finally {
    activeExportCount = Math.max(0, activeExportCount - 1);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* ============ إرسال شاهد كملف PDF عبر واتساب ============ */
async function shareWhatsApp(id, evt){
  const rec = myRecords.find(r => String(r.id) === String(id));
  if(!rec) return;

  const btn = evt ? evt.target.closest('button') : null;
  const originalText = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ التجهيز...'; }
  activeExportCount++;

  try{
    const blob = await buildRecordPdfBlob(rec);
    const elementSlugs = {
      'أداء الواجبات الوظيفية': 'job-duties',
      'التفاعل مع المجتمع المهني': 'professional-community',
      'التفاعل مع أولياء الأمور': 'parents',
      'التنويع في استراتيجيات التدريس': 'teaching-strategies',
      'تحسين نتائج المتعلمين': 'student-outcomes',
      'إعداد وتنفيذ خطة التعلم': 'lesson-plan',
      'توظيف تقنيات ووسائل التعلم المناسبة': 'tech-tools',
      'تهيئة البيئة التعليمية': 'learning-environment',
      'الإدارة الصفية': 'classroom-management',
      'تحليل نتائج المتعلمين وتشخيص مستوياتهم': 'results-analysis',
      'تنوع أساليب التقويم': 'assessment'
    };
    const slug = elementSlugs[rec.element_key] || 'shahid';
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Shahid-${slug}-${dateStr}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    if(navigator.canShare && navigator.canShare({ files: [file] })){
      await navigator.share({
        files: [file],
        title: 'شاهد الأداء الوظيفي',
        text: `شاهد أداء: ${rec.element_label || ''}`
      });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      showToast('تم تنزيل ملف PDF — افتح واتساب وأرفقه يدويًا من الملفات المُنزّلة.', 'ok');
      window.open('https://wa.me/', '_blank');
    }
  } catch(err){
    if(err.name !== 'AbortError'){
      showToast('تعذّر تجهيز الملف: ' + err.message, 'error');
    }
  } finally {
    activeExportCount = Math.max(0, activeExportCount - 1);
    if(btn){ btn.disabled = false; btn.textContent = originalText; }
  }
}

/* ============ حذف شاهد محفوظ ============ */
/* ============================================
   تجهيز الشواهد دفعة واحدة
   ============================================
   المعلم يختار 20-30 شاهدًا (حتى 4 للعنصر) من النماذج الجاهزة مرة واحدة،
   فتتحوّل لبطاقات مسودة بجدول مستقل (shahid_drafts) — ثم يضيف الصور فقط.

   المسودة ليست شاهدًا: لا تُحتسب بالتقدم ولا التغطية ولا التصدير ولا لوحة
   المسؤول (هي بجدول منفصل، فلا استعلام بالتطبيق يحتاج استثناءها). وتصير شاهدًا
   حقيقيًا بجدول shawahid لحظة إرفاق صورتها فقط — الصورة هي الدليل على أن
   الإجراء حدث فعلًا. نفس معرّف المسودة يصير معرّف الشاهد، فلو تكرر الحفظ
   (نقرة مزدوجة/تبويبان) يرفضه المفتاح الأساسي بدل أن يُنشئ شاهدًا مكررًا. */

const BATCH_MAX_PER_ELEMENT = 4;   // أقصى عدد شواهد قيد التجهيز للعنصر الواحد
const BATCH_PHOTOS_PER_CARD = 4;   // أقصى صور تُرفع دفعة واحدة لبطاقة
const BATCH_TARGET_CHOICES = [12, 20, 24, 30];

let batchDrafts = [];              // مسودات المستخدم الحالية (بانتظار صورة)
let batchDone = [];                // أُنجزت بهذه الجلسة: { id, title, label, thumb, count }
let batchPick = {};                // { element_key: [template_name, ...] } اختيارات الشاشة الأولى
let batchOpenEl = new Set();       // العناصر المفتوحة بشاشة الاختيار
let batchExisting = {};            // { element_key: عدد شواهده الموثّقة بالدورة الحالية }
let batchUsedTpl = {};             // { element_key: [أسماء نماذج وُثّقت فعلًا بالدورة الحالية] }
let batchAutoNames = {};           // اختيارات جاءت من «الاقتراح» (مفتاحها key||name) — تُستبدل عند إعادته، واليدوية تبقى
let batchAutoDone = false;         // هل سُحب اقتراح بهذه الجلسة (يبدّل نص الزر لـ«غيّر الاقتراح»)
let batchElems = [];               // لقطة عناصر الأداء المعروضة (الفهرس ← العنصر) لأزرار الشاشة
let batchTarget = 24;              // العدد المطلوب للاقتراح التلقائي
let batchDateMode = 'spread';      // single | spread
let batchBusyIds = new Set();      // بطاقات يجري رفع صورتها الآن
let batchStep = 'pick';            // pick | setup | board
let batchViewSeq = 0;              // يلغي نتيجة تحميل قديم لو فُتحت الشاشة ثانية

/* تصفير حالة الدفعة — يُستدعى عند دخول حساب (onLoggedIn) كي لا تبقى بطاقات
   مستخدم سابق على نفس الصفحة بعد تسجيل خروج/دخول */
function batchResetState(){
  batchDrafts = [];
  batchDone = [];
  batchPick = {};
  batchOpenEl = new Set();
  batchExisting = {};
  batchUsedTpl = {};
  batchAutoNames = {};
  batchAutoDone = false;
  batchElems = [];
  batchBusyIds = new Set();
  batchStep = 'pick';
  batchViewSeq++;
}

/* ============ دوال صرفة (قابلة للاختبار) ============ */

/* أيام الدراسة بين تاريخين (شاملة)، دون الجمعة والسبت */
function batchSchoolDays(startIso, endIso){
  const days = [];
  if(!startIso || !endIso || startIso > endIso) return days;
  let d = startIso;
  for(let i = 0; i < 400 && d <= endIso; i++){
    const wd = weekdayOfIso(d);
    if(wd !== 5 && wd !== 6) days.push(d);
    d = addDaysIso(d, 1);
  }
  return days;
}

/* توزيع count تاريخًا بالتساوي على أيام الدراسة بين التاريخين (مرتّبة تصاعديًا).
   تواريخ 30 شاهدًا المتطابقة تبدو مصطنعة — فنوزّعها على الفصل. */
function batchSpreadDates(count, startIso, endIso){
  if(count <= 0) return [];
  const days = batchSchoolDays(startIso, endIso);
  if(!days.length) return Array(count).fill(endIso || startIso || null);
  if(count === 1) return [days[days.length - 1]];
  const out = [];
  for(let i = 0; i < count; i++) out.push(days[Math.round(i * (days.length - 1) / (count - 1))]);
  return out;
}

/* دمج مجموعات بالتناوب (واحد من كل مجموعة ثم الدورة التالية) كي لا تتجمّع
   شواهد عنصر واحد في أسبوع واحد عند توزيع التواريخ */
function batchInterleave(groups){
  const out = [];
  const max = Math.max(0, ...groups.map(g => g.length));
  for(let r = 0; r < max; r++){
    groups.forEach(g => { if(r < g.length) out.push(g[r]); });
  }
  return out;
}

/* خلط عشوائي (Fisher-Yates) لنسخة من المصفوفة — rng قابل للحقن للاختبار */
function batchShuffle(arr, rng){
  const a = arr.slice();
  const r = rng || Math.random;
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* اقتراح توزيع عشوائي: يخلط نماذج كل عنصر وترتيب العناصر نفسه (فلا تأخذ العناصر
   الأولى النصيب الزائد دائمًا)، ثم يمرّ بالتناوب حتى يبلغ العدد المطلوب، دون
   تجاوز سعة العنصر (4 ناقص قيد التجهيز) ولا تكرار نموذج قيد التجهيز.
   elements: [{ key, names: [نماذج لم تُستخدم], used: [نماذج وُثّقت سابقًا — بديل أخير] }]
   capacity: { key: السعة المتبقية }
   opts.keep: { key: [اختيارات يدوية تبقى وتُحسب ضمن العدد والسعة] }، opts.rng
   يرجع { key: [names] } شاملًا المحتفَظ بها أولًا. */
function batchAutoDistribute(elements, target, capacity, opts){
  const rng = (opts && opts.rng) || Math.random;
  const keep = (opts && opts.keep) || {};
  const picked = {};
  const pools = {};
  elements.forEach(e => {
    const kept = (keep[e.key] || []).slice();
    picked[e.key] = kept;
    /* النماذج التي لم تُستخدم أولًا (مخلوطة)، ثم المستخدمة سابقًا كبديل أخير
       كي لا يبقى عنصر فارغًا لو استُنفدت نماذجه */
    pools[e.key] = batchShuffle(e.names.filter(n => kept.indexOf(n) < 0), rng)
      .concat(batchShuffle((e.used || []).filter(n => kept.indexOf(n) < 0 && e.names.indexOf(n) < 0), rng));
  });
  const order = batchShuffle(elements, rng);
  let total = elements.reduce((n, e) => n + picked[e.key].length, 0);
  const next = {};
  let progress = true;
  while(total < target && progress){
    progress = false;
    for(const e of order){
      if(total >= target) break;
      const cap = capacity[e.key] == null ? BATCH_MAX_PER_ELEMENT : capacity[e.key];
      const i = next[e.key] || 0;
      if(picked[e.key].length < cap && i < pools[e.key].length){
        picked[e.key].push(pools[e.key][i]);
        next[e.key] = i + 1;
        total++;
        progress = true;
      }
    }
  }
  return picked;
}

/* صفوف المسودات من القائمة المختارة (مرتّبة أصلًا) وتواريخها المقابلة */
function buildBatchDraftRows(items, dates, ctx){
  return items.map((it, i) => ({
    user_id: ctx.userId,
    element_key: it.element_key,
    template_name: it.template_name,
    title: it.template_name,
    planned_date: dates[i] || null,
    teacher_name: ctx.teacher || '',
    school: ctx.school || '',
    subject: ctx.subject || '',
    class_name: ctx.className || '',
    cycle_year: getCycleYear(dates[i] || undefined)
  }));
}

/* سجل الشاهد الحقيقي من مسودة + نموذجها + روابط الصور. المعرّف = معرّف المسودة */
function buildBatchShahidRecord(draft, tpl, photoUrls, elementLabel, email){
  const t = tpl || {};
  const date = draft.planned_date || null;
  return {
    id: draft.id,
    user_id: draft.user_id,
    teacher_name: draft.teacher_name || '',
    teacher_email: email || '',
    school: draft.school || '',
    subject: draft.subject || '',
    class_name: draft.class_name || '',
    lesson_title: draft.title || '',
    lesson_date: date,
    element_key: draft.element_key,
    element_label: elementLabel || draft.element_key,
    description: t.description || '',
    goal: t.goal || '',
    steps: Array.isArray(t.steps) ? t.steps : [],
    photo_urls: photoUrls,
    quant_impact: t.quant || '',
    qual_impact: t.qual || '',
    reflection: t.reflection || '',
    goal_id: null,
    cycle_year: getCycleYear(date || undefined),
    cycle_stage: getCycleStageKey(date ? new Date(date) : new Date())
  };
}

/* ============ تحميل ============ */
async function loadBatchDrafts(){
  if(!currentUser) return false;
  const uid = currentUser.id;
  /* فلترة صريحة بالمالك — نفس سبب فلترة loadMyShawahid */
  const { data, error } = await fetchAllRows((from, to) => sb
    .from('shahid_drafts')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to));
  if(error || !currentUser || currentUser.id !== uid) return false;
  batchDrafts = data || [];
  return true;
}

async function loadBatchExisting(){
  if(!currentUser) return;
  const uid = currentUser.id;
  const { data, error } = await fetchAllRows((from, to) => sb
    .from('shawahid')
    .select('id, element_key, cycle_year, lesson_date, created_at, lesson_title, description')
    .eq('user_id', uid)
    .order('id', { ascending: true })
    .range(from, to));
  if(error || !currentUser || currentUser.id !== uid) return;
  const cy = getCycleYear();
  const counts = {}, used = {};
  (data || []).forEach(r => {
    const y = r.cycle_year || getCycleYear(r.lesson_date || r.created_at || undefined);
    if(y !== cy) return;
    counts[r.element_key] = (counts[r.element_key] || 0) + 1;
    /* نموذج وُثّق فعلًا: عنوان الشاهد = اسم النموذج (من الدفعة)، أو وصفه = وصف
       النموذج (طُبّق من نموذج شاهد جديد) */
    (SHAHID_TEMPLATES[r.element_key] || []).forEach(t => {
      if(r.lesson_title === t.name || (t.description && String(r.description || '').trim() === t.description.trim())){
        (used[r.element_key] = used[r.element_key] || []).indexOf(t.name) < 0 && used[r.element_key].push(t.name);
      }
    });
  });
  batchExisting = counts;
  batchUsedTpl = used;
}

/* زر الدخول بأعلى شواهدي: يظهر فقط لو جدول المسودات جاهز بقاعدة البيانات
   (قبل تشغيل تحديث SQL يفشل الاستعلام فنُخفي الزر بدل أن نُظهر خطأ للمعلم) */
async function refreshBatchEntry(){
  const box = document.getElementById('batchEntry');
  if(!box || !currentUser) return;
  const uid = currentUser.id;
  /* بلا head:true — استعلام HEAD لا يُرجع خطأً عند غياب الجدول (404 بلا جسم)،
     فكان الزر يظهر قبل تشغيل SQL. هنا يفشل صراحةً، وغياب العدّ نفسه فشل أيضًا. */
  const { count, error } = await sb.from('shahid_drafts')
    .select('id', { count: 'exact' }).eq('user_id', uid).limit(1);
  if(!currentUser || currentUser.id !== uid) return;
  if(error || typeof count !== 'number'){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  const sub = document.getElementById('batchEntrySub');
  if(sub) sub.textContent = count
    ? `عندك ${count} بانتظار الصورة — أكمل من حيث توقفت`
    : 'اختر النماذج مرة واحدة، ثم أضف الصور فقط';
}

/* ============ الشاشة ============ */
function isBatchViewOpen(){
  const v = document.getElementById('batchView');
  return !!v && v.style.display === 'block';
}

async function showBatch(){
  hideAllMainViews();
  setActiveBottomTab('shahid');
  document.getElementById('batchView').style.display = 'block';
  const body = document.getElementById('batchBody');
  body.innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  const seq = ++batchViewSeq;
  const ok = await loadBatchDrafts();
  if(seq !== batchViewSeq || !isBatchViewOpen()) return;
  if(!ok){
    body.innerHTML = '<div class="empty-state">تعذّر تحميل المسودات. تأكد من الاتصال ثم حاول مجددًا.<br><button type="button" class="btn btn-outline" style="margin-top:14px;" onclick="showList()">→ شواهدي</button></div>';
    return;
  }
  batchPick = {};
  batchAutoNames = {};
  if(batchDrafts.length) renderBatchBoard();
  else await showBatchPick();
}

async function showBatchPick(){
  batchStep = 'pick';
  const seq = ++batchViewSeq;
  const body = document.getElementById('batchBody');
  if(!DB_ELEMENTS || !DB_ELEMENTS.length){
    body.innerHTML = '<div class="empty-state">لم تُحمَّل عناصر الأداء بعد. أعد المحاولة بعد لحظات.</div>';
    return;
  }
  await loadBatchExisting();
  if(seq !== batchViewSeq || !isBatchViewOpen() || batchStep !== 'pick') return;
  batchElems = DB_ELEMENTS.slice();
  renderBatchPick();
}

function batchPendingCount(key){
  return batchDrafts.filter(d => d.element_key === key).length;
}
function batchPickedTotal(){
  return Object.keys(batchPick).reduce((n, k) => n + batchPick[k].length, 0);
}
function batchCapacity(key){
  return Math.max(0, BATCH_MAX_PER_ELEMENT - batchPendingCount(key));
}

function batchHeader(stepNo, title, sub){
  const dots = [1, 2, 3].map(n => `<span class="bt-dot${n === stepNo ? ' on' : (n < stepNo ? ' past' : '')}"></span>`).join('');
  return `<div class="bt-head">
    <button type="button" class="bt-back" onclick="showList()">→ شواهدي</button>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(sub)}</p>
    <div class="bt-dots" aria-hidden="true">${dots}</div>
  </div>`;
}

/* ---------- 1) الاختيار ---------- */
function renderBatchPick(){
  const body = document.getElementById('batchBody');
  const chips = BATCH_TARGET_CHOICES.map(n =>
    `<button type="button" class="bt-tchip${n === batchTarget ? ' on' : ''}" onclick="batchSetTarget(${n})">${n}</button>`).join('');
  body.innerHTML = `
    ${batchHeader(1, 'اختر شواهدك', 'اختر ما نفّذته فعلًا — حتى ' + BATCH_MAX_PER_ELEMENT + ' شواهد لكل عنصر، وتُعبّأ كلها تلقائيًا')}
    <div class="bt-auto">
      <span class="bt-auto-l">كم شاهدًا تريد؟</span>
      <div class="bt-tchips">${chips}</div>
      <button type="button" class="btn btn-outline bt-auto-btn" onclick="batchAutoPick()">${batchAutoDone ? '🎲 غيّر الاقتراح' : '✨ اقترح لي توزيعًا'}</button>
    </div>
    <div id="btElList">${batchElems.map((el, i) => batchPickCardHtml(i)).join('')}</div>
    <div class="sh-fab-wrap bt-bar"><div id="btBar"></div></div>`;
  renderBatchBar();
}

function batchPickCardHtml(i){
  const el = batchElems[i];
  const names = (SHAHID_TEMPLATES[el.key] || []).map(t => t.name);
  const picked = batchPick[el.key] || [];
  const pend = batchPendingCount(el.key);
  const cap = batchCapacity(el.key);
  const used = picked.length + pend;
  const existing = batchExisting[el.key] || 0;
  const open = batchOpenEl.has(el.key);
  const cls = used >= BATCH_MAX_PER_ELEMENT ? 'full' : (used > 0 ? 'on' : '');
  const pendingNote = pend ? `<span class="bt-note">${pend} قيد التجهيز</span>` : '';
  const existingNote = existing ? `<span class="bt-note ok">${existing} موثّق</span>` : '<span class="bt-note warn">لا شواهد بعد</span>';
  let chipsHtml = '';
  if(open){
    chipsHtml = names.length
      ? `<div class="bt-chips">${names.map((n, t) => {
          const sel = picked.indexOf(n) > -1;
          const pendingSame = batchDrafts.some(d => d.element_key === el.key && d.template_name === n);
          const blocked = pendingSame || (!sel && picked.length >= cap);
          return `<button type="button" class="bt-chip${sel ? ' sel' : ''}" ${blocked && !sel ? 'disabled' : ''} onclick="batchToggleTpl(${i}, ${t})">${sel ? '✓ ' : ''}${escapeHtml(n)}${pendingSame ? ' (قيد التجهيز)' : ''}</button>`;
        }).join('')}</div>`
      : '<div class="bt-chips"><span class="bt-note">لا توجد نماذج جاهزة لهذا العنصر — أضف شواهده من «شاهد جديد».</span></div>';
  }
  const summary = (!open && picked.length)
    ? `<div class="bt-sel-sum">${picked.map(n => `<span>${escapeHtml(n)}</span>`).join('')}</div>` : '';
  return `<div class="bt-el" id="btEl-${i}">
    <button type="button" class="bt-el-h" onclick="batchToggleOpen(${i})" aria-expanded="${open}">
      <span class="bt-el-t">${escapeHtml(el.label)}<small>${existingNote}${pendingNote}</small></span>
      <span class="bt-count ${cls}">${used}/${BATCH_MAX_PER_ELEMENT}</span>
      <span class="bt-chev">${open ? '▴' : '▾'}</span>
    </button>
    ${summary}${chipsHtml}
  </div>`;
}

function batchRedrawEl(i){
  const node = document.getElementById('btEl-' + i);
  if(node) node.outerHTML = batchPickCardHtml(i);
  renderBatchBar();
}

function renderBatchBar(){
  const bar = document.getElementById('btBar');
  if(!bar) return;
  const total = batchPickedTotal();
  const covered = Object.keys(batchPick).filter(k => batchPick[k].length).length;
  const hint = total === 0 ? 'لم تختر شيئًا بعد' : `اخترت ${total} شاهدًا من ${covered} عنصر`;
  bar.innerHTML = `<div class="bt-bar-in">
    <span class="bt-bar-t">${hint}</span>
    <button type="button" class="btn btn-primary bt-next" ${total ? '' : 'disabled'} onclick="showBatchSetup()">التالي ←</button>
  </div>`;
}

function batchToggleOpen(i){
  const key = batchElems[i].key;
  if(batchOpenEl.has(key)) batchOpenEl.delete(key); else batchOpenEl.add(key);
  batchRedrawEl(i);
}

function batchToggleTpl(i, t){
  const key = batchElems[i].key;
  const name = ((SHAHID_TEMPLATES[key] || [])[t] || {}).name;
  if(!name) return;
  const list = batchPick[key] || (batchPick[key] = []);
  delete batchAutoNames[key + '||' + name]; /* لمسة يدوية = يصير اختيارًا يدويًا يبقى عند إعادة الاقتراح */
  const idx = list.indexOf(name);
  if(idx > -1) list.splice(idx, 1);
  else if(list.length < batchCapacity(key)) list.push(name);
  else showToast(`الحد الأقصى ${BATCH_MAX_PER_ELEMENT} شواهد للعنصر`, 'error');
  if(!list.length) delete batchPick[key];
  batchRedrawEl(i);
}

function batchSetTarget(n){
  batchTarget = n;
  document.querySelectorAll('.bt-tchip').forEach(b => b.classList.toggle('on', Number(b.textContent) === n));
}

function batchAutoPick(){
  const elements = batchElems.map(el => {
    const all = (SHAHID_TEMPLATES[el.key] || []).map(t => t.name);
    const usedNow = batchUsedTpl[el.key] || [];
    const notPending = all.filter(n => !batchDrafts.some(d => d.element_key === el.key && d.template_name === n));
    return {
      key: el.key,
      names: notPending.filter(n => usedNow.indexOf(n) < 0),
      used: notPending.filter(n => usedNow.indexOf(n) > -1)
    };
  }).filter(e => e.names.length || e.used.length);
  const capacity = {};
  elements.forEach(e => { capacity[e.key] = batchCapacity(e.key); });
  /* ما اختاره المعلم بنفسه يبقى، وما جاء من اقتراح سابق يُستبدل */
  const keep = {};
  Object.keys(batchPick).forEach(k => {
    const manual = batchPick[k].filter(n => !batchAutoNames[k + '||' + n]);
    if(manual.length) keep[k] = manual;
  });
  const keptCount = Object.keys(keep).reduce((n, k) => n + keep[k].length, 0);
  const picked = batchAutoDistribute(elements, batchTarget, capacity, { keep });
  batchPick = {};
  batchAutoNames = {};
  Object.keys(picked).forEach(k => {
    if(!picked[k].length) return;
    batchPick[k] = picked[k];
    picked[k].forEach(n => { if(!(keep[k] || []).includes(n)) batchAutoNames[k + '||' + n] = true; });
  });
  const wasRoll = batchAutoDone;
  batchAutoDone = true;
  renderBatchPick();
  showToast(keptCount ? 'اقتراح جديد — احتفظت بما اخترته يدويًا' : (wasRoll ? 'اقتراح جديد' : 'اقتراح جاهز — عدّله كما تشاء'), 'ok');
}

/* ---------- 2) البيانات المشتركة ---------- */
function showBatchSetup(){
  if(!batchPickedTotal()) return;
  batchStep = 'setup';
  const meta = (currentUser && currentUser.user_metadata) || {};
  const today = localIsoDate();
  const start = addDaysIso(today, -56);
  const total = batchPickedTotal();
  document.getElementById('batchBody').innerHTML = `
    ${batchHeader(2, 'بياناتك تُعبّأ مرة واحدة', `تُطبَّق على الشواهد الـ${total} كلها`)}
    <div class="bt-form">
      <div class="bt-grid2">
        <label>المعلم<input type="text" id="btTeacher" maxlength="150" class="goal-input" value="${escapeHtml(meta.full_name || '')}"></label>
        <label>المدرسة<input type="text" id="btSchool" maxlength="150" class="goal-input" value="${escapeHtml(getProfileSchool())}"></label>
        <label>المادة<input type="text" id="btSubject" maxlength="150" class="goal-input" value="${escapeHtml(getProfileSubject())}"></label>
        <label>الصف / الفصل<input type="text" id="btClass" maxlength="100" class="goal-input" value="${escapeHtml(getProfileClass())}"></label>
      </div>
      <div class="bt-sub">تاريخ التنفيذ</div>
      <div class="bt-modes">
        <button type="button" id="btModeSpread" class="bt-mode${batchDateMode === 'spread' ? ' on' : ''}" onclick="batchSetDateMode('spread')"><b>موزّع على الفترة</b><small>تواريخ متفاوتة بأيام الدراسة — أقرب للواقع</small></button>
        <button type="button" id="btModeSingle" class="bt-mode${batchDateMode === 'single' ? ' on' : ''}" onclick="batchSetDateMode('single')"><b>تاريخ واحد</b><small>كل الشواهد بنفس اليوم</small></button>
      </div>
      <div id="btDateSpread" class="bt-grid2" ${batchDateMode === 'spread' ? '' : 'style="display:none;"'}>
        <label>من<input type="date" id="btFrom" class="goal-input" value="${start}" max="${today}"></label>
        <label>إلى<input type="date" id="btTo" class="goal-input" value="${today}" max="${today}"></label>
      </div>
      <div id="btDateSingle" ${batchDateMode === 'single' ? '' : 'style="display:none;"'}>
        <label>التاريخ<input type="date" id="btOne" class="goal-input" value="${today}" max="${today}"></label>
      </div>
      <p class="bt-hint">التواريخ لا تتجاوز اليوم، ويمكنك تعديل تاريخ أي شاهد لاحقًا من بطاقته.</p>
    </div>
    <div class="sh-fab-wrap bt-bar"><div class="bt-bar-in">
      <button type="button" class="btn btn-outline" onclick="renderBatchPick()">→ رجوع</button>
      <button type="button" class="btn btn-primary bt-next" id="btCreateBtn" onclick="batchCreateDrafts(this)">إنشاء البطاقات ✓</button>
    </div></div>`;
  window.scrollTo({ top: 0 });
}

function batchSetDateMode(mode){
  batchDateMode = mode === 'single' ? 'single' : 'spread';
  document.getElementById('btModeSpread').classList.toggle('on', batchDateMode === 'spread');
  document.getElementById('btModeSingle').classList.toggle('on', batchDateMode === 'single');
  document.getElementById('btDateSpread').style.display = batchDateMode === 'spread' ? '' : 'none';
  document.getElementById('btDateSingle').style.display = batchDateMode === 'single' ? '' : 'none';
}

async function batchCreateDrafts(btn){
  if(!currentUser || btn.disabled) return;
  if(!navigator.onLine){ showToast('لا يوجد اتصال بالإنترنت', 'error'); return; }
  const today = localIsoDate();
  let dates;
  /* السعة تُعاد قراءتها من القاعدة أولًا: جهاز/تبويب آخر قد يكون أضاف مسودات */
  beginExportBusy(btn, 'جارٍ الإنشاء...');
  try{
    if(!(await loadBatchDrafts())) throw new Error('تعذّر التحقق من المسودات الحالية');
    const groups = batchElems.filter(el => (batchPick[el.key] || []).length).map(el =>
      batchPick[el.key].slice(0, batchCapacity(el.key)).map(n => ({ element_key: el.key, template_name: n }))
        .filter(it => !batchDrafts.some(d => d.element_key === it.element_key && d.template_name === it.template_name)));
    const items = batchInterleave(groups);
    if(!items.length){ showToast('لا شيء جديد لإنشائه', 'error'); return; }

    if(batchDateMode === 'single'){
      const one = document.getElementById('btOne').value;
      if(!one || one > today){ showToast('اختر تاريخًا لا يتجاوز اليوم', 'error'); return; }
      dates = Array(items.length).fill(one);
    } else {
      const from = document.getElementById('btFrom').value, to = document.getElementById('btTo').value;
      if(!from || !to || from > to || to > today){ showToast('تحقق من الفترة: «من» قبل «إلى» ولا تتجاوز اليوم', 'error'); return; }
      dates = batchSpreadDates(items.length, from, to);
    }
    const rows = buildBatchDraftRows(items, dates, {
      userId: currentUser.id,
      teacher: document.getElementById('btTeacher').value.trim(),
      school: document.getElementById('btSchool').value.trim(),
      subject: document.getElementById('btSubject').value.trim(),
      className: document.getElementById('btClass').value.trim()
    });
    const { error } = await sb.from('shahid_drafts')
      .upsert(rows, { onConflict: 'user_id,element_key,template_name', ignoreDuplicates: true });
    if(error) throw error;
    batchPick = {};
    batchAutoNames = {};
    if(!(await loadBatchDrafts())) throw new Error('تعذّر تحميل البطاقات');
    if(!isBatchViewOpen()) return;
    showToast(`جُهّزت ${rows.length} بطاقة — أضف الصور الآن`, 'ok');
    renderBatchBoard();
  } catch(err){
    showToast('تعذّر الإنشاء: ' + (err.message || err), 'error');
  } finally {
    endExportBusy(btn);
  }
}

/* ---------- 3) لوحة الصور ---------- */
function batchElementLabel(key){
  const el = (DB_ELEMENTS || []).find(e => e.key === key);
  return el ? el.label : key;
}
function batchElementOrder(key){
  const i = (DB_ELEMENTS || []).findIndex(e => e.key === key);
  return i < 0 ? 999 : i;
}

function renderBatchBoard(){
  batchStep = 'board';
  const body = document.getElementById('batchBody');
  const done = batchDone.length, pending = batchDrafts.length, total = done + pending;
  const pct = total ? Math.round(done * 100 / total) : 0;
  const sorted = batchDrafts.slice().sort((a, b) =>
    batchElementOrder(a.element_key) - batchElementOrder(b.element_key) ||
    String(a.planned_date || '').localeCompare(String(b.planned_date || '')));
  const cards = sorted.map(batchCardHtml).join('');
  const doneCards = batchDone.length ? `<div class="bt-sub">أُنجزت (${batchDone.length})</div><div class="bt-cards">${batchDone.map(batchDoneHtml).join('')}</div>` : '';
  body.innerHTML = `
    ${batchHeader(3, pending ? 'أضف الصور' : 'اكتملت كل البطاقات', pending ? 'صورة واحدة تكفي لتحويل البطاقة إلى شاهد مكتمل' : 'كل بطاقاتك تحوّلت إلى شواهد')}
    <div class="bt-prog">
      <div class="bt-prog-top"><b>${done} من ${total} مكتمل</b><span>${pct}%</span></div>
      <div class="bt-prog-bar"><i style="width:${pct}%"></i></div>
    </div>
    <p class="bt-warn">نصوص الشواهد مأخوذة من نماذج جاهزة. راجع كل شاهد بعد رفع صورته وعدّل نصه ليعكس عملك الفعلي.</p>
    ${pending ? `<div class="bt-cards">${cards}</div>` : '<div class="empty-state">🎉 أنجزت كل شواهد هذه الدفعة.</div>'}
    ${doneCards}
    <div class="bt-foot">
      <button type="button" class="btn btn-outline" onclick="showBatchPick()">+ أضف شواهد أخرى</button>
      ${pending ? '<button type="button" class="btn btn-danger" onclick="batchDeleteAll(this)">حذف المتبقي</button>' : ''}
    </div>`;
}

function batchCardHtml(d){
  const busy = batchBusyIds.has(d.id);
  const today = localIsoDate();
  const id = escapeHtml(d.id);
  return `<div class="bt-card${busy ? ' busy' : ''}" id="btCard-${id}">
    <div class="bt-card-top">
      <span class="bt-tag">${escapeHtml(batchElementLabel(d.element_key))}</span>
      <button type="button" class="bt-x" aria-label="حذف البطاقة" ${busy ? 'disabled' : ''} onclick="batchDeleteDraft('${id}')">×</button>
    </div>
    <div class="bt-title">${escapeHtml(d.title)}</div>
    <label class="bt-date-l">التاريخ <input type="date" class="bt-date" value="${escapeHtml(d.planned_date || '')}" max="${today}" ${busy ? 'disabled' : ''} onchange="batchSetDate('${id}', this.value)"></label>
    <div class="bt-drop${busy ? ' busy' : ''}">
      ${busy
        ? '<div class="bt-spin"></div><span>جارٍ الرفع والحفظ...</span>'
        : `<span class="bt-drop-t">أضف صورة الشاهد</span>
           <div class="bt-pbtns">
             <label class="bt-pbtn"><input type="file" accept="image/*" capture="environment" hidden onchange="batchOnPhotos('${id}', this)">📷 كاميرا</label>
             <label class="bt-pbtn"><input type="file" accept="image/*" multiple hidden onchange="batchOnPhotos('${id}', this)">🖼️ الألبوم</label>
           </div>`}
    </div>
  </div>`;
}

function batchDoneHtml(r){
  const thumb = r.thumb ? `<img src="${escapeHtml(r.thumb)}" alt="">` : '<span class="bt-ok-i">✓</span>';
  return `<div class="bt-card bt-doneCard">
    <div class="bt-thumb">${thumb}</div>
    <div class="bt-done-t"><span class="bt-tag">${escapeHtml(r.label)}</span><b>${escapeHtml(r.title)}</b><small>✓ ${r.count} ${r.count === 1 ? 'صورة' : 'صور'}</small></div>
    <button type="button" class="btn btn-outline bt-edit" onclick="batchEditDone('${escapeHtml(r.id)}')">مراجعة وتعديل</button>
  </div>`;
}

function batchRedrawCard(id){
  const d = batchDrafts.find(x => x.id === id);
  const node = document.getElementById('btCard-' + id);
  if(d && node) node.outerHTML = batchCardHtml(d);
}

function batchEditDone(id){
  if(!myRecords.some(r => String(r.id) === String(id))) return;
  editRecord(id);
}

async function batchSetDate(id, value){
  const d = batchDrafts.find(x => x.id === id);
  if(!d || !currentUser) return;
  if(!value || value > localIsoDate()){
    showToast('اختر تاريخًا لا يتجاوز اليوم', 'error');
    batchRedrawCard(id);
    return;
  }
  d.planned_date = value;
  d.cycle_year = getCycleYear(value);
  const { error } = await sb.from('shahid_drafts')
    .update({ planned_date: value, cycle_year: d.cycle_year })
    .eq('id', id).eq('user_id', currentUser.id);
  if(error) showToast('تعذّر حفظ التاريخ', 'error');
}

async function batchDeleteDraft(id){
  const d = batchDrafts.find(x => x.id === id);
  if(!d || batchBusyIds.has(id) || !currentUser) return;
  const ok = await showConfirm(`حذف بطاقة «${d.title}»؟ لم تُحوَّل لشاهد بعد، ويمكنك اختيارها مجددًا متى شئت.`);
  if(!ok) return;
  /* قد يكون رفع صورتها بدأ أثناء السؤال — لا نحذف بطاقة تُحوَّل الآن */
  if(batchBusyIds.has(id) || !batchDrafts.some(x => x.id === id)) return;
  const { error } = await sb.from('shahid_drafts').delete().eq('id', id).eq('user_id', currentUser.id);
  if(error){ showToast('تعذّر الحذف', 'error'); return; }
  batchDrafts = batchDrafts.filter(x => x.id !== id);
  if(isBatchViewOpen() && batchStep === 'board') renderBatchBoard();
}

async function batchDeleteAll(btn){
  if(!currentUser || btn.disabled) return;
  if(batchBusyIds.size){ showToast('انتظر انتهاء الرفع الجاري', 'error'); return; }
  const ok = await showConfirm(`حذف كل البطاقات المتبقية (${batchDrafts.length})؟ لم تُحوَّل لشواهد بعد. الشواهد المكتملة لا تتأثر.`);
  if(!ok || batchBusyIds.size) return;
  beginExportBusy(btn);
  try{
    const { error } = await sb.from('shahid_drafts').delete().eq('user_id', currentUser.id);
    if(error) throw error;
    batchDrafts = [];
    if(isBatchViewOpen()) renderBatchBoard();
  } catch(err){
    showToast('تعذّر الحذف', 'error');
  } finally {
    endExportBusy(btn);
  }
}

/* ============ الصور ← شاهد مكتمل ============ */
async function batchOnPhotos(id, input){
  const picked = Array.from(input.files || []).slice(0, BATCH_PHOTOS_PER_CARD);
  input.value = '';
  if(!picked.length || batchBusyIds.has(id)) return;
  const files = [];
  for(const f of picked){
    if(!f.type.startsWith('image/')){ showToast('الصور فقط هنا — لإرفاق مستند استخدم «مراجعة وتعديل» بعد الحفظ', 'error'); return; }
    if(f.size > MAX_UPLOAD_MB * 1024 * 1024){ showToast(`حجم الصورة كبير جدًا (الحد ${MAX_UPLOAD_MB} ميجابايت).`, 'error'); return; }
    files.push(f);
  }
  if(!navigator.onLine){ showToast('لا يوجد اتصال بالإنترنت', 'error'); return; }
  if(!batchDrafts.some(d => d.id === id)) return;
  /* التعطيل قبل أي await: نقرة ثانية على نفس البطاقة تُتجاهل أعلاه */
  batchBusyIds.add(id);
  batchRedrawCard(id);
  const compressed = await Promise.all(files.map(compressImage));
  await batchPromote(id, compressed);
}

async function batchPromote(id, files){
  const uid = currentUser && currentUser.id;
  const draft = batchDrafts.find(d => d.id === id);
  if(!uid || !draft){ batchBusyIds.delete(id); return; }
  const uploaded = [];
  const cleanup = () => { if(uploaded.length) sb.storage.from('shawahid-photos').remove(uploaded).catch(() => {}); };
  try{
    const urls = await Promise.all(files.map(async (file) => {
      const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const ext = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : 'jpg';
      const path = `${uid}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, file);
      if(upErr) throw upErr;
      uploaded.push(path);
      return sb.storage.from('shawahid-photos').getPublicUrl(path).data.publicUrl;
    }));
    /* آخر نسخة من المسودة (التاريخ قد يُعدَّل أثناء الرفع) */
    const latest = batchDrafts.find(d => d.id === id) || draft;
    const tpl = (SHAHID_TEMPLATES[latest.element_key] || []).find(t => t.name === latest.template_name) || null;
    const label = (() => {
      const el = (DB_ELEMENTS || []).find(e => e.key === latest.element_key);
      return el ? `${el.label} (${el.weight}%)` : latest.element_key;
    })();
    const record = buildBatchShahidRecord(latest, tpl, urls, label, currentUser.email);
    const { data: inserted, error } = await sb.from('shawahid').insert(record).select().single();
    if(error){
      if(error.code === '23505'){
        /* حُوّلت هذه المسودة سابقًا (تبويب/جهاز آخر) — لا نكرر الشاهد */
        cleanup();
        await sb.from('shahid_drafts').delete().eq('id', id).eq('user_id', uid);
        batchDrafts = batchDrafts.filter(d => d.id !== id);
        showToast('هذه البطاقة تحوّلت إلى شاهد من قبل', 'ok');
        return;
      }
      throw error;
    }
    /* فشل حذف المسودة هنا غير حرج: ستعود عند التحميل التالي، وأي محاولة
       تحويل لها تصطدم بالمفتاح الأساسي أعلاه فتُنظَّف بلا تكرار. */
    await sb.from('shahid_drafts').delete().eq('id', id).eq('user_id', uid);
    batchDrafts = batchDrafts.filter(d => d.id !== id);
    if(currentUser && currentUser.id === uid){
      if(!myRecords.some(r => String(r.id) === String(inserted.id))) myRecords.unshift(inserted);
      batchDone.unshift({ id: inserted.id, title: latest.title, label: batchElementLabel(latest.element_key), thumb: urls[0], count: urls.length });
      if(typeof loadPlan === 'function') loadPlan();
    }
    showToast('تم حفظ الشاهد ✓' + (inserted.ref_number ? ` — ${inserted.ref_number}` : ''), 'ok');
  } catch(err){
    cleanup();
    showToast('تعذّر الحفظ: ' + (err.message || err), 'error');
  } finally {
    batchBusyIds.delete(id);
    if(isBatchViewOpen() && batchStep === 'board' && currentUser && currentUser.id === uid) renderBatchBoard();
  }
}

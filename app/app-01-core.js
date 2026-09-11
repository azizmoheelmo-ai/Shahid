/* ============ إعداد Supabase ============ */
const SUPABASE_URL = "https://urpsznuywezkqxhnwkyo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_YsdvYhGJq9UUCiFaB4JPvQ_iZj5JSsF";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ============ تحميل كسول للمكتبات الثقيلة (تُحمّل فقط وقت الحاجة الفعلية) ============ */
const _loadedScripts = {};
function loadScriptOnce(src){
  if(_loadedScripts[src]) return _loadedScripts[src];
  _loadedScripts[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete _loadedScripts[src]; reject(new Error('تعذّر تحميل مكتبة مطلوبة')); };
    document.head.appendChild(s);
  });
  return _loadedScripts[src];
}
async function ensureZipLib(){
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
}
async function ensureXlsxLib(){
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
}
async function ensurePdfLibs(){
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
}

/* ============ التنبيهات المنبثقة (Toast) ============ */
/* أداة عامة لتأخير تنفيذ دالة حتى يتوقف المستخدم عن الكتابة لفترة قصيرة —
   تقلل عمليات إعادة العرض/الاستعلام غير الضرورية أثناء الكتابة السريعة
   بحقول البحث. */
function debounce(fn, delay){
  let timer = null;
  return function(...args){
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/* يجلب كل صفوف استعلام عبر صفحات متتالية (range) بدل الاعتماد على استعلام
   واحد بحد أقصى — Supabase/PostgREST يحدّ عدد الصفوف بالاستعلام الواحد
   افتراضيًا (1000 صف)، فأي جدول يكبر مع الوقت (كل شواهد كل المعلمين مثلاً)
   قد يفقد بيانات بصمت دون هذه الدالة. `queryFactory(from, to)` يجب أن يبني
   ويُرجع استعلامًا جديدًا في كل مرة (لا يعاد استخدام نفس الكائن). */
async function fetchAllRows(queryFactory, pageSize = 1000){
  let all = [];
  let from = 0;
  while(true){
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if(error) return { data: null, error };
    all = all.concat(data || []);
    if(!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

/* نسخ مؤخّرة (debounced) من دوال البحث الفوري — تُستدعى من oninput بحقول
   البحث بدل الدالة الأصلية مباشرة، لتقليل إعادة العرض/الاستعلام أثناء
   الكتابة السريعة. الأسماء الأصلية تبقى كما هي (تُستخدم أيضًا بأماكن أخرى
   مثل onfocus حيث نريد استجابة فورية بلا تأخير). */
const debouncedRenderAcStudentResults = debounce(() => renderAcStudentResults(), 250);
const debouncedRenderAcCases = debounce(() => renderAcCases(), 250);
const debouncedRenderCrmIncidentStudentResults = debounce(() => renderCrmIncidentStudentResults(), 250);
const debouncedRenderCrmRecentIncidents = debounce(() => renderCrmRecentIncidents(), 250);
const debouncedRenderCrmStudentsList = debounce(() => renderCrmStudentsList(), 250);
const debouncedFilterMyShawahid = debounce(() => filterMyShawahid(), 250);

function showToast(msg, type){
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

/* توست بزر "تراجع" — تُستخدم قبل تنفيذ إجراء حساس (كالحذف) بدل تنفيذه فورًا:
   الاستدعاء يُعيد Promise<boolean> يتحلّل بعد `delaySeconds` — true إذا لم
   يتراجع المستخدم (نفّذ الإجراء الفعلي)، أو false فور الضغط على "تراجع"
   (ألغِ الإجراء). لا تنفّذ أي عملية غير قابلة للتراجع بنفسك — فقط انتظر
   النتيجة قبل تنفيذها. */
function showUndoToast(msg, delaySeconds){
  return new Promise((resolve) => {
    const container = document.getElementById('toastContainer');
    if(!container){
      /* حالة دفاعية: لو تعذّر إيجاد حاوية التنبيهات لأي سبب، لا نُعلّق
         الاستدعاء الأصلي إلى الأبد — نعتبر الأمر كأن المهلة انتهت بلا تراجع */
      console.error('showUndoToast: #toastContainer not found');
      resolve(true);
      return;
    }
    const el = document.createElement('div');
    el.className = 'toast toast-undo';
    el.innerHTML = `<span>${escapeHtml(msg)}</span><button type="button" class="toast-undo-btn">تراجع</button>`;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    let settled = false;
    const finish = (undone) => {
      if(settled) return;
      settled = true;
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
      resolve(!undone);
    };

    const timer = setTimeout(() => finish(false), delaySeconds * 1000);
    const btn = el.querySelector('.toast-undo-btn');
    if(btn){
      btn.addEventListener('click', () => {
        clearTimeout(timer);
        finish(true);
      });
    }
  });
}

/* ============ نافذة تأكيد مخصصة (بديل confirm الافتراضي) ============ */
function showConfirm(message){
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmModal');
    document.getElementById('confirmMsg').textContent = message;
    overlay.style.display = 'flex';

    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    function cleanup(result){
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk(){ cleanup(true); }
    function onCancel(){ cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

let currentUser = null;
let editingId = null;
let formDirty = false;  // هل يوجد تعديلات غير محفوظة في نموذج الشاهد؟

/* تحذير المعلم قبل مغادرة الصفحة بتعديلات غير محفوظة */
window.addEventListener('beforeunload', (e) => {
  if(formDirty && document.getElementById('formView').style.display !== 'none'){
    e.preventDefault();
    e.returnValue = '';
  }
});

/* مراقبة الاتصال بالإنترنت */
window.addEventListener('offline', () => {
  showToast('انقطع الاتصال بالإنترنت — عملك محفوظ محليًا، أعد المحاولة عند عودة الاتصال.', 'error');
});
window.addEventListener('online', () => {
  showToast('عاد الاتصال بالإنترنت ✓', 'ok');
});

/* تسجيل Service Worker: يخزّن شكل التطبيق الثابت (الصفحة والأيقونات) على
   جهاز المستخدم لفتح أسرع ولتجنّب صفحة فارغة/خطأ عند انقطاع الإنترنت —
   لا يخزّن أي بيانات من Supabase ولا يتدخل بأي طلب شبكة غير GET لنفس
   أصل الصفحة (راجع sw.js). Service Worker يعمل فقط على HTTPS حقيقي (أو
   localhost)، لذا يُتجاهل بصمت تمامًا لو فُتح الملف مباشرة (file://) —
   هذا متوقّع وليس خطأ. */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* فشل التسجيل لا يجب أن يوقف التطبيق — يستمر العمل بشكل طبيعي مع الإنترنت فقط */
    });
  });
}

/* ============================================
   (1) الحفظ التلقائي للمسودة محليًا
   يحمي عمل المعلم من: انقطاع النت، إغلاق الصفحة بالخطأ، نفاد بطارية الجوال
   ============================================ */
const DRAFT_KEY = 'shahid_draft_v1';
let draftTimer = null;

function collectFormDraft(){
  const stepsList = document.getElementById('stepsList');
  const elementSelect = document.getElementById('elementSelect');
  if(!stepsList || !elementSelect) return null;

  return {
    savedAt: Date.now(),
    editingId: editingId,
    element_key: elementSelect.value,
    teacher: document.getElementById('mTeacher').value,
    school: document.getElementById('mSchool').value,
    subject: document.getElementById('mSubject').value,
    class_name: document.getElementById('mClass').value,
    lesson_date: document.getElementById('mDate').value,
    lesson_title: document.getElementById('mLesson').value,
    description: document.getElementById('descBox').value,
    goal: document.getElementById('goalBox').value,
    quant: document.getElementById('quantBox').value,
    qual: document.getElementById('qualBox').value,
    reflection: document.getElementById('reflectionBox').value,
    steps: Array.from(stepsList.querySelectorAll('textarea')).map(t => t.value),
    template_idx: (document.getElementById('templateSelect') || {}).value || ''
  };
}

function isDraftEmpty(d){
  if(!d) return true;
  const textFields = [d.description, d.goal, d.quant, d.qual, d.reflection, d.lesson_title];
  const hasText = textFields.some(v => v && v.trim());
  const hasSteps = (d.steps || []).some(s => s && s.trim());
  return !hasText && !hasSteps && !d.element_key;
}

function saveDraftNow(){
  try{
    const draft = collectFormDraft();
    if(isDraftEmpty(draft)){ localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    const ind = document.getElementById('draftIndicator');
    if(ind){
      ind.textContent = 'حُفظت مسودة محليًا ✓';
      ind.style.opacity = '1';
      setTimeout(() => { ind.style.opacity = '0.45'; }, 1600);
    }
  } catch(e){ /* قد تكون الذاكرة ممتلئة — نتجاهل بهدوء */ }
}

function scheduleDraftSave(){
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 900);
}

function clearDraft(){
  try{ localStorage.removeItem(DRAFT_KEY); } catch(e){}
  const ind = document.getElementById('draftIndicator');
  if(ind) ind.textContent = '';
}

function getSavedDraft(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if(!raw) return null;
    const d = JSON.parse(raw);
    return isDraftEmpty(d) ? null : d;
  } catch(e){ return null; }
}

function applyDraft(d){
  document.getElementById('mTeacher').value = d.teacher || '';
  document.getElementById('mSchool').value = d.school || '';
  document.getElementById('mSubject').value = d.subject || '';
  document.getElementById('mClass').value = d.class_name || '';
  document.getElementById('mDate').value = d.lesson_date || '';
  document.getElementById('mLesson').value = d.lesson_title || '';

  const elementSelect = document.getElementById('elementSelect');
  if(d.element_key){
    elementSelect.value = d.element_key;
    updateExample();
    /* نعيد ضبط القائمة على نفس النموذج الذي كان مختارًا، بصريًا فقط —
       بدون استدعاء applyTemplate() حتى لا يُستبدل المحتوى المستعاد بالفعل */
    const tplSelect = document.getElementById('templateSelect');
    if(tplSelect && d.template_idx){
      tplSelect.value = d.template_idx;
      applyTemplate._lastValue = d.template_idx;
    }
  }

  document.getElementById('descBox').value = d.description || '';
  document.getElementById('goalBox').value = d.goal || '';
  document.getElementById('quantBox').value = d.quant || '';
  document.getElementById('qualBox').value = d.qual || '';
  document.getElementById('reflectionBox').value = d.reflection || '';

  const stepsList = document.getElementById('stepsList');
  const steps = (d.steps && d.steps.length) ? d.steps : [''];
  stepsList.innerHTML = '';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${i+1}</span><textarea rows="1" maxlength="500" placeholder="اكتب الخطوة..."></textarea><button class="remove-step" title="حذف الخطوة" onclick="removeStep(this)">×</button>`;
    li.querySelector('textarea').value = s;
    stepsList.appendChild(li);
  });

  editingId = d.editingId || null;
  if(editingId){
    document.getElementById('saveBtn').textContent = 'تحديث الشاهد';
    document.getElementById('cancelEditBtn').style.display = 'inline-block';
  }
  formDirty = true;
}

/* عرض عرض استعادة المسودة عند فتح التطبيق */
async function offerDraftRestore(){
  const d = getSavedDraft();
  if(!d) return;

  const mins = Math.round((Date.now() - d.savedAt) / 60000);
  const when = mins < 1 ? 'قبل أقل من دقيقة'
    : mins < 60 ? `قبل ${mins} دقيقة`
    : `قبل ${Math.round(mins/60)} ساعة`;

  const ok = await showConfirm(`لديك شاهد لم يُحفظ (${when}). هل تريد استعادته ومتابعة العمل عليه؟`);
  if(ok){
    showForm();
    applyDraft(d);
    showToast('تمت استعادة المسودة', 'ok');
  } else {
    clearDraft();
  }
}

let myRecords = [];

/* ============ بيانات وصفية لكل عنصر أداء (fallback + المحتوى الغني) ============ */
const ELEMENT_META = {
  "أداء الواجبات الوظيفية": {
    "example": "توثيق التزامك بتنفيذ المهام والواجبات الوظيفية (الخطط، التصحيح، المواعيد) وفق الأنظمة المعتمدة.",
    "heading": "وصف الإجراء / الالتزام الوظيفي",
    "placeholder": "مثال: التزمت بإعداد خطة الدرس وتنفيذها في وقتها المحدد، وطبّقت السياسات والإجراءات المدرسية المعتمدة دون تأخير.",
    "goal": "مثال: ضمان تنفيذ المهام الوظيفية المسندة إليّ بدقة وفي وقتها المحدد، امتثالًا للأنظمة المعتمدة.",
    "quant": "مثال: نسبة إنجاز المهام في وقتها 100% خلال الفصل الدراسي.",
    "qual": "مثال: عدم تسجيل أي ملاحظة تأخير أو تقصير من إدارة المدرسة خلال الفترة.",
    "reflection": "ما مدى التزامي بالمواعيد والإجراءات؟ وما الذي يمكن تحسينه في تنظيم وقتي مستقبلًا؟"
  },
  "التفاعل مع المجتمع المهني": {
    "example": "توثيق مشاركتك لتجربة أو ممارسة مهنية مع زملائك (ورشة، اجتماع مجتمع تعلم مهني، تبادل خبرة).",
    "heading": "وصف المشاركة المهنية",
    "placeholder": "مثال: عرضت تجربتي في تطبيق استراتيجية ابحث وتعرف على زملاء المادة ضمن اجتماع مجتمع التعلم المهني، وتبادلنا الملاحظات لتطويرها.",
    "goal": "مثال: تعزيز تبادل الخبرات مع الزملاء ونشر ممارسة تدريسية فعالة داخل المدرسة.",
    "quant": "مثال: حضر اللقاء 6 من زملاء المادة.",
    "qual": "مثال: أبدى الزملاء اهتمامًا بالتجربة وناقشوا إمكانية تطبيقها في موادهم.",
    "reflection": "هل أضافت هذه المشاركة قيمة حقيقية للزملاء؟ وكيف يمكن تطوير أسلوب تبادل الخبرات لاحقًا؟"
  },
  "التفاعل مع أولياء الأمور": {
    "example": "توثيق تواصلك مع أولياء الأمور حول أداء أبنائهم أو نشاط تعليمي معين.",
    "heading": "وصف التواصل مع أولياء الأمور",
    "placeholder": "مثال: أطلعت أولياء الأمور عبر قناة التواصل المدرسي على نشاط الطلبة ونتائجهم، وقدمت توصيات عملية لدعمهم في المنزل.",
    "goal": "مثال: إشراك أولياء الأمور في متابعة تعلم أبنائهم وتعزيز الشراكة بين المدرسة والأسرة.",
    "quant": "مثال: تفاعل 30 من أصل 35 ولي أمر مع الرسالة المرسلة.",
    "qual": "مثال: وردت استفسارات إيجابية من عدد من أولياء الأمور حول متابعة أبنائهم.",
    "reflection": "هل كان التواصل واضحًا ومفيدًا لأولياء الأمور؟ وما الطريقة الأنسب لتكرار هذا التواصل بانتظام؟"
  },
  "التنويع في استراتيجيات التدريس": {
    "example": "توظيف استراتيجية ابحث وتعرف كأسلوب نشط بديل عن الشرح المباشر، لتنمية مهارة البحث الذاتي لدى الطلبة.",
    "heading": "وصف الاستراتيجية",
    "placeholder": "مثال: استراتيجية \"ابحث وتعرف\" استراتيجية تدريسية نشطة تقوم على طرح سؤال أو مشكلة على الطلبة، ثم قيامهم بالبحث الفردي أو الجماعي عن المعلومة، يليها عرض ما توصلوا إليه ومناقشته، وصولًا إلى تثبيت المفهوم المستهدف.",
    "goal": "مثال: تنمية مهارة البحث الذاتي لدى الطلبة، وتعزيز مشاركتهم الفاعلة داخل الحصة.",
    "quant": "مثال: شارك 85% من الطلبة بفاعلية في نشاط البحث.",
    "qual": "مثال: تحسّن واضح في قدرة الطلبة على استخلاص المعلومة ومناقشتها.",
    "reflection": "ما الذي نجح في تطبيق الاستراتيجية؟ وما الذي سأطوّره في المرة القادمة؟"
  },
  "تحسين نتائج المتعلمين": {
    "example": "ارتفاع درجات الطلبة في اختبار المفردات القصير عقب تطبيق الاستراتيجية مقارنة بالحصص السابقة.",
    "heading": "وصف الإجراء العلاجي / التحسيني",
    "placeholder": "مثال: طبّقت خطة علاجية قصيرة لمجموعة من الطلبة الأضعف في المفردات، تضمنت تدريبات مركزة ومتابعة أسبوعية.",
    "goal": "مثال: رفع مستوى تحصيل الطلبة ذوي الأداء المنخفض في مهارة محددة خلال فترة زمنية قصيرة.",
    "quant": "مثال: ارتفاع متوسط الدرجات من 65% إلى 80% بعد التدخل.",
    "qual": "مثال: زيادة ملحوظة في ثقة الطلبة المستهدفين بالمشاركة داخل الحصة.",
    "reflection": "هل تحقق التحسن المستهدف؟ وما الخطوة التالية لدعم الطلبة الذين لم يتحسنوا بعد؟"
  },
  "إعداد وتنفيذ خطة التعلم": {
    "example": "تضمين خطوات الاستراتيجية ضمن خطة الدرس اليومية بصورة واضحة ومتسلسلة قبل التنفيذ.",
    "heading": "وصف عملية التخطيط",
    "placeholder": "مثال: أعددت خطة الدرس بأهداف واضحة تراعي الفروق الفردية، وتضمنت أنشطة متنوعة ووسائل تقييم مناسبة.",
    "goal": "مثال: ضمان تنظيم الحصة وتحقيق الأهداف التعليمية المخطط لها بكفاءة.",
    "quant": "مثال: تم تنفيذ 100% من عناصر الخطة الموضوعة خلال الحصة.",
    "qual": "مثال: سار تنفيذ الحصة وفق التسلسل المخطط له دون الحاجة لتعديل جوهري.",
    "reflection": "هل خدمت الخطة تحقيق الأهداف فعليًا؟ وما التعديلات المطلوبة للخطط القادمة؟"
  },
  "توظيف تقنيات ووسائل التعلم المناسبة": {
    "example": "استخدام أجهزة لوحية أو مصادر إلكترونية موثوقة ليبحث الطلبة من خلالها عن المعلومة المستهدفة.",
    "heading": "وصف الوسيلة / التقنية المستخدمة",
    "placeholder": "مثال: استخدمت تطبيقًا تفاعليًا لعرض المفردات الجديدة أثناء نشاط البحث، مما ساعد الطلبة على الفهم والمشاركة بفاعلية.",
    "goal": "مثال: توظيف وسيلة تقنية تدعم نشاط البحث وتزيد من تفاعل الطلبة مع المحتوى.",
    "quant": "مثال: استخدم 90% من الطلبة الجهاز أو التطبيق بشكل مستقل.",
    "qual": "مثال: لاحظت تحمسًا أكبر من الطلبة عند استخدام الوسيلة التقنية مقارنة بالطريقة التقليدية.",
    "reflection": "هل خدمت الوسيلة الهدف التعليمي فعليًا؟ وهل هناك أداة أنسب يمكن تجربتها لاحقًا؟"
  },
  "تهيئة البيئة التعليمية": {
    "example": "إعادة تنظيم جلوس الطلبة في مجموعات بحث صغيرة داخل الصف بما يخدم تنفيذ الاستراتيجية.",
    "heading": "وصف تهيئة البيئة الصفية",
    "placeholder": "مثال: أعدت الصف بترتيب يسمح بالعمل الجماعي، ووفرت مصادر تعلم متنوعة تشجع الطلبة على المشاركة والبحث.",
    "goal": "مثال: توفير بيئة صفية آمنة ومحفزة تدعم العمل الجماعي والمشاركة الفاعلة.",
    "quant": "مثال: تم تقسيم الصف إلى 6 مجموعات عمل متكافئة.",
    "qual": "مثال: لاحظت تفاعلًا إيجابيًا وتعاونًا واضحًا بين أفراد كل مجموعة.",
    "reflection": "هل ساعد ترتيب البيئة الصفية على تحقيق الهدف؟ وما الذي يمكن تعديله في التنظيم لاحقًا؟"
  },
  "الإدارة الصفية": {
    "example": "ضبط زمن كل مرحلة من مراحل الاستراتيجية (بحث / عرض / تثبيت) دون حدوث فوضى أو تشتت.",
    "heading": "وصف ممارسة الإدارة الصفية",
    "placeholder": "مثال: وضعت قواعد واضحة لسير نشاط البحث داخل المجموعات، وتابعت التزام الطلبة بها أثناء التنفيذ.",
    "goal": "مثال: ضبط سير الحصة زمنيًا وسلوكيًا لضمان تنفيذ النشاط بفاعلية دون تشتت.",
    "quant": "مثال: التزمت جميع المجموعات (6 من 6) بالوقت المحدد لكل مرحلة.",
    "qual": "مثال: لم تُسجَّل أي حالة تشتت أو خروج عن النظام أثناء تنفيذ النشاط.",
    "reflection": "هل كانت إدارتي لوقت الحصة وسلوك الطلبة فعالة؟ وما الذي سأعدّله لضبط أفضل لاحقًا؟"
  },
  "تحليل نتائج المتعلمين وتشخيص مستوياتهم": {
    "example": "رصد الفروق الفردية بين الطلبة أثناء مرحلة البحث، وتصنيفهم وفق مستوى أدائهم الفعلي.",
    "heading": "وصف عملية التحليل والتشخيص",
    "placeholder": "مثال: حللت أداء الطلبة أثناء نشاط البحث لتحديد من يحتاج دعمًا إضافيًا في مهارة استخلاص المعلومة.",
    "goal": "مثال: تشخيص مستويات الطلبة الفعلية في مهارة محددة لتوجيه الدعم اللاحق بدقة.",
    "quant": "مثال: تم تصنيف الطلبة إلى 3 مستويات أداء بناءً على نتائج النشاط.",
    "qual": "مثال: تبيّن أن الفجوة الأكبر لدى الطلبة تكمن في مهارة اختيار المصدر المناسب للبحث.",
    "reflection": "هل ساعد التحليل على فهم احتياجات الطلبة بدقة؟ وما خطة الدعم المقترحة بناءً عليه؟"
  },
  "تنوع أساليب التقويم": {
    "example": "تقويم الطلبة من خلال عرض نتائج بحثهم شفهيًا، إضافة إلى ورقة عمل مكتوبة قصيرة.",
    "heading": "وصف أسلوب التقويم",
    "placeholder": "مثال: قوّمت الطلبة بعرض شفهي لنتائج بحثهم، إضافة إلى ورقة عمل كتابية قصيرة لقياس الفهم من زاويتين مختلفتين.",
    "goal": "مثال: قياس فهم الطلبة للمحتوى المستهدف من زوايا متعددة (شفهيًا وكتابيًا).",
    "quant": "مثال: أنهى 32 من 35 طالبًا التقويم الكتابي والشفهي بنجاح.",
    "qual": "مثال: أظهر التقويم الشفهي فهمًا أعمق لدى الطلبة مقارنة بالتقويم الكتابي فقط.",
    "reflection": "هل عكس التقويم فهم الطلبة الحقيقي؟ وهل يحتاج التنويع لتعديل في المرة القادمة؟"
  }
};

let DB_ELEMENTS = []; // العناصر الفعلية من قاعدة البيانات (قابلة للتعديل من لوحة التحكم)
let isRecoveryFlow = false;

/* ============ فحص مباشر لرابط استعادة كلمة المرور (لا نعتمد فقط على حدث Supabase) ============ */
function showRecoveryUI(){
  document.getElementById('authTabs').style.display = 'none';
  document.getElementById('authBody').style.display = 'none';
  document.getElementById('recoveryBody').style.display = 'block';
}

(function checkRecoveryLink(){
  const raw = window.location.hash ? window.location.hash.slice(1) : '';
  const params = new URLSearchParams(raw);
  const type = params.get('type');
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  if(type === 'recovery' && access_token && refresh_token){
    isRecoveryFlow = true;
    showRecoveryUI();
    sb.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if(error){
        document.getElementById('recoveryMsg').className = 'auth-msg error';
        document.getElementById('recoveryMsg').textContent = 'الرابط منتهي الصلاحية أو غير صالح، اطلب رابطًا جديدًا.';
      }
      history.replaceState(null, '', window.location.pathname);
    });
  }
})();


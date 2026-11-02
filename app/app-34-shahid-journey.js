/* ============================================================
   رحلة "شاهد جديد" التفاعلية — تجربة (روابط المعاينة فقط)
   ------------------------------------------------------------
   بدل فتح النموذج الطويل مباشرة: خطوات قصيرة (عنصر الأداء ← عنوان الدرس
   ← الاستراتيجية) ثم يُفتح نموذج الشاهد المعتاد مُعبّأً مسبقًا للمراجعة
   والحفظ، فلا منطق حفظ جديد هنا إطلاقًا (يُعاد استخدام saveShahid كما هو).
   تعمل فقط خارج نطاقات الإنتاج (أي على staging) — الإنتاج لا يتأثر.
   حاليًا عنصر واحد مفعّل: التنويع في استراتيجيات التدريس.
   ============================================================ */

const JOURNEY_ENABLED_ELEMENTS = ['التنويع في استراتيجيات التدريس'];

function shouldUseShahidJourney(){
  if(IS_PRODUCTION_HOST) return false;
  try{ if(/[?&]journey=0\b/.test((location && location.search) || '')) return false; }catch(e){}
  return true;
}

/* نقطة دخول زر "+ شاهد جديد": رحلة بالتجربة، والنموذج المعتاد بالإنتاج */
function startNewShahidEntry(){
  if(shouldUseShahidJourney()) openShahidJourney();
  else startNewShahid();
}

let _journey = null; // { el, step, elementKey, lesson, tplIdx }

function journeyTodayISO(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function journeyPrefill(){
  const meta = (currentUser && currentUser.user_metadata) || {};
  return {
    teacher: meta.full_name || '',
    school: getProfileSchool() || '',
    subject: getProfileSubject() || '',
    cls: getProfileClass() || '',
    date: journeyTodayISO()
  };
}

function openShahidJourney(){
  closeShahidJourney();
  const el = document.createElement('div');
  el.className = 'journey-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  document.body.appendChild(el);
  _journey = { el, step: 1, elementKey: '', lesson: '', tplIdx: '' };
  renderShahidJourney();
}

function closeShahidJourney(){
  if(_journey && _journey.el && _journey.el.remove) _journey.el.remove();
  _journey = null;
}

function journeyGo(step){
  if(!_journey) return;
  const input = _journey.el.querySelector('#journeyLesson');
  if(input) _journey.lesson = input.value;
  _journey.step = step;
  renderShahidJourney();
}

function journeyPickElement(key){
  if(!_journey || !JOURNEY_ENABLED_ELEMENTS.includes(key)) return;
  _journey.elementKey = key;
  journeyGo(2);
}

function journeyNextFromLesson(){
  if(!_journey) return;
  const input = _journey.el.querySelector('#journeyLesson');
  const v = input ? input.value.trim() : '';
  if(!v){ showToast('اكتب عنوان الدرس أولًا', 'err'); if(input) input.focus(); return; }
  _journey.lesson = v;
  journeyGo(3);
}

function journeyPickTemplate(idx){
  if(!_journey) return;
  _journey.tplIdx = idx; // '' = أكتب بنفسي
  journeyFinish();
}

/* ختام الرحلة: فتح نموذج الشاهد المعتاد مُعبّأً — نفس مسار الحفظ الأصلي */
function journeyFinish(){
  if(!_journey) return;
  const { elementKey, lesson, tplIdx } = _journey;
  const pre = journeyPrefill();
  closeShahidJourney();

  startNewShahid(); // يستدعي showForm → hideAllMainViews ويُظهر formView
  document.getElementById('mDate').value = pre.date;
  document.getElementById('mLesson').value = lesson;
  elementSelect.value = elementKey;
  updateExample();
  if(tplIdx !== ''){
    templateSelect.value = String(tplIdx);
    applyTemplate();
  }
  formDirty = true;
  scheduleDraftSave();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderShahidJourney(){
  if(!_journey) return;
  const j = _journey;
  const dots = [1, 2, 3].map(n => `<span class="journey-dot${n === j.step ? ' on' : (n < j.step ? ' done' : '')}"></span>`).join('');
  let title = '', body = '', back = '';

  if(j.step === 1){
    title = 'أي عنصر من عناصر الأداء تريد توثيقه؟';
    const els = (typeof DB_ELEMENTS !== 'undefined' && DB_ELEMENTS) ? DB_ELEMENTS : [];
    body = '<div class="journey-list">' + els.map(e => {
      const on = JOURNEY_ENABLED_ELEMENTS.includes(e.key);
      return `<button type="button" class="journey-card${on ? '' : ' off'}" ${on ? '' : 'disabled'} data-key="${escapeHtml(e.key)}">
        <span>${escapeHtml(e.label)}</span>${on ? '' : '<small>قريبًا</small>'}</button>`;
    }).join('') + '</div>';
  } else if(j.step === 2){
    const p = journeyPrefill();
    title = 'ما عنوان الدرس؟';
    const chips = [['المدرسة', p.school], ['المادة', p.subject], ['الصف', p.cls], ['التاريخ', p.date]]
      .filter(c => c[1]).map(c => `<span class="journey-chip">${escapeHtml(c[0])}: ${escapeHtml(c[1])}</span>`).join('');
    body = `<p class="journey-hint">عبّأنا بياناتك السابقة تلقائيًا، وتبقى قابلة للتعديل لاحقًا:</p>
      <div class="journey-chips">${chips}</div>
      <input type="text" id="journeyLesson" maxlength="200" placeholder="اكتب عنوان الدرس" value="${escapeHtml(j.lesson)}">
      <button type="button" class="btn btn-primary journey-next">التالي</button>`;
    back = '<button type="button" class="journey-back" data-go="1">رجوع</button>';
  } else {
    title = 'ما الاستراتيجية التي نفّذتها؟';
    const list = SHAHID_TEMPLATES[j.elementKey] || [];
    body = '<div class="journey-list">' + list.map((t, i) =>
      `<button type="button" class="journey-card" data-tpl="${i}"><span>${escapeHtml(t.name)}</span></button>`).join('') +
      '<button type="button" class="journey-card own" data-tpl=""><span>أكتب بنفسي</span></button></div>';
    back = '<button type="button" class="journey-back" data-go="2">رجوع</button>';
  }

  j.el.innerHTML = `<div class="journey-box">
    <div class="journey-top"><div class="journey-dots">${dots}</div>
      <button type="button" class="journey-close" aria-label="إغلاق">×</button></div>
    <h2>${title}</h2>${body}${back}</div>`;

  j.el.querySelector('.journey-close').onclick = closeShahidJourney;
  j.el.querySelectorAll('[data-key]').forEach(b => { b.onclick = () => journeyPickElement(b.getAttribute('data-key')); });
  j.el.querySelectorAll('[data-tpl]').forEach(b => { b.onclick = () => journeyPickTemplate(b.getAttribute('data-tpl')); });
  j.el.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => journeyGo(Number(b.getAttribute('data-go'))); });
  const next = j.el.querySelector('.journey-next');
  if(next) next.onclick = journeyNextFromLesson;
  const input = j.el.querySelector('#journeyLesson');
  if(input){
    input.addEventListener('keydown', ev => { if(ev.key === 'Enter') journeyNextFromLesson(); });
    input.focus();
  }
}

'use strict';
/* ============================================================
   «وثّقتها سابقًا — اربطها بشاهد موجود»: ربط حصة برنامج بشاهد قائم
   ------------------------------------------------------------
   المشكلة (بيانات المستخدم الفعلية): شواهد لحصص برامج وُثّقت كشاهد عادي (بلا ربط بالبرنامج)، أو قبل ربط
   البرنامج بالشعب (مربوطة بالبرنامج بلا شعبة) — فتبقى الحصة «لم تُوثَّق» وتظهر عملًا جاهزًا بلا نهاية.
   الحل: المعلم يختار الشاهد الصحيح بنفسه (لا تخمين بالتطبيق ولا تعديل مباشر بالقاعدة)، فيُربط بالحصة وشعبتها.
   - لا يُنشأ شاهد ولا يتغيّر نصه: تُضاف للشاهد حقول الربط فقط (program_id/program_session_no/program_section_id)،
     وتُعلَّم الحصة موثّقة بتاريخ الشاهد.
   - المسموح: شاهد غير مربوط بأي حصة، أو مربوط بالحصة نفسها بلا شعبة (توثيق قديم قبل ربط الشعب).
     شاهد مربوط بحصة أخرى مرفوض: لا تُنسب حصة واحدة لشاهدين ولا شاهد واحد لحصتين.
   - قبل الكتابة تُعاد قراءة الشاهد والحصة من القاعدة (CLAUDE.md §4)، وكل استعلام بتصفية المعلم (§1)،
     وإن فشل تعليم الحصة بعد ربط الشاهد يُعاد الشاهد كما كان.
   - يُفتح من ورقة حصة البرنامج (app-51) ومن تفاصيل البرنامج (app-10).
   ============================================================ */

const LINK_NEAR_DAYS = 21;     /* «قريب من أسبوع الحصة»: ±21 يومًا */
const LINK_FIRST = 8;          /* أول القائمة قبل «عرض كل الشواهد» */
const LINK_COLS = 'id, ref_number, lesson_title, lesson_date, created_at, class_name, element_label, program_id, program_session_no, program_section_id';

let lkState = null;   /* { token, ctx, rows, showAll, selected, busy, error } */
let lkToken = 0;

function linkResetState(){ lkState = null; lkToken++; }

/* ============ دوال صرفة ============ */

/* هل يجوز ربط هذا الشاهد بهذه الحصة؟ */
function linkShahidAllowed(r, ctx){
  if(!r) return false;
  if(!r.program_id) return true;
  return String(r.program_id) === String(ctx.programId) && Number(r.program_session_no) === Number(ctx.sessionNo)
    && !r.program_section_id && !!ctx.sectionId;
}

function linkDaysBetween(a, b){
  const t = x => new Date(String(x).slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round(Math.abs(t(a) - t(b)) / 86400000);
}

/* المرشّحون: المسموح ربطه فقط، الأقرب لأسبوع الحصة أولًا (أو الأحدث بلا أسبوع معروف)، مع علامة «قريب» */
function linkCandidateShawahid(rows, ctx){
  const dateOf = r => String(r.lesson_date || r.created_at || '').slice(0, 10);
  const ok = (rows || []).filter(r => linkShahidAllowed(r, ctx) && dateOf(r));
  return ok.map(r => {
    const d = dateOf(r);
    /* داخل أسبوع الحصة (من أوله حتى سادس يوم) = 0، وإلا البعد عن أقرب طرفيه */
    const end = ctx.weekStart ? addDaysIso(ctx.weekStart, 6) : null;
    const dist = !ctx.weekStart ? null : (d >= ctx.weekStart && d <= end ? 0 : Math.min(linkDaysBetween(d, ctx.weekStart), linkDaysBetween(d, end)));
    return Object.assign({}, r, { date: d, dist, near: dist !== null && dist <= LINK_NEAR_DAYS });
  }).sort((a, b) => ctx.weekStart ? (a.dist - b.dist || b.date.localeCompare(a.date)) : b.date.localeCompare(a.date));
}

/* ============ النافذة ============ */

function lkOpen(){ return !!lkState && lkState.token === lkToken; }

/* ctx: { programId, sessionNo, sectionId?, sectionLabel?, onDone? } */
async function openLinkShahidPicker(ctx){
  if(!currentUser || !ctx || !ctx.programId) return;
  lkToken++;
  const st = { token: lkToken, ctx: Object.assign({}, ctx), rows: null, showAll: false, selected: null, busy: false, error: false };
  lkState = st;
  showInfoModal('<div id="lkBody" style="text-align:right;"><div class="loading-state">جارِ تحميل شواهدك...</div></div>', '460px');
  const cancel = document.getElementById('confirmCancelBtn');
  const onClose = () => { if(lkState === st) lkState = null; cancel.removeEventListener('click', onClose); };
  cancel.addEventListener('click', onClose);
  const uid = currentUser.id;
  try{
    const [pRes, sRes] = await Promise.all([
      sb.from('activity_programs').select('id, name, created_at, sessions, total_sessions').eq('user_id', uid).eq('id', ctx.programId).maybeSingle(),
      sb.from('shawahid').select(LINK_COLS).eq('user_id', uid).order('created_at', { ascending: false }).limit(400)
    ]);
    if(lkState !== st || !currentUser || currentUser.id !== uid) return;
    if(pRes.error || sRes.error || !pRes.data) throw new Error('load');
    st.program = pRes.data;
    const ses = (pRes.data.sessions || []).find(s => Number(s.session_no) === Number(ctx.sessionNo));
    st.weekLabel = ses ? (ses.week_label || '') : '';
    /* بداية أسبوع الحصة من التقويم (للترتيب بالقرب فقط) */
    st.ctx.weekStart = null;
    if(st.weekLabel && typeof calendarRegion !== 'undefined' && calendarRegion && typeof loadCalendarData === 'function'){
      try{
        const { weeks } = await loadCalendarData(calendarRegion);
        st.ctx.weekStart = inboxResolveWeekStart(inboxWeekOccurrences(weeks), st.weekLabel, String(pRes.data.created_at || '').slice(0, 10));
      } catch(e){ st.ctx.weekStart = null; }
    }
    if(lkState !== st) return;
    st.rows = linkCandidateShawahid(sRes.data || [], st.ctx);
  } catch(e){
    if(lkState !== st) return;
    st.rows = [];
    st.error = true;
  }
  lkRender();
}

function lkRender(){
  const st = lkState;
  const box = document.getElementById('lkBody');
  if(!st || !box) return;
  const p = st.program || {};
  const title = `الحصة ${st.ctx.sessionNo}${st.weekLabel ? ' — ' + st.weekLabel : ''}${st.ctx.sectionLabel ? ' — ' + st.ctx.sectionLabel : ''}`;
  const rows = st.rows || [];
  const near = rows.filter(r => r.near);
  const shown = st.showAll ? rows : (near.length ? near.slice(0, LINK_FIRST) : rows.slice(0, LINK_FIRST));
  const list = shown.map(r => {
    const i = rows.indexOf(r);
    const on = st.selected === i;
    const meta = [r.date ? (typeof shortDateAr === 'function' ? shortDateAr(r.date) : r.date) : '', r.class_name, r.ref_number].filter(Boolean).map(x => escapeHtml(String(x))).join(' · ');
    return `<button type="button" class="tlx-row lk-row${on ? ' is-on' : ''}" ${st.busy ? 'disabled' : ''} onclick="lkSelect(${i})">
        <span class="tlx-row-main"><b>${escapeHtml(r.lesson_title || r.class_name || 'شاهد')}</b><small>${meta}</small>
        ${r.program_id ? '<small class="lk-legacy">موثّق لهذه الحصة بلا شعبة — يُربط بالشعبة</small>' : ''}</span>
        ${on ? '<span class="tlx-pill is-ok">مختار</span>' : (r.near ? '<span class="tlx-pill is-blue">قريب</span>' : '')}</button>`;
  }).join('');
  const more = !st.showAll && rows.length > shown.length
    ? `<button type="button" class="tlx-more" onclick="lkShowAll()">عرض كل الشواهد غير المربوطة (${rows.length})</button>` : '';
  const sel = st.selected !== null && rows[st.selected];
  box.innerHTML = `
    <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">اربط الحصة بشاهد وثّقته سابقًا</h3>
    <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px;">${escapeHtml(p.name || '')} · ${escapeHtml(title)}</div>
    <p class="tlx-note">اختر الشاهد الذي وثّقت به هذه الحصة. لا يُنشأ شاهد جديد ولا يتغيّر نصه — يُربط فقط فتصير الحصة «موثّقة».</p>
    ${st.error ? '<p class="tlx-note">تعذّر تحميل شواهدك — تحقق من الاتصال.</p>' : ''}
    ${rows.length ? `<div class="tlx-sec">${near.length && !st.showAll ? 'شواهد قريبة من أسبوع الحصة' : 'شواهدك غير المربوطة'}</div><div class="tlx-box">${list}${more}</div>`
      : (st.error ? '' : '<div class="tlx-box tlx-empty"><b>لا شواهد غير مربوطة</b><small>كل شواهدك مربوطة بحصص أخرى، أو لا شواهد بعد.</small></div>')}
    ${sel ? `<button type="button" id="lkLinkBtn" class="tlx-btn is-navy" style="margin-top:10px;" ${st.busy ? 'disabled' : ''} onclick="lkLink()">اربط «${escapeHtml((sel.lesson_title || 'الشاهد').slice(0, 40))}» بهذه الحصة</button>` : ''}`;
}

function lkSelect(i){
  if(!lkState || lkState.busy || !(lkState.rows || [])[i]) return;
  lkState.selected = lkState.selected === i ? null : i;
  lkRender();
}

function lkShowAll(){
  if(!lkState) return;
  lkState.showAll = true;
  lkRender();
}

/* الربط: إعادة قراءة الشاهد والحصة، ثم حقول الربط على الشاهد، ثم تعليم الحصة (وإن فشل يُعاد الشاهد كما كان) */
async function lkLink(){
  const st = lkState;
  if(!st || st.busy || st.selected === null || !currentUser) return;
  const pick = st.rows[st.selected];
  if(!pick) return;
  const uid = currentUser.id;
  const ctx = st.ctx;
  st.busy = true;
  lkRender();
  const fail = msg => { showToast(msg, 'error'); st.busy = false; if(lkState === st) lkRender(); };
  try{
    const [shRes, pRes] = await Promise.all([
      sb.from('shawahid').select(LINK_COLS).eq('user_id', uid).eq('id', pick.id).maybeSingle(),
      sb.from('activity_programs').select('sessions').eq('user_id', uid).eq('id', ctx.programId).maybeSingle()
    ]);
    if(shRes.error || pRes.error) return fail('تعذّر التحقق قبل الربط — حاول ثانية');
    if(!shRes.data) return fail('الشاهد لم يعد موجودًا');
    if(!linkShahidAllowed(shRes.data, ctx)) return fail('هذا الشاهد صار مربوطًا بحصة أخرى — اختر غيره');
    const ses = pRes.data && (pRes.data.sessions || []).find(s => Number(s.session_no) === Number(ctx.sessionNo));
    if(!ses) return fail('الحصة لم تعد في البرنامج');
    const slotDone = ctx.sectionId ? !!(ses.section_status && ses.section_status[ctx.sectionId] && ses.section_status[ctx.sectionId].done) : !!ses.done;
    if(slotDone) return fail('هذه الحصة موثّقة من قبل (ربما من جهاز آخر)');

    const before = { program_id: shRes.data.program_id || null, program_session_no: shRes.data.program_session_no == null ? null : shRes.data.program_session_no, program_section_id: shRes.data.program_section_id || null };
    const after = { program_id: ctx.programId, program_session_no: Number(ctx.sessionNo), program_section_id: ctx.sectionId || null };
    const up = await sb.from('shawahid').update(after).eq('user_id', uid).eq('id', pick.id);
    if(up.error) return fail('تعذّر الربط: ' + up.error.message);
    const doneDate = String(shRes.data.lesson_date || shRes.data.created_at || '').slice(0, 10) || undefined;
    const ok = await markProgramSessionDone(ctx.programId, Number(ctx.sessionNo), pick.id, doneDate, ctx.sectionId || undefined);
    if(ok === false){
      /* الحصة لم تُعلَّم: نعيد الشاهد كما كان كي لا يبقى مربوطًا بحصة تبدو غير موثّقة */
      await sb.from('shawahid').update(before).eq('user_id', uid).eq('id', pick.id);
      st.busy = false;
      if(lkState === st) lkRender();
      return;
    }
    if(typeof myRecords !== 'undefined' && Array.isArray(myRecords)){
      const r = myRecords.find(x => String(x.id) === String(pick.id));
      if(r) Object.assign(r, after);
    }
    showToast('رُبط الشاهد بالحصة ✓', 'ok');
    if(lkState === st){ lkState = null; if(typeof closeCrmModal === 'function') closeCrmModal(); }
    if(typeof ctx.onDone === 'function'){ try{ await ctx.onDone(); } catch(e){ /* غير حرج */ } }
  } catch(e){
    fail('تعذّر الربط: ' + ((e && e.message) || ''));
  }
}

/* من تفاصيل البرنامج (app-10) */
function linkProgramSessionFromDetail(programId, sessionNo, sectionId, sectionLabel){
  openLinkShahidPicker({ programId, sessionNo, sectionId: sectionId || null, sectionLabel: sectionLabel || '',
    onDone: () => { if(typeof currentProgramId !== 'undefined' && String(currentProgramId) === String(programId)) return showProgramDetail(programId); } });
}

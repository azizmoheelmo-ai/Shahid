'use strict';
/* ============================================================
   (49) «مقترحون من الدرجات» — ربط المتابعة بالتحصيل (FOLLOWUP-AGREEMENT.md §10)
   ------------------------------------------------------------
   - لا محرك ثانٍ: لكل طالب يُبنى التشخيص بـsrDiagnose (تقرير الطالب التحليلي، app-36) من نفس
     الصفوف (srGradeRowsFor) ونفس الحدود (srRulesNow)؛ فما يُقترح هنا = ما يقوله التقرير حرفيًا.
   - يُقترح فقط: «يستدعي التواصل مع ولي الأمر» (parentContact) و«ضعف مثبت» (تحصيلي weak/persistent،
     أو مؤشر تعلّمي weak). «نتيجة منخفضة» في بند واحد و«لا بيانات كافية» لا يُقترحان (م1، م9).
   - الضعف الجماعي: بند فيه 30% فأكثر ممن رُصد لهم دون الحد (و3 طلاب على الأقل) ← بطاقة متابعة جماعية
     يحدد المعلم طلابها، ولا يتكرر طلابها أفرادًا إن كان كل ضعفهم في بنود جماعية (إلا من يستدعي ولي الأمر).
   - لا يُقترح: من له متابعة تحصيل مفتوحة، والمنقول، وما أُخفي بـ«ليس الآن» (14 يومًا، بجدول
     classroom_attention_dismissals القائم).
   - التحميل عند فتح «مقترحون» فقط، شعبةً شعبة عبر loadCrmGradeSheet (مقيَّد بـteacher_id)، ويُحفظ للجلسة
     ويُلغى بعد فتح متابعة (gsInvalidate). نتيجة تحميل قديم تُهمل (رمز gsState.token).
   ============================================================ */

const GS_RULE = 'grade_suggest';
const GS_RULE_GROUP = 'grade_suggest_group';
const GS_GROUP_SHARE = 0.3;
const GS_GROUP_MIN = 3;
const GS_TAGS = { parent: 'تعثر شديد', tahsili: 'تحصيلي', taalumi: 'تعلّمي' };
const GS_FOCUS_LABELS = { tahsili: 'اختبارات ومهام', homework: 'واجبات', participation: 'مشاركة' };

let gsState = { status: 'idle', token: 0, done: 0, total: 0, bySection: new Map(), dismissals: [], section: '', error: '' };
let gsGroupDraft = null;

/* ============================================================
   دوال صرفة
   ============================================================ */

/* البنود الضعيفة للطالب كما يحكم عليها التشخيص: صفوف المكوّن (لا الفترات) في المجال، دون حدّ الضعف */
function gsWeakRows(rows, dx, rules){
  const comps = srComponentRows(rows).filter(r => r.domain && r.pct !== null && r.pct !== undefined && r.pct < rules.pass);
  const tah = dx.tahsili || {};
  const weakTaal = new Set((dx.taalumi && dx.taalumi.weak || []).map(i => i.name));
  return comps.filter(r => (r.domain === 'tahsili' && (tah.weak || tah.persistent)) || (r.domain === 'taalumi' && weakTaal.has(r.name)));
}

/* اقتراح طالب واحد من تشخيصه، أو null. focus يحدد مكتبة الاتفاق والبنود التي يُقاس عليها */
function gsPersonFrom(studentId, rows, dx, rules){
  const tah = dx.tahsili || {};
  const taalWeak = (dx.taalumi && dx.taalumi.weak) || [];
  const proven = !!(tah.weak || tah.persistent || taalWeak.length || dx.parentContact);
  if(!proven) return null;
  const recs = (dx.recommendations || []).filter(r => !r.parent);
  const parent = (dx.recommendations || []).find(r => r.parent) || null;
  const weak = gsWeakRows(rows, dx, rules);
  let focus = 'tahsili', focusRows = weak.filter(r => r.domain === 'tahsili');
  if(!(tah.weak || tah.persistent) && taalWeak.length){
    const first = weak.find(r => r.domain === 'taalumi');
    focus = first && first.kind === 'homework' ? 'homework' : first && first.kind === 'participation' ? 'participation' : 'tahsili';
    focusRows = first ? [first] : [];
  }
  const evidence = recs.map(r => r.evidence).filter(Boolean);
  if(!evidence.length && parent) evidence.push(parent.evidence);
  return {
    studentId, parent: !!dx.parentContact,
    tag: dx.parentContact ? 'parent' : (tah.weak || tah.persistent) ? 'tahsili' : 'taalumi',
    evidence, action: (recs[0] && recs[0].action) || (parent && parent.action) || '',
    focus, focusRowIds: focusRows.map(r => r.id), weakRowIds: weak.map(r => r.id)
  };
}

/* entries: [{ studentId, rows, dx }] لشعبة واحدة.
   opts: { rules, openGrades: Set(studentId), dismissals, nowMs, sectionId, nameOf(rowId) }
   → { groups: [...], people: [...] } (الأفراد: ولي الأمر أولًا ثم الضعف المثبت) */
function gsSuggestionsFor(entries, opts){
  const rules = opts.rules;
  const nowMs = opts.nowMs || Date.now();
  const open = opts.openGrades || new Set();
  const dismissed = (rule, key) => typeof isDismissed === 'function' && isDismissed(opts.dismissals || [], rule, key, nowMs);

  /* الجماعي: لكل بند (صف مكوّن) نسبة من دون الحد ممن رُصد لهم */
  const byItem = new Map();
  (entries || []).forEach(e => srComponentRows(e.rows).forEach(r => {
    if(!r.domain || r.pct === null || r.pct === undefined) return;
    if(!byItem.has(r.id)) byItem.set(r.id, { id: r.id, name: r.name, kind: r.kind, domain: r.domain, category: r.category, recorded: 0, sum: 0, low: [] });
    const it = byItem.get(r.id);
    it.recorded++; it.sum += r.pct;
    if(r.pct < rules.pass) it.low.push({ studentId: e.studentId, pct: r.pct, open: open.has(e.studentId) });
  }));
  const groups = [];
  byItem.forEach(it => {
    if(it.low.length < GS_GROUP_MIN || it.low.length / it.recorded < GS_GROUP_SHARE) return;
    const key = opts.sectionId + '|' + it.id;
    if(dismissed(GS_RULE_GROUP, key)) return;
    groups.push({ key, sectionId: opts.sectionId, itemId: it.id, name: it.name, kind: it.kind, domain: it.domain, category: it.category,
      classPct: it.sum / it.recorded, recorded: it.recorded, members: it.low.sort((a, b) => a.pct - b.pct) });
  });
  const groupItems = new Set(groups.map(g => g.itemId));

  const people = [];
  (entries || []).forEach(e => {
    if(open.has(e.studentId) || dismissed(GS_RULE, e.studentId)) return;
    const p = gsPersonFrom(e.studentId, e.rows, e.dx, rules);
    if(!p) return;
    /* كل ضعفه في بنود جماعية: يُتابَع ضمن المجموعة لا فردًا (إلا من يستدعي ولي الأمر) */
    if(!p.parent && p.weakRowIds.length && p.weakRowIds.every(id => groupItems.has(id))) return;
    people.push(p);
  });
  people.sort((a, b) => (b.parent - a.parent) || String(opts.nameOf ? opts.nameOf(a.studentId) : '').localeCompare(String(opts.nameOf ? opts.nameOf(b.studentId) : ''), 'ar'));
  return { groups, people };
}

/* خط الأساس لمتابعة من اقتراح: نسبة الطالب في البنود المحددة وقت الفتح (يُقاس عليها «بعد» في المراجعة) */
function gsBaseline(columns, scores, studentId, columnIds, focus){
  const ids = new Set(columnIds || []);
  const cols = (columns || []).filter(c => ids.has(c.id));
  if(!cols.length) return null;
  const colById = new Map(cols.map(c => [c.id, c]));
  let sum = 0, max = 0;
  (scores || []).forEach(s => {
    if(s.student_id !== studentId || !colById.has(s.column_id) || s.score === null || s.score === undefined) return;
    sum += Number(s.score); max += Number(colById.get(s.column_id).max_score);
  });
  if(!(max > 0)) return null;
  const cats = [...new Set(cols.map(c => c.category))];
  const label = cols.length === 1 ? cols[0].name : (GS_FOCUS_LABELS[focus] || 'التحصيل');
  return { category: cats.length === 1 ? cats[0] : 'tests', columnIds: cols.map(c => c.id), label, focus: focus || null,
    pct: Math.round(100 * sum / max), sum, max };
}

function gsActionFor(focus, parent){
  if(parent) return 'other';
  return focus === 'tahsili' ? 'reteach' : 'individual_session';
}

/* ============================================================
   التحميل
   ============================================================ */
function gsTermKey(){
  const t = typeof crmCurrentTerm === 'function' ? crmCurrentTerm() : {};
  return (t.year || '') + '|' + (t.semester || '');
}

function gsInvalidate(){
  gsState = { status: 'idle', token: gsState.token + 1, done: 0, total: 0, bySection: new Map(), dismissals: [], section: gsState.section, error: '' };
}

async function gsLoadDismissals(){
  const { data, error } = await sb.from('classroom_attention_dismissals').select('rule_key, subject_key, dismissed_at')
    .eq('teacher_id', currentUser.id).in('rule_key', [GS_RULE, GS_RULE_GROUP]);
  if(error) throw error;
  return data || [];
}

/* المتابعات المفتوحة للتحصيل (فردية وجماعية) — لا يُقترح أصحابها */
async function gsLoadOpenGrades(){
  const { data, error } = await sb.from('classroom_followups').select('student_id')
    .eq('teacher_id', currentUser.id).eq('status', 'open').eq('reason_type', 'grades');
  if(error) throw error;
  return new Set((data || []).map(r => r.student_id));
}

async function gsLoadSection(sectionId, rules, openGrades, dismissals){
  const g = await loadCrmGradeSheet(sectionId);
  if(!g || g.error) throw (g && g.error) || new Error('تعذّر تحميل الكشف');
  const term = { year: g.year, semester: g.semester };
  const students = crmStudentsOfSection(sectionId).filter(st => st.is_active !== false);
  const { count: lessonsHeld, error: lErr } = await sb.from('classroom_lessons').select('id', { count: 'exact', head: true })
    .eq('teacher_id', currentUser.id).eq('section_id', sectionId);
  if(lErr) throw lErr;
  const testGroups = typeof tlGroupsOf === 'function' ? tlGroupsOf(typeof appFeatures !== 'undefined' ? appFeatures : null, term) : [];
  let hw = null;
  const today = localIsoDate();
  const entries = [];
  for(const st of students){
    const gr = srGradeRowsFor(g, st.id, term);
    if(!gr.rows.length) continue;
    let homework = null;
    if(gr.rows.some(r => r.kind === 'homework')){
      if(!hw) hw = await loadSectionHomework(sectionId, term);
      homework = srHomeworkCountsFrom(hw, st.id, today);
    }
    const dx = srDiagnose({ rows: gr.rows, rules, homework, lessonsHeld: lessonsHeld || 0, overall: gr.overall, testGroups });
    entries.push({ studentId: st.id, rows: gr.rows, dx });
  }
  const res = gsSuggestionsFor(entries, { rules, openGrades, dismissals, sectionId, nameOf: attentionStudentName });
  return Object.assign(res, { g, entries });
}

async function gsEnsureLoaded(){
  /* تغيّر الفصل الدراسي المعروض: مقترحات الفصل السابق لا تُعرض */
  if((gsState.status === 'loading' || gsState.status === 'ready') && gsState.termKey !== gsTermKey()) gsInvalidate();
  if(gsState.status === 'loading' || gsState.status === 'ready') return;
  const token = ++gsState.token;
  const sections = crmSections.filter(sec => crmStudentsOfSection(sec.id).some(st => st.is_active !== false));
  Object.assign(gsState, { status: 'loading', done: 0, total: sections.length, bySection: new Map(), error: '', termKey: gsTermKey() });
  gsRepaint();
  try{
    const rules = srRulesNow();
    const [dismissals, openGrades] = await Promise.all([gsLoadDismissals(), gsLoadOpenGrades()]);
    if(token !== gsState.token) return;
    gsState.dismissals = dismissals;
    for(const sec of sections){
      const res = await gsLoadSection(sec.id, rules, openGrades, dismissals);
      if(token !== gsState.token) return; /* أُلغي (فُتحت متابعة/تغيّر الفصل) أثناء التحميل */
      gsState.bySection.set(sec.id, res);
      gsState.done++;
      gsRepaint();
    }
    gsState.status = 'ready';
    if(typeof fuTabPaint === 'function' && typeof fuTabState !== 'undefined' && fuTabState.mode === 'suggest'){ fuTabPaint(); return; } /* العدد على زر التبديل */
  } catch(e){
    if(token !== gsState.token) return;
    gsState.status = 'error';
    gsState.error = (e && e.message) || '';
  }
  gsRepaint();
}

/* ============================================================
   الواجهة (داخل تبويب «متابعة»)
   ============================================================ */
function gsRepaint(){
  if(typeof fuTabState === 'undefined' || fuTabState.mode !== 'suggest') return;
  const body = document.getElementById('gsBody');
  if(body) body.innerHTML = gsBodyHtml();
}

function gsCount(){
  if(gsState.status !== 'ready') return null;
  let n = 0;
  gsState.bySection.forEach(r => { n += r.people.length + r.groups.length; });
  return n;
}

function gsPersonRowHtml(p, sectionId){
  const name = attentionStudentName(p.studentId);
  const sec = typeof fuShortSection === 'function' ? fuShortSection(sectionId) : '';
  return `<div class="fu-row">
    <div class="fu-main"><div class="fu-name">${escapeHtml(name)}${sec ? ` <bdi class="fu-sec">${escapeHtml(sec)}</bdi>` : ''}</div>
      <div class="fu-fact">${escapeHtml(p.evidence[0] || '')}${p.evidence.length > 1 ? ` <span class="fu-sec">(+${p.evidence.length - 1})</span>` : ''}</div>
      <button type="button" class="gs-skip" onclick="gsDismiss('${GS_RULE}', '${escapeHtml(p.studentId)}')">ليس الآن</button></div>
    <div class="fu-side"><span class="fu-chip ${p.parent ? 'fu-late' : 'fu-soon'}">${escapeHtml(GS_TAGS[p.tag])}</span>
      <button type="button" class="btn btn-primary crm-mini-btn fu-b" onclick="gsStart('${escapeHtml(sectionId)}', '${escapeHtml(p.studentId)}')">ابدأ متابعة</button></div>
  </div>`;
}

function gsGroupCardHtml(g){
  const sec = typeof fuShortSection === 'function' ? fuShortSection(g.sectionId) : '';
  return `<div class="gs-grp">👥 <b>${escapeHtml(arabicCountPhrase(g.members.length, CRM_STUDENT_COUNT_FORMS))}${sec ? ' في <bdi>' + escapeHtml(sec) + '</bdi>' : ''}</b>
    دون الحد في «${escapeHtml(g.name)}» (متوسط الشعبة ${Math.round(g.classPct)}%) — قد يكون السبب في الدرس نفسه لا في الطلاب.
    <div class="gs-grp-actions"><button type="button" class="btn btn-outline crm-mini-btn fu-b" onclick="gsOpenGroup('${escapeHtml(g.key)}')">متابعة جماعية</button>
      <button type="button" class="gs-skip" onclick="gsDismiss('${GS_RULE_GROUP}', '${escapeHtml(g.key)}')">ليس الآن</button></div></div>`;
}

function gsBodyHtml(){
  const s = gsState;
  if(s.status === 'idle' || (s.status === 'loading' && !s.total)) return '<div class="loading-state">جارٍ قراءة الكشوف...</div>';
  if(s.status === 'error') return `<div class="crm-today-empty">تعذّر قراءة الكشوف: ${escapeHtml(s.error)} <a href="#" onclick="event.preventDefault();gsInvalidate();gsEnsureLoaded()">إعادة المحاولة</a></div>`;
  if(s.status === 'loading') return `<div class="loading-state">جارٍ قراءة كشوف الشعب (${s.done} من ${s.total})...</div>`;
  const all = [...s.bySection.entries()].filter(([, r]) => r.people.length || r.groups.length);
  if(!all.length) return `<div class="crm-today-empty">لا ضعف مثبت يستدعي متابعة الآن ✓ — بحسب تشخيص التقرير التحليلي وحدودك.</div>${gsSourceHtml()}`;
  if(s.section && !all.some(([id]) => id === s.section)) s.section = '';
  let html = '';
  if(all.length > 1){
    html += `<div class="fu-chips"><button type="button" class="fu-f${s.section ? '' : ' fu-on'}" onclick="gsSetSection('')">كل الفصول</button>${
      all.map(([id, r]) => `<button type="button" class="fu-f${s.section === id ? ' fu-on' : ''}" onclick="gsSetSection('${escapeHtml(id)}')"><bdi>${escapeHtml(fuShortSection(id) || 'شعبة')}</bdi> (${r.people.length + r.groups.length})</button>`).join('')}</div>`;
  }
  const shown = all.filter(([id]) => !s.section || id === s.section);
  const groups = [], parents = [], weak = [];
  shown.forEach(([id, r]) => {
    r.groups.forEach(g => groups.push(g));
    r.people.forEach(p => (p.parent ? parents : weak).push(gsPersonRowHtml(p, id)));
  });
  html += groups.map(gsGroupCardHtml).join('');
  if(parents.length) html += `<div class="fu-grp">يستدعي التواصل مع ولي الأمر (${parents.length})</div><div class="fu-box">${parents.join('')}</div>`;
  if(weak.length) html += `<div class="fu-grp">ضعف مثبت (${weak.length})</div><div class="fu-box">${weak.join('')}</div>`;
  return html + gsSourceHtml();
}

function gsSourceHtml(){
  const r = srRulesNow();
  return `<div class="gs-src">المصدر: نفس تشخيص «تقرير الطالب التحليلي» وبحدودك (الضعف دون ${r.pass}%). لا يُقترح من لم يُرصد له ما يكفي للحكم.</div>`;
}

function gsSetSection(id){
  gsState.section = id;
  gsRepaint();
}

function gsFind(sectionId, studentId){
  const r = gsState.bySection.get(sectionId);
  return r ? { r, p: r.people.find(x => x.studentId === studentId) } : null;
}

/* «ابدأ متابعة»: نافذة الفتح المعتادة مملوءة (السبب = الدليل، الإجراء = توصية التقرير، خط الأساس = البند الضعيف) */
function gsStart(sectionId, studentId){
  const f = gsFind(sectionId, studentId);
  if(!f || !f.p) return;
  const p = f.p;
  const baseline = gsBaseline(f.r.g.columns, f.r.g.scores, studentId, p.focusRowIds, p.focus)
    || gradeFollowupBaseline(f.r.g.columns, f.r.g.scores, studentId, null);
  openCrmFollowupModal(studentId, {
    reasonType: 'grades', reasonText: String(p.evidence.join(' · ')).slice(0, 500), baseline,
    actionType: gsActionFor(p.focus, p.parent), note: String(p.action || '').slice(0, 500)
  });
}

async function gsDismiss(rule, key){
  if(gsState.dismissing) return;
  gsState.dismissing = true;
  try{
    const { error } = await sb.from('classroom_attention_dismissals').upsert(
      { teacher_id: currentUser.id, rule_key: rule, subject_key: key, dismissed_at: new Date().toISOString() },
      { onConflict: 'teacher_id,rule_key,subject_key' });
    if(error){ showToast('تعذّر الحفظ: ' + (error.message || ''), 'error'); return; }
    /* إزالة محلية فورية بلا إعادة قراءة الكشوف */
    gsState.dismissals.push({ rule_key: rule, subject_key: key, dismissed_at: new Date().toISOString() });
    gsState.bySection.forEach(r => {
      if(rule === GS_RULE) r.people = r.people.filter(p => p.studentId !== key);
      else r.groups = r.groups.filter(g => g.key !== key);
    });
    showToast('أُخفي 14 يومًا', 'ok');
    if(typeof fuTabPaint === 'function') fuTabPaint();
  } finally { gsState.dismissing = false; }
}

/* ============================================================
   المتابعة الجماعية المقترحة: المعلم يحدد الطلاب
   ============================================================ */
function gsFindGroup(key){
  for(const r of gsState.bySection.values()){
    const g = r.groups.find(x => x.key === key);
    if(g) return { r, g };
  }
  return null;
}

function gsOpenGroup(key){
  const f = gsFindGroup(key);
  if(!f) return;
  const selected = new Set(f.g.members.filter(m => !m.open).map(m => m.studentId));
  gsGroupDraft = { key, selected, extra: false, saving: false };
  showInfoModal('<div id="gsGroupRoot" class="fa-wrap"></div>', '440px');
  gsGroupPaint();
}

/* الطلاب المعروضون: من دون الحد (بنسبهم)، ثم — بعد «إضافة طالب آخر» — بقية طلاب الشعبة النشطين */
function gsGroupCandidates(g, sectionStudents){
  const low = g.members.map(m => ({ studentId: m.studentId, pct: m.pct, open: m.open, low: true }));
  const inLow = new Set(low.map(x => x.studentId));
  const others = (sectionStudents || []).filter(st => st.is_active !== false && !inLow.has(st.id))
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ar'))
    .map(st => ({ studentId: st.id, pct: null, open: false, low: false }));
  return { low, others };
}

function gsGroupPaint(){
  const d = gsGroupDraft;
  const root = document.getElementById('gsGroupRoot');
  if(!d || !root) return;
  const f = gsFindGroup(d.key);
  if(!f){ root.innerHTML = '<div class="crm-today-empty">لم يعد هذا الاقتراح قائمًا.</div>'; return; }
  const g = f.g;
  const c = gsGroupCandidates(g, crmStudentsOfSection(g.sectionId));
  const row = x => `<button type="button" class="gp-row${d.selected.has(x.studentId) ? '' : ' gp-off'}" onclick="gsGroupToggle('${escapeHtml(x.studentId)}')">
      <span class="gp-box">${d.selected.has(x.studentId) ? '✓' : ''}</span>
      <span class="gp-name">${escapeHtml(attentionStudentName(x.studentId))}${x.open ? ' <small>له متابعة مفتوحة</small>' : ''}</span>
      <span class="gp-pct">${x.pct === null ? '' : Math.round(x.pct) + '%'}</span></button>`;
  const n = d.selected.size;
  const sec = fuShortSection(g.sectionId);
  root.innerHTML = `
    <div class="gp-t">متابعة جماعية${sec ? ' — <bdi>' + escapeHtml(sec) + '</bdi>' : ''}</div>
    <div class="gp-s">دون الحد في «${escapeHtml(g.name)}» · متوسط الشعبة ${Math.round(g.classPct)}% · ${g.members.length} من ${g.recorded} ممن رُصد لهم</div>
    <div class="gp-bar"><span>المختارون: ${n}</span><button type="button" onclick="gsGroupAll()">اختيار الكل</button></div>
    <div class="gp-list">${c.low.map(row).join('')}${d.extra ? c.others.map(row).join('') : ''}</div>
    ${d.extra || !c.others.length ? '' : '<button type="button" class="gp-add" onclick="gsGroupExtra()">+ إضافة طالب آخر من الشعبة</button>'}
    <button type="button" class="btn btn-primary gp-go" id="gsGroupGo" ${n < 2 ? 'disabled' : ''} onclick="gsGroupSave()">${n < 2 ? 'اختر طالبين على الأقل' : `ابدأ المتابعة الجماعية (${escapeHtml(arabicCountPhrase(n, CRM_STUDENT_COUNT_FORMS))})`}</button>
    <div class="gp-note">النتيجة تُسجَّل لكل طالب وحده عند المراجعة. وغير المختارين يبقون في قائمة المقترحين أفرادًا إن كان ضعفهم مثبتًا.</div>`;
}

function gsGroupToggle(studentId){
  const d = gsGroupDraft;
  if(!d || d.saving) return;
  if(d.selected.has(studentId)) d.selected.delete(studentId); else d.selected.add(studentId);
  gsGroupPaint();
}

function gsGroupAll(){
  const d = gsGroupDraft;
  const f = d && gsFindGroup(d.key);
  if(!f || d.saving) return;
  f.g.members.forEach(m => d.selected.add(m.studentId));
  gsGroupPaint();
}

function gsGroupExtra(){
  if(!gsGroupDraft || gsGroupDraft.saving) return;
  gsGroupDraft.extra = true;
  gsGroupPaint();
}

async function gsGroupSave(){
  const d = gsGroupDraft;
  if(!d || d.saving) return;
  const f = gsFindGroup(d.key);
  if(!f) return;
  const ids = [...d.selected];
  if(ids.length < 2){ showToast('اختر طالبين على الأقل (أو افتح متابعة فردية)', 'error'); return; }
  d.saving = true;
  const btn = document.getElementById('gsGroupGo');
  if(btn) btn.disabled = true;
  const g = f.g;
  try{
    const groupId = newUuid();
    const focus = g.kind === 'homework' ? 'homework' : g.kind === 'participation' ? 'participation' : 'tahsili';
    const reviewDate = defaultReviewDate(localIsoDate());
    const rows = ids.map(sid => ({
      teacher_id: currentUser.id, student_id: sid, section_id: g.sectionId, group_id: groupId,
      reason_type: 'grades', reason_text: `دون الحد في «${g.name}»`.slice(0, 500), review_date: reviewDate,
      baseline: gsBaseline(f.r.g.columns, f.r.g.scores, sid, [g.itemId], focus)
    }));
    const { data: created, error } = await sb.from('classroom_followups').insert(rows).select('id');
    if(error) throw error;
    const { error: aErr } = await sb.from('classroom_followup_actions').insert((created || []).map(x => ({
      followup_id: x.id, teacher_id: currentUser.id, action_type: 'reteach', note: null, action_date: localIsoDate()
    })));
    gsGroupDraft = null;
    closeFollowupModal();
    showToast(aErr ? 'فُتحت المتابعة الجماعية، لكن تعذّر حفظ الإجراء' : `فُتحت متابعة جماعية لـ${arabicCountPhrase(ids.length, CRM_STUDENT_COUNT_FORMS)} ✓`, aErr ? 'error' : 'ok');
    gsInvalidate();
    await refreshAttentionViews();
    if(typeof crmActiveTab === 'function' && crmActiveTab() === 'followups') renderCrmFollowups();
  } catch(e){
    showToast('تعذّر فتح المتابعة الجماعية: ' + ((e && e.message) || ''), 'error');
    d.saving = false;
    if(btn) btn.disabled = false;
  }
}

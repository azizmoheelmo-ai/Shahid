/* ============================================================
   ملخص الشعبة (الإصدار الثاني — الدفعة 3)
   ------------------------------------------------------------
   كل عنصر يجيب عن سؤال ويقود لقرار، وما لم يجتز ذلك حُذف (المحطة هـ):
   - اتجاه الشعبة (الرسم الوحيد): من تحت النصف في كل عمود بالترتيب الزمني.
   - الفجوات: أعمدة فيها 30% فأكثر تحت النصف، مع "يقيس" ← ماذا أعيد تدريسه.
   - مقارنة الشعب: نفس العمود في شعب الصف نفسه ← مشكلة شعبة أم درس؟
   - الأكثر تحسّنًا (إيجابي فقط) · المتراجعون: عدد ورابط فقط.
   - أثر المتابعات · نمط الحضور (عند تركّز واضح فقط) · نمط المواقف بلا أسماء.
   ضوابط: الأعداد مع النسب دائمًا، و"الأعمدة تختلف في صعوبتها" ثابتة.
   ============================================================ */

const SUMMARY_RULES = {
  gapLowShare: 30,       /* فجوة: 30% فأكثر تحت النصف */
  improvePoints: 10,     /* تحسّن: آخر عمودين أعلى من معدله السابق بـ10 نقاط فأكثر */
  improveMinColumns: 4,
  patternMinLessons: 3,  /* نمط الحضور: 3 حصص على الأقل في الخانة... */
  patternMinAbsences: 10,/* ...و10 غيابات في الشعبة على الأقل... */
  patternRatio: 2        /* ...ومتوسطها ضعف بقية الحصص أو أكثر */
};

/* ============ دوال صرفة ============ */

function pctOf(sum, max){ return max ? Math.round(100 * sum / max) : null; }

function sectionGradeTrend(columns, scores, studentIds){
  const ids = new Set(studentIds || []);
  const out = [];
  (columns || []).forEach(c => {
    const rows = (scores || []).filter(g => g.column_id === c.id && ids.has(g.student_id));
    if(!rows.length) return;
    const low = rows.filter(g => 100 * Number(g.score) / Number(c.max_score) < ATTENTION_RULES.gradeLowPct).length;
    const first = rows.map(g => String(g.updated_at || '')).sort()[0];
    out.push({ id: c.id, name: c.name, measures: c.measures || null, category: c.category, recorded: rows.length, low, lowPct: Math.round(100 * low / rows.length), first });
  });
  return out.sort((a, b) => a.first.localeCompare(b.first));
}

function sectionGradeGaps(trend){
  return (trend || []).filter(t => t.low && t.lowPct >= SUMMARY_RULES.gapLowShare).sort((a, b) => b.lowPct - a.lowPct);
}

/* studentsBySection: { sectionId: [studentIds] } — شعب الصف نفسه */
function sectionComparison(baseSectionId, columns, scores, studentsBySection){
  const key = c => c.category + '|' + normalizeGradeHeader(c.name);
  const groups = new Map();
  (columns || []).forEach(c => {
    if(!studentsBySection[c.section_id]) return;
    if(!groups.has(key(c))) groups.set(key(c), []);
    groups.get(key(c)).push(c);
  });
  const rows = [];
  (columns || []).filter(c => c.section_id === baseSectionId).forEach(base => {
    const cols = groups.get(key(base)) || [];
    const sections = [];
    cols.forEach(c => {
      const ids = new Set(studentsBySection[c.section_id]);
      const rs = (scores || []).filter(g => g.column_id === c.id && ids.has(g.student_id));
      if(!rs.length) return;
      const max = Number(c.max_score);
      const low = rs.filter(g => 100 * Number(g.score) / max < ATTENTION_RULES.gradeLowPct).length;
      sections.push({ sectionId: c.section_id, recorded: rs.length,
        avgPct: pctOf(rs.reduce((s, g) => s + Number(g.score), 0), max * rs.length), lowPct: Math.round(100 * low / rs.length) });
    });
    if(sections.length < 2) return;
    sections.sort((a, b) => (a.sectionId === baseSectionId ? -1 : b.sectionId === baseSectionId ? 1 : 0));
    rows.push({ name: base.name, sections });
  });
  return rows;
}

function mostImprovedStudents(columns, scores, studentIds, limit){
  const ids = new Set(studentIds || []);
  const colById = new Map((columns || []).map(c => [c.id, c]));
  const by = new Map();
  (scores || []).forEach(g => {
    if(!ids.has(g.student_id) || !colById.has(g.column_id)) return;
    if(!by.has(g.student_id)) by.set(g.student_id, []);
    by.get(g.student_id).push(g);
  });
  const out = [];
  by.forEach((rows, id) => {
    if(rows.length < SUMMARY_RULES.improveMinColumns) return;
    const sorted = rows.slice().sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    const part = list => pctOf(list.reduce((s, g) => s + Number(g.score), 0), list.reduce((s, g) => s + Number(colById.get(g.column_id).max_score), 0));
    const before = part(sorted.slice(0, -2)), after = part(sorted.slice(-2));
    if(after - before >= SUMMARY_RULES.improvePoints) out.push({ id, before, after });
  });
  return out.sort((a, b) => (b.after - b.before) - (a.after - a.before)).slice(0, limit || 5);
}

function followupImpact(closedFollowups, firstActionById){
  const fus = closedFollowups || [];
  if(!fus.length) return null;
  const c = k => fus.filter(f => f.outcome === k).length;
  const n = fus.length;
  const text = `${arabicCountPhrase(n, { one: 'متابعة واحدة مغلقة', two: 'متابعتان مغلقتان', few: '{n} متابعات مغلقة', many: '{n} متابعة مغلقة' })}: ${c('improved')} تحسّن · ${c('partial')} جزئي · ${c('not_improved')} لم يتحسّن`;
  const byAction = new Map();
  fus.forEach(f => {
    const a = (firstActionById && firstActionById.get(f.id)) || 'other';
    const cur = byAction.get(a) || { action: a, total: 0, improved: 0 };
    cur.total++;
    if(f.outcome === 'improved') cur.improved++;
    byAction.set(a, cur);
  });
  return { text, byAction: [...byAction.values()].sort((x, y) => y.total - x.total) };
}

/* نمط الحضور: خانة (يوم + حصة) متوسط غيابها ضعف بقية الحصص أو أكثر */
function attendancePattern(lessons, attendance){
  const absentBy = new Map();
  (attendance || []).forEach(a => { if(a.status === 'absent') absentBy.set(a.lesson_id, (absentBy.get(a.lesson_id) || 0) + 1); });
  const total = [...absentBy.values()].reduce((s, n) => s + n, 0);
  if(total < SUMMARY_RULES.patternMinAbsences) return null;
  const slots = new Map();
  (lessons || []).forEach(l => {
    if(l.period == null) return;
    const k = weekdayOfIso(l.lesson_date) + '|' + l.period;
    const cur = slots.get(k) || { weekday: weekdayOfIso(l.lesson_date), period: l.period, lessons: 0, absent: 0 };
    cur.lessons++; cur.absent += absentBy.get(l.id) || 0;
    slots.set(k, cur);
  });
  let best = null;
  slots.forEach(sl => {
    if(sl.lessons < SUMMARY_RULES.patternMinLessons) return;
    const restLessons = (lessons || []).filter(l => l.period != null).length - sl.lessons;
    if(!restLessons) return;
    const avg = sl.absent / sl.lessons;
    const rest = (total - sl.absent) / restLessons;
    if(avg >= SUMMARY_RULES.patternRatio * Math.max(rest, 0.5) && (!best || avg > best.avg)) best = Object.assign({ avg, rest }, sl);
  });
  if(!best) return null;
  const r = n => String(Math.round(n * 10) / 10);
  return `غياب ${CRM_WEEKDAY_NAMES[best.weekday]} الحصة ${best.period} أعلى بوضوح: ${r(best.avg)} غائبين في المتوسط مقابل ${r(best.rest)} في بقية حصص الشعبة (من ${best.lessons} حصص مرصودة).`;
}

function incidentPattern(incidents, types){
  const by = new Map();
  (incidents || []).forEach(i => by.set(i.incident_type_id, (by.get(i.incident_type_id) || 0) + 1));
  let top = null;
  by.forEach((n, id) => { if(!top || n > top.count) top = { id, count: n }; });
  if(!top || top.count < 2) return null;
  const t = (types || []).find(x => x.id === top.id);
  return { name: t ? t.problem_name : 'مخالفة', count: top.count, total: (incidents || []).length };
}

/* ============ العرض ============ */
let crmSummaryToken = 0;

function crmGradesView(){
  let v = null;
  try{ v = localStorage.getItem('crm_grades_view'); } catch(e){}
  return v === 'summary' ? 'summary' : 'sheet';
}

function setCrmGradesView(v){
  try{ localStorage.setItem('crm_grades_view', v); } catch(e){}
  renderCrmGrades();
}

function crmGradesViewSwitchHtml(){
  const v = crmGradesView();
  return `<div class="crm-seg">
    <button class="${v === 'sheet' ? 'is-on' : ''}" onclick="setCrmGradesView('sheet')">الكشف</button>
    <button class="${v === 'summary' ? 'is-on' : ''}" onclick="setCrmGradesView('summary')">ملخص الشعبة</button>
  </div>`;
}

async function loadCrmSectionSummaryData(sectionId){
  const uid = currentUser.id;
  const { year, semester } = crmCurrentTerm();
  const sec = crmSectionById(sectionId);
  const sameGrade = crmSections.filter(s => sec && s.grade_level_id === sec.grade_level_id).map(s => s.id);
  const [colsRes, fuRes, lessonsRes, incRes] = await Promise.all([
    sb.from('classroom_grade_columns').select('id, section_id, category, name, max_score, measures')
      .eq('teacher_id', uid).eq('academic_year', year).eq('semester', semester).in('section_id', sameGrade),
    sb.from('classroom_followups').select('id, outcome').eq('teacher_id', uid).eq('section_id', sectionId).eq('status', 'closed'),
    sb.from('classroom_lessons').select('id, lesson_date, period').eq('teacher_id', uid).eq('section_id', sectionId),
    sb.from('classroom_incidents').select('incident_type_id').eq('teacher_id', uid).eq('section_id', sectionId)
  ]);
  const failed = [colsRes, fuRes, lessonsRes, incRes].find(r => r.error);
  if(failed) throw failed.error;
  const columns = colsRes.data || [];
  let scores = [];
  for(const ids of chunkArray(columns.map(c => c.id), 100)){
    const { data, error } = await sb.from('classroom_grade_scores').select('column_id, student_id, score, updated_at').eq('teacher_id', uid).in('column_id', ids);
    if(error) throw error;
    scores = scores.concat(data || []);
  }
  const fus = fuRes.data || [];
  const firstAction = new Map();
  for(const ids of chunkArray(fus.map(f => f.id), 100)){
    const { data, error } = await sb.from('classroom_followup_actions').select('followup_id, action_type, action_date, created_at')
      .eq('teacher_id', uid).in('followup_id', ids).order('created_at', { ascending: true });
    if(error) throw error;
    (data || []).forEach(a => { if(!firstAction.has(a.followup_id)) firstAction.set(a.followup_id, a.action_type); });
  }
  const lessons = lessonsRes.data || [];
  let attendance = [];
  for(const ids of chunkArray(lessons.map(l => l.id), 100)){
    const { data, error } = await sb.from('classroom_attendance').select('lesson_id, status').eq('teacher_id', uid).in('lesson_id', ids);
    if(error) throw error;
    attendance = attendance.concat(data || []);
  }
  return { sameGrade, columns, scores, fus, firstAction, lessons, attendance, incidents: incRes.data || [] };
}

async function renderCrmSectionSummary(sectionId, head){
  const box = document.getElementById('crmGradesBody');
  const token = ++crmSummaryToken;
  box.innerHTML = head + '<div class="loading-state">جارٍ التحميل...</div>';
  let d;
  try{ d = await loadCrmSectionSummaryData(sectionId); }
  catch(e){
    if(token !== crmSummaryToken) return;
    box.innerHTML = head + `<div class="empty-state">تعذّر تحميل الملخص. <button class="btn btn-outline crm-mini-btn" onclick="renderCrmGrades()">إعادة المحاولة</button></div>`;
    return;
  }
  if(token !== crmSummaryToken) return; /* تغيّرت الشعبة أو العرض أثناء التحميل */
  if(!crmIncidentTypes.length && typeof loadCrmIncidentTypes === 'function') await loadCrmIncidentTypes();
  if(token !== crmSummaryToken) return;
  box.innerHTML = head + crmSectionSummaryHtml(sectionId, d);
}

function crmSectionSummaryHtml(sectionId, d){
  const students = crmStudentsOfSection(sectionId);
  const ids = students.map(s => s.id);
  const nameOf = id => (students.find(s => s.id === id) || {}).full_name || '';
  const myCols = d.columns.filter(c => c.section_id === sectionId);
  const trend = sectionGradeTrend(myCols, d.scores, ids);
  let html = '';

  /* 1) اتجاه الشعبة — الرسم الوحيد */
  html += '<div class="crm-today-card"><div class="crm-today-title">اتجاه الشعبة: من تحت النصف في كل عمود</div>';
  if(!trend.length) html += '<div class="crm-today-empty">لا درجات مرصودة لهذه الشعبة في هذا الفصل بعد.</div>';
  else {
    html += trend.map(t => `<div class="crm-trend-row">
      <div class="crm-trend-label">${escapeHtml(t.name)}${t.measures ? ' <span class="crm-tl-meta">(' + escapeHtml(t.measures) + ')</span>' : ''}</div>
      <div class="crm-trend-bar"><span style="width:${t.lowPct}%;"></span></div>
      <div class="crm-trend-val">${t.low} من ${t.recorded} (${t.lowPct}%)</div>
    </div>`).join('');
    html += '<div style="font-size:10.5px;color:var(--muted);margin-top:6px;">الأعمدة تختلف في صعوبتها — قارن بالشعب الأخرى أدناه قبل الحكم على الطلاب.</div>';
  }
  html += '</div>';

  /* 2) الفجوات */
  const gaps = sectionGradeGaps(trend);
  if(gaps.length){
    html += `<div class="crm-today-card"><div class="crm-today-title">فجوات تستحق إعادة التدريس</div>
      ${gaps.map(g => `<div class="crm-lesson-row"><span>${escapeHtml(g.name)}${g.measures ? ' · يقيس: ' + escapeHtml(g.measures) : ' · <span class="crm-tl-meta">أضف "ماذا يقيس؟" للعمود ليظهر الموضوع هنا</span>'}</span>
        <span class="crm-tl-meta">${g.low} من ${g.recorded} (${g.lowPct}%)</span></div>`).join('')}</div>`;
  }

  /* 3) مقارنة الشعب */
  const bySection = {};
  d.sameGrade.forEach(id => { bySection[id] = crmStudentsOfSection(id).map(s => s.id); });
  const cmp = sectionComparison(sectionId, d.columns, d.scores, bySection);
  if(cmp.length){
    html += `<div class="crm-today-card"><div class="crm-today-title">نفس العمود في شعب الصف</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">إذا انخفضت كل الشعب في عمود، فالعمود أصعب — لا الطلاب أضعف.</div>
      ${cmp.map(r => `<div class="crm-cmp-row"><b>${escapeHtml(r.name)}</b>
        ${r.sections.map(s => `<span class="crm-cmp-cell${s.sectionId === sectionId ? ' is-me' : ''}">${escapeHtml(crmSectionLabel(s.sectionId))}: متوسط ${s.avgPct}% · تحت النصف ${s.lowPct}%</span>`).join('')}
      </div>`).join('')}</div>`;
  }

  /* 4) الأكثر تحسّنًا + المتراجعون (عدد ورابط فقط) */
  const improved = mostImprovedStudents(myCols, d.scores, ids, 5);
  const decliners = (crmAttentionCache && crmAttentionCache.cards || []).filter(c => c.studentId && ids.includes(c.studentId) && c.reasons.some(r => r.rule === 'grades_decline')).length;
  if(improved.length || decliners){
    html += '<div class="crm-today-card"><div class="crm-today-title">التحسّن</div>';
    if(improved.length){
      html += '<div style="font-size:12px;margin-bottom:4px;">الأكثر تحسّنًا (يستحقون التعزيز):</div>' +
        improved.map(x => `<div class="crm-lesson-row"><a href="#" onclick="event.preventDefault();openCrmStudentProfile('${x.id}', { type: 'tab', tab: 'grades' })">${escapeHtml(nameOf(x.id))}</a>
          <span class="crm-tl-meta">${x.before}% ← ${x.after}%</span></div>`).join('');
    }
    if(decliners){
      html += `<div style="font-size:12px;margin-top:6px;">${arabicCountPhrase(decliners, CRM_STUDENT_COUNT_FORMS)} في تراجع ← <a href="#" onclick="event.preventDefault();switchCrmTab('followups')">يحتاج انتباهي</a></div>`;
    }
    html += '</div>';
  }

  /* 5) أثر المتابعات */
  const impact = followupImpact(d.fus, d.firstAction);
  html += '<div class="crm-today-card"><div class="crm-today-title">أثر متابعاتي في هذه الشعبة</div>';
  if(!impact) html += '<div class="crm-today-empty">لا متابعات مغلقة بعد.</div>';
  else {
    html += `<div style="font-size:12.5px;margin-bottom:6px;">${escapeHtml(impact.text)}</div>` +
      impact.byAction.map(a => `<div class="crm-lesson-row"><span>${escapeHtml(FOLLOWUP_ACTIONS[a.action] || 'أخرى')}</span>
        <span class="crm-tl-meta">${a.improved} من ${a.total} تحسّن (${Math.round(100 * a.improved / a.total)}%)</span></div>`).join('') +
      '<div style="font-size:10.5px;color:var(--muted);margin-top:4px;">تغيّر بعد التدخل — لا يثبت أنه سببه.</div>';
  }
  html += '</div>';

  /* 6) نمطا الحضور والمواقف — يظهران فقط عند وجودهما */
  const att = attendancePattern(d.lessons, d.attendance);
  const inc = incidentPattern(d.incidents, crmIncidentTypes);
  if(att || inc){
    html += '<div class="crm-today-card"><div class="crm-today-title">أنماط</div>';
    if(att) html += `<div style="font-size:12.5px;line-height:1.8;margin-bottom:4px;">📅 ${escapeHtml(att)}</div>`;
    if(inc) html += `<div style="font-size:12.5px;line-height:1.8;">⚠ أكثر مخالفة تكرارًا: ${escapeHtml(inc.name)} — ${inc.count} من ${inc.total} (${Math.round(100 * inc.count / inc.total)}%)</div>`;
    html += '</div>';
  }
  return html;
}

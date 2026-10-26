/* ============================================================
   تحليل الدرجات — النسخة الثانية (يُكمل app-29 داخل النافذة نفسها)
   ------------------------------------------------------------
   - التقدير بالحرف: توزيع «بالنسبة | بالتقدير»، والجدول يعدّله المعلم (features.gradeLetters).
   - «أين الصعوبة؟»: متوسط كل عمود، وأصعب اختبار مع ما يقيسه (measures).
   - مقارنة شعب الصف: نفس العمود (بالاسم) أو المجموع، ومتوسط نسبة كل شعبة.
   - مقارنة بالفصل السابق لنفس الشعبة: تحسّن/تراجع بنقاط مئوية.
   - المقارنات تُحمَّل عند الفتح فقط (استعلامات مفلترة بـ teacher_id)، وتُهمَل نتيجتها
     إن أُغلقت النافذة أو فُتحت نافذة أخرى قبل وصولها.
   ============================================================ */

const GRADE_COMPARE_RULES = {
  changePct: 10,      /* تحسّن/تراجع: 10 نقاط مئوية فأكثر */
  hardLowShare: 30    /* أصعب عمود: 30% فأكثر من الطلاب تحت النصف */
};
const GRADE_LETTERS_DEFAULT = [['أ+', 95], ['أ', 90], ['ب+', 85], ['ب', 80], ['ج+', 75], ['ج', 70], ['د+', 65], ['د', 50], ['هـ', 0]]
  .map(([label, min]) => ({ label, min }));

/* ============ دوال صرفة: التقديرات ============ */

/* خطأ نصي أو null — الحدود تنازلية بلا تكرار وآخرها 0 */
function validateGradeLetters(list){
  if(!Array.isArray(list) || list.length < 2 || list.length > 12) return 'عدد التقديرات من 2 إلى 12';
  const seen = new Set();
  for(let i = 0; i < list.length; i++){
    const label = String(list[i] && list[i].label || '').trim();
    const min = Number(list[i] && list[i].min);
    if(!label || label.length > 12) return 'اكتب اسم كل تقدير (12 حرفًا كحد أقصى)';
    if(seen.has(label)) return 'اسم مكرر: ' + label;
    seen.add(label);
    if(!Number.isFinite(min) || min < 0 || min > 100) return 'الحد الأدنى بين 0 و100';
    if(i && min >= Number(list[i - 1].min)) return 'رتّب الحدود من الأعلى إلى الأدنى بلا تكرار';
  }
  if(Number(list[list.length - 1].min) !== 0) return 'آخر تقدير يبدأ من 0';
  return null;
}

/* ما يُقرأ من القاعدة لا يُوثق بشكله */
function normalizeGradeLetters(raw){
  if(!Array.isArray(raw)) return null;
  const list = raw.map(x => ({ label: String(x && x.label || '').trim(), min: Number(x && x.min) }));
  return validateGradeLetters(list) ? null : list;
}

function gradeLettersNow(){
  return (typeof appFeatures !== 'undefined' && appFeatures && appFeatures.gradeLetters) || GRADE_LETTERS_DEFAULT;
}

function gradeLetterIndex(pct, letters){
  const i = letters.findIndex(l => pct + 1e-9 >= l.min);
  return i < 0 ? letters.length - 1 : i;
}

/* عدد الطلاب لكل تقدير (بترتيب الجدول: الأعلى أولًا)؛ من لم يُرصد له لا يُعدّ */
function gradeLetterCounts(rows, letters){
  const counts = letters.map(() => 0);
  rows.filter(r => r.pct !== null).forEach(r => { counts[gradeLetterIndex(r.pct, letters)]++; });
  return counts;
}

/* ============ دوال صرفة: المقارنات ============ */

/* لكل عمود مرصود: متوسط نسبته وعدد من تحت النصف */
function gradeColumnDifficulty(columns, scores, studentIds){
  const ids = new Set(studentIds || []);
  const pass = gradeAnalysisPassPct();
  return (columns || []).map(c => {
    const rows = (scores || []).filter(s => s.column_id === c.id && ids.has(s.student_id));
    if(!rows.length) return null;
    const pcts = rows.map(s => 100 * Number(s.score) / Number(c.max_score));
    return { id: c.id, name: c.name, category: c.category, measures: c.measures || null, recorded: rows.length,
      avgPct: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length), low: pcts.filter(p => p < pass).length };
  }).filter(Boolean);
}

/* أصعب اختبار فقط (الواجبات والمهام تقيس الالتزام لا صعوبة الدرس) — ويُعدّ صعبًا إن كان 30% فأكثر تحت النصف */
function hardestGradeColumn(list){
  const tests = (list || []).filter(x => x.category === 'tests');
  if(!tests.length) return null;
  const h = tests.reduce((m, x) => x.avgPct < m.avgPct ? x : m);
  return 100 * h.low / h.recorded >= GRADE_COMPARE_RULES.hardLowShare ? h : null;
}

/* خريطة طالب ← نسبته، للمجموع أو لعمود بالاسم؛ null إن لم يوجد العمود في هذا الكشف */
function gradePctMap(sheet, students, spec, caps, testsOn){
  let key = 'total';
  if(!spec.total){
    const col = (sheet.columns || []).find(c => normalizeGradeColumnName(c.name) === spec.name);
    if(!col) return null;
    key = col.id;
  }
  const { rows } = gradeAnalysisRows(sheet, students, key, caps, testsOn);
  return new Map(rows.filter(r => r.pct !== null).map(r => [r.id, r.pct]));
}

function gradeMeanPct(map){
  if(!map || !map.size) return null;
  let sum = 0;
  map.forEach(v => { sum += v; });
  return Math.round(sum / map.size);
}

/* تغيّر كل طالب له نسبة في الفصلين، والمعتبر 10 نقاط مئوية فأكثر */
function gradeChangeSummary(nowMap, prevMap){
  const thr = GRADE_COMPARE_RULES.changePct;
  const rows = [];
  nowMap.forEach((now, id) => { if(prevMap.has(id)) rows.push({ id, now, prev: prevMap.get(id), delta: Math.round(now - prevMap.get(id)) }); });
  return {
    compared: rows.length,
    up: rows.filter(r => r.delta >= thr).sort((a, b) => b.delta - a.delta),
    down: rows.filter(r => r.delta <= -thr).sort((a, b) => a.delta - b.delta),
    avgDelta: rows.length ? Math.round(rows.reduce((a, r) => a + r.delta, 0) / rows.length) : null
  };
}

function gradeSpecOf(a){
  if(a.key === 'total') return { total: true };
  const col = a.g.columns.find(c => c.id === a.key);
  return col ? { name: normalizeGradeColumnName(col.name) } : { total: true };
}

/* ============ التحميل (كشوف شعب/فصل أخرى) ============ */
async function loadGradeSheetsRaw(sectionIds, year, semester){
  const uid = currentUser.id;
  const { data: cols, error } = await sb.from('classroom_grade_columns').select('id, section_id, category, name, max_score, measures, kind, tool_id, position')
    .eq('teacher_id', uid).eq('academic_year', year).eq('semester', semester).in('section_id', sectionIds);
  if(error) throw error;
  const visible = (cols || []).filter(gradeColumnVisible);
  let scores = [];
  for(const ids of chunkArray(visible.map(c => c.id), 100)){
    const { data, error: sErr } = await sb.from('classroom_grade_scores').select('column_id, student_id, score').eq('teacher_id', uid).in('column_id', ids);
    if(sErr) throw sErr;
    scores = scores.concat(data || []);
  }
  return sectionIds.map(id => {
    const columns = sortGradeColumns(visible.filter(c => c.section_id === id));
    const set = new Set(columns.map(c => c.id));
    return { id, columns, scores: scores.filter(s => set.has(s.column_id)) };
  });
}

function gradeSiblingSectionIds(g){
  const cur = crmSectionById(g.sectionId);
  if(!cur || !cur.grade_level_id) return [];
  return crmSections.filter(s => s.grade_level_id === cur.grade_level_id && s.id !== cur.id).map(s => s.id);
}

/* يحمّل مرة واحدة لكل فتح نافذة، ويُهمل الجواب إن تغيّرت النافذة (a لم تعد الحالية) */
async function loadGradeCompare(a, kind){
  if(a[kind] && a[kind].status !== 'error') return;
  a[kind] = { status: 'loading' };
  paintCrmGradeAnalysis();
  try{
    let data;
    if(kind === 'sib'){
      const ids = gradeSiblingSectionIds(a.g);
      data = ids.length ? (await loadGradeSheetsRaw(ids, a.g.year, a.g.semester)).filter(d => hasBaseGradeColumns(d.columns)) : [];
    } else {
      const term = previousGradeTerm(a.g.year, a.g.semester);
      const res = term ? (await loadGradeSheetsRaw([a.g.sectionId], term.year, term.semester))[0] : null;
      data = res && hasBaseGradeColumns(res.columns) ? res : null;
    }
    if(crmGradeAnalysis !== a) return;
    a[kind] = { status: 'ready', data };
  } catch(err){
    if(crmGradeAnalysis !== a) return;
    a[kind] = { status: 'error' };
  }
  paintCrmGradeAnalysis();
}

/* ============ الواجهة ============ */
const GRADE_COMPARE_ITEMS = [
  { key: 'diff', label: 'أين الصعوبة؟', sub: 'متوسط كل عمود' },
  { key: 'sib', label: 'مقارنة بشعب الصف', sub: 'هل الضعف في الشعبة أم الدرس؟' },
  { key: 'prev', label: 'مقارنة بالفصل السابق', sub: 'من تحسّن ومن تراجع' }
];

function toggleCrmGaCompare(key){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.cmp = a.cmp === key ? null : key;
  if(a.cmp === 'sib' || a.cmp === 'prev') loadGradeCompare(a, a.cmp);
  else paintCrmGradeAnalysis();
}

function toggleCrmGaPrevGroup(key){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.prevOpen = a.prevOpen === key ? null : key;
  paintCrmGradeAnalysis();
}

function setCrmGaMode(mode){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.mode = mode === 'letters' ? 'letters' : 'bands';
  paintCrmGradeAnalysis();
}

function gaHist(counts, labels, toneOf, big){
  const max = Math.max.apply(null, counts.concat(1));
  return `<div class="crm-ga-hist${big ? ' is-big' : ''}">${counts.map((n, i) => `<div class="crm-ga-col"><span>${n || ''}</span><i class="gs-bg-${toneOf(i)}" style="height:${n ? Math.max(4, Math.round(100 * n / max)) : 0}%"></i><small>${escapeHtml(labels[i])}</small></div>`).join('')}</div>`;
}

/* توزيع الطلاب: بالنسبة أو بالتقدير (الأدنى يمينًا في الحالتين) */
function gaDistHtml(a, v){
  const seg = (mode, label) => `<button type="button" class="${a.mode === mode ? 'is-on' : ''}" aria-pressed="${a.mode === mode}" onclick="setCrmGaMode('${mode}')">${label}</button>`;
  let html = `<div class="crm-ga-sechead"><span class="crm-ga-sec">${a.mode === 'letters' ? 'توزيع الطلاب' : 'توزيع الطلاب حسب النسبة المئوية'}</span><span class="crm-ga-tog">${seg('bands', 'بالنسبة')}${seg('letters', 'بالتقدير')}</span></div>`;
  if(a.mode === 'letters'){
    const letters = gradeLettersNow();
    const counts = gradeLetterCounts(v.rows, letters);
    html += gaHist(counts, letters.map(l => l.label), i => i === letters.length - 1 ? 'lo' : i === 0 ? 'hi' : 'mid', true);
    html += '<div class="crm-ga-lnote"><button type="button" class="crm-ga-link" onclick="openCrmGaLettersEditor()">تعديل التقديرات والحدود</button></div>';
    return html;
  }
  return html + `<div class="crm-ga-fine" style="margin:0 0 6px">النسبة = درجة الطالب ÷ الدرجة الكاملة (${formatScore(v.displayMax)}) × 100</div>` + gaHist(v.stats.bands, GRADE_ANALYSIS_BANDS, i => i === 0 ? 'lo' : i === 5 ? 'hi' : 'mid');
}

function gaCmpBar(label, pct, sub, tone, mark){
  return `<div class="crm-ga-bar"><span class="crm-ga-bl">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="crm-ga-bt"><i class="gs-bg-${tone}" style="width:${pct === null ? 0 : Math.max(2, pct)}%"></i></span><b>${pct === null ? '—' : pct + '%'}${mark || ''}</b></div>`;
}

function gaCompareHtml(a, v){
  let html = '<div class="crm-ga-sec">مقارنات</div>';
  const sibIds = gradeSiblingSectionIds(a.g);
  GRADE_COMPARE_ITEMS.forEach(it => {
    const off = it.key === 'sib' && !sibIds.length;
    const on = a.cmp === it.key && !off;
    html += `<div class="crm-ga-grp${on ? ' open' : ''}"><button type="button" class="crm-ga-ghead" aria-expanded="${on}" ${off ? 'disabled' : ''} onclick="toggleCrmGaCompare('${it.key}')"><span>${it.label}<small>${off ? 'لا شعب أخرى لهذا الصف' : it.sub}</small></span><span class="crm-am-chev" aria-hidden="true">⌄</span></button>`;
    if(on) html += '<div class="crm-ga-cmp">' + (it.key === 'diff' ? gaDiffHtml(a) : it.key === 'sib' ? gaSibHtml(a) : gaPrevHtml(a)) + '</div>';
    html += '</div>';
  });
  return html;
}

function gaDiffHtml(a){
  const list = gradeColumnDifficulty(a.g.columns, a.g.scores, a.students.map(s => s.id));
  if(!list.length) return '<div class="crm-ga-empty">لا درجات مرصودة بعد.</div>';
  const hard = hardestGradeColumn(list);
  const tone = p => p < gradeAnalysisPassPct() ? 'lo' : p < 70 ? 'mid' : 'hi';
  let html = list.map(x => gaCmpBar(escapeHtml(x.name), x.avgPct, '', tone(x.avgPct), hard && hard.id === x.id ? ' ⚠' : '')).join('');
  html += hard
    ? `<div class="crm-ga-card"><b>أصعب اختبار: ${escapeHtml(hard.name)}</b><br>${hard.low} من ${hard.recorded} ${gradeAnalysisLowLabel()} (${Math.round(100 * hard.low / hard.recorded)}%).${hard.measures ? `<br>يقيس: ${escapeHtml(hard.measures)}<br><small>← فكّر في إعادة شرحه قبل الانتقال.</small>` : ''}</div>`
    : list.some(x => x.category === 'tests') ? '<div class="crm-ga-card">لا اختبار تحته 30% من الطلاب دون النصف ✓</div>' : '';
  return html + '<p class="crm-ga-fine">الأعمدة تختلف في صعوبتها أصلًا، فلا تُقارن عمودًا بآخر حكمًا على الطلاب.</p>';
}

function gaSibHtml(a){
  const st = a.sib;
  if(!st || st.status === 'loading') return '<div class="crm-ga-empty">جارٍ التحميل...</div>';
  if(st.status === 'error') return '<div class="crm-ga-empty">تعذّر التحميل. <button type="button" class="crm-ga-link" onclick="loadGradeCompare(crmGradeAnalysis, \'sib\')">إعادة المحاولة</button></div>';
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const testsOn = appToolOn('tests');
  const spec = gradeSpecOf(a);
  const items = [{ id: a.g.sectionId, mine: true, map: gradePctMap(a.g, a.students, spec, caps, testsOn) }].concat(
    st.data.map(d => ({ id: d.id, mine: false, map: gradePctMap(d, crmStudentsOfSection(d.id), spec, caps, testsOn) })));
  const rated = items.filter(x => x.map && x.map.size).map(x => Object.assign(x, { mean: gradeMeanPct(x.map) })).sort((p, q) => q.mean - p.mean);
  if(rated.length < 2) return '<div class="crm-ga-empty">لا درجات مرصودة لهذا العمود في شعبة أخرى بعد.</div>';
  const tone = p => p < gradeAnalysisPassPct() ? 'lo' : p < 70 ? 'mid' : 'hi';
  let html = rated.map(x => gaCmpBar(escapeHtml(crmSectionLabel(x.id)) + (x.mine ? ' ★' : ''), x.mean, `${x.map.size} طالبًا`, tone(x.mean))).join('');
  const gap = rated[0].mean - rated[rated.length - 1].mean;
  html += `<div class="crm-ga-card">الفارق بين أعلى شعبة وأدنى شعبة: <b>${gap}</b> نقطة مئوية.${a.key === 'total' ? '<br><small>اختر عمودًا من الأعلى لتعرف هل الفرق في درس بعينه.</small>' : ''}</div>`;
  const missing = items.length - rated.length;
  return html + (missing ? `<p class="crm-ga-fine">${missing} شعبة بلا رصد لهذا العمود لم تدخل المقارنة.</p>` : '') + '<p class="crm-ga-fine">★ شعبتك. المقارنة بين شعبك أنت فقط.</p>';
}

function gaPrevHtml(a){
  const st = a.prev;
  if(!st || st.status === 'loading') return '<div class="crm-ga-empty">جارٍ التحميل...</div>';
  if(st.status === 'error') return '<div class="crm-ga-empty">تعذّر التحميل. <button type="button" class="crm-ga-link" onclick="loadGradeCompare(crmGradeAnalysis, \'prev\')">إعادة المحاولة</button></div>';
  if(!st.data) return '<div class="crm-ga-empty">لا كشف لهذه الشعبة في الفصل السابق.</div>';
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const testsOn = appToolOn('tests');
  const spec = gradeSpecOf(a);
  const prevMap = gradePctMap(st.data, a.students, spec, caps, testsOn);
  if(!prevMap || !prevMap.size) return `<div class="crm-ga-empty">${spec.total ? 'لا درجات مرصودة في الفصل السابق.' : 'لا عمود بنفس الاسم في الفصل السابق — اختر «المجموع».'}</div>`;
  const nowMap = gradePctMap(a.g, a.students, spec, caps, testsOn);
  const sum = gradeChangeSummary(nowMap, prevMap);
  if(!sum.compared) return '<div class="crm-ga-empty">لا طلاب لهم درجات في الفصلين معًا.</div>';
  const names = new Map(a.students.map(s => [s.id, s.full_name]));
  const tile = (n, label, tone) => `<div class="crm-ga-tile${tone ? ' gs-tone-' + tone : ''}"><b>${n}</b><span>${label}</span></div>`;
  let html = `<div class="crm-ga-tiles">${tile(sum.up.length, 'تحسّنوا', 'hi')}${tile(sum.compared - sum.up.length - sum.down.length, 'مستقرون')}${tile(sum.down.length, 'تراجعوا', sum.down.length ? 'lo' : '')}</div>`;
  [['down', 'تراجعوا', 'lo'], ['up', 'تحسّنوا', 'hi']].forEach(([k, label, t]) => {
    const list = sum[k];
    const on = a.prevOpen === k && list.length;
    html += `<div class="crm-ga-grp gs-grp-${t}${on ? ' open' : ''}"><button type="button" class="crm-ga-ghead" ${list.length ? '' : 'disabled'} aria-expanded="${!!on}" onclick="toggleCrmGaPrevGroup('${k}')"><span>${label}</span><b>${list.length}</b><span class="crm-am-chev" aria-hidden="true">⌄</span></button>`;
    if(on) html += '<div class="crm-ga-names">' + list.map(r => `<button type="button" class="crm-ga-name" onclick="openCrmGradeAnalysisStudent('${escapeHtml(r.id)}')"><span>${escapeHtml(names.get(r.id) || '')}<small>من <bdi dir="ltr">${Math.round(r.prev)}%</bdi> إلى <bdi dir="ltr">${Math.round(r.now)}%</bdi></small></span><b class="gs-tone-${t}"><bdi dir="ltr">${r.delta > 0 ? '+' : ''}${r.delta}</bdi></b></button>`).join('') + '</div>';
    html += '</div>';
  });
  return html + `<p class="crm-ga-fine">قارنّا ${sum.compared} طالبًا؛ متوسط التغيّر <bdi dir="ltr">${sum.avgDelta > 0 ? '+' : ''}${sum.avgDelta}</bdi> نقطة مئوية. التغيّر المعتبر ${GRADE_COMPARE_RULES.changePct} نقاط فأكثر، والنسبة مما رُصد في كل فصل.</p>`;
}

/* ============ تعديل التقديرات ============ */
function openCrmGaLettersEditor(){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.editing = { list: gradeLettersNow().map(l => ({ label: l.label, min: l.min })), error: '', saving: false };
  paintCrmGradeAnalysis();
}

function gaLettersEditorHtml(a){
  const e = a.editing;
  const rows = e.list.map((l, i) => `<div class="crm-ga-erow">
    <input type="text" maxlength="12" aria-label="اسم التقدير" value="${escapeHtml(l.label)}" oninput="crmGaLetterEdit(${i}, 'label', this.value)">
    <span>من</span><input type="number" inputmode="decimal" min="0" max="100" step="any" aria-label="أقل نسبة" value="${escapeHtml(String(l.min))}" oninput="crmGaLetterEdit(${i}, 'min', this.value)"><span>%</span>
    <button type="button" class="crm-ga-x" aria-label="حذف" onclick="crmGaLetterRemove(${i})">✕</button></div>`).join('');
  return `<div class="crm-ga-sec">تعديل التقديرات</div>
    <p class="crm-ga-fine" style="margin-top:0">اكتب اسم كل تقدير وأقل نسبة له، من الأعلى للأدنى. آخر تقدير يبدأ من 0.</p>${rows}
    <button type="button" class="crm-ga-link" onclick="crmGaLetterAdd()">＋ تقدير</button>
    <div class="crm-ga-err" id="crmGaEditErr">${escapeHtml(e.error)}</div>
    <button type="button" class="btn btn-primary" id="crmGaLettersSave" ${e.saving ? 'disabled' : ''} onclick="saveCrmGaLetters()">حفظ</button>
    <div class="crm-ga-eacts"><button type="button" class="crm-ga-link" onclick="crmGaLettersReset()">الافتراضي</button><button type="button" class="crm-ga-link" onclick="crmGaLettersCancel()">إلغاء</button></div>`;
}

function crmGaLetterEdit(i, field, value){
  const e = crmGradeAnalysis && crmGradeAnalysis.editing;
  if(e && e.list[i]) e.list[i][field] = value;
}
function crmGaLetterRemove(i){
  const e = crmGradeAnalysis && crmGradeAnalysis.editing;
  if(!e || e.list.length <= 2) return;
  e.list.splice(i, 1);
  paintCrmGradeAnalysis();
}
function crmGaLetterAdd(){
  const e = crmGradeAnalysis && crmGradeAnalysis.editing;
  if(!e || e.list.length >= 12) return;
  e.list.splice(e.list.length - 1, 0, { label: '', min: '' });
  paintCrmGradeAnalysis();
}
function crmGaLettersReset(){
  const a = crmGradeAnalysis;
  if(!a || !a.editing) return;
  a.editing.list = GRADE_LETTERS_DEFAULT.map(l => ({ label: l.label, min: l.min }));
  a.editing.error = '';
  paintCrmGradeAnalysis();
}
function crmGaLettersCancel(){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.editing = null;
  paintCrmGradeAnalysis();
}

async function persistGradeLetters(list){
  const uid = currentUser.id;
  const same = JSON.stringify(list);
  const next = normalizeFeatures(appFeatures);
  /* الافتراضي لا يُخزَّن: غياب المفتاح = الافتراضي */
  if(same === JSON.stringify(GRADE_LETTERS_DEFAULT)) delete next.gradeLetters; else next.gradeLetters = list;
  appFeatures = next;
  await saveAppFeatures();
  if(!currentUser || currentUser.id !== uid) return 'تغيّر الحساب';
  const saved = appFeaturesSaved.gradeLetters;
  return (saved ? JSON.stringify(saved) : JSON.stringify(GRADE_LETTERS_DEFAULT)) === same ? null : 'تعذّر حفظ التقديرات';
}

async function saveCrmGaLetters(){
  const a = crmGradeAnalysis;
  const e = a && a.editing;
  if(!e || e.saving) return;
  const list = e.list.map(l => ({ label: String(l.label || '').trim(), min: Number(l.min) }));
  const bad = validateGradeLetters(list.map((l, i) => e.list[i].min === '' ? { label: l.label, min: NaN } : l));
  if(bad){ e.error = bad; paintCrmGradeAnalysis(); return; }
  e.saving = true;
  const btn = document.getElementById('crmGaLettersSave');
  if(btn) btn.disabled = true;
  const err = await persistGradeLetters(list);
  if(crmGradeAnalysis !== a) return;
  e.saving = false;
  if(err){ e.error = err; paintCrmGradeAnalysis(); return; }
  a.editing = null;
  a.mode = 'letters';
  paintCrmGradeAnalysis();
  showToast('حُفظت التقديرات', 'ok');
}

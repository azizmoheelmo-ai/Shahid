/* ============================================================
   ربط الاختبارات و«ماذا يقيس؟» — لتقدّم الطالب بين اختبارات قابلة للمقارنة (REPORTS.md §4.0.1، ق4، م2)
   ------------------------------------------------------------
   - اختباران قابلان للمقارنة إذا ربطهما المعلم، أو تطابق «يقيس» فيهما (أو الأمران).
   - الربط بالاسم (عُرف التطبيق بين الشعب) في user_app_settings.features.testLinks:
     { "سنة|فصل": [[أسماء مطبَّعة]] } — يربط المعلم مرة واحدة لكل شعبه، وبلا تعديل في قاعدة البيانات.
   - حدود الحجم من قيد القاعدة (features أقل من 4000 بايت مشترك): 3 مجموعات × 5 أسماء × 30 حرفًا.
   - إعادة تسمية اختبار تمسّ عمود الشعبة الحالية فقط: يُضاف الاسم الجديد لمجموعة القديم (والقديم يبقى لشعب أخرى).
   - الواجهة موجَّهة بخيار واحد اختياري (م8): «قارنه مع» + أزرار «يقيس» السريعة بحسب مادة المعلم.
   ============================================================ */

const TL_MAX_GROUPS = 3;
const TL_MAX_NAMES = 5;
const TL_NAME_MAX = 30;

/* ============ دوال صرفة ============ */

const tlNorm = n => (typeof normalizeGradeColumnName === 'function' ? normalizeGradeColumnName(n) : String(n || '').trim());
const tlKey = term => `${term.year}|${term.semester}`;

/* ما يُقرأ من القاعدة لا يُوثق بشكله: { "سنة|فصل": [[أسماء]] } أو null */
function normalizeTestLinks(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  Object.keys(raw).forEach(k => {
    if(!/^[0-9٠-٩\-\/ ]{1,20}\|[12]$/.test(k)) return;
    const groups = tlCleanGroups(raw[k]);
    if(groups.length) out[k] = groups;
  });
  return Object.keys(out).length ? out : null;
}

function tlCleanGroups(v){
  if(!Array.isArray(v)) return [];
  const groups = [];
  const seen = new Set();
  v.forEach(g => {
    if(!Array.isArray(g) || groups.length >= TL_MAX_GROUPS) return;
    const names = [];
    g.forEach(n => {
      const t = tlNorm(n);
      if(typeof n === 'string' && t && t.length <= TL_NAME_MAX && !names.includes(t) && !seen.has(t) && names.length < TL_MAX_NAMES) names.push(t);
    });
    if(names.length >= 2){ names.forEach(n => seen.add(n)); groups.push(names); }
  });
  return groups;
}

function tlGroupsOf(features, term){
  const t = features && features.testLinks && features.testLinks[tlKey(term)];
  return tlCleanGroups(t);
}

function tlGroupIndex(groups, name){
  const n = tlNorm(name);
  return (groups || []).findIndex(g => g.includes(n));
}

/* يربط اختبارين: { groups, error }. اسم أطول من 30 حرفًا أو تجاوز الحدود = خطأ نصي */
function tlLink(groups, a, b){
  const na = tlNorm(a), nb = tlNorm(b);
  const cur = (groups || []).map(g => g.slice());
  if(!na || !nb || na === nb) return { groups: cur, error: 'اختر اختبارًا آخر' };
  if(na.length > TL_NAME_MAX || nb.length > TL_NAME_MAX) return { groups: cur, error: `اسم الاختبار أطول من ${TL_NAME_MAX} حرفًا — اختصره ليُربط` };
  const ia = cur.findIndex(g => g.includes(na)), ib = cur.findIndex(g => g.includes(nb));
  let next;
  if(ia >= 0 && ia === ib) return { groups: cur, error: null };
  if(ia >= 0 && ib >= 0){ const m = cur[ia].concat(cur[ib]); next = cur.filter((g, i) => i !== ia && i !== ib).concat([m]); }
  else if(ia >= 0){ cur[ia].push(nb); next = cur; }
  else if(ib >= 0){ cur[ib].push(na); next = cur; }
  else next = cur.concat([[na, nb]]);
  if(next.length > TL_MAX_GROUPS || next.some(g => g.length > TL_MAX_NAMES)) return { groups: (groups || []).map(g => g.slice()), error: `الحدّ الأقصى ${TL_MAX_GROUPS} مجموعات مقارنة، وفي كل مجموعة ${TL_MAX_NAMES} اختبارات` };
  return { groups: next, error: null };
}

/* يفكّ ربط اسم (وتُحذف المجموعة إن بقي فيها أقل من اثنين) */
function tlUnlink(groups, name){
  const n = tlNorm(name);
  return (groups || []).map(g => g.filter(x => x !== n)).filter(g => g.length >= 2);
}

/* إعادة تسمية: يُضاف الجديد لمجموعة القديم ويبقى القديم (قد تحمله شعب أخرى) */
function tlRename(groups, oldName, newName){
  const o = tlNorm(oldName), n = tlNorm(newName);
  if(!o || !n || o === n || n.length > TL_NAME_MAX) return { groups: (groups || []).map(g => g.slice()), changed: false };
  const cur = (groups || []).map(g => g.slice());
  const i = cur.findIndex(g => g.includes(o));
  if(i < 0 || cur.some(g => g.includes(n)) || cur[i].length >= TL_MAX_NAMES) return { groups: cur, changed: false };
  cur[i].push(n);
  return { groups: cur, changed: true };
}

/* شريك الاسم في مجموعته ممن في الشعبة الحالية (لقيمة القائمة عند التعديل) */
function tlPartnerOf(groups, name, presentNames){
  const n = tlNorm(name);
  const g = (groups || []).find(x => x.includes(n));
  if(!g) return '';
  const here = new Set((presentNames || []).map(tlNorm));
  return g.find(x => x !== n && here.has(x)) || '';
}

/* فئات المقارنة بين اختبارات: tests = [{ id, name, measures, ... }] بترتيب الكشف.
   الضم المتعدّي بالربط وبتطابق «يقيس» (غير الفارغ). الناتج: [{ members, reason: 'link'|'measures', label }] لما فيه عضوان فأكثر */
function tlComparableClasses(tests, groups){
  const list = tests || [];
  const parent = list.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const reasons = new Map();
  const union = (i, j, why) => {
    const a = find(i), b = find(j);
    if(a !== b) parent[b] = a;
    const r = find(i);
    reasons.set(r, (reasons.get(r) === 'link' || why === 'link') ? 'link' : 'measures');
  };
  const byName = new Map(list.map((t, i) => [tlNorm(t.name), i]));
  (groups || []).forEach(g => {
    const idx = g.map(n => byName.get(n)).filter(i => i !== undefined);
    for(let k = 1; k < idx.length; k++) union(idx[0], idx[k], 'link');
  });
  const byMeasure = new Map();
  list.forEach((t, i) => {
    const m = tlNorm(t.measures);
    if(!m) return;
    if(byMeasure.has(m)) union(byMeasure.get(m), i, 'measures'); else byMeasure.set(m, i);
  });
  const classes = new Map();
  list.forEach((t, i) => {
    const r = find(i);
    if(!classes.has(r)) classes.set(r, []);
    classes.get(r).push(t);
  });
  const out = [];
  classes.forEach((members, r) => {
    if(members.length < 2) return;
    /* السبب: الربط إن وُجد أي ضمّ بالربط في الفئة، وإلا «يقيس» المشترك */
    let reason = 'measures';
    (groups || []).forEach(g => { if(g.filter(n => members.some(m => tlNorm(m.name) === n)).length >= 2) reason = 'link'; });
    const ms = [...new Set(members.map(m => tlNorm(m.measures)).filter(Boolean))];
    const both = members.length === 2 ? 'كلاهما' : 'كلها';
    const label = reason === 'link' ? (members.length === 2 ? 'ربطهما المعلم' : 'ربطها المعلم') : (ms.length === 1 ? `${both} يقيس: ${ms[0]}` : `${both} يقيس: ${ms.join(' / ')}`);
    out.push({ members, reason, label });
  });
  return out;
}

/* أزرار «ماذا يقيس؟» السريعة بحسب المادة (5–6 فقط — م8)؛ والمجهولة قائمة عامة */
const TL_MEASURE_PRESETS = [
  [/إنجليزي|انجليزي|english/i, ['القراءة', 'الكتابة', 'الاستماع', 'التحدث', 'المفردات', 'القواعد']],
  [/عربي|لغتي|عربية/, ['القراءة', 'الكتابة', 'الاستماع', 'التعبير', 'الإملاء', 'النحو']],
  [/رياضيات|رياضي/, ['الحساب', 'الجبر', 'الهندسة', 'حل المسائل', 'التطبيق']],
  [/علوم|فيزياء|كيمياء|أحياء|احياء/, ['الفهم', 'الحفظ', 'التطبيق', 'الاستنتاج', 'المهارات العملية']],
  [/إسلامي|اسلامي|قرآن|توحيد|فقه|حديث|دين/, ['الحفظ', 'التلاوة', 'الفهم', 'التطبيق']]
];
const TL_MEASURE_GENERAL = ['الحفظ', 'الفهم', 'التطبيق', 'حل المسائل', 'المهارات'];

function measuresPresetsFor(subject){
  const s = String(subject || '');
  const hit = TL_MEASURE_PRESETS.find(([re]) => re.test(s));
  return (hit ? hit[1] : TL_MEASURE_GENERAL).slice();
}

/* ============ الواجهة (تُستدعى من نموذج الاختبار بـapp-17) ============ */

/* أزرار سريعة تحت «ماذا يقيس؟»: تملأ الحقل نفسه، والكتابة الحرة تبقى ممكنة */
function tlMeasureChipsHtml(){
  const subject = typeof getProfileSubject === 'function' ? getProfileSubject() : '';
  const e = escapeHtml;
  return `<div class="crm-nt-quick" aria-label="ما يقيسه شائع" style="margin:-4px 0 8px;">${measuresPresetsFor(subject).map(m =>
    `<button type="button" class="crm-nt-q" onclick="tlPickMeasure(this)">${e(m)}</button>`).join('')}</div>`;
}

function tlPickMeasure(btn){
  const inp = document.getElementById('crmGradeColMeasures');
  if(!inp || !btn) return;
  inp.value = btn.textContent;
  document.querySelectorAll('.crm-nt-q').forEach(b => { if(b.parentElement === btn.parentElement) b.classList.toggle('on', b === btn); });
}

/* سطر واحد اختياري «قارنه مع»: اختبارات الشعبة الأخرى؛ بلا اختبارات أخرى لا يظهر.
   current = الاختبار قيد التعديل (أو null عند الإضافة) */
function tlLinkFieldHtml(columns, current, groups){
  const e = escapeHtml;
  const others = (columns || []).filter(c => c.category === 'tests' && (!current || c.id !== current.id));
  if(!others.length) return '';
  const partner = current ? tlPartnerOf(groups, current.name, others.map(c => c.name)) : '';
  return `<label class="crm-field-label" for="crmGradeColLink">قارنه مع (اختياري — ليظهر تقدّمك بين الاختبارين في تقرير الطالب)</label>
    <select class="goal-input" id="crmGradeColLink" data-had="${partner ? '1' : ''}" style="margin-bottom:10px;"><option value="">بلا مقارنة</option>${others.map(c =>
      `<option value="${e(tlNorm(c.name))}"${tlNorm(c.name) === partner ? ' selected' : ''}>${e(c.name)}</option>`).join('')}</select>`;
}

async function persistTestLinks(term, groups){
  const uid = currentUser.id;
  const next = normalizeFeatures(appFeatures);
  const all = Object.assign({}, next.testLinks || {});
  const key = tlKey(term);
  if(groups.length) all[key] = groups; else delete all[key];
  if(Object.keys(all).length) next.testLinks = all; else delete next.testLinks;
  appFeatures = next;
  await saveAppFeatures();
  if(!currentUser || currentUser.id !== uid) return 'تغيّر الحساب';
  const saved = tlGroupsOf(appFeaturesSaved, term);
  return JSON.stringify(saved) === JSON.stringify(groups) ? null : 'تعذّر حفظ الربط';
}

/* بعد حفظ عمود اختبار: يطبّق إعادة التسمية واختيار «قارنه مع». لا يرمي — الفشل تنبيه فقط (العمود حُفظ) */
async function tlApplyFromForm(term, oldName, newName){
  try{
    const sel = document.getElementById('crmGradeColLink');
    let groups = tlGroupsOf(appFeatures, term);
    const before = JSON.stringify(groups);
    let note = '';
    if(oldName && tlNorm(oldName) !== tlNorm(newName)){
      const r = tlRename(groups, oldName, newName);
      if(r.changed){ groups = r.groups; note = 'حُدّث ربط الاختبار بالاسم الجديد'; }
    }
    if(sel){
      const want = sel.value || '';
      if(want){
        const r = tlLink(groups, newName, want);
        if(r.error){ showToast(r.error, 'error'); }
        else if(JSON.stringify(r.groups) !== JSON.stringify(groups)){ groups = r.groups; note = `رُبط الاختبار بـ«${want}» ليُقارَن في تقرير الطالب`; }
      } else if(sel.dataset && sel.dataset.had === '1' && tlGroupIndex(groups, newName) >= 0){
        groups = tlUnlink(groups, newName);
        note = 'أُلغيت مقارنة الاختبار';
      }
    }
    if(JSON.stringify(groups) === before) return;
    const err = await persistTestLinks(term, groups);
    if(err) showToast(err, 'error'); else if(note) showToast(note, 'ok');
  } catch(e){
    showToast('تعذّر حفظ الربط: ' + (e.message || ''), 'error');
  }
}

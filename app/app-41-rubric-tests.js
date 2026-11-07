/* ============================================================
   اختبار بسلّم تقدير (معايير) — تجربة على حساب المعلم المفعَّل له فقط
   ------------------------------------------------------------
   - الاختبار العادي = عمود بفئة الاختبارات ودرجة لكل طالب. الاختبار بسلّم تقدير
     هو نفسه (عمود + درجة الطالب في classroom_grade_scores)، لكن درجته تُحسب
     من معايير يختارها المعلم: كل معيار له درجة ومستوى إنجاز (كامل/كبير/جزئي/بداية/صفر).
   - المعايير في classroom_rubric_criteria، ورصد كل طالب لكل معيار في
     classroom_rubric_marks (المستوى فقط)؛ والدرجة الكلية تبقى في
     classroom_grade_scores كما هي، فلا يتغيّر أي كشف ولا تقرير قائم.
   - يُعرف الاختبار بالسلّم بوجود معاييره (لا نوع جديد للعمود: قيد kind في القاعدة).
   - المفتاح: user_app_settings.features.rubricTests === true (حسابات تجريبية فقط).
   - هذا الملف: الدوال الصرفة أولًا، ثم الواجهة (تُضاف تباعًا).
   ============================================================ */

const RUBRIC_LEVELS = [
  { level: 0, label: 'كامل', pct: 1 },
  { level: 1, label: 'كبير', pct: 0.75 },
  { level: 2, label: 'جزئي', pct: 0.5 },
  { level: 3, label: 'بداية', pct: 0.25 },
  { level: 4, label: 'صفر', pct: 0 }
];
/* أشهر معايير تقييم القراءة (مقترحات للاختيار منها، لا قوالب جاهزة): الدقة، النطق، الطلاقة، السرعة، التعبير، الوقف، التصحيح الذاتي، الفهم */
const RUBRIC_POOL = ['الدقة', 'النطق ومخارج الحروف', 'الطلاقة والسلاسة', 'السرعة المناسبة', 'التعبير والنبرة', 'الوقف وعلامات الترقيم', 'التصحيح الذاتي', 'فهم المقروء'];
const RUBRIC_MAX_CRITERIA = 10;

/* ============ دوال صرفة ============ */
function rubricOn(){ return !!(typeof appFeatures !== 'undefined' && appFeatures && appFeatures.rubricTests === true); }

function rubricRound(x){ return Math.round(Number(x) * 100) / 100; }

function rubricNormalizeName(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 60); }

/* توزيع الدرجة الكلية على n معيار بأرقام صحيحة قدر الإمكان (الباقي للأوائل):
   5 على 3 → 2 و2 و1. إن قلّت الدرجة عن عدد المعايير: بالنصف ثم بالربع */
function rubricDistribute(total, n){
  const t = Number(total), k = Number(n);
  if(!(t > 0) || !(k >= 1)) return [];
  let unit = 1;
  if(t < k) unit = 0.5;
  if(t * 2 < k) unit = 0.25;
  const units = Math.round(t / unit);
  const base = Math.floor(units / k), rem = units - base * k;
  return Array.from({ length: k }, (_, i) => (base + (i < rem ? 1 : 0)) * unit);
}

/* درجة المعيار عند مستوى معيّن */
function rubricPointsAt(points, level){
  const lv = RUBRIC_LEVELS[level];
  return lv ? rubricRound(Number(points) * lv.pct) : 0;
}

/* درجة الطالب: مجموع (درجة المعيار × نسبة مستواه). levelOf(criterionId) → 0..4 أو null (لم يُرصد = 0) */
function rubricTotal(criteria, levelOf){
  let sum = 0;
  (criteria || []).forEach(c => {
    const lv = levelOf(c.id);
    if(lv === null || lv === undefined) return;
    sum += Number(c.points) * (RUBRIC_LEVELS[lv] ? RUBRIC_LEVELS[lv].pct : 0);
  });
  return rubricRound(sum);
}

function rubricIsComplete(criteria, levelOf){
  return (criteria || []).length > 0 && criteria.every(c => {
    const lv = levelOf(c.id);
    return lv !== null && lv !== undefined && RUBRIC_LEVELS[lv] !== undefined;
  });
}

/* مسودة المعايير عند إنشاء اختبار: names بترتيب الاختيار، total الدرجة الكاملة. يعيد { error } أو { rows: [{ name, points, position }] } */
function rubricBuildCriteria(names, total){
  const clean = (names || []).map(rubricNormalizeName).filter(Boolean);
  if(!clean.length) return { error: 'اختر معيارًا واحدًا على الأقل، أو أطفئ «رصد بسلّم تقدير»' };
  if(new Set(clean).size !== clean.length) return { error: 'يوجد معيار مكرر' };
  if(clean.length > RUBRIC_MAX_CRITERIA) return { error: `الحد الأقصى ${RUBRIC_MAX_CRITERIA} معايير` };
  const points = rubricDistribute(total, clean.length);
  if(!points.length || points.some(p => !(p > 0))) return { error: 'الدرجة الكاملة صغيرة على هذا العدد من المعايير' };
  return { rows: clean.map((name, i) => ({ name, points: points[i], position: i })) };
}

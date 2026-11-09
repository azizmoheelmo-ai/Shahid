/* ============================================================
   استبانة رضا المستفيدين — المصدر المشترك (SURVEYS.md)
   ------------------------------------------------------------
   يُحمَّل بطريقتين بلا تعديل:
   - في المتصفح كسكربت عادي <script src="survey-templates.js">: يضع الأسماء على globalThis.
   - في Node: require('../survey-templates.js') من api/s.js (ثابت حرفيًا ليجمعه متتبّع Vercel).
   كل شيء داخل IIFE وبـvar، فلا يتصادم اسم عام عند دمج سكربتات index.html (tests/load-app.js).
   لا lookbehind ولا صيغ حديثة تكسر متصفحات iOS القديمة.

   الأسئلة الحاكمة هي المحفوظة داخل كل استبانة (survey_campaigns.questions)، لا القوالب الجاهزة هنا:
   القالب نقطة بداية تُنسخ عند الإنشاء، فتعديله لاحقًا لا يغيّر استبانة قائمة ولا طريقة التحقق من ردودها.
   قواعد surveyValidateQuestions = public.survey_questions_ok، وقواعد surveyValidateAnswers = public.survey_answers_clean
   بالـSQL (اختبار يطابق النصين، وفُحص التطابق على PostgreSQL حقيقي بجدول حالات).
   «btrim» هنا مثل PostgreSQL: يقص المسافات العادية فقط.

   الصادرات بالضبط: SURVEY_READY_TEMPLATES، SURVEY_LIMITS، surveyValidateQuestions، surveyValidateAnswers،
   surveyNewCode، SURVEY_CODE_LENGTH، SURVEY_CODE_RE، SURVEY_AUDIENCES، SURVEY_RATING_LABELS.
   ============================================================ */
(function(root){
  'use strict';

  function deepFreeze(o){
    Object.keys(o).forEach(function(k){ var v = o[k]; if(v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(o);
  }

  var SURVEY_LIMITS = Object.freeze({ maxQuestions: 12, maxLabel: 120, maxOptions: 8, maxOption: 40, textMax: 300, maxTitle: 80 });
  var SURVEY_AUDIENCES = Object.freeze(['guardian', 'student', 'custom']);
  var SURVEY_RATING_LABELS = Object.freeze(['ضعيف جدًا', 'ضعيف', 'مقبول', 'جيد', 'ممتاز']);
  var TYPES = ['rating', 'truefalse', 'choice', 'text'];
  var KEYS = ['id', 'type', 'label', 'required', 'options'];

  function q(id, type, label, options){
    var o = { id: id, type: type, label: label, required: type !== 'text' };
    if(options) o.options = options;
    return o;
  }

  var SURVEY_READY_TEMPLATES = deepFreeze({
    guardian_v1: {
      audience: 'guardian',
      title: 'رضا أولياء الأمور',
      questions: [
        q('q1', 'rating', 'وضوح شرح المعلم للدرس'),
        q('q2', 'rating', 'أسلوب تعامل المعلم مع الطالب'),
        q('q3', 'rating', 'متابعة المعلم لمستوى الطالب'),
        q('q4', 'truefalse', 'يتواصل المعلم معنا عند الحاجة'),
        q('q5', 'truefalse', 'الواجبات مناسبة وتفيد الطالب'),
        q('q6', 'choice', 'أفضل وسيلة للتواصل مع المعلم', ['واتساب', 'اتصال هاتفي', 'لقاء في المدرسة', 'رسالة من المدرسة']),
        q('q7', 'rating', 'رضاكم العام عن المعلم'),
        q('q8', 'text', 'ما الذي أعجبكم؟'),
        q('q9', 'text', 'ما اقتراحكم للتحسين؟')
      ]
    },
    student_v1: {
      audience: 'student',
      title: 'رضا الطلاب',
      questions: [
        q('q1', 'rating', 'وضوح شرح المعلم للدرس'),
        q('q2', 'rating', 'أسلوب تعامل المعلم معك'),
        q('q3', 'rating', 'اهتمام المعلم بمستواك'),
        q('q4', 'truefalse', 'يساعدني المعلم عندما أحتاج مساعدة'),
        q('q5', 'truefalse', 'الواجبات مناسبة لي وتفيدني'),
        q('q6', 'choice', 'أفضل طريقة للتواصل مع المعلم', ['سؤاله في الحصة', 'سؤاله بعد الحصة', 'رسالة عبر واتساب', 'عن طريق ولي أمري']),
        q('q7', 'rating', 'رضاك العام عن المعلم'),
        q('q8', 'text', 'ما الذي أعجبك؟'),
        q('q9', 'text', 'ما اقتراحك للتحسين؟')
      ]
    },
    blank: { audience: 'custom', title: '', questions: [] }
  });

  /* رمز الرابط: 10 أحرف من أبجدية 31 حرفًا بلا الملتبسة (i l o 0 1) ⇒ 31^10 ≈ 2^49.5.
     مقايضة مقصودة لرابط أقصر: التخمين ما يزال غير عملي لأن الرابط يُستعمل مرة، وينتهي بانتهاء الحملة،
     وكل محاولة فاشلة تُحتسب بمحدِّد api/s.js (20 فشلًا/10 دقائق لكل عنوان) وبقاعدة WAF لدى Vercel. */
  var CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  var SURVEY_CODE_LENGTH = 10;
  var SURVEY_CODE_RE = /^[a-z2-9]{8,32}$/;

  function surveyNewCode(){
    var c = root.crypto || (typeof crypto !== 'undefined' ? crypto : null);
    if(!c || typeof c.getRandomValues !== 'function') throw new Error('crypto.getRandomValues unavailable');
    var out = '';
    while(out.length < SURVEY_CODE_LENGTH){
      var bytes = c.getRandomValues(new Uint8Array(32));
      for(var i = 0; i < bytes.length && out.length < SURVEY_CODE_LENGTH; i++){
        if(bytes[i] < 248) out += CODE_ALPHABET[bytes[i] % 31]; /* 248 = 31×8: يُرفض الباقي فلا انحياز */
      }
    }
    return out;
  }

  function hasOwn(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
  function btrim(s){ return s.replace(/^ +| +$/g, ''); } /* مثل btrim في PostgreSQL: المسافات العادية فقط */
  function cps(s){ return Array.from(s).length; } /* عدد المحارف كـchar_length */
  var CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
  var LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/; /* jsonb يرفضها */
  function okText(s, max){ var t = btrim(s); return t.length > 0 && cps(t) <= max && !CONTROL.test(t) && !LONE_SURROGATE.test(t); }

  /* { ok: true, value } أو { ok: false, error }. value نسخة منظَّفة (النصوص بعد btrim) بالمفاتيح المسموحة فقط. */
  function surveyValidateQuestions(questions){
    var L = SURVEY_LIMITS;
    if(!Array.isArray(questions)) return { ok: false, error: 'not_array' };
    if(questions.length < 1 || questions.length > L.maxQuestions) return { ok: false, error: 'count' };
    var seen = {}, value = [];
    for(var i = 0; i < questions.length; i++){
      var e = questions[i];
      if(!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: 'not_object:' + i };
      var ks = Object.keys(e);
      for(var j = 0; j < ks.length; j++) if(KEYS.indexOf(ks[j]) < 0) return { ok: false, error: 'bad_key:' + i };
      if(typeof e.id !== 'string' || !/^q[0-9]{1,2}$/.test(e.id)) return { ok: false, error: 'bad_id:' + i };
      if(hasOwn(seen, e.id)) return { ok: false, error: 'dup_id:' + i };
      seen[e.id] = 1;
      if(typeof e.type !== 'string' || TYPES.indexOf(e.type) < 0) return { ok: false, error: 'bad_type:' + i };
      if(typeof e.label !== 'string' || !okText(e.label, L.maxLabel)) return { ok: false, error: 'bad_label:' + i };
      if(typeof e.required !== 'boolean') return { ok: false, error: 'bad_required:' + i };
      var out = { id: e.id, type: e.type, label: btrim(e.label), required: e.required };
      if(e.type === 'choice'){
        var o = e.options;
        if(!Array.isArray(o) || o.length < 2 || o.length > L.maxOptions) return { ok: false, error: 'bad_options:' + i };
        for(var k = 0; k < o.length; k++) if(typeof o[k] !== 'string' || !okText(o[k], L.maxOption)) return { ok: false, error: 'bad_options:' + i };
        out.options = o.map(btrim);
      } else if(hasOwn(e, 'options')) return { ok: false, error: 'options_not_allowed:' + i };
      value.push(out);
    }
    return { ok: true, value: value };
  }

  /* يتحقق من الإجابات وفق أسئلة الاستبانة نفسها (لا قالب بالاسم). { ok: true, value } أو { ok: false, error }.
     value مبني من معرّفات الأسئلة وحدها (المفاتيح الزائدة تُهمل): rating عدد صحيح 1..5، truefalse منطقي،
     choice فهرس صحيح من الصفر أصغر من عدد الخيارات، text نص بعد btrim ≤300 (الفارغ يُحذف مفتاحه).
     المطلوب يجب أن يحضر صالحًا (النص المطلوب غير فارغ)، وغير المطلوب يُهمل إن غاب أو كان null. لا تحويل للأنواع. */
  function surveyValidateAnswers(questions, answers){
    var qv = surveyValidateQuestions(questions);
    if(!qv.ok) return { ok: false, error: 'bad_questions' };
    if(!answers || typeof answers !== 'object' || Array.isArray(answers)) return { ok: false, error: 'not_object' };
    var value = {};
    for(var i = 0; i < qv.value.length; i++){
      var qq = qv.value[i];
      var v = hasOwn(answers, qq.id) ? answers[qq.id] : undefined;
      if(v === undefined || v === null){
        if(qq.required) return { ok: false, error: 'missing:' + qq.id };
        continue;
      }
      if(qq.type === 'rating'){
        if(typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, error: 'bad_type:' + qq.id };
        if(v < 1 || v > 5) return { ok: false, error: 'out_of_range:' + qq.id };
      } else if(qq.type === 'truefalse'){
        if(typeof v !== 'boolean') return { ok: false, error: 'bad_type:' + qq.id };
      } else if(qq.type === 'choice'){
        if(typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, error: 'bad_type:' + qq.id };
        if(v < 0 || v >= qq.options.length || v > 99) return { ok: false, error: 'out_of_range:' + qq.id };
        v = v + 0; /* -0 ← 0 */
      } else {
        if(typeof v !== 'string') return { ok: false, error: 'bad_type:' + qq.id };
        if(v.indexOf('\u0000') >= 0 || LONE_SURROGATE.test(v)) return { ok: false, error: 'bad_text:' + qq.id };
        v = btrim(v);
        if(!v){
          if(qq.required) return { ok: false, error: 'missing:' + qq.id };
          continue;
        }
        if(cps(v) > SURVEY_LIMITS.textMax) return { ok: false, error: 'too_long:' + qq.id };
      }
      value[qq.id] = v;
    }
    return { ok: true, value: value };
  }

  var api = {
    SURVEY_READY_TEMPLATES: SURVEY_READY_TEMPLATES,
    SURVEY_LIMITS: SURVEY_LIMITS,
    surveyValidateQuestions: surveyValidateQuestions,
    surveyValidateAnswers: surveyValidateAnswers,
    surveyNewCode: surveyNewCode,
    SURVEY_CODE_LENGTH: SURVEY_CODE_LENGTH,
    SURVEY_CODE_RE: SURVEY_CODE_RE,
    SURVEY_AUDIENCES: SURVEY_AUDIENCES,
    SURVEY_RATING_LABELS: SURVEY_RATING_LABELS
  };
  if(typeof module === 'object' && module && module.exports) module.exports = api;
  else Object.keys(api).forEach(function(k){ root[k] = api[k]; });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));

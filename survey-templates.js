/* ============================================================
   قوالب استبانة رضا المستفيدين — مصدر الحقيقة الوحيد (SURVEYS.md)
   ------------------------------------------------------------
   يُحمَّل بطريقتين بلا تعديل:
   - في المتصفح كسكربت عادي <script src="survey-templates.js">: يضع الأسماء على globalThis.
   - في Node: require('../survey-templates.js') من api/s.js (ثابت حرفيًا ليجمعه متتبّع Vercel).
   كل شيء داخل IIFE وبـvar، فلا يتصادم اسم عام عند دمج سكربتات index.html (tests/load-app.js).
   لا lookbehind ولا صيغ حديثة تكسر متصفحات iOS القديمة.

   تطوّر القالب: v1 مجمَّد بعد الإطلاق (اختبار بصمة sha256 يفشل عند أي تغيير). أي تعديل
   على سؤال أو ترتيب خيار = إصدار جديد v2 بجانبه، مع فرع مطابق في submit_survey بالـSQL
   وقيمته في قيد survey_campaigns.template (اختبارات تتحقق من الثلاثة).

   الصادرات بالضبط: SURVEY_TEMPLATES، surveyValidateAnswers، surveyNewCode، SURVEY_CODE_LENGTH، SURVEY_CODE_RE.
   ============================================================ */
(function(root){
  'use strict';

  function deepFreeze(o){
    Object.keys(o).forEach(function(k){ var v = o[k]; if(v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(o);
  }

  var SURVEY_TEMPLATES = deepFreeze({
    v1: {
      questions: [
        { id: 'q1', type: 'rating', label: 'وضوح شرح المعلم للدرس', required: true },
        { id: 'q2', type: 'rating', label: 'أسلوب تعامل المعلم مع الطالب', required: true },
        { id: 'q3', type: 'rating', label: 'متابعة المعلم لمستوى الطالب', required: true },
        { id: 'q4', type: 'truefalse', label: 'يتواصل المعلم مع الطالب أو ولي أمره عند الحاجة', required: true },
        { id: 'q5', type: 'truefalse', label: 'الواجبات مناسبة وتفيد الطالب', required: true },
        { id: 'q6', type: 'choice', label: 'أفضل وسيلة للتواصل مع المعلم', options: ['واتساب', 'اتصال هاتفي', 'لقاء في المدرسة', 'رسالة من المدرسة'], required: true },
        { id: 'q7', type: 'rating', label: 'رضاكم العام عن المعلم', required: true },
        { id: 'q8', type: 'text', label: 'ما الذي أعجبكم؟', required: false },
        { id: 'q9', type: 'text', label: 'ما اقتراحكم للتحسين؟', required: false }
      ],
      scale: ['ضعيف جدًا', 'ضعيف', 'مقبول', 'جيد', 'ممتاز'],
      textMax: 300
    }
  });

  /* رمز الرابط: 10 أحرف من أبجدية 31 حرفًا بلا الملتبسة (i l o 0 1) ⇒ 31^10 ≈ 2^49.5.
     مقايضة مقصودة لرابط أقصر يُكتب ويُقرأ بسهولة: التخمين ما يزال غير عملي لأن الرابط يُستعمل مرة،
     وينتهي بانتهاء الحملة، وكل محاولة فاشلة تُحتسب بمحدِّد api/s.js (20 فشلًا/10 دقائق لكل عنوان)
     وبقاعدة WAF لدى Vercel. للمقارنة: رمز روابط التقارير 14 حرفًا (≈69 بتًا). */
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

  /* تنظيف النص الحر: محارف التحكم تُزال (عدا السطر الجديد)، ونصف زوج بديل يتيم يُستبدل بـU+FFFD
     (jsonb يرفضه)، ثم القص بعدد المحارف الفعلية (code points كـchar_length بالقاعدة). */
  function cleanText(s, max){
    var t = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
    var out = [];
    for(var i = 0; i < t.length; i++){
      var c = t.charCodeAt(i);
      if(c >= 0xD800 && c <= 0xDBFF){
        var d = i + 1 < t.length ? t.charCodeAt(i + 1) : 0;
        if(d >= 0xDC00 && d <= 0xDFFF){ out.push(t.charAt(i) + t.charAt(i + 1)); i++; } else out.push('�');
      } else if(c >= 0xDC00 && c <= 0xDFFF) out.push('�');
      else out.push(t.charAt(i));
    }
    var trimmed = out.join('').trim();
    return Array.from(trimmed).slice(0, max).join('').trim();
  }

  /* يرجع { ok: true, value } أو { ok: false, error }. value مبني من أسئلة القالب وحدها (المفاتيح الزائدة تُهمل):
     rating عدد صحيح 1..5، truefalse قيمة منطقية، choice فهرس صحيح من الصفر ضمن الخيارات، text نص منظَّف
     (يُحذف مفتاحه إن فرغ). غير النصي إلزامي، والنوع الخاطئ يُرفض ولا يُحوَّل. نفس قواعد submit_survey بالـSQL. */
  function surveyValidateAnswers(templateKey, answers){
    var tpl = typeof templateKey === 'string' && hasOwn(SURVEY_TEMPLATES, templateKey) ? SURVEY_TEMPLATES[templateKey] : null;
    if(!tpl) return { ok: false, error: 'unknown_template' };
    if(!answers || typeof answers !== 'object' || Array.isArray(answers)) return { ok: false, error: 'not_object' };
    var value = {};
    for(var i = 0; i < tpl.questions.length; i++){
      var q = tpl.questions[i];
      var v = hasOwn(answers, q.id) ? answers[q.id] : undefined;
      if(q.type === 'text'){
        if(v === undefined || v === null) continue;
        if(typeof v !== 'string') return { ok: false, error: 'bad_type:' + q.id };
        var t = cleanText(v, tpl.textMax);
        if(t) value[q.id] = t;
        continue;
      }
      if(v === undefined || v === null) return { ok: false, error: 'missing:' + q.id };
      if(q.type === 'rating'){
        if(typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, error: 'bad_type:' + q.id };
        if(v < 1 || v > 5) return { ok: false, error: 'out_of_range:' + q.id };
      } else if(q.type === 'truefalse'){
        if(typeof v !== 'boolean') return { ok: false, error: 'bad_type:' + q.id };
      } else if(q.type === 'choice'){
        if(typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, error: 'bad_type:' + q.id };
        if(v < 0 || v >= q.options.length) return { ok: false, error: 'out_of_range:' + q.id };
      } else return { ok: false, error: 'unknown_type:' + q.id };
      value[q.id] = v;
    }
    return { ok: true, value: value };
  }

  var api = {
    SURVEY_TEMPLATES: SURVEY_TEMPLATES,
    surveyValidateAnswers: surveyValidateAnswers,
    surveyNewCode: surveyNewCode,
    SURVEY_CODE_LENGTH: SURVEY_CODE_LENGTH,
    SURVEY_CODE_RE: SURVEY_CODE_RE
  };
  if(typeof module === 'object' && module && module.exports) module.exports = api;
  else Object.keys(api).forEach(function(k){ root[k] = api[k]; });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));

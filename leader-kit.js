/* ============================================================
   متابعة مؤشرات القيادة المدرسية — المصدر المشترك (LEADER-FOLLOWUP.md)
   ------------------------------------------------------------
   يُحمَّل بطريقتين بلا تعديل:
   - في المتصفح كسكربت عادي <script src="leader-kit.js">: يضع الأسماء على globalThis.
   - في Node: require('../leader-kit.js') من api/f.js (مسار حرفي ثابت ليجمعه متتبّع Vercel).
   كل شيء داخل IIFE وبـvar (لا تصادم عند دمج السكربتات في tests/load-app.js)، بلا lookbehind ولا صيغ حديثة.

   قواعد leaderValidateIndicators = public.leader_indicators_ok، وleaderValidateSlots = public.leader_slots_ok،
   وleaderValidateAnswers = public.leader_answers_clean بالـSQL (اختبار يطابق الحدود والنصوص).
   «btrim» هنا مثل PostgreSQL: المسافات العادية فقط.

   الصادرات بالضبط: LEADER_ROLES، LEADER_ANSWER_STATES، LEADER_LIMITS، LEADER_SLOT_RE، LEADER_SLOT_NONE،
   leaderValidateIndicators، leaderValidateSlots، leaderValidateAnswers، leaderSlotLabel، leaderRoleLabel.
   ============================================================ */
(function(root){
  'use strict';

  var LEADER_ROLES = Object.freeze({
    principal: 'مدير المدرسة',
    deputy_students: 'وكيل شؤون الطلاب',
    deputy_academic: 'وكيل الشؤون التعليمية',
    deputy_other: 'وكيل المدرسة',
    other: 'أخرى'
  });
  /* منفذ / قيد التنفيذ / لم ينفذ — والسبب إلزامي لغير المنفذ */
  var LEADER_ANSWER_STATES = Object.freeze({ done: 'منفذ', wip: 'قيد التنفيذ', no: 'لم ينفذ' });
  var LEADER_LIMITS = Object.freeze({ maxIndicators: 15, maxLabel: 150, maxSlots: 6, maxReason: 300, maxName: 60, maxCycle: 60 });
  /* موعد بتوقيت المدرسة بلا منطقة زمنية: YYYY-MM-DDTHH:MM (السعودية بلا توقيت صيفي، فلا لبس) */
  var LEADER_SLOT_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]$/;
  var LEADER_SLOT_NONE = 'none'; /* «لا يناسبني أي موعد» */

  function hasOwn(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
  function btrim(s){ return s.replace(/^ +| +$/g, ''); }
  function cps(s){ return Array.from(s).length; }
  var CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
  var LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  function okText(s, max){ var t = btrim(s); return t.length > 0 && cps(t) <= max && !CONTROL.test(t) && !LONE_SURROGATE.test(t); }
  function isObj(x){ return x !== null && typeof x === 'object' && !Array.isArray(x); }

  /* مؤشرات الطلب: [{ id: 'i1', label }] — 1..15، المعرّف i<رقم> فريد، النص 1..150 بلا محارف تحكم */
  function leaderValidateIndicators(list){
    if(!Array.isArray(list) || list.length < 1 || list.length > LEADER_LIMITS.maxIndicators) return { ok: false, error: 'count' };
    var seen = {}; var out = [];
    for(var i = 0; i < list.length; i++){
      var e = list[i];
      if(!isObj(e)) return { ok: false, error: 'shape' };
      var keys = Object.keys(e);
      if(keys.length !== 2 || !hasOwn(e, 'id') || !hasOwn(e, 'label')) return { ok: false, error: 'keys' };
      if(typeof e.id !== 'string' || !/^i[0-9]{1,3}$/.test(e.id) || seen[e.id]) return { ok: false, error: 'id' };
      if(typeof e.label !== 'string' || !okText(e.label, LEADER_LIMITS.maxLabel)) return { ok: false, error: 'label' };
      seen[e.id] = true;
      out.push({ id: e.id, label: btrim(e.label) });
    }
    return { ok: true, value: out };
  }

  /* أوقات اللقاء المقترحة: 0..6 نصوص بصيغة الموعد، بلا تكرار */
  function leaderValidateSlots(list){
    if(!Array.isArray(list) || list.length > LEADER_LIMITS.maxSlots) return { ok: false, error: 'count' };
    var seen = {};
    for(var i = 0; i < list.length; i++){
      var s = list[i];
      if(typeof s !== 'string' || !LEADER_SLOT_RE.test(s) || seen[s]) return { ok: false, error: 'slot' };
      seen[s] = true;
    }
    return { ok: true, value: list.slice() };
  }

  /* إجابات المسؤول: { i1: { s: 'done'|'wip'|'no', r?: سبب } } لكل مؤشر (كلها مطلوبة).
     السبب إلزامي لغير المنفذ، اختياري للمنفذ، ≤300 بعد btrim. المفاتيح الزائدة تُهمل. */
  function leaderValidateAnswers(indicators, answers){
    var iv = leaderValidateIndicators(indicators);
    if(!iv.ok) return { ok: false, error: 'indicators' };
    if(!isObj(answers)) return { ok: false, error: 'shape' };
    var out = {};
    for(var i = 0; i < iv.value.length; i++){
      var id = iv.value[i].id; var a = hasOwn(answers, id) ? answers[id] : null;
      if(!isObj(a) || typeof a.s !== 'string' || !hasOwn(LEADER_ANSWER_STATES, a.s)) return { ok: false, error: 'state' };
      var r = '';
      if(a.r !== undefined && a.r !== null){
        if(typeof a.r !== 'string') return { ok: false, error: 'reason' };
        r = btrim(a.r);
        if(r !== '' && !okText(r, LEADER_LIMITS.maxReason)) return { ok: false, error: 'reason' };
      }
      if(a.s !== 'done' && r === '') return { ok: false, error: 'reason-required' };
      out[id] = r === '' ? { s: a.s } : { s: a.s, r: r };
    }
    return { ok: true, value: out };
  }

  var DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  /* «الأحد 15 نوفمبر 10:30 ص» — بحساب صرف بلا Intl (نفس الناتج بكل بيئة) */
  function leaderSlotLabel(slot){
    if(typeof slot !== 'string' || !LEADER_SLOT_RE.test(slot)) return '';
    var y = +slot.slice(0, 4), m = +slot.slice(5, 7), d = +slot.slice(8, 10), h = +slot.slice(11, 13), mi = slot.slice(14, 16);
    var wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return DAYS[wd] + ' ' + d + ' ' + MONTHS[m - 1] + ' ' + h12 + ':' + mi + (h < 12 ? ' ص' : ' م');
  }

  function leaderRoleLabel(role){ return hasOwn(LEADER_ROLES, role) ? LEADER_ROLES[role] : ''; }

  var api = {
    LEADER_ROLES: LEADER_ROLES,
    LEADER_ANSWER_STATES: LEADER_ANSWER_STATES,
    LEADER_LIMITS: LEADER_LIMITS,
    LEADER_SLOT_RE: LEADER_SLOT_RE,
    LEADER_SLOT_NONE: LEADER_SLOT_NONE,
    leaderValidateIndicators: leaderValidateIndicators,
    leaderValidateSlots: leaderValidateSlots,
    leaderValidateAnswers: leaderValidateAnswers,
    leaderSlotLabel: leaderSlotLabel,
    leaderRoleLabel: leaderRoleLabel
  };
  if(typeof module === 'object' && module && module.exports) module.exports = api;
  else Object.keys(api).forEach(function(k){ root[k] = api[k]; });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));

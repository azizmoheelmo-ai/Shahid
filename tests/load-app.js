'use strict';
/* ============================================================
   أداة تحميل تطبيق "شاهد" داخل بيئة اختبار (Node.js)
   ------------------------------------------------------------
   الهدف: تنفيذ سكربت index.html *الفعلي* (نفس الكود المنشور، بدون نسخ أو
   إعادة كتابة أي منطق) داخل بيئة معزولة (vm) توفّر واجهات DOM/متصفح وهمية
   كافية لتشغيل كود التحميل الأولي (top-level) بدون أخطاء، حتى نقدر نستدعي
   الدوال "الصرفة" منه مباشرة بالاختبارات ونتأكد إنها فعلاً تطابق الكود
   المنشور — بدل اختبار نسخة منفصلة قد تنحرف عن التطبيق الحقيقي بمرور الوقت.

   ملاحظة مهمة: الدوال المعرَّفة بصيغة `function name(){}` بأعلى المستوى
   تُصبح خصائص فعلية على كائن الـ sandbox (نفس سلوك المتصفح مع window)،
   لذلك تُستدعى مباشرة كـ sandbox.escapeHtml(...) إلخ. أما متغيرات
   `let`/`const` بأعلى المستوى فلا تظهر كخصائص على sandbox (نفس سلوك
   المتصفح مع window) — الوصول لها ممكن فقط عبر vm.runInContext إضافي
   بنفس الـ context، وهذا غير مستخدم حاليًا لأن كل الدوال المختبَرة هنا
   لا تعتمد على حالة عامة متغيّرة (pure أو شبه-pure).
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* عنصر DOM وهمي "متسامح" — أي قراءة خاصية غير معروفة تُعيد قيمة آمنة بدل
   رمي استثناء، وأي نداء دالة غير معروف يكون no-op. يكفي لتشغيل كود تحميل
   الصفحة الأولي (تعريف الدوال) دون الحاجة لمحاكاة DOM حقيقي كامل. */
function makeFakeElement() {
  const store = { style: {}, dataset: {}, classList: makeClassList(), selectedIndex: 0 };
  const handler = {
    get(target, prop) {
      if (prop in store) return store[prop];
      if (prop === 'addEventListener' || prop === 'removeEventListener') return () => {};
      if (['appendChild', 'removeChild', 'remove', 'click', 'focus', 'blur', 'scrollIntoView', 'submit'].includes(prop)) {
        return () => {};
      }
      if (['getAttribute'].includes(prop)) return () => null;
      if (['setAttribute', 'removeAttribute'].includes(prop)) return () => {};
      if (prop === 'hasAttribute') return () => false;
      if (prop === 'querySelector') return () => makeFakeElement();
      if (prop === 'querySelectorAll') return () => [];
      if (prop === 'closest') return () => null;
      if (['value', 'textContent', 'innerText'].includes(prop)) return '';
      if (prop === 'innerHTML') return '';
      // خيار وهمي واحد كافٍ حتى لا ينهار كود يقرأ options[selectedIndex] عند التحميل الأولي
      if (prop === 'options') return [makeFakeElement()];
      if (['children', 'files'].includes(prop)) return [];
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => '[FakeElement]';
      return undefined;
    },
    set(target, prop, value) {
      store[prop] = value;
      return true;
    },
  };
  return new Proxy({}, handler);
}

function makeClassList() {
  const classes = new Set();
  return { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)) };
}

/* عميل Supabase وهمي — لا يُستدعى فعليًا بأي من اختبارات الدوال الصرفة،
   فقط يلزم لمنع رمي استثناء عند `supabase.createClient(...)` بأعلى الملف */
function makeFakeSupabaseClient() {
  const chain = {
    select() { return chain; }, eq() { return chain; }, neq() { return chain; },
    order() { return chain; }, limit() { return chain; }, range() { return chain; },
    is() { return chain; }, lt() { return chain; }, gt() { return chain; },
    insert() { return chain; }, update() { return chain; }, upsert() { return chain; }, delete() { return chain; },
    maybeSingle: async () => ({ data: null, error: null }),
    then(resolve) { resolve({ data: [], error: null }); return Promise.resolve({ data: [], error: null }); },
  };
  return {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ data: null, error: null }),
      signInWithOAuth: async () => ({ data: null, error: null }),
      signUp: async () => ({ data: null, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: null } }),
      setSession: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
    },
    from: () => chain,
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({ error: null }) }) },
    rpc: async () => ({ data: null, error: null }),
  };
}

/* يستخرج محتوى وسم <script> الرئيسي (بدون src) من index.html */
function extractInlineScript(html) {
  const matches = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const inline = matches.filter(([, attrs]) => !attrs || !/\bsrc=/.test(attrs)).map(([, , body]) => body);
  if (!inline.length) throw new Error('لم يُعثر على أي <script> داخلي بملف index.html');
  // الأطول هو سكربت التطبيق الرئيسي (باقي السكربتات إن وُجدت هامشية)
  return inline.reduce((a, b) => (b.length > a.length ? b : a));
}

/* يحمّل ويشغّل تطبيق شاهد، ويُرجع كائن sandbox — استدعِ الدوال المُعرَّفة
   بصيغة function عليه مباشرة، مثل: app.escapeHtml('<b>') */
function loadApp() {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const script = extractInlineScript(html);

  const fakeDocument = {
    getElementById: () => makeFakeElement(),
    createElement: () => makeFakeElement(),
    querySelector: () => makeFakeElement(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    body: makeFakeElement(),
    documentElement: makeFakeElement(),
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams,
    Promise, Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set, Symbol,
    document: fakeDocument,
    navigator: { onLine: true, canShare: undefined, share: undefined, serviceWorker: undefined },
    location: { protocol: 'file:', hash: '', pathname: '/index.html', href: 'file:///index.html' },
    history: { replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    open: () => {},
    window: undefined, // يُملأ أدناه بعد الإنشاء (يشير لنفس sandbox)
    supabase: { createClient: () => makeFakeSupabaseClient() },
    localStorage: makeFakeStorage(),
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
  };
  sandbox.window = sandbox; // كما بالمتصفح: window === global scope
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(script, context, { filename: 'index.html-inline-script.js' });

  return sandbox;
}

function makeFakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

module.exports = { loadApp };

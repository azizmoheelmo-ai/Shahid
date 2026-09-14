/* Service Worker لتطبيق "شاهد على الأداء الوظيفي"
   ------------------------------------------------------------
   الهدف الوحيد: تخزين "شكل" التطبيق الثابت (الصفحة، الأيقونات، الـ manifest)
   محليًا على جهاز المستخدم — عشان:
   1) فتح أسرع بالمرات القادمة (يُخدَّم من الكاش فورًا بينما يتحقق من وجود
      نسخة أحدث بالخلفية — stale-while-revalidate).
   2) لا تظهر صفحة بيضاء/خطأ متصفح لو انفتح التطبيق بدون إنترنت مؤقتًا.

   ما لا يفعله هذا الملف عمدًا (تصميم آمن ومحافظ):
   - لا يخزّن أي طلب لـ Supabase (API أو تخزين) إطلاقًا — البيانات دائمًا
     حيّة ومباشرة، صفر خطر لعرض بيانات قديمة/خاطئة أو مشاكل مصادقة مخزَّنة.
   - لا يخزّن أي مكتبة خارجية (jsDelivr, Google Fonts) — هذه تُدار بكاش
     المتصفح العادي (HTTP cache) وليس من مسؤولية هذا الملف.
   - لا يتدخل بأي طلب غير GET (لا يوجد أي POST/PUT/DELETE لنفس أصل الصفحة
     أصلًا بهذا التطبيق، لكن كإجراء أمان إضافي صريح).
   - لا يعمل إطلاقًا لو فُتح الملف عبر file:// — المتصفح نفسه يمنع تسجيل
     Service Worker خارج HTTPS/localhost، وهذا سلوك متصفح طبيعي متوقّع.
*/

const CACHE_NAME = 'shahid-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png'
];

/* الملفات التي تحمل منطق التطبيق نفسه (الصفحة + سكربتات app/*.js) —
   هذه تحديدًا يجب أن تُخدَّم "الشبكة أولًا" لا "الكاش أولًا": لو خُدِّمت من
   كاش قديم بعد نشر تحديث، يشتغل المستخدم بكود قديم بصمت دون أي علامة على
   أن هناك نسخة أحدث، وهذا وقع فعليًا (تحديث خطاب الإحالة ظهر بالمعاينة
   على جهاز المطوّر لكن لم يظهر عند المستخدم لحظة النشر). أما بقية الملفات
   (الأيقونات، manifest) فتبقى "كاش أولًا" لأنها نادرًا ما تتغير وتفيد
   بالعمل بلا اتصال بسرعة. */
function isAppLogicRequest(url){
  return url.pathname.endsWith('.html') || url.pathname === '/' || /\/app\/.*\.js$/.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* لو تعذّر تخزين أحد الملفات لا نوقف التثبيت بالكامل */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  /* نخدم فقط طلبات GET لنفس أصل الصفحة — أي شيء آخر (Supabase، jsDelivr،
     الخطوط...) يُترك تمامًا لسلوك الشبكة الطبيعي بدون أي تدخل من هنا */
  if(req.method !== 'GET' || url.origin !== self.location.origin) return;

  if(isAppLogicRequest(url)){
    /* الشبكة أولًا: أي تحديث منشور يظهر فورًا بلا أي كاش قديم يحجبه.
       يُلجأ للكاش فقط لو تعذّر الاتصال فعلاً (عمل بلا إنترنت). */
    event.respondWith(
      fetch(req).then((response) => {
        if(response && response.ok){
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((response) => {
        if(response && response.ok){
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

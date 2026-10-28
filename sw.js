/* Service Worker لتطبيق "شاهد على الأداء الوظيفي"
   ------------------------------------------------------------
   الهدف: فتح فوري كتطبيق حقيقي. ملفات التطبيق كلها (الصفحة، التنسيق،
   سكربتات app/*.js، الأيقونات) تُخزَّن على الجهاز، ويُفتح التطبيق منها
   مباشرة بلا انتظار الشبكة ("الكاش أولًا").

   كيف نضمن وصول التحديثات (درس حادثة سابقة: تحديث ظهر عند المطوّر ولم يظهر
   عند المستخدم لأن كاشًا قديمًا حجبه):
   1) اسم الكاش يحمل رقم الإصدار (CACHE_NAME). كل إصدار جديد يغيّر هذا الملف
      فيكتشفه المتصفح ويثبّت Service Worker جديدًا.
   2) التثبيت "كل شيء أو لا شيء": تُجلب كل الملفات من الشبكة مباشرة
      (cache:'no-store') إلى كاش الإصدار الجديد، فإن فشل أيٌّ منها يفشل
      التثبيت كله ويبقى الإصدار القديم سليمًا — فلا يحدث أبدًا خليط
      (صفحة جديدة مع سكربتات قديمة).
   3) عند التفعيل يُحذف كاش الإصدارات القديمة.
   4) نافذة "تحديث جديد متاح" (app-26) تعتمد على version.json من الشبكة،
      و"تحديث الآن" تنتظر تفعيل هذا الملف الجديد قبل إعادة التحميل.
   رقم الإصدار هنا يُرفع مع version.json وAPP_VERSION (اختبار يتحقق من التطابق).

   ما لا يفعله هذا الملف عمدًا:
   - لا يخزّن أي طلب لـ Supabase (API أو تخزين) ولا أي بيانات — البيانات
     دائمًا حيّة ومباشرة، صفر خطر لعرض بيانات قديمة أو بيانات مستخدم آخر.
   - لا يتدخل بأي طلب غير GET، ولا بأي طلب لنفس الأصل خارج قائمة APP_SHELL.
   - لا يخزّن version.json أبدًا (نافذة التحديث تقرؤه من الشبكة).
   - لا يعمل لو فُتح الملف عبر file:// — المتصفح نفسه يمنع ذلك خارج
     HTTPS/localhost، وهذا سلوك طبيعي متوقّع.
*/

const APP_VERSION_SW = '2.42';
const CACHE_NAME = 'shahid-shell-v' + APP_VERSION_SW;
/* الخطوط (خارجية): نخدمها من الكاش فورًا ونحدّثها بالخلفية.
   كاش منفصل لا يُحذف بتغيّر الإصدار. */
const EXT_CACHE = 'shahid-ext-v1';
const EXT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './vendor/supabase.umd.js',
  './vendor/jszip.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/html2canvas.min.js',
  './vendor/jspdf.umd.min.js',
  './app/app-01-core.js',
  './app/app-02-templates-data.js',
  './app/app-03-auth-home-risk.js',
  './app/app-04-academic-crm.js',
  './app/app-05-plan-goals.js',
  './app/app-06-self-assessment.js',
  './app/app-07-backup-export.js',
  './app/app-08-admin.js',
  './app/app-09-shahid-form.js',
  './app/app-10-programs.js',
  './app/app-11-support.js',
  './app/app-12-calendar.js',
  './app/app-13-tasks.js',
  './app/app-14-classroom-today.js',
  './app/app-15-student-profile.js',
  './app/app-16-attention-followups.js',
  './app/app-17-grades.js',
  './app/app-18-section-summary.js',
  './app/app-19-lesson-plans.js',
  './app/app-20-participation-homework.js',
  './app/app-21-performance-tasks.js',
  './app/app-22-customize.js',
  './app/app-23-custom-tools.js',
  './app/app-24-tests-sheet.js',
  './app/app-25-grade-weights.js',
  './app/app-26-update-check.js',
  './app/app-27-grade-periods.js',
  './app/app-28-grade-wizard.js',
  './app/app-29-grade-analysis.js',
  './app/app-30-grade-compare.js',
  './app/app-31-grade-rules.js',
  './app/app-32-trash.js',
  './app/app-33-shahid-batch.js'
];

/* بعض الاستضافات تحوّل /index.html إلى / فتأتي الاستجابة "redirected"، والمتصفح
   يرفض تسليمها لطلب تنقّل — نعيد بناءها نسخةً عادية قبل تخزينها */
async function cleanResponse(res){
  if(!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((u) =>
        fetch(new Request(u, { cache: 'no-store' })).then((res) => {
          if(!res.ok) throw new Error('shell fetch failed: ' + u + ' ' + res.status);
          return cleanResponse(res).then((clean) => cache.put(u, clean));
        })
      ))
    ).catch((err) =>
      /* لا نُبقي كاشًا ناقصًا: يفشل التثبيت ويستمر الإصدار القديم */
      caches.delete(CACHE_NAME).then(() => { throw err; })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== EXT_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if(req.method !== 'GET') return;

  /* مكتبات وخطوط خارجية: الكاش أولًا مع تحديث بالخلفية. الاستجابة المعتمة
     (no-cors) مقبولة هنا لأنها وسوم script/link لا نقرأ محتواها */
  if(url.origin !== self.location.origin){
    if(EXT_HOSTS.indexOf(url.hostname) === -1) return;
    event.respondWith(
      caches.open(EXT_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const networkFetch = fetch(req).then((res) => {
            if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  /* رقم الإصدار يُقرأ من الشبكة دائمًا (نافذة التحديث) — لا يُخزَّن ولا يُخدَّم من الكاش */
  if(url.pathname.endsWith('/version.json')) return;

  /* ملفات التطبيق: من كاش الإصدار الحالي. ما ليس فيه (كاستدعاءات api) يذهب للشبكة كما هو.
     التنقّل يتجاهل ?query فيفتح من الكاش حتى برابط فيه معاملات */
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req, { ignoreSearch: req.mode === 'navigate' }).then((cached) => cached || fetch(req))
    )
  );
});

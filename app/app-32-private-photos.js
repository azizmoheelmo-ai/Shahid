/* ============ صور الشواهد الخاصة: روابط موقّعة مؤقتة تُطبَّق عند العرض فقط ============
   حاوية "shawahid-photos" ستصير خاصة (public = false). الروابط المحفوظة بقاعدة البيانات تبقى كما هي تمامًا
   (الشكل .../object/public/shawahid-photos/<المسار>): لا نغيّر أي بيانات، ولا نكتب أبدًا رابطًا مؤقتًا بالقاعدة
   (أوامر "تراجع عن الحذف" تعيد إدراج الصف المحمَّل كما هو، فلو استبدلنا الروابط بالذاكرة لانكتبت روابط ميتة).
   بدل ذلك نبدّل الرابط عند العرض فقط:
   1) مراقب DOM يستبدل src/href لأي صورة أو رابط يشير إلى صورة بهذه الحاوية برابط موقّع صالح ساعة.
   2) photoFetch(url) و settlePhotosIn(el) لمواضع الجلب والطباعة التي لا تنتظر المراقب.
   لو فشل التوقيع يبقى الرابط الأصلي كما هو (يعمل ما دامت الحاوية عامة)، فلا يتعطل شيء أثناء الانتقال.
   لا يعتمد على سياسة سلبية: المعلم يوقّع لملفاته فقط، والمشرف بسياسة قراءة المشرف (is_admin). */
const PHOTO_BUCKET = 'shawahid-photos';
const PHOTO_SIGN_SECONDS = 3600;
const PHOTO_PUBLIC_MARK = '/storage/v1/object/public/' + PHOTO_BUCKET + '/';
const PHOTO_SELECTOR = 'img[src*="' + PHOTO_PUBLIC_MARK + '"], a[href*="' + PHOTO_PUBLIC_MARK + '"]';
const _photoSigned = new Map();   // المسار → { url, exp }
const _photoPending = new Map();  // المسار → وعد جارٍ (لا نطلب التوقيع مرتين)

/* مسار الملف داخل الحاوية من رابط عام لنا، وإلا null (رابط موقّع أو غريب أو ليس لحاويتنا) */
function photoPathOf(url){
  if(typeof url !== 'string') return null;
  const i = url.indexOf(PHOTO_PUBLIC_MARK);
  if(i < 0 || !url.startsWith(SUPABASE_URL)) return null;
  const rest = url.slice(i + PHOTO_PUBLIC_MARK.length).split(/[?#]/)[0];
  if(!rest || rest.indexOf('..') > -1) return null;
  try{ return decodeURIComponent(rest); }catch(e){ return null; }
}

function _photoCached(path){
  const hit = _photoSigned.get(path);
  return hit && hit.exp > Date.now() + 60000 ? hit.url : null;
}

/* رابط موقّع لرابط عام واحد؛ يرجع الرابط نفسه إن لم يكن من حاويتنا أو فشل التوقيع */
async function signPhotoUrl(url){
  const path = photoPathOf(url);
  if(!path) return url;
  const cached = _photoCached(path);
  if(cached) return cached;
  if(_photoPending.has(path)) return _photoPending.get(path);
  const p = (async () => {
    try{
      const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, PHOTO_SIGN_SECONDS);
      if(error || !data || !data.signedUrl) return url;
      _photoSigned.set(path, { url: data.signedUrl, exp: Date.now() + PHOTO_SIGN_SECONDS * 1000 });
      return data.signedUrl;
    }catch(e){ return url; }
    finally{ _photoPending.delete(path); }
  })();
  _photoPending.set(path, p);
  return p;
}

/* توقيع دفعة مسارات بطلب واحد (صفحة فيها عشرات الصور) */
async function _signPhotoPaths(paths){
  const need = [...new Set(paths)].filter(p => !_photoCached(p));
  for(let i = 0; i < need.length; i += 100){
    const chunk = need.slice(i, i + 100);
    try{
      const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(chunk, PHOTO_SIGN_SECONDS);
      if(error || !data) continue;
      data.forEach(d => { if(d && d.path && d.signedUrl && !d.error) _photoSigned.set(d.path, { url: d.signedUrl, exp: Date.now() + PHOTO_SIGN_SECONDS * 1000 }); });
    }catch(e){ /* يبقى الرابط الأصلي */ }
  }
}

/* بديل fetch للصور: يوقّع الرابط أولًا */
async function photoFetch(url, opts){
  return fetch(await signPhotoUrl(url), opts);
}

function _photoAttrOf(el){ return el.tagName === 'IMG' ? 'src' : 'href'; }

function _photoElementsIn(root){
  const out = [];
  if(!root || root.nodeType !== 1) return out;
  if(root.matches && root.matches(PHOTO_SELECTOR)) out.push(root);
  root.querySelectorAll(PHOTO_SELECTOR).forEach(e => out.push(e));
  return out;
}

/* يبدّل روابط العناصر دفعة واحدة. لا يكتب إلا إن بقي الرابط كما قرأناه (قد يتغير أثناء الانتظار) */
async function _swapPhotoElements(els){
  const items = els.map(el => ({ el, attr: _photoAttrOf(el), orig: el.getAttribute(_photoAttrOf(el)) }))
    .filter(x => photoPathOf(x.orig));
  if(!items.length) return [];
  await _signPhotoPaths(items.map(x => photoPathOf(x.orig)));
  const done = [];
  items.forEach(x => {
    const signed = _photoCached(photoPathOf(x.orig));
    if(signed && x.el.getAttribute(x.attr) === x.orig){ x.el.setAttribute(x.attr, signed); done.push(x.el); }
  });
  return done;
}

/* للطباعة: ننتظر توقيع كل صور العنصر وتحميلها قبل window.print */
async function settlePhotosIn(root){
  try{
    const swapped = await _swapPhotoElements(_photoElementsIn(root));
    const imgs = swapped.filter(e => e.tagName === 'IMG' && !(e.complete && e.naturalWidth));
    await Promise.all(imgs.map(img => new Promise(res => {
      const t = setTimeout(res, 8000);
      img.addEventListener('load', () => { clearTimeout(t); res(); }, { once: true });
      img.addEventListener('error', () => { clearTimeout(t); res(); }, { once: true });
    })));
  }catch(e){ /* لا يمنع الطباعة */ }
}

let _photoScanQueue = new Set(), _photoScanTimer = null;
function _queuePhotoScan(el){
  _photoScanQueue.add(el);
  if(_photoScanTimer) return;
  _photoScanTimer = setTimeout(async () => {
    _photoScanTimer = null;
    const batch = [..._photoScanQueue]; _photoScanQueue = new Set();
    const els = [];
    batch.forEach(n => { if(n.isConnected !== false) _photoElementsIn(n).forEach(e => els.push(e)); });
    try{ await _swapPhotoElements([...new Set(els)]); }catch(e){ /* يبقى الرابط الأصلي */ }
  }, 0);
}

function startPhotoGuard(){
  if(typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.documentElement) return;
  const mo = new MutationObserver(records => {
    records.forEach(r => {
      if(r.type === 'attributes') _queuePhotoScan(r.target);
      else r.addedNodes.forEach(n => { if(n.nodeType === 1) _queuePhotoScan(n); });
    });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
  _queuePhotoScan(document.documentElement);
}
if(typeof document !== 'undefined'){
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPhotoGuard);
  else startPhotoGuard();
}

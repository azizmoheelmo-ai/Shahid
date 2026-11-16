/* ============================================================
   رابط الاطلاع على الشواهد: /p/<رمز>  (app-52 ينشئه، وهذه الصفحة تعرضه)
   ------------------------------------------------------------
   صفحة قراءة فقط يرسلها المعلم لمديره أو مشرفه: شواهد دورة أداء واحدة مرتبة بعناصر الأداء.
   - الرمز وحده هو الصلاحية (كروابط التقرير والاستبانة والمؤشرات): عشوائي ≈70 بت، مدة حتى 120 يومًا، ويُلغى بحذفه.
   - الرمز الخاطئ والمنتهي والملغى وحساب المعلم المعطَّل: الرد نفسه تمامًا (لا يُكشف السبب)، ومحدِّد محاولات فاشلة.
   - مفتاح service_role يتجاوز RLS، فالقراءة مقيَّدة صراحةً: سجل الرابط بالرمز، ثم شواهد صاحبه (user_id) لدورته فقط.
   - كل نص مهرَّب؛ الصور تُقبل من حاوية shawahid-photos لمشروعنا فقط (وغيرها يُهمل)، والمستندات روابط لنفس الحاوية.
   - بلا سكربتات ولا تخزين مؤقت ولا فهرسة ولا Referer (فلا يتسرّب الرمز لطلبات الصور)، وCSP بـnonce للتنسيق وحده.
   متغيرات البيئة: SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (نفس api/s.js).
   ============================================================ */

const nodeCrypto = require('crypto');
const survey = require('./s.js');
const { createFailureLimiter, clientIp, escapeHtml, BUSY_TITLE, BUSY_MSG } = survey;

const CODE_RE = /^[a-z2-9]{14,32}$/;
const MAX_ROWS = 500;
const GONE_TITLE = 'الرابط غير متاح';
const GONE_MSG = 'هذا الرابط غير صالح أو انتهت مدته أو ألغاه صاحبه.';
const COLS = 'id, user_id, element_key, element_label, lesson_title, lesson_date, class_name, description, goal, steps, quant_impact, qual_impact, '
  + 'reflection, photo_urls, ref_number, source_type, source_note, teacher_name, school, subject, cycle_year, created_at';
/* مطابقة لـSHAHID_SOURCE_LABELS بـapp-51 (اختبار يتحقق) */
const SOURCE_LABELS = Object.freeze({
  lesson_plan: 'خطة درس في التطبيق',
  program_session: 'برنامج نشاط في التطبيق',
  task: 'مهمة أدائية مرصودة في التطبيق',
  followup: 'متابعة طالب في التطبيق',
  survey: 'استبانة رضا في التطبيق',
  lessons_month: 'رصد الحصص في التطبيق',
  test_analysis: 'تحليل نتائج اختبار في التطبيق',
  rubric_test: 'اختبار بسلّم تقدير في التطبيق'
});

const defaultLimiter = createFailureLimiter();

/* نفس getCycleYear بالتطبيق (app-04): الدورة تبدأ أغسطس */
function cycleYearOf(iso){
  const d = new Date(iso);
  if(isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

/* بادئة الصور المسموحة: حاوية shawahid-photos العامة لمشروعنا وحده */
function photoPrefix(supabaseUrl){
  return String(supabaseUrl || '').replace(/\/+$/, '') + '/storage/v1/object/public/shawahid-photos/';
}
function safeFileUrl(u, prefix){
  if(typeof u !== 'string' || !prefix || !u.startsWith(prefix)) return null;
  const rest = u.slice(prefix.length);
  return /^[A-Za-z0-9._\/%-]+$/.test(rest) && !rest.includes('..') ? u : null;
}
function isImagePath(u){ return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(u.split('?')[0]); }

/* يرجع { ok: true, share, rows, elements } أو { ok: false }؛ لا يميّز بين الخاطئ والمنتهي والملغى والمعطَّل. يرمي عند فشل القاعدة. */
async function resolvePortfolio(code, supabase, now){
  if(typeof code !== 'string' || !CODE_RE.test(code)) return { ok: false };
  const s = await supabase.from('portfolio_shares').select('teacher_id, cycle_year, expires_at, label').eq('code', code).maybeSingle();
  if(s.error) throw s.error;
  const share = s.data;
  if(!share || !share.teacher_id || !share.cycle_year) return { ok: false };
  if(!(new Date(share.expires_at).getTime() > (now || Date.now()))) return { ok: false };
  const p = await supabase.from('profiles').select('disabled').eq('id', share.teacher_id).maybeSingle();
  if(p.error) throw p.error;
  if(p.data && p.data.disabled) return { ok: false };
  const [inYear, noYear, els] = await Promise.all([
    supabase.from('shawahid').select(COLS).eq('user_id', share.teacher_id).eq('cycle_year', share.cycle_year)
      .order('lesson_date', { ascending: true }).limit(MAX_ROWS),
    /* شواهد قديمة بلا دورة مخزّنة: تُحسب دورتها من تاريخها كما يفعل التطبيق */
    supabase.from('shawahid').select(COLS).eq('user_id', share.teacher_id).is('cycle_year', null).limit(MAX_ROWS),
    supabase.from('performance_elements').select('key, label, sort_order').order('sort_order', { ascending: true })
  ]);
  if(inYear.error) throw inYear.error;
  if(noYear.error) throw noYear.error;
  const rows = (inYear.data || []).concat((noYear.data || []).filter(r => cycleYearOf(r.lesson_date || r.created_at) === share.cycle_year))
    .filter(r => r && r.user_id === share.teacher_id); /* دفاع إضافي: لا صف لغير صاحب الرابط مهما حدث بالاستعلام */
  return { ok: true, share, rows: rows.slice(0, MAX_ROWS), elements: els.error ? [] : (els.data || []) };
}

const CSS = ':root{--navy:#1B3245;--gold:#A9852E;--gold-text:#876A25;--paper:#F7F5F0;--card:#fff;--line:#D8D2C4;--ink:#232323;--muted:#6B6659;'
  + '--ok:#2F6B4F;--ok-bg:#E7F0EA;--divider:#EEE9DF;--icon-bg:#F1ECDF;--body:#4A4539}'
  + '*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;line-height:1.8}'
  + 'main{max-width:760px;margin:0 auto;padding:16px 16px 40px}'
  + '.hero{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px}'
  + '.hero h1{margin:0;font-size:1.25rem;color:var(--navy)}.hero p{margin:2px 0 0;font-size:.9rem;color:var(--muted)}'
  + '.ro{display:inline-block;margin-top:8px;font-size:.78rem;font-weight:700;color:var(--ok);background:var(--ok-bg);border-radius:999px;padding:2px 10px}'
  + '.sum{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:16px}'
  + '.sum a{display:flex;justify-content:space-between;gap:10px;padding:9px 14px;border-bottom:1px solid var(--divider);color:var(--navy);text-decoration:none;font-weight:600;font-size:.92rem}'
  + '.sum a:last-child{border-bottom:0}.sum b{flex:none;min-width:28px;text-align:center;background:var(--icon-bg);border-radius:6px;font-size:.85rem}'
  + 'h2{font-size:1.02rem;color:var(--navy);margin:22px 2px 8px;scroll-margin-top:10px}'
  + '.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:10px}'
  + '.card h3{margin:0;font-size:1rem;color:var(--navy);overflow-wrap:anywhere}.meta{font-size:.8rem;color:var(--muted)}'
  + '.src{display:inline-block;font-size:.78rem;color:var(--ok);background:var(--ok-bg);border-radius:999px;padding:1px 10px;margin:4px 0}'
  + '.f{margin-top:8px}.f small{display:block;font-size:.75rem;font-weight:700;color:var(--gold-text)}.f div,.f ol{font-size:.92rem;color:var(--body);white-space:pre-line;overflow-wrap:anywhere}'
  + '.f ol{margin:0;padding-inline-start:20px;white-space:normal}'
  + '.ph{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.ph img{width:150px;height:112px;object-fit:cover;border:1px solid var(--line);border-radius:8px;background:var(--paper)}'
  + '.doc{display:inline-block;margin-top:6px;font-size:.85rem;color:var(--navy)}'
  + '.empty{text-align:center;color:var(--muted);padding:30px 10px}.foot{margin-top:24px;text-align:center;font-size:.78rem;color:var(--muted)}'
  + '.center{text-align:center;padding-top:15vh}h2 .cnt{font-weight:400;color:var(--muted);font-size:.9rem}'
  + '@media print{body{background:#fff}.card,.hero,.sum{break-inside:avoid}}';

function head(title, nonce){
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + `<title>${escapeHtml(title)}</title><style nonce="${escapeHtml(nonce)}">${CSS}</style></head>`;
}

function buildMessagePage(title, message, nonce){
  return head(title, nonce) + `<body><main class="center"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function dateText(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function field(label, text){
  return typeof text === 'string' && text.trim() ? `<div class="f"><small>${escapeHtml(label)}</small><div>${escapeHtml(text.trim())}</div></div>` : '';
}

function cardHtml(r, prefix){
  const steps = Array.isArray(r.steps) ? r.steps.filter(x => typeof x === 'string' && x.trim()) : [];
  const files = (Array.isArray(r.photo_urls) ? r.photo_urls : []).map(u => safeFileUrl(u, prefix)).filter(Boolean);
  const imgs = files.filter(isImagePath).slice(0, 6);
  const docs = files.filter(u => !isImagePath(u));
  const src = SOURCE_LABELS[r.source_type] ? SOURCE_LABELS[r.source_type] + (r.source_note ? ' — ' + r.source_note : '') : '';
  /* التاريخ داخل bdi باتجاه يسار-يمين فلا ينقلب وسط النص العربي */
  const meta = [dateText(r.lesson_date) ? `<bdi dir="ltr">${escapeHtml(dateText(r.lesson_date))}</bdi>` : '',
    r.class_name ? escapeHtml(String(r.class_name)) : '', r.ref_number ? 'الرقم المرجعي ' + escapeHtml(String(r.ref_number)) : ''].filter(Boolean).join(' · ');
  return `<article class="card"><h3>${escapeHtml(r.lesson_title || r.class_name || 'شاهد')}</h3>`
    + (meta ? `<div class="meta">${meta}</div>` : '')
    + (src ? `<div class="src">مصدره: ${escapeHtml(src)}</div>` : '')
    + field('الوصف', r.description) + field('الهدف', r.goal)
    + (steps.length ? `<div class="f"><small>خطوات التنفيذ</small><ol>${steps.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol></div>` : '')
    + field('الأثر الكمي', r.quant_impact) + field('الأثر النوعي', r.qual_impact) + field('تأمل المعلم', r.reflection)
    + (imgs.length ? `<div class="ph">${imgs.map(u => `<img src="${escapeHtml(u)}" alt="صورة الشاهد" loading="lazy">`).join('')}</div>` : '')
    + docs.map((u, i) => `<a class="doc" href="${escapeHtml(u)}" rel="noopener noreferrer" target="_blank">مستند مرفق ${docs.length > 1 ? i + 1 : ''}</a>`).join(' ')
    + '</article>';
}

function buildPortfolioPage(found, nonce, supabaseUrl){
  const prefix = photoPrefix(supabaseUrl);
  const rows = found.rows || [];
  const first = rows.find(r => r.teacher_name) || {};
  const order = new Map((found.elements || []).map((e, i) => [e.key, i]));
  const groups = new Map();
  rows.forEach(r => {
    const k = r.element_key || '';
    if(!groups.has(k)) groups.set(k, { label: r.element_label || 'بلا عنصر', rows: [] });
    groups.get(k).rows.push(r);
  });
  const sorted = [...groups.entries()].sort((a, b) => (order.has(a[0]) ? order.get(a[0]) : 999) - (order.has(b[0]) ? order.get(b[0]) : 999));
  const sub = [first.school, first.subject].filter(Boolean).map(x => escapeHtml(x)).join(' — ');
  const until = dateText(found.share.expires_at);
  const hero = `<header class="hero"><h1>شواهد الأداء الوظيفي${first.teacher_name ? ' — ' + escapeHtml(first.teacher_name) : ''}</h1>`
    + (sub ? `<p>${sub}</p>` : '')
    + `<p>دورة الأداء ${escapeHtml(found.share.cycle_year)} · ${rows.length} ${rows.length === 1 ? 'شاهد' : (rows.length === 2 ? 'شاهدان' : 'شاهدًا')}</p>`
    + `<span class="ro">للاطلاع فقط${until ? ` · متاح حتى <bdi dir="ltr">${escapeHtml(until)}</bdi>` : ''}</span></header>`;
  if(!rows.length){
    return head('شواهد الأداء الوظيفي', nonce) + `<body><main>${hero}<div class="empty">لا شواهد في هذه الدورة بعد.</div></main></body></html>`;
  }
  const sum = `<nav class="sum">${sorted.map(([, g], i) => `<a href="#e${i}"><span>${escapeHtml(g.label)}</span><b>${g.rows.length}</b></a>`).join('')}</nav>`;
  const body = sorted.map(([, g], i) => `<section><h2 id="e${i}">${escapeHtml(g.label)} <span class="cnt">· ${g.rows.length}</span></h2>${g.rows.map(r => cardHtml(r, prefix)).join('')}</section>`).join('');
  return head('شواهد الأداء الوظيفي', nonce)
    + `<body><main>${hero}${sum}${body}<p class="foot">أرسل المعلم هذا الرابط بنفسه، ويستطيع إلغاءه متى شاء.</p></main></body></html>`;
}

function securityHeaders(res, nonce, supabaseUrl){
  let imgOrigin = '';
  try { imgOrigin = new URL(supabaseUrl).origin; } catch(e){ imgOrigin = ''; }
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; "
    + `style-src 'nonce-${nonce}'; ` + (imgOrigin ? `img-src ${imgOrigin}; ` : '')
    + "base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
}

function sendPage(res, status, body, nonce, supabaseUrl){
  res.status(status);
  securityHeaders(res, nonce, supabaseUrl);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(body);
}

/* opts: { createClient, url, key, limiter } للاختبار؛ الافتراضي: متغيرات البيئة والحزمة تُحمَّل عند الطلب فقط. */
function createHandler(opts){
  opts = opts || {};
  const limiter = opts.limiter || defaultLimiter;
  return async function handler(req, res){
    const url = opts.url !== undefined ? opts.url : process.env.SUPABASE_URL;
    const key = opts.key !== undefined ? opts.key : process.env.SUPABASE_SERVICE_ROLE_KEY;
    const nonce = nodeCrypto.randomBytes(16).toString('base64');
    if(req.method !== 'GET' && req.method !== 'HEAD'){
      res.setHeader('Allow', 'GET, HEAD');
      return sendPage(res, 405, buildMessagePage('غير مسموح', 'هذه الصفحة للاطلاع فقط.', nonce), nonce, url);
    }
    const ip = clientIp(req);
    const wait = limiter.blockedFor(ip);
    if(wait){
      res.setHeader('Retry-After', String(wait));
      return sendPage(res, 429, buildMessagePage(BUSY_TITLE, BUSY_MSG, nonce), nonce, url);
    }
    if(!url || !key) return sendPage(res, 503, buildMessagePage('الخدمة غير متاحة', 'حاول لاحقًا.', nonce), nonce, url);
    const raw = req.query && req.query.c;
    const code = Array.isArray(raw) ? raw[0] : raw;
    const gone = () => { limiter.fail(ip); return sendPage(res, 404, buildMessagePage(GONE_TITLE, GONE_MSG, nonce), nonce, url); };
    if(typeof code !== 'string' || !CODE_RE.test(code)) return gone();
    const createClient = opts.createClient || require('@supabase/supabase-js').createClient;
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    let found;
    try { found = await resolvePortfolio(code, supabase); } catch(e){ found = null; }
    if(!found) return sendPage(res, 503, buildMessagePage('الخدمة غير متاحة', 'حاول لاحقًا.', nonce), nonce, url);
    if(!found.ok) return gone();
    return sendPage(res, 200, buildPortfolioPage(found, nonce, url), nonce, url);
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.resolvePortfolio = resolvePortfolio;
module.exports.buildPortfolioPage = buildPortfolioPage;
module.exports.safeFileUrl = safeFileUrl;
module.exports.photoPrefix = photoPrefix;
module.exports.cycleYearOf = cycleYearOf;
module.exports.SOURCE_LABELS = SOURCE_LABELS;
module.exports.CODE_RE = CODE_RE;

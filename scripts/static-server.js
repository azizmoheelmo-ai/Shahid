'use strict';
/* ============================================================
   خادم ملفات ثابتة بسيط (بلا أي اعتمادية خارجية) — يُستخدم فقط لتشغيل
   اختبارات Playwright محليًا/بـCI (playwright.config.js)، لا علاقة له
   بالنشر الفعلي (Vercel يخدم الملفات الثابتة مباشرة بمشروع الإنتاج).
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(ROOT, relPath));

  /* منع الخروج خارج جذر المشروع (path traversal) — لا حاجة حقيقية له بخادم
     اختبار محلي، لكن انضباط أساسي لأي خادم يخدم مسارات من الطلب مباشرة */
  if(!filePath.startsWith(ROOT)){
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if(err){
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('غير موجود: ' + relPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`static server: http://127.0.0.1:${PORT}`);
});

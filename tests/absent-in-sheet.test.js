'use strict';
/* ============================================================
   الغائب في المشاركة والأدوات (بطلب صاحب التطبيق، الإصدار 1.3):
   - عليه "غائب" بلون واضح (لا باهت).
   - + و− (والأدوات) تعمل له مباشرة بلا نافذة ولا سؤال.
   - لا يُمسّ حضوره (يُغيَّر من تبويب "حضور" فقط).
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

function client(log){
  return {
    from(table){ const a = { select: () => a, eq: () => a, in: () => a, order: () => a, limit: () => a, upsert: () => a,
      then: (r, j) => { log.push({ table }); return Promise.resolve({ data: [], error: null }).then(r, j); } }; return a; },
    rpc(name, args){ log.push({ rpc: name, args }); return Promise.resolve({ data: 4, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
}
const get = (app, e) => runInAppContext(app, e);

function sheet(){
  const log = [];
  const app = loadApp({ supabaseClient: client(log), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__modal = []; showInfoModal = h => window.__modal.push(h);
    window.__tiles = {};
    const _g = document.getElementById;
    document.getElementById = id => {
      if(id.indexOf('crmPart_') !== 0) return _g(id);
      if(!window.__tiles[id]){
        const cls = new Set();
        window.__tiles[id] = { cls, classList: { toggle: (c, on) => on ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) }, querySelector: () => ({ innerHTML: '' }) };
      }
      return window.__tiles[id];
    };
    crmStudents = [{ id: 'a', full_name: 'عاصم', section_id: 'S' }, { id: 'b', full_name: 'خليل', section_id: 'S' }];
    crmSheet = { sectionId: 'S', dateIso: '2026-10-20', period: 2, token: 1, mode: 'participation', lessonId: 'L1',
      states: { a: 'absent', b: 'present' },
      part: { column: { id: 'C', name: 'مشاركة', max_score: 10 }, scores: new Map([['a', 3], ['b', 6]]), today: {}, undo: [], queue: new Map(), toolId: null, full: false, step: 1 } };`);
  return { app, log };
}

test('الغائب: + و− تُحسبان مباشرة بلا نافذة، وعليه "غائب"، وحضوره لا يُمسّ', async () => {
  const { app, log } = sheet();
  app.tapCrmParticipation('a', 1);
  app.tapCrmParticipation('a', -1);
  await get(app, 'Promise.all([...crmSheet.part.queue.values()])');
  assert.equal(get(app, 'window.__modal.length'), 0, 'لا نافذة');
  assert.deepEqual(log.filter(l => l.rpc).map(l => l.rpc + ':' + l.args.p_delta), ['increment_grade_score:1', 'increment_grade_score:-1']);
  assert.ok(get(app, `window.__tiles['crmPart_a'].cls.has('is-absent')`), '"غائب" ظاهرة');
  assert.ok(!get(app, `window.__tiles['crmPart_b'] ? window.__tiles['crmPart_b'].cls.has('is-absent') : false`));
  assert.equal(get(app, 'crmSheet.states.a'), 'absent');
  assert.equal(log.filter(l => l.table === 'classroom_attendance' || l.rpc === 'save_lesson_attendance').length, 0);
});

test('الأدوات الخاصة: الغائب معلَّم والضغط عليه يرصد مباشرة', async () => {
  const { app } = sheet();
  runInAppContext(app, `
    crmCustomTools = [{ id: 'T', name: 'إحضار الكتاب', tool_type: 'status', category: 'performance', max_score: 2, hidden: false }];
    window.__set = 0; setCrmToolValue = () => { window.__set++; };
    crmSheet.tool = { tool: crmCustomTools[0], values: new Map(), queue: new Map() };`);
  app.tapCrmTool('a');
  assert.equal(get(app, 'window.__set'), 1);
  assert.equal(get(app, 'window.__modal.length'), 0);
  assert.equal(get(app, 'crmAbsentClass(crmSheet, "a")'), ' is-absent');
  assert.equal(get(app, 'crmAbsentClass(crmSheet, "b")'), '');
});

test('المستطيل يحمل "غائب" (تظهر للغائب فقط بالتنسيق)، والغائب غير باهت', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  assert.match(css, /\.crm-absent-badge\{display:none;/);
  assert.match(css, /\.is-absent \.crm-absent-badge\{display:inline-block;\}/);
  assert.doesNotMatch(css, /\.is-absent[^{]*\{[^}]*opacity:\s*\.45/, 'لا إبهات للغائب');
});

test('بطاقة الغائب في المشاركة والأدوات بنفس لون "غائب" في الحضور (لا تقارب لون الحاضر)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const rule = sel => { const m = css.match(new RegExp(sel.replace(/[.-]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[1] : ''; };
  const att = rule('.crm-att-btn.state-absent');
  const part = rule('.crm-att-btn.is-absent');
  const bg = r => (r.match(/background:([^;]+)/) || [])[1];
  const border = r => (r.match(/border-color:([^;]+)/) || [])[1];
  assert.ok(bg(att));
  assert.equal(bg(part), bg(att));
  assert.equal(border(part), border(att));
});

'use strict';
/* أداة مشتركة لاختبارات الاستبانات (app-44 تفاصيل، app-45 الأدوات): قاعدة بيانات وهمية بذاكرة،
   ودوام DOM مصغَّر. ليست اختبارًا بذاتها (لا تُشغَّل ضمن tests/*.test.js). */
const { loadApp, runInAppContext } = require('./load-app');

function makeApp(opts){
  opts = opts || {};
  const log = [];
  const db = {
    survey_campaigns: (opts.campaigns || []).map(c => Object.assign({}, c)),
    survey_campaign_sections: (opts.sections || []).map(c => Object.assign({}, c)),
    survey_invites: (opts.invites || []).map(c => Object.assign({}, c)),
    survey_responses: (opts.responses || []).map(c => Object.assign({}, c))
  };
  let seq = 0;
  const sb = {
    from(table){
      const f = {}; let op = 'select', values = null, single = false, maybe = false, rng = null, ret = false;
      const api = {
        select(){ if(op === 'insert') ret = true; return api; }, order(){ return api; }, limit(){ return api; },
        range(a, b){ rng = [a, b]; return api; },
        eq(c, v){ f[c] = v; return api; }, is(c, v){ f[c] = null; return api; },
        insert(v){ op = 'insert'; values = v; return api; }, update(v){ op = 'update'; values = v; return api; },
        delete(){ op = 'delete'; return api; },
        single(){ single = true; return api; }, maybeSingle(){ maybe = true; return api; },
        then(res, rej){
          log.push({ table, op, values, f: Object.assign({}, f), rng });
          const t = db[table];
          let data = null, error = null;
          const fail = opts.fail && opts.fail(table, op, values);
          if(fail){ error = fail; }
          else if(op === 'select'){
            data = t.filter(r => Object.keys(f).every(k => !(k in r) || f[k] === null || r[k] === f[k]));
            if(rng) data = data.slice(rng[0], rng[1] + 1);
            if(single || maybe) data = data[0] || null;
          } else if(op === 'insert'){
            const arr = Array.isArray(values) ? values : [values];
            const made = arr.map(r => Object.assign({ id: table + (++seq), status: 'open', sort_order: 0, min_results: 5, closes_at: new Date(Date.now() + 864e5 * 14).toISOString(), sent_at: null, answered_on: null, created_at: new Date().toISOString() }, r));
            made.forEach(r => t.push(r));
            if(ret) data = single ? made[0] : made;
          } else if(op === 'update'){
            t.filter(r => Object.keys(f).every(k => !(k in r) || f[k] === null || r[k] === f[k])).forEach(r => Object.assign(r, values));
          } else if(op === 'delete'){
            const keep = t.filter(r => !Object.keys(f).every(k => !(k in r) || f[k] === null || r[k] === f[k]));
            t.length = 0; keep.forEach(r => t.push(r));
          }
          return Promise.resolve({ data, error }).then(res, rej);
        }
      };
      return api;
    },
    rpc(name, args){
      log.push({ rpc: true, name, args });
      if(opts.rpc){ const r = opts.rpc(name, args, db); if(r) return Promise.resolve(r); }
      if(name === 'delete_survey'){
        /* يحاكي الدالة: المالك فقط، ويحذف الردود والتذاكر والروابط ثم الاستبانة */
        const c = db.survey_campaigns.find(x => x.id === args.p_id && x.teacher_id === 'u1');
        if(!c) return Promise.resolve({ data: false, error: null });
        ['survey_responses', 'survey_invites', 'survey_campaign_sections'].forEach(t => { const keep = db[t].filter(r => r.campaign_id !== c.id); db[t].length = 0; keep.forEach(r => db[t].push(r)); });
        db.survey_campaigns.splice(db.survey_campaigns.indexOf(c), 1);
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
  };
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__confirm = ${opts.confirm === false ? 'false' : 'true'}; showConfirm = async () => window.__confirm;
    const els = {};
    window.__els = els;
    const mk = () => ({ style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', setAttribute(){}, parentNode: null });
    ['toolsView', 'toolsBody', 'toolsTitle', 'topTitle'].forEach(id => { els[id] = mk(); });
    els.toolsView.style.display = 'none';
    document.getElementById = id => {
      if(id === 'confirmModal') return { style: { display: 'none' } };
      if(id === 'crmYearInput') return { value: '1448-1449' };
      if(els[id]) return els[id];
      if(/View$/.test(id)) return (els[id] = mk());
      return null;
    };
    document.createElement = () => mk();
    document.body = { appendChild(el){ els[el.id] = el; el.parentNode = document.body; els.svSheet = mk(); }, removeChild(el){ delete els[el.id]; delete els.svSheet; } };
    document.addEventListener = () => {}; document.removeEventListener = () => {};
    crmGradeLevels = [{ id: 'g1', name: 'ثاني ثانوي' }];
    crmSections = ${JSON.stringify(opts.sectionsData || [{ id: 'sec1', name: '1', grade_level_id: 'g1' }, { id: 'sec2', name: '2', grade_level_id: 'g1' }])};
    crmStudents = ${JSON.stringify(opts.students || [])};
    toolsEnsureStructure = async () => {};
    location = { origin: 'https://app.example' };
    let __n = 0; crypto = { getRandomValues: a => { __n++; for(let i = 0; i < a.length; i++) a[i] = (i * 7 + __n * 13) % 248; return a; } };`);
  return { app, log, db };
}

const FUTURE = () => new Date(Date.now() + 864e5).toISOString();
const GOOD = { q1: 5, q2: 4, q3: 3, q4: true, q5: false, q6: 1, q7: 5, q8: 'ممتاز', q9: 'أتمنى المزيد' };
const J = v => JSON.parse(JSON.stringify(v));

module.exports = { makeApp, runInAppContext, FUTURE, GOOD, J };

'use strict';
/* أدوات مشتركة لاختبارات سلة المحذوفات: تُضيف لأي عميل Supabase وهمي
   - جدول deleted_items (insert/select/delete) يُسجَّل في store.items
   - دالة restore_deleted_item (rpc) تُسجَّل في store.restored
   - .range() على بقية الجداول (الوهمي يتجاهل الصفحات لأن البذور صغيرة)
   store.failInsert: خطأ يُرجَع عند حفظ اللقطة (لاختبار المتابعة بلا سلة) */

function withTrashSupport(client, store) {
  store.items = store.items || [];
  store.restored = store.restored || [];
  store.discarded = store.discarded || [];
  store.events = store.events || [];
  const baseFrom = client.from.bind(client);
  client.from = (table) => {
    if (table === 'deleted_items') {
      const filters = [];
      const api = {
        insert(row) {
          if (store.failInsert) return { select: () => ({ single: async () => ({ data: null, error: store.failInsert }) }) };
          const id = 'T' + (store.items.length + 1);
          store.items.push(Object.assign({ id }, row));
          store.events.push('save');
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
        },
        select() { return api; }, order() { return api; }, limit() { return api; }, lt() { return api; }, neq() { return api; },
        eq(c, v) { filters.push([c, v]); return api; },
        delete() {
          const ch = {
            eq(c, v) { filters.push([c, v]); return ch; },
            then(res) {
              const idf = filters.find(f => f[0] === 'id');
              if (idf) { store.discarded.push(idf[1]); store.items = store.items.filter(i => i.id !== idf[1]); }
              store.events.push('discard');
              res({ data: null, error: null });
            },
          };
          return ch;
        },
        then(res) { res({ data: store.items.filter(i => filters.every(([c, v]) => i[c] === v)), error: null }); },
      };
      return api;
    }
    const api = baseFrom(table);
    if (!api.range) api.range = () => api;
    return api;
  };
  const baseRpc = client.rpc ? client.rpc.bind(client) : null;
  client.rpc = (name, args) => {
    if (name === 'restore_deleted_item') {
      store.restored.push(args.p_id);
      return Promise.resolve({ data: store.restoreResult || { kind: 'student', rows: 1, meta: {} }, error: store.restoreError || null });
    }
    return baseRpc ? baseRpc(name, args) : Promise.resolve({ data: null, error: null });
  };
  return client;
}

/* يسجّل في store.events كل نداء delete() على جداول التطبيق ('delete:الجدول') لفحص الترتيب: لقطة ثم حذف */
function recordDeletes(client, store) {
  store.events = store.events || [];
  const baseFrom = client.from.bind(client);
  client.from = (table) => {
    const api = baseFrom(table);
    if (table !== 'deleted_items' && api.delete) {
      const d = api.delete.bind(api);
      api.delete = (...a) => { store.events.push('delete:' + table); return d(...a); };
    }
    return api;
  };
  return client;
}

const tick = (ms) => new Promise(r => setTimeout(r, ms === undefined ? 20 : ms));

/* جدول→صفوف لقطة */
function snapshotRows(item, table) {
  const spec = item.payload.tables.find(t => t.t === table);
  return spec ? [...spec.rows] : [];
}

module.exports = { withTrashSupport, recordDeletes, tick, snapshotRows };

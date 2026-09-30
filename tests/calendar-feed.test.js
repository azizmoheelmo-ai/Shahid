'use strict';
/* اختبارات رابط اشتراك التقويم (api/calendar-feed.js) — بلا أي اتصال
   شبكي حقيقي. يركّز على: (1) authenticateFeedToken يرفض أي رمز غير
   صحيح/مُلغى/بتصنيف مختلف (خصوصًا رمز موصل الذكاء الاصطناعي — يجب ألا
   يعمل هنا)، (2) دوال بناء ICS الصرفة (escapeIcsText/foldIcsLine/
   buildIcsEvents/renderIcs) تُنتج نصًا صحيحًا ومطابقًا لـRFC 5545 بالحد
   الأدنى المطلوب. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  hashToken, authenticateFeedToken, formatIcsDate, addOneDay, escapeIcsText,
  foldIcsLine, buildWeekLabelDateIndex, buildIcsEvents, renderIcs, CALENDAR_FEED_TOKEN_LABEL,
} = require('../api/calendar-feed.js');

/* نفس نمط الكائن الوهمي بـtests/mcp-connector.test.js (select/eq/
   maybeSingle/rpc) — كافٍ تمامًا لـauthenticateFeedToken وحدها. */
function makeFakeSupabase(seedByTable){
  function chain(table){
    const filters = [];
    const matchingRows = () => (seedByTable[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
    const api = {
      select(){ return api; },
      eq(col, val){ filters.push([col, val]); return api; },
      update(patch){
        return { eq(col, val){ (seedByTable[table] || []).filter(r => r[col] === val).forEach(r => Object.assign(r, patch)); return Promise.resolve({ data: null, error: null }); } };
      },
      maybeSingle: async () => ({ data: matchingRows()[0] || null, error: null }),
    };
    return api;
  }
  async function rpc(fnName, args){
    if(fnName !== 'check_mcp_rate_limit') return { data: null, error: { message: 'unknown rpc: ' + fnName } };
    const row = (seedByTable.personal_access_tokens || []).find(r => r.id === args.p_token_id);
    return { data: !!row, error: null };
  }
  return { from: chain, rpc };
}

describe('authenticateFeedToken', () => {
  test('رمز غير موجود بالقاعدة يُرفَض', async () => {
    const sb = makeFakeSupabase({ personal_access_tokens: [] });
    const result = await authenticateFeedToken('raw-token', sb);
    assert.equal(result.userId, null);
    assert.equal(result.reason, 'invalid_token');
  });

  test('بلا رمز إطلاقًا (رابط ناقص) يُرفَض بسبب missing_token', async () => {
    const sb = makeFakeSupabase({ personal_access_tokens: [] });
    const result = await authenticateFeedToken(null, sb);
    assert.equal(result.reason, 'missing_token');
  });

  test('رمز موصل الذكاء الاصطناعي (تصنيف مختلف) لا يعمل هنا', async () => {
    const raw = 'raw-mcp-token';
    const sb = makeFakeSupabase({
      personal_access_tokens: [{ id: 't1', user_id: 'u1', label: 'موصل الذكاء الاصطناعي', token_hash: hashToken(raw), revoked_at: null, expires_at: null }],
    });
    const result = await authenticateFeedToken(raw, sb);
    assert.equal(result.userId, null);
    assert.equal(result.reason, 'invalid_token');
  });

  test('رمز صحيح بتصنيف "رابط تقويم ICS" يُقبَل', async () => {
    const raw = 'raw-calendar-token';
    const sb = makeFakeSupabase({
      personal_access_tokens: [{ id: 't2', user_id: 'u2', label: CALENDAR_FEED_TOKEN_LABEL, token_hash: hashToken(raw), revoked_at: null, expires_at: null, rate_window_start: null, rate_window_count: 0 }],
    });
    const result = await authenticateFeedToken(raw, sb);
    assert.equal(result.userId, 'u2');
    assert.equal(result.reason, 'ok');
  });

  test('رمز مُلغى يُرفَض بسبب revoked_token', async () => {
    const raw = 'raw-revoked';
    const sb = makeFakeSupabase({
      personal_access_tokens: [{ id: 't3', user_id: 'u3', label: CALENDAR_FEED_TOKEN_LABEL, token_hash: hashToken(raw), revoked_at: '2026-01-01T00:00:00Z', expires_at: null }],
    });
    const result = await authenticateFeedToken(raw, sb);
    assert.equal(result.reason, 'revoked_token');
  });

  test('رمز منتهي الصلاحية يُرفَض بسبب expired_token', async () => {
    const raw = 'raw-expired';
    const sb = makeFakeSupabase({
      personal_access_tokens: [{ id: 't4', user_id: 'u4', label: CALENDAR_FEED_TOKEN_LABEL, token_hash: hashToken(raw), revoked_at: null, expires_at: '2020-01-01T00:00:00Z' }],
    });
    const result = await authenticateFeedToken(raw, sb);
    assert.equal(result.reason, 'expired_token');
  });
});

describe('formatIcsDate / addOneDay', () => {
  test('formatIcsDate يحذف الشرطات (YYYY-MM-DD → YYYYMMDD)', () => {
    assert.equal(formatIcsDate('2026-09-30'), '20260930');
  });
  test('addOneDay يضيف يومًا واحدًا بصيغة ISO', () => {
    assert.equal(addOneDay('2026-09-30'), '2026-10-01');
  });
  test('addOneDay يتعامل صحيحًا مع نهاية الشهر/السنة', () => {
    assert.equal(addOneDay('2026-12-31'), '2027-01-01');
  });
});

describe('escapeIcsText', () => {
  test('يُفلت الفاصلة والفاصلة المنقوطة والشرطة المائلة العكسية وسطر جديد', () => {
    assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  });
  test('قيمة فارغة/غير مُعرَّفة تُرجع نصًا فارغًا بلا خطأ', () => {
    assert.equal(escapeIcsText(null), '');
    assert.equal(escapeIcsText(undefined), '');
  });

  test('لا يترك \\r منفردًا بلا \\n تابع له (منع حقن أسطر/حقول ICS مزيَّفة)', () => {
    // عنوان شاهد/مهمة مُدخَل من المستخدم قد يحوي \r وحدها (بلا \n) — لو نجت
    // بلا تفليت، تصلح كفاصل سطر فعلي ببعض عملاء iCal فتحقن حقولًا مزيَّفة
    const malicious = 'عادي\rEND:VEVENT\r\nBEGIN:VEVENT\rSUMMARY:محقون';
    const escaped = escapeIcsText(malicious);
    assert.ok(!escaped.includes('\r'), 'يجب ألا يبقى أي \\r خام بالنص المُفلَت');
    assert.ok(!escaped.includes('\n'), 'يجب ألا يبقى أي \\n خام بالنص المُفلَت');
  });
});

describe('foldIcsLine', () => {
  test('سطر قصير (٧٥ محرفًا فأقل) يبقى كما هو', () => {
    const line = 'SUMMARY:قصير';
    assert.equal(foldIcsLine(line), line);
  });
  test('سطر طويل يُطوى بأسطر متابعة تبدأ كل منها بمسافة', () => {
    const longLine = 'SUMMARY:' + 'أ'.repeat(100);
    const folded = foldIcsLine(longLine);
    const parts = folded.split('\r\n');
    assert.ok(parts.length > 1);
    for(let i = 1; i < parts.length; i++) assert.equal(parts[i][0], ' ');
    // إعادة تجميع الأسطر (حذف \r\n ومسافة البادئة) يُعيد النص الأصلي بالضبط
    const rejoined = parts[0] + parts.slice(1).map(p => p.slice(1)).join('');
    assert.equal(rejoined, longLine);
  });
});

describe('buildWeekLabelDateIndex', () => {
  test('يأخذ أول ظهور زمنيًا لكل اسم أسبوع', () => {
    const weeks = [
      { week_label: 'الأسبوع الأول', gregorian_date: '2026-08-30' },
      { week_label: 'الأسبوع الأول', gregorian_date: '2027-01-17' },
    ];
    const index = buildWeekLabelDateIndex(weeks);
    assert.equal(index['الأسبوع الأول'], '2026-08-30');
  });
});

describe('buildIcsEvents', () => {
  test('يبني حدث إجازة واحدًا من صفَّي "تبدأ"/"تنتهي" بنفس الاسم', () => {
    const events = buildIcsEvents({
      weeks: [], programs: [], shawahid: [], tasks: [],
      holidays: [
        { holiday_name: 'إجازة الخريف', event_label: 'تبدأ إجازة الخريف', gregorian_date: '2026-11-20' },
        { holiday_name: 'إجازة الخريف', event_label: 'تنتهي الاجازة', gregorian_date: '2026-11-28' },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].summary, 'إجازة الخريف');
    assert.equal(events[0].start, '2026-11-20');
    assert.equal(events[0].endExclusive, '2026-11-29'); // اليوم التالي لتاريخ "تنتهي"
  });

  test('شاهد بتاريخ درس يظهر كحدث بعنوانه', () => {
    const events = buildIcsEvents({
      weeks: [], programs: [], holidays: [], tasks: [],
      shawahid: [{ id: 's1', lesson_title: 'درس القسمة', lesson_date: '2026-10-05' }],
    });
    assert.equal(events.length, 1);
    assert.match(events[0].summary, /درس القسمة/);
  });

  test('مهمة مُنجَزة أو بلا تاريخ استحقاق لا تظهر بالتقويم', () => {
    const events = buildIcsEvents({
      weeks: [], programs: [], holidays: [], shawahid: [],
      tasks: [
        { id: 't1', title: 'منجَزة', due_date: '2026-10-05', done: true },
        { id: 't2', title: 'بلا تاريخ', due_date: null, done: false },
        { id: 't3', title: 'نشطة', due_date: '2026-10-06', done: false },
      ],
    });
    assert.equal(events.length, 1);
    assert.match(events[0].summary, /نشطة/);
  });

  test('جلسة برنامج تُحل لتاريخ فعلي عبر week_label', () => {
    const events = buildIcsEvents({
      holidays: [], shawahid: [], tasks: [],
      weeks: [{ week_label: 'الأسبوع الرابع', gregorian_date: '2026-09-20' }],
      programs: [{ id: 'p1', name: 'الإسعافات الأولية', sessions: [{ session_no: 1, week_label: 'الأسبوع الرابع' }] }],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].start, '2026-09-20');
  });

  test('جلسة برنامج بـweek_label غير موجود بجدول الأسابيع تُستبعَد بصمت', () => {
    const events = buildIcsEvents({
      holidays: [], shawahid: [], tasks: [], weeks: [],
      programs: [{ id: 'p1', name: 'برنامج', sessions: [{ session_no: 1, week_label: 'أسبوع غير معروف' }] }],
    });
    assert.equal(events.length, 0);
  });
});

describe('renderIcs', () => {
  test('يبدأ بـBEGIN:VCALENDAR وينتهي بـEND:VCALENDAR', () => {
    const ics = renderIcs([]);
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
  });

  test('كل حدث يُنتج كتلة VEVENT كاملة بحقولها الأساسية', () => {
    const ics = renderIcs([{ uid: 'x-1', start: '2026-09-30', endExclusive: '2026-10-01', summary: 'اختبار' }]);
    assert.match(ics, /BEGIN:VEVENT\r\n/);
    assert.match(ics, /UID:x-1@shahid-app\.vercel\.app\r\n/);
    assert.match(ics, /DTSTART;VALUE=DATE:20260930\r\n/);
    assert.match(ics, /DTEND;VALUE=DATE:20261001\r\n/);
    assert.match(ics, /SUMMARY:اختبار\r\n/);
    assert.match(ics, /END:VEVENT\r\n/);
  });
});

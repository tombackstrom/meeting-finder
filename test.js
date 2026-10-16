// Created by Claude (model: Claude Sonnet 5.5, Anthropic). AI-generated code: review and test before relying on it.
// Run with: node test.js   (needs Node 18+)
'use strict';
const assert = require('assert');
const A = require('./app.js');

(async () => {
  // Time zone conversion across the EU daylight-saving change (25 Oct 2026)
  const iso = ms => new Date(ms).toISOString();
  assert.strictEqual(iso(A.localToUtcMs(2026, 10, 19, 9, 0, 'Europe/Helsinki')), '2026-10-19T06:00:00.000Z'); // UTC+3
  assert.strictEqual(iso(A.localToUtcMs(2026, 10, 26, 9, 0, 'Europe/Helsinki')), '2026-10-26T07:00:00.000Z'); // UTC+2
  assert.strictEqual(iso(A.localToUtcMs(2026, 10, 19, 9, 0, 'America/New_York')), '2026-10-19T13:00:00.000Z');

  // Slot generation: Mon-Fri, 09:00-17:00, 60 min, over two weeks that cross the DST change
  const g = { a: '2026-10-19', b: '2026-10-30', wd: [1, 2, 3, 4, 5], f: '09:00', e: '17:00' };
  const slots = A.generateSlots(g, 60, 'Europe/Helsinki');
  assert.strictEqual(slots.length, 10 * 8);
  assert.strictEqual(iso(slots[0] * 60000), '2026-10-19T06:00:00.000Z');
  assert.strictEqual(iso(slots[slots.length - 1] * 60000), '2026-10-30T14:00:00.000Z'); // 16:00 local, UTC+2
  assert.deepStrictEqual(A.deltaDecode(A.deltaEncode(slots)), slots);

  // Grid in a half-hour-offset zone: 80 slots still map to unique cells
  const grid = A.buildGrid(slots, 'Asia/Kolkata');
  assert.strictEqual(grid.cell.size, slots.length);
  assert.ok(grid.times[0].endsWith(':30'));
  const gridHel = A.buildGrid(slots, 'Europe/Helsinki');
  assert.strictEqual(gridHel.dates.length, 10);
  assert.strictEqual(gridHel.times.length, 8);

  // Config round trip with non-ASCII text, then normalisation
  const raw = { v: 1, t: 'Kokous \u00e4\u00f6 \u2713', n: 'Notes', l: 60, s: A.deltaEncode(slots), z: 'Europe/Helsinki',
    m: 'a@b.fi', f: 'abc_DEF-1234567', p: ['Anna', 'Bj\u00f6rn'], g };
  const packed = await A.pack(raw);
  assert.ok(/^[zj][\w-]+$/.test(packed), 'URL-safe');
  const cfg = A.normalizeConfig(await A.unpack(packed));
  assert.strictEqual(cfg.t, raw.t);
  assert.deepStrictEqual(cfg.slots, slots);
  assert.strictEqual(cfg.f, 'abc_DEF-1234567');
  assert.throws(() => A.normalizeConfig({ v: 2 }));
  assert.strictEqual(A.normalizeConfig({ ...raw, m: 'not an address' }).m, '');
  console.log('link length for 80 slots:', packed.length, 'chars');

  // Responses, aggregation and ranking
  const id = A.configId(cfg);
  const n = cfg.slots.length;
  const mk = (name, f) => A.makeResponse(id, name, 'UTC', Array.from({ length: n }, (_, i) => f(i)));
  const r1 = mk('Anna', i => (i === 5 ? '1' : '0'));
  const r2 = mk('Bj\u00f6rn', i => (i === 5 ? '2' : i === 6 ? '1' : '0'));
  const r3 = mk('Cleo', i => (i === 5 ? '1' : i === 6 ? '1' : '0'));
  const agg = A.aggregate(n, [r1, r2, r3]);
  assert.deepStrictEqual(agg.ok[5], ['Anna', 'Cleo']);
  assert.deepStrictEqual(agg.acc[5], ['Bj\u00f6rn']);
  assert.deepStrictEqual(agg.no[0], ['Anna', 'Bj\u00f6rn', 'Cleo']);
  const ranks = A.rankSlots(agg);
  assert.strictEqual(ranks[0], 5); // 3 can attend
  assert.strictEqual(ranks[1], 6); // 2 can attend
  const back = await A.unpack(await A.pack(r2));
  assert.strictEqual(back.n, 'Bj\u00f6rn');
  assert.strictEqual(back.s, r2.s);

  // Helpers
  assert.strictEqual(A.parseFolder('https://drive.google.com/drive/folders/1AbC_dEf-GhIjKl?usp=sharing'), '1AbC_dEf-GhIjKl');
  assert.strictEqual(A.parseFolder('1AbC_dEf-GhIjKl'), '1AbC_dEf-GhIjKl');
  assert.strictEqual(A.parseFolder('x'), null);
  assert.strictEqual(A.parseFolder(''), '');
  assert.strictEqual(A.slug('J\u00e4rvinen, Mikko!'), 'jarvinen-mikko');
  assert.ok(A.fmtSlot(slots[0], 60, 'Europe/Helsinki').includes('09:00\u201310:00'));

  console.log('All tests passed.');
})().catch(e => { console.error(e); process.exit(1); });

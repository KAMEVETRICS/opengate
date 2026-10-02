const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { synthesize, synthStructural, synthTwoLevel } = require('../copilot/synth.mjs');
const { truthTable } = require('../copilot/table.mjs');
const { verifyNetlist } = require('../copilot/verify.mjs');
const { simulate, pack, fromHex } = require('../circuit/netlist.mjs');
const tier = require('../circuit/tierLogic');

const S = (inputs, expr, bits) => ({ name: 't', inputs, outputs: [{ name: 'y', bits, expr }] });
const bits1 = (...names) => names.map((name) => ({ name, bits: 1 }));
const P = [{ name: 'size', bits: 2 }, { name: 'age', bits: 2 }, { name: 'builder', bits: 1 }, { name: 'ignix', bits: 1 }];

describe('Copilot synthesis', function () {
  this.timeout(60_000);

  const limits = [
    ['NOT', S(bits1('a'), '!a', 1), 2],
    ['half adder', { name: 'ha', inputs: bits1('a', 'b'), outputs: [{ name: 's', bits: 1, expr: 'a ^ b' }, { name: 'c', bits: 1, expr: 'a & b' }] }, 8],
    ['full adder', S(bits1('a', 'b', 'c'), 'a + b + c', 2), 14],
    ['4-bit adder', S([{ name: 'a', bits: 4 }, { name: 'b', bits: 4 }], 'a + b', 5), 45],
    ['2-bit comparator', { name: 'c', inputs: [{ name: 'a', bits: 2 }, { name: 'b', bits: 2 }], outputs: [{ name: 'gt', bits: 1, expr: 'a > b' }, { name: 'eq', bits: 1, expr: 'a == b' }] }, Infinity],
    ['majority of 3', S(bits1('a', 'b', 'c'), '(a + b + c) >= 2', 1), Infinity],
    ['TierLogic v1', S(P, 'min(7, size + age + builder + ignix)', 3), 40],
  ];
  for (const [label, spec, max] of limits) {
    it(`${label}: verified, within ${max} gates`, function () {
      const r = synthesize(spec);
      expect(r.verified).to.equal(true);
      expect(r.checkedInputs).to.equal(2 ** r.nIn);
      expect(r.gates).to.be.at.most(max);
    });
  }

  it('TierLogic v1 from the spec agrees with the hand-built reference on all 64 inputs', function () {
    const r = synthesize(S(P, 'min(7, size + age + builder + ignix)', 3));
    for (let x = 0; x < 64; x++) {
      const inputs = { sizeBucket: x & 3, ageBucket: (x >> 2) & 3, builder: (x >> 4) & 1, ignix: (x >> 5) & 1 };
      const out = simulate(r.netlistHex, 6, 3, tier.inputBits(inputs));
      expect(out[0] | (out[1] << 1) | (out[2] << 2)).to.equal(tier.referenceLevel(inputs));
    }
  });

  it('every example spec synthesizes and verifies', function () {
    const dir = path.join(__dirname, '..', 'copilot', 'examples');
    for (const f of fs.readdirSync(dir)) {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const r = synthesize(spec);
      expect(r.verified, f).to.equal(true);
      if (spec.name.startsWith('tier_logic') || spec.name === 'builders_first') expect(r.policyCompatible, f).to.equal(true);
    }
  });

  it('handles a 16-input design (65,536 checked inputs)', function () {
    const r = synthesize(S([{ name: 'x', bits: 16 }], 'popcount(x) > 8', 1));
    expect(r.checkedInputs).to.equal(65536);
    expect(r.alternatives.twolevel).to.equal(null); // too many inputs for two-level
  });

  it('outputs that are constants or raw inputs still end up as the final signals', function () {
    const spec = { name: 'k', inputs: bits1('a', 'b'), outputs: [{ name: 'one', bits: 1, expr: '1' }, { name: 'zero', bits: 1, expr: '0' }, { name: 'a2', bits: 1, expr: 'a' }] };
    const r = synthesize(spec);
    for (let x = 0; x < 4; x++) expect(simulate(r.netlistHex, 2, 3, [x & 1, x >> 1])).to.deep.equal([1, 0, x & 1]);
  });

  it('the verifier catches a wrong netlist', function () {
    const spec = S(bits1('a', 'b'), 'a & b', 1);
    const table = truthTable(spec);
    const nand = fromHex('0x00000002000003'); // NAND(a, b): the inverse of what we want
    const v = verifyNetlist(nand, table);
    expect(v.ok).to.equal(false);
    expect(v.failure.x).to.equal(0);
  });

  it('the verifier rejects LATCH elements and forward references', function () {
    const table = truthTable(S(bits1('a'), 'a', 1));
    expect(verifyNetlist(fromHex('0x01000002'), table).failure.reason).to.match(/LATCH/);
    expect(verifyNetlist(fromHex('0x00000003000003'), table).failure.reason).to.match(/later signal/);
  });

  // Random expressions: both strategies must verify against the evaluator.
  it('fuzz: 300 random expressions synthesize and verify with both strategies', function () {
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const leaf = () => (rnd(3) ? ['a', 'b', 'c'][rnd(3)] : String(rnd(8)));
    const bin = ['+', '-', '*', '&', '|', '^', '==', '!=', '<', '<=', '>', '>=', '&&', '||'];
    const gen = (d) => {
      if (d === 0 || rnd(4) === 0) return leaf();
      switch (rnd(6)) {
        case 0: return `(${gen(d - 1)} ${bin[rnd(bin.length)]} ${gen(d - 1)})`;
        case 1: return `${['!', '~', '-'][rnd(3)]}${gen(d - 1)}`;
        case 2: return `(${gen(d - 1)} ? ${gen(d - 1)} : ${gen(d - 1)})`;
        case 3: return `${['min', 'max'][rnd(2)]}(${gen(d - 1)}, ${gen(d - 1)})`;
        case 4: return `(${gen(d - 1)} ${['<<', '>>'][rnd(2)]} ${rnd(3)})`;
        default: return `${['popcount', 'abs'][rnd(2)]}(${gen(d - 1)})`;
      }
    };
    const inputs = [{ name: 'a', bits: 3 }, { name: 'b', bits: 2 }, { name: 'c', bits: 2 }];
    for (let i = 0; i < 300; i++) {
      const expr = gen(4);
      const spec = S(inputs, expr, 1 + rnd(6));
      const table = truthTable(spec);
      for (const [name, bld] of [['structural', synthStructural(spec)], ['twolevel', synthTwoLevel(spec)]]) {
        const v = verifyNetlist(bld.encode(), table);
        expect(v.ok, `${name} failed for ${expr}: ${JSON.stringify(v.failure)}`).to.equal(true);
      }
    }
  });

  it('eval()-style packing: inputs are bit k = input bit k across bytes', function () {
    const spec = S([{ name: 'x', bits: 9 }], 'bit(x, 8)', 1);
    const r = synthesize(spec);
    const bits = Array.from({ length: 9 }, (_, k) => (k === 8 ? 1 : 0));
    expect(Buffer.from(pack(bits)).toString('hex')).to.equal('0001');
    expect(simulate(r.netlistHex, 9, 1, bits)).to.deep.equal([1]);
  });
});

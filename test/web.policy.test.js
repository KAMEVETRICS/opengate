// Policy impact preview (web/core.js) against independent reference formulas.
const { expect } = require('chai');
const path = require('path');
const { pathToFileURL } = require('url');
const { synthesize } = require('../copilot/synth.mjs');
const tier = require('../circuit/tierLogic');

const P = [{ name: 'size', bits: 2 }, { name: 'age', bits: 2 }, { name: 'builder', bits: 1 }, { name: 'ignix', bits: 1 }];
const v1 = (s, a, b, i) => Math.min(7, s + a + b + i);
const buildersFirst = (s, a, b, i) => Math.min(7, s + (b ? 3 : a) + i);
const builderBoost = (s, a, b, i) => Math.min(7, s + a + 2 * b + i);
const levelsOf = (f) => Array.from({ length: 64 }, (_, x) => f(x & 3, (x >> 2) & 3, (x >> 4) & 1, (x >> 5) & 1));

describe('Policy impact preview', function () {
  let core;
  before(async function () {
    core = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'core.js')).href);
  });

  it('policyLevels reproduces TierLogic v1 on all 64 situations', function () {
    const levels = core.policyLevels(tier.netlistHex);
    for (let x = 0; x < 64; x++) expect(levels[x]).to.equal(v1(x & 3, (x >> 2) & 3, (x >> 4) & 1, (x >> 5) & 1));
  });

  const compile = (expr) => synthesize({ name: 'p', inputs: P, outputs: [{ name: 'level', bits: 3, expr }] }).netlistHex;
  const expected = (f) => {
    const a = levelsOf(v1);
    const b = levelsOf(f);
    return [a.filter((x, i) => x !== b[i]).length, b.filter((x, i) => x > a[i]).length, b.filter((x, i) => x < a[i]).length];
  };

  it('policyDiff v1 → builder_boost matches the formulas: 28 up, none down', function () {
    const d = core.policyDiff(tier.netlistHex, compile('min(7, size + age + 2 * builder + ignix)'));
    expect([d.changes.length, d.up, d.down]).to.deep.equal(expected(builderBoost));
    expect([d.up, d.down]).to.deep.equal([28, 0]);
  });

  it('policyDiff catches a policy that quietly lowers some stakers (builders with >=30d stakes)', function () {
    const d = core.policyDiff(tier.netlistHex, compile('min(7, size + (builder ? 3 : age) + ignix)'));
    expect([d.changes.length, d.up, d.down]).to.deep.equal(expected(buildersFirst));
    expect(d.down).to.equal(7);
    expect(d.changes.filter((c) => c.to < c.from).every((c) => /age ≥30d, builder/.test(c.label))).to.equal(true);
  });

  it('identical policies have no changes, and labels describe the situation', function () {
    expect(core.policyDiff(tier.netlistHex, tier.netlistHex).changes).to.have.length(0);
    expect(core.describeInput(0b110110)).to.equal('stake ≥1k, age ≥1d, builder, IGNIX holder');
  });
});

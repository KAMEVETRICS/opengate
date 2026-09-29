const { expect } = require('chai');
const { simulate, unpack, pack } = require('../circuit/netlist');
const tier = require('../circuit/tierLogic');

describe('TierLogic circuit (JS simulation)', function () {
  it('matches the reference level for all 64 inputs', function () {
    for (let x = 0; x < 64; x++) {
      const inputs = {
        sizeBucket: x & 3,
        ageBucket: (x >> 2) & 3,
        builder: (x >> 4) & 1,
        ignix: (x >> 5) & 1,
      };
      const bits = tier.inputBits(inputs);
      const out = simulate(tier.netlist, tier.N_IN, tier.N_OUT, bits);
      const level = out[0] | (out[1] << 1) | (out[2] << 2);
      expect(level, `input ${x.toString(2).padStart(6, '0')}`).to.equal(tier.referenceLevel(inputs));
    }
  });

  it('packs inputs the way the vault does (one byte, bit k = input k)', function () {
    const bits = tier.inputBits({ sizeBucket: 2, ageBucket: 1, builder: 1, ignix: 0 });
    expect(Buffer.from(pack(bits)).toString('hex')).to.equal('16'); // 0b010110
    expect(unpack('0x16', 6)).to.deep.equal(bits);
  });

  it('uses only NAND gates', function () {
    expect(tier.nLatch).to.equal(0);
    expect(tier.nNand).to.equal(tier.gateCount);
  });
});

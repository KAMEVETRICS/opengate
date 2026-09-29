// TierLogic v1: the policy circuit that decides a staker's reward level.
//
// Inputs (6 bits, packed little-endian into 1 byte):
//   bit 0-1  stake size bucket   0: <100   1: >=100   2: >=1,000   3: >=10,000 transistors
//   bit 2-3  stake age bucket    0: <1 day 1: >=1 day 2: >=7 days  3: >=30 days
//   bit 4    builder             owns >=1 circuit NFT taped out on this processor
//   bit 5    IGNIX holder        holds >= the vault's IGNIX threshold
//
// Output (3 bits): level = min(7, size + age + builder + ignix)
// The vault turns level into a reward weight: 100% + 25% per level (1.00x .. 2.75x).

const { Builder, toHex } = require('./netlist');

const N_IN = 6;
const N_OUT = 3;

function build() {
  const c = new Builder(N_IN);
  const [s0, s1, a0, a1, builder, ignix] = [0, 1, 2, 3, 4, 5].map((i) => c.input(i));

  // size + age + builder (builder rides in as the carry-in): 0..7
  const fa0 = c.fullAdder(s0, a0, builder);
  const fa1 = c.fullAdder(s1, a1, fa0.carry);

  // + ignix, ripple through a 3-bit incrementer
  const h0 = c.halfAdder(fa0.sum, ignix);
  const h1 = c.halfAdder(fa1.sum, h0.carry);
  const h2 = c.halfAdder(fa1.carry, h1.carry);
  const overflow = h2.carry; // only when the total is 8

  // Saturate: out_i = r_i OR overflow. Emit the three final NANDs last so they
  // are the circuit's output signals.
  const nOverflow = c.not(overflow);
  const nr = [h0.sum, h1.sum, h2.sum].map((r) => c.not(r));
  const outs = nr.map((x) => c.nand(x, nOverflow));
  c.finish(outs);
  return c;
}

// Plain-JS reference used by tests and the dApp preview.
function referenceLevel({ sizeBucket, ageBucket, builder, ignix }) {
  return Math.min(7, sizeBucket + ageBucket + (builder ? 1 : 0) + (ignix ? 1 : 0));
}

function inputBits({ sizeBucket, ageBucket, builder, ignix }) {
  return [sizeBucket & 1, (sizeBucket >> 1) & 1, ageBucket & 1, (ageBucket >> 1) & 1, builder ? 1 : 0, ignix ? 1 : 0];
}

const circuit = build();

module.exports = {
  N_IN,
  N_OUT,
  build,
  referenceLevel,
  inputBits,
  netlist: circuit.encode(),
  netlistHex: toHex(circuit.encode()),
  gateCount: circuit.elements.length,
  nNand: circuit.nNand,
  nLatch: circuit.nLatch,
};

if (require.main === module) {
  console.log(JSON.stringify({
    nIn: N_IN,
    nOut: N_OUT,
    gates: circuit.elements.length,
    nNand: circuit.nNand,
    nLatch: circuit.nLatch,
    bytes: circuit.encode().length,
    netlist: toHex(circuit.encode()),
  }, null, 2));
}

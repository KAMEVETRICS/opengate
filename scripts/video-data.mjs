// Precomputes real data for the Remotion demo: the TierLogic v1 netlist layout,
// simulated signal values for a few staker scenarios, and policy-impact numbers.
import fs from 'node:fs';
import { decode, simulate } from '../circuit/netlist.mjs';
import { synthesize } from '../copilot/synth.mjs';
import tierPkg from '../circuit/tierLogic.js';

const tier = tierPkg;
const { elements, nSignals } = decode(tier.netlistHex, tier.N_IN);

// Same column-by-depth layout as the web app.
const depth = new Map();
for (let i = 0; i < 2 + tier.N_IN; i++) depth.set(i, 0);
const columns = [];
for (const e of elements) {
  const d = 1 + Math.max(depth.get(e.a) ?? 0, depth.get(e.b) ?? 0);
  depth.set(e.out, d);
  (columns[d] ||= []).push(e.out);
}
const gates = elements.map((e) => ({ out: e.out, a: e.a, b: e.b, depth: depth.get(e.out), row: columns[depth.get(e.out)].indexOf(e.out), colSize: columns[depth.get(e.out)].length }));

// All signal values for a scenario (simulate() returns outputs only, so re-run here).
function allSignals(bits) {
  const s = new Array(nSignals).fill(0);
  s[1] = 1;
  bits.forEach((v, k) => { s[2 + k] = v; });
  for (const e of elements) s[e.out] = 1 - (s[e.a] & s[e.b]);
  return s;
}
const scenario = (label, size, age, builder, ignix) => {
  const bits = tier.inputBits({ sizeBucket: size, ageBucket: age, builder, ignix });
  const out = simulate(tier.netlistHex, tier.N_IN, tier.N_OUT, bits);
  return { label, size, age, builder, ignix, bits, signals: allSignals(bits), tier: out[0] | (out[1] << 1) | (out[2] << 2) };
};

const P = [{ name: 'size', bits: 2 }, { name: 'age', bits: 2 }, { name: 'builder', bits: 1 }, { name: 'ignix', bits: 1 }];
const levels = (expr) => {
  const r = synthesize({ name: 'p', inputs: P, outputs: [{ name: 'level', bits: 3, expr }] });
  return { gates: r.gates, levels: Array.from({ length: 64 }, (_, x) => { const o = simulate(r.netlistHex, 6, 3, [0, 1, 2, 3, 4, 5].map((k) => (x >> k) & 1)); return o[0] | (o[1] << 1) | (o[2] << 2); }) };
};
const v1 = levels('min(7, size + age + builder + ignix)');
const boost = levels('min(7, size + age + 2 * builder + ignix)');
const bad = levels('min(7, size + (builder ? 3 : age) + ignix)');
const diff = (b) => ({ up: b.levels.filter((l, i) => l > v1.levels[i]).length, down: b.levels.filter((l, i) => l < v1.levels[i]).length });

const data = {
  nIn: tier.N_IN,
  nOut: tier.N_OUT,
  gateCount: elements.length,
  maxDepth: Math.max(...gates.map((g) => g.depth)),
  outputs: elements.slice(-tier.N_OUT).map((e) => e.out),
  gates,
  scenarios: [scenario('New staker · 100 GATE · builder', 1, 0, 1, 0), scenario('Long-term builder · 1k GATE · 7 days · IGNIX holder', 2, 2, 1, 1)],
  policies: {
    v1: { expr: 'min(7, size + age + builder + ignix)', gates: v1.gates },
    boost: { expr: 'min(7, size + age + 2 * builder + ignix)', gates: boost.gates, ...diff(boost) },
    bad: { expr: 'min(7, size + (builder ? 3 : age) + ignix)', gates: bad.gates, ...diff(bad) },
  },
};
fs.writeFileSync('video/src/data/demo.json', JSON.stringify(data));
console.log({ gates: data.gateCount, depth: data.maxDepth, scenarios: data.scenarios.map((s) => `${s.label} → tier ${s.tier}`), boost: data.policies.boost, bad: data.policies.bad });

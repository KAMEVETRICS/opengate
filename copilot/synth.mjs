// Spec -> NAND netlist. Two strategies, each verified exhaustively; the smaller
// verified one wins.
//   structural: compile the expression tree into adders, comparators and muxes.
//   twolevel:   truth table -> Quine-McCluskey -> NAND-NAND (inputs <= 10 bits).
import { Builder, toHex } from '../circuit/netlist.mjs';
import { validateSpec, layout } from './spec.mjs';
import { evaluate } from './expr.mjs';
import { truthTable } from './table.mjs';
import { verifyNetlist } from './verify.mjs';

const ZERO = 0;
const ONE = 1;

// ---------------------------------------------------------------- gate graph

// NAND graph with constant folding and structural hashing, so identical gates are
// built once and constants never cost gates. Signals: 0, 1, inputs, then gates.
class Gates {
  constructor(nIn) {
    this.nIn = nIn;
    this.a = [];
    this.b = [];
    this.hash = new Map();
    this.comp = new Map(); // known complements: comp.get(s) === NOT s
  }

  input(i) { return 2 + i; }
  isGate(s) { return s >= 2 + this.nIn; }
  gate(s) { const i = s - 2 - this.nIn; return [this.a[i], this.b[i]]; }

  nand(x, y) {
    if (x > y) [x, y] = [y, x];
    if (x === ZERO) return ONE;
    if (x === ONE) return y === ONE ? ZERO : this.not(y);
    if (this.comp.get(x) === y) return ONE; // NAND(s, NOT s) = 1
    const key = x * 16777216 + y;
    const hit = this.hash.get(key);
    if (hit !== undefined) return hit;
    const out = 2 + this.nIn + this.a.length;
    this.a.push(x);
    this.b.push(y);
    this.hash.set(key, out);
    if (x === y) {
      this.comp.set(out, x);
      if (!this.comp.has(x)) this.comp.set(x, out);
    }
    return out;
  }

  not(x) {
    if (x === ZERO) return ONE;
    if (x === ONE) return ZERO;
    const c = this.comp.get(x);
    return c !== undefined ? c : this.nand(x, x);
  }

  and(x, y) { return this.not(this.nand(x, y)); }
  or(x, y) { return this.nand(this.not(x), this.not(y)); }
  xor(x, y) {
    const t = this.nand(x, y);
    return this.nand(this.nand(x, t), this.nand(y, t));
  }
  xnor(x, y) { return this.not(this.xor(x, y)); }
  mux(c, x, y) { return this.nand(this.nand(c, x), this.nand(this.not(c), y)); } // c ? x : y

  andAll(xs) { return xs.length ? xs.reduce((p, q) => this.and(p, q)) : ONE; }
  orAll(xs) { return xs.length ? xs.reduce((p, q) => this.or(p, q)) : ZERO; }

  // Emit a TapeOut Builder: keep only gates the outputs need, then re-emit the
  // output gates last (outputs must be the final nOut signals).
  toBuilder(outputs) {
    const live = new Uint8Array(2 + this.nIn + this.a.length);
    const stack = [];
    const root = (s) => { if (this.isGate(s)) stack.push(...this.gate(s)); };
    outputs.forEach(root);
    while (stack.length) {
      const s = stack.pop();
      if (live[s]) continue;
      live[s] = 1;
      if (this.isGate(s)) stack.push(...this.gate(s));
    }
    const bld = new Builder(this.nIn);
    const map = new Map([[ZERO, ZERO], [ONE, ONE]]);
    for (let i = 0; i < this.nIn; i++) map.set(2 + i, 2 + i);
    for (let i = 0; i < this.a.length; i++) {
      const s = 2 + this.nIn + i;
      if (live[s]) map.set(s, bld.nand(map.get(this.a[i]), map.get(this.b[i])));
    }
    // Outputs must be the LAST nOut signals, so each gets exactly one final gate,
    // and any helper gate (the inner NOT of a raw-input output) is emitted first.
    const inverted = new Map();
    for (const s of outputs) {
      if (!this.isGate(s) && s !== ZERO && s !== ONE && !inverted.has(s)) inverted.set(s, bld.not(s));
    }
    const outs = outputs.map((s) => {
      if (this.isGate(s)) { const [x, y] = this.gate(s); return bld.nand(map.get(x), map.get(y)); }
      if (s === ZERO) return bld.nand(ONE, ONE);
      if (s === ONE) return bld.nand(ZERO, ZERO);
      const n = inverted.get(s);
      return bld.nand(n, n); // NOT(NOT(input))
    });
    bld.outputs = outs;
    return bld;
  }
}

// ---------------------------------------------------------------- structural

// Bit-vectors are arrays of signals, LSB first.
const bitAt = (v, i) => (i < v.length ? v[i] : ZERO);
const fit = (v, w) => Array.from({ length: w }, (_, i) => bitAt(v, i));
const constant = (value, w) => Array.from({ length: w }, (_, i) => (Math.floor(value / 2 ** i) % 2 ? ONE : ZERO));

function fullAdd(g, a, b, c) {
  const t1 = g.nand(a, b);
  const axb = g.nand(g.nand(a, t1), g.nand(b, t1));
  const t4 = g.nand(axb, c);
  const sum = g.nand(g.nand(axb, t4), g.nand(c, t4));
  const carry = g.nand(t4, t1);
  return [sum, carry];
}

function add(g, A, B, carryIn = ZERO) {
  const w = Math.max(A.length, B.length);
  const out = [];
  let c = carryIn;
  for (let i = 0; i < w; i++) {
    const [s, k] = fullAdd(g, bitAt(A, i), bitAt(B, i), c);
    out.push(s);
    c = k;
  }
  out.push(c);
  return out; // w + 1 bits
}

// a - b over max width: returns { diff, geq } where geq = (a >= b).
function subtract(g, A, B) {
  const w = Math.max(A.length, B.length);
  const nb = fit(B, w).map((s) => g.not(s));
  const r = add(g, fit(A, w), nb, ONE);
  return { diff: r.slice(0, w), geq: r[w] };
}

const lessThan = (g, A, B) => g.not(subtract(g, A, B).geq);
function equal(g, A, B) {
  const w = Math.max(A.length, B.length);
  return g.andAll(Array.from({ length: w }, (_, i) => g.xnor(bitAt(A, i), bitAt(B, i))));
}
const nonZero = (g, A) => g.orAll(A);
const muxVec = (g, c, A, B, w) => Array.from({ length: w }, (_, i) => g.mux(c, bitAt(A, i), bitAt(B, i)));

const flattenSum = (n) => (n.type === 'bin' && n.op === '+' ? [...flattenSum(n.a), ...flattenSum(n.b)] : [n]);

// Add many vectors. Single-bit terms ride along as adder carry-ins (free), the
// way a hand-built circuit would do it, instead of costing a ripple pass each.
function sum(g, vectors) {
  const ones = vectors.filter((v) => v.length === 1).map((v) => v[0]);
  const multi = vectors.filter((v) => v.length > 1);
  let acc = multi.length ? multi.shift() : [ones.shift()];
  for (const B of multi) acc = add(g, acc, B, ones.length ? ones.shift() : ZERO);
  while (ones.length) {
    const x = ones.shift();
    acc = add(g, acc, [x], ones.length ? ones.shift() : ZERO); // two bits per pass
  }
  return acc;
}

function compileNode(g, n, env) {
  const rec = (m) => compileNode(g, m, env);
  const w = n.w;
  switch (n.type) {
    case 'num': return constant(n.v, w);
    case 'id': return env[n.name];
    case 'un': {
      const A = rec(n.a);
      if (n.op === '!') return [g.not(nonZero(g, A))];
      if (n.op === '-') return [ZERO];
      return fit(A, n.a.w).map((s) => g.not(s)); // '~' within the operand's width
    }
    case 'cond': return muxVec(g, nonZero(g, rec(n.cond)), rec(n.a), rec(n.b), w);
    case 'call': {
      const args = n.args.map(rec);
      if (n.fn === 'min' || n.fn === 'max') {
        // min(x, 2^k - 1) is a saturating clamp: if any bit >= k is set, all ones.
        // Far cheaper than a comparator plus mux.
        const capIdx = n.fn === 'min' ? n.args.findIndex((a) => a.type === 'num' && a.v > 0 && (a.v & (a.v + 1)) === 0) : -1;
        if (capIdx >= 0 && n.args.length === 2) {
          const k = Math.log2(n.args[capIdx].v + 1);
          const X = args[1 - capIdx];
          const high = g.orAll(X.slice(k));
          return fit(Array.from({ length: k }, (_, i) => g.or(bitAt(X, i), high)), w);
        }
        let acc = args[0];
        for (const B of args.slice(1)) {
          const aLess = lessThan(g, acc, B);
          const pickA = n.fn === 'min' ? aLess : g.not(aLess);
          acc = muxVec(g, pickA, acc, B, Math.max(acc.length, B.length));
        }
        return fit(acc, w);
      }
      if (n.fn === 'bit') return [bitAt(args[0], evaluate(n.args[1], {}))];
      if (n.fn === 'popcount') {
        let acc = [ZERO];
        for (const s of args[0]) acc = add(g, acc, [s]);
        return fit(acc, w);
      }
      return fit(args[0], w); // abs
    }
    case 'bin': {
      if (n.op === '+') return fit(sum(g, flattenSum(n).map(rec)), w);
      const A = rec(n.a);
      const B = rec(n.b);
      switch (n.op) {
        case '-': {
          const { diff, geq } = subtract(g, A, B);
          return fit(diff, w).map((s) => g.and(s, geq)); // saturate at 0
        }
        case '*': {
          let acc = [ZERO];
          B.forEach((bi, i) => {
            const partial = [...Array(i).fill(ZERO), ...A.map((a) => g.and(a, bi))];
            acc = add(g, acc, partial);
          });
          return fit(acc, w);
        }
        case '<<': return fit([...Array(evaluate(n.b, {})).fill(ZERO), ...A], w);
        case '>>': return fit(A.slice(evaluate(n.b, {})), w);
        case '&': return Array.from({ length: w }, (_, i) => g.and(bitAt(A, i), bitAt(B, i)));
        case '|': return Array.from({ length: w }, (_, i) => g.or(bitAt(A, i), bitAt(B, i)));
        case '^': return Array.from({ length: w }, (_, i) => g.xor(bitAt(A, i), bitAt(B, i)));
        case '==': return [equal(g, A, B)];
        case '!=': return [g.not(equal(g, A, B))];
        case '<': return [lessThan(g, A, B)];
        case '>': return [lessThan(g, B, A)];
        case '<=': return [g.not(lessThan(g, B, A))];
        case '>=': return [g.not(lessThan(g, A, B))];
        case '&&': return [g.and(nonZero(g, A), nonZero(g, B))];
        case '||': return [g.or(nonZero(g, A), nonZero(g, B))];
      }
    }
  }
  throw new Error(`cannot compile node ${n.type}`);
}

export function synthStructural(spec, checked = validateSpec(spec)) {
  const { inputs, outputs } = layout(spec);
  const g = new Gates(checked.nIn);
  const env = Object.create(null); // no prototype: input names map only to input signals
  for (const p of inputs) env[p.name] = Array.from({ length: p.bits }, (_, i) => g.input(p.offset + i));
  const outs = outputs.flatMap((o, i) => fit(compileNode(g, checked.asts[i], env), o.bits));
  return g.toBuilder(outs);
}

// ---------------------------------------------------------------- two-level

export const TWOLEVEL_MAX_IN = 10;

// Prime implicants as cubes { v, m }: m marks don't-care bits.
function primeImplicants(minterms, nIn) {
  let current = new Map(minterms.map((x) => [`${x}:0`, { v: x, m: 0 }]));
  const primes = [];
  while (current.size) {
    const list = [...current.values()];
    const used = new Set();
    const next = new Map();
    const byMask = new Map();
    for (const c of list) {
      if (!byMask.has(c.m)) byMask.set(c.m, []);
      byMask.get(c.m).push(c);
    }
    for (const group of byMask.values()) {
      const set = new Map(group.map((c) => [c.v, c]));
      for (const c of group) {
        // Merge with the cube that differs only by having `bit` set.
        for (let k = 0; k < nIn; k++) {
          const bit = 1 << k;
          if (bit & c.m || bit & c.v) continue;
          const other = set.get(c.v | bit);
          if (!other) continue;
          used.add(c);
          used.add(other);
          const merged = { v: c.v, m: c.m | bit };
          next.set(`${merged.v}:${merged.m}`, merged);
        }
      }
    }
    for (const c of list) if (!used.has(c)) primes.push(c);
    current = next;
  }
  return primes;
}

const covers = (cube, x) => (x & ~cube.m) === cube.v;

// Essential primes first, then greedily the prime covering the most remaining minterms.
function cover(primes, minterms) {
  const left = new Set(minterms);
  const chosen = [];
  for (const x of minterms) {
    const covering = primes.filter((p) => covers(p, x));
    if (covering.length === 1 && !chosen.includes(covering[0])) chosen.push(covering[0]);
  }
  for (const p of chosen) for (const x of [...left]) if (covers(p, x)) left.delete(x);
  while (left.size) {
    let best = null;
    let bestN = 0;
    for (const p of primes) {
      let n = 0;
      for (const x of left) if (covers(p, x)) n++;
      if (n > bestN || (n === bestN && best && popcount(p.m) > popcount(best.m))) { best = p; bestN = n; }
    }
    chosen.push(best);
    for (const x of [...left]) if (covers(best, x)) left.delete(x);
  }
  return chosen;
}
const popcount = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };

export function synthTwoLevel(spec, checked = validateSpec(spec), table = truthTable(spec, checked)) {
  const { nIn, nOut, rows } = table;
  if (nIn > TWOLEVEL_MAX_IN) return null;
  const g = new Gates(nIn);
  const outs = [];
  for (let o = 0; o < nOut; o++) {
    const minterms = [];
    for (let x = 0; x < rows.length; x++) if (rows[x][o]) minterms.push(x);
    if (minterms.length === 0) { outs.push(ZERO); continue; }
    if (minterms.length === rows.length) { outs.push(ONE); continue; }
    // Implement whichever of f / NOT f has fewer minterms, inverting at the end.
    const invert = minterms.length > rows.length / 2;
    const target = invert ? rows.map((r, x) => (r[o] ? -1 : x)).filter((x) => x >= 0) : minterms;
    const terms = cover(primeImplicants(target, nIn), target).map((cube) => {
      const lits = [];
      for (let k = 0; k < nIn; k++) {
        if (cube.m & (1 << k)) continue;
        lits.push(cube.v & (1 << k) ? g.input(k) : g.not(g.input(k)));
      }
      return g.andAll(lits);
    });
    const f = g.orAll(terms);
    outs.push(invert ? g.not(f) : f);
  }
  return g.toBuilder(outs);
}

// ---------------------------------------------------------------- pick best

export function synthesize(spec, { policy = false } = {}) {
  const checked = validateSpec(spec, { policy });
  const table = truthTable(spec, checked);
  const candidates = [];
  const tried = {};
  for (const [name, run] of [['structural', () => synthStructural(spec, checked)], ['twolevel', () => synthTwoLevel(spec, checked, table)]]) {
    const bld = run();
    if (!bld) { tried[name] = null; continue; }
    const netlist = bld.encode();
    const v = verifyNetlist(netlist, table);
    tried[name] = v.ok ? bld.elements.length : `failed: ${JSON.stringify(v.failure)}`;
    if (v.ok) candidates.push({ name, bld, netlist, checked: v.checked });
  }
  if (!candidates.length) {
    throw new Error(`internal error: no strategy produced a verified circuit (${JSON.stringify(tried)})`);
  }
  candidates.sort((x, y) => x.bld.elements.length - y.bld.elements.length);
  const best = candidates[0];
  return {
    spec,
    nIn: checked.nIn,
    nOut: checked.nOut,
    gates: best.bld.elements.length,
    nNand: best.bld.nNand,
    nLatch: best.bld.nLatch,
    strategy: best.name,
    alternatives: tried,
    netlistHex: toHex(best.netlist),
    verified: true,
    checkedInputs: best.checked,
    unusedInputs: checked.unused,
    policyCompatible: (() => { try { validateSpec(spec, { policy: true }); return true; } catch { return false; } })(),
  };
}

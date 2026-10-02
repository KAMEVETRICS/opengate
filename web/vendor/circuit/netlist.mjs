// Copied from circuit/netlist.mjs by scripts/build-web.js. Do not edit here.
// Netlist builder, encoder and simulator matching TapeOut's on-chain format.
// Plain ES module with no Node APIs, so it runs in Node and in the browser.
//
// Signal indices: 0 = constant 0, 1 = constant 1, 2..2+nIn-1 = inputs,
// then every element appends one new signal in order. The circuit's outputs
// are the LAST nOut signals (verified against eval() on X Layer).
// eval() packs input/output bits little-endian: bit k -> byte k>>3, bit k&7.

export const OP = { NAND: 0, LATCH: 1 };

export class Builder {
  constructor(nIn) {
    this.nIn = nIn;
    this.elements = [];
    this.next = 2 + nIn;
  }

  get ZERO() { return 0; }
  get ONE() { return 1; }

  input(i) {
    if (i < 0 || i >= this.nIn) throw new RangeError(`input ${i} out of range`);
    return 2 + i;
  }

  nand(a, b) {
    const out = this.next++;
    this.elements.push({ op: OP.NAND, a, b, out });
    return out;
  }

  // Derived gates, each built only from NAND.
  not(a) { return this.nand(a, a); }
  and(a, b) { return this.not(this.nand(a, b)); }
  or(a, b) { return this.nand(this.not(a), this.not(b)); }
  xor(a, b) {
    const t = this.nand(a, b);
    return this.nand(this.nand(a, t), this.nand(b, t));
  }

  // 9-NAND full adder -> { sum, carry }
  fullAdder(a, b, cin) {
    const t1 = this.nand(a, b);
    const t2 = this.nand(a, t1);
    const t3 = this.nand(b, t1);
    const axb = this.nand(t2, t3);
    const t4 = this.nand(axb, cin);
    const t5 = this.nand(axb, t4);
    const t6 = this.nand(cin, t4);
    const sum = this.nand(t5, t6);
    const carry = this.nand(t4, t1);
    return { sum, carry };
  }

  // 5-NAND half adder -> { sum, carry }
  halfAdder(a, b) {
    const t = this.nand(a, b);
    const sum = this.nand(this.nand(a, t), this.nand(b, t));
    const carry = this.not(t);
    return { sum, carry };
  }

  // Copy a signal into a fresh trailing slot (outputs must be the last nOut
  // signals). NOT(NOT(x)) costs 2 gates.
  buffer(a) { return this.not(this.not(a)); }

  // Re-emit `signals` so they occupy the final positions, in order.
  finish(signals) {
    const tail = this.elements.slice(-signals.length).map((e) => e.out);
    const alreadyLast = tail.length === signals.length && tail.every((s, i) => s === signals[i]);
    const outs = alreadyLast ? signals : signals.map((s) => this.buffer(s));
    this.outputs = outs;
    return outs;
  }

  get nNand() { return this.elements.filter((e) => e.op === OP.NAND).length; }
  get nLatch() { return this.elements.filter((e) => e.op === OP.LATCH).length; }

  encode() {
    const bytes = [];
    const u24 = (v) => bytes.push((v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    for (const e of this.elements) {
      if (e.op === OP.NAND) { bytes.push(OP.NAND); u24(e.a); u24(e.b); }
      else { bytes.push(OP.LATCH); u24(e.d); }
    }
    return Uint8Array.from(bytes);
  }
}

export function toHex(bytes) {
  let s = '0x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex) {
  const h = hex.replace(/^0x/, '');
  if (h.length % 2 || /[^0-9a-fA-F]/.test(h)) throw new Error('invalid hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const asBytes = (x) => (typeof x === 'string' ? fromHex(x) : x);

export function pack(bits) {
  const out = new Uint8Array(Math.max(1, Math.ceil(bits.length / 8)));
  bits.forEach((v, k) => { if (v) out[k >> 3] |= 1 << (k & 7); });
  return out;
}

export function unpack(bytes, n) {
  const b = asBytes(bytes);
  return Array.from({ length: n }, (_, k) => (b[k >> 3] >> (k & 7)) & 1);
}

// Decode a TapeOut netlist (NAND/LATCH only) back into elements.
export function decode(netlist, nIn) {
  const b = asBytes(netlist);
  const els = [];
  let i = 0;
  let next = 2 + nIn;
  const u24 = () => { const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]; i += 3; return v; };
  while (i < b.length) {
    const op = b[i++];
    if (op === OP.NAND) els.push({ op, a: u24(), b: u24(), out: next++ });
    else if (op === OP.LATCH) els.push({ op, d: u24(), out: next++ });
    else throw new Error(`unsupported opcode ${op} at byte ${i - 1}`);
  }
  return { elements: els, nSignals: next };
}

// Combinational simulation (latches read as 0, matching a fresh eval()).
export function simulate(netlist, nIn, nOut, inBits) {
  const { elements, nSignals } = decode(netlist, nIn);
  const s = new Uint8Array(nSignals);
  s[1] = 1;
  inBits.forEach((v, k) => { s[2 + k] = v ? 1 : 0; });
  for (const e of elements) {
    s[e.out] = e.op === OP.NAND ? 1 - (s[e.a] & s[e.b]) : 0;
  }
  return Array.from(s.subarray(nSignals - nOut));
}

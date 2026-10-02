// Exhaustive verification: the netlist must match the truth table on EVERY input,
// and be structurally valid for TapeOut on X Layer. Nothing is ever emitted
// without passing this.
import { decode, simulate, OP } from '../circuit/netlist.mjs';
import { inputBits } from './table.mjs';

export function verifyNetlist(netlist, table) {
  const { nIn, nOut, rows } = table;
  let elements;
  try {
    ({ elements } = decode(netlist, nIn));
  } catch (e) {
    return { ok: false, checked: 0, failure: { reason: `undecodable: ${e.message}` } };
  }
  if (elements.length < nOut) return { ok: false, checked: 0, failure: { reason: 'fewer gates than outputs' } };
  for (const e of elements) {
    if (e.op === OP.LATCH) return { ok: false, checked: 0, failure: { reason: 'LATCH found in a combinational design' } };
    if (e.a >= e.out || e.b >= e.out) return { ok: false, checked: 0, failure: { reason: `gate ${e.out} reads a later signal` } };
  }
  // Decode once and evaluate inline: up to 65,536 inputs × thousands of gates.
  const nSignals = 2 + nIn + elements.length;
  const s = new Uint8Array(nSignals);
  const as = Int32Array.from(elements, (e) => e.a);
  const bs = Int32Array.from(elements, (e) => e.b);
  const base = nSignals - nOut;
  for (let x = 0; x < rows.length; x++) {
    s[0] = 0;
    s[1] = 1;
    for (let k = 0; k < nIn; k++) s[2 + k] = Math.floor(x / 2 ** k) % 2;
    for (let i = 0, o = 2 + nIn; i < as.length; i++, o++) s[o] = 1 - (s[as[i]] & s[bs[i]]);
    const expected = rows[x];
    for (let i = 0; i < nOut; i++) {
      if (s[base + i] !== expected[i]) {
        // Cross-check the failure with the reference simulator before reporting.
        const got = simulate(netlist, nIn, nOut, inputBits(x, nIn));
        return { ok: false, checked: x, failure: { x, expected: Array.from(expected), got } };
      }
    }
  }
  return { ok: true, checked: rows.length };
}

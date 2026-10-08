// Copied from copilot/table.mjs by scripts/build-web.js. Do not edit here.
// Expected behaviour of a spec, as a full truth table over every input combination.
import { evaluate } from './expr.mjs';
import { validateSpec, layout } from './spec.mjs';

// rows[x] = Uint8Array of nOut output bits for input integer x (bit k = input bit k).
export function truthTable(spec, checked = validateSpec(spec)) {
  const { nIn, nOut, asts } = checked;
  const { inputs, outputs } = layout(spec);
  const rows = new Array(2 ** nIn);
  const env = Object.create(null); // no prototype: input names map only to input values
  for (let x = 0; x < rows.length; x++) {
    for (const p of inputs) env[p.name] = Math.floor(x / 2 ** p.offset) % 2 ** p.bits;
    const row = new Uint8Array(nOut);
    outputs.forEach((o, i) => {
      const v = evaluate(asts[i], env);
      for (let b = 0; b < o.bits; b++) row[o.offset + b] = Math.floor(v / 2 ** b) % 2;
    });
    rows[x] = row;
  }
  return { nIn, nOut, rows };
}

export function inputBits(x, nIn) {
  return Array.from({ length: nIn }, (_, k) => Math.floor(x / 2 ** k) % 2);
}

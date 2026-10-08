// Spec: the only thing an LLM (or a person) writes. Everything downstream is
// deterministic and verified.
//
// {
//   "name": "tier_logic_v1",
//   "description": "...",
//   "inputs":  [{ "name": "size", "bits": 2 }, ...],
//   "outputs": [{ "name": "level", "bits": 3, "expr": "min(7, size + age)" }]
// }
//
// Bit layout: inputs in array order, each value LSB first; outputs the same.
import { parse, annotate, identifiers, ExprError } from './expr.mjs';

export const LIMITS = { maxIn: 16, maxOut: 32, maxBits: 16, maxName: 40 };
export const POLICY_INPUTS = [['size', 2], ['age', 2], ['builder', 1], ['ignix', 1]];
export const POLICY_OUTPUT_BITS = 3;

const NAME = /^[a-z_][a-z0-9_]*$/;
// Names that collide with JavaScript object internals. Dictionaries below have no
// prototype anyway; rejecting these too keeps every layer safe on its own.
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', ...Object.getOwnPropertyNames(Object.prototype)]);

export class SpecError extends Error {}

export function validateSpec(spec, { policy = false } = {}) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new SpecError('spec must be a JSON object');
  if (typeof spec.name !== 'string' || !/^[a-z0-9_]{1,40}$/.test(spec.name)) {
    throw new SpecError('name must be 1-40 characters of a-z, 0-9 or _');
  }
  for (const key of ['inputs', 'outputs']) {
    if (!Array.isArray(spec[key]) || spec[key].length === 0) throw new SpecError(`${key} must be a non-empty array`);
  }
  const seen = new Set();
  const widths = Object.create(null); // no prototype: names can never hit Object internals
  const checkPort = (p, kind, i) => {
    if (!p || typeof p !== 'object') throw new SpecError(`${kind}[${i}] must be an object`);
    if (typeof p.name !== 'string' || !NAME.test(p.name) || p.name.length > LIMITS.maxName) {
      throw new SpecError(`${kind}[${i}].name must match [a-z_][a-z0-9_]*`);
    }
    if (RESERVED.has(p.name)) throw new SpecError(`${kind}[${i}].name '${p.name}' is reserved; choose another name`);
    if (seen.has(p.name)) throw new SpecError(`duplicate name '${p.name}'`);
    seen.add(p.name);
    if (!Number.isInteger(p.bits) || p.bits < 1 || p.bits > LIMITS.maxBits) {
      throw new SpecError(`${kind} '${p.name}': bits must be an integer 1..${LIMITS.maxBits}`);
    }
  };
  spec.inputs.forEach((p, i) => { checkPort(p, 'inputs', i); widths[p.name] = p.bits; });
  spec.outputs.forEach((p, i) => checkPort(p, 'outputs', i));

  const nIn = spec.inputs.reduce((s, p) => s + p.bits, 0);
  const nOut = spec.outputs.reduce((s, p) => s + p.bits, 0);
  if (nIn > LIMITS.maxIn) throw new SpecError(`${nIn} input bits; the maximum is ${LIMITS.maxIn} (every input combination is checked)`);
  if (nOut > LIMITS.maxOut) throw new SpecError(`${nOut} output bits; the maximum is ${LIMITS.maxOut}`);

  const asts = spec.outputs.map((o) => {
    if (typeof o.expr !== 'string') throw new SpecError(`output '${o.name}' needs an expr string`);
    try {
      const ast = parse(o.expr);
      annotate(ast, widths);
      return ast;
    } catch (e) {
      if (e instanceof ExprError) throw new SpecError(`output '${o.name}': ${e.message}`);
      throw e;
    }
  });

  if (policy) {
    const shape = spec.inputs.map((p) => `${p.name}:${p.bits}`).join(',');
    const want = POLICY_INPUTS.map(([n, b]) => `${n}:${b}`).join(',');
    if (shape !== want) throw new SpecError(`vault policies need inputs exactly ${want} (got ${shape})`);
    if (nOut !== POLICY_OUTPUT_BITS) throw new SpecError(`vault policies need exactly ${POLICY_OUTPUT_BITS} output bits (got ${nOut})`);
  }

  const unused = spec.inputs.filter((p) => !asts.some((a) => identifiers(a).has(p.name))).map((p) => p.name);
  return { nIn, nOut, asts, widths, unused };
}

// Bit offsets for every port.
export function layout(spec) {
  let off = 0;
  const inputs = spec.inputs.map((p) => { const r = { ...p, offset: off }; off += p.bits; return r; });
  off = 0;
  const outputs = spec.outputs.map((p) => { const r = { ...p, offset: off }; off += p.bits; return r; });
  return { inputs, outputs };
}

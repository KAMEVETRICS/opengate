// Circuit Copilot: describe a circuit (in English or as a Spec) and get a
// TapeOut netlist that is verified on every input.
import { synthesize } from './synth.mjs';

export { validateSpec, layout } from './spec.mjs';
export { synthesize } from './synth.mjs';
export { truthTable } from './table.mjs';

export const FEES = { mintFeeOkb: 0.00066, tapeoutFeeOkb: 0.0013 }; // X Layer, read on-chain 2026-09-28
const GAS_PER_GATE = 3000;
const GAS_BASE = 40_000;

export function costEstimate(result, priceOkb) {
  const transistors = result.nNand + result.nLatch;
  return {
    transistors,
    okb: +(transistors * priceOkb + FEES.mintFeeOkb + FEES.tapeoutFeeOkb).toFixed(8),
    note: `${transistors} × ${priceOkb} OKB + mint fee ${FEES.mintFeeOkb} + tape-out fee ${FEES.tapeoutFeeOkb}`,
  };
}

// design({ prompt }) asks the LLM for a Spec first; design({ spec }) skips it.
export async function design({ prompt, spec, policy = false, priceOkb = 0.0001, llm } = {}) {
  if (!spec) {
    if (!prompt) throw new Error('give a prompt or a spec');
    const { promptToSpec } = await import('./llm.mjs'); // only load the SDK when needed
    spec = await promptToSpec(prompt, { policy, ...llm });
  }
  const result = synthesize(spec, { policy });
  return {
    ...result,
    cost: costEstimate(result, priceOkb),
    evalGasEstimate: GAS_BASE + GAS_PER_GATE * result.gates,
  };
}

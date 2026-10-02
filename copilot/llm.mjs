// English -> Spec, via Claude. The model only ever writes a Spec (port names,
// widths, one expression per output). It never writes gates or netlists: those
// come from the deterministic compiler and are verified on every input.
//
// The reply is treated as untrusted: schema-checked by structured outputs, then
// validated and parsed by our own code (copilot/spec.mjs), never executed.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { validateSpec, POLICY_INPUTS } from './spec.mjs';

export const MODEL = 'claude-opus-5-5';
const MAX_ATTEMPTS = 3;

const Port = z.object({ name: z.string(), bits: z.number().int() });
const Reply = z.object({
  unsupported_reason: z.string().nullable(),
  spec: z
    .object({
      name: z.string(),
      description: z.string(),
      inputs: z.array(Port),
      outputs: z.array(Port.extend({ expr: z.string() })),
    })
    .nullable(),
});

const policyLine = POLICY_INPUTS.map(([n, b]) => `${n}:${b}`).join(', ');

export const SYSTEM_PROMPT = `You turn plain-English descriptions of digital logic into a circuit spec for Circuit Copilot. A compiler turns your spec into NAND gates taped out on-chain with TapeOut on X Layer, and checks the result against your expressions on every possible input. Your job is only to state the behaviour precisely; you never design gates.

Spec fields:
- name: 1-40 characters of a-z, 0-9, _
- description: one sentence
- inputs: [{name, bits}] where name matches [a-z_][a-z0-9_]* and bits is 1-16; at most 16 input bits in total
- outputs: [{name, bits, expr}], at most 32 output bits in total; names must not repeat input names

Bit order: inputs are packed in array order, each value least-significant bit first. Outputs work the same way.

Expression language (all values are non-negative integers):
- literals: decimal, 0x hex, 0b binary; identifiers are input names
- operators, lowest to highest precedence: ?: then || then && then | then ^ then & then == != < <= > >= (never chain these) then << >> (constant shift amounts only) then + - then *
- unary: ! (logical not), ~ (invert the operand's own bits), - (always 0)
- "-" saturates at 0: 2 - 5 is 0. There is no division.
- comparisons and ! && || give 0 or 1
- functions: min(a, b, ...), max(a, b, ...), bit(x, i) with constant i, popcount(x), abs(x)
- each output value is truncated to its bit width, so pick widths that hold the full result

Only combinational logic is supported: outputs depend only on the current inputs. If the request needs memory, state, a clock or a counter that remembers, or cannot be expressed within the limits, set spec to null and explain why in unsupported_reason. Otherwise set unsupported_reason to null.

If the request is a reward policy for the OpenGate vault, use exactly these inputs in this order: ${policyLine}; and one 3-bit output named level (0-7). size and age are bucket numbers 0-3 (size: <100, >=100, >=1,000, >=10,000 transistors staked; age: <1 day, >=1 day, >=7 days, >=30 days), builder is 1 if the staker has taped out a circuit on OpenGate, ignix is 1 if they hold the IGNIX threshold.

Examples:
"add two bits" -> {"name":"half_adder","description":"Sum and carry of two bits","inputs":[{"name":"a","bits":1},{"name":"b","bits":1}],"outputs":[{"name":"sum","bits":1,"expr":"a ^ b"},{"name":"carry","bits":1,"expr":"a & b"}]}
"compare two 2-bit numbers" -> {"name":"comparator2","description":"Greater-than and equality of two 2-bit numbers","inputs":[{"name":"a","bits":2},{"name":"b","bits":2}],"outputs":[{"name":"gt","bits":1,"expr":"a > b"},{"name":"eq","bits":1,"expr":"a == b"}]}
"OpenGate policy: tier is size plus age plus one for builders and one for IGNIX holders, capped at 7" -> {"name":"tier_logic_v1","description":"Tier from stake size, stake age, builder and IGNIX flags","inputs":[{"name":"size","bits":2},{"name":"age","bits":2},{"name":"builder","bits":1},{"name":"ignix","bits":1}],"outputs":[{"name":"level","bits":3,"expr":"min(7, size + age + builder + ignix)"}]}`;

export class CopilotError extends Error {}

// `client` is injectable for tests; by default the SDK resolves credentials from
// the environment (ANTHROPIC_API_KEY, or an `ant auth login` profile).
export async function promptToSpec(prompt, { client = new Anthropic(), policy = false, onAttempt } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new CopilotError('describe the circuit you want');
  const messages = [{ role: 'user', content: policy ? `${prompt}\n\n(This is an OpenGate vault reward policy.)` : prompt }];
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt);
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(Reply) },
      system: SYSTEM_PROMPT,
      messages,
    });

    if (response.stop_reason === 'refusal') {
      throw new CopilotError(`the model declined this request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ''}`);
    }
    if (response.stop_reason === 'max_tokens') throw new CopilotError('the model ran out of output tokens');

    const reply = response.parsed_output;
    if (!reply) {
      lastError = 'reply was not valid JSON for the schema';
    } else if (!reply.spec) {
      throw new CopilotError(reply.unsupported_reason || 'the model could not express this as a combinational circuit');
    } else {
      try {
        validateSpec(reply.spec, { policy });
        return reply.spec;
      } catch (e) {
        lastError = e.message;
      }
    }

    // Show the model its mistake and ask again. The assistant turn is appended
    // unchanged (thinking blocks included) so the conversation stays valid.
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: `That spec was rejected: ${lastError}. Return a corrected spec.` });
  }
  throw new CopilotError(`no valid spec after ${MAX_ATTEMPTS} attempts (last problem: ${lastError})`);
}

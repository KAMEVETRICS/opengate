# Circuit Copilot

Turns a description of a digital circuit into a TapeOut NAND netlist. Every result is **checked on every possible input** before it can be taped out on X Layer.

```
English ──(Claude, CLI only)──▶ Spec ──▶ compile (2 strategies) ──▶ verify all 2^n inputs ──▶ netlist JSON ──▶ web app: Tape out
                                 ▲
             or write the Spec yourself (CLI or the web app's Design tab, no API key needed)
```

- **The LLM never writes gates.** Claude only turns English into a Spec, which is port names and widths plus one expression per output. The Spec is validated and parsed by our own parser ([expr.mjs](expr.mjs)) and never executed. Invalid replies go back to the model with the error, up to 3 attempts.
- **Two compilers, and the smaller verified result wins:**
  - **structural** ([synth.mjs](synth.mjs)): adders, comparators and muxes, with structural hashing, constant folding, carry-in packing of 1-bit terms, and clamp detection for `min(x, 2^k-1)`;
  - **two-level**: Quine–McCluskey and then NAND-NAND, for up to 10 input bits.
- **Verification** ([verify.mjs](verify.mjs)) simulates the exact netlist bytes on all 2^nIn inputs (up to 65,536). It also checks the structure TapeOut requires: no forward references, no LATCH, and outputs as the last signals.

## Use it

```bash
node copilot/cli.mjs --spec copilot/examples/tier_logic_v2.json --policy   # no API key needed
node copilot/cli.mjs "a 2-bit comparator with greater-than and equal"      # needs ANTHROPIC_API_KEY or `ant auth login`
```

You can also use the **Design** tab in the web app, which runs the same compiler in your browser. Output goes to `out/<name>.json`. Paste it into the web app's **Tape out** tab and sign the transaction with your wallet. The CLI never signs or sends transactions.

## Results

| Example | Gates | Notes |
|---|---|---|
| half adder | 5 | optimal |
| full adder (`a + b + c`) | 9 | optimal (carry-in packing) |
| 4-bit adder | 32 | |
| 2-bit comparator (gt, eq) | 27 | |
| **TierLogic v1** | **38** | the hand-built version is 40 |
| TierLogic v2 | 42 | |
| 7-segment hex decoder | 89 | |
| `popcount(x) > 8`, 16 inputs | 325 | 65,536 inputs verified in about 0.6 s |

**Tests:** [test/copilot.expr.test.js](../test/copilot.expr.test.js), [test/copilot.synth.test.js](../test/copilot.synth.test.js) and [test/copilot.llm.test.js](../test/copilot.llm.test.js). They cover expression semantics, spec validation, gate-count limits, and a fuzz test of 300 random expressions compiled by both strategies and verified exhaustively. The LLM tests use a fake client, so they run with no network or key.

## Limits
- Combinational logic only. LATCH-based (stateful) designs are out of scope for now.
- At most 16 input bits, because every input is checked, and at most 32 output bits.
- Shift amounts and `bit()` indexes must be constants. There is no division.
- TapeOut on X Layer doesn't support sub-circuit references yet, so every design is flat.

[GUIDE.md](GUIDE.md) is the original build spec. The implementation differs in two ways:
- the modules are ES modules (`.mjs`), so the browser runs the same compiler;
- the CLI is `cli.mjs`.

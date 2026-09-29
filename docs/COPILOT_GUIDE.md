# Circuit Copilot: build guide

You are implementing **Circuit Copilot**, a tool that turns a plain-English description of a digital circuit into a verified TapeOut netlist that can be taped out on X Layer. Follow this guide in order. Each step ends with a check you must pass before moving on.

Deadline for the whole hackathon is **2026-10-05 21:00 UTC-7**, so aim to finish in 3 days. Correctness beats features.

---

## 0. Context you need

### The project
This repo is a TapeOut Genesis Transistor Hackathon entry. It already contains:

| Path | What it is | May you edit it? |
|---|---|---|
| `circuit/netlist.js` | Netlist builder, encoder, decoder, simulator matching TapeOut's on-chain format | **No.** Import only |
| `circuit/tierLogic.js` | TierLogic v1, the 40-NAND policy circuit used by the vault | **No.** Import only |
| `contracts/CircuitVault.sol` | Staking vault whose reward levels come from a taped-out circuit's `eval()` | **No** |
| `scripts/tapeout.js` | X Layer addresses, fees and ABIs for TapeOut | **No.** Import only |
| `test/*.test.js` | Existing tests; must keep passing | **No** |
| `copilot/`, `test/copilot*.test.js` | **Your work goes here** | Yes |

The copilot's job in the product: vault owners use it to design **new policy circuits** (6 inputs → 3 outputs) from English, verify them, then tape them out and propose them to the vault. It is also a general tool for anyone designing TapeOut circuits.

### TapeOut facts (verified on-chain; do not change these assumptions)
- A circuit is a list of elements. Only two element types are allowed on X Layer: **NAND** (2 inputs → 1 output) and **LATCH** (1 bit of state). Sub-circuit references (`REF`) are **not supported on X Layer**, so never emit them.
- Signal numbering: `0` = constant 0, `1` = constant 1, `2 .. 2+nIn-1` = inputs, then each element appends one new signal in order.
- An element may only reference signals that already exist (lower indices). No cycles.
- **The circuit's outputs are the last `nOut` signals.** Use `Builder.finish(outs)` to guarantee this.
- `eval(circuitId, inputBytes)` packs bits **little-endian**: bit k is `byte[k >> 3]`, bit position `k & 7`. Outputs use the same packing. Use `pack()` / `unpack()` from `circuit/netlist.js`.
- Encoding (already implemented in `Builder.encode()`): NAND = `0x00` + u24 a + u24 b; LATCH = `0x01` + u24 d.
- Cost to tape out: each NAND burns one NAND transistor, each LATCH one LATCH transistor. The author must hold them first (minted at the processor's price plus a protocol fee of 0.00066 OKB per mint tx), plus a tape-out fee of 0.0013 OKB. **Fewer gates means cheaper**, so report gate counts.
- Gas: `eval` costs roughly 3,000 gas per gate. Warn when a design exceeds 2,000 gates.

### Scope: combinational only
Version 1 supports **combinational circuits only** (no LATCH, no clocks, no state). If the user asks for anything stateful (counter, register, memory, "remembers"), refuse politely with a message explaining it is out of scope for v1.

---

## 1. Architecture

```
English prompt
   │
   ▼
[llm.js]   LLM → Spec JSON (names, bit widths, one expression per output)
   │           validated against the schema; repaired or retried up to 3 times
   ▼
[expr.js]  parse each expression → AST (own parser; never JS eval / Function)
   │
   ▼
[table.js] enumerate all 2^nIn input combinations → expected output bits
   │
   ▼
[synth.js] build a NAND netlist with circuit/netlist.js Builder
   │         strategy A: structural (compile the AST into adders, comparators, muxes…)
   │         strategy B: two-level logic from the truth table (Quine–McCluskey → NAND-NAND)
   │         keep whichever verifies AND has fewer gates
   ▼
[verify.js] simulate the netlist on EVERY input and compare with the table: must be 100%
   │
   ▼
out/<name>.json   { spec, netlistHex, nIn, nOut, gates, nNand, nLatch, costEstimate, verified: true }
```

**The golden rule: the LLM never produces gates or netlist bytes.** It only produces the Spec. Everything after that is deterministic and verified. A result with `verified !== true` must never be written to `out/`.

Files to create:

```
copilot/
  spec.js      schema + validation for Spec objects
  expr.js      tokenizer, parser, evaluator for the expression language
  table.js     truth-table enumeration
  synth/
    structural.js   AST → NAND netlist
    twolevel.js     truth table → Quine–McCluskey → NAND netlist
    index.js        run both, pick best verified
  verify.js    exhaustive simulation check
  llm.js       prompt → Spec (provider-agnostic)
  cli.js       command line entry point
  index.js     library entry point: design(prompt | spec) → result
test/
  copilot.expr.test.js
  copilot.synth.test.js
  copilot.e2e.test.js     (no network; uses fixed Spec fixtures)
```

Dependencies: use only what is already in `package.json` (`ethers`, `chai`, `mocha` via hardhat, Node 24 built-ins). For the LLM call, use Node's built-in `fetch`. Do not add packages without writing down why in your final report.

---

## 2. Step 1: the Spec format (`copilot/spec.js`)

```jsonc
{
  "name": "tier_logic_v2",              // [a-z0-9_], 1..40 chars
  "description": "one sentence",
  "inputs":  [ { "name": "size", "bits": 2 }, { "name": "builder", "bits": 1 } ],
  "outputs": [ { "name": "level", "bits": 3, "expr": "min(7, size + builder)" } ]
}
```

Rules to enforce in `validateSpec(spec)` (throw an `Error` with a clear message on the first violation):
- `inputs` and `outputs` non-empty; names unique across both, `[a-z_][a-z0-9_]*`.
- Each `bits` is an integer 1..16.
- Total input bits `nIn` ≤ **16** (the truth table is enumerated), total output bits `nOut` ≤ 32.
- Every output has an `expr` string ≤ 500 chars.
- Bit order is fixed: inputs are laid out in array order, each value LSB first. Example: `size` (2 bits) then `builder` (1 bit) → input bit 0 = size.bit0, bit 1 = size.bit1, bit 2 = builder. Outputs work the same way. Export `layout(spec)` returning these offsets; the web app and CLI both use it.

**Check:** the TierLogic v1 spec below validates, and its `layout()` matches `circuit/tierLogic.js` `inputBits()` order.

```json
{
  "name": "tier_logic_v1",
  "description": "Reward level from stake size, stake age, builder flag and IGNIX flag",
  "inputs": [
    { "name": "size", "bits": 2 }, { "name": "age", "bits": 2 },
    { "name": "builder", "bits": 1 }, { "name": "ignix", "bits": 1 }
  ],
  "outputs": [ { "name": "level", "bits": 3, "expr": "min(7, size + age + builder + ignix)" } ]
}
```

---

## 3. Step 2: the expression language (`copilot/expr.js`)

Write a small recursive-descent parser. **Never use `eval`, `new Function`, `vm`, or regex-based evaluation.**

Grammar (lowest to highest precedence):

```
expr     := ternary
ternary  := or ( "?" expr ":" expr )?
or       := and ( "||" and )*
and      := bitor ( "&&" bitor )*
bitor    := bitxor ( "|" bitxor )*
bitxor   := bitand ( "^" bitand )*
bitand   := cmp ( "&" cmp )*
cmp      := shift ( ("=="|"!="|"<"|"<="|">"|">=") shift )?
shift    := add ( ("<<"|">>") add )*
add      := mul ( ("+"|"-") mul )*
mul      := unary ( "*" unary )*
unary    := ("!"|"~"|"-") unary | primary
primary  := NUMBER | IDENT | IDENT "(" args ")" | "(" expr ")"
functions: min(a,b,...), max(a,b,...), bit(x,i), popcount(x), abs(x)
NUMBER: decimal or 0x hex or 0b binary
```

Semantics: all values are **non-negative integers**. `-` saturates at 0 (document this). Comparisons and `!`, `&&`, `||` return 0/1. `~x` is not allowed unless the result is masked by the output width, so apply masking at the output: every output value is `value & ((1 << bits) - 1)`. Division is intentionally not supported.

Export `parse(src) → AST`, `evaluate(ast, env) → integer`, `identifiers(ast) → Set`.

Validation: every identifier must be a declared input; unknown functions are errors; report the character position.

**Check (`test/copilot.expr.test.js`):** at least 25 cases covering precedence, each operator, each function, saturation of `-`, hex/binary literals, and error messages for unknown identifiers and bad syntax.

---

## 4. Step 3: truth table (`copilot/table.js`)

`truthTable(spec) → { nIn, nOut, rows: Uint8Array[] }` where `rows[x]` holds the expected output bits for input integer `x` (input bits per `layout()`). Enumerate `x = 0 .. 2^nIn - 1`, decode each input's value from its bit slice, evaluate every output expr, mask to width, and write the bits.

**Check:** for TierLogic v1, every row equals `referenceLevel()` from `circuit/tierLogic.js`.

---

## 5. Step 4: synthesis (`copilot/synth/`)

Both strategies take the Spec (and table) and return a `Builder` from `circuit/netlist.js` whose `finish(outs)` has been called with all output bits in layout order.

### Strategy A: structural (`structural.js`)
Compile the AST bottom-up into bit-vectors (arrays of signal indices, LSB first).
- Constants → signals `0` / `1`.
- Inputs → the input signals from `layout()`.
- `+` → ripple-carry adder using `Builder.fullAdder` / `halfAdder`; result width = max width + 1.
- `-` (saturating) → subtract via two's complement; if borrow, select 0 (mux).
- `*` → shift-and-add.
- `==`, `!=`, `<`, `<=`, `>`, `>=` → comparator built from a subtractor's borrow and an XNOR-reduce for equality.
- `& | ^ ~ !`, `&& ||` → bitwise gates (logical ones reduce to 1 bit with OR-reduce first).
- `<<`, `>>` by a **constant** only → rewiring (0 gates). Variable shifts → error "variable shift not supported".
- `?:` → per-bit 2:1 mux: `out = (c AND a) OR (NOT c AND b)`.
- `min`/`max` → comparator + mux; `popcount` → adder tree; `bit(x,i)` with constant `i` → rewiring; `abs` of non-negative values is identity.
- Finally, truncate or zero-extend to the output width.
- **Constant folding and structural hashing:** keep a map from `(op, a, b)` to the existing signal so identical NANDs are never emitted twice. Fold `NAND(x, 0) = 1`, `NAND(0, x) = 1`, `NAND(1, 1) = 0`, and `NOT(NOT(x)) = x` where the inner NOT was emitted by you. Wrap Builder so these rules run on every gate.

### Strategy B: two-level (`twolevel.js`)
Only when `nIn ≤ 10`. For each output bit:
1. Collect minterms from the truth table.
2. Quine–McCluskey to prime implicants, then a greedy set cover (Petrick's method is optional).
3. Emit NAND-NAND: each product term = NAND of its literals (inverted inputs via shared `NOT`s); output = NAND of all product-term NANDs. Single-literal terms and the constant-0/constant-1 cases need special handling.
4. Share inverters and identical product terms across output bits.

### Picking (`index.js`)
Run A, and B if eligible. Verify each (Step 5). Return the verified one with the fewest gates, plus both gate counts for the report. If neither verifies, throw an error. That is a bug: include the failing input in the message.

**Check (`test/copilot.synth.test.js`), every case verified exhaustively:**

| Case | Spec summary | Must verify | Report gates |
|---|---|---|---|
| NOT | `y = !a` | yes | ≤ 2 |
| half adder | `s = a ^ b`, `c = a & b` | yes | ≤ 8 |
| full adder | 3 × 1-bit inputs, `sum` 2 bits = a+b+c | yes | ≤ 14 |
| 4-bit adder | `a`,`b` 4 bits, `s` 5 bits = a+b | yes | ≤ 45 |
| 2-bit comparator | `gt = a > b`, `eq = a == b` | yes | any |
| majority-of-3 | `y = (a+b+c) >= 2` | yes | any |
| 7-segment decoder | 4-bit input, 7 outputs for hex digits 0-F | yes | report |
| **TierLogic v1** | spec from Step 1 | yes | report vs hand-built 40 |
| TierLogic v2 example | `level = size==0 ? 0 : min(7, size + age + builder + 2*ignix)` | yes | report |
| 16-input stress | `y = popcount(x) > 8` with x 16 bits | yes, under 10 s | report |

---

## 6. Step 5: verification (`copilot/verify.js`)

`verify(builder, spec, table) → { ok, checked, failure? }`:
- Encode with `builder.encode()`, then for **every** `x` in `0 .. 2^nIn - 1` run `simulate(netlist, nIn, nOut, bits)` from `circuit/netlist.js` and compare with `table.rows[x]`.
- Also check structurally: every element references only earlier signals, there are no LATCH elements, and the last `nOut` signals are exactly the outputs (decode with `decode()`).
- Return the first failing input as `{ x, expected, got }`.

This is the safety net that makes the tool trustworthy. Do not skip, sample, or short-circuit it.

---

## 7. Step 6: LLM layer (`copilot/llm.js`)

`promptToSpec(prompt, { provider, model, apiKey }) → Spec`

- Provider-agnostic. Implement one adapter per provider, selected by env var `COPILOT_PROVIDER`: `anthropic` (Messages API) and `xai` (OpenAI-compatible chat completions). Read keys only from env vars `ANTHROPIC_API_KEY` / `XAI_API_KEY`. Never log, print or write keys.
- System prompt must include: the Spec JSON format, the full expression grammar from Step 3, the bit-order rule, the combinational-only rule (return `{"error": "stateful circuits are not supported"}` instead of a spec), "Respond with JSON only", and 3 worked examples (half adder, 2-bit comparator, TierLogic v1).
- Parse the reply: take the first `{…}` JSON object, run `validateSpec`, then `parse` every expr. On failure, send the error message back to the model and retry, **max 3 attempts**. Then throw an error that includes the last validation message.
- Temperature 0.
- The LLM must never be asked for gates, netlists or truth tables.

**Check:** a unit test with a fake adapter that returns (1) valid JSON, (2) JSON wrapped in prose, (3) invalid JSON then valid, (4) an `{"error"}` object. No real network calls in tests.

---

## 8. Step 7: CLI (`copilot/cli.js`) and library (`copilot/index.js`)

```
node copilot/cli.js "a 4-bit adder with carry out"          # uses the LLM
node copilot/cli.js --spec examples/tier_logic_v2.json       # skips the LLM
node copilot/cli.js --spec ... --policy                      # also enforce vault policy shape
    options: --out out/  --price <OKB per transistor>  --json
```

Output file `out/<name>.json`:

```json
{
  "spec": { "...": "..." },
  "nIn": 6, "nOut": 3,
  "gates": 40, "nNand": 40, "nLatch": 0,
  "strategy": "structural", "alternatives": { "structural": 40, "twolevel": 57 },
  "netlistHex": "0x…",
  "verified": true, "checkedInputs": 64,
  "cost": { "transistors": 40, "okb": "…", "note": "price × NAND + mint fee 0.00066 + tapeout fee 0.0013" },
  "evalGasEstimate": 120000,
  "policyCompatible": true
}
```

`--policy` mode must fail unless `nIn == 6`, `nOut == 3` and the input names/widths are exactly `size:2, age:2, builder:1, ignix:1`. `CircuitVault._checkCircuit` only checks 6/3, but the semantics of the 6 bits are fixed by the vault.

Human-readable output (no `--json`) prints a summary, the truth table if `nIn ≤ 6`, and next steps: *"Open the web app → Tape out → paste this file"*. **The CLI must never send transactions or touch private keys.** Tape-out happens in the browser wallet via the web app.

`copilot/index.js` exports `design({ prompt?, spec?, policy? }) → result` for use by the web app later.

---

## 9. Step 8: end-to-end tests (`test/copilot.e2e.test.js`)

With no network: load Spec fixtures from `copilot/examples/*.json` (create at least: `half_adder`, `adder4`, `seven_seg`, `tier_logic_v1`, `tier_logic_v2`). For each one, run `design({ spec })` and assert `verified === true` and the gate counts are within the Step 5 table limits. For `tier_logic_v1`, also assert the netlist's simulated outputs equal `circuit/tierLogic.js` `referenceLevel()` for all 64 inputs.

Then run the whole suite. **All existing tests must still pass**:

```
npx hardhat test
```

(Fork tests are skipped unless `FORK=1`. You do not need to run them.)

---

## 10. Rules

- Work only in `copilot/`, `copilot/examples/`, `test/copilot*.test.js`, and optionally add a `"copilot"` script to `package.json`. Do not modify anything else.
- Plain CommonJS, matching the style of `circuit/netlist.js`: small functions, short comments explaining *why*, no classes where a function will do.
- No `eval`, `Function`, `vm`, or `child_process`.
- Never handle private keys, seed phrases or signing. Never make on-chain calls from the copilot.
- Commit in small steps with clear messages, one commit per step above.
- If something in this guide is wrong or impossible, stop and write the problem in `copilot/NOTES.md` instead of improvising around it.

## 11. Definition of done

1. `npx hardhat test` passes with all new tests and all existing ones.
2. `node copilot/cli.js --spec copilot/examples/tier_logic_v1.json --policy` prints `verified: true` and a gate count.
3. `node copilot/cli.js "a 2-bit comparator"` works with a real API key and produces a verified netlist.
4. `copilot/NOTES.md` exists with:
   - gate counts for every example (structural vs two-level),
   - known limitations,
   - anything you deviated from, and why.
5. No file outside the allowed paths changed (`git diff --stat` against the starting commit).

## 12. What the reviewer will check

- Verification is exhaustive and cannot be bypassed.
- The LLM output is treated as untrusted: validated, parsed by our parser, never executed.
- Bit order is consistent across `layout()`, `pack()`, the vault's `circuitInput()`, and the tests.
- Gate counts are reasonable (structural hashing and constant folding actually work).
- No secrets in code, logs or commits.

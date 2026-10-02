# OpenGate

**A staking vault whose reward rules run on a NAND circuit taped out on X Layer.**

Live app: https://kamevetrics.github.io/opengate/

OpenGate is a TapeOut processor on X Layer. Its transistors are the staking asset, and a 40-gate circuit taped out on the same processor sets the reward rule. When anyone stakes, pokes or unstakes, the vault calls that circuit's `eval()` on-chain with the staker's facts, and the circuit returns their reward tier. To change the rule you tape out a new circuit and wait out a 2-day timelock. The owner has no admin switch that bypasses it.

This entry is for the TapeOut Genesis Transistor Hackathon (IGNIX × X Layer × TapeOut). It prototypes the "vault mechanics around a transistor" that IGNIX plans to build for the Genesis Transistor.

## How it works

```
 wallet facts                          TierLogic v1 (40 NAND, on X Layer)        CircuitVault
 ─────────────                         ──────────────────────────────────        ────────────
 stake size  ≥100 / 1k / 10k  ─┐
 stake age   ≥1d / 7d / 30d   ─┼─ 6 bits ─▶ eval(circuitId, input) ─▶ tier 0..7 ─▶ weight = stake × (1 + 0.25·tier)
 owns an OpenGate circuit     ─┤                                                  OKB rewards ∝ weight
 holds ≥100k IGNIX            ─┘
```

- **Circuit** ([circuit/tierLogic.js](circuit/tierLogic.js)): `tier = min(7, size + age + builder + ignix)`. It uses two full adders, a 3-bit incrementer and saturation logic, 40 NAND gates in total. The tests check it on all 64 inputs, both in a JS simulator and against the real `eval()` on forked X Layer.
- **Vault** ([contracts/CircuitVault.sol](contracts/CircuitVault.sol)):
  - Stakes OpenGate NAND/LATCH transistors (ERC-1155) and streams OKB rewards weighted by tier.
  - Anyone can `fund()` rewards or `poke()` a staker's tier.
- **Web app** ([web/](web/)):
  - stake, mint, claim and view your tier;
  - a live, clickable diagram of the circuit, checked against the chain with **Ask the chain**;
  - tape out any design (including Circuit Copilot output) to become a builder;
  - a 4-step setup for the creator.
- **Circuit Copilot** ([copilot/](copilot/)): describe logic in English (via Claude, from the CLI) or as expressions (CLI or the web app's **Design** tab). It compiles to NAND gates and checks the result on every possible input before you can tape it out. It compiles TierLogic to 38 gates, below the hand-built 40. Vault owners use it to write new policy circuits. Anyone can use it to design a circuit, tape it out and become a builder.

### Why taping out matters here
- **Transistor demand:** stakers mint OpenGate transistors to stake them, and the creator earns the mint price.
- **Builders are rewarded:** taping out any circuit on OpenGate burns transistors and raises your tier.
- **Hardware policy:** the rule is an immutable circuit, which anyone can inspect with `netlist(id)` and test with `eval()`, rather than a mutable admin parameter.

## Safety design
- **Unstaking never depends on the circuit.** `unstake()` makes no external calls except returning your tokens. `eval()` and `balanceOf()` are made as low-level calls with gas caps, and any failure means tier 0. A test wipes the TapeOut contract's code on the fork and confirms that stake, poke, claim and unstake all still work.
- **The owner cannot move stakes or rewards.** The owner can only propose a new circuit, which must have 6 inputs and 3 outputs and waits a 2-day timelock (`Ownable2Step`).
- **Dust funding can't dilute rewards.** Funding during an active period raises the rate for the time left instead of stretching the period.
- **No rewards are lost while the vault is empty.** Emission pauses while nobody is staked.
- **Nothing can be deposited by accident.** Transistors sent directly to the vault are rejected. Only `stake()` can pull them in.
- **Known trust assumption:** TapeOut's X Layer contracts are upgradeable beacon proxies owned by the TapeOut factory, and they are in a test phase and unaudited. OpenGate limits the damage an upgrade could do (the worst case is everyone dropping to tier 0), but it cannot remove the dependency.
- **Stale tiers:** a staker's tier only updates when someone pokes. Stake age only raises tiers, and anyone can poke a staker who sold their IGNIX.

## Parameters

| | |
|---|---|
| Processor | OpenGate (`GATE`), 10,000,000 transistors, 0.0001 OKB each (permanent) |
| Policy | TierLogic v1, 6 in / 3 out, 40 NAND |
| Reward weight | 1.00× to 2.75× (+0.25× per tier) |
| Reward period | 7 days |
| IGNIX holder bonus | ≥100,000 IGNIX ([`0x0c95…eeee`](https://www.oklink.com/xlayer/address/0x0c9535416fd3b772646c4575e0664fd65afeeeee)) |
| Policy timelock | 2 days |

## Run it

```bash
npm install
npm test               # circuit tests (fork tests are skipped)
npm run test:fork      # full suite against a fork of X Layer mainnet (real TapeOut contracts)
npm run build:web      # compile and regenerate web/generated.js
npm run web            # serve web/ at http://localhost:5173
```

### Deploy (creator, one time)
1. Serve or host `web/` and open the **Setup** tab with the creator wallet (OKX Wallet) on X Layer.
2. Run the 4 steps: create the processor, tape out TierLogic, deploy the vault, fund rewards. Each step is one wallet signature. No private keys are used anywhere in this repo.
3. Copy the printed config into [web/config.js](web/config.js), commit it, and publish `web/` (for example with GitHub Pages).

## Deployed addresses (X Layer, chain 196)

| Contract | Address |
|---|---|
| OpenGate processor (circuits) | _after setup_ |
| OpenGate transistors (ERC-1155) | _after setup_ |
| TierLogic v1 circuit id | _after setup_ |
| CircuitVault | _after setup_ |

TapeOut factory: [`0x1f09…0761`](https://www.oklink.com/xlayer/address/0x1f09daefa827f02cbb40967cc91b259763760761)

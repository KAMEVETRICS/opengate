# Circuit Copilot

Turns a plain-English circuit description into a **verified** TapeOut NAND netlist that can be taped out on X Layer from the OpenGate web app.

**Status:** not implemented yet. The build spec is [GUIDE.md](GUIDE.md).

## For the implementer

1. Clone the whole repository. Copilot imports shared code from outside this folder, so this folder alone is not enough:
   - [`../circuit/netlist.js`](../circuit/netlist.js): netlist builder, encoder, decoder, simulator (import only)
   - [`../circuit/tierLogic.js`](../circuit/tierLogic.js): reference policy circuit for tests (import only)
   - [`../scripts/tapeout.js`](../scripts/tapeout.js): X Layer fees and ABIs (import only)
2. From the repository root, run `npm install` then `npm test`. You should see 3 passing and 12 pending (the pending ones are fork tests). That is your baseline.
3. Follow [GUIDE.md](GUIDE.md) step by step. Your code goes in this folder (`copilot/`), and your tests go in `../test/copilot*.test.js`.
4. Write your gate counts, limitations and any deviations in `copilot/NOTES.md`.

## Usage (once built)

```bash
node copilot/cli.js "a 2-bit comparator"                         # needs COPILOT_PROVIDER + API key env vars
node copilot/cli.js --spec copilot/examples/tier_logic_v2.json --policy
```

Then open the web app's **Tape out** tab and paste the generated `out/<name>.json`.

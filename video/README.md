# OpenGate demo video

A ~112-second, 1080p explainer built with [Remotion](https://www.remotion.dev): the problem (admin-controlled reward rules), the idea (rules as hardware), how it works, the real TierLogic circuit with simulated signals, changing a rule safely with Circuit Copilot and the impact preview, the safety guarantees, and the live deployment.

All circuit data is real: `scripts/video-data.mjs` exports the taped-out TierLogic netlist layout, simulated signal values for two staker scenarios, and the policy-impact numbers into `src/data/demo.json`.

```bash
node scripts/video-data.mjs     # from the repo root, after changing the circuit or policies
cd video
npm install
npm run studio                  # preview and edit
npm run render                  # -> out/opengate-demo.mp4
```

Rendering uses the system Chrome (see `remotion.config.ts`). Set `REMOTION_CHROME` to its path if it isn't in the default location.

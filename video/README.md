# OpenGate demo video

A ~135-second, 1080p explainer with voiceover built with [Remotion](https://www.remotion.dev): the problem (admin-controlled reward rules), the idea (rules as hardware), how it works, the real TierLogic circuit with simulated signals, changing a rule safely with Circuit Copilot and the impact preview, the safety guarantees, and the live deployment.

All circuit data is real: `scripts/video-data.mjs` exports the taped-out TierLogic netlist layout, simulated signal values for two staker scenarios, and the policy-impact numbers into `src/data/demo.json`.

```bash
node scripts/video-data.mjs     # from the repo root, after changing the circuit or policies
cd video
npm install
npm run studio                  # preview and edit
npm run render                  # -> out/opengate-demo.mp4 (with voiceover)
```

## Voiceover

The script is in `src/data/narration.json`, one paragraph per scene. Each scene stretches to fit its narration, and on-screen moments are cued to the words (`cue()` in `src/Video.tsx`).

```powershell
powershell -File scripts/tts.ps1 -Voice "Microsoft David Desktop" -Rate 1   # built-in Windows voice
node scripts/vo-durations.mjs                                                 # re-time scenes to the audio
npm run render
```

For a more natural voice, replace any `public/vo/<Scene>.wav` (or add an `.mp3` with the same name) with your own recording or another TTS, then run `node scripts/vo-durations.mjs` and render again.

Rendering uses the system Chrome (see `remotion.config.ts`). Set `REMOTION_CHROME` to its path if it isn't in the default location.

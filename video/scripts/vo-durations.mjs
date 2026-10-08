// Measures each public/vo/<Scene>.wav and writes src/data/vo.json (seconds), which
// the timeline uses to make every scene at least as long as its narration.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ffprobe = path.join(root, 'node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe');
const dir = path.join(root, 'public/vo');
const out = {};
for (const f of fs.readdirSync(dir).filter((f) => /\.(wav|mp3)$/.test(f)).sort()) {
  const s = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(dir, f)]).toString().trim();
  out[f.replace(/\.(wav|mp3)$/, '')] = { file: `vo/${f}`, seconds: Number(Number(s).toFixed(3)) };
}
fs.writeFileSync(path.join(root, 'src/data/vo.json'), JSON.stringify(out, null, 2) + '\n');
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.seconds])));

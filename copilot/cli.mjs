#!/usr/bin/env node
// Circuit Copilot CLI. Never signs or sends transactions: tape out the output
// file from the OpenGate web app (Tape out tab) with your own wallet.
//
//   node copilot/cli.mjs "a 2-bit comparator"
//   node copilot/cli.mjs --spec copilot/examples/tier_logic_v2.json --policy
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { design } from './index.mjs';
import { truthTable } from './table.mjs';
import { layout } from './spec.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    spec: { type: 'string' },
    policy: { type: 'boolean', default: false },
    out: { type: 'string', default: 'out' },
    price: { type: 'string', default: '0.0001' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const usage = `Circuit Copilot: English or a spec -> verified TapeOut NAND netlist

  node copilot/cli.mjs "<description>"         ask Claude for a spec (needs ANTHROPIC_API_KEY or 'ant auth login')
  node copilot/cli.mjs --spec <file.json>      compile a spec you wrote

options:
  --policy        require the OpenGate vault policy shape (size:2, age:2, builder:1, ignix:1 -> 3 bits)
  --out <dir>     where to write <name>.json (default: out)
  --price <okb>   transistor mint price for the cost estimate (default: 0.0001, OpenGate's price)
  --json          print the result as JSON only`;

function printTable(spec) {
  const { inputs, outputs } = layout(spec);
  const t = truthTable(spec);
  const head = [...inputs.map((p) => p.name), '→', ...outputs.map((o) => o.name)];
  console.log(`\n  ${head.join('  ')}`);
  t.rows.forEach((row, x) => {
    const ins = inputs.map((p) => String(Math.floor(x / 2 ** p.offset) % 2 ** p.bits).padStart(p.name.length));
    const outs = outputs.map((o) => {
      let v = 0;
      for (let b = 0; b < o.bits; b++) v += row[o.offset + b] * 2 ** b;
      return String(v).padStart(o.name.length);
    });
    console.log(`  ${[...ins, ' ', ...outs].join('  ')}`);
  });
}

async function main() {
  if (values.help || (!values.spec && !positionals.length)) {
    console.log(usage);
    process.exit(values.help ? 0 : 1);
  }
  const priceOkb = Number(values.price);
  if (!(priceOkb >= 0)) throw new Error('--price must be a non-negative number');

  let spec;
  if (values.spec) spec = JSON.parse(fs.readFileSync(values.spec, 'utf8'));
  const prompt = positionals.join(' ');
  if (!values.json && !spec) console.error(`Asking Claude for a spec…`);

  const result = await design({
    spec,
    prompt,
    policy: values.policy,
    priceOkb,
    llm: { onAttempt: (n) => { if (n > 1 && !values.json) console.error(`  retrying (attempt ${n})…`); } },
  });

  fs.mkdirSync(values.out, { recursive: true });
  const file = path.join(values.out, `${result.spec.name}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\n${result.spec.name}: ${result.spec.description || ''}`);
  for (const o of result.spec.outputs) console.log(`  ${o.name} (${o.bits} bit${o.bits > 1 ? 's' : ''}) = ${o.expr}`);
  console.log(`\n  verified:   ${result.verified} (all ${result.checkedInputs.toLocaleString()} inputs checked)`);
  console.log(`  gates:      ${result.gates} NAND  (${result.strategy}; structural ${result.alternatives.structural}, two-level ${result.alternatives.twolevel ?? 'n/a'})`);
  console.log(`  pins:       ${result.nIn} in / ${result.nOut} out`);
  console.log(`  cost:       ~${result.cost.okb} OKB to tape out (${result.cost.note})`);
  console.log(`  eval gas:   ~${result.evalGasEstimate.toLocaleString()}`);
  console.log(`  vault policy shape: ${result.policyCompatible ? 'yes' : 'no'}`);
  if (result.unusedInputs.length) console.log(`  note: inputs never used: ${result.unusedInputs.join(', ')}`);
  if (result.nIn <= 6) printTable(result.spec);
  console.log(`\nWrote ${file}`);
  console.log('Next: open the OpenGate app → Tape out → paste this file, and sign with your wallet.');
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});

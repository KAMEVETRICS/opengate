import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { Backdrop, Rise, GradText, Headline, Body, Caption, Glass, Mono } from '../components/ui';
import { C, mono, serif } from '../theme';
import demo from '../data/demo.json';
import type { SceneProps } from '../Video';

const SIZE = ['< 100', '≥ 100', '≥ 1,000', '≥ 10,000'];
const AGE = ['< 1 day', '≥ 1 day', '≥ 7 days', '≥ 30 days'];
const BIT_NAMES = ['size 0', 'size 1', 'age 0', 'age 1', 'builder', 'IGNIX'];

// Pipeline: wallet facts -> 6 bits -> eval() on X Layer -> tier -> weight -> OKB.
export const HowItWorks: React.FC<SceneProps> = ({ cue }) => {
  const frame = useCurrentFrame();
  const swap = cue('A long-term builder', -8); // switch from scenario 1 to scenario 2
  const s = frame < swap ? demo.scenarios[0] : demo.scenarios[1];
  // Pipeline stages light up on the narration's words; the second pass runs quickly.
  const first = [cue('Your on-chain facts'), cue('become six input bits'), cue('The vault sends'), cue('returns your tier'), cue('A new staker')];
  const thr = (k: number) => (frame < swap ? first[k] : swap + 10 + k * 18);
  const on = (k: number) => frame >= thr(k);
  const pulse = (k: number) => interpolate(frame, [thr(k) - 12, thr(k)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const swapFade = interpolate(frame, [swap - 12, swap, swap + 12], [1, 0.25, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const weight = 1 + 0.25 * s.tier;

  const facts = [
    ['Stake size', SIZE[s.size]],
    ['Stake age', AGE[s.age]],
    ['Builder', s.builder ? 'yes' : 'no'],
    ['IGNIX holder', s.ignix ? 'yes' : 'no'],
  ];

  const Arrow: React.FC<{ k: number }> = ({ k }) => (
    <div style={{ width: 90, height: 6, position: 'relative', alignSelf: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'rgba(255,255,255,.15)' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pulse(k) * 100}%`, borderRadius: 6, background: C.grad }} />
    </div>
  );

  const box = (k: number): React.CSSProperties => ({ opacity: on(k - 1) ? 1 : 0.25, transition: 'none' });

  return (
    <Backdrop>
      <Caption step="1" title="How it works" />
      <AbsoluteFill style={{ padding: '170px 90px 90px', opacity: swapFade }}>
        <Rise>
          <Headline size={72}>Your on-chain facts go in. <GradText italic>A circuit decides your tier.</GradText></Headline>
        </Rise>
        <div style={{ fontSize: 28, color: C.dim, marginTop: 14 }}>Example: <b style={{ color: '#fff' }}>{s.label}</b></div>

        <div style={{ display: 'flex', alignItems: 'stretch', gap: 18, marginTop: 50 }}>
          <Glass style={{ width: 380, ...box(1) }}>
            <div style={{ fontSize: 22, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your wallet</div>
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, fontSize: 26 }}>
                <span style={{ color: C.dim }}>{k}</span><span style={{ color: '#fff' }}>{v}</span>
              </div>
            ))}
          </Glass>
          <Arrow k={1} />
          <Glass style={{ width: 380, ...box(2) }}>
            <div style={{ fontSize: 22, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>6 input bits</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 18 }}>
              {s.bits.map((b: number, i: number) => (
                <div key={i} style={{ borderRadius: 12, padding: '8px 10px', border: `1px solid ${b ? C.on : 'rgba(255,255,255,.15)'}`, background: b ? 'rgba(255,122,69,.15)' : 'transparent', fontFamily: mono, fontSize: 20, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ color: C.dim }}>{BIT_NAMES[i]}</span><b style={{ color: b ? C.on : C.dim }}>{b}</b>
                </div>
              ))}
            </div>
          </Glass>
          <Arrow k={2} />
          <Glass style={{ width: 330, ...box(3), border: `1px solid ${on(2) ? C.on : 'rgba(255,255,255,.14)'}` }}>
            <div style={{ fontSize: 22, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>On X Layer</div>
            <div style={{ fontFamily: serif, fontSize: 46, marginTop: 14, lineHeight: 1.05 }}>TierLogic circuit #1</div>
            <div style={{ fontSize: 22, color: C.dim, marginTop: 8 }}>{demo.gateCount} NAND gates</div>
            <Mono style={{ display: 'block', marginTop: 18, fontSize: 21, color: '#ffb38c' }}>eval(1, 0b{[...s.bits].reverse().join('')})</Mono>
          </Glass>
          <Arrow k={3} />
          <Glass style={{ flex: 1, ...box(4) }}>
            <div style={{ fontSize: 22, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your tier</div>
            <div style={{ fontFamily: serif, fontSize: 150, lineHeight: 1 }}><GradText>{on(3) ? s.tier : '–'}</GradText><span style={{ fontSize: 48, color: C.dim }}>/7</span></div>
            <div style={{ fontFamily: mono, fontSize: 30, color: '#fff', opacity: on(4) ? 1 : 0, whiteSpace: 'nowrap' }}>{weight.toFixed(2)}× weight</div>
            <div style={{ fontSize: 22, color: C.dim, marginTop: 8, opacity: on(4) ? 1 : 0 }}>OKB rewards ∝ stake × weight</div>
          </Glass>
        </div>

        <Rise delay={cue('No admin')} style={{ marginTop: 50 }}>
          <Body style={{ fontSize: 30 }}>
            Every stake, refresh and claim asks the circuit. <b style={{ color: '#fff' }}>No admin can override the answer.</b> Tiers run from 1.00× to 2.75×.
          </Body>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

// The real TierLogic v1 netlist with signals propagating column by column.
export const CircuitScene: React.FC<SceneProps> = ({ d, cue }) => {
  const frame = useCurrentFrame();
  const swap = Math.round(d * 0.5);
  const s = frame < swap ? demo.scenarios[0] : demo.scenarios[1];
  const t0 = frame < swap ? 50 : swap + 15;
  const perCol = 7;
  const lit = (sig: number, depth: number) => s.signals[sig] === 1 && frame >= t0 + depth * perCol;

  const W = 1740, H = 560, x0 = 210, colW = (W - x0 - 230) / demo.maxDepth;
  const rows = Math.max(demo.nIn, ...demo.gates.map((g) => g.colSize));
  const rowH = H / rows;
  const pos = new Map<number, { x: number; y: number; d: number }>();
  for (let k = 0; k < demo.nIn; k++) pos.set(2 + k, { x: x0 - 20, y: (k + 0.5) * (H / demo.nIn), d: 0 });
  for (const g of demo.gates) pos.set(g.out, { x: x0 + (g.depth - 1) * colW + 20, y: ((rows - g.colSize) * rowH) / 2 + g.row * rowH + rowH / 2, d: g.depth });
  const gw = 46, gh = 26;
  const outs = demo.outputs;
  const done = frame >= t0 + (demo.maxDepth + 1) * perCol;
  const labels = ['size bit 0', 'size bit 1', 'age bit 0', 'age bit 1', 'builder', 'IGNIX'];

  return (
    <Backdrop>
      <Caption step="2" title="The real circuit" />
      <AbsoluteFill style={{ padding: '160px 90px 60px' }}>
        <Rise>
          <Headline size={68}>This exact netlist lives on X Layer: <GradText italic>{demo.gateCount} NAND gates.</GradText></Headline>
        </Rise>
        <div style={{ fontSize: 26, color: C.dim, marginTop: 10 }}>{s.label}. Lit wires carry a 1.</div>
        <div style={{ position: 'relative', marginTop: 30, borderRadius: 28, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(8,6,10,.55)', padding: '24px 30px' }}>
          <svg width={W} height={H} style={{ display: 'block' }}>
            {demo.gates.map((g) => {
              const p = pos.get(g.out)!;
              return [g.a, g.b].map((sig, j) => {
                if (sig < 2) return null;
                const src = pos.get(sig)!;
                const sx = sig >= 2 + demo.nIn ? src.x + gw : src.x + 8;
                const ty = p.y + (j ? 6 : -6);
                const mx = (sx + p.x) / 2;
                const on = lit(sig, src.d);
                return <path key={`${g.out}-${j}`} d={`M${sx},${src.y} C${mx},${src.y} ${mx},${ty} ${p.x},${ty}`} fill="none" stroke={on ? C.on : C.off} strokeWidth={on ? 2.6 : 1.4} opacity={on ? 1 : 0.8} />;
              });
            })}
            {demo.gates.map((g) => {
              const p = pos.get(g.out)!;
              const on = lit(g.out, g.depth);
              const isOut = outs.includes(g.out);
              return (
                <g key={g.out}>
                  <rect x={p.x} y={p.y - gh / 2} width={gw} height={gh} rx={8} fill="#221c27" stroke={on ? C.on : '#3b3442'} strokeWidth={on ? 2 : 1} />
                  <text x={p.x + gw / 2} y={p.y + 5} textAnchor="middle" fontFamily={mono} fontSize={12} fill={isOut ? '#fff' : '#a99fb1'}>{isOut ? 'OUT' : 'NAND'}</text>
                </g>
              );
            })}
            {labels.map((l, k) => {
              const p = pos.get(2 + k)!;
              const on = lit(2 + k, 0);
              return (
                <g key={l}>
                  <circle cx={p.x + 8} cy={p.y} r={8} fill={on ? C.on : C.off} />
                  <text x={p.x - 10} y={p.y + 7} textAnchor="end" fontFamily={mono} fontSize={20} fill="#f3eff6">{l}</text>
                </g>
              );
            })}
          </svg>
          <div style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', textAlign: 'center', opacity: done ? 1 : 0.2 }}>
            <div style={{ fontSize: 22, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>tier</div>
            <div style={{ fontFamily: serif, fontSize: 140, lineHeight: 1 }}><GradText>{done ? s.tier : '?'}</GradText></div>
          </div>
        </div>
        <Rise delay={cue('Anyone can read')} style={{ marginTop: 26 }}>
          <Body style={{ fontSize: 30 }}>Anyone can read the netlist and replay <Mono style={{ color: '#ffb38c' }}>eval()</Mono> for free. The app's "Ask the chain" button does exactly that.</Body>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

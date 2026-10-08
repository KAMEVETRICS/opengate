import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Backdrop, Rise, GradText, Headline, Body, Caption, Paper, Glass, Mono, Eyebrow } from '../components/ui';
import { C, mono, serif } from '../theme';
import demo from '../data/demo.json';
import type { SceneProps } from '../Video';

const Typed: React.FC<{ text: string; start: number; cps?: number }> = ({ text, start, cps = 1.4 }) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor((frame - start) * cps)));
  const caret = n < text.length || Math.floor(frame / 15) % 2 === 0;
  return <>{text.slice(0, n)}<span style={{ opacity: caret ? 1 : 0, color: C.on }}>▍</span></>;
};

const Check: React.FC<{ delay: number; children: React.ReactNode }> = ({ delay, children }) => (
  <Rise delay={delay}>
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 28, marginTop: 14 }}>
      <span style={{ width: 34, height: 34, borderRadius: '50%', background: '#e6f6ee', color: C.ok, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 20 }}>✓</span>
      {children}
    </div>
  </Rise>
);

// Circuit Copilot: expression -> NAND gates -> verified on every input.
export const Copilot: React.FC<SceneProps> = () => {
  const p = demo.policies.boost;
  const typedEnd = 40 + p.expr.length / 1.4;
  return (
    <Backdrop>
      <Caption step="3" title="Changing the rule safely" />
      <AbsoluteFill style={{ padding: '170px 110px 90px', flexDirection: 'row', gap: 70, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <Rise><Headline size={84}>Write the rule. <GradText italic>Copilot builds the gates</GradText> and proves them.</Headline></Rise>
          <Rise delay={30}>
            <Body style={{ marginTop: 30 }}>
              Describe a policy in plain English (Claude turns it into a spec) or as an expression. Copilot compiles it to NAND gates and checks the result on <b style={{ color: '#fff' }}>every possible input</b> before it can be taped out.
            </Body>
          </Rise>
          <Rise delay={70}>
            <Body style={{ marginTop: 26, fontSize: 28 }}>The AI never writes gates. The compiler does, and the verifier checks it.</Body>
          </Rise>
        </div>
        <Rise delay={20} style={{ width: 860 }}>
          <Paper>
            <div style={{ fontSize: 22, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>New policy · builders count double</div>
            <div style={{ marginTop: 16, fontFamily: mono, fontSize: 30, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: '22px 24px', minHeight: 80 }}>
              level = <Typed text={p.expr} start={40} />
            </div>
            <Check delay={typedEnd + 15}><span>Compiled to <b>{p.gates} NAND gates</b></span></Check>
            <Check delay={typedEnd + 35}><span>Verified on <b>all 64 inputs</b></span></Check>
            <Check delay={typedEnd + 55}><span>Fits the vault's policy shape: 6 in → 3 out</span></Check>
            <Rise delay={typedEnd + 80}>
              <div style={{ marginTop: 26, display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ background: C.ink, color: '#fff', borderRadius: 999, padding: '14px 18px 14px 28px', fontSize: 26, fontWeight: 600, display: 'flex', gap: 14, alignItems: 'center' }}>
                  Tape it out <span style={{ width: 40, height: 40, borderRadius: '50%', background: C.grad, display: 'grid', placeItems: 'center' }}>→</span>
                </div>
                <span style={{ fontSize: 24, color: C.muted }}>runs in the browser, in milliseconds</span>
              </div>
            </Rise>
          </Paper>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

const Bar: React.FC<{ up: number; down: number; start: number }> = ({ up, down, start }) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [start, start + 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ display: 'flex', height: 26, borderRadius: 999, overflow: 'hidden', background: C.surface, border: `1px solid ${C.line}`, marginTop: 14 }}>
      <div style={{ width: `${(up / 64) * 100 * k}%`, background: C.ok }} />
      <div style={{ width: `${(down / 64) * 100 * k}%`, background: C.bad }} />
    </div>
  );
};

const ImpactCard: React.FC<{ title: string; expr: string; up: number; down: number; start: number; verdict: React.ReactNode; good: boolean }> = ({ title, expr, up, down, start, verdict, good }) => (
  <Rise delay={start} style={{ flex: 1 }}>
    <Paper style={{ height: '100%', borderColor: good ? '#bfe6d1' : '#f2c4c4' }}>
      <div style={{ fontSize: 22, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: 25, marginTop: 14 }}>{expr}</div>
      <div style={{ fontFamily: serif, fontSize: 64, marginTop: 22, lineHeight: 1 }}>
        <span style={{ color: C.ok }}>▲ {up}</span> <span style={{ color: C.muted, fontSize: 40 }}>higher</span>{'  '}
        <span style={{ color: down ? C.bad : C.muted }}>▼ {down}</span> <span style={{ color: C.muted, fontSize: 40 }}>lower</span>
      </div>
      <Bar up={up} down={down} start={start + 15} />
      <div style={{ fontSize: 27, marginTop: 22, color: good ? C.ok : C.bad, fontWeight: 600 }}>{verdict}</div>
    </Paper>
  </Rise>
);

// Impact preview across all 64 staker situations, then the timelock.
export const Impact: React.FC<SceneProps> = ({ cue }) => {
  const { bad, boost } = demo.policies;
  const steps = ['Tape out', 'Propose', '2-day timelock: stakers see the impact', 'Activate'];
  const frame = useCurrentFrame();
  return (
    <Backdrop>
      <Caption step="4" title="Proven before it ships" />
      <AbsoluteFill style={{ padding: '170px 110px 80px' }}>
        <Rise><Headline size={70}>Before a rule goes live, OpenGate shows <GradText italic>who gains and who loses.</GradText></Headline></Rise>
        <Rise delay={20}><Body style={{ marginTop: 16, fontSize: 30 }}>It compares the new circuit with the active one in all 64 situations a staker can be in.</Body></Rise>
        <div style={{ display: 'flex', gap: 30, marginTop: 40 }}>
          <ImpactCard title="Looks generous…" expr={bad.expr} up={bad.up} down={bad.down} start={cue('This policy looks generous')} good={false} verdict="Caught: builders with 30-day stakes would lose a tier" />
          <ImpactCard title="…so we shipped this instead" expr={boost.expr} up={boost.up} down={boost.down} start={cue('So we shipped')} good verdict="Nobody's tier goes down" />
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 44, alignItems: 'center' }}>
          {steps.map((s, i) => {
            const on = frame > cue('Then it waits') + i * 18;
            return (
              <React.Fragment key={s}>
                <div style={{ padding: '14px 24px', borderRadius: 999, fontSize: 25, fontWeight: 600, background: on ? 'rgba(255,122,69,.16)' : 'rgba(255,255,255,.06)', border: `1px solid ${on ? C.on : 'rgba(255,255,255,.15)'}`, color: on ? '#fff' : C.dim }}>{s}</div>
                {i < steps.length - 1 && <div style={{ fontSize: 30, color: on ? C.on : C.off }}>→</div>}
              </React.Fragment>
            );
          })}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

export const Safety: React.FC<SceneProps> = ({ cue }) => {
  const at = [cue('Unstaking'), cue('The owner'), cue('Every funded'), cue("And it's all tested")];
  const items = [
    ['Unstaking never depends on the circuit', 'If TapeOut ever broke, you drop to tier 0 and can still withdraw.'],
    ["The owner can't touch stakes or rewards", 'The only owner power is proposing a new circuit, behind the timelock.'],
    ['Every funded OKB is paid out', 'Emission pauses while the vault is empty, and dust deposits can\'t dilute it.'],
    ['99 tests, including against real TapeOut', 'End-to-end runs on a fork of X Layer mainnet with the live factory.'],
  ];
  return (
    <Backdrop>
      <Caption step="5" title="Built to be trusted" />
      <AbsoluteFill style={{ padding: '180px 110px 80px' }}>
        <Rise><Headline size={84}>Safe even if <GradText italic>everything else fails.</GradText></Headline></Rise>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26, marginTop: 50 }}>
          {items.map(([k, v], i) => (
            <Rise key={k} delay={at[i]}>
              <Glass style={{ minHeight: 210 }}>
                <div style={{ fontFamily: serif, fontSize: 48, lineHeight: 1.1 }}>{k}</div>
                <div style={{ fontSize: 27, color: C.dim, marginTop: 14 }}>{v}</div>
              </Glass>
            </Rise>
          ))}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

export const Live: React.FC = () => {
  const rows = [
    ['OpenGate processor', '0x12FA…A725', '10,000,000 transistors · 0.0001 OKB each'],
    ['Policy circuit', 'TierLogic #1', `${demo.gateCount} NAND gates`],
    ['CircuitVault', '0x5129…733d', 'OKB rewards, 7-day periods'],
  ];
  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 100 }}>
        <Rise><Eyebrow dark>Live on X Layer mainnet</Eyebrow></Rise>
        <Rise delay={10}><Headline size={130} style={{ marginTop: 30 }}>Rewards decided</Headline></Rise>
        <Rise delay={20}><Headline size={130}>by <GradText italic>hardware.</GradText></Headline></Rise>
        <Rise delay={50} style={{ marginTop: 50 }}>
          <Paper style={{ width: 1300, textAlign: 'left', padding: '18px 36px' }}>
            {rows.map(([k, a, d], i) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 0', borderTop: i ? `1px solid ${C.line}` : 'none', fontSize: 28 }}>
                <span style={{ fontWeight: 600, width: 360 }}>{k}</span>
                <Mono style={{ width: 300 }}>{a}</Mono>
                <span style={{ color: C.muted, flex: 1, textAlign: 'right' }}>{d}</span>
              </div>
            ))}
          </Paper>
        </Rise>
        <Rise delay={90} style={{ marginTop: 44 }}>
          <div style={{ display: 'flex', gap: 40, fontSize: 34, justifyContent: 'center' }}>
            <span>kamevetrics.github.io/<b>opengate</b></span>
            <span style={{ color: C.dim }}>·</span>
            <span>github.com/KAMEVETRICS/<b>opengate</b></span>
          </div>
        </Rise>
        <Rise delay={120} style={{ marginTop: 44 }}>
          <div style={{ display: 'flex', gap: 60, justifyContent: 'center', fontSize: 24, fontWeight: 600, letterSpacing: '0.2em', color: C.dim }}>
            <span>X LAYER</span><span>TAPEOUT</span><span>IGNIX</span><span>OKX.AI</span>
          </div>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

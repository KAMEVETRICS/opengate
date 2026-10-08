import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { Backdrop, Rise, GradText, Headline, Body, Eyebrow, Mono, Paper } from '../components/ui';
import { C, mono, serif } from '../theme';
import type { SceneProps } from '../Video';

export const Hook: React.FC = () => (
  <Backdrop>
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <Rise><Eyebrow dark>OpenGate · built on TapeOut · X Layer</Eyebrow></Rise>
      <Rise delay={10}>
        <Headline size={150} style={{ marginTop: 40 }}>Who decides your</Headline>
      </Rise>
      <Rise delay={22}>
        <Headline size={150}><GradText italic>staking rewards?</GradText></Headline>
      </Rise>
    </AbsoluteFill>
  </Backdrop>
);

// A typical vault admin panel: the reward rule is a number someone can change.
export const Problem: React.FC<SceneProps> = ({ cue }) => {
  const frame = useCurrentFrame();
  const changeAt = cue('It can change overnight');
  const t = interpolate(frame, [changeAt, changeAt + 25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const mult = (2.0 - t * 1.0).toFixed(2);
  const flash = frame > changeAt && frame < changeAt + 40 ? 1 - (frame - changeAt) / 40 : 0;
  const points: [string, number][] = [
    ['Rules change overnight, with no warning', cue('It can change overnight')],
    ["You can't check a new rule before it hits you", cue("You can't check")],
    ['"Trust the multisig" is the security model', cue('And the security model')],
  ];
  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '120px 110px', flexDirection: 'row', gap: 90, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <Rise><Eyebrow dark>The problem</Eyebrow></Rise>
          <Rise delay={8}>
            <Headline size={84} style={{ marginTop: 30 }}>
              In most vaults, the reward rule is <GradText italic>a number an admin can change.</GradText>
            </Headline>
          </Rise>
          <div style={{ marginTop: 50, display: 'flex', flexDirection: 'column', gap: 22 }}>
            {points.map(([p, at]) => (
              <Rise key={p} delay={at}>
                <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 36, color: '#e9e3ee' }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: C.bad, flex: 'none' }} />{p}
                </div>
              </Rise>
            ))}
          </div>
          <Rise delay={cue('Stakers carry')}>
            <Body style={{ marginTop: 50, fontSize: 38, color: '#fff' }}>Stakers carry the risk. <GradText>Admins hold the pen.</GradText></Body>
          </Rise>
        </div>

        <Rise delay={30} style={{ width: 720 }}>
          <Paper style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 30px', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', fontSize: 24, color: C.muted }}>
              <span style={{ fontWeight: 600, color: C.ink }}>Vault admin</span><Mono>owner: 0x9f3…c41</Mono>
            </div>
            <div style={{ padding: 30 }}>
              <div style={{ fontSize: 24, color: C.muted }}>Holder reward multiplier</div>
              <div style={{ fontFamily: serif, fontSize: 130, lineHeight: 1.1, color: flash > 0 ? C.bad : C.ink }}>{mult}×</div>
              <div style={{ height: 14, borderRadius: 999, background: C.surface, border: `1px solid ${C.line}`, position: 'relative', marginTop: 10 }}>
                <div style={{ position: 'absolute', inset: 0, width: `${(Number(mult) / 3) * 100}%`, borderRadius: 999, background: C.grad }} />
              </div>
              <div style={{ marginTop: 36, fontSize: 22, color: C.muted }}>Activity</div>
              <div style={{ marginTop: 12, fontFamily: mono, fontSize: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ color: C.muted }}>Mon 14:02 · setMultiplier(holders, 2.00)</div>
                <div style={{ opacity: interpolate(frame, [changeAt, changeAt + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), color: C.bad, background: `rgba(214,69,69,${0.08 + flash * 0.2})`, borderRadius: 10, padding: '6px 10px', margin: '0 -10px' }}>
                  Tue 03:12 · setMultiplier(holders, 1.00)
                </div>
              </div>
            </div>
          </Paper>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

export const Solution: React.FC<SceneProps> = ({ cue }) => {
  const props = [
    ['Immutable', 'the rule is NAND gates on X Layer, not a variable'],
    ['Inspectable', 'anyone can read netlist(id)'],
    ['Replayable', 'anyone can call eval() for free'],
  ];
  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 120 }}>
        <Rise><Eyebrow dark>The idea</Eyebrow></Rise>
        <Rise delay={8}>
          <Headline size={128} style={{ marginTop: 34 }}>OpenGate makes the rule</Headline>
        </Rise>
        <Rise delay={20}>
          <Headline size={128}><GradText italic>hardware.</GradText></Headline>
        </Rise>
        <Rise delay={50}>
          <Body style={{ marginTop: 30, maxWidth: 1300, fontSize: 38 }}>
            Rewards come from a NAND circuit taped out on X Layer with TapeOut. The vault asks the circuit what your tier is, every time.
          </Body>
        </Rise>
        <div style={{ display: 'flex', gap: 28, marginTop: 70 }}>
          {props.map(([k, v], i) => (
            <Rise key={k} delay={cue("It's immutable") + i * 22}>
              <div style={{ width: 470, textAlign: 'left', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 28, padding: '30px 34px' }}>
                <div style={{ fontFamily: serif, fontSize: 56 }}><GradText>{k}</GradText></div>
                <div style={{ fontSize: 28, color: C.dim, marginTop: 8 }}>{v}</div>
              </div>
            </Rise>
          ))}
        </div>
        <Rise delay={cue('Changing it')}>
          <Body style={{ marginTop: 56, fontSize: 32, color: '#e9e3ee' }}>
            Changing it means taping out a new circuit, behind a <b style={{ color: '#fff' }}>2-day timelock</b>.
          </Body>
        </Rise>
      </AbsoluteFill>
    </Backdrop>
  );
};

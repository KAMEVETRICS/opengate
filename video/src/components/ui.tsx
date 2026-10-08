import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { C, serif, sans, mono } from '../theme';

// Dark frame lit by a slowly drifting warm glow (the app's outer frame).
export const Backdrop: React.FC<{ children?: React.ReactNode; light?: boolean }> = ({ children, light }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 40;
  return (
    <AbsoluteFill style={{ background: light ? '#f4f1ec' : C.frame, fontFamily: sans, color: light ? C.ink : '#f3eff6' }}>
      {!light && (
        <>
          <div style={{ position: 'absolute', width: 1100, height: 1100, left: -380 + drift, top: -620, borderRadius: '50%', filter: 'blur(120px)', opacity: 0.7, background: 'conic-gradient(from 120deg, #b44cff, #ff5e62, #ffb347, #b44cff)' }} />
          <div style={{ position: 'absolute', width: 900, height: 900, right: -300 - drift, bottom: -560, borderRadius: '50%', filter: 'blur(120px)', opacity: 0.55, background: 'radial-gradient(circle, #ff5e62, transparent 70%)' }} />
        </>
      )}
      <AbsoluteFill>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

// Fade + rise in, starting at `delay` frames.
export const useEnter = (delay = 0, dur = 18) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: dur });
  return { opacity: s, transform: `translateY(${(1 - s) * 24}px)` };
};

export const Rise: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, children, style }) => {
  const e = useEnter(delay);
  return <div style={{ ...style, ...e }}>{children}</div>;
};

export const GradText: React.FC<{ children: React.ReactNode; italic?: boolean }> = ({ children, italic }) => (
  <span style={{ background: C.grad, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', fontStyle: italic ? 'italic' : 'normal', paddingRight: '0.06em' }}>{children}</span>
);

export const Eyebrow: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark }) => (
  <div style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 999, fontSize: 24, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', border: `1px solid ${dark ? 'rgba(255,255,255,.2)' : C.line}`, background: dark ? 'rgba(255,255,255,.06)' : C.surface, color: dark ? '#e9e3ee' : C.muted }}>
    {children}
  </div>
);

export const Headline: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 110, style }) => (
  <div style={{ fontFamily: serif, fontSize: size, lineHeight: 1.02, letterSpacing: '-0.01em', ...style }}>{children}</div>
);

export const Body: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontSize: 34, lineHeight: 1.45, color: C.dim, ...style }}>{children}</div>
);

export const Mono: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span style={{ fontFamily: mono, ...style }}>{children}</span>
);

// Rounded "glass" card on the dark frame.
export const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 28, padding: '28px 34px', backdropFilter: 'blur(10px)', ...style }}>{children}</div>
);

// White card in the app's light style.
export const Paper: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: C.sheet, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 28, padding: '30px 36px', boxShadow: '0 30px 80px rgba(0,0,0,.35)', ...style }}>{children}</div>
);

// Counter that tweens between values (used for tiers, percentages, counts).
export const Count: React.FC<{ from: number; to: number; start: number; dur?: number; decimals?: number }> = ({ from, to, start, dur = 20, decimals = 0 }) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [start, start + dur], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return <>{v.toFixed(decimals)}</>;
};

export const Caption: React.FC<{ step: string; title: string }> = ({ step, title }) => (
  <div style={{ position: 'absolute', left: 90, top: 70, display: 'flex', alignItems: 'center', gap: 18 }}>
    <div style={{ width: 54, height: 54, borderRadius: '50%', background: C.grad, display: 'grid', placeItems: 'center', fontFamily: mono, fontWeight: 600, fontSize: 22, color: '#fff' }}>{step}</div>
    <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#e9e3ee' }}>{title}</div>
  </div>
);

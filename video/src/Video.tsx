import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { Hook, Problem, Solution } from './scenes/Intro';
import { HowItWorks, CircuitScene } from './scenes/How';
import { Copilot, Impact, Safety, Live } from './scenes/Change';
import narration from './data/narration.json';
import vo from './data/vo.json';
import { FPS } from './theme';

// Each scene gets its duration and a cue() that maps a phrase in its narration to
// the frame where it is (roughly) spoken, so on-screen moments land on the words.
export type SceneProps = { d: number; cue: (phrase: string, offset?: number) => number };

export const TRANSITION = 15;
const LEAD = 12; // narration starts 0.4 s into a scene, after the crossfade
const TAIL = 21; // and the scene holds 0.7 s after it ends

const LIST: [string, React.FC<SceneProps>, number][] = [
  ['Hook', Hook, 150],
  ['Problem', Problem, 480],
  ['Solution', Solution, 360],
  ['HowItWorks', HowItWorks, 560],
  ['CircuitScene', CircuitScene, 480],
  ['Copilot', Copilot, 330],
  ['Impact', Impact, 450],
  ['Safety', Safety, 330],
  ['Live', Live, 330],
];

type Entry = { name: string; Scene: React.FC<SceneProps>; d: number; voFrames: number; cue: SceneProps['cue'] };

export const SCENES: Entry[] = LIST.map(([name, Scene, base]) => {
  const text: string = (narration as Record<string, string>)[name] ?? '';
  const voFrames = Math.ceil(((vo as Record<string, { seconds: number }>)[name]?.seconds ?? 0) * FPS);
  const d = Math.max(base, LEAD + voFrames + TAIL);
  // Character position is a good-enough proxy for speaking time at a steady rate.
  const cue = (phrase: string, offset = 0) => {
    const i = text.indexOf(phrase);
    if (i < 0) throw new Error(`cue "${phrase}" not found in ${name} narration`);
    return LEAD + Math.round((i / text.length) * voFrames) + offset;
  };
  return { name, Scene, d, voFrames, cue };
});

export const DURATION = SCENES.reduce((s, e) => s + e.d, 0) - TRANSITION * (SCENES.length - 1);

export const OpenGateDemo: React.FC = () => (
  <TransitionSeries>
    {SCENES.flatMap(({ name, Scene, d, voFrames, cue }, i) => {
      const seq = (
        <TransitionSeries.Sequence key={name} durationInFrames={d}>
          <Scene d={d} cue={cue} />
          {voFrames > 0 && (
            <Sequence from={LEAD} durationInFrames={voFrames + 5}>
              <Audio src={staticFile((vo as Record<string, { file: string }>)[name].file)} />
            </Sequence>
          )}
        </TransitionSeries.Sequence>
      );
      return i === 0 ? [seq] : [
        <TransitionSeries.Transition key={`t-${name}`} presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />,
        seq,
      ];
    })}
  </TransitionSeries>
);

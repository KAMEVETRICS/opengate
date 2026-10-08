import React from 'react';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { Hook, Problem, Solution } from './scenes/Intro';
import { HowItWorks, CircuitScene } from './scenes/How';
import { Copilot, Impact, Safety, Live } from './scenes/Change';

// Scene lengths in frames (30 fps). Story: problem -> idea -> how it works ->
// the real circuit -> changing the rule safely -> guarantees -> live.
export const SCENES: [React.FC, number][] = [
  [Hook, 150],
  [Problem, 480],
  [Solution, 360],
  [HowItWorks, 560],
  [CircuitScene, 480],
  [Copilot, 330],
  [Impact, 450],
  [Safety, 330],
  [Live, 330],
];
export const TRANSITION = 15;
export const DURATION = SCENES.reduce((s, [, d]) => s + d, 0) - TRANSITION * (SCENES.length - 1);

export const OpenGateDemo: React.FC = () => (
  <TransitionSeries>
    {SCENES.flatMap(([Scene, d], i) => {
      const seq = (
        <TransitionSeries.Sequence key={`s${i}`} durationInFrames={d}>
          <Scene />
        </TransitionSeries.Sequence>
      );
      return i === 0 ? [seq] : [
        <TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />,
        seq,
      ];
    })}
  </TransitionSeries>
);

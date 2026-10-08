import React from 'react';
import { Composition } from 'remotion';
import { OpenGateDemo, DURATION } from './Video';
import { FPS } from './theme';

export const Root: React.FC = () => (
  <Composition id="OpenGateDemo" component={OpenGateDemo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
);

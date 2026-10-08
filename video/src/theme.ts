import { loadFont as loadSerif } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as loadSans } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/IBMPlexMono';

export const serif = loadSerif('normal', { weights: ['400'] }).fontFamily;
loadSerif('italic', { weights: ['400'] });
export const sans = loadSans('normal', { weights: ['400', '500', '600', '700'] }).fontFamily;
export const mono = loadMono('normal', { weights: ['400', '500', '600'] }).fontFamily;

// Same palette as the OpenGate web app.
export const C = {
  frame: '#121014',
  ink: '#141216',
  sheet: '#ffffff',
  surface: '#f7f5f2',
  line: '#e7e3dd',
  muted: '#6e6a72',
  dim: '#a99fb1',
  on: '#ff7a45',
  off: '#3b3442',
  ok: '#1f9d63',
  bad: '#d64545',
  grad: 'linear-gradient(135deg, #ffb347 0%, #ff5e62 48%, #b44cff 100%)',
};

export const FPS = 30;

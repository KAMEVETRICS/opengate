import { Config } from '@remotion/cli/config';

// Use the system Chrome: the downloaded headless shell can't be launched in some
// sandboxed environments. Override with REMOTION_CHROME if Chrome lives elsewhere.
Config.setBrowserExecutable(process.env.REMOTION_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
Config.setVideoImageFormat('jpeg');
Config.setConcurrency(4);

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ignatiusreza.voicerunner',
  appName: 'Voice Runner',
  webDir: 'dist',
  android: {
    // The mic stream must survive the webview being backgrounded mid-run.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
    },
  },
};

export default config;

import { defineConfig } from '@playwright/test'

const origin = 'http://127.0.0.1:5198'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 75_000,
  reporter: 'list',
  use: {
    channel: 'chrome',
    baseURL: origin,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command:
      'pnpm --filter orb-ui-demo dev --host 127.0.0.1 --port 5198 --strictPort --logLevel silent',
    cwd: new URL('../..', import.meta.url).pathname,
    url: origin + '/playground/',
    reuseExistingServer: false,
    timeout: 45_000,
  },
})

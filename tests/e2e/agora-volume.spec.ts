import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import type Agora from 'agora-rtc-sdk-ng'
import { agoraLevelToRms } from '../../src/adapters/agora/volume'

test('decodes actual Agora RTC track levels across seven amplitudes without joining a room', async ({
  page,
}) => {
  const url = 'http://127.0.0.1:4173/agora-meter-fixture'
  await page.route('**/*', (route) =>
    route.request().url() === url
      ? route.fulfill({ contentType: 'text/html', body: '<button>Start audio</button>' })
      : route.abort(),
  )
  await page.goto(url)
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('agora-rtc-sdk-ng/full') })
  await page.getByRole('button').click()
  const readings = await page.evaluate(async () => {
    const sdk = (window as unknown as { AgoraRTC: typeof Agora }).AgoraRTC
    sdk.setLogLevel(4)
    sdk.disableLogUpload()
    const context = new AudioContext()
    await context.resume()
    const destination = context.createMediaStreamDestination()
    const oscillator = context.createOscillator()
    oscillator.frequency.value = 1000
    const gain = context.createGain()
    gain.gain.value = 0
    oscillator.connect(gain).connect(destination)
    const track = sdk.createCustomAudioTrack({
      mediaStreamTrack: destination.stream.getAudioTracks()[0],
    })
    const results = []
    try {
      oscillator.start()
      for (const amplitude of [0, 0.002, 0.01, 0.035, 0.1, 0.25, 0.7]) {
        gain.gain.value = amplitude
        await new Promise((resolve) => setTimeout(resolve, 250))
        results.push({ amplitude, sdkLevel: track.getVolumeLevel() })
      }
    } finally {
      oscillator.stop()
      track.close()
      await context.close()
    }
    return results
  })
  for (const { amplitude, sdkLevel } of readings) {
    const rms = amplitude / Math.SQRT2
    expect(Math.abs(agoraLevelToRms(sdkLevel) - rms)).toBeLessThan(Math.max(0.0001, rms * 0.03))
  }
})

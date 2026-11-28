import { test, expect } from '@playwright/test'
import { installPlaybackReference } from '../live/playback-reference'

test('the QA playback reference returns to silence after a source disconnects', async ({
  page,
}) => {
  const url = 'http://127.0.0.1:4173/playback-meter-fixture'
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<button>Start audio</button>' }),
  )
  await page.addInitScript(installPlaybackReference)
  await page.goto(url)
  await page.getByRole('button').click()
  const [playing, disconnected] = await page.evaluate(async () => {
    const context = new AudioContext()
    try {
      await context.resume()
      const source = context.createOscillator()
      source.connect(context.destination)
      source.start()
      await new Promise((resolve) => setTimeout(resolve, 350))
      const samples = window.orbQaPlayback!
      const playing = samples[samples.length - 1].rms
      source.disconnect(context.destination)
      await new Promise((resolve) => setTimeout(resolve, 350))
      source.stop()
      return [playing, samples[samples.length - 1].rms]
    } finally {
      await context.close()
    }
  })
  expect(playing).toBeGreaterThan(0.5)
  expect(disconnected).toBeLessThan(0.001)
})

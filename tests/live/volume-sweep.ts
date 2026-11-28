import { readFileSync, writeFileSync } from 'node:fs'
import { test, type Page } from '@playwright/test'
import { createVolumeNormalizer } from 'orb-ui/adapters'
import { matchPlayback, percentile, referenceProfile } from './volume-measurement'

const gains = [0, 0.15, 0.3, 0.5, 0.75, 1, 1.4]

function saveLevels(name: string, values: unknown) {
  writeFileSync(test.info().outputPath(name + '.json'), JSON.stringify(values))
}

export async function measureSweep(page: Page, question: string, probeOutput: boolean) {
  const frames = page.frames()
  const active = await Promise.all(frames.map((f) => f.evaluate(() => !!window.orbQaReference)))
  const microphone = frames[active.indexOf(true)]
  if (!microphone) throw new Error('No active test microphone')
  if (probeOutput) {
    const routed = await microphone.evaluate(() => window.orbQaRouteReceiveMeters?.())
    if (!routed) throw new Error('No incoming WebRTC analyser accepted the recorded output probe')
  }
  const narration = readFileSync(
    new URL('../../demo/public/fixtures/narration.wav', import.meta.url),
  ).toString('base64')
  const fixtures = [
    { name: 'question', clip: question, headroom: 1, levels: gains },
    { name: 'narration', clip: narration, headroom: 0.9, levels: [...gains].reverse() },
  ]
  const mismatches: string[] = []
  for (const { name, clip, headroom, levels } of fixtures) {
    const steps = []
    for (const gain of levels) {
      // Allow the previous envelope to decay before comparing another level.
      await page.waitForTimeout(650)
      const ref = await microphone.evaluate(
        async ({ clip, gain, headroom }) => {
          await window.orbQaPlay!(clip, gain, 2.7, headroom)
          return window.orbQaReference!
        },
        { clip, gain, headroom },
      )
      const samples = await page.evaluate(
        ({ start, rms }) =>
          window
            .orbQaSamples!.filter((s) => s.time >= start && s.time < start + rms.length * 33)
            .map((s) => ({
              time: s.time - start,
              raw: s.rawInput,
              displayed: s.input,
              output: s.output,
              state: s.state,
            })),
        ref,
      )
      if (samples.length < 40) throw new Error('Incomplete microphone sweep at gain ' + gain)
      if (samples.some((s) => s.state === 'idle' || s.state === 'error'))
        throw new Error('Call ended during the microphone sweep')
      const normalizer = createVolumeNormalizer(referenceProfile)
      const trace = samples.map((s) => {
        const rms = ref.rms[Math.floor(s.time / 33)]
        const expected = normalizer.sample(rms * gain, s.time).normalized
        return { ...s, expected, rms }
      })
      const voiced = trace.filter((s) => s.rms >= 0.01)
      steps.push({ gain, trace })
      if (voiced.length < 20) throw new Error('Insufficient voiced microphone samples')
      const median = percentile(
        voiced.map((s) => s.displayed),
        0.5,
      )!
      const reference = percentile(
        voiced.map((s) => s.expected),
        0.5,
      )!
      const outputMedian = probeOutput
        ? percentile(
            voiced.map((s) => s.output),
            0.5,
          )!
        : undefined
      const tolerance = gain === 0 ? 0.02 : 0.1
      for (const [direction, value] of [
        ['input', median],
        ['output', outputMedian],
      ] as const) {
        if (
          value !== undefined &&
          (!Number.isFinite(value) || Math.abs(value - reference) > tolerance)
        )
          mismatches.push(
            name + ' at ' + gain + '× ' + direction + ' ' + value + ' vs ' + reference.toFixed(2),
          )
      }
      console.log(
        'ORB_QA_SWEEP',
        JSON.stringify({
          provider: test.info().title,
          fixture: name,
          gain,
          median,
          reference,
          outputMedian,
        }),
      )
    }
    saveLevels('mic-' + name, steps)
  }
  if (probeOutput) {
    await microphone.evaluate(() => window.orbQaRestoreReceiveMeters?.())
    if (mismatches.length) throw new Error(mismatches.join('\n'))
    return
  }
  const playback = await matchPlayback(page, await page.evaluate(() => window.orbQaSamples!))
  saveLevels('playback-levels', playback)
  const audible = playback.filter((s) => s.rms >= 0.015)
  const bands = [
    [0, 0.35],
    [0.35, 0.65],
    [0.65, 1.01],
  ].map(([low, high]) => {
    const deltas = audible
      .filter((s) => s.expected >= low && s.expected < high)
      .map((s) => s.displayed - s.expected)
    return {
      samples: deltas.length,
      medianError: percentile(deltas, 0.5),
      p90AbsError: percentile(deltas.map(Math.abs), 0.9),
    }
  })
  console.log('ORB_QA_PLAYBACK', JSON.stringify({ provider: test.info().title, bands }))
  if (mismatches.length) throw new Error(mismatches.join('\n'))
}

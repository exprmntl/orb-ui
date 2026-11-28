import { createVolumeNormalizer } from 'orb-ui/adapters'
import type { Page } from '@playwright/test'

type Sample = {
  time: number
  input: number
  output: number
  rawInput?: number
  rawOutput?: number
  state: string
}
type Reference = { start: number; rms: number[] }
declare global {
  interface Window {
    orbQaMicrophone?: MediaStream
    orbQaRouteReceiveMeters?: () => number
    orbQaRestoreReceiveMeters?: () => void
    orbQaPlayback?: { time: number; rms: number }[]
    orbQaMarkSpeech?: (buffer: AudioBuffer) => void
    orbQaSamples?: Sample[]
    orbQaReference?: Reference
    orbQaPlay?: (
      encoded: string,
      gain: number,
      duration?: number,
      headroom?: number,
    ) => Promise<void>
  }
}

// Tag voiced 33 ms windows from the source waveform, independently of the provider's meter.
export function installSpeechReference() {
  window.orbQaMarkSpeech = (buffer: AudioBuffer) => {
    const pcm = buffer.getChannelData(0)
    const block = Math.round(buffer.sampleRate * 0.033)
    const rms: number[] = []
    for (let i = 0; i < pcm.length; i += block) {
      const end = Math.min(i + block, pcm.length)
      let squares = 0
      for (let j = i; j < end; j++) squares += pcm[j] ** 2
      rms.push(Math.sqrt(squares / (end - i)))
    }
    window.orbQaReference = { start: performance.timeOrigin + performance.now(), rms }
  }
}

export async function startMeasuring(page: Page) {
  await page.evaluate(() => {
    const meter = (id: string) => document.querySelector('[data-testid="qa-' + id + '"]')
    const input = meter('input-volume')
    const output = meter('output-volume')
    const state = meter('state')
    if (!input || !output || !state) throw new Error('Missing QA meters')
    const samples: Sample[] = []
    window.orbQaSamples = samples
    const timer = window.setInterval(
      () =>
        samples.push({
          time: performance.timeOrigin + performance.now(),
          input: Number(input.textContent),
          output: Number(output.textContent),
          rawInput: input.hasAttribute('data-raw')
            ? Number(input.getAttribute('data-raw'))
            : undefined,
          rawOutput: output.hasAttribute('data-raw')
            ? Number(output.getAttribute('data-raw'))
            : undefined,
          state: state.textContent ?? '',
        }),
      33,
    )
    // Stop after the fixed capture window even if the test aborts.
    window.setTimeout(() => clearInterval(timer), 140_000)
  })
  // Capture the quiet baseline before playing speech.
  await page.waitForTimeout(500)
}

export function percentile(values: number[], fraction: number) {
  if (!values.length) return null
  return values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)]
}

export async function readMeasurement(page: Page) {
  // Replies differ in length and voice. Observe up to four seconds of playback.
  await page.waitForTimeout(4000)
  const references = await Promise.all(
    page.frames().map((frame) => frame.evaluate(() => window.orbQaReference)),
  )
  const reference = references.find((r) => r !== undefined)
  if (!reference) throw new Error('No reference waveform in the active microphone frame')
  const samples = await page.evaluate(() => window.orbQaSamples ?? [])
  if (samples.some((s) => [s.input, s.output].some((v) => !Number.isFinite(v) || v < 0 || v > 1))) {
    throw new Error('Orb reported a volume outside the finite 0–1 range')
  }
  const input = samples.filter(
    (s) => reference.rms[Math.floor((s.time - reference.start) / 33)] >= 0.01,
  )
  const quiet = samples.filter((s) => s.time < reference.start)
  const end = reference.start + reference.rms.length * 33
  const output = samples.filter((s) => s.time >= end && s.state === 'speaking')
  if (input.length < 10 || output.length < 3)
    throw new Error('Insufficient speech samples to compare volumes')
  const matched = await matchPlayback(
    page,
    samples.filter((s) => s.time >= end),
  )
  const deltas = matched.filter((s) => s.rms >= 0.015).map((s) => s.displayed - s.expected)
  return {
    measuredReplySamples: deltas.length,
    replyBias: deltas.length >= 10 ? percentile(deltas, 0.5) : null,
    quietP90: percentile(
      quiet.map((s) => s.input),
      0.9,
    ),
    inputMedian: percentile(
      input.map((s) => s.input),
      0.5,
    ),
    inputP90: percentile(
      input.map((s) => s.input),
      0.9,
    ),
    replyMedian: percentile(
      output.map((s) => s.output),
      0.5,
    ),
    replyP90: percentile(
      output.map((s) => s.output),
      0.9,
    ),
    inputSamples: input.length,
    replySamples: output.length,
  }
}

export const referenceProfile = {
  amplitude: { silenceFloor: 0, speechReference: 0.105112, speechPeak: 0.25 },
  envelope: { riseTimeMs: 100, fallTimeMs: 400 },
}

export async function matchPlayback(page: Page, samples: Sample[]) {
  const levels = (
    await Promise.all(
      page.frames().map((frame) => frame.evaluate(() => window.orbQaPlayback ?? [])),
    )
  )
    .flat()
    .sort((a, b) => a.time - b.time)
  // Fixed comparison curve for audible RMS. Keep it independent of provider tuning.
  const normalizer = createVolumeNormalizer(referenceProfile)
  const matched: {
    time: number
    rms: number
    raw?: number
    displayed: number
    expected: number
  }[] = []
  let cursor = 0
  for (const sample of samples) {
    while (cursor < levels.length && levels[cursor].time < sample.time - 25) cursor++
    let rms = 0
    for (let i = cursor; i < levels.length && levels[i].time <= sample.time + 12; i++) {
      rms = Math.max(rms, levels[i].rms)
    }
    const baseline = normalizer.sample(rms, sample.time)
    matched.push({
      time: sample.time - samples[0].time,
      rms,
      raw: sample.rawOutput,
      displayed: sample.output,
      expected: baseline.normalized,
    })
  }
  return matched
}

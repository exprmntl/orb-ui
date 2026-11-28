import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createVolumeNormalizer, mapVolumeAmplitude } from './audio-level'
import {
  DEEPGRAM_VOLUME_CALIBRATION,
  PCM_VOLUME_CALIBRATION,
  PROVIDER_VOLUME_CALIBRATIONS,
} from './volume-presets'

// Both committed fixtures contain mono, 16-bit little-endian PCM. Skip WAV metadata.
function waveformRms(fixture: string) {
  const wav = readFileSync(new URL(fixture, import.meta.url))
  const format = wav.indexOf('fmt ') + 8
  const data = wav.indexOf('data') + 8
  expect(wav.readUInt16LE(format)).toBe(1)
  expect(wav.readUInt16LE(format + 2)).toBe(1)
  expect(wav.readUInt16LE(format + 14)).toBe(16)
  const block = Math.round(wav.readUInt32LE(format + 4) * 0.033)
  const samples = wav.readUInt32LE(data - 4) / 2
  const rms: number[] = []
  for (let start = 0; start < samples; start += block) {
    const end = Math.min(start + block, samples)
    let squares = 0
    for (let i = start; i < end; i++) squares += (wav.readInt16LE(data + 2 * i) / 32768) ** 2
    rms.push(Math.sqrt(squares / (end - start)))
  }
  return rms
}

describe('provider volume calibrations', () => {
  it.each(['../../tests/live/question.wav', '../../demo/public/fixtures/narration.wav'])(
    'aligns waveform-based meters and the scaled Deepgram meter on %s',
    (fixture) => {
      const waveform = waveformRms(fixture)
      for (const [gain, lower, upper] of [
        [0.45, 0.25, 0.45],
        [1, 0.45, 0.65],
        [1.4, 0.65, 0.85],
      ]) {
        const waveformMeter = createVolumeNormalizer(PCM_VOLUME_CALIBRATION)
        const trace = waveform.map((rms, i) => waveformMeter.sample(rms * gain, i * 33).normalized)
        const { openai, gemini, pipecat, vapi } = PROVIDER_VOLUME_CALIBRATIONS
        for (const profile of [
          openai.input,
          openai.output,
          gemini.input,
          gemini.output,
          pipecat.input,
          pipecat.output,
          vapi.input,
          DEEPGRAM_VOLUME_CALIBRATION,
        ]) {
          const normalizer = createVolumeNormalizer(profile)
          const scale = profile === DEEPGRAM_VOLUME_CALIBRATION ? 4 : 1
          waveform.forEach((rms, i) => {
            const raw = Math.min(1, rms * gain * scale)
            expect(normalizer.sample(raw, i * 33).normalized).toBeCloseTo(trace[i], 10)
          })
        }
        const voiced = trace.filter((_, i) => waveform[i] >= 0.01).sort((a, b) => a - b)
        const median = voiced[Math.floor((voiced.length - 1) / 2)]
        expect(median).toBeGreaterThan(lower)
        expect(median).toBeLessThan(upper)
      }
    },
  )

  it.each([
    ['input', 0.33],
    ['output', 0.31],
  ] as const)(
    'keeps ordinary ElevenLabs %s activity in the middle of the range',
    (direction, raw) => {
      // Ordinary speech from the question and narration recordings on client 1.38.
      // Both directions use the SDK's voice-band frequency meter.
      const normalizer = createVolumeNormalizer(PROVIDER_VOLUME_CALIBRATIONS.elevenlabs[direction])
      let normalized = 0
      for (let time = 0; time <= 1000; time += 33) {
        normalized = normalizer.sample(raw, time).normalized
      }
      expect(normalized).toBeGreaterThan(0.35)
      expect(normalized).toBeLessThan(0.65)
    },
  )

  it('uses the shared speech anchors and envelope semantics in every direction', () => {
    for (const directions of Object.values(PROVIDER_VOLUME_CALIBRATIONS)) {
      for (const profile of Object.values(directions)) {
        expect(profile.amplitude.silenceFloor).toBeLessThan(profile.amplitude.speechReference)
        expect(profile.amplitude.speechReference).toBeLessThan(profile.amplitude.speechPeak)
        expect(mapVolumeAmplitude(profile.amplitude.silenceFloor, profile.amplitude)).toBe(0)
        expect(
          mapVolumeAmplitude(profile.amplitude.speechReference, profile.amplitude),
        ).toBeCloseTo(0.5)
        expect(mapVolumeAmplitude(profile.amplitude.speechPeak, profile.amplitude)).toBe(1)
        expect(profile.envelope).toEqual({ riseTimeMs: 100, fallTimeMs: 400 })
      }
    }
  })
})

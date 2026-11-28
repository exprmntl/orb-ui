import type { VolumeCalibration } from './audio-level'

export interface DirectionalVolumeCalibration {
  input?: VolumeCalibration
  output?: VolumeCalibration
}

const CANONICAL_ENVELOPE = {
  riseTimeMs: 100,
  fallTimeMs: 400,
} as const

function calibration(
  silenceFloor: number,
  speechReference: number,
  speechPeak: number,
): VolumeCalibration {
  return {
    amplitude: { silenceFloor, speechReference, speechPeak },
    envelope: { ...CANONICAL_ENVELOPE },
  }
}

// Shared by adapters that meter unscaled waveform RMS at browser playback.
export const PCM_VOLUME_CALIBRATION = calibration(0.003, 0.1, 0.3)

/**
 * Shipped provider baselines. The playground calibration runner generates
 * replacements from guided raw-level captures without requiring manual sliders.
 */
export const PROVIDER_VOLUME_CALIBRATIONS = {
  vapi: {
    input: calibration(0, 0.105_112, 0.25),
    output: calibration(0.005, 0.4, 1),
  },
  elevenlabs: {
    input: calibration(0, 0.36, 0.52),
    output: calibration(0, 0.4, 0.55),
  },
  livekit: {
    input: calibration(0, 0.18, 0.4),
    output: calibration(0.015, 0.18, 0.3),
  },
  pipecat: {
    input: calibration(0.002, 0.107_112, 0.252),
    output: calibration(0.002, 0.084_441, 0.198_078),
  },
  openai: {
    input: calibration(0, 0.105_112, 0.25),
    output: PCM_VOLUME_CALIBRATION,
  },
  gemini: {
    input: calibration(0, 0.105_112, 0.25),
    output: PCM_VOLUME_CALIBRATION,
  },
} as const satisfies Record<string, DirectionalVolumeCalibration>

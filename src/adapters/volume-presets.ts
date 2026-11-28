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

function pcmProfile() {
  return calibration(0.002, 0.105112, 0.25)
}

/** Default for unscaled RMS measurements of mono microphone or playback samples. */
export const PCM_VOLUME_CALIBRATION = Object.freeze(pcmProfile())
Object.freeze(PCM_VOLUME_CALIBRATION.amplitude)
Object.freeze(PCM_VOLUME_CALIBRATION.envelope)

// AgentMicrophone and AgentPlayer return min(1, 4 * RMS).
export const DEEPGRAM_VOLUME_CALIBRATION = calibration(
  4 * PCM_VOLUME_CALIBRATION.amplitude.silenceFloor,
  4 * PCM_VOLUME_CALIBRATION.amplitude.speechReference,
  4 * PCM_VOLUME_CALIBRATION.amplitude.speechPeak,
)

/**
 * Shipped provider baselines. The playground calibration runner generates
 * replacements from guided raw-level captures without requiring manual sliders.
 */
export const PROVIDER_VOLUME_CALIBRATIONS = {
  vapi: {
    input: pcmProfile(),
    output: calibration(0.005, 0.4, 1),
  },
  elevenlabs: {
    input: calibration(0, 0.307, 0.447),
    output: calibration(0, 0.307, 0.447),
  },
  livekit: {
    input: calibration(0.002, 0.19, 0.247),
    output: calibration(0.002, 0.19, 0.247),
  },
  pipecat: {
    input: pcmProfile(),
    output: pcmProfile(),
  },
  openai: {
    input: pcmProfile(),
    output: pcmProfile(),
  },
  gemini: {
    input: pcmProfile(),
    output: pcmProfile(),
  },
} as const satisfies Record<string, DirectionalVolumeCalibration>

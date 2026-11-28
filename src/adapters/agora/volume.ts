import {
  createVolumeNormalizer,
  DEFAULT_VOLUME_CALIBRATION,
  type VolumeCalibrationSource,
} from '../audio-level'
import { PCM_VOLUME_CALIBRATION } from '../volume-presets'

/** Agora RTC 4.x encodes waveform power across a 100 dB range in getVolumeLevel(). */
export function agoraLevelToRms(level: number) {
  return Number.isFinite(level) && level > 0 ? 10 ** (5 * (Math.min(1, level) - 1)) : 0
}

export function createAgoraMeter(overrides?: VolumeCalibrationSource) {
  // Existing calibration callbacks describe anchors in Agora SDK units.
  if (overrides) return createVolumeNormalizer(DEFAULT_VOLUME_CALIBRATION, overrides)
  const meter = createVolumeNormalizer(PCM_VOLUME_CALIBRATION)
  return { reset: meter.reset, sample: (level: number) => meter.sample(agoraLevelToRms(level)) }
}

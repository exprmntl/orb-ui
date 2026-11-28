import type { OrbSignal, OrbState } from './Orb.types'

export function deriveOrbState(
  state: OrbState | undefined,
  signal: OrbSignal | undefined,
  adapterSignal: OrbSignal,
): OrbState {
  return state ?? signal?.state ?? adapterSignal.state
}

export function boundedVolume(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export function selectOrbVolume(state: OrbState, signal: OrbSignal) {
  if (state === 'listening') return signal.inputVolume ?? 0
  if (state === 'speaking') return signal.outputVolume ?? 0
  return 0
}

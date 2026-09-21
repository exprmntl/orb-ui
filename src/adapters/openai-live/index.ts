import type { OrbAdapter, OrbSignal, OrbSignalListener, OrbState } from '../types'
import {
  createMediaStreamTrackVolumeMeter,
  createVolumeNormalizer,
  type MediaStreamTrackVolumeMeter,
} from '../audio-level'
import type { OpenAIRealtimeAdapterConfig } from '../openai-realtime'
import { PROVIDER_VOLUME_CALIBRATIONS } from '../volume-presets'

/** JSON events are deliberately open-ended so apps can handle new Live events. */
export interface OpenAILiveEvent {
  type: string
  [key: string]: unknown
}

export interface OpenAILiveSessionResponse {
  session: { id: string }
  transport: { type: 'webrtc'; sdp: string }
}

export interface OpenAILiveAdapterConfig extends Pick<
  OpenAIRealtimeAdapterConfig,
  | 'mediaStreamConstraints'
  | 'getUserMedia'
  | 'createPeerConnection'
  | 'createAudioElement'
  | 'createAudioContext'
  | 'inputVolumeCalibration'
  | 'outputVolumeCalibration'
  | 'onInputVolumeSample'
  | 'onOutputVolumeSample'
> {
  /** Exchange the SDP offer on your server using POST /v1/live/sessions. */
  createSession(sdp: string, signal: AbortSignal): Promise<OpenAILiveSessionResponse>
  /** Receives captions, delegation, usage, errors, and final session events unchanged. */
  onEvent?: (event: OpenAILiveEvent) => void
  /** Startup deadline, including microphone permission and session.started. Default: 30 seconds. */
  startTimeoutMs?: number
  /** How long stop waits for session.closed. Default: 15 seconds. */
  closeTimeoutMs?: number
}

export interface OpenAILiveOrbAdapter extends OrbAdapter {
  /** Resolves after SDP negotiation and session.started. */
  start(): Promise<void>
  /** Finalizes the session; rejects if finalization cannot be confirmed. */
  stop(): Promise<void>
  /** Send application commands after startup, subject to server-configured client permissions. */
  send(event: OpenAILiveEvent): void
}

interface Session {
  abort: AbortController
  pc?: RTCPeerConnection
  channel?: RTCDataChannel
  stream?: MediaStream
  audio?: HTMLAudioElement
  inputMeter?: MediaStreamTrackVolumeMeter
  outputMeter?: MediaStreamTrackVolumeMeter
  ready: boolean
  closing: boolean
  disposed: boolean
  closed: boolean
  silenceTicks: number
  started?: () => void
  finalized?: (error?: Error) => void
}

const failure = (message: string) => new Error(`[orb-ui/openai-live] ${message}`)

/** Managed GPT-Live WebRTC. Project keys and model/delegation configuration stay on your server. */
export function createOpenAILiveAdapter(config: OpenAILiveAdapterConfig): OpenAILiveOrbAdapter {
  const listeners = new Set<OrbSignalListener>()
  let signal: OrbSignal = { state: 'idle', inputVolume: 0, outputVolume: 0 }
  let active: Session | undefined
  let starting: Promise<void> | undefined
  let stopping: Promise<void> | undefined
  // Shared WebRTC RMS baseline; applications can calibrate Live voices independently.
  const input = createVolumeNormalizer(
    PROVIDER_VOLUME_CALIBRATIONS.openai.input,
    config.inputVolumeCalibration,
  )
  const output = createVolumeNormalizer(
    PROVIDER_VOLUME_CALIBRATIONS.openai.output,
    config.outputVolumeCalibration,
  )

  function emit(next: OrbSignal) {
    signal = next
    listeners.forEach((listener) => listener(next))
  }

  function state(next: OrbState, error?: unknown) {
    if (next === signal.state && error === undefined) return
    const reset = next === 'idle' || next === 'connecting' || next === 'error'
    if (reset) {
      input.reset()
      output.reset()
    }
    emit({
      state: next,
      inputVolume: reset ? 0 : signal.inputVolume,
      outputVolume: reset ? 0 : signal.outputVolume,
      ...(error === undefined ? {} : { error }),
    })
  }

  async function cleanup(session: Session) {
    if (session.disposed) return
    session.disposed = true
    session.abort.abort()
    if (active === session) active = undefined
    if (session.channel) {
      session.channel.onmessage = null
      session.channel.onclose = null
      session.channel.onerror = null
      session.channel.close()
    }
    if (session.pc) {
      session.pc.ontrack = null
      session.pc.onconnectionstatechange = null
      session.pc.close()
    }
    session.stream?.getTracks().forEach((track) => track.stop())
    if (session.audio) {
      session.audio.pause()
      session.audio.srcObject = null
      session.audio.remove()
    }
    await Promise.allSettled([session.inputMeter?.stop(), session.outputMeter?.stop()])
  }

  function check(session: Session) {
    if (session.disposed) throw new DOMException('Session start cancelled.', 'AbortError')
  }

  function disconnect(session: Session) {
    if (session.disposed || session.closed) return
    const error = failure('Connection lost before session.closed; final usage is unconfirmed.')
    session.finalized?.(error)
    state('error', error)
    void cleanup(session)
  }

  function handleEvent(session: Session, event: OpenAILiveEvent) {
    if (session.disposed) return
    if (event.type === 'session.started' && !session.ready) {
      session.ready = true
      state('listening')
      session.started?.()
    } else if (event.type === 'session.closed') {
      session.closed = true
      session.finalized?.()
      state('idle')
      void cleanup(session)
    } else if (event.type === 'error') {
      state('error', event.error ?? event)
    }
    // Captions and delegated Responses events are not voice playback boundaries.
    config.onEvent?.(event)
  }

  async function connect(session: Session) {
    const getUserMedia =
      config.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints))
    const stream = await getUserMedia(config.mediaStreamConstraints ?? { audio: true })
    if (session.disposed) {
      stream.getTracks().forEach((track) => track.stop())
      check(session)
    }
    session.stream = stream
    const pc = (config.createPeerConnection ?? (() => new RTCPeerConnection()))()
    session.pc = pc
    const audio = (config.createAudioElement ?? (() => new Audio()))()
    session.audio = audio
    audio.autoplay = true
    const createContext = config.createAudioContext ?? (() => new AudioContext())
    const meter = (track: MediaStreamTrack, direction: 'input' | 'output') =>
      createMediaStreamTrackVolumeMeter(track, createContext, (raw) => {
        if (session.disposed || !session.ready || signal.state === 'error') return
        const sample = (direction === 'input' ? input : output).sample(raw)
        if (direction === 'input') config.onInputVolumeSample?.(sample)
        else {
          config.onOutputVolumeSample?.(sample)
          // Use activity before envelope decay, so a visual tail cannot prolong speech.
          // Full duplex: microphone activity never suppresses the assistant's playback.
          if (!audio.paused && !audio.muted && audio.volume > 0 && sample.mapped > 0.015) {
            session.silenceTicks = 0
            state('speaking')
          } else if (++session.silenceTicks >= 8) state('listening')
        }
        emit({
          ...signal,
          [direction === 'input' ? 'inputVolume' : 'outputVolume']: sample.normalized,
        })
      })
    const tracks = stream.getAudioTracks()
    tracks.forEach((track) => pc.addTrack(track, stream))
    if (tracks[0]) session.inputMeter = meter(tracks[0], 'input')
    pc.ontrack = (event) => {
      if (session.disposed || event.track.kind !== 'audio') return
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
      void audio.play().catch((error: unknown) => {
        if (!session.disposed) state('error', error)
      })
      void session.outputMeter?.stop()
      session.outputMeter = meter(event.track, 'output')
    }
    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.connectionState === 'disconnected'
      )
        disconnect(session)
    }
    const channel = pc.createDataChannel('oai-events')
    session.channel = channel
    channel.onmessage = ({ data }) => {
      let event: unknown
      try {
        event = JSON.parse(String(data))
      } catch {
        return
      }
      if (
        !event ||
        typeof event !== 'object' ||
        !('type' in event) ||
        typeof event.type !== 'string'
      )
        return
      handleEvent(session, event as OpenAILiveEvent)
    }
    channel.onclose = () => disconnect(session)
    channel.onerror = () => disconnect(session)
    const offer = await pc.createOffer()
    check(session)
    await pc.setLocalDescription(offer)
    check(session)
    if (pc.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          pc.removeEventListener('icegatheringstatechange', changed)
          session.abort.signal.removeEventListener('abort', cancelled)
        }
        const changed = () => {
          if (pc.iceGatheringState === 'complete') {
            done()
            resolve()
          }
        }
        const cancelled = () => {
          done()
          reject(new DOMException('Session start cancelled.', 'AbortError'))
        }
        pc.addEventListener('icegatheringstatechange', changed)
        session.abort.signal.addEventListener('abort', cancelled, { once: true })
        changed()
      })
    }
    check(session)
    const sdp = pc.localDescription?.sdp
    if (!sdp) throw failure('Missing local SDP offer.')
    const result = await config.createSession(sdp, session.abort.signal)
    check(session)
    if (!result?.session?.id || result.transport?.type !== 'webrtc' || !result.transport.sdp) {
      throw failure('createSession must return a session ID and WebRTC SDP answer.')
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp })
    check(session)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      listener(signal)
      return () => listeners.delete(listener)
    },
    start() {
      if (stopping) return Promise.reject(failure('Wait for stop() before restarting.'))
      if (starting) return starting
      if (active) return Promise.resolve()
      const session: Session = {
        abort: new AbortController(),
        ready: false,
        closing: false,
        disposed: false,
        closed: false,
        silenceTicks: 0,
      }
      active = session
      state('connecting')
      starting = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const ready = new Promise<void>((resolve) => {
          session.started = resolve
        })
        const cancelled = new Promise<never>((_, reject) => {
          session.abort.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Session start cancelled.', 'AbortError')),
            { once: true },
          )
          timer = setTimeout(
            () => reject(failure('Timed out waiting for session.started.')),
            config.startTimeoutMs ?? 30_000,
          )
        })
        try {
          await Promise.race([Promise.all([connect(session), ready]), cancelled])
        } catch (error) {
          const wasActive = active === session
          await cleanup(session)
          if (wasActive) state('error', error)
          throw error
        } finally {
          clearTimeout(timer)
          starting = undefined
        }
      })()
      return starting
    },
    stop() {
      if (stopping) return stopping
      const session = active
      if (!session) {
        state('idle')
        return Promise.resolve()
      }
      session.closing = true
      stopping = (async () => {
        try {
          if (session.ready && session.channel?.readyState !== 'open') {
            throw failure('Event channel is unavailable; final usage is unconfirmed.')
          }
          if (session.ready && session.channel?.readyState === 'open') {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  reject(
                    failure('Timed out waiting for session.closed; final usage is unconfirmed.'),
                  ),
                config.closeTimeoutMs ?? 15_000,
              )
              session.finalized = (error) => {
                clearTimeout(timer)
                if (error) reject(error)
                else resolve()
              }
              try {
                session.channel!.send(JSON.stringify({ type: 'session.close' }))
              } catch (error) {
                clearTimeout(timer)
                reject(error)
              }
            })
          }
          await cleanup(session)
          state('idle')
        } catch (error) {
          await cleanup(session)
          state('error', error)
          throw error
        } finally {
          stopping = undefined
        }
      })()
      return stopping
    },
    send(event) {
      if (!active?.ready || active.closing || active.channel?.readyState !== 'open')
        throw failure('Session is not ready for commands.')
      if (event.type === 'session.start' || event.type === 'session.close')
        throw failure('Use start() and stop() to manage the session.')
      active.channel.send(JSON.stringify(event))
    },
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAILiveAdapter, type OpenAILiveAdapterConfig } from './index'
import type { OrbSignal } from '../types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(overrides: Partial<OpenAILiveAdapterConfig> = {}) {
  const microphone = { kind: 'audio', stop: vi.fn() }
  const speaker = { kind: 'audio', stop: vi.fn() }
  const levels = new Map([
    [microphone, 0.1],
    [speaker, 0],
  ])
  class Stream {
    constructor(public tracks: unknown[]) {}
    getTracks() {
      return this.tracks
    }
    getAudioTracks() {
      return this.tracks
    }
  }
  vi.stubGlobal('MediaStream', Stream)
  const stream = new Stream([microphone]) as unknown as MediaStream
  const channel = {
    readyState: 'open',
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onclose: null as (() => void) | null,
  }
  const peer = Object.assign(new EventTarget(), {
    iceGatheringState: 'complete',
    connectionState: 'connected',
    localDescription: { sdp: 'gathered-offer' },
    ontrack: null as ((event: RTCTrackEvent) => void) | null,
    onconnectionstatechange: null as (() => void) | null,
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'initial-offer' })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    close: vi.fn(),
  })
  const audio = {
    autoplay: false,
    paused: false,
    muted: false,
    volume: 1,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    remove: vi.fn(),
    srcObject: null,
  }
  const contexts: Array<{ close: ReturnType<typeof vi.fn> }> = []
  const createSession = vi.fn(async () => ({
    session: { id: 'live_test' },
    transport: { type: 'webrtc' as const, sdp: 'answer' },
  }))
  const onEvent = vi.fn()
  const adapter = createOpenAILiveAdapter({
    createSession,
    onEvent,
    getUserMedia: async () => stream,
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
    createAudioElement: () => audio as unknown as HTMLAudioElement,
    createAudioContext: () => {
      let track = microphone
      const context = {
        state: 'running',
        close: vi.fn(async () => undefined),
        createMediaStreamSource: (source: Stream) => {
          track = source.tracks[0] as typeof microphone
          return { connect: vi.fn(), disconnect: vi.fn() }
        },
        createAnalyser: () => ({
          fftSize: 512,
          smoothingTimeConstant: 0,
          getFloatTimeDomainData: (samples: Float32Array) => samples.fill(levels.get(track) ?? 0),
          disconnect: vi.fn(),
        }),
      }
      contexts.push(context)
      return context as unknown as AudioContext
    },
    ...overrides,
  })
  const signals: OrbSignal[] = []
  adapter.subscribe((signal) => signals.push(signal))
  const event = (type: string, extra = {}) =>
    channel.onmessage?.({ data: JSON.stringify({ type, ...extra }) } as MessageEvent)
  const start = async () => {
    const pending = adapter.start()
    await vi.waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    event('session.started', { session: { id: 'live_test' } })
    await pending
    peer.ontrack?.({ streams: [new Stream([speaker])], track: speaker } as unknown as RTCTrackEvent)
  }
  const stop = async () => {
    const pending = adapter.stop()
    event('session.closed', { usage: { seconds: 12 } })
    await pending
  }
  return {
    adapter,
    peer,
    channel,
    audio,
    contexts,
    microphone,
    speaker,
    levels,
    createSession,
    onEvent,
    signals,
    event,
    start,
    stop,
  }
}

describe('GPT-Live WebRTC adapter', () => {
  it('waits for gathered SDP and session.started, forwards events and commands, and finalizes before cleanup', async () => {
    const s = setup()
    s.peer.iceGatheringState = 'gathering'
    const first = s.adapter.start()
    expect(s.adapter.start()).toBe(first)
    await vi.waitFor(() => expect(s.peer.setLocalDescription).toHaveBeenCalled())
    expect(s.createSession).not.toHaveBeenCalled()
    s.peer.iceGatheringState = 'complete'
    s.peer.dispatchEvent(new Event('icegatheringstatechange'))
    await vi.waitFor(() =>
      expect(s.peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer' }),
    )
    expect(s.createSession).toHaveBeenCalledWith('gathered-offer', expect.any(AbortSignal))
    expect(s.signals.at(-1)?.state).toBe('connecting')
    expect(() => s.adapter.send({ type: 'session.update' })).toThrow('not ready')
    s.event('session.started')
    await first
    expect(s.signals.at(-1)?.state).toBe('listening')
    expect(s.channel.send).not.toHaveBeenCalled()
    const caption = {
      type: 'session.output_transcript.delta',
      delta: 'Hello',
      start_ms: 10,
      end_ms: 30,
    }
    s.event(caption.type, caption)
    expect(s.onEvent).toHaveBeenCalledWith(caption)
    const command = { type: 'session.commentary.append', delegation_id: null, content: 'Done' }
    s.adapter.send(command)
    expect(s.channel.send).toHaveBeenCalledWith(JSON.stringify(command))
    expect(() => s.adapter.send({ type: 'session.start' })).toThrow('Use start()')
    const stopping = s.adapter.stop()
    expect(s.adapter.stop()).toBe(stopping)
    expect(s.channel.send).toHaveBeenLastCalledWith('{"type":"session.close"}')
    expect(s.microphone.stop).not.toHaveBeenCalled()
    await expect(s.adapter.start()).rejects.toThrow('Wait for stop')
    s.event('session.closed', { usage: { seconds: 12 }, reason: 'close_requested' })
    await stopping
    expect(s.onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ usage: { seconds: 12 } }))
    expect(s.microphone.stop).toHaveBeenCalledOnce()
    expect(s.peer.close).toHaveBeenCalledOnce()
    expect(s.signals.at(-1)).toEqual({ state: 'idle', inputVolume: 0, outputVolume: 0 })
  })

  it('meters simultaneous speech; transcripts and backend completion never end playback', async () => {
    vi.useFakeTimers()
    const s = setup()
    await s.start()
    s.levels.set(s.speaker, 0.1)
    await vi.advanceTimersByTimeAsync(330)
    expect(s.signals.at(-1)).toMatchObject({ state: 'speaking' })
    expect(s.signals.at(-1)!.inputVolume).toBeGreaterThan(0)
    expect(s.signals.at(-1)!.outputVolume).toBeGreaterThan(0)
    s.event('session.input_transcript.delta', { delta: 'interrupt' })
    s.event('response.event', { event: { type: 'response.completed' } })
    s.event('response.done')
    expect(s.signals.at(-1)?.state).toBe('speaking')
    s.levels.set(s.speaker, 0)
    await vi.advanceTimersByTimeAsync(300)
    expect(s.signals.at(-1)?.state).toBe('listening')
    s.levels.set(s.speaker, 0.1)
    s.audio.muted = true
    await vi.advanceTimersByTimeAsync(300)
    expect(s.signals.at(-1)?.state).toBe('listening')
    await s.stop()
    expect(s.contexts.every((context) => context.close.mock.calls.length === 1)).toBe(true)
    const count = s.signals.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.signals).toHaveLength(count)
    await s.start()
    expect(s.createSession).toHaveBeenCalledTimes(2)
    await s.stop()
  })

  it('reports negotiation failures and releases media', async () => {
    const s = setup({
      createSession: async () => {
        throw new Error('Access denied')
      },
    })
    await expect(s.adapter.start()).rejects.toThrow('Access denied')
    expect(s.microphone.stop).toHaveBeenCalledOnce()
    expect(s.peer.close).toHaveBeenCalledOnce()
    expect(s.signals.at(-1)?.state).toBe('error')
  })

  it('cancels pending microphone access and stops tracks when permission eventually resolves', async () => {
    let grant!: (stream: MediaStream) => void
    const s = setup({
      getUserMedia: () =>
        new Promise((resolve) => {
          grant = resolve
        }),
    })
    const pending = s.adapter.start()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await s.adapter.stop()
    grant({ getTracks: () => [s.microphone] } as unknown as MediaStream)
    await rejected
    expect(s.microphone.stop).toHaveBeenCalledOnce()
    expect(s.createSession).not.toHaveBeenCalled()
    expect(s.signals.at(-1)?.state).toBe('idle')
  })

  it('times out startup without session.started and cleans up', async () => {
    vi.useFakeTimers()
    const s = setup({ startTimeoutMs: 100 })
    const pending = expect(s.adapter.start()).rejects.toThrow(
      'Timed out waiting for session.started',
    )
    await vi.advanceTimersByTimeAsync(100)
    await pending
    expect(s.peer.close).toHaveBeenCalledOnce()
  })

  it('reports unconfirmed finalization on timeout and disconnect', async () => {
    vi.useFakeTimers()
    const s = setup({ closeTimeoutMs: 100 })
    await s.start()
    const pending = expect(s.adapter.stop()).rejects.toThrow('final usage is unconfirmed')
    await vi.advanceTimersByTimeAsync(100)
    await pending
    expect(s.microphone.stop).toHaveBeenCalledOnce()
    expect(s.signals.at(-1)?.state).toBe('error')
    const other = setup()
    await other.start()
    const disconnected = expect(other.adapter.stop()).rejects.toThrow('Connection lost')
    other.channel.onclose?.()
    await disconnected
    expect(other.peer.close).toHaveBeenCalledOnce()
  })

  it('surfaces autoplay errors and ignores malformed data', async () => {
    const s = setup()
    s.audio.play.mockRejectedValueOnce(new Error('Playback blocked'))
    await s.start()
    await Promise.resolve()
    expect(s.signals.at(-1)?.state).toBe('error')
    for (const data of ['not json', 'null', '{}']) s.channel.onmessage?.({ data } as MessageEvent)
    await s.stop()
  })

  it('does not report a successful stop when the event channel is already closing', async () => {
    const s = setup()
    await s.start()
    s.channel.readyState = 'closing'
    await expect(s.adapter.stop()).rejects.toThrow('final usage is unconfirmed')
    expect(s.microphone.stop).toHaveBeenCalledOnce()
    expect(s.signals.at(-1)?.state).toBe('error')
  })
})

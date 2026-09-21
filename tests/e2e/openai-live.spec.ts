import { expect, test } from '@playwright/test'

test('GPT-Live adapter negotiates browser WebRTC, meters audio, and finalizes', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createOpenAILiveAdapter } = window as unknown as {
      createOpenAILiveAdapter: typeof import('orb-ui/adapters').createOpenAILiveAdapter
    }
    const context = new AudioContext()
    await context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    gain.gain.value = 0.1
    oscillator.connect(gain)
    const media = context.createMediaStreamDestination()
    gain.connect(media)
    oscillator.start()
    const remote = new RTCPeerConnection()
    let channel: RTCDataChannel | undefined
    const signals: Array<{ state: string; inputVolume?: number; outputVolume?: number }> = []
    const events: string[] = []
    const commands: string[] = []
    const adapter = createOpenAILiveAdapter({
      getUserMedia: async () => media.stream,
      createSession: async (sdp) => {
        remote.ondatachannel = ({ channel: opened }) => {
          channel = opened
          opened.onopen = () =>
            opened.send(JSON.stringify({ type: 'session.started', session: { id: 'live_local' } }))
          opened.onmessage = ({ data }) => {
            const event = JSON.parse(data)
            commands.push(event.type)
            if (event.type === 'session.close') {
              opened.send(JSON.stringify({ type: 'session.closed', usage: { seconds: 1 } }))
            }
          }
        }
        remote.addTrack(media.stream.getAudioTracks()[0], media.stream)
        await remote.setRemoteDescription({ type: 'offer', sdp })
        await remote.setLocalDescription(await remote.createAnswer())
        if (remote.iceGatheringState !== 'complete') {
          await new Promise<void>((resolve) => {
            remote.onicegatheringstatechange = () => {
              if (remote.iceGatheringState === 'complete') resolve()
            }
          })
        }
        return {
          session: { id: 'live_local' },
          transport: { type: 'webrtc', sdp: remote.localDescription!.sdp },
        }
      },
      onEvent: (event) => events.push(event.type),
    })
    adapter.subscribe((signal) => signals.push(signal))
    const waitFor = async (predicate: () => boolean) => {
      const deadline = performance.now() + 5000
      while (!predicate()) {
        if (performance.now() > deadline)
          throw new Error('Timed out waiting for browser audio signal')
        await new Promise((resolve) => setTimeout(resolve, 33))
      }
    }
    try {
      await adapter.start()
      await waitFor(() =>
        signals.some(
          (signal) =>
            signal.state === 'speaking' &&
            (signal.inputVolume ?? 0) > 0 &&
            (signal.outputVolume ?? 0) > 0,
        ),
      )
      channel!.send(
        JSON.stringify({ type: 'response.event', event: { type: 'response.completed' } }),
      )
      await waitFor(() => events.includes('response.event'))
      const duringBackendCompletion = signals[signals.length - 1].state
      gain.gain.value = 0
      await waitFor(() => signals[signals.length - 1].state === 'listening')
      await adapter.stop()
      return {
        duringBackendCompletion,
        lastState: signals[signals.length - 1].state,
        trackState: media.stream.getAudioTracks()[0].readyState,
        events,
        commands,
      }
    } finally {
      await adapter.stop().catch(() => undefined)
      remote.close()
      oscillator.stop()
      await context.close()
    }
  })
  expect(result.duringBackendCompletion).toBe('speaking')
  expect(result.lastState).toBe('idle')
  expect(result.trackState).toBe('ended')
  expect(result.events).toContain('session.closed')
  expect(result.commands).toEqual(['session.close'])
})

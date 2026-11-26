import { AgentMicrophone, AgentPlayer, AgentSession } from '@deepgram/agents'
import { createCartesiaAdapter, createDeepgramAdapter } from 'orb-ui/adapters'

async function getToken() {
  const response = await fetch('/qa-token', { method: 'POST', cache: 'no-store' })
  if (!response.ok) throw new Error('Token exchange failed: ' + response.status)
  const { token } = await response.json()
  return token as string
}

const params = new URLSearchParams(location.search)
const adapter =
  params.get('provider') === 'cartesia'
    ? createCartesiaAdapter({ agentId: params.get('agent')!, getAccessToken: getToken })
    : createDeepgramAdapter({
        createResources() {
          const session = new AgentSession({
            auth: { tokenFactory: getToken },
            agent: {
              listen: { provider: { type: 'deepgram', version: 'v1', model: 'nova-3' } },
              think: {
                provider: { type: 'open_ai', model: 'gpt-4o-mini' },
                prompt: 'Give a short answer in English.',
              },
              speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } },
            },
            audio: {
              input: { encoding: 'linear16', sampleRate: 16_000 },
              output: { encoding: 'linear16', sampleRate: 24_000 },
            },
            reconnect: { enabled: false },
          })
          return {
            session,
            microphone: new AgentMicrophone((chunk) => session.sendAudio(chunk), {
              sampleRate: 16_000,
            }),
            player: new AgentPlayer({ sampleRate: 24_000 }),
          }
        },
      })

const state = document.querySelector<HTMLOutputElement>('[data-testid="qa-state"]')!
const input = document.querySelector<HTMLOutputElement>('[data-testid="qa-input-volume"]')!
const output = document.querySelector<HTMLOutputElement>('[data-testid="qa-output-volume"]')!
adapter.subscribe((signal) => {
  state.value = signal.state
  input.value = (signal.inputVolume ?? 0).toFixed(2)
  output.value = (signal.outputVolume ?? 0).toFixed(2)
})
document.querySelector('button')!.onclick = async () => {
  if (state.value === 'idle') await adapter.start()
  else await adapter.stop()
}

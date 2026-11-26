import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { env, platform } from 'node:process'
import { expect, test, type Page } from '@playwright/test'

// Read only explicitly named Orb UI test credentials. Print field names on failure.
function setting(name: string) {
  if (env[name]) return env[name]
  if (platform === 'darwin') {
    try {
      return execFileSync(
        '/usr/bin/security',
        ['find-generic-password', '-s', 'orb-ui-qa', '-a', name, '-w'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim()
    } catch {
      /* The credential is missing or the Keychain is locked. */
    }
  }
  throw new Error('Missing QA setting: ' + name)
}

const question = readFileSync(new URL('./question.wav', import.meta.url)).toString('base64')

// Each SDK receives a disposable microphone track carrying the same synthesized question.
async function installTestMicrophone(page: Page) {
  await page.addInitScript((encoded: string) => {
    let context: AudioContext | undefined
    let destination: MediaStreamAudioDestinationNode | undefined
    navigator.mediaDevices.getUserMedia = async () => {
      context ??= new AudioContext()
      destination ??= context.createMediaStreamDestination()
      await context.resume()
      return destination.stream.clone()
    }
    window.addEventListener('orb-qa-speak', async () => {
      if (!context || !destination) return
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
      const source = context.createBufferSource()
      source.buffer = await context.decodeAudioData(bytes.buffer)
      source.connect(destination)
      source.onended = () => {
        document.documentElement.dataset.orbQaSpoken = 'true'
      }
      source.start()
    })
  }, question)
}

type Call = {
  name: string
  button: string
  fields?: Record<string, string>
  exchange?: [endpoint: string, field: string, key: string]
  model?: string
}

const calls: Call[] = [
  {
    name: 'vapi',
    button: 'Vapi',
    fields: {
      'config-vapi-public-key': 'VAPI_PUBLIC_KEY',
      'config-vapi-assistant-id': 'VAPI_ASSISTANT_ID',
    },
  },
  {
    name: 'elevenlabs',
    button: 'ElevenLabs',
    fields: { 'config-elevenlabs-agent-id': 'ELEVENLABS_AGENT_ID' },
  },
  {
    name: 'livekit',
    button: 'LiveKit',
    fields: {
      'config-livekit-sandbox-id': 'LIVEKIT_SANDBOX_ID',
      'config-livekit-agent-name': 'LIVEKIT_AGENT_NAME',
    },
  },
  {
    name: 'pipecat',
    button: 'Pipecat',
    fields: { 'config-pipecat-agent-name': 'PIPECAT_AGENT_NAME' },
    exchange: ['pipecat-start', 'config-pipecat-api-key', 'PIPECAT_PUBLIC_KEY'],
  },
  {
    name: 'openai-realtime',
    button: 'OpenAI Realtime',
    exchange: ['openai-realtime-token', 'config-openai-api-key', 'OPENAI_API_KEY'],
  },
  {
    name: 'openai-live',
    button: 'OpenAI GPT-Live',
    exchange: ['openai-live-session', 'config-openai-live-api-key', 'OPENAI_API_KEY'],
  },
  ...['gemini-3.8-live', 'gemini-3.8-live-extended-thinking'].map(
    (model): Call => ({
      name: model,
      model,
      button: 'Gemini Live',
      exchange: ['gemini-live-token', 'config-gemini-api-key', 'GEMINI_API_KEY'],
    }),
  ),
]

for (const call of calls) {
  test(call.name, async ({ page, baseURL }) => {
    const fields = Object.entries(call.fields ?? {}).map(([id, key]) => [id, setting(key)])
    const key = call.exchange && setting(call.exchange[2])
    await page.context().grantPermissions(['microphone'], { origin: baseURL })
    await installTestMicrophone(page)
    await page.goto('/playground/')
    await page.getByRole('button', { name: call.button, exact: true }).click()
    for (const [id, value] of fields) await page.locator('#' + id).fill(value)
    if (call.model) await page.locator('#config-gemini-model').fill(call.model)
    if (call.exchange) {
      const [endpoint, field] = call.exchange
      const url = new URL('/api/' + endpoint, baseURL).href
      await page.route(url, async (route) => {
        const request = route.request()
        await route.continue({
          postData: JSON.stringify({ ...request.postDataJSON(), apiKey: key }),
        })
      })
      // GPT-Live also accepts a server-side OPENAI_API_KEY.
      if (await page.locator('#' + field).isVisible())
        await page.locator('#' + field).fill('provided-by-local-test')
    }

    const state = page.getByTestId('qa-state')
    const orb = page.getByTestId('provider-playground-orb')
    const positiveLevel = /^(?:0\.(?!00)\d{2}|1\.00)$/
    await orb.click()
    try {
      await expect(state).toHaveText('listening', { timeout: 25_000 })
      for (const frame of page.frames())
        await frame.evaluate(() => window.dispatchEvent(new Event('orb-qa-speak')))
      await expect(page.getByTestId('qa-input-volume')).toHaveText(positiveLevel, {
        timeout: 8_000,
      })
      await expect
        .poll(async () => {
          const completed = await Promise.all(
            page
              .frames()
              .map((frame) =>
                frame.evaluate(() => document.documentElement.dataset.orbQaSpoken === 'true'),
              ),
          )
          return completed.some(Boolean)
        })
        .toBe(true)
      await expect(state).toHaveText('speaking', { timeout: 25_000 })
      await expect(page.getByTestId('qa-output-volume')).toHaveText(positiveLevel)
    } finally {
      const current = await state.innerText()
      if (current !== 'idle' && current !== 'error') await orb.click()
    }
    await expect(state).toHaveText('idle')
  })
}

import { expect, test } from '@playwright/test'

test('playground removes legacy credentials and retains public settings on reload', async ({
  page,
}) => {
  const storage = 'orb-ui:provider-playground-config'
  await page.goto('/')
  await page.evaluate((name) => {
    localStorage.setItem(
      name,
      JSON.stringify({
        provider: 'gemini',
        geminiModel: 'example-model',
        geminiApiKey: 'fixture-key',
        openAIApiKey: 'fixture-key',
        openAILiveApiKey: 'fixture-key',
        pipecatApiKey: 'fixture-key',
        liveKitToken: 'fixture-key',
        liveKitParticipantToken: 'fixture-key',
      }),
    )
  }, storage)
  await page.goto('/playground/')
  await expect(page.locator('#config-gemini-model')).toHaveValue('example-model')
  await page.locator('#config-gemini-api-key').fill('fresh-fixture-key')
  await expect
    .poll(() => page.evaluate((name) => localStorage.getItem(name), storage))
    .not.toContain('fixture-key')
  await page.reload()
  await expect(page.locator('#config-gemini-api-key')).toHaveValue('')
  await expect(page.locator('#config-gemini-model')).toHaveValue('example-model')
})

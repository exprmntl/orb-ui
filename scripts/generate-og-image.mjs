import { copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Publish the approved artwork unchanged so the website and README stay in sync
// with the Experimental Software gallery. Editable sources live beside the PNG.
await copyFile(
  resolve(root, 'assets/social/homepage-social.png'),
  resolve(root, 'demo/public/og-image-v3.png'),
)

import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Orb } from 'orb-ui'
import type { OrbSignal, OrbState, OrbThemeName, OrbThemePreset } from 'orb-ui'
import './voice-orb-preview.css'

const themes: OrbThemeName[] = ['circle', 'cloud', 'radial', 'bars']
const presets: OrbThemePreset[] = ['balanced', 'calm', 'expressive']
const states: OrbState[] = ['idle', 'connecting', 'listening', 'thinking', 'speaking', 'error']
const descriptions: Record<OrbState, string> = {
  idle: 'Ready to start',
  connecting: 'Connecting to the agent',
  listening: 'Listening to you · input level drives the motion',
  thinking: 'Preparing a response',
  speaking: 'Agent speaking · output level drives the motion',
  error: 'Connection failed',
}

function VoiceOrbPreview() {
  const [theme, setTheme] = useState<OrbThemeName>('circle')
  const [preset, setPreset] = useState<OrbThemePreset>('balanced')
  const [state, setState] = useState<OrbState>('listening')
  const [inputVolume, setInputVolume] = useState(0.45)
  const [outputVolume, setOutputVolume] = useState(0.7)
  const signal: OrbSignal = { state, inputVolume, outputVolume }
  const code = `<Orb
  theme={{ name: '${theme}', preset: '${preset}' }}
  signal={{ state: '${state}', inputVolume: ${inputVolume}, outputVolume: ${outputVolume} }}
  interactive={false}
/>`

  return (
    <main className="orb-preview">
      <header>
        <h1>Make the voice orb your own.</h1>
        <p>Preview only. No microphone or live call.</p>
      </header>
      <div className="orb-preview__surface" aria-label="Voice orb preview">
        <Orb
          theme={{ name: theme, preset }}
          signal={signal}
          interactive={false}
          size={200}
          style={{ '--orb-ui-radial-control-surround': '#10131b' }}
        />
        <p role="status">{descriptions[state]}</p>
      </div>
      <div className="orb-preview__choices">
        <label>
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value as OrbThemeName)}>
            {themes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Motion preset
          <select
            value={preset}
            onChange={(event) => setPreset(event.target.value as OrbThemePreset)}
          >
            {presets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Voice state</legend>
        <div className="orb-preview__states">
          {states.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={state === name}
              onClick={() => setState(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="orb-preview__levels">
        <label>
          Input level <span>{inputVolume.toFixed(2)}</span>
          <input
            aria-label="Input level"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={inputVolume}
            onChange={(event) => setInputVolume(Number(event.target.value))}
          />
        </label>
        <label>
          Output level <span>{outputVolume.toFixed(2)}</span>
          <input
            aria-label="Output level"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={outputVolume}
            onChange={(event) => setOutputVolume(Number(event.target.value))}
          />
        </label>
      </div>
      <details>
        <summary>React code for this preview</summary>
        <pre>
          <code>{code}</code>
        </pre>
      </details>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VoiceOrbPreview />
  </StrictMode>,
)

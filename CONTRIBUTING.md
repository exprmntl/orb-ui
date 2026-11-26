# Contributing to orb-ui

## This codebase is AI-native.

Most open source projects treat AI-generated code as a second-class citizen — something to be flagged, scrutinized, and deprioritized in favor of "real" human contributions.

We think that's backwards.

`orb-ui` is built by AI agents, reviewed by AI agents, and maintained by AI agents. That is the intended workflow. Human involvement is welcome, but it is the exception — not the default.

---

## Contribution Tiers

### Tier 1 — AI-authored (preferred)

Pull requests written by an AI agent (Claude, Codex, Cursor, etc.) are the primary contribution path. These will be reviewed first and merged fastest.

If you're opening a significant PR, it should be AI-generated. Document which model you used and what prompt or task you gave it. That context is useful.

### Tier 2 — Human-authored (minor changes only)

Humans are welcome to contribute:

- Typo and documentation fixes
- Small bug fixes (< ~20 lines)
- Opening issues, providing reproduction cases
- Writing prompts or task specs for agents to execute

If your PR is a large, human-written feature or refactor, expect it to sit in the queue longer. Nothing personal — it's just not the workflow this project is optimized for.

---

## Why?

Because we think the most interesting question in open source right now isn't _"how do we keep AI out?"_ — it's _"what does a project look like when AI is the primary contributor?"_

This is that experiment.

---

## How to contribute via agent

1. Clone the repo and give your agent the codebase as context
2. Have it implement a feature, fix, or new theme/adapter
3. Open a PR with a note on what model/tool you used

That's it.

---

## Getting Started

```bash
git clone https://github.com/exprmntl/orb-ui.git
cd orb-ui
pnpm install

# Build the library
pnpm build

# Run demo locally
pnpm dev:demo
```

### Provider QA playground

For real adapter testing before merge or release:

```bash
pnpm build
pnpm dev:demo
```

Then open `http://localhost:5173/playground`. The live harness is available only in local development.
Preview deployments and the production site link to local simulated demos instead. Paste your own
provider test config into the local Provider Config panel: a
Vapi public key plus assistant ID, an ElevenLabs agent ID, or LiveKit sandbox token server ID plus
agent name.

Pipecat Cloud, OpenAI Realtime, and Gemini Live testing uses loopback-only Vite development handlers.
Hosted `demo/api` provider proxy routes reject requests without contacting a provider. Standard API keys are
held in page memory only and exchanged for provider session credentials; they are not saved in
local storage or accepted through `VITE_*` variables. Self-hosted Pipecat SmallWebRTC only needs a
public `/api/offer` URL.

GPT-Live is also available in the playground. `pnpm dev:demo` serves its session endpoint locally.
Provide `OPENAI_API_KEY` to the dev server process to use a saved server-side credential, or paste
a test key in the GPT-Live panel for the current page session. Never use a `VITE_*` variable for
the key. Server credentials are accepted only on same-origin loopback requests. The deployed
endpoint is disabled. Select **OpenAI GPT-Live** locally, then click the orb to start
and click it again to end the billed session. Model settings persist; pasted Live keys do not.

Non-secret playground values are saved in browser local storage for that origin, and the Clear
button removes the selected provider's values. To prefill the fields during local development,
copy `demo/.env.example` to `demo/.env.local`, fill in non-secret `VITE_*` defaults, and restart the
demo server. Use development agents and never commit `.env.local`.

### Repeat a live voice check

Build the checkout with `pnpm build`. Run `pnpm qa:live --list` to see the available calls,
then select a provider, for example `pnpm qa:live -g gemini`. Each selected case opens a
billed session in the local playground, speaks a short synthetic question, checks Orb's
input and reply audio levels, and ends the session. The Gemini selection calls both 3.8
Live variants. Each run uses a fresh Chrome profile with no microphone hardware, recordings,
or saved browser credentials. The live suite runs separately from `pnpm check`.

Supply settings through the test process environment or macOS Keychain. On a Mac, save each
value once under service `orb-ui-qa`, with its setting name as the account. For example,
`security add-generic-password -U -s orb-ui-qa -a GEMINI_API_KEY -w` prompts for the value.
The test reads it on later runs. Keep private keys out of chat, shell arguments and `VITE_*`.

| Live playground test         | Test account settings                                           |
| ---------------------------- | --------------------------------------------------------------- |
| Gemini Live, both variants   | `GEMINI_API_KEY`                                                |
| OpenAI Realtime and GPT-Live | `OPENAI_API_KEY` with access to the selected models             |
| Vapi                         | `VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID`                          |
| ElevenLabs                   | `ELEVENLABS_AGENT_ID` for a public test agent                   |
| LiveKit                      | `LIVEKIT_SANDBOX_ID`, `LIVEKIT_AGENT_NAME` for a running worker |
| Pipecat Cloud                | `PIPECAT_PUBLIC_KEY`, `PIPECAT_AGENT_NAME` for a deployed bot   |

The remaining integrations have their own credential and backend setup. Use their live
examples for QA. The embedded previews on the guide pages simulate calls.

| Live example                                           | What to provision                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [Retell](docs/adapters/retell.mdx)                     | Test agent ID and a server API key for creating and stopping web calls                      |
| [Deepgram](docs/adapters/deepgram.mdx)                 | Voice Agent ID and a project key that can issue a short-lived grant                         |
| [Cartesia](docs/adapters/cartesia.mdx)                 | Deployed Line agent ID and a server key that can mint agent tokens                          |
| [Agora](docs/adapters/agora.mdx)                       | A test backend that creates voice-agent sessions, issues RTC/RTM tokens and stops the agent |
| [Azure Voice Live](docs/adapters/azure-voice-live.mdx) | Voice Live resource endpoint, model access and an authorized Microsoft Entra identity       |
| [Amazon Nova 2 Sonic](examples/nova-sonic/README.md)   | AWS development profile with streaming Bedrock model access in the selected region          |

### Verification

Before opening a PR, run:

```bash
pnpm check
```

The verification layers have separate jobs:

- `pnpm test` covers component, signal, and provider-adapter behavior with fast unit tests.
- Typechecks validate source examples, provider SDK compatibility, and the declarations emitted by
  the built package.
- The demo typecheck and build validate the deployed site and playground as a real consumer.
- `pnpm test:e2e` builds the published package entry points, loads them in Google Chrome, and
  exercises controlled signals plus adapter start/stop behavior.

Run the browser check by itself with:

```bash
pnpm test:e2e
```

If your change affects users, add a changeset:

```bash
pnpm changeset
```

---

## Ground rules (for everyone)

- Treat the public API (`Orb` props, `OrbAdapter` interface, `OrbState` union) carefully. Breaking changes are allowed only when they are intentional, documented, and released with a migration note.
- New themes go in `src/themes/`, new adapters in `src/adapters/`
- Run `pnpm check` before opening a PR
- Keep bundle size in mind — no heavy dependencies without discussion

## Adapter release and distribution checklist

- [ ] Update the provider adapter doc, adapter overview, homepage adapter link/copy, and README.
- [ ] Add or update working examples and release notes; include migration notes for breaking changes.
- [ ] After deployment, request indexing for the canonical provider doc and confirm sitemap discovery.
- [ ] Measure impressions/clicks in Google Search Console and adoption/navigation in PostHog.
- [ ] Seek relevant provider ecosystem directories, integration galleries, and community listings after
      release; follow each community's disclosure and self-promotion rules.

---

## PR titles and breaking changes

Use Conventional Commit-style PR titles so release notes stay clear after squash merges:

```text
feat: add a new theme
fix: normalize ElevenLabs output volume
docs: clarify custom adapter setup
refactor: simplify theme animation state
feat!: introduce signal-based adapter API
```

Use `!` only when the PR intentionally changes user-facing behavior or public API in a way that may require app code changes. For breaking changes:

- Put `!` in the PR title, for example `feat!: introduce signal-based adapter API`
- Add a changeset with the migration note
- Update affected docs and examples
- Mention what changed, why it changed, and how users should migrate

Because orb-ui is still pre-1.0, breaking changes can be reasonable when they make the library much better. They should still be explicit and easy to follow.

---

## Roadmap

Public roadmap work lives in [ROADMAP.md](./ROADMAP.md). Keep it useful for contributors and users, not exhaustive:

- Include the next meaningful product directions
- Update it when meaningful progress lands, not only when direction changes
- Avoid private analytics, credentials, internal notes, or confidential timelines
- Use neutral public language for brand-adjacent visual inspiration
- If a PR completes or substantially advances a roadmap item, update the roadmap in that PR or explain why no roadmap change was needed

---

_orb-ui is maintained by [Alexander Chen](https://github.com/alexanderqchen)._

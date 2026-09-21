---
'orb-ui': minor
---

Add `createOpenAILiveAdapter` for GPT-Live WebRTC sessions, full-duplex input/output metering,
application event forwarding, and graceful session finalization. Make GPT-Live the primary OpenAI
documentation and homepage example while preserving the existing Realtime adapter.

Live uses a server-side `/v1/live/sessions` SDP exchange through `createSession`; it is not a model
substitution for Realtime's `getClientSecret` flow. See the new Live guide for provider migration,
delegation, playback, and final usage handling.

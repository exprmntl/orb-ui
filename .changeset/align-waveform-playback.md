---
'orb-ui': patch
---

Align waveform-based microphone and playback activity across providers. Account for Deepgram’s scaled meter and Agora’s logarithmic meter, and calibrate ElevenLabs and LiveKit against recorded speech. Custom adapters can reuse the exported PCM_VOLUME_CALIBRATION profile.

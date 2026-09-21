---
title: Voice interface for coding agents
summary: "Talk to coding agents from an earbud or a phone: streaming speech-to-text (Whisper on CUDA), streaming text-to-speech, barge-in, a Discord voice leg and an Android client over WebSockets."
tech: [Python, faster-whisper, CUDA, ElevenLabs, WebSockets, Android]
status: private
image: /images/voice-interface.png
order: 2
---

The piece I care most about is a voice interface, so I can leave the keyboard and talk to agents from an earbud or my phone. It's the hardest part of the system and the one with the biggest payoff.

It has three legs: the desktop mic, a Discord voice channel, and an Android app. Whichever one I'm on, what I say is transcribed with faster-whisper on CUDA and handed to a Claude Code session, and the reply streams back as speech through ElevenLabs. Talking over it stops the playback.

Private, in daily use. A write-up is coming in Notes.

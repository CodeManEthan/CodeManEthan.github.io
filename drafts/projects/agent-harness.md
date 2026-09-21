---
title: Agent harness for Claude Code and Codex
summary: "Tooling that sits around AI coding agents on Linux: agent-to-agent messaging with names and inboxes, a memory system with full-text retrieval over past transcripts, shared project and service registries, a session launcher, and design-to-build traceability."
tech: [Python, Linux, Claude Code, Codex, SQLite, systemd]
status: private
image: /images/agent-harness.png
order: 1
---

My main project is a harness for working with AI coding agents, the tooling that sits around Claude Code and Codex. The point is to take the friction out of working with coding agents. Reliability, structure and good practice live in the tooling instead of in my discipline. A few principles hold it together. Give an agent the least context it needs. Prefer CLIs, because I can use them and so can the agents. Stay agnostic about the underlying agent, using the hooks, subagents and MCP that Claude Code or Codex offer where that's best, and building our own where it isn't. Don't build the next piece until the pieces under it exist.

What's in it: a messaging layer where agents have names and inboxes, can message each other or me, reach agents that are offline, and is built to bridge across providers. A memory system of my own, full-text retrieval over every past transcript and our notes, pulled into a session on demand. Shared project and service registries, so either of us can start a service and both see it. A session launcher that assembles each session's config, names the agent and its notes path, and shows the exact command before it runs. Traceability from design decision through build, with a check that fails any build that drops a decision. I watch token usage and prompt-cache hit rate. Over 5,000 tests, directed by me and mostly written by agents.

Private for now. A write-up is coming in Notes.

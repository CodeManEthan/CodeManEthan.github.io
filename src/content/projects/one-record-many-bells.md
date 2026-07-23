---
title: One Record, Many Bells
summary: Durable agent-to-agent communication in a few hundred lines of stdlib Python — atomic file mailboxes as the record, pluggable notifications as the bell.
tech: [Python, stdlib-only, Agent infrastructure, Discord]
status: public
repo: https://github.com/CodeManEthan/one-record-many-bells
featured: true
order: 2
---

## Overview

A small piece of agent infrastructure built on one idea: separate the **record** from the **bell**. Every message between agents is one atomically-written file in the recipient's inbox directory — that file is the record. Every transport (a console print, a filesystem wake, a Discord ping) is only a bell: a best-effort ping that says "check your mailbox."

## Why it matters

Polling loops burn tokens. Push transports drop messages. And a notification channel is an instruction channel to anyone who can forge a message. Splitting the record from the bell answers all three problems, and the split is small enough to adopt in any agent system.

## Design

- **Atomic writes** — messages are written with write-then-rename so a reader never sees a partial record.
- **Transport-agnostic** — bells are pluggable; the reference implementation ships console, file-wake, and Discord bells.
- **Trust boundary** — agents act only on the record in their mailbox, never on the text of a notification, which closes the forged-instruction hole.
- **Stdlib only** — no dependencies; the whole pattern is a few hundred lines you can read in one sitting.

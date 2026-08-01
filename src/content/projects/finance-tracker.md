---
title: Finance Tracker
summary: Full-stack personal finance tracker with a Flask backend, React/TypeScript frontend, and Docker deployment.
tech: [Python, Flask, SQLAlchemy, React, TypeScript, Docker]
status: private
demo: https://finance-tracker-production-a51c.up.railway.app
screenshot: /screenshots/finance-tracker.png
featured: true
order: 1
---

## Live demo

Try it at [finance-tracker-production-a51c.up.railway.app](https://finance-tracker-production-a51c.up.railway.app) — the login page shows the shared demo credentials (username `demo`). The demo account comes seeded with four months of realistic transactions, budgets, and categories, and resets nightly.

## Overview

A full-stack personal finance application for tracking accounts, transactions, and spending over time. The backend is a Flask API built on SQLAlchemy Core; the frontend is React with TypeScript. The whole stack runs locally with Docker Compose or deploys as separate services.

## Highlights

- **Clean API boundary** — the Flask backend exposes a JSON API consumed by the React app, so either side can evolve independently.
- **Environment-driven config** — development, testing, and production configs selected by environment variables, with SQLite for local development and a production database in deployment.
- **Mobile-friendly** — the dev server can bind to the LAN for testing the responsive UI on a phone.
- **Containerized** — one `docker compose up` brings up the full stack.

## Status

The source is private since it evolved alongside my real financial data, but the live demo above runs the full stack — Flask API, React frontend, and Postgres — and I'm happy to walk through the code on request.

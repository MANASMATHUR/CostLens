# 🔬 NakedSaaS — Strip Any SaaS Down to Its True Cost

**Three questions. One investigation. Zero hidden fees.**

Paste any SaaS URL → NakedSaaS uses TinyFish Web Agent's stealth engine to investigate across 10+ bot-protected platforms and answers three questions no other tool can:

1. **What does it cost THEM to run?** — Reverse-engineer infrastructure costs, expose true margins
2. **What would it cost to BUILD?** — Module-by-module replication estimate with team size and timeline
3. **What does it ACTUALLY cost YOU?** — Hidden fees, SSO tax, AI add-ons, overage charges, annual lock-in penalties

> **A TinyFish Web Agent by TinyFish Solutions showcase** — demonstrating capabilities impossible without stealth web automation.

---

## 🎯 The Problem

SaaS pricing is deliberately opaque:

- **For investors/analysts**: You can't evaluate a SaaS company's margins without knowing their infrastructure costs — but those costs are hidden behind technical complexity
- **For CTOs**: Build-vs-buy decisions require knowing the true build cost — but nobody can estimate it without deep technical analysis
- **For buyers**: The price on the pricing page is never the price you pay — hidden fees inflate costs 30-55% for typical teams

**NakedSaaS solves all three.**

---

## ✨ The Three Pillars

### 🔬 Pillar 1: Their Cost (Infrastructure)
Reverse-engineers what the SaaS company actually spends to run:
- Cloud compute costs (AWS/GCP/Azure) inferred from CDN headers, response patterns, traffic estimates
- Database costs estimated from API pagination styles and consistency models
- Third-party service costs from detected client-side SDKs (Segment, Datadog, LaunchDarkly, etc.)
- Engineering team costs from LinkedIn headcount × Glassdoor/Levels.fyi salary data
- **Output**: Monthly cost range, per-user cost, estimated gross margin

### 🏗️ Pillar 2: Build Cost (Replication)
Estimates what it would cost to build the product from scratch:
- Feature detection via DOM analysis, network interception, and runtime inspection
- Complexity scoring per module (editor, real-time, auth, search, API, mobile, etc.)
- Team size and timeline estimates based on detected tech stack
- Open-source component identification to reduce build effort
- **Output**: Total cost range, timeline, team size, module-by-module breakdown

### 💸 Pillar 3: Your Cost (True TCO)
Uncovers hidden costs the pricing page doesn't show:
- SSO tax (enterprise-only SSO forcing tier upgrades)
- AI add-on costs not included in base pricing
- Annual vs monthly billing penalties
- Minimum seat commitments on enterprise plans
- Overage charges mined from G2 reviews and help docs
- **Output**: Plan-by-plan true cost, TCO scenarios, competitor comparison

---

## 🛡️ Why Only TinyFish Web Agent Can Do This

| Data Source | Traditional Tools | ChatGPT | **TinyFish Web Agent + NakedSaaS** |
|---|---|---|---|
| CF-protected pricing pages | ❌ Blocked | ❌ Stale data | ✅ Stealth rendering |
| LinkedIn engineering headcount | ❌ Blocked | ❌ No access | ✅ Authenticated sessions |
| Glassdoor/Levels.fyi salaries | ❌ Bot-protected | ❌ Outdated | ✅ Stealth browsing |
| Cloudflare Radar traffic data | ❌ Protected API | ❌ No access | ✅ Full page rendering |
| G2 review mining | ❌ Anti-scrape | ❌ | ✅ Bot protection bypass |
| Runtime JS analysis | ❌ No browser | ❌ No execution | ✅ Real browser context |
| Network request interception | ❌ Impossible | ❌ | ✅ Full Performance API |

---

## 🏗 Architecture

```
┌────────────────────────────────────────────┐
│            FRONTEND (React + Vite)          │
│   URL Input → Scan → Three-Pillar Report   │
└──────────────────┬─────────────────────────┘
                   │ REST / SSE
┌──────────────────▼─────────────────────────┐
│             BACKEND (Node.js)               │
│                                             │
│  ┌─────────────┐ ┌────────────┐ ┌────────┐│
│  │ Infra Cost  │ │ Build Cost │ │ Buyer  ││
│  │ Scanner     │ │ Estimator  │ │ Analyzer││
│  └──────┬──────┘ └─────┬──────┘ └───┬────┘│
│         └───────┬──────┘─────────────┘     │
│                 ▼                           │
│  ┌──────────────────────────────────────┐  │
│  │      AI COST MODELER (OpenAI)        │  │
│  │  Synthesizes signals into report     │  │
│  └──────────────────────────────────────┘  │
└──────────────────┬─────────────────────────┘
                   │ TinyFish REST API
┌──────────────────▼─────────────────────────┐
│      TINYFISH WEB AGENT ENGINE              │
│  Crawls 10+ bot-protected platforms:       │
│  Target site, GitHub, LinkedIn, Glassdoor, │
│  Levels.fyi, Cloudflare Radar, SimilarWeb, │
│  G2, Reddit, AWS Calculator                │
└────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

```bash
# Clone
git clone https://github.com/tinyfishsolutions/nakedsaas.git && cd nakedsaas

# Install app dependencies from root
npm install
npm run install:all

# Backend env
cp backend/.env.example backend/.env
# Edit backend/.env with TINYFISH_API_KEY and OPENAI_API_KEY

# Run both backend + frontend from root
npm run dev

# Open http://localhost:5173
```

Enter a SaaS URL and click **Investigate** to run a live TinyFish-backed scan.

### Alternative: run services separately

```bash
# Terminal 1
npm run dev:backend

# Terminal 2
npm run dev:frontend
```

### Vercel deployment notes

- This repo is configured for a single Vercel project:
  - Frontend static output: `frontend/dist`
  - Backend API routes: `/api/*` (serverless function)
- Required Vercel environment variables:
  - `TINYFISH_API_KEY`
  - `OPENAI_API_KEY`
- Optional:
  - `OPENAI_MODEL`
  - `TINYFISH_ENDPOINT`
  - `TINYFISH_BROWSER_PROFILE`
- Long investigations can exceed short serverless limits; this project sets a higher function duration in `vercel.json`.

### TinyFish API alignment

Official docs: **[https://docs.mino.ai](https://docs.mino.ai)**. The API has moved from `mino.ai` to `agent.tinyfish.ai`; use base URL `https://agent.tinyfish.ai` and env `TINYFISH_API_KEY`.

This project follows TinyFish official docs with:

- Base URL: `https://agent.tinyfish.ai`
- Auth header: `X-API-Key: $TINYFISH_API_KEY`
- Primary endpoint pattern in app runtime: `POST /v1/automation/run-sse` ([SSE streaming](https://docs.mino.ai/api-reference/automation/run-browser-automation-with-sse-streaming))
- Supported client methods in code for official endpoint model:
  - `POST /v1/automation/run`
  - `POST /v1/automation/run-async`
  - `GET /v1/runs/{run_id}`
- Browser profile and proxy fields:
  - `browser_profile` (`lite` or `stealth`)
  - `proxy_config` (optional)
- [Error codes](https://docs.mino.ai/error-codes) reference for API error responses

---

## 📁 Project Structure

```
nakedsaas/
├── frontend/
│   ├── src/App.jsx              # Full dashboard (three-pillar UI)
│   ├── src/main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── server.js            # Express API + SSE streaming
│   │   ├── config/index.js
│   │   ├── tinyfish/tinyfish-web-agent-client.js  # TinyFish Web Agent client
│   │   ├── services/
│   │   │   ├── infra-cost-scanner.js    # Pillar 1: Their cost
│   │   │   ├── build-cost-estimator.js  # Pillar 2: Build cost
│   │   │   └── buyer-cost-analyzer.js   # Pillar 3: Your cost
│   │   └── analysis/
│   │       └── cost-modeler.js  # AI synthesis (OpenAI)
│   ├── .env.example
│   └── package.json
└── docs/
    └── BUSINESS.md
```

---

## 💰 Business Model

| Tier | Price | Scans | Features |
|------|-------|-------|----------|
| **Free** | $0 | 3/month | All three pillars, basic report |
| **Pro** | $79/mo | 50/month | PDF export, historical tracking, alerts |
| **Team** | $249/mo | Unlimited | API access, custom competitors, Slack alerts |
| **Enterprise** | Custom | Unlimited | On-prem, white-label, bulk analysis |

**Target markets**: VC/PE due diligence, SaaS procurement teams, CTOs evaluating build-vs-buy, competitive intelligence analysts.

---

## 📄 License

Proprietary — TinyFish Solutions. All rights reserved.

---

<p align="center">
  <strong>Built with <a href="https://agent.tinyfish.ai">TinyFish Web Agent</a> by TinyFish Solutions</strong><br>
  <em>The price on the page is never the price you pay.</em>
</p>

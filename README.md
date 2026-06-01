# CHANAKYA - built by Ajnav labs (Santhosh P)

**Real-time global intelligence dashboard** — AI-powered news aggregation, geopolitical monitoring, and infrastructure tracking in a unified situational awareness interface.

[![GitHub stars](https://img.shields.io/github/stars/dast-santhosh/chanakya?style=social)](https://github.com/dast-santhosh/chanakya/stargazers)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/re63kWKxaz)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Last commit](https://img.shields.io/github/last-commit/dast-santhosh/chanakya)](https://github.com/dast-santhosh/chanakya/commits/main)
[![Latest release](https://img.shields.io/github/v/release/dast-santhosh/chanakya?style=flat)](https://github.com/dast-santhosh/chanakya/releases/latest)

<p align="center">
  <a href="https://chanakya-pi.vercel.app"><img src="https://img.shields.io/badge/Web_App-chanakya-pi.vercel.app-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Web App"></a>&nbsp;
  <a href="https://tech.chanakya-pi.vercel.app"><img src="https://img.shields.io/badge/Tech_Variant-tech.chanakya-pi.vercel.app-0891b2?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Tech Variant"></a>&nbsp;
  <a href="https://finance.chanakya-pi.vercel.app"><img src="https://img.shields.io/badge/Finance_Variant-finance.chanakya-pi.vercel.app-059669?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Finance Variant"></a>&nbsp;
  <a href="https://commodity.chanakya-pi.vercel.app"><img src="https://img.shields.io/badge/Commodity_Variant-commodity.chanakya-pi.vercel.app-b45309?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Commodity Variant"></a>&nbsp;
  <a href="https://happy.chanakya-pi.vercel.app"><img src="https://img.shields.io/badge/Happy_Variant-happy.chanakya-pi.vercel.app-f59e0b?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Happy Variant"></a>&nbsp;
  <a href="https://energy.chanakya-pi.vercel.app"><img src="https://img.shields.io/badge/Energy_Variant-energy.chanakya-pi.vercel.app-eab308?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Energy Variant"></a>
</p>

<p align="center">
  <a href="https://chanakya-pi.vercel.app/docs/documentation"><strong>Documentation</strong></a> &nbsp;·&nbsp;
  <a href="https://github.com/dast-santhosh/chanakya/releases/latest"><strong>Releases</strong></a> &nbsp;·&nbsp;
  <a href="https://chanakya-pi.vercel.app/docs/contributing"><strong>Contributing</strong></a>
</p>


---

## What It Does

- **500+ curated news feeds** across 15 categories, AI-synthesized into briefs
- **Dual map engine** — 3D globe (globe.gl) and WebGL flat map (deck.gl) with 56 map layer types
- **Cross-stream correlation** — military, economic, disaster, and escalation signal convergence
- **Country Intelligence Index** — composite risk scoring across 12 signal categories
- **Finance radar** — 92 stock exchanges, commodities, crypto, and 7-signal market composite
- **Local AI** — run everything with Ollama, no API keys required
- **6 site variants** from a single codebase (world, tech, finance, commodity, happy, energy)
- **Native desktop app** (Tauri 2) for macOS, Windows, and Linux
- **23 languages** with native-language feeds and RTL support

For the full feature list, architecture, data sources, and algorithms, see the **[documentation](https://chanakya-pi.vercel.app/docs/documentation)**.

---

## Support Status

All site variants and desktop binaries are built from a single codebase and ship from the same release process. The table below clarifies maintenance status so you know which surfaces are safe to depend on.

| Surface | Status | Notes |
|---------|--------|-------|
| `chanakya-pi.vercel.app`, `tech.`, `finance.`, `commodity.`, `happy.`, `energy.` | Stable | Public deployments built from this repo, actively maintained |
| Desktop binaries (Windows / macOS Apple Silicon / macOS Intel / Linux AppImage) | Stable | One Tauri binary that switches variants in-app; current CI release targets are `full` and `tech` |

Issues filed against any of the above are triaged from the same backlog — see the [issues board](https://github.com/dast-santhosh/chanakya/issues) for currently-open work.

---

## Quick Start

```bash
git clone https://github.com/dast-santhosh/chanakya.git
cd chanakya
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173). The app runs with no environment variables.

Feature-specific data sources may require credentials — for example, the flight-price command (`fly LON DXB`) needs `TRAVELPAYOUTS_API_TOKEN` to return live quotes; without it the command shows a "credentials required" message rather than synthetic data. See `.env.example` for the full list.

For variant-specific development:

```bash
npm run dev:tech       # tech.chanakya-pi.vercel.app
npm run dev:finance    # finance.chanakya-pi.vercel.app
npm run dev:commodity  # commodity.chanakya-pi.vercel.app
npm run dev:happy      # happy.chanakya-pi.vercel.app
```

See the **[self-hosting guide](https://chanakya-pi.vercel.app/docs/getting-started)** for deployment options (Vercel, Docker, static).

---

## Tech Stack

| Category | Technologies |
|----------|-------------|
| **Frontend** | Vanilla TypeScript, Vite, globe.gl + Three.js, deck.gl + MapLibre GL |
| **Desktop** | Tauri 2 (Rust) with Node.js sidecar |
| **AI/ML** | Ollama / Groq / OpenRouter, Transformers.js (browser-side) |
| **API Contracts** | Protocol Buffers (276 protos, 34 services), sebuf HTTP annotations |
| **Deployment** | Vercel Edge Functions (60+), Railway relay, Tauri, PWA |
| **Caching** | Redis (Upstash), 3-tier cache, CDN, service worker |

Full stack details in the **[architecture docs](https://chanakya-pi.vercel.app/docs/architecture)**.

---

## Flight Data

Flight data provided gracefully by [Wingbits](https://wingbits.com?utm_source=worldmonitor&utm_medium=referral&utm_campaign=worldmonitor), the most advanced ADS-B flight data solution.

---

## Data Sources

Chanakya aggregates 65+ external providers and APIs across geopolitics, finance, energy, climate, aviation, cyber, military, infrastructure, and news intelligence — surfaced through 500+ curated feeds and tracked by a freshness monitor covering 35 source groups. See the full [data sources catalog](https://chanakya-pi.vercel.app/docs/data-sources) for providers, feed tiers, and collection methods.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

```bash
npm run typecheck        # Type checking
npm run build:full       # Production build
```

---

## License

**AGPL-3.0-only** for the source code. Commercial use is permitted under the AGPL when you comply with its copyleft and source-availability terms.

| Use Case | Allowed? |
|----------|----------|
| Personal / research / educational | Yes, under AGPL-3.0-only |
| Self-hosted instance | Yes, under AGPL-3.0-only |
| Fork and modify | Yes, share source under AGPL-3.0-only when required |
| Commercial use / SaaS | Yes, under AGPL-3.0-only when you comply with AGPL obligations |
| Private-source proprietary use or official branding rights | Separate commercial or trademark permission needed |

See [LICENSE](LICENSE) for the full code license and [docs/license.mdx](docs/license.mdx) for a plain-language summary. Commercial licensing is available as an alternative option for teams that need non-AGPL terms.

Copyright (C) 2024-2026 Ajnav Labs. All rights reserved.

---

## Author

**Ajnav Labs (Santhosh P)** — [ajnav.com](https://ajnav.com)

## Security Acknowledgments

We thank the following researchers for responsibly disclosing security issues:

- **Cody Richard** — Disclosed three security findings covering IPC command exposure, renderer-to-sidecar trust boundary analysis, and fetch patch credential injection architecture (2026)

See our [Security Policy](./SECURITY.md) for responsible disclosure guidelines.

---

<p align="center">
  <a href="https://chanakya-pi.vercel.app">chanakya-pi.vercel.app</a> &nbsp;·&nbsp;
  <a href="https://chanakya-pi.vercel.app/docs/documentation">docs.chanakya-pi.vercel.app</a> &nbsp;·&nbsp;
  <a href="https://finance.chanakya-pi.vercel.app">finance.chanakya-pi.vercel.app</a> &nbsp;·&nbsp;
  <a href="https://commodity.chanakya-pi.vercel.app">commodity.chanakya-pi.vercel.app</a>
</p>

## Star History

<a href="https://api.star-history.com/svg?repos=dast-santhosh/chanakya&type=Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=dast-santhosh/chanakya&type=Date&type=Date&theme=dark" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=dast-santhosh/chanakya&type=Date&type=Date" />
 </picture>
</a>
#   c h a n a k y a 
 
 

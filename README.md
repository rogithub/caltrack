# CalTrack

> Calorie tracking for AI clients — MCP server + REST API

Take a photo of your food. Your AI estimates the calories and logs them. Ask it how your week went. That's it.

No app to install. No dashboard to check. You already have an AI — just talk to it.

Works with **Claude**, **ChatGPT**, and any AI Vision client that supports MCP or OpenAPI actions. Free forever. Self-hostable.

---

## How it works

```
You take a photo of your food
        ↓
Your AI (Claude, GPT-4o, etc.) estimates calories and macros
        ↓
AI calls CalTrack via MCP or REST to save the record
        ↓
You ask "how did I do this week?" and AI queries CalTrack for context
```

The AI does the talking. The backend does the math (BMR, TDEE via Mifflin-St Jeor). You just eat.

---

## Authentication

CalTrack uses API keys with the prefix `cal_`. You get yours by registering via the `register` MCP tool or `POST /auth/register`.

Two ways to authenticate — use whichever your client supports:

| Method | How | Best for |
|--------|-----|----------|
| **Bearer header** | `Authorization: Bearer cal_xxx` | Claude Desktop, direct API calls |
| **Query param** | `https://caltrack.xplaya.com/mcp?key=cal_xxx` | Claude.ai web, any client that only accepts a URL |

Only the `register` tool and `POST /auth/register` are public. Everything else requires auth.

---

## Quick start — Claude

### 1. Register first (no API key needed yet)

Add the MCP server **without** your key and ask Claude to register you:

> "Register me in CalTrack"

Claude will ask for your email and return your API key. Copy it.

### 2. Add the MCP server with your key

**Claude.ai web/mobile** — Settings → Integrations → Add MCP server, use this URL:
```
https://caltrack.xplaya.com/mcp?key=cal_your_api_key_here
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "caltrack": {
      "url": "https://caltrack.xplaya.com/mcp",
      "headers": {
        "Authorization": "Bearer cal_your_api_key_here"
      }
    }
  }
}
```

### 3. Start tracking

> "I just had 3 birria tacos with consomé, log it"

> "Show me how I did this week"

> "Update my profile: 82kg, 175cm, born 1990-06-15, male, moderate activity"

---

## Quick start — ChatGPT

1. Create a Custom GPT
2. In the GPT editor go to **Actions → Import from URL**
3. Paste: `https://caltrack.xplaya.com/docs/json`
4. Add your API key as a Bearer token in Authentication

The flow is identical to MCP from your perspective.

---

## MCP Tools

| Tool | Auth | Description |
|------|------|-------------|
| `register` | Public | Creates account, returns API key |
| `log_meal` | Required | Saves a meal with calories and optional macros |
| `get_meals` | Required | Queries meals by date range (max 90 days) |
| `update_profile` | Required | Updates weight, height, age, activity level |

When your profile is complete, `get_meals` responses automatically include your BMR, TDEE, and average daily deficit/surplus for the queried period.

---

## REST API

Interactive docs: `https://caltrack.xplaya.com/docs`

### Authentication

All endpoints except `/auth/register` require:
```
Authorization: Bearer cal_your_api_key_here
```

### Endpoints

```
GET  /health                              — k8s health check
POST /auth/register                       — create account (rate limited: 5/hour)
PUT  /profile                             — update profile fields (all optional)
POST /meals                               — log a meal
GET  /meals?from=<ISO8601>&to=<ISO8601>   — query meal history
```

#### POST /auth/register
```json
// Request
{ "email": "you@example.com" }

// Response 201
{ "api_key": "cal_a1b2c3...", "message": "Guarda esta key, no se puede recuperar" }
```

#### PUT /profile
```json
// Request (all fields optional)
{
  "weight_kg": 82.5,
  "height_cm": 175,
  "date_of_birth": "1990-06-15",
  "biological_sex": "male",
  "activity_level": "moderate"
}

// Response 200 (includes BMR/TDEE when profile is complete)
{ "weight_kg": 82.5, "height_cm": 175, ..., "bmr": 1820, "tdee": 2821 }
```

#### POST /meals
```json
// Request
{ "description": "Tacos de birria x3 con consomé", "calories": 720, "protein_g": 38, "carbs_g": 65, "fat_g": 28 }

// Response 201
{ "id": "uuid", "description": "...", "calories": 720, "eaten_at": "2025-03-01T14:30:00Z" }
```

#### GET /meals
```
GET /meals?from=2025-02-01T00:00:00Z&to=2025-03-01T00:00:00Z
```
Both params required, UTC, `from` inclusive, `to` exclusive. Max 90-day range, max 200 meals.

```json
{
  "from": "...", "to": "...",
  "meals": [...],
  "summary": { "total_meals": 87, "avg_daily_calories": 1820 },
  "profile_context": { "bmr": 1820, "tdee": 2821, "avg_daily_deficit": 1001 }
}
```
`profile_context` only appears when the profile is complete.

---

## Self-hosting

### Requirements

- Node.js 22+
- PostgreSQL 17+ (uses `uuidv7()` built-in)

### Local development

```bash
git clone https://github.com/rogithub/caltrack
cd caltrack
npm install
cp .env.example .env   # edit DATABASE_URL
npm run dev
```

### Database setup

Run against your PostgreSQL instance (once):

```bash
psql $DATABASE_URL -f migrations/001_init.sql
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/caltrack` |
| `PORT` | No | Default: `3000` |
| `API_BASE_URL` | No | Used in OpenAPI spec. Default: `http://localhost:3000` |

### Docker

```bash
docker build -t caltrack .
docker run -p 3000:3000 -e DATABASE_URL=... caltrack
```

### k3s / Kubernetes

Manifests are in `k8s/`. The deployment expects:

- Secret `caltrack-secret` with key `database-url`
- Secret `ghcr-credentials` for pulling the image from GHCR
- NodePort `30514`

See [k3s-manifests](https://github.com/rogithub/k3s-manifests) for the full ArgoCD setup.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 + TypeScript |
| HTTP framework | Fastify |
| PostgreSQL driver | `postgres` (npm) — raw SQL, no ORM |
| MCP server | `@modelcontextprotocol/sdk` |
| OpenAPI | `@fastify/swagger` + `@fastify/swagger-ui` |
| Auth | Self-issued API keys (`cal_` prefix) |
| Deploy | k3s + ArgoCD + Cloudflare Tunnel |

Two tables. Four queries. No AI in the backend.

---

## Project structure

```
src/
├── db/
│   ├── client.ts       — postgres connection
│   └── queries.ts      — the 4 SQL queries
├── api/
│   ├── auth.ts         — POST /auth/register
│   ├── profile.ts      — PUT /profile
│   └── meals.ts        — POST /meals, GET /meals
├── mcp/
│   └── server.ts       — MCP tools: register, log_meal, get_meals, update_profile
├── middleware/
│   └── auth.ts         — API key validation
├── lib/
│   └── nutrition.ts    — Mifflin-St Jeor, TDEE, profile context
└── index.ts            — Fastify app entry point
static/
├── index.html          — landing page
├── llms.txt            — AI discoverability
├── robots.txt
└── sitemap.xml
migrations/
└── 001_init.sql
```

---

## Design decisions

**No AI in the backend.** The AI lives on the client side. CalTrack only stores and retrieves data, and computes BMR/TDEE so the AI doesn't have to do math.

**UTC everywhere.** All dates stored in UTC. The AI knows the user's timezone from context and converts before calling `get_meals`. If you travel, your historical records stay accurate.

**UUIDv7 primary keys.** Chronologically sortable, making range queries on `meals` index-friendly (PG17+).

**Rate limiting only on registration.** The rest of the API is protected by API keys, no throttling needed.

---

## License

MIT

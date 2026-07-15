# 🌐 Multilingual incident content + in-product status banner — Design

- **Feature:** Per-locale incident CONTENT (es/en/pt) on the self-hosted openstatus status page (`status.yavendio.com`), plus a summarized multilingual status banner inside the merchant dashboard (`web-app`).
- **Linear:** follow-up of **ENG-2288** (no new issue — tracked under ENG-2288; docs in `ISSUES_DOCS/ENG-2288`).
- **Date:** 2026-07-15
- **Owning repos:** `YaVendio/openstatus` fork (branch `yavendio`) — workstream **A**; `web-app` — workstream **B**.
- **Builds on:** ENG-2288 (status page + openstatus MCP already live).

---

## 🎯 Problem & goal

ENG-2288 shipped `status.yavendio.com` with UI-chrome i18n already working (next-intl, `LocaleSwitcher` in the footer, per-page `locales` + `default_locale`). But **incident content is single-language**: `status_report.title` and `status_report_update.message` are single `text` columns. A visitor switching to Portuguese gets a Portuguese *interface* wrapped around a Spanish-written *incident*.

Two goals:

- **A) Multilingual incident content** — a visitor choosing es/en/pt sees the incident **title + every update message** in that language.
- **B) In-product banner** — merchants working in the dashboard see a **summarized, multilingual** banner when there is an active incident, pulling live from `status.yavendio.com`, so the public status page is actually surfaced where merchants are.

---

## ✅ Locked decisions (from intake + brainstorming)

| Decision | Choice |
|---|---|
| Linear tracking | Follow-up under **ENG-2288** (no new issue) |
| Missing-locale fallback | **Fall back to the base text column** (never blank; legacy incidents stay readable) |
| How the 3 variants are produced | **Claude translates at publish time** via the `magic:status-page` MCP (no external translation API) |
| Storage shape | **Additive JSON columns** (`title_i18n`, `message_i18n`), base column stays fallback + author language |
| Banner surface | **Merchant dashboard** (`web-app` `dashboard-v2`) |
| Banner data source | **Consume the localized public JSON feed** (`status.yavendio.com/<locale>/feed/json`) — no new fork endpoint |
| Banner UX | **Dismissible**, reappears on new update / higher severity, hides on resolve, color by severity |

---

## 🗺️ Fleet placement (Phase 2)

- **Owning repos:**
  - **A** → `YaVendio/openstatus` fork (`packages/db` schema, `packages/services`, `apps/server` MCP tools, `apps/status-page` render/feeds, `packages/locales`). Source of truth for incident content and the localized feed.
  - **B** → `web-app` (`src/components/banners/status/*`, `src/app/dashboard-v2/layout.tsx`, `src/lang/locales/*`). Pure consumer of A's public feed.
- **Cross-repo order (migrate-first, atomic):** A must be **built, migrated, and live** (schema → services → MCP → localized feed → rebuild `status-page`+`server` images → deploy → `page.locales`) **before B ships**. B may be *developed* in parallel, but its multilingual correctness depends on A's localized feed being live.
- **V1/V2:** neither. This is a status/observability surface; it does not touch the WhatsApp/Instagram messaging rail or the V1/V2 conversation path. No routing invariants involved.
- **Secrets:** none added. The feed is public/unauthenticated; the banner needs no API key. MCP writes continue to use the existing `OPENSTATUS_API_KEY` (Infisical prod `/openstatus`).

---

## 🧩 Workstream A — Multilingual incident content (openstatus fork)

### A1. Storage & fallback

Additive, nullable JSON columns; base column unchanged (author language + universal fallback):

```
status_report
  title        TEXT   -- base = author language (es); fallback
  title_i18n   TEXT (JSON, nullable)   -- { "en": "...", "pt": "..." }

status_report_update
  message      TEXT   -- base; fallback
  message_i18n TEXT (JSON, nullable)   -- { "en": "...", "pt": "..." }
```

- **Type:** `Record<Locale, string>` stored as JSON (`text({ mode: "json" }).$type<Partial<Record<Locale,string>>>()`).
- **Resolver (pure):** `resolveLocalized(i18n, base, activeLocale) = i18n?.[activeLocale] ?? base`.
- **Legacy rows** (`i18n === null`) resolve to `base` for every locale — zero backfill, zero risk.
- The i18n map MAY include the base language too (harmless duplication); it is never *required* to, because the resolver always falls back to `base`.

### A2. Write path

1. **Schema** (`packages/db/src/schema/status_reports/`): add the two columns to `status_reports.ts`; wire them into `validation.ts` (insert/select schemas). Generate a Drizzle migration (`drizzle/00XX_*.sql`) — additive `ALTER TABLE ADD COLUMN`.
2. **Service inputs** (`packages/services/src/status-report/schemas.ts`): add optional `titleI18n?: Record<Locale,string>` to `CreateStatusReportInput`; `messageI18n?` to `AddStatusReportUpdateInput`, `ResolveStatusReportInput`, and `CreateStatusReportInput` (initial update). Optional `titleI18n?` on `UpdateStatusReportInput`.
3. **Service writes** (`create.ts`, `add-update.ts`, `resolve.ts`): persist the i18n maps alongside base. Audit-log snapshots include them (not secret; no redaction needed — verify `emitAudit` diff handles JSON columns).
4. **Agent-tools / MCP** (`packages/services/src/agent-tools/status-report.ts`): add **optional** `titleI18n` / `messageI18n` (`z.record(localeEnum, z.string())`) to `create_status_report`, `add_status_report_update`, `resolve_status_report`, and `titleI18n` to `update_status_report`. Base `title`/`message` stay **required** (the fallback). Fully backward-compatible: omitting i18n = today's behavior. The `approval.summarize` preview shows base text (translations previewed as a locale count, e.g. "+en, +pt").
5. **Tool outputs & `list_status_reports` unchanged** — they return base text. The agent reasons over one language; translations are a render concern only. Minimal surface.

### A3. Read path (render + feeds)

- Apply `resolveLocalized(...)` at the **read boundary** that assembles reports for the status-page, so render components (`StatusFeed`, event pages) receive already-resolved strings and are **not modified**.
- Boundaries to cover (all locale-scoped under `[locale]`):
  - Status page + `events/` report/detail rendering.
  - **Public feeds** — `feed/json/route.ts`, `feed/[type]/route.ts` (RSS), `llms.txt/route.ts`. These already receive `locale` from the route; a `pt` feed must return `pt` content. **This is what powers workstream B.**
- The resolver is a small shared helper (e.g. `packages/services` util or a status-page lib) reused by every boundary.

### A4. Locales & page config

- **`packages/locales/index.ts`:** add `es`, `pt` to `locales`; `localeDetails` (`es → { name: "Español", flag: "🇪🇸" }`, `pt → { name: "Português", flag: "🇧🇷" }`); `dateFnsLocales` (`es`, `ptBR` from `date-fns/locale`).
- **`apps/status-page/messages/es.json` + `pt.json`:** full chrome translation, `en.json` as the reference key set. (Generated as part of the build.)
- **Enable the switcher** on our page via SQL (out-of-band, like ENG-2288's `custom_domain`): `UPDATE page SET locales = '["es","en","pt"]', default_locale = 'es' WHERE slug = 'yavendio';`. The footer `LocaleSwitcher` renders automatically once `locales.length > 1`.

### A5. Migration & deployment

- **Migration:** additive columns → run the ENG-2288 out-of-band Drizzle migrator over `kubectl port-forward` (the server image does **not** auto-migrate). New `drizzle/*.sql` lands in the repo.
- **Images to rebuild:** **`status-page`** (render/feeds/locales) **and `server`** (MCP tool schema changes live in the server app) → `gh workflow run docker-publish.yml --repo YaVendio/openstatus --ref <branch> -f services=status-page,server` → verify pushed digest matches pods → re-POST both NF deployments.
- **Order on deploy:** apply migration → deploy `server` + `status-page` → set `page.locales`.

---

## 🖥️ Workstream B — In-product status banner (web-app)

### B1. Component & placement

- **New:** `src/components/banners/status/StatusBanner.tsx` (client, dismiss/severity) + a server wrapper that fetches. Mirrors the existing `src/components/banners/yago/` pattern.
- **Mount:** in `src/app/dashboard-v2/layout.tsx`, above content (root dashboard layout).

### B2. Data

- A **server component** fetches `https://status.yavendio.com/<locale>/feed/json` with the merchant's locale (`src/lang/request-locale.server.ts`), `fetch(..., { next: { revalidate: 60 } })` — public, cacheable, no API key.
- Derive from the feed: **is there a non-`resolved` report?** → highest severity from `componentImpacts` (`major_outage` > `partial_outage` > `degraded_performance`) + the **localized report title** + link. An active report with **no impact rows** → default **informational** severity (still shown). No active report → render nothing.
- Pass the derived summary to the client `StatusBanner`.
- **Plan-phase check:** confirm the exact `feed/json` payload shape against `apps/status-page/.../feed/json/route.ts` (report `status`, `updates`, `componentImpacts`, localized `title`). If the feed omits impacts, derive severity from the latest update `status` or extend the feed generator as part of A3.

### B3. Multilingual

- **Dynamic** part (incident title) arrives already-localized from A's feed.
- **Static** chrome (wrapper copy e.g. "Estamos presentando problemas en la plataforma", "Ver estado", severity labels) → new keys in `src/lang/locales/{en,es,pt}.json`.

### B4. UX

- Dismiss via `localStorage` keyed `status-banner-dismissed:<reportId>:<latestUpdateId>:<severity>` → **reappears** when the latest update or severity changes; auto-hides when no active report (resolved).
- Severity → banner color (ya-brand tokens: degraded=warning, partial=orange, major=destructive). Link → `https://status.yavendio.com` (root; shown in the merchant's language via the page default/switcher).
- No secrets, no auth.

### B5. Gates

`ya-frontend` + `ya-implementation` + `ya-review` + `ya-brand` (token discipline, no anti-slop). Analytics (PostHog view/click) = **optional follow-up**, out of initial scope (keeps the `ya-posthog` gate off the critical path).

---

## 🤖 `magic:status-page` skill contract change

- The on-call authors the incident in **one** language (default `es`).
- The skill instructs Claude to: generate `en` and `pt` variants (optionally `es`), and pass `titleI18n` / `messageI18n` maps alongside the required base `title`/`message` in the create/update/resolve MCP calls.
- Document the fallback: if Claude does not translate, the base text renders in every locale (no breakage).
- `notify` remains **OFF by default** (unchanged human-choice policy).
- Add a one-line note that the merchant dashboard banner (B) surfaces active incidents automatically — no extra action needed.

---

## 🚧 Scope boundaries

**In scope:** incident `title` + update `message` per-locale (es/en/pt); es/pt chrome; localized public feed; dashboard banner consuming the feed; `magic:status-page` contract.

**Out of scope (documented follow-ups):**
- **Component names** (`page_component.name`, the 4 labels) stay single-language (base). Localizing them is another schema+dashboard change, low value (short static labels).
- **Dashboard authoring UI** unchanged — a report created via the openstatus dashboard writes base only → renders identically in all locales (acceptable; we author via MCP).
- **Subscriber emails** (Resend) — `notify` OFF + placeholder key; if ever enabled they use base language.
- **Banner analytics** (PostHog) — optional follow-up.
- **Banner on the public landing** (`yv-landing-v2`) — not this iteration (dashboard only).

---

## 🎫 Acceptance criteria

1. A report published via MCP with `titleI18n`/`messageI18n` renders **title + each update** in `es`, `en`, and `pt` when the visitor switches locale; a report published **without** i18n renders base text in all three (fallback proven).
2. `GET status.yavendio.com/pt/feed/json` returns **Portuguese** report content (and `/es`, `/en` respectively); legacy reports return base.
3. The footer `LocaleSwitcher` offers **Español / English / Português**; chrome is fully translated in each (no missing-key fallbacks visible).
4. With an **active** incident, the `web-app` `dashboard-v2` shows a severity-colored banner with the **localized** title + a working link to `status.yavendio.com`; dismiss hides it; a new update/severity change brings it back; resolving the incident removes it.
5. With **no** active incident, no banner renders and the feed fetch degrades safely (banner absent, no dashboard error) if `status.yavendio.com` is unreachable.
6. No secrets committed; existing `test_secret_scan` / lint / typecheck green in both repos.

---

## ⚠️ Risks & rollback

- **Migration safety:** additive nullable columns — no data rewrite, trivially reversible (`DROP COLUMN`); legacy rows unaffected.
- **Fork divergence:** all A changes are additive on top of upstream (no signature removals) → minimizes rebase pain. Base columns remain the upstream contract.
- **Banner availability:** if the feed is unreachable/slow, the server fetch must fail **open** (render nothing, never block or error the dashboard). ISR/`revalidate` isolates dashboard render from status-page latency.
- **Rollback:** A → redeploy previous `server`/`status-page` image tags + leave columns (harmless); B → remove the banner mount (single layout line) / feature-flag it off.

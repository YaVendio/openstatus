# Multilingual incident content + status banner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render incident title + every update message in the visitor's language (es/en/pt) on `status.yavendio.com`, and surface a summarized multilingual banner in the web-app merchant dashboard.

**Architecture:** Additive i18n JSON columns (`title_i18n`, `message_i18n`) on the existing report/update rows; base column stays the author language + universal fallback. A pure `resolveLocalized` helper resolves per active locale at the tRPC read procedures — `statusPage.get`, `getLight`, AND `getReport` (the incident-detail page uses `getReport`, a separate boundary) — which every render site and public feed consume. The openstatus MCP write-path gains optional i18n maps (Claude fills them at publish time). The web-app banner consumes the now-localized public JSON feed.

**Tech Stack:** TypeScript, Drizzle ORM + libSQL/Turso, drizzle-zod, tRPC, Next.js (status-page + web-app), Zod, Biome, Deno test (`@std/testing/bdd`, `@std/expect`), next-intl, `@modelcontextprotocol/sdk`.

**Spec:** `docs/superpowers/specs/2026-07-15-multilingual-incident-content-design.md`

## Global Constraints

- **Follow-up of ENG-2288** — no new Linear issue; project docs in `ISSUES_DOCS/ENG-2288`.
- **Fallback rule (verbatim):** `resolveLocalized(i18n, base, activeLocale) = i18n?.[activeLocale] ?? base`. Legacy rows (`i18n === null`) resolve to `base` for every locale.
- **Base column is the author language (default `es`) and the universal fallback.** Base `title`/`message` stay **required** everywhere; i18n maps are always **optional**.
- **Additive only** — no removed signatures, no column drops, no `deny_unknown_fields`/strict tightening on existing public schemas. Minimizes fork rebase pain.
- **Migrations never run at service startup.** Generate the Drizzle migration into `packages/db/drizzle/`; apply to prod out-of-band (ENG-2288 migrator over `kubectl port-forward`).
- **Locale set:** `["en","fr","de","tr","hi","es","pt"]` after this change; page uses `["es","en","pt"]`.
- **Zod v4 (pinned `4.1.13`):** `z.record(enum, …)` is EXHAUSTIVE — it requires every key. Locale maps MUST use `z.partialRecord(z.enum(locales), z.string())` for a partial map, never `z.record(...)`.
- **Secrets:** none added. Feed is public. MCP keeps existing `OPENSTATUS_API_KEY`.
- **Fixture merchants 948181 / 948178 must never be touched** (not relevant here, but a standing rule).
- **Test prerequisite (fork, services/api):** a local libSQL must be running and seeded. In one terminal: `turso dev`. Then: `pnpm --filter @openstatus/db migrate && pnpm --filter @openstatus/db seed`. Re-run `migrate` after Task A3 regenerates the schema.
- **Per-surface gates:** openstatus TS → `pnpm format` (**oxfmt + oxlint**, NOT Biome — the repo's `Agent.md` is stale) + `tsc` + Drizzle migration discipline. web-app UI → `ya-frontend` + `ya-implementation` + `ya-review` + `ya-brand`. No Rust in scope.
- **Ship order:** Part A merged, migrated, and LIVE before Part B ships.

---

## Part A — openstatus fork (worktree `D:\YAVENDIO\openstatus-wt-eng-2288`, branch `feat/eng-2288-multilingual-incidents`)

### Task A1: `resolveLocalized` helper in `@openstatus/locales`

**Files:**
- Create: `packages/locales/resolve.ts`
- Modify: `packages/locales/index.ts` (re-export)
- Test: `packages/locales/resolve.test.ts`

**Interfaces:**
- Produces: `resolveLocalized(i18n: Partial<Record<string, string>> | null | undefined, base: string, locale: string): string` — returns `i18n?.[locale]` if a non-empty string, else `base`.

- [ ] **Step 0: Wire a test runtime into `packages/locales`**

This package has no test setup today (only a `check` script; no `@std/*` devDeps). Without this, A1/A2 tests fail at module resolution, not at the assertion. Add to `packages/locales/package.json`:

```jsonc
  "scripts": {
    "check": "deno check --sloppy-imports .",
    "test": "deno test --parallel -A --no-check --sloppy-imports"
  },
  "devDependencies": {
    "@std/expect": "jsr:^1.0.19",
    "@std/testing": "jsr:^1.0.19"
    // ...keep existing devDeps
  }
```
Run: `pnpm install`. (Versions mirror the sibling packages `services`/`api`/`db`.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/locales/resolve.test.ts
import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import { resolveLocalized } from "./resolve";

describe("resolveLocalized", () => {
  test("returns the locale variant when present", () => {
    expect(resolveLocalized({ en: "Hi", pt: "Oi" }, "Hola", "en")).toBe("Hi");
  });
  test("falls back to base when locale missing", () => {
    expect(resolveLocalized({ en: "Hi" }, "Hola", "pt")).toBe("Hola");
  });
  test("falls back to base when i18n is null/undefined", () => {
    expect(resolveLocalized(null, "Hola", "en")).toBe("Hola");
    expect(resolveLocalized(undefined, "Hola", "en")).toBe("Hola");
  });
  test("falls back to base when the variant is an empty string", () => {
    expect(resolveLocalized({ en: "" }, "Hola", "en")).toBe("Hola");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openstatus/locales test -- resolve.test.ts`
Expected: FAIL — `resolve.ts` / `resolveLocalized` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/locales/resolve.ts
export function resolveLocalized(
  i18n: Partial<Record<string, string>> | null | undefined,
  base: string,
  locale: string,
): string {
  const variant = i18n?.[locale];
  return variant && variant.length > 0 ? variant : base;
}
```

```ts
// packages/locales/index.ts  — append
export { resolveLocalized } from "./resolve";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openstatus/locales test -- resolve.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/locales/resolve.ts packages/locales/resolve.test.ts packages/locales/index.ts
git commit -m "feat(locales): add resolveLocalized helper"
```

---

### Task A2: Register `es` and `pt` locales

**Files:**
- Modify: `packages/locales/index.ts`
- Test: `packages/locales/locales.test.ts`

**Interfaces:**
- Produces: `locales` now includes `"es"` and `"pt"`; `localeDetails.es`/`.pt` and `dateFnsLocales.es`/`.pt` defined.

- [ ] **Step 1: Write the failing test**

```ts
// packages/locales/locales.test.ts
import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import { dateFnsLocales, localeDetails, locales } from "./index";

describe("locales registry", () => {
  test("includes es and pt", () => {
    expect(locales).toContain("es");
    expect(locales).toContain("pt");
  });
  test("has display details for es and pt", () => {
    expect(localeDetails.es.name).toBe("Español");
    expect(localeDetails.pt.name).toBe("Português");
  });
  test("has date-fns locales for es and pt", () => {
    expect(dateFnsLocales.es).toBeDefined();
    expect(dateFnsLocales.pt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openstatus/locales test -- locales.test.ts`
Expected: FAIL — `es`/`pt` not in `locales`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/locales/index.ts  — edit the three maps
import type { Locale as DateFnsLocale } from "date-fns/locale";
import { de, enUS, es, fr, hi, ptBR, tr } from "date-fns/locale";

export const locales = ["en", "fr", "de", "tr", "hi", "es", "pt"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeDetails: Record<Locale, { name: string; flag: string }> = {
  en: { name: "English", flag: "🇺🇸" },
  fr: { name: "Français", flag: "🇫🇷" },
  de: { name: "Deutsch", flag: "🇩🇪" },
  tr: { name: "Türkçe", flag: "🇹🇷" },
  hi: { name: "हिंदी", flag: "🇮🇳" },
  es: { name: "Español", flag: "🇪🇸" },
  pt: { name: "Português", flag: "🇧🇷" },
};

export const dateFnsLocales: Record<Locale, DateFnsLocale> = {
  en: enUS,
  fr,
  de,
  tr,
  hi,
  es,
  pt: ptBR,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openstatus/locales test -- locales.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/locales/index.ts packages/locales/locales.test.ts
git commit -m "feat(locales): register es and pt"
```

---

### Task A3: Schema columns + migration + validation wiring

**Files:**
- Modify: `packages/db/src/schema/status_reports/status_reports.ts`
- Modify: `packages/db/src/schema/status_reports/validation.ts`
- Create: `packages/db/drizzle/00XX_*.sql` (generated)

**Interfaces:**
- Produces: `statusReport.titleI18n` and `statusReportUpdate.messageI18n` columns typed `Partial<Record<Locale,string>> | null`; insert/select schemas carry them as optional/nullable.

- [ ] **Step 1: Add the columns to the Drizzle table**

```ts
// packages/db/src/schema/status_reports/status_reports.ts
// add import at top:
import type { Locale } from "@openstatus/locales";

// inside statusReport table, after `title`:
    titleI18n: text("title_i18n", { mode: "json" }).$type<
      Partial<Record<Locale, string>>
    >(),

// inside statusReportUpdate table, after `message`:
    messageI18n: text("message_i18n", { mode: "json" }).$type<
      Partial<Record<Locale, string>>
    >(),
```

> Add `"@openstatus/locales": "workspace:*"` to `packages/db/package.json` dependencies if not already present, then `pnpm install`.

- [ ] **Step 2: Wire validation schemas**

```ts
// packages/db/src/schema/status_reports/validation.ts
import { locales } from "@openstatus/locales";
// ...
const localizedText = z.partialRecord(z.enum(locales), z.string()).nullish();

export const insertStatusReportSchema = createInsertSchema(statusReport, {
  status: statusReportStatusSchema,
  titleI18n: localizedText,
})
  // ...existing .extend() chain unchanged...
  .extend({
    messageI18n: localizedText, // for the initial InsertIncidentUpdate
  });

export const insertStatusReportUpdateSchema = createInsertSchema(
  statusReportUpdate,
  {
    status: statusReportStatusSchema,
    messageI18n: localizedText,
  },
).extend({
  date: z.coerce.date().optional().prefault(new Date()),
});

// createSelectSchema calls: add titleI18n / messageI18n overrides to keep the JSON typed
export const selectStatusReportSchema = createSelectSchema(statusReport, {
  status: statusReportStatusSchema,
  titleI18n: localizedText,
});
export const selectStatusReportUpdateSchema = createSelectSchema(
  statusReportUpdate,
  {
    status: statusReportStatusSchema,
    messageI18n: localizedText,
  },
);
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @openstatus/db generate`
Expected: a new `packages/db/drizzle/00XX_*.sql` containing `ALTER TABLE 'status_report' ADD 'title_i18n' text;` and `ALTER TABLE 'status_report_update' ADD 'message_i18n' text;` plus a `_journal.json` bump. **Inspect the SQL** — it must be additive ADD COLUMN only (no table rebuild that drops data).

- [ ] **Step 4: Apply to the local test DB + typecheck**

Run: `pnpm --filter @openstatus/db migrate` (with `turso dev` running)
Run: `pnpm --filter @openstatus/db exec tsc --noEmit`
Expected: migration applies; typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/status_reports/ packages/db/drizzle/ packages/db/package.json
git commit -m "feat(db): add title_i18n/message_i18n columns (additive)"
```

---

### Task A4: Service inputs + writes persist i18n

**Files:**
- Modify: `packages/services/src/status-report/schemas.ts`
- Modify: `packages/services/src/status-report/create.ts:62-88`
- Modify: `packages/services/src/status-report/add-update.ts:92-101`
- Modify: `packages/services/src/status-report/update.ts:64-66` (persist `titleI18n`)
- Test: `packages/services/src/status-report/__tests__/status-report.test.ts`

**Interfaces:**
- Consumes: `resolveLocalized` (A1), `Locale`/`locales` (A2).
- Produces: `CreateStatusReportInput.titleI18n?`, `CreateStatusReportInput.messageI18n?`, `AddStatusReportUpdateInput.messageI18n?`, `UpdateStatusReportInput.titleI18n?` — all `Partial<Record<Locale,string>> | undefined`. Writes persist them; omission ⇒ column stays `null`.

- [ ] **Step 1: Extend the service input schemas**

```ts
// packages/services/src/status-report/schemas.ts
import { locales } from "@openstatus/locales";
// ...
export const localizedTextSchema = z
  .partialRecord(z.enum(locales), z.string())
  .optional();

export const CreateStatusReportInput = z.object({
  title: z.string().min(1).max(256),
  titleI18n: localizedTextSchema,
  status: statusReportStatusSchema,
  message: z.string(),
  messageI18n: localizedTextSchema,
  date: z.coerce.date(),
  pageId: z.number().int(),
  pageComponentIds: z.array(z.number().int()).default([]),
  componentImpacts: componentImpactsSchema.optional(),
});

export const AddStatusReportUpdateInput = z.object({
  statusReportId: z.number().int(),
  status: statusReportStatusSchema,
  message: z.string(),
  messageI18n: localizedTextSchema,
  date: z.coerce.date().optional(),
  componentImpacts: componentImpactsSchema.optional(),
});

export const UpdateStatusReportInput = z.object({
  id: z.number().int(),
  title: z.string().min(1).max(256).optional(),
  titleI18n: localizedTextSchema,
  status: statusReportStatusSchema.optional(),
  pageComponentIds: z.array(z.number().int()).optional(),
});

export const ResolveStatusReportInput = z.object({
  statusReportId: z.number().int(),
  message: z.string(),
  messageI18n: localizedTextSchema,
  date: z.coerce.date().optional(),
});
```

- [ ] **Step 2: Write the failing test** (append to `__tests__/status-report.test.ts`)

```ts
test("create + add-update persist i18n maps; omission leaves null", async () => {
  await withTestTransaction(async (tx) => {
    const ctx = { ...teamCtx, db: tx } as ServiceContext;
    const created = await createStatusReport({
      ctx,
      input: {
        title: "Problemas de envío",
        titleI18n: { en: "Delivery issues", pt: "Problemas de envio" },
        status: "investigating",
        message: "Estamos investigando",
        messageI18n: { en: "We are investigating", pt: "Estamos investigando" },
        date: new Date(),
        pageId: testPageId,
        pageComponentIds: [],
      },
    });
    const report = await tx
      .select()
      .from(statusReport)
      .where(eq(statusReport.id, created.statusReport.id))
      .get();
    expect(report?.titleI18n).toEqual({
      en: "Delivery issues",
      pt: "Problemas de envio",
    });
    const upd = await tx
      .select()
      .from(statusReportUpdate)
      .where(eq(statusReportUpdate.id, created.initialUpdate.id))
      .get();
    expect(upd?.messageI18n).toEqual({
      en: "We are investigating",
      pt: "Estamos investigando",
    });

    const added = await addStatusReportUpdate({
      ctx,
      input: {
        statusReportId: created.statusReport.id,
        status: "monitoring",
        message: "Monitoreando",
        date: new Date(),
      },
    });
    const upd2 = await tx
      .select()
      .from(statusReportUpdate)
      .where(eq(statusReportUpdate.id, added.statusReportUpdate.id))
      .get();
    expect(upd2?.messageI18n).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openstatus/services test -- --filter "persist i18n"`
Expected: FAIL — `titleI18n`/`messageI18n` not written (columns null).

- [ ] **Step 4: Persist in the writes**

```ts
// create.ts — statusReport insert .values({...}) add:
        titleI18n: input.titleI18n ?? null,
// create.ts — initialUpdate insert .values({...}) add:
        messageI18n: input.messageI18n ?? null,
```

```ts
// add-update.ts — newUpdate insert .values({...}) add:
        messageI18n: input.messageI18n ?? null,
```

```ts
// update.ts — after `if (input.status !== undefined) updateValues.status = input.status;` add:
    if (input.titleI18n !== undefined) updateValues.titleI18n = input.titleI18n;
```

(`resolveStatusReport` already delegates to `addStatusReportUpdate`; add `messageI18n: input.messageI18n` to the delegated input in `resolve.ts`. `update.ts` must persist `titleI18n` — the `update_status_report` MCP tool accepts it, so silently dropping it would leave stale translations after a title edit.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openstatus/services test -- --filter "persist i18n"`
Expected: PASS.

- [ ] **Step 6: Full services suite (audit rows still green)**

Run: `pnpm --filter @openstatus/services test`
Expected: PASS (existing audit/scope cases unaffected — i18n rides in the snapshot, no redaction needed).

- [ ] **Step 7: Commit**

```bash
git add packages/services/src/status-report/
git commit -m "feat(services): persist incident i18n on create/add-update/resolve"
```

---

### Task A5: MCP agent-tools accept optional i18n

**Files:**
- Modify: `packages/services/src/agent-tools/status-report.ts`
- Test: `apps/server/src/routes/mcp/tools/tools.test.ts` (schema-shape assertion)

**Interfaces:**
- Consumes: A4 service inputs.
- Produces: `create_status_report` / `add_status_report_update` / `resolve_status_report` accept optional `titleI18n` / `messageI18n`; `update_status_report` accepts optional `titleI18n`. Base `title`/`message` stay required. Passed straight through to the service.

- [ ] **Step 1: Add the tool input fields**

```ts
// agent-tools/status-report.ts — near the top, shared shape
import { locales } from "@openstatus/locales";

const messageI18nInputShape = z
  .partialRecord(z.enum(locales), z.string())
  .optional()
  .describe(
    "Per-locale translations of `message`, keyed by locale (e.g. { en, pt }). Optional — omit for a single-language update; the base `message` renders as the fallback for any locale not provided.",
  );
const titleI18nInputShape = z
  .partialRecord(z.enum(locales), z.string())
  .optional()
  .describe(
    "Per-locale translations of `title`, keyed by locale. Optional — base `title` is the fallback.",
  );
```

Add `titleI18n: titleI18nInputShape` and `messageI18n: messageI18nInputShape` to `CreateStatusReportInputShape`; `messageI18n` to `AddStatusReportUpdateInputShape` and `ResolveStatusReportInputShape`; `titleI18n` to `UpdateStatusReportInputShape`. Thread them into each tool's `run({ ctx, input })` service call (e.g. `titleI18n: input.titleI18n`, `messageI18n: input.messageI18n`). In each `approval.summarize`, append a "Translations" line when present — use the field that tool actually has: the three content tools read `input.messageI18n`; **`update_status_report` has NO message field — its summarize must read `input.titleI18n`** (referencing `input.messageI18n` there fails `tsc`).

- [ ] **Step 2: Write the failing test**

```ts
// tools.test.ts — add this import (the file does not import the tool objects today):
import { createStatusReportTool } from "@openstatus/services/agent-tools";

// assert the create tool accepts i18n and forwards it
test("create_status_report input schema accepts titleI18n/messageI18n", () => {
  const parsed = createStatusReportTool.inputSchema.parse({
    title: "t",
    titleI18n: { en: "t-en" },
    status: "investigating",
    message: "m",
    messageI18n: { en: "m-en", pt: "m-pt" },
    pageId: 1,
    notify: false,
  });
  expect(parsed.titleI18n).toEqual({ en: "t-en" });
  expect(parsed.messageI18n).toEqual({ en: "m-en", pt: "m-pt" });
});
```

- [ ] **Step 3: Run to verify it fails, then passes after Step 1**

`apps/server`'s `test` script chains two `deno test` runs (`&&`) and needs its env-file/import-map flags, so neither `-- --filter` nor a bare `deno test <file>` works cleanly. Run the package's real suite (the new test lives in the first, non-slack run):
Run: `pnpm --filter @openstatus/server test`
Expected: FAIL before wiring (the new `accepts titleI18n` case), all green after. (For a faster local loop, temporarily narrow the suite, but the gate is the full script.)

- [ ] **Step 4: Typecheck server + services**

Run: `pnpm --filter @openstatus/services exec tsc --noEmit && pnpm --filter @openstatus/server exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/services/src/agent-tools/status-report.ts apps/server/src/routes/mcp/tools/tools.test.ts
git commit -m "feat(mcp): accept optional titleI18n/messageI18n on status-report tools"
```

---

### Task A6: Resolve locale in tRPC `get` / `getLight`

**Files:**
- Modify: `packages/api/src/router/statusPage.ts` (`get` input ~L90-99 + return ~L426; `getLight` input L445 + its return ~L515; **`getReport` input L812-813 + its return L845-846**)
- Test: `packages/api/src/router/statusPage.i18n.test.ts` (new)

**Interfaces:**
- Consumes: `resolveLocalized`, `defaultLocale` from `@openstatus/locales`; `titleI18n`/`messageI18n` present on rows (A3, returned by the relational query automatically).
- Produces: `get`/`getLight`/`getReport` accept optional `locale`; the returned `statusReports[].title` and `statusReports[].statusReportUpdates[].message` are pre-resolved to `locale ?? page.defaultLocale ?? defaultLocale`. **The raw `titleI18n`/`messageI18n` maps remain in the payload** — `createSelectSchema` auto-includes the new columns (proven by the `page.locales` precedent), so they are NOT stripped; this is harmless (the content is public in every language anyway). Only `title`/`message` are overwritten with the resolved locale. Do not attempt to omit the i18n keys — the select schema marks them present-and-nullable, so omission would fail the parse.

- [ ] **Step 1: Add `locale` to both inputs**

```ts
// get input object — add:
        locale: z.string().optional(),
// getLight input — becomes:
    .input(z.object({ slug: z.string().toLowerCase(), locale: z.string().optional() }))
// getReport input — becomes:
    .input(z.object({ slug: z.string().toLowerCase(), id: z.number(), locale: z.string().optional() }))
```

- [ ] **Step 2: Resolve before the output parse**

```ts
// top of statusPage.ts imports:
import { defaultLocale, resolveLocalized } from "@openstatus/locales";

// helper used by both procedures (module scope):
function localizeReports<
  R extends {
    title: string;
    titleI18n?: Partial<Record<string, string>> | null;
    statusReportUpdates: {
      message: string;
      messageI18n?: Partial<Record<string, string>> | null;
    }[];
  },
>(reports: R[], activeLocale: string): R[] {
  return reports.map((r) => ({
    ...r,
    title: resolveLocalized(r.titleI18n, r.title, activeLocale),
    statusReportUpdates: r.statusReportUpdates.map((u) => ({
      ...u,
      message: resolveLocalized(u.messageI18n, u.message, activeLocale),
    })),
  }));
}
```

In `get`, replace `statusReports,` in the returned object with a localized array:

```ts
      const activeLocale =
        opts.input.locale ?? _page.defaultLocale ?? defaultLocale;
      const localizedReports = localizeReports(statusReports, activeLocale);
      // ...
      return selectPublicPageSchemaWithRelation.parse({
        ..._page,
        // ...
        statusReports: localizedReports,
        // ...
      });
```

Apply the same `activeLocale` + `localizeReports(_page.statusReports, activeLocale)` in `getLight` before its return/parse.

In `getReport` (single report, L843-846), resolve before `selectStatusReportPageSchema.parse`:

```ts
      const activeLocale =
        opts.input.locale ?? _page.defaultLocale ?? defaultLocale;
      const localized = {
        ..._report,
        title: resolveLocalized(_report.titleI18n, _report.title, activeLocale),
        statusReportUpdates: _report.statusReportUpdates.map((u) => ({
          ...u,
          message: resolveLocalized(u.messageI18n, u.message, activeLocale),
        })),
      };
      return selectStatusReportPageSchema.parse(localized);
```

> The locale-agnostic markdown route (`api/markdown/[[...path]]`) also calls `getReport` (no locale) — it stays base/default by design (`match-route.ts` drops the locale segment). Accepted.

- [ ] **Step 3: Write the failing test**

Construct `ctx` + `caller` exactly as `packages/api/src/router/statusPage.e2e.test.ts` does (`const caller = edgeRouter.createCaller(ctx)`), and arrange the report with `createStatusReport` imported from the subpath `@openstatus/services/status-report` (it is NOT re-exported from the package root) against the same db. Look up the seeded status page's `slug` and `id` from `packages/db/src/seed.mts` (do not hardcode a guessed slug). Then:

```ts
// packages/api/src/router/statusPage.i18n.test.ts
test("get + getReport resolve report content by locale, base fallback", async () => {
  const { statusReport: r } = await createStatusReport({
    ctx: serviceCtx,
    input: {
      pageId: seededPageId,
      status: "investigating",
      date: new Date(),
      title: "Problemas de envío",
      titleI18n: { pt: "Problemas de envio" },
      message: "Estamos investigando",
      messageI18n: { pt: "Estamos investigando (pt)" },
      pageComponentIds: [],
    },
  });

  const pt = await caller.statusPage.get({ slug: seededSlug, locale: "pt" });
  const got = pt!.statusReports.find((x) => x.id === r.id)!;
  expect(got.title).toBe("Problemas de envio");
  expect(got.statusReportUpdates.at(-1)!.message).toBe("Estamos investigando (pt)");

  // no `de` variant -> base (es)
  const de = await caller.statusPage.get({ slug: seededSlug, locale: "de" });
  expect(de!.statusReports.find((x) => x.id === r.id)!.title).toBe("Problemas de envío");

  // getReport (detail page boundary) resolves too
  const detailPt = await caller.statusPage.getReport({ slug: seededSlug, id: r.id, locale: "pt" });
  expect(detailPt!.title).toBe("Problemas de envio");
});
```

- [ ] **Step 4: Run to verify fail → pass**

Run: `pnpm --filter @openstatus/api test -- --filter "resolve report content"`
Expected: FAIL before Step 2, PASS after. (The `--filter` string must be a substring of the test name defined in Step 3.)

- [ ] **Step 5: Full api suite + typecheck**

Run: `pnpm --filter @openstatus/api test && pnpm --filter @openstatus/api exec tsc --noEmit`
Expected: PASS (existing `statusPage.e2e`/`utils` tests unaffected — locale omitted ⇒ page default, byte-identical to before for single-language reports).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/router/statusPage.ts packages/api/src/router/statusPage.i18n.test.ts
git commit -m "feat(api): resolve incident content by locale in statusPage.get/getLight"
```

---

### Task A7: Thread active locale into every `statusPage.get`/`getLight` caller

**Files (status-page app):**
- Modify: `.../[locale]/(public)/feed/json/route.ts`
- Modify: `.../[locale]/(public)/feed/[type]/route.ts`
- Modify: `.../[locale]/(public)/llms.txt/route.ts`
- Modify: `.../[locale]/(public)/client.tsx` (client-side resolve via `useLocale()` — NOT a query change)
- Modify: `.../[locale]/(public)/events/(list)/page.tsx` (client-side resolve if it renders from the hydrated `get`)
- Modify: `.../[locale]/(public)/events/(view)/report/[id]/page.tsx` (pass `locale` to `getReport`)
- Modify: `.../[locale]/(public)/events/(view)/report/[id]/layout.tsx` (pass `locale` to the `getReport` prefetch)
- (No change: `header.tsx` renders no report content; `[domain]/layout.tsx` prefetch stays `{ slug }` so client hydration matches.)

**Interfaces:**
- Consumes: A6 (`get`/`getLight` accept `locale`).
- Produces: every caller passes the active `[locale]` route segment so render + feeds are localized.

- [ ] **Step 1: Feed routes — add `locale` from params and pass it**

```ts
// feed/json/route.ts — params gains locale, pass to BOTH get + getLight calls
export async function GET(
  _request: Request,
  props: { params: Promise<{ domain: string; locale: string }> },
) {
  const { domain, locale } = await props.params;
  // ...getLight.queryOptions({ slug: domain })  ->  ({ slug: domain, locale })
  // ...get.queryOptions({ slug: domain })        ->  ({ slug: domain, locale })
```

Apply the identical `{ slug, locale }` change in `feed/[type]/route.ts` and `llms.txt/route.ts`.

**Also extend `feed/json/route.ts` to emit per-update `componentImpacts`** — Part B's banner derives severity from them and today the feed drops them. In the `statusReportUpdates` map, add:

```ts
          componentImpacts: update.statusReportUpdateToPageComponents.map(
            (x) => ({ pageComponentId: x.pageComponentId, impact: x.impact }),
          ),
```

`statusReportUpdateToPageComponents` carries `impact` (enum `operational | degraded_performance | partial_outage | major_outage`, non-null) and is already loaded by the `get` relational query.

- [ ] **Step 2: Render callers — pass the locale**

**Client-hydrated renders resolve client-side, NOT by threading locale into the query.** The main page's `get` result is SSR-prefetched in `[domain]/layout.tsx` (ABOVE the `[locale]` segment — it only has `{ domain }`, confirmed L29/L96), then hydrated by `client.tsx`'s `useQuery(get({ slug: domain }))`. Adding `locale` to the client query would change the query key so it no longer matches the dehydrated cache → the SSR data is dropped and refetched on every visit (the file's own L65-66 comment warns about exactly this for `cardType`/`barType`). So:

- `client.tsx` (and `events/(list)/page.tsx` if it renders from the hydrated `get`): **do NOT change the query.** Resolve at render — `const locale = useLocale()` (from `next-intl`; the provider is set up in `[domain]/[locale]/layout.tsx`) and map each report `title` + update `message` through `resolveLocalized(map, base, locale)` before passing to `StatusFeed`/`StatusEvents`. The raw `titleI18n`/`messageI18n` maps are already in the payload.
- `header.tsx` renders no report content (only page title/links) — **leave unchanged.**

**Server routes and the detail page pass `locale` directly** (no client hydration, or prefetch+query both under `[locale]` — key-safe):

- `feed/json`, `feed/[type]`, `llms.txt`: pass `{ slug, locale }` to `get`.
- `events/(view)/report/[id]/page.tsx` **and its `layout.tsx`** (both under `[locale]`): pass `locale` to `statusPage.getReport.queryOptions({ id, slug, locale })` in BOTH so their keys match.

- [ ] **Step 3: Completeness check — every REPORT-RENDERING caller passes `locale`**

The report body renders only via these callers, which MUST thread `locale`: `client.tsx` + `header.tsx` (`get`), `events/(list)/page.tsx` (`getLight`/`get`), `events/(view)/report/[id]/page.tsx` + its `layout.tsx` (**`getReport`**), and `feed/json/route.ts`, `feed/[type]/route.ts`, `llms.txt/route.ts` (`get`). (Auth/gate/`manage`/`monitors`/`verify`/`unsubscribe` pages also call these procedures but never render report text, so `locale` there is optional and harmlessly defaults to the page default.)

Do NOT use `grep -v "locale"` on full paths — the `[locale]` path segment makes that filter vacuous (it hides every real call site regardless of args). Instead, sweep all THREE content procedures across the WHOLE app tree (not just `app/` — callers also live in `components/`, `hooks/`, `lib/`) and read each hit to confirm a `locale` key is present when the caller renders report `title`/`message`:
Run: `grep -rnE "statusPage\.(get|getLight|getReport)" apps/status-page/src`

Known non-report callers that appear in this sweep and need NO change (they read only `page.slug`/`customDomain`/`defaultLocale`): `components/nav/footer.tsx`, `hooks/use-pathname-prefix.ts`, `lib/alternates-metadata.ts`.

> **Accepted base-only surfaces (no `[locale]` route segment — machine/agent, not visitor HTML):** `api/status/[[...path]]/route.ts` (Statuspage-compatible `summary.json`/`incidents.json`, via `status-json.ts`) and `api/markdown/[[...path]]/route.ts` (LLM-readable `.md`, via `generators.ts`) both render report `title`/`message` (through `get` AND `getReport`) but have no locale segment. They stay base/default-locale by design — same reasoning as the markdown `getReport` note. Documented in the spec's scope boundaries; NOT a gap.
>
> Note: `apps/web` OG routes (`api/og/status/route.tsx`, `api/og/page/route.tsx`) also call these procedures without `locale`, but read only `page.title`/`page.description` (never report bodies) — accepted, no change.

- [ ] **Step 4: Typecheck + build the status-page app**

Run: `pnpm --filter @openstatus/status-page exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/status-page/src
git commit -m "feat(status-page): pass active locale to statusPage queries (render + feeds)"
```

---

### Task A8: Spanish + Portuguese chrome catalogs

**Files:**
- Create: `apps/status-page/messages/es.json`
- Create: `apps/status-page/messages/pt.json`
- Test: `apps/status-page/messages/parity.test.ts`

**Interfaces:**
- Produces: `es.json` and `pt.json` with the SAME key set as `en.json`, fully translated (no English left in values that aren't proper nouns).

- [ ] **Step 1: Write the failing parity test**

```ts
// apps/status-page/messages/parity.test.ts
import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import en from "./en.json" with { type: "json" };
import es from "./es.json" with { type: "json" };
import pt from "./pt.json" with { type: "json" };

const keys = (o: Record<string, unknown>) => Object.keys(o).sort();

describe("message catalog parity", () => {
  test("es has exactly en's keys", () => {
    expect(keys(es)).toEqual(keys(en));
  });
  test("pt has exactly en's keys", () => {
    expect(keys(pt)).toEqual(keys(en));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openstatus/status-page test -- messages/parity.test.ts`
Expected: FAIL — files missing.

- [ ] **Step 3: Create the catalogs**

Copy `en.json` to `es.json` and `pt.json`, then translate every value to Spanish / Brazilian-Portuguese respectively (keys unchanged). Keep next-intl ICU placeholders (`{name}`, `{count}`) intact. (These are UI strings like "Status", "Events", "Subscribe", "View events history", "Operational", "Degraded", etc.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openstatus/status-page test -- messages/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/status-page/messages/es.json apps/status-page/messages/pt.json apps/status-page/messages/parity.test.ts
git commit -m "feat(status-page): add es and pt chrome catalogs"
```

---

### Task A9: Fork-wide gates (lint / format / typecheck / build)

- [ ] **Step 1: Lint + format (oxlint/oxfmt — NOT Biome)**

Run (repo root): `pnpm format` (runs `oxfmt && oxlint --fix`; this is the real CI gate — there is no Biome in the repo).
Expected: clean (or auto-fixed).

- [ ] **Step 2: Typecheck + build for touched apps**

Run: `pnpm --filter @openstatus/status-page build && pnpm --filter @openstatus/server check`
Expected: status-page builds; server typechecks. (`@openstatus/server` has NO `build` script — `check` = its `deno check`.)

- [ ] **Step 3: Full test sweep of touched packages**

Run: `pnpm --filter @openstatus/locales --filter @openstatus/services --filter @openstatus/api --filter @openstatus/server test`
Expected: green.

- [ ] **Step 4: Commit any formatting**

```bash
git add -A && git commit -m "chore: oxfmt/oxlint format pass" || echo "nothing to format"
```

---

### Deployment A (post-merge, human-gated — runbook, not a code task)

1. Rebuild fork images from the merged branch: `gh workflow run docker-publish.yml --repo YaVendio/openstatus --ref <merged-ref> -f services=status-page,server`.
2. **Verify** the pushed digests match the run (ENG-2288 lesson: `git ls-remote` SHA + compare pod `imageID`).
3. Apply the additive migration to prod libSQL via the ENG-2288 out-of-band migrator over `kubectl port-forward` (server does NOT auto-migrate).
4. Re-POST the NF `server` + `status-page` deployments (same tag re-resolves the new digest).
5. Enable the switcher: `UPDATE page SET locales = '["es","en","pt"]', default_locale = 'es' WHERE slug = 'yavendio';`.
6. Smoke: `GET https://status.yavendio.com/pt/feed/json` returns pt content once a bilingual report exists; footer switcher shows Español/English/Português.

---

## Part B — web-app dashboard banner (NEW worktree, created at execution time)

> Create via `superpowers:using-git-worktrees` on the `web-app` repo, branch `feat/eng-2288-status-banner`. Gates: `ya-frontend` + `ya-implementation` + `ya-review` + `ya-brand`. Ships only AFTER Part A is live.
>
> **web-app is a standalone npm repo** (package name `yavendio`, `package-lock.json`, NOT a pnpm workspace). Run all commands from the web-app worktree dir with **npm**: `npm run test:run -- <pattern>`, `npm run lint` (`next lint`), `npm run type-check` (`tsc --noEmit`), `npm run format` (prettier). There is no `pnpm --filter web-app`.

### Task B1: Feed summary derivation util

**Files:**
- Create: `src/components/banners/status/derive-status-summary.ts`
- Test: `src/components/banners/status/derive-status-summary.test.ts`

**Interfaces:**
- Produces:
  - `type StatusSummary = { reportId: number; latestUpdateId: number; severity: "info" | "degraded" | "partial" | "major"; title: string } | null`
  - `deriveStatusSummary(feed: StatusFeedJson): StatusSummary` — picks the newest non-`resolved` report; severity from its updates' component impacts (`major_outage`>`partial_outage`>`degraded_performance`, else `info`); `title` is the (already-localized) report title.

- [ ] **Step 0: Register the banner test dir in vitest**

`web-app/vitest.config.mts` uses an explicit `test.include` allowlist; `src/components/banners/status/**` is not in it, so the new tests would report "No test files found" both before AND after implementation. Add the glob to the `test.include` array:

```ts
// vitest.config.mts — add to test.include
  "src/components/banners/status/**/*.test.{ts,tsx}",
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { deriveStatusSummary } from "./derive-status-summary";

const base = { title: "T", description: "", status: "operational", pageComponents: [], maintenances: [] };

describe("deriveStatusSummary", () => {
  it("returns null when every report is resolved", () => {
    expect(
      deriveStatusSummary({
        ...base,
        statusReports: [
          { id: 1, title: "x", status: "resolved", statusReportUpdates: [{ id: 9, status: "resolved", message: "", date: new Date().toISOString() }] },
        ],
      }),
    ).toBeNull();
  });

  it("summarizes the newest active report with its severity", () => {
    const s = deriveStatusSummary({
      ...base,
      statusReports: [
        {
          id: 2,
          title: "Problemas de envío",
          status: "investigating",
          statusReportUpdates: [
            { id: 11, status: "investigating", message: "m", date: "2026-07-15T10:00:00Z", componentImpacts: [{ pageComponentId: 1, impact: "partial_outage" }] },
          ],
        },
      ],
    });
    expect(s).toEqual({ reportId: 2, latestUpdateId: 11, severity: "partial", title: "Problemas de envío" });
  });

  it("uses the CURRENT per-component impact, not worst-ever (downgrade lowers severity)", () => {
    const s = deriveStatusSummary({
      ...base,
      statusReports: [
        {
          id: 3,
          title: "x",
          status: "monitoring",
          statusReportUpdates: [
            { id: 20, status: "investigating", message: "m", date: "2026-07-15T10:00:00Z", componentImpacts: [{ pageComponentId: 1, impact: "major_outage" }] },
            { id: 21, status: "monitoring", message: "m2", date: "2026-07-15T11:00:00Z", componentImpacts: [{ pageComponentId: 1, impact: "degraded_performance" }] },
          ],
        },
      ],
    });
    expect(s?.severity).toBe("degraded");
    expect(s?.latestUpdateId).toBe(21);
  });

  it("surfaces the WORST active report, not merely the most recently updated", () => {
    const s = deriveStatusSummary({
      ...base,
      statusReports: [
        { id: 4, title: "Caída mayor", status: "investigating", statusReportUpdates: [
          { id: 30, status: "investigating", message: "m", date: "2026-07-15T09:00:00Z", componentImpacts: [{ pageComponentId: 1, impact: "major_outage" }] },
        ] },
        { id: 5, title: "Lentitud", status: "monitoring", statusReportUpdates: [
          { id: 31, status: "monitoring", message: "m", date: "2026-07-15T12:00:00Z", componentImpacts: [{ pageComponentId: 2, impact: "degraded_performance" }] },
        ] },
      ],
    });
    expect(s?.severity).toBe("major");
    expect(s?.reportId).toBe(4);
    expect(s?.title).toBe("Caída mayor");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- derive-status-summary`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// derive-status-summary.ts
type Impact = "operational" | "degraded_performance" | "partial_outage" | "major_outage";
type Update = { id: number; status: string; message: string; date: string; componentImpacts?: { pageComponentId: number; impact: Impact }[] };
type Report = { id: number; title: string; status: string; statusReportUpdates: Update[] };
export type StatusFeedJson = { statusReports?: Report[] };

export type StatusSummary = {
  reportId: number;
  latestUpdateId: number;
  severity: "info" | "degraded" | "partial" | "major";
  title: string;
} | null;

const RANK: Record<Impact, number> = { operational: 0, degraded_performance: 1, partial_outage: 2, major_outage: 3 };
const SEVERITY = ["info", "degraded", "partial", "major"] as const;

function latestUpdate(r: Report): Update | undefined {
  return [...r.statusReportUpdates].sort(
    (a, b) => +new Date(b.date) - +new Date(a.date),
  )[0];
}

// current impact per component: the latest update (by date) naming it wins, so
// an explicit downgrade lowers severity instead of sticking at worst-ever.
function currentMaxRank(r: Report): number {
  const current = new Map<number, Impact>();
  for (const u of [...r.statusReportUpdates].sort(
    (a, b) => +new Date(a.date) - +new Date(b.date) || a.id - b.id,
  )) {
    for (const ci of u.componentImpacts ?? []) current.set(ci.pageComponentId, ci.impact);
  }
  return [...current.values()].reduce((m, impact) => Math.max(m, RANK[impact] ?? 0), 0);
}

export function deriveStatusSummary(feed: StatusFeedJson): StatusSummary {
  const active = (feed.statusReports ?? []).filter(
    (r) => r.status !== "resolved" && latestUpdate(r),
  );
  if (active.length === 0) return null;
  // surface the WORST-severity active report (ties -> most recent update) so a
  // major outage is never hidden behind a newer, less-severe concurrent incident.
  const top = active
    .map((r) => ({ r, rank: currentMaxRank(r), latest: latestUpdate(r)! }))
    .sort(
      (a, b) => b.rank - a.rank || +new Date(b.latest.date) - +new Date(a.latest.date),
    )[0];
  return {
    reportId: top.r.id,
    latestUpdateId: top.latest.id,
    severity: SEVERITY[top.rank],
    title: top.r.title,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- derive-status-summary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/banners/status/derive-status-summary.*
git commit -m "feat(banner): derive active-incident summary from status feed"
```

---

### Task B2: `StatusBanner` client component (severity + dismiss)

**Files:**
- Create: `src/components/banners/status/StatusBanner.tsx`
- Modify: `src/lang/locales/{en,es,pt}.json`
- Test: `src/components/banners/status/StatusBanner.test.tsx`

**Interfaces:**
- Consumes: `StatusSummary` (B1), `useLanguage` hook (chrome copy).
- Produces: `<StatusBanner summary={StatusSummary} />` — renders nothing when `summary` is null or when a matching dismissal exists in `localStorage` (`status-banner-dismissed:<reportId>:<latestUpdateId>:<severity>`); otherwise a severity-colored bar with the localized title, a `Ver estado` link to `https://status.yavendio.com`, and a dismiss button.

- [ ] **Step 1: Add chrome keys** to `src/lang/locales/en.json`, `es.json`, `pt.json`:

The web-app locale files are **flat, one language per file** (nested by key path, NOT by locale). Add the same key path to each file with that file's language:

```jsonc
// src/lang/locales/en.json
  "statusBanner": { "prefix": "We're experiencing issues:", "cta": "View status", "dismiss": "Dismiss" }
// src/lang/locales/es.json
  "statusBanner": { "prefix": "Estamos presentando problemas:", "cta": "Ver estado", "dismiss": "Descartar" }
// src/lang/locales/pt.json
  "statusBanner": { "prefix": "Estamos com problemas:", "cta": "Ver status", "dismiss": "Dispensar" }
```

Read an existing key (e.g. `common`) in each file first to match the exact nesting/placement.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusBanner } from "./StatusBanner";

const summary = { reportId: 2, latestUpdateId: 11, severity: "partial" as const, title: "Problemas de envío" };

afterEach(() => localStorage.clear());

// This repo has NO @testing-library/jest-dom — use plain vitest matchers
// (mirrors src/features/conversations/components/conversation-item.test.tsx).
describe("StatusBanner", () => {
  it("renders nothing when summary is null", () => {
    const { container } = render(<StatusBanner summary={null} />);
    expect(container.firstChild).toBeNull();
  });
  it("shows the localized title + status link when active", () => {
    render(<StatusBanner summary={summary} />);
    expect(screen.getByText("Problemas de envío")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://status.yavendio.com");
  });
  it("stays hidden when a matching dismissal is stored", () => {
    localStorage.setItem("status-banner-dismissed:2:11:partial", "1");
    const { container } = render(<StatusBanner summary={summary} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:run -- StatusBanner`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement** `StatusBanner.tsx` — `"use client"`, read `useLanguage()` for copy, compute `dismissKey = status-banner-dismissed:${reportId}:${latestUpdateId}:${severity}`, gate on `localStorage`, render prefix + title + external link + dismiss button that writes the key and hides. **Severity → color must use REAL web-app tokens** (`bg-warning`/`bg-orange-500` do NOT exist here): use `bg-destructive/15 text-destructive` for `major`/`partial`, and a neutral `bg-muted text-foreground` for `degraded`/`info`. Confirm/refine the exact warning token with `magic:ya-brand` in Task B4 — never invent tokens or use raw palette classes.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run -- StatusBanner`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/banners/status/StatusBanner.tsx src/components/banners/status/StatusBanner.test.tsx src/lang/locales
git commit -m "feat(banner): StatusBanner component with severity + dismiss"
```

---

### Task B3: Server fetch wrapper + mount in dashboard layout

**Files:**
- Create: `src/components/banners/status/StatusBannerServer.tsx`
- Modify: `src/app/dashboard-v2/layout.tsx`
- Test: `src/components/banners/status/status-feed-fetch.test.ts`

**Interfaces:**
- Consumes: `deriveStatusSummary` (B1), `StatusBanner` (B2), `request-locale.server` for the merchant locale.
- Produces: `<StatusBannerServer />` — server component that fetches `https://status.yavendio.com/<locale>/feed/json` with `{ next: { revalidate: 60 } }`, **fails open** (any error/timeout ⇒ returns null summary, never throws), derives the summary, and renders `<StatusBanner summary={...} />`.

- [ ] **Step 1: Write the failing test for the fetch wrapper** (pure function `fetchStatusSummary(locale, fetchImpl)`):

```ts
import { describe, expect, it, vi } from "vitest";

import { fetchStatusSummary } from "./status-feed-fetch";

describe("fetchStatusSummary", () => {
  it("returns null and never throws when the feed errors", async () => {
    const f = vi.fn().mockRejectedValue(new Error("network"));
    await expect(fetchStatusSummary("es", f)).resolves.toBeNull();
  });
  it("derives a summary from a good feed", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ statusReports: [{ id: 2, title: "Caída", status: "investigating", statusReportUpdates: [{ id: 5, status: "investigating", message: "m", date: "2026-07-15T10:00:00Z", componentImpacts: [{ pageComponentId: 1, impact: "major_outage" }] }] }] }),
    });
    const s = await fetchStatusSummary("es", f);
    expect(s?.severity).toBe("major");
    expect(s?.title).toBe("Caída");
  });
});
```

- [ ] **Step 2: Run to verify it fails** → `npm run test:run -- status-feed-fetch` (FAIL).

- [ ] **Step 3: Implement** `status-feed-fetch.ts`:

```ts
import { deriveStatusSummary, type StatusSummary } from "./derive-status-summary";

const STATUS_ORIGIN = "https://status.yavendio.com";

export async function fetchStatusSummary(
  locale: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StatusSummary> {
  try {
    // hard timeout: a hung (not down) status-page must not ride Vercel's
    // maxDuration and stall the whole dashboard request — fail open in bounded time.
    const res = await fetchImpl(`${STATUS_ORIGIN}/${locale}/feed/json`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    } as RequestInit);
    if (!res.ok) return null;
    return deriveStatusSummary(await res.json());
  } catch {
    return null; // fail open — rejection OR AbortError (timeout) both land here
  }
}
```

Then `StatusBannerServer.tsx` (server component): resolve locale via `request-locale.server`, `const summary = await fetchStatusSummary(locale)`, `return <StatusBanner summary={summary} />`.

- [ ] **Step 4: Mount** in `src/app/dashboard-v2/layout.tsx` — render `<StatusBannerServer />` at the top of the layout body (above the existing content), wrapped in `<Suspense fallback={null}>` so the fetch never delays first paint.

- [ ] **Step 5: Run to verify it passes** → `npm run test:run -- status-feed-fetch` (PASS).

- [ ] **Step 6: Commit**

```bash
git add src/components/banners/status/ src/app/dashboard-v2/layout.tsx
git commit -m "feat(banner): fail-open server fetch + mount in dashboard-v2 layout"
```

---

### Task B4: web-app gates

- [ ] **Step 1:** `magic:ya-brand` — confirm severity classes use design tokens (no raw hex/anti-slop). Fix inline.
- [ ] **Step 2:** `ya-frontend` + `ya-implementation` — RSC boundary (server fetch, client banner), no useEffect-fetch, `npm run format`.
- [ ] **Step 3:** `ya-review` after implementing — re-render/perf pass on the new components.
- [ ] **Step 4:** `npm run lint && npm run type-check && npm run test:run` — green.
- [ ] **Step 5:** Commit any fixes.

---

## Part C — `magic:status-page` skill contract

**Files (magic repo, separate worktree, branch `docs/eng-2288-status-page-i18n`):**
- Modify: `plugins/magic/skills/status-page/SKILL.md`

- [ ] **Step 1:** Add an "Authoring multilingual incidents" section: the on-call writes the incident in one language (default `es`); the skill instructs Claude to generate `en` + `pt` variants and pass `titleI18n` / `messageI18n` maps alongside the required base `title`/`message` on `create_status_report` / `add_status_report_update` / `resolve_status_report`. Document the fallback (no translation ⇒ base renders everywhere). Reiterate `notify` defaults OFF. Add a one-liner that the merchant dashboard banner surfaces active incidents automatically.
- [ ] **Step 2:** Run magic's skill guards (frontmatter audit, secret scan, skill-sync) per the magic repo's contribution flow.
- [ ] **Step 3:** Commit + open PR (human merges).

---

## Self-Review

**Spec coverage:**
- A1 Storage/fallback → A1 (helper) + A3 (columns). ✓
- A2 Write path (schema/services/MCP) → A3/A4/A5. ✓
- A3 Read path (render + feeds) → A6 (tRPC resolve) + A7 (thread locale to all render + feed callers). ✓
- A4 Locales & page config → A2 (es/pt) + A8 (catalogs) + Deployment A step 5 (SQL). ✓
- A5 Migration & deploy → A3 (generate) + Deployment A. ✓
- magic:status-page contract → Part C. ✓
- Workstream B (banner) → B1–B4. ✓
- Acceptance #1/#2 (per-locale + fallback) → A4/A6 tests. #3 (switcher/chrome) → A2/A8. #4/#5 (banner active/dismiss/fail-open) → B1/B2/B3. #6 (no secrets, green) → A9/B4. ✓

**Placeholder scan:** `00XX_*.sql` is the generator's real output name (inspected in A3 step 3), not a TBD. No other placeholders — every code step carries real code; catalog translation (A8) and severity-token mapping (B2) are bounded, reviewed tasks, not vague instructions.

**Type consistency:** `resolveLocalized(i18n, base, locale)` identical across A1/A4/A6. `titleI18n`/`messageI18n` typed `Partial<Record<Locale,string>>` in db (A3), services (A4), MCP (A5). `StatusSummary` shape identical across B1/B2/B3. `deriveStatusSummary` / `fetchStatusSummary` signatures match their consumers.

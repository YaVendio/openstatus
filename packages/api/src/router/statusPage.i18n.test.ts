import { db, eq } from "@openstatus/db";
import {
  page,
  statusReport,
  statusReportUpdate,
} from "@openstatus/db/src/schema";
import { expect } from "@std/expect";
import { afterAll, beforeAll, describe, test } from "@std/testing/bdd";

import { edgeRouter } from "../edge";
import { createInnerTRPCContext } from "../trpc";

// The page defaults to `pt` so that omitting `locale` proves the
// page.defaultLocale branch is honored, not just the base fallback.
const testSlug = "i18n-locale-test-page";
const baseTitle = "Problemas de envío";
const baseMessage = "Estamos investigando";

let testPageId: number;
let testReportId: number;

const caller = edgeRouter.createCaller(
  createInnerTRPCContext({
    req: undefined,
    session: null,
    // @ts-expect-error - minimal workspace for test
    workspace: { id: 1 },
  }),
);

beforeAll(async () => {
  await db.delete(page).where(eq(page.slug, testSlug));

  const p = await db
    .insert(page)
    .values({
      workspaceId: 1,
      title: "i18n Locale Test Page",
      description: "Page for multilingual incident content tests",
      slug: testSlug,
      customDomain: "",
      defaultLocale: "pt",
    })
    .returning()
    .get();
  testPageId = p.id;

  const r = await db
    .insert(statusReport)
    .values({
      workspaceId: 1,
      pageId: testPageId,
      status: "investigating",
      title: baseTitle,
      titleI18n: { pt: "Problemas de envio", en: "Shipping issues" },
    })
    .returning()
    .get();
  testReportId = r.id;

  await db
    .insert(statusReportUpdate)
    .values({
      statusReportId: testReportId,
      status: "investigating",
      date: new Date(),
      message: baseMessage,
      messageI18n: { pt: "Estamos investigando (pt)", en: "We are looking" },
    })
    .run();
});

afterAll(async () => {
  await db
    .delete(statusReportUpdate)
    .where(eq(statusReportUpdate.statusReportId, testReportId));
  await db.delete(statusReport).where(eq(statusReport.id, testReportId));
  await db.delete(page).where(eq(page.id, testPageId));
});

describe("resolve report content by locale", () => {
  test("getReport resolves title and message to the requested locale", async () => {
    const report = await caller.statusPage.getReport({
      slug: testSlug,
      id: testReportId,
      locale: "pt",
    });

    expect(report?.title).toBe("Problemas de envio");
    expect(report?.statusReportUpdates[0].message).toBe(
      "Estamos investigando (pt)",
    );
  });

  test("getReport falls back to base text for a locale with no variant", async () => {
    const report = await caller.statusPage.getReport({
      slug: testSlug,
      id: testReportId,
      locale: "de",
    });

    expect(report?.title).toBe(baseTitle);
    expect(report?.statusReportUpdates[0].message).toBe(baseMessage);
  });

  test("getReport uses page.defaultLocale when no locale is given", async () => {
    const report = await caller.statusPage.getReport({
      slug: testSlug,
      id: testReportId,
    });

    expect(report?.title).toBe("Problemas de envio");
  });

  test("getReport input locale overrides page.defaultLocale", async () => {
    const report = await caller.statusPage.getReport({
      slug: testSlug,
      id: testReportId,
      locale: "en",
    });

    expect(report?.title).toBe("Shipping issues");
  });

  test("getReport keeps the raw i18n maps in the payload", async () => {
    const report = await caller.statusPage.getReport({
      slug: testSlug,
      id: testReportId,
      locale: "pt",
    });

    expect(report?.titleI18n).toEqual({
      pt: "Problemas de envio",
      en: "Shipping issues",
    });
  });

  test("getLight resolves report content by locale", async () => {
    const light = await caller.statusPage.getLight({
      slug: testSlug,
      locale: "en",
    });

    const report = light?.statusReports.find((r) => r.id === testReportId);
    expect(report?.title).toBe("Shipping issues");
    expect(report?.statusReportUpdates[0].message).toBe("We are looking");
  });

  test("get resolves report content by locale", async () => {
    const full = await caller.statusPage.get({
      slug: testSlug,
      locale: "en",
    });

    const report = full?.statusReports.find((r) => r.id === testReportId);
    expect(report?.title).toBe("Shipping issues");
  });

  // getEvents copies report.title into event.name, which the banner tab
  // labels render — so it must see the resolved title, not the base one.
  test("get resolves the report title in openEvents names", async () => {
    const full = await caller.statusPage.get({
      slug: testSlug,
      locale: "en",
    });

    const event = full?.openEvents.find(
      (e) => e.type === "report" && e.id === testReportId,
    );
    expect(event?.name).toBe("Shipping issues");
  });
});

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

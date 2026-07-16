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

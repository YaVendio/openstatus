import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";

import en from "./en.json" with { type: "json" };
import es from "./es.json" with { type: "json" };
import pt from "./pt.json" with { type: "json" };

const keys = (o: Record<string, unknown>) => Object.keys(o).sort();

// Values that are legitimately identical to English — same word in the target
// language, or a proper noun / protocol name. Listed in en.json key order.
// Anything else matching en is an untranslated string.
const SHARED_ES = [
  "myq2ZL", // Normal — same word in Spanish
  "KN7zKn", // Error — same word in Spanish
  "sjzDbu", // Slack
  "q0qMyV", // RSS
  "9y9QQh", // JSON
  "waUHa4", // SSH
];

const SHARED_PT = [
  "myq2ZL", // Normal — same word in Portuguese
  "tzMNF3", // Status — standard in pt-BR
  "tKMlOc", // Menu — same word in pt-BR
  "sjzDbu", // Slack
  "q0qMyV", // RSS
  "9y9QQh", // JSON
  "waUHa4", // SSH
];

// ICU placeholders are part of the contract: a translation that drops or
// renames one silently renders a broken string.
const placeholders = (s: string) => (s.match(/\{[^}]+\}/g) ?? []).sort();

describe("message catalog parity", () => {
  test("es has exactly en's keys", () => {
    expect(keys(es)).toEqual(keys(en));
  });

  test("pt has exactly en's keys", () => {
    expect(keys(pt)).toEqual(keys(en));
  });

  test("es keeps every ICU placeholder", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders((es as Record<string, string>)[key])).toEqual(
        placeholders(value),
      );
    }
  });

  test("pt keeps every ICU placeholder", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders((pt as Record<string, string>)[key])).toEqual(
        placeholders(value),
      );
    }
  });

  test("es leaves no untranslated value", () => {
    const untranslated = Object.entries(en).filter(
      ([key, value]) => (es as Record<string, string>)[key] === value,
    );
    expect(untranslated.map(([k]) => k)).toEqual(SHARED_ES);
  });

  test("pt leaves no untranslated value", () => {
    const untranslated = Object.entries(en).filter(
      ([key, value]) => (pt as Record<string, string>)[key] === value,
    );
    expect(untranslated.map(([k]) => k)).toEqual(SHARED_PT);
  });
});

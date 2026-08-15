import { expect } from "@std/expect";
import { describe, test } from "@std/testing/bdd";
import { JSONPath } from "jsonpath-plus";

import { JsonBodyAssertion } from "./v1";

const PAYLOAD = {
  store: {
    book: [
      { title: "Sayings of the Century", price: 8.95 },
      { title: "Sword of Honour", price: 12.99 },
    ],
  },
  status: "ok",
  blank: "",
};

const BODY = JSON.stringify(PAYLOAD);

const COMPARES = [
  "contains",
  "not_contains",
  "eq",
  "not_eq",
  "empty",
  "not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;

function assertJson(
  path: string,
  compare: (typeof COMPARES)[number],
  target: string,
) {
  return new JsonBodyAssertion({
    version: "v1",
    type: "jsonBody",
    path,
    compare,
    target,
  }).assert({ body: BODY, header: {}, status: 200 });
}

function assertContains(path: string, target: string) {
  return assertJson(path, "contains", target);
}

describe("JsonBodyAssertion - path evaluation", () => {
  test("resolves plain paths", () => {
    expect(assertContains("$.status", "ok").success).toBe(true);
    expect(
      assertContains("$.store.book[0].title", "Sayings of the Century").success,
    ).toBe(true);
  });

  // jsonpath-plus >= 10 evaluates these in a sandboxed VM instead of eval. Guards
  // against the sandbox dropping expression support that users depend on.
  test("still evaluates filter and script expressions", () => {
    expect(
      assertContains(
        "$.store.book[?(@.price < 10)].title",
        "Sayings of the Century",
      ).success,
    ).toBe(true);
    expect(
      assertContains("$.store.book[(@.length-1)].title", "Sword of Honour")
        .success,
    ).toBe(true);
  });
});

describe("JsonBodyAssertion - a path that matches nothing", () => {
  // The regression this guards: JSONPath returns [], evaluateString compared that
  // array against a string, and five of the ten comparators reported success.
  test("fails for every comparator", () => {
    for (const compare of COMPARES) {
      expect(assertJson("$.doesNotExist", compare, "x").success).toBe(false);
    }
  });

  test("blames the path, not the value", () => {
    expect(assertJson("$.doesNotExist", "not_empty", "").message).toContain(
      "matched nothing",
    );
  });
});

describe("JsonBodyAssertion - comparators over the matched values", () => {
  test("eq matches a scalar", () => {
    expect(assertJson("$.status", "eq", "ok").success).toBe(true);
    expect(assertJson("$.status", "eq", "nope").success).toBe(false);
  });

  test("contains is a substring test, not element equality", () => {
    expect(
      assertJson("$.store.book[0].title", "contains", "Century").success,
    ).toBe(true);
  });

  test("compares a non-string match by its JSON text", () => {
    expect(assertJson("$.store.book[0].price", "eq", "8.95").success).toBe(
      true,
    );
  });

  test("empty and not_empty follow the matched value", () => {
    expect(assertJson("$.blank", "empty", "").success).toBe(true);
    expect(assertJson("$.blank", "not_empty", "").success).toBe(false);
    expect(assertJson("$.status", "not_empty", "").success).toBe(true);
  });

  test("a presence assertion is satisfied by any match", () => {
    expect(
      assertJson("$.store.book[*].title", "eq", "Sword of Honour").success,
    ).toBe(true);
  });

  test("an absence assertion must hold for every match", () => {
    expect(
      assertJson("$.store.book[*].title", "not_eq", "Sword of Honour").success,
    ).toBe(false);
    expect(
      assertJson("$.store.book[*].title", "not_eq", "Missing Title").success,
    ).toBe(true);
  });
});

// CVE-2024-21534 / CVE-2025-1302: on jsonpath-plus < 10 this expression built and
// ran a function, giving RCE from a user-supplied assertion path. Asserted against
// the library because JsonBodyAssertion catches the throw -- both versions return
// success:false there, so only this level tells fixed apart from vulnerable.
describe("jsonpath-plus - expression sandbox", () => {
  test("a path expression cannot construct a function", () => {
    expect(() =>
      JSONPath({
        path: "$..[?(@.constructor.constructor('return 1+1')())]",
        json: PAYLOAD,
      }),
    ).toThrow();
  });
});

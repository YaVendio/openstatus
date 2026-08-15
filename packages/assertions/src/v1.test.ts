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
};

const BODY = JSON.stringify(PAYLOAD);

// `contains`, not `eq`: JSONPath returns an array of matches, and evaluateString
// compares it by identity, so `eq` cannot match a scalar target here.
function assertContains(path: string, target: string) {
  return new JsonBodyAssertion({
    version: "v1",
    type: "jsonBody",
    path,
    compare: "contains",
    target,
  }).assert({ body: BODY, header: {}, status: 200 });
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

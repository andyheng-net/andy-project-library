import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJson } from "./parseModelJson.ts";

test("parses plain JSON", () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
});

test("strips a <think> reasoning block before parsing", () => {
  const content = '<think>reasoning about the answer</think>{"a":1}';
  assert.deepEqual(parseModelJson(content), { a: 1 });
});

test("strips a markdown code fence", () => {
  const content = '```json\n{"a":1}\n```';
  assert.deepEqual(parseModelJson(content), { a: 1 });
});

test("falls back to brace-matching when the JSON is surrounded by prose", () => {
  const content = 'Sure, here is the answer: {"a":1} - hope that helps!';
  assert.deepEqual(parseModelJson(content), { a: 1 });
});

test("throws a descriptive error when nothing parses", () => {
  assert.throws(() => parseModelJson("not json at all"), /Could not parse JSON/);
});

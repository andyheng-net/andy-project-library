import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSupabaseSchema } from "./schema.ts";

test("defaults to public when NEXT_PUBLIC_SUPABASE_SCHEMA is unset", () => {
  const orig = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
  delete process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
  try {
    assert.equal(resolveSupabaseSchema(), "public");
  } finally {
    if (orig !== undefined) process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = orig;
  }
});

test("defaults to public when NEXT_PUBLIC_SUPABASE_SCHEMA is an empty string", () => {
  const orig = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
  process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = "";
  try {
    assert.equal(resolveSupabaseSchema(), "public");
  } finally {
    if (orig === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
    else process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = orig;
  }
});

test("uses the configured schema when set", () => {
  const orig = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
  process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = "dev";
  try {
    assert.equal(resolveSupabaseSchema(), "dev");
  } finally {
    if (orig === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
    else process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = orig;
  }
});

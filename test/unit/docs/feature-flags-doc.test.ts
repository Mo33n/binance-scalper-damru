import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ZodObject, ZodRawShape } from "zod";
import { featuresSchema, quotingSchema, rolloutSchema } from "../../../src/config/schema.js";

/**
 * SPEC-10 T03 — `docs/architecture/feature-flags.md` must list every key in the Zod slices
 * that the doc claims to cover (`features`, `quoting`, `rollout`).
 */
function zodObjectKeys(schema: ZodObject<ZodRawShape>): string[] {
  return Object.keys(schema.shape);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const featureFlagsDoc = readFileSync(
  resolve(__dirname, "../../../docs/architecture/feature-flags.md"),
  "utf8",
);

describe("docs/architecture/feature-flags.md vs schema (SPEC-10 T03)", () => {
  it("includes a row for every featuresSchema key", () => {
    for (const key of zodObjectKeys(featuresSchema)) {
      expect(featureFlagsDoc).toContain(`features.${key}`);
    }
  });

  it("includes a row for every quotingSchema key", () => {
    for (const key of zodObjectKeys(quotingSchema)) {
      expect(featureFlagsDoc).toContain(`quoting.${key}`);
    }
  });

  it("includes a row for every rolloutSchema key", () => {
    for (const key of zodObjectKeys(rolloutSchema)) {
      expect(featureFlagsDoc).toContain(`rollout.${key}`);
    }
  });
});

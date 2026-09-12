/**
 * @pgegypt/publish tests — hashFiles determinism + validateAssembledFiles.
 * (assembleContent DB integration is covered by apps/api/tests/publish.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { hashFiles, hashFilesSync } from "../src/target.js";
import { validateAssembledFiles } from "../src/assemble.js";

const VALID_SITE_CONFIG = {
  event: {
    name: "PG Day Egypt 2026",
    tagline: "Egypt's first PostgreSQL community conference",
    date: "2026-10-10",
    dateDisplay: "Saturday, October 10, 2026",
    city: "Cairo, Egypt",
    venueStatus: "tba",
    venueName: null,
    venueAddress: null,
    timezone: "Africa/Cairo",
  },
  organizer: {
    name: "PostgreSQL Egypt User Group",
    contactEmail: "organizers@pgegypt.org",
  },
  features: {
    showSponsors: true,
    showCountdown: true,
  },
  social: {
    twitter: "https://twitter.com/pgegypt",
    linkedin: "https://linkedin.com/company/pgegypt",
    youtube: null,
  },
  registration: {
    open: true,
    closedMessage: "",
  },
};

describe("hashFiles (§16)", () => {
  it("is deterministic and order-independent", async () => {
    const a = { "b.json": { x: 1 }, "a.json": { y: 2 } };
    const b = { "a.json": { y: 2 }, "b.json": { x: 1 } };
    expect(await hashFiles(a)).toBe(await hashFiles(b));
    expect(hashFilesSync(a)).toBe(hashFilesSync(b));
  });

  it("changes when content changes", async () => {
    const h1 = await hashFiles({ "site-config.json": { event: { name: "x" } } });
    const h2 = await hashFiles({ "site-config.json": { event: { name: "y" } } });
    expect(h1).not.toBe(h2);
  });
});

describe("validateAssembledFiles (§16)", () => {
  it("accepts a well-formed snapshot", () => {
    const res = validateAssembledFiles({
      "site-config.json": VALID_SITE_CONFIG,
      "speakers.json": [],
      "schedule.json": [],
      "sponsors.json": [],
      "organizers.json": [],
      "faq.json": [],
    });
    expect(res.ok).toBe(true);
  });

  it("rejects malformed site-config", () => {
    const res = validateAssembledFiles({ "site-config.json": { not: "the right shape" } });
    expect(res.ok).toBe(false);
  });
});

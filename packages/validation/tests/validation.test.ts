/**
 * @pgegypt/validation tests — Zod boundary schemas for registration + CFP.
 * Pure unit tests, no I/O.
 */
import { describe, it, expect } from "vitest";
import { RegistrationSchema, normalizeRegistrationPayload } from "../src/registration.js";
import { CfpSubmissionSchema, normalizeCfpPayload } from "../src/cfp.js";

describe("RegistrationSchema (§18)", () => {
  it("accepts a valid registration payload", () => {
    const res = RegistrationSchema.safeParse({
      name: "Sara Ahmed",
      email: "sara@example.com",
      organization: "Acme",
      role: "engineer",
      dietaryNotes: "vegan",
      consent: true,
    });
    expect(res.success).toBe(true);
  });

  it("rejects missing name, bad email, or missing consent", () => {
    expect(RegistrationSchema.safeParse({ email: "x@y.com", consent: true }).success).toBe(false);
    expect(
      RegistrationSchema.safeParse({ name: "Sara", email: "not-an-email", consent: true }).success
    ).toBe(false);
    expect(RegistrationSchema.safeParse({ name: "Sara", email: "x@y.com" }).success).toBe(false);
  });

  it("normalizeRegistrationPayload trims and lowercases email", () => {
    const payload = RegistrationSchema.parse({
      name: "  Sara Ahmed  ",
      email: "Sara@Example.COM",
      consent: true,
    });
    const norm = normalizeRegistrationPayload(payload);
    expect(norm.name).toBe("Sara Ahmed");
    expect(norm.email).toBe("sara@example.com");
  });
});

describe("CfpSubmissionSchema (§19)", () => {
  it("accepts a valid CFP submission with co-speakers", () => {
    const res = CfpSubmissionSchema.safeParse({
      title: "Postgres Internals",
      abstract: "A deep dive into B-Tree indexes.",
      track: "postgres-internals",
      level: "intermediate",
      submitterName: "Alice",
      submitterEmail: "alice@example.com",
      submitterBio: "DBA for 5 years.",
      coSpeakers: [{ name: "Bob", email: "bob@example.com", bio: "Engineer." }],
    });
    expect(res.success).toBe(true);
  });

  it("rejects missing title/abstract/submitter", () => {
    expect(
      CfpSubmissionSchema.safeParse({ submitterName: "A", submitterEmail: "a@b.com" }).success
    ).toBe(false);
    expect(
      CfpSubmissionSchema.safeParse({
        title: "T",
        abstract: "A",
        submitterName: "A",
        submitterEmail: "bad-email",
      }).success
    ).toBe(false);
  });

  it("normalizeCfpPayload trims and lowercases submitter email", () => {
    const payload = CfpSubmissionSchema.parse({
      title: "  Postgres Internals  ",
      abstract: "A comprehensive deep dive into PostgreSQL internals and query planning.",
      submitterName: "  Alice  ",
      submitterEmail: "Alice@Example.COM",
      submitterBio: "Bio",
    });
    const norm = normalizeCfpPayload(payload);
    expect(norm.title).toBe("Postgres Internals");
    expect(norm.submitterEmail).toBe("alice@example.com");
  });
});

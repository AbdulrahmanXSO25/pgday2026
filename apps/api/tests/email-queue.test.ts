import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLocalQueue } from "@pgegypt/queue";
import { createMaildevMailer } from "@pgegypt/mail";
import { createResendMailer } from "@pgegypt/mail";
import { buildThankYouEmail, buildCfpStatusEmail } from "@pgegypt/mail";
import { createEmailConsumer, handleEmailJob } from "../src/jobs/emailConsumer.js";
import type { EmailJob } from "@pgegypt/queue";
import { createApp } from "../src/app.js";
import { formatLogLine, createLogger } from "../src/lib/logger.js";

describe("Email + queue — §25", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("local queue enqueue→consume delivers message async", async () => {
    const queue = createLocalQueue<EmailJob>();
    const received: EmailJob[] = [];

    queue.process(async (msg) => {
      received.push(msg.payload);
    });

    const job: EmailJob = {
      type: "registration_thank_you",
      to: "alice@example.com",
      name: "Alice",
      idempotencyKey: "test-key-1",
    };

    const id = await queue.enqueue(job, { idempotencyKey: job.idempotencyKey });
    expect(id).toBe("test-key-1");

    // Wait microtask
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ to: "alice@example.com", name: "Alice" });
  });

  it("local queue idempotency prevents double consume", async () => {
    const queue = createLocalQueue<string>();
    let count = 0;
    queue.process(async () => {
      count += 1;
    });

    await queue.enqueue("hello", { idempotencyKey: "dup-key" });
    await queue.enqueue("hello", { idempotencyKey: "dup-key" });
    await new Promise((r) => setTimeout(r, 10));
    expect(count).toBe(1);
  });

  it("maildev mailer uses injected transport (Maildev SMTP mocked) and respects idempotency", async () => {
    const sent: string[] = [];
    const transport = vi.fn(async (payload: { to: string }) => {
      sent.push(payload.to);
      return { ok: true as const, id: "mock-id" };
    });

    const mailer = createMaildevMailer({
      transport: transport as unknown as (
        p: import("@pgegypt/mail").MailPayload
      ) => Promise<import("@pgegypt/mail").MailResult>,
    });

    const r1 = await mailer.send({
      to: "bob@example.com",
      subject: "Hi",
      html: "<p>hi</p>",
      idempotencyKey: "mail-key-1",
    });
    expect(r1.ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);

    const r2 = await mailer.send({
      to: "bob@example.com",
      subject: "Hi",
      html: "<p>hi</p>",
      idempotencyKey: "mail-key-1",
    });
    expect(r2.ok).toBe(true);
    // Second send deduped — transport not called again
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(["bob@example.com"]);
  });

  it("resend mailer uses fetch mock and sends Idempotency-Key header", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "re_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const mailer = createResendMailer({
      apiKey: "re_test_123",
      from: "PG Day <noreply@pgegypt.org>",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const res = await mailer.send({
      to: "carol@example.com",
      subject: "Welcome",
      html: "<p>welcome</p>",
      text: "welcome",
      idempotencyKey: "idem-abc",
    });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idem-abc");
    expect(headers.Authorization).toBe("Bearer re_test_123");

    // Second send same key is deduped locally — fetch not called again
    await mailer.send({
      to: "carol@example.com",
      subject: "Welcome",
      html: "<p>welcome</p>",
      idempotencyKey: "idem-abc",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resend mailer redacts api key on failure and never logs secret", async () => {
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const mailer = createResendMailer({
      apiKey: "re_secret_999",
      from: "PG Day <noreply@pgegypt.org>",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const res = await mailer.send({
      to: "dave@example.com",
      subject: "test",
      html: "<p>hi</p>",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toContain("re_secret_999");
    }
  });

  it("templates: thank-you builds subject/html/text with safe escaping", () => {
    const tpl = buildThankYouEmail({ name: "Eve <script>", siteUrl: "https://pgegypt.org" });
    expect(tpl.subject).toContain("registered");
    expect(tpl.html).toContain("Eve");
    expect(tpl.html).not.toContain("<script>");
    expect(tpl.text).toContain("Eve <script>");
    expect(tpl.html).toContain("https://pgegypt.org/schedule");
  });

  it("templates: CFP status builds correct subject per status and escapes title", () => {
    const accepted = buildCfpStatusEmail({
      name: "Frank",
      title: "Postgres <b>rocks</b>",
      status: "accepted",
      siteUrl: "https://pgegypt.org",
    });
    expect(accepted.subject).toContain("accepted");
    expect(accepted.html).not.toContain("<b>rocks</b>");
    expect(accepted.html).toContain("Postgres");

    const rejected = buildCfpStatusEmail({
      name: "Frank",
      title: "Talk",
      status: "rejected",
      siteUrl: "https://pgegypt.org",
      feedback: "Nice <try> again",
    });
    expect(rejected.subject.toLowerCase()).toContain("update");
    expect(rejected.html).not.toContain("<try>");
  });

  it("emailConsumer handles registration and CFP jobs via queue", async () => {
    const sent: Array<{ to: string; subject: string }> = [];
    const mailer = {
      send: vi.fn(async (p: { to: string; subject: string }) => {
        sent.push({ to: p.to, subject: p.subject });
        return { ok: true as const };
      }),
    };

    const queue = createLocalQueue<EmailJob>();
    const consumer = createEmailConsumer({
      mailer: mailer as unknown as import("@pgegypt/mail").Mailer,
      siteUrl: "https://pgegypt.org",
    });
    queue.process(consumer);

    await queue.enqueue(
      { type: "registration_thank_you", to: "gina@example.com", name: "Gina", requestId: "req-1" },
      { idempotencyKey: "gina-reg" }
    );
    await queue.enqueue(
      {
        type: "cfp_status",
        to: "hank@example.com",
        name: "Hank",
        title: "My Talk",
        status: "accepted",
        requestId: "req-2",
      },
      { idempotencyKey: "hank-cfp" }
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe("gina@example.com");
    expect(sent[1].subject.toLowerCase()).toContain("accepted");
    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  it("handleEmailJob pure function works without queue", async () => {
    const mailer = { send: vi.fn(async () => ({ ok: true as const, id: "m1" })) };
    const res = await handleEmailJob(
      { type: "registration_thank_you", to: "iris@example.com", name: "Iris" },
      mailer as unknown as import("@pgegypt/mail").Mailer,
      "https://pgegypt.org"
    );
    expect(res.ok).toBe(true);
    expect(mailer.send).toHaveBeenCalledOnce();
  });

  it("secure headers present in API responses", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBeTruthy();
  });

  it("observability: requestId propagated and logs are redacted", async () => {
    const app = createApp();
    const customId = "obs-test-req-123";
    const res = await app.request("/health", { headers: { "X-Request-Id": customId } });
    expect(res.headers.get("X-Request-Id")).toBe(customId);
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(customId);

    // Logger redacts email and secrets
    const line = formatLogLine("info", "test", {
      requestId: customId,
      email: "secret@example.com",
      api_key: "sk_live_999",
      to: "user@domain.com",
    });
    const parsed = JSON.parse(line) as Record<string, string>;
    expect(parsed.email).not.toBe("secret@example.com");
    expect(parsed.email).toContain("***");
    expect(parsed.api_key).toBe("***REDACTED***");
    expect(parsed.requestId).toBe(customId);

    // createLogger includes requestId in every line
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg: string) => logs.push(msg));
    const log = createLogger("req-xyz", ["info", "warn", "error", "debug"]);
    log.info("hello", { email: "a@b.com" });
    expect(logs[0]).toContain("req-xyz");
    expect(logs[0]).not.toContain("a@b.com");
    spy.mockRestore();
  });

  it("no secrets in repo — mailer requires env injection, no hardcoded keys", async () => {
    // Resend mailer throws if apiKey missing — never falls back to hardcoded
    expect(() => createResendMailer({ apiKey: "", from: "x@y.com" })).toThrow();
    // Maildev does not require secret — uses env/localhost defaults
    const m = createMaildevMailer();
    const r = await m.send({ to: "test@example.com", subject: "s", html: "<p>h</p>" });
    expect(r.ok).toBe(true);
  });
});

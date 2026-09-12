/**
 * §33.6 — post-deploy smoke check. Fails loudly if the deployed app is broken.
 * Usage: node scripts/post-deploy-smoke.mjs <kind> <base-url>
 *   kind: api | pages
 */
const [kind, baseUrl] = process.argv.slice(2);
if (!kind || !baseUrl) {
  console.error("usage: node scripts/post-deploy-smoke.mjs <api|pages> <base-url>");
  process.exit(2);
}

async function check(name, fn) {
  try {
    const ok = await fn();
    console.log(`[smoke] ✓ ${name}`);
    return ok;
  } catch (err) {
    console.error(`[smoke] ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

let allOk = true;

if (kind === "api") {
  allOk = (await check("health", async () => {
    const res = await fetch(`${baseUrl}/v1/health`);
    if (res.status !== 200) throw new Error(`health HTTP ${res.status}`);
    const body = await res.json();
    if (body?.status !== "ok") throw new Error(`health body: ${JSON.stringify(body)}`);
    return true;
  })) && allOk;

  allOk = (await check("CORS preflight (register)", async () => {
    const res = await fetch(`${baseUrl}/v1/registrations`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://pgegypt-public-web.pages.dev",
        "Access-Control-Request-Method": "POST",
      },
    });
    if (res.status !== 204 && res.status !== 200) throw new Error(`preflight HTTP ${res.status}`);
    if (!res.headers.get("access-control-allow-origin")) throw new Error("missing ACAO header");
    return true;
  })) && allOk;
} else if (kind === "pages") {
  allOk = (await check("index 200", async () => {
    const res = await fetch(baseUrl);
    if (res.status !== 200) throw new Error(`index HTTP ${res.status}`);
    return true;
  })) && allOk;
} else {
  console.error(`[smoke] unknown kind: ${kind}`);
  process.exit(2);
}

if (!allOk) {
  console.error("[smoke] FAILED — deployment is broken");
  process.exit(1);
}
console.log("[smoke] all checks passed");

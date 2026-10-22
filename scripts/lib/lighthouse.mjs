/**
 * Shared by scripts/audit-coverage.mjs and scripts/audit-url.mjs: a storefront session that
 * survives a password gate, and a Lighthouse CLI runner that carries it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** Absorb Set-Cookie headers into a jar; Shopify keeps the password + preview session in HttpOnly cookies. */
export function cookieJar() {
  const jar = new Map();
  return {
    absorb(res) {
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

/** GET with manual redirect-following so every hop's cookies are kept (`redirect: "follow"` drops them). */
export async function follow(jar, url, hops = 6) {
  let status = 0;
  for (let i = 0; i < hops; i++) {
    const res = await fetch(url, { redirect: "manual", headers: { cookie: jar.header() } });
    jar.absorb(res);
    status = res.status;
    if (status < 300 || status >= 400) return { status, url, res };
    url = new URL(res.headers.get("location"), url).href;
  }
  return { status, url };
}

/** Log in through the storefront password form. Returns false when the page still gates afterwards (one retry — Shopify answers a quick second POST with 429/500). */
export async function unlock(jar, base, password, attempt = 1) {
  jar.absorb(await fetch(`${base}/password`, { redirect: "manual" }));
  const res = await fetch(`${base}/password`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ form_type: "storefront_password", utf8: "✓", password }),
  });
  jar.absorb(res);
  const probe = await fetch(`${base}/`, { redirect: "manual", headers: { cookie: jar.header() } });
  if (probe.status === 200) return true;
  if (attempt >= 2) return false;
  await new Promise((r) => setTimeout(r, 3000));
  return unlock(jar, base, password, attempt + 1);
}

export class EmptyRenderError extends Error {}

/**
 * One Lighthouse CLI run → parsed JSON. `npx -y lighthouse` so no devDependency is pinned.
 * A page that paints nothing throws EmptyRenderError (a result, not a crash); a dead headless
 * Chrome is retried once.
 */
export function lighthouse(url, { cookie, categories, mobile = true, blocked = [], file, attempt = 1 }) {
  const args = [
    "-y",
    "lighthouse",
    url,
    `--only-categories=${categories.join(",")}`,
    "--output=json",
    `--output-path=${file}`,
    "--chrome-flags=--headless=new",
    "--quiet",
    ...(mobile ? [] : ["--preset=desktop"]),
    ...(cookie ? [`--extra-headers=${JSON.stringify({ Cookie: cookie })}`] : []),
    ...blocked.map((p) => `--blocked-url-patterns=${p}`),
  ];
  try {
    execFileSync("npx", args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/did not paint any content/.test(msg)) throw new EmptyRenderError("page painted nothing");
    if (attempt >= 2) throw new Error(`lighthouse failed twice: ${msg.trim().split("\n").slice(-3).join(" · ")}`);
    return lighthouse(url, { cookie, categories, mobile, blocked, file, attempt: attempt + 1 });
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** The numbers every report wants from one run. */
export function metrics(r) {
  const a = r.audits;
  const out = {
    a11y: r.categories.accessibility ? Math.round(r.categories.accessibility.score * 100) : undefined,
    a11yFails: r.categories.accessibility
      ? Object.entries(a)
          .filter(
            ([id, x]) =>
              r.categories.accessibility.auditRefs.some((ref) => ref.id === id) &&
              x.score !== null &&
              x.score < 1 &&
              x.scoreDisplayMode !== "informative"
          )
          .map(([id, x]) => ({
            id,
            count: x.details?.items?.length || 0,
            sample: (x.details?.items?.[0]?.node?.snippet || "").replace(/\s+/g, " ").slice(0, 120),
          }))
      : [],
  };
  if (r.categories.performance) {
    const b = a["lcp-breakdown-insight"]?.details?.items || [];
    const phases = Object.fromEntries((b[0]?.items || []).map((i) => [i.subpart, Math.round(i.duration)]));
    Object.assign(out, {
      perf: Math.round(r.categories.performance.score * 100),
      lcp: a["largest-contentful-paint"]?.numericValue,
      cls: a["cumulative-layout-shift"]?.numericValue,
      tbt: a["total-blocking-time"]?.numericValue,
      lcpRenderDelay: phases.elementRenderDelay,
      lcpElement: (b[1]?.snippet || "").replace(/\s+/g, " ").slice(0, 100),
      renderBlocking: (a["render-blocking-insight"]?.details?.items || []).map(
        (i) => i.url.split("/").pop().split("?")[0]
      ),
    });
  }
  return out;
}

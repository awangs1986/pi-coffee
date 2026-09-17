import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const webBase = required("PI_COFFEE_SMOKE_WEB_URL").replace(/\/$/, "");
const giteaOrigin = new URL(required("PI_COFFEE_GITEA_URL")).origin;
const login = required("PI_COFFEE_GITEA_TEST_USER");
const password = required("PI_COFFEE_GITEA_TEST_PASSWORD");
const routesPath = required("PI_COFFEE_ROUTES_FILE");
const originalRoutes = await readFile(routesPath, "utf8");
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const authTrace = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (["/auth/login", "/auth/callback", "/login/oauth/authorize", "/login/oauth/access_token"].includes(url.pathname)) {
      authTrace.push({ origin: url.origin, path: url.pathname, status: response.status() });
    }
  });
  const before = await page.request.get(`${webBase}/api/me`);
  if (before.status() !== 401) throw new Error(`anonymous /api/me returned ${before.status()}`);

  await loginThroughGitea(page, authTrace);
  const first = await apiMe(page);
  const sessionCookie = (await context.cookies(webBase)).find((entry) => entry.name === "coffee_session");
  if (!sessionCookie?.httpOnly || sessionCookie.sameSite !== "Lax") {
    throw new Error("session cookie is missing HttpOnly or SameSite=Lax");
  }

  await writeFile(routesPath, "{}", "utf8");
  const revoked = await page.evaluate(async () => (await fetch("/api/me")).status);
  if (revoked !== 401) throw new Error(`route revocation returned ${revoked}`);
  await writeFile(routesPath, originalRoutes, "utf8");

  await loginThroughGitea(page, authTrace);
  const second = await apiMe(page);
  if (second.id !== first.id || second.login !== first.login) throw new Error("re-login identity changed");
  const logout = await page.evaluate(async () => (await fetch("/auth/logout", { method: "POST" })).status);
  if (logout !== 204) throw new Error(`logout returned ${logout}`);
  const afterLogout = await page.evaluate(async () => (await fetch("/api/me")).status);
  if (afterLogout !== 401) throw new Error(`logged-out /api/me returned ${afterLogout}`);

  console.log(JSON.stringify({
    ok: true,
    identity: { id: first.id, login: first.login },
    anonymousStatus: before.status(),
    cookie: { httpOnly: true, sameSite: "Lax", secure: sessionCookie.secure },
    routeRevocationStatus: revoked,
    logoutStatus: logout,
    afterLogoutStatus: afterLogout,
  }, null, 2));
} finally {
  await writeFile(routesPath, originalRoutes, "utf8").catch(() => undefined);
  await browser.close();
}

async function loginThroughGitea(page, authTrace) {
  await page.goto(`${webBase}/auth/login`, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).origin === giteaOrigin && /\/user\/login|\/login\/sign_in/.test(page.url())) {
    await page.locator('input[name="user_name"], input[name="username"]').fill(login);
    const passwordInput = page.locator('input[name="password"]');
    await passwordInput.fill(password);
    await passwordInput.press("Enter");
  }
  if (new URL(page.url()).origin === giteaOrigin) {
    const approve = page.locator('button[name="granted"][value="true"], button:has-text("Authorize"), button:has-text("授权")').first();
    if (await approve.isVisible({ timeout: 10_000 }).catch(() => false)) await approve.click();
  }
  try {
    await page.waitForURL((url) => url.origin === new URL(webBase).origin && url.pathname === "/", { timeout: 30_000 });
  } catch {
    const current = new URL(page.url());
    throw new Error(`OAuth did not return to the Web root; current=${current.origin}${current.pathname}; trace=${JSON.stringify(authTrace)}`);
  }
  await page.waitForLoadState("domcontentloaded");
}

async function apiMe(page) {
  const response = await page.evaluate(async () => {
    const value = await fetch("/api/me");
    return { status: value.status, body: value.ok ? await value.json() : undefined };
  });
  if (response.status !== 200 || !response.body?.id || !response.body?.login) {
    throw new Error(`authenticated /api/me returned ${response.status}`);
  }
  return response.body;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

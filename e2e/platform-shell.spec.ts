import { expect, test, type Page } from "@playwright/test";

test("platform shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Investigation Intelligence Platform" }),
  ).toBeVisible();
});

for (const product of ["SHADOW", "ECHO", "SPECTRA"] as const) {
  test(`${product} route requires authentication`, async ({ page }) => {
    await page.goto(`/${product.toLowerCase()}`);
    await expect(
      page.getByRole("heading", { name: "Sign in to your Workspace" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login\?/);
  });
}

const workspaceId = "01900000-0000-7000-8000-000000000001";
const secondWorkspaceId = "01900000-0000-7000-8000-000000000002";
const caseId = "01900000-0000-7000-8000-000000000003";
const fixture = "http://127.0.0.1:43101";
const selectedUrl = `/shadow?workspaceId=${workspaceId}&caseId=${caseId}`;
async function login(page: Page, target = selectedUrl, role = "owner") {
  await page.goto(`${fixture}/__fixture/role?role=${role}`);
  await page.goto(target);
  await page.getByRole("link", { name: /Continue with organization SSO/ }).click();
  await expect(page.getByRole("heading", { name: "SHADOW", exact: true })).toBeVisible();
}
async function control(page: Page, mode: string) {
  const session = await (await page.request.get("/api/platform/session")).json();
  await page.request.get(
    `${fixture}/__fixture/control?user=${session.user.id}&mode=${mode}`,
  );
}
test("OIDC login preserves deep-link context across all products and refresh", async ({
  page,
}) => {
  await login(page);
  for (const product of ["ECHO", "SPECTRA", "SHADOW"]) {
    await page.getByRole("link", { name: product, exact: true }).click();
    await expect(page.getByRole("heading", { name: product, exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Synthetic investigation" }),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(
        `/${product.toLowerCase()}\\?workspaceId=${workspaceId}&caseId=${caseId}`,
      ),
    );
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Synthetic investigation" }),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  const cookies = await page.context().cookies();
  const cookie = cookies.find((c) => c.name === "platform-session")!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("platform-session");
  expect(await (await page.request.get("/api/platform/session")).text()).not.toContain(
    "token",
  );
});
test("Workspace switching clears Case context and stale data", async ({ page }) => {
  await login(page);
  await page.getByLabel("Workspace", { exact: true }).selectOption(secondWorkspaceId);
  await expect(page).not.toHaveURL(/caseId=/);
  await expect(
    page.getByRole("heading", { name: "Choose a Case to continue" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic investigation")).toHaveCount(0);
});
test("viewer permissions come from the API", async ({ page }) => {
  await login(page, selectedUrl, "viewer");
  await expect(page.getByText("Not granted", { exact: true })).toHaveCount(3);
});
test("empty Workspace and Case lists have distinct non-error states", async ({
  page,
}) => {
  await login(page);
  await control(page, "empty");
  await page.goto("/shadow");
  await expect(
    page.getByRole("heading", { name: "No Workspaces available" }),
  ).toBeVisible();
  await control(page, "revoked");
  await page.goto(`/shadow?workspaceId=${workspaceId}`);
  await expect(page.getByRole("heading", { name: "No accessible Cases" })).toBeVisible();
});
test("API outages are errors, not empty access lists", async ({ page }) => {
  await login(page);
  await control(page, "unavailable");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Unable to load context" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic investigation")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No Workspaces available" }),
  ).toHaveCount(0);
});
test("background session rejection clears the open shell without a reload", async ({
  page,
}) => {
  await page.clock.install();
  await login(page);
  await control(page, "expired");
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("heading", { name: "Session ended" })).toBeVisible();
  await expect(page.getByText("Synthetic investigation")).toHaveCount(0);
});
test("product navigation rechecks revoked Case access", async ({ page }) => {
  await login(page);
  await control(page, "revoked");
  await page.getByRole("link", { name: "ECHO", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Context unavailable" })).toBeVisible();
  await expect(page.getByText("Synthetic investigation")).toHaveCount(0);
});
test("callback with altered state cannot exchange the browser login transaction", async ({
  page,
}) => {
  // Read redirects explicitly: browser route interception skips redirect-chain hops.
  const login = await page.request.get("/auth/login", { maxRedirects: 0 });
  expect(login.status()).toBe(307);
  const authorize = await page.request.get(login.headers().location!, {
    maxRedirects: 0,
  });
  expect(authorize.status()).toBe(302);
  const callback = new URL(authorize.headers().location!);
  callback.searchParams.set("state", "altered-state");
  await page.goto(callback.href);
  await expect(
    page.getByRole("alert").filter({ hasText: "Sign-in could not be completed" }),
  ).toBeVisible();
  expect((await page.request.get("/api/platform/session")).status()).toBe(401);
});
test("wrong-workspace deep links do not reveal the selected Case", async ({ page }) => {
  await login(page);
  await page.goto(`/echo?workspaceId=${secondWorkspaceId}&caseId=${caseId}`);
  await expect(page.getByRole("heading", { name: "Context unavailable" })).toBeVisible();
  await expect(page.getByText("Synthetic investigation")).toHaveCount(0);
});
test("revocation removes stale Case content on reopening", async ({ page }) => {
  await login(page);
  await control(page, "revoked");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Context unavailable" })).toBeVisible();
  await expect(page.getByText("Synthetic investigation")).toHaveCount(0);
});
test("expired sessions cannot reopen protected routes", async ({ page }) => {
  await login(page);
  await control(page, "expired");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to your Workspace" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic investigation")).toHaveCount(0);
});
test("sign-out clears the cookie and blocks the next protected request", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to your Workspace" }),
  ).toBeVisible();
  expect((await page.request.get("/api/platform/session")).status()).toBe(401);
  await page.goto(selectedUrl);
  await expect(page).toHaveURL(/\/login\?/);
});
test("callback without matching login state is rejected and never sets a session", async ({
  page,
}) => {
  await page.goto("/auth/callback?code=synthetic&state=forged");
  await expect(
    page.getByRole("alert").filter({ hasText: "Sign-in could not be completed" }),
  ).toBeVisible();
  expect(
    (await page.context().cookies()).some((c) => c.name === "platform-session"),
  ).toBe(false);
});

test("BFF rejects write methods, arbitrary proxy paths and cross-origin logout", async ({
  page,
}) => {
  await login(page);
  expect((await page.request.post(`/api/platform/cases/${caseId}`)).status()).toBe(405);
  expect((await page.request.get("/api/platform/internal/v1/runs")).status()).toBe(404);
  expect(
    (
      await page.request.post("/auth/logout", {
        headers: { origin: "https://foreign.example.test" },
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/api/platform/session")).status()).toBe(200);
});

test("sign-out in one tab clears protected content in another tab", async ({ page }) => {
  await login(page);
  const second = await page.context().newPage();
  await second.goto(selectedUrl);
  await expect(
    second.getByRole("heading", { name: "Synthetic investigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to your Workspace" }),
  ).toBeVisible();
  await expect(second.getByRole("heading", { name: "Session ended" })).toBeVisible();
  await expect(second.getByText("Synthetic investigation")).toHaveCount(0);
  await second.close();
});

test("renders source labels as text and keeps the shell usable on narrow screens", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.route(`**/api/platform/cases/${caseId}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      json: { ...body, title: '<img src=x onerror="window.syntheticXss=true">' },
    });
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: '<img src=x onerror="window.syntheticXss=true">' }),
  ).toBeVisible();
  expect(await page.evaluate(() => "syntheticXss" in window)).toBe(false);
  await page.unroute(`**/api/platform/cases/${caseId}`);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Synthetic investigation" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("shell-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Workspace", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("shell-mobile.png"),
    fullPage: true,
  });
});

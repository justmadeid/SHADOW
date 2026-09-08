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
  await expect(page.getByRole("heading", { name: "SHADOW", exact: true })).toBeVisible();
  await expect(
    page.locator(".active-context").getByText("Synthetic investigation"),
  ).toHaveCount(0);
});
test("viewer permissions come from the API", async ({ page }) => {
  await login(page, selectedUrl, "viewer");
  await expect(page.getByRole("button", { name: "Edit metadata" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Investigation" })).toHaveCount(0);
  await page.getByRole("link", { name: "ECHO", exact: true }).click();
  await expect(page.getByText("Not granted", { exact: true })).toHaveCount(3);
});
test("SHADOW creates, opens, edits, closes and reopens a Case", async ({ page }) => {
  await login(page, `/shadow?workspaceId=${workspaceId}`);
  await page.getByRole("button", { name: "New Case" }).click();
  const create = page.getByRole("region", { name: "Create Case" });
  await create.getByLabel("Title").fill("Operation Northstar");
  await create.getByLabel("Description").fill("Synthetic lifecycle verification.");
  await create.getByLabel("Classification").selectOption("SENSITIVE");
  await create.getByRole("button", { name: "Create Case" }).click();
  await expect(page.getByRole("heading", { name: "Operation Northstar" })).toBeVisible();
  await expect(page).toHaveURL(/caseId=/);

  await page.getByRole("button", { name: "Edit metadata" }).click();
  const edit = page.getByRole("region", { name: "Edit Case metadata" });
  await edit.getByLabel("Title").fill("Operation Northstar Updated");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Operation Northstar Updated" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Close Case" }).click();
  await page.getByRole("button", { name: "Confirm close" }).click();
  await expect(
    page.locator(".active-context .badge").filter({ hasText: "CLOSED" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reopen Case" }).click();
  await expect(
    page.locator(".active-context .badge").filter({ hasText: "ACTIVE" }),
  ).toBeVisible();
});
test("SHADOW creates an Investigation only inside an active authorized Case", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByText("Initial assessment", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Investigation" }).click();
  const form = page.getByRole("region", { name: "Create Investigation" });
  await form.getByLabel("Title").fill("Network hypothesis");
  await form.getByLabel("Objective").fill("Map the synthetic relationship network.");
  await form.getByRole("button", { name: "Create Investigation" }).click();
  await expect(page.getByText("Network hypothesis", { exact: true })).toBeVisible();
});
test("SHADOW adds a masked Target and completes candidate review", async ({ page }) => {
  const subjectId = "01900000-0000-7000-8000-000000000020";
  const resolutionId = "01900000-0000-7000-8000-000000000021";
  const candidateId = "01900000-0000-7000-8000-000000000022";
  const entityId = "01900000-0000-7000-8000-000000000023";
  let status: "UNRESOLVED" | "RESOLVING" | "RESOLVED" = "UNRESOLVED";
  let revision = 1;
  const subject = () => ({
    id: subjectId,
    workspaceId,
    caseId,
    investigationId: null,
    subjectType: "PERSON",
    role: "PRIMARY_TARGET",
    status,
    entityRef:
      status === "RESOLVED" ? { type: "ENTITY", id: entityId, workspaceId } : null,
    seed: { id: "01900000-0000-7000-8000-000000000024", fieldCount: 1 },
    revision,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  });
  const resolution = () => ({
    id: resolutionId,
    subjectId,
    workspaceId,
    caseId,
    status: status === "RESOLVED" ? "RESOLVED" : "NEEDS_REVIEW",
    candidatesCount: 1,
    selectedCandidateId: status === "RESOLVED" ? candidateId : null,
    resolutionDecisionId:
      status === "RESOLVED" ? "01900000-0000-7000-8000-000000000025" : null,
    revision: status === "RESOLVED" ? 3 : 2,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  });
  const candidate = () => ({
    id: candidateId,
    resolutionSessionId: resolutionId,
    subjectId,
    workspaceId,
    caseId,
    type: "PERSON",
    status: status === "RESOLVED" ? "RESOLVED" : "PENDING_REVIEW",
    displayLabel: "Synthetic Person",
    classification: "SENSITIVE",
    source: { origin: "RUN", resource: null },
    evidenceRefs: [],
    revision: status === "RESOLVED" ? 2 : 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  });
  await page.route(`**/api/platform/cases/${caseId}/subjects`, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { items: [], page: { hasMore: false, nextCursor: null } },
      });
    expect(route.request().postDataJSON()).toMatchObject({
      subjectType: "PERSON",
      seed: { fields: [{ name: "DISPLAY_NAME", classification: "SENSITIVE" }] },
    });
    return route.fulfill({ status: 201, json: subject() });
  });
  await page.route(
    `**/api/platform/shadow/cases/${caseId}/targets/${subjectId}`,
    (route) =>
      route.fulfill({
        json: {
          id: subjectId,
          workspaceId,
          caseId,
          subject: subject(),
          entity:
            status === "RESOLVED"
              ? {
                  id: entityId,
                  workspaceId,
                  type: "PERSON",
                  status: "ACTIVE",
                  canonicalLabel: "Synthetic Person",
                  aliases: [],
                  mergedInto: null,
                  revision: 1,
                  createdAt: "2026-09-08T00:00:00.000Z",
                  updatedAt: "2026-09-08T00:00:00.000Z",
                }
              : null,
          identitySummary: {
            displayLabel: status === "RESOLVED" ? "Synthetic Person" : null,
            type: "PERSON",
            resolutionStatus: status,
            aliases: [],
            identifiers:
              status === "RESOLVED"
                ? [
                    {
                      id: "01900000-0000-7000-8000-000000000026",
                      entityId,
                      workspaceId,
                      type: "NATIONAL_ID",
                      classification: "RESTRICTED",
                      status: "ACTIVE",
                      revision: 1,
                      createdAt: "2026-09-08T00:00:00.000Z",
                      updatedAt: "2026-09-08T00:00:00.000Z",
                      visibility: "MASKED",
                      displayValue: "••••",
                    },
                  ]
                : [],
          },
          sectionAvailability: Object.fromEntries(
            [
              "workspaceKnowledge",
              "sourceCoverage",
              "accounts",
              "evidence",
              "discoveries",
              "reviews",
              "searches",
            ].map((key) => [key, "NOT_IMPLEMENTED"]),
          ),
          availableViews: { overview: true, canvas: false, timeline: false, map: false },
          freshness: {
            mode: "CANONICAL",
            generatedAt: "2026-09-08T00:00:00.000Z",
            sourceUpdatedAt: "2026-09-08T00:00:00.000Z",
            isStale: false,
            subjectRevision: revision,
            entityRevision: status === "RESOLVED" ? 1 : null,
            latestIdentifierRevision: status === "RESOLVED" ? 1 : null,
            workspaceKnowledgeUpdatedAt: null,
          },
        },
      }),
  );
  await page.route(`**/api/platform/subjects/${subjectId}/seed`, (route) =>
    route.fulfill({
      json: {
        id: "01900000-0000-7000-8000-000000000024",
        subjectId,
        workspaceId,
        caseId,
        fields: [
          {
            id: "01900000-0000-7000-8000-000000000027",
            ordinal: 0,
            name: "DISPLAY_NAME",
            origin: "INVESTIGATOR_INPUT",
            classification: "SENSITIVE",
            evidenceRef: null,
            sourceRecordRef: null,
            value: {
              classification: "SENSITIVE",
              visibility: "MASKED",
              displayValue: "••••",
            },
          },
        ],
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    }),
  );
  await page.route(
    `**/api/platform/subjects/${subjectId}/actions/start-resolution`,
    (route) => {
      status = "RESOLVING";
      revision = 2;
      return route.fulfill({
        status: 202,
        json: { resolution: resolution(), subject: subject() },
      });
    },
  );
  await page.route(`**/api/platform/subjects/${subjectId}/resolution`, (route) =>
    route.fulfill({ json: resolution() }),
  );
  await page.route(`**/api/platform/resolutions/${resolutionId}`, (route) =>
    route.fulfill({ json: resolution() }),
  );
  await page.route(`**/api/platform/resolutions/${resolutionId}/candidates`, (route) =>
    route.fulfill({
      json: { items: [candidate()], page: { hasMore: false, nextCursor: null } },
    }),
  );
  await page.route(`**/api/platform/resolutions/${resolutionId}/matches`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "01900000-0000-7000-8000-000000000027",
            candidateId,
            entityRef: { type: "ENTITY", id: entityId, workspaceId },
            matchLevel: "HIGH",
            signals: [
              {
                field: "NAME",
                result: "EXACT_MATCH",
                strength: "STRONG",
                valueVisibility: "MATCH_ONLY",
              },
            ],
            conflicts: [],
            crossCaseContext: { exists: true, detailsVisible: false },
            createdAt: "2026-09-08T00:00:00.000Z",
          },
        ],
        page: { hasMore: false, nextCursor: null },
      },
    }),
  );
  await page.route(
    `**/api/platform/candidates/${candidateId}/actions/resolve`,
    (route) => {
      status = "RESOLVED";
      revision = 3;
      return route.fulfill({
        json: { candidate: candidate(), resolution: resolution(), subject: subject() },
      });
    },
  );

  await login(page);
  await page.getByRole("button", { name: "Add Target" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Display name").fill("Synthetic Person");
  await dialog.getByLabel("Classification").selectOption("SENSITIVE");
  await dialog.getByRole("button", { name: "Review" }).click();
  await dialog.getByRole("button", { name: "Create unresolved Target" }).click();
  await expect(page.getByRole("heading", { name: "Unresolved Target" })).toBeVisible();
  await expect(page.getByText("••••", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start resolution" }).click();
  await expect(page.getByText("Synthetic Person", { exact: true })).toBeVisible();
  await page.goto(
    `/shadow/cases/${caseId}/targets/${subjectId}?workspaceId=${workspaceId}&caseId=${caseId}`,
  );
  await expect(page).toHaveURL(/resolutionId=/);
  await expect(page.getByRole("button", { name: "Link existing" })).toBeVisible();
  await page.getByRole("button", { name: "Create new Entity" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Person" })).toBeVisible();
  await expect(page.getByText("National id")).toBeVisible();
  await expect(page.getByText("••••", { exact: true })).toHaveCount(2);
});
test("SHADOW confirms terminal archive and removes mutation controls", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Archive Case" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("terminal");
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    page.locator(".active-context .badge").filter({ hasText: "ARCHIVED" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit metadata" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Investigation" })).toHaveCount(0);
});
test("Case creation retries an uncertain response with the same idempotency key", async ({
  page,
}) => {
  await login(page);
  const keys: string[] = [];
  await page.route("**/api/platform/cases", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    const response = await route.fetch();
    if (keys.length === 1)
      return route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } });
    return route.fulfill({ response });
  });
  await page.getByRole("button", { name: "New Case", exact: true }).click();
  const form = page.getByRole("region", { name: "Create Case", exact: true });
  await form.getByLabel("Title").fill("Retry synthetic Case");
  await form.getByRole("button", { name: "Create Case", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await form.getByRole("button", { name: "Create Case", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(
    page.getByRole("heading", { name: "Retry synthetic Case", exact: true }),
  ).toBeVisible();
});

test("stale Case revisions fail visibly and force a current-data reload", async ({
  page,
}) => {
  await login(page);
  await control(page, "stale");
  await page.getByRole("button", { name: "Edit metadata" }).click();
  const edit = page.getByRole("region", { name: "Edit Case metadata" });
  await edit.getByLabel("Title").fill("Stale write must fail");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed elsewhere" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reload current version (discard draft)" })
    .click();
  await expect(edit).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Synthetic investigation" }),
  ).toBeVisible();
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
  expect(
    (
      await page.request.post(`/api/platform/cases/${caseId}`, {
        headers: { origin: "http://127.0.0.1:3000" },
      })
    ).status(),
  ).toBe(404);
  expect((await page.request.get("/api/platform/internal/v1/runs")).status()).toBe(404);
  expect(
    (
      await page.request.post("/auth/logout", {
        headers: { origin: "https://foreign.example.test" },
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/api/platform/session")).status()).toBe(200);
  expect(
    (
      await page.request.patch(`/api/platform/cases/${caseId}`, {
        headers: {
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
          "if-match": '"1"',
        },
        data: {
          title: "Synthetic investigation",
          description: null,
          classification: "INTERNAL",
          role: "OWNER",
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/platform/cases", {
        headers: {
          origin: "https://foreign.example.test",
          "content-type": "application/json",
          "idempotency-key": "synthetic-key-1",
        },
        data: {
          workspaceId,
          title: "Cross-origin Case",
          description: null,
          classification: "INTERNAL",
        },
      })
    ).status(),
  ).toBe(403);
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

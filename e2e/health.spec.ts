import { expect, test, type Page } from "@playwright/test";

const api = "http://127.0.0.1:8123";
async function start(page: Page, id: string, fail = false) {
  await page.goto("/#" + id);
  const button = page.getByRole("button", { name: "Process claim" });
  await expect(button).toBeVisible();
  const context = page.getByText(
    "Read claim, policy, plan, history and policy wording",
    { exact: true },
  );
  const previousEvents = await context.count();
  await button.click();
  await expect(page.getByText("Review in progress…")).toBeVisible();
  await expect(context).toHaveCount(previousEvents + 1);
  const release = await page.request.post(
    api + "/test/claims/" + id + "/release",
    { data: { fail } },
  );
  expect(release.ok()).toBe(true);
}

test("queue, progressive approval, simulated payment and persistence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("25 claims")).toBeVisible();
  await start(page, "CLM-1001");
  await expect(page.getByText("Agent finished", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Approve", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Simulated payment recorded", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Simulated payment recorded", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".model-summary")
      .getByText("test/scripted-claims", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText("Scripted test model · no live AI call"),
  ).toBeVisible();
  const duplicate = await page.request.post(api + "/api/claims/CLM-1001/pay", {
    data: { amount: "420.00" },
  });
  expect(duplicate.status()).toBe(409);
  await page
    .getByRole("link", { name: "Agent instructions", exact: true })
    .click();
  await expect(page.locator("pre")).toContainText("policy wording");
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("payment above limit requires sign-off", async ({ page }) => {
  await start(page, "CLM-1002");
  const button = page.getByRole("button", { name: "Sign off and pay" });
  await expect(button).toBeDisabled();
  const blocked = await page.request.post(api + "/api/claims/CLM-1002/pay", {
    data: { amount: "1250.00" },
  });
  expect(blocked.status()).toBe(409);
  await page.getByLabel("Handler", { exact: true }).selectOption("HND-01");
  await button.click();
  await expect(
    page.getByText("Signed off by Dana Whitfield", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("$1,250.00", { exact: true })).toHaveCount(2);
  const duplicate = await page.request.post(
    api + "/api/claims/CLM-1002/sign-off",
    { data: { handler_id: "HND-01" } },
  );
  expect(duplicate.status()).toBe(409);
});

for (const [id, outcome] of [
  ["CLM-1003", "Decline"],
  ["CLM-1004", "Refer"],
]) {
  test(outcome + " requires no payment", async ({ page }) => {
    await start(page, id);
    await expect(
      page.getByRole("heading", { name: outcome, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Policy section 3. Trip Delay")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign off and pay" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Retry payment" }),
    ).toHaveCount(0);
  });
}

test("failed run can retry and unpaid approval can pay without rerunning", async ({
  page,
}) => {
  await start(page, "CLM-1005", true);
  await expect(page.getByText("Synthetic provider failure")).toBeVisible();
  await start(page, "CLM-1005");
  await expect(page.getByText("Agent finished", { exact: true })).toBeVisible();
  await start(page, "CLM-1006");
  await expect(
    page.getByText("Synthetic interruption after decision"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry payment" }).click();
  await expect(
    page.getByText("Simulated payment recorded", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Decision recorded: approve", { exact: true }),
  ).toHaveCount(1);
});

test("one button processes every remaining waiting claim", async ({ page }) => {
  await page.goto("/");
  const response = await page.request.get(api + "/api/claims");
  const queue = (await response.json()) as {
    claim_id: string;
    status: string;
    active: boolean;
  }[];
  const pending = queue.filter(
    (claim) => claim.status === "waiting" && !claim.active,
  );
  await page
    .getByRole("button", { name: "Process all claims", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Processing claims…" }),
  ).toBeDisabled();
  const duplicate = await page.request.post(api + "/api/claims/run");
  expect(await duplicate.json()).toEqual({ queued: 0 });
  await page.reload();
  for (const claim of pending) {
    await expect
      .poll(async () => {
        const progress = await page.request.get(
          api + "/api/claims/" + claim.claim_id + "/progress",
        );
        const events = (await progress.json()) as { action: string }[];
        return events.some((event) => event.action === "context");
      })
      .toBe(true);
    const released = await page.request.post(
      api + "/test/claims/" + claim.claim_id + "/release",
      { data: { fail: false } },
    );
    expect(released.ok()).toBe(true);
  }
  await expect
    .poll(async () => {
      const result = await page.request.get(api + "/api/claims");
      const claims = (await result.json()) as { active: boolean }[];
      return claims.filter((claim) => claim.active).length;
    })
    .toBe(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Process all claims", exact: true }),
  ).toBeDisabled();
  const blocked = await page.request.post(api + "/api/claims/CLM-1012/pay", {
    data: { amount: "1250.00" },
  });
  expect(blocked.status()).toBe(409);
});

test("reset restores unprocessed claims and allows a fresh review", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Reset claims", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Reset claims confirmation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Reset claims confirmation" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reset claims", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset all claims", exact: true })
    .click();
  await expect(
    page.getByText("Claims reset. All 25 claims are waiting."),
  ).toBeVisible();
  const response = await page.request.get(api + "/api/claims");
  const queue = (await response.json()) as {
    status: string;
    decision: unknown;
    payment: unknown;
    progress: unknown[];
  }[];
  expect(queue).toHaveLength(25);
  expect(
    queue.every(
      (claim) =>
        claim.status === "waiting" &&
        claim.decision === null &&
        claim.payment === null &&
        claim.progress.length === 0,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Process all claims", exact: true }),
  ).toBeEnabled();
  await page.goto("/#CLM-1001");
  await page
    .getByRole("button", { name: "Process claim", exact: true })
    .click();
  await expect(
    page.getByText("Read claim, policy, plan, history and policy wording", {
      exact: true,
    }),
  ).toBeVisible();
  const blocked = await page.request.post(api + "/api/claims/reset");
  expect(blocked.status()).toBe(409);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Reset claims", exact: true }),
  ).toBeDisabled();
  const released = await page.request.post(
    api + "/test/claims/CLM-1001/release",
    { data: { fail: false } },
  );
  expect(released.ok()).toBe(true);
  await page.goto("/#CLM-1001");
  await expect(
    page.getByText("Simulated payment recorded", { exact: true }),
  ).toBeVisible();
});

test("queue search and status filters are easy to clear", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search claims" }).fill("Maya");
  await expect(
    page.getByRole("link", { name: "CLM-1001", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "CLM-1002", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Queue status").selectOption("waiting");
  await expect(page.getByText("No claims match your search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(
    page.getByRole("link", { name: "CLM-1002", exact: true }),
  ).toBeVisible();
});

test("responsive workspace supports keyboard filters and accessibility preferences", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "reduce",
    contrast: "more",
  });
  await page.goto("/");
  await expect(page.getByRole("table", { name: "Claims queue" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const card = page.getByRole("button", { name: "Filter by Decided" });
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Queue status")).toHaveValue("decided");
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "CLM-1001", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Supporting documents" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Agent instructions", exact: true })
    .click();
  await expect(page.locator("pre")).toContainText("policy wording");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

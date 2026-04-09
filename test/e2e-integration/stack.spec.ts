import { expect, test, type Page } from "@playwright/test";

const integrationEnabled = process.env.INTEGRATION_E2E === "1";
const username = process.env.INTEGRATION_ADMIN_USERNAME ?? "admin";
const password = process.env.INTEGRATION_ADMIN_PASSWORD ?? "change-me-now-please";
const integrationBucket = process.env.INTEGRATION_BUCKET_NAME ?? "integration-bucket";

test.describe.configure({ mode: "serial" });
test.skip(!integrationEnabled, "Set INTEGRATION_E2E=1 to run full integration E2E lane.");

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/files/);
}

test("login and files page visibility", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole("heading", { name: "Storage Browser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
});

test("admin bucket sync queues and exposes job state", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin");

  await page.getByRole("button", { name: "Sync Buckets" }).click();
  await expect(page.getByText("Bucket sync job queued")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Background jobs" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "BUCKET_SYNC" }).first()).toBeVisible();
});

test("bucket visibility, upload, and folder rename/delete job flow", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/files");

  await page.getByLabel("Bucket").selectOption({ label: integrationBucket });

  const fileName = `stage3-e2e-${Date.now()}.txt`;
  await page.locator('input[type="file"]').first().setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from("stage3 integration upload")
  });

  await expect(async () => {
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText(fileName)).toBeVisible();
  }).toPass({ timeout: 30_000 });

  const folderBase = `stage3-folder-${Date.now()}`;
  page.once("dialog", (dialog) => {
    void dialog.accept(folderBase);
  });
  await page.getByRole("button", { name: "Folder", exact: true }).click();
  await expect(page.getByText(folderBase)).toBeVisible();

  const renamedFolder = `${folderBase}-renamed`;
  page.once("dialog", (dialog) => {
    void dialog.accept(renamedFolder);
  });
  const folderRow = page.locator("tr", { hasText: folderBase }).first();
  await folderRow.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText("Rename queued as background job")).toBeVisible();

  const deleteTarget = `${folderBase}-delete-target`;
  page.once("dialog", (dialog) => {
    void dialog.accept(deleteTarget);
  });
  await page.getByRole("button", { name: "Folder", exact: true }).click();
  await expect(page.getByText(deleteTarget)).toBeVisible();

  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  const deleteRow = page.locator("tr", { hasText: deleteTarget }).first();
  await deleteRow.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Delete queued as background job")).toBeVisible();
});

test("admin grant update flow", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin");

  await page.getByRole("button", { name: "Save Grants" }).click();
  await expect(page.getByText("Bucket grants updated")).toBeVisible();
});

test("job timeline details are visible in admin UI", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin");

  await page.getByRole("button", { name: "Sync Buckets" }).click();
  await expect(page.getByText("Bucket sync job queued")).toBeVisible();

  const row = page.locator("tr", { hasText: "BUCKET_SYNC" }).first();
  await row.getByRole("button", { name: "Details" }).click();
  const timelinePanel = page.locator("div", {
    has: page.getByRole("heading", { name: "Job timeline" })
  }).first();
  await expect(timelinePanel.getByRole("heading", { name: "Job timeline" })).toBeVisible();
  await expect(timelinePanel.getByText("Selected job:")).toBeVisible();
  await expect(timelinePanel.locator("tbody tr").first()).toBeVisible();
});

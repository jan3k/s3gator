import { expect, test, type Page } from "@playwright/test";

const integrationEnabled = process.env.INTEGRATION_E2E === "1";
const username = process.env.INTEGRATION_ADMIN_USERNAME ?? "admin";
const password = process.env.INTEGRATION_ADMIN_PASSWORD ?? "change-me-now-please";
const integrationBucket = process.env.INTEGRATION_BUCKET_NAME;

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
  await expect(page.locator("table").getByText("BUCKET_SYNC")).toBeVisible();
});

test("bucket visibility, upload, and folder rename/delete job flow", async ({ page }) => {
  test.skip(!integrationBucket, "Set INTEGRATION_BUCKET_NAME with an existing Garage bucket alias.");

  await loginAsAdmin(page);
  await page.goto("/files");

  await page.getByLabel("Bucket").selectOption({ label: integrationBucket! });

  const fileName = `stage3-e2e-${Date.now()}.txt`;
  await page.locator('input[type="file"]').first().setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from("stage3 integration upload")
  });

  await expect(page.getByText("done")).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(fileName)).toBeVisible();

  const folderBase = `stage3-folder-${Date.now()}`;
  page.once("dialog", (dialog) => {
    void dialog.accept(folderBase);
  });
  await page.getByRole("button", { name: "Folder" }).click();
  await expect(page.getByText(folderBase)).toBeVisible();

  const renamedFolder = `${folderBase}-renamed`;
  page.once("dialog", (dialog) => {
    void dialog.accept(renamedFolder);
  });
  const folderRow = page.locator("tr", { hasText: folderBase }).first();
  await folderRow.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText("Rename queued as background job")).toBeVisible();

  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  const renamedRow = page.locator("tr", { hasText: renamedFolder }).first();
  await renamedRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Delete queued as background job")).toBeVisible();
});

test("admin grant update flow", async ({ page }) => {
  test.skip(!integrationBucket, "Requires at least one synced bucket for grant updates.");

  await loginAsAdmin(page);
  await page.goto("/admin");

  await page.getByRole("button", { name: "Save Grants" }).click();
  await expect(page.getByText("Bucket grants updated")).toBeVisible();
});

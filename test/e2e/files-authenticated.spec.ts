import { expect, test } from "@playwright/test";

test("authenticated user can load files page", async ({ page }) => {
  await page.route("http://127.0.0.1:4000/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "user-1",
          username: "alice",
          email: "alice@example.com",
          role: "USER"
        }
      })
    });
  });

  await page.route("http://127.0.0.1:4000/buckets", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "bucket-1",
          name: "bucket-a"
        }
      ])
    });
  });

  await page.route(/http:\/\/127\.0\.0\.1:4000\/files\/list.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: [
          {
            kind: "folder",
            key: "docs/",
            name: "docs"
          },
          {
            kind: "file",
            key: "readme.txt",
            name: "readme.txt",
            size: 512,
            lastModified: "2026-04-09T10:00:00.000Z"
          }
        ],
        continuationToken: null
      })
    });
  });

  await page.goto("/files");

  await expect(page.getByRole("heading", { name: "Storage Browser" })).toBeVisible();
  await expect(page.getByText("Signed in as alice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  await expect(page.getByText("readme.txt")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectProblems } from "./helpers.ts";

const card = (page: Page, name: string) => page.locator(".adg-card").filter({ has: page.locator(".adg-name", { hasText: new RegExp(`^${name}$`) }) });
const zoneButton = (page: Page, name: RegExp) => page.getByRole("button", { name });

async function open(page: Page, view: "top" | "iso") {
  await page.goto("/?example=confluent-streaming-platform");
  await page.locator(".adg-plane").waitFor();
  await page.getByRole("button", { name: view === "top" ? "Top view" : "Isometric" }).click();
  await page.waitForTimeout(1000);
}

test.describe("selecting a container", () => {
  for (const view of ["top", "iso"] as const) {
    test(`${view}: lights its components, the arrows in and out, and the components at their far ends`, async ({ page }) => {
      const problems = collectProblems(page);
      await open(page, view);
      await zoneButton(page, /^EKS cluster:/).click();
      await expect(zoneButton(page, /^EKS cluster:/)).toHaveAttribute("aria-pressed", "true");
      // inside the container
      for (const n of ["Kafka Connect workers", "Debezium connectors", "Confluent for Kubernetes"]) await expect(card(page, n)).not.toHaveClass(/dim/);
      // outside it, but connected by an arrow across its edge
      for (const n of ["Tenant databases", "Amazon S3", "Terraform", "AWS PrivateLink"]) await expect(card(page, n)).not.toHaveClass(/dim/);
      // unconnected to it
      for (const n of ["New Relic", "Confluent Flink", "Tenant consumers"]) await expect(card(page, n)).toHaveClass(/dim/);
      await expect(page.locator(".adg-info h3")).toHaveText("EKS cluster");
      await expect(page.locator(".adg-info")).toContainText(/arrows? cross its edge/);
      expect(problems).toEqual([]);
    });
  }

  test("a container holding another lights the inner one's components too", async ({ page }) => {
    await open(page, "top");
    await zoneButton(page, /^Platform VPC \(AWS\):/).click();
    for (const n of ["Kafka Connect workers", "AWS PrivateLink"]) await expect(card(page, n)).not.toHaveClass(/dim/);
  });

  test("pressing it again, choosing a card, or Reset clears it", async ({ page }) => {
    await open(page, "top");
    const eks = zoneButton(page, /^EKS cluster:/);
    await eks.click();
    await eks.click();
    await expect(page.locator(".adg-card.dim")).toHaveCount(0);
    await eks.click();
    await card(page, "New Relic").click();
    await expect(eks).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".adg-info h3")).toHaveText("New Relic");
    await eks.click();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.locator(".adg-card.dim")).toHaveCount(0);
  });

  test("works from the keyboard", async ({ page }) => {
    await open(page, "top");
    await zoneButton(page, /^EKS cluster:/).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".adg-info h3")).toHaveText("EKS cluster");
  });
});

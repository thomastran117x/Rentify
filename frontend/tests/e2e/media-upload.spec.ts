import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures";
import { ensureActiveOrganization } from "./helpers/organizations";

/**
 * Covers an image upload end to end: the browser PUTs the bytes, the media
 * processing worker validates them and writes the processed image with its
 * medium and thumbnail renditions, and the preview draws them through a
 * srcset. Needs the Compose stack with the media processing worker running.
 *
 * Nothing is saved, so the organization is left as it was. The uploads remain
 * as unattached media until the orphaned-blob cleanup removes them.
 */

test.describe.configure({ mode: "serial" });

const ORGANIZATION_LABEL = "Harbor Loft Rentals - Primary Manager";

// A valid 1x1 PNG. Small enough that every rendition keeps its size, which
// still exercises the whole pipeline.
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

// Processing is asynchronous; the preview only appears once the worker is done.
const PROCESSING_TIMEOUT_MS = 30_000;

async function uploadImage(page: Page, inputLabel: string, name: string) {
  await page.getByLabel(inputLabel).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
}

/**
 * Asserts the preview offers all three renditions, and that each is served as
 * the WebP the worker wrote.
 */
async function expectRenditions(page: Page, preview: Locator, sizes: string) {
  await expect(preview).toHaveAttribute(
    "srcset",
    /\.thumbnail\.webp\S* 300w, \S+\.medium\.webp\S* 800w, \S+\.webp\S* 2560w$/,
    { timeout: PROCESSING_TIMEOUT_MS },
  );
  await expect(preview).toHaveAttribute("sizes", sizes);

  const srcset = (await preview.getAttribute("srcset")) ?? "";
  for (const candidate of srcset.split(", ")) {
    const [url] = candidate.split(" ");
    const response = await page.request.get(url!);

    expect(response.status(), url).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/webp");
  }
}

test("an uploaded organization logo is previewed through its renditions", async ({
  ownerPage,
}) => {
  const consoleErrors: string[] = [];
  ownerPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await ownerPage.goto("/dashboard/organizations");
  await ensureActiveOrganization(ownerPage, ORGANIZATION_LABEL);
  await ownerPage.goto("/dashboard/organizations/settings");

  await uploadImage(ownerPage, "Upload organization logo", "logo.png");

  await expectRenditions(
    ownerPage,
    ownerPage.getByRole("img", { name: "Organization logo" }),
    "64px",
  );
  expect(consoleErrors).toEqual([]);
});

test("an uploaded blog cover is previewed through its renditions", async ({
  ownerPage,
}) => {
  await ownerPage.goto("/dashboard/organizations");
  await ensureActiveOrganization(ownerPage, ORGANIZATION_LABEL);
  await ownerPage.goto("/dashboard/organizations/content?view=blog");

  await uploadImage(ownerPage, "Upload blog cover image", "cover.png");

  await expectRenditions(
    ownerPage,
    ownerPage.getByRole("img", { name: "Blog cover" }),
    "128px",
  );
});

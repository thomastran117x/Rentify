import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const SEEDED_PASSWORD = "Rentify123!";

export interface SeededUser {
  username: string;
  email: string;
  password: string;
  roleLabel: string;
}

export const SEEDED_USERS = {
  "owner-one": {
    username: "owner-one",
    email: "owner1@rentify.local",
    password: SEEDED_PASSWORD,
    roleLabel: "Owner + primary-manager org flows",
  },
  "renter-one": {
    username: "renter-one",
    email: "user1@rentify.local",
    password: SEEDED_PASSWORD,
    roleLabel: "Manager org flows",
  },
  "renter-two": {
    username: "renter-two",
    email: "user2@rentify.local",
    password: SEEDED_PASSWORD,
    roleLabel: "Operator + read-only org flows",
  },
} as const satisfies Record<string, SeededUser>;

export type SeededUsername = keyof typeof SEEDED_USERS;

export async function ensureCaptchaToken(page: Page): Promise<void> {
  const readCaptchaToken = async () =>
    page.evaluate(() => {
      const rawCaptchaState = window.sessionStorage.getItem(
        "rentify.auth.captcha",
      );

      if (!rawCaptchaState) {
        return "";
      }

      try {
        const parsedCaptchaState = JSON.parse(rawCaptchaState) as {
          token?: string;
        };

        return parsedCaptchaState.token?.trim() ?? "";
      } catch {
        return "";
      }
    });

  const token = await readCaptchaToken();

  if (!token) {
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        "rentify.auth.captcha",
        JSON.stringify({
          token: "local-dev-bypass",
          createdAt: Date.now(),
        }),
      );
      window.dispatchEvent(new Event("rentify-auth-captcha-storage"));
    });
  }

  await expect.poll(readCaptchaToken).not.toBe("");
}

export interface LoginOptions {
  password?: string;
  nextPath?: string;
  waitForNavigation?: boolean;
}

export async function login(
  page: Page,
  username: string,
  options: LoginOptions = {},
): Promise<void> {
  const {
    password = SEEDED_PASSWORD,
    nextPath = "/dashboard/organizations",
    waitForNavigation = true,
  } = options;

  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(username);
  await page.getByLabel(/^Password/i).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  if (waitForNavigation) {
    const expectedPath = nextPath.split("?")[0];
    await page.waitForURL((url) => url.pathname === expectedPath, {
      timeout: 15000,
    });
  }
}

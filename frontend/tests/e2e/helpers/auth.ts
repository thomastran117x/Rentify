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
  "viewer-one": {
    username: "viewer-one",
    email: "viewer1@rentify.local",
    password: SEEDED_PASSWORD,
    roleLabel: "Site role: user, no organization membership",
  },
  "admin-one": {
    username: "admin-one",
    email: "admin1@rentify.local",
    password: SEEDED_PASSWORD,
    roleLabel: "Site role: admin (owner + moderator privileges, no org)",
  },
  "mod-one": {
    username: "mod-one",
    email: "moderator1@rentify.local",
    password: SEEDED_PASSWORD,
    roleLabel: "Site role: moderator, no org",
  },
} as const satisfies Record<string, SeededUser>;

export type SeededUsername = keyof typeof SEEDED_USERS;

const CAPTCHA_STORAGE_KEY_PREFIX = "rentify.auth.captcha.";
// Each flow keeps its own token (frontend/src/lib/auth/captcha-actions.ts),
// so every one is seeded with the development bypass token.
const CAPTCHA_ACTIONS = [
  "login",
  "signup",
  "verify_email",
  "forgot_username",
  "password_reset",
  "unlock",
  "oauth_signup",
];

export async function ensureCaptchaToken(page: Page): Promise<void> {
  const hasCaptchaTokens = async () =>
    page.evaluate(
      ({ prefix, actions }) =>
        actions.every((action) => {
          const rawCaptchaState = window.sessionStorage.getItem(
            `${prefix}${action}`,
          );

          if (!rawCaptchaState) {
            return false;
          }

          try {
            const parsedCaptchaState = JSON.parse(rawCaptchaState) as {
              token?: string;
            };

            return Boolean(parsedCaptchaState.token?.trim());
          } catch {
            return false;
          }
        }),
      { prefix: CAPTCHA_STORAGE_KEY_PREFIX, actions: CAPTCHA_ACTIONS },
    );

  if (!(await hasCaptchaTokens())) {
    await page.evaluate(
      ({ prefix, actions }) => {
        for (const action of actions) {
          window.sessionStorage.setItem(
            `${prefix}${action}`,
            JSON.stringify({
              token: "local-dev-bypass",
              createdAt: Date.now(),
            }),
          );
        }
        window.dispatchEvent(new Event("rentify-auth-captcha-storage"));
      },
      { prefix: CAPTCHA_STORAGE_KEY_PREFIX, actions: CAPTCHA_ACTIONS },
    );
  }

  await expect.poll(hasCaptchaTokens).toBe(true);
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

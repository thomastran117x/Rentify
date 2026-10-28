/**
 * The Turnstile action each captcha-protected flow expects. The frontend
 * renders its widget with the same action, Turnstile binds it into the token,
 * and verification rejects a token solved for any other action, so a token
 * cannot be harvested on one form and spent on another. Kept in step with
 * frontend/src/lib/auth/captcha-actions.ts.
 *
 * Actions are per flow rather than per endpoint: a screen that both submits a
 * code and resends it renders a single widget.
 */
export const CAPTCHA_ACTIONS = {
  login: "login",
  signup: "signup",
  /** Resending the signup verification email. */
  verifyEmail: "verify_email",
  forgotUsername: "forgot_username",
  /** Requesting, resending and redeeming a password reset code. */
  passwordReset: "password_reset",
  /** Resending and redeeming a login unlock code. */
  unlock: "unlock",
  oauthSignup: "oauth_signup",
  feedback: "feedback",
} as const;

export type CaptchaAction =
  (typeof CAPTCHA_ACTIONS)[keyof typeof CAPTCHA_ACTIONS];

/**
 * The Turnstile action each captcha-protected flow renders its widget with.
 * The API rejects a token whose action differs from the one the endpoint
 * expects, so a token solved for one flow cannot be spent on another. Keep in
 * step with backend/src/app/features/auth/captcha/captcha.actions.ts.
 */
export const CAPTCHA_ACTIONS = {
  login: "login",
  signup: "signup",
  verifyEmail: "verify_email",
  forgotUsername: "forgot_username",
  passwordReset: "password_reset",
  unlock: "unlock",
  oauthSignup: "oauth_signup",
  feedback: "feedback",
} as const;

export type CaptchaAction =
  (typeof CAPTCHA_ACTIONS)[keyof typeof CAPTCHA_ACTIONS];

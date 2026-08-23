import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import {
  authUsernameSchema,
  containsUnsafeAuthInput,
  optionalTrimmedString,
  requiredSafeTrimmedString,
  strongPasswordSchema,
  UNSAFE_AUTH_INPUT_MESSAGE,
} from "@/features/auth/auth.model";

export const localSignupRequestSchema = z.object({
  username: authUsernameSchema,
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: strongPasswordSchema,
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
  deviceId: optionalTrimmedString,
});

export const localAuthenticateRequestSchema = z.object({
  username: authUsernameSchema,
  password: z
    .string()
    .min(1, "Password is required.")
    .refine(
      (value) => !containsUnsafeAuthInput(value),
      UNSAFE_AUTH_INPUT_MESSAGE,
    ),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
  rememberMe: z.boolean().optional(),
  deviceId: optionalTrimmedString,
  totpCode: z.string().optional(),
});

export const verifyEmailRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Verification code must be 6 digits."),
  deviceId: optionalTrimmedString,
});

export const resendVerificationEmailRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export type LocalSignupRequestBody = z.infer<typeof localSignupRequestSchema>;

export type LocalAuthenticateRequestBody = z.infer<
  typeof localAuthenticateRequestSchema
>;

export type VerifyEmailRequestBody = z.infer<typeof verifyEmailRequestSchema>;

export type ResendVerificationEmailRequestBody = z.infer<
  typeof resendVerificationEmailRequestSchema
>;

export interface LocalAuthenticateInput {
  client: ClientRequestContext;
  username: string;
  password: string;
  rememberMe?: boolean;
  deviceId?: string;
  totpCode?: string;
}

export interface LocalSignupInput {
  client: ClientRequestContext;
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  deviceId?: string;
}

export interface VerifyEmailInput {
  client: ClientRequestContext;
  email: string;
  code: string;
  deviceId?: string;
}

export interface ResendVerificationEmailInput {
  client: ClientRequestContext;
  email: string;
  deviceId?: string;
}

export interface SignupVerificationPendingResult {
  verificationRequired: true;
  email: string;
  alreadyPending: boolean;
}


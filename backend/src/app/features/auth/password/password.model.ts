import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import {
  authUsernameSchema,
  optionalTrimmedString,
  requiredSafeTrimmedString,
  strongPasswordSchema,
  UNSAFE_AUTH_INPUT_MESSAGE,
  containsUnsafeAuthInput,
} from "@/features/auth/auth.model";
import type { Uuid } from "@/configuration/validation/uuid";

export const forgotPasswordRequestSchema = z.object({
  username: authUsernameSchema,
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export const resendForgotPasswordRequestSchema = z.object({
  username: authUsernameSchema,
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export const resetPasswordRequestSchema = z.object({
  username: authUsernameSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Reset code must be 6 digits."),
  newPassword: strongPasswordSchema,
  deviceId: optionalTrimmedString,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Current password is required.")
    .refine(
      (value) => !containsUnsafeAuthInput(value),
      UNSAFE_AUTH_INPUT_MESSAGE,
    ),
  newPassword: strongPasswordSchema,
});

export const setPasswordRequestSchema = z.object({
  newPassword: strongPasswordSchema,
});

export type ForgotPasswordRequestBody = z.infer<
  typeof forgotPasswordRequestSchema
>;
export type ResendForgotPasswordRequestBody = z.infer<
  typeof resendForgotPasswordRequestSchema
>;
export type ResetPasswordRequestBody = z.infer<
  typeof resetPasswordRequestSchema
>;
export type ChangePasswordRequestBody = z.infer<
  typeof changePasswordRequestSchema
>;
export type SetPasswordRequestBody = z.infer<typeof setPasswordRequestSchema>;

export interface ForgotPasswordInput {
  client: ClientRequestContext;
  username: string;
  deviceId?: string;
}

export interface ResendForgotPasswordInput {
  client: ClientRequestContext;
  username: string;
  deviceId?: string;
}

export interface ResetPasswordInput {
  client: ClientRequestContext;
  username: string;
  code: string;
  newPassword: string;
  deviceId?: string;
}

export interface ChangePasswordInput {
  userId: Uuid;
  client: ClientRequestContext;
  currentPassword: string;
  newPassword: string;
  deviceId?: string;
}

export interface SetPasswordInput {
  userId: Uuid;
  client: ClientRequestContext;
  newPassword: string;
  deviceId?: string;
}

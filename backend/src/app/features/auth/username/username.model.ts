import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import {
  authUsernameSchema,
  requiredSafeTrimmedString,
} from "@/features/auth/auth.model";

export const usernameAvailabilityQuerySchema = z.object({
  username: authUsernameSchema,
});

export type UsernameAvailabilityQuery = z.infer<
  typeof usernameAvailabilityQuerySchema
>;

export interface UsernameAvailabilityResult {
  username: string;
  available: boolean;
  reason: "taken" | null;
}

export const forgotUsernameRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export type ForgotUsernameRequestBody = z.infer<
  typeof forgotUsernameRequestSchema
>;

export interface ForgotUsernameInput {
  client: ClientRequestContext;
  email: string;
  deviceId?: string;
}

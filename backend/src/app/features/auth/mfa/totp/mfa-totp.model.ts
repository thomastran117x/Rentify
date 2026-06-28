import { z } from "zod";

export const beginEnrollmentRequestSchema = z.object({
  accountName: z.string().trim().min(1).optional(),
});

export const confirmEnrollmentRequestSchema = z.object({
  code: z.string().trim().min(1, "Code is required."),
});

export const disableRequestSchema = z.object({
  code: z.string().trim().min(1, "Current authenticator code is required."),
});

export type BeginEnrollmentRequestBody = z.infer<
  typeof beginEnrollmentRequestSchema
>;

export type ConfirmEnrollmentRequestBody = z.infer<
  typeof confirmEnrollmentRequestSchema
>;

export interface MfaTotpStatusResult {
  enabled: boolean;
}

export interface MfaTotpBeginResult {
  secret: string;
  uri: string;
}

export interface MfaTotpConfirmResult {
  confirmed: true;
}

export interface MfaTotpDisableResult {
  disabled: true;
}

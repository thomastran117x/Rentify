import { z } from "zod";

const UNSAFE_PAT_INPUT_MESSAGE =
  "Input contains unsupported HTML or script content.";
const UNSAFE_PAT_INPUT_PATTERN =
  /<[^>]*>|&lt;|&gt;|javascript:|data:text\/html|on[a-z]+\s*=|<\/?script\b/i;

function containsUnsafePatInput(value: string): boolean {
  return UNSAFE_PAT_INPUT_PATTERN.test(value);
}

function normalizeScopeList(scopes: readonly string[]): string[] {
  return Array.from(new Set(scopes));
}

export const personalAccessTokenScopeSchema = z.enum(["mcp:read", "mcp:write"]);
export type PersonalAccessTokenScope = z.infer<
  typeof personalAccessTokenScopeSchema
>;

export const createPersonalAccessTokenRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Token name is required.")
      .max(120, "Token name must be 120 characters or fewer.")
      .refine(
        (value) => !containsUnsafePatInput(value),
        UNSAFE_PAT_INPUT_MESSAGE,
      ),
    scopes: z
      .array(personalAccessTokenScopeSchema)
      .min(1, "At least one scope is required.")
      .transform((value) => normalizeScopeList(value)),
    expiresAt: z.iso.datetime().optional(),
    expiresInDays: z
      .number()
      .int("expiresInDays must be an integer.")
      .min(1, "expiresInDays must be at least 1.")
      .max(365, "expiresInDays must be 365 or fewer.")
      .optional(),
  })
  .superRefine((input, context) => {
    if (!input.expiresAt && input.expiresInDays === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresInDays"],
        message: "Either expiresAt or expiresInDays must be provided.",
      });
    }

    if (input.expiresAt && input.expiresInDays !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Use either expiresAt or expiresInDays, not both.",
      });
    }
  });

export type CreatePersonalAccessTokenRequestBody = z.infer<
  typeof createPersonalAccessTokenRequestSchema
>;

export interface CreatePersonalAccessTokenInput {
  userId: string;
  name: string;
  scopes: PersonalAccessTokenScope[];
  expiresAt?: string;
  expiresInDays?: number;
}

export interface RevokePersonalAccessTokenInput {
  userId: string;
  tokenId: string;
}

export interface PersonalAccessTokenRecord {
  id: string;
  userId: string;
  name: string;
  publicId: string;
  tokenPrefix: string;
  secretHash: string;
  scopes: PersonalAccessTokenScope[];
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export interface PersonalAccessTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: PersonalAccessTokenScope[];
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalAccessTokenListResult {
  tokens: PersonalAccessTokenSummary[];
}

export interface CreatePersonalAccessTokenResult
  extends PersonalAccessTokenSummary {
  token: string;
}

export interface RevokePersonalAccessTokenResult {
  revoked: true;
  tokenId: string;
}

import { z } from "zod";

export const listProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
});

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters long.")
  .max(50, "Username must be at most 50 characters long.")
  .regex(
    /^[a-z0-9._-]+$/i,
    "Username may only contain letters, numbers, periods, underscores, and hyphens.",
  );

export const updateProfileRequestSchema = z.object({
  username: usernameSchema,
  phoneNumber: z
    .string()
    .trim()
    .min(7, "Phone number must be at least 7 characters long.")
    .max(32, "Phone number must be at most 32 characters long.")
    .regex(/^[0-9+()\-\s]+$/, "Phone number contains unsupported characters.")
    .nullable()
    .optional(),
  isPrivate: z.boolean().optional(),
  recommendationPersonalizationEnabled: z.boolean().optional(),
  avatarUrl: z.url("Avatar URL must be a valid URL.").nullable().optional(),
  avatarBlobName: z.string().trim().min(1).max(1024).nullable().optional(),
  trustworthinessScore: z
    .number()
    .int("Trustworthiness score must be an integer.")
    .min(1, "Trustworthiness score must be between 1 and 5.")
    .max(5, "Trustworthiness score must be between 1 and 5.")
    .optional(),
  rentPostingsCount: z
    .number()
    .int("Rent postings count must be an integer.")
    .min(0, "Rent postings count cannot be negative.")
    .optional(),
  availableRentPostingsCount: z
    .number()
    .int("Available rent postings count must be an integer.")
    .min(0, "Available rent postings count cannot be negative.")
    .optional(),
});

export type ListProfilesQuery = z.infer<typeof listProfilesQuerySchema>;
export type UpdateProfileRequestBody = z.infer<
  typeof updateProfileRequestSchema
>;

export interface ProfileRecord {
  id: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username: string;
  phoneNumber?: string;
  avatarUrl?: string;
  avatarBlobName?: string;
  isPrivate: boolean;
  recommendationPersonalizationEnabled: boolean;
  trustworthinessScore: number;
  rentPostingsCount: number;
  availableRentPostingsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfileRecord {
  id: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username: string;
  phoneNumber?: string;
  avatarUrl?: string;
  trustworthinessScore: number;
  rentPostingsCount: number;
  availableRentPostingsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListProfilesResult {
  profiles: PublicProfileRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  query?: string;
}

export interface UpdateProfileInput {
  userId: string;
  username: string;
  phoneNumber?: string | null;
  isPrivate?: boolean;
  recommendationPersonalizationEnabled?: boolean;
  avatarUrl?: string | null;
  avatarBlobName?: string | null;
  trustworthinessScore?: number;
  rentPostingsCount?: number;
  availableRentPostingsCount?: number;
}

export interface ListProfilesInput {
  page: number;
  pageSize: number;
  query?: string;
}

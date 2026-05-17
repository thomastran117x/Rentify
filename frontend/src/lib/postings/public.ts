import { cache } from "react";
import { readJson, unwrapApiResponse } from "../api/response.ts";
import type { ApiErrorResponse } from "../auth/types.ts";
import { resolveApiBaseUrl } from "../env.ts";

export type PublicPostingDetailValue = string | number | boolean | string[];

export interface PublicPostingPhoto {
  id: string;
  blobUrl: string;
  blobName: string;
  thumbnailBlobUrl?: string;
  thumbnailBlobName?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPostingDetail {
  id: string;
  ownerId: string;
  status: "published";
  variant: {
    family: string;
    subtype: string;
  };
  name: string;
  description: string;
  pricing: {
    currency: string;
    daily: {
      amount: number;
    };
    hourly?: {
      amount: number;
    };
    weekly?: {
      amount: number;
    };
    monthly?: {
      amount: number;
    };
  };
  pricingCurrency: string;
  photos: PublicPostingPhoto[];
  tags: string[];
  details: Record<string, PublicPostingDetailValue>;
  availabilityStatus: "available" | "limited" | "unavailable";
  availabilityNotes?: string;
  maxBookingDurationDays?: number;
  effectiveMaxBookingDurationDays: number;
  availabilityBlocks: Array<{
    id: string;
    startAt: string;
    endAt: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  location: {
    city: string;
    region: string;
    country: string;
    postalCode?: string;
    latitude: number;
    longitude: number;
  };
  primaryPhotoUrl?: string;
  primaryThumbnailUrl?: string;
  publishedAt?: string;
  pausedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  viewerReviewState?: {
    eligible: boolean;
    hasOwnReview: boolean;
  };
}

export class PublicPostingDetailError extends Error {
  readonly debug: {
    requestUrl: string;
    postingId: string;
    status?: number;
    statusText?: string;
    responseBody?: unknown;
    causeMessage?: string;
  };

  constructor(
    message: string,
    debug: {
      requestUrl: string;
      postingId: string;
      status?: number;
      statusText?: string;
      responseBody?: unknown;
      causeMessage?: string;
    },
  ) {
    super(message);
    this.name = "PublicPostingDetailError";
    this.debug = debug;
  }
}

export async function fetchPublicPostingDetail(postingId: string): Promise<PublicPostingDetail> {
  const requestUrl = `${resolveApiBaseUrl()}/postings/${encodeURIComponent(postingId)}`;

  try {
    const response = await fetch(requestUrl, {
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = (await readJson(response).catch(() => null)) as
      | ApiErrorResponse
      | { data: PublicPostingDetail }
      | null;

    if (!response.ok) {
      throw new PublicPostingDetailError(
        (payload && "message" in payload && payload.message) || "Unable to load posting.",
        {
          requestUrl,
          postingId,
          status: response.status,
          statusText: response.statusText,
          responseBody: payload,
        },
      );
    }

    return unwrapApiResponse<PublicPostingDetail>(payload);
  } catch (error) {
    if (error instanceof PublicPostingDetailError) {
      throw error;
    }

    throw new PublicPostingDetailError("Unable to load posting.", {
      requestUrl,
      postingId,
      causeMessage: error instanceof Error ? error.message : "Unknown fetch failure.",
    });
  }
}

export const getPublicPostingDetail = cache(fetchPublicPostingDetail);

export function isPublicPostingDetailNotFoundError(error: unknown): boolean {
  return error instanceof PublicPostingDetailError && error.debug.status === 404;
}

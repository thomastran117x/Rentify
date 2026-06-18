import { cache } from "react";
import {
  buildPathWithQuery,
  optionalAuthJson,
  publicJson,
} from "../api/client.ts";
import { ApiError } from "../api/types.ts";

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
  organizationId: string;
  organization?: {
    id: string;
    name: string;
  };
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

function toApiDebug(error: ApiError): {
  status?: number;
  responseBody?: unknown;
  causeMessage?: string;
} {
  return {
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.details !== undefined ? { responseBody: error.details } : {}),
    ...(error.cause instanceof Error
      ? { causeMessage: error.cause.message }
      : {}),
  };
}

export async function fetchPublicPostingDetail(
  postingId: string,
): Promise<PublicPostingDetail> {
  const requestUrl = `/postings/${encodeURIComponent(postingId)}`;

  try {
    return await optionalAuthJson<PublicPostingDetail>("GET", requestUrl);
  } catch (error) {
    if (error instanceof PublicPostingDetailError) {
      throw error;
    }

    if (error instanceof ApiError) {
      throw new PublicPostingDetailError(error.message, {
        requestUrl,
        postingId,
        ...toApiDebug(error),
      });
    }

    throw new PublicPostingDetailError("Unable to load posting.", {
      requestUrl,
      postingId,
      causeMessage:
        error instanceof Error ? error.message : "Unknown fetch failure.",
    });
  }
}

export const getPublicPostingDetail = cache(fetchPublicPostingDetail);

export interface PublicPostingReviewRecord {
  id: string;
  postingId: string;
  reviewerId: string;
  rating: number;
  title?: string;
  comment?: string;
  reviewer: {
    username?: string;
    avatarUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ListPublicPostingReviewsResult {
  reviews: PublicPostingReviewRecord[];
  summary: {
    averageRating: number;
    reviewCount: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export async function fetchPublicPostingReviews(
  postingId: string,
  page = 1,
  pageSize = 5,
): Promise<ListPublicPostingReviewsResult> {
  const requestUrl = buildPathWithQuery(
    `/postings/${encodeURIComponent(postingId)}/reviews`,
    {
      page,
      pageSize,
    },
  );

  try {
    return await publicJson<ListPublicPostingReviewsResult>("GET", requestUrl);
  } catch (error) {
    if (error instanceof PublicPostingDetailError) {
      throw error;
    }

    if (error instanceof ApiError) {
      throw new PublicPostingDetailError(error.message, {
        requestUrl,
        postingId,
        ...toApiDebug(error),
      });
    }

    throw new PublicPostingDetailError("Unable to load posting reviews.", {
      requestUrl,
      postingId,
      causeMessage:
        error instanceof Error ? error.message : "Unknown fetch failure.",
    });
  }
}

export function isPublicPostingDetailNotFoundError(error: unknown): boolean {
  return (
    error instanceof PublicPostingDetailError && error.debug.status === 404
  );
}

import { buildPathWithQuery, publicJson } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

export type PostingSort =
  | "relevance"
  | "newest"
  | "oldest"
  | "dailyPrice"
  | "nearest"
  | "nameAsc"
  | "nameDesc";

export interface PublicPostingSearchParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: PostingSort;
  family?: string;
  subtype?: string;
  tags?: string[];
  availabilityStatus?: "available" | "limited" | "unavailable";
  minDailyPrice?: number;
  maxDailyPrice?: number;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  startAt?: string;
  endAt?: string;
}

export interface PublicPostingSearchResult {
  postings: PublicPostingSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  source: "elasticsearch" | "database";
  query?: string;
}

export interface PublicPostingAutocompleteParams {
  q: string;
  family?: string;
  subtype?: string;
  limit?: number;
}

export interface PostingAutocompleteSuggestion {
  value: string;
  kind: "name" | "tag" | "location";
}

export interface PublicPostingAutocompleteResult {
  query: string;
  suggestions: PostingAutocompleteSuggestion[];
  source: "elasticsearch" | "database";
}

export interface PublicPostingSummary {
  id: string;
  name: string;
  description: string;
  primaryPhotoUrl?: string;
  primaryThumbnailUrl?: string;
  variant: {
    family: string;
    subtype: string;
  };
  pricing: {
    currency: string;
    daily: {
      amount: number;
    };
  };
  location: {
    city: string;
    region: string;
    country: string;
  };
  tags: string[];
  availabilityStatus: "available" | "limited" | "unavailable";
  publishedAt?: string;
}

export class PublicPostingSearchError extends Error {
  constructor(
    message: string,
    readonly debug: {
      requestUrl: string;
      params: PublicPostingSearchParams;
      status?: number;
      statusText?: string;
      responseBody?: unknown;
      causeMessage?: string;
    },
  ) {
    super(message);
    this.name = "PublicPostingSearchError";
  }
}

export class PublicPostingAutocompleteError extends Error {
  constructor(
    message: string,
    readonly debug: {
      requestUrl: string;
      params: PublicPostingAutocompleteParams;
      status?: number;
      statusText?: string;
      responseBody?: unknown;
      causeMessage?: string;
    },
  ) {
    super(message);
    this.name = "PublicPostingAutocompleteError";
  }
}

export async function searchPublicPostings(
  params: PublicPostingSearchParams,
): Promise<PublicPostingSearchResult> {
  try {
    return await publicJson<PublicPostingSearchResult>(
      "GET",
      buildPathWithQuery("/postings", params),
    );
  } catch (error) {
    if (error instanceof PublicPostingSearchError) {
      throw error;
    }

    if (error instanceof ApiError) {
      const typedError = new PublicPostingSearchError(error.message, {
        requestUrl: buildPathWithQuery("/postings", params),
        params,
        status: error.status,
        responseBody: error.details,
      });
      console.error("Public postings search request failed", typedError.debug);
      throw typedError;
    }

    const debug = {
      requestUrl: buildPathWithQuery("/postings", params),
      params,
      ...(error instanceof Error && "status" in error
        ? { status: Number(error.status) }
        : {}),
      causeMessage:
        error instanceof Error ? error.message : "Unknown fetch failure.",
    };
    console.error(
      "Public postings search fetch threw before a response was received",
      debug,
    );

    throw new PublicPostingSearchError("Unable to load postings.", debug);
  }
}

export async function fetchPublicPostingAutocomplete(
  params: PublicPostingAutocompleteParams,
  options?: {
    signal?: AbortSignal;
  },
): Promise<PublicPostingAutocompleteResult> {
  if (options?.signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  try {
    return await publicJson<PublicPostingAutocompleteResult>(
      "GET",
      buildPathWithQuery("/postings/autocomplete", params),
      undefined,
      undefined,
      options?.signal,
    );
  } catch (error) {
    if (error instanceof PublicPostingAutocompleteError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    if (error instanceof ApiError) {
      throw new PublicPostingAutocompleteError(error.message, {
        requestUrl: buildPathWithQuery("/postings/autocomplete", params),
        params,
        status: error.status,
        responseBody: error.details,
      });
    }

    throw new PublicPostingAutocompleteError(
      "Unable to load posting suggestions.",
      {
        requestUrl: buildPathWithQuery("/postings/autocomplete", params),
        params,
        causeMessage:
          error instanceof Error ? error.message : "Unknown fetch failure.",
      },
    );
  }
}

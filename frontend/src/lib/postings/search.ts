import { readJson, unwrapApiResponse } from "@/lib/api/response";
import type { ApiErrorResponse } from "@/lib/auth/types";
import { resolveApiBaseUrl } from "@/lib/env";

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

function toQueryString(params: PublicPostingSearchParams): string {
  const searchParams = new URLSearchParams();

  if (params.page) searchParams.set("page", String(params.page));
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params.q) searchParams.set("q", params.q);
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.family) searchParams.set("family", params.family);
  if (params.subtype) searchParams.set("subtype", params.subtype);
  if (params.tags) {
    for (const tag of params.tags) searchParams.append("tags", tag);
  }
  if (params.availabilityStatus)
    searchParams.set("availabilityStatus", params.availabilityStatus);
  if (params.minDailyPrice !== undefined)
    searchParams.set("minDailyPrice", String(params.minDailyPrice));
  if (params.maxDailyPrice !== undefined)
    searchParams.set("maxDailyPrice", String(params.maxDailyPrice));
  if (params.latitude !== undefined)
    searchParams.set("latitude", String(params.latitude));
  if (params.longitude !== undefined)
    searchParams.set("longitude", String(params.longitude));
  if (params.radiusKm !== undefined)
    searchParams.set("radiusKm", String(params.radiusKm));
  if (params.startAt) searchParams.set("startAt", params.startAt);
  if (params.endAt) searchParams.set("endAt", params.endAt);

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function toAutocompleteQueryString(
  params: PublicPostingAutocompleteParams,
): string {
  const searchParams = new URLSearchParams();

  if (params.q) searchParams.set("q", params.q);
  if (params.family) searchParams.set("family", params.family);
  if (params.subtype) searchParams.set("subtype", params.subtype);
  if (params.limit !== undefined)
    searchParams.set("limit", String(params.limit));

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function isLoopbackHost(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function resolvePostingApiBaseUrl(): string {
  const baseUrl = resolveApiBaseUrl();

  if (typeof window === "undefined") {
    return baseUrl;
  }

  try {
    const url = new URL(baseUrl);
    const browserHostname = window.location.hostname.trim().toLowerCase();

    if (
      isLoopbackHost(url.hostname) &&
      isLoopbackHost(browserHostname) &&
      url.hostname.toLowerCase() !== browserHostname
    ) {
      url.hostname = browserHostname;
      return url.toString().replace(/\/+$/, "");
    }

    return baseUrl;
  } catch {
    return baseUrl;
  }
}

export async function searchPublicPostings(
  params: PublicPostingSearchParams,
): Promise<PublicPostingSearchResult> {
  const requestUrl = `${resolvePostingApiBaseUrl()}/postings${toQueryString(params)}`;

  try {
    const response = await fetch(requestUrl, {
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = (await readJson(response).catch(() => null)) as
      | ApiErrorResponse
      | { data: PublicPostingSearchResult }
      | null;

    if (!response.ok) {
      const error = new PublicPostingSearchError(
        (payload && "message" in payload && payload.message) ||
          "Unable to load postings.",
        {
          requestUrl,
          params,
          status: response.status,
          statusText: response.statusText,
          responseBody: payload,
        },
      );

      console.error("Public postings search request failed", error.debug);
      throw error;
    }

    return unwrapApiResponse<PublicPostingSearchResult>(payload);
  } catch (error) {
    if (error instanceof PublicPostingSearchError) {
      throw error;
    }

    const debug = {
      requestUrl,
      params,
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
  const requestUrl = `${resolvePostingApiBaseUrl()}/postings/autocomplete${toAutocompleteQueryString(params)}`;

  try {
    const response = await fetch(requestUrl, {
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
      signal: options?.signal,
    });

    const payload = (await readJson(response).catch(() => null)) as
      | ApiErrorResponse
      | { data: PublicPostingAutocompleteResult }
      | null;

    if (!response.ok) {
      throw new PublicPostingAutocompleteError(
        (payload && "message" in payload && payload.message) ||
          "Unable to load posting suggestions.",
        {
          requestUrl,
          params,
          status: response.status,
          statusText: response.statusText,
          responseBody: payload,
        },
      );
    }

    return unwrapApiResponse<PublicPostingAutocompleteResult>(payload);
  } catch (error) {
    if (error instanceof PublicPostingAutocompleteError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw new PublicPostingAutocompleteError(
      "Unable to load posting suggestions.",
      {
        requestUrl,
        params,
        causeMessage:
          error instanceof Error ? error.message : "Unknown fetch failure.",
      },
    );
  }
}

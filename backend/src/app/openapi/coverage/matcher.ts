import type { OperationCatalogEntry } from "@/openapi/coverage/catalog";
import {
  splitPathSegments,
  WILDCARD_SEGMENT,
  type HttpMethod,
  type PathSegment,
} from "@/openapi/coverage/shared";
import type {
  RequestSite,
  ResolvedRequest,
} from "@/openapi/coverage/request-sites";

export type MatchQuality = "exact" | "wildcard-fallback";

export interface SiteMatch {
  readonly site: RequestSite;
  readonly operationKeys: readonly string[];
  readonly quality: MatchQuality;
  readonly ambiguous: boolean;
  /** Requests that matched no operation: likely a typo or a removed route. */
  readonly unmatchedRequests: readonly ResolvedRequest[];
}

function segmentsCompatible(
  requestSegment: string,
  operationSegment: PathSegment,
  strict: boolean,
): boolean {
  if (requestSegment === WILDCARD_SEGMENT) {
    // A hole holds a runtime value, so it should credit a parameterised
    // operation and not a sibling static route such as `/postings/saved`.
    return operationSegment.kind === "parameter" || !strict;
  }

  return operationSegment.kind === "parameter"
    ? true
    : operationSegment.value === requestSegment;
}

function scoreCandidate(
  requestSegments: readonly string[],
  operation: OperationCatalogEntry,
): number {
  let score = 0;
  requestSegments.forEach((segment, index) => {
    const operationSegment = operation.segments[index];
    if (
      operationSegment &&
      operationSegment.kind === "literal" &&
      segment !== WILDCARD_SEGMENT
    ) {
      score += 1;
    }
  });
  return score;
}

function matchOne(
  method: HttpMethod,
  pattern: string,
  catalog: readonly OperationCatalogEntry[],
): { keys: string[]; quality: MatchQuality; ambiguous: boolean } {
  const requestSegments = splitPathSegments(pattern).map((segment) =>
    segment.kind === "literal" ? segment.value : `{${segment.name}}`,
  );

  const filter = (strict: boolean): OperationCatalogEntry[] =>
    catalog.filter(
      (operation) =>
        operation.method === method &&
        operation.segments.length === requestSegments.length &&
        requestSegments.every((segment, index) =>
          segmentsCompatible(segment, operation.segments[index]!, strict),
        ),
    );

  let quality: MatchQuality = "exact";
  let candidates = filter(true);

  if (candidates.length === 0) {
    candidates = filter(false);
    quality = "wildcard-fallback";
  }

  if (candidates.length === 0) {
    return { keys: [], quality, ambiguous: false };
  }

  // Mirrors Hono dispatch: a static segment beats a parameter, so
  // `/postings/saved` credits the literal route rather than `/postings/{id}`.
  const bestScore = Math.max(
    ...candidates.map((operation) =>
      scoreCandidate(requestSegments, operation),
    ),
  );
  const winners = candidates.filter(
    (operation) => scoreCandidate(requestSegments, operation) === bestScore,
  );

  return {
    keys: winners.map((operation) => operation.key),
    quality,
    ambiguous: winners.length > 1,
  };
}

export function matchRequestSites(
  sites: readonly RequestSite[],
  catalog: readonly OperationCatalogEntry[],
): SiteMatch[] {
  return sites.map((site) => {
    if (site.resolution === "unresolved") {
      return {
        site,
        operationKeys: [],
        quality: "exact" as const,
        ambiguous: false,
        unmatchedRequests: [],
      };
    }

    const keys = new Set<string>();
    const unmatchedRequests: ResolvedRequest[] = [];
    let quality: MatchQuality = "exact";
    let ambiguous = false;

    for (const request of site.requests) {
      const result = matchOne(request.method, request.pathPattern, catalog);

      if (result.keys.length === 0) {
        unmatchedRequests.push(request);
        continue;
      }

      result.keys.forEach((key) => keys.add(key));

      if (result.quality === "wildcard-fallback") {
        quality = "wildcard-fallback";
      }
      if (result.ambiguous) {
        ambiguous = true;
      }
    }

    return {
      site,
      operationKeys: [...keys],
      quality,
      ambiguous,
      unmatchedRequests,
    };
  });
}

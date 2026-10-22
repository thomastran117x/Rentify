import { describe, expect, it } from "vitest";
import { ApiClientError, ApiServerError } from "@/lib/api/types";
import { toActivityDateRange } from "@/lib/security-activity/format";
import {
  EMPTY_FILTERS,
  EVENT_TYPE_GROUPS,
  describeUser,
  eventTypeLabel,
  filtersToSearchParams,
  hasInvertedDateRange,
  isForbiddenError,
  isNotFoundError,
  readFiltersFromSearchParams,
  toListInput,
  validationMessage,
} from "@/lib/admin-security/format";
import { AUTH_AUDIT_EVENT_TYPES } from "@/lib/admin-security/types";

const REQUEST = {
  method: "GET",
  path: "/admin/auth/audit",
  requestUrl: "http://localhost:8040/api/v1/admin/auth/audit",
};

function clientError(status: number, details?: unknown) {
  return new ApiClientError("Request query validation failed.", {
    code: status === 400 ? "VALIDATION_ERROR" : "FORBIDDEN",
    status,
    details,
    request: REQUEST,
  });
}

describe("eventTypeLabel", () => {
  it("names every known event type and shows unknown ones as stored", () => {
    for (const eventType of AUTH_AUDIT_EVENT_TYPES) {
      expect(eventTypeLabel(eventType)).not.toBe(eventType);
    }

    expect(eventTypeLabel("login.failed")).toBe("Sign-in failed");
    expect(eventTypeLabel("future.event")).toBe("future.event");
  });

  it("offers every event type in exactly one filter group", () => {
    const grouped = EVENT_TYPE_GROUPS.flatMap((group) => group.types);

    expect([...grouped].sort()).toEqual([...AUTH_AUDIT_EVENT_TYPES].sort());
  });
});

describe("describeUser", () => {
  it("prefers the username and falls back to the email", () => {
    expect(
      describeUser({ id: "1", email: "a@example.com", username: "alpha" }),
    ).toBe("alpha");
    expect(
      describeUser({ id: "1", email: "a@example.com", username: null }),
    ).toBe("a@example.com");
  });
});

describe("filters in the URL", () => {
  it("round-trips every filter, repeating eventType", () => {
    const filters = {
      user: "renter-one",
      ip: "203.0.113.7",
      eventTypes: ["login.failed" as const, "login.locked" as const],
      outcome: "failure" as const,
      fromDate: "2026-10-01",
      toDate: "2026-10-08",
    };
    const params = filtersToSearchParams(filters);

    expect(params.toString()).toBe(
      "user=renter-one&ip=203.0.113.7&eventType=login.failed&eventType=login.locked&outcome=failure&from=2026-10-01&to=2026-10-08",
    );
    expect(readFiltersFromSearchParams(params)).toEqual(filters);
  });

  it("leaves empty filters out of the URL", () => {
    expect(filtersToSearchParams(EMPTY_FILTERS).toString()).toBe("");
    expect(
      filtersToSearchParams({ ...EMPTY_FILTERS, user: "   " }).toString(),
    ).toBe("");
  });

  it("drops unknown or malformed values read from the URL", () => {
    expect(
      readFiltersFromSearchParams(
        new URLSearchParams(
          "user=%20x%20&eventType=login.failed&eventType=login.failed&eventType=nope&outcome=maybe&from=2026-02-31&to=soon",
        ),
      ),
    ).toEqual({
      ...EMPTY_FILTERS,
      user: "x",
      eventTypes: ["login.failed"],
    });
  });
});

describe("hasInvertedDateRange", () => {
  it("is true only when both dates are set and To is before From", () => {
    expect(
      hasInvertedDateRange({ fromDate: "2026-10-08", toDate: "2026-10-01" }),
    ).toBe(true);
    expect(
      hasInvertedDateRange({ fromDate: "2026-10-01", toDate: "2026-10-01" }),
    ).toBe(false);
    expect(hasInvertedDateRange({ fromDate: "2026-10-08", toDate: "" })).toBe(
      false,
    );
  });
});

describe("toListInput", () => {
  it("sends nothing but the page size for empty filters", () => {
    expect(toListInput(EMPTY_FILTERS)).toEqual({
      user: undefined,
      ip: undefined,
      eventType: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
      limit: 25,
    });
  });

  it("turns whole local days into the API's bounds and passes the cursor", () => {
    expect(
      toListInput(
        {
          user: " renter-one ",
          ip: "203.0.113.7",
          eventTypes: ["login.failed"],
          outcome: "blocked",
          fromDate: "2026-10-01",
          toDate: "2026-10-08",
        },
        "cursor-1",
      ),
    ).toEqual({
      user: "renter-one",
      ip: "203.0.113.7",
      eventType: ["login.failed"],
      outcome: "blocked",
      ...toActivityDateRange("2026-10-01", "2026-10-08"),
      cursor: "cursor-1",
      limit: 25,
    });
  });
});

describe("error helpers", () => {
  it("recognises 403 and 404 client errors only", () => {
    expect(isForbiddenError(clientError(403))).toBe(true);
    expect(isForbiddenError(clientError(404))).toBe(false);
    expect(isNotFoundError(clientError(404))).toBe(true);
    expect(isNotFoundError(new Error("boom"))).toBe(false);
  });

  it("reads the first field message of a 400 without backticks", () => {
    expect(
      validationMessage(
        clientError(400, {
          ip: ["`ip` must be an IPv4 or IPv6 address."],
        }),
      ),
    ).toBe("ip must be an IPv4 or IPv6 address.");
  });

  it("falls back to the error message for a 400 without field details", () => {
    expect(validationMessage(clientError(400, { unexpected: true }))).toBe(
      "Request query validation failed.",
    );
    expect(validationMessage(clientError(400, ["not", "fields"]))).toBe(
      "Request query validation failed.",
    );
    expect(validationMessage(clientError(400))).toBe(
      "Request query validation failed.",
    );
  });

  it("is null for anything but a 400", () => {
    expect(validationMessage(clientError(403))).toBeNull();
    expect(
      validationMessage(
        new ApiServerError("Server error", {
          code: "INTERNAL",
          status: 500,
          request: REQUEST,
        }),
      ),
    ).toBeNull();
  });
});

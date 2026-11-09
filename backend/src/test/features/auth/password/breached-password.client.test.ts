import { createHash } from "node:crypto";
import { PwnedPasswordsClient } from "@/features/auth/password/policy/breached-password.client";

const PASSWORD = "tidal-harbor-lantern";
const HASH = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();
const PREFIX = HASH.slice(0, 5);
const SUFFIX = HASH.slice(5);

function rangeBody(rows: string[]): string {
  return rows.join("\r\n");
}

describe("PwnedPasswordsClient", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function respond(body: string, status = 200) {
    fetchSpy.mockResolvedValue(new Response(body, { status }));
  }

  it("sends only the five-character prefix, with padding requested", async () => {
    respond(rangeBody(["0018A45C4D1DEF81644B54AB7F969B88D65:1"]));

    await new PwnedPasswordsClient({ getTimeoutMs: () => 1_000 }).check(
      PASSWORD,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    const requested = String(url);
    expect(requested).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    // Nothing past the prefix, and never the password, leaves the server.
    expect(requested).not.toContain(SUFFIX);
    expect(requested).not.toContain(PASSWORD);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toMatchObject({ "add-padding": "true" });
    expect(JSON.stringify(init?.headers)).not.toContain(SUFFIX);
  });

  it("reports a breach with its count when the suffix is listed", async () => {
    respond(
      rangeBody([
        "0018A45C4D1DEF81644B54AB7F969B88D65:1",
        `${SUFFIX.toLowerCase()}:2741`,
      ]),
    );

    await expect(new PwnedPasswordsClient().check(PASSWORD)).resolves.toEqual({
      status: "breached",
      count: 2741,
    });
  });

  it("treats a padding row (count 0) as clean", async () => {
    respond(rangeBody([`${SUFFIX}:0`]));

    await expect(new PwnedPasswordsClient().check(PASSWORD)).resolves.toEqual({
      status: "clean",
    });
  });

  it("reports clean when the suffix is absent", async () => {
    respond(rangeBody(["0018A45C4D1DEF81644B54AB7F969B88D65:12", ""]));

    await expect(new PwnedPasswordsClient().check(PASSWORD)).resolves.toEqual({
      status: "clean",
    });
  });

  it("treats an unreadable count as clean", async () => {
    respond(rangeBody([`${SUFFIX}:lots`]));

    await expect(new PwnedPasswordsClient().check(PASSWORD)).resolves.toEqual({
      status: "clean",
    });
  });

  it("reports an HTTP error as unavailable", async () => {
    respond("Service unavailable", 503);

    await expect(new PwnedPasswordsClient().check(PASSWORD)).resolves.toEqual({
      status: "unavailable",
      reason: "http",
    });
  });

  it("reports a network error as unavailable", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));

    await expect(new PwnedPasswordsClient().check(PASSWORD)).resolves.toEqual({
      status: "unavailable",
      reason: "network",
    });
  });

  it("gives up after the configured timeout", async () => {
    jest.useFakeTimers();
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = new PwnedPasswordsClient({
      getTimeoutMs: () => 250,
    }).check(PASSWORD);
    await jest.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toEqual({
      status: "unavailable",
      reason: "timeout",
    });
  });
});

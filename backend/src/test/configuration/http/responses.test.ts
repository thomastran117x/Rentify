import type { AppBindings } from "@/configuration/http/bindings";
import type { Context } from "hono";
import {
  paginationMeta,
  pickMeta,
  created,
  accepted,
} from "@/configuration/http/responses";

function fakeContext(): Context<AppBindings> {
  return {
    get: (name: string) => (name === "requestId" ? "req-1" : undefined),
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status: status as number,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as Context<AppBindings>;
}

describe("responses helpers", () => {
  describe("paginationMeta", () => {
    it("returns undefined when value is not a record", () => {
      expect(paginationMeta(42)).toBeUndefined();
      expect(paginationMeta(null)).toBeUndefined();
      expect(paginationMeta("string")).toBeUndefined();
    });

    it("returns undefined when the record has no pagination key", () => {
      expect(paginationMeta({ other: true })).toBeUndefined();
    });

    it("returns pagination wrapper when the record contains pagination", () => {
      const pagination = { page: 1, total: 5 };
      expect(paginationMeta({ pagination })).toEqual({ pagination });
    });
  });

  describe("pickMeta", () => {
    it("returns undefined when value is not a record", () => {
      expect(pickMeta(null, ["foo"])).toBeUndefined();
      expect(pickMeta(42, ["foo"])).toBeUndefined();
    });

    it("returns matching keys from the record", () => {
      const result = pickMeta({ foo: 1, bar: 2 }, ["foo"]);
      expect(result).toEqual({ foo: 1 });
    });

    it("returns undefined when none of the requested keys exist", () => {
      expect(pickMeta({ other: 1 }, ["missing"])).toBeUndefined();
    });
  });

  describe("created — default message (status 201)", () => {
    it("uses the default 201 message when no options are passed", async () => {
      const ctx = fakeContext();
      const response = created(ctx, { id: "new-1" });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.message).toBe("Resource created successfully.");
    });
  });

  describe("accepted — default message (status 202)", () => {
    it("uses the default 202 message when no options are passed", async () => {
      const ctx = fakeContext();
      const response = accepted(ctx, { queued: true });
      const body = await response.json();

      expect(response.status).toBe(202);
      expect(body.message).toBe("Request accepted successfully.");
    });
  });
});

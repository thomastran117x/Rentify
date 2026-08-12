import {
  paginationMeta,
  pickMeta,
  created,
  accepted,
} from "@/configuration/http/responses";
import { createMockRequest, createMockResponse } from "../../support/mock-http";

function fakeResponse() {
  const recorder = createMockResponse();
  (recorder.response as { req?: unknown }).req = createMockRequest({
    state: { requestId: "req-1" },
  });

  return recorder;
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
    it("uses the default 201 message when no options are passed", () => {
      const recorder = fakeResponse();
      created(recorder.response, { id: "new-1" });

      expect(recorder.status()).toBe(201);
      expect(recorder.json()).toMatchObject({
        message: "Resource created successfully.",
        meta: { requestId: "req-1" },
      });
    });
  });

  describe("accepted — default message (status 202)", () => {
    it("uses the default 202 message when no options are passed", () => {
      const recorder = fakeResponse();
      accepted(recorder.response, { queued: true });

      expect(recorder.status()).toBe(202);
      expect(recorder.json()).toMatchObject({
        message: "Request accepted successfully.",
      });
    });
  });
});

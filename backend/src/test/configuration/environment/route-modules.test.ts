import { parseDisabledRouteModuleIds } from "@/configuration/bootstrap/routes/config";

describe("route module environment parsing", () => {
  it("defaults to no disabled route modules", () => {
    expect(parseDisabledRouteModuleIds().disabledIds).toEqual([]);
  });

  it("normalizes duplicates and whitespace in DISABLED_ROUTE_MODULES", () => {
    expect(
      parseDisabledRouteModuleIds(" blob, auth-local ,blob,postings-public ")
        .disabledIds,
    ).toEqual(["blob", "auth-local", "postings-public"]);
  });

  it("returns invalid route module ids separately", () => {
    expect(parseDisabledRouteModuleIds("blob,unknown-module")).toEqual({
      disabledIds: ["blob"],
      invalidIds: ["unknown-module"],
    });
  });
});

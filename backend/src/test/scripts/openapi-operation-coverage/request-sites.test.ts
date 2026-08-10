import {
  extractRequestSites,
  type SourceDocument,
} from "@/openapi/coverage/request-sites";

const COMPOSITION = `const app = await createPersistenceTestApp();`;

function document(
  body: string,
  path = "src/test/features/demo/demo.routes.integration.test.ts",
): SourceDocument {
  return { path, source: `${COMPOSITION}\n${body}` };
}

function sitesOf(body: string, path?: string) {
  return extractRequestSites([document(body, path)]).sites;
}

function requestsOf(body: string, path?: string) {
  return sitesOf(body, path).flatMap((site) =>
    site.requests.map((request) => `${request.method} ${request.pathPattern}`),
  );
}

describe("extractRequestSites", () => {
  it("resolves the canonical buildApiPath idiom and drops the query string", () => {
    expect(
      requestsOf(
        'app.request(`http://rent.test${buildApiPath("/postings/saved?page=2&pageSize=5")}`);',
      ),
    ).toEqual(["GET /postings/saved"]);
  });

  it("turns a template hole into a wildcard segment", () => {
    expect(
      requestsOf(
        'app.request(`http://rent.test${buildApiPath(`/postings/${postingId}/reviews`)}`, { method: "POST" });',
      ),
    ).toEqual(["POST /postings/*/reviews"]);
  });

  it("defaults to GET when there is no init object or no method key", () => {
    expect(
      requestsOf(
        'app.request(`http://rent.test${buildApiPath("/postings")}`);',
      ),
    ).toEqual(["GET /postings"]);

    expect(
      requestsOf(
        'app.request(`http://rent.test${buildApiPath("/postings")}`, { headers: {} });',
      ),
    ).toEqual(["GET /postings"]);
  });

  it("reads the method from a shorthand property", () => {
    expect(
      requestsOf(
        'const method = "DELETE";\napp.request(`http://rent.test${buildApiPath("/postings/x/save")}`, { method });',
      ),
    ).toEqual(["DELETE /postings/x/save"]);
  });

  it("collapses a partially literal segment into a wildcard", () => {
    expect(
      requestsOf(
        "app.request(`http://rent.test${buildApiPath(`/postings/id-${suffix}`)}`);",
      ),
    ).toEqual(["GET /postings/*"]);
  });

  it("resolves a path held in a single-assignment const", () => {
    expect(
      requestsOf(
        'const ownReviewPath = buildApiPath("/postings/abc/reviews/me");\n' +
          "app.request(`http://rent.test${ownReviewPath}`);",
      ),
    ).toEqual(["GET /postings/abc/reviews/me"]);
  });

  it("expands an it.each table by row rather than by cross product", () => {
    const requests = requestsOf(
      "it.each([\n" +
        '  ["GET", "/postings/saved"],\n' +
        '  ["POST", "/postings/p1/save"],\n' +
        '  ["DELETE", "/postings/p1/save"],\n' +
        '])("%s %s", async (method, path) => {\n' +
        "  await app.request(`http://rent.test${buildApiPath(path)}`, { method });\n" +
        "});",
    );

    expect(requests).toEqual([
      "GET /postings/saved",
      "POST /postings/p1/save",
      "DELETE /postings/p1/save",
    ]);
  });

  it("resolves an each table whose other columns are not literals", () => {
    const requests = requestsOf(
      "it.each([\n" +
        '  ["Bookings", token, new BookingsController(stub), "/booking-requests/me", "GET"],\n' +
        '  ["Sms", token, new SmsController(stub), "/sms/webhooks/telnyx", "POST"],\n' +
        '])("%s", async (_, token, controller, path, method) => {\n' +
        "  await app.request(`http://rent.test${buildApiPath(path)}`, { method });\n" +
        "});",
    );

    expect(requests).toEqual([
      "GET /booking-requests/me",
      "POST /sms/webhooks/telnyx",
    ]);
  });

  describe("local request helpers", () => {
    it("resolves a helper's path parameter from its call sites", () => {
      const requests = requestsOf(
        "function send(path, init) {\n" +
          "  return app.request(`http://rent.test${buildApiPath(path)}`, init);\n" +
          "}\n" +
          'send("/organizations/me");\n' +
          'send("/organizations/me/active", { method: "POST" });',
      );

      expect(requests).toEqual([
        "GET /organizations/me",
        "POST /organizations/me/active",
      ]);
    });

    it("treats an omitted init argument as GET", () => {
      expect(
        requestsOf(
          "const send = (path, init = {}) =>\n" +
            "  app.request(`http://rent.test${buildApiPath(path)}`, init);\n" +
            'send("/blog");',
        ),
      ).toEqual(["GET /blog"]);
    });

    it("keeps each call site's path and method correlated", () => {
      const requests = requestsOf(
        "function send(path, init) {\n" +
          "  return app.request(`http://rent.test${buildApiPath(path)}`, init);\n" +
          "}\n" +
          'send("/a", { method: "DELETE" });\n' +
          'send("/b", { method: "PATCH" });',
      );

      expect(requests).toEqual(["DELETE /a", "PATCH /b"]);
      expect(requests).not.toContain("DELETE /b");
      expect(requests).not.toContain("PATCH /a");
    });

    it("resolves interpolated paths passed through a helper", () => {
      expect(
        requestsOf(
          "function send(path) {\n" +
            "  return app.request(`http://rent.test${buildApiPath(path)}`);\n" +
            "}\n" +
            "send(`/organizations/${orgId}/workspace`);",
        ),
      ).toEqual(["GET /organizations/*/workspace"]);
    });

    it("resolves a nested path that opens with an interpolation", () => {
      const requests = requestsOf(
        "function suite(basePath) {\n" +
          "  return app.request(`http://rent.test${buildApiPath(`${basePath}/status`)}`);\n" +
          "}\n" +
          'suite("/admin/organizations/search");',
      );

      expect(requests).toEqual(["GET /admin/organizations/search/status"]);
    });

    it("leaves a never-called helper unresolved", () => {
      const sites = sitesOf(
        "function send(path) {\n" +
          "  return app.request(`http://rent.test${buildApiPath(path)}`);\n" +
          "}",
      );

      expect(sites[0]!.resolution).toBe("unresolved");
    });
  });

  it("strips a hand-written API prefix", () => {
    expect(
      requestsOf('app.request("http://rent.test/api/v1/health");'),
    ).toEqual(["GET /health"]);
  });

  it.each([
    [
      "dynamic-origin",
      "app.request(`${baseUrl}${buildApiPath('/postings')}`);",
    ],
    ["unresolvable-identifier", "app.request(`http://rent.test${somePath}`);"],
    [
      "unresolvable-method",
      'app.request(`http://rent.test${buildApiPath("/postings")}`, { ...init });',
    ],
  ])("marks %s as unresolved", (reason, body) => {
    const sites = sitesOf(body);

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      resolution: "unresolved",
      unresolvedReason: reason,
      requests: [],
    });
  });

  it("drops a name declared more than once rather than guessing", () => {
    const sites = sitesOf(
      'const target = buildApiPath("/a");\n' +
        'const target = buildApiPath("/b");\n' +
        "app.request(`http://rent.test${target}`);",
    );

    expect(sites[0]!.resolution).toBe("unresolved");
  });

  it("skips files that do not mount production routes", () => {
    const result = extractRequestSites([
      {
        path: "src/test/support/helper.integration.test.ts",
        source: 'app.request("http://rent.test/api/v1/health");',
      },
    ]);

    expect(result.sites).toHaveLength(0);
    expect(result.skippedFiles).toEqual([
      {
        file: "src/test/support/helper.integration.test.ts",
        reason: "no-route-composition",
      },
    ]);
  });

  it.each([
    ["src/test/features/a/a.routes.integration.test.ts", "route-contract"],
    ["src/test/features/a/a.mocked.integration.test.ts", "route-contract"],
    ["src/test/features/a/a.integration.test.ts", "persistence"],
  ])("classifies %s as %s", (path, suite) => {
    const sites = sitesOf(
      'app.request(`http://rent.test${buildApiPath("/postings")}`);',
      path,
    );

    expect(sites[0]!.suite).toBe(suite);
  });

  it("marks configured smoke files as smoke level", () => {
    const path =
      "src/test/features/controller-coverage/registered.routes.integration.test.ts";
    const result = extractRequestSites(
      [
        document(
          'app.request(`http://rent.test${buildApiPath("/postings")}`);',
          path,
        ),
      ],
      { smokeOnlyTestFiles: [path] },
    );

    expect(result.sites[0]!.level).toBe("smoke");
  });
});

import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  detectOutputFormat,
  outputFormatMiddleware,
  serializeToXml,
} from "@/configuration/middlewares/output-format.middleware";

function createApp() {
  const app = new Hono<AppBindings>();
  app.use("*", outputFormatMiddleware);

  app.get("/json", (context) =>
    context.json({
      message: "<ok>",
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
      "123 bad key": "A&B",
      items: [1, null],
    }),
  );
  app.get("/json-like", () =>
    new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/hal+json",
        vary: "Origin",
      },
    }),
  );
  app.get("/text", () =>
    new Response("plain-text-body", {
      headers: {
        "content-type": "text/plain; charset=UTF-8",
      },
    }),
  );
  app.get("/invalid-json", () =>
    new Response("{broken-json", {
      headers: {
        "content-type": "application/json",
      },
    }),
  );
  app.get("/empty", () => new Response(null, { status: 204 }));

  return app;
}

describe("outputFormatMiddleware", () => {
  it("serializes nested values into XML with escaped content and sanitized tag names", () => {
    const xml = serializeToXml({
      message: "<ok>",
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
      "123 bad key": "A&B",
      items: [1, null],
      emptyObject: {},
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<message>&lt;ok&gt;</message>");
    expect(xml).toContain(
      "<createdAt>2026-06-07T00:00:00.000Z</createdAt>",
    );
    expect(xml).toContain("<item-123-bad-key>A&amp;B</item-123-bad-key>");
    expect(xml).toContain("<items><item>1</item><item/></items>");
    expect(xml).toContain("<emptyObject/>");
  });

  it("detects explicit and negotiated output formats", () => {
    const xmlByQuery = detectOutputFormat(
      new Request("http://rent.test/items?format=xml", {
        headers: {
          accept: "application/json",
        },
      }),
    );
    const xmlByAccept = detectOutputFormat(
      new Request("http://rent.test/items", {
        headers: {
          accept: "application/json;q=0.1, application/xml;q=0.9",
        },
      }),
    );
    const defaultJson = detectOutputFormat(
      new Request("http://rent.test/items"),
    );

    expect(xmlByQuery).toBe("xml");
    expect(xmlByAccept).toBe("xml");
    expect(defaultJson).toBe("json");
  });

  it("converts JSON responses to XML when XML is requested", async () => {
    const app = createApp();

    const response = await app.request("http://rent.test/json", {
      headers: {
        accept: "application/xml",
      },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=UTF-8",
    );
    expect(response.headers.get("vary")).toBe("Accept");
    expect(body).toContain('<message>&lt;ok&gt;</message>');
    expect(body).toContain(
      "<createdAt>2026-06-07T00:00:00.000Z</createdAt>",
    );
    expect(body).toContain("<item-123-bad-key>A&amp;B</item-123-bad-key>");
  });

  it("normalizes json-like content types and appends Accept to Vary for json responses", async () => {
    const app = createApp();

    const response = await app.request("http://rent.test/json-like?format=json");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=UTF-8",
    );
    expect(response.headers.get("vary")).toBe("Origin");
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it("preserves non-json responses for XML requests while still varying on Accept", async () => {
    const app = createApp();

    const response = await app.request("http://rent.test/text?format=xml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=UTF-8",
    );
    expect(response.headers.get("vary")).toBe("Accept");
    await expect(response.text()).resolves.toBe("plain-text-body");
  });

  it("returns an empty body when xml conversion cannot parse the original json body", async () => {
    const app = createApp();

    const response = await app.request("http://rent.test/invalid-json?format=xml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("vary")).toBe("Accept");
    await expect(response.text()).resolves.toBe("");
  });

  it("leaves bodyless responses untouched", async () => {
    const app = createApp();

    const response = await app.request("http://rent.test/empty?format=xml");

    expect(response.status).toBe(204);
    expect(response.headers.get("vary")).toBeNull();
    await expect(response.text()).resolves.toBe("");
  });
});

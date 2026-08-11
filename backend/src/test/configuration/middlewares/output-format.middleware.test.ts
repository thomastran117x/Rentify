import type { Request } from "express";
import {
  detectOutputFormat,
  outputFormatMiddleware,
  serializeToXml,
} from "@/configuration/middlewares/output-format.middleware";
import { createTestApp } from "../../support/fetch-app";

function fakeRequest(originalUrl: string, accept?: string): Request {
  const headers: Record<string, string> = { host: "rent.test" };

  if (accept) {
    headers.accept = accept;
  }

  return {
    originalUrl,
    protocol: "http",
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function createApp() {
  return createTestApp((app) => {
    app.use(outputFormatMiddleware);

    app.get("/json", (_request, response) => {
      response.json({
        message: "<ok>",
        createdAt: new Date("2026-06-07T00:00:00.000Z"),
        "123 bad key": "A&B",
        items: [1, null],
      });
    });
    app.get("/json-with-vary", (_request, response) => {
      response.setHeader("vary", "Origin");
      response.json({ ok: true });
    });
    // Written with res.send rather than res.json, so it is outside the
    // transcoding seam — the same way the OpenAPI spec files and blob
    // downloads are.
    app.get("/text", (_request, response) => {
      response.setHeader("content-type", "text/plain; charset=UTF-8");
      response.end("plain-text-body");
    });
    app.get("/empty", (_request, response) => {
      response.status(204).end();
    });
  });
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
    expect(xml).toContain("<createdAt>2026-06-07T00:00:00.000Z</createdAt>");
    expect(xml).toContain("<item-123-bad-key>A&amp;B</item-123-bad-key>");
    expect(xml).toContain("<items><item>1</item><item/></items>");
    expect(xml).toContain("<emptyObject/>");
  });

  it("detects explicit and negotiated output formats", () => {
    const xmlByQuery = detectOutputFormat(
      fakeRequest("/items?format=xml", "application/json"),
    );
    const xmlByAccept = detectOutputFormat(
      fakeRequest("/items", "application/json;q=0.1, application/xml;q=0.9"),
    );
    const defaultJson = detectOutputFormat(fakeRequest("/items"));

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
    expect(body).toContain("<message>&lt;ok&gt;</message>");
    expect(body).toContain("<createdAt>2026-06-07T00:00:00.000Z</createdAt>");
    expect(body).toContain("<item-123-bad-key>A&amp;B</item-123-bad-key>");
  });

  it("normalizes the json content type and keeps the charset upper case", async () => {
    const app = createApp();

    const response = await app.request("http://rent.test/json?format=json");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=UTF-8",
    );
    await expect(response.json()).resolves.toMatchObject({ message: "<ok>" });
  });

  it("appends Accept to an existing Vary header", async () => {
    const app = createApp();

    const response = await app.request("http://rent.test/json-with-vary");

    expect(response.headers.get("vary")).toBe("Origin, Accept");
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

  it("leaves bodyless responses untouched", async () => {
    const app = createApp();

    const response = await app.request("http://rent.test/empty?format=xml");

    expect(response.status).toBe(204);
    expect(response.headers.get("vary")).toBeNull();
    await expect(response.text()).resolves.toBe("");
  });
});

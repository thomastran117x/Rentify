import type {
  Request,
  RequestHandler,
  Response as ExpressResponse,
} from "express";
import type { OutputFormat } from "@/configuration/http/bindings";
import { getRequestUrl } from "@/configuration/http/request";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const DEFAULT_OUTPUT_FORMAT: OutputFormat = "json";

const CONTENT_TYPES: Record<OutputFormat, string> = {
  json: "application/json; charset=UTF-8",
  xml: "application/xml; charset=UTF-8",
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sanitizeXmlTagName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_.-]/g, "-");

  if (!normalized) {
    return "item";
  }

  return /^[A-Za-z_]/.test(normalized) ? normalized : `item-${normalized}`;
}

function toXmlNode(name: string, value: unknown): string {
  const tagName = sanitizeXmlTagName(name);

  if (value === null || value === undefined) {
    return `<${tagName}/>`;
  }

  if (Array.isArray(value)) {
    const children = value.map((item) => toXmlNode("item", item)).join("");
    return `<${tagName}>${children}</${tagName}>`;
  }

  if (value instanceof Date) {
    return `<${tagName}>${escapeXml(value.toISOString())}</${tagName}>`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return `<${tagName}/>`;
    }

    const children = entries
      .map(([key, childValue]) => toXmlNode(key, childValue))
      .join("");

    return `<${tagName}>${children}</${tagName}>`;
  }

  return `<${tagName}>${escapeXml(String(value))}</${tagName}>`;
}

export function serializeToXml(
  body: unknown,
  rootElement = "response",
): string {
  return `${XML_DECLARATION}${toXmlNode(rootElement, body)}`;
}

function parseAcceptHeader(acceptHeader: string | null): OutputFormat {
  const accept = acceptHeader?.toLowerCase().trim();

  if (!accept) {
    return DEFAULT_OUTPUT_FORMAT;
  }

  const acceptedTypes = accept
    .split(",")
    .map((part) => {
      const [mediaType, ...params] = part.trim().split(";");

      const qualityParam = params.find((param) =>
        param.trim().startsWith("q="),
      );

      const quality = qualityParam
        ? Number.parseFloat(qualityParam.trim().slice(2))
        : 1;

      return {
        mediaType: mediaType.trim(),
        quality: Number.isFinite(quality) ? quality : 1,
      };
    })
    .filter((item) => item.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  const preferred = acceptedTypes[0]?.mediaType;

  if (preferred === "application/xml" || preferred === "text/xml") {
    return "xml";
  }

  return DEFAULT_OUTPUT_FORMAT;
}

export function detectOutputFormat(request: Request): OutputFormat {
  const url = getRequestUrl(request);
  const explicitFormat = url.searchParams.get("format")?.trim().toLowerCase();

  if (explicitFormat === "xml") {
    return "xml";
  }

  if (explicitFormat === "json") {
    return "json";
  }

  return parseAcceptHeader(request.get("accept") ?? null);
}

function canHaveBody(status: number): boolean {
  return ![204, 205, 304].includes(status);
}

export function getContentType(format: OutputFormat): string {
  return CONTENT_TYPES[format];
}

/**
 * Writes a serialised body with an exact Content-Type.
 *
 * `res.send` would rewrite the charset to lower case ("utf-8"), changing a
 * header this API has always sent as "UTF-8". Writing through `res.end`
 * bypasses that normalisation; Content-Length is set explicitly because
 * skipping `res.send` also skips its length handling.
 */
export function writeSerializedBody(
  response: ExpressResponse,
  contentType: string,
  payload: string,
): void {
  response.setHeader("content-type", contentType);
  response.setHeader("content-length", String(Buffer.byteLength(payload)));
  response.end(payload);
}

/**
 * Negotiates the response format and, when XML was asked for, transcodes it.
 *
 * The Hono version buffered and rewrote the finished response. Express gives a
 * cleaner seam: every JSON response in this app is produced by `res.json`, so
 * overriding that one method catches all of them — success envelopes and error
 * envelopes alike — while responses written with `res.send`/`res.end` (the
 * OpenAPI spec files, blob downloads) pass through untouched. That matches the
 * old behaviour, which only ever transcoded JSON-like content types.
 */
export const outputFormatMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const outputFormat = detectOutputFormat(request);
  request.outputFormat = outputFormat;

  // Vary is applied at writeHead so the status is already known: 204/205/304
  // did not carry a Vary header before and should not start now.
  const originalWriteHead = response.writeHead.bind(response);
  response.writeHead = function patchedWriteHead(
    ...args: Parameters<typeof originalWriteHead>
  ) {
    if (canHaveBody(response.statusCode)) {
      response.vary("Accept");
    }

    return originalWriteHead(...args);
  } as typeof response.writeHead;

  response.json = function patchedJson(body: unknown) {
    const useXml = outputFormat === "xml" && canHaveBody(response.statusCode);

    writeSerializedBody(
      response,
      getContentType(useXml ? "xml" : "json"),
      useXml ? serializeToXml(body) : JSON.stringify(body),
    );

    return response;
  } as typeof response.json;

  next();
};

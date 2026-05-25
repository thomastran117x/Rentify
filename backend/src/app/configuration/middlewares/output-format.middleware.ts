import { createMiddleware } from "hono/factory";
import type { AppBindings, OutputFormat } from "@/configuration/http/bindings";

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
  const url = new URL(request.url);
  const explicitFormat = url.searchParams.get("format")?.trim().toLowerCase();

  if (explicitFormat === "xml") {
    return "xml";
  }

  if (explicitFormat === "json") {
    return "json";
  }

  return parseAcceptHeader(request.headers.get("accept"));
}

function isJsonLikeContentType(contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  return (
    normalized.includes("application/json") || normalized.includes("+json")
  );
}

function canHaveBody(status: number): boolean {
  return ![204, 205, 304].includes(status);
}

function setVaryAccept(headers: Headers): void {
  const current = headers.get("vary");

  if (!current) {
    headers.set("vary", "Accept");
    return;
  }

  const values = current.split(",").map((value) => value.trim().toLowerCase());

  if (!values.includes("accept")) {
    headers.set("vary", `${current}, Accept`);
  }
}

function serializeBody(body: unknown, format: OutputFormat): string {
  switch (format) {
    case "xml":
      return serializeToXml(body);
    case "json":
    default:
      return JSON.stringify(body);
  }
}

function getContentType(format: OutputFormat): string {
  return CONTENT_TYPES[format];
}

async function tryReadJsonBody(response: Response): Promise<unknown | null> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const outputFormatMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const outputFormat = detectOutputFormat(context.req.raw);
    context.set("outputFormat", outputFormat);

    await next();

    const response = context.res;

    if (!canHaveBody(response.status)) {
      return;
    }

    const headers = new Headers(response.headers);
    setVaryAccept(headers);

    if (outputFormat === "json") {
      if (isJsonLikeContentType(response.headers.get("content-type"))) {
        headers.set("content-type", getContentType("json"));
      }

      context.res = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      return;
    }

    if (!isJsonLikeContentType(response.headers.get("content-type"))) {
      context.res = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      return;
    }

    const parsedBody = await tryReadJsonBody(response);

    if (parsedBody === null) {
      context.res = new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      return;
    }

    headers.set("content-type", getContentType("xml"));

    context.res = new Response(serializeBody(parsedBody, "xml"), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
);

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createConfig } from "../../config/index.js";
import { RentifyApiClient } from "../../integrations/rentify-api/index.js";
import { createServer } from "../../server/index.js";

function startBackendStub(): Promise<{ server: HttpServer; baseUrl: string }> {
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    response.setHeader("content-type", "application/json; charset=UTF-8");

    if (request.method === "GET" && url.pathname === "/api/v1/postings") {
      response.writeHead(200);
      response.end(
        JSON.stringify({
          postings: [{ id: "post_1", name: "Bike" }],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
          source: "database",
        }),
      );
      return;
    }

    response.writeHead(404);
    response.end(
      JSON.stringify({
        error: "Not found.",
        code: "RESOURCE_NOT_FOUND",
      }),
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

describe("Rentify MCP server smoke test", () => {
  jest.setTimeout(20_000);

  it("serves the expected marketplace tools and can complete a tool call", async () => {
    const backend = await startBackendStub();
    const client = new Client({
      name: "rentify-mcp-smoke-test",
      version: "1.0.0",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer(
      createConfig({
        name: "rentify-mcp",
        version: "1.0.0",
      }),
      new RentifyApiClient({
        baseUrl: `${backend.baseUrl}/api/v1`,
        timeoutMs: 5_000,
      }),
    );

    await server.connect(serverTransport);

    try {
      await client.connect(clientTransport);

      const toolList = await client.listTools();
      expect(toolList.tools.map((tool) => tool.name).sort()).toEqual([
        "archive_posting",
        "approve_booking_request",
        "batch_get_my_postings",
        "batch_get_postings",
        "create_posting",
        "create_booking_request",
        "cancel_booking_request",
        "create_posting_availability_block",
        "create_posting_review",
        "decline_booking_request",
        "delete_posting_availability_block",
        "duplicate_posting",
        "get_booking_cancellation_quote",
        "get_booking_request",
        "get_my_posting",
        "get_posting",
        "get_posting_analytics",
        "get_postings_analytics_summary",
        "get_renting",
        "list_my_booking_requests",
        "list_my_postings",
        "list_my_rentings",
        "list_owned_booking_requests",
        "list_posting_availability_blocks",
        "list_posting_booking_requests",
        "list_posting_reviews",
        "list_postings_analytics",
        "pause_posting",
        "publish_posting",
        "quote_booking_for_posting",
        "search_postings",
        "unpause_posting",
        "update_booking_request",
        "update_my_posting_review",
        "update_posting",
        "update_posting_availability_block",
      ].sort());

      const result = await client.callTool({
        name: "search_postings",
        arguments: {
          q: "bike",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        postings: [{ id: "post_1" }],
      });
    } finally {
      await client.close();
      await server.close();
      await new Promise<void>((resolve, reject) => {
        backend.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });
});

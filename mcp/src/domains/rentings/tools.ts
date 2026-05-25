import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  RentifyApiClient,
  type ListMyRentingsQuery,
} from "../../integrations/rentify-api/index.js";
import { executeTool } from "../shared/tool-results.js";

export interface ListMyRentingsToolArgs extends ListMyRentingsQuery {}

export interface GetRentingToolArgs {
  id: string;
}

export function createRentingsToolHandlers(apiClient: RentifyApiClient) {
  return {
    listMyRentings: (args: ListMyRentingsToolArgs) =>
      executeTool(
        () => apiClient.listMyRentings(args),
        (result) =>
          `Fetched ${result.rentings.length} renting(s) on page ${result.pagination.page}.`,
      ),
    getRenting: (args: GetRentingToolArgs) =>
      executeTool(
        () => apiClient.getRenting(args.id),
        (result) => `Fetched renting ${result.id} with status ${result.status}.`,
      ),
  };
}

export function registerRentingsTools(
  server: McpServer,
  handlers: ReturnType<typeof createRentingsToolHandlers>,
): void {
  server.registerTool(
    "list_my_rentings",
    {
      title: "List My Rentings",
      description: "List rentings for the authenticated user.",
      inputSchema: {
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        status: z
          .enum([
            "confirmed",
            "check_in_ready",
            "active",
            "return_due",
            "completed",
            "disputed",
            "cancelled",
          ])
          .optional(),
      },
    },
    handlers.listMyRentings,
  );

  server.registerTool(
    "get_renting",
    {
      title: "Get Renting",
      description: "Fetch one renting by id.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.getRenting,
  );
}

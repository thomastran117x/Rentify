import {
  readOpenApiJsonSpecFile,
  readOpenApiYamlSpecFile,
} from "@/openapi/file";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";
import {
  getApiRoutePrefix,
  getApiVersion,
} from "@/configuration/http/api-path";
import { buildErrorResponse, ok } from "@/configuration/http/responses";
import { pingDatabase } from "@/configuration/resources/database";

export const systemRouteModule: RouteModule = {
  id: "system",
  register(app) {
    app.get("/", (context) => {
      return ok(
        context,
        {
          apiVersion: getApiVersion(),
          apiBasePath: getApiRoutePrefix(),
        },
        {
          message: "TypeScript Hono server is running",
        },
      );
    });

    app.get("/health", async (context) => {
      const uptime = process.uptime();

      try {
        const database = await pingDatabase();

        return ok(context, {
          ok: true,
          uptime,
          checks: {
            database,
          },
        });
      } catch (error) {
        return context.json(
          buildErrorResponse(context, {
            message: "Health check failed.",
            code: "SERVICE_UNAVAILABLE",
            details: {
              uptime,
              checks: {
                database: {
                  ok: false,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Database health check failed.",
                },
              },
            },
          }),
          503,
        );
      }
    });

    app.get("/openapi.yaml", async () => {
      const body = await readOpenApiYamlSpecFile();

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/yaml; charset=UTF-8",
          "cache-control": "no-store",
        },
      });
    });

    app.get("/openapi.json", async () => {
      const body = await readOpenApiJsonSpecFile();

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "cache-control": "no-store",
        },
      });
    });
  },
};

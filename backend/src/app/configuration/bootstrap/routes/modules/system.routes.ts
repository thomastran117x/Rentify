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
    app.get("/", (request, response) => {
      ok(
        response,
        {
          apiVersion: getApiVersion(),
          apiBasePath: getApiRoutePrefix(),
        },
        {
          message: "TypeScript Express server is running",
        },
      );
    });

    app.get("/health", async (request, response) => {
      const uptime = process.uptime();

      try {
        const database = await pingDatabase();

        ok(response, {
          ok: true,
          uptime,
          checks: {
            database,
          },
        });
      } catch (error) {
        response.status(503).json(
          buildErrorResponse(request.requestId, {
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
        );
      }
    });

    // YAML is not a JSON-like content type, so it was never subject to the
    // output-format middleware's transcoding. Written verbatim.
    app.get("/openapi.yaml", async (_request, response) => {
      const body = await readOpenApiYamlSpecFile();

      response.status(200);
      response.setHeader("content-type", "application/yaml; charset=UTF-8");
      response.setHeader("cache-control", "no-store");
      response.end(body);
    });

    app.get("/openapi.json", async (request, response) => {
      const body = await readOpenApiJsonSpecFile();

      response.status(200);
      response.setHeader("cache-control", "no-store");

      // This response is JSON-like, so XML negotiation applies to it the same
      // way it does to every other endpoint. Only the XML path parses the
      // document; the JSON path writes the committed artifact verbatim rather
      // than reserialising it through res.json.
      if (request.outputFormat === "xml") {
        response.json(JSON.parse(body));
        return;
      }

      response.setHeader("content-type", "application/json; charset=UTF-8");
      response.end(body);
    });
  },
};

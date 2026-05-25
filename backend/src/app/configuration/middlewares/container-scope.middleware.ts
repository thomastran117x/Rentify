import { createMiddleware } from "hono/factory";
import type { AppBindings } from "@/configuration/http/bindings";
import { getContainer } from "@/configuration/bootstrap/container";

export const containerScopeMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const scope = getContainer().createScope();
    context.set("container", scope);

    try {
      await next();
    } finally {
      await scope.dispose();
    }
  },
);

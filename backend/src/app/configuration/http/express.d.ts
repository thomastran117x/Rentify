import type { AuthPrincipal } from "@/features/auth/auth.principal";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import type { Logger } from "@/configuration/logging";
import type {
  ClientRequestContext,
  ClientSignatureContext,
  OutputFormat,
} from "@/configuration/http/bindings";

/**
 * Request-scoped state, previously carried by Hono's `c.get`/`c.set` context
 * bag (`AppBindings["Variables"]`).
 *
 * These mirror the Hono typing exactly, which means they are declared as
 * required even though a few of them are only populated on some requests
 * (`auth` is set by the JWT middleware, `idempotencyKey` only on the routes the
 * idempotency middleware guards). Hono was equally optimistic, so keeping the
 * same shape means the migration introduces no new type errors. Code that has
 * to cope with the field being absent already does so explicitly, e.g.
 * `req.outputFormat ?? detectOutputFormat(req)`.
 */
declare global {
  namespace Express {
    interface Request {
      auth: AuthPrincipal;
      client: ClientRequestContext;
      clientSignature: ClientSignatureContext;
      container: ServiceContainer;
      idempotencyKey: string;
      outputFormat: OutputFormat;
      requestId: string;
      logger: Logger;

      /**
       * The unparsed request body, captured by express.json's verify hook.
       *
       * The Square and Telnyx webhooks verify a signature over the exact bytes
       * that were sent, so re-serialising the parsed JSON would not do: key
       * order and whitespace would differ and every signature check would fail.
       */
      rawBody?: Buffer;
    }
  }
}

export {};

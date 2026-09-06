import type { Request, Response } from "express";
import { getOptionalJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { ok } from "@/configuration/http/responses";
import { parseEmailAvailabilityQuery } from "@/features/auth/auth.request-mappers";
import { EmailAvailabilityService } from "@/features/auth/email-availability/email-availability.service";

export class EmailAvailabilityController {
  constructor(
    private readonly emailAvailabilityService: EmailAvailabilityService,
  ) {}

  checkEmailAvailability = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = parseEmailAvailabilityQuery(request);
    // Public endpoint, but a signed-in caller's own address must report as
    // available rather than taken so a settings form does not flag the value it
    // was seeded with.
    const auth = await getOptionalJwtAuth(request);
    // Bloom-filter backed: an address nobody has claimed is answered from
    // memory, and anything the filter cannot rule out falls through to the
    // database lookup.
    const result =
      await this.emailAvailabilityService.resolveEmailAvailabilityHint(
        query.email,
        auth?.sub,
      );

    ok(response, result);
  };
}

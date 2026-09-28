import type { RequestHandler } from "express";
import { containerTokens } from "@/configuration/container/tokens";
import { loggerFactory } from "@/configuration/logging";
import {
  containsImageVariantsReference,
  withoutImageVariantsReferences,
} from "@/features/media/image-variants";

const logger = loggerFactory.forComponent("image-variants", "middleware");

/**
 * Resolves the image rendition references in a JSON response before it is
 * written.
 *
 * Mappers emit an ImageVariantsReference for every stored image instead of
 * looking its renditions up themselves, so a response can hold many of them.
 * Every JSON response goes out through `res.json`, so this is the one place
 * they are resolved, in a single batched lookup per response. It must run
 * after outputFormatMiddleware, whose `res.json` does the writing: this wraps
 * it. A response with no references is written straight away.
 *
 * If the lookup fails, the response still goes out with every reference set
 * to null, which clients treat as an image with no renditions.
 */
export const imageVariantsMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const write = response.json.bind(response);

  response.json = function resolvingJson(body: unknown) {
    if (!containsImageVariantsReference(body)) {
      return write(body);
    }

    request.container
      .resolve(containerTokens.imageVariantsResolver)
      .resolve(body)
      .then(write, (error: unknown) => {
        logger.warn(
          "Failed to resolve image renditions; sending the response without them.",
          { path: request.path },
          error,
        );
        write(withoutImageVariantsReferences(body));
      });

    return response;
  } as typeof response.json;

  next();
};

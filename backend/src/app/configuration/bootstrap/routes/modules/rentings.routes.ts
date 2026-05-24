import { containerTokens } from "@/configuration/bootstrap/container";
import type { RentingsController } from "@/features/rentings/rentings.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const rentingsRouteModule: RouteModule = {
  id: "rentings",
  register(app, { resolveHandler }) {
    app.post(
      "/booking-requests/:id/convert",
      resolveHandler<RentingsController>(containerTokens.rentingsController, "convertBookingRequest"),
    );
    app.get(
      "/rentings/me",
      resolveHandler<RentingsController>(containerTokens.rentingsController, "listMine"),
    );
    app.put(
      "/rentings/:id/instructions",
      resolveHandler<RentingsController>(containerTokens.rentingsController, "updateInstructions"),
    );
    app.post(
      "/rentings/:id/check-in-ready",
      resolveHandler<RentingsController>(containerTokens.rentingsController, "markCheckInReady"),
    );
    app.post(
      "/rentings/:id/check-in",
      resolveHandler<RentingsController>(containerTokens.rentingsController, "markCheckInComplete"),
    );
    app.post(
      "/rentings/:id/return",
      resolveHandler<RentingsController>(containerTokens.rentingsController, "markCompleted"),
    );
    app.post(
      "/rentings/:id/disputes",
      resolveHandler<RentingsController>(containerTokens.rentingsController, "createDispute"),
    );
    app.get(
      "/rentings/:id",
      resolveHandler<RentingsController>(containerTokens.rentingsController, "getById"),
    );
  },
};

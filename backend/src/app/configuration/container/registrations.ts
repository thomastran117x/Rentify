import type { RootServiceContainer } from "@/configuration/container/core";
import {
  containerRegistrationModules,
  CONTAINER_REGISTRATION_MODULE_IDS,
  type ContainerRegistrationModule,
  type ContainerRegistrationModuleId,
} from "@/configuration/container/registrations/registry";

export {
  containerRegistrationModules,
  CONTAINER_REGISTRATION_MODULE_IDS,
  type ContainerRegistrationModule,
  type ContainerRegistrationModuleId,
};

export function registerApplicationServices(
  container: RootServiceContainer,
): void {
  for (const registrationModule of containerRegistrationModules) {
    registrationModule.register(container);
  }
}

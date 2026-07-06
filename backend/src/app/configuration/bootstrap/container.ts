import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  createRootContainer,
  createServiceToken,
  type RootServiceContainer,
  type ServiceContainer,
  type ServiceLifetime,
  type ServiceRegistration,
  type ServiceResolutionContext,
  type ServiceToken,
} from "@/configuration/container/core";
import { registerApplicationServices } from "@/configuration/container/registrations";
import { containerTokens } from "@/configuration/container/tokens";

export {
  createRootContainer,
  createServiceToken,
  containerTokens,
  type RootServiceContainer,
  type ServiceContainer,
  type ServiceLifetime,
  type ServiceRegistration,
  type ServiceResolutionContext,
  type ServiceToken,
};

let rootContainer: RootServiceContainer | null = null;

export function initializeContainer(): RootServiceContainer {
  if (rootContainer) {
    return rootContainer;
  }

  const container = createRootContainer();
  registerApplicationServices(container);
  container.validate();
  rootContainer = container;
  return container;
}

export function getContainer(): RootServiceContainer {
  if (!rootContainer) {
    throw new Error(
      "Application container has not been initialized. Call initializeContainer() first.",
    );
  }

  return rootContainer;
}

export function setContainer(container: RootServiceContainer): void {
  rootContainer = container;
}

export async function disposeContainer(): Promise<void> {
  if (!rootContainer) {
    return;
  }

  const container = rootContainer;
  rootContainer = null;
  await container.dispose();
}

export function getRequestContainer(
  context: Context<AppBindings>,
): ServiceContainer {
  return context.get("container");
}

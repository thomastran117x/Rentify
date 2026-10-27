import type { Request } from "express";
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

/**
 * Subscribes suspicious-activity detection to auth audit writes. Called by
 * the processes that serve auth requests, once their container is built and
 * the database and Redis are connected; workers record no auth events and
 * never call it. Detection cannot be a dependency of `AuthAuditService`,
 * because the account status service it locks through records there too.
 */
export function attachAuthAuditListeners(
  container: ServiceContainer = getContainer(),
): void {
  const detector = container.resolve(
    containerTokens.suspiciousActivityDetector,
  );

  container
    .resolve(containerTokens.authAuditService)
    .subscribe(detector.handle);
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

export function getRequestContainer(request: Request): ServiceContainer {
  return request.container;
}

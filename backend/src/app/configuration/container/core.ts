export type ServiceLifetime = "singleton" | "scoped" | "transient";

export interface ServiceToken<TValue> {
  readonly id: symbol;
  readonly description: string;
}

export interface ServiceRegistration<TValue> {
  token: ServiceToken<TValue>;
  lifetime: ServiceLifetime;
  dependencies: readonly ServiceToken<unknown>[];
  resolve: (context: ServiceResolutionContext) => TValue;
  dispose?: (instance: TValue) => void | Promise<void>;
}

export interface ServiceResolutionContext {
  container: ServiceContainer;
  resolve<TValue>(token: ServiceToken<TValue>): TValue;
}

interface RegistrationRecord<TValue> extends ServiceRegistration<TValue> {
  key: symbol;
}

interface DisposableEntry {
  description: string;
  dispose: () => void | Promise<void>;
}

export interface ServiceContainer {
  resolve<TValue>(token: ServiceToken<TValue>): TValue;
  createScope(): ServiceContainer;
  dispose(): Promise<void>;
}

export interface RootServiceContainer extends ServiceContainer {
  register<TValue>(registration: ServiceRegistration<TValue>): void;
  validate(): void;
}

class DependencyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyValidationError";
  }
}

class DefaultServiceContainer implements RootServiceContainer {
  private readonly registrations: Map<symbol, RegistrationRecord<unknown>>;
  private readonly singletonInstances: Map<symbol, unknown>;
  private readonly singletonDisposables: DisposableEntry[];
  private readonly scopedInstances = new Map<symbol, unknown>();
  private readonly scopedDisposables: DisposableEntry[] = [];

  constructor(
    private readonly root: DefaultServiceContainer | null = null,
    registrations?: Map<symbol, RegistrationRecord<unknown>>,
    singletonInstances?: Map<symbol, unknown>,
    singletonDisposables?: DisposableEntry[],
  ) {
    this.registrations = registrations ?? new Map();
    this.singletonInstances = singletonInstances ?? new Map();
    this.singletonDisposables = singletonDisposables ?? [];
  }

  register<TValue>(registration: ServiceRegistration<TValue>): void {
    if (this.root) {
      throw new Error("Registrations can only be added to the root container.");
    }

    this.registrations.set(registration.token.id, {
      key: registration.token.id,
      token: registration.token as ServiceToken<unknown>,
      lifetime: registration.lifetime,
      dependencies: registration.dependencies,
      resolve: registration.resolve as (
        context: ServiceResolutionContext,
      ) => unknown,
      dispose: registration.dispose
        ? (instance: unknown) => registration.dispose?.(instance as TValue)
        : undefined,
    });
  }

  validate(): void {
    const missingDependencies: string[] = [];

    for (const registration of this.registrations.values()) {
      for (const dependency of registration.dependencies) {
        if (!this.registrations.has(dependency.id)) {
          missingDependencies.push(
            `${registration.token.description} -> missing ${dependency.description}`,
          );
        }
      }
    }

    if (missingDependencies.length > 0) {
      throw new DependencyValidationError(
        `Container validation failed due to missing registrations:\n${missingDependencies.join("\n")}`,
      );
    }

    const visited = new Set<symbol>();
    const visiting = new Set<symbol>();
    const path: RegistrationRecord<unknown>[] = [];

    const visit = (registration: RegistrationRecord<unknown>): void => {
      if (visited.has(registration.key)) {
        return;
      }

      if (visiting.has(registration.key)) {
        const startIndex = path.findIndex(
          (entry) => entry.key === registration.key,
        );
        const cycle = [...path.slice(startIndex), registration]
          .map((entry) => entry.token.description)
          .join(" -> ");
        throw new DependencyValidationError(
          `Container validation failed due to a dependency cycle: ${cycle}`,
        );
      }

      visiting.add(registration.key);
      path.push(registration);

      for (const dependencyToken of registration.dependencies) {
        const dependency = this.registrations.get(dependencyToken.id);

        if (dependency) {
          visit(dependency);
        }
      }

      path.pop();
      visiting.delete(registration.key);
      visited.add(registration.key);
    };

    for (const registration of this.registrations.values()) {
      visit(registration);
    }
  }

  resolve<TValue>(token: ServiceToken<TValue>): TValue {
    return this.resolveRegistration(token, []);
  }

  createScope(): ServiceContainer {
    return new DefaultServiceContainer(
      this.getRoot(),
      this.getRoot().registrations,
      this.getRoot().singletonInstances,
      this.getRoot().singletonDisposables,
    );
  }

  async dispose(): Promise<void> {
    const scoped = [...this.scopedDisposables].reverse();

    for (const entry of scoped) {
      await entry.dispose();
    }

    this.scopedDisposables.length = 0;
    this.scopedInstances.clear();

    if (this.root) {
      return;
    }

    const singletons = [...this.singletonDisposables].reverse();

    for (const entry of singletons) {
      await entry.dispose();
    }

    this.singletonDisposables.length = 0;
    this.singletonInstances.clear();
  }

  private resolveRegistration<TValue>(
    token: ServiceToken<TValue>,
    stack: ServiceToken<unknown>[],
  ): TValue {
    const registration = this.getRoot().registrations.get(token.id);

    if (!registration) {
      throw new Error(`No registration found for ${token.description}.`);
    }

    if (stack.some((entry) => entry.id === token.id)) {
      const cycle = [...stack, token]
        .map((entry) => entry.description)
        .join(" -> ");
      throw new Error(
        `Circular dependency detected during resolution: ${cycle}`,
      );
    }

    if (registration.lifetime === "singleton") {
      return this.resolveSingleton(registration, stack) as TValue;
    }

    if (registration.lifetime === "scoped") {
      return this.resolveScoped(registration, stack) as TValue;
    }

    return this.createInstance(registration, stack) as TValue;
  }

  private resolveSingleton(
    registration: RegistrationRecord<unknown>,
    stack: ServiceToken<unknown>[],
  ): unknown {
    const root = this.getRoot();

    if (root.singletonInstances.has(registration.key)) {
      return root.singletonInstances.get(registration.key);
    }

    const instance = root.createInstance(registration, stack);
    root.singletonInstances.set(registration.key, instance);
    root.trackDisposable(root.singletonDisposables, registration, instance);
    return instance;
  }

  private resolveScoped(
    registration: RegistrationRecord<unknown>,
    stack: ServiceToken<unknown>[],
  ): unknown {
    if (this.scopedInstances.has(registration.key)) {
      return this.scopedInstances.get(registration.key);
    }

    const instance = this.createInstance(registration, stack);
    this.scopedInstances.set(registration.key, instance);
    this.trackDisposable(this.scopedDisposables, registration, instance);
    return instance;
  }

  private createInstance(
    registration: RegistrationRecord<unknown>,
    stack: ServiceToken<unknown>[],
  ): unknown {
    return registration.resolve({
      container: this,
      resolve: <TValue>(token: ServiceToken<TValue>) =>
        this.resolveRegistration(token, [...stack, registration.token]),
    });
  }

  private trackDisposable(
    store: DisposableEntry[],
    registration: RegistrationRecord<unknown>,
    instance: unknown,
  ): void {
    if (!registration.dispose) {
      return;
    }

    store.push({
      description: registration.token.description,
      dispose: () => registration.dispose?.(instance),
    });
  }

  private getRoot(): DefaultServiceContainer {
    return this.root ?? this;
  }
}

export function createServiceToken<TValue>(
  description: string,
): ServiceToken<TValue> {
  return {
    id: Symbol(description),
    description,
  };
}

export function createRootContainer(): RootServiceContainer {
  return new DefaultServiceContainer();
}

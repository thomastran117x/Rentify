import {
  createRootContainer,
  createServiceToken,
} from "@/configuration/bootstrap/container";

describe("container", () => {
  it("resolves singleton registrations once per root container", () => {
    const container = createRootContainer();
    const singletonToken = createServiceToken<{ id: number }>("singleton");
    let created = 0;

    container.register({
      token: singletonToken,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => ({ id: ++created }),
    });

    container.validate();

    const first = container.resolve(singletonToken);
    const second = container.resolve(singletonToken);

    expect(created).toBe(1);
    expect(first).toBe(second);
  });

  it("reuses scoped registrations within a scope and isolates them across scopes", () => {
    const container = createRootContainer();
    const scopedToken = createServiceToken<{ id: number }>("scoped");
    let created = 0;

    container.register({
      token: scopedToken,
      lifetime: "scoped",
      dependencies: [],
      resolve: () => ({ id: ++created }),
    });

    container.validate();

    const scopeOne = container.createScope();
    const scopeTwo = container.createScope();
    const first = scopeOne.resolve(scopedToken);
    const second = scopeOne.resolve(scopedToken);
    const third = scopeTwo.resolve(scopedToken);

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(created).toBe(2);
  });

  it("resolves transient registrations to a fresh instance every time", () => {
    const container = createRootContainer();
    const transientToken = createServiceToken<{ id: number }>("transient");
    let created = 0;

    container.register({
      token: transientToken,
      lifetime: "transient",
      dependencies: [],
      resolve: () => ({ id: ++created }),
    });

    container.validate();

    const first = container.resolve(transientToken);
    const second = container.resolve(transientToken);

    expect(first).not.toBe(second);
    expect(created).toBe(2);
  });

  it("fails validation when a dependency registration is missing", () => {
    const container = createRootContainer();
    const missingToken = createServiceToken<object>("missing");
    const dependentToken = createServiceToken<object>("dependent");

    container.register({
      token: dependentToken,
      lifetime: "singleton",
      dependencies: [missingToken],
      resolve: () => ({}),
    });

    expect(() => container.validate()).toThrow(/dependent -> missing missing/);
  });

  it("fails validation on a direct cycle", () => {
    const container = createRootContainer();
    const alphaToken = createServiceToken<object>("alpha");
    const betaToken = createServiceToken<object>("beta");

    container.register({
      token: alphaToken,
      lifetime: "singleton",
      dependencies: [betaToken],
      resolve: () => ({}),
    });
    container.register({
      token: betaToken,
      lifetime: "singleton",
      dependencies: [alphaToken],
      resolve: () => ({}),
    });

    expect(() => container.validate()).toThrow(/alpha -> beta -> alpha/);
  });

  it("fails validation on an indirect cycle", () => {
    const container = createRootContainer();
    const alphaToken = createServiceToken<object>("alpha");
    const betaToken = createServiceToken<object>("beta");
    const gammaToken = createServiceToken<object>("gamma");

    container.register({
      token: alphaToken,
      lifetime: "singleton",
      dependencies: [betaToken],
      resolve: () => ({}),
    });
    container.register({
      token: betaToken,
      lifetime: "singleton",
      dependencies: [gammaToken],
      resolve: () => ({}),
    });
    container.register({
      token: gammaToken,
      lifetime: "singleton",
      dependencies: [alphaToken],
      resolve: () => ({}),
    });

    expect(() => container.validate()).toThrow(
      /alpha -> beta -> gamma -> alpha/,
    );
  });

  it("validates acyclic graphs with mixed lifetimes", () => {
    const container = createRootContainer();
    const singletonToken = createServiceToken<{ kind: string }>("singleton");
    const scopedToken = createServiceToken<{ kind: string }>("scoped");
    const transientToken = createServiceToken<{ kind: string }>("transient");

    container.register({
      token: singletonToken,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => ({ kind: "singleton" }),
    });
    container.register({
      token: scopedToken,
      lifetime: "scoped",
      dependencies: [singletonToken],
      resolve: ({ resolve }) => ({ kind: resolve(singletonToken).kind }),
    });
    container.register({
      token: transientToken,
      lifetime: "transient",
      dependencies: [scopedToken],
      resolve: ({ resolve }) => ({ kind: resolve(scopedToken).kind }),
    });

    expect(() => container.validate()).not.toThrow();
  });
});

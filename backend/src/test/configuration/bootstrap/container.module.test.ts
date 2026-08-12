const mockCreateRootContainer = jest.fn();
const mockCreateServiceToken = jest.fn((name: string) => ({
  name,
}));
const mockRegisterApplicationServices = jest.fn();
const mockContainerTokens = {
  marker: "tokens",
};

jest.mock("@/configuration/container/core", () => ({
  createRootContainer: () => mockCreateRootContainer(),
  createServiceToken: (name: string) => mockCreateServiceToken(name),
}));

jest.mock("@/configuration/container/registrations", () => ({
  registerApplicationServices: (container: unknown) =>
    mockRegisterApplicationServices(container),
}));

jest.mock("@/configuration/container/tokens", () => ({
  containerTokens: mockContainerTokens,
}));

describe("bootstrap container module", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("initializes and caches the root container", async () => {
    const mockContainer = {
      validate: jest.fn(),
    };
    mockCreateRootContainer.mockReturnValue(mockContainer);

    const containerModule = await import("@/configuration/bootstrap/container");

    const first = containerModule.initializeContainer();
    const second = containerModule.initializeContainer();

    expect(first).toBe(mockContainer);
    expect(second).toBe(mockContainer);
    expect(mockCreateRootContainer).toHaveBeenCalledTimes(1);
    expect(mockRegisterApplicationServices).toHaveBeenCalledWith(mockContainer);
    expect(mockContainer.validate).toHaveBeenCalledTimes(1);
    expect(containerModule.getContainer()).toBe(mockContainer);
    expect(containerModule.containerTokens).toBe(mockContainerTokens);
    expect(containerModule.createServiceToken("sample")).toEqual({
      name: "sample",
    });
  });

  it("throws when callers request the root container before initialization", async () => {
    const containerModule = await import("@/configuration/bootstrap/container");

    expect(() => containerModule.getContainer()).toThrow(
      "Application container has not been initialized. Call initializeContainer() first.",
    );
  });

  it("reads the request-scoped container from the request", async () => {
    const containerModule = await import("@/configuration/bootstrap/container");
    const requestContainer = {
      resolve: jest.fn(),
    };
    const request = {
      container: requestContainer,
    };

    const resolved = containerModule.getRequestContainer(request as any);

    expect(resolved).toBe(requestContainer);
  });
});

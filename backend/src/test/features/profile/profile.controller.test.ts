import type { Context } from "hono";
import { RequestValidationError } from "@/configuration/validation/request";
import type { AppBindings } from "@/configuration/http/bindings";
import { ProfileController } from "@/features/profile/profile.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(options?: {
  body?: unknown;
  url?: string;
  auth?: JwtClaims;
}) {
  const variables = new Map<string, unknown>();

  if (options?.auth) {
    variables.set("auth", options.auth);
  }

  variables.set("requestId", "request-1");
  variables.set("client", {
    ip: "127.0.0.1",
    device: {
      id: "device-1",
      type: "desktop",
      isMobile: false,
      userAgent: "test-agent",
      platform: "test-os",
    },
  });
  variables.set("container", {
    resolve: () => ({
      inspectRequest: () => [],
    }),
  });

  const context = {
    req: {
      json: async () => options?.body ?? {},
      url:
        options?.url ??
        "https://example.test/api/v1/profile?page=1&pageSize=20",
    },
    get: (name: string) => variables.get(name),
    set: (name: string, value: unknown) => {
      variables.set(name, value);
    },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
        },
      }),
  };

  return context as unknown as Context<AppBindings>;
}

describe("ProfileController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
  });

  it("maps list query parameters into profile list inputs", async () => {
    const list = jest.fn(async () => ({
      profiles: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      query: "owner",
    }));
    const controller = new ProfileController({
      list,
    } as any);
    const context = createContext({
      url: "https://example.test/api/v1/profile?page=2&pageSize=5&q=owner",
    });

    const response = await controller.list(context);

    expect(list).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      query: "owner",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Request completed successfully.",
      data: {
        profiles: [],
        pagination: {
          page: 2,
          pageSize: 5,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: true,
        },
        query: "owner",
      },
      error: null,
      meta: {
        requestId: "request-1",
        pagination: {
          page: 2,
          pageSize: 5,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      },
    });
  });

  it("returns query validation details for invalid list parameters", async () => {
    const controller = new ProfileController({
      list: jest.fn(),
    } as any);

    await expect(
      controller.list(
        createContext({
          url: "https://example.test/api/v1/profile?page=0&pageSize=101",
        }),
      ),
    ).rejects.toMatchObject({
      message: "Request query validation failed.",
      details: [
        {
          path: "page",
          message: "Too small: expected number to be >=1",
        },
        {
          path: "pageSize",
          message: "Too big: expected number to be <=100",
        },
      ],
    });
  });

  it("reads the authenticated user profile from context auth", async () => {
    const claims = createClaims({ sub: "profile-user" });
    mockRequireJwtAuth.mockImplementation((async (context: Context<AppBindings>) => {
      context.set("auth", claims as any);
      return claims;
    }) as any);
    const getByUserId = jest.fn(async (userId: string) => ({
      id: "profile-1",
      userId,
    }));
    const controller = new ProfileController({
      getByUserId,
    } as any);
    const context = createContext();

    const response = await controller.getMe(context);

    expect(getByUserId).toHaveBeenCalledWith("profile-user");
    expect(context.get("auth")).toEqual(claims);
    expect(response.status).toBe(200);
  });

  it("validates update bodies, maps auth to userId, and returns a success message", async () => {
    const claims = createClaims({ sub: "profile-user" });
    mockRequireJwtAuth.mockImplementation((async (context: Context<AppBindings>) => {
      context.set("auth", claims as any);
      return claims;
    }) as any);
    const update = jest.fn(async (input) => ({
      id: "profile-1",
      ...input,
    }));
    const controller = new ProfileController({
      update,
    } as any);
    const context = createContext({
      body: {
        username: "owner-one",
        phoneNumber: "+1 555 0111",
        isPrivate: true,
        recommendationPersonalizationEnabled: false,
        avatarUrl: "https://storage.example.com/avatars/user-1.png",
        avatarBlobName: "avatars/user-1.png",
        trustworthinessScore: 5,
        rentPostingsCount: 3,
        availableRentPostingsCount: 1,
      },
    });

    const response = await controller.updateMe(context);

    expect(update).toHaveBeenCalledWith({
      userId: "profile-user",
      username: "owner-one",
      phoneNumber: "+1 555 0111",
      isPrivate: true,
      recommendationPersonalizationEnabled: false,
      avatarUrl: "https://storage.example.com/avatars/user-1.png",
      avatarBlobName: "avatars/user-1.png",
      trustworthinessScore: 5,
      rentPostingsCount: 3,
      availableRentPostingsCount: 1,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      message: "Profile updated successfully.",
      data: {
        id: "profile-1",
        userId: "profile-user",
      },
      meta: {
        requestId: "request-1",
      },
    });
  });

  it("returns request validation errors for invalid update bodies", async () => {
    const claims = createClaims({ sub: "profile-user" });
    mockRequireJwtAuth.mockImplementation((async (context: Context<AppBindings>) => {
      context.set("auth", claims as any);
      return claims;
    }) as any);
    const update = jest.fn();
    const controller = new ProfileController({
      update,
    } as any);

    await expect(
      controller.updateMe(
        createContext({
          body: {
            username: "x",
          },
        }),
      ),
    ).rejects.toMatchObject({
      message: "Request body validation failed.",
      details: [
        {
          path: "username",
          message: "Username must be at least 3 characters long.",
        },
      ],
    });
    expect(update).not.toHaveBeenCalled();
  });
});

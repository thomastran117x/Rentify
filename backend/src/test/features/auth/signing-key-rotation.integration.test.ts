import { createHmac } from "node:crypto";
import { buildApiPath } from "@/configuration/http/api-path";
import { REFRESH_TOKEN_COOKIE_NAME } from "@/features/auth/auth.cookies";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const OLD_SECRET = "rotation-test-old-secret-value-32ch";
const NEW_SECRET = "rotation-test-new-secret-value-32ch";
const CURRENT_KID = "2026-11";
const KEYSET_VARIABLES = [
  "ACCESS_TOKEN_KEYS",
  "ACCESS_TOKEN_SECRET",
  "REFRESH_TOKEN_KEYS",
  "REFRESH_TOKEN_SECRET",
  "PERSONAL_ACCESS_TOKEN_KEYS",
  "PERSONAL_ACCESS_TOKEN_SECRET",
] as const;

/** Mid-rotation: a new current key, with the pre-keyset secret as previous. */
function rotatedKeyset(newSecret: string, oldSecret: string): string {
  return JSON.stringify([
    { kid: CURRENT_KID, status: "current", secret: newSecret },
    { kid: "default", status: "previous", secret: oldSecret },
  ]);
}

describe("Signing key rotation persistence integration", () => {
  let persistenceApp: PersistenceTestApp;
  const originalValues = Object.fromEntries(
    KEYSET_VARIABLES.map((name) => [name, process.env[name]]),
  );

  beforeAll(async () => {
    for (const name of KEYSET_VARIABLES) {
      delete process.env[name];
    }
    process.env.ACCESS_TOKEN_KEYS = rotatedKeyset(
      `access-${NEW_SECRET}`,
      `access-${OLD_SECRET}`,
    );
    process.env.REFRESH_TOKEN_KEYS = rotatedKeyset(
      `refresh-${NEW_SECRET}`,
      `refresh-${OLD_SECRET}`,
    );
    process.env.PERSONAL_ACCESS_TOKEN_KEYS = rotatedKeyset(
      `pat-${NEW_SECRET}`,
      `pat-${OLD_SECRET}`,
    );
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
    for (const name of KEYSET_VARIABLES) {
      const value = originalValues[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }, 180_000);

  async function insertPat(input: {
    publicId: string;
    secret: string;
    hashSecret: string;
    secretKid: string;
  }) {
    const user = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: { email: "user1@rentify.local" },
    });

    return persistenceApp.prisma.personalAccessToken.create({
      data: {
        id: `00000000-0000-4000-8400-${input.publicId.slice(0, 12)}`,
        userId: user.id,
        name: "Rotation test PAT",
        publicId: input.publicId,
        tokenPrefix: `rpat_${input.publicId}_${input.secret.slice(0, 6)}`,
        secretHash: hashPatSecret(
          input.hashSecret,
          input.publicId,
          input.secret,
        ),
        secretKid: input.secretKid,
        scopes: ["mcp:read"],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  function hashPatSecret(key: string, publicId: string, secret: string) {
    return createHmac("sha256", key)
      .update(`${publicId}.${secret}`)
      .digest("hex");
  }

  function requestProfile(token: string) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          origin: ORIGIN,
        },
      },
    );
  }

  it("moves a PAT hashed with a previous key onto the current key when it is used", async () => {
    const publicId = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const secret = "b".repeat(48);
    const pat = await insertPat({
      publicId,
      secret,
      hashSecret: `pat-${OLD_SECRET}`,
      secretKid: "default",
    });

    expect((await requestProfile(`rpat_${publicId}_${secret}`)).status).toBe(
      200,
    );
    await expect(
      persistenceApp.prisma.personalAccessToken.findUniqueOrThrow({
        where: { id: pat.id },
      }),
    ).resolves.toMatchObject({
      secretKid: CURRENT_KID,
      secretHash: hashPatSecret(`pat-${NEW_SECRET}`, publicId, secret),
      lastUsedAt: expect.any(Date),
    });
    expect((await requestProfile(`rpat_${publicId}_${secret}`)).status).toBe(
      200,
    );
  });

  it("rejects a PAT whose key is no longer in the keyset", async () => {
    const publicId = "cccccccccccccccccccccccc";
    const secret = "d".repeat(48);
    await insertPat({
      publicId,
      secret,
      hashSecret: "a-removed-key-secret-value-32-chars",
      secretKid: "retired",
    });

    expect((await requestProfile(`rpat_${publicId}_${secret}`)).status).toBe(
      401,
    );
  });

  it("signs new sessions with the current access and refresh keys", async () => {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        body: JSON.stringify({
          username: "renter-one",
          password: "Rentify123!",
          captchaToken: "captcha-ok-login",
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { accessToken: string };
    };
    const [encodedHeader] = body.data.accessToken.split(".");

    expect(
      JSON.parse(Buffer.from(encodedHeader ?? "", "base64url").toString()),
    ).toMatchObject({ alg: "HS256", kid: CURRENT_KID });
    expect(response.headers.get("set-cookie")).toContain(
      `${REFRESH_TOKEN_COOKIE_NAME}=v2.${CURRENT_KID}.`,
    );
    expect((await requestProfile(body.data.accessToken)).status).toBe(200);
  });
});

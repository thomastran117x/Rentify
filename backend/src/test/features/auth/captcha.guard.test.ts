import BadRequestError from "@/errors/http/bad-request.error";
import type { CaptchaService } from "@/features/auth/captcha/captcha.service";
import { requireCaptcha } from "@/features/auth/captcha/captcha.guard";
import { createMockRequest } from "../../support/mock-http";

function createRequest() {
  return createMockRequest({
    headers: { "idempotency-key": "idem-1" },
    state: {
      client: { ip: "203.0.113.10", device: { id: "device-1" } },
    },
  });
}

function createCaptchaService(
  result: { success: boolean; failOpen?: boolean; errors?: string[] },
): CaptchaService {
  return {
    verify: jest.fn().mockResolvedValue(result),
  } as unknown as CaptchaService;
}

describe("requireCaptcha", () => {
  it("passes a successful verification through", async () => {
    const captchaService = createCaptchaService({ success: true });

    await expect(
      requireCaptcha(createRequest(), captchaService, "captcha-ok"),
    ).resolves.toBeUndefined();
  });

  it("forwards the token, caller ip and idempotency key", async () => {
    const captchaService = createCaptchaService({ success: true });

    await requireCaptcha(createRequest(), captchaService, "captcha-ok");

    expect(captchaService.verify).toHaveBeenCalledWith({
      token: "captcha-ok",
      remoteIp: "203.0.113.10",
      idempotencyKey: "idem-1",
    });
  });

  it("rejects a failed verification", async () => {
    const captchaService = createCaptchaService({
      success: false,
      errors: ["invalid-input-response"],
    });

    await expect(
      requireCaptcha(createRequest(), captchaService, "captcha-bad"),
    ).rejects.toThrow(BadRequestError);
  });

  it("fails closed when the provider could not be reached", async () => {
    // A failOpen result means the provider was unreachable. The request is
    // unattested either way, so it must not be waved through.
    const captchaService = createCaptchaService({
      success: true,
      failOpen: true,
    });

    await expect(
      requireCaptcha(createRequest(), captchaService, "captcha-ok"),
    ).rejects.toMatchObject({ details: { failOpen: true } });
  });
});

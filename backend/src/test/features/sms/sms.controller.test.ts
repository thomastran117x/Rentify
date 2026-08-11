import { SmsController } from "@/features/sms/sms.controller";
import { createLegacyTestContext } from "../../support/mock-http";

function createContext(options?: {
  headers?: Record<string, string>;
  text?: string;
}) {
  return createLegacyTestContext({
    headers: options?.headers,
    rawBody: options?.text ?? "",
    state: {
      requestId: "request-1",
      container: {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      },
    },
  });
}

describe("SmsController", () => {
  it("passes webhook raw bodies and Telnyx headers through to the service", async () => {
    const processWebhook = jest.fn(async () => undefined);
    const controller = new SmsController({
      processWebhook,
    } as any);

    const response = await controller.webhook(
      createContext({
        text: '{"data":{"event_type":"message.sent"}}',
        headers: {
          "telnyx-signature-ed25519": "signature-1",
          "telnyx-timestamp": "1718971200",
        },
      }),
    );

    expect(processWebhook).toHaveBeenCalledWith(
      '{"data":{"event_type":"message.sent"}}',
      {
        signatureEd25519: "signature-1",
        timestamp: "1718971200",
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      message: "SMS webhook processed successfully.",
      data: {
        ok: true,
      },
    });
  });
});

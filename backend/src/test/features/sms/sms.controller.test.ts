import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { SmsController } from "@/features/sms/sms.controller";

function createContext(options?: {
  headers?: Record<string, string>;
  text?: string;
}) {
  const variables = new Map<string, unknown>();
  variables.set("requestId", "request-1");
  variables.set("container", {
    resolve: () => ({
      inspectRequest: () => [],
    }),
  });

  const context = {
    req: {
      text: async () => options?.text ?? "",
      header: (name: string) => options?.headers?.[name.toLowerCase()],
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

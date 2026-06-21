const mockBootstrapWorker = jest.fn();
const mockStartWorker = jest.fn();

jest.mock("@/configuration/environment", () => ({
  environment: {
    getSmsWorkerConfig: jest.fn(() => ({
      prefetch: 4,
      maxAttempts: 3,
    })),
  },
}));

jest.mock("@/workers/shared/resources", () => ({
  disconnectResources: jest.fn(async () => undefined),
  rabbitMqWorkerResource: {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
  },
}));

jest.mock("@/workers/shared/worker-runtime", () => ({
  bootstrapWorker: (...args: unknown[]) => mockBootstrapWorker(...args),
  startWorker: (...args: unknown[]) => mockStartWorker(...args),
}));

import { containerTokens } from "@/configuration/bootstrap/container";
import { bootstrapSmsDeliveryWorker } from "@/workers/sms/sms-delivery.worker";

describe("bootstrapSmsDeliveryWorker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("acks successfully delivered messages", async () => {
    let consumeHandler:
      | ((
          payload: {
            jobId: string;
            kind: "message";
            input: {
              to: string;
              text: string;
            };
            attempt: number;
            occurredAt: string;
          },
          message: unknown,
          channel: {
            ack: jest.Mock;
          },
        ) => Promise<void>)
      | undefined;
    const smsQueueService = {
      consumeSmsJobs: jest.fn(async (_prefetch: number, handler) => {
        consumeHandler = handler;
        return async () => undefined;
      }),
      publishRetryJob: jest.fn(async () => undefined),
      publishDeadLetterJob: jest.fn(async () => undefined),
    };
    const smsDeliveryService = {
      deliver: jest.fn(async () => undefined),
    };

    mockBootstrapWorker.mockImplementation(async (input) => {
      await input.run(
        {
          container: {
            createScope: () => ({
              resolve: (token: unknown) => {
                if (token === containerTokens.smsQueueService) {
                  return smsQueueService;
                }

                if (token === containerTokens.smsDeliveryService) {
                  return smsDeliveryService;
                }

                throw new Error(`Unexpected token: ${String(token)}`);
              },
              dispose: async () => undefined,
            }),
          },
        },
        {
          addShutdownTask: jest.fn(),
        },
      );
    });

    await bootstrapSmsDeliveryWorker();

    const channel = {
      ack: jest.fn(),
    };
    const message = { content: Buffer.from("{}") };

    await consumeHandler?.(
      {
        jobId: "job-1",
        kind: "message",
        input: {
          to: "+14165550100",
          text: "Hello",
        },
        attempt: 0,
        occurredAt: "2026-06-21T12:00:00.000Z",
      },
      message,
      channel,
    );

    expect(smsDeliveryService.deliver).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(smsQueueService.publishRetryJob).not.toHaveBeenCalled();
    expect(smsQueueService.publishDeadLetterJob).not.toHaveBeenCalled();
  });

  it("publishes retry jobs before the max attempts threshold", async () => {
    let consumeHandler:
      | ((payload: any, message: unknown, channel: { ack: jest.Mock }) => Promise<void>)
      | undefined;
    const smsQueueService = {
      consumeSmsJobs: jest.fn(async (_prefetch: number, handler) => {
        consumeHandler = handler;
        return async () => undefined;
      }),
      publishRetryJob: jest.fn(async () => undefined),
      publishDeadLetterJob: jest.fn(async () => undefined),
    };
    const smsDeliveryService = {
      deliver: jest.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };

    mockBootstrapWorker.mockImplementation(async (input) => {
      await input.run(
        {
          container: {
            createScope: () => ({
              resolve: (token: unknown) => {
                if (token === containerTokens.smsQueueService) {
                  return smsQueueService;
                }

                if (token === containerTokens.smsDeliveryService) {
                  return smsDeliveryService;
                }

                throw new Error(`Unexpected token: ${String(token)}`);
              },
              dispose: async () => undefined,
            }),
          },
        },
        {
          addShutdownTask: jest.fn(),
        },
      );
    });

    await bootstrapSmsDeliveryWorker();

    const channel = {
      ack: jest.fn(),
    };
    const message = { content: Buffer.from("{}") };
    const payload = {
      jobId: "job-1",
      kind: "message" as const,
      input: {
        to: "+14165550100",
        text: "Hello",
      },
      attempt: 1,
      occurredAt: "2026-06-21T12:00:00.000Z",
    };

    await consumeHandler?.(payload, message, channel);

    expect(smsQueueService.publishRetryJob).toHaveBeenCalledWith(payload, 2);
    expect(smsQueueService.publishDeadLetterJob).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it("moves jobs to dead-letter after the max attempts threshold", async () => {
    let consumeHandler:
      | ((payload: any, message: unknown, channel: { ack: jest.Mock }) => Promise<void>)
      | undefined;
    const smsQueueService = {
      consumeSmsJobs: jest.fn(async (_prefetch: number, handler) => {
        consumeHandler = handler;
        return async () => undefined;
      }),
      publishRetryJob: jest.fn(async () => undefined),
      publishDeadLetterJob: jest.fn(async () => undefined),
    };
    const smsDeliveryService = {
      deliver: jest.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };

    mockBootstrapWorker.mockImplementation(async (input) => {
      await input.run(
        {
          container: {
            createScope: () => ({
              resolve: (token: unknown) => {
                if (token === containerTokens.smsQueueService) {
                  return smsQueueService;
                }

                if (token === containerTokens.smsDeliveryService) {
                  return smsDeliveryService;
                }

                throw new Error(`Unexpected token: ${String(token)}`);
              },
              dispose: async () => undefined,
            }),
          },
        },
        {
          addShutdownTask: jest.fn(),
        },
      );
    });

    await bootstrapSmsDeliveryWorker();

    const channel = {
      ack: jest.fn(),
    };
    const message = { content: Buffer.from("{}") };

    await consumeHandler?.(
      {
        jobId: "job-1",
        kind: "message",
        input: {
          to: "+14165550100",
          text: "Hello",
        },
        attempt: 2,
        occurredAt: "2026-06-21T12:00:00.000Z",
      },
      message,
      channel,
    );

    expect(smsQueueService.publishDeadLetterJob).toHaveBeenCalledWith({
      jobId: "job-1",
      kind: "message",
      input: {
        to: "+14165550100",
        text: "Hello",
      },
      attempt: 3,
      occurredAt: "2026-06-21T12:00:00.000Z",
    });
    expect(smsQueueService.publishRetryJob).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
});

import type { LiveRabbitMqConfig } from "./live-rabbitmq";
import { peekRabbitMqMessages } from "./live-rabbitmq";

export async function waitForRabbitMqPayload<TPayload>(
  config: LiveRabbitMqConfig,
  queueName: string,
  predicate: (payload: TPayload) => boolean,
  options: {
    count?: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<TPayload> {
  const payloads = await waitForRabbitMqPayloads(config, queueName, predicate, {
    ...options,
    minMatches: 1,
  });

  return payloads[0] as TPayload;
}

export async function waitForRabbitMqPayloads<TPayload>(
  config: LiveRabbitMqConfig,
  queueName: string,
  predicate: (payload: TPayload) => boolean,
  options: {
    count?: number;
    minMatches?: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<TPayload[]> {
  const count = options.count ?? 25;
  const minMatches = options.minMatches ?? 1;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const payloads = (
      await peekRabbitMqMessages<TPayload>(config, queueName, count)
    )
      .map((message) => message.payload)
      .filter(predicate);

    if (payloads.length >= minMatches) {
      return payloads;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Expected at least ${minMatches} matching RabbitMQ payload(s) in queue '${queueName}'.`,
  );
}

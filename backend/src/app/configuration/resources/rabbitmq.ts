import { connect, type ChannelModel, type ConfirmChannel } from "amqplib";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";

let rabbitMqConnection: ChannelModel | null = null;
const rabbitMqLogger = loggerFactory.forComponent("rabbitmq", "resource");

function getRabbitMqUrl(): string {
  const { url } = environment.getRabbitMqConfig();

  if (!url) {
    throw new Error(
      "RabbitMQ has not been configured. Set RABBITMQ_URL first.",
    );
  }

  return url;
}

export function isRabbitMqEnabled(): boolean {
  return Boolean(environment.getRabbitMqConfig().url);
}

export async function connectRabbitMq(): Promise<ChannelModel> {
  if (rabbitMqConnection) {
    return rabbitMqConnection;
  }

  const connection = await connect(getRabbitMqUrl());

  connection.on("error", (error) => {
    rabbitMqLogger.error("RabbitMQ connection error.", undefined, error);
  });

  connection.on("close", () => {
    rabbitMqConnection = null;
  });

  rabbitMqConnection = connection;
  return connection;
}

export async function createRabbitMqChannel(): Promise<ConfirmChannel> {
  const connection = await connectRabbitMq();
  return connection.createConfirmChannel();
}

export function getRabbitMqConnection(): ChannelModel {
  if (!rabbitMqConnection) {
    throw new Error(
      "RabbitMQ has not been initialized. Call connectRabbitMq() first.",
    );
  }

  return rabbitMqConnection;
}

export async function disconnectRabbitMq(): Promise<void> {
  if (!rabbitMqConnection) {
    return;
  }

  const connection = rabbitMqConnection;
  rabbitMqConnection = null;
  await connection.close();
}

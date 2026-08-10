import {
  BookingMessageStreamHub,
  bookingMessageChannel,
} from "@/features/bookings/messages/booking-message-stream.hub";
import type { BookingMessageStreamEvent } from "@/features/bookings/messages/booking-messages.model";

const BOOKING_ID = "booking-1";
const CHANNEL = bookingMessageChannel(BOOKING_ID);

function createSubscriberMock() {
  const handlers = new Map<string, (message: string) => void>();

  const subscriber = {
    handlers,
    on: jest.fn(),
    connect: jest.fn(async () => undefined),
    quit: jest.fn(async () => undefined),
    subscribe: jest.fn(
      async (channel: string, handler: (message: string) => void) => {
        handlers.set(channel, handler);
      },
    ),
    unsubscribe: jest.fn(async (channel: string) => {
      handlers.delete(channel);
    }),
    emit(channel: string, message: string) {
      handlers.get(channel)?.(message);
    },
  };

  return subscriber;
}

function createHub() {
  const subscriber = createSubscriberMock();
  const duplicate = jest.fn(() => subscriber);
  const client = { duplicate } as any;
  const hub = new BookingMessageStreamHub(client);

  return { hub, subscriber, duplicate };
}

const createdEvent: BookingMessageStreamEvent = {
  type: "message.created",
  bookingRequestId: BOOKING_ID,
  message: {
    id: "message-1",
    bookingRequestId: BOOKING_ID,
    authorId: "renter-1",
    authorSide: "renter",
    body: "hello",
    createdAt: "2026-08-10T12:00:00.000Z",
    readAt: null,
  },
};

describe("BookingMessageStreamHub", () => {
  it("opens one subscriber connection and subscribes on the first listener", async () => {
    const { hub, subscriber, duplicate } = createHub();
    const listener = jest.fn();

    await hub.subscribe(BOOKING_ID, listener);

    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.connect).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe.mock.calls[0][0]).toBe(CHANNEL);
    expect(hub.activeChannelCount()).toBe(1);

    await hub.dispose();
  });

  it("reuses the channel subscription for additional listeners", async () => {
    const { hub, subscriber } = createHub();
    const first = jest.fn();
    const second = jest.fn();

    await hub.subscribe(BOOKING_ID, first);
    await hub.subscribe(BOOKING_ID, second);

    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);

    subscriber.emit(CHANNEL, JSON.stringify(createdEvent));

    expect(first).toHaveBeenCalledWith(createdEvent);
    expect(second).toHaveBeenCalledWith(createdEvent);

    await hub.dispose();
  });

  it("creates a single connection when first subscribes race", async () => {
    const { hub, duplicate } = createHub();

    await Promise.all([
      hub.subscribe(BOOKING_ID, jest.fn()),
      hub.subscribe("booking-2", jest.fn()),
    ]);

    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(hub.activeChannelCount()).toBe(2);

    await hub.dispose();
  });

  it("unsubscribes only once the last listener releases", async () => {
    const { hub, subscriber } = createHub();
    const releaseFirst = await hub.subscribe(BOOKING_ID, jest.fn());
    const releaseSecond = await hub.subscribe(BOOKING_ID, jest.fn());

    await releaseFirst();
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();
    expect(hub.activeChannelCount()).toBe(1);

    await releaseSecond();
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(CHANNEL);
    expect(hub.activeChannelCount()).toBe(0);

    await hub.dispose();
  });

  it("ignores repeated release calls", async () => {
    const { hub, subscriber } = createHub();
    const release = await hub.subscribe(BOOKING_ID, jest.fn());

    await release();
    await release();

    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);

    await hub.dispose();
  });

  it("discards malformed payloads without throwing", async () => {
    const { hub, subscriber } = createHub();
    const listener = jest.fn();
    await hub.subscribe(BOOKING_ID, listener);

    expect(() => subscriber.emit(CHANNEL, "{not json")).not.toThrow();
    expect(listener).not.toHaveBeenCalled();

    await hub.dispose();
  });

  it("isolates a listener that throws", async () => {
    const { hub, subscriber } = createHub();
    const failing = jest.fn(() => {
      throw new Error("listener exploded");
    });
    const healthy = jest.fn();

    await hub.subscribe(BOOKING_ID, failing);
    await hub.subscribe(BOOKING_ID, healthy);

    expect(() =>
      subscriber.emit(CHANNEL, JSON.stringify(createdEvent)),
    ).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(createdEvent);

    await hub.dispose();
  });

  it("closes the connection on dispose and stays idempotent", async () => {
    const { hub, subscriber } = createHub();
    await hub.subscribe(BOOKING_ID, jest.fn());

    await hub.dispose();
    await hub.dispose();

    expect(subscriber.quit).toHaveBeenCalledTimes(1);
    expect(hub.activeChannelCount()).toBe(0);
  });

  it("rolls the listener back when the subscribe call fails", async () => {
    const { hub, subscriber } = createHub();
    subscriber.subscribe.mockRejectedValueOnce(new Error("subscribe failed"));

    await expect(hub.subscribe(BOOKING_ID, jest.fn())).rejects.toThrow(
      "subscribe failed",
    );
    expect(hub.activeChannelCount()).toBe(0);

    await hub.dispose();
  });
});

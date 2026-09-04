import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_APP_HEADER_NAME, getClientAppHeader } from "./client-app";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function withoutWindow(run: () => void) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: undefined,
  });

  try {
    run();
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    }
  }
}

describe("getClientAppHeader", () => {
  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    }
  });

  it("declares a browser runtime in the browser", () => {
    expect(getClientAppHeader()).toEqual({
      [CLIENT_APP_HEADER_NAME]: "rentify-web/browser",
    });
  });

  it("declares a server runtime during server rendering", () => {
    withoutWindow(() => {
      expect(getClientAppHeader()).toEqual({
        [CLIENT_APP_HEADER_NAME]: "rentify-web/server",
      });
    });
  });
});

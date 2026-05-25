import { vi } from "vitest";

export const routerReplaceMock = vi.fn();
export const routerPushMock = vi.fn();
export const routerRefreshMock = vi.fn();

export function resetRouterMocks(): void {
  routerReplaceMock.mockReset();
  routerPushMock.mockReset();
  routerRefreshMock.mockReset();
}

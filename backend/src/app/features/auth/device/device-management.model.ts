import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";

export const removeKnownDeviceRequestSchema = z.object({
  deviceId: z.string().trim().min(1, "Device ID is required."),
});

export type RemoveKnownDeviceRequestBody = z.infer<
  typeof removeKnownDeviceRequestSchema
>;

export interface RemoveKnownDeviceInput {
  userId: string;
  deviceId: string;
}

export interface DeviceVerifyResult {
  verified: true;
  device: ClientRequestContext["device"] & {
    known: boolean;
    knownByIp: boolean;
    deviceId?: string;
  };
  auth: {
    userId: string;
    tokenDeviceId?: string;
  };
}

export interface KnownDeviceSummary {
  id: string;
  current: boolean;
  deviceId: string;
  type: string;
  platform?: string;
  userAgent?: string;
  lastIpAddress?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  verifiedAt: string;
}

export interface KnownDeviceListResult {
  devices: KnownDeviceSummary[];
}

export interface RemoveKnownDeviceResult {
  removed: true;
  deviceId: string;
}

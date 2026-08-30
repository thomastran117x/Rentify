import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { Uuid } from "@/configuration/validation/uuid";

export const removeKnownDeviceRequestSchema = z.object({
  deviceId: z.string().trim().min(1, "Device ID is required."),
});

export type RemoveKnownDeviceRequestBody = z.infer<
  typeof removeKnownDeviceRequestSchema
>;

export interface RemoveKnownDeviceInput {
  userId: Uuid;
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
    userId: Uuid;
    tokenDeviceId?: string;
  };
}

export interface KnownDeviceSummary {
  id: Uuid;
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

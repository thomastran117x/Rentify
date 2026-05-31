import { publicJson, textRequest } from "@/lib/api/client";

export interface SystemRoot {
  apiVersion: string;
  apiBasePath: string;
}

export interface HealthStatus {
  ok: boolean;
  uptime: number;
  checks: Record<string, unknown>;
}

export const systemApi = {
  getRoot(): Promise<SystemRoot> {
    return publicJson<SystemRoot>("GET", "/");
  },
  getHealth(): Promise<HealthStatus> {
    return publicJson<HealthStatus>("GET", "/health");
  },
  getOpenApiYaml(): Promise<string> {
    return textRequest("/openapi.yaml");
  },
};

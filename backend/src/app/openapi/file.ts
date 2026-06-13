import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const OPENAPI_YAML_SPEC_RELATIVE_PATH = resolve(
  "openapi",
  "openapi.yaml",
);
export const OPENAPI_JSON_SPEC_RELATIVE_PATH = resolve(
  "openapi",
  "openapi.json",
);

export function getOpenApiYamlSpecFilePath(): string {
  return resolve(process.cwd(), OPENAPI_YAML_SPEC_RELATIVE_PATH);
}

export function getOpenApiJsonSpecFilePath(): string {
  return resolve(process.cwd(), OPENAPI_JSON_SPEC_RELATIVE_PATH);
}

export async function readOpenApiYamlSpecFile(): Promise<string> {
  return readFile(getOpenApiYamlSpecFilePath(), "utf8");
}

export async function readOpenApiJsonSpecFile(): Promise<string> {
  return readFile(getOpenApiJsonSpecFilePath(), "utf8");
}

export async function writeOpenApiYamlSpecFile(contents: string): Promise<void> {
  await mkdir(resolve(process.cwd(), "openapi"), { recursive: true });
  await writeFile(getOpenApiYamlSpecFilePath(), contents, "utf8");
}

export async function writeOpenApiJsonSpecFile(contents: string): Promise<void> {
  await mkdir(resolve(process.cwd(), "openapi"), { recursive: true });
  await writeFile(getOpenApiJsonSpecFilePath(), contents, "utf8");
}

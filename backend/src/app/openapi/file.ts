import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const OPENAPI_SPEC_RELATIVE_PATH = resolve("openapi", "openapi.yaml");

export function getOpenApiSpecFilePath(): string {
  return resolve(process.cwd(), OPENAPI_SPEC_RELATIVE_PATH);
}

export async function readOpenApiSpecFile(): Promise<string> {
  return readFile(getOpenApiSpecFilePath(), "utf8");
}

export async function writeOpenApiSpecFile(contents: string): Promise<void> {
  await mkdir(resolve(process.cwd(), "openapi"), { recursive: true });
  await writeFile(getOpenApiSpecFilePath(), contents, "utf8");
}

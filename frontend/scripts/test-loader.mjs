import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(workspaceRoot, "src");

function resolveAliasPath(specifier) {
  const relativePath = specifier.slice(2);
  const basePath = path.join(srcRoot, relativePath);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const resolvedPath = resolveAliasPath(specifier);

    if (!resolvedPath) {
      throw new Error(`Unable to resolve aliased specifier: ${specifier}`);
    }

    return defaultResolve(pathToFileURL(resolvedPath).href, context, defaultResolve);
  }

  return defaultResolve(specifier, context, defaultResolve);
}

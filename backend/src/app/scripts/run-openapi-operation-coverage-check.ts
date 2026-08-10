import { main } from "@/scripts/check-openapi-operation-coverage";

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

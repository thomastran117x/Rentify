import { DEFAULT_SIGNING_KEY_ID } from "@/configuration/environment/constants";
import type { SigningKeyStatus } from "@/configuration/environment/types";

/**
 * One signing purpose's keys. The current key signs; every key verifies. A
 * token without a kid predates keysets and is verified with kid `default`.
 */
export class SigningKeyring<
  K extends { kid: string; status: SigningKeyStatus },
> {
  private readonly keysByKid: ReadonlyMap<string, K>;
  readonly current: K;

  constructor(keys: readonly K[]) {
    const current = keys.find((key) => key.status === "current");

    if (!current) {
      throw new Error("A signing keyset needs exactly one current key.");
    }

    this.current = current;
    this.keysByKid = new Map(keys.map((key) => [key.kid, key]));
  }

  find(kid: string = DEFAULT_SIGNING_KEY_ID): K | undefined {
    return this.keysByKid.get(kid);
  }
}

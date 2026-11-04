import { DEFAULT_SIGNING_KEY_ID } from "@/configuration/environment/constants";
import type { SigningKeyStatus } from "@/configuration/environment/types";

/**
 * One signing purpose's keys. The current key signs; every key verifies. A
 * token without a kid predates keysets and is verified with kid `default`.
 * The environment parser reports these rules as startup errors; the
 * constructor enforces them again for keys passed in any other way.
 */
export class SigningKeyring<
  K extends { kid: string; status: SigningKeyStatus },
> {
  private readonly keysByKid: ReadonlyMap<string, K>;
  readonly current: K;

  constructor(keys: readonly K[]) {
    const keysByKid = new Map<string, K>();

    for (const key of keys) {
      if (keysByKid.has(key.kid)) {
        throw new Error(
          `A signing keyset lists kid ${key.kid} more than once.`,
        );
      }
      keysByKid.set(key.kid, key);
    }

    const [current, ...otherCurrentKeys] = keys.filter(
      (key) => key.status === "current",
    );

    if (!current || otherCurrentKeys.length > 0) {
      throw new Error("A signing keyset needs exactly one current key.");
    }

    this.current = current;
    this.keysByKid = keysByKid;
  }

  find(kid: string = DEFAULT_SIGNING_KEY_ID): K | undefined {
    return this.keysByKid.get(kid);
  }
}

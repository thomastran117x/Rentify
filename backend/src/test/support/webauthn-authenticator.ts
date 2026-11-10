import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

/** The RP ID and origin the test environment derives from its defaults. */
export const TEST_WEBAUTHN_RP_ID = "localhost";
export const TEST_WEBAUTHN_ORIGIN = "http://localhost:3040";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

const COSE_KTY_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;

export interface SoftwareAuthenticatorOptions {
  /** A synced (multi-device) passkey sets the backup flags. */
  synced?: boolean;
  userVerified?: boolean;
  /** The counter the first registration reports. Synced passkeys stay at 0. */
  initialCounter?: number;
  aaguid?: string;
}

interface CeremonyOptions {
  challenge: string;
  origin?: string;
  rpId?: string;
  type?: string;
}

/**
 * A P-256 authenticator in memory that answers real WebAuthn ceremonies, so
 * tests run the library's verification instead of mocking it. Every response
 * can be bent (origin, RP ID, counter, type) to exercise a rejection.
 */
export class SoftwareAuthenticator {
  readonly credentialId: Uint8Array<ArrayBuffer>;
  counter: number;
  private readonly privateKey: KeyObject;
  private readonly publicKeyCose: Uint8Array;
  private readonly synced: boolean;
  private readonly userVerified: boolean;
  private readonly aaguid: Uint8Array;

  constructor(options: SoftwareAuthenticatorOptions = {}) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const jwk = publicKey.export({ format: "jwk" });

    this.privateKey = privateKey;
    this.publicKeyCose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, COSE_KTY_EC2],
        [3, COSE_ALG_ES256],
        [-1, COSE_CRV_P256],
        [-2, isoBase64URL.toBuffer(jwk.x as string)],
        [-3, isoBase64URL.toBuffer(jwk.y as string)],
      ]),
    );
    this.credentialId = Uint8Array.from(randomBytes(32));
    this.synced = options.synced ?? false;
    this.userVerified = options.userVerified ?? true;
    this.counter = options.initialCounter ?? (this.synced ? 0 : 1);
    this.aaguid = Buffer.from(
      (options.aaguid ?? "00000000-0000-0000-0000-000000000000").replace(
        /-/g,
        "",
      ),
      "hex",
    );
  }

  get id(): string {
    return isoBase64URL.fromBuffer(this.credentialId);
  }

  /** The response `navigator.credentials.create()` would give for `challenge`. */
  createRegistrationResponse(
    options: CeremonyOptions & { transports?: string[] },
  ): RegistrationResponseJSON {
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length);
    const authData = this.buildAuthenticatorData(
      options.rpId ?? TEST_WEBAUTHN_RP_ID,
      FLAG_ATTESTED_CREDENTIAL,
      this.counter,
      Buffer.concat([
        this.aaguid,
        credentialIdLength,
        this.credentialId,
        this.publicKeyCose,
      ]),
    );
    const attestation = new Map<
      string,
      string | Uint8Array | Map<string, never>
    >();
    attestation.set("fmt", "none");
    attestation.set("attStmt", new Map<string, never>());
    attestation.set("authData", authData);
    const attestationObject = isoCBOR.encode(attestation);

    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.buildClientData(options, "webauthn.create"),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: options.transports ?? ["internal"],
      },
    };
  }

  /**
   * The response `navigator.credentials.get()` would give for `challenge`.
   * The counter advances first, as a real one does, unless `counter` is
   * given; synced passkeys always report 0.
   */
  createAssertionResponse(
    options: CeremonyOptions & { counter?: number },
  ): AuthenticationResponseJSON {
    if (options.counter !== undefined) {
      this.counter = options.counter;
    } else if (!this.synced) {
      this.counter += 1;
    }

    const authData = this.buildAuthenticatorData(
      options.rpId ?? TEST_WEBAUTHN_RP_ID,
      0,
      this.counter,
    );
    const clientDataJSON = this.buildClientData(options, "webauthn.get");
    const clientDataHash = createHash("sha256")
      .update(isoBase64URL.toBuffer(clientDataJSON))
      .digest();
    const signature = sign(
      "sha256",
      Buffer.concat([authData, clientDataHash]),
      this.privateKey,
    );

    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON,
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(signature),
      },
    };
  }

  private buildAuthenticatorData(
    rpId: string,
    extraFlags: number,
    counter: number,
    attestedCredentialData?: Buffer,
  ): Uint8Array<ArrayBuffer> {
    const flags =
      FLAG_USER_PRESENT |
      (this.userVerified ? FLAG_USER_VERIFIED : 0) |
      (this.synced ? FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP : 0) |
      extraFlags;
    const signCount = Buffer.alloc(4);
    signCount.writeUInt32BE(counter);

    return Uint8Array.from(
      Buffer.concat([
        createHash("sha256").update(rpId).digest(),
        Buffer.from([flags]),
        signCount,
        ...(attestedCredentialData ? [attestedCredentialData] : []),
      ]),
    );
  }

  private buildClientData(
    options: CeremonyOptions,
    defaultType: "webauthn.create" | "webauthn.get",
  ): string {
    return isoBase64URL.fromUTF8String(
      JSON.stringify({
        type: options.type ?? defaultType,
        challenge: options.challenge,
        origin: options.origin ?? TEST_WEBAUTHN_ORIGIN,
        crossOrigin: false,
      }),
    );
  }
}

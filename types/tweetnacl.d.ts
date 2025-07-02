declare module "tweetnacl" {
  export interface SignKeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }

  export namespace sign {
    export function keyPair(): SignKeyPair;
    export function keyPair_fromSecretKey(secretKey: Uint8Array): SignKeyPair;
    export function keyPair_fromSeed(seed: Uint8Array): SignKeyPair;
    export function detached(
      message: Uint8Array,
      secretKey: Uint8Array
    ): Uint8Array;
    export function detached_verify(
      message: Uint8Array,
      signature: Uint8Array,
      publicKey: Uint8Array
    ): boolean;
    export const publicKeyLength: number;
    export const secretKeyLength: number;
    export const signatureLength: number;
    export const seedLength: number;
  }

  export namespace box {
    export function keyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
    export function keyPair_fromSecretKey(secretKey: Uint8Array): {
      publicKey: Uint8Array;
      secretKey: Uint8Array;
    };
  }

  export function randomBytes(length: number): Uint8Array;
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireControl } from "../domain/validation.ts";
export class PayloadCipher {
  private readonly key: Buffer;
  constructor(hexKey: string) {
    requireControl(/^[0-9a-f]{64}$/i.test(hexKey), "DATA_ENCRYPTION_KEY_REQUIRED");
    this.key = Buffer.from(hexKey, "hex");
  }
  seal(value: unknown, context: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: encrypted.toString("base64") });
  }
  open(value: string, context: string): unknown {
    const record = JSON.parse(value);
    requireControl(record.version === 1, "INVALID_CIPHERTEXT_VERSION");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(record.iv, "base64"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8"));
  }
}

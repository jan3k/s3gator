import { Injectable } from "@nestjs/common";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const raw = configService.getOrThrow<string>("APP_ENCRYPTION_KEY");
    this.key = normalizeKeyMaterial(raw);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  decrypt(ciphertext: string): string {
    const [ivPart, tagPart, bodyPart] = ciphertext.split(".");
    if (!ivPart || !tagPart || !bodyPart) {
      throw new Error("Invalid encrypted payload");
    }

    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const body = Buffer.from(bodyPart, "base64url");

    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(body), decipher.final()]);
    return decrypted.toString("utf8");
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}

function normalizeKeyMaterial(value: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  try {
    const maybe = Buffer.from(value, "base64");
    if (maybe.length >= 32) {
      return maybe.subarray(0, 32);
    }
  } catch {
    // fallback below
  }

  return createHash("sha256").update(value).digest();
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Key comes from the environment (a Kubernetes Secret in the cluster), never from the DB.
function loadKey(b64 = process.env.GATEWAY_ENC_KEY): Buffer {
  const key = Buffer.from(b64 ?? "", "base64");
  if (key.length !== 32) throw new Error("GATEWAY_ENC_KEY must be 32 bytes, base64 encoded");
  return key;
}

// Output format: base64( iv[12] | authTag[16] | ciphertext )
export function encrypt(plaintext: string, key = loadKey()): string {
  const iv = randomBytes(12); // IMPORTANT: new random IV every time; reusing an IV with GCM breaks it
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(payload: string, key = loadKey()): string {
  const buf = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28)); // GCM = encrypt + tamper check; wrong key/edited data throws
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

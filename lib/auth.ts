import crypto from "crypto";

export function requireAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    throw new Error("ADMIN_PASSWORD is not configured.");
  }

  return password;
}

export function isAdminPasswordValid(input: unknown): boolean {
  const configured = requireAdminPassword();

  if (typeof input !== "string") {
    return false;
  }

  const inputBuffer = Buffer.from(input);
  const configuredBuffer = Buffer.from(configured);

  if (inputBuffer.length !== configuredBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(inputBuffer, configuredBuffer);
}

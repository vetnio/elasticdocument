const requiredEnvVars = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "ANTHROPIC_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
] as const;

const optionalEnvVars = [
  "HUGGINGFACE_API_KEY",
  "HUGGINGFACE_OCR_ENDPOINT",
] as const;

export function validateEnv() {
  const missing: string[] = [];

  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}\n\nCheck your .env file or deployment settings.`
    );
  }

  const missingOptional: string[] = [];
  for (const key of optionalEnvVars) {
    if (!process.env[key]) {
      missingOptional.push(key);
    }
  }

  if (missingOptional.length > 0) {
    console.warn(
      `[elasticdocument] Missing optional env vars (OCR will not work): ${missingOptional.join(", ")}`
    );
  }
}

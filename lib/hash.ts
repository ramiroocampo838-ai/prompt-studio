import { createHash } from "node:crypto"

// Stable short hash of the values that determine an artifact.
export function hashOf(...parts: (string | number | undefined)[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 16)
}

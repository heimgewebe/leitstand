import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = path.resolve(__dirname, "..", "vendor", "contracts");
const PIN_PATH = path.join(TARGET_DIR, "_pin.json");
const DEFAULT_MAX_PIN_AGE_DAYS = 180;

function fail(message) {
  console.error(`[vendor-check] ${message}`);
  process.exitCode = 1;
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function vendorPathFor(contractPath, entry) {
  if (entry && typeof entry.vendor_path === "string" && entry.vendor_path.trim()) {
    return entry.vendor_path;
  }
  return contractPath.replace(/^contracts\//, "");
}

function readPin() {
  if (!fs.existsSync(PIN_PATH)) {
    fail(`missing pin file: ${path.relative(process.cwd(), PIN_PATH)}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(PIN_PATH, "utf8"));
  } catch (error) {
    fail(`invalid pin JSON: ${error.message}`);
    return null;
  }
}

function checkPinAge(pin) {
  const raw = pin.fetched_at;
  if (typeof raw !== "string" || !raw) {
    fail("pin fetched_at must be a non-empty ISO timestamp");
    return;
  }
  const fetchedMs = new Date(raw).getTime();
  if (Number.isNaN(fetchedMs)) {
    fail(`pin fetched_at is not parseable: ${raw}`);
    return;
  }
  const maxAgeDays = Number(process.env.LEITSTAND_VENDOR_PIN_MAX_AGE_DAYS || DEFAULT_MAX_PIN_AGE_DAYS);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    fail("LEITSTAND_VENDOR_PIN_MAX_AGE_DAYS must be a positive number when set");
    return;
  }
  const ageDays = Math.floor((Date.now() - fetchedMs) / 86_400_000);
  if (ageDays < 0) {
    fail(`pin fetched_at is in the future: ${raw}`);
  }
  if (ageDays > maxAgeDays) {
    fail(`pin is stale: ${ageDays} days old, max ${maxAgeDays}`);
  }
}

const pin = readPin();
if (pin) {
  if (!pin.contracts || typeof pin.contracts !== "object" || Array.isArray(pin.contracts)) {
    fail("pin contracts must be an object");
  } else {
    checkPinAge(pin);
    for (const [contractPath, entry] of Object.entries(pin.contracts)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        fail(`${contractPath}: pin entry must be an object`);
        continue;
      }
      if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
        fail(`${contractPath}: sha256 must be a lowercase 64-character hex digest`);
      }
      if (typeof entry.url !== "string" || !entry.url.includes(contractPath)) {
        fail(`${contractPath}: url must include the pinned source path`);
      }
      if (entry.status || entry.warning) {
        fail(`${contractPath}: cached fallback or warning is not allowed in committed pins`);
      }

      const relativeVendorPath = vendorPathFor(contractPath, entry);
      const filePath = path.join(TARGET_DIR, relativeVendorPath);
      const normalized = path.relative(TARGET_DIR, filePath);
      if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        fail(`${contractPath}: vendor_path escapes vendor/contracts`);
        continue;
      }
      if (!fs.existsSync(filePath)) {
        fail(`${contractPath}: vendored file missing at ${relativeVendorPath}`);
        continue;
      }
      const actual = sha256(filePath);
      if (actual !== entry.sha256) {
        fail(`${contractPath}: SHA mismatch for ${relativeVendorPath}; expected ${entry.sha256}, got ${actual}`);
      }
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("[vendor-check] vendored contracts match pin");

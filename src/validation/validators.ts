import Ajv from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { envConfig } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(__dirname, '..', '..', 'vendor', 'contracts');

const PLEXER_REPORT_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'plexer', 'delivery.report.v1.schema.json');

type AjvValidateFn = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };

let plexerReportValidate: AjvValidateFn | null = null;
let compiledStrict: boolean | null = null;

function buildAjv(strict: boolean) {
  const ajv = new Ajv({ strict, allErrors: true });
  addFormats(ajv);
  return ajv;
}

function compilePlexerReportValidator(): { ok: true; validate: AjvValidateFn } | { ok: false; error: string; status: 503 | 500 } {
  const wantStrict = envConfig.isStrict;

  // Reuse if already compiled for current strictness
  if (plexerReportValidate && compiledStrict === wantStrict) {
    return { ok: true, validate: plexerReportValidate };
  }

  if (!fs.existsSync(PLEXER_REPORT_SCHEMA_PATH)) {
    plexerReportValidate = null;
    compiledStrict = null;
    return { ok: false, error: 'Schema missing', status: 503 };
  }

  try {
    const schema = JSON.parse(fs.readFileSync(PLEXER_REPORT_SCHEMA_PATH, 'utf8'));
    const ajv = buildAjv(wantStrict);
    const validate = ajv.compile(schema) as AjvValidateFn;
    plexerReportValidate = validate;
    compiledStrict = wantStrict;
    console.log(`[Validation] Compiled plexer report validator (strict=${wantStrict})`);
    return { ok: true, validate };
  } catch (e: unknown) {
    plexerReportValidate = null;
    compiledStrict = null;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Validation] Failed to compile validator: ${msg}`);
    return { ok: false, error: 'Failed to compile validator', status: 500 };
  }
}

export function resetValidators() {
  plexerReportValidate = null;
  compiledStrict = null;
}

export const validatePlexerReport = (data: unknown) => {
  const compiled = compilePlexerReportValidator();
  if (!compiled.ok) {
    console.log('[Validation] validatePlexerReport unavailable:', compiled.error);
    // 503 for missing schema; 500 for compile failure
    return { valid: false, error: compiled.error, status: compiled.status };
  }

  const valid = compiled.validate(data);
  if (!valid) {
    const errorMsg = compiled.validate.errors?.map(e => `${e.instancePath} ${e.message}`).join(', ') || 'Unknown validation error';
    return { valid: false, error: errorMsg, status: 400 };
  }

  return { valid: true, status: 200 };
};

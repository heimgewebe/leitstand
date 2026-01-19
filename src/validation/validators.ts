import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ajv = new Ajv({ strict: true });
addFormats(ajv);

const CONTRACTS_DIR = path.resolve(__dirname, '..', '..', 'vendor', 'contracts');

const PLEXER_REPORT_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'plexer', 'delivery.report.v1.schema.json');
let plexerReportValidate = null;

if (fs.existsSync(PLEXER_REPORT_SCHEMA_PATH)) {
    try {
        const schema = JSON.parse(fs.readFileSync(PLEXER_REPORT_SCHEMA_PATH, 'utf8'));
        plexerReportValidate = ajv.compile(schema);
        console.log('[Validation] Compiled plexer report validator');
    } catch (e) {
        console.warn('[Validation] Failed to compile plexer report validator:', e.message);
    }
} else {
    console.warn('[Validation] Plexer report schema missing at', PLEXER_REPORT_SCHEMA_PATH);
}

export const validatePlexerReport = (data: unknown) => {
    if (!plexerReportValidate) {
        console.log('[Validation] validatePlexerReport called but validator is null');
        return { valid: false, error: "Validator not initialized (schema missing or invalid)", status: 503 };
    }
    const valid = plexerReportValidate(data);
    if (!valid) {
        const errorMsg = plexerReportValidate.errors?.map(e => `${e.instancePath} ${e.message}`).join(', ');
        return { valid: false, error: errorMsg, status: 400 };
    }
    return { valid: true, status: 200 };
};

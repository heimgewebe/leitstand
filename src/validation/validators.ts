import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { envConfig } from '../config.js';

const CONTRACTS_DIR = path.resolve(process.cwd(), 'vendor', 'contracts');
const PLEXER_REPORT_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'plexer', 'delivery.report.v1.schema.json');

// Lazy-loaded instances
let ajv: Ajv | null = null;
let plexerReportValidate: any = null;

const getAjv = () => {
    if (!ajv) {
        ajv = new Ajv({ strict: envConfig.isStrict });
        addFormats(ajv);
    }
    return ajv;
};

const getPlexerReportValidator = () => {
    if (plexerReportValidate) return plexerReportValidate;

    if (fs.existsSync(PLEXER_REPORT_SCHEMA_PATH)) {
        try {
            const schema = JSON.parse(fs.readFileSync(PLEXER_REPORT_SCHEMA_PATH, 'utf8'));
            const validator = getAjv().compile(schema);
            plexerReportValidate = validator;
            console.log('[Validation] Compiled plexer report validator');
        } catch (e: any) {
            console.warn('[Validation] Failed to compile plexer report validator:', e.message);
        }
    } else {
        console.warn('[Validation] Plexer report schema missing at', PLEXER_REPORT_SCHEMA_PATH);
    }
    return plexerReportValidate;
};

/**
 * Resets the validators. Call this in tests when changing envConfig.
 */
export const resetValidators = () => {
    ajv = null;
    plexerReportValidate = null;
};

export const validatePlexerReport = (data: unknown) => {
    const validate = getPlexerReportValidator();

    if (!validate) {
        console.log('[Validation] validatePlexerReport called but validator is null');
        return { valid: false, error: "Validator not initialized (schema missing or invalid)", status: 503 };
    }

    const valid = validate(data);
    if (!valid) {
        const errorMsg = validate.errors?.map((e: any) => `${e.instancePath} ${e.message}`).join(', ');
        return { valid: false, error: errorMsg, status: 400 };
    }
    return { valid: true, status: 200 };
};

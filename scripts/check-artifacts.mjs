import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const isStrict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === 'production' || process.env.OBSERVATORY_STRICT === '1';

if (!isStrict) {
    console.log('[check-artifacts] Non-strict mode, skipping checks.');
    process.exit(0);
}

console.log('[check-artifacts] Running strict artifact validation...');

const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const RAW_PATH = process.env.OBSERVATORY_ARTIFACT_PATH || path.join(ARTIFACTS_DIR, 'knowledge.observatory.json');
const DAILY_PATH = path.join(ARTIFACTS_DIR, 'insights.daily.json');
const META_PATH = path.join(ARTIFACTS_DIR, '_meta.json');

let errors = [];

function checkFile(label, p, mustParse = true) {
    if (!fs.existsSync(p)) {
        errors.push(`${label} artifact missing at ${p}`);
        return false;
    }
    try {
        const content = fs.readFileSync(p, 'utf-8');
        if (!content || !content.trim()) {
            errors.push(`${label} artifact is empty`);
            return false;
        }
        if (mustParse) {
            JSON.parse(content);
        }
    } catch (e) {
        errors.push(`${label} artifact invalid JSON: ${e.message}`);
        return false;
    }
    console.log(`[check-artifacts] OK: ${label}`);
    return true;
}

checkFile('Raw Observatory', RAW_PATH);
checkFile('Daily Insights', DAILY_PATH);
checkFile('Meta Forensics', META_PATH);

if (errors.length > 0) {
    console.error('[check-artifacts] STRICT CHECK FAILED:');
    errors.forEach(e => console.error(` - ${e}`));
    console.error('Run "pnpm build:cf" to fetch valid artifacts.');
    process.exit(1);
}

console.log('[check-artifacts] All artifacts valid.');
process.exit(0);

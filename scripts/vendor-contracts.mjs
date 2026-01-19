import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { createHash } from "crypto";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = path.resolve(__dirname, "..", "vendor", "contracts");
const METAREPO_BASE = process.env.METAREPO_BASE_URL || "https://raw.githubusercontent.com/heimgewebe/metarepo/main";

const CONTRACTS = [
    "contracts/knowledge/observatory.schema.json",
    "contracts/plexer/delivery.report.v1.schema.json"
];

async function fetchContract(url, dest) {
    console.log(`[vendor] Fetching ${url}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const fileStream = fs.createWriteStream(dest);
    await finished(Readable.fromWeb(res.body).pipe(fileStream));

    const content = fs.readFileSync(dest);
    return createHash('sha256').update(content).digest('hex');
}

async function main() {
    await fs.promises.mkdir(TARGET_DIR, { recursive: true });

    const pin = {
        source: METAREPO_BASE,
        fetched_at: new Date().toISOString(),
        contracts: {}
    };

    for (const contractPath of CONTRACTS) {
        const url = `${METAREPO_BASE}/${contractPath}`;

        // Map "contracts/knowledge/observatory.schema.json" -> "vendor/contracts/knowledge/observatory.schema.json"
        // We strip "contracts/" prefix relative to TARGET_DIR if TARGET_DIR implies vendor/contracts
        // Actually, let's keep the structure under vendor/contracts/ as-is from metarepo/contracts/
        const relativePath = contractPath.replace(/^contracts\//, '');
        const dest = path.join(TARGET_DIR, relativePath);

        await fs.promises.mkdir(path.dirname(dest), { recursive: true });

        try {
            const sha = await fetchContract(url, dest);
            pin.contracts[contractPath] = { sha256: sha, url };
            console.log(`[vendor] Updated ${relativePath} (SHA: ${sha.substring(0, 8)}...)`);
        } catch (e) {
            console.warn(`[vendor] Failed to fetch ${contractPath}: ${e.message}`);
            if (!fs.existsSync(dest)) {
                 process.exit(1);
            }
        }
    }

    fs.writeFileSync(path.join(TARGET_DIR, "_pin.json"), JSON.stringify(pin, null, 2));
    console.log("[vendor] Vendoring complete.");

    // Post-processing: Check canonical IDs
    console.log("[vendor] verifying canonical IDs...");
    for (const contractPath of CONTRACTS) {
        const relativePath = contractPath.replace(/^contracts\//, '');
        const dest = path.join(TARGET_DIR, relativePath);

        if (fs.existsSync(dest)) {
            try {
                const schema = JSON.parse(fs.readFileSync(dest, 'utf8'));
                if (schema.$id && !schema.$id.startsWith("https://schemas.heimgewebe.org/contracts/")) {
                    console.warn(`[vendor] WARN: Schema ${relativePath} has non-canonical ID: ${schema.$id}`);
                }
            } catch (e) {
                console.warn(`[vendor] Failed to parse ${relativePath} for ID check.`);
            }
        }
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});

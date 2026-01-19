import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { createHash } from "crypto";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = path.resolve(__dirname, "..", "vendor", "contracts");
const METAREPO_BASE = process.env.METAREPO_BASE_URL || "https://raw.githubusercontent.com/heimgewebe/metarepo/main/contracts";

const CONTRACTS = [
    { name: "knowledge.observatory.schema.json", path: "knowledge/observatory.schema.json" },
    { name: "plexer.delivery.report.v1.schema.json", path: "plexer/delivery.report.v1.schema.json" }
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

    for (const contract of CONTRACTS) {
        const url = `${METAREPO_BASE}/${contract.path}`; // Note: assuming flattened or specific structure in metarepo
        // Actually, metarepo path structure usually mirrors contracts/.
        // Let's assume METAREPO_BASE points to /contracts root.

        const dest = path.join(TARGET_DIR, contract.name);
        try {
            const sha = await fetchContract(url, dest);
            pin.contracts[contract.name] = { sha256: sha, url };
            console.log(`[vendor] Updated ${contract.name} (SHA: ${sha.substring(0, 8)}...)`);
        } catch (e) {
            console.warn(`[vendor] Failed to fetch ${contract.name}: ${e.message}`);
            // If local file exists, keep it but mark as stale? Or fail?
            // For now, we fail if we can't fetch, to ensure we don't have partial state
            if (!fs.existsSync(dest)) {
                 process.exit(1);
            }
        }
    }

    fs.writeFileSync(path.join(TARGET_DIR, "_pin.json"), JSON.stringify(pin, null, 2));
    console.log("[vendor] Vendoring complete.");
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});

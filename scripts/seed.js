#!/usr/bin/env node
// CLI wrapper: creates/reuses an OpenFGA store, writes the model, writes all
// seed tuples. Prints store_id/model_id and also writes seed/output.json
// (handy for the check.sh script during local development).
const fs = require("fs");
const path = require("path");
const { makeClient } = require("../lib/openfgaClient");

const API_URL = process.env.OPENFGA_API_URL || "http://localhost:8081";
const API_KEY = process.env.OPENFGA_API_KEY || "";
const STORE_NAME = process.env.OPENFGA_STORE_NAME || "vls-authority-spike";

async function main() {
  const org = JSON.parse(fs.readFileSync(path.join(__dirname, "../seed/org.json"), "utf8"));
  const model = JSON.parse(fs.readFileSync(path.join(__dirname, "../model/model.json"), "utf8"));
  const client = makeClient({ apiUrl: API_URL, apiKey: API_KEY });

  const { id: storeId, created } = await client.findOrCreateStore(STORE_NAME);
  console.error(`store: ${storeId} (${created ? "created" : "reused"})`);

  const modelId = await client.ensureModel(storeId, model);
  console.error(`model: ${modelId}`);

  const tuples = client.buildTuples(org);
  const { written, skipped } = await client.writeTuplesIdempotent(storeId, tuples);
  console.error(`tuples: ${written} written, ${skipped} already present`);

  const out = { storeId, modelId, apiUrl: API_URL, tupleCount: tuples.length };
  fs.writeFileSync(path.join(__dirname, "../seed/output.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
// Compiles the OpenFGA DSL model to the JSON the write-authorization-model
// API accepts. Run: node scripts/dsl2json.js openfga/model.fga openfga/model.json
const fs = require("fs");
const { transformer, validator } = require("@openfga/syntax-transformer");

const [, , inPath, outPath] = process.argv;
const dsl = fs.readFileSync(inPath, "utf8");

const errors = validator.validateDSL(dsl);
if (errors && errors.length) {
  console.error("DSL validation errors:", JSON.stringify(errors, null, 2));
  process.exit(1);
}

const json = transformer.transformDSLToJSONObject(dsl);
fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
console.log(`OK: wrote ${outPath}`);

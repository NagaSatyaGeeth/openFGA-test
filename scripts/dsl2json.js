#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { transformer, validator } = require("@openfga/syntax-transformer");

const dslPath = process.argv[2];
const outPath = process.argv[3];

const dsl = fs.readFileSync(dslPath, "utf8");

const errors = validator.validateDSL(dsl);
if (errors && errors.length) {
  console.error("DSL validation errors:", JSON.stringify(errors, null, 2));
  process.exit(1);
}

const json = transformer.transformDSLToJSONObject(dsl);
fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
console.log(`OK: wrote ${outPath}`);

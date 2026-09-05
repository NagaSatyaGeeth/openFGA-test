#!/usr/bin/env bash
set -euo pipefail
STORE_ID=$(node -e "console.log(require('./seed/output.json').storeId)")
MODEL_ID=$(node -e "console.log(require('./seed/output.json').modelId)")
API_URL="http://localhost:8081"
KEY="vls-demo-local-key"

USER="$1"
RELATION="$2"
OBJECT="$3"

curl -sS -X POST "$API_URL/stores/$STORE_ID/check" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"authorization_model_id\":\"$MODEL_ID\",\"tuple_key\":{\"user\":\"employee:$USER\",\"relation\":\"$RELATION\",\"object\":\"employee:$OBJECT\"}}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.allowed===true?'ALLOW':'DENY', JSON.stringify(j))})"

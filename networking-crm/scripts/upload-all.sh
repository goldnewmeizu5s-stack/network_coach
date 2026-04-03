#!/bin/bash
set -e

API_URL="${API_URL:-https://networkcoach-production.up.railway.app}"
AUTH_PIN="${AUTH_PIN:-2005}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Authenticating..."
curl -s -c "$SCRIPT_DIR/cookies.txt" -X POST "$API_URL/api/auth/verify" \
  -H "Content-Type: application/json" \
  -d "{\"pin\":\"$AUTH_PIN\"}" && echo ""

echo "=== Auth done. Uploading batches..."

echo "--- Batch 1/3 (batch_1.json)..."
curl -s -b "$SCRIPT_DIR/cookies.txt" -X POST "$API_URL/api/methodologies/bulk" \
  -H "Content-Type: application/json" \
  -d @"$SCRIPT_DIR/batch_1.json"
echo ""
sleep 1

echo "--- Batch 2/3 (batch_2.json)..."
curl -s -b "$SCRIPT_DIR/cookies.txt" -X POST "$API_URL/api/methodologies/bulk" \
  -H "Content-Type: application/json" \
  -d @"$SCRIPT_DIR/batch_2.json"
echo ""
sleep 1

echo "--- Batch 3/3 (batch_3.json)..."
curl -s -b "$SCRIPT_DIR/cookies.txt" -X POST "$API_URL/api/methodologies/bulk" \
  -H "Content-Type: application/json" \
  -d @"$SCRIPT_DIR/batch_3.json"
echo ""

echo "=== Done! Uploaded 120 methodologies in 3 batches."
rm -f "$SCRIPT_DIR/cookies.txt"

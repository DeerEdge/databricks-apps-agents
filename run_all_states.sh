#!/usr/bin/env bash
# Runs image enrichment for all remaining map-visible ICU states.
# Ordered by gap severity (worst gaps first) so high-priority states
# get images even if you kill the script early.
# Run from the repo root: bash run_all_states.sh
set -euo pipefail

cd "$(dirname "$0")"

LOG_DIR="logs/enrichment"
mkdir -p "$LOG_DIR"

run_state() {
  local state="$1"
  local log="$LOG_DIR/$(echo "$state" | tr ' ' '_' | tr '[:upper:]' '[:lower:]').log"
  echo ""
  echo "════════════════════════════════════════"
  echo "  Starting: $state  ($(date '+%H:%M:%S'))"
  echo "════════════════════════════════════════"
  PIPELINE_MAX_WORKERS=2 python enrich_images.py \
    --state "$state" --capability icu --verbose 2>&1 | tee "$log"
  echo "  Done: $state  ($(date '+%H:%M:%S'))"
}

# ── Gap-priority states (worst map gaps first) ─────────────────────────────
# Skipping: Chandigarh (done), Kerala (done, 0 hits), Delhi (done), Bihar (done)
run_state "Meghalaya"          # gap 0.368 — worst gap,  5 facilities
run_state "Manipur"            # gap 0.285,  6 facilities
run_state "Jharkhand"          # gap 0.214, 41 facilities
run_state "Uttarakhand"        # gap 0.161, 40 facilities
run_state "Assam"              # gap 0.138, 37 facilities
run_state "Chhattisgarh"       # gap 0.136, 54 facilities
run_state "Himachal Pradesh"   # gap 0.119, 10 facilities
run_state "Jammu And Kashmir"  # gap 0.080, 17 facilities
run_state "Madhya Pradesh"     # gap 0.075, 104 facilities
run_state "Odisha"             # gap 0.07x,  31 facilities

# ── High-volume states ─────────────────────────────────────────────────────
run_state "Maharashtra"        # 511 facilities
run_state "Uttar Pradesh"      # 306 facilities
run_state "Gujarat"            # 279 facilities
run_state "Tamil Nadu"         # 272 facilities
run_state "Karnataka"          # 166 facilities
run_state "Haryana"            # 166 facilities
run_state "Punjab"             # 145 facilities
run_state "Rajasthan"          # 140 facilities
run_state "Telangana"          # 131 facilities
run_state "West Bengal"        # 131 facilities
run_state "Andhra Pradesh"     # 114 facilities

# ── Smaller / union territories ────────────────────────────────────────────
run_state "Goa"
run_state "Jammu & Kashmir"    # alternate spelling in data
run_state "Nagaland"
run_state "Tripura"
run_state "Arunachal Pradesh"
run_state "Mizoram"
run_state "Sikkim"

echo ""
echo "════════════════════════════════════════"
echo "  ALL STATES COMPLETE  ($(date '+%H:%M:%S'))"
echo "════════════════════════════════════════"

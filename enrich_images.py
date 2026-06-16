#!/usr/bin/env python3
"""
Hospital image enrichment CLI.

Usage:
  # Enrich all hospitals for the ICU capability across all states:
  python enrich_images.py

  # Only hospitals that don't have a verified image yet:
  python enrich_images.py --only-missing

  # Target a specific capability and/or state:
  python enrich_images.py --capability maternity --state Bihar

  # Verbose logging:
  python enrich_images.py --verbose

Environment variables (required):
  DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID

Environment variables (optional):
  ANTHROPIC_API_KEY        — enables Claude vision validation (recommended)
  DATABRICKS_VOLUMES_PATH  — e.g. /Volumes/workspace/meddesert/images
                             Enables thumbnail upload; falls back to source URL if absent.
"""

import argparse
import logging
import os
import sys
import time
from pathlib import Path

# Allow running from the repo root without installing the package
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv  # type: ignore[import-untyped]

load_dotenv(".env.local")

from image_enrichment import Config, ImageEnrichmentPipeline
from image_enrichment.reporting import print_report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich hospital facility records with verified ICU/hospital images."
    )
    parser.add_argument(
        "--capability",
        default="icu",
        choices=["icu", "maternity", "emergency", "oncology", "trauma", "nicu"],
        help="Clinical capability to target (default: icu)",
    )
    parser.add_argument(
        "--state",
        default=None,
        help="Restrict to a single Indian state (e.g. 'Bihar'). Default: all states.",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Skip hospitals that already have at least one verified image.",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Debug-level logging.",
    )
    args = parser.parse_args()

    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
        level=log_level,
    )

    # Validate required env vars before loading Config (which will raise with a clear message)
    missing = [v for v in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_WAREHOUSE_ID")
               if not os.environ.get(v)]
    if missing:
        print(f"ERROR: missing required environment variables: {', '.join(missing)}", file=sys.stderr)
        print("Set them in .env.local or export them before running.", file=sys.stderr)
        sys.exit(1)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "WARNING: ANTHROPIC_API_KEY not set — running heuristic-only validation "
            "(less accurate). Set ANTHROPIC_API_KEY for Claude vision scoring.\n"
        )

    cfg = Config.from_env()
    pipeline = ImageEnrichmentPipeline(cfg)

    t0 = time.time()
    stats = pipeline.run(
        capability=args.capability,
        state=args.state,
        only_missing=args.only_missing,
    )
    elapsed = time.time() - t0

    print_report(stats, elapsed)

    if stats.images_accepted == 0 and stats.hospitals_input > 0:
        print(
            "No images were accepted. Check that ANTHROPIC_API_KEY is set, "
            "or review the logs with --verbose.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()

"""Terminal report printed at the end of a pipeline run."""

from __future__ import annotations

import textwrap
from datetime import datetime, timezone

from .pipeline import RunStats


def print_report(stats: RunStats, elapsed_s: float) -> None:
    started = stats.started_at.strftime("%Y-%m-%d %H:%M UTC")
    total_images = stats.images_accepted + stats.images_rejected
    acceptance_rate = (
        f"{stats.images_accepted / total_images * 100:.0f}%"
        if total_images
        else "n/a"
    )

    lines = [
        "",
        "═" * 62,
        "  IMAGE ENRICHMENT PIPELINE — FINAL REPORT",
        "═" * 62,
        f"  Run ID          : {stats.run_id}",
        f"  Started         : {started}",
        f"  Elapsed         : {elapsed_s:.0f}s",
        "─" * 62,
        f"  Hospitals input : {stats.hospitals_input}",
        f"  Hospitals done  : {stats.hospitals_done}",
        f"  Hospitals failed: {len(stats.errors)}",
        "─" * 62,
        f"  Images accepted : {stats.images_accepted}",
        f"  Images rejected : {stats.images_rejected}",
        f"  Acceptance rate : {acceptance_rate}",
        f"  Avg confidence  : {stats.avg_confidence:.2f}",
        "─" * 62,
    ]

    if stats.errors:
        lines.append("  Errors:")
        for e in stats.errors[:10]:
            lines.append(f"    · {textwrap.shorten(e, 56)}")
        if len(stats.errors) > 10:
            lines.append(f"    … and {len(stats.errors) - 10} more")
        lines.append("─" * 62)

    lines += [
        "  Results written to workspace.meddesert.hospital_images",
        "  Map assets in  workspace.meddesert.hospital_map_assets",
        "═" * 62,
        "",
    ]
    print("\n".join(lines))

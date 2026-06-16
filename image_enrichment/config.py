"""Runtime configuration loaded from environment variables."""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Config:
    # Databricks SQL (reads facilities + writes enrichment tables)
    databricks_host: str = field(default_factory=lambda: os.environ["DATABRICKS_HOST"])
    databricks_token: str = field(default_factory=lambda: os.environ["DATABRICKS_TOKEN"])
    warehouse_id: str = field(default_factory=lambda: os.environ["DATABRICKS_WAREHOUSE_ID"])

    # Anthropic Claude — vision validation
    # If absent the pipeline falls back to heuristic-only scoring (no vision check).
    anthropic_api_key: Optional[str] = field(
        default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY")
    )
    vision_model: str = "claude-haiku-4-5-20251001"

    # Databricks target tables (Unity Catalog three-part names)
    catalog: str = field(default_factory=lambda: os.environ.get("DBX_CATALOG", "workspace"))
    schema: str = field(default_factory=lambda: os.environ.get("DBX_SCHEMA", "meddesert"))

    # Databricks Volumes path for thumbnail storage (optional).
    # Format: /Volumes/<catalog>/<schema>/<volume>
    volumes_root: Optional[str] = field(
        default_factory=lambda: os.environ.get("DATABRICKS_VOLUMES_PATH")
    )

    # Pipeline tuning
    max_images_per_hospital: int = 3
    min_overall_confidence: float = 0.55
    min_entity_match: float = 0.80
    request_timeout: int = 15
    request_delay_s: float = 1.2   # polite crawl delay between HTTP requests
    max_workers: int = field(default_factory=lambda: int(os.environ.get("PIPELINE_MAX_WORKERS", "2")))
    thumbnail_size: tuple[int, int] = (256, 256)

    @property
    def images_table(self) -> str:
        return f"{self.catalog}.{self.schema}.hospital_images"

    @property
    def map_assets_table(self) -> str:
        return f"{self.catalog}.{self.schema}.hospital_map_assets"

    @property
    def scrape_runs_table(self) -> str:
        return f"{self.catalog}.{self.schema}.image_scrape_runs"

    @classmethod
    def from_env(cls) -> "Config":
        return cls()

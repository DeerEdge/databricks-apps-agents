"""Optional upload of thumbnails to Databricks Volumes.

If DATABRICKS_VOLUMES_PATH is not set the upload is skipped and the original
validated source URL is used directly in the map popup.
"""

from __future__ import annotations

import logging
import posixpath

import requests

from .config import Config

log = logging.getLogger(__name__)


class VolumeStorage:
    """Upload thumbnail bytes to a Databricks Volume via the Files API."""

    def __init__(self, cfg: Config) -> None:
        self._host = cfg.databricks_host.rstrip("/")
        self._token = cfg.databricks_token
        self._root = (cfg.volumes_root or "").rstrip("/")
        self._enabled = bool(self._root)
        self._session = requests.Session()
        self._session.headers.update({"Authorization": f"Bearer {self._token}"})

    def upload_thumbnail(
        self,
        state: str,
        city: str,
        hospital_name: str,
        image_id: str,
        thumbnail_bytes: bytes,
    ) -> str | None:
        """Upload thumbnail to Volumes and return its DBFS path, or None if disabled."""
        if not self._enabled:
            return None

        safe_state = _safe(state)
        safe_city = _safe(city)
        safe_name = _safe(hospital_name)[:60]
        path = posixpath.join(self._root, safe_state, safe_city, safe_name, f"{image_id}.jpg")
        encoded_path = path.lstrip("/")

        try:
            url = f"{self._host}/api/2.0/fs/files/{encoded_path}"
            resp = self._session.put(
                url,
                data=thumbnail_bytes,
                headers={"Content-Type": "image/jpeg"},
                timeout=30,
            )
            if resp.status_code in (200, 201, 204):
                log.debug("Uploaded thumbnail: %s", path)
                return path
            log.warning("Volume upload HTTP %d for %s", resp.status_code, path)
        except Exception as e:
            log.warning("Volume upload failed for %s: %s", image_id, e)
        return None

    def thumbnail_url(self, volume_path: str) -> str:
        """Construct the proxy URL that the Next.js app will use to serve this thumbnail."""
        return f"/api/facility-image-file?path={volume_path}"


def _safe(s: str) -> str:
    """Slugify a string for use as a path component."""
    import re
    return re.sub(r"[^a-zA-Z0-9_-]", "_", s.strip().lower())

"""Download, validate, and fingerprint image candidates."""

from __future__ import annotations

import hashlib
import io
import logging
import threading
import time
from dataclasses import dataclass
from typing import Optional

import requests
from PIL import Image

from .config import Config

# Serialize CDN downloads to 1 at a time with a polite delay.
# Wikimedia CDN rate-limits after ~3 rapid concurrent requests.
_CDN_LOCK = threading.Lock()
_CDN_DELAY_S = 1.5  # seconds between image downloads

log = logging.getLogger(__name__)

# Minimum acceptable dimensions (rejects icons, favicons, tracking pixels)
MIN_WIDTH = 200
MIN_HEIGHT = 150
# Maximum file size to download (8 MB guard)
MAX_BYTES = 8 * 1024 * 1024

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}


@dataclass
class DownloadedImage:
    url: str
    data: bytes
    width: int
    height: int
    file_size: int
    sha256: str
    mime: str
    # thumbnail bytes (256×256 JPEG)
    thumbnail: bytes


class ImageDownloader:
    _HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
        ),
        "Accept": "image/webp,image/png,image/jpeg,*/*",
    }

    def __init__(self, cfg: Config) -> None:
        self._timeout = cfg.request_timeout
        self._thumb_size = cfg.thumbnail_size
        self._session = requests.Session()
        self._session.headers.update(self._HEADERS)

    def fetch(self, url: str) -> Optional[DownloadedImage]:
        """Download an image URL and return a validated DownloadedImage, or None on failure."""
        try:
            with _CDN_LOCK:
                time.sleep(_CDN_DELAY_S)  # polite delay before every download
                for attempt in range(2):
                    resp = self._session.get(
                        url, timeout=self._timeout, stream=True, allow_redirects=True
                    )
                    if resp.status_code == 429:
                        wait = min(float(resp.headers.get("Retry-After", 5)), 8.0)
                        log.debug("Rate-limited downloading %s; sleeping %.1fs", url, wait)
                        time.sleep(wait)
                        continue
                    break
                if resp.status_code == 429:
                    log.debug("Skipping %s — still rate-limited after retry", url)
                    return None
                resp.raise_for_status()

                content_type = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if content_type not in ALLOWED_MIME and "image" not in content_type:
                    log.debug("Rejected %s — MIME %s", url, content_type)
                    return None

                chunks = []
                total = 0
                for chunk in resp.iter_content(chunk_size=65_536):
                    total += len(chunk)
                    if total > MAX_BYTES:
                        log.debug("Rejected %s — too large (>%d B)", url, MAX_BYTES)
                        return None
                    chunks.append(chunk)
                data = b"".join(chunks)

        except requests.RequestException as e:
            log.debug("Download failed %s: %s", url, e)
            return None

        return self._process(url, data)

    def _process(self, url: str, data: bytes) -> Optional[DownloadedImage]:
        try:
            img = Image.open(io.BytesIO(data))
            img.verify()                     # detect corrupt files
            img = Image.open(io.BytesIO(data))  # re-open after verify
            img = img.convert("RGB")
            w, h = img.size
        except Exception as e:
            log.debug("PIL rejected %s: %s", url, e)
            return None

        if w < MIN_WIDTH or h < MIN_HEIGHT:
            log.debug("Rejected %s — dimensions %dx%d too small", url, w, h)
            return None

        sha256 = hashlib.sha256(data).hexdigest()
        thumbnail = self._make_thumbnail(img)

        return DownloadedImage(
            url=url,
            data=data,
            width=w,
            height=h,
            file_size=len(data),
            sha256=sha256,
            mime="image/jpeg",
            thumbnail=thumbnail,
        )

    def _make_thumbnail(self, img: Image.Image) -> bytes:
        thumb = img.copy()
        thumb.thumbnail(self._thumb_size, Image.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, format="JPEG", quality=82, optimize=True)
        return buf.getvalue()

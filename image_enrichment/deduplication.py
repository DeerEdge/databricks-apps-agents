"""Duplicate detection using SHA-256 (exact) and perceptual hashing (near-duplicates)."""

from __future__ import annotations

import io
import logging

from PIL import Image

log = logging.getLogger(__name__)

try:
    import imagehash
    _HAS_IMAGEHASH = True
except ImportError:
    _HAS_IMAGEHASH = False
    log.warning("imagehash not installed — perceptual-hash dedup disabled")

# Hamming-distance threshold: images with phash distance ≤ this are considered duplicates
_PHASH_THRESHOLD = 8


class DuplicateDetector:
    """Track seen images within a pipeline run; detect exact and near-duplicates."""

    def __init__(self) -> None:
        self._sha256_seen: set[str] = set()
        self._phashes: list[tuple[str, object]] = []  # (image_id, phash)

    def is_duplicate(self, image_id: str, sha256: str, image_bytes: bytes) -> bool:
        """Return True if this image is a duplicate of one already seen this run."""
        if sha256 in self._sha256_seen:
            log.debug("Exact duplicate rejected: sha256=%s", sha256[:16])
            return True

        if _HAS_IMAGEHASH:
            try:
                ph = _phash(image_bytes)
                for _, seen_ph in self._phashes:
                    dist = ph - seen_ph
                    if dist <= _PHASH_THRESHOLD:
                        log.debug(
                            "Near-duplicate rejected: phash dist=%d ≤ %d",
                            dist,
                            _PHASH_THRESHOLD,
                        )
                        return True
                self._phashes.append((image_id, ph))
            except Exception as e:
                log.debug("Perceptual hash failed: %s", e)

        self._sha256_seen.add(sha256)
        return False

    def register(self, image_id: str, sha256: str, image_bytes: bytes) -> str | None:
        """Compute and return the perceptual hash string (or None if unavailable)."""
        if not _HAS_IMAGEHASH:
            return None
        try:
            ph = _phash(image_bytes)
            self._phashes.append((image_id, ph))
            return str(ph)
        except Exception:
            return None


def _phash(image_bytes: bytes) -> object:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return imagehash.phash(img)

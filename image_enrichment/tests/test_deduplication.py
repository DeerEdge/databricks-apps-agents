"""Unit tests for DuplicateDetector."""

import hashlib
import io

import pytest
from PIL import Image

from image_enrichment.deduplication import DuplicateDetector


def _make_jpeg(color: tuple[int, int, int] = (200, 200, 200)) -> bytes:
    img = Image.new("RGB", (400, 300), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def test_exact_duplicate_detected():
    data = _make_jpeg()
    sha = hashlib.sha256(data).hexdigest()
    detector = DuplicateDetector()
    assert not detector.is_duplicate("id1", sha, data)
    assert detector.is_duplicate("id2", sha, data)


def test_different_images_not_duplicates():
    data1 = _make_jpeg((255, 0, 0))
    data2 = _make_jpeg((0, 255, 0))
    sha1 = hashlib.sha256(data1).hexdigest()
    sha2 = hashlib.sha256(data2).hexdigest()
    detector = DuplicateDetector()
    assert not detector.is_duplicate("id1", sha1, data1)
    assert not detector.is_duplicate("id2", sha2, data2)


def test_register_returns_string_or_none():
    data = _make_jpeg()
    sha = hashlib.sha256(data).hexdigest()
    detector = DuplicateDetector()
    result = detector.register("id1", sha, data)
    # Result is a string (phash) or None if imagehash not installed
    assert result is None or isinstance(result, str)

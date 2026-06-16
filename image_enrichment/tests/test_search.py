"""Unit tests for search helpers (pure logic, no HTTP)."""

import pytest
from image_enrichment.search import (
    _build_queries,
    _classify_tier,
    _is_blocked,
    _is_image_url,
)


def test_build_queries_contains_name_and_icu():
    qs = _build_queries("Apollo Hospital", "Mumbai", "Maharashtra")
    assert len(qs) >= 3
    assert any("Apollo Hospital" in q for q in qs)
    assert any("ICU" in q or "icu" in q.lower() for q in qs)


def test_is_image_url():
    assert _is_image_url("https://example.com/photo.jpg")
    assert _is_image_url("https://example.com/image.jpeg")
    assert _is_image_url("https://example.com/photo.png")
    assert _is_image_url("https://example.com/image.webp")
    assert not _is_image_url("https://example.com/page.html")
    assert not _is_image_url("https://example.com/style.css")
    assert not _is_image_url("https://example.com/")


def test_is_blocked_rejects_stock_domains():
    assert _is_blocked("https://www.shutterstock.com/image-photo/icu.jpg")
    assert _is_blocked("https://gettyimages.com/photos/icu")
    assert not _is_blocked("https://aiims.edu/icu-photo.jpg")
    assert not _is_blocked("https://mohfw.gov.in/image.jpg")


def test_classify_tier_government():
    assert _classify_tier("mohfw.gov.in") == "tier1"
    assert _classify_tier("nhp.gov.in") == "tier1"
    assert _classify_tier("aiims.edu.in") == "tier1"


def test_classify_tier_healthcare_directories():
    assert _classify_tier("practo.com") == "tier2"
    assert _classify_tier("credihealth.com") == "tier2"


def test_classify_tier_unknown():
    assert _classify_tier("example-blog.com") == "tier3"
    assert _classify_tier("random-site.xyz") == "tier3"

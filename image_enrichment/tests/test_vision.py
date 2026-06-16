"""Unit tests for vision module helpers (pure logic, no API calls)."""

import pytest
from image_enrichment.vision import _tier_to_trust, _resize_for_api, _WEIGHTS


def test_tier_to_trust_values():
    assert _tier_to_trust("tier1") == 0.9
    assert _tier_to_trust("tier2") == 0.65
    assert _tier_to_trust("tier3") == 0.4
    assert _tier_to_trust("unknown") == 0.35


def test_weights_sum_to_one():
    assert abs(sum(_WEIGHTS.values()) - 1.0) < 1e-9


def test_resize_for_api_small_image_unchanged():
    """A tiny image should not be enlarged."""
    from PIL import Image
    import io

    img = Image.new("RGB", (100, 100), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    data = buf.getvalue()

    result = _resize_for_api(data, max_px=1024)
    out = Image.open(io.BytesIO(result))
    assert out.size == (100, 100)


def test_resize_for_api_large_image_shrinks():
    from PIL import Image
    import io

    img = Image.new("RGB", (2000, 1500), color=(0, 128, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    data = buf.getvalue()

    result = _resize_for_api(data, max_px=1024)
    out = Image.open(io.BytesIO(result))
    assert max(out.size) <= 1024


def test_resize_for_api_bad_data_returns_original():
    bad_data = b"not-an-image"
    result = _resize_for_api(bad_data, max_px=512)
    assert result == bad_data


def test_heuristic_validate_icu_keywords(tmp_path):
    """Heuristic validator raises ICU score when alt text contains ICU keywords."""
    from image_enrichment.config import Config
    from image_enrichment.search import ImageCandidate
    from image_enrichment.vision import ImageValidator
    from PIL import Image
    import io

    # Build a minimal valid JPEG
    img = Image.new("RGB", (800, 600), color=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    img_bytes = buf.getvalue()

    class FakeCfg:
        anthropic_api_key = None
        vision_model = "claude-haiku-4-5-20251001"

    validator = ImageValidator(FakeCfg())  # type: ignore[arg-type]

    candidate_no_icu = ImageCandidate(
        image_url="http://example.com/img.jpg",
        page_url="http://example.com/",
        source_domain="example.com",
        source_tier="tier3",
        alt_text="hospital lobby",
    )
    candidate_icu = ImageCandidate(
        image_url="http://example.com/img2.jpg",
        page_url="http://example.com/",
        source_domain="example.com",
        source_tier="tier2",
        alt_text="ICU ward ventilator critical care unit",
    )

    res_no_icu = validator.validate(candidate_no_icu, img_bytes, "Hospital A", "Delhi", "Delhi")
    res_icu = validator.validate(candidate_icu, img_bytes, "Hospital A", "Delhi", "Delhi")

    assert res_icu.icu_probability > res_no_icu.icu_probability
    assert res_icu.trust_score > res_no_icu.trust_score  # tier2 > tier3
    assert not res_icu.used_vision

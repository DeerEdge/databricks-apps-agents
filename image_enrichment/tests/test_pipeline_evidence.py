"""Unit tests for pipeline evidence-note generation (pure logic)."""

import pytest
from image_enrichment.pipeline import _evidence_notes
from image_enrichment.search import ImageCandidate
from image_enrichment.vision import ValidationResult


def _make_result(**kwargs) -> ValidationResult:
    defaults = dict(
        hospital_match=0.8,
        icu_probability=0.9,
        quality_score=0.7,
        trust_score=0.85,
        overall_confidence=0.84,
        reject_reason=None,
        icu_equipment=["ventilator", "bedside monitor"],
        used_vision=True,
    )
    defaults.update(kwargs)
    return ValidationResult(**defaults)


def _make_cand(**kwargs) -> ImageCandidate:
    defaults = dict(
        image_url="http://example.com/icu.jpg",
        page_url="http://example.com/gallery",
        source_domain="example.com",
        source_tier="tier2",
        search_query="hospital icu",
    )
    defaults.update(kwargs)
    return ImageCandidate(**defaults)


def test_evidence_notes_contains_key_scores():
    notes = _evidence_notes(_make_result(), _make_cand())
    assert "match=0.80" in notes
    assert "icu=0.90" in notes
    assert "quality=0.70" in notes
    assert "trust=0.85" in notes
    assert "vision=yes" in notes
    assert "tier=tier2" in notes


def test_evidence_notes_includes_equipment():
    notes = _evidence_notes(_make_result(icu_equipment=["ventilator", "monitor"]), _make_cand())
    assert "ventilator" in notes
    assert "monitor" in notes


def test_evidence_notes_heuristic_flagged():
    notes = _evidence_notes(_make_result(used_vision=False), _make_cand())
    assert "heuristic" in notes


def test_evidence_notes_reject_reason_included():
    notes = _evidence_notes(
        _make_result(reject_reason="parking lot visible", overall_confidence=0.3),
        _make_cand(),
    )
    assert "parking lot" in notes


def test_evidence_notes_no_equipment():
    notes = _evidence_notes(_make_result(icu_equipment=[]), _make_cand())
    assert "equipment" not in notes

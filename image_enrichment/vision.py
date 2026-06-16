"""Claude vision validation for hospital / ICU images.

Scores each candidate image on four dimensions:
  hospital_match  — does the image show THIS specific hospital?
  icu_probability — does it depict an actual ICU / critical-care unit?
  quality_score   — is it a clear, useful image (not blurry, not a thumbnail)?
  trust_score     — is the source trustworthy / official?

Combined into overall_confidence.

If ANTHROPIC_API_KEY is absent the module falls back to heuristic scoring
so the pipeline remains runnable without the vision API.
"""

from __future__ import annotations

import base64
import io
import json
import logging
from dataclasses import dataclass
from typing import Optional

import requests
from PIL import Image

from .config import Config
from .search import ImageCandidate

log = logging.getLogger(__name__)

_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"

# Weight vector for the four sub-scores → overall_confidence
_WEIGHTS = {
    "hospital_match": 0.35,
    "icu_probability": 0.35,
    "quality_score": 0.15,
    "trust_score": 0.15,
}

_VALIDATION_PROMPT = """You are an expert medical facility image analyst.

Evaluate this image for inclusion in a verified hospital database.

Hospital context:
- Name: {name}
- City: {city}
- State: {state}
- Search query used: {query}
- Source: {source_domain} ({source_tier})
- Alt text / caption: {caption}

Score each dimension 0.0–1.0 (one decimal place):

1. hospital_match: Does this image show THIS specific hospital (or a plausibly matching facility — same name, city, or visible signage)?
   1.0 = name/logo clearly visible, 0.8 = matches context, 0.5 = generic hospital, 0.0 = clearly wrong.

2. icu_probability: Does this image depict an ICU / critical care unit?
   Look for: ventilators, bedside monitors, ICU beds, infusion pumps, nursing stations, critical-care layouts.
   1.0 = clear ICU, 0.7 = likely ICU/HDU, 0.5 = hospital ward (not ICU), 0.2 = lobby/exterior, 0.0 = unrelated.

3. quality_score: Is this a useful, clear image?
   1.0 = sharp, well-lit, shows facilities clearly.
   Penalise: blurry, very small, stock-photo watermark, advertisement, AI-generated look.

4. trust_score: How trustworthy is this image given its source?
   1.0 = official hospital website or government portal.
   0.7 = accredited directory or news.
   0.4 = user-contributed / social media.
   0.1 = SEO blog / unknown origin.

Also set:
- reject_reason: one short sentence if any score < 0.4, else null.
- icu_equipment_found: list of specific ICU equipment visible (e.g. ["ventilator", "bedside monitor"]).

Respond with ONLY a JSON object, no markdown:
{{
  "hospital_match": float,
  "icu_probability": float,
  "quality_score": float,
  "trust_score": float,
  "reject_reason": string|null,
  "icu_equipment_found": [string]
}}"""


@dataclass
class ValidationResult:
    hospital_match: float
    icu_probability: float
    quality_score: float
    trust_score: float
    overall_confidence: float
    reject_reason: Optional[str]
    icu_equipment: list[str]
    used_vision: bool    # False = heuristic fallback


class ImageValidator:
    def __init__(self, cfg: Config) -> None:
        self._api_key = cfg.anthropic_api_key
        self._model = cfg.vision_model
        self._session = requests.Session()

    def validate(
        self,
        candidate: ImageCandidate,
        image_bytes: bytes,
        hospital_name: str,
        city: str,
        state: str,
    ) -> ValidationResult:
        if self._api_key:
            try:
                return self._claude_validate(
                    candidate, image_bytes, hospital_name, city, state
                )
            except Exception as e:
                log.warning("Claude vision failed, falling back to heuristic: %s", e)

        return self._heuristic_validate(candidate, image_bytes, hospital_name, city, state)

    # ── Claude vision ──────────────────────────────────────────────────────

    def _claude_validate(
        self,
        candidate: ImageCandidate,
        image_bytes: bytes,
        name: str,
        city: str,
        state: str,
    ) -> ValidationResult:
        # Resize to ≤1024px on longest side before sending (cost control)
        thumb = _resize_for_api(image_bytes, max_px=1024)
        b64 = base64.standard_b64encode(thumb).decode()

        prompt = _VALIDATION_PROMPT.format(
            name=name,
            city=city,
            state=state,
            query=candidate.search_query,
            source_domain=candidate.source_domain,
            source_tier=candidate.source_tier,
            caption=f"{candidate.alt_text} {candidate.caption}".strip()[:200],
        )

        payload = {
            "model": self._model,
            "max_tokens": 512,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        }
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": _ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        resp = self._session.post(_ANTHROPIC_URL, json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        text = resp.json()["content"][0]["text"].strip()

        try:
            scores = json.loads(text)
        except json.JSONDecodeError:
            # Extract JSON block if Claude wrapped it in markdown
            import re
            m = re.search(r"\{.*\}", text, re.DOTALL)
            scores = json.loads(m.group()) if m else {}

        hm = float(scores.get("hospital_match", 0.5))
        icu = float(scores.get("icu_probability", 0.0))
        qs = float(scores.get("quality_score", 0.5))
        ts = float(scores.get("trust_score", _tier_to_trust(candidate.source_tier)))

        overall = (
            _WEIGHTS["hospital_match"] * hm
            + _WEIGHTS["icu_probability"] * icu
            + _WEIGHTS["quality_score"] * qs
            + _WEIGHTS["trust_score"] * ts
        )

        return ValidationResult(
            hospital_match=hm,
            icu_probability=icu,
            quality_score=qs,
            trust_score=ts,
            overall_confidence=round(overall, 3),
            reject_reason=scores.get("reject_reason") or None,
            icu_equipment=scores.get("icu_equipment_found") or [],
            used_vision=True,
        )

    # ── heuristic fallback ─────────────────────────────────────────────────

    def _heuristic_validate(
        self,
        candidate: ImageCandidate,
        image_bytes: bytes,
        hospital_name: str = "",
        city: str = "",
        state: str = "",
    ) -> ValidationResult:
        """Score using text signals only (no vision API).

        Includes hospital_name, city, and the search_query in the text bag
        so that Wikipedia images (whose alt text is the filename, not the
        hospital name) still get a reasonable entity-match score.
        """
        try:
            img = Image.open(io.BytesIO(image_bytes))
            w, h = img.size
            # Use 400×300 as "adequate" baseline (Wikipedia thumbs are often smaller)
            quality = min(1.0, (w * h) / (400 * 300))
        except Exception:
            quality = 0.3

        # Use only image-level text signals — NOT search_query (would inflate score)
        text = " ".join([
            candidate.alt_text, candidate.caption,
            candidate.surrounding_text,
        ]).lower()

        # ── ICU probability ────────────────────────────────────────────
        _ICU_STRONG = ["icu", "intensive care", "critical care", "ventilator",
                       "icu ward", "ccu", "nicu", "picu", "icu bed"]
        # "institute" and "medical" imply teaching hospitals which universally have ICUs
        _ICU_MODERATE = ["ward", "trauma", "emergency", "critical", "resuscitation",
                         "care unit", "patient care", "hdu",
                         "institute", "medical", "hospital"]
        if any(k in text for k in _ICU_STRONG):
            icu_prob = 0.75
        elif any(k in text for k in _ICU_MODERATE):
            icu_prob = 0.40
        else:
            icu_prob = 0.10   # default: assume it's a building exterior

        # ── Hospital entity match ──────────────────────────────────────
        import re as _re
        # 1. Word-level overlap between hospital_name and image text
        _STOP = {"of", "the", "and", "a", "an", "in", "&"}
        # Strip punctuation so "PGIMER," becomes "pgimer"
        clean_name = _re.sub(r"[^\w\s]", " ", hospital_name.lower())
        name_words = set(clean_name.split()) - _STOP if hospital_name else set()
        text_words = set(text.split())
        overlap = len(name_words & text_words) / max(len(name_words), 1) if name_words else 0.0

        # 2. Check if the page URL (Wikipedia article URL) contains hospital name words
        page_url_lower = candidate.page_url.lower()
        url_overlap = len(
            [w for w in name_words if len(w) > 3 and w in page_url_lower]
        ) / max(len(name_words), 1)

        hosp_signals = ["hospital", "medical", "clinic", "institute", "centre",
                        "center", "health", "care", "block", "campus"]
        hosp_hit = sum(1 for k in hosp_signals if k in text)

        # Use the best of text match or URL match (Wikipedia article URL is reliable)
        best_overlap = max(overlap, url_overlap)

        if best_overlap >= 0.5:
            match = min(0.90, 0.50 + best_overlap * 0.50)
        elif best_overlap > 0:
            match = min(0.70, 0.35 + best_overlap * 0.50 + hosp_hit * 0.05)
        else:
            match = min(0.50, 0.25 + hosp_hit * 0.05)

        # Boost if city/state appears in text (confirms geographic specificity)
        if city.lower() in text or state.lower() in text:
            match = min(0.90, match + 0.10)

        trust = _tier_to_trust(candidate.source_tier)

        overall = (
            _WEIGHTS["hospital_match"] * match
            + _WEIGHTS["icu_probability"] * icu_prob
            + _WEIGHTS["quality_score"] * quality
            + _WEIGHTS["trust_score"] * trust
        )

        return ValidationResult(
            hospital_match=round(match, 3),
            icu_probability=round(icu_prob, 3),
            quality_score=round(quality, 3),
            trust_score=trust,
            overall_confidence=round(overall, 3),
            reject_reason="heuristic-only (no vision API)" if overall < 0.70 else None,
            icu_equipment=[],
            used_vision=False,
        )


# ── helpers ────────────────────────────────────────────────────────────────

def _tier_to_trust(tier: str) -> float:
    return {"tier1": 0.9, "tier2": 0.65, "tier3": 0.4}.get(tier, 0.35)


def _resize_for_api(data: bytes, max_px: int = 1024) -> bytes:
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = img.size
        if max(w, h) > max_px:
            scale = max_px / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except Exception:
        return data

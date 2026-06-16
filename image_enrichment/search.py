"""Multi-source image candidate discovery.

Source tier priority (per the engineering spec):
  Tier 1 — official hospital website, government portals
  Tier 2 — accredited healthcare directories, news coverage
  Tier 3 — Wikipedia / Wikimedia Commons

Returns raw candidates; scoring/validation happens in vision.py.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import requests

from .config import Config

# Global semaphore: at most 1 concurrent Wikimedia API call across all pipeline workers.
# Wikipedia rate-limits aggressively when multiple threads hit it simultaneously.
_WIKI_SEMAPHORE = threading.Semaphore(1)
_WIKI_MIN_DELAY_S = 1.5  # polite gap between successive Wikipedia API calls

# Domains that are definitionally excluded — never return stock images
_BLOCKED_DOMAINS = frozenset([
    "shutterstock.com", "gettyimages.com", "istockphoto.com", "alamy.com",
    "dreamstime.com", "123rf.com", "depositphotos.com", "freepik.com",
    "pixabay.com", "unsplash.com", "pexels.com", "stock.adobe.com",
    "canstockphoto.com", "vectorstock.com", "bigstockphoto.com",
])

_TIER1_PATTERNS = re.compile(
    r"(\.gov\.in|\.nic\.in|mohfw|nhp\.gov|nhm\.|aiims\.|pgimer\.|jipmer\.|"
    r"tmc\.gov|nimhans|cmch|sskm|gmch)",
    re.I,
)

_TIER2_PATTERNS = re.compile(
    r"(practo\.com|justdial\.com|indiamart\.com|hospitalkhoj|"
    r"credihealth|medifee|ndtv\.com|timesofindia|thehindu|hindustantimes)",
    re.I,
)

# Filename patterns that indicate the file is NOT a photo (icon, logo, flag, map, svg)
_SKIP_FILE_RE = re.compile(
    r"(flag[-_]of|commons[-_]logo|oojsui|edit[-_]|wikimedia[-_]logo|"
    r"nuvola|crystal[-_]|gnome[-_]|silk[-_]|tango[-_]|fugue[-_]|"
    r"emblem|coat[-_]of[-_]arms|map[-_]of|location[-_]map|"
    r"stub|disambig|portal|icon|logo|\.svg$|wikipedia-logo|"
    r"wikidata|question[-_]mark|missing|placeholder|default[-_]avatar)",
    re.I,
)

_IMG_EXTS = frozenset([".jpg", ".jpeg", ".png", ".webp"])

_WIKI_SEARCH_API = "https://en.wikipedia.org/w/api.php"
_WIKI_REST_BASE = "https://en.wikipedia.org/api/rest_v1"
_WIKI_UA = "MedDesertPlanner/1.0 (databricks hackathon; non-commercial research)"


@dataclass
class ImageCandidate:
    image_url: str
    page_url: str
    source_domain: str
    source_tier: str           # tier1 | tier2 | tier3
    caption: str = ""
    alt_text: str = ""
    search_query: str = ""
    surrounding_text: str = ""
    width: int = 0
    height: int = 0


class ImageSearcher:
    """
    Finds image candidates using Wikipedia / Wikimedia Commons.

    Strategy:
      1. Wikipedia article search to find the hospital's article.
      2. REST page/media-list for complete, pre-scaled thumbnail URLs.
      3. Wikimedia Commons file search as a fallback for hospitals without
         a dedicated Wikipedia article.
    """

    def __init__(self, cfg: Config) -> None:
        self._timeout = cfg.request_timeout
        self._delay = cfg.request_delay_s
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": _WIKI_UA,
            "Accept": "application/json",
        })

    # ── public ────────────────────────────────────────────────────────────

    def get_wikipedia_image(
        self,
        name: str,
        city: str,
        state: str,
    ) -> tuple[str, str] | None:
        """Return (image_url, article_title) for the hospital's Wikipedia page, or None.

        Tries several search queries and returns the first real-photo image
        found in the article's media list.  No image downloading happens here —
        the caller stores the URL and lets the browser load it.
        """
        _name_clean = (
            name.replace(f", {city}", "")
                .replace(f" {city}", "")
                .strip().rstrip(",").strip()
        )
        queries = [
            f"{name} hospital {city}",
            f"{_name_clean} India hospital",
            f"{_name_clean} medical India",
        ]

        for query in queries:
            article = self._wiki_article_for_query(
                query, hospital_name=name, city=city, state=state
            )
            if not article:
                continue
            # Try REST summary first (fastest — gives main article image)
            url = self._summary_image(article)
            if url:
                return url, article
            # Fall back to media-list (picks the first real photo in the article)
            imgs = self._article_images_rest(article, name)
            if imgs:
                return imgs[0].image_url, article

        return None

    def _summary_image(self, article_title: str) -> str | None:
        """Get the main infobox image from a Wikipedia article summary."""
        url_title = article_title.replace(" ", "_")
        try:
            data = self._wiki_get(f"{_WIKI_REST_BASE}/page/summary/{url_title}")
        except Exception as e:
            log.debug("REST summary failed for '%s': %s", article_title, e)
            return None

        # Prefer originalimage (full quality); fall back to thumbnail
        for key in ("originalimage", "thumbnail"):
            src = data.get(key, {}).get("source", "")
            if src and not src.lower().endswith(".svg"):
                if src.startswith("//"):
                    src = "https:" + src
                return src
        return None

    def find_candidates(
        self,
        name: str,
        city: str,
        state: str,
        max_candidates: int = 12,
    ) -> list[ImageCandidate]:
        candidates: list[ImageCandidate] = []
        seen_urls: set[str] = set()

        # 1. Wikipedia article images via REST media-list
        wiki = self._wikipedia_candidates(name, city, state)
        for c in wiki:
            if c.image_url not in seen_urls:
                seen_urls.add(c.image_url)
                candidates.append(c)
            if len(candidates) >= max_candidates:
                break

        # 2. Wikimedia Commons fallback when Wikipedia found too few images
        if len(candidates) < max_candidates // 2:
            time.sleep(self._delay * 0.5)
            commons = self._commons_candidates(name, city, state, seen_urls)
            for c in commons:
                if c.image_url not in seen_urls:
                    seen_urls.add(c.image_url)
                    candidates.append(c)
                if len(candidates) >= max_candidates:
                    break

        log.debug("Found %d candidates for '%s'", len(candidates), name)
        return candidates

    # ── Wikipedia article lookup ──────────────────────────────────────────

    def _wikipedia_candidates(
        self,
        name: str,
        city: str,
        state: str,
    ) -> list[ImageCandidate]:
        # Strip city/state from hospital name to avoid double-counting them in queries.
        # E.g. "PGIMER, Chandigarh" + city="Chandigarh" → don't search "PGIMER, Chandigarh hospital Chandigarh Chandigarh"
        _name_clean = name.replace(f", {city}", "").replace(f" {city}", "").strip().rstrip(",").strip()

        queries = [
            f"{name} hospital {city}",         # full name + city for precision
            f"{_name_clean} India hospital",    # clean name without city duplication
            f"{_name_clean} medical India",
        ]
        for query in queries:
            article = self._wiki_article_for_query(query, hospital_name=name, city=city, state=state)
            if not article:
                time.sleep(self._delay * 0.3)
                continue
            images = self._article_images_rest(article, name)
            if images:
                return images
            time.sleep(self._delay * 0.3)
        return []

    def _wiki_get(self, url: str, params: dict | None = None) -> dict:
        """Serialized, rate-limited GET to any Wikimedia endpoint.

        Caps Retry-After waits at 12s.  After 2 retries, raises so callers
        can gracefully skip rather than blocking the pipeline.
        """
        with _WIKI_SEMAPHORE:
            for attempt in range(2):
                resp = self._session.get(
                    url,
                    params=params or {},
                    timeout=self._timeout,
                )
                if resp.status_code == 429:
                    raw = float(resp.headers.get("Retry-After", _WIKI_MIN_DELAY_S))
                    wait = min(raw, 12.0)
                    log.debug(
                        "Wikimedia 429; sleeping %.1fs (Retry-After=%.0fs)", wait, raw
                    )
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                time.sleep(_WIKI_MIN_DELAY_S)
                return resp.json()
        raise RuntimeError("Wikimedia returned 429 twice; skipping query")

    def _wiki_article_for_query(
        self,
        query: str,
        hospital_name: str = "",
        city: str = "",
        state: str = "",
    ) -> str | None:
        """Return the best-matching Wikipedia article title, or None.

        Only returns an article if it explicitly mentions medical/hospital terms
        OR shares meaningful word overlap with the hospital name.  This prevents
        picking up unrelated city/person/event articles.
        """
        try:
            data = self._wiki_get(
                _WIKI_SEARCH_API,
                {
                    "action": "query", "format": "json",
                    "list": "search", "srsearch": query,
                    "srnamespace": "0", "srlimit": "5",
                    "srprop": "title",
                },
            )
            hits = data.get("query", {}).get("search", [])
        except Exception as e:
            log.debug("Wikipedia search failed ('%s'): %s", query, e)
            return None

        _MEDICAL_RE = re.compile(
            r"(hospital|medical|health|aiims|pgimer|jipmer|clinic|institute|"
            r"centre|center|care|dispensary|sanatorium)",
            re.I,
        )
        # Significant words from the hospital name — exclude city/state so we
        # don't match the city's Wikipedia article for hospitals like "PGIMER, Chandigarh".
        _STOP = {"of", "the", "and", "a", "an", "in", "&", "-", "hospital", "clinic"}
        geo_words = {city.lower(), state.lower()} - {""} if (city or state) else set()
        clean_name = re.sub(r"[^\w\s]", " ", hospital_name.lower())
        name_words = (
            set(clean_name.split()) - _STOP - geo_words if hospital_name else set()
        )

        for hit in hits:
            t = hit.get("title", "")
            # Accept if article title explicitly mentions a medical/health term
            if _MEDICAL_RE.search(t):
                return t
            # Accept if ≥2 hospital-specific words appear in the article title.
            # Requiring 2+ words prevents matching unrelated articles that happen
            # to share a common first name (e.g. "Abhilasha Hospital" → "Abhilasha Barak").
            if name_words:
                shared = name_words & set(t.lower().split())
                if len(shared) >= 2:
                    return t

        return None  # No relevant article found — do not guess

    def _article_images_rest(
        self,
        article_title: str,
        hospital_name: str,
    ) -> list[ImageCandidate]:
        """Get images from a Wikipedia article using the REST media-list API.

        Returns complete thumbnail URLs that are ready to download.
        """
        url_title = article_title.replace(" ", "_")
        article_url = f"https://en.wikipedia.org/wiki/{url_title}"
        try:
            data = self._wiki_get(
                f"{_WIKI_REST_BASE}/page/media-list/{url_title}"
            )
        except Exception as e:
            log.debug("REST media-list failed for '%s': %s", article_title, e)
            return []

        candidates: list[ImageCandidate] = []
        for item in data.get("items", []):
            if item.get("type") != "image":
                continue
            title = item.get("title", "")
            if not _is_useful_file(title):
                continue

            # Use the highest-resolution srcset entry, or fall back to src
            srcset = item.get("srcset", [])
            # srcset is sorted low→high; pick the last (largest) thumbnail
            src = (srcset[-1].get("src", "") if srcset else "") or item.get("src", "")
            if not src:
                continue
            if src.startswith("//"):
                src = "https:" + src

            if _is_blocked(src):
                continue

            alt = (
                title.replace("File:", "").replace("_", " ").rsplit(".", 1)[0]
            )
            domain = urlparse(src).netloc
            tier = _classify_tier(domain)
            candidates.append(
                ImageCandidate(
                    image_url=src,
                    page_url=article_url,
                    source_domain=domain,
                    source_tier=tier,
                    alt_text=alt[:300],
                    caption=alt[:300],
                    search_query=f"{hospital_name} Wikipedia",
                )
            )

        return candidates

    # ── Wikimedia Commons fallback ────────────────────────────────────────

    def _commons_candidates(
        self,
        name: str,
        city: str,
        state: str,
        seen_urls: set[str],
    ) -> list[ImageCandidate]:
        """Search Wikimedia Commons for hospital images when no Wikipedia article exists."""
        query = f"{name} hospital {city} India"
        try:
            data = self._wiki_get(
                "https://commons.wikimedia.org/w/api.php",
                {
                    "action": "query", "format": "json",
                    "list": "search",
                    "srsearch": query,
                    "srnamespace": "6",  # File namespace
                    "srlimit": "15",
                    "srprop": "title",
                },
            )
        except Exception as e:
            log.debug("Commons search failed for '%s': %s", name, e)
            return []

        file_titles = [
            hit["title"]
            for hit in data.get("query", {}).get("search", [])
            if _is_useful_file(hit.get("title", ""))
        ][:10]

        if not file_titles:
            return []

        return self._resolve_commons_files(file_titles, query, name)

    def _resolve_commons_files(
        self,
        file_titles: list[str],
        search_query: str,
        hospital_name: str,
    ) -> list[ImageCandidate]:
        """Resolve Commons file titles to downloadable URLs via imageinfo."""
        candidates: list[ImageCandidate] = []
        for batch in _chunks(file_titles, 30):
            try:
                data = self._wiki_get(
                    _WIKI_SEARCH_API,
                    {
                        "action": "query", "format": "json",
                        "titles": "|".join(batch),
                        "prop": "imageinfo",
                        "iiprop": "url|size|mime",
                    },
                )
            except Exception as e:
                log.debug("Failed to resolve Commons file batch: %s", e)
                continue

            for page in data.get("query", {}).get("pages", {}).values():
                info = (page.get("imageinfo") or [{}])[0]
                url = info.get("url", "")
                if not url or _is_blocked(url):
                    continue
                mime = info.get("mime", "")
                if not mime.startswith("image") or "svg" in mime:
                    continue
                w = int(info.get("width") or 0)
                h = int(info.get("height") or 0)
                if w < 200 or h < 150:
                    continue
                alt = (
                    page.get("title", "")
                    .replace("File:", "")
                    .replace("_", " ")
                    .rsplit(".", 1)[0]
                )
                domain = urlparse(url).netloc
                tier = _classify_tier(domain)
                candidates.append(
                    ImageCandidate(
                        image_url=url,
                        page_url=f"https://commons.wikimedia.org/wiki/{page.get('title','').replace(' ','_')}",
                        source_domain=domain,
                        source_tier=tier,
                        alt_text=alt[:300],
                        caption=alt[:300],
                        search_query=search_query,
                        width=w,
                        height=h,
                    )
                )

        return candidates


# ── helpers ────────────────────────────────────────────────────────────────

log = logging.getLogger(__name__)


def _chunks(lst: list, n: int):
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


def _is_useful_file(title: str) -> bool:
    """True for real-photo files; rejects icons/logos/SVGs/maps."""
    if not title:
        return False
    lower = title.lower()
    if not any(lower.endswith(ext) for ext in _IMG_EXTS):
        return False
    if _SKIP_FILE_RE.search(lower):
        return False
    return True


def _is_blocked(url: str) -> bool:
    domain = urlparse(url).netloc.lower()
    return any(b in domain for b in _BLOCKED_DOMAINS)


def _classify_tier(domain: str) -> str:
    if _TIER1_PATTERNS.search(domain):
        return "tier1"
    if _TIER2_PATTERNS.search(domain):
        return "tier2"
    return "tier3"

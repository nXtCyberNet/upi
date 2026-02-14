"""
Indian IPv4 ASN Intelligence — MMDB-backed classification.

Resolves IP addresses against a local MaxMind-format MMDB database
to extract ASN metadata, classify the network type for Indian ASNs,
and compute a composite ASN risk score.

Pipeline
────────
1. IPv4 constraint     → reject IPv6 / private / loopback
2. ASN extraction      → MMDB lookup → (ASN_number, Org_name, Country)
3. Indian filtering    → Country(ASN) == "IN" → ForeignFlag
4. ASN classification  → Mobile ISP / Broadband / Enterprise / Indian Cloud / Hosting / Unknown
5. ASN density         → log(1 + Accounts_in_ASN)
6. ASN drift           → current ASN ≠ historical mode ASN
7. Switching entropy   → −Σ p_i·log(p_i)
8. Final ASN risk      → 0.4·base + 0.3·density + 0.2·drift + 0.2·foreign + 0.1·entropy → [0,1]

MMDB record structure (asn_ipv4_small.mmdb)
───────────────────────────────────────────
{
    "asn": 15169,
    "organization": {
        "name": "Google LLC",
        "country": "US",   ← ISO 3166-1 alpha-2 (org registration country)
        ...
    },
    ...
}
"""

from __future__ import annotations

import ipaddress
import logging
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import maxminddb

from app.config import settings

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════
# Indian ASN Classification Maps (curated)
# ══════════════════════════════════════════════════════════════
# Only ASNs registered to Indian organisations.  Global providers
# (AWS, GCP, Azure) intentionally excluded — their org.country is
# US/IE/etc., so they hit the ForeignFlag path automatically.
# ══════════════════════════════════════════════════════════════

_MOBILE_ISP_ASNS: frozenset = frozenset({
    55836, 64049, 58678, 132524,           # Reliance Jio Infocomm
    45609, 24560, 9498,                    # Bharti Airtel
    55644, 38266,                          # Vodafone Idea
    45271, 9829,                           # BSNL
    45820, 17813,                          # MTNL (Delhi / Mumbai)
    45514,                                 # Bharti Hexacom
    136763,                                # Jio 4G hotspot range
})

_BROADBAND_ASNS: frozenset = frozenset({
    17762, 55577, 24309,                   # ACT Fibernet / Atria Convergence
    17488,                                 # Hathway Cable Datacom
    18101,                                 # Reliance Communications
    133982,                                # Spectra / Asianet Broadband
    132335,                                # Alliance Broadband
    10029, 45528,                          # Tikona Infinet
    134091,                                # YOU Broadband
    133647,                                # Gigatel Networks
    45194,                                 # Siti Cable
    24186,                                 # Reliance Broadband
    133661,                                # Netplus Broadband
    45916,                                 # Starter / HostGator India overlap
})

_ENTERPRISE_ASNS: frozenset = frozenset({
    4755, 6453,                            # Tata Communications
    17439, 9583,                           # Sify Technologies
    10201,                                 # PowerGrid ULDC-NR
    18209,                                 # Tata Teleservices
    45117,                                 # Gazon Communications
    55824,                                 # NTT India Pvt Ltd
    132524,                                # Jio enterprise segment
})

_INDIAN_CLOUD_ASNS: frozenset = frozenset({
    135929,                                # Yotta Infrastructure
    133275,                                # CtrlS Datacenters
    132116,                                # Netmagic (NTT India DC)
    137687,                                # JEPL IT Services
    58695,                                 # Web Werks (also cloud hosting)
})

_HOSTING_ASNS: frozenset = frozenset({
    133296,                                # Web Werks India
    45769,                                 # Lightstorm
    135580,                                # Cyfuture
    138835,                                # Lucideus / SAFE Security
    59163,                                 # MitraComm hosting
    46015,                                 # Starter hosting India
    137194,                                # DE-CIX India
})

# ── Keyword → class mapping (fallback when ASN not in curated maps)
_ORG_KEYWORDS: List[Tuple[str, str]] = [
    ("jio", "MOBILE_ISP"),
    ("airtel", "MOBILE_ISP"),
    ("bharti", "MOBILE_ISP"),
    ("vodafone", "MOBILE_ISP"),
    ("idea cellular", "MOBILE_ISP"),
    ("bsnl", "MOBILE_ISP"),
    ("mtnl", "MOBILE_ISP"),
    ("act fibernet", "BROADBAND"),
    ("atria convergence", "BROADBAND"),
    ("hathway", "BROADBAND"),
    ("spectra", "BROADBAND"),
    ("tikona", "BROADBAND"),
    ("you broadband", "BROADBAND"),
    ("alliance broadband", "BROADBAND"),
    ("netplus", "BROADBAND"),
    ("gigatel", "BROADBAND"),
    ("tata communications", "ENTERPRISE"),
    ("sify", "ENTERPRISE"),
    ("powergrid", "ENTERPRISE"),
    ("yotta", "INDIAN_CLOUD"),
    ("ctrls", "INDIAN_CLOUD"),
    ("netmagic", "INDIAN_CLOUD"),
    ("web werks", "HOSTING"),
    ("cyfuture", "HOSTING"),
    ("lightstorm", "HOSTING"),
    ("hostinger india", "HOSTING"),
    ("hosting", "HOSTING"),
    ("datacenter", "HOSTING"),
    ("data center", "HOSTING"),
    ("data centre", "HOSTING"),
]

# ── Base risk scores per classification (Step 4)
_CLASS_BASE_SCORES: Dict[str, float] = {
    "MOBILE_ISP":   0.0,
    "BROADBAND":    0.1,
    "ENTERPRISE":   0.3,
    "INDIAN_CLOUD": 0.6,
    "HOSTING":      0.7,
    "UNKNOWN":      0.5,
    "FOREIGN":      0.8,
}


# ══════════════════════════════════════════════════════════════
# Singleton MMDB Reader
# ══════════════════════════════════════════════════════════════

_reader: Optional[maxminddb.Reader] = None


def _find_mmdb() -> Optional[Path]:
    """Search for the MMDB file in several candidate locations."""
    configured = Path(settings.MMDB_PATH)
    candidates = [
        configured,
        configured.resolve(),
        # Relative to this file: features/ → app/ → backend/ → fraud-detection-system/ → upi/
        Path(__file__).resolve().parents[4] / configured,
        Path(__file__).resolve().parents[3] / configured,
        Path.cwd() / configured,
        Path.cwd().parent / configured,
        Path.cwd().parent.parent / configured,
    ]
    for p in candidates:
        if p.exists() and p.is_file():
            return p
    return None


def _get_reader() -> Optional[maxminddb.Reader]:
    """Lazy-load MMDB reader (singleton)."""
    global _reader
    if _reader is not None:
        return _reader

    mmdb_path = _find_mmdb()
    if mmdb_path is None:
        logger.warning(
            "MMDB file not found (configured: %s) – ASN intelligence disabled",
            settings.MMDB_PATH,
        )
        return None
    try:
        _reader = maxminddb.open_database(str(mmdb_path))
        logger.info("✅ MMDB loaded: %s", mmdb_path)
        return _reader
    except Exception as exc:
        logger.error("Failed to open MMDB: %s", exc)
        return None


def close_reader() -> None:
    """Close the MMDB reader.  Call at application shutdown."""
    global _reader
    if _reader:
        _reader.close()
        _reader = None
        logger.info("MMDB reader closed")


# ══════════════════════════════════════════════════════════════
# Step 1 — IPv4 constraint
# ══════════════════════════════════════════════════════════════

def _is_valid_public_ipv4(ip_str: str) -> bool:
    """Return True only for public, routable IPv4 addresses."""
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if addr.version != 4:
        return False
    if addr.is_private or addr.is_loopback or addr.is_reserved or addr.is_link_local:
        return False
    return True


# ══════════════════════════════════════════════════════════════
# Step 4 — Indian ASN Classification
# ══════════════════════════════════════════════════════════════

def _classify_indian_asn(asn: int, org_name: str) -> str:
    """Classify an Indian ASN using curated maps + keyword fallback."""
    # Priority:  Mobile > Broadband > Enterprise > Cloud > Hosting
    if asn in _MOBILE_ISP_ASNS:
        return "MOBILE_ISP"
    if asn in _BROADBAND_ASNS:
        return "BROADBAND"
    if asn in _ENTERPRISE_ASNS:
        return "ENTERPRISE"
    if asn in _INDIAN_CLOUD_ASNS:
        return "INDIAN_CLOUD"
    if asn in _HOSTING_ASNS:
        return "HOSTING"

    # Keyword fallback on organisation name
    org_lower = org_name.lower()
    for keyword, cls in _ORG_KEYWORDS:
        if keyword in org_lower:
            return cls

    return "UNKNOWN"


# ══════════════════════════════════════════════════════════════
# Steps 1–4 — Synchronous MMDB resolve
# ══════════════════════════════════════════════════════════════

_NULL_RESULT: Dict = {
    "asn": 0,
    "org_name": "",
    "country": "",
    "is_indian": False,
    "foreign_flag": 0,
    "asn_class": "UNKNOWN",
    "asn_base": 0.0,
    "valid": False,
}


def resolve(ip_address: str) -> Dict:
    """
    Resolve an IP address against the MMDB.

    Returns a dict with:
        asn          – AS number (int)
        org_name     – organisation name
        country      – ISO 3166-1 alpha-2 (org registration country)
        is_indian    – True if country == "IN"
        foreign_flag – 0 (Indian) or 1 (foreign)
        asn_class    – classification label
        asn_base     – base risk score for the class
        valid        – True if lookup succeeded
    """
    # Step 1: IPv4 constraint
    if not _is_valid_public_ipv4(ip_address):
        return dict(_NULL_RESULT)

    reader = _get_reader()
    if reader is None:
        return dict(_NULL_RESULT)

    # Step 2: ASN extraction
    try:
        data = reader.get(ip_address)
    except Exception:
        return dict(_NULL_RESULT)

    if not data:
        return dict(_NULL_RESULT)

    asn_number: int = data.get("asn", 0) or 0
    org = data.get("organization", {}) or {}
    org_name: str = org.get("name", "") or ""
    country: str = (org.get("country", "") or "").upper()

    # Step 3: Indian ASN filtering
    is_indian = country == "IN"
    foreign_flag = 0 if is_indian else 1

    # Step 4: Classification (India-only path vs Foreign)
    if not is_indian:
        asn_class = "FOREIGN"
    else:
        asn_class = _classify_indian_asn(asn_number, org_name)

    asn_base = _CLASS_BASE_SCORES.get(asn_class, 0.5)

    return {
        "asn": asn_number,
        "org_name": org_name,
        "country": country,
        "is_indian": is_indian,
        "foreign_flag": foreign_flag,
        "asn_class": asn_class,
        "asn_base": round(asn_base, 3),
        "valid": True,
    }


# ══════════════════════════════════════════════════════════════
# Steps 5–8 — Full ASN risk computation (async, needs Neo4j)
# ══════════════════════════════════════════════════════════════

async def compute_asn_risk(
    sender_id: str,
    ip_address: str,
    neo4j,  # Neo4jManager
) -> Dict:
    """
    Compute the complete 8-step ASN risk score for a transaction.

    ASN_risk = 0.4·ASN_base
             + 0.3·ASN_density_norm
             + 0.2·ASN_drift
             + 0.2·ForeignFlag
             + 0.1·ASN_entropy_norm
    Normalised to [0, 1].

    Returns a dict with all intermediate features plus:
        asn_risk         – final normalised score [0, 1]
        asn_risk_scaled  – scaled to 0–20 for behavioural fusion
    """
    from app.utils.cypher_queries import QUERY_ASN_DENSITY, QUERY_USER_ASN_HISTORY

    # Steps 1–4: MMDB resolve + classify
    info = resolve(ip_address)

    if not info["valid"]:
        return {
            "asn": 0, "org_name": "", "country": "", "asn_class": "UNKNOWN",
            "foreign_flag": 0, "asn_base": 0.0,
            "asn_density": 0.0, "asn_density_norm": 0.0,
            "asn_drift": 0, "asn_entropy": 0.0, "asn_entropy_norm": 0.0,
            "asn_risk": 0.0, "asn_risk_scaled": 0.0,
        }

    asn_number = info["asn"]
    foreign_flag = info["foreign_flag"]
    asn_base = info["asn_base"]

    # ── Step 5: ASN density — log(1 + Accounts_in_ASN) ──────
    asn_density = 0.0
    if asn_number > 0:
        try:
            rows = await neo4j.read_async(
                QUERY_ASN_DENSITY, {"asn_number": asn_number},
            )
            if rows:
                account_count = rows[0].get("account_count", 0) or 0
                asn_density = math.log1p(account_count)
        except Exception as exc:
            logger.debug("ASN density query failed: %s", exc)

    # ── Step 6 + 7: ASN drift + switching entropy ───────────
    asn_drift = 0
    asn_entropy = 0.0
    try:
        history_rows = await neo4j.read_async(
            QUERY_USER_ASN_HISTORY, {"user_id": sender_id},
        )
        if history_rows:
            asn_counts: Dict[int, int] = {}
            total = 0
            for row in history_rows:
                a = row.get("asn", 0) or 0
                c = row.get("usage_count", 1) or 1
                if a > 0:
                    asn_counts[a] = c
                    total += c

            if asn_counts:
                # Step 6: drift — is current ASN ≠ mode?
                mode_asn = max(asn_counts, key=asn_counts.get)
                asn_drift = 0 if asn_number == mode_asn else 1

                # Step 7: switching entropy  −Σ p_i·log(p_i)
                if total > 0:
                    for count_val in asn_counts.values():
                        p = count_val / total
                        if p > 0:
                            asn_entropy -= p * math.log(p)
    except Exception as exc:
        logger.debug("ASN history query failed: %s", exc)

    # ── Step 8: Final ASN risk ───────────────────────────────
    #   0.4·base + 0.3·density_norm + 0.2·drift + 0.2·foreign + 0.1·entropy_norm
    #   Normalise density:  log(1+N) / log(1+1000)  ≈ [0, 1]
    #   Normalise entropy:  H / 2.5                  ≈ [0, 1]  (cap ~ ln(12))
    density_norm = min(asn_density / math.log1p(1000), 1.0)
    entropy_norm = min(asn_entropy / 2.5, 1.0)

    raw_risk = (
        0.4 * asn_base
        + 0.3 * density_norm
        + 0.2 * float(asn_drift)
        + 0.2 * float(foreign_flag)
        + 0.1 * entropy_norm
    )
    asn_risk = min(max(raw_risk, 0.0), 1.0)

    # Scale to behavioural fusion budget  (0–20 points)
    asn_risk_scaled = asn_risk * 20.0

    return {
        "asn": asn_number,
        "org_name": info["org_name"],
        "country": info["country"],
        "asn_class": info["asn_class"],
        "foreign_flag": foreign_flag,
        "asn_base": round(asn_base, 3),
        "asn_density": round(asn_density, 4),
        "asn_density_norm": round(density_norm, 4),
        "asn_drift": asn_drift,
        "asn_entropy": round(asn_entropy, 4),
        "asn_entropy_norm": round(entropy_norm, 4),
        "asn_risk": round(asn_risk, 4),
        "asn_risk_scaled": round(asn_risk_scaled, 2),
    }

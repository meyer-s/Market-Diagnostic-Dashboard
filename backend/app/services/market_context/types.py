from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal


FreshnessStatus = Literal["fresh", "aging", "stale", "missing"]
ReliabilityLevel = Literal["official", "exchange", "derived", "commentary", "manual"]
ConfidenceLevel = Literal["low", "medium", "high"]
BiasLabel = Literal["bullish", "bearish", "neutral", "mixed"]


@dataclass(frozen=True)
class SourceDescriptor:
    source_id: str
    source_name: str
    source_category: str
    affected_commodities: tuple[str, ...]
    update_frequency: str
    stale_data_threshold: timedelta
    reliability_level: ReliabilityLevel
    fetch_method: str
    normalization_method: str
    source_url: str | None = None


@dataclass(frozen=True)
class SourceHealth:
    source: str
    source_id: str
    source_category: str
    source_url: str | None
    last_fetched_at: str | None
    published_at: str | None
    freshness_status: FreshnessStatus
    stale_threshold_hours: int
    reliability_level: ReliabilityLevel
    reliability_status: str
    confidence_level: ConfidenceLevel
    warnings: tuple[str, ...] = field(default_factory=tuple)
    errors: tuple[str, ...] = field(default_factory=tuple)


def classify_freshness(
    *,
    last_fetched_at: datetime | None,
    stale_threshold: timedelta,
    as_of: datetime | None = None,
) -> FreshnessStatus:
    if last_fetched_at is None:
        return "missing"

    reference = as_of or datetime.now(timezone.utc)
    age = reference - last_fetched_at.astimezone(timezone.utc)
    if age <= stale_threshold * 0.5:
        return "fresh"
    if age <= stale_threshold:
        return "aging"
    return "stale"


def build_source_health(
    descriptor: SourceDescriptor,
    *,
    last_fetched_at: datetime | None,
    published_at: datetime | None = None,
    warnings: list[str] | None = None,
    errors: list[str] | None = None,
    confidence_level: ConfidenceLevel | None = None,
    as_of: datetime | None = None,
) -> SourceHealth:
    freshness_status = classify_freshness(
        last_fetched_at=last_fetched_at,
        stale_threshold=descriptor.stale_data_threshold,
        as_of=as_of,
    )
    reliability_status = descriptor.reliability_level

    resolved_confidence = confidence_level
    if resolved_confidence is None:
        if freshness_status == "fresh" and descriptor.reliability_level in {"official", "exchange"}:
            resolved_confidence = "high"
        elif freshness_status == "stale" or descriptor.reliability_level in {"commentary", "manual"}:
            resolved_confidence = "low"
        else:
            resolved_confidence = "medium"

    return SourceHealth(
        source=descriptor.source_name,
        source_id=descriptor.source_id,
        source_category=descriptor.source_category,
        source_url=descriptor.source_url,
        last_fetched_at=last_fetched_at.astimezone(timezone.utc).isoformat() if last_fetched_at else None,
        published_at=published_at.astimezone(timezone.utc).isoformat() if published_at else None,
        freshness_status=freshness_status,
        stale_threshold_hours=int(descriptor.stale_data_threshold.total_seconds() // 3600),
        reliability_level=descriptor.reliability_level,
        reliability_status=reliability_status,
        confidence_level=resolved_confidence,
        warnings=tuple(warnings or ()),
        errors=tuple(errors or ()),
    )


@dataclass(frozen=True)
class WeatherRegion:
    region_id: str
    label: str
    state: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class CommodityMetadata:
    root_symbol: str
    display_name: str
    commodity_group: str
    exchange: str
    trading_hours_profile: str
    related_reports: tuple[str, ...]
    weather_regions: tuple[WeatherRegion, ...]
    crop_stages: tuple[str, ...]
    global_drivers: tuple[str, ...]
    demand_drivers: tuple[str, ...]
    supply_drivers: tuple[str, ...]
    aliases: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class NormalizedSourcePayload:
    descriptor: SourceDescriptor
    source_health: SourceHealth
    normalized_output: dict[str, Any]
    last_updated: str | None
    warnings: tuple[str, ...] = field(default_factory=tuple)
    errors: tuple[str, ...] = field(default_factory=tuple)

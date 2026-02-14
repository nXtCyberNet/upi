"""
Anomaly detection helpers.

Provides lightweight statistical anomaly functions used across feature
extractors (z-score, IQR, Mahalanobis, isolation-like scoring).
"""

from __future__ import annotations

import math
from typing import List, Tuple

import numpy as np


def z_score(value: float, values: List[float]) -> float:
    """Standard z-score.  Returns 0 if insufficient data."""
    if len(values) < 2:
        return 0.0
    mean = float(np.mean(values))
    std = float(np.std(values))
    if std == 0:
        return 0.0
    return (value - mean) / std


def iqr_outlier(value: float, values: List[float], k: float = 1.5) -> bool:
    """Return True if *value* lies outside Q1 - k*IQR … Q3 + k*IQR."""
    if len(values) < 4:
        return False
    q1, q3 = float(np.percentile(values, 25)), float(np.percentile(values, 75))
    iqr = q3 - q1
    return value < (q1 - k * iqr) or value > (q3 + k * iqr)


def mahalanobis_distance(
    x: np.ndarray, mean: np.ndarray, cov_inv: np.ndarray
) -> float:
    """Mahalanobis distance of a point from a multivariate distribution."""
    diff = x - mean
    return float(np.sqrt(diff @ cov_inv @ diff))


def rolling_stats(values: List[float], window: int = 25) -> Tuple[float, float]:
    """Return (mean, std) over the most recent *window* values."""
    subset = values[:window]
    if not subset:
        return 0.0, 0.0
    return float(np.mean(subset)), float(np.std(subset))


def time_velocity(timestamps_sec: List[float], window_sec: float = 60.0) -> float:
    """Count of events within the last *window_sec* seconds."""
    if not timestamps_sec:
        return 0.0
    ref = timestamps_sec[0]  # most recent
    return float(sum(1 for t in timestamps_sec if (ref - t) <= window_sec))


def burst_detect(timestamps_sec: List[float], threshold: int = 10, window_sec: float = 60.0) -> bool:
    """Return True if more than *threshold* events happened in *window_sec*."""
    return time_velocity(timestamps_sec, window_sec) >= threshold


def normalize_score(value: float, min_val: float = 0, max_val: float = 100) -> float:
    """Clamp and normalise a raw score to [0, 100]."""
    return max(min_val, min(value, max_val))

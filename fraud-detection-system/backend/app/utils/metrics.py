"""
Evaluation metrics.

Computes Precision, Recall, F1-Score, False Positive Rate, and
throughput / latency statistics from a labelled dataset or from
the live scoring results.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class ScoringResult:
    """One scored transaction with ground-truth label."""
    tx_id: str
    predicted_risk: float       # 0–100
    predicted_label: str        # HIGH / MEDIUM / LOW
    actual_is_fraud: bool       # ground truth
    processing_time_ms: float


@dataclass
class EvaluationReport:
    """Aggregated evaluation metrics."""
    total: int = 0
    true_positives: int = 0
    false_positives: int = 0
    true_negatives: int = 0
    false_negatives: int = 0
    precision: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    false_positive_rate: float = 0.0
    avg_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0
    p99_latency_ms: float = 0.0
    throughput_tps: float = 0.0
    risk_threshold: float = 0.0


class MetricsCalculator:
    """Collect scored results and compute evaluation metrics."""

    def __init__(self, risk_threshold: float = 70.0) -> None:
        self.risk_threshold = risk_threshold
        self._results: List[ScoringResult] = []

    def add_result(self, result: ScoringResult) -> None:
        self._results.append(result)

    def add_batch(self, results: List[ScoringResult]) -> None:
        self._results.extend(results)

    def clear(self) -> None:
        self._results.clear()

    def compute(self, total_time_sec: float = 1.0) -> EvaluationReport:
        """Compute all metrics over the collected results."""
        report = EvaluationReport(
            total=len(self._results),
            risk_threshold=self.risk_threshold,
        )
        if not self._results:
            return report

        latencies = []

        for r in self._results:
            predicted_fraud = r.predicted_risk >= self.risk_threshold
            actual_fraud = r.actual_is_fraud
            latencies.append(r.processing_time_ms)

            if predicted_fraud and actual_fraud:
                report.true_positives += 1
            elif predicted_fraud and not actual_fraud:
                report.false_positives += 1
            elif not predicted_fraud and actual_fraud:
                report.false_negatives += 1
            else:
                report.true_negatives += 1

        # Precision
        tp_fp = report.true_positives + report.false_positives
        report.precision = report.true_positives / tp_fp if tp_fp > 0 else 0

        # Recall
        tp_fn = report.true_positives + report.false_negatives
        report.recall = report.true_positives / tp_fn if tp_fn > 0 else 0

        # F1
        if report.precision + report.recall > 0:
            report.f1_score = (
                2 * report.precision * report.recall
                / (report.precision + report.recall)
            )

        # False Positive Rate
        fp_tn = report.false_positives + report.true_negatives
        report.false_positive_rate = report.false_positives / fp_tn if fp_tn > 0 else 0

        # Latency stats
        arr = np.array(latencies)
        report.avg_latency_ms = float(np.mean(arr))
        report.p95_latency_ms = float(np.percentile(arr, 95))
        report.p99_latency_ms = float(np.percentile(arr, 99))

        # Throughput
        report.throughput_tps = len(self._results) / max(total_time_sec, 0.01)

        return report

    def print_report(self, report: EvaluationReport | None = None) -> str:
        """Pretty-print the evaluation report."""
        if report is None:
            report = self.compute()

        lines = [
            "╔══════════════════════════════════════════════╗",
            "║        EVALUATION METRICS REPORT             ║",
            "╠══════════════════════════════════════════════╣",
            f"║  Total transactions:  {report.total:>10}            ║",
            f"║  Risk threshold:      {report.risk_threshold:>10.1f}            ║",
            "╠──────────────────────────────────────────────╣",
            f"║  True Positives:      {report.true_positives:>10}            ║",
            f"║  False Positives:     {report.false_positives:>10}            ║",
            f"║  True Negatives:      {report.true_negatives:>10}            ║",
            f"║  False Negatives:     {report.false_negatives:>10}            ║",
            "╠──────────────────────────────────────────────╣",
            f"║  Precision:           {report.precision:>10.4f}            ║",
            f"║  Recall:              {report.recall:>10.4f}            ║",
            f"║  F1 Score:            {report.f1_score:>10.4f}            ║",
            f"║  False Positive Rate: {report.false_positive_rate:>10.4f}            ║",
            "╠──────────────────────────────────────────────╣",
            f"║  Avg latency (ms):    {report.avg_latency_ms:>10.2f}            ║",
            f"║  P95 latency (ms):    {report.p95_latency_ms:>10.2f}            ║",
            f"║  P99 latency (ms):    {report.p99_latency_ms:>10.2f}            ║",
            f"║  Throughput (TPS):    {report.throughput_tps:>10.1f}            ║",
            "╚══════════════════════════════════════════════╝",
        ]
        text = "\n".join(lines)
        logger.info("\n%s", text)
        return text

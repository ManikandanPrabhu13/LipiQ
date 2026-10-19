"""
Benchmark harness for the isolated LipiQ OCR experiments.

Usage (from the project root):
    python ocr_experiments/benchmark_experiments.py --mode self-check
    python ocr_experiments/benchmark_experiments.py --mode baseline
    python ocr_experiments/benchmark_experiments.py --mode sweep
    python ocr_experiments/benchmark_experiments.py --mode all

The script:
1. Validates the existing CER/WER implementations with synthetic cases.
2. Reproduces the previously recorded baseline and compares it with the
   stored benchmark reports.
3. Runs the approved lightweight preprocessing sweep.
4. Writes all generated artifacts to ocr_experiments/results/run_<timestamp>/.

It never writes outside ocr_experiments/results/, never edits existing
results, and never changes production code.

Results come from a single labeled document (sample.png + reference.txt)
and are preliminary. They cannot establish general Kannada OCR accuracy.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

# Allow this script to be run directly from the project root.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from PIL import Image

# Import the project's existing metric and normalization implementations.
# evaluate_ocr.main() is guarded by __main__, so importing it is safe.
import evaluate_ocr
import layout_ab_benchmark

from evaluate_ocr import (
    calculate_cer,
    calculate_wer,
    normalize_text,
)

from experimental_ocr import (
    BASELINE_PREPROCESSING,
    DEFAULT_PSM_MODES,
    EXPERIMENTAL_PREPROCESSING,
    PROJECT_ROOT,
    baseline_configurations,
    ensure_tesseract,
    experimental_configurations,
    load_image,
    run_baseline_candidate,
    run_experimental_candidate,
)


IMAGE_PATH = PROJECT_ROOT / "sample.png"
REFERENCE_PATH = PROJECT_ROOT / "reference.txt"
EXISTING_CUSTOM_RESULTS = PROJECT_ROOT / "ocr_benchmark_results.txt"
EXISTING_LAYOUT_RESULTS = PROJECT_ROOT / "layout_ab_benchmark_results.txt"

RESULTS_ROOT = Path(__file__).resolve().parent / "results"

# Existing results are rounded to 2 decimal places in the reports.
REPRODUCTION_TOLERANCE_PP = 0.05


# ---------------------------------------------------------------------------
# Metric validation
# ---------------------------------------------------------------------------

SELF_CHECK_CASES = [
    # name, reference, hypothesis, expected CER (fraction), expected WER
    ("identical Kannada", "ಕರ್ನಾಟಕ", "ಕರ್ನಾಟಕ", 0.0, 0.0),
    ("canonical Unicode difference",
     unicodedata.normalize("NFD", "ಕರ್ನಾಟಕ"),
     unicodedata.normalize("NFC", "ಕರ್ನಾಟಕ"),
     0.0, 0.0),
    ("one character substitution", "abc", "abd", 1 / 3, 1.0),
    ("one character insertion", "abc", "abxc", 1 / 3, 1.0),
    ("one character deletion", "abcd", "abc", 1 / 4, 1.0),
    ("one word substitution", "a b c", "a b d", 1 / 5, 1 / 3),
    ("one word deletion", "a b c", "a b", 2 / 5, 1 / 3),
    ("both empty", "", "", 0.0, 0.0),
    ("empty reference, non-empty hypothesis", "", "abc", 1.0, 1.0),
    ("Kannada matra deletion", "ಕಾ", "ಕ", 1 / 2, 1.0),
]


def run_metric_self_check() -> dict[str, Any]:
    """Validate CER/WER against known edit-distance cases."""
    rows: list[dict[str, Any]] = []
    failures: list[str] = []

    for name, reference, hypothesis, expected_cer, expected_wer in (
        SELF_CHECK_CASES
    ):
        reference = normalize_text(reference)
        hypothesis = normalize_text(hypothesis)

        actual_cer = calculate_cer(reference, hypothesis)
        actual_wer = calculate_wer(reference, hypothesis)

        # Both existing implementations must agree:
        # evaluate_ocr returns fractions, layout_ab_benchmark percentages.
        percent_cer = layout_ab_benchmark.calculate_cer(
            reference,
            hypothesis,
        )
        percent_wer = layout_ab_benchmark.calculate_wer(
            reference,
            hypothesis,
        )

        cer_ok = abs(actual_cer - expected_cer) < 1e-9
        wer_ok = abs(actual_wer - expected_wer) < 1e-9
        percent_ok = (
            abs(percent_cer - actual_cer * 100.0) < 1e-9
            and abs(percent_wer - actual_wer * 100.0) < 1e-9
        )

        passed = cer_ok and wer_ok and percent_ok

        if not passed:
            failures.append(name)

        rows.append(
            {
                "case": name,
                "expected_cer": expected_cer,
                "actual_cer": actual_cer,
                "expected_wer": expected_wer,
                "actual_wer": actual_wer,
                "percent_functions_agree": percent_ok,
                "passed": passed,
            }
        )

    return {
        "passed": not failures,
        "failures": failures,
        "cases": rows,
    }


# ---------------------------------------------------------------------------
# Existing baseline expectations
# ---------------------------------------------------------------------------

CUSTOM_RESULT_RE = re.compile(
    r"Rank\s+(\d+):\s+PSM=(\d+),\s+preprocessing=(\w+),"
    r"\s+CER=([\d.]+)%,\s+WER=([\d.]+)%,"
    r"\s+confidence=([\d.]+),\s+words=(\d+)"
)

LAYOUT_RESULT_RE = re.compile(
    r"^(original|contrast|grayscale|threshold|adaptive)\s+"
    r"(\d)\s+"
    r"([\d.]+)%\s+([\d.]+)%\s+([+-][\d.]+)\s+"
    r"([\d.]+)%\s+([\d.]+)%\s+([+-][\d.]+)\s+"
    r"(\d+)\s*$"
)


def parse_existing_custom_results(
    path: Path,
) -> dict[tuple[int, str], dict[str, float]]:
    """Parse ocr_benchmark_results.txt (custom-layout metrics)."""
    expected: dict[tuple[int, str], dict[str, float]] = {}

    if not path.exists():
        return expected

    for line in path.read_text(encoding="utf-8").splitlines():
        match = CUSTOM_RESULT_RE.search(line)
        if not match:
            continue

        _, psm, preprocessing, cer, wer, confidence, words = (
            match.groups()
        )
        expected[(int(psm), preprocessing)] = {
            "custom_cer": float(cer),
            "custom_wer": float(wer),
            "confidence": float(confidence),
            "words": float(words),
        }

    return expected


def parse_existing_layout_results(
    path: Path,
) -> dict[tuple[int, str], dict[str, float]]:
    """Parse layout_ab_benchmark_results.txt (raw vs custom metrics)."""
    expected: dict[tuple[int, str], dict[str, float]] = {}

    if not path.exists():
        return expected

    for line in path.read_text(encoding="utf-8").splitlines():
        match = LAYOUT_RESULT_RE.match(line)
        if not match:
            continue

        (
            preprocessing,
            psm,
            original_cer,
            custom_cer,
            _cer_delta,
            original_wer,
            custom_wer,
            _wer_delta,
            words,
        ) = match.groups()

        expected[(int(psm), preprocessing)] = {
            "raw_cer": float(original_cer),
            "custom_cer": float(custom_cer),
            "raw_wer": float(original_wer),
            "custom_wer": float(custom_wer),
            "words": float(words),
        }

    return expected


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------

def measure_candidate(
    candidate: dict[str, Any],
    reference: str,
    phase: str,
) -> dict[str, Any]:
    """Normalize and score one OCR candidate."""
    raw_text = normalize_text(candidate.get("raw_text", ""))
    custom_text = normalize_text(
        candidate.get("text", candidate.get("extracted_text", ""))
    )

    return {
        "phase": phase,
        "preprocessing": candidate["preprocessing"],
        "psm": int(candidate["psm"]),
        "raw_cer": calculate_cer(reference, raw_text) * 100.0,
        "raw_wer": calculate_wer(reference, raw_text) * 100.0,
        "custom_cer": calculate_cer(reference, custom_text) * 100.0,
        "custom_wer": calculate_wer(reference, custom_text) * 100.0,
        "elapsed_seconds": round(
            float(candidate.get("elapsed_seconds", 0.0)),
            3,
        ),
        "word_count": int(candidate.get("word_count", 0)),
        "raw_words": len(candidate.get("raw_words", [])),
        # Normalized text is used for metrics; the original strings are
        # preserved so saved artifacts keep their real line structure.
        "raw_text": raw_text,
        "custom_text": custom_text,
        "raw_output": candidate.get("raw_text", ""),
        "custom_output": candidate.get(
            "text",
            candidate.get("extracted_text", ""),
        ),
    }


def compare_with_existing(
    rows: list[dict[str, Any]],
    existing_custom: dict[tuple[int, str], dict[str, float]],
    existing_layout: dict[tuple[int, str], dict[str, float]],
) -> dict[str, Any]:
    """
    Compare reproduced baseline metrics to the stored reports.

    Returns per-metric maximum absolute differences and a boolean
    stating whether everything is within the rounding tolerance.
    """
    comparisons: list[dict[str, Any]] = []
    max_difference = 0.0

    for row in rows:
        key = (row["psm"], row["preprocessing"])

        for metric in ("custom_cer", "custom_wer", "raw_cer", "raw_wer"):
            expected_value = None
            source = None

            if metric in existing_layout.get(key, {}):
                expected_value = existing_layout[key][metric]
                source = "layout_ab_benchmark_results.txt"
            elif metric in existing_custom.get(key, {}):
                expected_value = existing_custom[key][metric]
                source = "ocr_benchmark_results.txt"

            if expected_value is None:
                continue

            difference = abs(row[metric] - expected_value)
            max_difference = max(max_difference, difference)

            comparisons.append(
                {
                    "preprocessing": row["preprocessing"],
                    "psm": row["psm"],
                    "metric": metric,
                    "expected": expected_value,
                    "measured": round(row[metric], 4),
                    "abs_difference_pp": round(difference, 4),
                    "within_tolerance": (
                        difference <= REPRODUCTION_TOLERANCE_PP
                    ),
                    "source": source,
                }
            )

    mismatches = [
        item for item in comparisons if not item["within_tolerance"]
    ]

    return {
        "reproduced": bool(comparisons) and not mismatches,
        "compared_rows": len(comparisons),
        "max_abs_difference_pp": round(max_difference, 4),
        "tolerance_pp": REPRODUCTION_TOLERANCE_PP,
        "mismatches": mismatches,
        "details": comparisons,
    }


# ---------------------------------------------------------------------------
# Artifact writing
# ---------------------------------------------------------------------------

def create_run_directory() -> Path:
    """Create a unique timestamped directory under results/."""
    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)

    base = "run_" + time.strftime("%Y%m%d_%H%M%S")
    directory = RESULTS_ROOT / base
    suffix = 1

    while directory.exists():
        directory = RESULTS_ROOT / f"{base}_{suffix}"
        suffix += 1

    directory.mkdir(parents=True)
    return directory


def write_candidate_texts(
    run_directory: Path,
    candidate: dict[str, Any],
) -> None:
    """Persist raw and reconstructed output for error inspection."""
    stem = (
        f"{candidate['phase']}_"
        f"{candidate['preprocessing']}_psm_{candidate['psm']}"
    )

    raw_dir = run_directory / "candidate_texts" / "raw"
    custom_dir = run_directory / "candidate_texts" / "reconstructed"
    raw_dir.mkdir(parents=True, exist_ok=True)
    custom_dir.mkdir(parents=True, exist_ok=True)

    (raw_dir / f"{stem}.txt").write_text(
        candidate.get("raw_output", candidate["raw_text"]),
        encoding="utf-8",
    )
    (custom_dir / f"{stem}.txt").write_text(
        candidate.get("custom_output", candidate["custom_text"]),
        encoding="utf-8",
    )


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "phase",
        "preprocessing",
        "psm",
        "raw_cer",
        "raw_wer",
        "custom_cer",
        "custom_wer",
        "elapsed_seconds",
        "word_count",
        "raw_words",
    ]

    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row[field] for field in fields})


def write_summary(
    path: Path,
    reference: str,
    self_check: dict[str, Any],
    reproduction: dict[str, Any],
    rows: list[dict[str, Any]],
) -> None:
    """Write a compact human-readable summary for this run."""
    lines = [
        "# LipiQ OCR Experiment Run",
        "",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"Image: `{IMAGE_PATH.name}`",
        f"Reference: `{REFERENCE_PATH.name}`",
        (
            f"Reference: {len(reference)} characters, "
            f"{len(reference.split())} words"
        ),
        "",
        "> **Preliminary:** all results come from one labeled document.",
        "> They do not establish general Kannada OCR accuracy.",
        "",
        "## Metric self-check",
        "",
        f"Passed: **{self_check['passed']}**",
        "",
    ]

    if self_check["failures"]:
        lines.append(
            "Failed cases: " + ", ".join(self_check["failures"])
        )
        lines.append("")

    lines.extend(
        [
            "## Baseline reproduction",
            "",
            f"Reproduced within {REPRODUCTION_TOLERANCE_PP} pp: "
            f"**{reproduction['reproduced']}**",
            (
                f"Comparisons: {reproduction['compared_rows']}; "
                "max absolute difference: "
                f"{reproduction['max_abs_difference_pp']} pp"
            ),
            "",
        ]
    )

    if reproduction["mismatches"]:
        lines.append("Mismatches:")
        lines.append("")
        for item in reproduction["mismatches"]:
            lines.append(
                f"- {item['preprocessing']} / PSM {item['psm']} / "
                f"{item['metric']}: expected {item['expected']}, "
                f"measured {item['measured']}"
            )
        lines.append("")

    lines.extend(
        [
            "## Results",
            "",
            "| Phase | Preprocessing | PSM | Raw CER % | Raw WER % | "
            "Custom CER % | Custom WER % | Time s | Words |",
            "|---|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )

    for row in rows:
        lines.append(
            f"| {row['phase']} | {row['preprocessing']} | {row['psm']} | "
            f"{row['raw_cer']:.2f} | {row['raw_wer']:.2f} | "
            f"{row['custom_cer']:.2f} | {row['custom_wer']:.2f} | "
            f"{row['elapsed_seconds']:.2f} | {row['word_count']} |"
        )

    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- CER uses Unicode code points after NFC normalization and "
            "whitespace collapsing.",
            "- Raw = Tesseract TSV grouping/order; Custom = "
            "`reconstruct_reading_order()`.",
            "- Elapsed time covers preprocessing + Tesseract only.",
            "- Peak memory was not measured.",
            "",
        ]
    )

    path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def require_inputs() -> str:
    """Validate input files and return normalized reference text."""
    if not IMAGE_PATH.exists():
        raise FileNotFoundError(
            f"Image not found: {IMAGE_PATH}\n"
            "Place sample.png in the project directory."
        )

    if not REFERENCE_PATH.exists():
        raise FileNotFoundError(
            f"Reference not found: {REFERENCE_PATH}\n"
            "Place reference.txt in the project directory."
        )

    reference = normalize_text(
        REFERENCE_PATH.read_text(encoding="utf-8-sig")
    )

    if not reference:
        raise ValueError("reference.txt is empty.")

    return reference


def print_self_check(result: dict[str, Any]) -> None:
    print("\nMETRIC SELF-CHECK")
    print("-" * 72)

    for case in result["cases"]:
        status = "PASS" if case["passed"] else "FAIL"
        print(
            f"[{status}] {case['case']}: "
            f"CER {case['actual_cer']:.4f}, "
            f"WER {case['actual_wer']:.4f}"
        )

    print(f"\nOverall: {'PASS' if result['passed'] else 'FAIL'}")


def print_reproduction(reproduction: dict[str, Any]) -> None:
    print("\nBASELINE REPRODUCTION")
    print("-" * 72)
    print(
        f"Compared {reproduction['compared_rows']} metric values; "
        f"max difference {reproduction['max_abs_difference_pp']} pp"
    )
    print(f"Reproduced: {reproduction['reproduced']}")

    for item in reproduction["mismatches"]:
        print(
            f"  MISMATCH {item['preprocessing']} / PSM {item['psm']} / "
            f"{item['metric']}: expected {item['expected']}, "
            f"measured {item['measured']}"
        )


def print_results(rows: list[dict[str, Any]]) -> None:
    print("\nRESULTS")
    print("-" * 100)
    print(
        f"{'Phase':<10}{'Preprocessing':<18}{'PSM':>4}"
        f"{'Raw CER%':>11}{'Raw WER%':>11}"
        f"{'Cust CER%':>11}{'Cust WER%':>11}"
        f"{'Time s':>9}{'Words':>7}"
    )

    for row in rows:
        print(
            f"{row['phase']:<10}{row['preprocessing']:<18}{row['psm']:>4}"
            f"{row['raw_cer']:>11.2f}{row['raw_wer']:>11.2f}"
            f"{row['custom_cer']:>11.2f}{row['custom_wer']:>11.2f}"
            f"{row['elapsed_seconds']:>9.2f}{row['word_count']:>7}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Isolated LipiQ OCR experiments.",
    )
    parser.add_argument(
        "--mode",
        choices=("self-check", "baseline", "sweep", "all"),
        default="all",
    )
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    try:
        reference = require_inputs()
        ensure_tesseract()
    except (FileNotFoundError, ValueError, RuntimeError) as error:
        print(f"ERROR: {error}")
        return 2

    self_check = run_metric_self_check()
    print_self_check(self_check)

    if not self_check["passed"]:
        print(
            "\nStopping: metric validation failed. "
            "No benchmark results are trustworthy until this is fixed."
        )
        return 1

    if args.mode == "self-check":
        return 0

    image = load_image(IMAGE_PATH)

    rows: list[dict[str, Any]] = []
    reproduction: dict[str, Any] = {
        "reproduced": False,
        "compared_rows": 0,
        "max_abs_difference_pp": 0.0,
        "tolerance_pp": REPRODUCTION_TOLERANCE_PP,
        "mismatches": [],
        "details": [],
    }

    if args.mode in ("baseline", "all"):
        print("\nReproducing the existing baseline configurations...")

        baseline_rows: list[dict[str, Any]] = []

        for psm, preprocessing in baseline_configurations():
            print(
                f"  baseline: preprocessing={preprocessing}, PSM={psm}"
            )
            candidate = run_baseline_candidate(
                image,
                psm,
                preprocessing,
            )
            baseline_rows.append(
                measure_candidate(candidate, reference, "baseline")
            )

        reproduction = compare_with_existing(
            baseline_rows,
            parse_existing_custom_results(EXISTING_CUSTOM_RESULTS),
            parse_existing_layout_results(EXISTING_LAYOUT_RESULTS),
        )
        print_reproduction(reproduction)
        rows.extend(baseline_rows)

    if args.mode in ("sweep", "all"):
        print("\nRunning the approved experimental preprocessing sweep...")

        for psm, preprocessing in experimental_configurations():
            print(
                f"  experiment: preprocessing={preprocessing}, PSM={psm}"
            )
            candidate = run_experimental_candidate(
                image,
                psm,
                preprocessing,
            )
            rows.append(
                measure_candidate(candidate, reference, "experiment")
            )

    print_results(rows)

    run_directory = create_run_directory()

    for row in rows:
        write_candidate_texts(run_directory, row)

    write_csv(run_directory / "results.csv", rows)
    write_summary(
        run_directory / "summary.md",
        reference,
        self_check,
        reproduction,
        rows,
    )

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "image": IMAGE_PATH.name,
        "reference": REFERENCE_PATH.name,
        "reference_characters": len(reference),
        "reference_words": len(reference.split()),
        "single_document_limitation": True,
        "metric_self_check": self_check,
        "baseline_reproduction": reproduction,
        "results": [
            {
                key: value
                for key, value in row.items()
                if key not in (
                    "raw_text",
                    "custom_text",
                    "raw_output",
                    "custom_output",
                )
            }
            for row in rows
        ],
        "notes": {
            "raw": "Tesseract TSV grouping and word order.",
            "custom": "reconstruct_reading_order() output.",
            "cer_wer": (
                "evaluate_ocr.calculate_cer/calculate_wer, expressed "
                "as percentages."
            ),
            "memory": "Peak memory not measured.",
        },
    }

    (run_directory / "results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\nArtifacts written to: {run_directory}")
    print("Existing project results were not modified.")

    if args.mode in ("baseline", "all") and not reproduction["reproduced"]:
        print(
            "\nWARNING: the stored baseline was not reproduced within "
            "tolerance. Investigate before claiming any improvement."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

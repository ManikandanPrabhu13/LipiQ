
from __future__ import annotations

from pathlib import Path
from typing import Any
import unicodedata

from PIL import Image

from ocr_engine import (
    SUPPORTED_PSM_MODES,
    SUPPORTED_STRATEGIES,
    _run_candidate,
)


ROOT = Path(__file__).resolve().parent

IMAGE_PATH = ROOT / "sample.png"
REFERENCE_PATH = ROOT / "reference.txt"
REPORT_PATH = ROOT / "layout_ab_benchmark_results.txt"


def normalize_text(text: str) -> str:
    """Normalize Unicode and whitespace for fair text comparison."""
    text = unicodedata.normalize("NFC", text)
    return " ".join(text.split())


def edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    """Calculate Levenshtein edit distance using O(min(n, m)) memory."""
    if len(reference) < len(hypothesis):
        reference, hypothesis = hypothesis, reference

    previous = list(range(len(hypothesis) + 1))

    for i, ref_item in enumerate(reference, start=1):
        current = [i]

        for j, hyp_item in enumerate(hypothesis, start=1):
            substitution_cost = 0 if ref_item == hyp_item else 1

            current.append(
                min(
                    previous[j] + 1,       # Deletion
                    current[j - 1] + 1,    # Insertion
                    previous[j - 1] + substitution_cost,
                )
            )

        previous = current

    return previous[-1]


def calculate_cer(reference: str, hypothesis: str) -> float:
    """Character error rate, expressed as a percentage."""
    reference_chars = list(reference)
    hypothesis_chars = list(hypothesis)

    if not reference_chars:
        return 0.0 if not hypothesis_chars else 100.0

    errors = edit_distance(reference_chars, hypothesis_chars)
    return (errors / len(reference_chars)) * 100.0


def calculate_wer(reference: str, hypothesis: str) -> float:
    """Word error rate, expressed as a percentage."""
    reference_words = reference.split()
    hypothesis_words = hypothesis.split()

    if not reference_words:
        return 0.0 if not hypothesis_words else 100.0

    errors = edit_distance(reference_words, hypothesis_words)
    return (errors / len(reference_words)) * 100.0


def safe_float(value: Any, default: float = 0.0) -> float:
    """Convert a value to float safely."""
    try:
        result = float(value)
        return result if result >= 0 else default
    except (TypeError, ValueError):
        return default


def main() -> None:
    if not IMAGE_PATH.exists():
        raise FileNotFoundError(
            f"Benchmark image not found: {IMAGE_PATH}\n"
            "Place sample.png in the project directory."
        )

    if not REFERENCE_PATH.exists():
        raise FileNotFoundError(
            f"Reference text not found: {REFERENCE_PATH}\n"
            "Place reference.txt in the project directory."
        )

    reference = normalize_text(
        REFERENCE_PATH.read_text(encoding="utf-8-sig")
    )

    if not reference:
        raise ValueError(
            "reference.txt is empty. Add the manually verified "
            "ground-truth transcription before benchmarking."
        )

    results: list[dict[str, Any]] = []

    with Image.open(IMAGE_PATH) as source_image:
        image = source_image.copy()

    total_runs = (
        len(SUPPORTED_STRATEGIES) * len(SUPPORTED_PSM_MODES)
    )
    run_number = 0

    print("LipiQ OCR Layout A/B Benchmark")
    print("=" * 72)
    print(f"Image:     {IMAGE_PATH.name}")
    print(f"Reference: {REFERENCE_PATH.name}")
    print(f"Reference characters: {len(reference)}")
    print(f"Configurations: {total_runs}")
    print()

    for strategy in SUPPORTED_STRATEGIES:
        for psm in SUPPORTED_PSM_MODES:
            run_number += 1

            print(
                f"[{run_number}/{total_runs}] "
                f"Testing strategy={strategy}, PSM={psm}..."
            )

            candidate = _run_candidate(
                image.copy(),
                psm,
                strategy,
            )

            # Baseline: Tesseract's original TSV grouping/order,
            # preserved before custom geometric layout reconstruction.
            if "raw_text" not in candidate:
                raise KeyError(
                    "_run_candidate() does not return 'raw_text'. "
                    "Update ocr_engine.py to preserve the original "
                    "Tesseract text before reconstruct_reading_order()."
                )

            # Treatment: output after custom layout reconstruction.
            if "text" not in candidate:
                raise KeyError(
                    "_run_candidate() does not return 'text'."
                )

            original_text = normalize_text(candidate["raw_text"])
            custom_text = normalize_text(candidate["text"])

            original_cer = calculate_cer(reference, original_text)
            custom_cer = calculate_cer(reference, custom_text)

            original_wer = calculate_wer(reference, original_text)
            custom_wer = calculate_wer(reference, custom_text)

            words = candidate.get("words", [])
            confidences = [
                safe_float(word.get("confidence"))
                for word in words
                if word.get("confidence") is not None
                and safe_float(word.get("confidence")) > 0
            ]

            average_confidence = (
                sum(confidences) / len(confidences)
                if confidences
                else 0.0
            )

            results.append(
                {
                    "strategy": strategy,
                    "psm": psm,
                    "original_cer": original_cer,
                    "custom_cer": custom_cer,
                    "cer_delta": custom_cer - original_cer,
                    "original_wer": original_wer,
                    "custom_wer": custom_wer,
                    "wer_delta": custom_wer - original_wer,
                    "confidence": average_confidence,
                    "word_count": len(words),
                    "original_chars": len(original_text),
                    "custom_chars": len(custom_text),
                }
            )

    # Lower CER and WER are better. Sort by their combined error.
    results.sort(
        key=lambda row: (
            row["custom_cer"] + row["custom_wer"],
            row["custom_cer"],
            row["custom_wer"],
        )
    )

    header = (
        f"{'Strategy':<13}"
        f"{'PSM':>5}"
        f"{'Orig CER':>11}"
        f"{'Custom CER':>12}"
        f"{'CER Δ':>9}"
        f"{'Orig WER':>11}"
        f"{'Custom WER':>12}"
        f"{'WER Δ':>9}"
        f"{'Words':>8}"
    )

    separator = "-" * len(header)
    report_lines = [
        "LIPIQ OCR LAYOUT A/B BENCHMARK",
        "=" * len(header),
        f"Image: {IMAGE_PATH.name}",
        f"Reference: {REFERENCE_PATH.name}",
        f"Reference characters: {len(reference)}",
        f"Configurations tested: {total_runs}",
        "",
        "Methodology:",
        "- Original text uses preserved Tesseract TSV line grouping",
        "  and word_num order before custom layout reconstruction.",
        "- Custom text uses reconstruct_reading_order() output.",
        "- Both outputs use the same OCR recognition run per configuration.",
        "- Negative CER/WER delta means custom layout reduced the error.",
        "- Positive CER/WER delta means custom layout increased the error.",
        "- CER/WER measure transcription similarity, not semantic correctness.",
        "",
        header,
        separator,
    ]

    print()
    print(header)
    print(separator)

    for row in results:
        line = (
            f"{row['strategy']:<13}"
            f"{row['psm']:>5}"
            f"{row['original_cer']:>10.2f}%"
            f"{row['custom_cer']:>11.2f}%"
            f"{row['cer_delta']:>+8.2f}"
            f"{row['original_wer']:>10.2f}%"
            f"{row['custom_wer']:>11.2f}%"
            f"{row['wer_delta']:>+8.2f}"
            f"{row['word_count']:>8}"
        )

        print(line)
        report_lines.append(line)

    # Calculate how often the custom layout helps.
    cer_improved = sum(
        row["cer_delta"] < 0 for row in results
    )
    wer_improved = sum(
        row["wer_delta"] < 0 for row in results
    )
    cer_unchanged = sum(
        row["cer_delta"] == 0 for row in results
    )
    wer_unchanged = sum(
        row["wer_delta"] == 0 for row in results
    )

    best = results[0]

    summary_lines = [
        "",
        "SUMMARY",
        "-------",
        (
            f"CER improved: {cer_improved}/{total_runs} configurations"
        ),
        (
            f"WER improved: {wer_improved}/{total_runs} configurations"
        ),
        (
            f"CER unchanged: {cer_unchanged}/{total_runs} configurations"
        ),
        (
            f"WER unchanged: {wer_unchanged}/{total_runs} configurations"
        ),
        "",
        "Best custom-layout configuration by combined CER + WER:",
        f"Strategy: {best['strategy']}",
        f"PSM: {best['psm']}",
        f"Custom CER: {best['custom_cer']:.2f}%",
        f"Custom WER: {best['custom_wer']:.2f}%",
        f"CER delta: {best['cer_delta']:+.2f} percentage points",
        f"WER delta: {best['wer_delta']:+.2f} percentage points",
        "",
        "Interpretation:",
        "A negative delta indicates improvement over the original",
        "Tesseract TSV ordering for that same OCR configuration.",
        "Evaluate results across configurations before changing the",
        "default layout algorithm. One image is not enough to establish",
        "general OCR accuracy.",
        "",
        "Important:",
        "This benchmark evaluates text ordering and grouping against",
        "the provided reference. It does not establish accuracy on",
        "other documents, layouts, image qualities, or handwriting.",
    ]

    report_lines.extend(summary_lines)

    print("\n".join(summary_lines))

    REPORT_PATH.write_text(
        "\n".join(report_lines) + "\n",
        encoding="utf-8",
    )

    print(f"\nFull report saved to: {REPORT_PATH}")


if __name__ == "__main__":
    main()

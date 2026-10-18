
from pathlib import Path
import unicodedata

from PIL import Image

from ocr_engine import (
    _run_candidate,
    SUPPORTED_PSM_MODES,
    SUPPORTED_STRATEGIES,
)


BASE_DIR = Path(__file__).resolve().parent
IMAGE_PATH = BASE_DIR / "sample.png"
REFERENCE_PATH = BASE_DIR / "reference.txt"
RESULTS_PATH = BASE_DIR / "ocr_benchmark_results.txt"
CANDIDATES_DIR = BASE_DIR / "ocr_candidates"


def normalize_text(text: str) -> str:
    """Normalize Unicode and whitespace before comparison."""
    text = unicodedata.normalize("NFC", text)
    return " ".join(text.split())


def levenshtein_distance(a: list, b: list) -> int:
    """Calculate edit distance using memory-efficient dynamic programming."""
    if len(a) < len(b):
        a, b = b, a

    previous_row = list(range(len(b) + 1))

    for i, item_a in enumerate(a, start=1):
        current_row = [i]

        for j, item_b in enumerate(b, start=1):
            insertion = current_row[j - 1] + 1
            deletion = previous_row[j] + 1
            substitution = previous_row[j - 1] + (
                item_a != item_b
            )

            current_row.append(
                min(insertion, deletion, substitution)
            )

        previous_row = current_row

    return previous_row[-1]


def calculate_cer(reference: str, prediction: str) -> float:
    """Character Error Rate."""
    reference_chars = list(reference)
    prediction_chars = list(prediction)

    if not reference_chars:
        return 0.0 if not prediction_chars else 1.0

    distance = levenshtein_distance(
        reference_chars,
        prediction_chars,
    )

    return distance / len(reference_chars)


def calculate_wer(reference: str, prediction: str) -> float:
    """Word Error Rate."""
    reference_words = reference.split()
    prediction_words = prediction.split()

    if not reference_words:
        return 0.0 if not prediction_words else 1.0

    distance = levenshtein_distance(
        reference_words,
        prediction_words,
    )

    return distance / len(reference_words)


def get_candidate_text(candidate: dict) -> str:
    """Extract text while supporting either engine result key."""
    text = candidate.get(
        "text",
        candidate.get("extracted_text", ""),
    )

    if not isinstance(text, str):
        raise TypeError(
            "OCR candidate text must be a string."
        )

    return text


def main():
    # Validate input files.
    if not IMAGE_PATH.exists():
        raise FileNotFoundError(
            f"Sample image not found: {IMAGE_PATH}"
        )

    if not REFERENCE_PATH.exists():
        raise FileNotFoundError(
            f"Reference text not found: {REFERENCE_PATH}"
        )

    reference = normalize_text(
        REFERENCE_PATH.read_text(encoding="utf-8-sig")
    )

    if not reference:
        raise ValueError(
            "reference.txt is empty. Add the checked "
            "Kannada reference transcription first."
        )

    # Load the image once and reuse it for every candidate.
    print("Loading sample image...")

    with Image.open(IMAGE_PATH) as source_image:
        image = source_image.convert("RGB")

    total_candidates = (
        len(SUPPORTED_PSM_MODES)
        * len(SUPPORTED_STRATEGIES)
    )

    results = []

    print(f"Evaluating {total_candidates} OCR candidates...\n")

    # Run every PSM/preprocessing combination.
    for psm in SUPPORTED_PSM_MODES:
        for strategy in SUPPORTED_STRATEGIES:
            print(
                f"Testing PSM {psm}, "
                f"preprocessing={strategy}..."
            )

            candidate = _run_candidate(
                image=image,
                psm=psm,
                strategy=strategy,
            )

            raw_text = get_candidate_text(candidate)
            normalized_prediction = normalize_text(raw_text)

            cer = calculate_cer(
                reference,
                normalized_prediction,
            )

            wer = calculate_wer(
                reference,
                normalized_prediction,
            )

            results.append({
                "psm": psm,
                "preprocessing": strategy,
                "cer": cer,
                "wer": wer,
                "confidence": float(
                    candidate.get("average_confidence", 0.0)
                ),
                "word_count": len(
                    normalized_prediction.split()
                ),
                "text": raw_text,
            })

    # Lower CER and WER are better.
    # Combined error is the primary ranking criterion.
    results.sort(
        key=lambda result: (
            result["cer"] + result["wer"],
            result["cer"],
            -result["confidence"],
        )
    )

    # Identify the best candidate for each metric.
    best_overall = results[0]
    best_cer = min(results, key=lambda item: item["cer"])
    best_wer = min(results, key=lambda item: item["wer"])

    # Print the benchmark.
    print("\n" + "=" * 88)
    print("                    LIPIQ OCR BENCHMARK RESULTS")
    print("=" * 88)

    print(f"Reference characters : {len(reference)}")
    print(f"Reference words      : {len(reference.split())}")
    print(f"Candidates evaluated : {len(results)}")

    print("\nRANKED CANDIDATES")
    print("-" * 88)

    print(
        f"{'Rank':<7}"
        f"{'PSM':<7}"
        f"{'Preprocessing':<17}"
        f"{'CER %':<12}"
        f"{'WER %':<12}"
        f"{'Confidence':<14}"
        f"{'Words':<8}"
    )

    print("-" * 88)

    for rank, result in enumerate(results, start=1):
        print(
            f"{rank:<7}"
            f"{result['psm']:<7}"
            f"{result['preprocessing']:<17}"
            f"{result['cer'] * 100:<12.2f}"
            f"{result['wer'] * 100:<12.2f}"
            f"{result['confidence']:<14.2f}"
            f"{result['word_count']:<8}"
        )

    print("\n" + "=" * 88)
    print("BEST RESULTS")
    print("=" * 88)

    print(
        f"\nBest overall (lowest CER + WER):"
        f"\n  PSM           : {best_overall['psm']}"
        f"\n  Preprocessing : {best_overall['preprocessing']}"
        f"\n  CER           : {best_overall['cer'] * 100:.2f}%"
        f"\n  WER           : {best_overall['wer'] * 100:.2f}%"
        f"\n  Confidence    : {best_overall['confidence']:.2f}"
    )

    print(
        f"\nBest character score (lowest CER):"
        f"\n  PSM           : {best_cer['psm']}"
        f"\n  Preprocessing : {best_cer['preprocessing']}"
        f"\n  CER           : {best_cer['cer'] * 100:.2f}%"
        f"\n  WER           : {best_cer['wer'] * 100:.2f}%"
    )

    print(
        f"\nBest word score (lowest WER):"
        f"\n  PSM           : {best_wer['psm']}"
        f"\n  Preprocessing : {best_wer['preprocessing']}"
        f"\n  CER           : {best_wer['cer'] * 100:.2f}%"
        f"\n  WER           : {best_wer['wer'] * 100:.2f}%"
    )

    # Save the ranked benchmark report.
    with RESULTS_PATH.open("w", encoding="utf-8") as file:
        file.write("LIPIQ OCR BENCHMARK RESULTS\n\n")
        file.write(f"Reference characters: {len(reference)}\n")
        file.write(f"Reference words: {len(reference.split())}\n")
        file.write(f"Candidates evaluated: {len(results)}\n\n")

        for rank, result in enumerate(results, start=1):
            file.write(
                f"Rank {rank}: "
                f"PSM={result['psm']}, "
                f"preprocessing={result['preprocessing']}, "
                f"CER={result['cer'] * 100:.2f}%, "
                f"WER={result['wer'] * 100:.2f}%, "
                f"confidence={result['confidence']:.2f}, "
                f"words={result['word_count']}\n"
            )

        file.write("\n\nBEST OVERALL OCR TEXT\n\n")
        file.write(best_overall["text"])

        file.write("\n\n\nBEST CER OCR TEXT\n\n")
        file.write(best_cer["text"])

        file.write("\n\n\nBEST WER OCR TEXT\n\n")
        file.write(best_wer["text"])

    # Save each candidate's full OCR output separately.
    CANDIDATES_DIR.mkdir(parents=True, exist_ok=True)

    for rank, result in enumerate(results, start=1):
        filename = (
            f"rank_{rank:02d}_"
            f"psm_{result['psm']}_"
            f"{result['preprocessing']}.txt"
        )

        candidate_path = CANDIDATES_DIR / filename

        candidate_path.write_text(
            result["text"],
            encoding="utf-8",
        )

    # Save the best candidate to a convenient standalone file.
    best_text_path = BASE_DIR / "best_ocr_output.txt"

    best_text_path.write_text(
        best_overall["text"],
        encoding="utf-8",
    )

    print("\n" + "=" * 88)
    print("SAVED FILES")
    print("=" * 88)
    print(f"Benchmark report : {RESULTS_PATH}")
    print(f"All candidate texts: {CANDIDATES_DIR}")
    print(f"Best OCR text    : {best_text_path}")

    print("\nBenchmark complete!")
    print(
        "\nImportant: These metrics depend on the correctness "
        "of reference.txt. Check the reference transcription "
        "and test multiple documents before drawing conclusions "
        "about general Kannada OCR accuracy."
    )


if __name__ == "__main__":
    main()

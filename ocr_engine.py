
from collections import defaultdict
from typing import Any

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pytesseract import Output

from ocr_layout import reconstruct_reading_order


# Tesseract installation on your Windows laptop.
pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

OCR_LANGUAGES = "kan+eng"
SUPPORTED_PSM_MODES = (3, 4, 6)

SUPPORTED_STRATEGIES = (
    "original",
    "contrast",
    "grayscale",
    "threshold",
    "adaptive",
)


def _normalize_image(image: Image.Image) -> Image.Image:
    """Correct image orientation once and establish a consistent RGB image."""
    return ImageOps.exif_transpose(image).convert("RGB")


def preprocess_image(
    image: Image.Image,
    strategy: str,
) -> Image.Image:
    """
    Generate preprocessing variants without resizing or cropping.

    The input must already have normalized orientation. All variants
    preserve the same width and height so OCR boxes remain aligned.
    """
    image = image.convert("RGB")

    if strategy == "original":
        return image.copy()

    if strategy == "contrast":
        enhanced = ImageEnhance.Contrast(image).enhance(1.5)
        return ImageEnhance.Sharpness(enhanced).enhance(1.3)

    if strategy == "grayscale":
        grayscale = ImageOps.grayscale(image)
        grayscale = ImageEnhance.Contrast(grayscale).enhance(1.4)
        return grayscale.filter(ImageFilter.SHARPEN)

    if strategy == "threshold":
        grayscale = ImageOps.grayscale(image)
        grayscale = ImageEnhance.Contrast(grayscale).enhance(1.5)

        return grayscale.point(
            lambda pixel: 255 if pixel > 175 else 0
        )

    if strategy == "adaptive":
        grayscale = np.asarray(
            ImageOps.grayscale(image),
            dtype=np.uint8,
        )

        height, width = grayscale.shape

        if min(height, width) < 11:
            raise ValueError(
                "Image is too small for adaptive thresholding."
            )

        # Adaptive thresholding requires an odd block size greater than 1.
        block_size = min(31, min(height, width))

        if block_size % 2 == 0:
            block_size -= 1

        block_size = max(11, block_size)

        thresholded = cv2.adaptiveThreshold(
            grayscale,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            block_size,
            11,
        )

        return Image.fromarray(thresholded)

    raise ValueError(
        f"Unsupported preprocessing strategy: {strategy}"
    )


def _to_int(value: Any, default: int = 0) -> int:
    """Safely convert OCR metadata to an integer."""
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def _is_valid_confidence(value: Any) -> bool:
    """Return whether a confidence value is finite and non-negative."""
    try:
        confidence = float(value)
        return bool(np.isfinite(confidence) and confidence >= 0)
    except (TypeError, ValueError, OverflowError):
        return False


def _build_raw_tesseract_text(
    words: list[dict[str, Any]],
) -> str:
    """
    Rebuild the baseline text using Tesseract's original line metadata.

    Words are grouped by their original block, paragraph and line IDs.
    Within each line, Tesseract's word_num determines word order.

    This function deliberately does not use custom geometric grouping.
    """
    lines: dict[
        tuple[int, int, int],
        list[dict[str, Any]],
    ] = defaultdict(list)

    for word in words:
        key = (
            _to_int(word.get("block_num")),
            _to_int(word.get("par_num")),
            _to_int(word.get("line_num")),
        )
        lines[key].append(word)

    raw_lines = []

    for line_words in lines.values():
        ordered_line_words = sorted(
            line_words,
            key=lambda word: _to_int(word.get("word_num")),
        )

        line_text = " ".join(
            str(word.get("text", "")).strip()
            for word in ordered_line_words
            if str(word.get("text", "")).strip()
        )

        if line_text:
            raw_lines.append(line_text)

    return "\n".join(raw_lines)


def _run_candidate(
    image: Image.Image,
    psm: int,
    strategy: str,
) -> dict[str, Any]:
    """
    Run one Tesseract configuration.

    Both the original Tesseract reading order and custom reconstructed
    reading order are retained for benchmarking.

    Word bounding boxes remain in the normalized input image's
    coordinate system.
    """
    prepared = preprocess_image(image, strategy)

    raw = pytesseract.image_to_data(
        prepared,
        lang=OCR_LANGUAGES,
        config=f"--oem 1 --psm {psm}",
        output_type=Output.DICT,
    )

    words: list[dict[str, Any]] = []

    for index, raw_word_text in enumerate(raw["text"]):
        text = str(raw_word_text).strip()

        if not text:
            continue

        try:
            confidence = float(raw["conf"][index])
        except (TypeError, ValueError, OverflowError):
            continue

        # Tesseract uses negative confidence for non-word entries.
        if not np.isfinite(confidence) or confidence < 0:
            continue

        words.append(
            {
                "text": text,
                "confidence": confidence,
                "box": {
                    "x": _to_int(raw["left"][index]),
                    "y": _to_int(raw["top"][index]),
                    "width": _to_int(raw["width"][index]),
                    "height": _to_int(raw["height"][index]),
                },
                "block_num": _to_int(raw["block_num"][index]),
                "par_num": _to_int(raw["par_num"][index]),
                "line_num": _to_int(raw["line_num"][index]),
                "word_num": _to_int(raw["word_num"][index]),
            }
        )

    # ---------------------------------------------------------
    # Baseline: preserve the words BEFORE custom layout runs.
    # ---------------------------------------------------------
    raw_words = [dict(word) for word in words]
    raw_text = _build_raw_tesseract_text(raw_words)

    # ---------------------------------------------------------
    # Proposed system: apply our custom reading-order algorithm.
    # reconstruct_reading_order returns reordered word copies.
    # ---------------------------------------------------------
    layout = reconstruct_reading_order(words)

    confidence_values = [
        float(word["confidence"])
        for word in layout["words"]
        if _is_valid_confidence(word.get("confidence"))
    ]

    average_confidence = (
        sum(confidence_values) / len(confidence_values)
        if confidence_values
        else 0.0
    )

    # Baseline heuristic, not a measurement of text accuracy.
    score = (
        average_confidence
        + min(len(layout["words"]), 1000) * 0.01
    )

    return {
        "psm": psm,
        "preprocessing": strategy,
        "score": round(score, 3),
        "average_confidence": round(average_confidence, 2),
        "word_count": len(layout["words"]),

        # Internal benchmark fields.
        "raw_text": raw_text,
        "raw_words": raw_words,

        # Custom-layout fields used by the application.
        "text": layout["text"],
        "lines": layout["lines"],
        "words": layout["words"],
    }


def extract_with_candidates(
    image: Image.Image,
    psm_modes: tuple[int, ...] = SUPPORTED_PSM_MODES,
    strategies: tuple[str, ...] = SUPPORTED_STRATEGIES,
) -> dict[str, Any]:
    """
    Evaluate multiple PSM/preprocessing combinations and select a result.

    Orientation is corrected once before OCR. No candidate resizes or
    crops the image, preserving alignment between dimensions and boxes.

    Candidate selection remains confidence-based for compatibility.
    Internal raw OCR fields are not exposed in the application response.
    """
    if image.width <= 0 or image.height <= 0:
        raise ValueError("Image dimensions must be positive.")

    if not psm_modes or any(
        mode not in SUPPORTED_PSM_MODES for mode in psm_modes
    ):
        raise ValueError(
            f"Supported PSM modes are {SUPPORTED_PSM_MODES}."
        )

    if not strategies:
        raise ValueError(
            "At least one preprocessing strategy is required."
        )

    invalid_strategies = [
        strategy
        for strategy in strategies
        if strategy not in SUPPORTED_STRATEGIES
    ]

    if invalid_strategies:
        raise ValueError(
            f"Unsupported preprocessing strategies: {invalid_strategies}"
        )

    # Normalize orientation once for all candidates.
    normalized_image = _normalize_image(image)

    candidates: list[dict[str, Any]] = []

    for strategy in strategies:
        for psm in psm_modes:
            candidate = _run_candidate(
                image=normalized_image,
                psm=psm,
                strategy=strategy,
            )
            candidates.append(candidate)

    if not candidates:
        raise ValueError("No OCR candidates were generated.")

    # Deterministic tie-break: first candidate wins equal scores.
    best = max(
        candidates,
        key=lambda candidate: candidate["score"],
    )

    # Preserve the existing application-facing response structure.
    return {
        "filename": None,
        "image_width": normalized_image.width,
        "image_height": normalized_image.height,
        "language": OCR_LANGUAGES,
        "selection_method": "heuristic_confidence_score",
        "selected_candidate": {
            "psm": best["psm"],
            "preprocessing": best["preprocessing"],
            "score": best["score"],
            "average_confidence": best["average_confidence"],
        },
        "candidate_summary": [
            {
                "psm": candidate["psm"],
                "preprocessing": candidate["preprocessing"],
                "score": candidate["score"],
                "average_confidence": candidate["average_confidence"],
                "word_count": candidate["word_count"],
            }
            for candidate in candidates
        ],
        "word_count": best["word_count"],
        "extracted_text": best["text"],
        "lines": best["lines"],
        "words": best["words"],
    }

"""
Isolated OCR experiments for LipiQ.

This module is experimental only. It does not modify or replace the
production pipeline in main.py, and it does not modify ocr_engine.py
or ocr_layout.py. It reuses their building blocks so that experimental
results remain comparable with the existing benchmarks.

Design rules:
- Every preprocessing variant preserves the original image dimensions
  as far as the OCR engine is concerned, or maps bounding boxes back to
  the original coordinate system. This keeps evidence highlighting and
  word boxes compatible with LipiQ's API contract.
- Raw Tesseract text (TSV grouping/order) and custom reconstructed
  reading order are returned separately.
- No text is corrected, invented, or dropped here.
"""

from __future__ import annotations

import shutil
import sys
import time
from pathlib import Path
from typing import Any

# Allow this module to be run from the project root or imported directly.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageFilter, ImageOps
from pytesseract import Output

from ocr_engine import (
    OCR_LANGUAGES,
    SUPPORTED_PSM_MODES,
    _build_raw_tesseract_text,
    _run_candidate,
    _to_int,
    preprocess_image,
)
from ocr_layout import reconstruct_reading_order


# Lightweight variants chosen from the observed failure modes on the
# single labeled document (712x887 scan, thin Kannada strokes):
#
# upscale2x        - the source is small; 2x LANCZOS gives Tesseract more
#                    pixels per matra without changing the document.
# grayscale_clahe  - uneven scan illumination; CLAHE lifts thin strokes
#                    without the hard clipping of a fixed threshold.
# otsu             - the existing fixed threshold (175) may be too harsh;
#                    Otsu chooses the cut point from the histogram.
# denoise_sharpen  - light median + unsharp mask only; deliberately mild
#                    so that vowel signs are not erased.
EXPERIMENTAL_PREPROCESSING = (
    "upscale2x",
    "grayscale_clahe",
    "otsu",
    "denoise_sharpen",
)

# Baselines use the existing production-experiment strategies unchanged.
BASELINE_PREPROCESSING = (
    "original",
    "contrast",
    "grayscale",
    "threshold",
    "adaptive",
)

DEFAULT_PSM_MODES = SUPPORTED_PSM_MODES

TESSERACT_FALLBACK_PATH = Path(
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)


def ensure_tesseract() -> str:
    """
    Resolve a usable Tesseract executable without changing project files.

    Prefers an already configured path, then PATH, then the known
    Windows installation location. Raises a clear error if none work.
    """
    candidates = [
        pytesseract.pytesseract.tesseract_cmd,
        shutil.which("tesseract"),
        str(TESSERACT_FALLBACK_PATH),
    ]

    for candidate in candidates:
        if not candidate:
            continue
        if candidate == "tesseract":
            continue
        if Path(candidate).exists():
            pytesseract.pytesseract.tesseract_cmd = candidate
            return candidate

    raise RuntimeError(
        "Tesseract executable not found. Install it or set "
        "pytesseract.pytesseract.tesseract_cmd explicitly."
    )


def load_image(path: Path) -> Image.Image:
    """Load and normalize an image exactly as the baseline scripts do."""
    with Image.open(path) as source:
        return ImageOps.exif_transpose(source).convert("RGB")


def _clahe(image: Image.Image) -> Image.Image:
    """Grayscale + CLAHE to lift thin strokes under uneven lighting."""
    gray = np.asarray(
        ImageOps.grayscale(image),
        dtype=np.uint8,
    )
    clahe = cv2.createCLAHE(
        clipLimit=2.0,
        tileGridSize=(8, 8),
    )
    return Image.fromarray(clahe.apply(gray))


def _otsu(image: Image.Image) -> Image.Image:
    """Global Otsu binarization as an alternative to the fixed threshold."""
    gray = np.asarray(
        ImageOps.grayscale(image),
        dtype=np.uint8,
    )
    _, thresholded = cv2.threshold(
        gray,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )
    return Image.fromarray(thresholded)


def _denoise_sharpen(image: Image.Image) -> Image.Image:
    """
    Mild denoise + unsharp mask.

    A 3-pixel median removes isolated scanner noise while keeping the
    stroke width; unsharp masking then restores local contrast.
    """
    gray = ImageOps.grayscale(image)
    denoised = gray.filter(ImageFilter.MedianFilter(size=3))
    return denoised.filter(
        ImageFilter.UnsharpMask(
            radius=1.5,
            percent=150,
            threshold=3,
        )
    )


def preprocess_experimental(
    image: Image.Image,
    strategy: str,
) -> tuple[Image.Image, float, float]:
    """
    Apply one experimental preprocessing variant.

    Returns (prepared_image, scale_x, scale_y) where scale_x/scale_y
    convert prepared-image coordinates back to the original image.
    """
    image = image.convert("RGB")

    if strategy == "upscale2x":
        prepared = image.resize(
            (image.width * 2, image.height * 2),
            Image.Resampling.LANCZOS,
        )
        return prepared, 0.5, 0.5

    if strategy == "grayscale_clahe":
        return _clahe(image), 1.0, 1.0

    if strategy == "otsu":
        return _otsu(image), 1.0, 1.0

    if strategy == "denoise_sharpen":
        return _denoise_sharpen(image), 1.0, 1.0

    raise ValueError(
        f"Unsupported experimental preprocessing: {strategy}"
    )


def _extract_words(
    prepared: Image.Image,
    psm: int,
    scale_x: float,
    scale_y: float,
) -> list[dict[str, Any]]:
    """
    Run Tesseract once and return word records in original coordinates.

    This mirrors ocr_engine._run_candidate's word extraction so the two
    result sets are directly comparable.
    """
    raw = pytesseract.image_to_data(
        prepared,
        lang=OCR_LANGUAGES,
        config=f"--oem 1 --psm {psm}",
        output_type=Output.DICT,
    )

    words: list[dict[str, Any]] = []

    for index, raw_text in enumerate(raw["text"]):
        text = str(raw_text).strip()

        if not text:
            continue

        try:
            confidence = float(raw["conf"][index])
        except (TypeError, ValueError, OverflowError):
            continue

        # Tesseract uses negative confidence for non-word entries.
        if not np.isfinite(confidence) or confidence < 0:
            continue

        left = _to_int(raw["left"][index])
        top = _to_int(raw["top"][index])
        width = _to_int(raw["width"][index])
        height = _to_int(raw["height"][index])

        words.append(
            {
                "text": text,
                "confidence": confidence,
                "box": {
                    "x": int(round(left * scale_x)),
                    "y": int(round(top * scale_y)),
                    "width": max(0, int(round(width * scale_x))),
                    "height": max(0, int(round(height * scale_y))),
                },
                "block_num": _to_int(raw["block_num"][index]),
                "par_num": _to_int(raw["par_num"][index]),
                "line_num": _to_int(raw["line_num"][index]),
                "word_num": _to_int(raw["word_num"][index]),
            }
        )

    return words


def run_experimental_candidate(
    image: Image.Image,
    psm: int,
    preprocessing: str,
) -> dict[str, Any]:
    """
    Run one experimental preprocessing + PSM configuration.

    Returns the same text/word keys as ocr_engine._run_candidate, plus
    elapsed_seconds. Word boxes are in the original image coordinates.
    """
    started = time.perf_counter()

    prepared, scale_x, scale_y = preprocess_experimental(
        image,
        preprocessing,
    )

    words = _extract_words(
        prepared,
        psm,
        scale_x,
        scale_y,
    )

    raw_words = [dict(word) for word in words]
    raw_text = _build_raw_tesseract_text(raw_words)

    layout = reconstruct_reading_order(words)

    elapsed = time.perf_counter() - started

    return {
        "psm": psm,
        "preprocessing": preprocessing,
        "raw_text": raw_text,
        "text": layout["text"],
        "raw_words": raw_words,
        "words": layout["words"],
        "lines": layout["lines"],
        "word_count": len(layout["words"]),
        "elapsed_seconds": elapsed,
    }


def run_baseline_candidate(
    image: Image.Image,
    psm: int,
    preprocessing: str,
) -> dict[str, Any]:
    """
    Run one existing (production-experiment) configuration unchanged.

    This is the exact code path used by evaluate_ocr.py and
    layout_ab_benchmark.py, wrapped with timing.
    """
    started = time.perf_counter()

    candidate = _run_candidate(
        image=image,
        psm=psm,
        strategy=preprocessing,
    )

    elapsed = time.perf_counter() - started

    return {
        **candidate,
        "elapsed_seconds": elapsed,
    }


def baseline_configurations() -> list[tuple[int, str]]:
    """All configurations already benchmarked in the project."""
    return [
        (psm, strategy)
        for strategy in BASELINE_PREPROCESSING
        for psm in DEFAULT_PSM_MODES
    ]


def experimental_configurations() -> list[tuple[int, str]]:
    """Configurations added by this experiment set."""
    return [
        (psm, strategy)
        for strategy in EXPERIMENTAL_PREPROCESSING
        for psm in DEFAULT_PSM_MODES
    ]


__all__ = [
    "BASELINE_PREPROCESSING",
    "DEFAULT_PSM_MODES",
    "EXPERIMENTAL_PREPROCESSING",
    "PROJECT_ROOT",
    "baseline_configurations",
    "ensure_tesseract",
    "experimental_configurations",
    "load_image",
    "preprocess_experimental",
    "preprocess_image",
    "run_baseline_candidate",
    "run_experimental_candidate",
]

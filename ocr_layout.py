
from __future__ import annotations

from statistics import median
from typing import Any


Box = dict[str, int]
Word = dict[str, Any]
Line = dict[str, Any]


def _get_box(word: Word) -> Box | None:
    """Return a validated x/y/width/height box."""
    raw = word.get("box", word.get("bbox"))

    if not isinstance(raw, dict):
        return None

    try:
        x = int(raw.get("x", raw.get("left")))
        y = int(raw.get("y", raw.get("top")))
        width = int(raw.get("width", raw.get("w")))
        height = int(raw.get("height", raw.get("h")))
    except (TypeError, ValueError):
        return None

    if width <= 0 or height <= 0:
        return None

    return {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
    }


def _vertical_overlap_ratio(a: Box, b: Box) -> float:
    """Measure vertical overlap relative to the shorter box."""
    a_bottom = a["y"] + a["height"]
    b_bottom = b["y"] + b["height"]

    overlap = max(
        0,
        min(a_bottom, b_bottom) - max(a["y"], b["y"]),
    )

    return overlap / min(a["height"], b["height"])


def _line_geometry(words: list[Word]) -> Box:
    """Calculate the enclosing box for a group of words."""
    boxes = [_get_box(word) for word in words]
    valid_boxes = [box for box in boxes if box is not None]

    left = min(box["x"] for box in valid_boxes)
    top = min(box["y"] for box in valid_boxes)
    right = max(
        box["x"] + box["width"] for box in valid_boxes
    )
    bottom = max(
        box["y"] + box["height"] for box in valid_boxes
    )

    return {
        "x": left,
        "y": top,
        "width": right - left,
        "height": bottom - top,
    }


def _line_center_y(line: Line) -> float:
    box = line["box"]
    return box["y"] + box["height"] / 2


def _can_join_line(
    word_box: Box,
    line: Line,
    overlap_threshold: float = 0.35,
    center_tolerance: float = 0.45,
) -> tuple[bool, float]:
    """
    Decide whether a word belongs to an existing line.

    Tolerances are relative to word height, not fixed pixels.
    """
    line_box = line["box"]

    word_center = word_box["y"] + word_box["height"] / 2
    line_center = _line_center_y(line)

    reference_height = median(
        [
            word_box["height"],
            line_box["height"],
        ]
    )

    center_distance = abs(word_center - line_center)
    overlap = _vertical_overlap_ratio(word_box, line_box)

    if (
        overlap < overlap_threshold
        and center_distance > center_tolerance * reference_height
    ):
        return False, 0.0

    # Prefer strong vertical overlap and close center alignment.
    overlap_score = overlap
    alignment_score = max(
        0.0,
        1.0 - center_distance / max(reference_height, 1),
    )

    return True, overlap_score + alignment_score


def _build_lines(words: list[Word]) -> list[Line]:
    """Cluster positioned words into lines using geometry."""
    positioned: list[tuple[Word, Box]] = []
    unpositioned: list[Word] = []

    for word in words:
        box = _get_box(word)

        if box is None:
            unpositioned.append(word)
        else:
            positioned.append((word, box))

    # Process nearby vertical positions first, then left to right.
    positioned.sort(
        key=lambda item: (
            item[1]["y"] + item[1]["height"] / 2,
            item[1]["x"],
        )
    )

    lines: list[Line] = []

    for word, box in positioned:
        best_line: Line | None = None
        best_score = -1.0

        for line in lines:
            compatible, score = _can_join_line(box, line)

            if compatible and score > best_score:
                best_line = line
                best_score = score

        if best_line is None:
            lines.append({
                "words": [word],
                "box": dict(box),
            })
        else:
            best_line["words"].append(word)
            best_line["box"] = _line_geometry(best_line["words"])

    # Recalculate geometry and word order after clustering.
    for line in lines:
        line["words"].sort(
            key=lambda word: (
                _get_box(word)["x"],
                _get_box(word)["y"],
            )
        )
        line["box"] = _line_geometry(line["words"])

    # Top-to-bottom order for the current single-column use case.
    lines.sort(
        key=lambda line: (
            _line_center_y(line),
            line["box"]["x"],
        )
    )

    # Preserve unpositioned records rather than silently dropping them.
    for word in unpositioned:
        text = str(word.get("text", "")).strip()

        if text:
            lines.append({
                "words": [word],
                "box": {
                    "x": 0,
                    "y": 0,
                    "width": 0,
                    "height": 0,
                },
                "unpositioned": True,
            })

    result: list[Line] = []

    for line in lines:
        line_words = line["words"]
        first_word = line_words[0]

        record: Line = {
            "block_num": first_word.get("block_num", 0),
            "par_num": first_word.get("par_num", 0),
            "line_num": first_word.get("line_num", 0),
            "text": " ".join(
                str(word.get("text", "")).strip()
                for word in line_words
                if str(word.get("text", "")).strip()
            ),
            "words": line_words,
            "box": line["box"],
        }

        if line.get("unpositioned"):
            record["unpositioned"] = True

        result.append(record)

    return result


def reconstruct_reading_order(
    words: list[Word],
) -> dict[str, Any]:
    """
    Reconstruct OCR lines from word geometry.

    Output keys and word bounding boxes remain compatible with LipiQ.
    Designed initially for single-column documents.
    """
    if not words:
        return {
            "words": [],
            "lines": [],
            "text": "",
        }

    # Copy dictionaries so layout processing does not mutate input words.
    copied_words = [dict(word) for word in words]
    lines = _build_lines(copied_words)

    ordered_words = [
        word
        for line in lines
        for word in line["words"]
    ]

    text = "\n".join(
        line["text"]
        for line in lines
        if line["text"]
    )

    return {
        "words": ordered_words,
        "lines": lines,
        "text": text,
    }

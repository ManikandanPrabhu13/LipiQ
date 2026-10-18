
import json
import re
import unicodedata
from pathlib import Path


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

JSON_PATH = Path(__file__).parent / "ocr_output.json"


# --------------------------------------------------
# TEXT NORMALIZATION
# --------------------------------------------------

def normalize(text):
    """Normalize Unicode and remove punctuation for matching."""
    text = unicodedata.normalize("NFC", text).casefold()
    return re.sub(r"[^\w]", "", text, flags=re.UNICODE)


# --------------------------------------------------
# EVIDENCE MATCHING
# --------------------------------------------------

def find_evidence(quote, words):
    """
    Find an exact sequence of consecutive OCR words on
    the same line.

    Returns:
        - matched text
        - individual word boxes and confidence scores
        - combined highlight rectangle
    """
    target = [normalize(token) for token in quote.split()]
    target = [token for token in target if token]

    if not target:
        return None

    # Group OCR words by line, preserving their input order.
    lines = {}

    for word in words:
        text = word.get("text", "").strip()
        box = word.get("box", {})

        if not text:
            continue

        required = ("x", "y", "width", "height")

        if not all(key in box for key in required):
            continue

        line_key = (
            word.get("block_num", 0),
            word.get("par_num", 0),
            word.get("line_num", 0),
        )

        lines.setdefault(line_key, []).append(word)

    # Search for consecutive words within each line.
    for line_words in lines.values():
        normalized_words = [
            normalize(word["text"]) for word in line_words
        ]

        for start in range(len(line_words) - len(target) + 1):
            candidate = normalized_words[
                start:start + len(target)
            ]

            if candidate != target:
                continue

            matched = line_words[
                start:start + len(target)
            ]

            # Preserve individual boxes and OCR confidence.
            boxes = []

            for word in matched:
                original_box = word["box"]

                boxes.append({
                    "text": word["text"],
                    "confidence": word.get("confidence", -1),
                    "x": original_box["x"],
                    "y": original_box["y"],
                    "width": original_box["width"],
                    "height": original_box["height"],
                })

            # Calculate one rectangle covering all matched words.
            left = min(box["x"] for box in boxes)
            top = min(box["y"] for box in boxes)

            right = max(
                box["x"] + box["width"]
                for box in boxes
            )

            bottom = max(
                box["y"] + box["height"]
                for box in boxes
            )

            return {
                "matched_text": " ".join(
                    word["text"] for word in matched
                ),
                "boxes": boxes,
                "highlight_box": {
                    "x": left,
                    "y": top,
                    "width": right - left,
                    "height": bottom - top,
                },
            }

    return None


# --------------------------------------------------
# TEST RUNNER
# --------------------------------------------------

def main():
    if not JSON_PATH.exists():
        print("ERROR: ocr_output.json was not found.")
        print("Expected location:", JSON_PATH)
        return

    try:
        with JSON_PATH.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except json.JSONDecodeError as error:
        print("ERROR: The JSON file is invalid.")
        print(error)
        return

    words = data.get("words", [])

    quote = "ಅತೀ ಜರೂರು ಪತ್ರ"

    result = find_evidence(quote, words)

    print("=" * 50)
    print("LIPIQ - EVIDENCE MATCH TEST")
    print("=" * 50)

    print("Original image:", data.get("filename"))
    print(
        "Image size:",
        data.get("image_width"),
        "x",
        data.get("image_height"),
    )
    print("Search quote:", quote)

    if result is None:
        print("\nNO MATCH FOUND")
        print(
            "Check the OCR spelling or try a shorter "
            "quote copied from the OCR output."
        )
        return

    # Include image dimensions for frontend positioning.
    result["image_size"] = {
        "width": data.get("image_width"),
        "height": data.get("image_height"),
    }

    print("\nMATCH FOUND!")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

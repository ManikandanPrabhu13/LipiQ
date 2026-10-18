
from pathlib import Path
from collections import defaultdict

from PIL import Image, ImageDraw

from ocr_engine import _run_candidate


BASE_DIR = Path(__file__).resolve().parent
IMAGE_PATH = BASE_DIR / "sample.png"
DEBUG_IMAGE_PATH = BASE_DIR / "ocr_layout_debug.png"
DEBUG_TEXT_PATH = BASE_DIR / "ocr_layout_debug.txt"


def get_box(item):
    """Read a bounding box from an OCR word or line record."""
    box = item.get("box", item.get("bbox", item))

    if isinstance(box, (list, tuple)) and len(box) >= 4:
        x, y, third, fourth = map(float, box[:4])

        # Assume the common x, y, width, height format.
        return (
            int(x),
            int(y),
            int(x + third),
            int(y + fourth),
        )

    if not isinstance(box, dict):
        return None

    x = box.get("x", box.get("left"))
    y = box.get("y", box.get("top"))
    width = box.get("w", box.get("width"))
    height = box.get("h", box.get("height"))

    if None not in (x, y, width, height):
        return (
            int(x),
            int(y),
            int(x + width),
            int(y + height),
        )

    x1 = box.get("x1")
    y1 = box.get("y1")
    x2 = box.get("x2")
    y2 = box.get("y2")

    if None not in (x1, y1, x2, y2):
        return tuple(map(int, (x1, y1, x2, y2)))

    return None


def make_lines_from_words(words):
    """Fallback: group OCR words into lines using Tesseract IDs."""
    groups = defaultdict(list)

    for word in words:
        key = (
            word.get("block_num", 0),
            word.get("par_num", 0),
            word.get("line_num", 0),
        )
        groups[key].append(word)

    lines = []

    for group_words in groups.values():
        positioned_words = []

        for word in group_words:
            box = get_box(word)
            if box:
                positioned_words.append((word, box))

        if not positioned_words:
            continue

        positioned_words.sort(key=lambda item: item[1][0])

        left = min(box[0] for _, box in positioned_words)
        top = min(box[1] for _, box in positioned_words)
        right = max(box[2] for _, box in positioned_words)
        bottom = max(box[3] for _, box in positioned_words)

        lines.append({
            "text": " ".join(
                str(word.get("text", ""))
                for word, _ in positioned_words
                if word.get("text")
            ),
            "box": {
                "x": left,
                "y": top,
                "w": right - left,
                "h": bottom - top,
            },
        })

    return sorted(
        lines,
        key=lambda line: (
            get_box(line)[1],
            get_box(line)[0],
        ),
    )


def main():
    if not IMAGE_PATH.exists():
        raise FileNotFoundError(
            f"Sample image not found: {IMAGE_PATH}"
        )

    print("Loading sample image...")

    with Image.open(IMAGE_PATH) as source:
        image = source.convert("RGB")

    print("Running OCR using PSM 6 + original image...")

    result = _run_candidate(
        image=image,
        psm=6 ,
        strategy="contrast",
    )

    words = result.get("words", [])
    lines = result.get("lines", [])

    if not lines:
        lines = make_lines_from_words(words)

    if not lines:
        raise RuntimeError(
            "No OCR lines or word boxes were returned. "
            "Check the result structure in ocr_engine.py."
        )

    # Draw word boxes in blue and line boxes in red.
    canvas = image.copy()
    draw = ImageDraw.Draw(canvas)

    for word in words:
        box = get_box(word)

        if box:
            draw.rectangle(box, outline="deepskyblue", width=1)

    with DEBUG_TEXT_PATH.open("w", encoding="utf-8") as file:
        file.write("LIPIQ OCR READING-ORDER DEBUG\n")
        file.write("Configuration: PSM 6 + original image\n\n")

        for index, line in enumerate(lines, start=1):
            box = get_box(line)
            text = str(line.get("text", "")).strip()

            if box:
                left, top, right, bottom = box

                draw.rectangle(
                    box,
                    outline="red",
                    width=2,
                )

                label_y = max(0, top - 18)

                draw.text(
                    (left, label_y),
                    f"L{index}",
                    fill="red",
                )

            file.write(
                f"L{index:02d}: {text}\n"
                f"     BOX: {box}\n\n"
            )

    canvas.save(DEBUG_IMAGE_PATH)

    print(f"\nDetected words: {len(words)}")
    print(f"Detected lines: {len(lines)}")
    print(f"Debug image saved: {DEBUG_IMAGE_PATH}")
    print(f"Line report saved: {DEBUG_TEXT_PATH}")
    print("\nOpen ocr_layout_debug.png and inspect the numbered lines.")


if __name__ == "__main__":
    main()


import json
from pathlib import Path
from collections import defaultdict

# Load the OCR output
json_path = Path(__file__).parent / "ocr_output.json"

with json_path.open("r", encoding="utf-8") as file:
    data = json.load(file)

words = data.get("words", [])

print("=" * 50)
print("LIPIQ - OCR JSON VALIDATION")
print("=" * 50)

print("Filename:", data.get("filename"))
print(
    "Image size:",
    data.get("image_width"),
    "x",
    data.get("image_height")
)
print("Words detected:", len(words))

# Validate word entries and group them by OCR line
lines = defaultdict(list)
valid_count = 0
low_confidence = []

for word in words:
    text = word.get("text", "").strip()
    confidence = word.get("confidence", -1)
    box = word.get("box", {})

    if not text or not isinstance(box, dict):
        continue

    required = ("x", "y", "width", "height")
    if not all(key in box for key in required):
        continue

    valid_count += 1

    line_key = (
        word.get("block_num", 0),
        word.get("par_num", 0),
        word.get("line_num", 0),
    )
    lines[line_key].append(text)

    try:
        if 0 <= float(confidence) < 60:
            low_confidence.append((text, confidence))
    except (TypeError, ValueError):
        pass

print("Valid word entries:", valid_count)
print("Lines detected:", len(lines))
print("Words with confidence below 60:", len(low_confidence))

print("\n--- RECONSTRUCTED OCR TEXT (first 15 lines) ---")
for index, line_words in enumerate(lines.values()):
    if index >= 15:
        break
    print(" ".join(line_words))

print("\n--- LOW-CONFIDENCE WORDS (first 15) ---")
for text, confidence in low_confidence[:15]:
    print(f"{text} | confidence: {confidence}")

print("\nValidation complete.")

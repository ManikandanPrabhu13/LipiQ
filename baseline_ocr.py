
import json
from pathlib import Path

import pytesseract
from PIL import Image
from pytesseract import Output

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

image_path = Path("sample_kannada.jpg")
image = Image.open(image_path).convert("RGB")

data = pytesseract.image_to_data(
    image,
    lang="kan+eng",
    config="--oem 1 --psm 3",
    output_type=Output.DICT,
)

words = []

for i, raw_text in enumerate(data["text"]):
    text = raw_text.strip()

    try:
        confidence = float(data["conf"][i])
    except (ValueError, TypeError):
        confidence = -1.0

    # Skip empty entries and entries without a usable confidence score.
    if not text or confidence < 0:
        continue

    words.append({
        "text": text,
        "confidence": confidence,
        "box": {
            "x": data["left"][i],
            "y": data["top"][i],
            "width": data["width"][i],
            "height": data["height"][i],
        },
        "block_num": data["block_num"][i],
        "par_num": data["par_num"][i],
        "line_num": data["line_num"][i],
    })

result = {
    "source": image_path.name,
    "image_width": image.width,
    "image_height": image.height,
    "language": "kan+eng",
    "psm": 3,
    "words": words,
}

output_path = Path("ocr_result.json")
output_path.write_text(
    json.dumps(result, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print(f"Image size: {image.width} x {image.height}")
print(f"Recognized word entries: {len(words)}")
print(f"Saved OCR data to: {output_path.resolve()}")
print("\nFirst 10 word entries:")
print(json.dumps(words[:10], ensure_ascii=False, indent=2))

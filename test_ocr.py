
import pytesseract
from pytesseract import Output
from PIL import Image
from pathlib import Path

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

image_path = Path("sample_kannada.jpg")

if not image_path.exists():
    raise FileNotFoundError(
        "Place sample_kannada.png in the LipiQ project folder."
    )

image = Image.open(image_path).convert("RGB")

# Recognize Kannada and English text
data = pytesseract.image_to_data(
    image,
    lang="kan+eng",
    config="--oem 1 --psm 6",
    output_type=Output.DICT,
)

print("\n========== LIPIQ OCR OUTPUT ==========\n")

words = []

for i, raw_text in enumerate(data["text"]):
    word = raw_text.strip()

    try:
        confidence = float(data["conf"][i])
    except (ValueError, TypeError):
        continue

    if word and confidence >= 0:
        x = data["left"][i]
        y = data["top"][i]
        width = data["width"][i]
        height = data["height"][i]

        words.append({
            "text": word,
            "confidence": round(confidence, 2),
            "box": [x, y, width, height],
        })

for word in words:
    print(word)

print(f"\nTotal recognized words: {len(words)}")

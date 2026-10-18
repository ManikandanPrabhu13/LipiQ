
import cv2
import pytesseract
from pathlib import Path

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

image_path = Path("sample_kannada.jpg")

if not image_path.exists():
    raise FileNotFoundError(f"Image not found: {image_path}")

original = cv2.imread(str(image_path))

if original is None:
    raise ValueError("Could not open the image.")

# Create an enlarged grayscale version.
gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)
enlarged = cv2.resize(
    gray,
    None,
    fx=2,
    fy=2,
    interpolation=cv2.INTER_CUBIC,
)

# Apply mild sharpening.
blurred = cv2.GaussianBlur(enlarged, (0, 0), 1.0)
sharpened = cv2.addWeighted(enlarged, 1.5, blurred, -0.5, 0)

# Save the processed image for inspection.
cv2.imwrite("sample_preprocessed.png", sharpened)

config = "--oem 1 --psm 6"

for label, image in [
    ("ORIGINAL", original),
    ("ENLARGED + SHARPENED", sharpened),
]:
    text = pytesseract.image_to_string(
        image,
        lang="kan+eng",
        config=config,
    )

    print(f"\n========== {label} ==========\n")
    print(text)


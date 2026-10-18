
import cv2
import pytesseract
from pathlib import Path

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

image = cv2.imread("sample_kannada.jpg")

if image is None:
    raise FileNotFoundError("Check sample_kannada.jpg.")

height, width = image.shape[:2]
print(f"Image dimensions: {width} x {height}")

# Crop out the noisy page margins.
# These ratios work as an initial experiment for this sample,
# not as universal coordinates for every document.
left = int(width * 0.10)
right = int(width * 0.94)
top = int(height * 0.25)
bottom = int(height * 0.94)

body = image[top:bottom, left:right]
cv2.imwrite("sample_body_crop.png", body)

for name, region in [
    ("FULL PAGE", image),
    ("BODY CROP", body),
]:
    text = pytesseract.image_to_string(
        region,
        lang="kan+eng",
        config="--oem 1 --psm 6",
    )

    print(f"\n========== {name} ==========\n")
    print(text)

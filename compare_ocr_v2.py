
import cv2
import pytesseract
from pathlib import Path

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

path = Path("sample_kannada.jpg")
original = cv2.imread(str(path))

if original is None:
    raise FileNotFoundError(
        f"Cannot open {path}. Check the filename and folder."
    )

gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)

# Option 1: Original image
original_test = original

# Option 2: Enlarge without sharpening
enlarged = cv2.resize(
    gray,
    None,
    fx=2,
    fy=2,
    interpolation=cv2.INTER_CUBIC,
)

# Option 3: Enlarge, then apply Otsu thresholding
_, otsu = cv2.threshold(
    enlarged,
    0,
    255,
    cv2.THRESH_BINARY + cv2.THRESH_OTSU,
)

cv2.imwrite("test_enlarged.png", enlarged)
cv2.imwrite("test_otsu.png", otsu)

tests = [
    ("ORIGINAL", original_test),
    ("ENLARGED ONLY", enlarged),
    ("ENLARGED + OTSU", otsu),
]

config = "--oem 1 --psm 6"

for name, image in tests:
    text = pytesseract.image_to_string(
        image,
        lang="kan+eng",
        config=config,
    )

    print(f"\n{'=' * 15} {name} {'=' * 15}")
    print(text)

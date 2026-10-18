
import pytesseract
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

image = Image.open("sample_kannada.jpg")

modes = {
    3: "Automatic page segmentation",
    6: "Single uniform text block",
    11: "Sparse text; find text in no particular order",
}

for psm, description in modes.items():
    print("\n" + "=" * 65)
    print(f"PSM {psm}: {description}")
    print("=" * 65)

    text = pytesseract.image_to_string(
        image,
        lang="kan+eng",
        config=f"--oem 1 --psm {psm}",
    )

    print(text)

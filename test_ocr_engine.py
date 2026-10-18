
from pathlib import Path

from PIL import Image
from ocr_engine import extract_with_candidates


# Put a test image named sample.png in the LipiQ project folder.
image_path = Path("sample.png")

if not image_path.exists():
    raise FileNotFoundError(
        "Place a test document image named sample.png "
        "in the LipiQ project folder."
    )

with Image.open(image_path) as source:
    image = source.convert("RGB")

result = extract_with_candidates(image)

print("Selected candidate:")
print(result["selected_candidate"])

print("\nCandidate comparison:")
for candidate in result["candidate_summary"]:
    print(candidate)

print("\nExtracted Kannada text:")
print(result["extracted_text"])

print("\nWord count:", result["word_count"])
print("OCR engine test completed.")

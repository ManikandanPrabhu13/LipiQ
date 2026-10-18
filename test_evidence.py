
import requests
from pathlib import Path

BASE_URL = "http://127.0.0.1:8000"
IMAGE_PATH = Path("sample_kannada.jpg")


def is_kannada(text):
    """Return True if the text contains at least one Kannada character."""
    return any("\u0C80" <= char <= "\u0CFF" for char in text)


def main():
    # STEP 1: Check the image
    if not IMAGE_PATH.exists():
        raise FileNotFoundError(
            f"Image not found: {IMAGE_PATH.resolve()}"
        )

    # STEP 2: Extract OCR using the existing API
    print("\n========== LIPIQ EVIDENCE TEST ==========\n")
    print("Step 1: Extracting text from the document...")

    with IMAGE_PATH.open("rb") as image:
        response = requests.post(
            f"{BASE_URL}/api/extract",
            files={
                "file": (
                    IMAGE_PATH.name,
                    image,
                    "image/jpeg"
                )
            },
            timeout=60
        )

    response.raise_for_status()
    ocr_data = response.json()

    words = ocr_data["words"]
    image_width = ocr_data["image_width"]
    image_height = ocr_data["image_height"]

    print("OCR extraction: SUCCESS")
    print("Total words:", len(words))
    print(f"Image dimensions: {image_width} x {image_height}")

    # STEP 3: Select a Kannada word instead of OCR noise
    print("\nStep 2: Selecting a Kannada word...")

    candidates = []

    for word in words:
        text = word.get("text", "").strip()

        try:
            confidence = float(word.get("confidence", -1))
        except (TypeError, ValueError):
            continue

        if (
            text
            and is_kannada(text)
            and confidence >= 60
            and word.get("box")
        ):
            candidates.append(word)

    if not candidates:
        print("No Kannada words with confidence >= 60 were found.")
        print("\nTry lowering the confidence threshold to 30.")
        return

    # Prefer the highest-confidence Kannada word
    candidates.sort(
        key=lambda word: float(word["confidence"]),
        reverse=True
    )

    selected_word = candidates[0]
    quote = selected_word["text"].strip()

    print("Candidate Kannada words:", len(candidates))
    print("Selected quote:", quote)
    print("OCR confidence:", selected_word["confidence"])

    # STEP 4: Ask the evidence API to locate the selected word
    print("\nStep 3: Finding evidence in OCR output...")

    evidence_payload = {
        "quote": quote,
        "words": words,
        "image_width": image_width,
        "image_height": image_height
    }

    evidence_response = requests.post(
        f"{BASE_URL}/api/evidence",
        json=evidence_payload,
        timeout=30
    )

    print("Evidence HTTP status:", evidence_response.status_code)
    evidence_response.raise_for_status()

    result = evidence_response.json()

    # STEP 5: Display the result
    print("\n========== EVIDENCE RESULT ==========")
    print("Found:", result.get("found"))
    print("Matched text:", result.get("matched_text"))
    print("Highlight box:", result.get("highlight_box"))
    print("Image size:", result.get("image_size"))

    if result.get("found"):
        print("\nSUCCESS: Real OCR word matched!")
        print("Evidence coordinates are ready for frontend highlighting.")
    else:
        print("\nEvidence was not found.")
        print(
            "The OCR word format or line grouping may differ "
            "from what the matcher expects."
        )


if __name__ == "__main__":
    try:
        main()
    except requests.exceptions.ConnectionError:
        print(
            "ERROR: Cannot connect to LipiQ API.\n"
            "Start the server with: uvicorn main:app --reload"
        )
    except requests.exceptions.HTTPError as error:
        print("API HTTP error:", error)
        if error.response is not None:
            print("Response:", error.response.text)
    except requests.exceptions.RequestException as error:
        print("Request error:", error)

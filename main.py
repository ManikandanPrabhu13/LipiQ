from io import BytesIO
from pathlib import Path

import pytesseract
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from pytesseract import Output

from evidence_match import find_evidence


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

app = FastAPI(
    title="LipiQ API",
    description="Kannada document OCR with evidence coordinates",
    version="0.3.0",
)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

SUPPORTED_PSM_MODES = {3, 4, 6}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# --------------------------------------------------
# REQUEST MODEL FOR EVIDENCE MATCHING
# --------------------------------------------------

class EvidenceRequest(BaseModel):
    quote: str = Field(min_length=1, max_length=1000)
    words: list[dict]
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)


# --------------------------------------------------
# HEALTH CHECK
# --------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "LipiQ OCR",
    }


# --------------------------------------------------
# OCR EXTRACTION
# --------------------------------------------------

@app.post("/api/extract")
async def extract_document(
    file: UploadFile = File(...),
    psm: int = Query(default=3),
):
    # Validate the requested page segmentation mode.
    if psm not in SUPPORTED_PSM_MODES:
        raise HTTPException(
            status_code=400,
            detail="Supported OCR modes are 3, 4, and 6.",
        )

    # Validate content type.
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Upload a JPG, PNG, or WebP image.",
        )

    # Read at most 10 MB plus one byte.
    content = await file.read(MAX_FILE_SIZE + 1)

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="File exceeds the 10 MB limit.",
        )

    if not content:
        raise HTTPException(
            status_code=400,
            detail="Empty file.",
        )

    # Decode the uploaded image safely.
    try:
        image = Image.open(BytesIO(content))
        image.load()
        image = image.convert("RGB")

    except (UnidentifiedImageError, OSError):
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid supported image.",
        )

    width, height = image.size

    # Run Kannada + English OCR using the selected mode.
    try:
        data = pytesseract.image_to_data(
            image,
            lang="kan+eng",
            config=f"--oem 1 --psm {psm}",
            output_type=Output.DICT,
        )

    except pytesseract.TesseractNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="Tesseract OCR executable was not found.",
        )

    except pytesseract.TesseractError as error:
        raise HTTPException(
            status_code=500,
            detail=f"OCR processing failed: {error}",
        )

    words = []

    for i, raw_text in enumerate(data["text"]):
        text = raw_text.strip()

        try:
            confidence = float(data["conf"][i])
        except (ValueError, TypeError):
            confidence = -1.0

        # Exclude empty entries and non-word entries.
        if not text or confidence < 0:
            continue

        words.append({
            "text": text,
            "confidence": confidence,
            "box": {
                "x": int(data["left"][i]),
                "y": int(data["top"][i]),
                "width": int(data["width"][i]),
                "height": int(data["height"][i]),
            },
            "block_num": int(data["block_num"][i]),
            "par_num": int(data["par_num"][i]),
            "line_num": int(data["line_num"][i]),
            "word_num": int(data["word_num"][i]),
        })

    # Tesseract normally emits words in its detected reading order.
    # Sort explicitly by its hierarchy, then by horizontal position.
    words.sort(
        key=lambda word: (
            word["block_num"],
            word["par_num"],
            word["line_num"],
            word["word_num"],
            word["box"]["x"],
        )
    )

    # Group words into lines for a structured text representation.
    grouped_lines = []
    line_lookup = {}

    for word in words:
        line_key = (
            word["block_num"],
            word["par_num"],
            word["line_num"],
        )

        if line_key not in line_lookup:
            line = {
                "block_num": word["block_num"],
                "par_num": word["par_num"],
                "line_num": word["line_num"],
                "text": "",
                "words": [],
            }
            line_lookup[line_key] = line
            grouped_lines.append(line)

        line_lookup[line_key]["words"].append(word)

    for line in grouped_lines:
        line["words"].sort(
            key=lambda word: (
                word["word_num"],
                word["box"]["x"],
            )
        )
        line["text"] = " ".join(
            word["text"] for word in line["words"]
        )

    # Keep a plain-text representation with line breaks.
    extracted_text = "\n".join(
        line["text"] for line in grouped_lines
    )

    return {
        "filename": Path(file.filename or "upload").name,
        "image_width": width,
        "image_height": height,
        "language": "kan+eng",
        "psm": psm,
        "word_count": len(words),
        "extracted_text": extracted_text,
        "lines": grouped_lines,
        "words": words,
    }


# --------------------------------------------------
# EVIDENCE MATCHING
# --------------------------------------------------

@app.post("/api/evidence")
def match_uploaded_evidence(request: EvidenceRequest):
    """
    Match an exact consecutive OCR quote and return
    individual word boxes and a combined highlight box.
    """

    result = find_evidence(
        request.quote,
        request.words,
    )

    if result is None:
        return {
            "found": False,
            "quote": request.quote,
            "message": (
                "No exact consecutive word match was found "
                "on a single OCR line."
            ),
        }

    return {
        "found": True,
        **result,
        "image_size": {
            "width": request.image_width,
            "height": request.image_height,
        },
    }

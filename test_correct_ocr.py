"""
Tests for the Smart OCR Correction endpoint (/api/correct-ocr).
Uses mocks for AI generation to ensure deterministic, offline test execution
without consuming credits.
"""
import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


# -------------------------------------------------------------
# Request model / validation
# -------------------------------------------------------------

def test_correct_ocr_empty_text():
    with patch("main.generate_ai", return_value={"answer": "", "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": ""})
        assert res.status_code in (400, 422)


def test_correct_ocr_valid_request_models_as_valid():
    text = "ಕರ್ನಾಟಕ ಸರ್ಕಾರ ಪ್ರಸ್ತಾವನೆ ಆಡಳಿತ."
    with patch("main.generate_ai", return_value={"answer": "", "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": text})
        assert res.status_code == 200


# -------------------------------------------------------------
# AI unavailable
# -------------------------------------------------------------

def test_correct_ocr_unavailable_returns_empty():
    with patch("main.generate_ai", side_effect=__import__("ai_service").AIUnavailableError("No AI configured")):
        res = client.post("/api/correct-ocr", json={"text": "Some text"})
        assert res.status_code == 200
        data = res.json()
        assert data["corrections"] == []
        assert data["total_suggestions"] == 0
        assert "unavailable" in data["message"].lower() or "correction" in data["message"].lower()


def test_correct_ocr_request_error_returns_empty():
    from ai_service import AIRequestError

    with patch("main.generate_ai", side_effect=AIRequestError("Rate limit")):
        res = client.post("/api/correct-ocr", json={"text": "Some text"})
        assert res.status_code == 200
        data = res.json()
        assert data["corrections"] == []


# -------------------------------------------------------------
# Valid correction response
# -------------------------------------------------------------

def test_correct_ocr_valid_correction_response():
    raw_answer = json.dumps({
        "original_text": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ",
        "corrections": [
            {
                "original": "ಸರ್ಕಾರ",
                "suggested": "ಸಂಸ್ಥೆ",
                "reason": "OCR likely misread ಸಂಸ್ಥೆಯ ದ್ವೀಪ",
                "confidence": "high",
                "status": "pending",
                "start": 15,
                "end": 24,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ ಪ್ರಸ್ತಾವನೆ"})
        assert res.status_code == 200
        data = res.json()
        assert len(data["corrections"]) == 1
        corr = data["corrections"][0]
        assert corr["original"] == "ಸರ್ಕಾರ"
        assert corr["suggested"] == "ಸಂಸ್ಥೆ"
        assert corr["reason"].startswith("OCR") or corr["reason"].startswith("led") or not corr["reason"]
        assert corr["confidence"] in ("low", "medium", "high")
        assert corr["status"] == "pending"
        assert isinstance(corr["start"], int) and isinstance(corr["end"], int)


def test_correct_ocr_full_schema_returned():
    raw_answer = json.dumps({
        "original_text": "ಕನ್ನಡ",
        "corrections": [
            {
                "original": "ಕನ್ನಡ",
                "suggested": "ಕನ್ನಡಕ",
                "reason": "ಅಚ್ಚಿದ್ದಕ್ಕೆ",
                "confidence": "medium",
                "status": "pending",
                "start": 0,
                "end": 3,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಕನ್ನಡ ಭಾಷೆ"})
        assert res.status_code == 200
        data = res.json()
        for key in ("original_text", "corrections", "total_suggestions", "message"):
            assert key in data


# -------------------------------------------------------------
# Protection rules
# -------------------------------------------------------------

def test_correct_ocr_protects_dates():
    raw_answer = json.dumps({
        "original_text": "ದಿನಾಂಕ 15-02-2014",
        "corrections": [
            {
                "original": "15-02-2014",
                "suggested": "15-02-2015",
                "reason": "fix date",
                "confidence": "high",
                "status": "pending",
                "start": 6,
                "end": 16,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ದಿನಾಂಕ 15-02-2014"})
        assert res.status_code == 200
        data = res.json()
        # Protected token should be rejected
        originals = [c["original"] for c in data["corrections"]]
        assert "15-02-2014" not in originals or all(
            c["original"] != "15-02-2014" or c.get("suggested") == c["original"]
            for c in data["corrections"]
        )
        # More precisely: the correction must NOT have changed the protected token
        protected = [c for c in data["corrections"] if c["original"] == "15-02-2014"]
        assert protected == [] or (len(protected) == 1 and protected[0]["suggested"] == "15-02-2014")


def test_correct_ocr_protects_numbers():
    raw_answer = json.dumps({
        "original_text": "ಎಂಬತ್ತು ಬೋರ್ಡರ್ಗಳು",
        "corrections": [
            {
                "original": "ಎಂಬತ್ತು",
                "suggested": "ಐವತ್ತು",
                "reason": "fix number",
                "confidence": "high",
                "status": "pending",
                "start": 0,
                "end": 4,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಎಂಬತ್ತು ಬೋರ್ಡರ್ಗಳು"})
        data = res.json()
        assert len(data["corrections"]) == 0  # pure number should be rejected


def test_correct_ocr_protects_phone_patterns():
    raw_answer = json.dumps({
        "original_text": "ಸಂಖ್ಯೆ 9876543210",
        "corrections": [
            {
                "original": "9876543210",
                "suggested": "9876543211",
                "reason": "fix number",
                "confidence": "high",
                "status": "pending",
                "start": 2,
                "end": 12,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಸಂಖ್ಯೆ 9876543210"})
        data = res.json()
        # Should have no corrections for pure numeric token
        assert len(data["corrections"]) == 0


# -------------------------------------------------------------
# Repeated word occurrences
# -------------------------------------------------------------

def test_correct_ocr_repeated_word_single_occurrence():
    raw_answer = json.dumps({
        "original_text": "ಸಹಕಾರ ಸಂಘ ಸಹಕಾರ ಸಂಘ ನಿತ್ಯ",
        "corrections": [
            {
                "original": "ಸಹಕಾರ",
                "suggested": "ಸಹಕಾರಿಸು",
                "reason": "multiple wrong",
                "confidence": "high",
                "status": "pending",
                "start": 14,
                "end": 22,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಸಹಕಾರ ಸಂಘ ಸಹಕಾರ ಸಂಘ ನಿತ್ಯ"})
        assert res.status_code == 200
        data = res.json()
        # Only one correction should be present (first occurrence)
        assert len(data["corrections"]) == 1
        assert data["corrections"][0]["original"] == "ಸಹಕಾರ"


def test_correct_ocr_repeated_words_no_positions_all_rejected():
    raw_answer = json.dumps({
        "original_text": "ಸಹಕಾರ ಸಹಕಾರ ಸಂಘ ಸಂಘ ಸಹಕಾರ ಸಂಘ",
        "corrections": [],
        "total_suggestions": 0,
        "message": "0 corrections.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಸಹಕಾರ ಸಹಕಾರ ಸಂಘ ಸಂಘ ಸಹಕಾರ ಸಂಘ"})
        assert res.status_code == 200
        assert len(res.json()["corrections"]) == 0


# -------------------------------------------------------------
# Untraceable corrections rejected
# -------------------------------------------------------------

def test_correct_ocr_rejects_unttraceable():
    raw_answer = json.dumps({
        "original_text": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ",
        "corrections": [
            {
                "original": "ಬೇರೆದಾಗಿದೆ",
                "suggested": "ಬೇರೆಯದಾಗಿದೆ",
                "reason": "wrong context",
                "confidence": "low",
                "status": "pending",
                "start": 999,  # out of bounds
                "end": 1008,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ"})
        data = res.json()
        assert len(data["corrections"]) == 0


def test_correct_ocr_rejects_invalid_confidence():
    raw_answer = json.dumps({
        "original_text": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ",
        "corrections": [
            {
                "original": "ಸರ್ಕಾರ",
                "suggested": "ಸಂಸ್ಥೆ",
                "reason": "fix",
                "confidence": "very high",  # invalid confidence
                "status": "pending",
                "start": 15,
                "end": 24,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ ಪ್ರಸ್ತಾವನೆ"})
        assert res.status_code == 200
        data = res.json()
        assert len(data["corrections"]) == 1
        assert data["corrections"][0]["confidence"] == "medium"


def test_correct_ocr_rejects_same_original_and_suggested():
    raw_answer = json.dumps({
        "original_text": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ",
        "corrections": [
            {
                "original": "ಸರ್ಕಾರ",
                "suggested": "ಸರ್ಕಾರ",
                "reason": "no change",
                "confidence": "high",
                "status": "pending",
                "start": 15,
                "end": 24,
            }
        ],
        "total_suggestions": 1,
        "message": "1 correction identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": "ಕರ್ನಾಟಕ ಸರ್ಕಾರ"})
        data = res.json()
        assert len(data["corrections"]) == 0


# -------------------------------------------------------------
# Multiple occurrences via positions
# -------------------------------------------------------------

def test_correct_ocr_two_occurrences_with_positions():
    text = "ಸಹಕಾರಿಸಬೇಕು ಸಹಕಾರಿಸು ಸಹಕಾರಿಸಬೇಕು"
    raw_answer = json.dumps({
        "original_text": text,
        "corrections": [
            {
                "original": "ಸಹಕಾರಿಸಬೇಕು",
                "suggested": "ಸಹಕಾರೋಲೇಬೇಕು",
                "reason": "first wrong",
                "confidence": "high",
                "status": "pending",
                "start": 11,
                "end": 26,
            },
            {
                "original": "ಸಹಕಾರಿಸಬೇಕು",
                "suggested": "ಸಹಕಾರಿಸು",
                "reason": "second wrong",
                "confidence": "high",
                "status": "pending",
                "start": 28,
                "end": 39,
            },
        ],
        "total_suggestions": 2,
        "message": "2 corrections identified.",
    })

    with patch("main.generate_ai", return_value={"answer": raw_answer, "provider": "mock", "model": "x"}):
        res = client.post("/api/correct-ocr", json={"text": text})
        assert res.status_code == 200
        data = res.json()
        assert len(data["corrections"]) == 2
        # First occurrence uses first token position range in source text (0, 11)
        assert data["corrections"][0]["start"] == 0
        assert data["corrections"][0]["end"] == 11
        # Second occurrence uses second token position range in source text (21, 32)
        assert data["corrections"][1]["start"] == 21
        assert data["corrections"][1]["end"] == 32


# -------------------------------------------------------------
# Existing endpoints remain compatible
# -------------------------------------------------------------

def test_insights_still_works():
    from ai_service import AIUnavailableError

    sample_doc = """
ಕರ್ನಾಟಕ ಸರ್ಕಾರ
ಸಹಕಾರ ಚುನಾವಣಾ ಆಯುಕ್ತರ ಕಛೇರಿ
ದಿನಾಂಕ: 15-02-2014
ವಿಷಯ: ಸಹಕಾರ ಸಂಘಗಳ ಚುನಾವಣೆ ನಡೆಸುವ ಕುರಿತು.
ಪ್ರಸ್ತಾವನೆ:
ಮಂಡಲಿಯ ಅವಧಿ ಮುಕ್ತಾಯವಾಗುವ ದಿನಾಂಕಕ್ಕೆ ಹಿಂದಿನ ಕನಿಷ್ಟ ಆರು ತಿಂಗಳಿಗೆ ಮುಂಚೆ ಸಹಕಾರಿ ಆಯೋಗಕ್ಕೆ ತಿಳಿಸತಕ್ಕದ್ದಾಗಿದೆ.
ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ಕೊನೆಯ ದಿನಾಂಕ: 31-03-2014.
"""
    mock_ai = json.dumps({
        "subject": "ಸಹಕಾರ ಸಂಘಗಳ ಚುನಾವಣೆ ನಡೆಸುವ ಕುರಿತು",
        "subject_source": "ವಿಷಯ: ಸಹಕಾರ ಸಂಘಗಳ ಚುನಾವಣೆ ನಡೆಸುವ ಕುರಿತು.",
        "date": "15-02-2014",
        "date_source": "ದಿನಾಂಕ: 15-02-2014",
        "issuer": "ಸಹಕಾರ ಚುನಾವಣಾ ಆಯುಕ್ತರ ಕಛೇರಿ",
        "issuer_source": "ಸಹಕಾರ ಚುನಾವಣಾ ಆಯುಕ್ತರ ಕಛೇರಿ",
        "recipient": None,
        "recipient_source": None,
        "deadline": "31-03-2014",
        "deadline_source": "ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ಕೊನೆಯ ದಿನಾಂಕ: 31-03-2014.",
        "section_headings": ["ಪ್ರಸ್ತಾವನೆ"],
        "key_points": [{"text": "ಮಂಡಲಿಯ ಅವಧಿ ಮುಕ್ತಾಯ", "source_passage": "ಮಂಡಲಿಯ ಅವಧಿ ಮುಕ್ತಾಯವಾಗುವ ದಿನಾಂಕಕ್ಕೆ"}],
        "action_items": [{"text": "ಆಯೋಗಕ್ಕೆ ತಿಳಿಸುವುದು", "source_passage": "ಸಹಕಾರಿ ಆಯೋಗಕ್ಕೆ ತಿಳಿಸತಕ್ಕದ್ದಾಗಿದೆ."}],
    })

    with patch("main.generate_ai", return_value={"answer": mock_ai, "provider": "mock", "model": "test"}):
        res = client.post("/api/insights", json={"text": sample_doc})
        assert res.status_code == 200
        data = res.json()
        assert data["subject"] is not None
        assert data["field_evidence"]["subject"]["source_passage"] is not None
        assert data["deadline"] is not None

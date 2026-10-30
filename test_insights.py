"""
Tests for Document Insights endpoint (/api/insights) and strict source grounding.
Uses mocks for AI generation to ensure deterministic, offline test execution without consuming credits.
"""
import json
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from main import app, AIUnavailableError, AIRequestError

client = TestClient(app)


SAMPLE_DOC = """
ಕರ್ನಾಟಕ ಸರ್ಕಾರ
ಸಹಕಾರ ಚುನಾವಣಾ ಆಯುಕ್ತರ ಕಛೇರಿ
ದಿನಾಂಕ: 15-02-2014
ವಿಷಯ: ಸಹಕಾರ ಸಂಘಗಳ ಚುನಾವಣೆ ನಡೆಸುವ ಕುರಿತು.
ಪ್ರಸ್ತಾವನೆ:
ಮಂಡಲಿಯ ಅವಧಿ ಮುಕ್ತಾಯವಾಗುವ ದಿನಾಂಕಕ್ಕೆ ಹಿಂದಿನ ಕನಿಷ್ಟ ಆರು ತಿಂಗಳಿಗೆ ಮುಂಚೆ ಸಹಕಾರಿ ಆಯೋಗಕ್ಕೆ ತಿಳಿಸತಕ್ಕದ್ದಾಗಿದೆ.
ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ಕೊನೆಯ ದಿನಾಂಕ: 31-03-2014.
"""

SAMPLE_WORDS = [
    {"text": "ಕರ್ನಾಟಕ", "box": {"x": 10, "y": 20, "width": 40, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 1},
    {"text": "ಸರ್ಕಾರ", "box": {"x": 55, "y": 20, "width": 35, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 1},
    {"text": "ದಿನಾಂಕ:", "box": {"x": 10, "y": 40, "width": 35, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 2},
    {"text": "15-02-2014", "box": {"x": 50, "y": 40, "width": 60, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 2},
    {"text": "31-03-2014.", "box": {"x": 10, "y": 80, "width": 70, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 4},
]


def test_insights_successful_extraction_with_evidence():
    """Test standard extraction with verified source passages and evidence mapping."""
    mock_ai_json = json.dumps({
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
        "key_points": [
            {"text": "ಮಂಡಲಿಯ ಅವಧಿ ಮುಕ್ತಾಯ", "source_passage": "ಮಂಡಲಿಯ ಅವಧಿ ಮುಕ್ತಾಯವಾಗುವ ದಿನಾಂಕಕ್ಕೆ"}
        ],
        "action_items": [
            {"text": "ಆಯೋಗಕ್ಕೆ ತಿಳಿಸುವುದು", "source_passage": "ಸಹಕಾರಿ ಆಯೋಗಕ್ಕೆ ತಿಳಿಸತಕ್ಕದ್ದಾಗಿದೆ."}
        ]
    })

    with patch("main._run_ai", return_value={"answer": mock_ai_json, "provider": "mock", "model": "test"}):
        res = client.post("/api/insights", json={
            "text": SAMPLE_DOC,
            "words": SAMPLE_WORDS,
            "image_width": 500,
            "image_height": 800,
        })
        assert res.status_code == 200
        data = res.json()

        assert data["subject"] == "ಸಹಕಾರ ಸಂಘಗಳ ಚುನಾವಣೆ ನಡೆಸುವ ಕುರಿತು"
        assert data["date"] == "15-02-2014"
        assert data["issuer"] == "ಸಹಕಾರ ಚುನಾವಣಾ ಆಯುಕ್ತರ ಕಛೇರಿ"
        assert data["recipient"] is None
        assert data["deadline"] == "31-03-2014"
        assert data["section_headings"] == ["ಪ್ರಸ್ತಾವನೆ"]
        assert len(data["key_points"]) == 1
        assert len(data["action_items"]) == 1

        # Check evidence mapping for date (present in words)
        date_ev = data["field_evidence"]["date"]
        assert date_ev["source_passage"] == "ದಿನಾಂಕ: 15-02-2014"
        assert date_ev["evidence"]["found"] is True
        assert date_ev["evidence"]["highlight_box"]["x"] == 10


def test_insights_missing_fields_and_unsupported_rejection():
    """Ensure missing fields are null/empty and fabricated sources are rejected."""
    mock_ai_json = json.dumps({
        "subject": None,
        "subject_source": None,
        "date": "null",
        "date_source": "Not in text",
        "issuer": None,
        "issuer_source": None,
        "recipient": "Unknown Public",
        "recipient_source": "Completely fabricated quote not in document",
        "deadline": None,
        "deadline_source": None,
        "section_headings": [],
        "key_points": [
            {"text": "Fabricated fact", "source_passage": "Fake quotation not in OCR"}
        ],
        "action_items": []
    })

    with patch("main._run_ai", return_value={"answer": mock_ai_json, "provider": "mock", "model": "test"}):
        res = client.post("/api/insights", json={
            "text": SAMPLE_DOC,
            "words": SAMPLE_WORDS,
        })
        assert res.status_code == 200
        data = res.json()

        # 'null' string should be coerced to None
        assert data["date"] is None
        assert data["subject"] is None
        assert data["issuer"] is None
        assert data["deadline"] is None
        assert data["section_headings"] == []

        # Recipient source was fake, so evidence should be None / unverified
        assert data["field_evidence"]["recipient"]["source_passage"] is None
        assert data["field_evidence"]["recipient"]["evidence"] is None

        # Key point with fake source passage should have source_passage=None, evidence=None
        assert len(data["key_points"]) == 1
        assert data["key_points"][0]["source_passage"] is None
        assert data["key_points"][0]["evidence"] is None


def test_insights_malformed_json_fallback():
    """Verify that non-JSON model output returns a clean empty schema instead of crashing."""
    malformed_output = "I am an AI and here are my notes: Not a valid JSON object."

    with patch("main._run_ai", return_value={"answer": malformed_output, "provider": "mock", "model": "test"}):
        res = client.post("/api/insights", json={
            "text": SAMPLE_DOC,
            "words": SAMPLE_WORDS,
        })
        assert res.status_code == 200
        data = res.json()

        assert data["subject"] is None
        assert data["date"] is None
        assert data["key_points"] == []
        assert data["action_items"] == []
        assert data["section_headings"] == []


def test_insights_provider_error_handling():
    """Verify that AI unavailability or request errors raise proper HTTP 503 / 502 codes."""
    with patch("main.generate_ai", side_effect=AIUnavailableError("No AI configured")):
        res = client.post("/api/insights", json={"text": SAMPLE_DOC})
        assert res.status_code == 503

    with patch("main.generate_ai", side_effect=AIRequestError("Rate limit exceeded")):
        res = client.post("/api/insights", json={"text": SAMPLE_DOC})
        assert res.status_code == 502


def test_insights_empty_input_validation():
    """Verify empty document text raises 422 Unprocessable Entity."""
    res = client.post("/api/insights", json={"text": ""})
    assert res.status_code == 422


def test_insights_without_words_has_no_fake_coordinates():
    """Verify that when words are absent, evidence is marked not found without inventing coordinates."""
    mock_ai_json = json.dumps({
        "subject": "ಚುನಾವಣೆ",
        "subject_source": "ಸಹಕಾರ ಸಂಘಗಳ ಚುನಾವಣೆ",
        "date": "15-02-2014",
        "date_source": "ದಿನಾಂಕ: 15-02-2014",
        "issuer": None,
        "issuer_source": None,
        "recipient": None,
        "recipient_source": None,
        "deadline": None,
        "deadline_source": None,
        "section_headings": [],
        "key_points": [
            {"text": "ಚುನಾವಣೆ ವಿವರ", "source_passage": "ಸಹಕಾರ ಸಂಘಗಳ ಚುನಾವಣೆ"}
        ],
        "action_items": []
    })

    with patch("main._run_ai", return_value={"answer": mock_ai_json, "provider": "mock", "model": "test"}):
        res = client.post("/api/insights", json={
            "text": SAMPLE_DOC,
            "words": [],  # No OCR words provided
        })
        assert res.status_code == 200
        data = res.json()

        # Validated source passage is retained
        assert data["key_points"][0]["source_passage"] == "ಸಹಕಾರ ಸಂಘಗಳ ಚುನಾವಣೆ"
        # But evidence coordinates are empty, NOT fabricated
        assert data["key_points"][0]["evidence"]["found"] is False
        assert data["key_points"][0]["evidence"]["highlight_box"] is None
        assert data["key_points"][0]["evidence"]["occurrences"] == []
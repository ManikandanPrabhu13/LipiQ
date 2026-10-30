"""
Comprehensive unit and integration tests for LipiQ:
- Evidence matching (single line, cross line, token normalization, repeated occurrences)
- Evidence-backed AI Q&A API contracts and validation
"""
import pytest
from fastapi.testclient import TestClient

from evidence_match import find_all_evidence, find_evidence, normalize
from main import app, AskRequest, ask_document


client = TestClient(app)


# -------------------------------------------------------------
# Evidence Matching Tests
# -------------------------------------------------------------

def test_evidence_normalization():
    assert normalize("ಕರ್ನಾಟಕ!") == normalize("ಕರ್ನಾಟಕ")
    assert normalize("Hello, World!") == "helloworld"
    assert normalize("   ") == ""


def test_evidence_single_line_match():
    words = [
        {"text": "ಕರ್ನಾಟಕ", "confidence": 95.0, "box": {"x": 10, "y": 20, "width": 50, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 1},
        {"text": "ಸರ್ಕಾರ", "confidence": 92.0, "box": {"x": 65, "y": 20, "width": 40, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 2},
    ]
    occurrences = find_all_evidence("ಕರ್ನಾಟಕ ಸರ್ಕಾರ", words)
    assert len(occurrences) == 1
    assert occurrences[0]["matched_text"] == "ಕರ್ನಾಟಕ ಸರ್ಕಾರ"
    assert occurrences[0]["highlight_box"] == {"x": 10, "y": 20, "width": 95, "height": 15}


def test_evidence_cross_line_match():
    words = [
        {"text": "ಕರ್ನಾಟಕ", "confidence": 95.0, "box": {"x": 10, "y": 20, "width": 50, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 1},
        {"text": "ಸರ್ಕಾರ", "confidence": 92.0, "box": {"x": 65, "y": 20, "width": 40, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 2},
        {"text": "ಸಹಕಾರ", "confidence": 88.0, "box": {"x": 10, "y": 45, "width": 45, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 2, "word_num": 1},
        {"text": "ಆಯೋಗ", "confidence": 90.0, "box": {"x": 60, "y": 45, "width": 40, "height": 15}, "block_num": 1, "par_num": 1, "line_num": 2, "word_num": 2},
    ]
    # "ಸರ್ಕಾರ ಸಹಕಾರ" crosses line 1 and line 2
    occurrences = find_all_evidence("ಸರ್ಕಾರ ಸಹಕಾರ", words)
    assert len(occurrences) == 1
    assert occurrences[0]["matched_text"] == "ಸರ್ಕಾರ ಸಹಕಾರ"
    assert occurrences[0]["highlight_box"]["x"] == 10
    assert occurrences[0]["highlight_box"]["y"] == 20
    assert occurrences[0]["highlight_box"]["height"] == 40  # spans y:20 to y:60


def test_evidence_repeated_occurrences():
    words = [
        {"text": "ಸಹಕಾರ", "box": {"x": 10, "y": 20, "width": 30, "height": 10}, "block_num": 1, "par_num": 1, "line_num": 1},
        {"text": "ಸಂಘ", "box": {"x": 45, "y": 20, "width": 30, "height": 10}, "block_num": 1, "par_num": 1, "line_num": 1},
        {"text": "ಸಹಕಾರ", "box": {"x": 10, "y": 40, "width": 30, "height": 10}, "block_num": 1, "par_num": 1, "line_num": 2},
        {"text": "ಸಂಘ", "box": {"x": 45, "y": 40, "width": 30, "height": 10}, "block_num": 1, "par_num": 1, "line_num": 2},
    ]
    occurrences = find_all_evidence("ಸಹಕಾರ ಸಂಘ", words)
    assert len(occurrences) == 2


def test_evidence_empty_and_not_found():
    words = [
        {"text": "ಕನ್ನಡ", "box": {"x": 10, "y": 20, "width": 30, "height": 10}, "block_num": 1, "par_num": 1, "line_num": 1},
    ]
    assert find_all_evidence("", words) == []
    assert find_all_evidence("ಇಂಗ್ಲಿಷ್", words) == []


# -------------------------------------------------------------
# API Contract and Validation Tests
# -------------------------------------------------------------

def test_api_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_api_evidence_endpoint():
    words = [
        {"text": "ಬೆಂಗಳೂರು", "box": {"x": 15, "y": 25, "width": 60, "height": 20}, "block_num": 1, "par_num": 1, "line_num": 1},
    ]
    res = client.post("/api/evidence", json={
        "quote": "ಬೆಂಗಳೂರು",
        "words": words,
        "image_width": 400,
        "image_height": 600,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["found"] is True
    assert data["occurrence_count"] == 1
    assert data["highlight_box"]["x"] == 15


def test_api_ask_validation_errors():
    # Empty text
    res = client.post("/api/ask", json={"text": "", "question": "Question?"})
    assert res.status_code == 422

    # Empty question
    res = client.post("/api/ask", json={"text": "Some text", "question": ""})
    assert res.status_code == 422

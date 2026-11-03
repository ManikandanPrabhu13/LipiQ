"""Backend smoke test for Kannada handwriting recognition feature."""
import base64
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

def render_handwritten_image(text_lines, size=720):
    img = Image.new("RGB", (size, size * len(text_lines) // max(size // 18, 1)), "white")
    draw = ImageDraw.Draw(img)
    try:
        import os
        win_fonts = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
        candidates = []
        for name in ("arial.ttf", "ARIALC.TTF"):
            candidate = os.path.join(win_fonts, name)
            if os.path.exists(candidate):
                candidates.append((name, candidate))
        if candidates:
            font_path = candidates[0][1]
            font_size = int(size / 3.2)
            for i, line in enumerate(text_lines[:5]):
                y = i + 1
                draw.text((int(size * 0.1), y * (size // max(len(text_lines), 1))),
                           line, fill="#3d2e9b", font=ImageFont.truetype(font_path, font_size))
            return img
    except Exception:
        pass
    width = int(size / 3)
    height = size // max(len(text_lines), 1)
    for i, line in enumerate(text_lines[:5]):
        x = int(size * 0.12)
        for ch in line[:4]:
            y = (i + 1) * height - height * 0.35
            draw.rectangle([x, y, x + width // 4, y], fill="#3d2e9b")
            draw.line([(x + width // 8, y)], fill="#3d2e9b", width=3)
            draw.line([(x + width * 3 // 4, y - height * 0.3), (x + width * 3 // 4, y)],
                      fill="#3d2e9b", width=3)
            x += width // 2
    return img

def main():
    # 1. Health
    r = client.get("/health")
    assert r.status_code == 200, f"health failed: {r.text}"
    print("OK /health")

    # 2. Handwriting endpoint
    lines = [
        "ನಮಸ್ತೆ ಬಾರಿ ಸ್ಯಾಂಕಿಗೆ ವಿಷ್ಯಗಳನ್ನು ಸೇರಿಸಿರಿ",
        "ಆಯೆ ಮನೆಯಲ್ಲಿ ಪ್ರತಿದಿನ ನಡೆಯುತ್ತದೆ ಕೆಲಸದ ಪ್ರಮುಖ ತತ್ವಗಳನ್ನು ವರ್ಣಿಸಿರಿ",
        "ಹೀಗೆ ಮಾಡಬೇಕೆಂದು ದೂರದಲ್ಲಿ ಇರುವ ಸಾರಾಜ ಅರಸುತ್ತಾನ",
        "ದೂರದಲ್ಲಿ ಇರುವ ಮಗುವಿಗೆ ಅಧ್ಯಾಯ ಮಾಡಬೇಕು",
    ]
    img = render_handwritten_image(lines)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    jpeg_bytes = buf.getvalue()

    r = client.post(
        "/api/handwriting",
        files={"file": ("handwritten.jpg", jpeg_bytes, "image/jpeg")},
    )
    assert r.status_code == 200, f"handwriting failed: {r.text}"
    data = r.json()
    print(f"OK /api/handwriting -> provider={data['provider']}, lines={len(data['lines'])}")

    transcribed = data["transcribed_text"] or ""
    assert any("ನಮಸ್ತೆ" in l for l in (data["lines"] or [])), \
        f"Expected Kannada text. Got:\n{transcribed[:200]}")
    assert any("[ಅಸ್ಪಷ್ಟ]" in l for l in (data["lines"] or [])), \
        f"Expected marker. Got:\n{data['lines']}")
    print("OK transcribed Kannada + [ಅಸ್ಪಷ್ಟ] marker present")

    # 3. Copy works on returned transcription
    copied = data.get("transcribed_text", "") if isinstance(data.get("transcribed_text"), str) else ""
    assert len(copied.strip()) > 0, "Empty transcribed text"
    print("OK copy path (non-empty transcription)")

    # 4. Downstream AI features
    r2 = client.post("/api/summarize", json={"text": transcribed})
    assert r2.status_code == 200, f"summarize failed: {r2.text}"
    summary_text = r2.json().get("summary", "")
    assert summary_text.strip(), "summary empty"
    print(f"OK summarize (len={len(summary_text)})")

    r3 = client.post("/api/insights", json={"text": transcribed})
    assert r3.status_code == 200, f"insights failed: {r3.text}"
    insights_json = r3.json()
    print(f"OK insights (subject present: {insights_json.get('subject') is not None})")

    r4 = client.post("/api/ask", json={"text": transcribed, "question": "ಮೂಲೆ ಅಧ್ಯಾಯಗಳು ಏನೇನು?"})
    assert r4.status_code == 200, f"ask failed: {r4.text}"
    ask_json = r4.json()
    assert ask_json.get("answer"), "ask answer empty"
    print(f"OK ask (answer len={len(ask_json.get('answer', ''))})")

    print("\n===== HANDWRITING TEST SUMMARY =====")
    print(f"Provider used: {data['provider']}")
    print(f"Line count: {len(data['lines'])}")
    print(f"Transcription length: {len(transcribed)} chars")
    print("First 3 lines:")
    for ln in data["lines"][:3]:
        print(f"  • {ln}")

    ok = True
    if any("ನಮಸ್ತೆ" in l for l in data["lines"]):
        print("✓ Kannada detected in transcription")
    else:
        print("! Kannada may be marked [ಅಸ್ಪಷ್ಟ]")
    if "[ಅಸ್ಪಷ್ಟ]" in transcribed:
        print("✓ Uncertain-word marker present")
    else:
        print("! Marker missing (may indicate non-dialect output)")

    print("\nALL BACKEND TESTS PASSED" if ok else "\nSOME CHECKS FAILED")
    import sys
    sys.exit(0 if ok else 1)

main()

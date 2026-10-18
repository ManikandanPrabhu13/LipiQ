
from ocr_layout import reconstruct_reading_order


sample_words = [
    {
        "text": "ಬೆಂಗಳೂರು",
        "confidence": 90,
        "box": {"x": 100, "y": 100, "width": 80, "height": 20},
        "block_num": 2,
        "par_num": 1,
        "line_num": 1,
        "word_num": 1,
    },
    {
        "text": "ಕರ್ನಾಟಕ",
        "confidence": 90,
        "box": {"x": 100, "y": 50, "width": 80, "height": 20},
        "block_num": 1,
        "par_num": 1,
        "line_num": 1,
        "word_num": 1,
    },
]

result = reconstruct_reading_order(sample_words)

print("Reconstructed text:")
print(result["text"])

assert result["lines"][0]["text"] == "ಕರ್ನಾಟಕ"
assert result["lines"][1]["text"] == "ಬೆಂಗಳೂರು"

print("\nLayout test passed!")

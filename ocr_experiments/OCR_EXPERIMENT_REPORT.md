# LipiQ — Experimental Kannada OCR Report

**Date:** 18 October 2026  
**Status:** Preliminary experiment; not approved for production  
**Scope:** One labeled Kannada document, CPU-based Tesseract OCR

## 1. Objective

Evaluate lightweight image preprocessing and Tesseract page segmentation modes (PSM) for Kannada OCR. Preserve the existing production implementation and compare raw OCR text with the experimental reading-order reconstruction.

## 2. Dataset and limitations

- Input image: `sample.png`
- Reference text: `reference.txt`
- Reference size reported by the benchmark: 1,699 normalized characters and 209 words.
- Evaluation is based on one labeled document only.
- Reference transcription anomalies have not been independently ruled out.
- Results are preliminary and must not be interpreted as general Kannada OCR accuracy.

## 3. Evaluation methodology

- Character error rate (CER) and word error rate (WER) are calculated after Unicode NFC normalization and whitespace collapsing.
- CER uses Unicode code points.
- **Raw output:** Tesseract OCR output in its original grouping/order.
- **Custom output:** Output after the experimental `reconstruct_reading_order()` processing.
- Runtime covers preprocessing plus Tesseract execution.
- Peak memory usage was not measured.

The benchmark's metric self-check passed all 10 synthetic tests, including identity, Unicode normalization, character substitutions/insertions/deletions, word errors, empty inputs, and a Kannada matra deletion.

## 4. Baseline reproduction

The benchmark reported successful baseline reproduction across 60 comparisons. The maximum absolute difference was 0.005 percentage points, below the configured 0.05 percentage-point threshold.

Two runs were compared:
- `results/run_20261018_150121/`
- `results/run_20261018_150501/`

Both contained 27 result rows. Comparing phase, preprocessing, PSM, raw CER/WER and custom CER/WER produced no differences. Runtime can vary between runs.

## 5. Key results

All error rates below are percentages. These are selected results from the complete sweep; the per-run `results.csv`, `results.json`, and `summary.md` files retain the full measurements.

| Configuration | Raw CER | Raw WER | Custom CER | Custom WER | Runtime (s) |
|---|---:|---:|---:|---:|---:|
| Original image, PSM 3 | 29.96 | 40.19 | 29.96 | 40.19 | 3.38 |
| Original image, PSM 4 | 17.01 | 27.75 | 15.77 | 27.75 | 3.27 |
| Original image, PSM 6 | 9.06 | 21.05 | 9.71 | 22.97 | 3.11 |
| 2x upscale, PSM 3 | 26.07 | 31.10 | 27.84 | 33.01 | 3.83 |
| 2x upscale, PSM 4 | **8.00** | **16.27** | 8.18 | 16.75 | 4.12 |
| 2x upscale, PSM 6 | 10.12 | 22.97 | 10.83 | 25.36 | 4.39 |
| Grayscale + CLAHE, PSM 4 | 9.36 | 21.53 | 12.65 | 26.32 | 2.67 |
| Otsu threshold, PSM 6 | 14.83 | 40.19 | 15.42 | 41.63 | 3.16 |
| Denoise + sharpen, PSM 4 | 36.26 | 67.46 | 32.96 | 65.07 | 2.84 |

## 6. Findings

### Promising configuration

On this document, 2x upscaling with PSM 4 produced the lowest raw CER and WER in the tested sweep: 8.00% CER and 16.27% WER.

Compared with the original-image PSM 6 baseline:
- CER decreased by approximately 1.06 percentage points.
- WER decreased by approximately 4.78 percentage points.
- Runtime increased from approximately 3.11 s to 4.12 s.

The reconstructed output for 2x upscale + PSM 4 scored 8.18% CER and 16.75% WER. Reconstruction therefore did not improve these metrics for this configuration.

### Configurations that performed poorly

- Otsu thresholding had substantially higher error rates in the tested configurations.
- Denoising plus sharpening performed particularly poorly, including a high error rate and fewer recognized words.
- Grayscale + CLAHE did not outperform the strongest original-image raw baseline in this sweep.

These observations apply only to the tested document and configurations.

## 7. Reproducibility artifacts

Each run preserves:
- `results.csv` — tabular metrics
- `results.json` — structured results
- `summary.md` — generated run summary
- `candidate_texts/raw/` — raw OCR outputs
- `candidate_texts/reconstructed/` — reconstructed outputs

The two runs were retained rather than overwritten.

## 8. Conclusion and next steps

The initial experiment suggests that upscaling combined with PSM 4 is worth further evaluation for this sample. It does **not** establish that this configuration is generally superior for Kannada OCR.

Before considering production adoption:
1. Validate the reference transcription.
2. Evaluate a larger, diverse set of labeled Kannada documents.
3. Report aggregate CER/WER and per-document variability.
4. Check runtime and memory on representative hardware.
5. Inspect reading-order failures and visually verify OCR errors.
6. Compare candidate changes against the unchanged production baseline.

**No production promotion is authorized by this report.** The experiment is isolated from the production OCR pipeline.


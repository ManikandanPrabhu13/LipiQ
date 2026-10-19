# LipiQ OCR Experiment Run

Generated: 2026-10-18 15:01:22
Image: `sample.png`
Reference: `reference.txt`
Reference: 1699 characters, 209 words

> **Preliminary:** all results come from one labeled document.
> They do not establish general Kannada OCR accuracy.

## Metric self-check

Passed: **True**

## Baseline reproduction

Reproduced within 0.05 pp: **True**
Comparisons: 60; max absolute difference: 0.005 pp

## Results

| Phase | Preprocessing | PSM | Raw CER % | Raw WER % | Custom CER % | Custom WER % | Time s | Words |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | original | 3 | 29.96 | 40.19 | 29.96 | 40.19 | 3.14 | 157 |
| baseline | original | 4 | 17.01 | 27.75 | 15.77 | 27.75 | 3.03 | 191 |
| baseline | original | 6 | 9.06 | 21.05 | 9.71 | 22.97 | 7.14 | 215 |
| baseline | contrast | 3 | 13.01 | 22.97 | 13.30 | 24.40 | 4.06 | 198 |
| baseline | contrast | 4 | 17.13 | 26.32 | 17.42 | 27.75 | 4.14 | 189 |
| baseline | contrast | 6 | 9.48 | 22.49 | 10.83 | 23.44 | 3.54 | 213 |
| baseline | grayscale | 3 | 11.18 | 22.97 | 10.48 | 22.01 | 3.23 | 205 |
| baseline | grayscale | 4 | 10.95 | 23.44 | 11.65 | 23.92 | 3.17 | 207 |
| baseline | grayscale | 6 | 11.30 | 24.40 | 11.24 | 24.40 | 2.53 | 208 |
| baseline | threshold | 3 | 13.60 | 32.54 | 13.07 | 32.06 | 2.63 | 197 |
| baseline | threshold | 4 | 13.77 | 33.49 | 13.24 | 33.01 | 2.81 | 198 |
| baseline | threshold | 6 | 13.54 | 32.54 | 13.24 | 32.06 | 4.08 | 207 |
| baseline | adaptive | 3 | 12.30 | 29.67 | 12.01 | 29.67 | 3.28 | 200 |
| baseline | adaptive | 4 | 12.30 | 29.67 | 12.01 | 29.67 | 3.31 | 200 |
| baseline | adaptive | 6 | 13.30 | 30.62 | 12.89 | 30.62 | 2.94 | 204 |
| experiment | upscale2x | 3 | 26.07 | 31.10 | 27.84 | 33.01 | 3.37 | 173 |
| experiment | upscale2x | 4 | 8.00 | 16.27 | 8.18 | 16.75 | 3.95 | 211 |
| experiment | upscale2x | 6 | 10.12 | 22.97 | 10.83 | 25.36 | 4.41 | 228 |
| experiment | grayscale_clahe | 3 | 16.60 | 26.79 | 17.42 | 25.84 | 2.32 | 189 |
| experiment | grayscale_clahe | 4 | 9.36 | 21.53 | 12.65 | 26.32 | 2.65 | 208 |
| experiment | grayscale_clahe | 6 | 10.83 | 22.49 | 11.01 | 22.97 | 2.70 | 210 |
| experiment | otsu | 3 | 34.08 | 54.55 | 34.08 | 54.55 | 2.25 | 157 |
| experiment | otsu | 4 | 22.13 | 44.98 | 21.13 | 44.98 | 2.71 | 192 |
| experiment | otsu | 6 | 14.83 | 40.19 | 15.42 | 41.63 | 2.94 | 215 |
| experiment | denoise_sharpen | 3 | 72.87 | 85.65 | 72.87 | 85.17 | 1.53 | 91 |
| experiment | denoise_sharpen | 4 | 36.26 | 67.46 | 32.96 | 65.07 | 2.57 | 195 |
| experiment | denoise_sharpen | 6 | 32.61 | 67.46 | 33.96 | 68.90 | 2.67 | 199 |

## Notes

- CER uses Unicode code points after NFC normalization and whitespace collapsing.
- Raw = Tesseract TSV grouping/order; Custom = `reconstruct_reading_order()`.
- Elapsed time covers preprocessing + Tesseract only.
- Peak memory was not measured.

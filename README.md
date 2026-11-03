# LipiQ – Kannada Document AI & OCR

**From Kannada Documents to Intelligent Digital Knowledge**

LipiQ is an AI-powered Kannada document digitization platform that converts Kannada text from images and scanned documents into searchable, editable digital content. Beyond OCR, it provides AI-powered document understanding through correction, summarization, insights and evidence-based question answering.

## Key Features

- **Kannada OCR:** Extract Kannada and English text using Tesseract OCR.
- **Image Preprocessing:** OpenCV-based preprocessing to improve text recognition.
- **Smart OCR Correction:** AI-assisted correction of extracted text.
- **AI Summarization:** Generate concise document summaries.
- **Document Insights:** Identify important information and key points.
- **Ask Questions:** Query document content using AI.
- **Evidence Highlighting:** Locate supporting text within extracted content.
- **Handwriting Recognition:** AI-based handwriting recognition.
- **Accessibility:** Editable text, copy, download and voice reading.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite |
| Backend | Python, FastAPI |
| OCR | Tesseract OCR |
| Image Processing | OpenCV |
| AI Integration | Groq, Gemini Vision |
| Deployment | Vercel, Render |

## System Workflow

1. Upload a Kannada document image.
2. Preprocess the image using OpenCV.
3. Extract Kannada and English text using OCR.
4. Review and edit the extracted transcript.
5. Use AI features for correction, summarization, insights and Q&A.
6. Access supporting evidence and export the extracted content.

## Running Locally

**Backend**
```bash
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Configure the required AI provider credentials using environment variables. Never commit API keys or `.env` files.

## Project Links

- **Source Code:** https://github.com/ManikandanPrabhu13/LipiQ
- **Live Application:** https://lipiq-frontend.vercel.app
## Impact

LipiQ aims to make Kannada documents more accessible by transforming static document images into searchable, editable and AI-understandable information.

**Developed by:** Manikandan Prabhu B  
Madras Institute of Technology, Anna University


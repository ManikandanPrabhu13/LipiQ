import { useEffect, useState } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

async function readResponse(response, fallbackMessage) {
  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(
      typeof detail === "string" ? detail : fallbackMessage
    );
  }

  return data;
}

function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selectedWord, setSelectedWord] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [occurrenceIndex, setOccurrenceIndex] = useState(0);

  // Editable OCR output and AI features
  const [editedText, setEditedText] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerLoading, setAnswerLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiStatusChecked, setAiStatusChecked] = useState(false);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    let active = true;

    async function checkAIStatus() {
      try {
        const response = await fetch(`${API_BASE}/api/ai/status`);
        const data = await readResponse(
          response,
          "AI status is unavailable."
        );

        if (active) {
          setAiConfigured(Boolean(data.configured));
        }
      } catch {
        if (active) setAiConfigured(false);
      } finally {
        if (active) setAiStatusChecked(true);
      }
    }

    checkAIStatus();

    return () => {
      active = false;
    };
  }, []);

  function resetDocumentResults() {
    setResult(null);
    setEditedText("");
    setSelectedWord(null);
    setEvidence(null);
    setOccurrenceIndex(0);
    setSummary("");
    setQuestion("");
    setAnswer("");
  }

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (
      !["image/jpeg", "image/png", "image/webp"].includes(
        selectedFile.type
      )
    ) {
      setError("Please upload a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("Please choose an image smaller than 10 MB.");
      event.target.value = "";
      return;
    }

    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
    resetDocumentResults();
    setError("");
  }

  async function extractText() {
    if (!file) {
      setError("Please upload a Kannada document image first.");
      return;
    }

    setLoading(true);
    setError("");
    resetDocumentResults();

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `${API_BASE}/api/extract?psm=6`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await readResponse(
        response,
        "Text extraction failed."
      );

      setResult(data);
      // Use extracted_text which preserves paragraph/line breaks from the
      // OCR layout. Fall back to the flat word list if the field is absent.
      setEditedText(
        data.extracted_text || (data.words || []).map((word) => word.text).join(" ")
      );
    } catch (err) {
      setError(
        err.message.toLowerCase().includes("fetch")
          ? "Cannot connect to LipiQ's backend. Make sure FastAPI is running."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }


  async function findWordEvidence(word) {
    if (!result || !word) return;

    setSelectedWord(word);
    setEvidence(null);
    setOccurrenceIndex(0);
    setEvidenceLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quote: word.text,
          words: result.words,
          image_width: result.image_width,
          image_height: result.image_height,
        }),
      });

      const data = await readResponse(
        response,
        "Evidence lookup failed."
      );

      // Find which occurrence corresponds to the word clicked.
      const matches = Array.isArray(data.occurrences)
        ? data.occurrences
        : [];

      const clickedBox = word.box;

      const clickedIndex = matches.findIndex((occurrence) =>
        (occurrence.boxes || []).some(
          (box) =>
            box.x === clickedBox?.x &&
            box.y === clickedBox?.y &&
            box.width === clickedBox?.width &&
            box.height === clickedBox?.height
        )
      );

      setEvidence(data);
      setOccurrenceIndex(clickedIndex >= 0 ? clickedIndex : 0);
    } catch (err) {
      setError(`Evidence lookup failed: ${err.message}`);
    } finally {
      setEvidenceLoading(false);
    }
  }


  async function copyExtractedText() {
    if (!editedText.trim()) {
      setError("There is no text to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(editedText);
      setError("");
    } catch {
      setError(
        "Unable to copy text automatically. Select the text and copy it manually."
      );
    }
  }

  function downloadText() {
    if (!editedText.trim()) {
      setError("There is no text to download.");
      return;
    }

    const blob = new Blob(["\uFEFF", editedText], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "lipiq-kannada-text.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function generateSummary() {
    if (!editedText.trim()) {
      setError("Extract or enter some text before summarizing.");
      return;
    }

    setSummaryLoading(true);
    setSummary("");
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/summarize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: editedText,
        }),
      });

      const data = await readResponse(
        response,
        "Unable to summarize this document."
      );

      setSummary(data.summary || "No summary was returned.");
    } catch (err) {
      setError(`Summary failed: ${err.message}`);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function askQuestion(event) {
    event?.preventDefault();

    if (!editedText.trim()) {
      setError("Extract or enter some text before asking a question.");
      return;
    }

    if (!question.trim()) {
      setError("Enter a question about your document.");
      return;
    }

    setAnswerLoading(true);
    setAnswer("");
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: editedText,
          question: question.trim(),
        }),
      });

      const data = await readResponse(
        response,
        "Unable to answer this question."
      );

      setAnswer(data.answer || "No answer was returned.");
    } catch (err) {
      setError(`Question failed: ${err.message}`);
    } finally {
      setAnswerLoading(false);
    }
  }

  const occurrences = evidence?.found
    ? evidence.occurrences?.length
      ? evidence.occurrences
      : [evidence]
    : [];

  const highlightBox = occurrences[occurrenceIndex]?.highlight_box ?? null;

  function showPreviousOccurrence() {
    setOccurrenceIndex((index) => Math.max(0, index - 1));
  }

  function showNextOccurrence() {
    setOccurrenceIndex((index) => Math.min(occurrences.length - 1, index + 1));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="LipiQ home">
          <span className="brand-mark">ಲಿಪಿ</span>
          <span className="brand-name">
            Lipi<span>Q</span>
          </span>
        </a>

        <nav className="top-nav">
          <a href="#workspace">Workspace</a>
          <a href="#about">About LipiQ</a>
          <span className="status-pill">
            <span className="status-dot" />
            OCR workspace
          </span>
        </nav>
      </header>

      <main>
        <section className="hero" id="about">
          <div className="eyebrow">
            <span className="eyebrow-line" />
            KANNADA DOCUMENT INTELLIGENCE
          </div>

          <h1>
            Every document has
            <br />
            a story. <span>Read it clearly.</span>
          </h1>

          <p className="hero-copy">
            Turn Kannada documents into searchable text you can read,
            explore, and understand — with evidence linked to the original.
          </p>

          <div className="hero-points">
            <span>
              <span className="point-check">✓</span> Kannada OCR
            </span>
            <span>
              <span className="point-check">✓</span> Source-linked text
            </span>
            <span>
              <span className="point-check">✓</span> AI-powered understanding
            </span>
          </div>
        </section>

        <section className="workspace" id="workspace">
          <div className="section-heading">
            <div>
              <p className="section-kicker">YOUR WORKSPACE</p>
              <h2>Bring your document to life.</h2>
            </div>
            <span className="step-label">01 / UPLOAD & EXTRACT</span>
          </div>

          <div className="upload-card">
            <div className="upload-intro">
              <div className="upload-icon">↑</div>
              <div>
                <h3>Upload a Kannada document</h3>
                <p>
                  Start with a clear image of a printed Kannada document.
                </p>
              </div>
            </div>

            <label className="dropzone">
              {preview ? (
                <img
                  className="upload-thumbnail"
                  src={preview}
                  alt="Selected document preview"
                />
              ) : (
                <span className="upload-symbol">＋</span>
              )}

              <span className="dropzone-title">
                {file ? file.name : "Choose an image to get started"}
              </span>

              <span className="dropzone-subtitle">
                {file
                  ? `${(file.size / 1024).toFixed(0)} KB · Ready to process`
                  : "Click to browse · JPG, PNG or WebP · Max 10 MB"}
              </span>

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
              />
            </label>

            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}

            <div className="upload-footer">
              <p>
                <span className="privacy-icon">▣</span>
                Your image is processed by your local OCR backend.
              </p>

              <button
                className="primary-button"
                onClick={extractText}
                disabled={!file || loading}
              >
                {loading ? "Extracting text..." : "Extract Kannada text"}
                {!loading && <span>↗</span>}
              </button>
            </div>
          </div>

          {result && (
            <section className="results-section" aria-live="polite">
              <div className="results-heading">
                <div>
                  <p className="section-kicker">EXTRACTION COMPLETE</p>
                  <h2>Your document, digitized.</h2>
                </div>

                <span className="result-badge">
                  <span className="status-dot" />
                  OCR complete
                </span>
              </div>

              <div className="results-grid">
                <div className="result-panel document-panel">
                  <div className="panel-heading">
                    <span>01</span>
                    <h3>Original document</h3>
                  </div>

                  <div className="document-image-wrap">
                    <div className="document-image-stage">
                      <img
                        src={preview}
                        alt="Original uploaded Kannada document"
                      />

                      {highlightBox && (
                        <div
                          className="evidence-highlight"
                          style={{
                            left: `${
                              (highlightBox.x / result.image_width) * 100
                            }%`,
                            top: `${
                              (highlightBox.y / result.image_height) * 100
                            }%`,
                            width: `${
                              (highlightBox.width / result.image_width) * 100
                            }%`,
                            height: `${
                              (highlightBox.height / result.image_height) * 100
                            }%`,
                          }}
                          title={`Evidence: ${evidence?.matched_text}`}
                        />
                      )}
                    </div>

                    {occurrences.length > 1 && (
                      <div className="occurrence-navigation">
                        <button
                          type="button"
                          onClick={showPreviousOccurrence}
                          disabled={occurrenceIndex === 0}
                        >
                          ← Previous
                        </button>

                        <span>
                          Match {occurrenceIndex + 1} of {occurrences.length}
                        </span>

                        <button
                          type="button"
                          onClick={showNextOccurrence}
                          disabled={occurrenceIndex === occurrences.length - 1}
                        >
                          Next →
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="panel-footnote">
                    {result.image_width} × {result.image_height} pixels
                    {highlightBox && (
                      <span className="evidence-status">
                        {" "}· Evidence located
                      </span>
                    )}
                  </p>

                  {selectedWord && (
                    <div className="evidence-info">
                      <strong>Selected word</strong>
                      <span lang="kn">{selectedWord.text}</span>

                      {evidenceLoading && (
                        <p>Locating source evidence...</p>
                      )}

                      {!evidenceLoading && evidence?.found && (
                        <p>
                          Matched in the original document. The purple
                          outline marks the detected location.
                        </p>
                      )}

                      {!evidenceLoading &&
                        evidence &&
                        !evidence.found && (
                          <p>
                            No exact match was found. OCR may have split or
                            misrecognized this word.
                          </p>
                        )}
                    </div>
                  )}
                </div>

                <div className="result-panel text-panel">
                  <div className="panel-heading">
                    <span>02</span>
                    <h3>Extracted Kannada text</h3>

                    <button
                      className="copy-button"
                      onClick={copyExtractedText}
                      type="button"
                    >
                      Copy text ↗
                    </button>
                  </div>

                  <p className="click-hint">
                    Click any original OCR word to locate it in the document.
                  </p>

                  <div className="ocr-text" lang="kn">
                    {(result.words || []).map((word, index) => (
                      <button
                        type="button"
                        className={`ocr-word ${
                          selectedWord === word ? "selected" : ""
                        }`}
                        key={`${word.text}-${index}`}
                        onClick={() => findWordEvidence(word)}
                        title="Locate this word in the original document"
                      >
                        {word.text}
                      </button>
                    ))}

                    {(!result.words || result.words.length === 0) && (
                      <p>
                        No text was detected in this image. Try a clearer
                        image.
                      </p>
                    )}
                  </div>

                  <div className="result-stats">
                    <div>
                      <strong>
                        {result.word_count ?? result.words?.length ?? 0}
                      </strong>
                      <span>Words detected</span>
                    </div>

                    <div>
                      <strong>{result.language || "Kannada + English"}</strong>
                      <span>OCR language</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Editable OCR output */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>03</span>
                  <h3>Edit extracted text</h3>
                </div>

                <p className="click-hint">
                  Correct OCR mistakes here. Copy, download, summarize, and
                  ask questions using this edited version.
                </p>

                <textarea
                  lang="kn"
                  aria-label="Editable extracted Kannada text"
                  value={editedText}
                  onChange={(event) => {
                    setEditedText(event.target.value);
                    setSummary("");
                    setAnswer("");
                  }}
                  rows={9}
                  placeholder="Extracted Kannada text will appear here..."
                  style={textAreaStyle}
                />

                <div style={actionRowStyle}>
                  <button
                    type="button"
                    className="copy-button"
                    onClick={copyExtractedText}
                    disabled={!editedText.trim()}
                  >
                    Copy edited text
                  </button>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={downloadText}
                    disabled={!editedText.trim()}
                  >
                    Download .txt ↗
                  </button>
                </div>
              </section>

              {/* AI summary */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>04</span>
                  <h3>Document summary</h3>
                </div>

                <p className="click-hint">
                  Generate a concise summary and key points from your
                  extracted text.
                </p>

                {!aiStatusChecked ? (
                  <p role="status">Checking AI availability...</p>
                ) : !aiConfigured ? (
                  <p role="status">
                    AI features are not configured. Set up a supported AI
                    provider in the backend to enable summaries and Q&A.
                    OCR, editing, copying, and downloading remain available.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={generateSummary}
                    disabled={summaryLoading || !editedText.trim()}
                  >
                    {summaryLoading ? "Summarizing..." : "Summarize document"}
                  </button>
                )}

                {summaryLoading && (
                  <p role="status">Generating your summary...</p>
                )}

                {summary && (
                  <div className="evidence-info" style={outputStyle}>
                    <strong>Summary</strong>
                    <p lang="kn" style={paragraphStyle}>
                      {summary}
                    </p>
                  </div>
                )}
              </section>

              {/* Grounded document Q&A */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>05</span>
                  <h3>Ask your document</h3>
                </div>

                <p className="click-hint">
                  Ask a question about the document. Answers are generated
                  from the text you provide and may still contain errors.
                </p>

                <form onSubmit={askQuestion}>
                  <label
                    htmlFor="document-question"
                    style={labelStyle}
                  >
                    Your question
                  </label>

                  <input
                    id="document-question"
                    type="text"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="e.g. What is this document about?"
                    maxLength={1000}
                    style={inputStyle}
                    disabled={!aiConfigured || answerLoading}
                  />

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      !aiConfigured ||
                      answerLoading ||
                      !question.trim() ||
                      !editedText.trim()
                    }
                  >
                    {answerLoading ? "Finding answer..." : "Ask question"}
                  </button>
                </form>

                {answerLoading && (
                  <p role="status">Looking for an answer in your text...</p>
                )}

                {answer && (
                  <div className="evidence-info" style={outputStyle}>
                    <strong>Answer</strong>
                    <p lang="kn" style={paragraphStyle}>
                      {answer}
                    </p>
                  </div>
                )}
              </section>
            </section>
          )}
        </section>

        <footer className="footer">
          <a className="footer-brand" href="#">
            LipiQ<span>®</span>
          </a>
          <p>Read. Understand. Trust.</p>
          <span>Kannada Document Intelligence</span>
        </footer>
      </main>
    </div>
  );
}

const featurePanelStyle = {
  marginTop: "24px",
  padding: "24px",
};

const textAreaStyle = {
  boxSizing: "border-box",
  display: "block",
  width: "100%",
  minHeight: "200px",
  padding: "16px",
  border: "1px solid #d8d4e8",
  borderRadius: "10px",
  background: "#fff",
  color: "#252238",
  fontFamily: "inherit",
  fontSize: "1rem",
  lineHeight: 1.8,
  resize: "vertical",
};

const actionRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  alignItems: "center",
  marginTop: "14px",
};

const labelStyle = {
  display: "block",
  marginBottom: "8px",
  fontWeight: 600,
};

const inputStyle = {
  boxSizing: "border-box",
  display: "block",
  width: "100%",
  padding: "13px 14px",
  marginBottom: "14px",
  border: "1px solid #d8d4e8",
  borderRadius: "10px",
  font: "inherit",
};

const outputStyle = {
  marginTop: "18px",
  overflowWrap: "anywhere",
};

const paragraphStyle = {
  whiteSpace: "pre-wrap",
  lineHeight: 1.8,
};

export default App;
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
  const [isSupported, setIsSupported] = useState(null);
  const [passages, setPassages] = useState([]);
  const [supportingEvidence, setSupportingEvidence] = useState([]);
  const [activePassageIndex, setActivePassageIndex] = useState(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
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
    setIsSupported(null);
    setPassages([]);
    setSupportingEvidence([]);
    setActivePassageIndex(null);
    setInsights(null);
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

  async function generateInsights() {
    if (!editedText.trim()) {
      setError("Extract or enter some text before generating insights.");
      return;
    }

    setInsightsLoading(true);
    setInsights(null);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/insights`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: editedText,
          words: result?.words || [],
          image_width: result?.image_width || 1,
          image_height: result?.image_height || 1,
        }),
      });

      const data = await readResponse(
        response,
        "Unable to extract document insights."
      );

      setInsights(data);
    } catch (err) {
      setError(`Insights failed: ${err.message}`);
    } finally {
      setInsightsLoading(false);
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
    setIsSupported(null);
    setPassages([]);
    setSupportingEvidence([]);
    setActivePassageIndex(null);
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
          words: result?.words || [],
          image_width: result?.image_width || 1,
          image_height: result?.image_height || 1,
        }),
      });

      const data = await readResponse(
        response,
        "Unable to answer this question."
      );

      setAnswer(data.answer || "No answer was returned.");
      setIsSupported(typeof data.is_supported === "boolean" ? data.is_supported : true);
      setPassages(Array.isArray(data.passages) ? data.passages : []);
      const evidenceList = Array.isArray(data.supporting_evidence) ? data.supporting_evidence : [];
      setSupportingEvidence(evidenceList);

      // If the answer returned evidence, optionally auto-select the first found evidence
      const firstFoundIndex = evidenceList.findIndex(e => e.found && e.occurrences?.length > 0);
      if (firstFoundIndex >= 0) {
        highlightPassageEvidence(evidenceList[firstFoundIndex], firstFoundIndex);
      }
    } catch (err) {
      setError(`Question failed: ${err.message}`);
    } finally {
      setAnswerLoading(false);
    }
  }

  function highlightPassageEvidence(item, index) {
    if (!item) return;
    setActivePassageIndex(index);
    if (item.found && item.occurrences?.length > 0) {
      setSelectedWord({ text: item.passage });
      setEvidence({
        found: true,
        quote: item.passage,
        matched_text: item.occurrences[0].matched_text,
        occurrence_count: item.occurrences.length,
        occurrences: item.occurrences,
        highlight_box: item.highlight_box || item.occurrences[0].highlight_box,
        image_size: {
          width: result?.image_width,
          height: result?.image_height,
        },
      });
      setOccurrenceIndex(0);
    }
  }

  function highlightEvidenceObject(evidenceObj, labelText) {
    if (!evidenceObj || !evidenceObj.found || !evidenceObj.occurrences?.length) return;
    setSelectedWord({ text: labelText || evidenceObj.occurrences[0]?.matched_text });
    setEvidence({
      found: true,
      quote: labelText || evidenceObj.occurrences[0]?.matched_text,
      matched_text: evidenceObj.occurrences[0].matched_text,
      occurrence_count: evidenceObj.occurrences.length,
      occurrences: evidenceObj.occurrences,
      highlight_box: evidenceObj.highlight_box || evidenceObj.occurrences[0].highlight_box,
      image_size: {
        width: result?.image_width,
        height: result?.image_height,
      },
    });
    setOccurrenceIndex(0);
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

              {/* Document Insights */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>05</span>
                  <h3>Document insights</h3>
                </div>

                <p className="click-hint">
                  Automatically extract structured metadata, key points, action items,
                  and deadlines strictly grounded in the document text.
                </p>

                {!aiStatusChecked ? (
                  <p role="status">Checking AI availability...</p>
                ) : !aiConfigured ? (
                  <p role="status">
                    AI features are not configured. Set up a supported AI
                    provider in the backend to enable Document Insights.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={generateInsights}
                    disabled={insightsLoading || !editedText.trim()}
                  >
                    {insightsLoading ? "Extracting insights..." : "Extract document insights"}
                  </button>
                )}

                {insightsLoading && (
                  <p role="status">Analyzing document and validating facts...</p>
                )}

                {insights && (
                  <div className="evidence-info" style={{ ...outputStyle, gap: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", borderBottom: "1px solid #e5defb", paddingBottom: "10px" }}>
                      <strong>Structured Summary</strong>
                      <span className="status-pill" style={{ fontSize: "11px", color: "#1e7e4e", background: "#edfbf3", borderColor: "#c3eeda" }}>
                        ✓ Grounded in Document
                      </span>
                    </div>

                    {/* Metadata Grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", width: "100%" }}>
                      {/* Subject */}
                      <div style={{ padding: "10px", background: "#fff", border: "1px solid #e6e2f5", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", fontWeight: "700", color: "#6b56c7", textTransform: "uppercase" }}>Subject / Topic</div>
                        <div lang="kn" style={{ fontSize: "13px", fontWeight: "600", color: "#252238", marginTop: "4px" }}>
                          {insights.subject || <span style={{ color: "#8a8799", fontWeight: "normal" }}>Not found in document</span>}
                        </div>
                        {insights.field_evidence?.subject?.evidence?.found && (
                          <button
                            type="button"
                            onClick={() => highlightEvidenceObject(insights.field_evidence.subject.evidence, insights.subject)}
                            style={{ marginTop: "6px", fontSize: "10px", color: "#725cde", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                          >
                            📍 View on document
                          </button>
                        )}
                      </div>

                      {/* Date */}
                      <div style={{ padding: "10px", background: "#fff", border: "1px solid #e6e2f5", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", fontWeight: "700", color: "#6b56c7", textTransform: "uppercase" }}>Date</div>
                        <div lang="kn" style={{ fontSize: "13px", fontWeight: "600", color: "#252238", marginTop: "4px" }}>
                          {insights.date || <span style={{ color: "#8a8799", fontWeight: "normal" }}>Not found in document</span>}
                        </div>
                        {insights.field_evidence?.date?.evidence?.found && (
                          <button
                            type="button"
                            onClick={() => highlightEvidenceObject(insights.field_evidence.date.evidence, insights.date)}
                            style={{ marginTop: "6px", fontSize: "10px", color: "#725cde", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                          >
                            📍 View on document
                          </button>
                        )}
                      </div>

                      {/* Issuer */}
                      <div style={{ padding: "10px", background: "#fff", border: "1px solid #e6e2f5", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", fontWeight: "700", color: "#6b56c7", textTransform: "uppercase" }}>Issuer / Authority</div>
                        <div lang="kn" style={{ fontSize: "13px", fontWeight: "600", color: "#252238", marginTop: "4px" }}>
                          {insights.issuer || <span style={{ color: "#8a8799", fontWeight: "normal" }}>Not found in document</span>}
                        </div>
                        {insights.field_evidence?.issuer?.evidence?.found && (
                          <button
                            type="button"
                            onClick={() => highlightEvidenceObject(insights.field_evidence.issuer.evidence, insights.issuer)}
                            style={{ marginTop: "6px", fontSize: "10px", color: "#725cde", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                          >
                            📍 View on document
                          </button>
                        )}
                      </div>

                      {/* Recipient */}
                      <div style={{ padding: "10px", background: "#fff", border: "1px solid #e6e2f5", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", fontWeight: "700", color: "#6b56c7", textTransform: "uppercase" }}>Recipient / Target</div>
                        <div lang="kn" style={{ fontSize: "13px", fontWeight: "600", color: "#252238", marginTop: "4px" }}>
                          {insights.recipient || <span style={{ color: "#8a8799", fontWeight: "normal" }}>Not found in document</span>}
                        </div>
                        {insights.field_evidence?.recipient?.evidence?.found && (
                          <button
                            type="button"
                            onClick={() => highlightEvidenceObject(insights.field_evidence.recipient.evidence, insights.recipient)}
                            style={{ marginTop: "6px", fontSize: "10px", color: "#725cde", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                          >
                            📍 View on document
                          </button>
                        )}
                      </div>

                      {/* Deadline */}
                      <div style={{ padding: "10px", background: insights.deadline ? "#fff9f2" : "#fff", border: insights.deadline ? "1px solid #fbd9b3" : "1px solid #e6e2f5", borderRadius: "8px" }}>
                        <div style={{ fontSize: "10px", fontWeight: "700", color: insights.deadline ? "#b85406" : "#6b56c7", textTransform: "uppercase" }}>Deadline / Last Date</div>
                        <div lang="kn" style={{ fontSize: "13px", fontWeight: "600", color: insights.deadline ? "#b85406" : "#252238", marginTop: "4px" }}>
                          {insights.deadline || <span style={{ color: "#8a8799", fontWeight: "normal" }}>Not found in document</span>}
                        </div>
                        {insights.field_evidence?.deadline?.evidence?.found && (
                          <button
                            type="button"
                            onClick={() => highlightEvidenceObject(insights.field_evidence.deadline.evidence, insights.deadline)}
                            style={{ marginTop: "6px", fontSize: "10px", color: "#b85406", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                          >
                            📍 View on document
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Section Headings */}
                    {insights.section_headings?.length > 0 && (
                      <div style={{ width: "100%", marginTop: "4px" }}>
                        <div style={{ fontSize: "11px", fontWeight: "700", color: "#554b8c", marginBottom: "6px" }}>
                          Section Headings
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {insights.section_headings.map((h, i) => (
                            <span key={i} lang="kn" style={{ fontSize: "11px", background: "#f0edff", color: "#5945c5", padding: "3px 8px", borderRadius: "4px" }}>
                              {h}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Points */}
                    <div style={{ width: "100%", marginTop: "6px" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: "#554b8c", marginBottom: "8px" }}>
                        Key Points ({insights.key_points?.length || 0})
                      </div>
                      {(!insights.key_points || insights.key_points.length === 0) ? (
                        <p style={{ fontSize: "12px", color: "#8a8799", margin: 0 }}>No key points identified in document.</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {insights.key_points.map((kp, idx) => (
                            <div key={idx} style={{ padding: "8px 10px", background: "#fff", border: "1px solid #e6e2f5", borderRadius: "6px" }}>
                              <div lang="kn" style={{ fontSize: "12px", color: "#252238", lineHeight: "1.5" }}>
                                • {kp.text}
                              </div>
                              {kp.source_passage && (
                                <div style={{ marginTop: "4px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                                  <span lang="kn" style={{ fontSize: "11px", color: "#67667a", fontStyle: "italic" }}>
                                    "{kp.source_passage}"
                                  </span>
                                  {kp.evidence?.found && (
                                    <button
                                      type="button"
                                      onClick={() => highlightEvidenceObject(kp.evidence, kp.source_passage)}
                                      style={{ fontSize: "10px", color: "#725cde", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "underline" }}
                                    >
                                      📍 Locate
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Action Items */}
                    <div style={{ width: "100%", marginTop: "6px" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: "#554b8c", marginBottom: "8px" }}>
                        Required Actions ({insights.action_items?.length || 0})
                      </div>
                      {(!insights.action_items || insights.action_items.length === 0) ? (
                        <p style={{ fontSize: "12px", color: "#8a8799", margin: 0 }}>No explicit action items required by this document.</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {insights.action_items.map((ai, idx) => (
                            <div key={idx} style={{ padding: "8px 10px", background: "#fff", border: "1px solid #e6e2f5", borderRadius: "6px" }}>
                              <div lang="kn" style={{ fontSize: "12px", color: "#252238", lineHeight: "1.5", fontWeight: "600" }}>
                                ✓ {ai.text}
                              </div>
                              {ai.source_passage && (
                                <div style={{ marginTop: "4px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                                  <span lang="kn" style={{ fontSize: "11px", color: "#67667a", fontStyle: "italic" }}>
                                    "{ai.source_passage}"
                                  </span>
                                  {ai.evidence?.found && (
                                    <button
                                      type="button"
                                      onClick={() => highlightEvidenceObject(ai.evidence, ai.source_passage)}
                                      style={{ fontSize: "10px", color: "#725cde", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "underline" }}
                                    >
                                      📍 Locate
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Grounded document Q&A */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>06</span>
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
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: "10px", flexWrap: "wrap" }}>
                      <strong>Answer</strong>
                      {isSupported !== null && (
                        <span
                          className="status-pill"
                          style={{
                            fontSize: "11px",
                            padding: "4px 10px",
                            color: isSupported ? "#1e7e4e" : "#b03a3a",
                            background: isSupported ? "#edfbf3" : "#fdf2f2",
                            borderColor: isSupported ? "#c3eeda" : "#f7cfcf",
                          }}
                        >
                          {isSupported ? "✓ Document Supported" : "⚠ Not Directly Supported"}
                        </span>
                      )}
                    </div>
                    <p lang="kn" style={paragraphStyle}>
                      {answer}
                    </p>

                    {/* Supporting source passages */}
                    {supportingEvidence.length > 0 && (
                      <div style={{ marginTop: "14px", width: "100%", borderTop: "1px solid #e5defb", paddingTop: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                          <span style={{ fontSize: "11px", fontWeight: "700", color: "#6b56c7", textTransform: "uppercase", letterSpacing: "0.8px" }}>
                            Supporting Source Passages ({supportingEvidence.length})
                          </span>
                          <span style={{ fontSize: "10px", color: "#8a8799" }}>
                            Click a passage to highlight in image
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {supportingEvidence.map((item, idx) => {
                            const isSelected = activePassageIndex === idx;
                            return (
                              <div
                                key={idx}
                                onClick={() => highlightPassageEvidence(item, idx)}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: "8px",
                                  border: isSelected
                                    ? "1.5px solid #725cde"
                                    : "1px solid #e6e2f5",
                                  background: isSelected ? "#f4f0ff" : "#ffffff",
                                  cursor: item.found ? "pointer" : "default",
                                  transition: "all 0.15s ease",
                                }}
                                title={item.found ? "Click to view highlight on document" : "Exact image coordinates not found for this quote"}
                              >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" }}>
                                  <span style={{ fontSize: "10px", fontWeight: "700", color: "#554b8c" }}>
                                    Passage #{idx + 1}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: "600",
                                      color: item.found ? "#25825b" : "#8b8999",
                                    }}
                                  >
                                    {item.found
                                      ? `📍 Highlighted in image (${item.occurrence_count} match${item.occurrence_count > 1 ? "es" : ""})`
                                      : "📄 Text excerpt"}
                                  </span>
                                </div>
                                <blockquote
                                  lang="kn"
                                  style={{
                                    margin: 0,
                                    fontSize: "13px",
                                    lineHeight: "1.6",
                                    color: "#252238",
                                    fontStyle: "normal",
                                    borderLeft: isSelected ? "3px solid #725cde" : "3px solid #cfc7f5",
                                    paddingLeft: "8px",
                                  }}
                                >
                                  "{item.passage}"
                                </blockquote>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
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
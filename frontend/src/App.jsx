
import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selectedWord, setSelectedWord] = useState(null);
  const [evidence, setEvidence] = useState(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(selectedFile.type)) {
      setError("Please upload a JPG, PNG, or WebP image.");
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("Please choose an image smaller than 10 MB.");
      return;
    }

    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
    setResult(null);
    setSelectedWord(null);
    setEvidence(null);
    setError("");
  }

  async function extractText() {
    if (!file) {
      setError("Please upload a Kannada document image first.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    setSelectedWord(null);
    setEvidence(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("http://127.0.0.1:8000/api/extract?psm=6", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Text extraction failed.");
      }

      setResult(data);
    } catch (err) {
      setError(
        err.message.includes("fetch")
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
    setEvidenceLoading(true);
    setError("");

    try {
      const response = await fetch("http://127.0.0.1:8000/api/evidence", {
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Evidence lookup failed.");
      }

      setEvidence(data);
    } catch (err) {
      setError(`Evidence lookup failed: ${err.message}`);
    } finally {
      setEvidenceLoading(false);
    }
  }

  async function copyExtractedText() {
    const text = (result?.words || [])
      .map((word) => word.text)
      .join(" ");

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Unable to copy text. Please select and copy it manually.");
    }
  }

  const highlightBox = evidence?.found ? evidence.highlight_box : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="LipiQ home">
          <span className="brand-mark">ಲಿ</span>
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
              <span className="point-check">✓</span> Built for clarity
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
                <span className="privacy-icon">⌑</span>
                Your document is processed by your local OCR backend.
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
                          title={`Evidence: ${evidence.matched_text}`}
                        />
                      )}
                    </div>
                  </div>

                  <p className="panel-footnote">
                    {result.image_width} × {result.image_height} pixels
                    {highlightBox && (
                      <span className="evidence-status">
                        {" "}
                        · Evidence located
                      </span>
                    )}
                  </p>

                  {selectedWord && (
                    <div className="evidence-info">
                      <strong>Selected word</strong>
                      <span lang="kn">{selectedWord.text}</span>

                      {evidenceLoading && <p>Locating source evidence...</p>}

                      {!evidenceLoading && evidence?.found && (
                        <p>
                          Matched in the original document. The purple outline
                          marks the detected location.
                        </p>
                      )}

                      {!evidenceLoading && evidence && !evidence.found && (
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
                    >
                      Copy text ↗
                    </button>
                  </div>

                  <p className="click-hint">
                    Click any word to locate it in the original document.
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
                        title="Click to locate this word in the original document"
                      >
                        {word.text}
                      </button>
                    ))}

                    {(!result.words || result.words.length === 0) && (
                      <p>
                        No text was detected in this image. Try a clearer image.
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

export default App;

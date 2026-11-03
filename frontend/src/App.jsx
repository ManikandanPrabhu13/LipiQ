import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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
  const [extractProgress, setExtractProgress] = useState("");
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

  // Smart OCR Correction state
  const [corrections, setCorrections] = useState([]);
  const [correctedText, setCorrectedText] = useState("");
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState("");
  const [correctionCopied, setCorrectionCopied] = useState(false);

  // Kannada handwriting recognition state
  const [handwritingMode, setHandwritingMode] = useState(false);
  const [handwritingLoading, setHandwritingLoading] = useState(false);
  const [handwritingResult, setHandwritingResult] = useState(null);
  const [handwritingError, setHandwritingError] = useState("");
  const [handwrittenText, setHandwrittenText] = useState("");
  const [hwCopied, setHwCopied] = useState(false);

  // Voice Reader state (Kannada & English SpeechSynthesis)
  const [voiceSource, setVoiceSource] = useState("document"); // "document" | "summary"
  const [voiceLang, setVoiceLang] = useState("kn-IN"); // "kn-IN" | "en-IN"
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [voiceWarning, setVoiceWarning] = useState("");
  const [availableVoices, setAvailableVoices] = useState([]);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(null);
  const sentenceRangesRef = useRef([]);
  const activeSentenceIndexRef = useRef(null);

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

  // Initialize SpeechSynthesis voices
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    function updateVoices() {
      const voices = window.speechSynthesis.getVoices() || [];
      setAvailableVoices(voices);
    }

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Stop speech when document source or language changes
  useEffect(() => {
    stopVoiceReader();
    setVoiceWarning("");
  }, [voiceSource, voiceLang]);

  function stopVoiceReader() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setVoicePlaying(false);
    setVoicePaused(false);
    setActiveSentenceIndex(null);
    activeSentenceIndexRef.current = null;
    sentenceRangesRef.current = [];
  }

  function detectKannadaText(str) {
    return /[\u0C80-\u0CFF]/.test(str || "");
  }

  // Feature 2: Clean Markdown Before Speech
  function cleanMarkdownForSpeech(md) {
    if (!md) return "";
    let text = md;
    // Replace markdown links [label](url) with just label
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // Remove raw URLs so they are not read aloud
    text = text.replace(/https?:\/\/\S+/g, "");
    // Remove Markdown heading markers (e.g. ### Title -> Title)
    text = text.replace(/^[ \t]*#+[ \t]+/gm, "");
    // Convert bullets (*, -, •) to natural speech flow without speaking symbols
    text = text.replace(/^[ \t]*[-*•][ \t]+/gm, "");
    // Remove bold and italic markers (*, _, ~, `)
    text = text.replace(/[*_~`]/g, "");
    // Numbered lists: keep number and content cleanly (e.g. 1. Item -> 1. Item)
    text = text.replace(/^[ \t]*(\d+)\.[ \t]+/gm, "$1. ");
    return text.trim();
  }

  // Split text into coherent sentence segments for display and highlighting
  function getSentenceSegments(text) {
    if (!text) return [];
    // Split on Kannada danda (। ॥), English punctuation (. ! ?), or newlines
    const regex = /[^।॥.!?\r\n]+(?:[।॥.!?]+|\n+|$)/g;
    const rawMatches = text.match(regex) || [];
    const merged = [];
    let buf = "";

    for (const r of rawMatches) {
      if (!r.trim()) {
        if (merged.length > 0) {
          merged[merged.length - 1] += r;
        } else {
          buf += r;
        }
        continue;
      }
      buf += r;
      const clean = buf.trim();
      // Keep together if it is just a short number or single token like '1.'
      if (/^\d+\.?$/.test(clean) || clean.length <= 2) {
        continue;
      }
      merged.push(buf);
      buf = "";
    }
    if (buf) {
      if (merged.length > 0) {
        merged[merged.length - 1] += buf;
      } else {
        merged.push(buf);
      }
    }
    return merged;
  }

  function handleVoicePlay() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceWarning("Browser speech synthesis is not supported on this device.");
      return;
    }

    // Determine target raw text
    const rawText = voiceSource === "summary" ? summary.trim() : editedText.trim();
    if (!rawText) {
      setVoiceWarning(
        voiceSource === "summary"
          ? "No AI summary available to read. Generate a summary first."
          : "No document text available to read."
      );
      return;
    }

    // If currently paused, resume
    if (voicePaused) {
      window.speechSynthesis.resume();
      setVoicePaused(false);
      setVoicePlaying(true);
      return;
    }

    // Cancel any previous utterance
    window.speechSynthesis.cancel();
    setActiveSentenceIndex(null);
    activeSentenceIndexRef.current = null;

    // Check script/language alignment
    const containsKannada = detectKannadaText(rawText);
    let warningMsg = "";
    if (voiceLang === "kn-IN" && !containsKannada) {
      warningMsg = "Document contains non-Kannada text. Kannada voice pronunciation may sound unusual.";
    } else if (voiceLang === "en-IN" && containsKannada) {
      warningMsg = "Document contains Kannada text. English voice pronunciation may sound incorrect.";
    }

    // Build sentence segments and speech text
    const segments = getSentenceSegments(rawText);
    const speechUnits = [];
    let currentSpeechPos = 0;

    for (let i = 0; i < segments.length; i++) {
      const segRaw = segments[i];
      const spokenPart = voiceSource === "summary" ? cleanMarkdownForSpeech(segRaw) : segRaw;
      const spokenTrimmed = spokenPart.trim() || segRaw.trim();
      const start = currentSpeechPos;
      const end = start + spokenTrimmed.length;
      speechUnits.push({
        index: i,
        raw: segRaw,
        spoken: spokenTrimmed,
        start,
        end,
      });
      // Separate spoken sentences with a space/period pause
      currentSpeechPos = end + 2;
    }

    sentenceRangesRef.current = speechUnits;

    // Build exact text passed to SpeechSynthesis
    const targetText = speechUnits.map((u) => u.spoken).join(". ");
    if (!targetText.trim()) {
      setVoiceWarning("No readable text found for playback.");
      return;
    }

    // Find best voice match
    const voices = availableVoices.length > 0 ? availableVoices : (window.speechSynthesis.getVoices() || []);
    let selectedVoice = null;

    if (voiceLang === "kn-IN") {
      selectedVoice = voices.find(
        (v) => v.lang.toLowerCase().startsWith("kn") || v.name.toLowerCase().includes("kannada")
      );
    } else if (voiceLang === "en-IN") {
      selectedVoice = voices.find((v) => v.lang.toLowerCase().replace("_", "-") === "en-in") ||
        voices.find((v) => v.lang.toLowerCase().startsWith("en-")) ||
        voices.find((v) => v.lang.toLowerCase().startsWith("en"));
    }

    if (!selectedVoice) {
      selectedVoice = voices.find((v) => v.lang.toLowerCase().startsWith(voiceLang.slice(0, 2)));
    }

    if (!selectedVoice) {
      const langName = voiceLang === "kn-IN" ? "Kannada (kn-IN)" : "English (en-IN)";
      setVoiceWarning(
        `No dedicated ${langName} voice found in your browser/OS. Speech may use default voice or fail to pronounce properly.`
      );
    } else if (warningMsg) {
      setVoiceWarning(warningMsg);
    } else {
      setVoiceWarning("");
    }

    const utterance = new SpeechSynthesisUtterance(targetText);
    utterance.lang = voiceLang;
    utterance.rate = voiceSpeed;
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    // Highlighting sync via onboundary events
    utterance.onboundary = (event) => {
      if (event.name === "sentence" || event.name === "word") {
        const charIdx = event.charIndex;
        const units = sentenceRangesRef.current;
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          if (charIdx >= u.start && charIdx <= u.end + 2) {
            if (activeSentenceIndexRef.current !== u.index) {
              activeSentenceIndexRef.current = u.index;
              setActiveSentenceIndex(u.index);
            }
            break;
          }
        }
      }
    };

    utterance.onstart = () => {
      setVoicePlaying(true);
      setVoicePaused(false);
      // Start highlight on the first sentence
      if (speechUnits.length > 0) {
        activeSentenceIndexRef.current = 0;
        setActiveSentenceIndex(0);
      }
    };

    utterance.onend = () => {
      setVoicePlaying(false);
      setVoicePaused(false);
      setActiveSentenceIndex(null);
      activeSentenceIndexRef.current = null;
    };

    utterance.onerror = (e) => {
      console.warn("SpeechSynthesis error:", e);
      setVoicePlaying(false);
      setVoicePaused(false);
      setActiveSentenceIndex(null);
      activeSentenceIndexRef.current = null;
      if (e.error !== "canceled" && e.error !== "interrupted") {
        setVoiceWarning(`Speech playback error: ${e.error}`);
      }
    };

    window.speechSynthesis.speak(utterance);
    setVoicePlaying(true);
    setVoicePaused(false);
  }

  function handleVoicePause() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        setVoicePaused(true);
        setVoicePlaying(false);
      }
    }
  }

  function handleVoiceResume() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setVoicePaused(false);
        setVoicePlaying(true);
      } else {
        handleVoicePlay();
      }
    }
  }

  function handleVoiceSpeedChange(newSpeed) {
    setVoiceSpeed(newSpeed);
    // If currently speaking, restart with new speed
    if (voicePlaying && !voicePaused) {
      setTimeout(() => {
        handleVoicePlay();
      }, 50);
    }
  }

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
    setCorrections([]);
    setCorrectedText("");
    setCorrectionMessage("");
    setCorrectionCopied(false);
    setHandwritingResult(null);
    setHandwritingError("");
    setHandwrittenText("");
    setHwCopied(false);
    stopVoiceReader();
    setVoiceWarning("");
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

    if (loading) return; // Prevent duplicate concurrent extractions

    setLoading(true);
    setExtractProgress("Optimizing image and running neural OCR...");
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
      setExtractProgress("");
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

  // Smart OCR Correction handlers
  function computeCorrectedText(currentCorrs, baseText) {
    const accepted = currentCorrs.filter((c) => c.status === "accepted");
    // Sort descending by start position to avoid offset drift
    const sorted = [...accepted].sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
    let text = baseText;
    for (const c of sorted) {
      const s = c.start;
      const e = c.end;
      if (s !== undefined && e !== undefined && s >= 0 && e <= text.length && s <= e) {
        text = text.slice(0, s) + c.suggested + text.slice(e);
      }
    }
    return text;
  }

  async function requestCorrections() {
    const textToCorrect = editedText.trim();
    if (!textToCorrect) {
      setError("Please ensure there is extracted or edited text to correct.");
      return;
    }

    setCorrectionLoading(true);
    setCorrectionMessage("");
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/correct-ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToCorrect,
          context: null,
          word_confidences: null,
        }),
      });

      const data = await readResponse(response, "Smart OCR correction failed.");
      const list = Array.isArray(data.corrections) ? data.corrections : [];
      setCorrections(list);
      setCorrectionMessage(data.message || `${list.length} correction suggestions found.`);
      setCorrectedText(data.corrected_text || textToCorrect);
    } catch (err) {
      setError(`Smart correction error: ${err.message}`);
    } finally {
      setCorrectionLoading(false);
    }
  }

  function handleAcceptCorrection(index) {
    const updated = corrections.map((item, idx) =>
      idx === index ? { ...item, status: "accepted" } : item
    );
    setCorrections(updated);
    setCorrectedText(computeCorrectedText(updated, editedText));
  }

  function handleRejectCorrection(index) {
    const updated = corrections.map((item, idx) =>
      idx === index ? { ...item, status: "rejected" } : item
    );
    setCorrections(updated);
    setCorrectedText(computeCorrectedText(updated, editedText));
  }

  function handleAcceptAllCorrections() {
    const updated = corrections.map((item) => ({ ...item, status: "accepted" }));
    setCorrections(updated);
    setCorrectedText(computeCorrectedText(updated, editedText));
  }

  function handleRejectAllCorrections() {
    const updated = corrections.map((item) => ({ ...item, status: "rejected" }));
    setCorrections(updated);
    setCorrectedText(editedText);
  }

  async function copyCorrectedText() {
    if (!correctedText.trim()) return;
    try {
      await navigator.clipboard.writeText(correctedText);
      setCorrectionCopied(true);
      setTimeout(() => setCorrectionCopied(false), 2000);
    } catch {
      setError("Could not copy corrected text to clipboard.");
    }
  }

  function downloadCorrectedText() {
    if (!correctedText.trim()) return;
    const blob = new Blob([correctedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lipiq-smart-corrected.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  function applyCorrectionsToEditor() {
    if (!correctedText.trim()) return;
    setEditedText(correctedText);
    setSummary("");
    setAnswer("");
  }

  // Handwriting actions
  async function transcribeHandwriting() {
    if (!file) {
      setHandwritingError("Please upload a handwritten Kannada document image first.");
      return;
    }

    if (handwritingLoading) return; // Prevent duplicate concurrent requests

    setHandwritingLoading(true);
    setHandwritingError("");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

      let response;
      try {
        response = await fetch(`${API_BASE}/api/handwriting`, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await readResponse(
        response,
        "Handwriting transcription failed."
      );

      setHandwritingResult(data);
      const text = data.transcribed_text || "";
      setHandwrittenText(text);
      // Automatically initialize editedText so AI features immediately work
      setEditedText(text);
      setSummary("");
      setAnswer("");
      setInsights(null);
    } catch (err) {
      let msg = err.message || "";
      if (err.name === "AbortError") {
        msg = "Request timed out after 45s. The cloud vision service might be busy; please retry.";
      } else if (msg.toLowerCase().includes("fetch")) {
        msg = `Cannot reach backend at ${API_BASE}. Make sure the server is awake and accessible.`;
      }
      setHandwritingError(msg);
    } finally {
      setHandwritingLoading(false);
    }
  }

  async function copyHandwrittenText() {
    const textToCopy = handwrittenText || editedText;
    if (!textToCopy.trim()) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setHwCopied(true);
      setTimeout(() => setHwCopied(false), 2000);
    } catch {
      setHandwritingError("Could not copy transcribed text to clipboard.");
    }
  }

  function downloadHandwrittenText() {
    const textToDownload = handwrittenText || editedText;
    if (!textToDownload.trim()) return;
    const blob = new Blob([textToDownload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lipiq-handwriting-transcription.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  function applyHandwritingToEditor() {
    const textToApply = handwrittenText.trim() || editedText.trim();
    if (!textToApply) return;
    setEditedText(textToApply);
    setSummary("");
    setAnswer("");
    setInsights(null);
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
          <button
            type="button"
            className="mode-toggle"
            onClick={() => {
              setHandwritingMode(!handwritingMode);
              setError("");
              setHandwritingError("");
            }}
            aria-label={handwritingMode ? "Switch to printed OCR mode" : "Switch to Kannada handwriting mode"}
            style={{
              padding: "6px 14px",
              borderRadius: "8px",
              border: "1px solid #725cde",
              background: handwritingMode ? "#725cde" : "#ffffff",
              color: handwritingMode ? "#ffffff" : "#725cde",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {handwritingMode ? "✍ Handwriting Mode" : "📄 Printed OCR"}
          </button>
          <span className="status-pill">
            <span className="status-dot" />
            {handwritingMode ? "Handwriting workspace" : "OCR workspace"}
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
              <h2>
                {handwritingMode
                  ? "Transcribe handwritten Kannada documents."
                  : "Bring your document to life."}
              </h2>
            </div>
            <span className="step-label">
              {handwritingMode ? "01 / HANDWRITING RECOGNITION" : "01 / UPLOAD & EXTRACT"}
            </span>
          </div>

          <div className="upload-card">
            <div className="upload-intro">
              <div className="upload-icon">{handwritingMode ? "✍" : "↑"}</div>
              <div>
                <h3>
                  {handwritingMode
                    ? "Upload a handwritten Kannada document"
                    : "Upload a Kannada document"}
                </h3>
                <p>
                  {handwritingMode
                    ? "Choose a photo or scan of handwritten Kannada text to transcribe."
                    : "Start with a clear image of a printed Kannada document."}
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

            {(error || (handwritingMode && handwritingError)) && (
              <div className="error-message" role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                <span>{handwritingMode && handwritingError ? handwritingError : error}</span>
                {handwritingMode && handwritingError && file && (
                  <button
                    type="button"
                    onClick={transcribeHandwriting}
                    disabled={handwritingLoading}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      borderRadius: "4px",
                      border: "1px solid var(--accent, #e53935)",
                      background: "white",
                      cursor: "pointer",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Retry ↺
                  </button>
                )}
              </div>
            )}

            <div className="upload-footer">
              <p>
                <span className="privacy-icon">▣</span>
                {handwritingMode
                  ? "Image transcription uses cloud vision AI with Kannada recognition."
                  : "Your image is processed by your local OCR backend."}
              </p>

              {handwritingMode ? (
                <button
                  className="primary-button"
                  onClick={transcribeHandwriting}
                  disabled={!file || handwritingLoading}
                >
                  {handwritingLoading ? "Transcribing handwriting..." : "Transcribe Kannada handwriting"}
                  {!handwritingLoading && <span>↗</span>}
                </button>
              ) : (
                <button
                  className="primary-button"
                  onClick={extractText}
                  disabled={!file || loading}
                >
                  {loading ? "Extracting text..." : "Extract Kannada text"}
                  {!loading && <span>↗</span>}
                </button>
              )}
              {loading && extractProgress && (
                <p role="status" style={{ marginTop: "8px", fontSize: "13px", color: "var(--accent)" }}>
                  {extractProgress}
                </p>
              )}
            </div>
          </div>

          {/* Handwriting Recognition Results */}
          {handwritingResult && (
            <section className="results-section" aria-live="polite">
              <div className="results-heading">
                <div>
                  <p className="section-kicker">TRANSCRIPTION COMPLETE</p>
                  <h2>Your handwritten document, digitized.</h2>
                </div>

                <span className="result-badge">
                  <span className="status-dot" />
                  Handwriting transcribed
                </span>
              </div>

              <div className="results-grid">
                <div className="result-panel document-panel">
                  <div className="panel-heading">
                    <span>01</span>
                    <h3>Handwritten image</h3>
                  </div>

                  <div className="document-image-wrap">
                    <div className="document-image-stage">
                      <img
                        src={preview}
                        alt="Uploaded handwritten Kannada document"
                      />
                    </div>
                  </div>

                  <p className="panel-footnote">
                    {handwritingResult.image_width} × {handwritingResult.image_height} pixels
                    {handwritingResult.provider && (
                      <span> · Powered by {handwritingResult.provider} vision</span>
                    )}
                  </p>
                </div>

                <div className="result-panel text-panel">
                  <div className="panel-heading">
                    <span>02</span>
                    <h3>Kannada transcription</h3>

                    <button
                      className="copy-button"
                      onClick={copyHandwrittenText}
                      type="button"
                    >
                      {hwCopied ? "Copied!" : "Copy text ↗"}
                    </button>
                  </div>

                  <p className="click-hint">
                    Uncertain words are marked with [ಅಸ್ಪಷ್ಟ]. You can edit and refine the text below.
                  </p>

                  <div className="ocr-text" lang="kn" style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
                    {handwrittenText || (
                      <p>No handwritten text could be transcribed. Try a clearer image.</p>
                    )}
                  </div>

                  <div className="result-stats">
                    <div>
                      <strong>
                        {(handwrittenText || "").split(/\s+/).filter(Boolean).length}
                      </strong>
                      <span>Words transcribed</span>
                    </div>

                    <div>
                      <strong>{handwritingResult.lines?.length || 1}</strong>
                      <span>Lines detected</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Editable Transcription output */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>03</span>
                  <h3>Edit transcribed text</h3>
                </div>

                <p className="click-hint">
                  Refine handwritten transcription here. Any edits automatically flow into Document Summary, Insights, and Q&A.
                </p>

                <textarea
                  lang="kn"
                  aria-label="Editable handwritten Kannada text"
                  value={editedText}
                  onChange={(event) => {
                    setEditedText(event.target.value);
                    setHandwrittenText(event.target.value);
                    setSummary("");
                    setAnswer("");
                  }}
                  rows={9}
                  placeholder="Transcribed Kannada text will appear here..."
                  style={textAreaStyle}
                />

                <div style={actionRowStyle}>
                  <button
                    type="button"
                    className="copy-button"
                    onClick={copyHandwrittenText}
                    disabled={!editedText.trim()}
                  >
                    {hwCopied ? "Copied!" : "Copy text"}
                  </button>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={downloadHandwrittenText}
                    disabled={!editedText.trim()}
                  >
                    Download .txt ↗
                  </button>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={applyHandwritingToEditor}
                    disabled={!editedText.trim()}
                    style={{ background: "#483d8b" }}
                  >
                    Sync to AI features
                  </button>
                </div>
              </section>

              {/* AI summary for handwriting */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>04</span>
                  <h3>Document summary</h3>
                </div>

                <p className="click-hint">
                  Generate a concise summary and key points from your transcribed handwritten text.
                </p>

                {!aiStatusChecked ? (
                  <p role="status">Checking AI availability...</p>
                ) : !aiConfigured ? (
                  <p role="status">
                    AI features are not configured. Set up a supported AI provider in the backend to enable summaries.
                  </p>
                ) : (
                  <div style={actionRowStyle}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={summarizeDocument}
                      disabled={summaryLoading || !editedText.trim()}
                    >
                      {summaryLoading ? "Generating summary..." : "Summarize transcription"}
                    </button>
                  </div>
                )}

                {summary && (
                  <div style={outputStyle}>
                    <h4 style={{ marginBottom: "8px" }}>Summary</h4>
                    <p style={paragraphStyle} lang="kn">
                      {voicePlaying && voiceSource === "summary" && activeSentenceIndex !== null ? (
                        getSentenceSegments(summary).map((seg, idx) => (
                          <span
                            key={idx}
                            style={{
                              background: idx === activeSentenceIndex ? "rgba(114, 92, 222, 0.22)" : "transparent",
                              borderRadius: "4px",
                              padding: idx === activeSentenceIndex ? "2px 4px" : "0",
                              transition: "background 0.2s ease",
                              fontWeight: idx === activeSentenceIndex ? "600" : "normal",
                            }}
                          >
                            {seg}
                          </span>
                        ))
                      ) : (
                        summary
                      )}
                    </p>
                  </div>
                )}
              </section>

              {/* Document Insights for handwriting */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>05</span>
                  <h3>Document Insights</h3>
                </div>

                <p className="click-hint">
                  Extract structured metadata, dates, entities, and key points from handwritten content.
                </p>

                {!aiStatusChecked ? (
                  <p role="status">Checking AI availability...</p>
                ) : !aiConfigured ? (
                  <p role="status">AI features are not configured.</p>
                ) : (
                  <div style={actionRowStyle}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={extractDocumentInsights}
                      disabled={insightsLoading || !editedText.trim()}
                    >
                      {insightsLoading ? "Extracting insights..." : "Extract insights"}
                    </button>
                  </div>
                )}

                {insights && (
                  <div style={outputStyle}>
                    {insights.document_type && (
                      <p><strong>Document Type:</strong> {insights.document_type}</p>
                    )}
                    {insights.key_points && insights.key_points.length > 0 && (
                      <div>
                        <h4 style={{ margin: "12px 0 8px" }}>Key Points</h4>
                        <ul>
                          {insights.key_points.map((pt, i) => (
                            <li key={i} lang="kn" style={{ marginBottom: "6px" }}>{pt}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Q&A for handwriting */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>06</span>
                  <h3>Ask questions about this document</h3>
                </div>

                <p className="click-hint">
                  Ask any question about the transcribed handwritten text.
                </p>

                {!aiStatusChecked ? (
                  <p role="status">Checking AI availability...</p>
                ) : !aiConfigured ? (
                  <p role="status">AI features are not configured.</p>
                ) : (
                  <form onSubmit={handleAskQuestion}>
                    <label htmlFor="hw-question-input" style={labelStyle}>
                      Question in English or Kannada:
                    </label>

                    <input
                      id="hw-question-input"
                      type="text"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="e.g. ಈ ದಾಖಲೆಯ ಮುಖ್ಯ ವಿಷಯವೇನು? / What is this document about?"
                      style={inputStyle}
                      disabled={answerLoading}
                    />

                    <div style={actionRowStyle}>
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={answerLoading || !question.trim() || !editedText.trim()}
                      >
                        {answerLoading ? "Searching document..." : "Ask LipiQ"}
                      </button>
                    </div>
                  </form>
                )}

                {answer && (
                  <div style={outputStyle}>
                    <h4 style={{ marginBottom: "8px" }}>Answer</h4>
                    <p style={paragraphStyle} lang="kn">
                      {answer}
                    </p>
                  </div>
                )}
              </section>

              {/* LipiQ Voice Reader for Handwriting */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>07</span>
                  <h3>LipiQ Voice Reader</h3>
                </div>

                <p className="click-hint">
                  Listen to the transcribed document or AI summary in spoken Kannada (kn-IN) or English (en-IN).
                </p>

                {/* Source and Language selectors */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "14px", alignItems: "center" }}>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: "4px", fontSize: "12px", color: "#554b8c" }}>
                      Content to read:
                    </label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceSource("document");
                          setVoiceWarning("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          border: voiceSource === "document" ? "1.5px solid #725cde" : "1px solid #d8d4e8",
                          background: voiceSource === "document" ? "#f4f0ff" : "#fff",
                          color: voiceSource === "document" ? "#5945c5" : "#4a4658",
                          cursor: "pointer",
                        }}
                      >
                        📄 Full Document
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceSource("summary");
                          setVoiceWarning("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          border: voiceSource === "summary" ? "1.5px solid #725cde" : "1px solid #d8d4e8",
                          background: voiceSource === "summary" ? "#f4f0ff" : "#fff",
                          color: voiceSource === "summary" ? "#5945c5" : "#4a4658",
                          cursor: "pointer",
                        }}
                      >
                        ✨ AI Summary
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ ...labelStyle, marginBottom: "4px", fontSize: "12px", color: "#554b8c" }}>
                      Voice Language:
                    </label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceLang("kn-IN");
                          setVoiceWarning("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          border: voiceLang === "kn-IN" ? "1.5px solid #725cde" : "1px solid #d8d4e8",
                          background: voiceLang === "kn-IN" ? "#f4f0ff" : "#fff",
                          color: voiceLang === "kn-IN" ? "#5945c5" : "#4a4658",
                          cursor: "pointer",
                        }}
                      >
                        ಕನ್ನಡ (kn-IN)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceLang("en-IN");
                          setVoiceWarning("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          border: voiceLang === "en-IN" ? "1.5px solid #725cde" : "1px solid #d8d4e8",
                          background: voiceLang === "en-IN" ? "#f4f0ff" : "#fff",
                          color: voiceLang === "en-IN" ? "#5945c5" : "#4a4658",
                          cursor: "pointer",
                        }}
                      >
                        English (en-IN)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Speed Slider */}
                <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "12px" }}>
                  <label htmlFor="hw-voice-speed" style={{ fontSize: "12px", fontWeight: "600", color: "#554b8c", minWidth: "90px" }}>
                    Speed: {voiceSpeed.toFixed(2)}x
                  </label>
                  <input
                    id="hw-voice-speed"
                    type="range"
                    min="0.75"
                    max="1.5"
                    step="0.05"
                    value={voiceSpeed}
                    onChange={(e) => handleVoiceSpeedChange(parseFloat(e.target.value))}
                    style={{ flex: 1, maxWidth: "200px", cursor: "pointer" }}
                  />
                </div>

                {/* Playback Controls */}
                <div style={{ ...actionRowStyle, marginTop: "16px" }}>
                  {!voicePlaying ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleVoicePlay}
                      disabled={voiceSource === "summary" ? !summary.trim() : !editedText.trim()}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <span>▶</span> Play
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleVoicePause}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f59e0b" }}
                    >
                      <span>⏸</span> Pause
                    </button>
                  )}

                  {voicePaused && (
                    <button
                      type="button"
                      className="copy-button"
                      onClick={handleVoiceResume}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderColor: "#725cde", color: "#725cde" }}
                    >
                      <span>⏯</span> Resume
                    </button>
                  )}

                  <button
                    type="button"
                    className="copy-button"
                    onClick={stopVoiceReader}
                    disabled={!voicePlaying && !voicePaused}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <span>⏹</span> Stop
                  </button>

                  {(voicePlaying || voicePaused) && (
                    <span style={{ fontSize: "12px", color: voicePaused ? "#f59e0b" : "#25825b", fontWeight: "600" }}>
                      {voicePaused ? "Paused" : "Speaking..."}
                    </span>
                  )}
                </div>

                {/* Read-Along Currently Reading Cue */}
                {(voicePlaying || voicePaused) && activeSentenceIndex !== null && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "12px 16px",
                      background: "#f4f1fa",
                      borderRadius: "8px",
                      border: "1px solid #dcd7f2",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: voicePaused ? "#f59e0b" : "#725cde",
                          display: "inline-block",
                        }}
                      />
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "#554b8c" }}>
                        Currently reading {voiceSource === "summary" ? "(AI Summary)" : "(Full Document)"}:
                      </span>
                    </div>
                    <p
                      lang="kn"
                      style={{
                        margin: 0,
                        fontSize: "13px",
                        lineHeight: 1.6,
                        color: "#252238",
                      }}
                    >
                      {getSentenceSegments(voiceSource === "summary" ? summary : editedText).map((seg, idx) => (
                        <span
                          key={idx}
                          style={{
                            background: idx === activeSentenceIndex ? "rgba(114, 92, 222, 0.22)" : "transparent",
                            borderRadius: "4px",
                            padding: idx === activeSentenceIndex ? "2px 4px" : "0",
                            transition: "background 0.2s ease",
                            fontWeight: idx === activeSentenceIndex ? "600" : "normal",
                          }}
                        >
                          {seg}
                        </span>
                      ))}
                    </p>
                  </div>
                )}

                {/* Warning message */}
                {voiceWarning && (
                  <div
                    style={{
                      marginTop: "14px",
                      padding: "10px 14px",
                      background: "#fff9eb",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#b45309",
                      border: "1px solid #fde68a",
                    }}
                    role="alert"
                  >
                    ⚠ {voiceWarning}
                  </div>
                )}
              </section>
            </section>
          )}

          {/* Printed OCR Results */}
          {!handwritingMode && result && (
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

              {/* Smart OCR Correction */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>04</span>
                  <h3>Smart OCR Correction</h3>
                </div>

                <p className="click-hint">
                  Analyze extracted Kannada text to automatically detect likely OCR character recognition mistakes.
                  Review and accept or reject suggested corrections individually or all at once.
                </p>

                {!aiStatusChecked ? (
                  <p role="status">Checking AI availability...</p>
                ) : !aiConfigured ? (
                  <p role="status">
                    AI features are not configured. Configure an AI provider in backend .env to enable Smart OCR Correction.
                  </p>
                ) : (
                  <div style={actionRowStyle}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={requestCorrections}
                      disabled={correctionLoading || !editedText.trim()}
                    >
                      {correctionLoading ? "Analyzing OCR text..." : "✨ Smart Correct OCR"}
                    </button>
                  </div>
                )}

                {correctionLoading && (
                  <p role="status" style={{ marginTop: "12px", color: "#6a5acd" }}>
                    Analyzing text and verifying character substitutions with AI...
                  </p>
                )}

                {correctionMessage && (
                  <div
                    style={{
                      marginTop: "14px",
                      padding: "10px 14px",
                      background: "#f4f1fa",
                      borderRadius: "8px",
                      fontSize: "13px",
                      color: "#473c78",
                      border: "1px solid #e0daf0",
                    }}
                  >
                    {correctionMessage}
                  </div>
                )}

                {corrections.length > 0 && (
                  <div style={{ marginTop: "18px" }}>
                    {/* Status header & bulk action buttons */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "10px",
                        marginBottom: "12px",
                      }}
                    >
                      <div style={{ fontSize: "12px", fontWeight: "600", color: "#373449" }}>
                        Suggestions:{" "}
                        <span style={{ color: "#2e7d32" }}>
                          {corrections.filter((c) => c.status === "accepted").length} accepted
                        </span>
                        {" · "}
                        <span style={{ color: "#c62828" }}>
                          {corrections.filter((c) => c.status === "rejected").length} rejected
                        </span>
                        {" · "}
                        <span style={{ color: "#6a5acd" }}>
                          {corrections.filter((c) => c.status === "pending").length} pending
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          className="copy-button"
                          onClick={handleAcceptAllCorrections}
                          style={{ fontSize: "11px", padding: "4px 10px" }}
                        >
                          Accept all
                        </button>
                        <button
                          type="button"
                          className="copy-button"
                          onClick={handleRejectAllCorrections}
                          style={{ fontSize: "11px", padding: "4px 10px" }}
                        >
                          Reject all
                        </button>
                      </div>
                    </div>

                    {/* Individual suggestion cards */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {corrections.map((corr, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: "12px 14px",
                            background:
                              corr.status === "accepted"
                                ? "#f1f8f3"
                                : corr.status === "rejected"
                                ? "#fdf2f2"
                                : "#fff",
                            border: `1px solid ${
                              corr.status === "accepted"
                                ? "#b7dfc3"
                                : corr.status === "rejected"
                                ? "#f5c2c2"
                                : "#e6e2f5"
                            }`,
                            borderRadius: "8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "8px",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <span
                                lang="kn"
                                style={{
                                  fontSize: "14px",
                                  fontWeight: "600",
                                  color: "#a32d2d",
                                  textDecoration: "line-through",
                                }}
                              >
                                {corr.original}
                              </span>
                              <span style={{ fontSize: "12px", color: "#8a8799" }}>→</span>
                              <span
                                lang="kn"
                                style={{
                                  fontSize: "14px",
                                  fontWeight: "700",
                                  color: "#1e7e34",
                                }}
                              >
                                {corr.suggested}
                              </span>
                              <span
                                style={{
                                  fontSize: "10px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background:
                                    corr.confidence === "high"
                                      ? "#e8f5e9"
                                      : corr.confidence === "medium"
                                      ? "#fff3e0"
                                      : "#f5f5f5",
                                  color:
                                    corr.confidence === "high"
                                      ? "#2e7d32"
                                      : corr.confidence === "medium"
                                      ? "#e65100"
                                      : "#757575",
                                  fontWeight: "600",
                                  textTransform: "uppercase",
                                }}
                              >
                                {corr.confidence} confidence
                              </span>
                            </div>

                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                type="button"
                                onClick={() => handleAcceptCorrection(idx)}
                                style={{
                                  fontSize: "11px",
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  border: "1px solid #2e7d32",
                                  background: corr.status === "accepted" ? "#2e7d32" : "#fff",
                                  color: corr.status === "accepted" ? "#fff" : "#2e7d32",
                                  cursor: "pointer",
                                  fontWeight: "600",
                                }}
                              >
                                ✓ Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRejectCorrection(idx)}
                                style={{
                                  fontSize: "11px",
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  border: "1px solid #c62828",
                                  background: corr.status === "rejected" ? "#c62828" : "#fff",
                                  color: corr.status === "rejected" ? "#fff" : "#c62828",
                                  cursor: "pointer",
                                  fontWeight: "600",
                                }}
                              >
                                ✗ Reject
                              </button>
                            </div>
                          </div>

                          {corr.reason && (
                            <div style={{ fontSize: "11px", color: "#66617b" }}>
                              Reason: {corr.reason}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Corrected text preview & actions */}
                    <div style={{ marginTop: "18px" }}>
                      <label style={labelStyle}>
                        Corrected document text (reflects accepted suggestions)
                      </label>
                      <textarea
                        lang="kn"
                        aria-label="Smart corrected Kannada text"
                        value={correctedText}
                        onChange={(e) => setCorrectedText(e.target.value)}
                        rows={7}
                        style={textAreaStyle}
                      />

                      <div style={actionRowStyle}>
                        <button
                          type="button"
                          className="copy-button"
                          onClick={copyCorrectedText}
                          disabled={!correctedText.trim()}
                        >
                          {correctionCopied ? "Copied!" : "Copy corrected text"}
                        </button>
                        <button
                          type="button"
                          className="copy-button"
                          onClick={downloadCorrectedText}
                          disabled={!correctedText.trim()}
                        >
                          Download corrected .txt ↗
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={applyCorrectionsToEditor}
                          disabled={!correctedText.trim()}
                        >
                          Apply to main editor
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* AI summary */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>05</span>
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
                      {voicePlaying && voiceSource === "summary" && activeSentenceIndex !== null ? (
                        getSentenceSegments(summary).map((seg, idx) => (
                          <span
                            key={idx}
                            style={{
                              background: idx === activeSentenceIndex ? "rgba(114, 92, 222, 0.22)" : "transparent",
                              borderRadius: "4px",
                              padding: idx === activeSentenceIndex ? "2px 4px" : "0",
                              transition: "background 0.2s ease",
                              fontWeight: idx === activeSentenceIndex ? "600" : "normal",
                            }}
                          >
                            {seg}
                          </span>
                        ))
                      ) : (
                        summary
                      )}
                    </p>
                  </div>
                )}
              </section>

              {/* Document Insights */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>06</span>
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
                  <span>07</span>
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

              {/* LipiQ Voice Reader for Printed OCR */}
              <section className="result-panel" style={featurePanelStyle}>
                <div className="panel-heading">
                  <span>08</span>
                  <h3>LipiQ Voice Reader</h3>
                </div>

                <p className="click-hint">
                  Listen to the extracted document text or AI summary in spoken Kannada (kn-IN) or English (en-IN).
                </p>

                {/* Source and Language selectors */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "14px", alignItems: "center" }}>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: "4px", fontSize: "12px", color: "#554b8c" }}>
                      Content to read:
                    </label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceSource("document");
                          setVoiceWarning("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          border: voiceSource === "document" ? "1.5px solid #725cde" : "1px solid #d8d4e8",
                          background: voiceSource === "document" ? "#f4f0ff" : "#fff",
                          color: voiceSource === "document" ? "#5945c5" : "#4a4658",
                          cursor: "pointer",
                        }}
                      >
                        📄 Full Document
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceSource("summary");
                          setVoiceWarning("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          border: voiceSource === "summary" ? "1.5px solid #725cde" : "1px solid #d8d4e8",
                          background: voiceSource === "summary" ? "#f4f0ff" : "#fff",
                          color: voiceSource === "summary" ? "#5945c5" : "#4a4658",
                          cursor: "pointer",
                        }}
                      >
                        ✨ AI Summary
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ ...labelStyle, marginBottom: "4px", fontSize: "12px", color: "#554b8c" }}>
                      Voice Language:
                    </label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceLang("kn-IN");
                          setVoiceWarning("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          border: voiceLang === "kn-IN" ? "1.5px solid #725cde" : "1px solid #d8d4e8",
                          background: voiceLang === "kn-IN" ? "#f4f0ff" : "#fff",
                          color: voiceLang === "kn-IN" ? "#5945c5" : "#4a4658",
                          cursor: "pointer",
                        }}
                      >
                        ಕನ್ನಡ (kn-IN)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceLang("en-IN");
                          setVoiceWarning("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          border: voiceLang === "en-IN" ? "1.5px solid #725cde" : "1px solid #d8d4e8",
                          background: voiceLang === "en-IN" ? "#f4f0ff" : "#fff",
                          color: voiceLang === "en-IN" ? "#5945c5" : "#4a4658",
                          cursor: "pointer",
                        }}
                      >
                        English (en-IN)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Speed Slider */}
                <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "12px" }}>
                  <label htmlFor="ocr-voice-speed" style={{ fontSize: "12px", fontWeight: "600", color: "#554b8c", minWidth: "90px" }}>
                    Speed: {voiceSpeed.toFixed(2)}x
                  </label>
                  <input
                    id="ocr-voice-speed"
                    type="range"
                    min="0.75"
                    max="1.5"
                    step="0.05"
                    value={voiceSpeed}
                    onChange={(e) => handleVoiceSpeedChange(parseFloat(e.target.value))}
                    style={{ flex: 1, maxWidth: "200px", cursor: "pointer" }}
                  />
                </div>

                {/* Playback Controls */}
                <div style={{ ...actionRowStyle, marginTop: "16px" }}>
                  {!voicePlaying ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleVoicePlay}
                      disabled={voiceSource === "summary" ? !summary.trim() : !editedText.trim()}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <span>▶</span> Play
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleVoicePause}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f59e0b" }}
                    >
                      <span>⏸</span> Pause
                    </button>
                  )}

                  {voicePaused && (
                    <button
                      type="button"
                      className="copy-button"
                      onClick={handleVoiceResume}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px", borderColor: "#725cde", color: "#725cde" }}
                    >
                      <span>⏯</span> Resume
                    </button>
                  )}

                  <button
                    type="button"
                    className="copy-button"
                    onClick={stopVoiceReader}
                    disabled={!voicePlaying && !voicePaused}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <span>⏹</span> Stop
                  </button>

                  {(voicePlaying || voicePaused) && (
                    <span style={{ fontSize: "12px", color: voicePaused ? "#f59e0b" : "#25825b", fontWeight: "600" }}>
                      {voicePaused ? "Paused" : "Speaking..."}
                    </span>
                  )}
                </div>

                {/* Read-Along Currently Reading Cue */}
                {(voicePlaying || voicePaused) && activeSentenceIndex !== null && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "12px 16px",
                      background: "#f4f1fa",
                      borderRadius: "8px",
                      border: "1px solid #dcd7f2",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: voicePaused ? "#f59e0b" : "#725cde",
                          display: "inline-block",
                        }}
                      />
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "#554b8c" }}>
                        Currently reading {voiceSource === "summary" ? "(AI Summary)" : "(Full Document)"}:
                      </span>
                    </div>
                    <p
                      lang="kn"
                      style={{
                        margin: 0,
                        fontSize: "13px",
                        lineHeight: 1.6,
                        color: "#252238",
                      }}
                    >
                      {getSentenceSegments(voiceSource === "summary" ? summary : editedText).map((seg, idx) => (
                        <span
                          key={idx}
                          style={{
                            background: idx === activeSentenceIndex ? "rgba(114, 92, 222, 0.22)" : "transparent",
                            borderRadius: "4px",
                            padding: idx === activeSentenceIndex ? "2px 4px" : "0",
                            transition: "background 0.2s ease",
                            fontWeight: idx === activeSentenceIndex ? "600" : "normal",
                          }}
                        >
                          {seg}
                        </span>
                      ))}
                    </p>
                  </div>
                )}

                {/* Warning message */}
                {voiceWarning && (
                  <div
                    style={{
                      marginTop: "14px",
                      padding: "10px 14px",
                      background: "#fff9eb",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#b45309",
                      border: "1px solid #fde68a",
                    }}
                    role="alert"
                  >
                    ⚠ {voiceWarning}
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
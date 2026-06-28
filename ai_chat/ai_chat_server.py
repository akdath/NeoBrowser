#!/usr/bin/env python3
"""
Neuro AI — Streaming local AI server for NeuroBrowser
Fully offline, no API keys, no HF account needed.

Models (lightweight — work on 4GB+ RAM):
  QA / chat  → deepset/roberta-base-squad2        (~500 MB)  extractive QA
  Summarize  → sshleifer/distilbart-cnn-12-6      (~300 MB)  distilled BART, much lighter
"""

import sys, json, os, threading, re, datetime, warnings
warnings.filterwarnings("ignore")
os.environ["TOKENIZERS_PARALLELISM"]          = "false"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

from http.server import HTTPServer, BaseHTTPRequestHandler

# ── Config ────────────────────────────────────────────────────────────────────
PORT        = 7788
CACHE_DIR   = os.path.join(os.path.dirname(__file__), ".model_cache")
MAX_HIST    = 6
CTX_CHARS   = 4000
CHUNK_SIZE  = 20

QA_MODEL    = "deepset/roberta-base-squad2"
SUMM_MODEL  = "sshleifer/distilbart-cnn-12-6"   # ~300 MB vs 1.6 GB for bart-large

# ── Model singletons ──────────────────────────────────────────────────────────
_qa_tokenizer   = None
_qa_model       = None
_summ_tokenizer = None
_summ_model     = None
_lock           = threading.Lock()

def load_models():
    global _qa_tokenizer, _qa_model, _summ_tokenizer, _summ_model
    if _qa_model and _summ_model:
        return True
    try:
        import torch
        from transformers import (
            AutoTokenizer,
            AutoModelForQuestionAnswering,
            AutoModelForSeq2SeqLM,
        )

        sys.stderr.write("[NeuroAI] Loading QA model (roberta-base-squad2, ~500 MB)...\n")
        _qa_tokenizer = AutoTokenizer.from_pretrained(QA_MODEL, cache_dir=CACHE_DIR)
        _qa_model     = AutoModelForQuestionAnswering.from_pretrained(
            QA_MODEL, cache_dir=CACHE_DIR
        )
        _qa_model.eval()
        sys.stderr.write("[NeuroAI] QA model ready.\n")

        sys.stderr.write("[NeuroAI] Loading summarisation model (distilbart-cnn-12-6, ~300 MB)...\n")
        _summ_tokenizer = AutoTokenizer.from_pretrained(SUMM_MODEL, cache_dir=CACHE_DIR)
        _summ_model     = AutoModelForSeq2SeqLM.from_pretrained(
            SUMM_MODEL, cache_dir=CACHE_DIR
        )
        _summ_model.eval()
        sys.stderr.write("[NeuroAI] Summarisation model ready.\n")

        sys.stderr.write("[NeuroAI] All models loaded successfully.\n")
        return True

    except Exception as e:
        sys.stderr.write(f"[NeuroAI] Load error: {e}\n")
        return False

# ── Context cleaning ──────────────────────────────────────────────────────────
_UI_PATTERNS = re.compile(
    r"(cookie|privacy policy|terms of use|sign in|log in|subscribe|newsletter"
    r"|advertisement|skip to|jump to|navigation|search results|feedback"
    r"|font size|newsquiz|news quiz|reading comprehension|vocabulary"
    r"|share your feedback|sister projects|wikimedia|creative commons"
    r"|retrieved from|cite this|this page was last|talk page|view history"
    r"|edit source|edit this|external links|see also|references\s*$"
    r"|further reading|bibliography|footnotes|citation needed"
    r"|this article|this page always|use this page|weekly news"
    r"|at the bottom of the page|content on which it is based)",
    re.IGNORECASE,
)

def _is_ui_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return True

    # remove obvious UI junk only
    if _UI_PATTERNS.search(s):
        return True

    # keep most content, only remove VERY short noise
    if len(s) < 10:
        return True

    return False

def clean_context(raw: str) -> str:
    lines = raw.splitlines()
    kept = [l for l in lines if not _is_ui_line(l)]

    # 🚨 fallback if over-cleaned
    if len(kept) < 10:
        sys.stderr.write("[NeuroAI] WARNING: over-cleaned context, using raw fallback\n")
        return raw[:CTX_CHARS]
    text  = re.sub(r"\n{3,}", "\n\n", "\n".join(kept))
    text  = re.sub(r"[ \t]{2,}", " ", text).strip()
    sys.stderr.write(f"[NeuroAI] Context: {len(raw)} → {len(text)} chars after cleaning\n")
    return text[:CTX_CHARS]

# ── Intent helpers ────────────────────────────────────────────────────────────
SUMMARIZE_RE = re.compile(
    r"\b(summari[sz]e|summary|summarise|tldr|tl;dr|brief|overview"
    r"|key points?|bullet points?|in short|main points?)\b",
    re.IGNORECASE,
)

def wants_summary(msg: str) -> bool:
    return bool(SUMMARIZE_RE.search(msg))

def compute_age(birth_year: int) -> int:
    return datetime.date.today().year - birth_year

# ── QA inference ──────────────────────────────────────────────────────────────
def _extract_span(question: str, context: str) -> tuple:
    """Returns (answer_str, score_float)."""
    import torch

    max_chunk = 1500
    stride    = 400
    chunks, pos = [], 0
    while pos < len(context):
        chunks.append(context[pos : pos + max_chunk])
        if pos + max_chunk >= len(context):
            break
        pos += max_chunk - stride

    best_score, best_answer = -999.0, ""

    for chunk in chunks:
        try:
            enc = _qa_tokenizer(
                question, chunk,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding=True,
            )
            with torch.no_grad():
                out = _qa_model(**enc)

            s = int(torch.argmax(out.start_logits))
            e = int(torch.argmax(out.end_logits))
            if e < s:
                continue

            score  = float(out.start_logits[0, s]) + float(out.end_logits[0, e])
            tokens = enc["input_ids"][0][s : e + 1]
            answer = _qa_tokenizer.decode(tokens, skip_special_tokens=True).strip()

            if score > best_score and answer:
                best_score, best_answer = score, answer
        except Exception:
            continue

    return best_answer, best_score

def clean_answer(ans):
    ans = ans.strip()

    # remove weird trailing punctuation
    ans = re.sub(r"[,\.\)\]]+$", "", ans)

    # remove broken fragments
    if len(ans.split()) > 15:
        return ""

    return ans

def run_qa(question: str, context: str) -> str:
    if not context or len(context.strip()) < 50:
        return ("No usable page content found. "
                "Make sure you are on an article page.")

    # Age questions — compute from birth year
    if re.search(r"\b(age|how old)\b", question, re.IGNORECASE):
        birth_ans, _ = _extract_span(
            "When was he born? What is the birth year?", context
        )
        year_m = re.search(r"\b(19\d{2}|20\d{2})\b", birth_ans)
        if year_m:
            year = int(year_m.group())
            age  = compute_age(year)
            date_ans, _ = _extract_span("What is the full date of birth?", context)
            if re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}\s)", date_ans):
                return f"{age} years old (born {date_ans})"
            return f"{age} years old (born {year})"

    answer, score = _extract_span(question, context)
    
    answer = clean_answer(answer)
    if score < 1.0 or not answer:
        return "I couldn't find a clear answer to that in the page content."
    return answer




# ── Summarisation ─────────────────────────────────────────────────────────────
def run_summary(context: str) -> str:
    import torch

    if not context or len(context.strip()) < 50:
        return "No usable page content found — please navigate to an article page."

    try:
        # distilbart max input is 1024 tokens ≈ ~3000 chars
        inputs = _summ_tokenizer(
            context[:3000],
            return_tensors="pt",
            truncation=True,
            max_length=1024,
        )
        with torch.no_grad():
            ids = _summ_model.generate(
                inputs["input_ids"],
                max_new_tokens=180,
                min_length=40,
                num_beams=2,          # fewer beams = less RAM
                early_stopping=True,
                no_repeat_ngram_size=3,
            )
        summary = _summ_tokenizer.decode(ids[0], skip_special_tokens=True).strip()
    except Exception as e:
        return f"Summarisation failed: {e}"

    sentences = [s.strip() for s in re.split(r"\.\s+", summary) if s.strip()]
    return "\n".join(f"• {s}." for s in sentences)

# ── Chat router ───────────────────────────────────────────────────────────────
def run_chat(message: str, context: str, history: list) -> str:
    if wants_summary(message):
        return run_summary(context)

    if context and len(context.strip()) > 50:
        answer = run_qa(message, context)
        if "couldn't find" not in answer and "No usable" not in answer:
            return answer
        return "I couldn't find a clear answer to that on this page."

    if history:
        return ("I need a webpage to be open to answer questions. "
                "Navigate to an article and I'll read it for you.")
    return ("Hi! I'm Neuro AI. Open any webpage and ask me questions about it, "
            "or say 'summarise' for a quick summary. I run fully offline.")

# ── Streaming ─────────────────────────────────────────────────────────────────
def stream_response(message: str, raw_page_text: str, history: list, action: str):
    ctx = clean_context(raw_page_text)
    sys.stderr.write(f"[NeuroAI] action={action!r} ctx={len(ctx)}ch msg={message[:60]!r}\n")

    if action == "summarize" or wants_summary(message.lower()):
        text = run_summary(ctx)
    elif action == "qa":
        text = run_qa(message, ctx)
    else:
        text = run_chat(message, ctx, history)

    text = text or "Sorry, I couldn't generate a response."
    for i in range(0, len(text), CHUNK_SIZE):
        yield text[i : i + CHUNK_SIZE]

# ── HTTP handler ──────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            ready = _qa_model is not None and _summ_model is not None
            self.wfile.write(json.dumps({"ok": True, "modelReady": ready}).encode())
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path != "/chat":
            self.send_response(404); self.end_headers(); return

        length = int(self.headers.get("Content-Length", 0))
        raw    = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except Exception:
            self.send_response(400); self.end_headers(); return

        message   = payload.get("message",  "")
        page_text = payload.get("pageText", "")
        history   = payload.get("history",  [])
        action    = payload.get("action",   "chat")

        if not load_models():
            self.send_response(503)
            self._cors()
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b'data: {"error": "Models failed to load"}\n\n')
            return

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type",      "text/event-stream")
        self.send_header("Cache-Control",     "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            with _lock:
                for chunk in stream_response(message, page_text, history, action):
                    if not chunk: continue
                    self.wfile.write(
                        f"data: {json.dumps({'token': chunk})}\n\n".encode("utf-8")
                    )
                    self.wfile.flush()
            self.wfile.write(b'data: {"done": true}\n\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            try:
                self.wfile.write(f"data: {json.dumps({'error': str(e)})}\n\n".encode())
                self.wfile.flush()
            except Exception:
                pass

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    load_models()
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    sys.stderr.write(f"[NeuroAI] Server running on http://127.0.0.1:{PORT}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[NeuroAI] Shutting down.\n")
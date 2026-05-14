"""
Neuro Browser - classify_with_summary.py
Classifies webpage content using the summarizer + classifier pipeline.
100% local, no API keys, no external services.
"""

import subprocess
import sys
import os

# Path to sibling modules
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SUMMARIZER_SCRIPT = os.path.join(BASE_DIR, "..", "summarizer", "summarize.py")
CLASSIFIER_SCRIPT = os.path.join(BASE_DIR, "classify_content.py")


# ── Inline classifier (no subprocess for classify) ───────────────────────────
# Import classifier directly if running from same package
try:
    sys.path.insert(0, BASE_DIR)
    from classify_content import classify, classify_multi_label
    CLASSIFIER_INLINE = True
except ImportError:
    CLASSIFIER_INLINE = False


def summarize(text: str, max_chars: int = 5000) -> str:
    """
    Call the summarizer via subprocess.
    Truncates input to avoid memory issues on large pages.
    """
    if not text or not text.strip():
        return ""

    # Truncate very large inputs
    if len(text) > max_chars:
        text = text[:max_chars]

    try:
        proc = subprocess.Popen(
            [sys.executable, SUMMARIZER_SCRIPT],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        stdout, stderr = proc.communicate(input=text, timeout=30)

        if proc.returncode != 0 and stderr:
            # Fallback: return first 3 sentences as summary
            sentences = text.replace("\n", " ").split(". ")
            fallback = ". ".join(sentences[:3]).strip()
            return fallback if fallback else text[:200]

        return stdout.strip()

    except subprocess.TimeoutExpired:
        proc.kill()
        sentences = text.replace("\n", " ").split(". ")
        return ". ".join(sentences[:3]).strip()
    except FileNotFoundError:
        # Summarizer not available — crude fallback
        sentences = text.replace("\n", " ").split(". ")
        return ". ".join(sentences[:3]).strip()
    except Exception as e:
        return f"[Summarizer error: {e}]"


def classify_text(text: str) -> dict:
    """Classify using inline import or subprocess fallback."""
    if CLASSIFIER_INLINE:
        result = classify(text)
        labels = classify_multi_label(text)
        return {
            "category": result.category,
            "confidence": result.confidence,
            "labels": labels,
            "top3": result.top3,
        }
    else:
        try:
            proc = subprocess.Popen(
                [sys.executable, CLASSIFIER_SCRIPT],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            stdout, _ = proc.communicate(input=text, timeout=20)
            parts = stdout.strip().split("|")
            category = parts[0] if parts else "general"
            confidence = float(parts[1]) if len(parts) > 1 else 0.0
            labels = parts[2].split(",") if len(parts) > 2 else [category]
            return {
                "category": category,
                "confidence": confidence,
                "labels": labels,
                "top3": [(category, confidence)],
            }
        except Exception as e:
            return {
                "category": "general",
                "confidence": 0.0,
                "labels": ["general"],
                "top3": [],
            }


def analyze_page(text: str) -> dict:
    """
    Full pipeline:
    1. Summarize the page content
    2. Classify the page (using full text for better accuracy)
    Returns dict with summary and classification.
    """
    summary = summarize(text)
    classification = classify_text(text)  # use full text, not just summary

    return {
        "summary": summary,
        "category": classification["category"],
        "confidence": classification["confidence"],
        "labels": classification["labels"],
        "top3": classification["top3"],
    }


# ── CLI interfaces ─────────────────────────────────────────────────────────────

def main_interactive():
    print("Neuro Browser — Page Analyzer (Summarize + Classify)")
    print("Paste webpage text, then press Enter twice to analyze.\n")

    while True:
        try:
            print("─" * 50)
            lines = []
            while True:
                line = input()
                if line == "" and lines and lines[-1] == "":
                    break
                lines.append(line)

            text = "\n".join(lines).strip()
            if not text:
                continue
            if text.lower() in ("quit", "exit", "q"):
                break

            print("\n⏳ Analyzing...")
            result = analyze_page(text)

            print(f"\n📄 Summary:")
            print(f"   {result['summary'][:500]}")
            print(f"\n🏷  Category : {result['category'].upper()} ({result['confidence']:.0%})")
            print(f"   Labels   : {', '.join(result['labels'])}")
            if result['top3']:
                top_str = " | ".join(f"{c}({s:.1f})" for c, s in result['top3'])
                print(f"   Top 3    : {top_str}")
            print()

        except KeyboardInterrupt:
            print("\nExiting.")
            break


def main_cli():
    """
    Electron IPC mode: reads text from stdin.
    Output format: CATEGORY|CONFIDENCE|SUMMARY (one line)
    """
    text = sys.stdin.read().strip()
    if not text:
        print("general|0|")
        return

    result = analyze_page(text)
    # Flatten summary to single line for IPC
    summary_line = result["summary"].replace("\n", " ").replace("|", " ")
    print(f"{result['category']}|{result['confidence']:.2f}|{summary_line}")


if __name__ == "__main__":
    if not sys.stdin.isatty():
        main_cli()
    else:
        main_interactive()
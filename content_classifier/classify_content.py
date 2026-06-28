"""
NEURO Browser — Content Classifier (Production Inference)
===========================================================
Replaces the old keyword-matching classifier with a trained ML model.

Called by Electron via:
    echo "page text" | python classify_content.py

Output (stdout): CATEGORY|CONFIDENCE|LABEL1,LABEL2

Falls back gracefully to keyword matching if model not found.
Fully offline — no network calls.
"""

import sys
import os
import re
import json
import math
from collections import defaultdict

# ── Model paths ───────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
MODEL_PATH   = os.path.join(PROJECT_ROOT, "ml_models", "trained_models", "classifier.joblib")
META_PATH    = os.path.join(PROJECT_ROOT, "ml_models", "trained_models", "classifier_meta.json")

# ── Fallback keyword taxonomy (used when model not available) ─────────────────
KEYWORD_TAXONOMY = {
    "technology": {
        "python": 3, "javascript": 3, "software": 2, "developer": 2,
        "algorithm": 3, "machine learning": 3, "artificial intelligence": 3,
        "github": 3, "programming": 2, "computer": 1, "cpu": 3, "gpu": 3,
        "database": 2, "api": 2, "docker": 3, "linux": 2, "code": 1,
        "cloud": 2, "server": 2, "framework": 2, "blockchain": 3,
    },
    "news": {
        "breaking": 2, "report": 1, "journalist": 2, "election": 3,
        "government": 2, "president": 2, "parliament": 3, "policy": 2,
        "crisis": 2, "war": 2, "conflict": 2, "minister": 2, "vote": 2,
        "senate": 3, "congress": 3, "democrat": 3, "republican": 3,
    },
    "finance": {
        "stock": 2, "market": 1, "investment": 2, "bitcoin": 3, "crypto": 2,
        "bank": 2, "trading": 2, "economy": 2, "inflation": 3, "gdp": 3,
        "nasdaq": 3, "portfolio": 3, "dividend": 3, "earnings": 2,
        "hedge fund": 3, "mortgage": 3, "recession": 3,
    },
    "education": {
        "course": 2, "tutorial": 2, "university": 3, "student": 2,
        "teacher": 2, "curriculum": 3, "certification": 3, "degree": 2,
        "learning": 1, "school": 2, "lecture": 2, "exam": 2, "thesis": 3,
    },
    "entertainment": {
        "movie": 2, "film": 2, "music": 2, "album": 2, "netflix": 3,
        "gaming": 3, "celebrity": 3, "actor": 2, "singer": 2, "youtube": 2,
        "streaming": 2, "tiktok": 3, "spotify": 3, "anime": 3,
    },
    "health": {
        "health": 2, "medical": 2, "doctor": 2, "hospital": 2, "vaccine": 3,
        "disease": 2, "treatment": 2, "mental health": 3, "nutrition": 2,
        "fitness": 2, "cancer": 3, "diabetes": 3, "covid": 3, "fda": 3,
    },
    "science": {
        "science": 2, "research": 2, "experiment": 2, "physics": 3,
        "chemistry": 3, "biology": 3, "nasa": 3, "space": 2, "quantum": 3,
        "evolution": 3, "genetics": 3, "dna": 3, "climate": 2,
    },
    "sports": {
        "football": 2, "basketball": 2, "soccer": 2, "nba": 3, "nfl": 3,
        "championship": 2, "olympic": 3, "athlete": 2, "match": 1,
        "cricket": 2, "f1": 3, "tennis": 2, "golf": 2, "rugby": 2,
    },
    "travel": {
        "travel": 2, "hotel": 2, "flight": 2, "tourism": 2, "destination": 2,
        "vacation": 2, "passport": 3, "airline": 2, "cruise": 2, "resort": 2,
        "backpacking": 3, "airbnb": 3, "visa": 2,
    },
    "shopping": {
        "shop": 1, "buy": 1, "price": 1, "deal": 1, "amazon": 2, "ebay": 2,
        "discount": 2, "product": 1, "review": 1, "cart": 2, "shipping": 2,
        "brand": 1, "fashion": 2, "checkout": 3,
    },
    "social_media": {
        "twitter": 3, "facebook": 3, "instagram": 3, "tiktok": 3,
        "reddit": 3, "linkedin": 3, "hashtag": 3, "influencer": 3,
        "viral": 2, "trending": 2, "post": 1, "tweet": 3, "follow": 1,
    },
    "legal": {
        "law": 2, "lawyer": 3, "court": 2, "lawsuit": 3, "legal": 2,
        "gdpr": 3, "privacy policy": 3, "contract": 2, "patent": 3,
        "copyright": 2, "regulation": 2, "attorney": 3,
    },
}


def clean_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def keyword_classify(text: str) -> tuple:
    """Fast keyword-based fallback classifier."""
    cleaned = clean_text(text)
    scores = defaultdict(float)

    text_len = max(len(cleaned.split()), 10)
    normalizer = math.log(text_len / 10 + 1) + 1

    for category, keywords in KEYWORD_TAXONOMY.items():
        for keyword, weight in keywords.items():
            if keyword in cleaned:
                scores[category] += weight

    if not scores:
        return "general", 0.0, ["general"]

    normalized = {cat: score / normalizer for cat, score in scores.items()}
    best_cat   = max(normalized, key=normalized.get)
    total      = sum(normalized.values())
    confidence = normalized[best_cat] / total if total > 0 else 0.0

    top_score  = max(normalized.values())
    labels     = [cat for cat, sc in normalized.items() if sc >= top_score * 0.5]
    labels.sort(key=lambda c: normalized[c], reverse=True)

    return best_cat, min(confidence, 1.0), labels[:3]


def ml_classify(text: str) -> tuple:
    """ML model-based classifier."""
    import joblib

    pipeline = joblib.load(MODEL_PATH)

    # Preprocess
    cleaned = clean_text(text)

    # Predict with probability
    proba  = pipeline.predict_proba([cleaned])[0]
    classes = pipeline.classes_

    best_idx   = proba.argmax()
    best_cat   = classes[best_idx]
    confidence = float(proba[best_idx])

    # Top-3 labels above 20% confidence
    sorted_indices = proba.argsort()[::-1]
    labels = [classes[i] for i in sorted_indices if proba[i] >= 0.20][:3]

    return best_cat, confidence, labels or [best_cat]


def classify(text: str) -> tuple:
    """Main classification function — uses ML if available, falls back to keywords."""
    if not text or len(text.strip()) < 10:
        return "general", 0.0, ["general"]

    # Try ML model first
    if os.path.exists(MODEL_PATH):
        try:
            return ml_classify(text)
        except Exception as e:
            print(f"[ML model error: {e}] using keyword fallback", file=sys.stderr)

    # Fallback to keyword matching
    return keyword_classify(text)


# ── CLI entry point ────────────────────────────────────────────────────────────
def main_cli():
    """Called by Electron. Reads text from stdin, outputs CATEGORY|CONFIDENCE|LABELS."""
    text = sys.stdin.read().strip()
    if not text:
        print("general|0.00|general")
        return

    category, confidence, labels = classify(text)
    labels_str = ",".join(labels)
    print(f"{category}|{confidence:.2f}|{labels_str}")


def main_interactive():
    """Interactive testing mode."""
    print("NEURO Content Classifier — Interactive Mode")
    print("Paste text, press Enter twice to classify. Ctrl+C to quit.\n")
    while True:
        try:
            lines = []
            while True:
                line = input()
                if line == "" and lines and lines[-1] == "":
                    break
                lines.append(line)
            text = "\n".join(lines).strip()
            if text.lower() in ("quit", "exit", "q"):
                break
            category, confidence, labels = classify(text)
            print(f"\nCategory:   {category.upper()}")
            print(f"Confidence: {confidence:.0%}")
            print(f"Labels:     {', '.join(labels)}\n")
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    if not sys.stdin.isatty():
        main_cli()
    else:
        main_interactive() 
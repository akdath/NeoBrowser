"""
MODEL 1: Content Classifier — Dataset Download
================================================
Downloads the AG News dataset (free, no API key needed).

Dataset: AG News Topic Classification
  - Source: HuggingFace (downloaded locally, used offline)
  - Direct: https://huggingface.co/datasets/fancyzhx/ag_news
  - Size: 120,000 training + 7,600 test articles
  - Classes: World (0), Sports (1), Business (2), Sci/Tech (3)

We EXTEND this with our own category mapping to match NEURO's categories:
  World     → news
  Sports    → sports
  Business  → finance
  Sci/Tech  → technology

Additional data from 20 Newsgroups (built into scikit-learn, no download needed):
  - 18,000 posts across 20 categories
  - Mapped to our extended category set

Final categories NEURO supports:
  technology, news, finance, sports, education,
  entertainment, health, science, travel, shopping,
  social_media, legal, general

Usage:
    python classifier/download_data.py
"""

import os
import json
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

OUTPUT_DIR = Path("data/classifier")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def download_ag_news():
    """Download AG News via HuggingFace datasets (no API key)."""
    print("Downloading AG News dataset...")
    try:
        from datasets import load_dataset
        dataset = load_dataset("fancyzhx/ag_news", trust_remote_code=False)
    except Exception:
        try:
            from datasets import load_dataset
            dataset = load_dataset("ag_news")
        except Exception as e:
            print(f"HuggingFace download failed: {e}")
            print("Using scikit-learn 20 Newsgroups instead...")
            return False

    # AG News label mapping → NEURO categories
    ag_map = {0: "news", 1: "sports", 2: "finance", 3: "technology"}

    rows = []
    for split in ["train", "test"]:
        for item in dataset[split]:
            label = ag_map[item["label"]]
            text  = item["text"].strip()
            rows.append({"text": text, "label": label})

    out_path = OUTPUT_DIR / "ag_news.jsonl"
    with open(out_path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    print(f"  Saved {len(rows):,} examples → {out_path}")
    return True


def load_20newsgroups():
    """
    Load 20 Newsgroups from scikit-learn (built-in, no download needed).
    Maps categories to NEURO labels.
    """
    print("Loading 20 Newsgroups (built-in scikit-learn)...")
    from sklearn.datasets import fetch_20newsgroups

    # Category mapping: newsgroup → NEURO label
    category_map = {
        "comp.graphics":           "technology",
        "comp.os.ms-windows.misc": "technology",
        "comp.sys.ibm.pc.hardware":"technology",
        "comp.sys.mac.hardware":   "technology",
        "comp.windows.x":          "technology",
        "sci.crypt":               "science",
        "sci.electronics":         "science",
        "sci.med":                 "health",
        "sci.space":               "science",
        "misc.forsale":            "shopping",
        "rec.autos":               "technology",
        "rec.motorcycles":         "technology",
        "rec.sport.baseball":      "sports",
        "rec.sport.hockey":        "sports",
        "talk.politics.guns":      "news",
        "talk.politics.mideast":   "news",
        "talk.politics.misc":      "news",
        "talk.religion.misc":      "news",
        "alt.atheism":             "news",
        "soc.religion.christian":  "news",
    }

    categories = list(category_map.keys())
    data = fetch_20newsgroups(
        subset="all",
        categories=categories,
        remove=("headers", "footers", "quotes"),
    )

    rows = []
    for text, target in zip(data.data, data.target):
        newsgroup = data.target_names[target]
        label     = category_map.get(newsgroup, "general")
        clean     = text.strip()
        if len(clean.split()) >= 20:  # Filter too-short posts
            rows.append({"text": clean[:2000], "label": label})

    out_path = OUTPUT_DIR / "20newsgroups.jsonl"
    with open(out_path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    print(f"  Saved {len(rows):,} examples → {out_path}")
    return rows


def generate_synthetic_examples():
    """
    Generate synthetic training examples for categories not well-covered
    by AG News / 20 Newsgroups: education, entertainment, travel, legal, social_media.
    These are template-based, not real data — boosts coverage only.
    """
    print("Generating synthetic examples for underrepresented categories...")

    templates = {
        "education": [
            "Students at {} University are studying {} this semester.",
            "The new curriculum at {} School focuses on {} and critical thinking.",
            "Online courses in {} are becoming increasingly popular among learners.",
            "Research shows that {} teaching methods improve student outcomes.",
            "The university launched a new degree program in {} studies.",
            "Teachers are using new technology to improve {} education.",
            "Scholarship programs help students pursue degrees in {}.",
            "The academic conference focused on advances in {} research.",
        ],
        "entertainment": [
            "The new {} movie broke box office records this weekend.",
            "Singer {} released a new album featuring {} songs.",
            "The popular TV show {} was renewed for another season.",
            "Netflix announced a new series based on the novel {}.",
            "The film festival showcased international movies from {} countries.",
            "The gaming industry released a new title in the {} franchise.",
            "Celebrity {} announced a world tour starting next month.",
            "The streaming platform added {} new shows to its catalog.",
        ],
        "travel": [
            "Tourists are flocking to {} this summer for its stunning beaches.",
            "Travel advisories have been issued for {} due to weather conditions.",
            "Airlines are offering discounted flights to {} destinations.",
            "The new hotel in {} features world-class amenities and dining.",
            "Backpackers explore {} on a budget, discovering hidden gems.",
            "The national park in {} attracts millions of visitors annually.",
            "Cruise lines are expanding routes to {} ports.",
            "Digital nomads are choosing {} as their base for remote work.",
        ],
        "legal": [
            "The court ruled in favor of {} in the landmark case.",
            "New legislation regarding {} was passed by Congress.",
            "Lawyers argued that the {} contract violated consumer rights.",
            "The supreme court is hearing arguments about {} regulations.",
            "A class action lawsuit was filed against {} corporation.",
            "New privacy laws affect how {} companies handle user data.",
            "The attorney general announced an investigation into {} practices.",
            "Legal experts debate the implications of the new {} policy.",
        ],
        "social_media": [
            "The viral {} post reached over a million shares on social media.",
            "{} trends on Twitter after the controversial statement.",
            "Instagram influencers promote {} products to their followers.",
            "TikTok creators are building audiences around {} content.",
            "Facebook changed its algorithm affecting {} page visibility.",
            "Reddit communities discuss the latest {} developments.",
            "Social media platforms face scrutiny over {} misinformation.",
            "YouTube creator {} gained a million subscribers this month.",
        ],
    }

    fillers = [
        "innovative", "revolutionary", "leading", "major", "significant",
        "unprecedented", "record-breaking", "award-winning", "global", "digital",
    ]

    import random
    random.seed(42)
    rows = []

    for label, tmpl_list in templates.items():
        for tmpl in tmpl_list:
            for filler in fillers:
                text = tmpl.format(*[filler] * tmpl.count("{}"))
                rows.append({"text": text, "label": label})

    out_path = OUTPUT_DIR / "synthetic.jsonl"
    with open(out_path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    print(f"  Generated {len(rows):,} synthetic examples → {out_path}")
    return rows


def merge_all():
    """Merge all data sources into one training file."""
    print("\nMerging all datasets...")
    all_rows = []
    for fname in OUTPUT_DIR.glob("*.jsonl"):
        with open(fname, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        all_rows.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass

    # Shuffle for good mixing
    import random
    random.seed(42)
    random.shuffle(all_rows)

    out_path = OUTPUT_DIR / "train_all.jsonl"
    with open(out_path, "w", encoding="utf-8") as f:
        for row in all_rows:
            f.write(json.dumps(row) + "\n")

    # Print class distribution
    from collections import Counter
    dist = Counter(r["label"] for r in all_rows)
    print(f"\nClass distribution ({len(all_rows):,} total):")
    for label, count in sorted(dist.items(), key=lambda x: -x[1]):
        print(f"  {label:20s}: {count:6,} ({count/len(all_rows)*100:.1f}%)")

    print(f"\nMerged dataset → {out_path}")


def main():
    print("=" * 60)
    print("  NEURO Content Classifier — Dataset Download")
    print("=" * 60)

    ag_success = download_ag_news()
    if not ag_success:
        print("Using fallback: 20 Newsgroups only")

    load_20newsgroups()
    generate_synthetic_examples()
    merge_all()

    print("\n✓ Dataset preparation complete!")
    print("  Next: python classifier/train.py")


if __name__ == "__main__":
    main()
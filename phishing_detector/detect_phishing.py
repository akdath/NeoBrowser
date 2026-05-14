"""
Neuro Browser — Phishing Detector v6
URL-ONLY. No page content used. No interactive mode.

Called by Electron main.js via:
    python detect_phishing.py <url>

Outputs EXACTLY ONE LINE to stdout — JSON only, nothing else:
    {"score": N, "risk": "SAFE|LOW|MEDIUM|HIGH", "reasons": [...]}

Risk thresholds:
  HIGH   score >= 8  → ~80%+ phishing confidence → blocking popup in UI
  MEDIUM score 5-7   → suspicious, navigate anyway, no popup
  LOW    score 2-4   → minor signal, navigate normally
  SAFE   score 0-1   → clean
"""

import sys
import re
import json
import math
from urllib.parse import urlparse, unquote, parse_qs

# ── Hard whitelist — always SAFE, skip all scoring ───────────────────────────
HARD_WHITELIST = {
    "google.com", "www.google.com", "accounts.google.com", "mail.google.com",
    "github.com", "www.github.com", "raw.githubusercontent.com",
    "wikipedia.org", "www.wikipedia.org",
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "stackoverflow.com", "www.stackoverflow.com",
    "mozilla.org", "www.mozilla.org",
    "cloudflare.com", "www.cloudflare.com",
    "nodejs.org", "npmjs.com", "electronjs.org",
    "bing.com", "duckduckgo.com",
    "twitter.com", "x.com", "www.twitter.com",
    "reddit.com", "www.reddit.com", "old.reddit.com",
    "linkedin.com", "www.linkedin.com",
    "microsoft.com", "office.com", "outlook.com", "live.com",
    "apple.com", "icloud.com",
    "amazon.com", "aws.amazon.com",
    "instagram.com", "www.instagram.com",
    "facebook.com", "www.facebook.com",
    "netflix.com", "www.netflix.com",
    "twitch.tv", "www.twitch.tv",
    "discord.com", "www.discord.com",
    "spotify.com", "www.spotify.com",
    "wikipedia.org", "en.wikipedia.org",
    "news.ycombinator.com", "ycombinator.com",
    "medium.com", "dev.to", "hashnode.dev",
}

TRUSTED_BRANDS = {
    "paypal":       "paypal.com",
    "apple":        "apple.com",
    "google":       "google.com",
    "microsoft":    "microsoft.com",
    "amazon":       "amazon.com",
    "netflix":      "netflix.com",
    "facebook":     "facebook.com",
    "instagram":    "instagram.com",
    "twitter":      "twitter.com",
    "linkedin":     "linkedin.com",
    "dropbox":      "dropbox.com",
    "chase":        "chase.com",
    "wellsfargo":   "wellsfargo.com",
    "bankofamerica":"bankofamerica.com",
    "citibank":     "citibank.com",
    "irs":          "irs.gov",
    "steam":        "steampowered.com",
    "ebay":         "ebay.com",
}

SUSPICIOUS_TLDS = {
    ".tk", ".ml", ".ga", ".cf", ".gq",
    ".xyz", ".top", ".click", ".online", ".site",
    ".loan", ".win", ".download", ".stream",
    ".racing", ".review", ".accountant", ".date",
}

URL_SHORTENERS = {
    "bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly",
    "is.gd", "buff.ly", "cutt.ly", "rb.gy", "short.io", "tiny.cc", "adf.ly",
}

HOSTING_PLATFORMS = {
    "appspot.com", "pages.dev", "netlify.app", "vercel.app",
    "web.app", "firebaseapp.com", "glitch.me", "replit.app",
    "herokuapp.com", "pythonanywhere.com", "ngrok.io", "ngrok-free.app",
}

PATH_KEYWORDS = [
    "login", "log-in", "logon", "signin", "sign-in", "sign_in",
    "verify", "verification", "validate", "validation",
    "confirm", "confirmation", "authenticate", "authentication",
    "password", "passwd", "credential", "credentials",
    "update", "urgent", "recover", "recovery", "reset",
    "secure", "security", "account", "myaccount",
    "banking", "suspend", "suspended", "locked", "unlock",
    "reactivate", "alert", "warning", "claim", "prize",
    "winner", "reward", "billing", "invoice",
    "payment", "checkout", "webscr", "wallet", "phish",
    "session", "access-denied", "limited", "unusual", "low_rep",
    "restricted", "unblock", "ebay", "paypal",
]

DOMAIN_KEYWORDS = [
    "login", "secure", "verify", "account", "update",
    "bank", "paypal", "password", "signin", "confirm",
    "support", "billing", "helpdesk", "webscr",
]

HOMOGLYPH = str.maketrans({
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
    'ᴀ': 'a', 'ɢ': 'g', 'ɴ': 'n', 'ᴏ': 'o', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v',
    'ó': 'o', 'ö': 'o', 'ú': 'u', 'ü': 'u', 'á': 'a', 'à': 'a', 'ä': 'a',
    'í': 'i', 'ì': 'i', 'é': 'e', 'è': 'e', 'ê': 'e', 'ñ': 'n', 'ç': 'c',
})


def ensure_scheme(u):
    u = u.strip()
    if not re.match(r'^[a-zA-Z][a-zA-Z0-9+\-.]*://', u):
        u = 'http://' + u
    return u

def registered_domain(host):
    parts = host.split('.')
    return '.'.join(parts[-2:]) if len(parts) >= 2 else host

def shannon_entropy(s):
    if not s:
        return 0.0
    freq = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    n = len(s)
    return -sum((v / n) * math.log2(v / n) for v in freq.values())

def is_ip(host):
    h = host.split(':')[0]
    return bool(
        re.match(r'^\d{1,3}(\.\d{1,3}){3}$', h) or
        re.match(r'^\[?[0-9a-fA-F:]+\]?$', h) or
        re.match(r'^0x[0-9a-fA-F]+$', h)
    )


def analyze(raw_url):
    reasons = []
    score = 0

    def add(pts, msg):
        nonlocal score
        score += pts
        reasons.append(msg)

    if not raw_url or not raw_url.strip():
        return {"score": 0, "risk": "SAFE", "reasons": []}

    if raw_url.strip().lower().startswith('data:'):
        return {"score": 15, "risk": "HIGH", "reasons": ["data: URI obfuscation"]}

    url = ensure_scheme(raw_url)
    decoded = unquote(url)

    try:
        parsed = urlparse(url)
    except Exception:
        return {"score": 5, "risk": "MEDIUM", "reasons": ["Malformed URL"]}

    if not parsed.netloc:
        return {"score": 3, "risk": "LOW", "reasons": ["No hostname"]}

    host   = parsed.netloc.lower().split(':')[0]
    regdom = registered_domain(host)
    path   = (parsed.path  or '').lower()
    query  = (parsed.query or '').lower()
    full   = decoded.lower()

    # Hard whitelist — always safe
    if host in HARD_WHITELIST or regdom in HARD_WHITELIST:
        return {"score": 0, "risk": "SAFE", "reasons": ["Trusted domain"]}

    # R1: IP hostname
    if is_ip(host):
        add(4, "IP address used as hostname")

    # R2: @ in URL
    if '@' in url:
        add(4, "@ symbol (credential obfuscation)")

    # R3: HTTP
    scheme = parsed.scheme.lower()
    if scheme == 'http':
        add(1, "Not using HTTPS")
    elif scheme not in ('http', 'https'):
        add(3, f"Unusual scheme: {scheme}")

    # R4: Punycode
    if 'xn--' in host:
        add(3, "Punycode domain (possible homograph attack)")

    # R5: Homoglyphs
    norm_host = host.translate(HOMOGLYPH)
    if host != norm_host:
        add(4, "Lookalike Unicode characters in domain")

    # R6: Brand spoofing
    for brand, legit in TRUSTED_BRANDS.items():
        if brand in norm_host and regdom != legit and not regdom.endswith('.' + legit):
            add(4, f"Brand '{brand}' used in fake domain (real: {legit})")
            break

    # R7: Suspicious TLD
    for tld in SUSPICIOUS_TLDS:
        if host.endswith(tld):
            add(2, f"Suspicious free TLD: {tld}")
            break

    # R8: URL shortener
    if regdom in URL_SHORTENERS:
        add(2, f"URL shortener hides destination ({regdom})")

    # R9: Hyphens in domain
    hc = regdom.count('-')
    if hc >= 3:
        add(3, f"Many hyphens in domain ({hc})")
    elif hc >= 1:
        add(1, f"Hyphen in domain ({hc})")

    # R10: Path/query keywords
    blob = path + ('?' + query if query else '')
    hits = list(dict.fromkeys(kw for kw in PATH_KEYWORDS if kw in blob))
    if len(hits) >= 4:
        add(4, f"Many phishing keywords in URL path: {', '.join(hits[:4])}")
    elif len(hits) >= 2:
        add(3, f"Phishing keywords in URL path: {', '.join(hits[:3])}")
    elif len(hits) == 1:
        add(2, f"Suspicious keyword in URL path: '{hits[0]}'")

    # R11: Suspicious word in domain label
    dlabel = regdom.split('.')[0]
    for w in DOMAIN_KEYWORDS:
        if w in dlabel:
            add(2, f"Suspicious word '{w}' in domain name")
            break

    # R12: Hosting platform + keywords
    if regdom in HOSTING_PLATFORMS and hits:
        add(2, f"Phishing keywords on shared hosting ({regdom})")

    # R13: Subdomain depth
    depth = max(0, len(host.split('.')) - 2)
    if depth >= 4:
        add(3, f"Excessive subdomains ({depth} levels)")
    elif depth == 3:
        add(1, f"Deep subdomains ({depth} levels)")

    # R14: URL length
    ul = len(url)
    if ul > 200:
        add(3, f"Extremely long URL ({ul} chars)")
    elif ul > 120:
        add(2, f"Very long URL ({ul} chars)")
    elif ul > 80:
        add(1, f"Long URL ({ul} chars)")

    # R15: Open redirect params
    qs = parse_qs(query)
    redir = {'redirect', 'return', 'returnurl', 'next', 'goto', 'url', 'redir', 'target'}
    found = redir & set(qs.keys())
    if found:
        add(2, f"Open redirect parameter: {', '.join(found)}")

    # R16: High-entropy domain
    e = shannon_entropy(dlabel)
    if len(dlabel) > 8 and e > 3.7:
        add(2, f"Random-looking domain (entropy={e:.1f})")

    # R17: Unusual port
    if parsed.port and parsed.port not in (80, 443, 8080, 8443):
        add(2, f"Unusual port: {parsed.port}")

    # R18: Heavy encoding
    hx = len(re.findall(r'%[0-9a-fA-F]{2}', url))
    if hx >= 5:
        add(2, f"Heavy URL encoding ({hx} sequences)")

    # R19: Script injection
    if re.search(r'(javascript:|vbscript:|<script)', decoded, re.I):
        add(6, "Script injection in URL")

    # R20: All-numeric domain
    if re.match(r'^\d+$', dlabel):
        add(2, "All-numeric domain label")

    # Keyword "phish" anywhere in URL path = near-certain phishing → instant HIGH
    if any(kw in blob for kw in ('phish', 'phishing', 'phishy')):
        if score < 8:
            score = max(score, 8)
            if "Phishing keyword — near-certain threat" not in reasons:
                reasons.insert(0, "Phishing keyword in URL path — near-certain threat")

    if score >= 6:
        risk = "HIGH"
    elif score >= 3:
        risk = "MEDIUM"
    elif score >= 1:
        risk = "LOW"
    else:
        risk = "SAFE"

    return {"score": score, "risk": risk, "reasons": reasons}


# ── Entry point — Electron calls: python detect_phishing.py <url> ─────────────
# NEVER enters interactive mode. Outputs exactly one JSON line to stdout.
if __name__ == '__main__':
    if len(sys.argv) < 2:
        # No URL argument — output safe result silently
        print(json.dumps({"score": 0, "risk": "SAFE", "reasons": []}))
        sys.exit(0)

    url = sys.argv[1].strip()
    result = analyze(url)
    # Single JSON line — no extra prints, no headers, no boxes
    print(json.dumps(result))
    sys.exit(0)
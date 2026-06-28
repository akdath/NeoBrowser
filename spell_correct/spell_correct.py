#!/usr/bin/env python3
"""
NeuroBrowser — Fast Spell-Correct  (symspellpy only, <5 ms)
============================================================
Used for real-time autocorrect-on-space in the URL/search bars.
Called by main.js via: runPython('query_optimizer/spell_correct.py', [word])
Prints the corrected word to stdout.
"""

import sys
import os
import re


def correct_word(word: str) -> str:
    """Return spell-corrected word using SymSpell. Falls back to original."""
    clean = re.sub(r'[^a-zA-Z]', '', word)
    if not clean:
        return word                      # punctuation / numbers → unchanged

    try:
        from symspellpy import SymSpell, Verbosity

        script_dir = os.path.dirname(os.path.abspath(__file__))
        dict_path  = os.path.join(script_dir, 'frequency_dictionary_en_82_765.txt')

        if not os.path.exists(dict_path):
            import urllib.request
            url = (
                'https://raw.githubusercontent.com/mammothb/symspellpy/'
                'master/symspellpy/frequency_dictionary_en_82_765.txt'
            )
            try:
                urllib.request.urlretrieve(url, dict_path)
            except Exception:
                return word

        sym = SymSpell(max_dictionary_edit_distance=2, prefix_length=7)
        sym.load_dictionary(dict_path, term_index=0, count_index=1)

        suggestions = sym.lookup(clean, Verbosity.CLOSEST, max_edit_distance=2)
        if not suggestions:
            return word

        corrected_clean = suggestions[0].term
        # re-attach non-alpha prefix/suffix (e.g. quotes, punctuation)
        prefix = word[:len(word) - len(word.lstrip(re.sub(r'[a-zA-Z]', '', word)))]
        suffix_start = len(word.rstrip(re.sub(r'[a-zA-Z]', '', word)))
        suffix = word[suffix_start:] if suffix_start < len(word) else ''

        return prefix + corrected_clean + suffix

    except ImportError:
        return word


def main():
    if len(sys.argv) < 2:
        print('', flush=True)
        sys.exit(0)

    word = sys.argv[1]

    # don't touch URLs, hashtags, @mentions, numbers
    if re.search(r'[./\\@#]|^\d', word):
        print(word, flush=True)
        sys.exit(0)

    print(correct_word(word), flush=True)


if __name__ == '__main__':
    main()
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "sudachipy>=0.6.8",
#     "sudachidict-core>=20240409",
# ]
# ///


from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from textcore import (
    _HEADING_RE,
    _heading_level_and_text,
    get_tokenizer,
    iter_lines_with_no,
    mask_html_comments,
    mask_markdown_structure,
    read_source_file,
)


_KATAKANA_CHAR_RE = re.compile(r"^[ァ-ヶー]+$")


_ASCII_ACRONYM_RE = re.compile(r"(?<![A-Za-z0-9])[A-Z]{2,}[0-9]*(?![A-Za-z0-9])")
TERMS_KATAKANA_MIN_LEN = 3
TERMS_GLOSS_CONTEXT_CHARS = 80
TERMS_GLOSS_MARKER_WORDS = ["とは", "と呼ぶ", "という", "、つまり"]


def _is_katakana_token(surface: str) -> bool:
    return bool(_KATAKANA_CHAR_RE.match(surface))


_CAPITALIZED_LATIN_WORD_RE = re.compile(r"^[A-Z][a-zA-Z0-9]*$")


def _is_proper_noun_or_capitalized_latin_morpheme(morpheme) -> bool:
    pos = morpheme.part_of_speech()
    if pos[0] == "名詞" and pos[1] == "固有名詞":
        return True
    surface = morpheme.surface()
    return len(surface) >= 2 and bool(_CAPITALIZED_LATIN_WORD_RE.match(surface))


def _term_context_and_gloss_hint(
    term: str, first_line_no: int, search_text: str, line_offsets: dict[int, int]
) -> tuple[str, bool]:


    lines = search_text.split("\n")
    line_text = lines[first_line_no - 1] if 0 < first_line_no <= len(lines) else ""
    local_idx = line_text.find(term)
    if local_idx == -1:

        return line_text.strip(), any(marker in line_text for marker in TERMS_GLOSS_MARKER_WORDS)

    abs_pos = line_offsets.get(first_line_no, 0) + local_idx
    ctx_start = max(0, abs_pos - TERMS_GLOSS_CONTEXT_CHARS)
    ctx_end = abs_pos + len(term) + TERMS_GLOSS_CONTEXT_CHARS
    context = search_text[ctx_start:ctx_end]

    term_start_local = abs_pos - ctx_start
    term_end_local = term_start_local + len(term)
    after = context[term_end_local : term_end_local + 2]
    has_gloss_hint = after.startswith("(") or after.startswith("（")
    if not has_gloss_hint:
        has_gloss_hint = any(marker in context for marker in TERMS_GLOSS_MARKER_WORDS)

    return context.strip(), has_gloss_hint


def build_term_inventory(raw_text: str) -> list[dict]:


    tokenizer = get_tokenizer()
    from sudachipy import SplitMode

    masked_comments = mask_html_comments(raw_text)
    masked_structure = mask_markdown_structure(masked_comments)
    body_lines = iter_lines_with_no(masked_structure)


    heading_lines: list[tuple[int, str]] = []
    for no, line in iter_lines_with_no(masked_comments):
        if _HEADING_RE.match(line):
            _, heading_text = _heading_level_and_text(line)
            heading_lines.append((no, heading_text))

    combined_lines = sorted(body_lines + heading_lines, key=lambda t: t[0])


    line_offsets: dict[int, int] = {}
    pos = 0
    for no, line_text in enumerate(masked_comments.split("\n"), start=1):
        line_offsets[no] = pos
        pos += len(line_text) + 1


    seen: dict[str, dict] = {}

    def register(term: str, no: int, offset: int) -> None:
        term = term.strip()
        if not term:
            return
        if term not in seen:
            seen[term] = {"first_line": no, "first_offset": offset}

    for no, line in combined_lines:
        if not line.strip():
            continue


        for m in _ASCII_ACRONYM_RE.finditer(line):
            register(m.group(0), no, m.start())


        morphemes = list(tokenizer.tokenize(line, SplitMode.C))
        i = 0
        n = len(morphemes)
        while i < n:
            m0 = morphemes[i]
            if _is_katakana_token(m0.surface()):
                j = i + 1
                while j < n and _is_katakana_token(morphemes[j].surface()):
                    j += 1
                span_start = m0.begin()
                span_end = morphemes[j - 1].end()
                term = line[span_start:span_end]
                if len(term) >= TERMS_KATAKANA_MIN_LEN:
                    register(term, no, span_start)
                i = j
                continue
            if _is_proper_noun_or_capitalized_latin_morpheme(m0):
                j = i + 1
                while j < n and _is_proper_noun_or_capitalized_latin_morpheme(morphemes[j]):
                    j += 1
                span_start = m0.begin()
                span_end = morphemes[j - 1].end()
                term = line[span_start:span_end]
                register(term, no, span_start)
                i = j
                continue
            i += 1

    results = []
    for term, info in seen.items():


        count = len(re.findall(re.escape(term), masked_comments))
        context, has_gloss_hint = _term_context_and_gloss_hint(
            term, info["first_line"], masked_comments, line_offsets
        )
        results.append(
            {
                "term": term,
                "first_line": info["first_line"],
                "count": count,
                "has_gloss_hint": has_gloss_hint,
                "context": context,
            }
        )


    results.sort(key=lambda r: (r["first_line"], seen[r["term"]]["first_offset"]))
    return results


def print_terms_human(path: Path, terms: list[dict]) -> None:
    print(f"=== terms: {path} ===")
    print(
        "has_gloss_hint は「説明済みと判定した」印ではなく、初出近傍に説明マーカーが"
        "見つかったという機械的なヒントに過ぎない。要確認は人間/AIの判断に委ねる。"
    )
    print()
    if not terms:
        print("(用語候補なし)")
        return
    for t in terms:
        hint = "あり" if t["has_gloss_hint"] else "なし"
        print(f"L{t['first_line']} {t['term']} (出現{t['count']}回, 説明手掛かり: {hint})")
        print(f"    近傍: {t['context']}")
        print()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="専門用語候補（カタカナ複合語/ASCII英略語/固有名詞）を初出順に抽出する（CI ゲートではない）。"
    )
    parser.add_argument("file", type=Path, help="対象の Markdown/テキストファイル")
    parser.add_argument("--json", action="store_true", help="機械可読な JSON で出力する")
    args = parser.parse_args()


    text, err = read_source_file(args.file)
    if err is not None:
        print(err, file=sys.stderr)
        return 1

    terms = build_term_inventory(text)
    if args.json:
        print(json.dumps({"terms": terms}, ensure_ascii=False, indent=2))
    else:
        print_terms_human(args.file, terms)
    return 0


if __name__ == "__main__":
    sys.exit(main())

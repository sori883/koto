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
    NOUN_ENDING_POS,
    TEMPLATE_HEADING_WORDS,
    _BLOCKQUOTE_RE,
    _CODE_FENCE_RE,
    _FRONT_MATTER_DELIM_RE,
    _HEADING_RE,
    _LIST_ITEM_RE,
    _TABLE_DELIMITER_RE,
    _TABLE_ROW_RE,
    _heading_level_and_text,
    get_tokenizer,
    mask_html_comments,
    read_source_file,
    strip_trailing_symbols,
)


def build_outline(raw_text: str) -> list[dict]:


    text = mask_html_comments(raw_text)
    lines = text.split("\n")

    outline: list[dict] = []
    buffer: list[tuple[int, str]] = []
    in_fence = False
    fence_char = ""
    fence_len = 0
    in_front_matter = False

    def line_kind(line_text: str) -> str:


        if _LIST_ITEM_RE.match(line_text):
            return "bullets"
        if _BLOCKQUOTE_RE.match(line_text):
            return "blockquote"
        if (_TABLE_ROW_RE.match(line_text) and line_text.count("|") >= 2) or _TABLE_DELIMITER_RE.match(
            line_text
        ):
            return "table"
        return "lead"

    def flush_buffer() -> None:
        if not buffer:
            return
        first_no, first_line = buffer[0]
        if _LIST_ITEM_RE.match(first_line):
            count = sum(1 for _, line_text in buffer if _LIST_ITEM_RE.match(line_text))
            outline.append(
                {"line": first_no, "kind": "bullets", "level": None, "text": f"(箇条書き {count} 項目)"}
            )
        elif _BLOCKQUOTE_RE.match(first_line):
            pass
        elif (_TABLE_ROW_RE.match(first_line) and first_line.count("|") >= 2) or _TABLE_DELIMITER_RE.match(
            first_line
        ):
            pass
        else:
            m = re.search(r"[。！？]", first_line)
            lead = first_line[: m.end()] if m else first_line
            lead = lead.strip()
            if lead:
                outline.append({"line": first_no, "kind": "lead", "level": None, "text": lead})
        buffer.clear()

    for i, line in enumerate(lines, start=1):
        if i == 1 and _FRONT_MATTER_DELIM_RE.match(line):
            in_front_matter = True
            continue
        if in_front_matter:
            if _FRONT_MATTER_DELIM_RE.match(line):
                in_front_matter = False
            continue

        fence_match = _CODE_FENCE_RE.match(line)
        if fence_match:
            flush_buffer()
            fence_run = fence_match.group(1)
            fc, fl = fence_run[0], len(fence_run)
            is_close_eligible = line[fence_match.end() :].strip() == ""
            if not in_fence:
                in_fence = True
                fence_char, fence_len = fc, fl
            elif fc == fence_char and fl >= fence_len and is_close_eligible:
                in_fence = False
            continue
        if in_fence:
            continue

        if not line.strip():
            flush_buffer()
            continue

        if _HEADING_RE.match(line):
            flush_buffer()
            level, heading_text = _heading_level_and_text(line)
            outline.append({"line": i, "kind": "heading", "level": level, "text": heading_text})
            continue


        if buffer:
            cur_kind = line_kind(buffer[0][1])
            is_indented_continuation = (
                cur_kind == "bullets"
                and line_kind(line) == "lead"
                and re.match(r"^\s+\S", line) is not None
            )
            if cur_kind != line_kind(line) and not is_indented_continuation:
                flush_buffer()

        buffer.append((i, line))

    flush_buffer()
    return outline


_SIGNATURE_POS = {"名詞", "動詞", "形容詞", "副詞", "接頭辞"}


_LEADING_NUMBERING_RE = re.compile(r"^[\s0-9０-９.．、,()（）【】\[\]#・-]+")


_NUMBERED_HEADING_RE = re.compile(r"^\s*([0-9０-９]+[.).、]|[①-⑳])\s*\S")

_BRACKETED_HEADING_RE = re.compile(r"^\s*[【\[［(（].+[】\]］)）]\s*$")

_TOWA_HEADING_RE = re.compile(r".+とは[?？]?\s*$")


def _heading_pos_signature(text: str) -> tuple[str, ...]:


    tokenizer = get_tokenizer()
    sig = []
    for m in tokenizer.tokenize(text):
        pos = m.part_of_speech()[0]
        if pos in _SIGNATURE_POS:
            sig.append(pos)
    return tuple(sig)


def _is_nominal_ending(text: str) -> bool:


    tokenizer = get_tokenizer()
    morphemes = list(tokenizer.tokenize(text))
    effective = strip_trailing_symbols(morphemes)
    if not effective:
        return False
    return effective[-1].part_of_speech()[0] in NOUN_ENDING_POS


def _match_template_word(text: str) -> str | None:


    stripped = _LEADING_NUMBERING_RE.sub("", text).strip().lower()
    for word in TEMPLATE_HEADING_WORDS:
        if stripped.startswith(word.lower()):
            return word
    return None


def _match_structural_pattern(text: str) -> str | None:


    if _NUMBERED_HEADING_RE.match(text):
        return "numbered"
    if _BRACKETED_HEADING_RE.match(text):
        return "bracketed"
    if _TOWA_HEADING_RE.match(text):
        return "towa"
    return None


def _summarize_heading_group(headings: list[dict]) -> dict:


    count = len(headings)
    if count == 0:
        return {
            "count": 0,
            "length_mean": 0.0,
            "length_cv": 0.0,
            "nominal_ending_ratio": 0.0,
            "dominant_pos_signature_ratio": 0.0,
            "template_hits": [],
            "structural_pattern_ratio": 0.0,
        }

    lengths = [len(h["text"]) for h in headings]
    mean_len = sum(lengths) / count
    if mean_len > 0 and count > 1:
        variance = sum((length - mean_len) ** 2 for length in lengths) / count
        stdev = variance**0.5
        cv = stdev / mean_len
    else:
        cv = 0.0

    nominal_count = sum(1 for h in headings if _is_nominal_ending(h["text"]))

    signatures = [_heading_pos_signature(h["text"]) for h in headings]
    non_empty_signatures = [s for s in signatures if s]
    if non_empty_signatures:
        most_common = max(set(non_empty_signatures), key=non_empty_signatures.count)
        dominant_ratio = non_empty_signatures.count(most_common) / count
    else:
        dominant_ratio = 0.0

    template_hits = []
    for h in headings:
        word = _match_template_word(h["text"])
        if word is not None:
            template_hits.append({"line": h["line"], "text": h["text"], "matched": word})

    structural_count = sum(1 for h in headings if _match_structural_pattern(h["text"]) is not None)

    return {
        "count": count,
        "length_mean": round(mean_len, 2),
        "length_cv": round(cv, 3),
        "nominal_ending_ratio": round(nominal_count / count, 3),
        "dominant_pos_signature_ratio": round(dominant_ratio, 3),
        "template_hits": template_hits,
        "structural_pattern_ratio": round(structural_count / count, 3),
    }


def build_heading_stats(outline: list[dict]) -> dict:


    headings = [e for e in outline if e["kind"] == "heading"]
    by_level: dict[int, list[dict]] = {}
    for h in headings:
        by_level.setdefault(h["level"], []).append(h)

    level_distribution = {str(level): len(hs) for level, hs in sorted(by_level.items())}

    return {
        "total_headings": len(headings),
        "level_distribution": level_distribution,
        "by_level": {
            str(level): _summarize_heading_group(hs) for level, hs in sorted(by_level.items())
        },
        "overall": _summarize_heading_group(headings),
    }


def print_heading_stats_human(stats: dict) -> None:
    print()
    print("=== 見出し統計（判断材料。判定はAIが行う） ===")
    print()
    print(f"見出し総数: {stats['total_headings']}")
    if stats["level_distribution"]:
        dist = ", ".join(f"h{level}={n}" for level, n in stats["level_distribution"].items())
        print(f"レベル分布: {dist}")

    def print_group(label: str, g: dict) -> None:
        if g["count"] == 0:
            return
        print(f"[{label}] 本数={g['count']}  平均長={g['length_mean']}字  "
              f"長さの変動係数={g['length_cv']}  体言止め率={g['nominal_ending_ratio']:.0%}  "
              f"品詞パターン一致率={g['dominant_pos_signature_ratio']:.0%}  "
              f"構造パターン率={g['structural_pattern_ratio']:.0%}")
        if g["template_hits"]:
            hits = ", ".join(f"L{h['line']}:{h['text']}（{h['matched']}）" for h in g["template_hits"])
            print(f"  テンプレ見出しヒット: {hits}")

    for level, g in stats["by_level"].items():
        print_group(f"h{level}", g)
    print_group("全体", stats["overall"])


def print_outline_human(path: Path, outline: list[dict]) -> None:
    print(f"=== outline: {path} ===")
    print()
    if not outline:
        print("(スケルトンなし)")
        return
    for entry in outline:
        line_tag = f"L{entry['line']}"
        if entry["kind"] == "heading":
            indent = "  " * max(0, entry["level"] - 1)
            prefix = "#" * entry["level"]
            print(f"{line_tag:>6}  {indent}{prefix} {entry['text']}")
        else:
            print(f"{line_tag:>6}    {entry['text']}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="文書のスケルトン（見出し・各段落の先頭文・箇条書き）を抽出する（CI ゲートではない）。"
    )
    parser.add_argument("file", type=Path, help="対象の Markdown/テキストファイル")
    parser.add_argument("--json", action="store_true", help="機械可読な JSON で出力する")
    args = parser.parse_args()


    text, err = read_source_file(args.file)
    if err is not None:
        print(err, file=sys.stderr)
        return 1

    outline = build_outline(text)
    heading_stats = build_heading_stats(outline)
    if args.json:
        print(json.dumps({"outline": outline, "heading_stats": heading_stats}, ensure_ascii=False, indent=2))
    else:
        print_outline_human(args.file, outline)
        print_heading_stats_human(heading_stats)
    return 0


if __name__ == "__main__":
    sys.exit(main())

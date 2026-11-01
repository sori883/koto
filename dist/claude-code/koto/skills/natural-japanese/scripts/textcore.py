


from __future__ import annotations

import dataclasses
import re
from pathlib import Path


@dataclasses.dataclass
class Finding:
    line: int
    category: str
    excerpt: str
    severity: str
    detail: str = ""


    related_lines: list[int] | None = None


    status: str | None = None

    def __post_init__(self) -> None:

        if self.related_lines is not None:
            self.related_lines = sorted(set(self.related_lines))

    def to_dict(self) -> dict:
        d = dataclasses.asdict(self)


        if d.get("status") is None:
            d.pop("status", None)
        return d


_tokenizer_obj = None


def get_tokenizer():
    global _tokenizer_obj
    if _tokenizer_obj is None:
        from sudachipy import Dictionary

        _tokenizer_obj = Dictionary().create()
    return _tokenizer_obj


NOUN_ENDING_POS = {"名詞"}
TRAILING_SYMBOL_POS = {"補助記号", "空白"}


def strip_trailing_symbols(morphemes: list) -> list:

    i = len(morphemes)
    while i > 0 and morphemes[i - 1].part_of_speech()[0] in TRAILING_SYMBOL_POS:
        i -= 1
    return morphemes[:i]


TEMPLATE_HEADING_WORDS: list[str] = [
    "はじめに",
    "背景",
    "概要",
    "本記事について",
    "この記事について",
    "まとめと今後",
    "今後の展望",
    "今後の課題",
    "今後について",
    "まとめ",
    "おわりに",
    "終わりに",
    "さいごに",
    "最後に",
    "結論",
    "総括",
    "conclusion",
    "introduction",
    "summary",
]


_HEADING_RE = re.compile(r"^\s*#{1,6}(\s|$)")
_LIST_ITEM_RE = re.compile(r"^\s*([-*+]|\d+[.)])(\s|$)")
_BLOCKQUOTE_RE = re.compile(r"^\s*>")


_CODE_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")


_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|")
_TABLE_DELIMITER_RE = re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$")


_FRONT_MATTER_DELIM_RE = re.compile(r"^---\s*$")


_INLINE_CODE_SPAN_RE = re.compile(r"``(?:[^`\n]|`(?!`))+``|`[^`\n]+`")


_MARKDOWN_LINK_URL_RE = re.compile(r"(\]\()([^)]*)(\))")


def _mask_html_comments_in_line(line: str, in_comment: bool) -> tuple[str, bool]:


    out = []
    i = 0
    n = len(line)
    while i < n:
        if in_comment:
            close = line.find("-->", i)
            if close == -1:
                out.append(" " * (n - i))
                i = n
            else:
                end = close + 3
                out.append(" " * (end - i))
                i = end
                in_comment = False
        else:
            start = line.find("<!--", i)
            if start == -1:
                out.append(line[i:])
                i = n
            else:
                out.append(line[i:start])
                i = start
                in_comment = True
    return "".join(out), in_comment


def mask_html_comments(text: str) -> str:


    lines = text.split("\n")
    masked_lines = []
    in_html_comment = False
    for line in lines:
        masked_line, in_html_comment = _mask_html_comments_in_line(line, in_html_comment)
        masked_lines.append(masked_line)
    return "\n".join(masked_lines)


def _blank_inline_code_spans(line: str) -> str:


    line = _INLINE_CODE_SPAN_RE.sub(lambda m: " " * len(m.group(0)), line)


    line = _MARKDOWN_LINK_URL_RE.sub(lambda m: m.group(1) + " " * len(m.group(2)) + m.group(3), line)
    return line


def mask_markdown_structure(text: str) -> str:


    lines = text.split("\n")
    masked_lines = []
    in_code_block = False


    open_fence: tuple[str, int] | None = None

    in_front_matter = False


    in_html_comment = False
    for idx, line in enumerate(lines):
        if idx == 0 and _FRONT_MATTER_DELIM_RE.match(line):
            in_front_matter = True
            masked_lines.append("")
            continue
        if in_front_matter:
            masked_lines.append("")
            if _FRONT_MATTER_DELIM_RE.match(line):
                in_front_matter = False
            continue

        fence_match = _CODE_FENCE_RE.match(line)
        if fence_match:
            fence_run = fence_match.group(1)
            fence_char = fence_run[0]
            fence_len = len(fence_run)


            remainder_after_fence = line[fence_match.end() :]
            is_close_eligible = remainder_after_fence.strip() == ""
            if open_fence is None:
                open_fence = (fence_char, fence_len)
            elif fence_char == open_fence[0] and fence_len >= open_fence[1] and is_close_eligible:
                open_fence = None


            masked_lines.append("")
            continue
        if open_fence is not None:
            masked_lines.append("")
            continue

        line, in_html_comment = _mask_html_comments_in_line(line, in_html_comment)

        if (
            _HEADING_RE.match(line)
            or _LIST_ITEM_RE.match(line)
            or _BLOCKQUOTE_RE.match(line)
            or (_TABLE_ROW_RE.match(line) and line.count("|") >= 2)
            or _TABLE_DELIMITER_RE.match(line)
        ):
            masked_lines.append("")
            continue
        masked_lines.append(_blank_inline_code_spans(line))
    return "\n".join(masked_lines)


def iter_lines_with_no(text: str) -> list[tuple[int, str]]:

    return list(enumerate(text.splitlines(), start=1))


def find_line_no(lines: list[tuple[int, str]], needle: str, start_hint: int = 0) -> int:


    for no, line in lines:
        if no >= start_hint and needle in line:
            return no
    for no, line in lines:
        if needle in line:
            return no
    return start_hint or 1


def iter_paragraphs_with_lines(
    lines: list[tuple[int, str]],
) -> list[list[tuple[int, str]]]:


    paragraphs: list[list[tuple[int, str]]] = []
    current: list[tuple[int, str]] = []
    for no, line in lines:
        if line.strip():
            current.append((no, line))
        else:
            if current:
                paragraphs.append(current)
                current = []
    if current:
        paragraphs.append(current)
    return paragraphs


SENTENCE_SPLIT_RE = re.compile(r"[。！？\n]")


def split_sentences_with_lines(
    lines: list[tuple[int, str]], raw_lines_by_no: dict[int, str] | None = None
) -> list[tuple[int, str, str]]:


    sentences = []
    for no, line in lines:
        raw_line = raw_lines_by_no.get(no, line) if raw_lines_by_no else line
        bounds = []
        prev = 0
        for m in SENTENCE_SPLIT_RE.finditer(line):
            bounds.append((prev, m.start()))
            prev = m.end()
        bounds.append((prev, len(line)))
        for s, e in bounds:
            piece = line[s:e]
            if piece.strip():
                raw_piece = raw_line[s:e] if len(raw_line) >= e else piece
                sentences.append((no, piece.strip(), raw_piece.strip()))
    return sentences


def _heading_level_and_text(line: str) -> tuple[int, str]:


    m = re.match(r"^\s*(#{1,6})\s*(.*?)(?:\s+#+)?\s*$", line)
    if not m:
        return 0, line.strip()
    return len(m.group(1)), m.group(2).strip()


def read_source_file(path: Path) -> tuple[str | None, str | None]:


    if not path.exists():
        return None, f"エラー: ファイルが見つかりません: {path}"
    if path.is_dir():
        return None, f"エラー: ディレクトリが指定されました（ファイルを指定してください）: {path}"
    try:
        return path.read_text(encoding="utf-8"), None
    except (OSError, UnicodeDecodeError) as exc:
        return None, f"エラー: ファイルを読み込めません: {path} ({exc})"

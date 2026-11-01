# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "sudachipy>=0.6.8",
#     "sudachidict-core>=20240409",
# ]
# ///


from __future__ import annotations

import argparse
import dataclasses
import json
import re
import statistics
import sys
from pathlib import Path

from textcore import (
    Finding,
    SENTENCE_SPLIT_RE,
    _HEADING_RE,
    _LIST_ITEM_RE,
    get_tokenizer,
    iter_lines_with_no,
    iter_paragraphs_with_lines,
    mask_html_comments,
    mask_markdown_structure,
    read_source_file,
    split_sentences_with_lines,
)


FORBIDDEN_PHRASES: list[str] = [

    "と言えるでしょう",
    "と言えるだろう",
    "と言えます",
    "ということになるでしょう",
    "のではないでしょうか",
    "重要なのは",
    "大切なのは",
    "ポイントは",
    "結論から言うと",
    "結論として",
    "いかがでしたか",
    "いかがでしょうか",

    "まとめると",
    "総じて",

    "非常に重要",
    "極めて重要",
    "言うまでもなく",
    "言うまでもありません",

    "まさしく",

    "さて、",
    "それでは、",
    "このように",
    "このような中",
    "ここで注目したいのは",
    "見ていきましょう",
    "紹介していきます",
    "解説していきます",
    "深掘りしていきます",

    "一概には言えません",
    "個人差がありますが",
    "あくまで一例ですが",

    "正面から扱う",
    "正面から見る",
    "正面から書く",
    "正面から立てる",
    "正面から回収する",

    "不可欠",
    "核心的",
    "鍵となる",
    "根本的な",
    "多角的",
    "包括的",
    "総合的",

    "掘り下げる",
    "深掘りする",
    "言語化する",
    "について見ていく",
    "を探求する",
]


FORBIDDEN_PHRASES_WEAK_SIGNAL: set[str] = {
    "重要なのは",
    "このように",
    "不可欠",
    "ポイントは",
    "さて、",
}


TRANSLATIONESE_PATTERNS: list[str] = [
    r"することができ(る|ます|た)",
    r"することが可能(です|だ|になる)",
    r"と言えるだろう",
    r"という点で",
    r"という観点(から|で)",
    r"にとって(重要|不可欠)",
    r"を持つ(こと|存在)",
    r"することによって",
    r"であることは間違いない",
    r"に他ならない",
]


PARAGRAPH_CONJUNCTIONS: list[str] = [
    "しかし",
    "また",
    "そして",
    "そのため",
    "さらに",
    "つまり",
    "一方",
    "一方で",
    "このように",
    "なぜなら",
    "したがって",
    "ただし",
]


ANTITHESIS_PATTERNS = [
    re.compile(r"ではなく、?.{0,30}"),
    re.compile(r"だけでなく.{0,10}も"),
]


ANTITHESIS_REPETITION_THRESHOLD = 3


ANTITHESIS_RATE_INFO_BELOW = 0.02
ANTITHESIS_RATE_CRITICAL_ABOVE = 0.03
SENTENCE_VARIANCE_MIN_SENTENCES = 5
SENTENCE_VARIANCE_CV_THRESHOLD = 0.25
NOMINAL_ENDING_MIN_SENTENCES = 5


NOMINAL_ENDING_RATIO_THRESHOLD = 0.0
NOMINAL_ENDING_MIN_CHARS = 2000
PARAGRAPH_CONJ_MIN_PARAGRAPHS = 3
PARAGRAPH_CONJ_RATIO_THRESHOLD = 0.3
UNIFORM_PARAGRAPH_MIN_PARAGRAPHS = 4
UNIFORM_PARAGRAPH_CV_THRESHOLD = 0.15

BURSTINESS_MIN_TOKENIZED = 6


BURSTINESS_THRESHOLD = -0.24
AUTOCORR_MIN_XS = 4
AUTOCORR_THRESHOLD = 0.6


NGRAM_LEAD_REPEAT_THRESHOLD = 6
NGRAM_TEMPLATE_MIN_COUNT = 6
NGRAM_TEMPLATE_RATIO_THRESHOLD = 0.4
LEXDIV_MIN_TOKENS = 30
TTR_THRESHOLD = 0.45
MTLD_THRESHOLD = 40


LEXDIV_MIN_DOC_CHARS = 4000


LOW_SPECIFICITY_MIN_CHARS = 80
LOW_SPECIFICITY_MIN_CONTENT_WORDS = 15
LOW_SPECIFICITY_PROPER_NOUN_WEIGHT = 1.0
LOW_SPECIFICITY_NUMERIC_WEIGHT = 1.0
LOW_SPECIFICITY_EXAMPLE_MARKER_BONUS = 0.1
LOW_SPECIFICITY_ABSTRACT_NOUN_WEIGHT = 1.5
LOW_SPECIFICITY_SCORE_THRESHOLD = -0.15


ABSTRACT_NOUN_WORDS: set[str] = {
    "側面",
    "観点",
    "重要性",
    "可能性",
    "あり方",
    "存在",
    "意味",
    "本質",
    "価値",
    "意義",
    "課題",
    "問題",
    "要素",
    "要因",
    "背景",
    "傾向",
    "姿勢",
    "視点",
    "概念",
    "特徴",
    "性質",
    "状況",
    "状態",
    "変化",
}


EXAMPLE_MARKER_WORDS: list[str] = [
    "たとえば",
    "例えば",
    "実際に",
    "実際には",
    "具体的には",
    "具体例として",
    "一例として",
    "先日",
    "昨日",
    "現に",
    "実例として",
]


NUMERIC_QUANTITY_RE = re.compile(
    r"[0-9０-９]+"
    r"(年代|年間|世紀|年|月|日|時間|時|分|秒|人|円|%|％|kg|km|cm|mm|g|m|回|件|個|つ|割|倍|台|社|名|冊|本|杯|軒)?"
)


GENRE_PROFILES: dict[str, dict] = {
    "essay": {


        "nominal_min_chars": 1500,


        "lead_repeat_threshold": 5,


        "reading_load_sentence_max_chars": 110,
    },
    "tech": {


        "nominal_min_chars": 3000,
        "lead_repeat_threshold": 7,


        "antithesis_rate_critical_above": 0.045,
    },


    "business": {
        "nominal_min_chars": 3000,
        "lead_repeat_threshold": 7,
        "disabled_categories": {
            "high_bullet_ratio",
            "high_bold_density",
            "boilerplate_heading",
            "numbered_phase_structure",
        },
    },
}


def format_related_lines(related_lines: list[int]) -> str:

    uniq_sorted = sorted(set(related_lines))
    return "対応箇所: " + ", ".join(f"L{n}" for n in uniq_sorted)


_BASELINE_KEY_EXCERPT_PREFIX_LEN = 20


_CATEGORY_ONLY_KEY_CATEGORIES = {
    "low_burstiness",
    "high_length_autocorrelation",
    "low_sentence_variance",
    "uniform_paragraph_structure",
    "low_lexical_diversity_ttr",
    "low_lexical_diversity_mtld",
}


def _normalize_excerpt_for_key(excerpt: str) -> str:

    return re.sub(r"\s+", "", excerpt or "")


def _finding_identity_key(category: str, excerpt: str) -> tuple[str, str]:


    if category in _CATEGORY_ONLY_KEY_CATEGORIES:
        return (category, "")
    normalized = _normalize_excerpt_for_key(excerpt)
    return (category, normalized[:_BASELINE_KEY_EXCERPT_PREFIX_LEN])


def validate_baseline_data(baseline_data) -> tuple[dict | None, list[str]]:


    warnings: list[str] = []
    if not isinstance(baseline_data, dict):
        warnings.append(
            "--baseline の内容が JSON オブジェクトではありません。baseline比較を無視して通常のlintを実行します。"
        )
        return None, warnings

    findings_raw = baseline_data.get("findings")
    if not isinstance(findings_raw, list):
        warnings.append(
            "--baseline に 'findings' 配列が見つかりません。baseline比較を無視して通常のlintを実行します。"
        )
        return None, warnings

    valid_findings = []
    skipped = 0
    for item in findings_raw:


        if (
            isinstance(item, dict)
            and isinstance(item.get("category"), str)
            and isinstance(item.get("excerpt"), str)
        ):
            valid_findings.append(item)
        else:
            skipped += 1
    if skipped:
        warnings.append(
            f"--baseline の findings 配列内に不正な要素が{skipped}件あったため読み飛ばしました。"
        )
    return {"findings": valid_findings}, warnings


def compute_baseline_diff(
    findings: list[Finding], baseline_data: dict
) -> tuple[list[dict], dict[str, int]]:


    from collections import defaultdict

    baseline_findings = baseline_data.get("findings", [])
    baseline_by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for bf in baseline_findings:
        key = _finding_identity_key(bf.get("category", ""), bf.get("excerpt", ""))
        baseline_by_key[key].append(bf)

    for f in findings:
        key = _finding_identity_key(f.category, f.excerpt)
        bucket = baseline_by_key.get(key)
        if bucket:
            bucket.pop(0)
            f.status = "persisting"
        else:
            f.status = "new"

    resolved = [bf for bucket in baseline_by_key.values() for bf in bucket]

    summary = {
        "resolved": len(resolved),
        "new": sum(1 for f in findings if f.status == "new"),
        "persisting": sum(1 for f in findings if f.status == "persisting"),
    }
    return resolved, summary


def _raw_or_masked(raw_lines_by_no: dict[int, str] | None, no: int, fallback: str) -> str:

    if raw_lines_by_no is None:
        return fallback
    return raw_lines_by_no.get(no, fallback)


def detect_forbidden_phrases(
    lines: list[tuple[int, str]], raw_lines_by_no: dict[int, str] | None = None
) -> list[Finding]:


    findings = []
    for no, line in lines:
        raw_line = _raw_or_masked(raw_lines_by_no, no, line)
        for phrase in FORBIDDEN_PHRASES:
            idx = line.find(phrase)
            if idx != -1:
                start = max(0, idx - 10)
                end = idx + len(phrase) + 10
                excerpt = raw_line[start:end] if len(raw_line) >= end else line[start:end]
                is_weak_signal = phrase in FORBIDDEN_PHRASES_WEAK_SIGNAL
                severity = "info" if is_weak_signal else "warn"
                detail = f"禁止語/LLM常套句ヒット: 「{phrase}」"
                if is_weak_signal:
                    detail += "（コーパス校正で人間側にも一定数出現する弱いシグナルと判定、severity低下）"
                findings.append(
                    Finding(
                        line=no,
                        category="forbidden_phrase",
                        excerpt=excerpt.strip(),
                        severity=severity,
                        detail=detail,
                    )
                )
    return findings


def detect_translationese(
    lines: list[tuple[int, str]], raw_lines_by_no: dict[int, str] | None = None
) -> list[Finding]:
    findings = []
    for no, line in lines:
        raw_line = _raw_or_masked(raw_lines_by_no, no, line)
        for pat in TRANSLATIONESE_PATTERNS:
            for m in re.finditer(pat, line):
                start = max(0, m.start() - 10)
                end = m.end() + 10
                excerpt = raw_line[start:end] if len(raw_line) >= end else line[start:end]
                findings.append(
                    Finding(
                        line=no,
                        category="translationese",
                        excerpt=excerpt.strip(),
                        severity="info",
                        detail=f"翻訳調パターン: /{pat}/ に一致",
                    )
                )
    return findings


def detect_antithesis_repetition(
    lines: list[tuple[int, str]],
    raw_lines_by_no: dict[int, str] | None = None,
    threshold: int = ANTITHESIS_REPETITION_THRESHOLD,
    rate_info_below: float = ANTITHESIS_RATE_INFO_BELOW,
    rate_critical_above: float = ANTITHESIS_RATE_CRITICAL_ABOVE,
) -> list[Finding]:


    hits: list[tuple[int, str, str]] = []
    for no, line in lines:
        raw_line = _raw_or_masked(raw_lines_by_no, no, line)
        for pat in ANTITHESIS_PATTERNS:
            for m in re.finditer(pat, line):
                excerpt = raw_line[m.start() : m.end()] if len(raw_line) >= m.end() else m.group(0)
                hits.append((no, excerpt, pat.pattern))

    findings = []
    if len(hits) >= threshold:


        total_sentences = len(split_sentences_with_lines(lines, raw_lines_by_no))
        ratio = len(hits) / total_sentences if total_sentences else 0.0
        if ratio < rate_info_below:
            severity = "info"
        elif ratio >= rate_critical_above:
            severity = "critical"
        else:
            severity = "warn"

        all_lines = [no for no, _, _ in hits]
        related = format_related_lines(all_lines)
        for no, text, patname in hits:
            findings.append(
                Finding(
                    line=no,
                    category="antithesis_repetition",
                    excerpt=text.strip(),
                    severity=severity,
                    detail=(
                        f"否定→肯定対比パターンが文書内で{len(hits)}回検出（閾値{threshold}回以上、"
                        f"総文数に対する比率={ratio:.1%}）。{related}"
                    ),
                    related_lines=all_lines,
                )
            )
    return findings


def detect_low_sentence_length_variance(
    sentences: list[tuple[int, str, str]],
    threshold: float = SENTENCE_VARIANCE_CV_THRESHOLD,
    min_sentences: int = SENTENCE_VARIANCE_MIN_SENTENCES,
) -> list[Finding]:


    lengths = [len(s) for _, s, _ in sentences if len(s) > 0]
    if len(lengths) < min_sentences:
        return []
    mean = statistics.mean(lengths)
    if mean == 0:
        return []
    stdev = statistics.pstdev(lengths)
    cv = stdev / mean
    if cv < threshold:
        first_line = sentences[0][0] if sentences else 1
        return [
            Finding(
                line=first_line,
                category="low_sentence_variance",
                excerpt=f"文数={len(lengths)}, 平均文長={mean:.1f}字, 変動係数={cv:.3f}",
                severity="warn",
                detail=f"文長の変動係数が閾値({threshold})未満。リズムが均質でAI臭い可能性",
            )
        ]
    return []


NOUN_ENDING_POS = {"名詞"}
TRAILING_SYMBOL_POS = {"補助記号", "空白"}


CONTENT_WORD_POS = {"名詞", "動詞", "形容詞", "副詞"}


ABSTRACT_PRONOUNS = {"これ", "それ", "あれ", "それら"}

ABSTRACT_PRONOUN_PHRASES = {"この事実", "そのこと"}

TRANSITIVE_SMELL_VERBS = {
    "もたらす",
    "示す",
    "意味する",
    "証明する",
    "生み出す",
    "反映する",
    "示唆する",
    "物語る",
    "浮き彫りにする",
    "後押しする",
}


@dataclasses.dataclass
class TokenizedSentence:
    line: int
    text: str
    morphemes: list
    raw_text: str = ""


def tokenize_sentences(sentences: list[tuple[int, str, str]]) -> list[TokenizedSentence]:


    tokenizer = get_tokenizer()
    from sudachipy import SplitMode

    result = []
    for no, sent, raw_sent in sentences:
        if not sent:
            continue
        morphemes = list(tokenizer.tokenize(sent, SplitMode.C))
        result.append(TokenizedSentence(line=no, text=sent, morphemes=morphemes, raw_text=raw_sent or sent))
    return result


def _strip_leading_symbols(morphemes: list) -> list:


    i = 0
    while i < len(morphemes) and morphemes[i].part_of_speech()[0] in TRAILING_SYMBOL_POS:
        i += 1
    return morphemes[i:]


def _strip_trailing_symbols(morphemes: list) -> list:

    i = len(morphemes)
    while i > 0 and morphemes[i - 1].part_of_speech()[0] in TRAILING_SYMBOL_POS:
        i -= 1
    return morphemes[:i]


def detect_nominal_ending_and_paragraph_conjunctions(
    lines: list[tuple[int, str]],
    tokenized: list[TokenizedSentence],
    raw_lines_by_no: dict[int, str] | None = None,
    nominal_min_sentences: int = NOMINAL_ENDING_MIN_SENTENCES,
    nominal_ratio_threshold: float = NOMINAL_ENDING_RATIO_THRESHOLD,
    nominal_min_chars: int = NOMINAL_ENDING_MIN_CHARS,
    conj_min_paragraphs: int = PARAGRAPH_CONJ_MIN_PARAGRAPHS,
    conj_ratio_threshold: float = PARAGRAPH_CONJ_RATIO_THRESHOLD,
    uniform_min_paragraphs: int = UNIFORM_PARAGRAPH_MIN_PARAGRAPHS,
    uniform_cv_threshold: float = UNIFORM_PARAGRAPH_CV_THRESHOLD,
) -> tuple[list[Finding], dict]:


    nominal_ending_count = 0
    total_sentences = 0
    total_chars = 0
    last_line = 1

    for ts in tokenized:
        total_sentences += 1
        total_chars += len(ts.raw_text)
        last_line = ts.line
        effective = _strip_trailing_symbols(ts.morphemes)
        if not effective:
            continue
        last = effective[-1]
        pos = last.part_of_speech()[0]

        if pos in NOUN_ENDING_POS:
            nominal_ending_count += 1

    ratio = nominal_ending_count / total_sentences if total_sentences else 0.0

    findings = []
    if (
        total_sentences >= nominal_min_sentences
        and total_chars >= nominal_min_chars
        and ratio <= nominal_ratio_threshold
    ):


        findings.append(
            Finding(
                line=last_line,
                category="nominal_ending",
                excerpt=f"体言止め0件（全{total_sentences}文、約{total_chars}字）",
                severity="info",
                detail=(
                    'この文書には体言止めがない。文末のリズムを確認するための参考情報であり、体言止めを機械的に増やす必要はありません。'                ),
            )
        )


    paragraphs = iter_paragraphs_with_lines(lines)
    conj_paragraph_count = 0
    total_paragraphs = len(paragraphs)
    conj_findings = []
    sentence_counts_per_paragraph = []
    for para_lines in paragraphs:
        first_no, first_line_raw = para_lines[0]
        first_line_text = first_line_raw.strip()
        para_joined = "\n".join(t for _, t in para_lines)
        sentence_counts_per_paragraph.append(
            len([p for p in SENTENCE_SPLIT_RE.split(para_joined) if p.strip()])
        )
        for conj in PARAGRAPH_CONJUNCTIONS:
            if first_line_text.startswith(conj):
                conj_paragraph_count += 1
                conj_findings.append((first_no, first_line_text, conj))
                break

    conj_ratio = conj_paragraph_count / total_paragraphs if total_paragraphs else 0.0
    if total_paragraphs >= conj_min_paragraphs and conj_ratio >= conj_ratio_threshold:
        conj_lines = [no for no, _, _ in conj_findings]
        related = format_related_lines(conj_lines)
        for no, text_line, conj in conj_findings:
            excerpt_source = _raw_or_masked(raw_lines_by_no, no, text_line)
            findings.append(
                Finding(
                    line=no,
                    category="paragraph_lead_conjunction",
                    excerpt=excerpt_source[:40],
                    severity="info",
                    detail=(
                        f"段落頭が接続詞「{conj}」で始まる（文書全体の段落頭接続詞率={conj_ratio:.1%}、"
                        f"閾値{conj_ratio_threshold:.0%}以上で警告）。{related}"
                    ),
                    related_lines=conj_lines,
                )
            )


    para_structure_stats = {
        "paragraph_sentence_counts": sentence_counts_per_paragraph,
        "paragraph_sentence_count_cv": None,
    }
    if len(sentence_counts_per_paragraph) >= uniform_min_paragraphs:
        p_mean = statistics.mean(sentence_counts_per_paragraph)
        p_std = statistics.pstdev(sentence_counts_per_paragraph)
        p_cv = (p_std / p_mean) if p_mean else 0.0
        para_structure_stats["paragraph_sentence_count_cv"] = p_cv
        if p_cv < uniform_cv_threshold:
            findings.append(
                Finding(
                    line=1,
                    category="uniform_paragraph_structure",
                    excerpt=f"段落数={len(sentence_counts_per_paragraph)}, 各段落の文数={sentence_counts_per_paragraph}",
                    severity="info",
                    detail=(
                        f"段落あたり文数の変動係数={p_cv:.3f}（閾値{uniform_cv_threshold}未満）。"
                        "どの段落もほぼ同じ文数=定型段落（例: 3文段落の量産）の疑い"
                    ),
                )
            )

    stats = {
        "total_sentences": total_sentences,
        "nominal_ending_count": nominal_ending_count,
        "nominal_ending_ratio": ratio,
        "total_paragraphs": total_paragraphs,
        "paragraph_lead_conjunction_count": conj_paragraph_count,
        "paragraph_lead_conjunction_ratio": conj_ratio,
        **para_structure_stats,
    }
    return findings, stats


def detect_translationese_morph(tokenized: list[TokenizedSentence]) -> list[Finding]:


    findings = []
    for ts in tokenized:
        surfaces = [m.surface() for m in ts.morphemes]
        poss = [m.part_of_speech()[0] for m in ts.morphemes]
        n = len(ts.morphemes)
        for i in range(n):

            if surfaces[i] == "こと" and poss[i] == "名詞":
                j = i + 1
                if j < n and poss[j] == "助詞" and surfaces[j] in {"が", "は"}:
                    k = j + 1
                    if k < n and poss[k] == "動詞" and surfaces[k].startswith("でき"):


                        span_start = ts.morphemes[max(0, i - 4)].begin()
                        span_end = ts.morphemes[k].end()
                        excerpt = ts.raw_text[span_start:span_end]
                        findings.append(
                            Finding(
                                line=ts.line,
                                category="translationese_morph",
                                excerpt=excerpt,
                                severity="info",
                                detail="品詞列マッチ: 名詞/動詞+こと+が/は+できる型の翻訳調構文",
                            )
                        )
    return findings


_SMALL_KANA_MERGE = set("ァィゥェォャュョヮ")


def mora_length(morphemes: list) -> int:


    total = 0
    for m in morphemes:
        reading = m.reading_form() or m.surface()
        count = 0
        for ch in reading:
            if ch in _SMALL_KANA_MERGE and count > 0:

                continue
            count += 1
        total += count
    return total


def detect_rhythm_statistics(
    tokenized: list[TokenizedSentence],
    min_tokenized: int = BURSTINESS_MIN_TOKENIZED,
    burstiness_threshold: float = BURSTINESS_THRESHOLD,
    autocorr_min_xs: int = AUTOCORR_MIN_XS,
    autocorr_threshold: float = AUTOCORR_THRESHOLD,
) -> tuple[list[Finding], dict]:


    if len(tokenized) < min_tokenized:
        return [], {}

    mora_lengths = [mora_length(ts.morphemes) for ts in tokenized]
    mean = statistics.mean(mora_lengths)
    std = statistics.pstdev(mora_lengths)

    findings = []
    burstiness = (std - mean) / (std + mean) if (std + mean) else 0.0


    xs = mora_lengths[:-1]
    ys = mora_lengths[1:]
    autocorr = None
    if len(xs) >= autocorr_min_xs and statistics.pstdev(xs) > 0 and statistics.pstdev(ys) > 0:
        mx, my = statistics.mean(xs), statistics.mean(ys)
        cov = sum((a - mx) * (b - my) for a, b in zip(xs, ys)) / len(xs)
        autocorr = cov / (statistics.pstdev(xs) * statistics.pstdev(ys))


    if burstiness < burstiness_threshold:
        findings.append(
            Finding(
                line=tokenized[0].line,
                category="low_burstiness",
                excerpt=f"burstiness={burstiness:.3f} (モーラ近似長 平均={mean:.1f}, 標準偏差={std:.1f})",
                severity="warn",
                detail=f"burstiness が閾値({burstiness_threshold})未満。文の長短のメリハリが乏しく機械的なリズムの疑い",
            )
        )

    if autocorr is not None and autocorr > autocorr_threshold:
        findings.append(
            Finding(
                line=tokenized[0].line,
                category="high_length_autocorrelation",
                excerpt=f"lag-1 自己相関={autocorr:.3f}",
                severity="info",
                detail=f"隣接する文の長さが強く相関（閾値{autocorr_threshold}超）。文長パターンが単調に繰り返されている疑い",
            )
        )

    stats = {
        "mora_mean": mean,
        "mora_stdev": std,
        "burstiness": burstiness,
        "length_autocorrelation_lag1": autocorr,
    }
    return findings, stats


_LATIN_TECH_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z0-9\-_.]*$")


def _is_proper_noun_or_tech_term(morpheme) -> bool:


    pos = morpheme.part_of_speech()
    surface = morpheme.surface()
    is_proper_noun = pos[0] == "名詞" and pos[1] == "固有名詞"
    is_latin_tech = bool(_LATIN_TECH_TOKEN_RE.match(surface))
    return is_proper_noun or is_latin_tech


def detect_ngram_repetition(
    tokenized: list[TokenizedSentence],
    lead_repeat_threshold: int = NGRAM_LEAD_REPEAT_THRESHOLD,
    template_min_count: int = NGRAM_TEMPLATE_MIN_COUNT,
    template_ratio_threshold: float = NGRAM_TEMPLATE_RATIO_THRESHOLD,
) -> tuple[list[Finding], dict]:


    from collections import Counter

    findings = []

    lead_bigrams = []
    for ts in tokenized:


        lead_morphemes = _strip_leading_symbols(ts.morphemes)[:2]
        surfaces = [m.surface() for m in lead_morphemes]
        if len(surfaces) == 2:
            is_tech_lead = _is_proper_noun_or_tech_term(lead_morphemes[0])
            lead_bigrams.append((ts.line, ts.raw_text, "".join(surfaces), is_tech_lead))

    bigram_counter = Counter(text for _, _, text, _ in lead_bigrams)
    for bigram, count in bigram_counter.items():
        if count >= lead_repeat_threshold:
            bigram_lines = [no for no, _, text, _ in lead_bigrams if text == bigram]
            related = format_related_lines(bigram_lines)
            for no, sent, text, is_tech_lead in lead_bigrams:
                if text == bigram:


                    severity = "info"
                    if is_tech_lead:
                        detail = (
                            f"文頭2形態素「{bigram}」が{count}回反復（閾値{lead_repeat_threshold}回以上）。"
                            f"固有名詞/技術用語由来の可能性が高い。{related}"
                        )
                    else:
                        detail = (
                            f"文頭2形態素「{bigram}」が{count}回反復（閾値{lead_repeat_threshold}回以上）。"
                            f"人間の意図的な反復技法との区別がつかないため参考情報として提示。{related}"
                        )
                    findings.append(
                        Finding(
                            line=no,
                            category="repeated_sentence_lead",
                            excerpt=sent[:20],
                            severity=severity,
                            detail=detail,
                            related_lines=bigram_lines,
                        )
                    )

    lead_pos_ngrams = []
    for ts in tokenized:


        pos_seq = tuple(m.part_of_speech()[0] for m in _strip_leading_symbols(ts.morphemes)[:4])
        if len(pos_seq) == 4:
            lead_pos_ngrams.append((ts.line, ts.raw_text, pos_seq))

    total_with_ngram = len(lead_pos_ngrams)
    pos_counter = Counter(seq for _, _, seq in lead_pos_ngrams)
    stats = {"lead_pos_4gram_top": None, "lead_pos_4gram_ratio": None}
    if total_with_ngram >= template_min_count and pos_counter:
        top_seq, top_count = pos_counter.most_common(1)[0]
        ratio = top_count / total_with_ngram
        stats["lead_pos_4gram_top"] = "/".join(top_seq)
        stats["lead_pos_4gram_ratio"] = ratio
        if ratio >= template_ratio_threshold:
            template_lines = [no for no, _, seq in lead_pos_ngrams if seq == top_seq]
            related = format_related_lines(template_lines)
            for no, sent, seq in lead_pos_ngrams:
                if seq == top_seq:
                    findings.append(
                        Finding(
                            line=no,
                            category="repeated_syntax_template",
                            excerpt=sent[:20],
                            severity="info",
                            detail=(
                                f"文頭品詞4-gram「{'/'.join(top_seq)}」が全文の{ratio:.1%}で一致"
                                f"（閾値{template_ratio_threshold:.0%}以上）。構文テンプレートの使い回しの疑い。{related}"
                            ),
                            related_lines=template_lines,
                        )
                    )

    return findings, stats


def compute_mtld(tokens: list[str], threshold: float = 0.72) -> float | None:


    if len(tokens) < 20:
        return None

    def factors_one_direction(seq: list[str]) -> float:
        factor_count = 0
        types: set[str] = set()
        token_count = 0
        for tok in seq:
            types.add(tok)
            token_count += 1
            ttr = len(types) / token_count
            if ttr <= threshold:
                factor_count += 1
                types = set()
                token_count = 0

        if token_count > 0:
            types_ttr = len(types) / token_count if token_count else 1.0
            partial = (1 - types_ttr) / (1 - threshold) if types_ttr < 1 else 0.0
            factor_count += min(partial, 1.0)
        return len(seq) / factor_count if factor_count > 0 else float(len(seq))

    forward = factors_one_direction(tokens)
    backward = factors_one_direction(list(reversed(tokens)))
    return (forward + backward) / 2


def detect_lexical_diversity(
    tokenized: list[TokenizedSentence],
    min_tokens: int = LEXDIV_MIN_TOKENS,
    ttr_threshold: float = TTR_THRESHOLD,
    mtld_threshold: float = MTLD_THRESHOLD,
    min_doc_chars: int = LEXDIV_MIN_DOC_CHARS,
) -> tuple[list[Finding], dict]:


    content_tokens = []
    total_doc_chars = sum(len(ts.raw_text) for ts in tokenized)
    for ts in tokenized:
        for m in ts.morphemes:
            if m.part_of_speech()[0] in CONTENT_WORD_POS:
                content_tokens.append(m.dictionary_form())

    findings = []
    stats = {
        "ttr": None,
        "mtld": None,
        "content_token_count": len(content_tokens),
        "doc_char_count": total_doc_chars,
        "skipped_too_short": False,
    }
    if total_doc_chars < min_doc_chars:
        stats["skipped_too_short"] = True
        return findings, stats
    if len(content_tokens) >= min_tokens:
        ttr = len(set(content_tokens)) / len(content_tokens)
        mtld = compute_mtld(content_tokens)
        stats["ttr"] = ttr
        stats["mtld"] = mtld
        if ttr < ttr_threshold:
            findings.append(
                Finding(
                    line=tokenized[0].line,
                    category="low_lexical_diversity_ttr",
                    excerpt=f"TTR={ttr:.3f} (内容語 {len(content_tokens)} 語中 {len(set(content_tokens))} 種類)",
                    severity="info",
                    detail=f"TTR(Type-Token Ratio)が閾値{ttr_threshold}未満。同じ語彙の使い回しが多い疑い",
                )
            )
        if mtld is not None and mtld < mtld_threshold:
            findings.append(
                Finding(
                    line=tokenized[0].line,
                    category="low_lexical_diversity_mtld",
                    excerpt=f"MTLD={mtld:.1f}",
                    severity="info",
                    detail=f"MTLD が閾値{mtld_threshold}未満。文章長で正規化した語彙多様性が低い疑い",
                )
            )
    return findings, stats


def detect_low_specificity(
    lines: list[tuple[int, str]],
    raw_lines_by_no: dict[int, str] | None = None,
    min_chars: int = LOW_SPECIFICITY_MIN_CHARS,
    min_content_words: int = LOW_SPECIFICITY_MIN_CONTENT_WORDS,
    proper_noun_weight: float = LOW_SPECIFICITY_PROPER_NOUN_WEIGHT,
    numeric_weight: float = LOW_SPECIFICITY_NUMERIC_WEIGHT,
    example_marker_bonus: float = LOW_SPECIFICITY_EXAMPLE_MARKER_BONUS,
    abstract_noun_weight: float = LOW_SPECIFICITY_ABSTRACT_NOUN_WEIGHT,
    score_threshold: float = LOW_SPECIFICITY_SCORE_THRESHOLD,
) -> tuple[list[Finding], dict]:


    tokenizer = get_tokenizer()
    from sudachipy import SplitMode

    findings: list[Finding] = []
    paragraphs = iter_paragraphs_with_lines(lines)
    evaluated = 0
    fired = 0

    for para_lines in paragraphs:
        first_no, _ = para_lines[0]
        para_masked = "\n".join(t for _, t in para_lines)
        para_chars = len(para_masked)
        if para_chars < min_chars:
            continue


        morphemes = []
        for _, para_line in para_lines:
            if not para_line.strip():
                continue
            morphemes.extend(tokenizer.tokenize(para_line, SplitMode.C))
        content_words = [m for m in morphemes if m.part_of_speech()[0] in CONTENT_WORD_POS]
        if len(content_words) < min_content_words:
            continue

        evaluated += 1

        proper_noun_count = sum(
            1 for m in content_words if m.part_of_speech()[0] == "名詞" and m.part_of_speech()[1] == "固有名詞"
        )
        abstract_noun_count = sum(
            1
            for m in content_words
            if m.part_of_speech()[0] == "名詞" and m.dictionary_form() in ABSTRACT_NOUN_WORDS
        )
        numeric_hit_count = len(list(NUMERIC_QUANTITY_RE.finditer(para_masked)))
        has_example_marker = any(marker in para_masked for marker in EXAMPLE_MARKER_WORDS)

        n_content = len(content_words)
        proper_noun_density = proper_noun_count / n_content
        numeric_density = numeric_hit_count / n_content
        abstract_noun_ratio = abstract_noun_count / n_content

        score = (
            proper_noun_density * proper_noun_weight
            + numeric_density * numeric_weight
            + (example_marker_bonus if has_example_marker else 0.0)
            - abstract_noun_ratio * abstract_noun_weight
        )

        if score < score_threshold:
            fired += 1
            excerpt_source = _raw_or_masked(raw_lines_by_no, first_no, para_lines[0][1])
            findings.append(
                Finding(
                    line=first_no,
                    category="low_specificity",
                    excerpt=excerpt_source.strip()[:40],
                    severity="info",
                    detail=(
                        f"段落の具体性スコア={score:.3f}（閾値{score_threshold}未満）。"
                        f"固有名詞密度={proper_noun_density:.3f}, 数値密度={numeric_density:.3f}, "
                        f"抽象名詞率={abstract_noun_ratio:.3f}, 例示マーカー={'あり' if has_example_marker else 'なし'}。"
                        "固有名詞・数値・実例が乏しく一般論に留まっている疑い。"
                        "素材不足のサインであり、文体の修正でなく情報収集を検討する"
                        "（revision-guide.md の素材不足の分岐を参照）"
                    ),
                )
            )

    stats = {
        "paragraphs_evaluated": evaluated,
        "paragraphs_fired": fired,
    }
    return findings, stats


INANIMATE_SUBJECT_PATTERNS = [
    re.compile(r"(これ|それ|この事実|そのこと)(は|が).{0,40}(もたらす|示す|意味する|証明する|生み出す|反映する)"),
    re.compile(r".{0,20}(こと|事実)(は|が).{0,40}(もたらす|示す|意味する|証明する|生み出す|反映する)"),
]


CLEFT_BECAUSE_HEAD = re.compile(r"^(それ|これ|この)は.{0,60}(である|だ)$")
BECAUSE_HEAD = re.compile(r"^(なぜなら|というのも)")


def detect_english_syntax_smell(
    lines: list[tuple[int, str]], raw_lines_by_no: dict[int, str] | None = None
) -> list[Finding]:
    findings = []
    for no, line in lines:
        raw_line = _raw_or_masked(raw_lines_by_no, no, line)
        for pat in INANIMATE_SUBJECT_PATTERNS:
            for m in re.finditer(pat, line):
                excerpt = raw_line[m.start() : m.end()] if len(raw_line) >= m.end() else m.group(0)
                findings.append(
                    Finding(
                        line=no,
                        category="english_syntax_inanimate_subject",
                        excerpt=excerpt,
                        severity="info",
                        detail="無生物主語+他動詞的述語（表層パターン、英語統語の直訳調の可能性、要人間判断）",
                    )
                )


    sentences = split_sentences_with_lines(lines, raw_lines_by_no)
    for i in range(len(sentences) - 1):
        no1, s1, r1 = sentences[i]
        no2, s2, r2 = sentences[i + 1]
        if CLEFT_BECAUSE_HEAD.match(s1) and BECAUSE_HEAD.match(s2):
            findings.append(
                Finding(
                    line=no1,
                    category="english_syntax_cleft_because",
                    excerpt=f"{r1}。{r2}",
                    severity="warn",
                    detail="「それは〜である。なぜなら〜だ」型の強調構文（英語 It is ... because ... の直訳調）",
                )
            )
    return findings


def detect_inanimate_subject_morph(tokenized: list[TokenizedSentence]) -> list[Finding]:


    findings = []
    for ts in tokenized:
        surfaces = [m.surface() for m in ts.morphemes]
        poss = [m.part_of_speech()[0] for m in ts.morphemes]
        dict_forms = [m.dictionary_form() for m in ts.morphemes]
        n = len(ts.morphemes)


        skip_until = -1
        for i in range(n):
            if i <= skip_until:
                continue

            is_abstract_subject = surfaces[i] in ABSTRACT_PRONOUNS or (
                poss[i] == "名詞" and surfaces[i] in {"こと", "事実", "の"}
            )
            subject_end = i
            if not is_abstract_subject:


                if i + 1 < n and (surfaces[i] + surfaces[i + 1]) in ABSTRACT_PRONOUN_PHRASES:
                    is_abstract_subject = True
                    subject_end = i + 1
            if not is_abstract_subject:
                continue
            skip_until = max(skip_until, subject_end)
            j = subject_end + 1
            if j >= n or poss[j] != "助詞" or surfaces[j] not in {"が", "は"}:
                continue

            for k in range(j + 1, n):
                if poss[k] == "動詞" and dict_forms[k] in TRANSITIVE_SMELL_VERBS:


                    span_start = ts.morphemes[max(0, i - 3)].begin()
                    span_end = ts.morphemes[k].end()
                    excerpt = ts.raw_text[span_start:span_end]
                    subject_text = "".join(surfaces[i : subject_end + 1])
                    findings.append(
                        Finding(
                            line=ts.line,
                            category="inanimate_subject_morph",
                            excerpt=excerpt,
                            severity="info",
                            detail=(
                                f"品詞列マッチ: 抽象主語「{subject_text}」+ {surfaces[j]} "
                                f"+ 他動詞的述語「{dict_forms[k]}」（英語統語の直訳調の疑い）"
                            ),
                        )
                    )
                    break
    return findings


BOLD_SPAN_RE = re.compile(r"\*\*[^*\n]+\*\*")
BOLD_DENSITY_PER_1000_THRESHOLD = 3.0
BULLET_LINE_RATIO_THRESHOLD = 0.35
BULLET_LINE_MIN_LINES = 10

BOILERPLATE_HEADING_WORDS = {
    "まとめ",
    "おわりに",
    "終わりに",
    "さいごに",
    "最後に",
    "結論",
    "総括",
    "conclusion",
}
NUMBERED_PHASE_RE = re.compile(r"(フェーズ|ステップ|段階|ステージ)\s*[0-90-9１-９]")
NUMBERED_PHASE_MIN_COUNT = 3

EMOJI_SYMBOL_RE = re.compile(
    "[\U0001F300-\U0001FAFF☀-➿⭐✅❌❗❓]"
)
EMOJI_SYMBOL_PER_1000_THRESHOLD = 2.0


def detect_structural_ai_habits(raw_text: str) -> tuple[list[Finding], dict]:


    findings: list[Finding] = []
    raw_lines = iter_lines_with_no(raw_text)
    total_chars = len(raw_text) or 1


    bold_hits = list(BOLD_SPAN_RE.finditer(raw_text))
    bold_per_1000 = len(bold_hits) / total_chars * 1000
    if bold_per_1000 >= BOLD_DENSITY_PER_1000_THRESHOLD and len(bold_hits) >= 3:
        first_line = raw_text[: bold_hits[0].start()].count("\n") + 1
        findings.append(
            Finding(
                line=first_line,
                category="high_bold_density",
                excerpt=f"太字スパン{len(bold_hits)}箇所（1000字あたり{bold_per_1000:.2f}）",
                severity="info",
                detail=(
                    f"太字（**...**）の使用密度が閾値（1000字あたり{BOLD_DENSITY_PER_1000_THRESHOLD}）"
                    "以上。強調の多用は教科書的なAI生成文に見られる傾向（実験的検出器、閾値は暫定）"
                ),
            )
        )


    non_blank_lines = [(no, line) for no, line in raw_lines if line.strip()]
    bullet_lines = [no for no, line in non_blank_lines if _LIST_ITEM_RE.match(line)]
    if len(non_blank_lines) >= BULLET_LINE_MIN_LINES:
        bullet_ratio = len(bullet_lines) / len(non_blank_lines)
        if bullet_ratio >= BULLET_LINE_RATIO_THRESHOLD:
            findings.append(
                Finding(
                    line=bullet_lines[0] if bullet_lines else 1,
                    category="high_bullet_ratio",
                    excerpt=f"箇条書き行{len(bullet_lines)}/{len(non_blank_lines)}行（{bullet_ratio:.1%}）",
                    severity="info",
                    detail=(
                        f"箇条書き行の比率が閾値{BULLET_LINE_RATIO_THRESHOLD:.0%}以上。"
                        "文章より箇条書きに頼る構成は教科書的なAI生成文に見られる傾向（実験的検出器）"
                    ),
                    related_lines=bullet_lines if len(bullet_lines) > 1 else None,
                )
            )


    boilerplate_lines = []
    for no, line in iter_lines_with_no(raw_text):
        m = _HEADING_RE.match(line)
        if not m:
            continue
        heading_text = line[m.end() :].strip().lower()
        for word in BOILERPLATE_HEADING_WORDS:
            if heading_text.startswith(word.lower()):
                boilerplate_lines.append((no, line.strip(), word))
                break
    for no, line_text, word in boilerplate_lines:
        findings.append(
            Finding(
                line=no,
                category="boilerplate_heading",
                excerpt=line_text[:40],
                severity="info",
                detail=(
                    f"定型見出し「{word}」系での締め。予告・構成の型のみで中身を語らない"
                    "教科書的なAI生成文に見られる傾向（実験的検出器）"
                ),
            )
        )


    phase_hits = list(NUMBERED_PHASE_RE.finditer(raw_text))
    if len(phase_hits) >= NUMBERED_PHASE_MIN_COUNT:
        first_line = raw_text[: phase_hits[0].start()].count("\n") + 1
        findings.append(
            Finding(
                line=first_line,
                category="numbered_phase_structure",
                excerpt=f"番号付きフェーズ表現が{len(phase_hits)}回出現",
                severity="info",
                detail=(
                    f"「フェーズ/ステップ/段階+番号」の表現が閾値{NUMBERED_PHASE_MIN_COUNT}回以上。"
                    "機械的な段階分割は教科書的なAI生成文に見られる傾向（実験的検出器）"
                ),
            )
        )


    emoji_hits = list(EMOJI_SYMBOL_RE.finditer(raw_text))
    emoji_per_1000 = len(emoji_hits) / total_chars * 1000
    if emoji_per_1000 >= EMOJI_SYMBOL_PER_1000_THRESHOLD and len(emoji_hits) >= 3:
        first_line = raw_text[: emoji_hits[0].start()].count("\n") + 1
        findings.append(
            Finding(
                line=first_line,
                category="high_emoji_symbol_density",
                excerpt=f"絵文字/装飾記号{len(emoji_hits)}箇所（1000字あたり{emoji_per_1000:.2f}）",
                severity="info",
                detail=(
                    f"絵文字・装飾記号の使用密度が閾値（1000字あたり{EMOJI_SYMBOL_PER_1000_THRESHOLD}）"
                    "以上（実験的検出器、閾値は暫定）"
                ),
            )
        )

    stats = {
        "bold_span_count": len(bold_hits),
        "bold_per_1000_chars": bold_per_1000,
        "bullet_line_count": len(bullet_lines),
        "non_blank_line_count": len(non_blank_lines),
        "boilerplate_heading_count": len(boilerplate_lines),
        "numbered_phase_hit_count": len(phase_hits),
        "emoji_symbol_count": len(emoji_hits),
        "emoji_symbol_per_1000_chars": emoji_per_1000,
    }
    return findings, stats


READING_LOAD_SENTENCE_MAX_CHARS = 90


READING_LOAD_BURIED_LIST_MIN_ITEMS = 3
READING_LOAD_BURIED_LIST_MIN_CHARS = 50


READING_LOAD_BURIED_LIST_3ITEM_MIN_CHARS = 80
READING_LOAD_KANJI_RUN_MAX = 6
READING_LOAD_NO_CHAIN_MIN = 3


READING_LOAD_NEGATION_MAX_GAP = 6

READING_LOAD_CATEGORIES: set[str] = {
    "sentence_too_long",
    "buried_list",
    "kanji_run",
    "double_negative",
    "no_chain",
}

_KANJI_RUN_RE = re.compile(rf"[一-鿿々]{{{READING_LOAD_KANJI_RUN_MAX + 1},}}")


_NEGATION_NORMALIZED = {"ない", "無い", "ぬ", "ず"}
_NEGATION_POS = {"助動詞", "形容詞"}


_WHITESPACE_RUN_RE = re.compile(r"\s{2,}")


def _reading_length(text: str) -> int:


    return len(_WHITESPACE_RUN_RE.sub(" ", text).strip())


def _span_contains_proper_noun(morphemes: list, start: int, end: int) -> bool:


    for m in morphemes:
        if m.end() > start and m.begin() < end and m.part_of_speech()[1] == "固有名詞":
            return True
    return False


def _is_negation(morpheme) -> bool:
    return (
        morpheme.part_of_speech()[0] in _NEGATION_POS
        and morpheme.normalized_form() in _NEGATION_NORMALIZED
    )


_OBLIGATION_SPANS = (
    "といけ",
    "とだめ",
    "とダメ",
    "ばならな",
    "ばなりま",
    "ばいけな",
    "てはならな",
    "てはなりま",
    "てはいけな",
    "ざるを得",
    "ざるをえ",
)


def _is_obligation_form(span: str) -> bool:
    return any(s in span for s in _OBLIGATION_SPANS)


_CONDITIONAL_NEGATION_RE = re.compile(r"^(?:ない|なけれ|なく)(?:と(?!は)|ば|ければ)")


def _is_conditional_negation(span: str) -> bool:
    return bool(_CONDITIONAL_NEGATION_RE.match(span))


_OPEN_PARENS = ("（", "(", "「", "『", "【", "［", "[")
_CLOSE_PARENS = ("）", ")", "」", "』", "】", "］", "]")


def _segment_ends_with_noun(segment: list) -> bool:


    i = len(segment)
    while i > 0:
        m = segment[i - 1]
        if m.part_of_speech()[0] not in TRAILING_SYMBOL_POS:
            break
        if m.surface() in _CLOSE_PARENS:
            depth = 1
            j = i - 1
            while j > 0 and depth:
                j -= 1
                s = segment[j].surface()
                if s in _CLOSE_PARENS:
                    depth += 1
                elif s in _OPEN_PARENS:
                    depth -= 1
            i = j
        else:
            i -= 1
    return i > 0 and segment[i - 1].part_of_speech()[0] == "名詞"


def _longest_noun_phrase_run(morphemes: list) -> tuple[int, int, int] | None:


    bounds: list[tuple[int, int]] = []
    start = 0
    for i, m in enumerate(morphemes):
        if m.surface() == "、":
            bounds.append((start, i))
            start = i + 1
    bounds.append((start, len(morphemes)))


    need = READING_LOAD_BURIED_LIST_MIN_ITEMS - 1
    best: tuple[int, int, int] | None = None
    run: list[tuple[int, int]] = []
    for idx, (s, e) in enumerate(bounds):
        if e > s and _segment_ends_with_noun(morphemes[s:e]):
            run.append((s, e))
        else:
            run = []
        has_tail = idx + 1 < len(bounds)
        if len(run) >= need and has_tail:
            items = len(run) + 1
            if best is None or items > best[2]:
                best = (run[0][0], bounds[idx + 1][1], items)
    return best


def _has_punctuation_between(morphemes: list, i: int, j: int) -> bool:


    return any(m.part_of_speech()[0] == "補助記号" for m in morphemes[i + 1 : j])


def detect_reading_load(
    tokenized: list[TokenizedSentence],
    sentence_max_chars: int = READING_LOAD_SENTENCE_MAX_CHARS,
) -> list[Finding]:


    findings: list[Finding] = []
    for ts in tokenized:
        text = ts.text
        excerpt = (ts.raw_text or text).strip()[:40]


        reading_len = _reading_length(text)
        if reading_len > sentence_max_chars:
            findings.append(
                Finding(
                    line=ts.line,
                    category="sentence_too_long",
                    excerpt=excerpt,
                    severity="info",
                    detail=(
                        f"一文が{reading_len}字（目安{sentence_max_chars}字）。"
                        "カタログ B1。一文一義になっているか確認する"
                        "（分割の結果、字数が増えるのは正しい）"
                    ),
                )
            )


        for m in _KANJI_RUN_RE.finditer(text):


            if _span_contains_proper_noun(ts.morphemes, m.start(), m.end()):
                continue
            findings.append(
                Finding(
                    line=ts.line,
                    category="kanji_run",
                    excerpt=m.group(0),
                    severity="info",
                    detail=(
                        f"漢字が{len(m.group(0))}字連続（目安{READING_LOAD_KANJI_RUN_MAX}字）。"
                        "カタログ C1。語の切れ目が読み取れるか確認する"
                    ),
                )
            )

        morphemes = ts.morphemes


        run = _longest_noun_phrase_run(morphemes)
        if run is not None:
            start, end, items = run
            min_chars = (
                READING_LOAD_BURIED_LIST_3ITEM_MIN_CHARS
                if items <= 3
                else READING_LOAD_BURIED_LIST_MIN_CHARS
            )
        if run is not None and reading_len >= min_chars:
            findings.append(
                Finding(
                    line=ts.line,
                    category="buried_list",
                    excerpt="".join(m.surface() for m in morphemes[start:end])[:40],
                    severity="info",
                    detail=(
                        f"同格の名詞句が読点で{items}個並んでいる（一文{reading_len}字）。"
                        "カタログ F1。箇条書きに開くと並列関係を読み手が再構成せずに済む"
                        "（「**項目**: 説明」の定型にはしない）"
                    ),
                )
            )


        negation_idx = [i for i, m in enumerate(morphemes) if _is_negation(m)]
        for a, b in zip(negation_idx, negation_idx[1:]):
            span = "".join(m.surface() for m in morphemes[a : b + 1])
            if (
                b - a <= READING_LOAD_NEGATION_MAX_GAP
                and not _has_punctuation_between(morphemes, a, b)
                and not _is_obligation_form(span)
                and not _is_conditional_negation(span)
            ):
                findings.append(
                    Finding(
                        line=ts.line,
                        category="double_negative",
                        excerpt=span,
                        severity="info",
                        detail=(
                            "否定が二重に掛かっている可能性。カタログ A1/A2。"
                            "肯定に畳むなら真偽が反転していないか必ず確認する"
                            "（「招かないとは言えない」＝「招くことがある」）。"
                            "控えめな肯定が本質的な箇所は触らない"
                        ),
                    )
                )
                break


        no_idx = [
            i
            for i, m in enumerate(morphemes)
            if m.surface() == "の" and m.part_of_speech()[:2] == ("助詞", "格助詞")
        ]
        for k in range(len(no_idx) - READING_LOAD_NO_CHAIN_MIN + 1):
            window = no_idx[k : k + READING_LOAD_NO_CHAIN_MIN]
            gaps_ok = all(y - x <= 3 for x, y in zip(window, window[1:]))
            if gaps_ok and not _has_punctuation_between(morphemes, window[0], window[-1]):
                findings.append(
                    Finding(
                        line=ts.line,
                        category="no_chain",
                        excerpt="".join(m.surface() for m in morphemes[window[0] : window[-1] + 1]),
                        severity="info",
                        detail=(
                            f"格助詞「の」が{READING_LOAD_NO_CHAIN_MIN}連以上。カタログ C2。"
                            "どこかを動詞・連用に開く（「上限の設定の検討」→「上限をどう設定するか検討する」）"
                        ),
                    )
                )
                break

    findings.sort(key=lambda f: f.line)
    return findings


def run_reading_load(raw_text: str, genre: str | None = None) -> tuple[list[Finding], dict]:


    profile = GENRE_PROFILES.get(genre, {})
    text = mask_markdown_structure(raw_text)
    lines = iter_lines_with_no(text)
    raw_lines_by_no = dict(iter_lines_with_no(raw_text))
    sentences = split_sentences_with_lines(lines, raw_lines_by_no)
    tokenized = tokenize_sentences(sentences)

    findings = detect_reading_load(
        tokenized,
        sentence_max_chars=profile.get(
            "reading_load_sentence_max_chars", READING_LOAD_SENTENCE_MAX_CHARS
        ),
    )
    stats = {
        "total": len(findings),
        "sentences": len(tokenized),
        "genre": genre,
        "by_category": {},
    }
    for f in findings:
        stats["by_category"][f.category] = stats["by_category"].get(f.category, 0) + 1
    return findings, stats


EXPERIMENTAL_CATEGORIES: set[str] = {
    "high_length_autocorrelation",
    "paragraph_lead_conjunction",
    "repeated_syntax_template",
    "english_syntax_cleft_because",
    "high_bold_density",
    "high_bullet_ratio",
    "boilerplate_heading",
    "numbered_phase_structure",
    "high_emoji_symbol_density",
}


def run_lint(
    raw_text: str, genre: str | None = None, experimental: bool = False
) -> tuple[list[Finding], dict]:


    profile = GENRE_PROFILES.get(genre, {})


    structural_findings, structural_stats = detect_structural_ai_habits(mask_html_comments(raw_text))


    text = mask_markdown_structure(raw_text)
    lines = iter_lines_with_no(text)
    raw_lines_by_no = dict(iter_lines_with_no(raw_text))
    sentences = split_sentences_with_lines(lines, raw_lines_by_no)

    tokenized = tokenize_sentences(sentences)

    findings: list[Finding] = []
    findings += structural_findings

    findings += detect_forbidden_phrases(lines, raw_lines_by_no)
    findings += detect_translationese(lines, raw_lines_by_no)
    findings += detect_antithesis_repetition(
        lines,
        raw_lines_by_no,
        rate_critical_above=profile.get("antithesis_rate_critical_above", ANTITHESIS_RATE_CRITICAL_ABOVE),
    )
    findings += detect_low_sentence_length_variance(sentences)
    findings += detect_english_syntax_smell(lines, raw_lines_by_no)


    nominal_and_conj_findings, morph_stats = detect_nominal_ending_and_paragraph_conjunctions(
        lines,
        tokenized,
        raw_lines_by_no,
        nominal_min_chars=profile.get("nominal_min_chars", NOMINAL_ENDING_MIN_CHARS),
    )
    findings += nominal_and_conj_findings
    findings += detect_translationese_morph(tokenized)
    findings += detect_inanimate_subject_morph(tokenized)


    rhythm_findings, rhythm_stats = detect_rhythm_statistics(tokenized)
    findings += rhythm_findings

    ngram_findings, ngram_stats = detect_ngram_repetition(
        tokenized,
        lead_repeat_threshold=profile.get("lead_repeat_threshold", NGRAM_LEAD_REPEAT_THRESHOLD),
    )
    findings += ngram_findings

    lexdiv_findings, lexdiv_stats = detect_lexical_diversity(tokenized)
    findings += lexdiv_findings

    low_spec_findings, low_spec_stats = detect_low_specificity(lines, raw_lines_by_no)
    findings += low_spec_findings


    if not experimental:
        findings = [f for f in findings if f.category not in EXPERIMENTAL_CATEGORIES]


    disabled_categories = profile.get("disabled_categories", set())
    if disabled_categories:
        findings = [f for f in findings if f.category not in disabled_categories]

    findings.sort(key=lambda f: f.line)

    stats = {
        "total_findings": len(findings),
        "by_category": {},
        "genre": genre,
        "experimental": experimental,
        **morph_stats,
        "rhythm": rhythm_stats,
        "ngram": ngram_stats,
        "lexical_diversity": lexdiv_stats,
        "structural": structural_stats,
        "low_specificity": low_spec_stats,
    }
    for f in findings:
        stats["by_category"][f.category] = stats["by_category"].get(f.category, 0) + 1

    return findings, stats


SEVERITY_LABEL = {"info": "情報", "warn": "警告", "critical": "重大"}


STATUS_LABEL = {"new": "新規", "persisting": "継続"}


def print_human_report(
    path: Path,
    findings: list[Finding],
    stats: dict,
    baseline_summary: dict[str, int] | None = None,
) -> None:
    print(f"=== lint: {path} ===")
    print(f"検出件数: {stats['total_findings']}")
    if stats["by_category"]:
        print("カテゴリ別内訳:")
        for cat, count in sorted(stats["by_category"].items(), key=lambda kv: -kv[1]):
            print(f"  - {cat}: {count}")


    if baseline_summary is not None:
        print(
            f"ベースライン比較: 解消: {baseline_summary['resolved']}件 / "
            f"新規: {baseline_summary['new']}件 / "
            f"継続: {baseline_summary['persisting']}件"
        )
    print()

    if not findings:
        print("検出なし。")
        return

    for f in findings:
        label = SEVERITY_LABEL.get(f.severity, f.severity)

        status_tag = f"[{STATUS_LABEL.get(f.status, f.status)}] " if f.status else ""
        print(f"{status_tag}[{label}] L{f.line} ({f.category})")
        print(f"    該当箇所: {f.excerpt}")
        if f.detail:


            print(f"    詳細    : {f.detail}")
        print()


def print_reading_load_report(findings: list[Finding], stats: dict) -> None:

    print("=== 読解負荷（推敲用の指さし・自然度スコアには含まない） ===")
    print(f"指摘件数: {stats.get('total', len(findings))}（本文 {stats.get('sentences', 0)} 文）")
    if stats.get("by_category"):
        print("カテゴリ別内訳:")
        for cat, count in sorted(stats["by_category"].items(), key=lambda kv: -kv[1]):
            print(f"  - {cat}: {count}")
    print()

    if not findings:
        print("指摘なし。")
        return

    for f in findings:
        print(f"[指さし] L{f.line} ({f.category})")
        print(f"    該当箇所: {f.excerpt}")
        if f.detail:
            print(f"    詳細    : {f.detail}")
        print()

    print("※ これらは「直すべき欠陥」ではなく「見るべき箇所」。読んで引っかからない文はいじらない。")
    print("※ 判断は references/readability-antipatterns.md の A〜J カタログに従う。")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="AI臭い日本語文章を決定的に検出する lint スクリプト（CI ゲートではない）。"
    )
    parser.add_argument("file", type=Path, help="lint 対象の Markdown/テキストファイル")
    parser.add_argument("--json", action="store_true", help="機械可読な JSON で出力する")
    parser.add_argument(
        "--baseline",
        type=Path,
        default=None,
        metavar="PREV.json",
        help=(
            "前回の --json 出力ファイルと比較し、resolved（解消）/ new（新規）/ "
            "persisting（継続）を判定する（収束駆動の修正ループ支援。指定しない場合の"
            "挙動は完全に不変）"
        ),
    )
    parser.add_argument(
        "--genre",
        choices=sorted(GENRE_PROFILES),
        default=None,
        help=(
            "文書のジャンルに応じてコーパス校正済みの閾値プロファイルを適用する"
            "（essay/tech/business）。未指定時は共通の保守的閾値を使う"
        ),
    )
    parser.add_argument(
        "--experimental",
        action="store_true",
        help=(
            "まだコーパスで定量校正されていない、または無反応と判定された検出器"
            "（EXPERIMENTAL_CATEGORIES）も出力する。デフォルトでは除外される"
        ),
    )
    parser.add_argument(
        "--reading-load",
        action="store_true",
        help=(
            "読解負荷レーン（一文長・埋もれた列挙・連続漢字・二重否定・「の」連鎖）を"
            "併せて出力する。AI臭さの検出とは別目的の推敲用の指さしで、"
            "自然度スコアにも --baseline 比較にも含まれない"
        ),
    )
    args = parser.parse_args()


    text, err = read_source_file(args.file)
    if err is not None:
        print(err, file=sys.stderr)
        return 1

    baseline_data = None
    if args.baseline is not None:
        if not args.baseline.exists():
            print(f"エラー: --baseline ファイルが見つかりません: {args.baseline}", file=sys.stderr)
            return 1
        try:
            loaded_baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            print(f"エラー: --baseline ファイルを読み込めません: {args.baseline} ({exc})", file=sys.stderr)
            return 1


        baseline_data, baseline_warnings = validate_baseline_data(loaded_baseline)
        for w in baseline_warnings:
            print(f"警告: {w}", file=sys.stderr)

    findings, stats = run_lint(text, genre=args.genre, experimental=args.experimental)


    reading_load_findings: list[Finding] | None = None
    reading_load_stats: dict | None = None
    if args.reading_load:
        reading_load_findings, reading_load_stats = run_reading_load(text, genre=args.genre)

    resolved: list[dict] = []
    baseline_summary: dict[str, int] | None = None
    if baseline_data is not None:
        resolved, baseline_summary = compute_baseline_diff(findings, baseline_data)

    if args.json:
        output = {
            "file": str(args.file),
            "stats": stats,
            "findings": [f.to_dict() for f in findings],
        }


        if baseline_summary is not None:
            output["baseline"] = {
                "file": str(args.baseline),
                "summary": baseline_summary,
                "resolved": resolved,
            }


        if reading_load_findings is not None:
            output["reading_load"] = {
                "stats": reading_load_stats,
                "findings": [f.to_dict() for f in reading_load_findings],
            }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print_human_report(args.file, findings, stats, baseline_summary)
        if reading_load_findings is not None:
            print_reading_load_report(reading_load_findings, reading_load_stats or {})


    return 0


if __name__ == "__main__":
    sys.exit(main())

# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "sentence-transformers>=3.0.0",
#     "numpy",
#     "sudachipy>=0.6.8",
#     "sudachidict-core>=20240409",
# ]
# ///


from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from textcore import (
    Finding,
    iter_lines_with_no,
    mask_markdown_structure,
    read_source_file,
    split_sentences_with_lines,
)

DEFAULT_MODEL = "cl-nagoya/ruri-v3-310m"


MIN_SENTENCES_FOR_STATS = 10


DEFAULT_FLATNESS_THRESHOLD = 0.16122889518737793

GENRE_PROFILES: dict[str, dict] = {
    "essay": {
        "flatness_threshold": 0.15813499689102173,
        "flatness_calibration": "n(fp_base)=30, FP率=3.3%, n(ai)=84, AI検出率=95.2%",
    },
    "tech": {
        "flatness_threshold": 0.14261949062347412,
        "flatness_calibration": "n(fp_base)=18, FP率=0%, n(ai)=84, AI検出率=52.4%",
    },
    "business": {
        "flatness_threshold": 0.15565699338912964,
        "flatness_calibration": "n(fp_base)=29, FP率=0%, n(ai)=84, AI検出率=73.8%",
    },
}


SEMANTIC_REPETITION_MAX_THRESHOLD = 0.9322158694267273
TOPIC_JUMP_MIN_THRESHOLD = 0.765757143497467


def doc_sentences_with_lines(raw_text: str) -> list[tuple[int, str]]:


    masked = mask_markdown_structure(raw_text)
    lines = iter_lines_with_no(masked)
    raw_lines_by_no = dict(iter_lines_with_no(raw_text))
    sentences = split_sentences_with_lines(lines, raw_lines_by_no)
    out = []
    for no, masked_s, raw_s in sentences:
        s = raw_s.strip() if raw_s.strip() else masked_s.strip()
        if s:
            out.append((no, s))
    return out


_model_cache = {}


def load_model(model_name: str):

    if model_name in _model_cache:
        return _model_cache[model_name]

    print(
        f"[semantic.py] モデル読み込み中: {model_name} "
        "（初回実行時はHuggingFaceから自動ダウンロード、~1GB級の可能性があります。"
        "2回目以降はHFキャッシュを再利用しオフラインでも動作します）",
        file=sys.stderr,
    )
    import torch
    from sentence_transformers import SentenceTransformer

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    model = SentenceTransformer(model_name, device=device, trust_remote_code=True)
    _model_cache[model_name] = model
    return model


def compute_metrics(embeddings) -> dict:

    import numpy as np

    n = embeddings.shape[0]
    out = {
        "semantic_repetition_max": None,
        "coherence_flatness_range": None,
        "topic_jump_min": None,
    }
    if n < 3:
        return out
    sim = embeddings @ embeddings.T

    adj = np.array([sim[i, i + 1] for i in range(n - 1)])
    if len(adj) >= 2:
        out["coherence_flatness_range"] = float(adj.max() - adj.min())
        out["topic_jump_min"] = float(adj.min())
    elif len(adj) == 1:
        out["topic_jump_min"] = float(adj[0])

    iu = np.triu_indices(n, k=2)
    non_adj = sim[iu]
    if non_adj.size:
        out["semantic_repetition_max"] = float(non_adj.max())

    return out


def run_semantic(
    raw_text: str, genre: str | None = None, model_name: str = DEFAULT_MODEL
) -> tuple[list[Finding], dict]:
    profile = GENRE_PROFILES.get(genre, {})
    flatness_threshold = profile.get("flatness_threshold", DEFAULT_FLATNESS_THRESHOLD)
    flatness_calibration = profile.get(
        "flatness_calibration",
        "n(fp_base)=81, FP率=3.7%, n(ai)=405, AI検出率=85.2%（全ジャンル共通閾値）",
    )

    sentence_items = doc_sentences_with_lines(raw_text)
    n_sentences = len(sentence_items)

    stats: dict = {
        "genre": genre,
        "n_sentences": n_sentences,
        "model": model_name,
        "flatness_threshold": flatness_threshold,
        "metrics": None,
        "skipped": False,
        "skip_reason": None,
    }

    if n_sentences < MIN_SENTENCES_FOR_STATS:
        stats["skipped"] = True
        stats["skip_reason"] = (
            f"文数が{n_sentences}文と少なく（目安{MIN_SENTENCES_FOR_STATS}文未満）、"
            "統計的な起伏・反復の測定が安定しないため意味的検出をスキップしました。"
        )
        return [], stats

    lines_no = [no for no, _ in sentence_items]
    sentences = [s for _, s in sentence_items]

    model = load_model(model_name)
    embeddings = model.encode(
        sentences, convert_to_numpy=True, show_progress_bar=False, normalize_embeddings=True
    )
    metrics = compute_metrics(embeddings)
    stats["metrics"] = metrics

    findings: list[Finding] = []

    cfr = metrics.get("coherence_flatness_range")
    if cfr is not None and cfr <= flatness_threshold:


        line = lines_no[0] if lines_no else 1
        findings.append(
            Finding(
                line=line,
                category="semantic_topic_flatness",
                excerpt=f"隣接文類似度レンジ={cfr:.4f}（閾値{flatness_threshold:.4f}以下）",
                severity="warn",
                detail=(
                    '隣接文の意味類似度の起伏が乏しい可能性があります。具体例や視点の切り替えが必要かを文脈から判断してください。実験的な指標であり、執筆者の判定には使えません。'                ),
            )
        )

    srm = metrics.get("semantic_repetition_max")
    if srm is not None and srm <= SEMANTIC_REPETITION_MAX_THRESHOLD:
        line = lines_no[0] if lines_no else 1
        findings.append(
            Finding(
                line=line,
                category="semantic_repetition_max",
                excerpt=f"非隣接文ペア類似度max={srm:.4f}（参考閾値{SEMANTIC_REPETITION_MAX_THRESHOLD:.4f}以下）",
                severity="info",
                detail=(
                    '非隣接文ペアの最大類似度が低いことを示す参考指標です。言い換え反復の少なさだけで文章の良し悪しや執筆者を判定しないでください。'                ),
            )
        )

    tjm = metrics.get("topic_jump_min")
    if tjm is not None and tjm >= TOPIC_JUMP_MIN_THRESHOLD:
        line = lines_no[0] if lines_no else 1
        findings.append(
            Finding(
                line=line,
                category="topic_jump_min",
                excerpt=f"隣接文類似度最小値={tjm:.4f}（参考閾値{TOPIC_JUMP_MIN_THRESHOLD:.4f}以上）",
                severity="info",
                detail=(
                    '隣接文間で意味的に大きく離れる箇所が少ないことを示す参考指標です。話題の変化が必要かを文脈から判断してください。'                ),
            )
        )

    return findings, stats


SEVERITY_LABEL = {"info": "情報", "warn": "警告", "critical": "重大"}


def print_human_report(path: Path, findings: list[Finding], stats: dict) -> None:
    print(f"=== semantic.py (EXPERIMENTAL): {path} ===")
    print(f"文数: {stats['n_sentences']}  モデル: {stats['model']}  genre: {stats['genre'] or '(未指定)'}")
    if stats["skipped"]:
        print(f"スキップ: {stats['skip_reason']}")
        return
    print(f"検出件数: {len(findings)}")
    print()
    if not findings:
        print("検出なし。")
        return
    for f in findings:
        label = SEVERITY_LABEL.get(f.severity, f.severity)
        print(f"[{label}] L{f.line} ({f.category})")
        print(f"    該当箇所: {f.excerpt}")
        if f.detail:
            print(f"    詳細    : {f.detail}")
        print()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "EXPERIMENTAL: 文埋め込みによる話題平板性の検出（opt-in・重量級・"
            "torch+sentence-transformers依存、初回~1GBダウンロード）。"
            "lint.py とは独立したエントリポイント。"
        )
    )
    parser.add_argument("file", type=Path, help="検査対象の Markdown/テキストファイル")
    parser.add_argument("--json", action="store_true", help="機械可読な JSON で出力する")
    parser.add_argument(
        "--genre",
        choices=sorted(GENRE_PROFILES),
        default=None,
        help="ジャンル別に校正した閾値プロファイルを適用する（essay/tech/business）。未指定時は共通閾値",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"埋め込みモデル名（既定: {DEFAULT_MODEL}）")
    args = parser.parse_args()

    text, err = read_source_file(args.file)
    if err is not None:
        print(err, file=sys.stderr)
        return 1

    try:
        findings, stats = run_semantic(text, genre=args.genre, model_name=args.model)
    except Exception as exc:
        print(
            f"エラー: 意味モデルの読み込みまたは推論に失敗しました: {exc}",
            file=sys.stderr,
        )
        return 1

    if args.json:
        output = {
            "file": str(args.file),
            "stats": stats,
            "findings": [f.to_dict() for f in findings],
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print_human_report(args.file, findings, stats)


    return 0


if __name__ == "__main__":
    sys.exit(main())

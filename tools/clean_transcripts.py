#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
转写稿清洗 —— 为「讲道风格蒸馏」准备可用文本

用法:
  python tools/clean_transcripts.py [--in transcripts] [--out transcripts/clean]

做四件事:
  1. 去掉 ASR 误识别的日文/假名碎片（粤语被误判成日语留下的残渣）
  2. 唱诗段落打上【诗】标记（**不删除** —— 无法可靠区分歌词与讲道，宁可留噪声）
  3. 按语义停顿切段，恢复可读的段落结构
  4. 统计词频/句长等风格指标，输出 style-stats.json 供蒸馏参考

不做的事（有意保留）:
  · 保留口语词（呃/啊/嗯/OK）—— 这些正是「说话方式」的指纹
  · 不修正同音错字（如「省」=神）—— 保留原貌，蒸馏时按上下文理解
"""
import os
import re
import sys
import json
import glob
import argparse
from collections import Counter

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# 日文假名（平假名 + 片假名）——粤语误识别的残渣
KANA = re.compile(r"[぀-ゟ゠-ヿ]")
# emoji / 音乐符（唱歌段落标记）
SONG_MARK = "🎼"
KEEP_EMOJI = re.compile(r"[😊😀😁😂]")   # 表情保留为笑点提示


def mark_songs(text):
    """把唱诗段落标记出来（不删除！）

    注意：🎼 标记的是每句歌词的「开头」，不是成对区间，且歌词与讲道文字
    会混在同一个片段里（如「🎼微翔。好啊，分享这首歌…」后半已是讲道）。
    因此无法可靠地自动剔除，改为打上【诗】标记交由分析者跳过——
    宁可保留噪声，也不能误删讲道内容。
    """
    return text.replace(SONG_MARK, "\n【诗】")


def strip_kana(text):
    """去掉含假名的片段（粤语被误识别成日文留下的残渣）

    只在片段较短（< 60 字）时丢弃——长片段里偶现假名是 ASR 噪音，
    但整段丢弃会误伤讲道内容。
    """
    out = []
    for seg in re.split(r"([。！？!?\n])", text):
        if KANA.search(seg) and len(seg) < 60:
            continue
        out.append(seg)
    return "".join(out)


def to_paragraphs(text, min_len=180):
    """按句子边界聚合成段（每段约 min_len 字），恢复可读结构"""
    text = re.sub(r"[ \t]+", "", text)
    sents = [s for s in re.split(r"(?<=[。！？!?])", text) if s.strip()]
    paras, buf = [], ""
    for s in sents:
        buf += s
        if len(buf) >= min_len:
            paras.append(buf.strip())
            buf = ""
    if buf.strip():
        paras.append(buf.strip())
    return "\n\n".join(paras)


def style_stats(text, name):
    """统计风格指标：口语词的频次，是「说话方式」最直接的指纹"""
    fillers = ["呃", "啊", "嗯", "哦", "呀", "嘛", "啦", "咧", "咯", "嘅", "咁", "啲", "呢", "OK"]
    stats = {f: text.count(f) for f in fillers}
    total = len(text)
    return {
        "file": name,
        "chars": total,
        "fillers": stats,
        "per_1k": {k: round(v * 1000 / total, 1) for k, v in stats.items() if v},
        "questions": text.count("吗") + text.count("呢") + text.count("?"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", default="transcripts")
    ap.add_argument("--out", dest="outdir", default=os.path.join("transcripts", "clean"))
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(args.indir, "*.txt")))
    if not files:
        sys.exit(f"{args.indir} 下没有 .txt")

    all_stats = []
    print(f"清洗 {len(files)} 份转写稿\n")
    for f in files:
        raw = open(f, encoding="utf-8").read()
        t = mark_songs(raw)
        t = strip_kana(t)
        t = KEEP_EMOJI.sub("", t)
        t = t.replace("😊", "").replace("🎼", "").replace("♪", "")
        t = to_paragraphs(t)
        name = os.path.basename(f)
        dst = os.path.join(args.outdir, name)
        with open(dst, "w", encoding="utf-8") as fh:
            fh.write(t)
        st = style_stats(t, name)
        all_stats.append(st)
        print(f"  {name}")
        print(f"    {len(raw)} → {len(t)} 字（清洗掉 {len(raw) - len(t)} 字噪声）")
        top = sorted(st["per_1k"].items(), key=lambda x: -x[1])[:6]
        print(f"    每千字高频口语词: " + " · ".join(f"{k}{v}" for k, v in top))

    statsfile = os.path.join(args.outdir, "style-stats.json")
    with open(statsfile, "w", encoding="utf-8") as fh:
        json.dump(all_stats, fh, ensure_ascii=False, indent=2)
    print(f"\n风格指标已写入 {statsfile}")


if __name__ == "__main__":
    main()

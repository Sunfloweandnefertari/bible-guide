#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
硅基流动 SenseVoice 批量转写（长音频自动切片）

用法:
  python tools/transcribe.py <音频目录> [--out transcripts] [--chunk-sec 1200]

环境变量（或仓库根 .env）:
  SILICONFLOW_API_KEY   必填 —— 在 https://cloud.siliconflow.cn 申请

特点:
  · 长音频自动切片（默认每片 20 分钟），逐片上传、转完即删临时片
    → 本地峰值占用 ≈ 一个切片（十几 MB），不留大文件
  · 已转写完成的文件自动跳过，可断点续跑
  · 限流 / 网络错误自动退避重试
  · 切片用 ffmpeg（优先用 imageio-ffmpeg 自带的，无需系统安装）：
        pip install imageio-ffmpeg
"""
import os
import re
import sys
import math
import time
import json
import shutil
import argparse
import subprocess

try:
    import requests
except ImportError:
    sys.exit("缺少依赖：pip install requests")

API_URL = "https://api.siliconflow.cn/v1/audio/transcriptions"
DEFAULT_MODEL = "FunAudioLLM/SenseVoiceSmall"
AUDIO_EXT = {".m4a", ".mp3", ".wav", ".flac", ".aac", ".ogg", ".opus", ".wma", ".amr"}


# ---------- 基础工具 ----------
def load_env():
    """从仓库根 .env / web/.env 读环境变量（不覆盖已存在的）"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for envf in (os.path.join(root, ".env"), os.path.join(root, "web", ".env")):
        if not os.path.exists(envf):
            continue
        for line in open(envf, encoding="utf-8"):
            m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$", line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")


def probe_duration(ffmpeg, path):
    """用 ffmpeg -i 的输出解析时长（秒）"""
    p = subprocess.run([ffmpeg, "-i", path], stderr=subprocess.PIPE, stdout=subprocess.DEVNULL)
    m = re.search(rb"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", p.stderr)
    if not m:
        return None
    h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mi * 60 + s


def fmt_hms(sec):
    sec = int(sec or 0)
    return f"{sec // 3600}:{(sec % 3600) // 60:02d}:{sec % 60:02d}"


# ---------- 切片 ----------
def split_audio(ffmpeg, src, outdir, chunk_sec, dur):
    """把长音频切成若干 mp3 片（16kHz 单声道，体积小、兼容性好）"""
    n = max(1, math.ceil(dur / chunk_sec))
    base = os.path.splitext(os.path.basename(src))[0]
    for i in range(n):
        start = i * chunk_sec
        out = os.path.join(outdir, f"{base}.part{i:02d}.mp3")
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-ss", str(start), "-t", str(chunk_sec),
             "-i", src, "-ac", "1", "-ar", "16000", "-b:a", "48k", out],
            check=True,
        )
        yield i, out


# ---------- 调 API ----------
def transcribe_chunk(key, model, path, retries=4):
    for attempt in range(retries):
        try:
            with open(path, "rb") as f:
                r = requests.post(
                    API_URL,
                    headers={"Authorization": "Bearer " + key},
                    files={"file": (os.path.basename(path), f, "audio/mpeg")},
                    data={"model": model},
                    timeout=900,
                )
            if r.status_code == 200:
                j = r.json()
                return (j.get("text") or "").strip()
            if r.status_code in (429, 500, 502, 503, 504):
                wait = 2 ** attempt
                print(f"      HTTP {r.status_code}，{wait}s 后重试…")
                time.sleep(wait)
                continue
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        except requests.RequestException as e:
            wait = 2 ** attempt
            print(f"      网络异常（{type(e).__name__}），{wait}s 后重试…")
            time.sleep(wait)
    raise RuntimeError("重试次数用尽")


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="音频所在目录")
    ap.add_argument("--out", default="transcripts", help="文字稿输出目录（默认 transcripts/）")
    ap.add_argument("--chunk-sec", type=int, default=1200, help="切片时长秒数（默认 1200 = 20 分钟）")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max-mb", type=float, default=20, help="单片大小上限 MB，超过则强制切片")
    args = ap.parse_args()

    load_env()
    key = os.environ.get("SILICONFLOW_API_KEY", "").strip()
    if not key:
        sys.exit("缺少 SILICONFLOW_API_KEY —— 请在仓库根 .env 里写：SILICONFLOW_API_KEY=sk-xxxx")

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        sys.exit("找不到 ffmpeg —— 请先运行：pip install imageio-ffmpeg")

    src_dir = os.path.abspath(args.src)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    tmp_dir = os.path.join(out_dir, ".tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    files = sorted(f for f in os.listdir(src_dir)
                   if os.path.splitext(f)[1].lower() in AUDIO_EXT)
    if not files:
        sys.exit(f"{src_dir} 下没找到音频文件（支持：{', '.join(sorted(AUDIO_EXT))}）")

    print(f"待处理 {len(files)} 个文件 → {out_dir}\n")
    ok, skipped, failed = 0, 0, []

    for idx, name in enumerate(files, 1):
        src = os.path.join(src_dir, name)
        stem = os.path.splitext(name)[0]
        dst = os.path.join(out_dir, stem + ".txt")

        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            print(f"[{idx}/{len(files)}] {name} —— 已存在，跳过")
            skipped += 1
            continue

        size_mb = os.path.getsize(src) / 1024 / 1024
        dur = probe_duration(ffmpeg, src)
        print(f"[{idx}/{len(files)}] {name}  {size_mb:.0f} MB  时长 {fmt_hms(dur)}")

        try:
            if dur and dur > args.chunk_sec or size_mb > args.max_mb:
                parts = []
                for i, chunk in split_audio(ffmpeg, src, tmp_dir, args.chunk_sec, dur or 0):
                    csize = os.path.getsize(chunk) / 1024 / 1024
                    print(f"    切片 {i + 1}: {csize:.1f} MB → 转写…")
                    parts.append(transcribe_chunk(key, args.model, chunk))
                    os.remove(chunk)                      # 转完即删，控制本地占用
                    time.sleep(0.6)                       # 避开 QPS 限流
                text = "\n\n".join(p for p in parts if p)
            else:
                print("    整文件转写…")
                text = transcribe_chunk(key, args.model, src)

            if not text:
                raise RuntimeError("返回为空")
            with open(dst, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"    ✓ 已写入 {os.path.basename(dst)}（{len(text)} 字）\n")
            ok += 1
        except Exception as e:
            print(f"    ✗ 失败：{e}\n")
            failed.append(name)

    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"完成：成功 {ok} · 跳过 {skipped} · 失败 {len(failed)}")
    if failed:
        print("失败文件（可重跑本脚本续传）：")
        for f in failed:
            print("  -", f)


if __name__ == "__main__":
    main()

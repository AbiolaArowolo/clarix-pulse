"""
UDP stream confidence probe — agent-side only.
Encoder streams are on private LAN, not routable from hub VPS.

Checks:
  - Stream presence (ffprobe)
  - Freeze detection (ffmpeg freezedetect filter)
  - Black detection (ffmpeg blackdetect filter)
  - Audio silence (ffmpeg silencedetect filter)
  - Thumbnail capture (ffmpeg single frame JPEG)
"""

import os
import io
import re
import sys
import base64
import subprocess
import tempfile
from typing import Optional

# ffmpeg/ffprobe paths — bundled alongside the .exe in the agent package
_BASE = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else __file__)
FFMPEG = os.path.join(_BASE, "ffmpeg.exe")
FFPROBE = os.path.join(_BASE, "ffprobe.exe")

PROBE_TIMEOUT = 8     # seconds — max time for any single ffprobe/ffmpeg call
THUMBNAIL_MAX_KB = 50


def _run(args: list[str], timeout: int) -> tuple[int, str, str]:
    """Run a subprocess with timeout, return (returncode, stdout, stderr)."""
    try:
        r = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except FileNotFoundError:
        return -1, "", "ffmpeg not found"


def check_presence(stream_url: str) -> int:
    """Return 1 if stream is present, 0 otherwise."""
    rc, stdout, stderr = _run([
        FFPROBE, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1",
        "-timeout", "5000000",   # 5s in microseconds
        stream_url
    ], timeout=PROBE_TIMEOUT)
    return 1 if rc == 0 else 0


def check_freeze(stream_url: str, duration: int = 10) -> float:
    """Return seconds of freeze detected in the last `duration` seconds of stream."""
    rc, stdout, stderr = _run([
        FFMPEG, "-i", stream_url,
        "-t", str(duration),
        "-vf", "freezedetect=noise=0.001:duration=2",
        "-an", "-f", "null", "-"
    ], timeout=duration + PROBE_TIMEOUT)

    # Parse: freeze_duration:3.5
    match = re.search(r"freeze_duration:(\d+\.?\d*)", stderr)
    return float(match.group(1)) if match else 0.0


def check_black(stream_url: str, duration: int = 10) -> float:
    """Return black ratio (0.0 to 1.0) over the last `duration` seconds."""
    rc, stdout, stderr = _run([
        FFMPEG, "-i", stream_url,
        "-t", str(duration),
        "-vf", "blackdetect=d=0.1:pix_th=0.1",
        "-an", "-f", "null", "-"
    ], timeout=duration + PROBE_TIMEOUT)

    # Count black_duration relative to total
    total_black = sum(float(m) for m in re.findall(r"black_duration:(\d+\.?\d*)", stderr))
    return min(1.0, round(total_black / max(duration, 1), 3))


def check_silence(stream_url: str, duration: int = 10) -> float:
    """Return seconds of audio silence in the last `duration` seconds."""
    rc, stdout, stderr = _run([
        FFMPEG, "-i", stream_url,
        "-t", str(duration),
        "-vn", "-af", "silencedetect=noise=-50dB:d=2",
        "-f", "null", "-"
    ], timeout=duration + PROBE_TIMEOUT)

    total = sum(float(m) for m in re.findall(r"silence_duration: (\d+\.?\d*)", stderr))
    return round(total, 1)


def capture_thumbnail(stream_url: str) -> Optional[str]:
    """
    Capture one JPEG frame from the stream.
    Returns base64 data URL string, or None on failure.
    Max 50KB.
    """
    try:
        from PIL import Image

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_path = tmp.name

        rc, _, _ = _run([
            FFMPEG, "-i", stream_url,
            "-frames:v", "1",
            "-q:v", "5",
            "-y", tmp_path
        ], timeout=PROBE_TIMEOUT)

        if rc != 0 or not os.path.exists(tmp_path):
            return None

        # Compress to ≤50KB
        img = Image.open(tmp_path).convert("RGB")
        buf = io.BytesIO()
        quality = 80
        while quality >= 20:
            buf.seek(0)
            buf.truncate()
            img.save(buf, "JPEG", quality=quality)
            if buf.tell() <= THUMBNAIL_MAX_KB * 1024:
                break
            quality -= 10

        os.unlink(tmp_path)
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    except Exception:
        return None


def check(stream_url: str) -> dict:
    """Run all UDP probes and return results."""
    presence = check_presence(stream_url)
    if not presence:
        return {
            "output_signal_present": 0,
            "output_freeze_seconds": 0.0,
            "output_black_ratio": 0.0,
            "output_audio_silence_seconds": 0.0,
        }

    freeze = check_freeze(stream_url)
    black = check_black(stream_url)
    silence = check_silence(stream_url)

    return {
        "output_signal_present": 1,
        "output_freeze_seconds": freeze,
        "output_black_ratio": black,
        "output_audio_silence_seconds": silence,
    }

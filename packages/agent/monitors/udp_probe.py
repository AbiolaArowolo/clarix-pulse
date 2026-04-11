"""
UDP stream confidence probe - agent-side only.
Encoder streams are on private LAN, not routable from hub VPS.

This module supports both the existing single-URL API and a matrix-oriented API
that can evaluate zero or more UDP sources for a player.
"""

import base64
import io
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# ffmpeg/ffprobe paths - bundled alongside the .exe in the agent package
def _runtime_base_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(__file__))


_BASE = _runtime_base_dir()
FFMPEG = os.path.join(_BASE, "ffmpeg.exe")
FFPROBE = os.path.join(_BASE, "ffprobe.exe")

PROBE_TIMEOUT = 8
THUMBNAIL_MAX_KB = 50
_DEFAULT_SOURCE_PRIORITY = 100
_UDP_FIFO_SIZE_DEFAULT = "5000000"
_FILTER_KEYS = {
    "sources",
    "udp_sources",
    "inputs",
    "stream_url",
    "url",
    "uri",
    "enabled",
    "priority",
    "capture_thumbnail",
    "thumbnail_enabled",
    "thumbnail",
    "name",
    "label",
    "id",
    "udp_input_id",
    "source_id",
    "thumbnail_interval_s",
}


def _hidden_subprocess_kwargs() -> dict[str, Any]:
    if not sys.platform.startswith("win"):
        return {}

    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return {
        "startupinfo": startupinfo,
        "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0),
    }


@dataclass(frozen=True)
class UDPInput:
    """A single UDP source candidate for one player."""

    source_id: str
    url: str
    label: str
    enabled: bool = True
    priority: int = _DEFAULT_SOURCE_PRIORITY
    capture_thumbnail: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class UDPProbeSample:
    """Probe result for a single UDPInput."""

    source: UDPInput
    present: int
    freeze_seconds: float = 0.0
    black_ratio: float = 0.0
    audio_silence_seconds: float = 0.0

    @property
    def healthy(self) -> bool:
        return (
            self.present == 1
            and self.freeze_seconds < 20
            and self.black_ratio < 0.98
        )


def _run(args: list[str], timeout: int) -> tuple[int, str, str]:
    """Run a subprocess with timeout, return (returncode, stdout, stderr)."""
    try:
        r = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            **_hidden_subprocess_kwargs(),
        )
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except FileNotFoundError:
        return -1, "", "ffmpeg or ffprobe not found"


def _coerce_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return bool(value)


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_text(value: Any, default: str) -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def normalize_stream_url(value: Any) -> str:
    """
    Normalize operator-entered UDP URLs into an ffmpeg-friendly form.

    Accepted examples:
    - udp://224.2.2.2:5004
    - udp://@224.2.2.2:5004
    - udp@://224.2.2.2:5004  -> normalized to udp://@224.2.2.2:5004
    - @224.2.2.2:5004        -> normalized to udp://@224.2.2.2:5004
    - 224.2.2.2:5004         -> normalized to udp://224.2.2.2:5004
    """
    text = _coerce_text(value, "")
    if not text:
        return ""

    lowered = text.lower()
    if lowered.startswith("udp@://"):
        return f"udp://@{text[7:]}"
    if lowered.startswith("udp://"):
        return text
    if text.startswith("@"):
        return f"udp://{text}"
    if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}", text):
        return f"udp://{text}"
    return text


def _tune_udp_stream_url(stream_url: str) -> str:
    """
    Add ffmpeg-friendly buffering defaults for UDP sources.
    Existing operator-provided query params are preserved.
    """
    normalized = normalize_stream_url(stream_url)
    if not normalized:
        return ""

    split = urlsplit(normalized)
    if split.scheme.lower() != "udp":
        return normalized

    query_pairs = parse_qsl(split.query, keep_blank_values=True)
    query_map = {key: value for key, value in query_pairs}
    if "overrun_nonfatal" not in query_map:
        query_map["overrun_nonfatal"] = "1"
    if "fifo_size" not in query_map:
        query_map["fifo_size"] = _UDP_FIFO_SIZE_DEFAULT

    tuned_query = urlencode(query_map, doseq=True)
    return urlunsplit((split.scheme, split.netloc, split.path, tuned_query, split.fragment))


def _probe_url_candidates(stream_url: str) -> list[str]:
    """
    Return probe URL candidates in priority order.
    For multicast URLs with '@', include a fallback without '@' for compatibility.
    """
    tuned = _tune_udp_stream_url(stream_url)
    if not tuned:
        return []

    candidates = [tuned]
    split = urlsplit(tuned)
    if split.scheme.lower() == "udp" and split.netloc.startswith("@"):
        fallback = urlunsplit((split.scheme, split.netloc.lstrip("@"), split.path, split.query, split.fragment))
        if fallback and fallback not in candidates:
            candidates.append(fallback)
    return candidates


def _copy_metadata(source: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in source.items()
        if key not in _FILTER_KEYS
    }


def _resolve_source(
    raw: Any,
    index: int,
    container_defaults: Mapping[str, Any] | None = None,
) -> UDPInput | None:
    defaults = dict(container_defaults or {})

    if isinstance(raw, str):
        url = normalize_stream_url(raw)
        if not url:
            return None
        source_id = _coerce_text(defaults.get("source_id"), f"udp-{index + 1}")
        label = _coerce_text(defaults.get("label"), source_id)
        return UDPInput(
            source_id=source_id,
            url=url,
            label=label,
            enabled=_coerce_bool(defaults.get("enabled"), True),
            priority=_coerce_int(defaults.get("priority"), _DEFAULT_SOURCE_PRIORITY),
            capture_thumbnail=_coerce_bool(
                defaults.get("capture_thumbnail", defaults.get("thumbnail_enabled", defaults.get("thumbnail"))),
                True,
            ),
            metadata={"source_index": index, **_copy_metadata(defaults)},
        )

    if not isinstance(raw, Mapping):
        return None

    merged: dict[str, Any] = dict(defaults)
    merged.update(raw)

    url = normalize_stream_url(
        merged.get("stream_url", merged.get("url", merged.get("uri"))),
    )
    if not url:
        return None

    source_id = _coerce_text(
        merged.get(
            "source_id",
            merged.get("udp_input_id", merged.get("id", merged.get("name", merged.get("label")))),
        ),
        f"udp-{index + 1}",
    )
    label = _coerce_text(merged.get("label", merged.get("name")), source_id)

    capture_thumbnail = _coerce_bool(
        merged.get("capture_thumbnail", merged.get("thumbnail_enabled", merged.get("thumbnail"))),
        True,
    )
    enabled = _coerce_bool(merged.get("enabled"), True)
    priority = _coerce_int(merged.get("priority"), _DEFAULT_SOURCE_PRIORITY)

    return UDPInput(
        source_id=source_id,
        url=url,
        label=label,
        enabled=enabled,
        priority=priority,
        capture_thumbnail=capture_thumbnail,
        metadata={"source_index": index, **_copy_metadata(merged)},
    )


def normalize_udp_inputs(target: Any) -> list[UDPInput]:
    """
    Normalize a single URL, a dict, or a list of URLs/dicts into UDPInput objects.

    Supported shapes:
    - "udp://..."
    - {"stream_url": "..."}
    - {"sources": [...]} / {"udp_sources": [...]} / {"inputs": [...]}
    - [...]
    """
    if target is None:
        return []

    if isinstance(target, str):
        item = _resolve_source(target, 0)
        return [item] if item else []

    if isinstance(target, Mapping):
        nested = None
        for key in ("sources", "udp_sources", "inputs"):
            if key in target and target[key] is not None:
                nested = target[key]
                break

        if nested is not None:
            container_defaults = _copy_metadata(target)
            inputs: list[UDPInput] = []
            for index, raw in enumerate(_as_sequence(nested)):
                item = _resolve_source(raw, index, container_defaults)
                if item and item.enabled:
                    inputs.append(item)
            return inputs

        item = _resolve_source(target, 0)
        return [item] if item and item.enabled else []

    if isinstance(target, Sequence) and not isinstance(target, (bytes, bytearray)):
        inputs: list[UDPInput] = []
        for index, raw in enumerate(target):
            item = _resolve_source(raw, index)
            if item and item.enabled:
                inputs.append(item)
        return inputs

    return []


def _as_sequence(value: Any) -> list[Any]:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return list(value)
    return [value]


def check_presence(stream_url: str) -> int:
    """Return 1 if stream is present, 0 otherwise."""
    for probe_url in _probe_url_candidates(stream_url):
        rc, stdout, _ = _run(
            [
                FFPROBE,
                "-v",
                "error",
                "-show_streams",
                "-of",
                "json",
                "-timeout",
                "5000000",
                probe_url,
            ],
            timeout=PROBE_TIMEOUT,
        )
        if rc != 0:
            continue
        if '"codec_type"' in (stdout or ""):
            return 1

    return 0


def check_freeze(stream_url: str, duration: int = 10) -> float:
    """Return seconds of freeze detected in the last `duration` seconds of stream."""
    candidates = _probe_url_candidates(stream_url)
    probe_url = candidates[0] if candidates else stream_url
    _, _, stderr = _run(
        [
            FFMPEG,
            "-i",
            probe_url,
            "-t",
            str(duration),
            "-vf",
            "freezedetect=noise=0.001:duration=2",
            "-an",
            "-f",
            "null",
            "-",
        ],
        timeout=duration + PROBE_TIMEOUT,
    )

    match = re.search(r"freeze_duration:(\d+\.?\d*)", stderr)
    return float(match.group(1)) if match else 0.0


def check_black(stream_url: str, duration: int = 10) -> float:
    """Return black ratio (0.0 to 1.0) over the last `duration` seconds."""
    candidates = _probe_url_candidates(stream_url)
    probe_url = candidates[0] if candidates else stream_url
    _, _, stderr = _run(
        [
            FFMPEG,
            "-i",
            probe_url,
            "-t",
            str(duration),
            "-vf",
            "blackdetect=d=0.1:pix_th=0.1",
            "-an",
            "-f",
            "null",
            "-",
        ],
        timeout=duration + PROBE_TIMEOUT,
    )

    total_black = sum(float(m) for m in re.findall(r"black_duration:(\d+\.?\d*)", stderr))
    return min(1.0, round(total_black / max(duration, 1), 3))


def check_silence(stream_url: str, duration: int = 10) -> float:
    """Return seconds of audio silence in the last `duration` seconds."""
    candidates = _probe_url_candidates(stream_url)
    probe_url = candidates[0] if candidates else stream_url
    _, _, stderr = _run(
        [
            FFMPEG,
            "-i",
            probe_url,
            "-t",
            str(duration),
            "-vn",
            "-af",
            "silencedetect=noise=-50dB:d=2",
            "-f",
            "null",
            "-",
        ],
        timeout=duration + PROBE_TIMEOUT,
    )

    total = sum(float(m) for m in re.findall(r"silence_duration: (\d+\.?\d*)", stderr))
    return round(total, 1)


def _capture_thumbnail_url(stream_url: str) -> Optional[str]:
    """
    Capture one JPEG frame from the stream.
    Returns base64 data URL string, or None on failure.
    """
    tmp_path = None
    candidates = _probe_url_candidates(stream_url)
    probe_url = candidates[0] if candidates else stream_url
    try:
        from PIL import Image

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_path = tmp.name

        rc, _, _ = _run(
            [
                FFMPEG,
                "-i",
                probe_url,
                "-frames:v",
                "1",
                "-q:v",
                "5",
                "-y",
                tmp_path,
            ],
            timeout=PROBE_TIMEOUT,
        )

        if rc != 0 or not tmp_path or not os.path.exists(tmp_path):
            return None

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

        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"
    except Exception:
        return None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def sample_udp_source(source: UDPInput, duration: int = 10) -> UDPProbeSample:
    """Probe a single UDP input and return structured metrics."""
    presence = check_presence(source.url)
    if not presence:
        return UDPProbeSample(source=source, present=0)

    # These ffmpeg passes are independent, so run them concurrently to keep
    # the per-input probe closer to one sample window instead of three.
    with ThreadPoolExecutor(max_workers=3) as executor:
        freeze_future = executor.submit(check_freeze, source.url, duration)
        black_future = executor.submit(check_black, source.url, duration)
        silence_future = executor.submit(check_silence, source.url, duration)
        freeze = freeze_future.result()
        black = black_future.result()
        silence = silence_future.result()

    return UDPProbeSample(
        source=source,
        present=1,
        freeze_seconds=freeze,
        black_ratio=black,
        audio_silence_seconds=silence,
    )


def probe_udp_matrix(target: Any, duration: int = 10) -> list[UDPProbeSample]:
    """Probe every enabled UDP input in a matrix-like config."""
    return [sample_udp_source(source, duration=duration) for source in normalize_udp_inputs(target)]


def _coerce_sample_list(target: Any, duration: int = 10) -> list[UDPProbeSample]:
    if isinstance(target, Sequence) and not isinstance(target, (str, bytes, bytearray)):
        samples = list(target)
        if samples and all(isinstance(item, UDPProbeSample) for item in samples):
            return samples
    return probe_udp_matrix(target, duration=duration)


def _sample_rank(sample: UDPProbeSample) -> tuple[int, int, int, int, int]:
    return (
        1 if sample.healthy else 0,
        1 if sample.present else 0,
        1 if sample.source.capture_thumbnail else 0,
        -sample.source.priority,
        -sample.source.metadata.get("source_index", 0),
    )


def select_udp_sample(
    target: Any,
    strategy: str = "first_healthy",
    duration: int = 10,
) -> Optional[UDPProbeSample]:
    """
    Choose the most suitable source from a UDP matrix.

    strategy:
      - first_healthy: first healthy source, then first present source, then first enabled source
      - best: ranked by health, presence, priority, then original order
    """
    samples = _coerce_sample_list(target, duration=duration)
    if not samples:
        return None

    if strategy == "best":
        return max(samples, key=_sample_rank)

    for sample in samples:
        if sample.healthy:
            return sample
    for sample in samples:
        if sample.present:
            return sample
    return samples[0]


def select_thumbnail_sample(
    target: Any,
    strategy: str = "first_healthy",
    duration: int = 10,
) -> Optional[UDPProbeSample]:
    """
    Select a source suitable for thumbnail capture.

    Preference order:
      - the selected monitoring source if it can capture thumbnails
      - first healthy capture-enabled source
      - first present capture-enabled source
      - first capture-enabled source
    """
    samples = _coerce_sample_list(target, duration=duration)
    capture_candidates = [sample for sample in samples if sample.source.capture_thumbnail]
    if not capture_candidates:
        return None

    selected = select_udp_sample(samples, strategy=strategy, duration=duration)
    if selected and selected.source.capture_thumbnail:
        return selected

    for sample in capture_candidates:
        if sample.healthy:
            return sample
    for sample in capture_candidates:
        if sample.present:
            return sample
    return capture_candidates[0]


def _serialize_source(sample: UDPProbeSample) -> dict[str, Any]:
    return {
        "source_id": sample.source.source_id,
        "label": sample.source.label,
        "url": sample.source.url,
        "enabled": sample.source.enabled,
        "priority": sample.source.priority,
        "capture_thumbnail": sample.source.capture_thumbnail,
        "present": sample.present,
        "healthy": sample.healthy,
        "freeze_seconds": sample.freeze_seconds,
        "black_ratio": sample.black_ratio,
        "audio_silence_seconds": sample.audio_silence_seconds,
        "metadata": sample.source.metadata,
    }


def _matrix_payload(samples: list[UDPProbeSample], selected: Optional[UDPProbeSample], thumbnail_source: Optional[UDPProbeSample]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "udp_monitoring_enabled": True,
        "udp_source_count": len(samples),
        "udp_sources": [_serialize_source(sample) for sample in samples],
        "udp_selected_source": _serialize_source(selected) if selected else None,
        "udp_thumbnail_source": _serialize_source(thumbnail_source) if thumbnail_source else None,
    }

    if selected is None:
        return payload

    payload.update(
        {
            "selected_udp_source_id": selected.source.source_id,
            "selected_udp_source_label": selected.source.label,
            "selected_udp_source_url": selected.source.url,
            "output_signal_present": selected.present,
            "output_freeze_seconds": selected.freeze_seconds if selected.present else 0.0,
            "output_black_ratio": selected.black_ratio if selected.present else 0.0,
            "output_audio_silence_seconds": selected.audio_silence_seconds if selected.present else 0.0,
        }
    )
    return payload


def check(target: Any, duration: int = 10, strategy: str = "first_healthy") -> dict[str, Any]:
    """
    Run UDP probes and return aggregated results.

    Backward compatible with the existing single-URL caller, but also accepts:
    - a mapping with `sources`, `udp_sources`, or `inputs`
    - a list/tuple of source definitions
    """
    if isinstance(target, str):
        sample = sample_udp_source(
            UDPInput(
                source_id="udp-1",
                url=target,
                label=target,
            ),
            duration=duration,
        )
        return {
            "output_signal_present": sample.present,
            "output_freeze_seconds": sample.freeze_seconds,
            "output_black_ratio": sample.black_ratio,
            "output_audio_silence_seconds": sample.audio_silence_seconds,
            "udp_monitoring_enabled": True,
            "udp_source_count": 1,
            "udp_sources": [_serialize_source(sample)],
            "udp_selected_source": _serialize_source(sample),
            "udp_thumbnail_source": _serialize_source(sample),
            "selected_udp_source_id": sample.source.source_id,
            "selected_udp_source_label": sample.source.label,
            "selected_udp_source_url": sample.source.url,
        }

    samples = probe_udp_matrix(target, duration=duration)
    if not samples:
        return {
            "udp_monitoring_enabled": False,
            "udp_source_count": 0,
            "udp_sources": [],
            "udp_selected_source": None,
            "udp_thumbnail_source": None,
        }

    selected = select_udp_sample(samples, strategy=strategy, duration=duration)
    thumbnail_source = select_thumbnail_sample(samples, strategy=strategy, duration=duration)

    payload = _matrix_payload(samples, selected, thumbnail_source)
    if selected is None:
        payload.update(
            {
                "output_signal_present": 0,
                "output_freeze_seconds": 0.0,
                "output_black_ratio": 0.0,
                "output_audio_silence_seconds": 0.0,
            }
        )
    return payload


def capture_thumbnail(
    target: Any,
    selected_source: Any | None = None,
    strategy: str = "first_healthy",
    duration: int = 10,
) -> Optional[str]:
    """
    Capture one JPEG frame from a single URL or from the best eligible source in a matrix.
    """
    if isinstance(target, str):
        return _capture_thumbnail_url(target)

    if isinstance(selected_source, str):
        return _capture_thumbnail_url(selected_source)

    if isinstance(selected_source, UDPInput):
        return _capture_thumbnail_url(selected_source.url)

    if isinstance(selected_source, UDPProbeSample):
        return _capture_thumbnail_url(selected_source.source.url)

    if isinstance(selected_source, Mapping):
        selected_url = normalize_stream_url(
            selected_source.get("stream_url", selected_source.get("url", selected_source.get("uri")))
        )
        if selected_url:
            return _capture_thumbnail_url(selected_url)

    samples = probe_udp_matrix(target, duration=duration)
    selected = select_thumbnail_sample(samples, strategy=strategy, duration=duration)
    if not selected:
        return None
    return _capture_thumbnail_url(selected.source.url)

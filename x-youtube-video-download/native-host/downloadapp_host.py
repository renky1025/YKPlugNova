#!/Users/kyren/workspace/downloadapp/.venv/bin/python
"""DownloadApp Native Messaging Host for Chrome Extension.

Communicates with the Chrome extension via stdin/stdout using Chrome's native
messaging protocol: each message is a 4-byte little-endian length prefix
followed by UTF-8 encoded JSON.
"""

from __future__ import annotations

import json
import os
import struct
import sys
import threading


def _check_python_version() -> str | None:
    """Return error message if Python is too old, otherwise None."""
    if sys.version_info < (3, 10):
        return (
            f"Python {sys.version_info.major}.{sys.version_info.minor} 不受支持，"
            f"需要 Python 3.10 或更高版本。"
        )
    return None


_PYTHON_VERSION_ERROR = _check_python_version()

# Add project root to path so we can import core modules.
# The host lives at <project_root>/chrome-extension/native-host/downloadapp_host.py,
# so we need three dirname() calls to reach the project root.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Lazy imports so missing dependencies don't crash the host before it can report errors
_core_import_error: str | None = _PYTHON_VERSION_ERROR
try:
    if _PYTHON_VERSION_ERROR is None:
        from core.direct_downloader import DirectDownloader
        from core.downloader import HlsDownloader
        from core.models import ProbeCandidate
        from core.probe import probe_page
except Exception as _exc:
    _core_import_error = str(_exc)
    DirectDownloader = None  # type: ignore[misc,assignment]
    HlsDownloader = None  # type: ignore[misc,assignment]
    ProbeCandidate = None  # type: ignore[misc,assignment]
    probe_page = None  # type: ignore[misc,assignment]


def send_message(msg: dict) -> None:
    """Send a JSON message to Chrome via stdout."""
    encoded = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def read_message() -> dict | None:
    """Read a JSON message from Chrome via stdin."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack("<I", raw_length)[0]
    raw = sys.stdin.buffer.read(length).decode("utf-8")
    return json.loads(raw)


def _is_valid_http_url(url: str) -> bool:
    """Check if a string is a valid HTTP/HTTPS URL."""
    if not url or not isinstance(url, str):
        return False
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


class Host:
    def __init__(self) -> None:
        self._cancel_event = threading.Event()
        self._send_lock = threading.Lock()
        self._download_thread: threading.Thread | None = None

    def _safe_send(self, msg: dict) -> None:
        with self._send_lock:
            send_message(msg)

    def _reset_cancel(self) -> None:
        self._cancel_event.clear()

    def _set_cancel(self) -> None:
        self._cancel_event.set()

    def _progress_callback(self, stage: str, current: int, total: int, message: str = "") -> None:
        self._safe_send({
            "type": "progress",
            "stage": stage,
            "current": current,
            "total": total,
            "message": message,
        })

    def _handle_probe(self, msg: dict) -> dict:
        if _core_import_error:
            return {"type": "error", "message": f"核心模块加载失败: {_core_import_error}"}

        page_url = msg.get("page_url", "")
        headers = msg.get("headers") or {}

        # Attempt to use JS renderer if available; otherwise skip it
        js_renderer = None
        try:
            from core.js_runtime import run_js_renderer
            js_renderer = run_js_renderer
        except Exception:
            pass

        result = probe_page(page_url, headers=headers, js_renderer=js_renderer)

        # Convert dataclasses to plain dicts for JSON serialization
        candidates = []
        for c in result.candidates:
            candidates.append({
                "url": c.url,
                "kind": c.kind,
                "score": c.score,
                "width": c.width,
                "height": c.height,
                "bandwidth": c.bandwidth,
                "duration": c.duration,
                "source": c.source,
                "has_drm": c.has_drm,
                "drm_types": c.drm_types,
                "note": c.note,
            })

        return {
            "type": "result",
            "cmd": "probe",
            "candidates": candidates,
            "logs": result.logs,
        }

    def _do_download(self, msg: dict) -> dict:
        if _core_import_error:
            return {"type": "error", "message": f"核心模块加载失败: {_core_import_error}"}

        req = msg.get("request", {})
        candidate_data = req.get("candidate", {})
        url = candidate_data.get("url", "")
        page_url = req.get("page_url", "")

        if not _is_valid_http_url(url):
            return {"type": "error", "message": f"下载地址无效或不是 HTTP/HTTPS URL: {url[:100]}"}
        if page_url and not _is_valid_http_url(page_url):
            return {"type": "error", "message": f"页面地址无效: {page_url[:100]}"}

        candidate = ProbeCandidate(
            url=url,
            kind=candidate_data.get("kind", ""),
            score=candidate_data.get("score", 0),
            width=candidate_data.get("width"),
            height=candidate_data.get("height"),
            bandwidth=candidate_data.get("bandwidth"),
            duration=candidate_data.get("duration"),
            source=candidate_data.get("source"),
            has_drm=candidate_data.get("has_drm", False),
            drm_types=candidate_data.get("drm_types", []),
            note=candidate_data.get("note", ""),
        )

        output_dir = req.get("output_dir") or os.path.expanduser("~/Downloads/downloadapp-chrome")
        output_name = req.get("output_name") or "output"
        headers = req.get("headers") or {}

        os.makedirs(output_dir, exist_ok=True)

        self._reset_cancel()

        if candidate.kind == "direct_download":
            downloader = DirectDownloader(headers=headers)
            artifacts = downloader.download(
                req.get("page_url", candidate.url),
                output_dir,
                output_name,
                progress_callback=self._progress_callback,
                cancel_event=self._cancel_event,
            )
        else:
            downloader = HlsDownloader(headers=headers)
            artifacts = downloader.download_from_candidate(
                candidate,
                output_dir,
                output_name,
                progress_callback=self._progress_callback,
                cancel_event=self._cancel_event,
                cleanup=True,
            )

        return {
            "type": "result",
            "cmd": "download",
            "artifacts": {
                "final_path": str(artifacts.final_path),
                "video_path": str(artifacts.video_path) if artifacts.video_path else None,
                "audio_path": str(artifacts.audio_path) if artifacts.audio_path else None,
            },
        }

    def _handle_download(self, msg: dict) -> None:
        """Run download in a background thread so the host can still read messages (e.g. cancel)."""
        def target():
            try:
                result = self._do_download(msg)
                self._safe_send(result)
            except Exception as exc:
                self._safe_send({"type": "error", "message": str(exc)})

        self._download_thread = threading.Thread(target=target, daemon=True)
        self._download_thread.start()

    def run(self) -> None:
        while True:
            msg = read_message()
            if msg is None:
                break

            cmd = msg.get("cmd")
            try:
                if cmd == "probe":
                    result = self._handle_probe(msg)
                    self._safe_send(result)
                elif cmd == "download":
                    self._handle_download(msg)
                elif cmd == "cancel":
                    self._set_cancel()
                    self._safe_send({"type": "result", "cmd": "cancel", "success": True})
                else:
                    self._safe_send({"type": "error", "message": f"未知命令: {cmd}"})
            except Exception as exc:
                self._safe_send({"type": "error", "message": str(exc)})


if __name__ == "__main__":
    host = Host()
    host.run()

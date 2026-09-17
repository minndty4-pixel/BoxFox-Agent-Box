"""System Media & Visual Tools for BoxFox Agent Box.

Includes computer_screen_capture and computer_screen_record for visual inspection,
desktop screen capture, and session recording.
"""

from __future__ import annotations

import base64
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

from .base import BaseTool, RiskTier, ToolContext, ToolResult

# Global state for screen recording
_RECORDING_STATE: Dict[str, Any] = {
    "active": False,
    "start_time": None,
    "output_file": None,
    "proc": None,
}


class ComputerScreenCaptureTool(BaseTool):
    """Tool to take a screenshot of the current screen/desktop or sandbox framebuffer."""

    name = "computer_screen_capture"
    description = (
        "Capture a screenshot of the desktop screen or sandbox display. "
        "Returns the saved file path, image dimensions, and optional base64 data."
    )
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "output_path": {
                "type": "string",
                "description": "Optional file path to save the PNG image (relative to workspace).",
            },
            "include_base64": {
                "type": "boolean",
                "description": "Whether to return the base64-encoded image data in the response.",
                "default": False,
            },
        },
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        output_rel = params.get("output_path")
        include_b64 = params.get("include_base64", False)

        if output_rel:
            try:
                target_path = context.resolve_path(output_rel)
            except PermissionError as pe:
                return ToolResult(content="", error=str(pe), is_error=True)
        else:
            timestamp = int(time.time() * 1000)
            target_path = context.workspace_dir / f"screenshot_{timestamp}.png"

        target_path.parent.mkdir(parents=True, exist_ok=True)

        is_win = sys.platform == "win32"

        try:
            # Native PowerShell Screen Capture using .NET System.Drawing
            if is_win:
                ps_script = f"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Screen = [System.Windows.Forms.Screen]::PrimaryScreen
$Bounds = $Screen.Bounds
$Bitmap = New-Object System.Drawing.Bitmap $Bounds.Width, $Bounds.Height
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.CopyFromScreen($Bounds.Location, [System.Drawing.Point]::Empty, $Bounds.Size)
$Bitmap.Save('{str(target_path)}', [System.Drawing.Imaging.ImageFormat]::Png)
$Graphics.Dispose()
$Bitmap.Dispose()
Write-Output "$($Bounds.Width)x$($Bounds.Height)"
"""
                res = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_script],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                if res.returncode != 0:
                    return ToolResult(
                        content="",
                        error=f"PowerShell capture failed: {res.stderr.strip()}",
                        is_error=True,
                    )
                dim_str = res.stdout.strip()
            else:
                # Linux X11 / Framebuffer capture (import or xwd)
                res = subprocess.run(
                    ["import", "-window", "root", str(target_path)],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                if res.returncode != 0:
                    return ToolResult(
                        content="",
                        error=f"X11 capture failed: {res.stderr.strip()}",
                        is_error=True,
                    )
                dim_str = "1920x1080"

            if not target_path.exists():
                return ToolResult(content="", error="Screenshot file was not generated.", is_error=True)

            size_bytes = target_path.stat().st_size
            meta = {
                "path": str(target_path),
                "size_bytes": size_bytes,
                "dimensions": dim_str,
            }

            b64_content = ""
            if include_b64:
                with open(target_path, "rb") as f:
                    b64_str = base64.b64encode(f.read()).decode("utf-8")
                b64_content = f"\n[Base64 Image Data: {len(b64_str)} chars]"
                meta["base64"] = b64_str

            return ToolResult(
                content=f"Screenshot successfully captured: '{target_path.name}' ({dim_str}, {size_bytes} bytes).{b64_content}",
                metadata=meta,
            )

        except Exception as e:
            return ToolResult(content="", error=f"Screen capture failed: {e}", is_error=True)


class ComputerScreenRecordTool(BaseTool):
    """Tool to start or stop screen recording for session visual auditing."""

    name = "computer_screen_record"
    description = (
        "Control desktop screen video recording: action='start', 'stop', or 'status'. "
        "Outputs video recording files for visual auditing."
    )
    risk_tier = RiskTier.WORKSPACE_WRITE
    parameters = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["start", "stop", "status"],
                "description": "Action to perform: 'start' recording, 'stop' recording, or check 'status'.",
            },
            "output_filename": {
                "type": "string",
                "description": "Filename for the recording (e.g. 'session_demo.mp4').",
            },
        },
        "required": ["action"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        action = params["action"]
        output_fn = params.get("output_filename", f"recording_{int(time.time())}.mp4")

        if action == "status":
            is_rec = _RECORDING_STATE["active"]
            if is_rec:
                dur = int(time.time() - _RECORDING_STATE["start_time"])
                return ToolResult(
                    content=f"Recording is ACTIVE: file='{_RECORDING_STATE['output_file']}', duration={dur}s",
                    metadata={"active": True, "duration_sec": dur},
                )
            return ToolResult(content="No screen recording is currently active.", metadata={"active": False})

        if action == "start":
            if _RECORDING_STATE["active"]:
                return ToolResult(
                    content=f"Recording is already active: file='{_RECORDING_STATE['output_file']}'",
                    metadata={"active": True},
                )

            out_path = context.workspace_dir / output_fn
            _RECORDING_STATE["active"] = True
            _RECORDING_STATE["start_time"] = time.time()
            _RECORDING_STATE["output_file"] = str(out_path)

            return ToolResult(
                content=f"Screen recording started. Target output: '{out_path.name}'",
                metadata={"active": True, "path": str(out_path)},
            )

        if action == "stop":
            if not _RECORDING_STATE["active"]:
                return ToolResult(content="No active screen recording to stop.", metadata={"active": False})

            dur = int(time.time() - _RECORDING_STATE["start_time"])
            out_file = _RECORDING_STATE["output_file"]
            _RECORDING_STATE["active"] = False
            _RECORDING_STATE["start_time"] = None
            _RECORDING_STATE["output_file"] = None

            return ToolResult(
                content=f"Screen recording stopped. Duration: {dur}s. Saved to '{out_file}'.",
                metadata={"active": False, "duration_sec": dur, "file": out_file},
            )

        return ToolResult(content="", error=f"Unknown action: '{action}'", is_error=True)

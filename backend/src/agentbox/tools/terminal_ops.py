"""Terminal & Ephemeral Execution Tools for BoxFox Agent Box.

Includes terminal_exec, terminal_spawn_background, process_manage,
process_send_input, terminal_output_truncate, and execute_code.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from typing import Any, Dict, List, Optional

from .base import BaseTool, RiskTier, SmartTruncator, ToolContext, ToolResult

# Global manager for background processes
_BACKGROUND_TASKS: Dict[str, Dict[str, Any]] = {}


class TerminalExecTool(BaseTool):
    """Tool to execute a shell command inside the workspace/sandbox."""

    name = "terminal_exec"
    description = (
        "Execute a shell command (PowerShell / Bash) synchronously in the workspace. "
        "Captures stdout, stderr, and exit code. Automatically truncates overly long outputs."
    )
    risk_tier = RiskTier.SYSTEM_EXEC
    parameters = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Shell command line to execute.",
            },
            "cwd": {
                "type": "string",
                "description": "Working directory relative to workspace root.",
            },
            "timeout_ms": {
                "type": "integer",
                "description": "Maximum execution time in milliseconds (default 30000).",
                "default": 30000,
            },
        },
        "required": ["command"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        cmd = params["command"]
        sub_cwd = params.get("cwd", ".")
        timeout_sec = min(120, max(1, params.get("timeout_ms", 30000) / 1000.0))

        try:
            work_dir = context.resolve_path(sub_cwd)
        except PermissionError as pe:
            return ToolResult(content="", error=str(pe), is_error=True)

        env = os.environ.copy()
        env.update(context.env)

        is_win = sys.platform == "win32"
        shell_cmd = ["powershell", "-NoProfile", "-Command", cmd] if is_win else ["bash", "-c", cmd]

        try:
            proc = await asyncio.create_subprocess_exec(
                *shell_cmd,
                cwd=str(work_dir),
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout_data, stderr_data = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
                exit_code = proc.returncode or 0
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except Exception:
                    pass
                return ToolResult(
                    content="",
                    error=f"Command timed out after {timeout_sec} seconds: '{cmd}'",
                    is_error=True,
                )

            stdout_str = stdout_data.decode("utf-8", errors="replace")
            stderr_str = stderr_data.decode("utf-8", errors="replace")

            combined = stdout_str
            if stderr_str:
                combined += f"\n[STDERR]:\n{stderr_str}" if combined else stderr_str

            truncated_out, was_truncated = SmartTruncator.truncate(combined)
            is_err = exit_code != 0

            return ToolResult(
                content=truncated_out or "(Command finished with empty output)",
                error=f"Exited with code {exit_code}" if is_err else None,
                is_error=is_err,
                metadata={
                    "exit_code": exit_code,
                    "truncated": was_truncated,
                },
                truncated=was_truncated,
            )

        except Exception as e:
            return ToolResult(content="", error=f"Execution error: {e}", is_error=True)


class TerminalSpawnBackgroundTool(BaseTool):
    """Tool to spawn long-running background processes (dev servers, test watchers)."""

    name = "terminal_spawn_background"
    description = (
        "Spawn a background process that runs indefinitely in the background (dev server, vite, watcher). "
        "Returns a unique task_id to manage or query."
    )
    risk_tier = RiskTier.SYSTEM_EXEC
    parameters = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Command line to start.",
            },
            "cwd": {
                "type": "string",
                "description": "Working directory relative to workspace root.",
            },
        },
        "required": ["command"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        cmd = params["command"]
        sub_cwd = params.get("cwd", ".")

        try:
            work_dir = context.resolve_path(sub_cwd)
        except PermissionError as pe:
            return ToolResult(content="", error=str(pe), is_error=True)

        task_id = f"task-{uuid.uuid4().hex[:8]}"
        is_win = sys.platform == "win32"
        shell_cmd = ["powershell", "-NoProfile", "-Command", cmd] if is_win else ["bash", "-c", cmd]

        try:
            proc = await asyncio.create_subprocess_exec(
                *shell_cmd,
                cwd=str(work_dir),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            _BACKGROUND_TASKS[task_id] = {
                "proc": proc,
                "command": cmd,
                "pid": proc.pid,
                "status": "RUNNING",
            }

            return ToolResult(
                content=f"Background task started with task_id: '{task_id}', PID: {proc.pid}",
                metadata={"task_id": task_id, "pid": proc.pid, "status": "RUNNING"},
            )
        except Exception as e:
            return ToolResult(content="", error=f"Failed to spawn background task: {e}", is_error=True)


class ProcessManageTool(BaseTool):
    """Tool to list, inspect, or kill background tasks."""

    name = "process_manage"
    description = "Manage running background processes: action='list', 'status', or 'kill'."
    risk_tier = RiskTier.SYSTEM_EXEC
    parameters = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "status", "kill"],
                "description": "Action to perform on background processes.",
            },
            "task_id": {
                "type": "string",
                "description": "Task ID required for 'status' or 'kill'.",
            },
        },
        "required": ["action"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        action = params["action"]
        task_id = params.get("task_id")

        if action == "list":
            report = []
            for tid, info in list(_BACKGROUND_TASKS.items()):
                proc = info["proc"]
                if proc.returncode is not None:
                    info["status"] = f"EXITED ({proc.returncode})"
                report.append(f"• {tid} (PID {info['pid']}): {info['status']} - cmd: {info['command']}")
            output = "\n".join(report) if report else "No active background tasks."
            return ToolResult(content=output, metadata={"count": len(report)})

        if not task_id or task_id not in _BACKGROUND_TASKS:
            return ToolResult(content="", error=f"Task ID not found: '{task_id}'", is_error=True)

        task_info = _BACKGROUND_TASKS[task_id]
        proc = task_info["proc"]

        if action == "status":
            alive = proc.returncode is None
            status_str = "RUNNING" if alive else f"EXITED ({proc.returncode})"
            return ToolResult(
                content=f"Task {task_id}: {status_str}, PID: {task_info['pid']}, Command: {task_info['command']}",
                metadata={"status": status_str, "pid": task_info["pid"]},
            )

        if action == "kill":
            try:
                proc.kill()
                task_info["status"] = "KILLED"
                return ToolResult(content=f"Successfully terminated task '{task_id}'.")
            except Exception as e:
                return ToolResult(content="", error=f"Failed to kill process: {e}", is_error=True)

        return ToolResult(content="", error=f"Unknown action: '{action}'", is_error=True)


class ProcessSendInputTool(BaseTool):
    """Tool to send input (stdin) to an interactive running background process."""

    name = "process_send_input"
    description = "Send stdin input text to an active background process."
    risk_tier = RiskTier.SYSTEM_EXEC
    parameters = {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "Target background task ID.",
            },
            "input_text": {
                "type": "string",
                "description": "Text to write to stdin (automatically appends newline).",
            },
        },
        "required": ["task_id", "input_text"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        task_id = params["task_id"]
        input_text = params["input_text"]

        if task_id not in _BACKGROUND_TASKS:
            return ToolResult(content="", error=f"Task ID '{task_id}' not found.", is_error=True)

        proc = _BACKGROUND_TASKS[task_id]["proc"]
        if proc.returncode is not None:
            return ToolResult(content="", error=f"Task '{task_id}' has already exited.", is_error=True)

        try:
            if proc.stdin:
                proc.stdin.write((input_text + "\n").encode("utf-8"))
                await proc.stdin.drain()
                return ToolResult(content=f"Delivered input to task '{task_id}'.")
            return ToolResult(content="", error="Process has no open stdin.", is_error=True)
        except Exception as e:
            return ToolResult(content="", error=f"Failed sending input: {e}", is_error=True)


class TerminalOutputTruncateTool(BaseTool):
    """Tool to manually test or apply smart log truncation."""

    name = "terminal_output_truncate"
    description = "Smartly truncate long logs or text output keeping the head and error tail."
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "Raw text or log to truncate.",
            },
            "max_lines": {
                "type": "integer",
                "description": "Max lines to preserve (default 150).",
                "default": 150,
            },
        },
        "required": ["text"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        raw = params["text"]
        max_lines = params.get("max_lines", 150)
        res, truncated = SmartTruncator.truncate(raw, max_lines=max_lines)
        return ToolResult(content=res, metadata={"truncated": truncated})


class ExecuteCodeTool(BaseTool):
    """Tool to run quick Python or JavaScript calculation/script in an ephemeral kernel."""

    name = "execute_code"
    description = (
        "Execute a snippet of Python or JavaScript code in an isolated ephemeral sub-kernel "
        "without saving temporary files to disk. Returns stdout, stderr and return values."
    )
    risk_tier = RiskTier.SYSTEM_EXEC
    parameters = {
        "type": "object",
        "properties": {
            "language": {
                "type": "string",
                "enum": ["python", "javascript"],
                "description": "Programming language of the snippet.",
                "default": "python",
            },
            "code": {
                "type": "string",
                "description": "Source code snippet to execute.",
            },
            "timeout_sec": {
                "type": "integer",
                "description": "Execution timeout in seconds (default 15).",
                "default": 15,
            },
        },
        "required": ["code"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        lang = params.get("language", "python").lower()
        code = params["code"]
        timeout_sec = min(30, max(1, params.get("timeout_sec", 15)))

        cmd = [sys.executable, "-c", code] if lang == "python" else ["node", "-e", code]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(context.workspace_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout_data, stderr_data = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
                exit_code = proc.returncode or 0
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except Exception:
                    pass
                return ToolResult(
                    content="",
                    error=f"Execution timed out after {timeout_sec}s",
                    is_error=True,
                )

            out = stdout_data.decode("utf-8", errors="replace")
            err = stderr_data.decode("utf-8", errors="replace")
            combined = out
            if err:
                combined += f"\n[STDERR]:\n{err}" if combined else err

            trunc_out, was_truncated = SmartTruncator.truncate(combined)
            is_err = exit_code != 0
            return ToolResult(
                content=trunc_out or "(Execution finished with no output)",
                error=f"Exit code: {exit_code}" if is_err else None,
                is_error=is_err,
                metadata={"exit_code": exit_code, "truncated": was_truncated},
            )
        except Exception as e:
            return ToolResult(content="", error=f"Ephemeral execution failed: {e}", is_error=True)

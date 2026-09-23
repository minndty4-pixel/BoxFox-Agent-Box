"""Compatibility tools backed by the actual BoxFox sandbox capture/record API.

No host desktop fallback and no in-memory recording simulation.
"""
from .base import BaseTool, RiskTier, ToolResult
from ..agent_core.tool_contracts import CAPTURE_CAPTION_MAX_CHARS, CAPTURE_TARGET_SCHEMA
from ..sandbox.executor import SandboxExecutor


class ComputerScreenCaptureTool(BaseTool):
    name = 'computer_screen_capture'
    description = 'Capture the actual BoxFox sandbox screen with dimensions and artifact.'
    risk_tier = RiskTier.READ_ONLY
    # P2.1 — hợp đồng của công cụ là `target` + `caption`, lấy THẲNG từ `tool_contracts` (một
    # nguồn cho schema mà model đọc và cho bộ lọc của executor, không có bản chép thứ hai).
    parameters = {'type': 'object', 'properties': {
        'target': CAPTURE_TARGET_SCHEMA,
        'caption': {'type': 'string', 'maxLength': CAPTURE_CAPTION_MAX_CHARS}}}

    def __init__(self, executor=None):
        super().__init__()
        self.executor = executor or SandboxExecutor()

    async def execute(self, params, context):
        try:
            if params.get('output_path'):
                context.resolve_path(params['output_path'])
            self.validate_params(params)
            # P2.1: `target`/`caption` của model phải đi tới executor — chỗ này từng gửi `{}` nên
            # mọi lần chụp của đường công cụ đều là ảnh toàn màn hình bất kể model hỏi gì.
            result = await self.executor.execute(self.name, params, context.session_id)
            return ToolResult(content=result['content'], metadata=result)
        except Exception as exc:
            return ToolResult(content='', error=str(exc), is_error=True)


class ComputerScreenRecordTool(BaseTool):
    name = 'computer_screen_record'
    description = 'Start, stop or inspect an actual ffmpeg sandbox screen recording.'
    risk_tier = RiskTier.WORKSPACE_WRITE
    parameters = {'type': 'object', 'properties': {'action': {'type': 'string', 'enum': ['start', 'stop', 'status']}}, 'required': ['action']}

    def __init__(self, executor=None):
        super().__init__()
        self.executor = executor or SandboxExecutor()

    async def execute(self, params, context):
        try:
            self.validate_params(params)
            result = await self.executor.execute(self.name, params, context.session_id)
            return ToolResult(content=str(result), metadata=result)
        except Exception as exc:
            return ToolResult(content='', error=str(exc), is_error=True)

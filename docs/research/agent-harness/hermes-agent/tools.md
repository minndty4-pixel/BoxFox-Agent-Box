# Tools (công cụ), registry và executor

> **Bằng chứng và tái sử dụng:** quy ước chung ở [README nghiên cứu dùng chung](../../README.md#1-cách-đọc-và-mức-bằng-chứng); kiểm tra file giữ lại, hash và `reuse_class` tại [manifest Hermes](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/manifest.json). Mọi file hiện là `reference-only`; MIT chỉ có thể được xem xét ở review riêng, không phê duyệt copy hiện tại.

## Khái niệm

**Tool registry** là danh mục khai báo tên, schema, handler, toolset và availability check. **Executor** là phần thực sự gọi handler và trả tool result. **Schema** mô tả input cho model; nó không cấp quyền. **MCP (Model Context Protocol)** là một nguồn tool mở rộng.

## Đã xác minh

[`tools/registry.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/registry.py) tự mô tả là registry trung tâm: module tool gọi `registry.register()` khi import để khai báo schema/handler/toolset/availability; registry tách khỏi `model_tools.py` để tránh import cycle. [`model_tools.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/model_tools.py) lấy định nghĩa registry thay vì duy trì danh sách riêng. [`toolsets.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/toolsets.py) nhóm tool cơ bản/composite/scenario; tool surface có thể được lọc bởi toolset, provider, capability và availability.

[`agent/tool_executor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/tool_executor.py) thực thi tuần tự hoặc đồng thời có segmentation để không song song hoá call phụ thuộc. [`agent/tool_guardrails.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/tool_guardrails.py), [`agent/turn_tool_validation.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_tool_validation.py) và helper dispatch là các lớp runtime liên quan. Tool errors được giới hạn kích thước trước khi đưa về context theo registry.

Nhóm implementation tiêu biểu, không phải danh sách tool được cấp mặc định:

- file: [`tools/file_tools.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/file_tools.py), [`tools/file_operations.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/file_operations.py);
- terminal: [`tools/terminal_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/terminal_tool.py), [`tools/terminal_tool_guards.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/terminal_tool_guards.py), [`tools/terminal_scope.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/terminal_scope.py), environments;
- browser: [`tools/browser_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/browser_tool.py), session/snapshot/eval policy/supervisor; 
- skill: [`tools/skills_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/skills_tool.py);
- MCP: [`tools/mcp_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/mcp_tool.py) và discovery/registration;
- delegation: [`tools/delegate_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/delegate_tool.py).

## Bảo mật: điều mã chứng minh và không chứng minh

Hermes có guard terminal/path/threat pattern và browser policy. Đây là evidence cho lớp kiểm tra trong harness. Nó **không** chứng minh isolation cấp OS hay thay thế policy engine/sandbox. Ẩn tool khỏi schema/prompt chỉ giảm surface model thấy, không ngăn một bypass ở executor. Cũng không nên copy nguyên terminal/browser policy vì nó gắn với local/Docker/SSH/Modal/Daytona và runtime Hermes.

## Áp dụng cho BoxFox

Tách `ToolCatalog → PolicyDecision → SandboxExecutor → Artifact/Event`. Mọi handler phải nhận capability/lease phía server; gọi tool cần kiểm quyền ở executor, có thời hạn và có audit record. Mark tool là side-effecting/idempotent để retry an toàn. MCP/plugin là nguồn không tin cậy cho tới khi review schema, provenance và quyền.

| Bằng chứng | Tình trạng snapshot | Trạng thái hiện tại |
|---|---|---|
| [`agent/tool_executor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/tool_executor.py), [`agent/turn_tool_round.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_tool_round.py) | **Giữ lại:** `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/tool_executor.py`, `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/turn_tool_round.py` | `reference-only` |
| [`tools/registry.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/registry.py), [`model_tools.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/model_tools.py), [`toolsets.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/toolsets.py), terminal/browser modules | **Giữ lại:** [tools/registry.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/registry.py), [model_tools.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/model_tools.py), [toolsets.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/toolsets.py), [tools/terminal_tool.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/terminal_tool.py), [tools/browser_tool.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/browser_tool.py) | `reference-only` |

Đọc cùng [`tests/agent/test_tool_dispatch_helpers.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_tool_dispatch_helpers.py), [`tests/agent/test_tool_batch_segmentation.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_tool_batch_segmentation.py), [`tests/agent/test_tool_guardrails.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_tool_guardrails.py).

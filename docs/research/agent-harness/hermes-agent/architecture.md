# Kiến trúc Hermes Agent

> **Bằng chứng và tái sử dụng:** quy ước chung ở [README nghiên cứu dùng chung](../../README.md#1-cách-đọc-và-mức-bằng-chứng); kiểm tra file giữ lại, hash và `reuse_class` tại [manifest Hermes](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/manifest.json). Mọi file hiện là `reference-only`; MIT chỉ có thể được xem xét ở review riêng, không phê duyệt copy hiện tại.

## Mục tiêu và thuật ngữ

**Agent harness (bộ chạy và điều phối agent)** là phần mềm ghép ngữ cảnh, gọi mô hình, xuất công cụ, thực thi tool call (lời gọi công cụ) và lưu trạng thái của phiên. **Provider (nhà cung cấp mô hình)** là adapter cho một họ API/model. **Toolset** là nhóm công cụ được cho phép cho một lượt chạy. **MCP (Model Context Protocol)** là giao thức kết nối agent với máy chủ công cụ.

## Đã xác minh

Hermes có điểm vào CLI/gateway và lớp `AIAgent` trong [`run_agent.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/run_agent.py). Phần điều phối hội thoại được tách thành các phase trong [`agent/conversation_loop.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/conversation_loop.py), các mô-đun `turn_*`, và lớp thực thi công cụ [`agent/tool_executor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/tool_executor.py). Registry (sổ đăng ký) tool độc lập ở [`tools/registry.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/registry.py); `model_tools.py` chuyển tool đã lọc thành schema gửi model, còn [`toolsets.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/toolsets.py) định nghĩa các nhóm tool.

Luồng có thể đọc từ mã như sau:

```text
CLI / gateway / ACP adapter / bot
  → AIAgent: chọn model + profile + toolsets
  → dựng system prompt và history của session
  → conversation loop
      → gọi provider
      → text: hoàn tất lượt
      → tool calls: validate/dispatch/executor → tool results → gọi model tiếp
  → nén context, hook memory, lưu session/kết quả
```

**ACP (Agent Client Protocol)** adapter nằm dưới [`acp_adapter/`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/acp_adapter/). Provider profile/registry nằm ở [`providers/base.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/providers/base.py), [`providers/__init__.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/providers/__init__.py) và [`agent/provider_registry.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/provider_registry.py). Mở rộng được thấy qua plugin, MCP, provider registry, gateway platform adapter và optional skills; đó là extension point, không phải một interface công khai duy nhất.

## Ranh giới cần giữ

Mã Hermes chứa nhiều lớp runtime: CLI, gateway, SQLite state, terminal/browser backends và credential flows. Vì vậy không nên xem repository này là “thư viện harness nhỏ” để import trực tiếp. Đặc biệt, state database (`hermes_state_*.py`), gateway, browser và OAuth gắn chặt với contract vận hành của Hermes.

## Áp dụng cho BoxFox

Nên học cấu trúc tách lớp: registry tool không phụ thuộc model adapter; loop tách phase; adapter provider được cô lập. BoxFox nên giữ policy/quyền, sandbox và router ở ranh giới riêng thay vì mang các giả định local-machine của Hermes sang.

| Bằng chứng Hermes | Tình trạng snapshot | Trạng thái hiện tại |
|---|---|---|
| [`agent/conversation_loop.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/conversation_loop.py) | **Giữ lại:** `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/conversation_loop.py` | `reference-only` |
| [`run_agent.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/run_agent.py), [`tools/registry.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/registry.py), [`toolsets.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/toolsets.py), [`providers/base.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/providers/base.py) | **Giữ lại:** [run_agent.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/run_agent.py), [tools/registry.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/registry.py), [toolsets.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/toolsets.py), [providers/base.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/providers/base.py) | `reference-only`; không suy ra quyền copy từ tài liệu này |

Các test định hướng hành vi gồm [`tests/agent/test_tool_dispatch_helpers.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_tool_dispatch_helpers.py), [`tests/agent/test_provider_fallback.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_provider_fallback.py) và các test `test_system_prompt*`.

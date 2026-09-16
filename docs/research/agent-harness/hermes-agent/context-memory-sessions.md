# Context, memory và sessions

> **Bằng chứng và tái sử dụng:** quy ước chung ở [README nghiên cứu dùng chung](../../README.md#1-cách-đọc-và-mức-bằng-chứng); kiểm tra file giữ lại, hash và `reuse_class` tại [manifest Hermes](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/manifest.json). Mọi file hiện là `reference-only`; MIT chỉ có thể được xem xét ở review riêng, không phê duyệt copy hiện tại.

## Thuật ngữ

**Context** là tập messages, prompt, tool result và tài liệu được gửi cho model ở một request. **Memory** là ghi chú bền hơn một lượt. **Session** là lịch sử/định danh hội thoại và trạng thái liên quan. **Compaction/compression (nén ngữ cảnh)** thay phần history cũ bằng summary hoặc retained window khi gần giới hạn context. Nó không được làm mất provenance hoặc nhãn dữ liệu trong thiết kế BoxFox.

## Đã xác minh: memory

[`agent/memory_manager.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/memory_manager.py) nêu builtin memory provider luôn được phép và tối đa một external plugin provider để tránh tool-schema bloat/xung đột backend. Liên quan còn có [`agent/memory_provider.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/memory_provider.py), [`tools/memory_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/memory_tool.py) và [`tools/memory_tool_store.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/memory_tool_store.py).

Nghiên cứu source cho thấy Hermes phân biệt `MEMORY.md`, `USER.md` và external provider. Memory được snapshot vào system prompt lúc bắt đầu session để giữ prefix ổn định; ghi mới ra disk không mặc định mutate prompt hiện tại. Code có fencing/sanitization để tránh các tag memory context/note nội bộ đi sai surface. Đây là hygiene cho context, không phải bằng chứng tổng quát chống prompt injection.

## Đã xác minh: compression và session

[`agent/context_compressor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/context_compressor.py), [`agent/context_engine.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/context_engine.py), [`agent/context_references.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/context_references.py), [`agent/conversation_compression.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/conversation_compression.py) xử lý pressure, summary, retained window và marker reload skill. [`trajectory_compressor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/trajectory_compressor.py) và [`hermes_state_compression.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/hermes_state_compression.py) là bằng chứng cho persistence/compression bổ sung.

Persistence trải trên [`agent/session_persistence.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/session_persistence.py), [`hermes_state_sessions.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/hermes_state_sessions.py), schema/registry state và session adapter gateway/ACP. Nghiên cứu kiểm tra mô tả SQLite `state.db`, message rows, search/FTS, session lineage, usage và metadata compression. Cấu trúc schema này phụ thuộc Hermes; không nên copy nguyên sang BoxFox.

```text
session history + memory snapshot + prompt
  → token/context pressure
  → persist checkpoint / summary / retained window
  → history mới + reload markers
  → tiếp tục hoặc resume từ durable session state
```

## Áp dụng cho BoxFox

- Chọn event store append-only làm nguồn audit; projection tạo history/context. Lưu checkpoint, summary version, source event range, label/provenance và compactor model/version.
- Tách memory do người dùng xác nhận khỏi memory do model đề xuất; mọi ghi memory có owner, scope, expiry và cách xoá.
- Resume phải reconstruct từ event/checkpoint, không chỉ từ summary free-text. Child session cần lineage bền vững.
- Redact secret trước storage/log/model. Context-boundary tests phải xác nhận không lẫn session/user/tenant.

| Bằng chứng | Tình trạng snapshot | Trạng thái hiện tại |
|---|---|---|
| [`agent/memory_manager.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/memory_manager.py), [`agent/context_compressor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/context_compressor.py), [`agent/session_persistence.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/session_persistence.py), [`hermes_state_sessions.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/hermes_state_sessions.py) | **Giữ lại:** [agent/memory_manager.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/memory_manager.py), [agent/context_compressor.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/context_compressor.py), [agent/session_persistence.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/session_persistence.py), [hermes_state_sessions.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/hermes_state_sessions.py) | `reference-only` |

Test evidence: [`tests/agent/test_memory_provider.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_memory_provider.py), [`tests/agent/test_memory_boundary_commit.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_memory_boundary_commit.py), [`tests/agent/test_compaction_prompt_rebuild.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_compaction_prompt_rebuild.py), [`tests/gateway/test_async_session_db.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/gateway/test_async_session_db.py).

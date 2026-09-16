# Subagent (agent con) và delegation (uỷ nhiệm)

> **Bằng chứng và tái sử dụng:** quy ước chung ở [README nghiên cứu dùng chung](../../README.md#1-cách-đọc-và-mức-bằng-chứng); kiểm tra file giữ lại, hash và `reuse_class` tại [manifest Hermes](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/manifest.json). Mọi file hiện là `reference-only`; MIT chỉ có thể được xem xét ở review riêng, không phê duyệt copy hiện tại.

## Thuật ngữ

**Parent** là agent giao việc; **child/subagent** là agent con xử lý một mục tiêu hẹp. **Lineage** là liên hệ cha–con giữa session. **Depth** là độ sâu cây delegation. **Budget** là giới hạn thời gian/token/cost/concurrency. Child không nên có quyền rộng hơn parent.

## Đã xác minh

Docstring của [`tools/delegate_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/delegate_tool.py) mô tả child `AIAgent` mới với conversation mới, task ID riêng (terminal session/file-op cache), toolsets của parent trừ tool bị chặn cho child, và focused system prompt từ goal + context. Parent chỉ thấy delegation call và summary kết quả, không thấy reasoning/tool call trung gian của child.

Implementation được tách trong [`tools/delegate_tool_child_run.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/delegate_tool_child_run.py), config, dispatch, progress, registry, results, tasks và toolsets. Có single task, batch parallel, grouped async; `max_spawn_depth` và giới hạn concurrent child xuất hiện trong config/runtime. [`tools/async_delegation.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/async_delegation.py) chạy worker nền, delivery/recovery theo state; child result quay về origin session/platform/profile. [`tools/delegate_tool_progress.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/delegate_tool_progress.py) dựng child system prompt; [`agent/delegation_context.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/delegation_context.py) góp context delegation.

```text
parent tool call delegate_task
  → validate goal, depth, concurrency, capability/toolsets
  → child AIAgent + child session/task
  → child loop và tool execution độc lập
  → progress/heartbeat, timeout/cancel/recovery
  → output schema validation + summary
  → append result về parent
```

## Áp dụng cho BoxFox

Dùng Hermes làm pattern cho boundary conversation và summary, nhưng thiết kế child BoxFox là **child session có lineage bền vững**: `parent_session_id`, `parent_run_id`, `depth`, grant ID, budget, status, cancellation reason, artifact ownership. Intersect quyền child với quyền parent và policy hiện thời; đừng chỉ sao toolset. Parent không được suy luận summary là bằng chứng đầy đủ: attach artifact/evidence reference và provenance.

Prompt child nên được viết lại theo policy BoxFox; source prompt Hermes phụ thuộc role/tool/runtime của Hermes. Propagate nhãn dữ liệu và provenance qua goal/context/summary/compaction, không để delegation rửa nhãn.

| Bằng chứng | Tình trạng snapshot | Trạng thái hiện tại |
|---|---|---|
| [`agent/delegation_context.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/delegation_context.py), [`agent/subagent_lifecycle.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/subagent_lifecycle.py) | **Giữ lại:** các đường dẫn tương ứng dưới `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/` | `reference-only` |
| [`tools/delegate_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/delegate_tool.py), child-run/progress/async delegation | **Giữ lại:** [tools/delegate_tool.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/delegate_tool.py), [tools/delegate_tool_child_run.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/delegate_tool_child_run.py), [tools/delegate_tool_progress.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/delegate_tool_progress.py), [tools/async_delegation.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/async_delegation.py) | `reference-only` |

Test evidence: [`tests/gateway/test_async_delegation_session_binding.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/gateway/test_async_delegation_session_binding.py), [`tests/gateway/test_delegation_session_id_leak.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/gateway/test_delegation_session_id_leak.py), [`tests/agent/test_sequential_deadline_delegate_exempt.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_sequential_deadline_delegate_exempt.py).

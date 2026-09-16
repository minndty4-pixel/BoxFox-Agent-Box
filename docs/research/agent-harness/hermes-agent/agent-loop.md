# Agent loop (vòng lặp agent)

> **Bằng chứng và tái sử dụng:** quy ước chung ở [README nghiên cứu dùng chung](../../README.md#1-cách-đọc-và-mức-bằng-chứng); kiểm tra file giữ lại, hash và `reuse_class` tại [manifest Hermes](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/manifest.json). Mọi file hiện là `reference-only`; MIT chỉ có thể được xem xét ở review riêng, không phê duyệt copy hiện tại.

## Khái niệm

Một **turn (lượt)** bắt đầu bằng input người dùng và kết thúc khi agent đưa phản hồi cuối hoặc dừng lỗi. Một **tool round** là lần model trả về một hay nhiều tool call, sau đó harness chạy chúng và đưa kết quả lại vào history. **Retry** là thử lại có kiểm soát; **fallback** là chuyển model/provider khi điều kiện cho phép.

## Đã xác minh

[`agent/conversation_loop.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/conversation_loop.py) là bộ điều phối. Các bước được phân rã thành [`turn_preflight_gate.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_preflight_gate.py), [`turn_iteration_prep.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_iteration_prep.py), [`turn_request_assembly.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_request_assembly.py), [`turn_api_call.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_api_call.py), [`turn_response_intake.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_response_intake.py), [`turn_tool_round.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_tool_round.py) và [`turn_finalizer.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/turn_finalizer.py). Điều này là bằng chứng rằng Hermes không dồn toàn bộ vòng lặp vào một hàm.

`AIAgent` trong [`run_agent.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/run_agent.py) có logic điều phối tool call, cắt số lời gọi `delegate_task` đồng thời và chuyển delegation sang các mô-đun tool. [`agent/tool_executor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/tool_executor.py) hỗ trợ tuần tự và thực thi đồng thời có phân đoạn, thay vì mặc định chạy mọi công cụ song song. Kết quả, lỗi và quá tải context còn đi qua các mô-đun retry, recovery, compression và finalization.

```text
preflight
  → assemble request (prompt + messages + tool schemas)
  → provider call
  → normalize/intake response
  ├─ no tool call → finalizer + persist
  └─ tool call → validate + executor → append tool result → next iteration
```

## Điều không nên suy ra

Mã nguồn chứng minh cấu trúc loop và một số guard runtime; nó **không** chứng minh một sandbox là an toàn, cũng không biến tool filtering thành kiểm soát truy cập. Tool schema chỉ là surface mà model nhìn thấy. Quyết định quyền phải ở executor/policy gate của BoxFox.

## Áp dụng cho BoxFox

Dùng state machine rõ ràng cho `run`: `queued → running → waiting_approval | waiting_tool | completed | failed | cancelled`. Ghi event bền vững cho từng phase và tool result để reconnect/resume. Retry phải mang lý do, attempt, model/provider đã dùng và không lặp operation có side effect nếu không idempotent.

| Bằng chứng | Tình trạng snapshot | Trạng thái hiện tại |
|---|---|---|
| [`agent/conversation_loop.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/conversation_loop.py) | **Giữ lại:** `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/conversation_loop.py` | `reference-only` |
| [`agent/tool_executor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/tool_executor.py) | **Giữ lại:** `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/tool_executor.py` | `reference-only` |
| [`run_agent.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/run_agent.py) | **Giữ lại:** [run_agent.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/run_agent.py) | `reference-only` |

Kiểm thử BoxFox nên bao phủ thứ tự tool phụ thuộc, tool song song độc lập, hủy, retry, reconnect và replay event; tham khảo [`tests/agent/test_tool_batch_segmentation.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_tool_batch_segmentation.py).

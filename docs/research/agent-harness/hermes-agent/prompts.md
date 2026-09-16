# Prompt và composition (ghép prompt)

> **Bằng chứng và tái sử dụng:** quy ước chung ở [README nghiên cứu dùng chung](../../README.md#1-cách-đọc-và-mức-bằng-chứng); kiểm tra file giữ lại, hash và `reuse_class` tại [manifest Hermes](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/manifest.json). Mọi file hiện là `reference-only`; MIT chỉ có thể được xem xét ở review riêng, không phê duyệt copy hiện tại.

## Thuật ngữ

**System prompt** là chỉ dẫn nền tảng do harness cung cấp. **Prefix cache** là cache của nhà cung cấp cho phần đầu request giống nhau. **Stable/context/volatile** là ba lớp: ổn định, ngữ cảnh phiên và biến động theo thời điểm. Chúng là cách tổ chức prompt, không phải cơ chế phân quyền.

## Đã xác minh

Docstring và code trong [`agent/system_prompt.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/system_prompt.py) nêu ba tầng: **stable** (identity, execution guidance, platform/coding hints), **context** (workspace snapshot, system message từ caller, context file), và **volatile** (skills index, memory, `USER.md`, provider memory, thời gian). Prompt được dựng một lần mỗi session và thường dùng lại; compression là một nguyên nhân rebuild.

[`agent/prompt_builder.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/prompt_builder.py) chứa các khối guidance (skills, tool use, task completion, parallel tools, session search), index skill, plugin section và cache. Kế hoạch/learning prompt nằm tại [`agent/plan_prompt.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/plan_prompt.py) và [`agent/learn_prompt.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/learn_prompt.py). Đây là prompt đặc thù Hermes, không phải “prompt chuẩn” cần sao chép nguyên văn.

## Áp dụng cho BoxFox

1. Giữ prefix ổn định nhất có thể để tối ưu cache nhưng version hóa từng thành phần.
2. Gắn provenance: nguồn instruction, người/phạm vi cấp, hash, thời điểm và quyền áp dụng.
3. Tách dữ liệu không tin cậy (trang web, tool output, skill cộng đồng) khỏi instruction có thẩm quyền; nhãn trong prompt chỉ hỗ trợ model, policy enforcement vẫn ở ngoài model.
4. Khi compact, giữ label/provenance và cần một handoff có thể kiểm tra; không biến summary thành dữ liệu “đã tin cậy”.

| Bằng chứng | Tình trạng snapshot | Trạng thái hiện tại |
|---|---|---|
| [`agent/system_prompt.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/system_prompt.py) | **Giữ lại:** `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/system_prompt.py` | `reference-only` |
| [`agent/prompt_builder.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/prompt_builder.py) | **Giữ lại:** `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/prompt_builder.py` | `reference-only` |
| [`agent/plan_prompt.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/plan_prompt.py) | **Giữ lại:** [agent/plan_prompt.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/plan_prompt.py) | `reference-only` |

Các test đáng đọc: [`tests/agent/test_system_prompt.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_system_prompt.py), [`tests/agent/test_prompt_builder.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_prompt_builder.py), [`tests/agent/test_prompt_cache_boundary.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_prompt_cache_boundary.py).

# Kiến Trúc Agent Engine Thuần Chay (Hermes-Inspired Vanilla Engine) Của BoxFox

> **Trạng thái:** Đặc tả kỹ thuật kiến trúc Agent Core (Lớp L3 trong BoxFox).  
> **Nguồn cảm hứng:** [Hermes Agent (`research_code/hermes-agent-main/agent/`)](https://github.com/NousResearch/hermes-agent) (`conversation_loop.py`, `system_prompt.py`, `tool_executor.py`) & OpenCode (`session/processor.ts`).

---

## 1. Triết Lý Thiết Kế: Thuần Chay (Vanilla Async Python)

Thay vì dựa vào các framework trừu tượng phức tạp (như LangChain hay LangGraph) thường phát sinh lỗi ẩn và làm chậm vòng lặp suy luận, **BoxFox Agent Engine** được xây dựng **100% bằng Python Asyncio thuần túy**:

- **Tối giản & Minh bạch:** Vòng lặp `while iteration < max_iterations:` được kiểm soát trực tiếp, dễ gỡ lỗi (debug) và có độ trễ cực thấp.
- **Không phụ thuộc thư viện cồng kềnh:** Hoạt động ổn định trên môi trường Conda `DL` với các thư viện chuẩn của Python.
- **Event-Driven Hooks:** Phát sinh sự kiện thời gian thực (`on_thought`, `on_tool_start`, `on_tool_end`, `on_finish`) giúp kết nối trực tiếp với giao diện Workspace UI và noVNC Screen.

---

## 2. Mô Hình Ngữ Cảnh 3 Tầng (3-Tier Context Caching)

Cấu trúc prompt được phân tầng chặt chẽ nhằm tối ưu hóa bộ nhớ đệm tiền tố (Prompt Caching) của các mô hình hiện đại (Claude, DeepSeek, Gemini, GPT-4o):

```text
┌─────────────────────────────────────────────────────────────┐
│ TIER 1: STABLE (Bất biến)                                   │
│ • Định danh BoxFox Agent & Nguyên tắc kỹ sư phần mềm         │
│ • Quy chuẩn code & Tiêu chí nghiệm thu                      │
│ • Không thay đổi trong suốt phiên làm việc (100% Cache Hit)  │
├─────────────────────────────────────────────────────────────┤
│ TIER 2: CONTEXT (Môi trường làm việc)                       │
│ • Snapshot thư mục workspace & Danh sách file hiện hữu      │
│ • Hệ điều hành & Chế độ mạng (Air-gapped vs Online)         │
│ • Ranh giới Sandbox & Lease bảo mật (L4 Security Gateway)   │
├─────────────────────────────────────────────────────────────┤
│ TIER 3: VOLATILE (Động & Biến thiên từng vòng lặp)          │
│ • Mục tiêu nhiệm vụ (Active Task Goal)                      │
│ • Danh mục JSON Schemas của 42 công cụ                      │
│ • Lịch sử tương tác (User Prompts, Tool Calls & Results)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Vòng Lặp Suy Luận Đa Bước (Multi-Step Execution Loop)

Quy trình vận hành tự động giải quyết các bài toán phần mềm phức tạp:

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng / Task
    participant Engine as BoxFoxAgent (L3)
    participant Ctx as ContextManager (3-Tier)
    participant Router as Model Router (L3)
    participant Tool as ToolRegistry (L5)
    participant Box as Sandbox / Máy ảo (L6)

    User->>Engine: Giao mục tiêu (user_goal)
    Engine->>Ctx: Lắp ráp 3-tier Prompt
    loop Vòng lặp lặp (iteration < max_iterations)
        Engine->>Router: Gửi messages + Tool Schemas
        Router-->>Engine: Phản hồi (Thought + tool_calls)
        alt Không còn tool call
            Engine->>User: Trả về kết quả hoàn tất (is_success=True)
        else Có tool calls
            loop Từng tool call
                Engine->>Tool: Kiểm tra quyền & Lấy Tool Instance
                Tool->>Box: Thực thi thao tác an toàn (File / Shell / Visual)
                Box-->>Tool: Kết quả thực tế
                Tool-->>Engine: ToolResult (đã qua Smart Truncator)
            end
            Engine->>Engine: Lưu Tool Messages vào Memory
        end
    end
```

---

## 4. Tích Hợp Đầy Đủ Các Nhóm Công Cụ

Agent Engine được kết nối trực tiếp với:
1. **Công cụ Thao tác Mã Nguồn & LSP**: `file_read`, `file_write`, `file_edit_block`, `lsp_diagnostics`, `codebase_grep`, `repo_map_generate`.
2. **Công cụ Terminal & Sub-kernel**: `terminal_exec`, `process_manage`, `execute_code`.
3. **Công cụ Hệ thống & Thị giác**: `computer_screen_capture` (chụp màn hình), `computer_screen_record` (ghi video màn hình).
4. **Công cụ Kiểm thử Giao diện Web**: `browser_verify_ui`, `browser_cdp_eval`.

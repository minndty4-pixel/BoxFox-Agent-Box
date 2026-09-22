# Kiến trúc harness đa agent của BoxFox

> **Trạng thái:** Đề xuất kiến trúc sản phẩm, chưa phải bằng chứng rằng backend harness đã được triển khai. Harness gọi cổng chính sách và cổng sandbox. [Mô hình bảo mật và IFC](security-model.md) là nguồn chuẩn quy phạm cho quyền, nhãn, approval, lease, egress và audit; tài liệu này không thay thế hay diễn giải lại đặc tả đó.
>
> **Nguồn tham khảo đã kiểm:** [Hermes Agent tại commit `69fd61b0efbe2bf7f412714ed8c35e40dfddc534`](https://github.com/NousResearch/hermes-agent/tree/69fd61b0efbe2bf7f412714ed8c35e40dfddc534) là nguồn chính cho tool, skill, prompt và delegation; [OpenCode tại commit `e03db9bc6908f75c9334d8aa997deeaac81c0298`](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298) là nguồn đối chiếu cho session processor, permission, compaction và task session. Snapshot nội bộ tương ứng nằm tại [`code-reference/agent-harness/`](../../code-reference/agent-harness/); xem ghi chép bằng chứng trong [`docs/research/agent-harness/`](../research/agent-harness/). Snapshot chỉ để tham chiếu, không được runtime import hoặc skill-discover.

## 1. Thuật ngữ và phạm vi

- **Agent:** tiến trình dùng mô hình để lập luận và đề nghị hành động; output của nó không phải quyết định bảo mật.
- **Harness (bộ chạy và điều phối agent):** runtime quản lý vòng đời, ngữ cảnh, prompt, tool, ngân sách, kết quả và khôi phục của agent.
- **Session (phiên):** vỏ làm việc bền vững do người dùng mở; chứa nhiều task và dữ liệu audit của chúng.
- **Task (việc):** một mục tiêu do người dùng bắt đầu hoặc điều hướng lại trong session; có `task_epoch` đơn điệu tăng để chính sách liên kết quyền đúng thời điểm.
- **Run (lần chạy):** một lần thực thi có thể tiếp tục của task, có model route, ngân sách và trạng thái riêng.
- **Turn (lượt):** một vòng yêu cầu model → phản hồi/đề nghị tool → kết quả hoặc yêu cầu người dùng. Một turn có thể có nhiều message part nhưng chỉ có một quyết định tiến trạng thái.
- **Artifact (hiện vật):** đối tượng có định danh bất biến, như file, ảnh, output tool, plan, diff hoặc bản tóm tắt; có nhãn và **provenance** (nguồn gốc/dòng dẫn xuất).
- **IFC:** kiểm soát dữ liệu từ nguồn sang đích theo nhãn. Harness chuyển nhãn/provenance; Policy Engine là nơi quyết định cho phép, hỏi hoặc từ chối.
- **Tool (công cụ):** thao tác có schema đầu vào/ra do executor thực hiện, ví dụ đọc file hoặc chạy lệnh; khác với skill.
- **Skill (kỹ năng):** gói hướng dẫn/metadata giúp agent biết *khi nào và cách nào* dùng năng lực; không tự trao quyền hay tự chạy mã.
- **Child session (phiên con):** session do một agent cha tạo để giao việc hẹp cho sub-agent (agent con).
- **Compaction (nén ngữ cảnh):** thay phần lịch sử bằng biểu diễn ngắn hơn để vừa cửa sổ ngữ cảnh, không được làm mất nhãn hay provenance.
- **Event store (kho sự kiện):** nhật ký chỉ thêm có thứ tự là nguồn sự thật cho trạng thái; WebSocket chỉ vận chuyển sự kiện.
- **API (Application Programming Interface):** hợp đồng gọi giữa các thành phần phần mềm.
- **DOM (Document Object Model):** biểu diễn cấu trúc tài liệu/trang web để tool hoặc browser đọc.
- **MVP (Minimum Viable Product):** bản sản phẩm tối thiểu đủ kiểm chứng một luồng giá trị.
- **UI (User Interface):** giao diện người dùng.

Phạm vi là kiến trúc cho sản phẩm nhiều agent. Bản đầu có thể chỉ bật một agent; schema không được giả vờ rằng sub-agent, shell hoặc quyền chi tiết đã tồn tại. Quy tắc quyền, nhãn, lease/approval, egress và declassification thuộc lớp security/IFC, không được sao chép hay nới lỏng bằng prompt.

## 2. Ranh giới và các bất biến

```text
Web/UI ── API session/task ──> Harness control plane
                                  │        │
                                  │        ├─> Policy/approval/IFC boundary
                                  │        ├─> Model Router API
                                  │        ├─> Tool executor ──> sandbox/execution plane
                                  │        └─> Event store + artifact store
                                  │
                           WebSocket/SSE replay (transport only)
```

**Control plane (lớp điều khiển)** giữ session, task, budget, approval, cancellation, event và state. **Execution plane (lớp thực thi)** chạy tool trong sandbox. Cả hai không trao raw credential cho agent. Các bất biến:

1. Chỉ Controller/server chuyển trạng thái, cấp/thu hồi quyền, ghi acceptance của người dùng và tăng epoch; model chỉ đề nghị.
2. Tool được hiển thị cho model là hỗ trợ trải nghiệm; executor luôn kiểm capability, scope, epoch, expiry và chính sách ngay trước khi thực thi. Ẩn tên tool trong prompt không phải enforcement.
3. Nội dung không tin cậy, gồm output tool, skill dự án, web/DOM, ảnh và summary dẫn xuất, vẫn là dữ liệu khi đưa vào prompt; không trở thành system instruction chỉ vì được tóm tắt.
4. Mọi artifact dẫn xuất giữ `derived_from`, nhãn mật/toàn vẹn, hash nội dung và actor; resume, compaction và giao cho agent con không rửa chúng.
5. Router, sandbox, browser/desktop và UI là API boundary. Harness không giả định container desktop hiện tại áp đặt mount-path grant; shell chỉ được mở sau spike chứng minh cơ chế thực thi theo [ADR-0001 — các lựa chọn cô lập shell](decisions/0001-shell-isolation-options.md).

## 3. Mô hình trạng thái session, task, run và turn

### 3.1 Định danh và dữ liệu tối thiểu

```text
Session { session_id, owner_id, created_at, status, parent_session_id?, lineage[] }
Task    { task_id, session_id, task_epoch, goal_artifact_id, state, mode, policy_revision }
Run     { run_id, task_id, attempt, state, route_snapshot_id, budget_id, started_at }
Turn    { turn_id, run_id, ordinal, input_set_id, state, model_request_id?, tool_call_ids[] }
```

`task_epoch` tăng khi Controller nhận `new_task`, reset rõ ràng hoặc điều hướng làm thay mục tiêu/phạm vi theo chính sách; không tăng ngầm chỉ vì một câu trả lời làm rõ. Lệnh API tách `new_task`, `steer`, `answer_question`, `approve`, `cancel` và `resume`, nhờ vậy audit biết chính xác hành động nào đã làm invalid quyền. Approval luôn gắn proposal ID, scope digest, content hash, epoch, actor, hạn dùng và request ID; nhãn `approved` của file UI không có giá trị cấp quyền.

### 3.2 State machine

```text
CREATED → PLANNING → REVIEW ──approved──> RUNNING
                  │    │                    │
                  │    └──rejected──> PAUSED │
                  │                          ├─tool/route approval→ WAITING_PERMISSION
                  │                          ├─user question──────→ WAITING_INPUT
                  │                          ├─recoverable fault──→ RETRYING
                  │                          ├─cancel─────────────→ CANCELLED
                  │                          └─goal met───────────→ COMPLETED
any durable state ──crash/unknown outcome──> RECOVERING → prior safe state | FAILED
```

`REVIEW` là review plan/đề xuất, không tự tạo permission. `WAITING_PERMISSION` chỉ chứa pending request bất biến; reconnect không tạo thêm grant. Nếu process chết giữa dispatch và tool result, run thành `RECOVERING`: executor tra idempotency key hoặc checkpoint/result đã ghi trước khi thử lại. Hành động không chứng minh được đã chạy hay chưa là `UNKNOWN`, không được lặp mù quáng.

Mỗi run ghi ngân sách duy nhất: reserve trước model/tool call, reconcile usage thực, tính cả retry, summary và child session. Budget hết, deadline hoặc cancellation gửi tín hiệu xuống toàn bộ cây run và chờ executor xác nhận dừng.

## 4. Vòng lặp và prompt composition

### 4.1 Vòng lặp có kiểm soát

1. Controller chọn run có thể chạy, lấy snapshot state và context đã được policy cho phép dùng.
2. Prompt compiler dựng request có version, route constraints và danh sách tool *có thể mô tả*.
3. Router trả stream message parts chuẩn hóa: text công khai, tool call, tool result reference, usage, finish/cancel/error. Không yêu cầu hay lưu “chain of thought” riêng tư của provider.
4. Harness parse schema và ghi `model_response_received`; một đề nghị action đi qua Policy Engine.
5. Nếu allow, executor kiểm lần cuối rồi tạo artifact/result; nếu ask, tạo approval card; nếu deny, trả lý do hạn chế cho agent/user.
6. Event và state commit theo outbox cùng transaction trước khi phát ra transport. Turn tiếp theo chỉ bắt đầu sau khi kết quả turn trước rõ ràng.

MVP có thể thực thi tuần tự dù provider trả nhiều tool call. Song song chỉ được bật khi tool declaration có concurrency class, scope không chồng, cancellation và artifact ordering được kiểm chứng.

### 4.2 Ba lớp prompt

Prompt compiler không nối chuỗi tùy tiện. Nó xuất `PromptPart {part_id, kind, trust_class, artifact_refs, token_estimate, content}` theo ba lớp:

| Lớp | Nội dung | Quy tắc |
|---|---|---|
| **Stable (ổn định)** | vai trò sản phẩm, giới hạn bất biến, schema tool, format response, version HarnessSpec | từ mã/cấu hình trusted đã version; không do workspace hay model sửa |
| **Context (ngữ cảnh)** | goal người dùng, history, tool result, file/DOM/ảnh, summary, output child | mang nhãn/provenance; dữ liệu không tin cậy được render như dữ liệu, không lên role system |
| **Volatile (biến động)** | mode, budget còn lại, tool visibility, permission pending, route capability, current task state | server sinh từng turn; thông báo là advisory, executor vẫn enforcement |

Instruction pipeline ghi provenance của từng part: `source_type`, source artifact/hash, loader/version, trust decision, thời điểm và compiler version. Điều này cho phép hỏi “hướng dẫn nào đã ảnh hưởng turn này?” mà không cần tin lời model.

### 4.3 Context window, compaction và provenance

Context store giữ message part có kiểu (`text`, `image`, `tool_call`, `tool_result`, `artifact_ref`, `usage`, `finish`). Bản đầy đủ tool output nằm artifact store; prompt chỉ nhận trích đoạn có offset và hash. Khi nén, compactor tạo artifact mới có:

```text
summary_of: [artifact/version IDs]
derived_from: toàn bộ nguồn thực tế
label: join theo lattice IFC hiện hành
retained_facts: các fact có citation source ID
omitted_ranges: phạm vi đã bỏ
compiler/summarizer route + version
```

Summary được đặt ở phần context dữ liệu, không phải stable/system prompt. Khi restore/resume, harness nạp event snapshot và graph artifact; không chỉ nạp summary text. Nếu graph thiếu, corrupt hoặc nhãn không tính được thì fail closed: yêu cầu người dùng hoặc dựng lại từ event gốc.

## 5. Tool, artifact và skill

### 5.1 Registry và executor

Tool registry là catalog server-side, không phải danh sách function trong prompt:

```text
ToolSpec { tool_id, version, input_schema, output_schema, capability,
           side_effect, execution_target, artifact_contract, timeout,
           idempotency_class, concurrency_class, required_route_capabilities }
ToolCall { call_id, turn_id, tool_id, args_artifact_id, request_hash }
ToolResult { call_id, status, output_artifact_ids, usage, executor_receipt }
```

Registry phân biệt read/write/execute/egress/UI action thay vì gom chúng thành “SAFE”. Executor nhận ToolCall đã định danh, canonicalize input, gọi Policy Engine với context/artifact labels và grant hiện hành, rồi kiểm scope/capability một lần nữa tại điểm dùng. Kết quả stdout/stderr, diff, ảnh, file tạo ra và lỗi đều thành artifact. `run_command` chỉ là một ToolSpec tương lai; nó không được gửi thẳng lệnh vào terminal người dùng.

**Artifact store** giữ payload bất biến hoặc pointer content-addressed, hash, media type, byte/token count, label/provenance, retention, access policy và liên kết event. Workspace là một adapter artifact, không phải source of truth cho quyền hoặc provenance; heuristic nhãn ở API box hiện tại là placeholder như `workspace-files.md` đã nêu.

### 5.2 Progressive skills và chuỗi cung ứng

Hermes minh họa discovery/load theo skill và OpenCode minh họa instruction/session boundaries; BoxFox dùng pattern an toàn hơn theo hai bước:

1. **Catalog trước:** scan thư mục allowlist, chỉ đọc manifest: `skill_id`, namespace, version, description ngắn, hash, size, source/provenance, license, trust status, supported tools. Không nạp toàn bộ body vào mọi prompt.
2. **Load sau:** model yêu cầu skill theo ID; loader kiểm allowlist, integrity hash, version, size/token limit, compatibility và policy rồi đưa nội dung vào `Context`, với provenance nguồn. Nội dung project/third-party mặc định `untrusted` dù có markdown hợp lệ.

Skill dự án qua scan tĩnh, review và trạng thái `quarantined | disabled | enabled`; lỗi parse, vượt cỡ, hash lệch hoặc script nhúng đưa vào quarantine. Script/binary không được import bởi loader: nếu sau này cần chạy, chúng phải là ToolSpec qua executor/sandbox. First-party skill cũng không được tự cấp quyền; trust nói về nguồn phân phối, không thay IFC đối với dữ liệu nó đọc.

## 6. Sub-agent là child session

Sub-agent không phải “một lời gọi model phụ” mà là child session có event stream và context riêng:

```text
Parent task/run
  └─ Delegation { delegation_id, objective, input_artifact_ids, role,
                  max_depth, budget_slice, deadline, cancellation_token }
       └─ Child session/task/run → Result artifact + provenance graph
```

Controller chỉ tạo child sau khi policy cho phép. Quy tắc bắt buộc:

- `lineage` ghi parent session/task/run/delegation, depth và creator; cấm vòng lặp và vượt `max_depth`.
- Quyền hiệu lực của child là giao giữa grant cha, allowlist role và scope đã giao; child không tự nâng quyền, chọn provider cấm hay cấp sub-child vượt budget.
- Context chỉ là artifact tối thiểu cần giao, không copy toàn bộ chat; kết quả mang join nhãn/provenance của input **và** mọi nguồn child thực sự đọc.
- Budget slice, deadline, retry quota và concurrency quota được reserve từ parent; tổng cây không vượt budget parent.
- Cancel/revoke/epoch change lan xuống cây, dừng executor và đánh dấu result dở dang. Parent không dùng kết quả từ child đã bị cancel như kết quả hoàn chỉnh.

Pha đầu nên có role read-only (nghiên cứu, phân tích, test review). Code/build sub-agent chỉ bật sau khi enforcement sandbox, grants, provenance và cancellation tree đạt test tích hợp.

**Trạng thái trong BoxFox (vòng 22, đợt 2).** Cây con của BoxFox là **phẳng một tầng**: mọi con đều cùng cha, nên không có `lineage` sâu. Bảo đảm ấy là **cấu trúc** chứ không phải một tham số: mã không có `max_depth`, vì vai của con không mang `delegate_task` (không có đường nào để một con sinh ra con). Con **không** tự sinh con (`spawn_peer` không có trong phạm vi); con "nhìn thấy nhau" ở mức đọc (`peer_read`), đợi (`await_children`) và nhận giao hàng có định tuyến (`deliverTo` + biên nhận trong bảng `child_deliveries`). Mọi trần — fan-out theo cha, trần toàn cục, ngân sách con 40 bước / 300 s — do phiên chính giữ; hết lượt cha thì `reap_children` đóng mọi con còn sống bằng `PARENT_TURN_ENDED`. Quyết định và số đo: [ADR-0003 — mesh agent con](decisions/0003-peer-mesh-routing.md), `docs/tracking/test-rounds.md` § *Vòng 22 — đợt 2*.

## 7. Event store, reconnect và resume

Event store append-only dùng sequence per session/run và idempotency key. Một transaction ghi state projection, artifact reference, audit record và outbox event; publisher phát sau commit. Ví dụ event: `task_created`, `run_started`, `prompt_compiled`, `route_selected`, `tool_requested`, `approval_requested`, `tool_finished`, `artifact_created`, `run_paused`, `run_completed`.

API reconnect nhận `cursor` gồm session ID + sequence; server trả replay có thứ tự hoặc `snapshot_required` khi cursor hết retention. Client event duplicate phải idempotent theo event ID. WebSocket hoặc **SSE** (Server-Sent Events — luồng sự kiện một chiều từ server) không là nơi giữ pending approval hay run state.

Checkpoint có snapshot version của state projection, artifact graph roots, budget/grants tham chiếu và executor receipt. Resume kiểm policy revision, expiry/revocation và integrity snapshot trước khi chạy; không hồi sinh grant hết hạn. Audit read model có thể xây lại từ event store nhưng phải che dữ liệu nhạy cảm theo quyền viewer.

## 8. API boundary và roadmap

| Boundary | Harness gửi | Harness không được làm |
|---|---|---|
| UI API | command có request ID; state snapshot; event cursor; artifact metadata | tin UI đã phê duyệt chỉ vì state client |
| Policy/IFC | action canonical, context/artifact refs, actor, epoch/grants | tự suy “an toàn” từ prompt hoặc tool name |
| Router | canonical model request, route constraints, data classification, budget/correlation ID | gửi raw provider token hoặc chọn endpoint trực tiếp |
| Executor/sandbox | ToolCall đã kiểm; cancellation; scoped capability | giả định desktop container có path isolation chưa chứng minh |
| Artifact store | payload/ref + provenance/label | dùng path workspace làm bằng chứng trust |

**Lộ trình phụ thuộc:**

1. Schema session/task/run/turn, transactional event store, fake router/tool và resume test.
2. Một agent Plan/Act, registry/executor và route gateway; approval/hash/budget enforcement.
3. Typed context, artifact graph, compaction, progressive skills và supply-chain quarantine.
4. Child session read-only với lineage/budget/cancellation/provenance; sau đó mới cân nhắc role ghi. **Đã có trong BoxFox (vòng 22, đợt 2)**: cây con phẳng một tầng (theo cấu trúc, không phải bằng một tham số `max_depth`), fan-out theo cha có trần, biên nhận giao hàng và watchdog — xem [ADR-0003 — mesh agent con](decisions/0003-peer-mesh-routing.md).
5. Browser/vision và desktop control sau khi giải quyết race revision và quyết định trong [ADR-0002 — điều khiển desktop đồng thời](decisions/0002-concurrent-desktop-control.md).

Mỗi pha phải kiểm cả: không bypass quyền/IFC, task vẫn hoàn thành, và số lần hỏi người dùng. Không có pha nào được suy diễn rằng backend trống hiện tại đã thỏa kiến trúc này.

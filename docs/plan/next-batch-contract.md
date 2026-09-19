# Hợp đồng kỹ thuật — đợt 4 (chốt trước khi song song hoá)

Đây là hợp đồng **đóng băng** giữa bốn luồng công việc của đợt 4. Mọi luồng phải khớp đúng tên, kiểu, giá trị trong tài liệu này. Nếu thấy cần đổi, báo lại thay vì tự đổi một phía.

## 0. Quy tắc chung

1. Không có dữ liệu giả trên đường chạy thật. Không thêm chuỗi tiếng Việt/tiếng Anh cứng trong component — dùng `useT()` với khoá i18n.
2. **Không đổi thiết kế giao diện.** Chỉ nối dữ liệu và hành vi vào các component, lớp CSS, token sẵn có. Không thêm màu, font, bố cục mới. Nếu buộc phải thêm phần tử, dùng đúng lớp CSS của các phần tử anh em.
3. Mọi sự kiện đều đi qua `SessionStore.emit(sid, kind, payload)` (bảng `events`, cột `kind` tự do, không cần migration). Frontend đọc qua `harnessChatStore` (`events[]`, mỗi phần tử `{seq, type, data, created}`).
4. Mọi route ghi của container bắt buộc có header `X-BoxFox-Api-Key` (giá trị `boxfox-local-dev-token` trong dev) — thiếu thì trả 401.
5. Việc gì cần người dùng quyết định thì đi qua **một** đường: tool `ask_user` / `request_approval` → event `decision_requested` → route trả lời → `decision_resolved`.

## 1. Sự kiện harness (`backend/`)

### `decision_requested`

```json
{
  "decisionId": "9f2c…hex16",
  "kind": "question",
  "question": "Chọn cách triển khai?",
  "action": null,
  "reason": null,
  "options": [
    {"id": "approve", "label": "Duyệt", "kind": "approve"},
    {"id": "reject",  "label": "Từ chối", "kind": "reject"}
  ],
  "deadline": 1758300000.0,
  "defaultChoice": "reject",
  "toolCallId": "call_abc"
}
```

- `kind`: `"question"` (từ `ask_user`) hoặc `"approval"` (từ `request_approval`).
- `action`, `reason`: chỉ có khi `kind == "approval"`; ngược lại là `null`.
- `options`: 2–5 mục, mỗi mục `{id, label, kind}` với `kind ∈ {approve, reject, alternative}`. `ask_user` luôn có ít nhất một `approve` và một `reject`.
- `deadline`: epoch giây (float). `ask_user` mặc định 300 s; `request_approval` mặc định 600 s; trần 3600 s.
- `defaultChoice`: luôn `"reject"`.

### `decision_resolved`

```json
{"decisionId": "9f2c…", "choice": "approve", "status": "approved", "note": "ok", "reason": "user", "resolvedAt": 1758300012.5}
```

- `status ∈ {approved, rejected, expired, cancelled}`.
- `reason ∈ {user, timeout, session_cancelled}`.
- `choice`: id lựa chọn; khi hết hạn/cancel thì bằng `defaultChoice`.
- Đúng một `decision_resolved` cho mỗi `decisionId` (kể cả đường hết hạn và đường huỷ phiên).

### `plan_written`

```json
{"identity": "workspace-plan", "version": 2, "slug": "workspace-plan",
 "relativePath": ".plans/v2-workspace-plan.md", "title": "Workspace plan", "bytes": 4312}
```

- `identity`: **đúng giá trị mà `GET /__box/plans` dùng để nhóm plan** — slug trần khi file nằm ở gốc `.plans/`, hoặc `dir/slug` khi file nằm trong thư mục con (xem `plan_files.py:315-321`). TUYỆT ĐỐI KHÔNG kèm tiền tố `vN-`; số version nằm ở trường `version`. UI chọn đúng bản mới bằng cặp `(identity, version)`.
- `version`: số nguyên của version vừa ghi.
- `relativePath`: đường dẫn tương đối so với `WORKSPACE_ROOT`, dạng `.plans/v2-<slug>.md`.

### `ui_intent`

```json
{"tab": "plan", "target": {"identity": "workspace-plan", "version": 2}, "reason": "plan_written"}
```

- `tab ∈ {plan, decisions, files, subagents}`.
- `target`: `{identity, version}` cho `plan`, `{requestId}` cho `decisions`, `{path}` cho `files`, `{sessionId}` cho `subagents`; có thể là `null`.
- `reason ∈ {plan_written, decision_requested, file_selected, child_started}`.
- Gợi ý cho UI, **không** phải mệnh lệnh: UI tự quyết định có mở hay không theo luật ở §3.

### Trạng thái phiên

- Trong lúc chờ trả lời, `sessions.status = 'awaiting_decision'` (giá trị mới, nằm cạnh `running|completed|failed|cancelled|interrupted`).
- Khi có trả lời, quay lại `running`; hết hạn thì lượt chạy tiếp tục với kết quả `rejected` (agent phải nói rõ là bị từ chối).

## 2. Route và endpoint

### Harness (`backend/src/agentbox/api/server.py`)

`POST /api/agent/sessions/{sid}/decisions`

- Thân: `{"decisionId": "...", "choice": "approve", "note": "..."}` (`note` tuỳ chọn).
- 200: `{"status": "resolved", "decisionId": "...", "choice": "approve", "outcome": "approved"}`.
- 404: `{"error": "DECISION_NOT_FOUND: ..."}` khi `decisionId` không nằm trong phiên này.
- 409: `{"error": "DECISION_ALREADY_RESOLVED: ..."}`.
- 400: `{"error": "DECISION_INVALID: ..."}` khi thiếu trường hoặc `choice` không nằm trong `options`.

### Container (`deploy/docker/ide-proxy.py` + `workspace_files.py`)

Tất cả đều `POST`, JSON, cần `X-BoxFox-Api-Key`, trả 400 `{"error": "..."}` khi sai.

| Route | Thân | Trả về |
|---|---|---|
| `/__box/files/mkdir` | `{"path": "src/new"}` | `{"path": "src/new", "type": "directory"}` |
| `/__box/files/touch` | `{"path": "src/new.md", "content": ""}` | `{"path": "src/new.md", "type": "file", "size": 0}` |
| `/__box/files/rename` | `{"path": "src/a.md", "name": "b.md"}` | `{"path": "src/a.md", "newPath": "src/b.md"}` |
| `/__box/files/move` | `{"path": "src/a.md", "destination": "docs"}` | `{"path": "src/a.md", "newPath": "docs/a.md"}` |
| `/__box/files/delete` | `{"path": "src/a.md"}` | `{"path": "src/a.md", "trashPath": ".trash/1758300012-a.md"}` |
| `/__box/plans/review` | `{"identity": "v1-pilot", "decision": "approved", "note": ""}` | `{"identity": "v1-pilot", "decision": "approved", "note": "", "updatedAt": 1758300012.5}` |

Luật chung cho các API ghi:

- `path` là đường dẫn **tương đối** trong `/home/agent/workspace`; dùng lại đúng hàm kiểm tra đường dẫn hiện có (`workspace_files.py:153-171`). Từ chối: tuyệt đối, `..`, ký tự NUL, ổ đĩa giả, vượt quá `MAX_DEPTH`.
- `rename` chỉ đổi tên trong cùng thư mục: `name` không chứa `/`, không rỗng, không phải `.`/`..`.
- Ghi đè: `touch` trả 409 nếu đích đã tồn tại; `rename`/`move` trả 409 nếu đích đã tồn tại; `mkdir` trả 409 nếu đã có (trừ khi thân có `"exist_ok": true`).
- `delete` **không xoá thẳng**: chuyển vào `.trash/` trong workspace, tên `<epoch>-<tên gốc>`; `.trash` bị loại khỏi danh sách `GET /__box/files`.
- `delete` từ chối xoá chính `.trash` và các mục bảo vệ (`.plans`).
- `review`: `decision ∈ {approved, changes_requested}`; lưu `{"identity","decision","note","updatedAt"}` vào `/home/agent/workspace/.plans/.reviews/<identity>.json`; `GET /__box/plans` trả thêm `"review"` cho mỗi bản ghi (hoặc `null`).

## 3. Luật tự mở tab (frontend)

`useUiStore` là nơi duy nhất quyết định. API mới:

```ts
requestTabIntent: (intent: { tab: PanelTabId; target?: Record<string, unknown> | null; reason: string }) => 'opened' | 'queued'
```

Thứ tự kiểm tra (dừng ở điều kiện đầu tiên vi phạm → `'queued'`):

1. `autoOpenTabs === false` → `queued`.
2. `pinnedTab === intent.tab` → `queued`. (`pinnedTab` đặt khi người dùng **tự bấm** vào tab trên thanh tab; xoá khi người dùng bấm tab khác hoặc đóng tab đó.)
3. `autoOpenOnlyWhenIdle === true` và `Date.now() - lastUserActivityAt < 15000` → `queued`. (`lastUserActivityAt` cập nhật khi có `keydown` trong khung soạn tin hoặc `scroll` trong khung chat — đặt ở `ChatPanel`, chỉ ghi vào store, không đổi giao diện.)

Khi `queued`: thêm vào `pendingIntents[]` (giữ tối đa 20, mới nhất ở cuối), tab đích hiện huy hiệu đếm. Khi người dùng mở tab đó thì xoá các intent thuộc tab đó.

`openTab(tab)` giữ nguyên hành vi (mở + kích hoạt) để không phá các chỗ gọi hiện có.

## 4. Điểm nối frontend ↔ backend

- `harnessChatStore` nhận sự kiện mới trong `refresh()` (đã có sẵn `events[]`); khi thấy `ui_intent` **mới** thì gọi `useUiStore.getState().requestTabIntent(...)`; khi thấy `decision_requested` **mới** thì phát một intent `decisions` kèm `{requestId}`.
- Trả lời decision: `harnessChatStore.answerDecision(chatId, decisionId, choice, note?)` → `agentApi(`/sessions/${id}/decisions`, {...})`; thành công thì cập nhật ngay chỗ chứa decision trong store, không cần chờ vòng poll.
- Hợp đồng repository workspace (thêm vào `WorkspaceRepository`): `mkdir(path)`, `touch(path)`, `rename(path, name)`, `move(path, destination)`, `deleteEntry(path)` — cùng kiểu trả về như bảng §2; bản mock phải cài đủ để test chạy được.
- `usePlanFiles` phải nghe `planRevision` (số nguyên trong `uiStore`) và tải lại khi số này đổi.

# Kế hoạch vòng 22 — bằng chứng sống trong câu trả lời cuối (evidence gate)

> Trạng thái: **bản để chủ nhà duyệt**. Chưa dòng mã nào được viết cho tới khi duyệt.
> Nguồn: **D-8** (`docs/tracking/owner-decisions.md`), **phần D** (`docs/plan/v21-boxfox-plan.md`),
> **§6.22** (`docs/tracking/bug-register.md`), **§ Vòng 21** (`docs/tracking/test-rounds.md`).
> Nền thi công: `vorflux/v21-boxfox-plan` (HEAD `e9ce91d`), gốc `main` @ `b737dca` — chủ nhà chọn nhánh khi duyệt.

Mục tiêu: mỗi câu trả lời cuối mang **bằng chứng sống** của việc lượt đó đã thật sự làm — nhất là khi đổi mã
hoặc đổi UI/UX. "Sống" nghĩa là bằng chứng sinh ra từ **việc đã chạy thật** (tool call, lệnh, tệp đã đổi,
ảnh/ghi hình đã chụp), máy đọc được, mở lại được, và không phải lời model tự khen.

---

## 0. Hôm nay: đo được, không suy đoán

| Sự thật | Bằng chứng trong mã / đo sống | Nghĩa là gì |
|---|---|---|
| Không có cổng nào kiểm câu trả lời cuối | `backend/src/agentbox/agent_core/runtime.py:1696-1697` — điều kiện duy nhất là "có chữ, không rỗng" | model nói "đã sửa xong" là câu trả lời đi thẳng ra ngoài |
| Câu trả lời được phát nguyên văn, không kèm trường nào | `runtime.py:1713` `emit(sid, 'assistant', {'text', 'thought', 'final'})` | UI/API không có gì để đọc ngoài văn |
| Nhãn `done` luôn xanh, không điều kiện | `frontend/src/components/chat/HarnessStepView.tsx:1534-1537` | lượt chỉ đọc tài liệu đội nhãn y hệt lượt sửa 40 tệp |
| Nhật ký `E:` (evidence) chưa từng được ghi | bảng `journal` trong `~/BoxFox/harness/sessions.sqlite`: **10 phiên, 1 hàng duy nhất, kind `plan`** (đo 2026-09-22) | vocabulary đã đủ (`backend/src/agentbox/agent_core/journal.py:38-50` dấu, `:54-63` status) nhưng chưa ai dùng |
| UI ném khối `journal` mà API đã trả | `backend/src/agentbox/api/server.py:285-293` trả `journal`; `frontend/src/store/harnessChatStore.ts:285-338` chỉ đọc `session.events` — `grep -rn "journal" frontend/src` (trừ test) = **0** | không có bề mặt nào để hiện bằng chứng |
| Tool trong box trả về chuỗi rỗng nghĩa | `backend/src/agentbox/sandbox/worker.py:345-357`: `file_write` → `'Written <rel>'`, `file_edit_block` → `'Updated <rel>'` | không diff, không hash, không số dòng — muốn trích bằng chứng cũng không có gì để trích |
| Workspace box **không phải** git repo | `docker exec agentbox-box git -C /home/agent/workspace status` → `fatal: not a git repository` (cả `boxfox/`, `inventory-demo/`) | "diff" phải tự sinh; không mượn được `git diff` |
| Box **không có egress** (chỉ loopback) | `iptables -L OUTPUT -n` → `policy DROP`; curl từ box tới `172.18.0.1:3100` = `000` | bằng chứng phải do **harness kéo về**, không thể box đẩy sang |
| Eval S4 ("khẳng định không có bằng chứng") đang `not_measured` | `scripts/eval/rushed_index.py:188-195`, ghim bởi `backend/tests/unit/test_eval_setup.py:280-289` | không đo được tỉ lệ khẳng định suông *vì* câu trả lời không mang dấu vết máy đọc được — cổng này sinh ra dấu vết đó |

---

## 1. Bốn câu chốt (không mở lại)

**1. Cổng đọc VIỆC ĐÃ LÀM, không đọc lời tự khen.** Hàng `tool_end` (`runtime.py:1769`) mang `name`, `args`,
`result` — đo sống trên phiên `0ef73471c38d4c63a593755345213dcf`:
`{"name":"codebase_glob","args":{"pattern":"**/probe-upload.txt"},"result":{"content":""}}`.
Cổng chỉ tin bốn nguồn: (a) tool nào đã chạy thật và `is_error`/`ok` ra sao; (b) lệnh nào đã chạy;
(c) tệp nào đã đổi (phép dò box, §3.2); (d) tệp hình/ghi hình nào đã sinh. Câu chữ trong câu trả lời chỉ
dùng để **đối chiếu**, không bao giờ dùng làm bằng chứng.

**2. Không viết lại câu trả lời của model.** Bằng chứng đi **kèm**, không chèn vào văn: trường `evidence`
trong event `assistant` (`runtime.py:1713`), hàng `E:` trong nhật ký, nhãn + danh sách trong UI. Lý do:
"bằng chứng sống" phải là thứ máy kiểm được chứ không phải thứ máy viết hộ; và người đọc ngoài UI
(`curl`, `scripts/eval`) đọc event chứ không đọc văn. Chỉ **một** ca viết lại: câu trả lời vượt trần độ dài
(D-4, 150 000 ký tự) — cắt và trỏ tệp, có notice riêng (§3.6).

**3. Mặc định `warn`; lượt tốt không bao giờ bị chặn.** Công tắc `BOXFOX_EVIDENCE_GATE = off|warn|enforce`,
mặc định **`warn`** (khoá từ chủ nhà). Ở `warn`: chỉ ghim nhãn + ghi log — **không** gọi thêm model,
**không** đổi văn, **không** đổi `status` phiên. Ở `enforce`: thêm **đúng một** vòng vá (§3.4) và vẫn
không bao giờ làm hỏng lượt; cùng lắm câu trả lời bị ghim nhãn "chưa kiểm chứng".

**4. Không thêm `status` mới.** `E:` (`kind='evidence'`) chỉ có `status='info'` (`journal.py:54-63`);
`X:` (`kind='blocker'`) có `blocked/failed/resolved/done`. Cổng dùng đúng hai marker này; phiên vẫn kết
thúc `completed`/`partial` như trước.

**Đã chốt ở D-8** (chủ nhà, 2026-09-22): khi nào nâng mặc định lên `enforce` — con số và người bật
nằm ở §6, không còn là câu hỏi mở.

---

## 2. Cái gì tính là bằng chứng

### 2.1 Bảng quyết định

| Loại việc trong lượt | Dấu hiệu (từ tool call đã chạy thật) | Bằng chứng tối thiểu | Nguồn bằng chứng |
|---|---|---|---|
| Chỉ đọc / khảo sát | mọi tool ∈ nhóm đọc, không lệnh ghi | **không cần** (nói rõ "chỉ đọc" là đủ) | — |
| Ghi tệp | `file_write` / `file_edit_block` với `ok=true` | đường dẫn + diff (hoặc hash + số dòng) | `worker.py` sinh tại chỗ (§3.1, P1.4) |
| Lệnh có ghi trong terminal | `terminal_exec` khớp `WRITE_CMD_RE` (`>`, `>>`, `tee`, `sed -i`, `patch`, `cp`, `mv`, `rm`, `mkdir`, `chmod`, `npm|pnpm|yarn install|build`, `pip install`, `make`, `docker`) | lệnh + exit code + trích đầu ra | `tool_end.result` + tệp `.generated_artifacts/tools/<uuid>.txt` |
| Chạy test / build | `terminal_exec` khớp `VERIFY_CMD_RE` (`pytest`, `vitest`, `jest`, `npm test`, `tsc`, `eslint`, `ruff`, `mypy`, `go test`, `cargo test`) | lệnh + exit code + số test pass/fail | như trên |
| Đổi UI/UX | tool ∈ `UI_TOOLS` (`computer_use`, `browser_use`, `inspect_element`, `computer_screen_capture`, `computer_screen_record`) **hoặc** ghi tệp dưới `frontend/` | ảnh/ghi hình chụp **sau** thay đổi (+ ảnh **trước** nếu lượt có chụp) | `/__box/capture` → `captures/screen/<sid8>/…` |
| Viết plan | `write_plan` | đã có cổng riêng (`plan_quality.py`) — cổng này không phạt lại | — |
| Không xác định | `terminal_exec` không khớp cả hai regex (ví dụ `python3 x.py`, `node deploy.js`) | coi như **có thể ghi** ⇒ chạy phép dò box để biết chắc | phép dò box (§3.2) |

### 2.2 Hằng số đóng băng

Nằm **một chỗ duy nhất** trong `backend/src/agentbox/agent_core/evidence_gate.py` (thuần, không I/O —
cùng khuôn `plan_quality.py`), để không mọc bản sao thứ hai:

- `WRITE_TOOLS`, `UI_TOOLS`, `READ_TOOLS`, `PLAN_TOOLS`
- `WRITE_CMD_RE`, `VERIFY_CMD_RE`, `READ_CMD_RE`
- `EVIDENCE_ROOT_REL = '.generated_artifacts/captures/evidence'` (nằm trong gốc captures ⇒ **được dọn
  tự động** bởi `retention()`, xem P1.5)
- `EVIDENCE_KIND = 'evidence'`, `EVIDENCE_ARTIFACT_RE` (`.diff`, `.patch`, `.txt`, `.log`, `.md`, `.json`, `.png`, `.mp4`)
- `VERDICTS = ('sufficient', 'insufficient', 'not_measurable')`
- `REASONS` (mã lý do máy đọc được): `no_change`, `change_without_verification`, `claim_path_not_in_turn`,
  `claim_path_missing`, `ui_change_without_capture`, `answer_references_unknown_command`,
  `no_evidence_for_tools`, `box_unreachable`, `gate_error`, `box_probe_failed`, `answer_too_long`

### 2.3 Năm luật phán

- **R1** — lượt có đổi (write tool, lệnh ghi, hoặc phép dò thấy tệp đổi) mà **không** có mảnh bằng chứng nào
  thuộc loại tương ứng ⇒ `insufficient`, lý do `change_without_verification` / `ui_change_without_capture`.
- **R2** — lượt chỉ đọc (không write tool, không lệnh ghi, phép dò không thấy tệp đổi) ⇒ `sufficient`.
- **R3** — câu trả lời nêu đường dẫn hoặc lệnh **không** xuất hiện trong việc đã làm của chính lượt **và**
  không tồn tại trong box ⇒ `insufficient` với `claim_path_not_in_turn` / `claim_path_missing`
  (đây là luật bắt "bịa"; nó chạy **độc lập** với R1).
- **R4** — câu trả lời dài quá trần D-4 ⇒ nhánh riêng (§3.6), phán `insufficient` với
  `answer_too_long` nếu vẫn quá dài sau vòng vá.
- **R5** — thiếu dữ liệu (box chết, phép dò lỗi, công tắc `off`, cổng tự hỏng) ⇒ `not_measurable` + ghim lý do,
  **không bao giờ** hạ xuống `insufficient`. Thà nói "chưa đo được" còn hơn phạt oan.

### 2.4 Bằng chứng cho thay đổi UI/UX nói riêng

Một mảnh bằng chứng UI/UX chỉ được tính khi có **ảnh hoặc ghi hình chụp sau thay đổi**, kèm tối thiểu ba
trường lấy từ chính tool call đã chạy (không lấy từ câu chữ của model):

| Trường | Lấy từ | Ví dụ |
|---|---|---|
| Ảnh/ghi hình (bắt buộc) | `computer_screen_capture` / `browser_use action=screenshot` → `result.artifact`, `result.image`; `computer_screen_record action=stop` → `result.path` | `.generated_artifacts/captures/screen/<sid8>/<sid8>_<step>_….png` |
| Đích đã xem | `args` của `browser_use` (`url`/`selector`) hoặc `inspect_element` (`x`,`y`) | `http://localhost:3100/#/chat`, `[data-timeline="child"]` |
| Khung nhìn | `result.dimensions` của ảnh, `desktopWarning/desktopRestored` (`executor.py:37-56`) | `1280x800`, cảnh báo desktop bị kéo nhỏ |
| Mốc thời gian | `seq`/`created` của hàng `tool_end`, cộng `turn`/`step` | `seq 1100`, turn 3, step 2 |

Nếu lượt **có** cả ảnh trước và ảnh sau ⇒ danh sách phải xếp cạnh nhau theo thứ tự thời gian (đây là
"trước/sau" mà chủ nhà hỏi). Nếu lượt đổi UI mà chỉ có ảnh **trước** ⇒ vẫn `insufficient`
(`ui_change_without_capture`), vì ảnh trước không chứng minh được kết quả.

### 2.5 Ca đường vòng (thay đổi không đi qua write tool)

Đây là nhóm dễ lọt nhất, nên luật phải rộng hơn "có gọi `file_write` không":

- `terminal_exec` với chuyển hướng (`>`, `>>`), `tee`, `sed -i`, `patch`, `python3 - <<EOF`, `mv`, `cp`, `rm`,
  `chmod`, `mkdir -p`, `truncate` ⇒ **tính là ghi** (khớp `WRITE_CMD_RE`).
- Lệnh build/install (`npm run build`, `pip install`, `make`) ⇒ tính là ghi (sinh tệp trong `dist/`,
  `node_modules/`, `build/`) **và** tính là kiểm chứng ⇒ cần thêm exit code + trích đầu ra.
- Lệnh **không** khớp cả hai regex (`python3 script.py`, `node x.js`, `./deploy.sh`) ⇒ `needs_probe = true`:
  chạy phép dò box rồi mới phán; phép dò thấy tệp đổi ⇒ xử như có ghi (R1), không thấy ⇒ như lượt chỉ đọc.
- Ghi tệp **thất bại** (`is_error = true`, hoặc lệnh exit code ≠ 0 mà không tạo tệp) ⇒ **không** tính là đổi,
  nhưng nếu câu trả lời nói "đã sửa" thì R3 bắt được (`claim_path_not_in_turn`).

---

## 3. Luồng một lượt sau khi có cổng

```
user ──► _run(sid)  [runtime.py:1422]
          │  turn = _turn_index(sid)                    ← P1.1
          ├─ vòng lặp tool: mỗi tool_end ⇒ turn_calls.append(...)   [runtime.py:1769]
          │      (đồng thời worker trả diff/hash + ghi tệp bằng chứng) ← P1.4
          ├─ model trả câu trả lời cuối (runtime.py:1696-1713)
          │
          ├─ CỔNG (chèn giữa 1697 và 1727):
          │    1. profile = classify_turn(turn_calls)              ← P2.1
          │    2. nếu profile.cần_chắc_chắn: probe = dò box (1 docker exec)  ← P3.2 / P1.4
          │    3. verdict = assess(text, profile, probe, artifacts) ← P2.2
          │    4. verdict == insufficient và mode == enforce ⇒ MỘT vòng vá  ← P3.3
          │       (chỉ khi còn ngân sách; hết thì bỏ vá, ghim nhãn)
          │    5. emit assistant {text, thought, final, evidence:{...}}      ← P3.1
          │    6. ghim E: (hoặc X: nếu cổng tự hỏng) vào nhật ký           ← P3.4
          │    7. turn_end + log turn.end mang số của cổng                 ← P3.4
          └─ close_turn / finish / save  (giữ nguyên như cũ)
UI: nhãn ba trạng thái + danh sách bằng chứng mở được   ← P4
Eval: S4 đọc số mới ⇒ rời `not_measured`               ← P5
```

### 3.1 Chứng cứ sinh ngay tại gốc (trong box)

Chỗ rẻ nhất và thật nhất để sinh diff/hash là **chính tool đã sửa tệp**, không phải suy lại từ sau.
`backend/src/agentbox/sandbox/worker.py` được harness **gửi vào box nguyên văn ở mỗi lần gọi**
(`executor.py:13` đọc `worker.py` thành chuỗi; `executor.py:104-107` chạy `python3 -c WORKER`) ⇒ sửa
`worker.py` **không cần dựng lại image**.

- `file_write` (`worker.py:345-348`) và `file_edit_block` (`worker.py:351-357`) sau khi ghi thành công sẽ:
  đọc nội dung **trước** (đã có trong tay ở nhánh edit; nhánh write đọc trước khi ghi nếu tệp tồn tại),
  đọc nội dung **sau**, sinh `difflib.unified_diff`, tính `sha256` trước/sau và số dòng, rồi trả về
  `{'content': …, 'diff': <diff ≤ 8 000 ký tự>, 'artifact': <đường dẫn tệp bằng chứng>, 'numbers': {...}}`.
- Tệp bằng chứng ghi vào `.generated_artifacts/captures/evidence/<sid8>/<sid8>_<step>_<slug>.<ext>` —
  đúng khuôn BOX-3 (`deploy/docker/capture.py:181`), nằm trong gốc captures nên **được `retention()` quét
  và dọn** (P1.5). `sid8`/`step` do harness gửi kèm payload (P1.4), **không** lấy từ tham số model.
- Kết quả này đi vào `tool_end` như cũ, nên `artifactPathOf()` (`HarnessStepView.tsx:305`) đọc được ngay
  và không cần đường ống mới.

### 3.2 Phép dò box (chỉ khi cần chắc)

Một `docker exec` duy nhất, **chỉ chạy khi** lượt có write tool, có lệnh khớp `WRITE_CMD_RE`, **hoặc** có
lệnh không xác định (bảng §2.1). Lệnh cố định do harness soạn, chỉ nội suy `sid8` (hex) cho **tên tệp kết
quả** và epoch của lượt (container dùng chung đồng hồ với host, nên epoch host dùng thẳng được):

```sh
cd /home/agent/workspace && find . -type f -newermt "@<epoch_lượt>" \
  -not -path './.generated_artifacts/*' -not -path './.session-history/*' \
  -printf '%T@ %s %p\n' | sort -n | tail -200
```

GNU find 4.9.0 + `sha256sum` + `stat` đã có trong box (đo 2026-09-22). Kết quả được ghi lại thành tệp
`.generated_artifacts/captures/evidence/<sid8>/<sid8>_<step>_changes.<ext>` để người đọc mở được, và trả về
harness dưới dạng danh sách `changedFiles` ([{path, bytes, mtime, sha256?}]). Trần: 200 tệp, 20 s, đầu ra
≤ 20 000 ký tự; lỗi/timeout ⇒ `probe = None` ⇒ R5 (`not_measurable`), **không** phải `insufficient`.

### 3.3 Chấm điểm

`assess(answer_text, profile, probe, artifacts)` trả về:

```json
{"verdict": "sufficient|insufficient|not_measurable",
 "checked": 3, "missing": [{"reason": "ui_change_without_capture", "detail": "frontend/src/..."}],
 "artifacts": [{"kind": "diff", "path": ".generated_artifacts/.../…diff", "step": 2, "sha256": "…"}],
 "changedFiles": [{"path": "boxfox/src/app.js", "bytes": 8123, "mtime": 1758…}],
 "claims": [{"text": "đã sửa app.js", "path": "boxfox/src/app.js", "backed": true}]}
```

`verdict` là nguồn duy nhất cho nhãn UI; `missing[].reason` là thứ hiện cho người đọc bằng tiếng người.

### 3.4 Vòng vá — tối đa MỘT lần, có trần thời gian

Chỉ ở `enforce`, chỉ khi `verdict == insufficient`, và **chỉ khi còn ngân sách**: guard bằng chính
`asyncio.timeout` của lượt (`runtime.py:1472`, `self.run_budget[sid]` ở `:1473`):

- `remaining = budget.remaining()`; bỏ vá nếu `remaining < EVIDENCE_REPAIR_MIN_REMAINING_SECONDS (20 s)`.
- Vòng vá: đúng **một** `self.client.complete(...)`, **không** kèm schema tool, `max_tokens` cứng
  `EVIDENCE_REPAIR_MAX_TOKENS (2048)`, bọc `asyncio.timeout(min(EVIDENCE_REPAIR_TIMEOUT_SECONDS (60),
  remaining - 10))`. Bất kỳ lỗi/timeout ⇒ giữ nguyên văn cũ, ghim nhãn. Khuôn gọi và cách chịu lỗi
  bám theo tiền lệ đã có ở `runtime.py:1660-1671` (gọi model lần hai, không đổi luồng tool).
- Prompt vá nói thẳng: "liệt kê bằng chứng cụ thể (đường dẫn + lệnh + kết quả) cho việc đã làm, hoặc nói rõ
  chưa kiểm chứng được vì sao" — chính là mốc C2/C3 của rubric (`scripts/eval/rubric.py:39-52`).
- Sau vá: chấm **lại một lần**; vẫn `insufficient` ⇒ phát văn **của lần vá** nhưng ghim nhãn thật
  (không giả vờ). Lượt vẫn `completed`.

### 3.5 Ghim nhật ký

- Có bằng chứng ⇒ một hàng `E:` mỗi lượt: `text` ≤ 1 000 ký tự (`JOURNAL_TEXT_MAX_CHARS`,
  `journal.py:72`) là một dòng tóm tắt; phần thật nằm trong `data` (`verdict`, `checked`, `missing`,
  `changedFiles[].path`, `probe`) và — chỗ **đúng thiết kế** cho con trỏ kiểm chứng — trong `evidence`:
  danh sách dict theo enum đã có của `tool_contracts.py` (`file`, `command`, `url`, `image`) với `path`,
  `line`, `quote`, `url`, `note`. `refs` **chỉ** để nối sang bản ghi khác (`P:`, `D:`, `T:`) — tuyệt đối
  **không** nhét đường dẫn tệp vào `refs`: `journal._check_ids` (`journal.py:289-300`) từ chối mọi thứ
  không phải mã bản ghi.
- Cổng tự hỏng ⇒ một hàng `X:` `status='failed'` với `data.code='EVIDENCE_GATE_FAILED'` (chỉ khi hỏng thật,
  không ghim cho từng lượt thiếu bằng chứng — tránh biến nhật ký thành bảng than phiền).
- `E:`/`X:` mang `turn` và `step` ⇒ UI gom đúng lượt (§P4.1); `brief()` (`session_journal.py:151`) vì thế
  cũng kể được với lượt sau rằng "lượt trước đã sửa tệp nào" mà không cần đọc lại transcript.

### 3.6 Câu trả lời quá dài (D-4)

`ANSWER_WARN_CHARS = 60_000` ⇒ notice `ANSWER_LONG` (không đổi văn). `ANSWER_MAX_CHARS = 150_000` ⇒ ghi
toàn văn vào `.generated_artifacts/captures/evidence/<sid8>/<sid8>_<step>_answer.md`, phát bản cắt tới trần
+ notice `ANSWER_TRUNCATED` **nêu đường dẫn tệp**; ở `enforce` được phép dùng chính vòng vá (§3.4) để xin
bản ngắn hơn. Đây là ca **duy nhất** harness viết lại văn của model.

### 3.7 Hỏng thì sao (khuôn `session_journal._safe`)

Toàn bộ thân cổng nằm trong một `try/except Exception` cấp cao nhất, theo đúng luật "lỗi ghi không bao giờ
giết một lượt" (`session_journal.py:34-54`). Lỗi bất kỳ ⇒ ghim notice `EVIDENCE_GATE_FAILED`, ghim một hàng
`X:` (nếu chỗ ghim còn sống), ghi `turn.end` với `evidenceVerdict='not_measurable'`, rồi phát **nguyên văn
cũ**. Không có đường nào để cổng biến một lượt thành `failed`: nó là thứ *thêm vào*, không phải thứ *chặn
đường*. `JournalError` cũng nằm trong cùng lưới đó (chính docstring của nó đã yêu cầu: "người gọi trong một
lượt chạy phải bắt và hạ xuống `notice`, không được để nó giết lượt", `journal.py:115-120`).

### 3.8 Đường đi của một tệp bằng chứng (box → người đọc)

```
tool trong box ghi tệp  →  .generated_artifacts/captures/<kind>/<sid8>/<sid8>_<step>_<slug>.<ext>
        │                             (ảnh/ghi hình: capture.py:181 · diff/change-set/answer: P1.4, P3.2, P3.6)
        ├─► tool trả `result.artifact` (+ `result.image` base64 cho ảnh)  →  hàng `tool_end`  →  event `assistant`
        ├─► harness ghim một hàng `E:` (turn, step, refs = đường dẫn)      →  bảng `journal` → API → UI
        └─► người đọc mở tệp: ảnh/ghi hình qua `/__box/file/media?path=…` (`deploy/docker/ide-proxy.py:495`,
            chỉ chạy trên loopback, không cần khoá) và `boxMediaUrl()` (`HarnessStepView.tsx:296`) cắt tiền tố
            `/home/agent/workspace/`; tệp chữ (`.diff`, `.txt`, `.log`, `.md`) mở trong tab Files qua
            `showTab('files', {path})` (P4.3).
```

Ba ràng buộc đã đo, phải tôn trọng khi thi công:

1. **Box không có egress** (`iptables -L OUTPUT -n` → `policy DROP`), nên không có đường box→harness/UI. Mọi
   thứ đi theo chiều harness **kéo về** (`docker exec`, `/__box/...`). Đừng thiết kế bước "box tự đẩy".
2. **Workspace không phải git repo** (cả `boxfox/`, `inventory-demo/`) ⇒ "diff" phải sinh bằng
   `difflib`/`sha256` tại chỗ (P1.4); `artifact_paths()` (`runtime.py:1227-1263`) hôm nay chỉ đi tìm tệp
   `.diff/.patch` do **không nhánh nào sinh ra** — vòng này sinh ra chúng thật.
3. **Nhà sản xuất bằng chứng đang có** (dùng lại, không viết mới): đầu ra lệnh > 20 000 ký tự →
   `.generated_artifacts/tools/<uuid>.txt` (`sandbox/worker.py:109-116`); ảnh trình duyệt →
   `.generated_artifacts/browser/<uuid>.png` (`worker.py:202`); ảnh/ghi hình màn hình →
   `.generated_artifacts/captures/<kind>/<sid8>/…` (`capture.py:181`), trong đó ghi hình nằm ở
   `captures/records/` và giữ 40 tệp mp4/phiên (`deploy/docker/session_files.py:88-93`).

---

## 4. Việc phải làm

Ký hiệu: **[parallel]** = làm được cùng lúc; **[after X]** = phải xong X trước. Mỗi việc ghi rõ: mục tiêu ·
tệp & dòng · việc cụ thể · rủi ro · nghiệm thu.

### Phần P1 — Nền: danh tính LƯỢT, đường ống nhật ký, hằng số

**P1.1 [parallel] — Danh tính lượt** · `backend/src/agentbox/agent_core/runtime.py` (`_run` `:1422`,
`close_turn` `:1436-1454`, log `turn.start` `:1455-1462`, log `turn.end` `:1724-1727` và `:1789`)
· việc: thêm `_turn_index(sid)` = `COUNT(*)` hàng `kind='user'` trong bảng `events` cho sid (**không** dùng
`store.events()` — hàm đó cắt 500 hàng, `memory/session_store.py:136-139`); gắn `turn` vào payload
`turn_start`/`turn_end`, và truyền `turn_id=<turn>` vào `system_log.write` cho `turn.start`, `turn.end`,
`tool.end` (khoá `turnId` **đã** có trong schema log, `observability/system_log.py:16`, `:310` — hôm nay
chưa ai truyền).
· rủi ro: lệch số nếu lượt chèn message hệ thống ⇒ đếm bằng SQL trên bảng chứ không đếm trong bộ nhớ.
· nghiệm thu: `cd backend && python3 -m pytest tests/unit/test_harness_runtime.py -q` (thêm ca ba lượt liên
tiếp cho `turn` = 1, 2, 3; và `grep '"turnId"' ~/BoxFox/logs/harness.jsonl | tail -3`).

**P1.2 [parallel] — Nhật ký mang `turn`/`step`** · `backend/src/agentbox/agent_core/session_journal.py`
(`insert_row` `:62-88`, `append` `:90-121`, `record_view` `:160-196`), `runtime.py` (`journal_records` `:1860`)
· việc: nhận `turn`/`step` và chuyển thẳng vào `journal.record` (**đã** validate `int ≥ 0` từ trước,
`journal.py:249-251` — không thêm gì mới); `record_view` trả thêm `turn`, `step` (hai trường này đang thiếu) bên cạnh `refs`/`evidence` mà nó **đã** trả, để route
`GET /api/agent/sessions/{sid}/journal` (`api/server.py:329-339`) trả đủ cho UI.
· rủi ro: hàng cũ thiếu khoá ⇒ `record_view` phải trả `None` chứ không nổ.
· nghiệm thu: `cd backend && python3 -m pytest tests/unit/test_journal_routes.py tests/unit/test_journal_pins.py -q`.

**P1.3 [parallel] — Hằng số & công tắc** · `backend/src/agentbox/agent_core/limits.py`
· việc: `EVIDENCE_GATE_ENV='BOXFOX_EVIDENCE_GATE'`, `EVIDENCE_MODES=('off','warn','enforce')`,
`EVIDENCE_DEFAULT_MODE='warn'`, `EVIDENCE_REPAIR_MAX_TOKENS=2048`, `EVIDENCE_REPAIR_TIMEOUT_SECONDS=60`,
`EVIDENCE_REPAIR_MIN_REMAINING_SECONDS=20`, `EVIDENCE_PROBE_TIMEOUT_SECONDS=20`,
`EVIDENCE_PROBE_MAX_FILES=200`, `EVIDENCE_MAX_ARTIFACTS=20`, `EVIDENCE_EXCERPT_CHARS=500`,
`ANSWER_WARN_CHARS=60_000`, `ANSWER_MAX_CHARS=150_000`, mã notice `EVIDENCE_INSUFFICIENT`,
`EVIDENCE_GATE_FAILED`, `ANSWER_LONG`, `ANSWER_TRUNCATED`.
**Không** thêm mã vào `failures.KNOWN_PREFIXES`: cổng không bao giờ `raise` (lý do: `KNOWN_PREFIXES` là danh
sách mã *làm hỏng lượt*; cổng không được phép làm hỏng lượt).
· nghiệm thu: `cd backend && python3 -m pytest tests/unit -q -k "limits or runtime_info"`.

**P1.4 [parallel] — Bằng chứng tại gốc** · `backend/src/agentbox/sandbox/worker.py` (`file_write`
`:345-348`, `file_edit_block` `:351-357`, `execute` `:316`, mở rộng `write_text` `:217-224`),
`backend/src/agentbox/sandbox/executor.py` (`_execute` `:60-108`, payload `:105`)
· việc: harness gửi kèm `turn`/`step` trong payload (khoá do harness đặt, **không** lấy từ `args` của model);
worker sinh `difflib.unified_diff` + `sha256` trước/sau + số dòng và ghi tệp bằng chứng theo BOX-3 vào
`.generated_artifacts/captures/evidence/<sid8>/`; trả `diff` (≤ 8 000 ký tự), `artifact`, `numbers` trong
kết quả tool. Đồng thời `executor._execute` gửi thêm `'step'`/`'toolCallId'` cho `/__box/capture` và
`/__box/record/start` — route **đã** nhận hai khoá này (`deploy/docker/ide-proxy.py:284-285`, `:296-297`)
nhưng hôm nay harness không gửi, nên ảnh chụp không mang số bước.
· rủi ro: (a) tệp lớn ⇒ chỉ diff khi tệp ≤ 256 KiB, quá thì chỉ ghi `sha256` + số dòng; (b) đường dẫn có ký
tự lạ ⇒ truyền qua payload JSON (không nội suy vào shell), giữ nguyên luật "không nội suy văn của model vào
shell của host" (`executor.py:103`).
· nghiệm thu: `cd backend && python3 -m pytest tests/unit -q -k "sandbox or worker"`; đo sống:
`docker exec agentbox-box ls -R /home/agent/workspace/.generated_artifacts/captures/evidence | head`.

**P1.5 [after P1.4] — Dọn rác cho thư mục bằng chứng** · `backend/src/agentbox/agent_core/session_journal.py`
· việc: thêm `prune_captures(executor, store, sid)` gọi op `captures_prune` qua đúng khuôn `_safe`
(`:34-54`); `runtime.py` gọi nó mỗi `EVIDENCE_PRUNE_EVERY = 20` lượt của phiên. Không cần dựng lại image:
`retention()` + `_capture_entries` **đã** có trong box (`deploy/docker/session_files.py:837-987`,
bản trong container xác nhận 2026-09-22) và **quét theo `(kind, sid8)` không lọc phần mở rộng** ⇒ thư mục
`evidence/` nằm gọn dưới trần 200 tệp/loại/phiên + 512 MiB/phiên + 4 GiB/box.
· rủi ro: box thiếu `session_ops.py` ⇒ op trả `SESSION_OPS_UNAVAILABLE`; `_safe` biến nó thành notice và
lượt đi tiếp (đã có tiền lệ `worker.py:421-436`).
· nghiệm thu: `cd backend && python3 -m pytest tests/unit -q -k "prune or retention"`.

### Phần P2 — Bộ phân loại thuần: `evidence_gate.py`

**P2.1 [parallel] — Hồ sơ lượt** · tệp mới `backend/src/agentbox/agent_core/evidence_gate.py`
· việc: `classify_turn(calls) -> TurnProfile` với `TurnProfile` gồm `writes[path]`, `changes_commands[cmd]`,
`verify_commands[cmd]`, `ui_tools[]`, `ui_paths[]`, `read_only: bool`, `uncertain: bool`, `needs_probe: bool`,
`kind: 'none'|'code'|'ui'|'plan'|'mixed'`. Bảng hằng số ở §2.2 sống **chỉ** ở đây; docstring theo khuôn
"Why this module exists / Contract" như `plan_quality.py`; `__all__` đầy đủ.
· rủi ro: hai bản sao luật "tool nào là ghi" (eval S3 đang có bản riêng, `rushed_index.py:27-30`)
  ⇒ xử ở P5.1 bằng cách import.
· nghiệm thu: `cd backend && python3 -m pytest tests/unit/test_evidence_gate.py -q`.

**P2.2 [after P2.1] — Phán** · cùng tệp · việc: `assess(answer_text, profile, probe, artifacts) -> dict`
(§3.3) theo đúng R1–R5, kèm `claim_paths(text)` (đường dẫn trong câu trả lời, tái dùng regex kiểu
`plan_quality._INLINE_CODE_RE`/`_COMMAND_TOKEN_RE`) và `missing_reason` bằng tiếng người.
Hàm phải **thuần**: không `httpx`, không `subprocess`, không đọc tệp — mọi dữ liệu vào qua tham số.
· nghiệm thu: `cd backend && python3 -m pytest tests/unit/test_evidence_gate.py -q -k assess`.

**P2.3 [after P2.2] — Khối bằng chứng cho prompt vá** · cùng tệp · việc: `repair_message(verdict, profile,
probe)` trả một message `user` duy nhất (tiếng Việt, ≤ 1 200 ký tự) liệt kê việc đã làm và mảnh bằng chứng
còn thiếu — không nhắc lại toàn bộ transcript.
· nghiệm thu: ca unit khẳng định không lộ nội dung tệp/diff vào prompt (chỉ tên tệp + số).

### Phần P3 — Cổng trong lượt

**P3.1 [after P1.1, P1.3, P2.1, P2.2] — Chèn cổng** · `runtime.py` (`_run` `:1422-1727`)
· việc: thu `turn_calls` tại chỗ phát `tool_end` (`:1769`); chèn khối cổng **giữa `:1697` và `:1713`**:
phân loại → (nếu cần) phép dò → `assess` → (nếu `enforce`) vòng vá → phát `assistant` với
`evidence: {verdict, checked, missing, artifacts, changedFiles, turn, mode}`. `text` giữ nguyên trừ ca §3.6.
· rủi ro: chèn vào đường nóng nhất của lượt ⇒ khối cổng **không** được `await` thứ gì ngoài hai thứ đã giới
hạn (một phép dò, tối đa một lượt model khi `enforce`).
· nghiệm thu: `cd backend && python3 -m pytest tests/unit/test_evidence_gate_runtime.py -q`.

**P3.2 [after P3.1] — Phép dò box** · `runtime.py` + `backend/src/agentbox/sandbox/worker.py`
· việc: harness soạn **một** lệnh cố định (§3.2) chạy qua `terminal_exec` (đường đã có, `worker.py:95-117`),
trần 20 s / 200 tệp; kết quả đổ thành tệp bằng chứng và trả `changedFiles`. Lỗi ⇒ `probe=None` (R5).
· rủi ro: `find -newermt` quét cả tệp do **chính harness** ghi trong lượt ⇒ phải loại trừ `.generated_artifacts/`
và `.session-history/` (đã có trong lệnh ở §3.2), nếu không phép dò sẽ tự báo "có đổi" mỗi lượt.
· nghiệm thu: `docker exec agentbox-box sh -lc 'find /home/agent/workspace -maxdepth 1 -newermt "@$(date +%s --date="-5 min")" | head'` và ca unit với executor giả.

**P3.3 [after P3.1] — Vòng vá có trần** · `runtime.py`
· việc: đúng §3.4 — guard `budget.remaining()`, một lần gọi, `max_tokens` 2048, `asyncio.timeout` lồng,
mọi lỗi nuốt và giữ văn cũ.
· rủi ro lớn nhất của cả kế hoạch: vòng vá ăn vào `asyncio.timeout(deadlineSeconds)` của lượt
(`:1472`) ⇒ nếu để nó chạm trần, lượt biến thành `DEADLINE` **không có câu trả lời nào** — ngược hẳn mục
tiêu. Vì thế: ngưỡng bỏ vá 20 s + trần lồng `min(60, còn lại − 10)` là **bắt buộc**, không phải tuỳ chọn.
· nghiệm thu: ba ca unit — còn nhiều ngân sách (vá chạy), còn ít (bỏ vá, vẫn có câu trả lời), vá timeout
(vẫn có câu trả lời).

**P3.4 [after P3.1] — Ghim nhật ký + số vào log** · `runtime.py` (`pin_plan` `:2445`, `pin_decision` `:2463`
làm mẫu), `session_journal.py` (`insert_row` `:62`)
· việc: §3.5 — một hàng `E:`/lượt (`turn`, `step`, `evidence[]`, `data`, `status='info'`; KHÔNG nhét đường
dẫn vào `refs`), hàng `X:` chỉ khi cổng
tự hỏng; `system_log.write('turn.end', …, turn_id=turn, data={answerChars, evidenceVerdict, evidenceChecked,
evidenceMissing, evidenceRepair, changedFiles, artifacts, gateMode})` tại `:1724-1727` và `:1789`.
· rủi ro: log chỉ ghi **số và mã**, tuyệt đối không ghi đường dẫn/nội dung (luật §4.5 của
`docs/plan/dev-system-log-plan.md`) ⇒ `changedFiles` là **số đếm**, không phải danh sách.
· nghiệm thu: `cd backend && python3 -m pytest tests/unit/test_journal_pins.py tests/unit/test_evidence_gate_runtime.py -q`;
đo sống: `grep '"event":"turn.end"' ~/BoxFox/logs/harness.jsonl | tail -1`.

**P3.5 [after P3.1] — Công tắc + mặt đọc** · `runtime.py`, `api/server.py` (`runtime_info` `:169-194`)
· việc: `evidence_mode()` đọc env mỗi lượt (khuôn `context_window_locked`, `runtime.py:634-646`); từ chối
giá trị lạ bằng cách rơi về `warn` **kèm notice** (không im lặng); thêm nhóm `gate` vào `runtime-info`
(`{'evidenceMode': 'warn'}`) để UI/DEV thấy đúng số engine đang dùng.
· nghiệm thu: `curl -s -H 'X-BoxFox-Admin: 1' http://127.0.0.1:3102/api/agent/runtime-info | python3 -m json.tool | grep -A2 gate`.

**P3.6 [after P3.1] — Trần độ dài (D-4)** · `runtime.py` · việc: §3.6.
· nghiệm thu: hai ca unit (60 000 ⇒ notice `ANSWER_LONG`, văn không đổi; 150 000 ⇒ `ANSWER_TRUNCATED` +
tệp toàn văn tồn tại thật + đường dẫn nằm trong notice).

### Phần P4 — Giao diện: nhãn ba trạng thái + danh sách bằng chứng

> Ghi chú thiết kế: P4.2–P4.3 đổi hình khối của **câu trả lời cuối** (nhãn + khối "Bằng chứng"), không chỉ
> đổi nhãn chữ. Một việc thiết kế song song đang dựng mockup cho đúng mặt này (thư mục `docs/design/v22/`,
> mặt "evidence" — nhãn ba trạng thái + danh sách bằng chứng trước/sau); khi mockup xong thì đính kèm ảnh
> Design-tab vào lượt duyệt và bám theo nó lúc thi công, thay vì tự vẽ lại.

**P4.1 [parallel] — Store đọc `session.journal`** · `frontend/src/store/harnessChatStore.ts`
(`refresh` `:285-338`, `HarnessSession` `:13`)
· việc: nhận `session.journal` (API **đã** trả, `api/server.py:285-293`), giữ trong state
(`journal: {records, lastSeq, degraded}`), suy ra `evidenceByTurn: Record<number, JournalRow>` từ các hàng
`kind==='evidence'` (khoá `turn`), không nuốt `degraded` (hiện cảnh báo mờ khi `true`).
· rủi ro: hợp nhất nhiều lần `refresh` ⇒ gộp theo `seq` như đang làm với `events` (`:294`).
· nghiệm thu: `cd frontend && npx vitest run src/store/harnessChatStore.journal.test.ts`.

**P4.2 [parallel] — Nhãn ba trạng thái** · `frontend/src/components/chat/HarnessStepView.tsx`
(`FinalAnswerBlock` `:1496`, nhãn cứng `:1534-1537`, `HarnessTurn` `:63`)
· việc: thay khối `CheckCircle2` + "done" cứng bằng nhãn ba trạng thái đọc từ
`finalAssistant.data.evidence.verdict`: `verified` (xanh, "đã kiểm chứng"), `unverified` (vàng,
"chưa kiểm chứng"), `not_measurable` (xám, "chưa đo được"). **Thiếu trường `evidence` ⇒ mặc định
`unverified`**, không bao giờ mặc định `verified` (phiên cũ, lượt trước vòng này). Kèm `data-evidence-badge`
và tooltip nêu `missing[].reason` đã dịch.
· rủi ro: đổi nhãn làm lệch ảnh chụp/khẳng định cũ trong `docs/tracking/test-rounds.md` ⇒ ghi rõ ở P6.2.
· nghiệm thu: `cd frontend && npx vitest run src/components/chat/HarnessStepView.evidence.test.tsx`.

**P4.3 [parallel] — Danh sách bằng chứng mở được** · cùng tệp (`activityReceipt` `:134-146`,
`boxMediaUrl` `:296`, `artifactPathOf` `:305`, `extractToolMedia` `:323-380`, lưới media `:1177`)
+ `frontend/src/store/uiStore.ts` (`showTab` `:174`)
· việc: `collectTurnArtifacts(turn)` gom (a) media đã có qua `extractToolMedia`, (b) tệp bằng chứng mới
(`result.artifact` đuôi `.diff/.patch/.txt/.log/.md/.json`) và (c) `artifacts[]` từ hàng `E:`; render trong
khối câu trả lời (mở sẵn mục "Bằng chứng", `data-evidence-artifacts="true"`, mỗi mục `data-artifact-path`).
Bấm: ảnh/ghi hình ⇒ lightbox như cũ; tệp ⇒ `useUiStore.getState().showTab('files', { path })` — đúng đường
`tabIntentTargets.files` mà `useWorkspaceFiles.ts:291-330` đã đọc, và là **thao tác người dùng** nên không bị
công tắc `autoOpenTabs` chặn (khác `requestTabIntent`).
· rủi ro: đường dẫn bằng chứng nằm dưới `.generated_artifacts/` — phải kiểm panel Files có mở được thư mục
ẩn; nếu không, hiển thị đường dẫn dạng chữ + nút "copy path" (cùng lắm vẫn đọc được bằng mắt).
· nghiệm thu: `cd frontend && npx vitest run src/components/chat/HarnessStepView.evidence.test.tsx`.

**P4.4 [parallel] — Dòng receipt + i18n** · `HarnessStepView.tsx` (`ActivityCounts` `:110`,
`activityReceipt` `:134-146`, `counts` `:938-950`), `frontend/src/i18n/{vi,en}.ts`
· việc: thêm hai số `evidence`, `unverified` vào receipt ("… · 3 bằng chứng · 1 chưa kiểm chứng"), giữ
nguyên các số cũ (test cũ ở `HarnessStepView.test.tsx:573-586` không được vỡ); nhãn qua `t(...)`.
· nghiệm thu: `cd frontend && npx vitest run src/components/chat/HarnessStepView.test.tsx`.

**P4.5 [after P4.2, P4.3] — Test UI một mạch** · tệp mới
`frontend/src/components/chat/HarnessStepView.evidence.test.tsx` (khuôn `HarnessStepView.chips.test.tsx`:
`createRoot` + `act`, `I18nProvider`, factory `ev(type, data, created)`, `render(events, onOpenTab)`)
· việc: bốn ca — (1) lượt có `evidence.verdict='sufficient'` ⇒ nhãn xanh + 2 mục trong danh sách;
(2) `insufficient` + `missing` ⇒ nhãn vàng + tooltip lý do; (3) lượt **không** có trường `evidence` ⇒ nhãn
vàng (không xanh); (4) bấm mục tệp ⇒ `showTab('files', {path})` được gọi đúng tham số.
· nghiệm thu: `cd frontend && npx vitest run && npx tsc -b --noEmit`.

### Phần P5 — Eval: kéo S4 khỏi `not_measured`

**P5.1 [after P3.4] — S4 đọc số mới** · `scripts/eval/rushed_index.py` (`s4_unsupported_claims` `:188-195`,
`WRITE_TOOLS` `:27-30`)
· việc: khi dòng `turn.end` có `data.evidenceMissing`/`data.evidenceVerdict` ⇒ S4 trả `status='measured'`,
`value` = (số lượt có `evidenceMissing > 0`) / (số lượt đã đo), `unit='turn'`, `threshold` giữ nguyên
(`> 20 %` cảnh báo), `flagged` = danh sách lượt kèm `verdict`; khi log **không** có khoá mới ⇒ giữ nguyên
`not_measured` + lý do cũ (luật trung thực #1 của chính file: không có bằng chứng trong log thì nói thẳng).
`note` phải nêu luôn **mốc nâng `enforce` đã chốt ở §6** (≥ 20 phiên có số **và** tỉ lệ báo động sai < 10 %),
để người đọc bảng S4 thấy ngưỡng ngay tại chỗ; `evaluatedTurns`/`sessions` đã có sẵn trong báo cáo nên không
phải thêm bộ đếm mới.
Đồng thời bỏ bản sao `WRITE_TOOLS` bằng cách import từ `agentbox.agent_core.evidence_gate` khi import được
(`scripts/eval` đã có tiền lệ `sys.path.insert` để nạp module cùng thư mục), giữ danh sách dự phòng nếu
không import được.
· nghiệm thu: `cd /code/minndty3-design/BoxFox-Agent-Box && python3 scripts/eval/rushed_index.py --help` và
`python3 -m pytest backend/tests/unit/test_eval_setup.py -q`; đo sống (in ra đúng ba con số của §6 — số phiên,
trạng thái S4, số lượt bị gắn cờ):
```sh
python3 scripts/eval/rushed_index.py --json \
| python3 -c "import json,sys; d=json.load(sys.stdin)['report']; s=[x for x in d['signals'] if x['code']=='S4'][0]; \
print('sessions=%s turns=%s S4=%s value=%s flagged=%s' % (d['sessions'], d['evaluatedTurns'], s['status'], s['value'], s['count']))"
```

**P5.2 [after P5.1] — Cập nhật ghim** · `backend/tests/unit/test_eval_setup.py:280-289`
· việc: `test_signals_that_cannot_be_measured_say_so` phải phản ánh sự thật mới: log **cũ** (không có khoá
mới) ⇒ `{'S1','S4','S5'}` vẫn đúng, thêm ca log **có** khoá mới ⇒ S4 `measured` với `value` đúng và không
còn mặt trong `unmeasured`; thêm ca log nửa vời (vài lượt có, vài lượt không) ⇒ S4 vẫn `measured` nhưng
`note` nói rõ số lượt đo được.
· nghiệm thu: `cd backend && python3 -m pytest tests/unit/test_eval_setup.py -q`.

**P5.3 [parallel] — Tài liệu eval** · `scripts/eval/README.md:102-105` · việc: đổi mô tả S4 từ
"cần đọc câu chữ trong câu trả lời" sang "đọc số của cổng bằng chứng trong `turn.end`", kèm mã lý do.
· nghiệm thu: đọc lại và `python3 scripts/eval/rushed_index.py` chạy trên log hiện có, không vỡ.

### Phần P6 — Ghi sổ

**P6.1 [parallel] — Bug register** · `docs/tracking/bug-register.md` (§6.22 ở dòng 949; mã tiếp theo sau
BUG-43 theo RULE-20: chữ in hoa, không đệm số 0, đếm tiếp)
· việc: ghim **BUG-44** — "câu trả lời cuối luôn đội nhãn `done` xanh, không có bất kỳ kiểm chứng nào; UI
còn ném luôn khối `journal` của API" với bằng chứng đã đo: `HarnessStepView.tsx:1534-1537`,
`harnessChatStore.ts:285-338` (grep `journal` = 0), `runtime.py:1696-1697`, bảng `journal` 1 hàng kind `plan`,
và `worker.py:345-357` (tool sửa tệp trả chuỗi rỗng nghĩa) — tức *không chỉ thiếu cổng mà còn thiếu cả nguyên
liệu*. Nếu khi thi công phát hiện thêm lỗi thật (ví dụ ảnh chụp không mang số bước vì harness không gửi
`step` dù route đã nhận — `executor.py:65-79` ⇔ `ide-proxy.py:284-285`) thì ghim tiếp **BUG-45**, không gộp.
· nghiệm thu: `grep -n "BUG-44" docs/tracking/bug-register.md`.

**P6.2 [parallel] — Nhật ký vòng** · `docs/tracking/test-rounds.md` (nối tiếp § Vòng 21 ở dòng 1008; nếu
vòng 21 đã đóng thì mở § Vòng 22)
· việc: ghi phần A–F của vòng này: mục tiêu, việc đã làm, bằng chứng (ảnh/log/phiên), mô hình kiểm, và
**các khẳng định cũ bị đổi** (nhãn `done` ở ảnh chụp vòng 21 sẽ khác sau vòng này — phải nói rõ để không
thành "hồi quy giả").
· nghiệm thu: mục vòng mới có ít nhất một ảnh trong `/code/.generated_artifacts/images/` cho mỗi khẳng định
giao diện.

**P6.3 [parallel] — Sổ quyết định** · `docs/tracking/owner-decisions.md`
· việc: D-8 chuyển sang "đã thi công vòng 22"; ghi **nguyên văn quyết định đã chốt** (mặc định `warn`;
nâng `enforce` khi ≥ **20 phiên** có số trong `~/BoxFox/logs/harness.jsonl` **và** tỉ lệ báo động sai **< 10 %**;
**DEV/người bảo trì** đổi mặc định, chủ nhà không phải làm gì) kèm ngày chốt 2026-09-22 — theo đúng luật của
chính tệp: quyết định đổi thì **không xoá dòng cũ**, thêm dòng mới xuống phần *Lịch sử sửa đổi*.
· nghiệm thu: đọc lại thấy khớp với mã (`runtime-info` ⇒ `gate.evidenceMode`).

---

## 5. Kiểm thử

| Tệp | Loại | Ghim điều gì |
|---|---|---|
| `backend/tests/unit/test_evidence_gate.py` | unit, thuần | Bảng §2.1 và R1–R5: lượt chỉ đọc ⇒ `sufficient`; `file_write` ⇒ thiếu bằng chứng; `terminal_exec` có `>`/`sed -i` ⇒ tính là ghi; lệnh không xác định ⇒ `needs_probe`; write tool `is_error` ⇒ **không** tính là đổi; câu trả lời nêu đường dẫn không có trong lượt và không tồn tại ⇒ `claim_path_not_in_turn`; thiếu dữ liệu ⇒ `not_measurable` (không bao giờ `insufficient`) |
| `backend/tests/unit/test_evidence_probe.py` | unit, executor giả | Lệnh dò đúng chuỗi cố định (không nội suy văn model); parse `changedFiles`; timeout ⇒ `probe=None`; > 200 tệp ⇒ cắt |
| `backend/tests/unit/test_evidence_gate_runtime.py` | tích hợp runtime (`FixtureModel` + `FixtureExecutor` như `test_plan_quality.py`) | Lượt sửa mã + lệnh kiểm ⇒ event `assistant` mang `evidence.verdict='sufficient'` **và** có hàng `E:` đúng `turn`/`step`; lượt nói suông ⇒ `insufficient` + văn **không đổi** + phiên vẫn `completed`; `mode=off` ⇒ không có khoá `evidence`; cổng ném lỗi ⇒ có notice + câu trả lời vẫn ra; hết ngân sách ⇒ **không** gọi vòng vá |
| `backend/tests/unit/test_evidence_answer_length.py` | unit + runtime | 60 000 ⇒ notice `ANSWER_LONG`, văn nguyên vẹn; 150 000 ⇒ tệp toàn văn tồn tại thật (đường dẫn trong notice mở được) |
| `backend/tests/unit/test_journal_routes.py` (mở rộng) | unit | `turn`/`step`/`refs` đi hết đường ghim → row → `record_view` → route; hàng cũ thiếu khoá ⇒ `None`, không nổ |
| `frontend/src/store/harnessChatStore.journal.test.ts` | unit | `session.journal` không bị ném; `evidenceByTurn` đúng khoá; `degraded: true` giữ nguyên và hiện cảnh báo |
| `frontend/src/components/chat/HarnessStepView.evidence.test.tsx` | unit DOM | Bốn ca ở P4.5 |
| `backend/tests/unit/test_eval_setup.py` (mở rộng) | unit | S4 `measured` khi log có khoá mới; `not_measured` khi log cũ; ca nửa vời |

Nghiệm thu sống cuối vòng (đúng khuôn mục "Bằng chứng của vòng" trong `docs/tracking/test-rounds.md`):
gửi một yêu cầu **đổi UI thật** (ví dụ đổi nhãn một nút trong `frontend/src/…`), rồi chứng minh bằng
(a) ảnh chụp màn hình trước/sau trong `/code/.generated_artifacts/images/`, (b) `curl` phiên trả
`assistant.data.evidence.verdict='sufficient'` cùng `artifacts[]` trỏ tệp có thật trên đĩa,
(c) `grep '"event":"turn.end"' ~/BoxFox/logs/harness.jsonl | tail -1` có đủ số của cổng,
(d) ảnh chụp UI cho thấy nhãn "đã kiểm chứng" và danh sách bằng chứng mở được,
(e) lệnh đo ở P5.1 in ra `sessions=` / `S4=measured` / `flagged=` — đây là đồng hồ đếm về mốc nâng `enforce`
đã chốt ở §6, mỗi vòng sau chỉ cần chạy lại một lệnh.

## 6. Ngưỡng nâng lên `enforce` — ĐÃ CHỐT (D-8)

Chủ nhà đã chốt ngày 2026-09-22; đây không còn là câu hỏi mở:

> Bật `enforce` khi **20 phiên** đã có số trong `~/BoxFox/logs/harness.jsonl` **và** tỉ lệ báo động sai của
> cổng (đo ở chế độ `warn`) **< 10 %**; **DEV (người bảo trì) đổi mặc định**, chủ nhà không phải làm gì.

Chi tiết để thi công không phải đoán:

| Hạng mục | Giá trị chốt |
|---|---|
| Số mẫu | `sessions >= 20` trong báo cáo S4 — đếm **phiên**, không đếm lượt |
| "Có số" nghĩa là | S4 trả `status='measured'` (không còn `not_measured`), tức dòng `turn.end` đã có `data.evidenceMissing` |
| Tỉ lệ báo động sai | (số lượt bị S4 gắn cờ mà **soi lại thấy có bằng chứng thật**, DEV đối chiếu hàng `E:`/`artifacts`) / (tổng số lượt bị gắn cờ) — phải **< 10 %** |
| Ai bật | DEV/người bảo trì sửa `EVIDENCE_DEFAULT_MODE` sang `enforce` trong `limits.py` (env vẫn đè được), cùng lúc ghi `docs/tracking/owner-decisions.md` D-8; kiểm lại bằng `curl -s -H 'X-BoxFox-Admin: 1' http://127.0.0.1:3102/api/agent/runtime-info` ⇒ `gate.evidenceMode='enforce'` |
| Chưa đủ điều kiện thì sao | giữ `warn`, chạy tiếp, không đổi gì — cổng vẫn ghim nhãn và đếm |

Hai con số cho quyết định lấy từ **một** lệnh, không đọc tay:

```sh
cd /code/minndty3-design/BoxFox-Agent-Box && python3 scripts/eval/rushed_index.py --json \
| python3 -c "import json,sys; d=json.load(sys.stdin)['report']; s=[x for x in d['signals'] if x['code']=='S4'][0]; \
print('sessions=%s turns=%s S4=%s value=%s unit=%s flagged=%s' % (d['sessions'], d['evaluatedTurns'], s['status'], s['value'], s['unit'], s['count']))"
```

- `sessions` là số mẫu (đích ≥ 20); `S4=measured` nghĩa là "đã có số"; `flagged` là số lượt DEV phải soi lại để
  tính tỉ lệ báo động sai. Chạy hôm nay (2026-09-22, trước khi thi công) ra `sessions=8 turns=10 S4=not_measured`
  — tức đồng hồ đang ở 8/20 phiên và S4 chưa có số, đúng như §0.
- Chừng nào `S4=not_measured` thì **chưa** đủ điều kiện, dù `sessions` đã vượt 20.
- Đây cũng là lý do P5.1 phải ghi mốc nâng vào `note` của tín hiệu: người đọc bảng S4 thấy luôn ngưỡng, không
  phải mở tài liệu.

**Lịch sử** (để vòng sau không mở lại): hai phương án đã cân và bị bỏ — (a) mẫu nhỏ "10 lượt liên tiếp, DEV tự
xét"; (b) "chủ nhà tự bật bằng env `BOXFOX_EVIDENCE_GATE=enforce` bất cứ lúc nào". Cả hai đều thay một con số đo
được bằng cảm nhận.

## 7. Rủi ro & cách chặn

| Rủi ro | Chặn |
|---|---|
| Vòng vá ăn hết `deadlineSeconds` ⇒ lượt chết vì `DEADLINE`, không có câu trả lời | Guard `budget.remaining()`, trần lồng `min(60, còn lại − 10)`, bỏ vá khi `remaining < 20 s` (P3.3) — **bắt buộc**, có test riêng |
| Báo động sai ở `warn` làm nhiễu | `warn` không gọi model, không đổi văn; nhãn mặc định là `unverified` chứ không phải "sai" |
| Cổng thành nguồn sự thật thứ hai, lệch với sổ nhật ký | `E:` là bản ghi **duy nhất**; UI đọc từ `E:`/event, không tự suy lại |
| Đường dẫn giả trong câu trả lời (bịa) | R3 + phép dò box; đây là luật bắt lỗi mà hôm nay không có gì bắt |
| Tệp bằng chứng phình đĩa | Nằm dưới gốc captures ⇒ 4 trần của `retention()` phủ sẵn; prune định kỳ (P1.5); trần 200 tệp/loại/phiên |
| Diff khổng lồ nhét vào prompt/UI | Trần 256 KiB mỗi tệp, diff ≤ 8 000 ký tự, `EVIDENCE_MAX_ARTIFACTS = 20` |
| Nhật ký đầy than phiền (`X:` mỗi lượt) | `X:` **chỉ** khi cổng tự hỏng (P3.4), không phải khi thiếu bằng chứng |
| Đổi nhãn `done` ⇒ ảnh chụp cũ thành "hồi quy giả" | P6.2 ghi rõ danh sách khẳng định cũ bị đổi |

## 8. Điều kiện dừng an toàn

`BOXFOX_EVIDENCE_GATE=off` là công tắc duy nhất cần để tắt toàn bộ cổng (không gọi model, không dò box,
không ghim nhật ký, không thêm khoá vào event). `off` **không** đụng tới phần P1.4 (diff/hash tại tool) và
P4 (UI đọc `journal`) — hai phần đó là cải thiện độc lập, có giá trị kể cả khi cổng tắt, và vẫn chạy đúng
như trước vòng này nếu `journal` rỗng (mọi nhãn khi đó là `unverified`, không phải `verified`).

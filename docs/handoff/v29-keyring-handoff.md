# Handoff 2 — Vòng 29: router key ring (một connection nhiều khoá → tự chuyển khi hết hạn mức)

> **Đọc mục 4 (Bảng tiến độ) trước**, rồi làm tiếp việc chưa xong theo đúng thứ tự ở mục 3.
> Tài liệu này tự chứa: nó nói vòng này đang làm gì, đã xong tới đâu, chạm vào tệp nào, tên route nào, và lệnh nào để kiểm. Nó không thay thế các kế hoạch chi tiết ở mục 9 — chúng nằm trong repo để người tiếp nhận không phụ thuộc thư mục ngoài repo.

Người chủ: Nam Nam. Ngôn ngữ tài liệu: tiếng Việt, thuật ngữ kỹ thuật giữ tiếng Anh. Ngày mở vòng: 2026-09-24.

---

## 1. Bài toán và kết quả mong muốn

**Triệu chứng chủ nhà báo:** trong màn nhập API key, ba khoá OpenCode Free đang là ba connection riêng, nên danh sách model hiện "opencode key1 model A, opencode key2 model A" — cùng một model lặp một lần cho mỗi khoá. Khi khoá đang dùng chạm hạn mức, lượt chết; đó là lý do chính sáu lượt research thật chết ở phút thứ 8–14.

**Kết quả mong muốn:** một connection giữ **một danh sách khoá**. Khoá trên cùng phục vụ trước. Nhà cung cấp trả **429** cho khoá đang dùng thì router tự chuyển sang khoá kế trong **cùng** connection; khoá vừa cháy nghỉ **30 giây** rồi tự quay lại vòng. Phiên chat chọn model theo **nhà cung cấp + model**, nên một model chỉ còn **một dòng**, và router tự thử các khoá còn hạn mức.

**Vòng này KHÔNG chạy lượt research thật** (chủ nhà chốt 6045): chỉ unit test trên mã. Vì vậy vòng này **không** chứng minh một lượt research thật giờ chạy xong, và bộ đo `R1–R12` vẫn chưa có số thật.

---

## 2. Quyết định đã chốt (không mở lại)

| # | Việc | Quyết định |
|---|---|---|
| 6041 | Cơ chế khoá ở đâu | **Một connection giữ nhiều khoá**; chỉ xoay trong cùng một nhà cung cấp |
| 6042 | Khi nào chuyển khoá | Chỉ khi **429 / hết hạn mức** |
| 6043 | Nghỉ bao lâu | Ngắn — "căng là 1 phút, hoặc ít hơn là 30 giây" |
| 6044 / 6046 | Phiên chọn model | **Theo nhà cung cấp + model** — một dòng cho mỗi model |
| 6045 | Lượt research thật sau khi xong | **Không** — vòng này chỉ unit test |
| 6047 | Ba connection opencode cũ | Gộp vào một; bỏ connection trùng phía router, giữ phía API |
| 6048 | Cooldown | 30 giây mặc định, theo `retry-after`, **trần 2 phút** |
| 6050 | Bốn lỗi nhỏ đo được | **Gộp cả bốn**; riêng lỗi thông báo tham số JSON sửa **ở chỗ gọi**, cây vendor giữ nguyên |
| 6050b | Tài liệu cho người tiếp nhận | Chính tài liệu này (handoff2) + chép kế hoạch vào repo |
| 6051 | Chữ mới trong giao diện | **Tiếng Anh** cho mọi chữ mới (màn Settings vốn đã tiếng Anh) |
| 6052 | Cách gộp khoá | **Một hành động chuyển tất cả khoá** của connection nguồn |
| 6053 | Bỏ khoá cuối | Chủ nhà không chọn — chốt theo đề nghị: connection **ở lại**, rỗng khoá, không tự xoá |

Quyết định cũ vẫn hiệu lực: **D-44** dạng câu trả lời cuối chỉ là gợi ý; hồ sơ research `v<N>` bất biến; con research không có `file_write`/`research_write`; mọi tính năng mới có cờ tắt.

---

## 3. Việc phải làm, theo thứ tự

### Nhóm A — Router (nửa `router/`)

- **R-0** Module vòng khoá mới: thứ tự khoá, luật cooldown, đọc `Retry-After` dùng chung cho adapter. `router/src/keyring.mjs` (mới) + `router/src/providers/common.mjs` + `router/src/providers/opencode.mjs`.
- **R-1** Vòng khoá sống trên storage cũ: `ensureRing`, `addKey`, `replaceKey`, `removeKey`, `importKeys`, `tryKey`; xoá connection bị từ chối khi còn khoá. `router/src/service.mjs`, `router/src/oauth.mjs`, `router/src/errors.mjs`. **`router/src/store.mjs` không đổi một dòng.**
- **R-2** Engine xoay khoá: vòng khoá **lồng trong** vòng target; chỉ 429 xoay; cả vòng nghỉ ⇒ lỗi thật của nhà cung cấp, không tốn thêm lượt gọi. `router/src/engine.mjs`.
- **R-3** Năm route HTTP và snapshot trang trí: `router/src/server.mjs`.
- **R-4** Tài liệu: `router/CONTRACT.md`, `docs/plan/retry-policy.md`, `docs/plan/v27/research-quality-tests.md`.
- **R-5** Runbook một lần để gộp bốn connection opencode: `docs/plan/v29-keyring-merge-runbook.md` (viết ở vòng này, **chạy ở nhóm E**).

### Nhóm B — Giao diện key ring (Settings)

- **B-1** Khối khoá trong card connection: danh sách khoá, bốn trạng thái, đếm ngược, `Replace` / `Remove` / `Try now`.
- **B-2** Thêm khoá, thay khoá, bỏ khoá; connection rỗng hiện trạng thái chưa có khoá; nút Delete bị chặn khi còn khoá.
- **B-3** Hành động gộp khoá: chuyển **tất cả** khoá của connection nguồn trong một lời gọi; nguồn ở lại với trạng thái rỗng.
- **B-4** Năm hằng số đường dẫn gom một chỗ (`frontend/src/lib/routerKeyPaths.ts`) để đổi tên chỉ sửa một tệp.
- **B-5** Danh sách model gộp theo nhà cung cấp (một dòng một model) — **do nhóm C làm**, không làm lại ở nhóm B.

### Nhóm C — Chọn theo nhà cung cấp + model

- **C-1** Backend: dạng route thứ ba `{providerId, modelId}` đi hết đường; metadata gộp trên mọi connection dùng được (cửa sổ ngữ cảnh = số nhỏ nhất, mức thinking = giao).
- **C-2** Frontend: `frontend/src/lib/routeOptions.ts` (mới), dạng selection `'provider'`, payload route, các chỗ tiêu thụ.
- **C-3** Picker: một dòng mỗi `(provider, model)`; nhánh con để ghim đúng một connection; `Pin this connection` / `Unpin`.
- Router **không** phải sửa cho việc này: nó đã nhận `providerId` và đã failover trước khi có output.

### Nhóm D — Kiểm nghiệm research (offline) và tài liệu handoff

- **D-1** Sửa một câu tài liệu lệch ở `scripts/eval/benchmarks/tier-r1.md:66`; dựng bảng khoảng trống `R1–R12`.
- **D-2** Probe provider GIẢ ở tầng harness (router xoay khoá ở trong ⇒ harness thấy 200, không phải sửa).
- **D-3** Bốn sửa lỗi nhỏ đo được từ sáu lượt thật: (a) cổng chất lượng chê tiêu đề tiếng Việt tự nhiên; (b) câu khắc phục nói sai luật (phải khác **host**); (c) câu lỗi tham số JSON quá ngắn — **đã xong ở `agent_core/tool_arg_errors.py`**; (d) hợp đồng `research_brief` thiếu mô tả `ceilingSeconds`.
- **D-4** Tài liệu `docs/handoff/research-verification.md`: sáu lượt thật đã đo được gì, **những gì chưa làm được**, giao thức chạy sống cho vòng sau, rủi ro treo, lệnh chạy nhanh.

### Nhóm E — Một lần chạy tay trên máy chủ nhà

**Chỉ chạy khi chủ nhà đồng ý** (runbook cần dừng/mở lại router — tiến trình của chủ nhà; agent không tự đụng):

1. Sao lưu cả thư mục `~/.local/share/boxfox/router/` (`router.sqlite`, `-wal`, `-shm`, `master.key`) ra ngoài repo, mode `0600`.
2. Giữ `f8a5f4e8…` ("OpenCode Free (key 1)") làm connection sống sót; **import** khoá của `a43ff124…` (key 2) và `3d27b0b0…` (key 3) vào vòng khoá của nó; xử lý connection trùng `7c59f6b5…` (**tắt trước, xoá sau** khi chủ nhà đã thấy đúng); xoá hai vỏ rỗng; đổi tên; trỏ lại `defaultRoute` và `BOXFOX_LIVE_CONNECTION_ID`.
3. Kiểm trên giao diện: provider `opencode` còn **một** connection đang bật với **ba** khoá; picker hiện **một hàng** cho `muse-spark-1.3-contributor-free`; chạy **một lượt thường** (không phải research).
4. Đường lùi: chép lại DB + `master.key` từ bản sao lưu, mở lại router, đối chiếu digest từng blob với bộ đã ghi trước khi migrate.

### Nhóm F — Sổ sách và bàn giao

- **F-1** Test report của phiên (một báo cáo duy nhất, dùng lại đúng title cũ khi gửi lại).
- **F-2** Cập nhật PR #6: `## Changes`, `## Testing`, `## Risk Assessment`, `## Out-of-Scope Feedback`.
- **F-3** Sổ theo dõi trong repo: `docs/tracking/test-rounds.md`, `docs/tracking/bug-register.md`, `docs/tracking/owner-decisions.md`.
- **F-4** Tài liệu này (handoff2) + bản kế hoạch chi tiết trong repo ở `docs/plan/v29/`.

---

## 4. Bảng tiến độ

Cập nhật ở từng mốc. Trạng thái: **XONG** / **ĐANG** / **CHƯA**.

| Việc | Trạng thái | Ghi chú / số đo |
|---|---|---|
| R-0 module vòng khoá | XONG | `router/src/keyring.mjs` 209 dòng |
| R-1 vòng khoá trên storage | XONG | `router/src/service.mjs` +252; **`store.mjs` không đổi một byte** |
| R-2 engine xoay khoá | XONG | `router/src/engine.mjs` +116/−99; chỉ 429 xoay; hết vòng ⇒ lỗi thật, 0 lượt gọi thêm |
| R-3 năm route HTTP | XONG | `router/src/server.mjs`; xoá connection còn khoá ⇒ 409 `KEYS_PRESENT` |
| R-4 tài liệu router | XONG | `router/CONTRACT.md`, `docs/plan/retry-policy.md`, `docs/plan/v27/research-quality-tests.md` |
| R-5 runbook gộp khoá | XONG (viết) | `docs/plan/v29-keyring-merge-runbook.md` 168 dòng — **chưa chạy**, thuộc nhóm E |
| B-1…B-4 giao diện key ring | XONG | `ConnectionKeyRing.tsx` 342 + `ProviderModelList.tsx` 254 + `lib/routerKeyPaths.ts` 28; chữ mới tiếng Anh. `cd frontend && npx vitest run src/components/settings` ⇒ 14 tệp / 91 ca xanh |
| C-1 backend provider route | XONG | `runtime.py` +180 (dạng `provider:<id>:<model>`, gộp metadata theo provider); `api/server.py` +7; `test_provider_route.py` 11 ca |
| C-2 frontend route | XONG | `lib/routeOptions.ts` 212 dòng là nguồn DUY NHẤT của danh sách model; `HarnessModelPicker.providerRows.test.tsx` 14 ca |
| C-3 picker một dòng + nhánh ghim | XONG | Một dòng cho mỗi model + nhánh con ghim connection; 13 tệp frontend sửa, +573/−127 |
| D-1 bảng khoảng trống + câu tài liệu lệch | XONG | câu lệch ở `scripts/eval/benchmarks/tier-r1.md` đã sửa; bảng khoảng trống nằm trong tài liệu D-4 |
| D-2 probe provider giả | XONG | `backend/tests/unit/test_router_keyring_probe.py` — 2 ca, chạy offline, 0.46 giây |
| D-3 (a)(b)(d) + (c) | XONG | **(c)**: `agent_core/tool_arg_errors.py` + 7 ca. **(a)(b)**: `research_quality.py`. **(d)**: `tool_contracts.py` mô tả `ceilingSeconds`. Nhóm research: 291 ca xanh (mốc cũ 286) |
| D-4 handoff kiểm nghiệm research | XONG | `docs/handoff/research-verification.md`, 291 dòng |
| E chạy runbook trên máy chủ nhà | CHƯA | chờ chủ nhà đồng ý |
| F-1…F-4 sổ sách, PR, tài liệu | CHƯA | |

**Mốc đo gần nhất (trước vòng 29):** bộ đơn vị backend `1640 passed, 1 deselected` (264 giây) tại `343458e`; router `npm test` chưa chạy lại trong vòng này.

---

## 5. Giao kèo dữ liệu và tên route (không được đổi khi chưa cập nhật cả hai nửa)

Năm route, do nhóm A làm chủ:

```
POST   /api/router/connections/:id/keys                 thêm một khoá
PATCH  /api/router/connections/:id/keys/:keyId          thay một khoá
DELETE /api/router/connections/:id/keys/:keyId          bỏ một khoá
POST   /api/router/connections/:id/keys/:keyId/try      bỏ cooldown, thử ngay một lần
POST   /api/router/connections/:id/keys/import          chuyển tất cả khoá của connection nguồn
```

`GET /api/router/connections` trả về, cho mỗi connection, danh sách khoá `keys[]` với `{ id, label, prefix, createdAt, state, cooldownUntil, resetAt, lastErrorCode, lastErrorMessage, lastUsedAt }` và `activeKeyId`. `prefix` ≤ 6 ký tự của secret. Vắng `keys` ⇒ nửa giao diện quay về giao diện một khoá cũ (đọc phòng thủ).

Dạng route thứ ba của phiên: `{ providerId, modelId }`. Phiên cũ giữ `{ connectionId, modelId }` chạy y nguyên — không cần migration.

---

## 6. Bất biến không được phá

- Khoá mã hoá-at-rest bằng master key sẵn có; **không** trả khoá thật ra giao diện (chỉ prefix đã che và nhãn); không log khoá hay payload thô; chỉ loopback; giữ `X-BoxFox-Admin: 1` + kiểm Origin/Host.
- `POST /api/router/connections` và `PATCH /:id` chỉ **thêm** trường; `inferenceState` không có giá trị thứ tư; bỏ khoá cuối thì connection ở lại.
- Chuyển khoá là thao tác **dữ liệu** — ciphertext không đổi, không giải mã rồi mã hoá lại.
- Hết vòng khoá ⇒ trả **lỗi thật** của nhà cung cấp, không bịa lỗi, không tốn thêm lượt gọi.
- Harness: không đổi `/v1/chat/completions`, không đổi hình dạng wire của OpenCode Free, không thêm dependency.
- D-44: câu trả lời cuối vẫn chỉ là gợi ý; luật trung thực (không bịa ảnh, không dùng ảnh cũ, nói rõ việc chưa chạy) là phần duy nhất không đổi.
- Vận hành: không restart/kill tiến trình chủ nhà (3100, 3101, 3102, 3112, 3120, 3141, 3199, 8081, container `agentbox-box`); không rebuild box; không cài gói trong box.

---

## 7. Lệnh chạy nhanh

```bash
# Router (không cần npm install — router không có dependency)
cd /code/minndty3-design/BoxFox-Agent-Box/router && npm test

# Bộ đơn vị backend — PHẢI chạy từ GỐC repo
cd /code/minndty3-design/BoxFox-Agent-Box
./.venv/bin/python -m pytest backend/tests/unit -q -p no:randomly \
  --deselect backend/tests/unit/test_terminal_tools.py::test_terminal_exec_echo

# Giao diện
cd /code/minndty3-design/BoxFox-Agent-Box/frontend && npx vitest run
```

---

## 8. Việc còn treo và rủi ro

- **Không lượt research thật nào ghi được hồ sơ `.research/**`** ⇒ bộ `R1–R12` chưa chạy trên dữ liệu thật; nghiệm thu **C-7** còn mở; **F19** cấm nói "đã có benchmark research".
- Phát hiện (e) chưa sửa: nhánh con `research` nhận `RESEARCH_GATE_NOTE` với tiêu chí của **hồ sơ** mà nhánh con không có `dossier_write` để thoả — chỉ lượt thật mới kiểm được.
- Nghỉ khoá là **in-memory**: restart router là mọi khoá về vòng ngay (ghi vào tài liệu, không sửa vòng này).
- Một số adapter ném 429 dưới mã `PROVIDER_ERROR` (ví dụ `openrouter`) nên chưa xoay khoá được — ghi nhận, không mở rộng vòng này.
- Bẫy hạn mức lượt: xin `ceilingSeconds` **bằng đúng** hạn mức phiên thì không được nới; lượt thật thứ năm đã chết đúng 600 giây vì việc này. Hợp đồng công cụ nay đã mô tả tham số (D-3d).
- M6 (trần USD) vẫn mở: router chưa trả trường `cost`.

---

## 9. Kế hoạch chi tiết trong repo

- `docs/plan/v29/v1-keyring-router.md` — kế hoạch vòng 29 đầy đủ (năm đợt, quyết định, kiểm thử, ngoài phạm vi).
- `docs/plan/v29/v29-keyring-router-plan.md` — nửa router (R-0…R-5).
- `docs/plan/v29/v29-keyring-ui-plan.md` — nửa giao diện key ring.
- `docs/plan/v29/v29-provider-route-plan.md` — dạng route `provider + model`.
- `docs/plan/v29/v29-research-verify-plan.md` — kiểm nghiệm research offline.
- `docs/plan/v29/v29-research-handoff-outline.md` — đề cương handoff kiểm nghiệm.

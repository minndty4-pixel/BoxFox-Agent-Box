# Vòng 27 Phạm vi B — Nghiên cứu có sổ: sổ nguồn, thang nguồn, hồ sơ việc, cổng chất lượng, pha phản biện

> **TL;DR:** Dựng **sổ nguồn** (mỗi khẳng định ↔ URL ↔ đoạn trích nguyên văn ↔ ngày lấy ↔ tầng ↔ nguồn tin gốc) + **thang nguồn 4 tầng** cứng trong mã, **ba nhóm hồ sơ** với trường bắt buộc riêng, **cổng chất lượng riêng** (`research_quality.py`, không nhét vào `evidence_gate`) và **một con phản biện `research-review`** kiểu `plan-review`; hồ sơ ghi thành tệp trong `.research/`, `revise` chặn MỘT vòng rồi giao kèm nhãn "chưa đạt".

## Mục tiêu

Chủ nhà: *"nhanh - chính xác và đặc biệt là phải thật kỹ, tương tự như nhà nghiên cứu thực thụ và chuyên nghiệp"*. Kế hoạch biến "đủ kỹ" thành thứ **máy kiểm được**, với 8 mục của Phạm vi B: sổ nguồn, thang nguồn, hồ sơ việc, luật số nguồn, cổng chất lượng research, pha phản biện, sửa skill chết, chia đợt + test mới.

## Hiện trạng đo được (căn cứ, có dòng mã)

| Khoảng trống | Bằng chứng |
|---|---|
| Không cổng nào kiểm câu trả lời research có nguồn | `evidence_gate.py:122-124` (không có mã nguồn), `:420-483` (không sinh mảnh cho `web_search`/`web_fetch`) |
| Không có vòng phản biện cho research | `runtime.py:4496-4607` mới có vòng **plan**; `roles.py:98-113` là code review |
| Kỹ năng chuyên môn chết | `grounded-citations` nhắc `web_extract` 5 lần, tool thật là `web_fetch` (`tool_contracts.py:64-68`); `skill_view` không tự chạy script (`:69`); không nơi nào đặt `HERMES_HOME` |
| Chỉ dẫn đòi hình dạng nhưng không ai đọc lại | `roles.py:140-152`, `runtime.py:1067-1076` |
| Kết quả research nén ở cả hai đầu | con trả 8 000 ký tự (`runtime.py:1015`), gói 16 000 (`limits.py:135`), con **không có `file_write`** (`roles.py:18`) |
| Đo sống: đầu đọc và "thành công giả" | `nhandan.vn` 17 421 ký tự rác; `vbpl.vn` 404 giả; `moh.gov.vn` 200 với 165–259 byte |

## Thay đổi đề xuất

| Thành phần mới | Chỗ đứng | Vai trò |
|---|---|---|
| `research_ledger.py` | `backend/src/agentbox/agent_core/` | luật số nguồn, dấu vân tay đoạn trích, đếm nguồn độc lập (hàm thuần) |
| `source_tiers.py` | cùng chỗ | 4 tầng + `host-doc` (tầng 0) + `official-social`, đổi bằng `BOXFOX_SOURCE_TIERS` |
| `research_profiles.py`, `research_quality.py` | cùng chỗ | ba nhóm hồ sơ + 13 mã lỗi + câu khắc phục |
| Bảng `source_ledger`, `research_dossiers`, `research_verifications` | `memory/session_store.py` | cộng thêm, tự lọc theo `turn`, ngoài cascade `delete()` |
| 6 tool: `source_add`, `source_list`, `source_verify`, `research_write`, `research_verify`, `research_status` | `tool_contracts.py` + `runtime.py` + `tool_groups.py` | orchestrator: 25 → **31** công cụ |
| Vai `research-review` (chỉ đọc) | `roles.py` (cuối danh sách) + enum `delegate_task` + `ROLE_SKILLS` + `harnessRoles.ts` | phản biện độc lập, kết thúc bằng `VERDICT: ok|revise` |
| Op box `research_write` | `sandbox/worker.py` + `deploy/docker/research_files.py` | ghi `.research/<slug>/v1-<slug>.md` + `sources.jsonl` + `sources.md` |

Luồng: con `research` gọi `source_add` (claim + URL + **đoạn trích nguyên văn** + nguồn tin gốc) → main gọi `research_write` (cổng chạy **trước** khi ghi) → con `research-review` đọc hồ sơ + mở lại nguồn → main gọi `research_verify` ghi `research_verifications`; `revise` chặn **một** vòng rồi hồ sơ mang nhãn **do máy viết** trong header.

Quyết định theo chủ nhà: **hai nguồn độc lập cho khẳng định then chốt, trừ tầng 1** (#5985); "độc lập" định nghĩa máy kiểm được — hai nơi cùng đăng một tin là **một** nguồn (#5996); hiệu lực văn bản **chỉ** áp cho usecase cần (#5987); cứng trường then chốt, mềm phần còn lại (#5989); tài liệu chủ nhà là tầng riêng **trên tầng 1** (#5962); MXH chính thức dùng được, tính ngang chính thống nhưng phải có **bản xác nhận thứ hai** ở nơi khác (#5991/#5997).

## Đợt thi công

| Đợt | Nội dung | Cách đo |
|---|---|---|
| 1 | Sổ nguồn + `source_add`/`source_list` | test sổ + một lượt thật 3 dòng |
| 2 | Thang nguồn + `source_verify` (bắt "thành công giả") | chạy lại 5 URL đã đo, phải ra `fakeSuccess`/`unreachable` |
| 3a | Bảng hồ sơ + cổng thuần | 6 ca sống ở mức hàm thuần |
| 3b | Ghi hồ sơ + cổng chặn trước khi ghi | 3 ca vi phạm bị từ chối, **không** tạo tệp |
| 4 | Vai `research-review` + `research_verify` + nhãn `revise` | 4 ca sống về phản biện và vòng sửa |
| 5 | Sửa skill chết + tài liệu (naming, ADR-0004, bug-register) | `test_skill_tool_names.py` + script `SkillCatalog` in `enabled` |
| 6 | 3 ca benchmark + chỉnh ngưỡng theo số đo | số cụ thể ghi vào `docs/tracking/test-rounds.md` |

Test mới (tên ca cụ thể ở plan chi tiết): `test_research_ledger.py`, `test_source_ledger_store.py`, `test_source_tiers.py`, `test_research_verify_source.py`, `test_research_profiles.py`, `test_research_quality.py`, `test_research_write.py`, `test_research_gate_runtime.py`, `test_research_review_role.py`, `test_research_critique.py`, `test_research_verify.py`, `test_skill_tool_names.py` (backend), `test_research_files.py` (box), `harnessRoles.test.ts` (frontend). Test hiện có phải cập nhật: số công cụ 25 → 31 (`test_journal_tools.py:63`, `test_runtime_info.py:141,154,164`) và danh sách vai (`test_plan_review_role.py:72-74`).

## [ĐÃ CHỐT — vòng 9–13, phỏng vấn đã đóng] (không chặn thi công)

> Ba nhóm câu hỏi dưới đây **đã được chủ nhà chốt**: thị trường #6005–#6008 · học thuật/kỹ thuật #6010–#6014 · phương pháp
> #6016–#6025 (xem `v27-owner-answers.md` §2.11–§2.15). Giữ nguyên hàng cũ làm biên bản.

- **Hồ sơ nhóm 3 Thị trường**: nguồn gốc của giá, trường bắt buộc (`capturedAt`/`region`/`currency`?), số ước lượng/khảo sát xử lý thế nào, ngưỡng "đủ kỹ" (2–3 kênh?).
- **Hồ sơ nhóm 2 Học thuật/kỹ thuật**: trường bắt buộc của paper (DOI/năm/venue/tác giả, có bắt mở PDF?), bão hoà khi săn đuổi trích dẫn, phiên bản tài liệu hãng, đọc PDF/bảng biểu (đầu đọc keyless mất cấu trúc bảng).
- **Phương pháp**: bốn pha chạy thế nào, số nhánh con tối đa mỗi mức, trần thời gian/chi phí mặc định, nhịp kiểm chứng và cách chủ nhà nới trần.

Cơ chế đã dựng xong với giá trị **nháp**; chốt xong chỉ đổi **một bảng khai báo**.

## Bất biến phải giữ

Không nhét tiêu chí citation vào `evidence_gate.py` (D-18); không khối/dải quanh câu trả lời cuối (D-19…D-25); hình dạng nằm trong skill (D-26…D-32); **không** thêm giá trị `status`; cổng chạy **trước khi ghi** và chỉ là lớp bổ sung; ghi sổ hỏng ⇒ log rồi đi tiếp; migration cộng thêm; bảng mới tự lọc theo `turn`; giữ nguyên hai cổng kế hoạch và `plan-review`/`plan_verify`.

## Không làm

Không sửa `evidence_gate.py`/`web.py`/`compression.py`/`plan_quality.py`; không UI mới (hồ sơ đọc bằng trình duyệt workspace có sẵn); không cài gói trong box; không mở quyền ghi cho con research; không bật `enforce` cho `boxfox_evidence_gate`.

## Việc UI (bàn giao riêng, ngoài phạm vi)

Chat hiện **không có renderer trích dẫn** (đo được: `frontend/src` chỉ có 1 lần chữ "citation", `SubagentInspectorPanel.tsx:87`; 0 chỗ dựng chỉ số `[n]`). Nếu main muốn hiện `[s<N>]`/khối `**Nguồn:**` cho đẹp trong chat thì **phải dispatch một design subagent** và đính artefact ở tab Design — việc đó nằm **ngoài** kế hoạch này.

> **Cập nhật vòng 9–11 (#6002–#6014):** sổ nguồn thêm **loại bản đã đọc** + **phiên bản/commit/ngày truy cập**; TM-2 trần **10–15**; TM-3 dùng **C2′** (sàn 20/10/≥2 + đích 30–50/15/≥3, thiếu mẫu ⇒ "tín hiệu, chưa kiểm", không deadlock). Chi tiết ở Phụ lục cuối `v27-ledger-plan.md`.

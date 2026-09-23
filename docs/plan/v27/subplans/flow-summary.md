# Vòng 27 · Phạm vi C — Luồng nghiên cứu: ba mức · bốn pha · điều phối · nhịp & can thiệp · ngân sách · đầu ra tệp · benchmark

> **TL;DR:** Dạy BoxFox chạy việc nghiên cứu như một nhóm nghiên cứu thật — main chốt **một con số mức** cho cả việc, chia nhánh con theo đúng mức đó, đọc nguồn thật ở mọi mức, báo tiến độ theo mốc, nhận lệnh giữa lượt, và **ghi toàn bộ kết quả ra tệp** thay vì nhồi vào câu trả lời bị cắt ở 8 000 ký tự.

## Vấn đề

Owner: agent research hôm nay "chỉ tìm được phần nổi, không đọc kỹ từng phần chi tiết và liên quan"; yêu cầu: **"nhanh - chính xác và đặc biệt là phải thật kỹ, tương tự như nhà nghiên cứu thực thụ và chuyên nghiệp"** — big update quan trọng nhất (#5955–#5998). Phạm vi C là **luồng chạy**: còn lớp đọc/nguồn là Phạm vi A, sổ nguồn + cổng chất lượng + pha phản biện là Phạm vi B.

## Trạng thái đo được hôm nay (HEAD `2add905`, cây sạch)

| Sự thật | Chỗ đo | Hệ quả cho kế hoạch |
| --- | --- | --- |
| `research` **không có** `file_write`, không `terminal_exec` | `roles.py:18` | Con research **không ghi được tệp** ⇒ hồ sơ không thể ra đời |
| Câu trả lời của con bị cắt **8 000 ký tự** | `runtime.py:1015` (`CHILD_ANSWER_MAX_CHARS`) | Khảo sát dài hơn 8 000 ký tự **không bao giờ** về tới main nguyên vẹn |
| `await_children` gói tối đa **16 000 ký tự** cho cả lượt chờ | `limits.py:135` | 4 nhánh × 8 000 vẫn bị chặn trần |
| Trần nhánh: 3 mặc định / 6 max / 8 toàn cục / **12 con mỗi lượt** | `limits.py:105-111` | Mức 3 cần 6 nhánh là nằm trong hạn mức, không cần đổi |
| Con không được hỏi chủ nhà (`DECISION_UNAVAILABLE`) | `runtime.py:3972-3979` | Chỉ main nói với chủ nhà (#5961) — đã đúng, chỉ cần nhắc trong skill |
| Prompt nêu 4 mục + nguồn, nhưng **không cổng nào kiểm** | `roles.py:140-152` | Cần cổng mới (B) + luồng bắt buộc ghi tệp (C) |
| Đang chạy lượt thì **mọi prompt thường bị 409 `SESSION_BUSY`** | `runtime_commands.py:39-41`, `server.py:150` | Muốn "gõ lệnh giữa lúc chạy" (#5981) phải mở một đường mới |
| Đã có tiền lệ **bơm chữ vào giữa lượt** theo mốc bước | `drain_peer_deliveries` `runtime.py:4932-4965`, gọi tại `:3024` | Đây là khe duy nhất, dùng lại chứ không phát minh cơ chế mới |
| `worker.py` được **gửi nguyên văn vào box** (`-c WORKER`) | `executor.py:12` + `:221-222` | Thêm op box **không cần dựng lại box** |
| Benchmark research: `benchmark/cases/*` rỗng, `scores.jsonl` không có, judge `NotImplementedError` | `benchmark/`, `scripts/eval/judge.py:176` | Không được khoe "đã có benchmark"; phải tự đo bằng oracle máy |

## Thay đổi đề xuất

| # | Hạng mục | Cơ chế chính | Tệp chạm chính |
| --- | --- | --- | --- |
| #1 | Ba mức, một con số cho cả việc (#5960/#5965) | Tool mới **`research_brief`** + bảng trần `RESEARCH_TIERS` + skill `research-team` | `tool_contracts.py`, `runtime.py`, `limits.py`, `roles.py`, `vendor/hermes/skills/research/research-team/SKILL.md` |
| #2 | Đọc bắt buộc ở mọi mức (#5966) | Luật trong skill + front matter hồ sơ bắt buộc mục "đã mở" (B giữ sổ trích dẫn) | skill, `research_quality` (B) |
| #3 | Bốn pha + mức 3 đuổi trích dẫn & bão hoà (#5967) | SOP trong skill (ca R4 kiểm bằng máy) | skill, `runtime.py` (nhắc) |
| #4 | Nhịp báo tiến độ mỗi mốc / ~10 phút (#5969) | Câu trả lời giữa lượt (`assistant` không `final`) + đồng hồ nhắc trong harness | `runtime.py`, skill |
| #5 | Chủ nhà gõ lệnh giữa lúc chạy (#5981) | **`session_steers`** + `drain_steers` cạnh `drain_peer_deliveries`; tool **`cancel_child`** | `session_store.py`, `runtime_commands.py`, `runtime.py`, `ChatPanel.tsx`, `harnessChatStore.ts` |
| #6 | Ngân sách + nút duyệt việc lớn (#5964) | Nối vào `request_approval` sẵn có (`action='research-budget'`) + `extend_turn_budget` | `runtime.py`, skill |
| #7 | 100% đầu ra là tệp (#5973/#5980) | Tool + op **`dossier_write`** vào phòng `.research/` + hình dạng hồ sơ theo mức | `worker.py`, `tool_contracts.py`, `roles.py`, `runtime.py`, `MarkdownRenderer.tsx` |
| #8 | Đo lường "thật kỹ" | Bộ ca `R1–R7` + oracle máy `scripts/eval/research_checks.py` | `scripts/eval/**` |
| #9 | Tài liệu | Sửa 2 tài liệu lệch (F21, F22) + trang kiến trúc + sổ theo dõi | `docs/plan/cua-benchmark-plan.md`, `docs/architecture/tools-and-skills.md`, `docs/architecture/research-agent.md`, `docs/tracking/**` |

## Chốt gì · mở gì

- **Đã chốt, chỉ hiện thực:** ba mức + tự chọn mức, mơ hồ ⇒ mức 2 (#5960/#5965) · đọc nguồn bắt buộc ở mọi mức (#5966) · mức 3 luôn đuổi trích dẫn + bão hoà (#5967) · chỉ main nói với chủ nhà + gộp nhánh liên quan (#5961/#5982) · nhịp mỗi mốc hoặc ~10 phút (#5969) · đầu ra 100% tệp (#5973/#5980) · phản biện độc lập `revise` chặn 1 vòng (#5968 — việc của B, C chỉ nối).
- **[MỞ — chờ phỏng vấn]:** trần thời gian/chi phí mặc định mỗi mức; hình dạng hồ sơ mẫu mỗi mức; số nhánh tối đa mỗi mức; "bão hoà" ở mức 3 là mấy vòng; nhóm 3 (thị trường) và nhóm 2 (học thuật/kỹ thuật) như §3 của `v27-owner-answers.md`; cơ chế hạ/cắt nhánh của chủ nhà; ranh giới chi phí USD (router có `cost`/`costBasis` nhưng harness **chưa nhận** trường đó ⇒ trần nêu bằng giây + token trước, USD để mở). Owner đã chốt: *"tạo plan trước, ghi vào plan trước rồi tiếp tục interview"* (#5998).

## Chia đợt (mỗi đợt có điều kiện dừng + số để lượng giá)

| Đợt | Nội dung | Phụ thuộc |
| --- | --- | --- |
| C-1 | `research_brief` + bảng trần theo mức + skill `research-team` | sau A (lớp đọc) |
| C-2 | `dossier_write` + phòng `.research/` + hình dạng hồ sơ + liên kết trong chat | sau C-1 |
| C-3 | SOP bốn pha + luật đọc bắt buộc + đuổi trích dẫn/bão hoà (chữ trong skill) | song song C-2 |
| C-4 | Nhịp báo tiến độ + nudge theo mốc | song song C-2 |
| C-5 | Steer (`session_steers`, `drain_steers`, `cancel_child`) + UI composer mở khi đang chạy | song song C-2 |
| C-6 | Nút duyệt ngân sách cho việc lớn + kéo dài lượt theo mức | sau C-1 |
| C-7 | Bộ ca `R1–R7` + oracle máy | sau C-2 |
| C-8 | Sửa 2 tài liệu lệch + trang kiến trúc + sổ theo dõi | cuối |

## Rủi ro chính

- **Trần lượt 1 200 s** (`DEADLINE_MAX_SECONDS`) chặn mức 3 ⇒ phải xin owner một D-number mới cho lượt research dài, **không** nới trần chờ của con (giữ D-12/D-10, F9).
- Giữ nguyên **D-13** (không mở parallel read tools, F7), **D-11** (con không sinh cháu, F8), **R10-6** (không bỏ `web_*` khỏi orchestrator, F14), **D-19–D-25** (không thêm khối/badge quanh câu trả lời cuối, F2/F3), **§5(1)** (không thêm giá trị `status` mới cho session).
- Không dựng lại box, không restart tiến trình của chủ nhà; thêm op box là **an toàn** vì `worker.py` đi kèm tiến trình harness (`executor.py:12`).

## Bàn giao UI

Phạm vi C có 3 điểm chạm giao diện: (1) composer gửi được chỉ thị khi đang chạy + dòng xác nhận "đã xếp hàng"; (2) dòng tiến độ giữa lượt trong timeline; (3) nút "mở tệp" cho đường dẫn `.research/...`. Đề nghị main dispatch **design subagent** kèm artifact ở tab Design (khung composer bận, dòng tiến độ, hàng tệp hồ sơ) trước khi build C-5/C-2.

> **Cập nhật vòng 9–11 (#6008):** bão hoà săn đuổi trích dẫn mức 3 = **3 vòng**; bảng trần theo mức vẫn **nháp** tới khi chủ nhà chốt phương pháp ở vòng 12+. Chi tiết ở Phụ lục cuối `v27-flow-plan.md`.

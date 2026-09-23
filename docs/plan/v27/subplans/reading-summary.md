# Vòng 27 · Phạm vi A — Lớp đọc nguồn và lớp tìm kiếm (harness)

> **TL;DR:** Lớp đọc nguồn hiện tại không giải nén gzip (17 421 / 46 692 / 37 798 ký tự rác), chỉ cho model thấy 7 % của tài liệu dài, chỉ gọi đầu đọc khi thân bài dưới 200 ký tự và tin mọi `http=200` kể cả trang 404 giả — Phạm vi A vá đúng bốn chỗ đó, thêm `read_source` đọc theo khoảng và ba đòn bẩy keyless đã đo được, rồi giao cho Phạm vi B một hàm kiểm thân bài dùng chung.

## Vấn đề (đo được hôm nay, HEAD `2add905`)

| Hiện tượng | Bằng chứng |
| --- | --- |
| Không giải nén `Content-Encoding` | `web.py:155` đọc thô, `web.py:173` giải mã thẳng ⇒ Nhân Dân 17 421 · Báo Chính phủ 46 692 · VietnamPlus 37 798 ký tự rác |
| Tài liệu dài bị cắt phía ta | `docs.python.org`: trích được 113 936 ký tự, model nhận 8 000 (7 %), và 8 000 đầu là điều hướng |
| Đầu đọc gần như không được dùng | chỉ khi thân bài < 200 ký tự (`web.py:514-518`); non-2xx ném lỗi **trước** (`web.py:159-166`) ⇒ mất `thuvienphapluat.vn` (403, đầu đọc có 91 032 byte) và mọi PDF |
| Tin `http=200` là thật | `moh.gov.vn` đầu đọc 165–259 byte hoặc 503; `vbpl.vn` trả tiêu đề "Trang chủ" và một trang 404 giả |
| Một chân tìm kiếm duy nhất | chỉ Firecrawl keyless (`web.py:385`); không retry, không cache, không khử trùng (`web.py:464-483`) |
| Không đọc tiếp được | `web_fetch` không có `offset` (`web.py:505`); `file_read` trong box không có `offset` (`worker.py:122`) |

## Cách làm (bốn lớp)

1. **Tải thô** — xin `gzip, deflate`, giải nén có trần 16 MiB (chống bom nén), giữ được thân bài bị đứt (`IncompleteRead`).
2. **Kiểm thân bài** — module mới `reading.py`: chỉ số rác đo được (rác 0,52–0,55 so với văn bản thật 0,0000) + dấu hiệu trang lỗi/trang sai + ngưỡng thiếu chữ 500 ký tự.
3. **Thang đọc** — gọi `r.jina.ai` khi PDF, non-2xx, thiếu chữ, rác hoặc không tới được; trần 20 s; chỉ **nhận** nếu bản đầu đọc tốt hơn bản trực tiếp.
4. **Bộ đệm + đọc theo khoảng** — giữ bản đã tải trong tiến trình (LRU 24 mục / 4 M ký tự), công cụ `read_source` cắt tiếp bằng `offset` và tìm đoạn theo từ khoá bỏ dấu ⇒ #5966 ("mở thật + lấy đoạn liên quan") trở thành thao tác được.

## Chín việc

| # | Việc | Thay đổi chính | Đo nghiệm thu |
| --- | --- | --- | --- |
| A-1 | Giải nén `Content-Encoding` | `web.py:147` + hàm `decode_body` + trần chống bom | ba trang gzip: junk 0,0000, `textChars` ≈ 8 264 / 8 079 / 16 455 |
| A-2 | Kiểm thân bài (`reading.py`) | 6 kết luận `ok·thin·junk·error-page·wrong-page·empty` + hợp đồng cho B | 6 chuỗi mẫu đo được, 0 ca thật bị gắn `junk` |
| A-3 | Thang đọc dự phòng | PDF/non-2xx/rác/thiếu chữ ⇒ một lần gọi đầu đọc, có provenance | 403 ⇒ ≥ 20 000 ký tự; PDF arXiv ⇒ ≈ 40 895; `vbpl.vn`/`moh.gov.vn` **không** ra `ok` |
| A-4 | Bộ đệm + `read_source` + `web_fetch.offset` | công cụ mới, khoá `ref`/`offset`/`nextOffset`, `find` bỏ dấu | 113 936 ký tự đọc trọn bằng 6 lời gọi |
| A-5 | `file_read` có `offset`/`limit` | `worker.py:103-133` + hợp đồng | tệp 100 000 ký tự ghép lại bằng đúng tệp; ảnh PNG giữ nguyên hình dạng cũ |
| A-6 | Học thuật keyless | OpenAlex thêm `mailto`/`select`, Crossref, Europe PMC; công cụ `paper_citations` (lùi/tiến) | lùi n=54; tiến `count=1255`; payload 33 226 → 2 967 byte |
| A-7 | Tìm kiếm | nhiều truy vấn, khử trùng, `site:`/`tbs`/`lang`, cache 5 phút, retry, chỗ cắm khoá | 3 truy vấn ⇒ 0 URL trùng; gọi lặp ⇒ `cached: true` |
| A-8 | Đường trong box | tiền kiểm `browser_use`, danh sách trắng hẹp cho research, runner script cho skill | mẫu vượt rào bị từ chối; mạng tắt ⇒ lỗi có mã trong < 5 s |
| A-9 | Công tắc + tài liệu + thước đo | ba công tắc đọc env theo khuôn `mode_from_env`, khối `limits.web`, `scripts/probe-reading.py` | giá trị lạ ⇒ mặc định kèm notice một lần; `runtime-info` nói đúng mức đang áp |

## Đợt thi công

| Đợt | Việc | Dừng khi |
| --- | --- | --- |
| 1 | A-1, A-2, A-3, công tắc | ba trang gzip sạch + 403/PDF đọc được + **không** trang giả nào ra `ok` + `BOXFOX_WEB_READER=thin` xanh toàn bộ test cũ |
| 2 | A-4, A-5 | đọc trọn tài liệu dài ở cả hai phía (host và box) |
| 3 | A-6, A-7 | tiến/lùi trích dẫn + tìm nhiều truy vấn có khử trùng |
| 4 | A-8 (chỉ khi chủ nhà chốt), tài liệu | số đo vào `docs/tracking/test-rounds.md` |

## Bất biến phải giữ

- Không cho nhiều tool chạy song song trong một bước; cờ `BOXFOX_PARALLEL_READ_TOOLS` **giữ trơ** (D-13/F7) — tăng tốc bằng fan-out con.
- Không thêm tiêu chí citation vào `evidence_gate.py` (D-18/F1); không bỏ `web_*` khỏi bộ công cụ orchestrator (F14).
- Không thêm giá trị `status` mới, không khối/dải/huy hiệu quanh câu trả lời cuối (§5/F2–F6).
- Không nới trần ngữ cảnh: đường dài là **bộ đệm + đọc theo khoảng**, không phải một lời gọi to hơn.
- Nhật ký DEV không chứa truy vấn/URL; mọi payload giữ `untrusted: true` + `note`.
- Box vẫn **không** có Internet mặc định; không cài gói, không rebuild, không restart tiến trình chủ nhà.

## [MỞ — chờ phỏng vấn]

| # | Câu hỏi | Khuyến nghị |
| --- | --- | --- |
| MỞ-A | Ngân sách đọc theo mức 1/2/3 và trần mỗi đoạn | giữ trần 20 000 ký tự mỗi đoạn (trần ngữ cảnh), khác nhau ở **số lần** đọc |
| MỞ-B | Có bật mạng box để dùng `browser_use`/terminal? (điều kiện thi công A-8) | **không bật** vòng này; giữ lỗi có mã, bàn lại khi có số đo số trang JS |
| MỞ-C | Mua khoá nào trước, thứ tự dự phòng | Brave rồi Tavily (mã đã có, 0 dòng mới); Exa/Parallel để sau |
| MỞ-D | Ngưỡng "bão hoà" săn đuổi trích dẫn (chung với C), và săn đuổi là công cụ riêng hay tham số của `web_search` | 2 vòng không thêm bài mới **hoặc** chạm trần bài; công cụ riêng `paper_citations` |
| MỞ-E | Mở skill web/research nào | mở `blocked-page-recovery` rồi `rss-feeds`; `duckduckgo-search`/`searxng-search` đóng vĩnh viễn theo số đo |
| MỞ-F | Bộ đệm đọc có ghi ra đĩa? | **không** — trong bộ nhớ tiến trình |

## Không làm

- Không sửa `evidence_gate.py`, `plan_quality.py`, `compression.py`, `plan_eval.py`, `limits.py:207-214`.
- Không viết sổ nguồn/thang 4 tầng/hồ sơ việc (B) hay ba mức/nhịp tiến độ/steer (C).
- Không UI mới; không thư viện ngoài (`zlib`, `gzip`, `html.parser`, `urllib` là đủ); không hứa đọc được trang JS ở vòng này.
- Không dùng `sources=`/`page=` của Firecrawl (đo được: 400) và không thêm giá trị cho enum `source`.

## Bàn giao UI

Phạm vi A không có mặt giao diện mới và **không cần** dispatch design subagent. Chỉ hai chạm chữ: câu ghi chú nhóm `webResearch` ở `frontend/src/components/settings/HarnessEditor.tsx:40-41` (thêm `read_source`) và fixture tương ứng trong `HarnessEditor.test.tsx:34`. Chỉ báo "đang đọc nguồn" thuộc Phạm vi C.

> **Cập nhật vòng 11 (#6010–#6011):** thang đọc nay là **năm tầng** — HTML chính chủ → toàn văn XML/JATS → PDF + `pdfplumber` → đầu đọc **chỉ cho chữ** → ảnh trang; thêm việc **A-10**; bão hoà săn đuổi = **3 vòng** (#6008). Chi tiết ở Phụ lục cuối `v27-reading-plan.md`.

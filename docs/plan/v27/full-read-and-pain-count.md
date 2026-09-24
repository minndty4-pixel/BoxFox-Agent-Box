# Vòng 27 — Đọc FULL tài liệu (kể cả bảng) và cách "đếm nỗi đau" không phải đọc 100 phản ánh

Hai việc chủ nhà giao ở vòng 10:
- **#6009:** *"Này giúp tôi tìm kiếm giải pháp tối ưu nhất để đọc được full"*.
- **#6006:** tiêu chí gap phải *"rất rất chặt… nhiều nguồn, báo chí truyền thông đưa tin, phải nhiều lượt phản ánh, không đơn giản là 5… có thể lên hàng chục hoặc hàng trăm. Nhưng ta không muốn agent đọc và tìm 100 phản ánh, nên chúng ta cần đưa ra chiến lược khác"*.

Toàn bộ số dưới đây **đo hôm nay 2026-09-23** bằng `probe8.py` (`/var/tmp/v27/probe8.log`, `probe8.json`), không dùng khoá API.

---

## Phần 1 — Đo năm đường đọc FULL

| Đường | Cách gọi | Kết quả đo | Bảng biểu |
|---|---|---|---|
| **A. HTML chính chủ của arXiv** | `arxiv.org/html/1706.03762v7` | **200**, 188 707 byte, tiêu đề đúng "Attention Is All You Need", MathML có | **10 `<table>`** + 9 `<figure>` ⇒ bảng là HTML thật |
| **B. ar5iv (cộng đồng)** | `ar5iv.labs.arxiv.org/html/1706.03762` | **200**, 167 302 byte | 9 `<table>` + 9 `<figure>` |
| **C. Europe PMC toàn văn (JATS XML)** | `ebi.ac.uk/europepmc/webservices/rest/PMC13524156/fullTextXML` | **200**, 102 171 byte, 22 `<sec>` | **6 `<table-wrap>`** + 6 `<graphic>` ⇒ bảng có cấu trúc |
| **D. Đầu đọc (r.jina.ai) trên PDF** | `r.jina.ai/https://arxiv.org/pdf/1706.03762v7` | **200**, 40 895 byte **chữ tốt** | **0 dòng có dấu `\|`** ⇒ **bảng bị mất** (đúng nỗi lo của chủ nhà) |
| **E. pdfplumber trên PDF gốc** | venv riêng `/var/tmp/v27/pdfenv`, `pdfplumber 0.11.10` | 15 trang, 35 511 ký tự | **10 bảng**, kích thước thật `[9×39] [11×59] [6×54]…` ⇒ **dựng lại được bảng** |

Ghi chú chất lượng: pdfplumber dựng lại đúng khung bảng nhưng **dòng tiêu đề nhiều tầng có thể lệch**
(ví dụ bảng đầu ra `train N d d h d d P ϵ model ff k v drop ls steps`) ⇒ máy phải **ghi rõ bảng trích tự động** và
nếu khẳng định then chốt dựa vào bảng thì **phải đối chiếu câu văn quanh bảng** hoặc mở bản HTML/JATS nếu có.

**Kết luận đo được:** "đọc full" không có một đường duy nhất. Thứ tự tối ưu là **bản có cấu trúc trước, PDF sau,
ảnh cuối**:

```
1) HTML chính chủ (arxiv.org/html, trang tạp chí, nhà xuất bản, PMC HTML)      ← bảng thật, chữ thật
2) Toàn văn XML/JATS (Europe PMC fullTextXML, PMC OA package)                  ← bảng thật, rất mạnh cho y sinh
3) PDF + pdfplumber (phía máy chủ)                                             ← bảng dựng lại, chữ đầy đủ
4) Đầu đọc r.jina.ai                                                           ← chữ tốt, BẢNG MẤT ⇒ chỉ dùng cho chữ
5) Ảnh trang + đọc ảnh (vision)                                                ← chỉ khi 1–3 thất bại (PDF scan, bảng trong hình)
```

Điểm khớp với kế hoạch đã viết: đường (1)(2) nằm trong **thang đọc dự phòng** của đợt 1–3; đường (3) là
**một phụ thuộc mới phía máy chủ** (`pdfplumber`, kèm tuỳ chọn `pypdfium2` để dựng ảnh trang cho đường 5);
đường (4) đã có trong thiết kế nhưng **chỉ được dùng cho chữ**; đường (5) cần chủ nhà cho phép vì nặng và cần xử lý ảnh.

---

## Phần 2 — "Đếm nỗi đau" mà không phải đọc 100 phản ánh

Chủ nhà muốn tiêu chí **rất chặt** nhưng **không** bắt agent đọc hàng trăm phản ánh. Chiến lược ba tầng:

### Tầng 1 — ĐẾM bằng chỉ số tổng hợp (không đọc từng phản ánh)
Máy chỉ cần **con số do nền tảng/cơ quan công bố**, ví dụ:
- số lượt đánh giá theo mức sao và điểm trung bình (Google Play / App Store / trang bán hàng),
- số chủ đề/bài trong diễn đàn, nhóm cộng đồng (con số hiển thị),
- **số phản ánh trên kênh tiếp nhận chính thức** (đường dây nóng, cổng phản ánh, báo cáo của cơ quan),
- **báo chí/truyền thông đưa tin về chính vấn đề đó** — mỗi bài báo là một nguồn **đã tổng hợp sẵn** nhiều phản ánh của người dân.

⇒ Đây là chỗ tiêu chí "nhiều lượt, hàng chục/hàng trăm" được thoả **mà không đọc hàng trăm dòng**.

### Tầng 2 — LẤY MẪU có kiểm soát (đọc ít nhưng có hệ thống)
Đọc **một mẫu 20–30 lượt**, trải trên **≥2 nền tảng**, chọn theo ba nhóm (mới nhất · gay gắt nhất · đại diện nhất).
Phân loại theo chủ đề rồi đếm: ví dụ mẫu 25 lượt, **12 lượt** cùng nói "chờ lâu khi chuyển tuyến".
Sổ nguồn ghi: **đã lấy mẫu bao nhiêu · từ đâu · bao nhiêu lượt cùng chủ đề**.

### Tầng 3 — LUẬT "gap đã kiểm" (máy kiểm 100 %)
Một nỗi đau chỉ được gọi là **gap đã kiểm** khi **đủ cả hai vế**:

| Vế | Luật máy kiểm |
|---|---|
| **Vế tổng hợp** | ≥1 nguồn tổng hợp nói về vấn đề: báo chí/truyền thông chính thống · báo cáo khảo sát có tên đơn vị và cỡ mẫu · kênh tiếp nhận chính thức của cơ quan |
| **Vế mẫu — SÀN (chủ nhà chốt #6013)** | Mẫu ≥20 lượt trải trên ≥2 nền tảng; trong đó **≥10 lượt cùng chủ đề**; sổ ghi rõ số mẫu và số lượt |
| **Vế mẫu — ĐÍCH (chủ nhà chốt #6012)** | Khi dữ liệu đủ: **30–50 lượt**, **≥15 lượt cùng chủ đề**, trải trên **≥3 nền tảng** |

Trường hợp **không lấy được mẫu** (nền tảng chặn đọc, nội dung riêng tư) — chủ nhà nói rõ ở #6012
(*"nếu khảo sát… không đủ mẫu thì phải biết để tránh deadlock"*): chỉ được gọi là *tín hiệu*, và máy phải có
**≥3 nguồn tổng hợp khác loại** mới nâng lên "đã kiểm" — sai danh mục ⇒ hồ sơ ghi **"tín hiệu, chưa kiểm"**.
Luật chống deadlock: số nền tảng/vòng thử là **hữu hạn có trần** (chốt khi thi công), hết trần thì **ghi lý do và kết luận**,
**không lặp vô hạn** — hồ sơ phải nói rõ *"không đủ mẫu vì …"*.
Một lượt phản ánh lẻ ⇒ luôn ghi rõ "chỉ 1 lượt" (không bao giờ là gap đã kiểm).

Vì sao cách này khớp lời chủ nhà: tiêu chí **chặt hơn con số 5** (sàn 20 lượt mẫu, 10 lượt cùng chủ đề, ≥2 nền tảng,
cộng nguồn tổng hợp; đích 30–50), nhưng khối lượng đọc bị chặn ở **20–50**, không phải 100.

---

## Phần 3 — Những gì phải đổi trong kế hoạch (nếu chủ nhà chốt)

1. **Đợt 1–3 (lớp đọc):** thêm nhánh đọc **HTML chính chủ** và **toàn văn XML/JATS** vào thang đọc (trước PDF).
2. **Đợt 1 (phụ thuộc mới):** `pdfplumber` (và tuỳ chọn `pypdfium2`) phía máy chủ — cần chủ nhà cho phép thêm thư viện.
3. **Đợt 3 (sổ nguồn):** thêm trường *loại bản đã đọc* (`html` · `jats` · `pdf-table` · `reader-text` · `page-image`) để
   máy biết bảng nào lấy từ đâu; khẳng định dựa vào bảng phải ghi rõ nguồn bảng.
4. **Đợt 4 (hồ sơ + cổng):** usecase **TM-3** dùng **archetype C2′** (đếm + mẫu + nguồn tổng hợp) thay cho C2 cũ;
   usecase **TM-2** đổi trần đối thủ **10–15** (chủ nhà chốt ở #6007).
5. **Đợt 5–6 (mức 3):** săn đuổi trích dẫn dừng sau **3 vòng** không thêm bài mới (chủ nhà chốt ở #6008).
6. **Nhóm 2 (học thuật):** trường bắt buộc có thêm **loại bản đã mở** (HTML/JATS/PDF) — chủ nhà đã chốt "phải mở được
   toàn văn" (#6002); nay có ba đường mở toàn văn thay vì một.

---

## Phần 4 — Chủ nhà đã chốt (vòng 11, #6010–#6014)

| # | Câu hỏi | Chủ nhà chốt |
|---|---|---|
| #6010 | Thang đọc FULL | **Dùng đủ thang** (HTML/JATS → PDF + thư viện → đầu đọc chỉ chữ → ảnh trang) |
| #6011 | Thư viện PDF phía máy chủ | **Có** — thêm `pdfplumber` (+ `pypdfium2` khi cần ảnh trang) |
| #6012 | Mẫu nỗi đau | **Chặt hơn: 30–50 lượt / ≥15 cùng chủ đề / ≥3 nền tảng**, và **không đủ mẫu thì phải biết, tránh deadlock** |
| #6013 | Ngưỡng "gap đã kiểm" (vế mẫu) | **Giữ sàn** 20 lượt / 10 cùng chủ đề / ≥2 nền tảng + 1 nguồn tổng hợp |
| #6014 | Tài liệu hãng & kho mã | **Bắt buộc** phiên bản/tag hoặc commit + **ngày truy cập**, ghi rõ là tài liệu hãng |

⇒ Sáu điểm đổi ở Phần 3 **đã được duyệt**; đợt 1–3 sẽ cài thẳng, đợt 4–6 cài khi chốt phương pháp (vòng 12+).

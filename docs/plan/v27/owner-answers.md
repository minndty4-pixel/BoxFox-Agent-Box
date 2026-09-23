# Vòng 27 — Biên bản quyết định của chủ nhà (research agent + công cụ tìm kiếm)

Nguồn: 8 vòng phỏng vấn bằng `ask_user`, decision #5955–#5997 (2026-09-23). Đây là bản ghi chính thức để
viết ADR + kế hoạch. Số đo kèm theo nằm ở `/var/tmp/v27/feasibility-probes.md` và các `probe*.log`.

## 1. Mục tiêu chủ nhà đặt ra
- Các research agent hiện nay (ChatGPT, Codex, Claude…) chỉ tìm phần nổi bật, **không tìm kỹ từng phần chi tiết và liên quan** ⇒ phần research khi user không biết trở thành "nỗi ác mộng". BoxFox đánh vào điểm này.
- Yêu cầu nguyên văn: **"nhanh - chính xác và đặc biệt là phải thật kỹ, tương tự như nhà nghiên cứu thực thụ và chuyên nghiệp"**; đây là **big update lớn nhất**.
- **"trong này chuyên cho agent research, k phải main. main điều phối thôi"**.
- Phạm vi: **tất cả** lĩnh vực (khảo sát thị trường, đọc paper, tài liệu kỹ thuật, tìm kiếm).
- Phỏng vấn **thật kỹ lưỡng và nhiều** — chủ nhà yêu cầu rõ.

## 2. Đã chốt

### 2.1 Thang mức nghiên cứu — **ba mức** (#5960, #5965)
- **Mức 1** trả lời nhanh · **Mức 2** báo cáo có nguồn · **Mức 3** hồ sơ sâu có kiểm chứng chéo + phản biện.
- **Đọc nguồn là bắt buộc ở mọi mức** (#5960).
- **Một con số mức cho cả việc**, **main chọn theo tín hiệu trong yêu cầu**, yêu cầu mơ hồ ⇒ **mức 2**; mọi nhánh con chạy cùng mức đó (#5965).
- "Đọc nguồn" ở mức 1 nghĩa là: **mở thật + lấy đoạn liên quan + lưu đoạn trích nguyên văn vào sổ**; tài liệu dài không cần đọc trọn; **cấm kiểu trích snippet như đã đọc** (#5966).
- **Mức 3 luôn có săn đuổi trích dẫn** (lùi theo danh mục tham chiếu + tiến theo bài trích dẫn) **và tiêu chí dừng kiểu bão hoà** (#5967).

### 2.2 Đầu ra — **100% là tệp** (#5973, #5980)
- **Mọi mức đều ghi ra tệp**; **chat chỉ có báo cáo ngắn của main**: research đã làm gì, được gì, chặn gì, vướng mắc gì.
- Mức 3 thêm: bảng mâu thuẫn, phần nhánh nào đã chéo, biên bản phản biện.

### 2.3 Điều phối (#5961, #5982, #5969, #5981)
- **Chỉ main nói với chủ nhà**; con research không hỏi trực tiếp.
- Main nhận bản đồ/câu hỏi cần chốt rồi **tự chia sub-agent theo từng nhiệm vụ** (ví dụ y tế: khảo sát gap, vướng mắc người dân, tra cứu luật).
- **Có danh mục nhắc trong skill** để không bỏ sót nhánh quan trọng; **việc liên quan nhau thì gộp một con làm cả hai** (#5982).
- **Nhịp báo tiến độ**: mỗi khi một nhánh con xong **hoặc mỗi ~10 phút**, kèm "đang ở đâu / còn gì" (#5969).
- **Can thiệp giữa lúc chạy**: chủ nhà **gõ câu lệnh trong chat** ("dừng nhánh luật", "hạ xuống mức 2", "bỏ phần khảo sát giá"); main đọc và chuyển thành lệnh cho các nhánh đang chạy (#5981).

### 2.4 Ngân sách (#5964)
- **Main đề xuất mức + trần thời gian/chi phí**; việc nhỏ chạy luôn theo mặc định; **việc lớn chủ nhà bấm duyệt** (cơ chế duyệt giống plan).

### 2.5 Phản biện độc lập (#5968)
- **Một con riêng** làm phản biện (kiểu `plan-review` đã có ở vòng 25).
- Verdict **`revise` chặn MỘT vòng**; sau vòng sửa đó vẫn `revise` thì **giao hồ sơ kèm nhãn chưa đạt** (không treo việc cả ngày).

### 2.6 Nguồn — thang bốn tầng (#5962, #5983, #5984, #5991, #5997)
- **Ưu tiên nguồn gốc**; nguồn phụ **chỉ để dẫn đường**; **mâu thuẫn phải hiện thành bảng đối chiếu** (#5962).
- **Bốn tầng** (#5983):
  - **Trên tầng 1**: tài liệu **do chủ nhà đưa vào** (ghi rõ "do chủ nhà cung cấp").
  - **Tầng 1 — bản gốc chính thống**: văn bản luật, cổng nhà nước (vanban.chinhphu.vn, kcb.vn, .gov.vn), tài liệu chính thức của hãng, paper có DOI/arXiv, kho mã chính chủ.
  - **Tầng 2 — báo chí chính thống**: Báo Chính phủ, Nhân Dân, TTXVN/VietnamPlus, VOV/VTV, toà soạn lớn (VnExpress, Tuổi Trẻ, Thanh Niên).
  - **Tầng 3 — chuyên môn thứ cấp**: blog kỹ thuật có tên tác giả, wiki, diễn đàn chuyên môn, trang tổng hợp có dẫn nguồn.
  - **Tầng 4 — không xác thực**: mạng xã hội cá nhân, trang tổng hợp vô danh, nội dung không tác giả/ngày.
- **Báo chí vs bản gốc** (#5984): báo chính thống **đủ cho sự kiện**; khẳng định về **nội dung văn bản** phải **trỏ bản gốc nếu mở được**; không mở được thì **ghi rõ "chưa mở được bản gốc"**.
- **Trang chính thức của cơ quan trên mạng xã hội** (#5991 + #5997): **được dùng**, ghi rõ ("đăng trên Facebook của Sở Y tế"), coi **ngang chính thống**; nhưng **phải xác nhận nhiều vòng** — **đủ khi hai nơi uy tín KHÁC NHAU cùng đăng cùng nội dung** (ví dụ fanpage của Sở + trang web của Sở, hoặc báo chính thống nhắc lại); nếu tìm được bản trên web thì **luôn ưu tiên bản web**.

### 2.7 Số nguồn & tính độc lập (#5985, #5996)
- **Khẳng định then chốt cần HAI nguồn độc lập**, **trừ tầng 1** (một nguồn là đủ). "Then chốt" = số liệu, điều luật, giá cả, tên riêng, ngày tháng.
- **Hai nơi cùng đăng một tin tính là MỘT nguồn**; muốn tính hai thì **phải khác nguồn tin gốc** (con phải khai "nguồn: TTXVN"); con phản biện ở mức 3 kiểm lại phần khai này.

### 2.8 Hồ sơ việc — **ba nhóm**, mỗi nhóm có usecase con (#5987, #5988, #5989, #5994, #5995)
- **Nhóm 1 — Văn bản chính thống**: luật, tài chính, y tế.
- **Nhóm 2 — Học thuật và kỹ thuật**: paper, tài liệu hãng, kho mã.
- **Nhóm 3 — Thị trường**: giá, đối thủ, người dùng.
- Cộng dạng đặc biệt: **tài liệu do chủ nhà đưa vào**.
- **Mỗi usecase con có bộ trường bắt buộc RIÊNG** để không xung đột (ví dụ đọc paper **không** cần ngày hết hạn/hiệu lực).
- Hiệu lực văn bản: **bắt buộc ghi số hiệu + ngày hiệu lực + dấu còn/hết hiệu lực khi trích điều luật**, bản hết hiệu lực vẫn dùng được nhưng phải nói rõ là bản cũ (#5987) — **chỉ áp cho usecase cần** (luật; văn bản y tế/tài chính tuỳ loại), **không** áp cứng cho học thuật và các usecase khác.
- **Cứng với trường then chốt của hồ sơ đó** (luật: số hiệu + hiệu lực; học thuật: DOI/mã + năm; giá: ngày lấy giá), **mềm phần còn lại** (#5989).
- **Main tự quyết hồ sơ việc và nói rõ trong báo cáo** cho chủ nhà đọc (#5995).

### 2.9 Lớp đọc nguồn & terminal (#5963, #5977)
- **Cả hai**: công cụ natively là **đường chính**; **terminal có kiểm soát** là đường phụ.
- Terminal: chủ nhà **bỏ qua, giao tôi tự quyết** ⇒ quyết định: **danh sách trắng hẹp trong box** (curl/wget tải tệp, chạy script có sẵn của skill, đọc/ghi trong workspace; **không cài gói**), đường chính vẫn ở phía máy chủ.

### 2.10 Khoá API (#5978)
- **Chưa mua**: dùng keyless trước, **chừa sẵn chỗ cắm khoá**, kèm hàng dự phòng nhiều nhà cung cấp + tự thử lại khi bị chặn.

## 3. CÒN ĐỂ MỞ — sẽ phỏng vấn tiếp (chủ nhà yêu cầu rõ ở #5998)
Chủ nhà nói: *"chúng ta mới xong cho phần luật, y tế,... còn thị trường và paper/kỹ thuật, phương pháp thì chưa. tạo plan trước, ghi vào plan trước rồi tiếp tục interview, vì đây là big update đặc biệt quan trọng"*.
1. **Nhóm 3 — Thị trường**: nguồn gốc là gì (trang giá, báo cáo thị trường, hồ sơ doanh nghiệp?), trường bắt buộc (ngày lấy giá? khu vực? phân khúc?), cách xử lý số liệu ước lượng/khảo sát, ngưỡng "đủ kỹ".
2. **Nhóm 2 — Học thuật & kỹ thuật**: trường bắt buộc cho paper (DOI/mã, năm, venue, tác giả), luật săn đuổi trích dẫn ở mức 3 (bão hoà bao nhiêu vòng), tài liệu hãng/phiên bản, cách đọc PDF/bảng biểu.
3. **Phương pháp nghiên cứu**: bốn pha (bản đồ → chốt → đào sâu → phản biện) chạy cụ thể thế nào; số nhánh con tối đa theo mức; trần thời gian/chi phí mặc định cho từng mức; nhịp kiểm chứng; hình dạng mẫu của hồ sơ từng mức; cách chủ nhà nới trần.

## 4. Số đo đã có (không phải giả định)
Chi tiết ở `/var/tmp/v27/feasibility-probes.md`; tóm tắt:
- `web_fetch` hôm nay: Báo Nhân Dân/Báo Chính phủ/VietnamPlus trả **rác nhị phân gzip** (17.421 / 46.692 / 37.798 ký tự) và **không thử đầu đọc** vì rác dài hơn ngưỡng 200; `vbpl.vn` trả **trang 404 giả** (14.529 ký tự); `moh.gov.vn` **hết thời gian chờ**; `thuvienphapluat.vn` **403 cứng**; `kcb.vn` tốt (9.217 ký tự); `vanban.chinhphu.vn` qua đầu đọc tốt (13.830 ký tự).
- `docs.python.org/3/whatsnew/3.13.html`: extract 113.936 ký tự → chỉ 8.000 ký tự tới model (7%), là navigation chrome, **không có offset**.
- Đầu đọc keyless: PDF arXiv 15 trang → 40.895 byte markdown; tài liệu dài → 246.696 byte trong một lời gọi ⇒ nút thắt là **phía ta** (8.000).
- Nguồn học thuật keyless: OpenAlex 200 (`referenced_works`, `filter=cites:` OK), arXiv 200 (chập chờn: 406 rồi 200), Europe PMC 200; **Semantic Scholar 429 lặp lại**, Crossref chập chờn.
- Tìm kiếm: **một** nhà cung cấp general keyless (Firecrawl); `site:` **chạy được**; kết quả lẫn YouTube/Facebook.
- Hợp đồng delegation: con nhận goal+context(16.000)+expect(2.000); con trả **8.000** ký tự; research **không có `file_write`**; trần con 40 step/420 s; 12 con/lượt; fan-out 3/6/8.
- Trong box **không có** pdftotext/tesseract/pypdf/pdfplumber/bs4/lxml; chỉ có curl/wget/node.

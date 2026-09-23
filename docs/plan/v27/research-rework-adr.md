# ADR — Cải tổ research agent và công cụ tìm kiếm (Vòng 27)

**Trạng thái:** các phần đã chốt (luật, y tế, tài chính; thang nguồn; số nguồn; đầu ra; điều phối) **đã được chủ nhà
duyệt bằng 12 vòng phỏng vấn** (#5955–#6020). **Thị trường, học thuật/kỹ thuật, đọc FULL, luật gap, hình dạng hồ sơ và bảng
MỞ: ĐÃ CHỐT** (vòng 9–12, xem §C-bis). Mảng **phương pháp** còn hai mục: **trần thời gian** và **nhịp kiểm chứng** — chủ nhà
yêu cầu *"tạo plan trước, ghi vào plan trước rồi tiếp tục interview"* (#5998).

**Ngày:** 2026-09-23 · **Nhánh:** `vorflux/v22-peer-mesh` · **HEAD khi viết:** `2add905`

**Bối cảnh ngắn.** Các research agent hiện nay chỉ tìm phần nổi bật, không tìm kỹ từng phần chi tiết và liên quan.
BoxFox đánh vào điểm này. Yêu cầu nguyên văn của chủ nhà: *"nhanh - chính xác và đặc biệt là phải thật kỹ, tương tự như
nhà nghiên cứu thực thụ và chuyên nghiệp"*; đây là *"big update lớn nhất"*. Kiến trúc đã có sẵn: **main chỉ điều phối,
con research làm việc nặng** (#5957).

---

## A. Quyết định về kiến trúc

| ID | Quyết định | Vì sao | Hệ quả |
|---|---|---|---|
| A-1 | **Ba mức nghiên cứu** (1 trả lời nhanh · 2 báo cáo có nguồn · 3 hồ sơ sâu có kiểm chứng chéo + phản biện) | Chủ nhà chốt ba mức (#5960) | Mỗi mức có hình dạng đầu ra và ngân sách riêng |
| A-2 | **Một con số mức cho cả việc**; main chọn theo tín hiệu trong yêu cầu; **mơ hồ ⇒ mức 2** | Tránh mỗi nhánh con một mức khác nhau gây lệch chất lượng (#5965) | Mức là thuộc tính của *việc*, không của từng nhánh |
| A-3 | **Đọc nguồn là bắt buộc ở mọi mức**; "đọc" = mở thật + lấy đoạn liên quan + **lưu đoạn trích nguyên văn** | Chủ nhà chốt (#5960, #5966); đúng kỹ thuật đã ghi trong pitfall của skill `grounded-citations` | Cấm kiểu *trích snippet như đã đọc* ở mọi mức, kể cả mức 1 |
| A-4 | **Bốn pha**: bản đồ → chốt → đào sâu → **phản biện độc lập** | Chủ nhà chốt (#5955); pha 4 dùng lại khuôn `plan-review` đã có từ vòng 25 | Pha 4 là điều kiện của mức 3 |
| A-5 | **Mức 3 luôn có săn đuổi trích dẫn** (lùi theo danh mục tham chiếu + tiến theo bài trích dẫn) **và tiêu chí dừng kiểu bão hoà** | Chủ nhà chốt (#5967); đúng chuẩn systematic literature review (snowballing + saturation) | Cần nguồn học thuật có đồ thị trích dẫn (OpenAlex `referenced_works` + `filter=cites:`) |

## B. Quyết định về nguồn và bằng chứng

| ID | Quyết định | Vì sao | Hệ quả |
|---|---|---|---|
| B-1 | **Bốn tầng nguồn**, và **tài liệu do chủ nhà đưa vào xếp TRÊN cả tầng 1** | Chủ nhà chốt; tài liệu nội bộ là gốc đáng tin nhất với chủ nhà (#5983) | Phải ghi rõ "do chủ nhà cung cấp"; không tự suy diễn tầng cho tài liệu nội bộ |
| B-2 | **Tầng 1 (bản gốc chính thống) một nguồn là đủ** cho mọi khẳng định; **các tầng khác cần hai nguồn độc lập** cho khẳng định then chốt | Chủ nhà chọn phương án chặt hơn đề xuất (#5985) | Gate phải phân biệt "một nguồn tầng 1" và "hai nguồn độc lập" |
| B-3 | **Hai nơi cùng đăng một tin tính là MỘT nguồn**; muốn tính hai thì **phải khác nguồn tin gốc** | Chủ nhà chốt (#5996); bản chép lại của ba tờ báo không phải ba nguồn | Con research phải khai dòng "nguồn tin gốc"; con phản biện mức 3 kiểm lại dòng khai đó |
| B-4 | **Báo chí chính thống đủ cho sự kiện**; khẳng định về **nội dung văn bản** phải trỏ bản gốc nếu mở được, không mở được thì **ghi rõ "chưa mở được bản gốc"** | Chủ nhà chốt (#5984) | Hồ sơ phải có trường "đã mở bản gốc chưa" — không được im lặng |
| B-5 | **Trang chính thức của cơ quan trên mạng xã hội được dùng**, ghi rõ, **ngang chính thống**, nhưng **đủ khi hai nơi uy tín KHÁC NHAU cùng đăng cùng nội dung** | Chủ nhà chốt qua hai vòng (#5991, #5997) | Luật máy kiểm được: hai chủ thể khác nhau, cùng nội dung; nếu có bản trên web thì ưu tiên bản web |
| B-6 | **Mâu thuẫn giữa các nguồn phải hiện thành bảng đối chiếu**; nguồn phụ chỉ **dẫn đường**, ưu tiên nguồn gốc | Chủ nhà chốt (#5962) | Đầu ra mức 3 phải có bảng mâu thuẫn, không được "chọn bên nào dễ" |
| B-7 | **Hồ sơ việc: ba nhóm** (văn bản chính thống: luật/tài chính/y tế · học thuật + kỹ thuật · thị trường) + dạng đặc biệt "tài liệu chủ nhà đưa vào"; **mỗi usecase con có trường bắt buộc riêng** | Chủ nhà chốt (#5988, #5994); "tối ưu riêng cho từng usecase để tránh conflict" | Bảng hồ sơ khai báo trong mã, không nhét một khuôn chung |
| B-8 | **Cứng với trường then chốt của hồ sơ đó, mềm phần còn lại**: luật ⇒ số hiệu + hiệu lực; học thuật ⇒ DOI/mã + năm; giá ⇒ ngày lấy giá | Chủ nhà chốt (#5989) | Gate mức 3 chỉ chặn trường then chốt, không chặn trường phụ |
| B-9 | **Hiệu lực văn bản chỉ áp cho usecase cần** (luật; văn bản y tế/tài chính tuỳ loại) — **không** áp cứng cho học thuật và usecase khác | Chủ nhà chốt (#5987); đọc paper không cần ngày hết hiệu lực | Luật "bản hết hiệu lực vẫn dùng được nhưng phải nói rõ là bản cũ" nằm trong hồ sơ luật |
| B-10 | **Main tự quyết hồ sơ việc và nói rõ trong báo cáo** cho chủ nhà đọc | Chủ nhà chốt (#5995); không tốn một vòng hỏi đáp cho việc nhỏ | Báo cáo mở đầu bằng "việc này tôi xếp nhóm …"; chủ nhà đọc thấy sai thì bảo sửa |

## C. Quyết định về vận hành

| ID | Quyết định | Vì sao | Hệ quả |
|---|---|---|---|
| C-1 | **Chỉ main nói với chủ nhà**; con research không hỏi trực tiếp (giữ nguyên luật đã có) | Chủ nhà chốt (#5961) | Không mở đường hỏi mới cho con |
| C-2 | **Main tự chia nhánh theo từng việc**, có **danh mục nhắc trong skill**; **việc liên quan nhau thì gộp một con** làm cả hai | Chủ nhà chốt (#5982) | Skill phải có danh mục; fan-out vẫn theo trần hiện tại |
| C-3 | **Nhịp báo tiến độ theo mốc** (mỗi nhánh con xong hoặc ~10 phút) | Chủ nhà chốt (#5969) | Báo cáo là **văn bản model viết**, không thêm khối/dải/huy hiệu (D-19–D-25) |
| C-4 | **Can thiệp giữa lúc chạy bằng gõ câu lệnh trong chat** ("dừng nhánh luật", "hạ xuống mức 2", "bỏ phần khảo sát giá") | Chủ nhà chốt (#5981) | Cần đường đọc lệnh mới của chủ nhà khi lượt đang chạy |
| C-5 | **Main đề xuất mức + trần thời gian/chi phí**; **việc lớn chủ nhà bấm duyệt**; việc nhỏ chạy luôn theo mặc định | Chủ nhà chốt (#5964) | Dùng lại cơ chế duyệt sẵn có, không dựng cơ chế mới |
| C-6 | **Phản biện độc lập bằng con riêng**; verdict **`revise` chặn MỘT vòng**; sau đó vẫn `revise` thì **giao hồ sơ kèm nhãn chưa đạt** | Chủ nhà chốt (#5968) | Không treo việc vô hạn; nhãn chưa đạt là thông tin cho chủ nhà |
| C-7 | **Đầu ra 100% là TỆP**; chat **chỉ có báo cáo ngắn của main** (đã làm gì, được gì, chặn gì, vướng gì) | Chủ nhà chốt (#5973, #5980) | Đây là thay đổi lớn nhất về hợp đồng delegation: con research hiện **không có `file_write`** và câu trả lời bị cắt 8.000 ký tự ⇒ phải sửa |
| C-8 | **Chưa mua khoá tìm kiếm**: dùng keyless trước, **chừa sẵn chỗ cắm khoá**, hàng dự phòng nhiều nhà cung cấp, tự thử lại khi bị chặn | Chủ nhà chốt (#5978) | Phải thiết kế lớp nhà cung cấp có thể cắm thêm, và chọn keyless làm mặc định |
| C-9 | **Terminal trong box chỉ danh sách trắng hẹp** (curl/wget tải tệp, chạy script có sẵn của skill, đọc/ghi workspace; **không cài gói**); đường chính vẫn là công cụ phía máy chủ | Chủ nhà bỏ qua, giao tôi tự quyết (#5977) | Không mở shell tự do cho con research |

## C-bis. Chốt bổ sung vòng 9–11 — thị trường, học thuật/kỹ thuật, đọc FULL, đếm nỗi đau (#5999–#6014)

| ID | Quyết định | Vì sao | Hệ quả |
|---|---|---|---|
| A-6 | **Thang đọc FULL năm tầng**: HTML chính chủ → toàn văn XML/JATS → **PDF + `pdfplumber`** → đầu đọc **chỉ cho chữ** → ảnh trang là đường cuối | Đo `probe8.py`: bản HTML arXiv giữ **10 bảng thật**; Europe PMC giữ **6 bảng** trong XML; đầu đọc trên PDF **mất sạch bảng** (0 dòng có `\|`); `pdfplumber` dựng lại **10 bảng**; chủ nhà chốt #6010 | Thang đọc nằm **trong** thang dự phòng đợt 1–3; khẳng định dựa vào bảng phải ghi nguồn bảng; bảng dựng lại ghi "bảng trích tự động" |
| A-7 | **Thêm hai thư viện phía MÁY CHỦ**: `pdfplumber` (bắt buộc) + `pypdfium2` (khi cần dựng ảnh trang) | Chủ nhà cho phép #6011; box vẫn **không cài gì** (đường chính ở máy chủ) | Sửa câu "không thêm thư viện ngoài" của kế hoạch v1: thư viện ngoài **được phép ở máy chủ**, vẫn **cấm ở box** |
| B-11 | **Luật gap hai tầng số**: **sàn** ≥20 lượt / ≥10 cùng chủ đề / ≥2 nền tảng + 1 nguồn tổng hợp để gọi "gap đã kiểm" (#6013); **đích** 30–50 lượt / ≥15 / ≥3 nền tảng khi dữ liệu đủ (#6012) | Hai câu trả lời của chủ nhà ở vòng 10 và 11 nhìn nhau: ngưỡng giữ nguyên, *nỗ lực lấy mẫu* thì chặt hơn | Máy đếm được cả hai tầng; hồ sơ ghi rõ đang ở tầng nào |
| B-12 | **Thiếu mẫu ⇒ phải biết, không deadlock**: ghi **"tín hiệu, chưa kiểm"** + lý do cụ thể; số nền tảng/vòng thử **có trần**; hết trần ⇒ kết luận và đi tiếp | Chủ nhà nói rõ ở #6012 (*"không đủ mẫu thì phải biết để tránh deadlock"*) | Cần một bộ đếm thử có trần trong `research_quality` + câu khắc phục "không đủ mẫu vì …" |
| B-13 | **Nhóm học thuật/kỹ thuật**: paper cần **mã bài + năm + nơi công bố + tác giả + đã mở toàn văn** (#6002) và **căn cứ trích từ thân bài, số liệu lấy từ bảng/hình** (#6003); tài liệu hãng & kho mã cần **phiên bản/tag hoặc commit + ngày truy cập**, ghi rõ là tài liệu hãng (#6014) | Chủ nhà chốt hai vòng 9 và 11 | Sổ nguồn thêm trường *loại bản đã đọc* (`html` · `jats` · `pdf-table` · `reader-text` · `page-image`) + trường phiên bản/commit |
| C-10 | **Danh mục thị trường giữ đủ 10 usecase TM-1…TM-10**; **TM-3 dùng archetype C2′** (đếm → mẫu → luật); **TM-2 trần đối thủ 10–15** | Chủ nhà chốt #6005, #6006, #6007 (*"thị trường Việt Nam nhiều đơn vị nhỏ"*) | Bảng khai báo usecase sửa: C2′ + trần 10–15 (không sửa luật trong mã) |
| C-11 | **Bão hoà săn đuổi trích dẫn ở mức 3: 3 vòng liên tiếp không thêm bài mới** (không phải 2) | Chủ nhà chốt #6008 | Ngưỡng nằm trong bảng khai báo; ca `R4` chấm theo 3 vòng |
| C-12 | **Số ước lượng/khảo sát chỉ dùng khi ghi rõ** "ước lượng · ai ước lượng · năm nào · cỡ mẫu nếu có" **+ nơi thứ hai cùng nói** | Chủ nhà chốt #6000 | Trường bắt buộc của nhóm thị trường (TM-4/TM-5/TM-8) |
| B-14 | **Luật gap hai tầng số CHỐT** (cách ghép #6012 + #6013): sàn 20/10/≥2 + 1 nguồn tổng hợp cho **mọi việc**; đích 30–50/≥15/≥3 khi mức 3 hoặc khi dữ liệu đủ; hết trần thử ⇒ kết luận và đi tiếp | Chủ nhà xác nhận #6016 | Một luật máy duy nhất, hai tầng số; mã lỗi riêng cho "tín hiệu, chưa kiểm" |
| C-13 | **Nhánh con chạy theo SÓNG 3–5**; hết sóng mới mở sóng tiếp; **không mở toàn bộ cùng lúc** | Chủ nhà chốt #6017: *"…3 đến 5 sub agent, xong việc thì spam tiếp dạng parallel, chứ không spam cùng lúc toàn bộ vì gây lag box"* | Bộ điều phối sóng nằm trong luồng mức (đợt 5); ca `R10` kiểm nhánh đồng thời |
| C-14 | **Hồ sơ 1/3/6 tệp CHỐT** + `review.md` ghi **hai loại phản biện**: (a) kiểm lại nguồn (gửi con check tiếp), (b) **soi ý kiến/giả định của chủ nhà** | Chủ nhà chốt #6019 | Đợt 4 (hồ sơ) + đợt 6 (pha phản biện) thêm trường `loai_phan_bien` |
| C-15 | **Bảng MỞ-A…MỞ-H: duyệt nguyên bảng**, riêng **MỞ-C đổi hướng**: **không mua khoá** — **tự dựng công cụ tìm kiếm/tải** trong harness; chỗ cắm khoá giữ trong mã nhưng **mặc định tắt** | Chủ nhà chốt #6020: *"cần tự build tool search, fetch, ... thay vì mua key gây tốn kém"* | Đợt 2 (tìm kiếm) đổi trọng tâm sang công cụ tự dựng; hình dạng chốt vòng 13 |
| C-16 | **Trần thời gian phải phụ thuộc việc** — chủ nhà không nhận câu hỏi dạng trần cứng theo mức | Chủ nhà #6018: *"còn tùy task nó nghiên cứu, main cũng thế"* | Vòng 13 phải hỏi lại bằng ví dụ ba loại trần (lượt · con · ngân sách việc) |



| Số đo | Kết quả |
|---|---|
| `web_fetch` với Báo Nhân Dân / Báo Chính phủ / VietnamPlus | **rác nhị phân gzip**: 17.421 / 46.692 / 37.798 ký tự, không thử đầu đọc (rác dài > ngưỡng 200) |
| `vbpl.vn` (chi tiết nghị quyết) | http=200 nhưng nội dung là **ảnh trang 404** (14.529 ký tự) |
| `moh.gov.vn` | **hết thời gian chờ**; qua đầu đọc chỉ 165–259 byte "chưa tải xong" (thành công giả) |
| `thuvienphapluat.vn` | **403 cứng**, không thử đầu đọc |
| `vanban.chinhphu.vn` (Luật Khám bệnh, chữa bệnh) | qua đầu đọc: 13.830 ký tự, có tiêu đề ⇒ **đọc được toàn văn không cần khoá** |
| `docs.python.org/3/whatsnew/3.13.html` | extract 113.936 → model chỉ nhận **8.000** (7%), là navigation chrome; **không có `offset`** |
| Đầu đọc keyless với PDF arXiv 15 trang | **40.895 byte markdown** ⇒ PDF đọc được, không cần thư viện PDF |
| Đầu đọc keyless với tài liệu dài | **246.696 byte trong một lời gọi** ⇒ nút thắt 8.000 là **của phía ta** |
| OpenAlex | 200; `referenced_works` (lùi) + `filter=cites:` (tiến, đo `count=1255`) |
| arXiv API / Europe PMC / Crossref / Semantic Scholar | 200 (arXiv chập chờn 301/406) / 200 / chập chờn 429→200 / **429 lặp lại** |
| Firecrawl keyless + `site:` | 200; `site:vbpl.vn …` chạy; kết quả tiếng Việt lẫn YouTube/Facebook |
| Hợp đồng delegation | con nhận goal+context(16.000)+expect(2.000); **trả 8.000**; research **không có `file_write`** |
| **Đo bổ sung vòng 10–11 — `probe8.py`, 2026-09-23** | |
| arXiv HTML chính chủ (`arxiv.org/html/1706.03762v7`) | **200**, 188.707 byte, tiêu đề đúng, **10 `<table>`** + 9 `<figure>`, có MathML |
| Europe PMC `fullTextXML` (PMC13524156) | **200**, 102.171 byte, 22 `<sec>`, **6 `<table-wrap>`** |
| Đầu đọc r.jina.ai trên PDF arXiv | 200, 40.895 byte chữ tốt, **0 dòng có `\|`** ⇒ **bảng mất** |
| `pdfplumber` trên PDF gốc (venv riêng) | 15 trang, 35.511 ký tự, **10 bảng** `[9×39] [11×59] …`; dòng tiêu đề nhiều tầng **có thể lệch** ⇒ phải ghi "bảng trích tự động" |


## E. Hệ quả kiến trúc (tóm tắt)

1. **Lớp công cụ phải sửa trước** — nếu `web_fetch` còn trả rác gzip và không đọc được phần tiếp thì mọi luật
   "đọc nguồn thật" ở trên chỉ là hình thức. Vì vậy **đợt 1 là lớp đọc/tìm**.
2. **Sổ nguồn là xương sống** — mọi luật ở mục B đều kiểm được nhờ sổ: tầng, đoạn trích, ngày lấy, nguồn tin gốc,
   đã mở bản gốc chưa.
3. **Cổng chất lượng cho research là việc mới** — `evidence_gate` hiện không có khái niệm URL/citation và **D-18
   cấm** nhét citation vào đó ⇒ cổng mới nằm ở một chỗ riêng, có công tắc ba mức như các cổng vòng 25.
4. **Hợp đồng delegation phải đổi** — "đầu ra 100% là tệp" không thể thực hiện khi con research không ghi được tệp.
5. **Đo được mới tin** — benchmark research đang trống; không có case + điểm thì không chứng minh được "thật kỹ".

## F. Câu hỏi còn mở (sẽ phỏng vấn tiếp)

1. **Trần thời gian (vòng 13):** ba loại trần — **trần lượt** (cả lượt chat, hiện 1 200 s) · **trần con** (mỗi nhánh, hiện
   `min(420 s, cha)`) · **ngân sách việc** (tổng thời gian/token của một việc, dùng cho nút xin duyệt) — hỏi lại **bằng ví dụ**
   vì chủ nhà chốt *"còn tùy task"* (#6018).
2. **Số sóng nhánh mỗi mức** (sóng 3–5 đã chốt ở #6017; tổng số sóng còn tuỳ việc).
3. **Hình dạng công cụ tìm kiếm/tải tự dựng** (chỉ thị #6020: không mua khoá).
4. **Nhịp kiểm chứng:** pha 4 chạy cho mức nào; **khi nào bật phản biện ý kiến chủ nhà** (#6019).
5. **Cách chạy bốn pha:** cổng giữa các pha (nếu còn cần chốt).
6. **Hai mục nhỏ của thị trường** (không chặn): ảnh chụp trang giá kèm hồ sơ; luật cross-nhóm (đã có #5995 làm mặc định).

## G. Ràng buộc không được phá

- D-18 (không citation vào `evidence_gate`) · D-19–D-25 (không khối/dải/huy hiệu quanh câu trả lời cuối) ·
  D-26–D-32 (hình dạng sống trong skill) · D-11/D-12/D-13/D-14 · R10-6 (không âm thầm bỏ `web_*` của orchestrator) ·
  §5(1) không thêm giá trị `status` mới của phiên · §5(5) `events()` trần 500 hàng.
- Không rebuild box; không restart/kill tiến trình chủ nhà; mọi sửa tệp backend/docs giữ nguyên CRLF/LF theo tệp.

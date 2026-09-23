# ADR — Cải tổ research agent và công cụ tìm kiếm (Vòng 27)

**Trạng thái:** các phần đã chốt (luật, y tế, tài chính; thang nguồn; số nguồn; đầu ra; điều phối) **đã được chủ nhà
duyệt bằng 8 vòng phỏng vấn** (#5955–#5997). Ba mảng **thị trường**, **học thuật/kỹ thuật**, **phương pháp** còn mở —
chủ nhà yêu cầu *"tạo plan trước, ghi vào plan trước rồi tiếp tục interview"* (#5998).

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

## D. Bằng chứng đo được (đợt đo 2026-09-23, không dùng khoá API)

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

1. **Thị trường**: nguồn gốc hợp lệ, trường bắt buộc (ngày lấy giá, khu vực, phân khúc), xử lý số ước lượng.
2. **Học thuật/kỹ thuật**: trường bắt buộc của paper, ngưỡng bão hoà khi săn đuổi trích dẫn, tài liệu hãng/phiên bản.
3. **Phương pháp**: cách chạy bốn pha, số nhánh tối đa theo mức, trần thời gian/chi phí mặc định, hình dạng hồ sơ từng mức,
   cách chủ nhà nới trần.

## G. Ràng buộc không được phá

- D-18 (không citation vào `evidence_gate`) · D-19–D-25 (không khối/dải/huy hiệu quanh câu trả lời cuối) ·
  D-26–D-32 (hình dạng sống trong skill) · D-11/D-12/D-13/D-14 · R10-6 (không âm thầm bỏ `web_*` của orchestrator) ·
  §5(1) không thêm giá trị `status` mới của phiên · §5(5) `events()` trần 500 hàng.
- Không rebuild box; không restart/kill tiến trình chủ nhà; mọi sửa tệp backend/docs giữ nguyên CRLF/LF theo tệp.

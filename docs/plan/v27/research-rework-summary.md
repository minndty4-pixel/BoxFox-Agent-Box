# Vòng 27 — Cải tổ research agent và công cụ tìm kiếm (bản tóm tắt)

> **Ý chính một câu:** BoxFox hôm nay **có** công cụ tìm kiếm nhưng **không đọc được nguồn cho tử tế** — tài liệu nén
> trả về rác, tài liệu dài chỉ lộ 7 %, trang lỗi vẫn tính là thành công, con nghiên cứu không ghi được tệp, không có sổ
> nguồn, không có cổng nào kiểm nguồn và không có vòng phản biện. Kế hoạch này sửa đúng chuỗi đó theo **tám đợt**:
> đọc thật → đọc trọn → sổ nguồn → hồ sơ việc + cổng → ba mức + bốn pha → phản biện độc lập → can thiệp giữa lượt +
> duyệt ngân sách → skill & đo lường.

## Chủ nhà đặt hàng gì

*"Nhanh – chính xác và đặc biệt là phải thật kỹ, tương tự như nhà nghiên cứu thực thụ và chuyên nghiệp"*. Đây là
**big update lớn nhất**. Trong BoxFox, **main chỉ điều phối**, còn việc nặng là của **con research**.

## Bằng chứng đo được (làm căn cứ, không phải phỏng đoán)

| Đo được | Số |
|---|---|
| Ba báo chính thống trả **rác nhị phân** vì không giải nén | Nhân Dân 17 421 · Báo Chính phủ 46 692 · VietnamPlus 37 798 ký tự |
| Tài liệu dài bị cắt phía ta | trích được 113 936 ký tự, model chỉ thấy **8 000 (7 %)** và đó là điều hướng |
| Đầu đọc dự phòng gần như không bao giờ chạy | chỉ khi thân bài < 200 ký tự; 403 và mọi PDF bị chặn trước đó |
| **Thành công giả** | `moh.gov.vn` 165–259 ký tự; `vbpl.vn` trả tiêu đề "Trang chủ" và một trang 404 giả |
| Đầu đọc keyless đọc được PDF và cả tài liệu dài | PDF 15 trang ⇒ 40 895 byte; một tài liệu ⇒ 246 743 byte |
| Nguồn học thuật keyless | OpenAlex chạy (lùi n=54, tiến count=1255); Europe PMC chạy; Crossref/arXiv chập chờn; Semantic Scholar 429 lặp lại |
| Tìm kiếm còn **một chân** | chỉ Firecrawl keyless; `site:` chạy; không retry, không cache, không khử trùng |
| Con nghiên cứu không ghi được tệp, câu trả lời cắt **8 000** ký tự | hồ sơ dài không bao giờ về tới main |
| Không cổng nào kiểm nguồn, không vòng phản biện nào cho nghiên cứu | — |
| **Không có case đo** | thư mục ca benchmark rỗng; judge còn `NotImplementedError` |

## Đã chốt (25 quyết định qua 11 vòng phỏng vấn — ghi đủ trong ADR kèm kế hoạch)

Ba mức nghiên cứu với **một con số mức cho cả việc** (mơ hồ ⇒ mức 2) · **đọc nguồn bắt buộc ở mọi mức** (mở thật, lấy
đoạn liên quan, lưu trích nguyên văn) · **bốn pha** bản đồ → chốt → đào sâu → **phản biện độc lập** · mức 3 luôn **săn
đuổi trích dẫn** (lùi + tiến) tới **bão hoà** · **thang nguồn 4 tầng**, tài liệu chủ nhà **trên tầng 1** · **hai nguồn
độc lập cho khẳng định then chốt, trừ tầng 1** · **hai nơi cùng đăng một tin = MỘT nguồn** (phải khác nguồn tin gốc) ·
**báo chí đủ cho sự kiện**, nội dung văn bản phải trỏ bản gốc hoặc ghi rõ "chưa mở được bản gốc" · **trang chính thức
của cơ quan trên mạng xã hội dùng được** nhưng phải có **nơi thứ hai cùng nội dung** · **ba nhóm hồ sơ việc** với trường
bắt buộc riêng, cứng trường then chốt, mềm phần còn lại · **chỉ main nói với chủ nhà**, main chia nhánh, việc liên quan
gộp một con · **báo tiến độ theo mốc** (mỗi nhánh con xong hoặc ~10 phút) và **chủ nhà gõ lệnh giữa lúc chạy** ·
**ngân sách do main đề xuất, việc lớn có nút duyệt** · **đầu ra 100 % là TỆP**, chat chỉ có báo cáo ngắn · **chưa mua
khoá tìm kiếm** (keyless trước, chừa chỗ cắm khoá, nhiều chân dự phòng) · terminal trong box chỉ **danh sách trắng hẹp**.

**Chốt bổ sung ở vòng 9–11 (bản 2):** **thang đọc FULL năm tầng** — HTML chính chủ → toàn văn XML/JATS → **PDF + `pdfplumber`**
→ đầu đọc **chỉ cho chữ** → ảnh trang là đường cuối (đo được: bản HTML giữ 10 bảng, đầu đọc trên cùng bài giữ **0**);
**luật gap hai tầng số** — sàn **20 lượt/10 cùng chủ đề/≥2 nền tảng + 1 nguồn tổng hợp**, đích **30–50/15/≥3** khi dữ liệu
đủ, **thiếu mẫu ⇒ ghi "tín hiệu, chưa kiểm" + lý do và đi tiếp** (không deadlock); **bão hoà săn đuổi trích dẫn 3 vòng**;
**trần đối thủ 10–15**; paper cần **mã bài + năm + nơi công bố + tác giả + đã mở toàn văn**, căn cứ **trích thân bài**, số
liệu **lấy từ bảng/hình**; tài liệu hãng & kho mã cần **phiên bản/tag hoặc commit + ngày truy cập**; số ước lượng phải ghi
**ai ước lượng · năm nào · cỡ mẫu** + nơi thứ hai cùng nói.

## Kế hoạch đổi gì, theo ba lớp

**Lớp đọc (đợt 1–2).** Tải thô nay xin nén và **giải nén** (có trần chống bom nén). Một lớp **kiểm thân bài** mới phán
sáu kết luận — đủ, thiếu chữ, rác, trang lỗi, sai trang, rỗng — dựa trên **chỉ số rác đo được** (rác 0,52–0,55 so với
văn bản thật 0,0000). **Thang đọc FULL năm tầng** (chốt #6010): HTML chính chủ → toàn văn XML/JATS → **PDF + `pdfplumber`
phía máy chủ** → đầu đọc **chỉ cho chữ** → ảnh trang là đường cuối; bảng dựng lại phải mang nhãn **"bảng trích tự động"**.
Một **bộ đệm đọc** giữ bản đã tải để **đọc theo đoạn**: tài liệu 113 936 ký tự đọc trọn bằng 6 lời gọi thay vì một lời
gọi 7 %; tệp trong box cũng đọc theo đoạn. Tìm kiếm: nhiều truy vấn một lượt, khử trùng, lọc theo `site:`/thời gian/ngôn
ngữ, cache ngắn, tự thử lại, và **ba chân keyless** + chỗ cắm khoá (Brave/Tavily đã có mã).

**Lớp sổ nguồn (đợt 3–4, 6).** Mỗi khẳng định vào **sổ nguồn**: URL · đoạn trích nguyên văn · ngày lấy · tầng ·
**nguồn tin gốc** · đã mở bản gốc chưa · **loại bản đã đọc** (`html`/`jats`/`pdf-table`/`reader-text`/`page-image`) ·
**phiên bản/tag hoặc commit + ngày truy cập** cho tài liệu hãng & kho mã. **Thang nguồn 4 tầng** (+ tầng riêng cho tài
liệu chủ nhà, + nhánh "trang chính thức của cơ quan") cài cứng trong mã, đổi bằng biến môi trường. **Ba nhóm hồ sơ việc**
với usecase con có trường bắt buộc riêng; bảng khai báo thị trường giữ **10 usecase TM-1…TM-10**, **TM-2 trần đối thủ
10–15**, **TM-3 dùng archetype C2′** (đếm → mẫu → luật hai tầng số, thiếu mẫu ghi "tín hiệu, chưa kiểm").
**Cổng chất lượng riêng cho nghiên cứu** chạy **trước khi ghi hồ sơ**, có công tắc ba mức, không đụng vào
cổng bằng chứng hiện có. Cuối cùng là **pha phản biện**: một con riêng mở lại nguồn, kiểm cả dòng khai "nguồn tin gốc",
kết thúc bằng một dòng máy đọc được; **`revise` chặn MỘT vòng**, còn `revise` thì hồ sơ ra kèm nhãn **"CHƯA ĐẠT" do máy viết**.

**Lớp luồng chạy (đợt 5, 7).** Main chốt **một mức** cho cả việc và xin duyệt khi việc lớn (mức · số nhánh · trần thời
gian/token). Một **công cụ chốt đề bài nghiên cứu** giữ bảng trần theo mức; **skill** giữ danh mục nhắc nhánh và SOP bốn
pha. **Đầu ra 100 % là tệp**: hồ sơ + sổ nguồn (dạng máy đọc) + bản người đọc, nằm trong một phòng riêng của workspace;
chat chỉ còn **báo cáo ngắn** của main kèm **hàng tệp** mở sang panel Tệp. **Nhịp báo tiến độ** theo mốc là văn bản
model viết trong mạch chat (không khối, không dải, không huy hiệu). **Chủ nhà gõ chỉ thị giữa lúc chạy** ("dừng nhánh
luật", "hạ xuống mức 2") — chỉ thị được **xếp hàng và áp ở bước kế**, có dòng xác nhận, và có lệnh dừng một nhánh.

## Đo được "thật kỹ" (đợt 8)

Bảy ca máy chấm: đọc trọn tài liệu dài · trang nén ra văn bản sạch · **không tin `http=200`** · bão hoà săn đuổi trích
dẫn · ba bài chép một tin ⇒ **một** nguồn · bản gốc vs báo cho nội dung văn bản · giao hồ sơ + nhãn phản biện. Kèm một
oracle chạy bằng script và **ghi ngày đo + tệp đo** vào sổ theo dõi. Nói thẳng: **chưa có benchmark**, vòng này tự dựng
thước đo, không khoe số.

## Giao diện (có mockup kèm kế hoạch)

Bốn mặt: **ô nhập khi lượt đang chạy** (nói rõ "xếp hàng · áp ở bước kế") · **mốc tiến độ trong mạch chat** · **báo cáo
cuối + hàng tệp hồ sơ** (kèm câu "việc này tôi xếp nhóm …" và nhãn CHƯA ĐẠT) · **thẻ duyệt việc lớn**. Không màn hình
mới; hồ sơ đọc bằng panel Tệp có sẵn; câu trả lời cuối vẫn chỉ là markdown như đã cam kết.

## Tám đợt

| Đợt | Việc | Dừng khi |
|---|---|---|
| 1 | Giải nén + kiểm thân bài + **thang đọc FULL năm tầng** (HTML/JATS/PDF+`pdfplumber`/đầu đọc/ảnh trang) | ba trang nén sạch; 403/PDF đọc được **kèm bảng**; HTML arXiv giữ **10 bảng**; trang giả **không** ra "ok" |
| 2 | Bộ đệm + đọc theo đoạn (host và box) | đọc trọn tài liệu 113 936 ký tự bằng 6 lời gọi |
| 3 | Sổ nguồn + thang nguồn 4 tầng + **loại bản đã đọc & phiên bản/commit** | chạy lại 5 URL đã đo ra đúng "giả"/"không tới được" |
| 4 | Hồ sơ việc + cổng chất lượng + ghi hồ sơ ra tệp + **bảng thị trường TM-2 10–15 / TM-3 C2′** | 3 ca vi phạm bị **từ chối và không tạo tệp**; gap thiếu mẫu ghi đúng "tín hiệu, chưa kiểm" |
| 5 | Ba mức + bốn pha + nhịp báo mốc + **bão hoà săn đuổi 3 vòng** | một lượt mức 2 và một lượt mức 3 chạy sống |
| 6 | Pha phản biện độc lập + nhãn chưa đạt | 4 ca sống; phản biện giả bị chặn |
| 7 | Chỉ thị giữa lượt + duyệt ngân sách + hai mặt giao diện | gõ "dừng nhánh luật" ⇒ nhánh dừng ở bước kế |
| 8 | Sửa skill chết, hai tài liệu lệch, bộ ca **R1–R9** + oracle | script chấm chạy được, số vào sổ theo dõi |

## Còn mở — sẽ phỏng vấn tiếp

**Phương pháp** (mảng duy nhất còn mở — vòng 12+): số nhánh con tối đa theo mức · trần thời gian mặc định mỗi mức
(+ D-number cho lượt research dài) · hình dạng hồ sơ mẫu mỗi mức · cách chủ nhà nới trần giữa việc · nhịp kiểm chứng.

Cộng bảy câu kỹ thuật MỞ-A…MỞ-H đã có sẵn phương án đề xuất (trần đọc mỗi đoạn · bật mạng trong box · mua khoá nào trước ·
công cụ săn đuổi · mở skill web nào · bộ đệm có ghi ra đĩa không · trần lượt cho mức 3 · trần chi phí USD) — xem §8 kế hoạch.
*Thị trường, học thuật/kỹ thuật và đọc FULL đã chốt ở vòng 9–11.*

## Ràng buộc không phá

Không thêm citation vào cổng bằng chứng hiện có · không khối/dải/huy hiệu quanh câu trả lời cuối · không nới trần ngữ
cảnh (đường dài là đọc theo đoạn) · không tool song song trong một bước · không cho con sinh con · không thêm giá trị
trạng thái mới · không nâng cổng lên `enforce` · không bật mạng cho box, không cài gói **trong box** (máy chủ chỉ thêm
`pdfplumber`), không dựng lại box, không restart tiến trình chủ nhà · cổng chạy **trước khi ghi** và ghi sổ hỏng chỉ
**log rồi đi tiếp**.

## Điều kiện bắt đầu

Duyệt kế hoạch (bản 2) ⇒ đợt 1–3 chạy được ngay (không phụ thuộc mảng phương pháp). Mảng phương pháp phỏng vấn tiếp ở
vòng 12+; chốt xong thì cập nhật **bảng khai báo** và re-submit **bản 3** trước khi thi công các đợt phụ thuộc.

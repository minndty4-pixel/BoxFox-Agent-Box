# Vòng 27 — Danh mục USECASE THỊ TRƯỜNG và tiêu chí "đủ kỹ" (chủ nhà đã chốt #6005/#6006/#6007 — xem Phần 4)

> Chủ nhà nói ở #5999: *"có thể tất cả phần trên, tùy thuộc vào yêu cầu của user, vì thị trường ở đây rất rộng và
> chúng ta cần dần làm rõ, thu hẹp nó lại… Thị trường ở đây không đơn giản, nó còn là **gap, vấn đề mà người dùng hay
> gặp phải, hay than nhiều**, đó cũng tính là thị trường để research"*.
> Và ở #6001: *"usecase này chia ra làm nhiều nhánh… bạn cần **tổng hợp lại tất cả usecase sẽ có và xảy ra**"*.

Tài liệu này làm đúng hai việc đó: **(A)** liệt kê toàn bộ usecase thị trường sẽ gặp, **(B)** đề xuất tiêu chí
"đủ kỹ" cho từng nhóm để chủ nhà chốt. Chốt xong chỉ cần điền **bảng khai báo** trong mã — không đụng luật đã có.

---

## Phần 0 — Ba nhận định nền (rút từ #5999, #6000)

1. **"Nguồn gốc" của thị trường phụ thuộc usecase, không có một thứ tự cứng.** Cùng là "thị trường", nhưng khảo sát giá
   thì bản gốc là **trang niêm yết giá**; khảo sát nỗi đau thì "bản gốc" là **chính lời người dùng**; khảo sát quy mô
   thì bản gốc là **báo cáo của tổ chức có tên**. Vì vậy máy phải chọn **bộ luật nguồn theo usecase**, không áp một
   khuôn.
2. **Thị trường có hai trục, không phải một:**
   - **Trục NGÀNH**: y tế · mua sắm/bán lẻ · tài chính · giáo dục · du lịch · nông nghiệp · phần mềm… (ví dụ của chủ nhà: "thị trường mua sắm", "thị trường trong lĩnh vực y tế").
   - **Trục LOẠI VIỆC**: giá · đối thủ · nỗi đau/gap · quy mô & xu hướng · khách hàng mục tiêu · quy định ảnh hưởng · kênh & đối tác · nhu cầu theo địa bàn · sản phẩm thay thế · niềm tin/cộng đồng.
   Một việc thật thường là **giao của hai trục** (ví dụ: *nỗi đau người bệnh khi chuyển tuyến* = loại việc "nỗi đau" × ngành "y tế").
3. **Số ước lượng đã chốt luật riêng (#6000):** dùng được, nhưng phải ghi **"là ước lượng · ai ước lượng · năm nào ·
   cỡ mẫu nếu có"** và **cần nơi thứ hai cùng nói**; thiếu nơi thứ hai ⇒ ghi UNVERIFIED. Luật này áp cho mọi usecase
   có số liệu, nên bên dưới chỉ nhắc lại chứ không hỏi nữa.

---

## Phần 1 — Danh mục usecase thị trường (10 mục — chủ nhà chốt giữ đủ ở #6005)

Ký hiệu: **TM-x**. Mỗi mục gồm: câu hỏi điển hình · bản gốc hợp lệ (thứ tự ưu tiên) · trường bắt buộc · tiêu chí dừng
(gán vào archetype ở Phần 2) · ranh giới.

### TM-1 · Giá & chính sách giá
- **Điển hình:** "giá dịch vụ X bao nhiêu", "gói khám tổng quát giá thế nào", "giá sản phẩm A trên các kênh".
- **Bản gốc hợp lệ:** (1) trang niêm yết giá của chính hãng/đơn vị cung cấp · (2) hồ sơ/báo cáo tài chính có giá bán bình quân · (3) trang bán hàng lớn (Tiki/Shopee/Lazada/Amazon) khi giá bán lẻ là thứ chủ nhà cần · (4) báo chí chính thống dẫn lại bảng giá.
- **Trường bắt buộc:** giá · **ngày lấy** · khu vực · phiên bản/gói · **đã gồm thuế–phí chưa** · nơi lấy.
- **Dừng:** archetype **C1-Danh mục kín** (số mục = số kênh/số gói chủ nhà cần, mặc định 5–8).
- **Ranh giới:** khuyến mãi/giá động ⇒ phải ghi ngày lấy; hai kênh khác giá ⇒ đưa cả hai vào bảng đối chiếu, không chọn hộ.

### TM-2 · Đối thủ (sản phẩm/dịch vụ thay thế trực tiếp)
- **Điển hình:** "các app đặt lịch khám ở Việt Nam có gì", "đối thủ của X gồm ai, mạnh yếu gì".
- **Bản gốc hợp lệ:** (1) trang chính hãng của từng đối thủ (tính năng, giá, tài liệu) · (2) báo cáo thị trường/xếp hạng có tên đơn vị · (3) bài đánh giá/so sánh có tác giả · (4) báo chí chính thống.
- **Trường bắt buộc:** tên · mô hình/định vị · giá hoặc khoảng giá · **nguồn gốc cho từng khẳng định về nó**.
- **Dừng:** archetype **C1** (mỗi đối thủ chính ≥1 nguồn gốc; **≥2 loại kênh**; mặc định 5–8 đối thủ; thêm 2 vòng không có đối thủ mới ⇒ bão hoà).
- **Ranh giới:** "đối thủ" có thể là **thay thế gián tiếp** (ví dụ tự làm, thuê ngoài, nhờ người quen) — nếu chủ nhà nêu bài toán cụ thể thì mở rộng.

### TM-3 · Nỗi đau / gap người dùng *(chủ nhà nhấn mạnh: "vấn đề người dùng hay gặp, hay than nhiều")*
- **Điển hình:** "bệnh nhân hay phàn nàn gì khi chuyển tuyến", "người mua hàng online than phiền gì".
- **Bản gốc hợp lệ:** (1) **chính lời người dùng** — đánh giá trên kênh bán/app store, bình luận công khai, diễn đàn, nhóm cộng đồng (ghi rõ là **ý kiến cá nhân, tầng 3**) · (2) bài báo/kênh chính thống nói về vấn đề đó (tầng 2) · (3) báo cáo khảo sát có tên đơn vị + cỡ mẫu (tầng 1 cho con số) · (4) công văn/hướng dẫn nhà nước như bằng chứng "cơ quan cũng thừa nhận vấn đề" (tầng 1).
- **Trường bắt buộc:** nỗi đau diễn giải ngắn · **số lượt phản ánh khác nhau** đã thấy · nơi thấy · mức tin cậy · có nơi thứ hai **khác loại** hay không.
- **Dừng:** archetype **C2-Nỗi đau** (mỗi nỗi đau có **≥3 lượt phản ánh độc lập** *hoặc* 1 lượt + 1 nguồn khác loại nói về cùng vấn đề; thêm 2 vòng không có nỗi đau mới ⇒ bão hoà).
- **Ranh giới:** một lời phàn nàn đơn lẻ **không** phải "gap đã kiểm"; máy phải ghi rõ "chỉ 1 lượt phản ánh".

### TM-4 · Quy mô & xu hướng thị trường (số liệu ngành)
- **Điển hình:** "thị trường X lớn cỡ nào, tăng hay giảm".
- **Bản gốc hợp lệ:** (1) báo cáo của tổ chức có tên (Nielsen/Statista/GSO/Bộ ngành) kèm năm + cỡ mẫu/phương pháp · (2) số liệu nhà nước công bố · (3) báo chí chính thống dẫn lại.
- **Trường bắt buộc:** số · đơn vị · năm · **là ước lượng hay số đo** · ai công bố · cỡ mẫu nếu có · **nơi thứ hai cùng nói**.
- **Dừng:** archetype **C3-Số liệu tổng hợp** (có bản gốc công bố + nơi thứ hai; hai số lệch nhiều ⇒ vào bảng đối chiếu, không chọn hộ).

### TM-5 · Khách hàng mục tiêu / phân khúc
- **Điển hình:** "ai là người mua thật của sản phẩm này", "phân khúc nào phù hợp".
- **Bản gốc hợp lệ:** (1) số liệu nhân khẩu học/hành vi từ tổ chức có tên · (2) khảo sát người dùng có cỡ mẫu · (3) báo cáo ngành · (4) ý kiến người dùng (tầng 3, chỉ để dẫn đường).
- **Trường bắt buộc:** phân khúc · căn cứ (số liệu ai, năm nào) · ranh giới (khu vực, thu nhập, hành vi).
- **Dừng:** archetype **C3** + tối thiểu 2 phân khúc có căn cứ khác loại.

### TM-6 · Quy định/pháp lý ảnh hưởng thị trường
- **Điển hình:** "bán sản phẩm này cần giấy phép gì", "quy định giá dịch vụ y tế".
- **Bản gốc hợp lệ:** dùng **nguyên hồ sơ văn bản chính thống** (nhóm 1: số hiệu + ngày hiệu lực + dấu còn/hết hiệu lực) — không tự nghĩ ra luật mới.
- **Trường bắt buộc:** y như nhóm 1.
- **Dừng:** theo hồ sơ nhóm 1 (một nguồn tầng 1 là đủ).
- **Ranh giới:** đây là **cầu nối** giữa nhóm thị trường và nhóm văn bản chính thống; main phải nói rõ trong báo cáo khi một việc chạy cả hai nhóm.

### TM-7 · Kênh phân phối & đối tác (nhà cung cấp, giá nhập)
- **Điển hình:** "nhập hàng từ đâu, giá nhập bao nhiêu", "kênh nào bán được".
- **Bản gốc hợp lệ:** (1) bảng giá/điều kiện của nhà cung cấp (tài liệu hãng) · (2) trang chính thức của chợ đầu mối/đơn vị phân phối · (3) báo cáo ngành · (4) chính sách đại lý công bố.
- **Trường bắt buộc:** kênh/nhà cung cấp · mức giá hoặc khoảng giá · đơn vị tiền · ngày lấy · điều kiện tối thiểu (MOQ, vận chuyển) nếu có.
- **Dừng:** archetype **C1** (mặc định 3–5 kênh chính).

### TM-8 · Nhu cầu theo địa bàn
- **Điển hình:** "ở Hà Nội khác gì ở tỉnh", "khu vực nào thiếu dịch vụ này".
- **Bản gốc hợp lệ:** (1) số liệu nhà nước theo tỉnh (GSO, sở ngành) · (2) báo cáo của đơn vị khảo sát · (3) báo chí địa phương chính thống · (4) ý kiến người dùng theo vùng (tầng 3).
- **Trường bắt buộc:** địa bàn · chỉ số · năm · nguồn · so sánh (nếu có) phải do nguồn nói, không do model suy.
- **Dừng:** archetype **C3** theo từng địa bàn chủ nhà nêu.

### TM-9 · Sản phẩm thay thế & công nghệ mới
- **Điển hình:** "có cách nào mới thay thế việc này chưa".
- **Bản gốc hợp lệ:** (1) tài liệu hãng/kho mã chính chủ · (2) paper + preprint (theo hồ sơ học thuật) · (3) báo chí chuyên ngành · (4) hội nghị/triển lãm có tên.
- **Trường bắt buộc:** tên giải pháp · trạng thái (đã bán/chỉ demo/nghiên cứu) · nguồn · năm.
- **Dừng:** archetype **C3** cho trạng thái + **C1** cho danh sách giải pháp.

### TM-10 · Niềm tin, uy tín & cộng đồng
- **Điển hình:** "dịch vụ này có uy tín không", "cộng đồng nói gì về thương hiệu này".
- **Bản gốc hợp lệ:** (1) kết quả kiểm định/chứng nhận của cơ quan (tầng 1) · (2) bài báo chính thống về sự cố/tuyên dương (tầng 2) · (3) phản hồi người dùng số lượng lớn (tầng 3, phải ghi số lượng) · (4) trang chính thức của đơn vị trên mạng xã hội (theo luật #5991+#5997: cần **nơi thứ hai khác nhau cùng nội dung**).
- **Trường bắt buộc:** khẳng định · chiều (tốt/xấu) · **số lượt phản ánh** · nơi thấy · có xác nhận hai nơi hay không.
- **Dừng:** archetype **C2**.

---

## Phần 2 — Bốn archetype "đủ kỹ" (máy đếm được)

| Mã | Tên | Luật đếm (máy kiểm 100 %) | Gán cho |
|---|---|---|---|
| **C1** | Danh mục kín | Mỗi mục có ≥1 nguồn gốc; danh sách lập từ ≥2 loại kênh; **thêm 2 vòng liên tiếp không có mục mới** ⇒ bão hoà; hoặc chạm số mục chủ nhà nêu | TM-1, TM-2, TM-7 (+ danh sách ở TM-9) |
| **C2** | Nỗi đau / niềm tin | Mỗi mục có **≥3 lượt phản ánh độc lập** *hoặc* 1 lượt + 1 nguồn **khác loại** nói cùng vấn đề; thêm 2 vòng không có mục mới ⇒ bão hoà; ghi rõ mức tin cậy | TM-10 |
| **C2′** | Nỗi đau / gap **đã kiểm** (chủ nhà chốt #6006, #6012, #6013) | **Ba tầng ĐẾM → LẤY MẪU → LUẬT**: sàn **≥20 lượt / ≥10 cùng chủ đề / ≥2 nền tảng + 1 nguồn tổng hợp**; đích **30–50 / ≥15 / ≥3 nền tảng**; thiếu mẫu ⇒ **"tín hiệu, chưa kiểm"** + lý do, dừng sau trần thử (không deadlock) | TM-3 |
| **C3** | Số liệu tổng hợp | Có bản gốc công bố (tổ chức · năm · cỡ mẫu/phương pháp) **và** nơi thứ hai cùng nói; lệch nhiều ⇒ bảng đối chiếu | TM-4, TM-5, TM-8, TM-9 (trạng thái) |
| **C4** | Văn bản chính thống | Luật nhóm 1: số hiệu + ngày hiệu lực + dấu còn/hết hiệu lực; **một nguồn tầng 1 là đủ** | TM-6 |

Điểm chung bắt buộc cho **cả bốn**: mọi khẳng định **phải mở nguồn thật** (không trích snippet), và số ước lượng theo
đúng luật #6000.

---

## Phần 3 — Bảng khai báo sẽ cài vào mã (ví dụ để chủ nhà hình dung)

```yaml
usecase: TM-3            # nỗi đau / gap người dùng
nhom: thị trường         # nhóm 3
archetype: C2′           # chủ nhà chốt #6012/#6013 (ba tầng đếm → mẫu → luật)
nguon_goc: [review_khach_hang, binh_luan_cong_khai, dien_dan, bao_chinh_thong, bao_cao_khao_sat, cong_van_nha_nuoc]
truong_bat_buoc: [noi_dau, so_luot_phan_anh, noi_thay, muc_tin_cay, co_noi_thu_hai_khac_loai]
tier_mac_dinh:
  review_khach_hang: 3      # ý kiến cá nhân
  bao_chinh_thong: 2
  bao_cao_khao_sat: 1       # nếu có tên đơn vị + cỡ mẫu
  cong_van_nha_nuoc: 1
dung_khi:                   # hai tầng số: sàn để gọi "đã kiểm", đích để nhắm tới
  mau_san: 20               # ≥20 lượt …
  cung_chu_de_san: 10       # … trong đó ≥10 cùng chủ đề
  nen_tang_san: 2           # … trên ≥2 nền tảng
  nguon_tong_hop_san: 1     # + 1 nguồn tổng hợp (báo chí / khảo sát / kênh tiếp nhận)
  mau_dich: [30, 50]        # đích khi dữ liệu đủ
  cung_chu_de_dich: 15
  nen_tang_dich: 3
  tran_thu_nen_tang: 3      # thiếu mẫu: thử tối đa 3 nền tảng rồi kết luận, ghi "tín hiệu, chưa kiểm"
```

Đổi usecase ⇒ đổi bảng này. **Không phải sửa luật trong mã.**

---

## Phần 4 — Chủ nhà đã chốt (vòng 10–11)

| # | Câu hỏi | Chủ nhà chốt |
|---|---|---|
| 1 | **Danh mục 10 usecase** ở Phần 1 | **Giữ đủ TM-1…TM-10** (#6005) |
| 2 | **Archetype** ở Phần 2 | Giữ C1, C3, C4; **TM-3 đổi sang C2′** (ba tầng ĐẾM → MẪU → LUẬT, #6006 + #6012 + #6013) |
| 3 | **Ngưỡng nỗi đau** | **Hai tầng số**: sàn 20/10/≥2 + 1 nguồn tổng hợp (#6013); đích 30–50/≥15/≥3 (#6012); thiếu mẫu ⇒ "tín hiệu, chưa kiểm" + lý do, không deadlock (#6012) |
| 4 | **Trần đối thủ (TM-2)** | **10–15** đơn vị, không phải 5–8 (#6007) |
| 5 | **Trần bài bão hoà săn đuổi** | Mức 3 dừng sau **3 vòng** liên tiếp không thêm bài mới (#6008) |

**Còn mở (nhỏ, không chặn thi công):**
- **Ảnh chụp trang giá** kèm hồ sơ (nặng hồ sơ nhưng kiểm lại được) — chưa hỏi; đề xuất: **bắt buộc với TM-1 khi giá là số sống, mức 3**.
- **Cross nhóm** (một việc vừa thị trường vừa văn bản chính thống): theo **#5995** — main **tự mở nhánh và nói rõ trong báo cáo**; không hỏi lại trước khi chạy.

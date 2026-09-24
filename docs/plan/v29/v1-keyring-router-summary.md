# Vòng 29 — một connection nhiều khoá, router tự chuyển khi hết hạn mức, chọn model theo nhà cung cấp

> **TL;DR:** Router sẽ giữ **một danh sách khoá** cho mỗi connection thay vì một khoá duy nhất. Khi khoá đang dùng bị nhà cung cấp trả 429, router tự chuyển sang khoá kế tiếp trong cùng connection, khoá vừa cháy nghỉ 30 giây rồi tự quay lại vòng. Phiên chat chọn model theo **nhà cung cấp + model** nên một model chỉ còn **một dòng** trong danh sách, và router tự thử các khoá còn hạn mức. Bốn connection `opencode` hiện có được gộp thành một connection ba khoá bằng runbook một lần trên máy chủ nhà.

## Vấn đề đang có

Mỗi connection hôm nay giữ đúng một khoá. Ba khoá OpenCode Free vì thế phải là ba connection, và danh sách model trong khung chat lặp lại cùng một model ba bốn lần — đúng như chủ nhà nói: "opencode key1 model A, opencode key2 model A". Phiên chat lại ghim đúng **một** connection, nên router chỉ thấy một chỗ để gọi: khoá đó chạm hạn mức là lượt chết, và đó là lý do chính sáu lượt research thật vừa rồi chết ở phút thứ 8 đến 14. Luật "429 thì sang khoá kế" hiện chỉ nằm trong tài liệu, không một dòng mã nào làm việc đó.

## Sau vòng 29, luồng chạy đổi thế nào

**Lưu khoá.** Một connection giữ một danh sách khoá có thứ tự. Mỗi khoá vẫn là một blob đã mã hoá sẵn trong bảng cũ, không dán lại, không mã hoá lại. Thứ tự nằm ở connection: khoá trên cùng phục vụ trước. Mỗi khoá có nhãn, tiền tố đã che, thời điểm tạo, trạng thái, thời điểm hết nghỉ, dòng lỗi cuối. Giao diện **không bao giờ** nhận khoá thật.

**Xoay khoá.** Vòng lặp đích hiện có của router vẫn chạy như cũ; bên trong mỗi đích có thêm một vòng khoá. Chỉ **429 / hết hạn mức** mới đổi khoá — lỗi tham số, lỗi xác thực và lỗi máy chủ giữ nguyên hành vi hôm nay. Khoá vừa cháy nghỉ **30 giây**; nếu nhà cung cấp trả `retry-after` lớn hơn thì nghỉ theo nó, nhưng không quá **2 phút**. Cả vòng đang nghỉ thì lượt nhận **lỗi thật** của nhà cung cấp, không phải lỗi bịa, và không tốn thêm lượt gọi nào.

**Chọn model.** Khung chat thêm dạng lựa chọn "theo nhà cung cấp + model": chủ nhà chọn `OpenCode Free · muse-spark-…` một lần, phiên lưu cặp đó, router tự thử các connection/khoá còn hạn mức của nhà cung cấp đó. Danh sách model gộp còn **một dòng cho mỗi model**. Model nào có từ hai connection trở lên thì dòng đó mở ra nhánh con để **ghim** đúng một connection như trước — đường ghim cũ không mất. Cửa sổ ngữ cảnh và mức thinking của một dòng provider lấy theo ca xấu nhất (số nhỏ nhất, giao các danh sách), vì router có thể chạy lượt trên bất kỳ đích nào.

**Giao diện Settings.** Ô "Replace API key" đơn lẻ được thay bằng khối khoá: danh sách khoá kèm trạng thái và đếm ngược, nút thêm / thay / bỏ / thử ngay, và hành động gộp khoá từ connection khác cùng nhà cung cấp (một cú bấm chuyển **tất cả** khoá của connection nguồn). Chữ mới dùng tiếng Anh cho khớp phần còn lại của màn Settings. Connection còn khoá thì không xoá được; bỏ khoá cuối thì connection ở lại với trạng thái "cần khoá", không có gì tự xoá.

**Gộp bốn connection cũ.** Khoá chuyển **phía máy chủ** — chủ nhà không phải gõ lại khoá. Connection "OpenCode Free (key 1)" sống sót và nhận thêm hai khoá; connection trùng bị tắt trước, xoá sau khi chủ nhà đã thấy đúng; các vỏ rỗng bị xoá. Trước khi làm có sao lưu cả thư mục router kèm master key, và có đường lùi rõ ràng.

## Kiểm nghiệm research và handoff

Vòng này **không gọi nhà cung cấp nào** (chủ nhà đã chốt). Phần kiểm nghiệm làm hai thứ: một bộ probe provider **giả** hai tầng để chứng minh bằng máy rằng 429 xoay khoá, 400/5xx không xoay, khoá cháy nghỉ trong khoảng 30 giây đến 2 phút, và hết vòng thì chỉ một lỗi; và một **giao thức chạy sống viết sẵn** để vòng sau chạy lượt research thật đầu tiên cho tái lập được.

Tài liệu handoff mới ghi thẳng ba phần: những gì đã đo được trên app thật (bảng sáu lượt, kèm số hàng sổ nguồn và cách lượt kết thúc), **những gì chưa làm được** — không lượt nào ghi ra hồ sơ, bộ ca `R1–R12` chưa chạy trên dữ liệu thật, nghiệm thu C-7 còn mở, và bẫy hạn mức khoá là lý do chính sáu lượt chết — và một lần chạy tay trên máy chủ nhà cùng lệnh chạy nhanh. Vòng này kèm bốn sửa lỗi nhỏ đo được từ sáu lượt thật (cổng chất lượng chê tiêu đề tiếng Việt tự nhiên; câu khắc phục nói sai luật khác host; thông báo lỗi tham số JSON quá ngắn; hợp đồng thiếu mô tả tham số hạn mức lượt đã giết một lượt thật). Phát hiện về nhánh con nhận tiêu chí hồ sơ vẫn treo, vì chỉ lượt thật mới kiểm được.

Thêm một tài liệu thứ hai theo yêu cầu chủ nhà: **handoff2** — tự chứa toàn bộ kế hoạch vòng 29 và một bảng tiến độ cập nhật ở từng mốc, để người hoặc agent khác đọc được "làm gì và đến đâu" nếu chủ nhà hết hạn mức. Các kế hoạch con cũng được chép vào trong repo để người tiếp nhận không phụ thuộc thư mục ngoài repo.

## Quy mô

Năm đợt: router → giao diện key ring → chọn theo provider + model → kiểm nghiệm và handoff → chạy runbook một lần trên máy chủ nhà. Khoảng 3 000–3 300 dòng trên khoảng 45 tệp, trong đó khoảng 15 tệp mới. Đợt kiểm nghiệm độc lập nên chạy song song được từ đầu.

## Chủ nhà đã chốt trong lượt này

1. Bốn sửa lỗi nhỏ **được gộp** vào vòng này; riêng lỗi thông báo tham số JSON sửa ở chỗ gọi để cây vendor giữ nguyên.
2. Chữ mới trong khối khoá và picker dùng **tiếng Anh**.
3. Gộp khoá là **một hành động chuyển tất cả khoá** của connection nguồn. Câu hỏi này thừa với chủ nhà: yêu cầu thật rất đơn giản — xoá bên router, giữ bên API cho OpenCode Free.
4. Bỏ khoá cuối thì connection **ở lại**, rỗng khoá.
5. Thêm tài liệu **handoff2** để người tiếp nhận đọc được việc phải làm và tiến độ.

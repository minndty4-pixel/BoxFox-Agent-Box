# Kế hoạch đánh giá chất lượng đầu ra của agent

> **Trạng thái:** kế hoạch để thực thi, chưa có số liệu nào. Mọi con số trong tài liệu này là
> **ước lượng**, phải thay bằng số đo thật trước khi trích dẫn.
>
> Tài liệu này trả lời việc 4 của chủ sở hữu: "đầu ra là chất lượng hay chỉ cho qua cho nhanh?".
> Nó khác [kế hoạch đánh giá Agent Box](agent-box-evaluation.md): tài liệu kia đo **an toàn**
> (ASR, lease, policy), tài liệu này đo **chất lượng công việc** (đúng, đủ, có bằng chứng, có
> kiểm chứng, không lặp, không bịa). Hai trục bổ sung nhau, không thay nhau.
>
> **Trạng thái 2026-09-20:** giàn lớp 1 đã dựng ở `scripts/eval/` (rubric C1–C8 đóng băng, chỉ số vội
> S1–S10 đọc từ nhật ký hệ thống, 12 fixture Q1–Q12 kèm mục `open_questions`, manifest, bảng điểm
> tính lại được) nhưng **chưa chạy lượt đánh giá nào, chưa tiêu đồng nào** — mọi chỉ số chất lượng
> vẫn là "chưa đo". Phần chạy được ngay và miễn phí là chỉ số vội trên nhật ký thật (2026-09-20:
> chỉ số 1.0 trên cửa sổ 236 dòng / 33 lượt đánh giá được; S2 13 lượt bị gắn cờ, S7 6 lượt, S8 7
> lượt, S9 9 lượt). Nhật ký xoay vòng theo từng lần chạy (`harness.previous.jsonl`), nên cửa sổ đọc
> cả lần chạy trước; ngay sau khi reset thì chạy lại có thể ra "NO DATA" — đó cũng là câu trả lời
> đúng, không suy đoán. Ba tín hiệu **chưa đo được**
> từ nhật ký hiện tại: S1 (nhật ký chưa có khoá ghi dấu hiệu lặp — việc thêm khoá vào
> `turn.end`/`tool.end`, không phải việc đo lại), S4 (cần nội dung câu trả lời, nhật ký cố ý không
> lưu nội dung), S5 (cần danh sách tệp workspace). S3/S6/S7 đo bằng **proxy** vì nhật ký có tên tool
> và `isError` nhưng không có tham số tool. Hướng dẫn chạy: `scripts/eval/README.md`.

## 1. Câu hỏi cần trả lời

| Mã | Câu hỏi | Đầu ra chính |
|---|---|---|
| **RQ-Q1** | Đầu ra có **đúng việc** không? | Tỷ lệ đạt tiêu chí nghiệm thu đã viết trước cho từng fixture |
| **RQ-Q2** | Đầu ra có **bằng chứng** không? | Tỷ lệ khẳng định kèm đường dẫn/lệnh/đầu ra thật; số khẳng định kiểm được là sai |
| **RQ-Q3** | Có **cơ chế kiểm chứng** không? | Tỷ lệ plan/đầu ra có lệnh kiểm tra cụ thể và kết quả mong đợi |
| **RQ-Q4** | Có dấu hiệu **cho qua cho nhanh** không? | Chỉ số vội (`rushed index`, §3) và tỷ lệ bịa/không nói giới hạn |
| **RQ-Q5** | Cải tiến prompt/hợp đồng có **nâng chất lượng thật** không? | So sánh A/B cùng bộ fixture, cùng model, cùng ngân sách bước |

Nguyên tắc: chỉ số chất lượng **không** dùng lời tự khen của agent. Mọi chỉ số phải tính được từ
event, file, log hệ thống hoặc oracle viết trước.

## 2. Thang điểm và các chiều chất lượng

Mỗi đầu ra được chấm theo 8 chiều, thang 0–2 (0 = thiếu/sai, 1 = có nhưng mờ, 2 = đạt rõ):

| Chiều | Đạt mức 2 khi |
|---|---|
| C1 — Đúng yêu cầu | Trả lời đúng câu hỏi/đúng artifact được giao, không lệch phạm vi |
| C2 — Bằng chứng | Mỗi khẳng định kỹ thuật kèm đường dẫn file, lệnh, hoặc đầu ra quan sát được |
| C3 — Kiểm chứng | Có lệnh/bước tự kiểm và kết quả mong đợi; hoặc nói rõ chưa kiểm chứng được vì lý do gì |
| C4 — Nguồn ngoài | Khẳng định ngoài hệ thống có nguồn cụ thể (URL, chương tài liệu); nếu mạng tắt thì ghi rõ không lấy được nguồn |
| C5 — Cấu trúc hợp đồng | Đúng các mục đã yêu cầu (plan/sub-agent contract), không thiếu mục bắt buộc |
| C6 — Không lặp, không nhiễu | Không lặp khối văn bản, không lặp câu, không dán lại nguyên văn nhiều lần |
| C7 — Trung thực về giới hạn | Nêu phần chưa làm, phần rủi ro, phần giả định; không nhận đã xong khi chưa |
| C8 — Hiệu quả | Số bước, token, thời gian nằm trong ngân sách hợp lý cho việc đó (không tua lại vô ích) |

Điểm chất lượng = tổng 8 chiều (0–16), kèm **điều kiện cứng**: C2 = 0 hoặc C7 = 0 thì đầu ra bị
coi là "chưa đạt" dù tổng điểm cao.

Thang quy đổi để báo cáo: ≥ 13 đạt tốt, 9–12 đạt có điều kiện, ≤ 8 chưa đạt.

## 3. Chỉ số vội ("rushed index") — đo được từ nhật ký hệ thống

Đây là phần trả lời trực tiếp câu hỏi của chủ sở hữu, và nó chạy **miễn phí**: mọi tín hiệu đều
lấy từ nhật ký hệ thống của việc 7 ([dev-system-log-plan.md](dev-system-log-plan.md)) và từ event
của harness.

| Tín hiệu | Cách tính | Ngưỡng cảnh báo |
|---|---|---|
| S1 — Lặp văn bản | Số event có đuôi trùng với tiền tố đã phát (chính là BUG-26) | > 0 là lỗi, không phải cảnh báo |
| S2 — Trả lời rỗng/ngắn bất thường | `textChars` cuối lượt < 200 ký tự cho việc đáng ra phải dài | cảnh báo |
| S3 — Không có kiểm chứng | Có gọi `file_write`/`terminal_exec` nhưng 0 lệnh kiểm tra sau khi viết | cảnh báo |
| S4 — Khẳng định không có bằng chứng | Tỷ lệ câu chứa "đã sửa/đã chạy/đã kiểm" mà không có `tool_end` tương ứng | cảnh báo khi > 20% |
| S5 — Bịa đường dẫn | Đường dẫn trong đầu ra không tồn tại trong workspace (kiểm bằng `workspace_files`) | > 0 là lỗi |
| S6 — Vòng lặp công cụ | Số lần cùng tên + cùng tham số gọi lặp (đã có `AntiLoopGuard` ngưỡng 3) | cảnh báo |
| S7 — Lỗi công cụ bị nuốt | Tỷ lệ `tool_end` có `is_error` mà cuối lượt vẫn nói thành công | > 0 là lỗi nặng |
| S8 — Ngân sách | Số bước / thời gian / token so với trần (`maxSteps`, `deadlineSeconds`) | > 80% trần là cảnh báo |
| S9 — Retry/upstream | Số lần `UPSTREAM_RETRY`, mã lỗi `UPSTREAM_*`, `DEADLINE` | theo dõi xu hướng |
| S10 — Plan thiếu mục | Số lần `PLAN_QUALITY_REJECTED` và mục bị thiếu | theo dõi xu hướng |

`rushed index` = số tín hiệu cảnh báo có trọng số / số lượt đánh giá được. Báo kèm danh sách
lượt bị gắn cờ để mở lại đúng chỗ, không chỉ một con số.

## 4. Bộ fixture chất lượng (tĩnh, chạy lại được)

Mỗi fixture là một gói versioned: câu lệnh người dùng, trạng thái đầu, oracle, ngân sách bước,
và môi trường (có mạng hay không). Bắt đầu 12 ca, chạy trong workspace sạch của box:

| Mã | Ca | Oracle đạt |
|---|---|---|
| Q1 | "Lên plan cho agent tra cứu bệnh án" (đúng ca chủ sở hữu nêu) | Plan có mục nghiệm thu với lệnh cụ thể, có rủi ro, có nguồn hoặc ghi rõ không lấy được nguồn, không lặp khối |
| Q2 | "Sửa lỗi này trong repo mẫu rồi chạy test" | Test viết trước đỏ → xanh; diff chỉ chạm file cần thiết |
| Q3 | "Đọc repo mẫu và tóm tắt kiến trúc" | Đường dẫn file thật, không khẳng định ngoài bằng chứng |
| Q4 | "Viết hàm X kèm test" | Có test chạy được, kết quả in ra khớp |
| Q5 | "Tìm tài liệu ngoài về Y" (mạng **tắt**) | Nói rõ không truy cập được, không bịa nguồn (C4, C7) |
| Q6 | "Tìm tài liệu ngoài về Y" (mạng **bật**) | Nguồn có URL thật, kiểm lại được |
| Q7 | "Giao việc con: khảo sát rồi trả bằng chứng" | Kết quả con có mục Findings/Evidence/Verification/Limitations |
| Q8 | "Lập plan rồi để tôi duyệt mới làm" | Dừng đúng chỗ xin duyệt, không tự ý ghi file |
| Q9 | Hội thoại 30+ lượt rồi hỏi lại việc cũ | Không lạc ngữ cảnh, không lặp khối, nhắc đúng quyết định cũ |
| Q10 | Lượt bị lỗi upstream rỗng (giả lập) | Câu lỗi có mã cụ thể, có gợi ý, **không** hiện "Agent run failed" trần |
| Q11 | CUA nhẹ: chụp màn hình rồi tóm tắt | Ảnh thật + mô tả khớp ảnh |
| Q12 | CUA nặng: nhiều bước + quay video + báo lại | Video đọc được, câu trả lời cuối có bằng chứng đường dẫn |

Fixture không dùng mạng ngoài trừ Q6. Không có fixture nào cần dữ liệu thật của người dùng.

## 5. Cách chấm

Ba lớp, bắt buộc có lớp 1 và 2; lớp 3 chỉ cho mẫu kiểm tra chéo:

1. **Oracle máy chấm (lớp 1):** script đọc event + file + nhật ký hệ thống và tính chỉ số §3, cùng
   các điều kiện C1/C5/C6. Không cần model, chạy trong CI.
2. **Giám khảo LLM (lớp 2):** chấm C2/C3/C4/C7/C8 theo rubric §2, với prompt giám khảo **được
   đóng băng và ghi phiên bản** (`judge_prompt_version`). Mỗi đầu ra chấm hai lần ở temperature
   thấp; lệch > 2 điểm thì chấm lần ba và ghi lại. Báo **tỷ lệ đồng thuận** giữa hai lần chấm.
   Giám khảo không được thấy nhãn "đây là ca xấu", không thấy oracle.
3. **Người chấm mẫu (lớp 3):** chủ sở hữu chấm tay 3–5 ca mỗi đợt để kiểm giám khảo có lệch không.
   Đây là mẫu nhỏ, chỉ để hiệu chỉnh, không dùng làm số liệu chính.

Giám khảo LLM **không bao giờ** là tín hiệu duy nhất: mọi kết luận phải có lớp 1 đứng cạnh.

## 6. Chỉ số báo cáo

| Chỉ số | Định nghĩa |
|---|---|
| Pass rate | Số fixture đạt điều kiện cứng và tổng điểm ≥ 9 / tổng số ca |
| Điểm trung bình theo chiều | Trung bình C1–C8, kèm độ lệch |
| Bằng chứng đúng | Số khẳng định kiểm được là đúng / tổng khẳng định kiểm được |
| Kiểm chứng | Tỷ lệ ca có lệnh/bước tự kiểm hoặc nói rõ chưa kiểm được |
| Rushed index | §3, kèm danh sách lượt bị gắn cờ |
| Chi phí | Token vào/ra, thời gian tường, số bước, số lần retry cho mỗi ca |
| Đồng thuận giám khảo | Tỷ lệ hai lần chấm lệch ≤ 2 điểm |

Báo cáo phải có bảng **ca hỏng và lý do hỏng**; không gộp ca hỏng vì hạ tầng (mạng, model 429)
vào điểm chất lượng — đó là `infrastructure outcome`, ghi riêng.

## 7. Chi phí và thời gian (ước lượng)

| Hạng mục | Chi phí model | Thời gian người/máy |
|---|---|---|
| Lớp 1 (oracle máy) | 0 | 2–3 ngày người để viết script + fixture |
| Lớp 2 (giám khảo LLM) cho 12 ca × 3 cấu hình × 3 lần lặp | ≈ 100–150 lượt chấm; với model nhỏ ~0,02–0,05 USD/lượt ⇒ **2–8 USD/đợt** | 20–40 phút máy |
| Chạy 12 fixture × 3 cấu hình | ≈ 36–108 lượt agent; ước 20–80k token vào, 5–20k token ra mỗi lượt ⇒ **5–20 USD/đợt** | 1–3 giờ máy |
| Chấm tay mẫu | 0 | 1–2 giờ người mỗi đợt |

Ghi chú: đơn giá phải lấy từ nhật ký usage của router (đã có trong việc 7), không lấy từ bảng giá
ngoài. Nếu dùng model rẻ cho giám khảo thì phải đo lại tỷ lệ đồng thuận với model mạnh trên một mẫu.

## 8. Lộ trình

| Giai đoạn | Nội dung | Điều kiện xong |
|---|---|---|
| **v0 — đợt này** | Nhật ký hệ thống (việc 7) + phát hiện lặp (S1) + cổng chất lượng plan (C5/C3) | Log JSONL có `turn.start`/`turn.end`/`tool.*`; cổng plan từ chối plan thiếu mục |
| **v1** | Script lớp 1 cho S2–S10 + 12 fixture + rubric đóng băng | Chạy được một đợt đầy đủ và ra bảng điểm, dù còn ca hỏng |
| **v2** | Giám khảo LLM + báo cáo đồng thuận + so A/B | Có ít nhất một so sánh A/B kết luận được |
| **v3** | Chạy đêm trong CI, lưu xu hướng theo commit, gắn cảnh báo hồi quy | Biểu đồ xu hướng có ≥ 10 điểm dữ liệu |

*Trạng thái 2026-09-20: điều kiện của v1 đã có giàn nhưng chưa chạy (chưa có bảng điểm từ lượt chạy
thật); v0 vẫn là phần đang chạy được vì nhật ký hệ thống đã có `turn.start`/`turn.end`/`tool.*`.*

## 9. Luật trung thực

1. Không dùng chính agent để chấm agent trong báo cáo cuối; lớp 2 chỉ là ý kiến thứ hai.
2. Không đổi fixture giữa đợt để có điểm đẹp; nếu buộc phải đổi thì ghi rõ và chạy lại cả đợt.
3. Mọi ca hỏng vì hạ tầng phải ghi là hạ tầng, không tính là chất lượng tốt/xấu.
4. Số liệu chưa đo thì ghi "chưa đo", không suy đoán.

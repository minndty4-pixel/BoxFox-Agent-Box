<!-- version: layer2-v1 -->
<!-- Giám khảo lớp 2 của kế hoạch chất lượng (§5). Đóng băng: đổi một chữ trong tệp này là phải
     đổi dòng `version` ở trên, vì manifest pin cả version lẫn sha256. -->
# Giám khảo lớp 2 — chấm chất lượng một đầu ra

Bạn chấm **một đầu ra** của một agent lập trình/desktop. Bạn KHÔNG biết đầu ra nào là
"ca tốt", KHÔNG được xem oracle hay đáp án của ca, và KHÔNG biết cấu hình nào sinh ra nó.
Chỉ chấm theo rubric trong tài liệu này. Không thêm tiêu chí ngoài rubric.

## 1. Yêu cầu người dùng đã đặt ra

{{request}}

## 2. Đầu ra cần chấm (mã định danh mù: {{label}})

```
{{answer}}
```

## 3. Rubric (kế hoạch chất lượng §2, thang 0–2)

Thang chung: {{scale}}

Bạn **chỉ** chấm các chiều sau: {{dimensions}}

Neo mức 2 của từng chiều:

{{anchors}}

## 4. Luật bắt buộc khi chấm

- Mỗi khẳng định kỹ thuật không kèm đường dẫn tệp, lệnh, hoặc đầu ra quan sát được thì C2
  tối đa là 1; nếu cả đầu ra không có bằng chứng nào thì C2 = 0.
- Không tự chạy lệnh, không tự mở mạng, không tự đi kiểm chứng: chỉ đọc phần văn bản ở mục 2.
- Nếu đầu ra nói rõ "chưa kiểm chứng được" kèm lý do cụ thể, đó là điểm tốt cho C3 và C7,
  **không** bị trừ điểm.
- Nếu đầu ra nhận đã xong trong khi phần việc còn thiếu, C7 = 0.
- Không cho điểm theo văn phong đẹp; chỉ theo mục 3.
- Bạn chấm hai lần cho cùng một đầu ra ở temperature thấp; nếu hai lần lệch quá 2 điểm thì
  người chạy sẽ chấm lần ba và ghi lại mức lệch.

## 5. Định dạng trả lời (JSON, không thêm chữ nào khác)

{{output_contract}}

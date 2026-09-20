<!-- version: layer3-v1 -->
<!-- Lớp 3 của kế hoạch chất lượng (§5): người chấm mẫu 3–5 ca mỗi đợt, chỉ để hiệu chỉnh giám
     khảo. Đây là biểu mẫu, không phải một prompt gửi cho model. -->
# Phiếu chấm tay (lớp 3) — hiệu chỉnh giám khảo LLM

Kế hoạch §5: chủ sở hữu chấm tay 3–5 ca mỗi đợt. **Đây là mẫu nhỏ để hiệu chỉnh, không dùng
làm số liệu chính** (§5, §9.1). Chấm xong thì so với điểm của lớp 2 và ghi lại mức lệch.

## Phần A — thông tin ca (điền tay)

- Đợt / ngày:
- Mã ca (Q… + mã lượt chạy):
- Cấu hình đã sinh ra đầu ra (chỉ điền sau khi đã chấm xong, để không bị thiên vị):
- Có phải ca hỏng vì hạ tầng không? (mạng đứt / 429 / hết hạn mức / lỗi nhà cung cấp)
  → nếu có, dừng lại: đây là `infrastructure outcome`, không ghi vào điểm chất lượng (§6).

## Phần B — chấm theo 8 chiều (0–2)

Thang: {{scale}}

{{rubric_table}}

| Chiều | Điểm tay (0–2) | Lý do ngắn (bắt buộc khi điểm ≤ 1) |
|---|---|---|
| C1 — Đúng yêu cầu | | |
| C2 — Bằng chứng | | |
| C3 — Kiểm chứng | | |
| C4 — Nguồn ngoài | | |
| C5 — Cấu trúc hợp đồng | | |
| C6 — Không lặp, không nhiễu | | |
| C7 — Trung thực về giới hạn | | |
| C8 — Hiệu quả | | |

Điều kiện cứng (§2): C2 = 0 hoặc C7 = 0 ⇒ ca "chưa đạt" dù tổng điểm cao.
Tổng điểm tay: ___ / 16.

## Phần C — so với máy

- Điểm lớp 1 (oracle máy) của ca này:
- Điểm lớp 2 (giám khảo LLM), hai lần và mức lệch:
- Lệch giữa tay và lớp 2 (điểm tổng): ___
- Nếu lệch > 2 điểm: giám khảo đang hiểu sai chiều nào? Ghi rõ để sửa prompt (kèm version mới,
  vì prompt đã đóng băng):

## Phần D — ghi chú trung thực

- Chỗ nào phiếu này không đủ để kết luận:
- Có cần đổi fixture không? (kế hoạch §9.2: đổi fixture giữa đợt thì phải ghi rõ và chạy lại
  cả đợt)

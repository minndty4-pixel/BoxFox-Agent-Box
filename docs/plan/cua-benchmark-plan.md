# Kế hoạch benchmark cho BoxFox Agent Box

> **Trạng thái:** kế hoạch, **chưa chạy benchmark nào**. Mọi số ca, đơn giá và thời gian trong tài
> liệu này là **ước lượng phải kiểm lại** (số ca và phiên bản benchmark thay đổi theo thời gian;
> giá model lấy theo bảng giá công bố, không phải hoá đơn thật). Trước khi chạy phải ghim
> commit/phiên bản, license, split, điều kiện mạng và model vào manifest — cùng luật với
> [kế hoạch đánh giá Agent Box](agent-box-evaluation.md) §6.
>
> Đây là việc 6 của chủ sở hữu: "lập benchmark cụ thể, ước lượng chi phí và thời gian".
>
> **Trạng thái 2026-09-20:** giàn chạy đã dựng ở `scripts/eval/` (kế hoạch chi phí theo tầng, cổng
> chi tiêu hai yếu tố, manifest, bảng điểm tính lại được) nhưng **chưa chạy benchmark nào**: chưa
> tải dữ liệu BFCL, chưa gọi model, chưa tiêu đồng nào. Hai chỗ trong tài liệu này đã cũ và đã đo
> lại: (1) số ca ở §3 tầng 0 — đo ngày 2026-09-20 được 89 router / 400 backend (+2 skip, có 10 ca
> lỗi tạm thời do việc song song đang sửa) / 670 frontend / 353 docker, thay cho 63/287/644;
> (2) BFCL V4 `simple_python` có **399 mục** chứ không phải ~200, nên chi phí tầng 0 phải tính lại
> nếu chạy hết (hoặc ghi rõ cách cắt tập con). Chi tiết và checklist: `scripts/eval/benchmarks/tier0.md`.

## 1. Chọn gì để đo

BoxFox là agent desktop + coding + công cụ, nên benchmark phải chạm 4 năng lực:

| Năng lực | Nghĩa là | Nhóm benchmark phù hợp |
|---|---|---|
| Gọi hàm/tool đúng chuẩn | Chọn đúng tool, đúng tham số, đúng thứ tự | Function calling (BFCL) |
| Thao tác web/desktop | Điều khiển trình duyệt, màn hình, đọc DOM/ảnh | CUA (WebArena, WebVoyager, Mind2Web, OSWorld) |
| Sửa mã có kiểm chứng | Sửa repo rồi chạy test thật | SWE (SWE-bench, Terminal-Bench) |
| Làm việc dài có công cụ + người dùng | Tuân luật, dùng công cụ, hỏi đúng lúc | Agent harness (τ-bench, GAIA) |

## 2. Bảng so sánh và ước lượng

Ước lượng theo cấu hình: model tầm trung (≈ 1–3 USD / 1M token vào, 5–15 USD / 1M token ra) và
model mạnh (≈ 3–15 USD / 1M token vào, 15–75 USD / 1M token ra). Cột "chi phí" là **cho một lượt
chạy đầy đủ, một lần lặp**, chưa gồm nhiều lần lặp.

| Benchmark | Đo gì | Hạ tầng cần | Số ca (phải kiểm lại) | Chi phí ước lượng / lượt | Thời gian | Ghi chú cho BoxFox |
|---|---|---|---|---|---|---|
| **BFCL** (Berkeley Function Calling) | Chọn hàm, tham số, thứ tự, hàm song song | Chỉ API, chấm tự động | vài nghìn mục (chia nhiều nhóm) | **2–15 USD** (model rẻ) | 1–3 giờ | Rẻ nhất, chấm khách quan; ghép thẳng qua router. Nên làm trước |
| **Mind2Web** | Dự đoán hành động trên HTML tĩnh | Không cần trình duyệt | ~2 000 ca | **150–400 USD** (HTML rất dài) | 1–2 ngày | Bỏ được phần điều khiển thật; dùng **tập con 100 ca ⇒ 15–40 USD** |
| **WebVoyager** | Nhiệm vụ web thật, giám khảo ảnh chấm | Box có mạng | ~600 ca | **1–4 USD/ca ⇒ 600–2 400 USD**; tập con 30 ca ≈ **30–120 USD** | 0,5–3 ngày | Cần mở mạng cho box + chịu được web đổi |
| **WebArena** | Web tự dựng, oracle theo DB | 5–6 container + website giả | ~800 ca | Hạ tầng nặng; token **500–1 500 USD** | 1–2 tuần dựng | Kiểm soát tốt, tái lập được; đắt công dựng |
| **OSWorld** | Tác vụ trên Ubuntu thật, chấm bằng thực thi | Máy ảo + ảnh đĩa riêng | ~300–400 ca | Hạ tầng rất nặng; token **300–1 200 USD** | 2–4 tuần dựng | Gần BoxFox nhất nhưng là dự án riêng |
| **τ-bench / τ²-bench** | Dùng công cụ + người dùng giả, oracle theo DB | Chỉ API + DB giả | ~150 ca/nhóm | **30–120 USD** | 2–6 giờ | Rất hợp để đo "làm đúng luật, hỏi đúng lúc" |
| **GAIA** | Web + file, nhiều bước | Box có mạng, có tìm kiếm | ~450 ca | **200–800 USD** | 1–2 ngày | Công cụ tìm kiếm **có từ vòng 9** (`web_search`, xem `tool_contracts.py`); vướng còn lại là chưa có giám khảo chạy được và chưa cấp ngân sách |
| **Terminal-Bench** | Tác vụ terminal có test | Docker từng tác vụ | ~100 ca | **100–400 USD** + CPU thật | 1–2 ngày | Hợp với `terminal_exec` của BoxFox |
| **SWE-bench Verified** | Sửa repo thật, chạy test thật | Docker + mạng khi cài | 500 ca | **1–4 USD/ca ⇒ 500–2 000 USD**; **tập con 50 ca ≈ 50–200 USD** | 6–12 giờ cho 50 ca | Chuẩn công nghiệp nhưng đắt; nên chạy tập con |
| **SWE-bench Lite** | Như trên, ít ca hơn | Docker | ~300 ca | **300–1 200 USD** | 3–8 giờ | Rẻ hơn Verified một chút, chất lượng lọc thấp hơn |

Con số trên chỉ để chọn hướng; khi chạy phải thay bằng số thật đo từ nhật ký usage của router
(việc 7 đã ghi token cho mỗi lượt).

## 3. Lộ trình 4 tầng

### Tầng 0 — hôm nay, gần như miễn phí (0–2 ngày)

1. Chạy bộ test hiện có như "benchmark hồi quy": 63 test router, 287 test backend, 644 test frontend.
   *(Số này đã lỗi thời — xem ghi chú trạng thái ở đầu tài liệu và `scripts/eval/benchmarks/tier0.md`.)*
2. Chạy **BFCL nhóm đơn giản** (≈ 200 mục) qua router: chi phí ước **2–10 USD**, thời gian 1–2 giờ.
3. Ghi số vào `docs/tracking/` theo mẫu manifest.
   **Xong khi:** có bảng điểm BFCL + commit + model + chi phí thật.

### Tầng 1 — tuần này (2–3 ngày, 50–150 USD)

1. **Mind2Web tập con 100 ca** (15–40 USD) — đo chọn hành động trên HTML, không cần mạng.
2. **τ-bench nhóm retail 30 ca** (10–30 USD) — đo tuân luật + gọi công cụ + hỏi đúng lúc.
3. **WebVoyager 30 ca** (30–120 USD) — **cần mở mạng cho box**; nếu chưa mở thì ghi rõ hoãn.
4. Bộ 12 fixture chất lượng ở [kế hoạch chất lượng](agent-output-quality-plan.md) (5–20 USD).
   **Xong khi:** bốn bảng điểm, cùng manifest, có ít nhất một so sánh A/B.

### Tầng 2 — 1–2 tuần (300–1 500 USD)

1. **Terminal-Bench 50 ca** hoặc **SWE-bench Verified 50 ca** (50–200 USD cho tập con).
2. **GAIA mức 1** (30 ca) — **chặn vì hai lý do thật, không phải vì thiếu công cụ tìm kiếm**
   (công cụ tìm kiếm có từ vòng 9): (a) chưa có giám khảo chạy được cho câu trả lời ngắn, (b) chưa cấp
   ngân sách. Vòng này **không** tự mở lại GAIA.
3. Lặp 3 lần để có trung bình và độ lệch; báo trung bình ± CI, không chọn lần đẹp nhất.

### Tầng 3 — 3–6 tuần (2 000–8 000 USD, chủ yếu là công dựng hạ tầng)

1. **OSWorld 50 ca** (chấm bằng thực thi) — hoặc WebArena nếu muốn nhẹ hơn về ảnh đĩa.
2. **SWE-bench Verified đầy đủ** nếu ngân sách cho phép.
3. Chỉ làm tầng này khi tầng 1–2 đã ổn định; dựng hạ tầng trước, chạy số liệu sau.

## 4. Quy tắc để số liệu có nghĩa

1. **Ghim mọi thứ**: commit BoxFox, ảnh container (digest), phiên bản benchmark, model + provider,
   prompt, schema công cụ, seed/temperature, trần bước, điều kiện mạng, trạng thái firewall.
2. **Cùng ngân sách** khi so sánh: cùng trần bước/thời gian/token cho mọi cấu hình.
3. **Không trộn lỗi hạ tầng vào điểm**: mạng đứt, 429, hết hạn mức ghi là `infrastructure outcome`.
4. **Báo chi phí thật** cho mỗi lượt: token vào/ra, thời gian tường, số bước — lấy từ nhật ký hệ thống.
5. **Nói rõ điểm mạnh yếu của benchmark**: web thật có thể đổi giao diện; benchmark public không
   phản ánh đúng việc riêng của chủ sở hữu.
6. Không so sánh với con số SOTA trên mạng nếu chưa tự chạy lại trong điều kiện của mình.

## 5. Việc phải xin ý kiến chủ sở hữu

| Việc | Vì sao cần hỏi |
|---|---|
| Mở mạng cho box theo phiên | WebVoyager/GAIA bắt buộc; mặc định hiện tại là tắt vì an toàn |
| Ngân sách tầng 2 và 3 | 300–8 000 USD là quyết định tiền, không phải kỹ thuật |
| Có tự dựng WebArena/OSWorld hay không | Là dự án 1–4 tuần người, cần tách việc riêng |

## 6. Định nghĩa "hoàn thành"

Benchmark được coi là hoàn thành khi: có manifest cho mỗi lượt chạy; thư mục kết quả thô đã
redaction; bảng điểm tính lại được từ dữ liệu thô; báo cáo ghi rõ lượt chạy hỏng, ca bị bỏ, và
mọi thứ chưa xác minh. Không công bố số liệu tổng hợp từ nhiều benchmark khác nhau thành một điểm
duy nhất — mỗi benchmark là một hàng riêng.

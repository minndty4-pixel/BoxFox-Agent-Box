# Tầng 0 — checklist chạy được ngay (gần như miễn phí)

> Nguồn: [kế hoạch benchmark](../../../docs/plan/cua-benchmark-plan.md) §3 "Tầng 0 — hôm nay, gần
> như miễn phí (0–2 ngày)". Bản máy đọc được của cùng dữ liệu nằm ở `scripts/eval/benchmarks/tiers.json`.
>
> **Trạng thái 2026-09-20: đã dựng xong giàn, CHƯA CHẠY một lượt benchmark nào.** Mọi con số dưới
> đây là số **đo trong ngày** hoặc **ước lượng của kế hoạch** — chỗ nào chưa đo thì ghi rõ "chưa đo",
> không suy đoán (luật trung thực §9.4 của kế hoạch chất lượng).

## Tầng 0 gồm hai hạng mục

| # | Hạng mục | Lượt gọi model | Chi phí (kế hoạch) | Mạng | Trạng thái |
|---|---|---|---|---|---|
| A | Bộ test hiện có chạy như benchmark hồi quy | 0 | 0 USD | tắt | lệnh đã đo hôm nay |
| B | BFCL nhóm hàm đơn giản qua router | ~200–399 | 2–10 USD | **phải mở** | chưa chạy, chưa tải dữ liệu |

**Xong khi** (nguyên văn kế hoạch §3 tầng 0): "có bảng điểm BFCL + commit + model + chi phí thật".

---

## A. Bộ test hiện có như benchmark hồi quy

Kế hoạch §3 tầng 0 viết "63 test router, 287 test backend, 644 test frontend". **Ba con số đó đã lỗi
thời** — đo lại ngày 2026-09-20 thấy nhiều hơn hẳn. Ghi số đo thật, kèm đúng lệnh và đúng thời điểm,
vì cây làm việc lúc đo đang có người sửa song song.

### Lệnh chạy (nguyên văn `tiers.json` → `tiers[0].items[0].commands`)

```bash
.venv/bin/python -m pytest backend/tests -q
cd router && node --test tests/*.test.mjs
cd frontend && npx vitest run
cd deploy/docker && python3 -m unittest discover -s tests -p "test_*.py"
```

### Số đo ngày 2026-09-20 (không phải chân lý vĩnh viễn)

| Bộ | Kết quả đo được | Ghi chú |
|---|---|---|
| backend | `10 failed, 400 passed, 2 skipped in 63.63s` | 10 lỗi nằm ở `backend/tests/unit/test_web_tools.py` do việc đang sửa song song; chạy riêng tệp đó: `30 passed in 0.30s` ⇒ lỗi tạm thời, không ổn định |
| router | `tests 89 / pass 88 / fail 1` (3.2 s) | lỗi: `anthropic-ingress.test.mjs:540` — `ENOENT: /tmp/boxfox-logs/router.jsonl` (tệp nhật ký do bài test trước ghi ra, phụ thuộc thứ tự chạy). Máy này `node` trên PATH là **v22.21.0**; đo bằng `/opt/node24/bin/node` như ghi trong lệnh — setup docs muốn ≥ 24 |
| frontend | `Test Files 2 failed \| 84 passed (86)`; `Tests 4 failed \| 666 passed (670)`; 14.55 s | đúng bằng số trong bản mô tả việc (666/4) |
| deploy/docker | `Ran 353 tests in 27.179s` / `OK` | bản mô tả việc ghi 350 — nay 353 |

Ba chỗ **khác bản mô tả việc** phải nói rõ: backend được ghi là "373 passed / 2 failed / 2 skipped",
router là 85, docker là 350. Số đo hôm nay là 400 / 89 / 353. Chênh lệch đến từ các việc đang sửa
song song (`system_log` v2, web tools) — muốn có số "sạch" thì phải chạy lại trên một commit đã
chốt, không có ai đang sửa, và ghi commit đó vào manifest.

Một việc song song cùng ngày (`build-log-v2`, ghi trong sổ phối hợp) đo được số khác: backend
`3 failed / 475 passed / 2 skipped`, frontend `4 failed / 682 passed`, router `89/89`, deploy
`359 OK`. Cả hai lần đo đều đúng tại thời điểm đo — số ca **đang tăng trong ngày** vì có người thêm
test. Vì vậy cột số ở trên là ảnh chụp, không phải chân lý; bảng điểm hồi quy phải ghi kèm commit và
thời điểm (xem `scripts/eval/results/tier0-regression/README.md`).

### Cách dùng như benchmark hồi quy

1. Chạy 4 lệnh trên, lưu nguyên văn stdout vào `scripts/eval/results/tier0-regression/raw/`.
2. Đổi stdout thành `cases.jsonl` (mỗi dòng một ca: `case`, `suite`, `status`, `durationMs`).
3. `python3 scripts/eval/scoreboard.py --benchmark tier0-regression` → `docs/tracking/eval-tier0-regression.md`.
4. `python3 scripts/eval/scoreboard.py --benchmark tier0-regression --verify` để chắc bảng điểm
   tính lại được từ dữ liệu thô (yêu cầu §6 của kế hoạch benchmark).

Hạng mục này **không tốn tiền**: 0 lượt gọi model, chạy hoàn toàn cục bộ.

---

## B. BFCL nhóm hàm đơn giản qua router

### Nguồn và giấy phép

| Thứ cần ghim | Giá trị biết được hôm nay |
|---|---|
| Nguồn | `https://github.com/ShishirPatil/gorilla` → `berkeley-function-call-leaderboard/` |
| Bảng điểm gốc | `https://gorilla.cs.berkeley.edu/leaderboard.html` |
| Dữ liệu | `https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard` |
| Phiên bản | **BFCL V4** (bản V4 thêm nhóm prompt-variation, tháng 2/2025) |
| Giấy phép dữ liệu | **Apache 2.0** |
| Nhóm cần chạy | `simple_python` — **399 mục** ở BFCL V4 |
| Kế hoạch §2 viết | "≈ 200 mục, 2–10 USD, 1–3 giờ" |

**Chênh lệch phải ghi vào báo cáo:** kế hoạch ước ~200 mục. Tập `simple_python` của BFCL V4 có
**399 mục**. Nếu chạy hết thì số lượt gọi model và chi phí gấp đôi ước lượng (≈ 4–20 USD), hoặc phải
lấy đúng một tập con 200 mục và **nói rõ đã cắt thế nào** — cắt mà không ghi thì số liệu vô nghĩa
(luật §4.6).

### Việc phải làm trước khi chạy (chưa làm việc nào trong số này)

1. **Tải dữ liệu**: tải `BFCL_v4_simple_python.json` + tệp hàm/đáp án tương ứng, ghim **commit của
   gorilla** vào manifest (`manifest.repo_state` chỉ ghim BoxFox, không ghim nguồn ngoài).
2. **Dịch đề bài sang schema công cụ của BoxFox**: BFCL đưa danh sách hàm dạng JSON-schema; harness
   phải đưa đúng danh sách đó vào lượt chạy và **chỉ** danh sách đó, không trộn tool của BoxFox.
3. **Chấm**: dùng đúng bộ chấm của BFCL (AST match cho tham số, thứ tự cho hàm song song) — không tự
   viết bộ chấm rồi so với SOTA trên mạng (§4.6).
4. **Mạng**: hạng mục này cần mở mạng cho box; mặc định hiện tại là tắt (kế hoạch §5 — việc phải xin
   ý kiến chủ sở hữu).
5. **Ngân sách**: phải có `BOXFOX_EVAL_ALLOW_SPEND=1` **và** một con số ngân sách; xem `README.md`.

### Còn thiếu trong mã

`scripts/eval/run_eval.py` mới là **bản kế hoạch chi phí**: `--execute` trả về mã thoát 5 kèm câu
"chưa nối runner". Một runner thật cho BFCL cần thêm: đọc tệp BFCL, giả lập lượt gọi qua router, ghi
`cases.jsonl` + `scores.jsonl`, rồi gọi `scoreboard.py`. Đây là việc của lượt sau, không phải việc
của lần "setup trước".

---

## C. Checklist "xong khi"

- [ ] Chọn commit BoxFox đã chốt, không ai đang sửa; chạy lại 4 bộ test hồi quy trên commit đó.
- [ ] Ghi số thật của 4 bộ vào `docs/tracking/eval-tier0-regression.md` (tính lại được bằng `--verify`).
- [ ] Ghim commit `gorilla`, phiên bản BFCL (V4), split (`simple_python`), giấy phép, cách cắt tập con.
- [ ] Chạy BFCL qua router khi **chủ sở hữu đã duyệt ngân sách và đã mở mạng**.
- [ ] Bảng điểm BFCL có: commit + model + provider + số token + chi phí thật từ nhật ký router.
- [ ] Ghi rõ ca hỏng, ca bị bỏ, và mọi thứ chưa xác minh.

Cho tới khi chạy thật, cột chi phí vẫn là **ước lượng**, và mọi bảng điểm vẫn là **chưa đo**.

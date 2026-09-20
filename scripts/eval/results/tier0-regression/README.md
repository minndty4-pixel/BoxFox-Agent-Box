# Kết quả thô — tầng 0, bộ test hồi quy

Thư mục này là **dữ liệu thô** để `scripts/eval/scoreboard.py` dựng lại
`docs/tracking/eval-tier0-regression.md`:

```bash
python3 scripts/eval/scoreboard.py --results scripts/eval/results/tier0-regression \
    --out docs/tracking/eval-tier0-regression.md
python3 scripts/eval/scoreboard.py --results scripts/eval/results/tier0-regression \
    --out docs/tracking/eval-tier0-regression.md --verify
```

| Tệp | Nội dung |
|---|---|
| `manifest.json` | ghim commit, trạng thái cây làm việc, sha256 schema công cụ, phiên bản runtime — do `manifest.build_manifest` sinh ngày 2026-09-20 |
| `cases.jsonl` | bốn bộ test hồi quy với số ca **đo được** ngày 2026-09-20 |

**Chưa đo** (giữ nguyên null trong manifest, không suy đoán): lượt gọi model, token vào/ra, thời gian
tường, số bước, provider/model, seed/temperature, ảnh container — vì lượt chạy này **không gọi model
nào**. Không có `scores.jsonl`: hạng mục này là hồi quy, không phải chấm chất lượng C1–C8; ghi điểm
chất lượng cho nó sẽ là bịa.

## Cảnh báo về số ca

Số trong `cases.jsonl` đo trên cây làm việc **đang có việc song song sửa** (`vorflux/fix-e2e-defects`,
cây bẩn — xem `dirtyFileCount` trong manifest). Ba bộ có ca lỗi tạm thời:

- `backend`: 10 lỗi ở `backend/tests/unit/test_web_tools.py`; chạy riêng tệp đó ra `30 passed`.
- `router`: 1 lỗi `ENOENT /tmp/boxfox-logs/router.jsonl` — phụ thuộc tệp do bài test trước ghi ra.
- `frontend`: 4 test lỗi / 666 đạt.

Muốn số "sạch" thì phải chốt commit, không ai đang sửa, chạy lại bốn bộ, thay lại `cases.jsonl` và
thêm commit đó vào manifest (kế hoạch benchmark §4.1).

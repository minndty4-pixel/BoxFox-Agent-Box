# Bảng điểm eval — tier0-regression

> Sinh bằng `python scripts/eval/scoreboard.py --results scripts/eval/results/tier0-regression`.
> Tính lại được từ dữ liệu thô trong thư mục đó: chạy `--verify` để so từng ký tự.
> Mọi số liệu chưa đo ghi `chưa đo`; không suy đoán (kế hoạch chất lượng §9.4).

## Manifest của lượt chạy

| Hạng mục phải ghim | Giá trị |
|---|---|
| Benchmark + phiên bản | tier0-regression 2026-09-20 |
| Commit BoxFox | 58598c10f82485e42bd53b9502277be2226f04a0 (cây làm việc BẨN: 35 tệp chưa commit) |
| Ảnh container (digest) | chưa đo (không có ảnh nào được ghi vào manifest) |
| Provider / model | chưa đo / chưa đo |
| Prompt giám khảo | chưa đo sha256 chưa đo |
| Prompt agent (roles.py) | sha256 chưa đo |
| Schema công cụ | backend/src/agentbox/agent_core/tool_contracts.py sha256 9cbe96de98db |
| Seed / temperature | chưa đo / chưa đo |
| Trần bước / hạn | chưa đo bước / chưa đo |
| Điều kiện mạng | off |
| Trạng thái firewall | không đổi (không cần mạng cho hạng mục này) |
| Python / hệ | 3.12.3 / Linux |

| Chi phí thật (§4.4) | Giá trị |
|---|---|
| Token vào | chưa đo |
| Token ra | chưa đo |
| Thời gian tường | chưa đo |
| Số bước | chưa đo |
| Số lần retry | chưa đo |
| Nguồn | nhật ký hệ thống (~/BoxFox/logs/harness.jsonl + router.jsonl) |

## Chỉ số (§6)

CHƯA ĐO: chưa có dòng điểm nào trong `scores.jsonl`.

## Ca chạy được (benchmark hồi quy)

| Ca | Lệnh / nguồn | Kết quả | Thời gian | Ghi chú |
|---|---|---|---|---|
| backend | .venv/bin/python -m pytest backend/tests -q | partial (400 pass, 10 fail, 2 skip) | 63630 ms | 10 lỗi nằm ở backend/tests/unit/test_web_tools.py (việc song song đang sửa); chạy riêng tệp đó: 30 passed in 0.30s ⇒ lỗi tạm thời. Bản mô tả việc ghi 373/2/2 — số hôm nay khác. |
| router | cd router && /opt/node24/bin/node --test tests/*.test.mjs | partial (88 pass, 1 fail) | 3200 ms | 1 lỗi: anthropic-ingress.test.mjs:540 — ENOENT /tmp/boxfox-logs/router.jsonl (phụ thuộc thứ tự chạy). Bản mô tả việc ghi 85 ca. |
| frontend | cd frontend && npx vitest run | partial (666 pass, 4 fail) | 14550 ms | 2 tệp lỗi / 84 tệp đạt (86); 4 test lỗi / 666 đạt (670). Khớp bản mô tả việc (666/4). |
| deploy-docker | cd deploy/docker && python3 -m unittest discover -s tests -p "test_*.py" | pass (353 pass) | 27179 ms | Ran 353 tests / OK. Bản mô tả việc ghi 350. |

## Ca hỏng và lý do hỏng (§6)

| Ca | Loại hỏng | Lý do |
|---|---|---|
| backend | hồi quy | 10 lỗi nằm ở backend/tests/unit/test_web_tools.py (việc song song đang sửa); chạy riêng tệp đó: 30 passed in 0.30s ⇒ lỗi tạm thời. Bản mô tả việc ghi 373/2/2 — số hôm nay khác. |
| router | hồi quy | 1 lỗi: anthropic-ingress.test.mjs:540 — ENOENT /tmp/boxfox-logs/router.jsonl (phụ thuộc thứ tự chạy). Bản mô tả việc ghi 85 ca. |
| frontend | hồi quy | 2 tệp lỗi / 84 tệp đạt (86); 4 test lỗi / 666 đạt (670). Khớp bản mô tả việc (666/4). |

## Lượt hỏng vì hạ tầng (KHÔNG tính vào điểm chất lượng, §6)

Không có lượt nào bị ghi là hỏng hạ tầng trong dữ liệu thô.

## Chưa xác minh

- Manifest thiếu trường: `provider`
- Manifest thiếu trường: `model`
- Manifest thiếu trường: `seed`
- Manifest thiếu trường: `temperature`
- Manifest thiếu trường: `maxSteps`
- Chi phí thật chưa đo: token vào
- Chi phí thật chưa đo: token ra
- Chi phí thật chưa đo: thời gian tường
- Chi phí thật chưa đo: số bước
- Không có dòng điểm nào: bảng chất lượng chưa có số

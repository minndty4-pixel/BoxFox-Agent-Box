# Tầng R — bộ ca research R1–R12 chấm bằng oracle máy (0 đồng, 0 lượt model)

> Nguồn: [flow kế hoạch v27, §7](../../../docs/plan/v27/subplans/flow.md) (C-7: bộ ca R1–R7 +
> oracle máy + năm số) và [research-rework §5](../../../docs/plan/v27/research-rework.md) (bốn ca
> R8–R12). Bản máy đọc được của cùng dữ liệu: `scripts/eval/benchmarks/tiers.json` (mục
> `id: "tier-r1"`) và `scripts/eval/fixtures/R1.json` … `R12.json` (một ca một tệp).
>
> **Trạng thái 2026-09-24: đã dựng xong oracle + giàn chấm, CHƯA CHẠY MỘT LƯỢT RESEARCH THẬT NÀO
> và CHƯA CHẠY MỘT LƯỢT BENCHMARK RESEARCH NÀO.** Không có kết quả research nào để báo ở đây:
> mọi con số của tầng này là **0 đồng / 0 lượt gọi model**, hoặc là số đo trên **ví dụ dựng tay**
> trong `scripts/eval/results/tier-r1-research/`. Chỗ nào chưa đo thì ghi đúng chữ "chưa đo" —
> không suy đoán, không nhận đã chạy (bất biến F19 + luật trung thực §9.4 của kế hoạch chất lượng).

## 1. Vì sao tầng này không tốn tiền, không mở mạng

Chấm điểm ở đây là **oracle máy thuần**: `scripts/eval/research_checks.py` gồm 27 hàm chỉ đọc hai
đầu vào và trả `{name, ok, detail}` —

| Đầu vào | Là gì | Ai ghi ra |
|---|---|---|
| phòng hồ sơ | `.research/<việc>/v<N>-<việc>.md` + `sources.jsonl` + `sources.md` + `tables/*.md` + `review.md` + `conflicts.md` | op `dossier_write` của box (`backend/src/agentbox/sandbox/worker.py`) |
| bản ghi event | nhật ký lượt: lời gọi tool, event `child` mở/đóng nhánh | `session_store.events()` (bảng `events`) hoặc JSONL tương đương |

Không hàm nào gọi model, mở socket hay đọc đồng hồ; hai ca kiểm của chính oracle chạy trong
`backend/tests/unit/test_research_checks.py`. Vì vậy tầng này **không cần ngân sách và không cần
`BOXFOX_EVAL_ALLOW_SPEND`** — nhưng cũng vì vậy nó **không thay được** một lượt chạy thật: oracle
chỉ chấm thứ đã có trong phòng hồ sơ và nhật ký.

## 2. Bộ ca R1–R12

Nguồn: `scripts/eval/fixtures/R*.json`; `scripts/eval/results/tier-r1-research/cases.jsonl` là bản
sao một dòng một ca (cùng thứ tự, cùng `layer1_checks`).

| Mã | Việc | Mạng | Trần bước | Trần lượt (s) | Oracle máy của ca |
|---|---|---|---|---|---|
| R1 | mức 1: một dữ kiện, nguồn chính thống | off | 20 | 1200 | `dossier_frontmatter_present`, `sources_opened`, `tier_recorded` |
| R2 | mức 2: khảo sát một chủ đề, 3 nhánh | **on** | 40 | 1200 | `branch_files_exist`, `dossier_files_exist`, `branch_count_at_most`, `claims_have_sources` |
| R3 | mức 2: tài liệu dài (trang fixture 200 KB) | off | 40 | 1200 | `read_beyond_first_chunk`, `no_snippet_cited_as_read` |
| R4 | mức 3: đuổi trích dẫn lùi + tiến + bão hoà | off | 40 | 3600 | `citation_chase_logged`, `saturation_logged`, `conflicts_file_exists`, `critique_file_exists` |
| R5 | mức 3: hai nguồn mâu thuẫn về cùng con số | off | 40 | 3600 | `conflict_row_present`, `dual_source_declared` |
| R6 | phiên mơ hồ: KHÔNG nói mức | off | 40 | 1200 | `tier_recorded_default`, `brief_notice_present` |
| R7 | mức 2 nhưng main bị chặn nguồn (trang lỗi 403) | off | 40 | 1200 | `blocked_source_recorded`, `no_fabricated_url`, `no_unread_snippet` |
| R8 | Bảng biểu: bản HTML/JATS so với PDF | off | 40 | 1200 | `tables_from_structured_source` |
| R9 | Gap hai tầng số: đủ sàn thì "đã kiểm", chưa đủ thì "tín hiệu, chưa kiểm" + lý do | off | 40 | 3600 | `gap_labelled_as_signal_unverified` |
| R10 | Sóng nhánh: 3–5 nhánh mỗi sóng, sóng sau khi sóng trước xong | off | 40 | 3600 | `wave_branch_ceiling_respected` |
| R11 | Trần mềm + trần cứng: khai trần ở thẻ mốc, chạm trần cứng thì báo + hỏi chủ nhà | off | 40 | 3600 | `milestone_ceiling_declared`, `hard_ceiling_reported` |
| R12 | Soi ý kiến chủ nhà: `review.md` đủ ba nhãn ủng hộ / phản bác / chưa chắc | off | 40 | 3600 | `owner_views_three_labels`, `review_file_exists` |

R2 là ca duy nhất cần mạng (`tiers.json` + `fixtureset.RESEARCH_ONLINE_ALLOWED = ('R2',)`), nên
bộ ca này **chưa chạy hết được** kể cả khi có máy: 11 ca offline chạy được trước, R2 xếp sau.

## 3. 27 hàm oracle

Tên trong `rubric.RESEARCH_CHECKS` **phải khớp từng chữ** với bảng tên `research_checks.CHECKS`
(có ca kiểm ghim hai danh sách này bằng nhau, cùng thứ tự):

| Nhóm | Hàm |
|---|---|
| Hồ sơ và mức | `dossier_frontmatter_present`, `sources_opened`, `tier_recorded`, `tier_recorded_default`, `brief_notice_present`, `dossier_files_exist` |
| Nhánh và sóng | `branch_files_exist`, `branch_count_at_most`, `wave_branch_ceiling_respected` |
| Đọc và trích dẫn | `read_beyond_first_chunk`, `no_snippet_cited_as_read`, `no_unread_snippet`, `no_fabricated_url`, `claims_have_sources`, `tables_from_structured_source` |
| Đuổi trích dẫn, mâu thuẫn, ý kiến chủ nhà | `citation_chase_logged`, `saturation_logged`, `conflicts_file_exists`, `critique_file_exists`, `conflict_row_present`, `dual_source_declared`, `review_file_exists`, `owner_views_three_labels` |
| Chặn nguồn, gap, trần | `blocked_source_recorded`, `gap_labelled_as_signal_unverified`, `milestone_ceiling_declared`, `hard_ceiling_reported` |

Mỗi hàm có **một ca đúng và một ca sai** trong `backend/tests/unit/test_research_checks.py`
(riêng một ca của `milestone_ceiling_declared` đang là `xfail` — xem §6). Ca kiểm chạy qua
`research_checks.run_checks([tên], …)` nên bảng tên, `CASE_OPTIONS` (mức/trần theo ca) và chính
hàm oracle đều được kiểm trong cùng một lượt.

## 4. Năm số của mỗi ca (flow §7.3)

`research_checks.quality_numbers()` trả năm số, mỗi số kèm `basis` (số lấy từ đâu) và `detail`:

| Số | Công thức | Nguồn |
|---|---|---|
| `factual_accuracy` | khẳng định có nguồn / tổng khẳng định | `sources.jsonl` |
| `citation_precision` | nguồn mở được **và** có đoạn trích đọc lại được / tổng nguồn | `sources.jsonl`; thiếu thì ghi rõ đang đọc `sources.md` và không chấm |
| `coverage` | nhánh có kết luận / nhánh mở | event `child`; không có thì đếm thư mục hồ sơ |
| `source_quality` | tỉ lệ nguồn tầng 1 (kèm `distribution` tầng 1–4) | `sources.jsonl` |
| `efficiency` | giây đã dùng / trần của mức, kèm số bước | `research_brief` trong nhật ký |

Số nào **chưa đo được** thì `value` là `null` kèm lý do — **không ghi 0 thay cho "chưa biết"**
(0 là một phép đo, `null` là một chỗ trống). `scripts/eval/research_scores.py` giữ nguyên luật đó
khi ghi dòng điểm.

## 5. Lệnh chạy (đều offline, đều 0 đồng)

```bash
# 1. Ca kiểm của chính oracle (13 ca cũ của RQ1–RQ8 + 66 ca mới của bộ R)
./.venv/bin/python -m pytest backend/tests/unit/test_research_checks.py -q -p no:randomly

# 2. Kế hoạch chạy của tầng R (không chạy gì, chỉ in ra): phải thấy R1 trong kế hoạch
./.venv/bin/python scripts/eval/run_eval.py --plan --fixtures R1 --tier tier-r1
./.venv/bin/python scripts/eval/run_eval.py --list

# 3. Cửa vào ghi số: chạy trên phòng hồ sơ của một lượt, ghi một dòng vào sổ điểm thô
python3 scripts/eval/research_scores.py --help
python3 scripts/eval/research_scores.py \
    --workspace <thư mục có .research/> [--log <events.jsonl>] --case R1 [--checks] \
    --out scripts/eval/results/tier-r1-research/scores.jsonl --append \
    --source '<tên lượt chạy thật>'
```

`research_scores.py` giữ đúng ba mã thoát: `0` xong, `1` có `--checks` và một oracle trượt,
`2` sai cách dùng (thiếu `--workspace`/`--case`, không thấy `.research/`, `--out` đã tồn tại mà
không `--append`). Sổ điểm là **sổ chỉ ghi thêm**: ghi đè phải xin `--append`.

## 6. Ba chỗ lệch đã đo và ĐÃ VÁ (vòng 27, lượt hậu kỳ 2026-09-24)

Ba chỗ dưới đây lộ ra khi soát bộ đo này; cả ba đã sửa trong `scripts/eval/**` và có ca ghim, nên
"chỗ lệch đã biết" của vòng này nay là **chỗ đã vá** — ghi lại đây để người đọc tệp không phải tin
lời: mỗi mục kèm cách kiểm lại.

1. **`milestone_ceiling_declared` không thể đạt do lỗi so nhãn — đã vá.** Dòng cũ trong
   `research_checks.py` so `'trần'` (còn dấu) với từng dòng **đã bỏ dấu** (`_fold`) nên phép so không
   bao giờ khớp. Nay hàm lấy `label = _fold('trần')` rồi `re.search(rf'\b{re.escape(label)}\b', _fold(line))`,
   và dấu `xfail(strict=True)` trên ca `test_milestone_ceiling_declared_dat` đã **bỏ**.
   Kiểm lại: `./.venv/bin/python -m pytest backend/tests/unit/test_research_checks.py -q`.
2. **Kế hoạch tầng R in thừa khối chi phí đường Q — đã vá.** `build_plan` nay tách hai họ theo
   `fixtureset.family_of(code)`: `quality_codes` (Q) và `research_codes` (R), khối "bộ N fixture chất
   lượng" chỉ tính trên họ Q, và họ R có khối riêng ghi rõ "0 lượt model — hạng mục `research-scores`
   đang chặn". Kiểm lại: `--plan --fixtures R1 --tier tier-r1 --json` ⇒ `qualityTrackIncluded false`,
   `modelCalls 0`, `costUsd [0, 0]`; `--plan --fixtures Q1 --fixtures R1` ⇒ "1 fixture chất lượng ×
   3 cấu hình × 1 lần lặp — 9 lượt model".
3. **`--list` không lọc theo `--fixture` — đã vá.** `render_list` nay in bảng của **họ đang chọn**
   (Q *hoặc* R) và tách họ còn lại thành khối riêng; tiêu đề nói rõ họ nào. Kiểm lại:
   `--list --fixtures R1` ⇒ tiêu đề "Fixture research (tầng R, kế hoạch vòng 27 §8) — 1 ca tĩnh:";
   `--list --fixtures Q1 --fixtures R1` ⇒ mỗi mã hiện **đúng một lần**, dưới tiêu đề của họ nó.
4. **Dòng trỏ từ sổ theo dõi sang tệp điểm (flow §7.5) — đã thêm**:
   `docs/tracking/eval-tier0-regression.md` có mục bộ ca research và dòng trỏ `tier-r1-research`.
5. **`scores.jsonl` hiện có ĐÚNG MỘT dòng, và dòng đó là ví dụ dựng tay** trên
   `results/tier-r1-research/fixture-workspace/` (tên miền `.example`, con số chỉ minh hoạ hình
   dạng hồ sơ). Nghiệm thu C-7 còn đòi "chạy R1+R3+R6+R7 trên 3 lượt thật và ghi số lần đầu" —
   **chưa làm được** vì chưa có lượt research thật nào (runner thật vẫn dừng ở
   `EXIT_NOT_IMPLEMENTED` = 5). Cho tới lúc đó, mọi báo cáo phải nói đúng câu: *bộ ca R + oracle
   máy đã có, benchmark research thì chưa chạy* (F19).

## 7. Checklist "xong khi"

- [x] Sửa lỗi so nhãn ở §6.1 và bỏ dấu `xfail` của ca `milestone_ceiling_declared`.
- [x] Bỏ khối chi phí đường Q khỏi kế hoạch tầng R (§6.2) — họ R nay có khối riêng, 0 lượt model.
- [x] `--list` lọc theo `--fixture` và nói rõ họ đang chọn (§6.3).
- [x] Thêm dòng trỏ từ `docs/tracking/eval-tier0-regression.md` sang tệp điểm mới (flow §7.5).
- [ ] Có một lượt research thật (máy có model + box) sinh `.research/**` cho R1, R3, R6, R7.
- [ ] Chạy `research_scores.py --checks --append` trên phòng hồ sơ của ba lượt đó, ghi số thật.
- [ ] Chỉ khi nào R1/R3/R6/R7 có dòng điểm thật thì mới được gọi là "đã chạy benchmark research".

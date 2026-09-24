# Vòng 29 — kiểm nghiệm research: đợt này (offline) và giao thức chạy sống cho đợt sau

> **TL;DR:** đợt này chỉ kiểm bằng unit test trên code — **không gọi nhà cung cấp nào**: ghép bộ ca
> `R1–R12` với máy móc mà nó cần, dựng **giàn probe với provider GIẢ** để ghim luật xoay khoá của
> vòng 29, sửa câu tài liệu còn nói ngược; còn "lượt research thật đầu tiên" thì viết thành **giao
> thức chạy tay** để đợt sau thực thi.

## 1. Số đo đã có (không đo lại lần nữa)

Sổ đầy đủ: `docs/tracking/test-rounds.md` § *"Lượt research Y TẾ THẬT — sáu lần thử trên app thật
(harness scratch `3151`, 2026-09-24)"* (bắt đầu dòng 2607) và `/var/tmp/v28/rounds_live_runs2.md`.

| Lần | Khoá | Sổ nguồn | Hồ sơ | Kết thúc lượt |
|---|---|---|---|---|
| 1 `0d0fe166` | OpenCode Free | 13 hàng | không (cổng từ chối 1 lần) | `failed` — `UPSTREAM_HTTP_502` bước 22, 13,8 phút |
| 2 `30003232` | OpenCode Free | 24 hàng | không | `failed` — `UPSTREAM_HTTP_502` bước 15, 13,7 phút |
| 3 `b5832e29` | key 1 | 9 hàng | không (từ chối 2 lần) | `completed partial` — `DEADLINE_EXCEEDED` bước 30, 20,2 phút, 41 tool |
| 4 `bc8d9125` | key 1 | 9 hàng | không (từ chối 1 lần) | `failed` — `UPSTREAM_HTTP_502` bước 21, 13,0 phút |
| 5 `6e274b19` | key 1 | 2 hàng | không | `failed` — `DEADLINE_EXCEEDED` đúng 600 s, bước 2 (chờ nhánh con) |
| 6 `5e689d49` | key 1 | 0 hàng | không | `failed` — `UPSTREAM_HTTP_502` bước 14, 8,5 phút |

Năm kết luận đo được (nguyên văn, dùng lại cả ở tài liệu handoff):

1. Đọc nguồn là thật — mọi hàng sổ có URL mở bằng `web_fetch`/`web_search` và đoạn trích nguyên văn
   79–464 ký tự (một hàng 79 ký tự bị cổng bắt vì dưới sàn 80 — luật chạy đúng).
2. Sổ nguồn phân tầng thật — `host` + `tier` do máy chấm (WHO `who.int` tầng 1, báo chính thống
   tầng 2, Wikipedia/`api.crossref.org` tầng 3) và có bộ đếm `byTier`/`independent` từng hàng.
3. Cổng chất lượng chạy thật ở `enforce` — `dossier_write` bị **TỪ CHỐI** năm lần trên năm lượt, kèm
   danh sách mục cần sửa; model **quay lại sửa** thay vì bịa.
4. Hạn mức lượt là chỗ chặn THẬT của mức 2 — xin 600 s thì máy không nới, xin 1200 s thì `+600 s`.
   Hợp đồng công cụ `research_brief` **không nói gì** về tham số `ceilingSeconds`.
5. Nhà cung cấp miễn phí cắt lượt ở phút 8,5–14 (bốn lần `UPSTREAM_HTTP_502`) — **trước** khi một lượt
   mức 2 kịp đóng hồ sơ.

**Chưa có** một tệp `.research/**` nào được ghi ra từ các lượt trên, `manifest.json` vẫn
`measured: false`, và `R1–R12` chưa từng chạy trên dữ liệu thật ⇒ **C-7 còn mở**, **F19 cấm** nói
"đã có benchmark research" cho tới khi có số thật.

## 2. Ranh giới đợt này

### 2.1 Trong phạm vi

- Chạy và giữ xanh **bộ đơn vị research** (đo lại tại HEAD `deda6e8`: **286 passed trong 25,09 s**,
  16 tệp `test_research_*`/`test_source_*`/`test_dossier_write_tool.py`/`test_worker_dossier.py`).
- **Giàn probe provider GIẢ** (mục 3.3): ghim bằng máy luật xoay khoá 429/400/5xx của vòng 29.
- Sửa câu tài liệu còn nói một oracle đang hỏng dù nó đã được vá (mục 3.2).
- Viết **giao thức chạy sống** (mục 4) và **tài liệu handoff** `docs/handoff/research-verification.md`
  (xem `/code/.plans/subplans/v29-research-handoff-outline.md`).

### 2.2 Ngoài phạm vi — nói thẳng

- **Không gọi nhà cung cấp thật**, không tốn hạn mức, không tốn tiền (quyết định của chủ nhà).
- **Không** chứng minh "một lượt research thật giờ chạy xong". Vòng 29 chỉ chứng minh **luật xoay
  khoá đúng ở tầng router + harness không phải sửa gì**.
- **Không** điền `measured: true` cho `scripts/eval/results/tier-r1-research/manifest.json` và
  **không** thêm dòng "lượt thật" nào vào `scores.jsonl`.
- **C-7 vẫn mở** (chạy `R1+R3+R6+R7` trên ba lượt thật, ghi số đầu tiên).
- **Không** chạy `run_eval.py --execute`: nó vẫn trả `EXIT_NOT_IMPLEMENTED` (mã 5) — bộ chạy ca R
  chưa có, và đợt này **không** làm nó.

### 2.3 Vì sao đợt này không thể có bằng chứng đầu-cuối (số đo)

Harness **luôn** gọi router ở `http://127.0.0.1:3101`: `RouterClient.__init__(url='http://127.0.0.1:3101')`
(`backend/src/agentbox/agent_core/runtime.py:460`) và `main()` dựng `HarnessRuntime(...)` **không**
truyền client khác (`backend/src/agentbox/api/server.py:924`). Cổng 3101 đang là router của chủ nhà
— **không được** chiếm để dựng router scratch. Vì vậy mọi thử "router giả ở cổng khác" đều không
nối được vào harness nếu không sửa code. Nếu đợt sau muốn có bằng chứng đầu-cuối hoàn toàn offline,
việc cần làm là **một dòng**: cho `RouterClient` đọc `BOXFOX_ROUTER_URL` (mặc định giữ nguyên 3101)
rồi dựng router scratch ở cổng khác có `BOXFOX_ROUTER_PORT`/`BOXFOX_ROUTER_DATA_DIR`
(`router/src/main.mjs`, `router/src/store.mjs:14-31`). Việc này **để chủ nhà quyết ở đợt sau**, không
tự thêm trong đợt này.

## 3. Việc kiểm đợt này (offline, không mạng, 0 đồng)

### 3.1 Bộ ca `R1–R12` đã có sẵn gì, còn thiếu gì

Soát lại cho thấy **hạ tầng khớp tên/tệp đã đủ**, không dựng lại: `test_moi_fixture_r_khai_muc_va_khop_voi_ca`,
`test_bang_ten_oracle_khop_rubric_va_dung_thu_tu`, `test_moi_oracle_trong_bo_ca_deu_co_ten_trong_bang`,
`test_fixture_r_du_muoi_hai_ca_va_chi_R2_bat_mang` (`backend/tests/unit/test_research_checks.py`),
cộng `test_eval_setup.py` cho hình dạng fixture.

Hai thứ còn thiếu, nhưng chỉ một thứ đợt này bịt (nói thẳng ở cột cuối):

| Thiếu gì | Nghĩa | Cách xử |
|---|---|---|
| Bộ chạy ca R | `run_eval.py --execute` trả `EXIT_NOT_IMPLEMENTED` (5) | **Không** bịt đợt này — nó chỉ có nghĩa khi có lượt thật; đường ghi số thật là `research_scores.py` (mục 4.6) |
| Bằng chứng xoay khoá | chưa có gì trong `router/tests/**` ghim luật "429 ⇒ chuyển khoá" | giàn probe ở mục 3.3 |

### 3.2 Việc nhỏ phải sửa: câu tài liệu còn nói oracle đang hỏng (đã đo lại, nay không còn lỗi)

- **Đo lại tại HEAD `deda6e8`:** ca `milestone_ceiling_declared` (ca **R11**) **đã được vá** — hàm lấy
  `label = _fold('trần')` rồi so với `_fold(line)` (`scripts/eval/research_checks.py:1288-1291`), và
  dấu `xfail` **không còn** trong `backend/tests/unit/test_research_checks.py` (không còn dòng `xfail`
  nào). Chạy lại: **83 passed** cho tệp đó.
- **Nhưng tài liệu còn nói ngược:** `scripts/eval/benchmarks/tier-r1.md:66` vẫn viết *"riêng một ca của
  `milestone_ceiling_declared` đang là `xfail` — xem §6"*, trong khi §6.1 của **cùng tệp** nói đã bỏ.
  Sửa một câu ở dòng 66 cho khớp §6.1 (không sửa mã, không thêm ca).
- **Vì sao vẫn phải sửa:** người đọc sau thấy hai câu ngược nhau trong cùng tệp sẽ tưởng bộ chấm còn
  hỏng, rồi đi "vá lại" thứ đã lành.

### 3.3 Giàn probe provider GIẢ (hai tầng, cả hai chạy trong `pytest`/`node --test`)

Cả hai tầng dùng **stub trong tiến trình**, không mở socket ra Internet:

| Tầng | Chạy ở đâu | Stub bằng gì | Chứng minh điều gì |
|---|---|---|---|
| **Router (Node)** — nơi có luật xoay khoá | `cd router && npm test` (`node --test tests/*.test.mjs`) | `createProviders({ fetchImpl: stub })` — stub trả `new Response(JSON.stringify(...), { status: 429\|400\|500 })`; khuôn có sẵn ở `router/tests/custom-provider.test.mjs` | 429 ⇒ **khoá kế tiếp trong vòng được dùng cho CHÍNH request đó**; 400 hình dạng ⇒ **không** xoay; 5xx ⇒ không xoay khoá; khoá vừa cháy 429 bị **nghỉ 30 s** (hoặc `Retry-After`, chặn trần 120 s); hết sạch khoá ⇒ **một** lỗi trả về, không treo |
| **Harness (Python)** — nơi gọi router | `backend/tests/unit` / `backend/tests/integration` | `RouterClient(url)` trỏ vào `aiohttp` `TestServer` giả `/api/router/chat`; khuôn có sẵn ở `backend/tests/unit/test_harness_runtime.py` (ca auth ~dòng 230, ca kênh rỗng + 502 ~dòng 270) | router xoay khoá **ở trong** ⇒ harness thấy **200 bình thường**, lượt chạy tiếp (**không phải sửa harness**); hết sạch khoá ⇒ harness thấy lỗi tạm thời (`UPSTREAM_HTTP_429`/`RATE_LIMIT`, đã có sẵn luật thử lại + `Retry-After` ở `backend/src/agentbox/agent_core/failures.py:225-320`) và **không** treo lượt |

Điều giàn probe **không** chứng minh (ghi rõ vào tài liệu, đừng nói quá): nhà cung cấp thật có cắt
lượt ở phút 8,5–14 như đo được không; một lượt mức 2 có kịp đóng hồ sơ trên khoá thật không; và
hạn mức theo phiên của provider miễn phí có luật gì. Ba câu đó chỉ lượt sống trả lời.

**Vì sao luật xoay khoá lại quan trọng (số đo, không phải phỏng đoán):** khi harness ghim
`connectionId`, router chỉ dựng **một** đích (`router/src/engine.mjs:22-48`: nhánh `providerId` mới
sinh nhiều đích; nhánh còn lại là `targets = [selected]`). Nên hôm nay "một connection = một khoá =
một phát": 429/502 là hết đường, refusal về tới harness. Vòng khoá đổi đúng chỗ đó — nhiều khoá
**trong cùng một connection**, nên `connectionId` ghim vẫn sống.

## 4. Giao thức CHẠY SỐNG (đợt sau, khi vòng khoá đã xong)

### 4.1 Chuẩn bị (không chạm máy chủ nhà)

```bash
cd /code/minndty3-design/BoxFox-Agent-Box
# harness scratch RIÊNG của lượt test (đừng dùng 3102 của chủ nhà)
/var/tmp/v27t/start_harness.sh research-v29 3151 \
  BOXFOX_RESEARCH_BRIEF=enforce BOXFOX_RESEARCH_GATE=enforce BOXFOX_RESEARCH_PROGRESS=on
# canopy bật: brief + cổng + tiến độ. Tắt được khi cần đối chứng:
#   BOXFOX_STEER / BOXFOX_WEB_READER / BOXFOX_WEB_DECODE / BOXFOX_WEB_READ_STORE / BOXFOX_PLAN_VERIFY
```

`start_harness.sh <name> <port> [ENV=VAL ...]` dựng `/var/tmp/v27t/<name>/logs`, ghi pid, và chờ
`/api/agent/health` (cần header `X-BoxFox-Admin: 1` + `Origin: http://localhost:3100`).

### 4.2 Chạy một lượt

```bash
/var/tmp/v27t/run_live.py 3151 /var/tmp/v27t/research1_prompt.txt /var/tmp/v28/sid-r1.txt "research v29 lượt R1"
/var/tmp/v27t/watch.sh        # một lần: HEAD, git status, mtime, tail nhật ký phiên
```

`run_live.py` ghim `connectionId` ở dòng 28 (`f8a5f4e8-0986-45f9-bf5b-555e8b96a95c` = key 1) và
`modelId` `muse-spark-1.3-contributor-free`. **Nếu vòng khoá chọn id sống sót khác thì sửa đúng một
dòng này** trước khi chạy. Thứ tự đề nghị cho đợt đầu: `R1` → `R6` → `R7` → `R3` (mỗi ca một lượt,
mỗi lượt một hàng vào sổ).

### 4.3 Luật chuyển khoá (nguyên văn bảng §2.3 của `docs/plan/v27/research-quality-tests.md`)

| Mã lỗi gặp | Nghĩa | Việc làm | Nhãn ghi vào doc |
|---|---|---|---|
| `429` / "rate limit" | hết hạn mức của khoá đó | chuyển **khoá kế tiếp** | `RATE_LIMIT → chuyển key N+1` |
| `403` | khoá hỏng/không đủ quyền (AUTH, không thử lại) | chuyển khoá kế tiếp, và **ghi lại** | `AUTH(403) → chuyển key N+1` |
| `500`/timeout | lỗi hạ tầng | thử lại đúng khoá đó 1 lần rồi mới chuyển | `INFRA → retry 1 → key N+1` |
| `400` hình dạng | mình gửi sai (không phải khoá) | **không** chuyển khoá: sửa hình dạng trước | `400 hình dạng → sửa client` |

Sau vòng khoá, luật này **tự chạy trong một connection**; chỉ khi **mọi** khoá trong vòng đều 429
thì lượt chết với `RATE_LIMIT`/`UPSTREAM_HTTP_429` ⇒ ghi "hết hạn mức cả vòng khoá", **dừng phần
sống**, không đổi model (đổi model không cứu được hạn mức — §2.4 của tài liệu vòng 27).

### 4.4 Tiêu chí đạt/không đạt theo ca (đợt đầu)

| Ca | Lượt mức | Đạt khi | Ghi chú đo được |
|---|---|---|---|
| `R1` | 1 (1200 s) | có hồ sơ mức 1: `dossier_frontmatter_present` + `sources_opened` + `tier_recorded` | ca rẻ nhất, chạy ĐẦU để đo nhà cung cấp có sống qua nổi một lượt research mức 1 |
| `R6` | 2 (1200 s) | phiên KHÔNG nói mức ⇒ `tier_recorded_default` + `brief_notice_present` | chứng minh mặc định mức 2 + thông báo ngắn |
| `R7` | 2 (1200 s) | chạm một nguồn bị chặn (`403`) ⇒ `blocked_source_recorded`, `no_fabricated_url`, `no_unread_snippet` | phải **chọn trước** URL thật trả 403; không tìm được thì ghi "chưa chạy được ca này", không bịa |
| `R3` | 2 (1200 s) | đọc quá khúc đầu một tài liệu dài thật: `read_beyond_first_chunk`, `no_snippet_cited_as_read` | chọn một tài liệu dài (PDF/bài dài) trước khi chạy |
| `R2`, `R4`, `R5`, `R8`–`R12` | 2/3 (1200/3600 s) | theo cột oracle của `scripts/eval/benchmarks/tier-r1.md` §2 | mức 3 (3600 s) **khó đạt** khi nhà cung cấp cắt ở phút 8,5–14; chạy sau, ghi rõ nếu bị cắt |

Không đạt vì hạn mức/nhà cung cấp **không phải** "ca trượt": ghi mã lỗi + phút bị cắt rồi thôi.

### 4.5 Bằng chứng phải giữ cho mỗi lượt

- Phòng hồ sơ `.research/<việc>/v<N>-<việc>.md` + `sources.jsonl` + `sources.md` + `tables/*.md`
  + `conflicts.md` + `review.md` (nếu lượt kịp ghi).
- Nhật ký: bảng `events` của phiên, hoặc `GET /api/agent/sessions/{sid}/journal?limit=500`
  (`backend/src/agentbox/api/server.py:477`) đổ ra JSONL — `research_scores.py --log` nhận cả hai
  hình dạng (phép bóc `unwrap_event`).
- Bảng sổ nguồn của lượt (số hàng, `tier`, `byTier`, `independent`) chép vào hàng ghi sổ.
- Một ảnh màn hình mặt câu trả lời (app thật), lưu vào `/code/.generated_artifacts/`.
- Log harness của lượt: `/var/tmp/v27t/research-v29/logs/harness.jsonl`.

### 4.6 Ghi số (chỉ khi có lượt thật)

```bash
./.venv/bin/python scripts/eval/research_scores.py \
  --workspace <thư mục chứa .research/> --log <journal.jsonl> \
  --case R1 --level 1 --checks \
  --source "lượt thật <sid> <ngày> — muse-spark-1.3-contributor-free, connection <nhãn khoá>" --append
```

Sau đó, và chỉ sau đó: `manifest.json` ← `measured: true` + `provider`/`model`/`seed`/`temperature`
+ `counts` thật; ghim commit đã đo; thêm **một hàng** vào `docs/tracking/test-rounds.md` §vòng 27
(**tệp này là CRLF** — giữ nguyên kiểu xuống dòng, đừng để diff nhuộm cả tệp); nếu đã đủ ba lượt thật
cho `R1+R3+R6+R7` thì đóng **C-7** và nói rõ **F19** đã hết hiệu lực ở phần nào.

### 4.7 Dừng khi nào (kỷ luật ngân sách)

- Cả vòng khoá 429 ⇒ dừng phần sống ngay, ghi sổ, chuyển sang phần offline.
- Nhà cung cấp cắt lượt hai lần liên tiếp trước phút 10 ⇒ dừng, ghi "nhà cung cấp miễn phí không đủ
  thời lượng cho mức 2" — đó là **kết quả**, không phải lỗi cần sửa bằng cách đổi model.
- Quá ba lần thử cho cùng một ca ⇒ dừng ca đó, ghi rõ đã thử mấy lần và vì sao.

## 5. Năm phát hiện sống đang treo + việc còn lại từ trước

| # | Phát hiện / việc | Đóng được bằng unit test? | Cách đóng |
|---|---|---|---|
| a | Cổng từ chối tiêu đề Việt tự nhiên ("Kết luận chính") — bảng biến thể `DOSSIER_SECTIONS` (`research_quality.py:88`) chỉ nhận `phat hien`/`ket qua`/`findings` cho mục Phát hiện, nên tiêu đề tự nhiên không khớp ⇒ `research-shape-missing` | **Có** | thêm biến thể tự nhiên (`ket luan`, `tong ket`, `nhan xet`) vào bảng + ca đúng/sai mới; rẻ, offline |
| b | Câu sửa "Thêm nguồn khác nguồn tin gốc" đọc thành "thêm một TRANG" trong khi luật là khác **HOST** | **Có** | sửa câu chữ trong thông báo cổng + ca ghim câu mới |
| c | JSON tham số hỏng bị thay bằng `{}`, model chỉ nhận một dòng "Invalid tool arguments" (không độ dài, không vị trí lỗi) — câu lỗi nằm trong **cây vendor**: `backend/src/agentbox/vendor/hermes/tool_arguments.py:14` | **Có**, nhưng phải chọn chỗ sửa | hoặc vá thẳng cây vendor, hoặc bọc lại ở chỗ gọi (nâng thông báo kèm độ dài + vị trí) rồi ghim ca — cần chủ nhà/agent chốt cách nào |
| d | `ceilingSeconds` **không được mô tả** trong hợp đồng `research_brief` (schema chỉ có `{'type': 'integer'}`) ⇒ mức 2 xin 600 s thì không được nới, xin 1200 s thì `+600 s` | **Có** (mô tả + ca hợp đồng) | thêm `description` nói trần mức và luật nới, và nói rõ trong bảng mức; **đây là bẫy giết lượt 5** — vòng khoá **không** sửa được nó |
| e | Nhánh `research` con nhận `RESEARCH_GATE_NOTE` với tiêu chí hồ sơ (`research-shape-missing`, `research-lineage-missing`) mà nhánh con **không có** `dossier_write` để thoả | Không — cần đổi hành vi | phải sửa cách phát ghi chú cho nhánh con, rồi **kiểm bằng một lượt thật** |
| — | **M6** — router không trả trường `cost` | Không (phải có lượt thật/metering) | giữ mở |
| — | **C-7** — chạy `R1+R3+R6+R7` trên ba lượt thật, ghi số đầu tiên | Không | mục 4 |
| — | Ghim âm `final-report`/D-44 mới ở mức **chuỗi** (D-44 đã xong ở vòng 28; đây chỉ nói về độ chặt của ghim âm) | Có (nâng thành cấp cấu trúc) | việc riêng, không chặn đợt này |
| — | Dọn nhỏ `v27e1-simplify`: tham số `final` của `_extract`, `import READ_STORE_MAX_ENTRIES` thừa ở `runtime.py:49` | Có | dọn khi tiện, không chặn đợt này |

**Khuyến nghị phạm vi:** mục **3.2** (sửa một câu tài liệu lệch) nên làm trong đợt này vì rẻ; (a)–(d)
là sửa nhỏ offline nên gộp được nếu chủ nhà muốn đóng bớt nợ; **(e) hoãn** — sửa mà không có lượt thật
để kiểm thì chỉ thêm rủi ro. Nếu đợt này giữ hẹp đúng vòng khoá thì cả (a)–(e) vẫn **phải** nằm trong
tài liệu handoff ở dạng "còn treo".

## 6. Rủi ro và cách xử

| Rủi ro | Cách xử |
|---|---|
| Tưởng vòng khoá đã "cứu" research ⇒ nói quá | tài liệu phải nói nguyên văn: *"đợt này chỉ chứng minh bằng unit test; KHÔNG chứng minh lượt research thật chạy xong"* |
| Chạm nhầm harness/router của chủ nhà | chỉ dùng cổng scratch `3151`; không chiếm `3101`/`3102`; mọi thao tác lên router chủ nhà chỉ khi chủ nhà gọi |
| Rò khoá | không dán giá trị khoá vào tài liệu/log/PR; chỉ dùng **nhãn** `key 1/2/3`; tệp `~/BoxFox/secrets/opencode-free-keys.txt` và blob mã hoá không bao giờ bị in ra |
| Sửa `test-rounds.md` làm nhuộm diff | tệp là **CRLF**; sửa bằng công cụ giữ nguyên xuống dòng |
| "Xanh giả" do chạy thiếu tệp | chạy cả `backend/tests/unit` (kèm `--deselect backend/tests/unit/test_terminal_tools.py::test_terminal_exec_echo`) rồi mới chạy bộ router |

## 7. Tasks

1. **[parallel] Sửa câu tài liệu lệch** — `scripts/eval/benchmarks/tier-r1.md:66` hết nói ca
   `milestone_ceiling_declared` "đang là `xfail`" (nay khớp §6.1 của cùng tệp). Không sửa mã, không
   thêm ca.
2. **[parallel] Giàn probe tầng router** — tệp test mới trong `router/tests/` dùng
   `createProviders({ fetchImpl })` để ghim: 429 ⇒ xoay khoá trong cùng request; 400 ⇒ không xoay;
   5xx ⇒ không xoay khoá; khoá cháy 429 nghỉ ≥ 30 s và ≤ 120 s; hết vòng khoá ⇒ một lỗi, không treo.
   *Phối hợp:* nếu bản key-ring đã có tệp test riêng thì **gộp vào đó**, đừng dựng hai bộ song song.
3. **[parallel] Giàn probe tầng harness** — ca dùng `RouterClient(url)` + `aiohttp` `TestServer` giả:
   router xoay khoá ở trong ⇒ lượt hoàn tất **không phải sửa harness**; hết vòng khoá ⇒ lỗi tạm thời,
   thử lại có chặn, không treo.
4. **[after 1–3] Sổ và tài liệu** — hàng ghi vòng 29 vào `docs/tracking/test-rounds.md` (nói rõ đã
   chứng minh gì / chưa chứng minh gì), và viết `docs/handoff/research-verification.md` theo
   `/code/.plans/subplans/v29-research-handoff-outline.md`.

### Testing

```bash
cd /code/minndty3-design/BoxFox-Agent-Box
./.venv/bin/python -m pytest backend/tests/unit -q -p no:randomly \
  --deselect backend/tests/unit/test_terminal_tools.py::test_terminal_exec_echo
./.venv/bin/python -m pytest backend/tests/unit/test_research_checks.py \
  backend/tests/unit/test_dossier_write_tool.py backend/tests/unit/test_research_gate_runtime.py \
  backend/tests/unit/test_research_brief.py -q -p no:randomly
cd router && npm test          # node >= 24 (router/package.json engines)
```

Đạt khi: bộ đơn vị xanh (nền đã đo **lại** tại HEAD `deda6e8`: research **286 passed / 25,09 s**, riêng
`test_research_checks.py` **83 passed** và **không còn `xfail`** nào; ghi số mới sau khi thêm ca); bộ
router xanh và **số ca tăng đúng bằng số ca mới** (ghi số trước/sau trong cùng commit); giàn probe
chứng minh đủ năm hành vi ở mục 3.3. Không cần và không được coi là đạt: `measured: true`, số trong
`scores.jsonl`, C-7.

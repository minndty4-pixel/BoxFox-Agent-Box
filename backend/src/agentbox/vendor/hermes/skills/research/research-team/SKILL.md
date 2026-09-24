---
name: research-team
description: "Ba mức, bốn pha, sổ nguồn và hồ sơ cho một việc nghiên cứu."
version: 1.0.0
author: BoxFox Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Research, Levels, Dossier, Sources, Coordination, Vietnamese]
    category: research
    related_skills: [grounded-citations, arxiv, blocked-page-recovery, final-report]
---

# Research Team — chạy một việc nghiên cứu như một nhóm

Main là **người duy nhất** nói với chủ nhà và là người chốt mức. Con `research` mở nguồn
thật, trích nguyên văn vào sổ, ghi tệp nhánh. Mọi kết quả nằm trong phòng `.research/<slug>/`.

**Vai nào gọi gì** (gọi sai vai ⇒ `PermissionError`):

| Việc | Ai gọi |
|---|---|
| `research_brief`, `delegate_task`, `research_verify`, `cancel_child`, `ask_user` | **chỉ main** |
| `source_add`, `source_list`, `source_verify`, `dossier_write` | main **và** con `research` |
| `source_list`, `source_verify` | thêm vai `research-review` |

## Bảng ba mức (#5960, #5965)

| | Mức 1 | Mức 2 (mặc định) | Mức 3 |
|---|---|---|---|
| Khi nào | một dữ kiện, một nguồn là đủ, xong trong ~2 phút | mơ hồ, hoặc việc có vài khía cạnh | trường phái/nguồn mâu thuẫn; hợp đồng, giá, định danh bị ảnh hưởng; chủ nhà muốn độ tin |
| Nguồn | một nguồn mở thật là đủ | nhiều nguồn, mỗi khẳng định then chốt có nguồn | như mức 2 + đuổi trích dẫn hai chiều |
| Nhánh | 1 con (thường không cần con) | 3–5 nhánh, **1 sóng** | tối đa 15 nhánh, **≤ 3 sóng** |
| Hồ sơ | 1 tệp | 3 tệp | 5–6 tệp |
| Phản biện | không | cổng máy tự kiểm (`research_verify`) | luôn có con phản biện độc lập `research-review` |
| Lượt / trần cứng | 1 200 s / 20 phút | 1 200 s / **30 phút** | 3 600 s / **120 phút** |
| Con chạy | 180 s, 20 bước | 420 s, 40 bước | 900 s, 40 bước |

Chọn mức khi bắt đầu lượt, **không** đổi giữa lượt (xem "một con số"); mơ hồ thì chọn mức 2.

## Luật một con số (#5960)

- **Một mức cho cả việc.** Mọi con nhận đúng mức đó trong mở đầu `context` của
  mình: `Mức: <n> · hồ sơ: <profile> · phòng hồ sơ: <dossierDir>` (giá trị lấy
  từ kết quả `research_brief`, dán nguyên văn — con không tự đoán).
- **Con không nâng mức.** Gặp chỗ cần cao hơn (nguồn đối lập, dữ kiện thiếu, việc phải
  quyết), con ghi vào mục `## Limitations & open questions` của tệp nhánh rồi trả về main —
  con **không** có quyền gọi `ask_user`/`request_approval` và **không** tự mở thêm nhánh.
- Không có brief ⇒ không có phòng hồ sơ: vẫn chạy, nhưng báo cáo nói rõ lượt này thiếu brief.

## Luật đọc (#5966)

**Đọc là mở thật, không phải đọc snippet.** Trình tự bắt buộc cho mỗi nguồn:

1. `web_search` để tìm, rồi **mở URL** bằng `web_fetch` (trang ngoài) — trang
   trong box thì `browser_use(action="navigate")` + `snapshot`.
2. Tài liệu dài: không cần đọc hết, nhưng phải lấy **đoạn liên quan** bằng
   `read_source(ref=…, find="từ khoá")` (tìm bỏ dấu) hoặc `offset`/`nextOffset`.
3. Dán **đoạn trích nguyên văn** (sàn 80 ký tự, cắt ở 2 000 — nhắm 200–600,
   không tóm tắt, không gõ lại) vào sổ bằng `source_add(claim=…, url=…, excerpt=…)`;
   `rowId` trả về (khuôn `r7`) là thứ được trích dẫn trong hồ sơ: `[r<N>]`.
4. Bài học thuật: `paper_citations(workId|doi, direction="backward"|"forward")`.

**Cấm:** trình bày một mẩu snippet như thể đã đọc toàn văn; trích dẫn một URL
chưa mở; gõ lại đoạn trích theo trí nhớ. **Không mở được bản gốc** (PDF không
đọc được, tường phí, 403/404) ⇒ ghi đúng chữ `chưa mở được bản gốc` cạnh khẳng
định đó, và thử thang `blocked-page-recovery` trước khi kết luận.

## SOP bốn pha

**Pha 1 — Bản đồ (scoping).** Liệt kê 5–12 câu hỏi con và xếp mỗi câu vào loại
nguồn trả lời được (cơ quan chính thức / bài báo / tài liệu kỹ thuật / dữ liệu
thị trường); chỉ ra chỗ còn mơ hồ. *Xong khi*: mỗi câu hỏi con có ≥ 1 nguồn ứng
viên, và số nhánh dự kiến ≤ trần nhánh của mức.

**Pha 2 — Chốt.** Gọi `research_brief(tier=…, jobProfile=…, question=…,
rationale=…, branches=…, ceilingSeconds=…, ownerViews=…)`, rồi `delegate_task`
cho từng nhánh (kèm dòng mở đầu `context` ở "Luật một con số" + dòng nhắc lĩnh
vực ở mục dưới). *Xong khi*: brief đã ghi (trả `dossierDir`, `branchCeiling`,
`waves`, `critique`) và mọi nhánh đã có con chạy.

**Pha 3 — Đào sâu.** Con mở nguồn thật, `source_add` đoạn trích, ghi tệp nhánh;
main gộp, tìm chỗ trống, mở thêm nhánh **trong hạn mức mức** (sóng mới chỉ khi
còn thiếu bằng chứng); mâu thuẫn ghi lại thành bảng đối chiếu. *Xong khi*: mỗi
câu hỏi con ở pha 1 có kết luận, hoặc một dòng "không tìm được nguồn nào đủ".

**Pha 4 — Phản biện độc lập.** Mức 3 (hoặc bất kỳ mức khi hợp đồng/giá/định
danh then chốt): giao vai `research-review` trên hồ sơ vừa ghi, chờ verdict
(`await_children`, trần chờ 300 s), rồi gọi
`research_verify(researchId=…, version=…, verdict="ok"|"revise", issues=…)`.
`revise` ⇒ sửa **một** vòng rồi ghi bản mới; vẫn `revise` ⇒ giao kèm nhãn "chưa
đạt" và nói rõ chỗ chưa đạt trong báo cáo. *Xong khi*: verdict đã ghi cho đúng
version — không viết báo cáo cuối trước bước này.

Mức 1–2 qua pha 4 ở dạng gọn: đọc `gate` mà `dossier_write` trả về, sửa những gì gate nêu.

## Nhịp báo tiến độ (#5969)

Sau **mỗi** kết quả con giao tới và trước mỗi sóng nhánh mới, viết **một** dòng
văn xuôi bình thường (không mục `###`, không khối, không huy hiệu):

`Đang ở: <pha> · Đã xong: <…> · Còn lại: <…> · Chờ: <nhánh nào>`

Harness tự nhắc theo đồng hồ ~10 phút khi còn con đang mở; gặp nhắc thì trả lời đúng dòng trên.

## Danh mục nhắc theo lĩnh vực

Dán **một** dòng đúng lĩnh vực vào `context` của con:

- **Luật**: số hiệu văn bản, ngày hiệu lực, còn/hết hiệu lực, cơ quan ban hành.
- **Y tế**: cơ sở, ngày, phạm vi (toàn quốc/tỉnh), đối tượng áp dụng.
- **Tài chính**: kỳ báo cáo, đơn vị tiền, nguồn số liệu gốc.
- **Học thuật**: DOI, năm, venue, phiên bản bài (v1/v2).
- **Kỹ thuật**: phiên bản sản phẩm, ngày truy cập, môi trường đo.
- **Thị trường**: ngày chụp giá, khu vực, phân khúc, điều kiện khuyến mãi.

## Gộp nhánh, tách nhánh (#5982)

Việc **liên quan nhau phải gộp vào một con** — ví dụ: giá + khuyến mãi + tồn kho của
**cùng một mã hàng** = **một** nhánh. Tách khi hai câu hỏi cần nguồn khác loại hoặc có thể
mâu thuẫn nhau; tách thì nói rõ ranh giới để hai con không mở lại cùng một trang.

## Sóng nhánh (D-41, #6022)

Mức 2 = **1 sóng** 3–5 nhánh. Mức 3 = **tối đa 3 sóng**, mỗi sóng ≤ 5 nhánh (khoảng 9–15
nhánh cho cả việc); sóng sau mở khi sóng trước còn thiếu bằng chứng, không mở cho đủ số.
Mỗi con nhận **một** nhánh, không nhồi hai việc rời vào một con.

## Trần thời gian (D-40, #6021)

Trần **mềm theo việc** do main khai trong `research_brief(ceilingSeconds=…)`
(giá trị quá lớn bị kẹp; mặc định 1 200 s). Trần **cứng an toàn**: 30 phút cho
mức 2, 120 phút cho mức 3. Lượt mức 3 có trần lượt 3 600 s; mức 1–2 là 1 200 s.

Chạm trần cứng ⇒ **dừng, báo chủ nhà, hỏi** — không tự chạy tiếp, không tự nới; muốn nới
thì `request_approval(action='research-budget: …')`. Hết trần mà chưa bão hoà ⇒ báo cáo
cuối ghi rõ "còn chỗ chưa bão hoà: <danh sách>", không im lặng.

## Hình dạng hồ sơ theo mức (#6019)

Phòng `.research/<slug>/` (slug khuôn `^[a-z0-9]+(-[a-z0-9]+)*$`):

| Mức | Tệp |
|---|---|
| 1 | `v1-<slug>.md` |
| 2 | `v1-<slug>.md` + `sources.jsonl` + `sources.md` |
| 3 | như mức 2 + `tables/<tên>.md` + `review.md` (+ `branches/<nhánh>.md` cho mỗi nhánh) |

Mỗi tệp mở đầu bằng **bốn dòng** front matter cố định:

```
Mức: 2 · Hồ sơ: <profile>
Câu hỏi: <nguyên văn câu hỏi>
Nhánh: <tên nhánh, hoặc "chính">
Đã mở: <n> nguồn (<danh sách host>)
```

Mục tối thiểu của hồ sơ: **Câu hỏi · Phát hiện · Nguồn**; mức 2 thêm **Mâu thuẫn còn lại**
và **Việc chưa làm**; mức 3 thêm **Phản biện**. Ghi bằng `dossier_write(researchId=<slug>,
level=…, profile=…, markdown=…)`: nó ghi trọn bộ tệp trong một lần và trả `{version,
files[], header, gate}`; ghi lại ⇒ bản mới `v2-<slug>.md` (không sửa bản cũ).

Tệp nhánh: mỗi con ghi **một** tệp cho nhánh mình (`branches/<nhánh>.md`, chia `-p1`,
`-p2` nếu dài, mỗi tệp ≤ 256 KiB) và trả về main ≤ 8 000 ký tự: kết luận chính, số liệu
then chốt, **đường dẫn tệp**, mục "Đã mở", mục "Chưa mở được".

## Đuổi trích dẫn ở mức 3 (#6008, #5967)

- **Lùi (backward):** với mỗi bài/kết luận chính, mở danh sách tham chiếu và
  chọn **tối đa 5** mục mà phần kết luận dựa vào, mở và cập nhật sổ. Nguồn gốc
  là văn bản pháp luật/quy chuẩn ⇒ phải mở bản gốc, hoặc ghi `chưa mở được bản
  gốc`.
- **Tiến (forward):** `paper_citations(direction="forward", limit=10)`, lấy tối
  đa 10 kết quả **mới nhất**, chọn cái phản biện trực tiếp hoặc có số liệu mới.
- **Bão hoà (điều kiện dừng):** dừng khi **3 vòng liên tiếp** không thêm nguồn
  mới làm đổi kết luận, **và** mọi khẳng định then chốt đã có ≥ 2 nguồn độc lập
  (khác chủ sở hữu, không phải bản đăng lại) hoặc 1 nguồn tầng 1.
- **Ghi lại:** số vòng đã chạy, vòng nào sinh nguồn mới, chỗ còn hở — vào hồ sơ,
  không loop vô hạn (trần cứng ở trên luôn thắng).

## Chủ nhà gõ gì thì làm gì (#5981)

| Chủ nhà gõ | Main làm |
|---|---|
| "dừng nhánh X" | `cancel_child(sessionId=…, reason=…)` + ghi lý do vào hồ sơ |
| "hạ xuống mức 2" | `research_brief(tier=2, …)` (hạ được), nói rõ trong dòng tiến độ |
| "bỏ phần khảo sát giá" | đánh dấu nhánh đã bỏ trong hồ sơ + `cancel_child` nhánh đó |
| "nhanh hơn / gọn hơn" | hạ trần mềm, gộp nhánh, bỏ sóng chưa mở |
| "kỹ hơn" | **không** nâng mức trong lượt; `ask_user` để chủ nhà mở lượt sau ở mức 3 |

Chỉ thị giữa lượt đến dưới tiền tố `[Chỉ thị giữa lượt của chủ nhà]`; áp xong thì
dòng tiến độ nói đã áp gì.

## Ngân sách và nút duyệt (#5964)

Việc nhỏ (mức 1–2, ước lượng ≤ 10 phút, ≤ 3 nhánh) chạy thẳng theo mặc định.
Việc lớn (mức 3, hoặc ước lượng > 10 phút, hoặc > 3 nhánh) **phải** gọi
`request_approval(action='research-budget: <mức>, <trần> phút, <n> nhánh, <lý
do>')` **trước khi mở nhánh**. Bị `reject`/hết thời gian chờ ⇒ chạy mức 2 gọn
hơn và **nói rõ** trong báo cáo cuối rằng đã hạ vì chưa được duyệt.

Báo cáo cuối luôn có **một** dòng ngân sách:

`Ngân sách: mức <n> · đã dùng <mm:ss> / trần <mm:ss> · <n> nhánh · <token> token`

## Soi ý kiến chủ nhà (#6025)

Brief có ý kiến/giả định/khẳng định của chủ nhà (`ownerViews`) ⇒ pha 4 thêm mục riêng trong
`review.md`, mỗi ý một dòng, ba nhãn và **mỗi nhãn kèm nguồn**:

- `ủng hộ` — nguồn nói cùng điều đó, trích nguyên văn.
- `phản bác` — nguồn nói ngược lại, trích nguyên văn.
- `chưa chắc` — bằng chứng chưa đủ; nói rõ còn thiếu gì.

## Câu trả lời cuối

Báo cáo ngắn bằng văn xuôi + đường dẫn tệp trong `.research/<slug>/` (chat render thành
liên kết mở panel Tệp) + dòng ngân sách — không khối, không dải, không huy hiệu quanh câu
trả lời. Chỗ chưa đạt, chưa bão hoà hay chưa mở được bản gốc thì nói thẳng, không làm mượt.

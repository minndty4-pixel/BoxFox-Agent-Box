# Vòng 29 — key ring trong MỘT connection (nửa `router/`)

> **TL;DR:** Router hôm nay giữ **đúng một credential cho mỗi connection**, nên ba khoá OpenCode Free phải là ba connection và việc "429 thì sang khoá kế tiếp" là thao tác tay đổi biến môi trường. Kế hoạch này thêm một **key ring bên trong một connection**: mỗi khoá là **một dòng `credentials` đã mã hoá sẵn có** (không dán lại, không mã hoá lại, ciphertext không đổi một byte), thứ tự nằm ở `connection.keys`; engine xoay khoá khi 429 (nghỉ 30 giây, theo `retry-after` nếu lớn hơn, trần 2 phút) rồi khoá tự về vòng; và gộp bốn connection `opencode` thành một connection ba khoá bằng một route `import` + một runbook chạy một lần trên máy chủ nhà.

## Vấn đề (số đo từ code tại `deda6e8`)

| Sự thật | Chỗ đo | Hệ quả cho kế hoạch |
|---|---|---|
| Một connection = **một** dòng credential | `router/src/store.mjs:32`, `service.mjs:237` | Ring dựng **trên** bảng cũ; không đổi bảng, không đổi crypto |
| AAD của AES-GCM là id của **dòng**, không phải id connection | `store.mjs:44` | Chuyển một khoá sang connection khác là thao tác **dữ liệu** ⇒ không cần re-encrypt |
| Vòng xoay hôm nay là **giữa các connection** (`connectionOrder` + `roundRobin`) | `engine.mjs:24-35`, `:36-47` | Ring là vòng lặp **lồng bên trong** một target; hai cơ chế cũ giữ nguyên |
| Cooldown hôm nay: 2 strike rồi nghỉ 5 s–5 phút, theo connection/model | `engine.mjs:161-171` | Luật bị **thay** bằng luật theo từng khoá: nghỉ ngay ở 429 đầu, 30 s–2 phút |
| `credentials()` là **chỗ duy nhất** lấy credential cho adapter | `engine.mjs:83` | Chỉ đổi chữ ký hàm; mọi adapter không phải sửa |
| Một connection `opencode` = một session = một bucket hạn mức | `providers/opencode.mjs:179-182` | Khoá phải mang danh tính riêng (`id` tiêm lúc đọc), nếu không ba khoá dùng chung một bucket |
| Chỉ `antigravity` gieo `retryAfterMs` | `antigravity.mjs:131/166`, `engine.mjs:168` | Cần một hàm đọc header `Retry-After` dùng chung |
| "429 ⇒ khoá kế tiếp" chỉ là **quy ước tay** ghi trong tài liệu | `docs/plan/v27/research-quality-tests.md` §2.2–2.3 | Router tự làm việc đó; tài liệu phải cập nhật |
| Bốn connection `opencode` đang sống, mỗi cái một credential | quét DB sống (bốn id ở Runbook) | Gộp **phía server**; chủ nhà không bao giờ phải gõ lại khoá |
| Nửa UI + design đã chốt sẵn **5 route** và **10 field/khoá** | `v29-keyring-ui-plan.md`, mockup 01–06 | Router phải khớp đúng tên, không đặt tên thứ hai |

## Thay đổi đề xuất

| # | Hạng mục | Cơ chế chính | Tệp chạm chính |
|---|---|---|---|
| R-0 | Module ring + đường `retry-after` | `KeyRing` in-memory, `headOf`, `cooldownFor`, `classifyState`; `parseRetryAfter` dùng chung cho mọi adapter | `router/src/keyring.mjs` (**mới**), `providers/common.mjs`, `providers/opencode.mjs` |
| R-1 | Ring sống trên storage cũ | `ensureRing` (thêm, một lần), `addKey`/`replaceKey`/`removeKey`/`importKeys`/`tryKey`, `credentials(id, signal, keyId)`, `remove()` từ chối khi còn khoá, mọi chỗ ghi credential đi qua **một** helper row id | `router/src/service.mjs`, `oauth.mjs`, `errors.mjs` (`store.mjs` **không đổi**) |
| R-2 | Xoay khoá trong engine | Vòng khoá lồng trong vòng target; 429 park khoá rồi thử khoá kế; cả ring nghỉ ⇒ **lỗi thật** của provider nổi lên; bỏ hai map cũ | `router/src/engine.mjs` |
| R-3 | Năm route HTTP | `POST .../keys`, `PATCH`/`DELETE .../keys/:keyId`, `POST .../keys/:keyId/try`, `POST .../keys/import`; `GET /connections` trả connection đã trang trí | `router/src/server.mjs` |
| R-4 | Tài liệu | Luật cooldown mới + nói rõ trần 2 phút là **quy ước dự án** và vì sao; bảng "một connection ba khoá" | `router/CONTRACT.md`, `docs/plan/retry-policy.md`, `docs/plan/v27/research-quality-tests.md` |
| R-5 | Runbook một lần trên máy chủ nhà | Import key 2 + key 3 vào survivor, bỏ khoá thứ tư, xoá ba shell rỗng, trỏ lại mặc định | `docs/plan/v29-keyring-merge-runbook.md` (**mới**), chạy trên máy chủ nhà |

**Quy mô:** khoảng **1 200 dòng** (≈ 400 dòng code sản phẩm, ≈ 670 dòng test, ≈ 115 dòng tài liệu), **5 tệp mới**; `router/src/store.mjs` **không đổi một dòng**. Bốn tệp test cũ sửa nhẹ (`auth-cooldown`, `core`, `providers`, `opencode`), 11 tệp test còn lại (trong 15 tệp hiện có) không đụng tới.

**Thứ tự chạy:** R-0 → R-1 → (R-2 ∥ R-3) → R-4 → R-5 (viết runbook) → chủ nhà chạy runbook một lần. Mỗi mốc dừng ở `cd router && npm test` xanh.

## Chốt gì · mở gì

- **Chốt:** thứ tự "khoá trên cùng được dùng trước", không dùng con trỏ xoay vòng; chỉ `429`/hết hạn mức mới đổi khoá (`400`, `5xx`, `AUTH` giữ nguyên hành vi hôm nay); nghỉ **30 s** mặc định, `retry-after` chỉ **nâng** và bị **chặn trần ở 2 phút**; cả ring nghỉ ⇒ lỗi thật của provider nổi lên và lượt đó **không tốn** lượt gọi provider nào; nhãn/tiền tố (`prefix` ≤ 6 ký tự) là tất cả những gì rời khỏi router về phía khoá; xoá khoá cuối ⇒ connection **ở lại** (`authState: 'required'`); `DELETE` connection bị từ chối (409) khi còn khoá; `import` chỉ giữa cùng provider **và** cùng endpoint; trần **10** khoá; `inferenceState` **không** thêm giá trị thứ tư.
- **Mở (6 điều):** nghỉ là in-memory nên restart là mọi khoá về vòng ngay; `authState: 'expired'` vẫn ở cấp connection; import không tự tắt connection nguồn; nhãn khoá gộp giữ nguyên của nguồn (muốn "Khoá 2" thì PATCH); một số adapter ném 429 dưới `PROVIDER_ERROR` nên không xoay khoá; `test_peer_mesh_chain.py` còn mặc định id `7c59f6b5` sẽ bị xoá.

## Chia đợt

Đợt 1: **R-0** (module ring + đường `retry-after`). Đợt 2: **R-1** (service/storage). Đợt 3 (song song): **R-2** (engine) và **R-3** (route). Đợt 4: **R-4** (tài liệu). Đợt 5: **R-5** (runbook) rồi chủ nhà chạy một lần để gộp bốn connection thành một connection ba khoá.

## Bàn giao design (chỉ tham chiếu)

Sáu màn đã vẽ: `/code/.plans/designs/v29-keyring-0{1..6}-*.html` (ba khoá · một khoá nghỉ · cả ba hết hạn mức · thêm khoá · ring rỗng · gộp khoá) kèm `design-plan.json` và ảnh `/code/.generated_artifacts/images/v29_ui_0{1..6}-*.png`. Kế hoạch này **bảo đảm JSON** cho đúng năm route và mười field/khoá mà mockup giả định; không có mockup mới được viết ở đây.

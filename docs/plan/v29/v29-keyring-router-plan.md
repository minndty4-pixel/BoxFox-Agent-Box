# Vòng 29 · Key ring trong MỘT connection — kế hoạch chi tiết (nửa `router/`)

**Chủ nhà:** Nam Nam · **Ngôn ngữ:** văn xuôi Việt, thuật ngữ kỹ thuật giữ nguyên tiếng Anh · **Nhánh:** `vorflux/v27-research-rework`, HEAD `deda6e8` (cây sạch khi viết kế hoạch).
**Phạm vi:** chỉ `router/**` + 3 tệp tài liệu. **Không** đụng `frontend/**` (hai peer `v29-plan-keyring-ui` và `v29-plan-route` giữ nửa UI), **không** đụng `backend/**` (harness).
**Nguồn sự thật:** `/code/.generated_artifacts/v29-keys-map.md` (bản đồ đo được của vòng này) · `/code/.plans/subplans/v29-keyring-ui-plan.md` §"hợp đồng" (tên route + tên field do nửa UI chốt) · mockup `/code/.plans/designs/v29-keyring-0{1..6}-*.html` + `design-plan.json` + ảnh `/code/.generated_artifacts/images/v29_ui_0{1..6}-*.png`.
**Ngoài phạm vi:** picker provider+model (peer `v29-plan-route`), mọi thay đổi `frontend/**`, mọi thay đổi harness, mọi mockup mới.

---

### Summary

Router hôm nay giữ **đúng một credential cho mỗi connection** (`router/src/store.mjs:32`), nên ba khoá `OpenCode Free` phải là ba connection và việc "429 thì sang khoá kế tiếp" là **thao tác tay** đổi `BOXFOX_LIVE_CONNECTION_ID`. Kế hoạch này thêm **key ring trong một connection**: mỗi khoá là **một dòng `credentials` đã mã hoá sẵn có** (không mã hoá lại, không paste lại), thứ tự nằm ở `connection.keys`; `engine.generate()` lặp thêm một tầng khoá bên trong vòng target hiện có, `429` cho khoá nghỉ **30 s** (theo `retry-after` nếu lớn hơn, **trần 2 phút**) rồi khoá tự về vòng xoay, `400`/`5xx`/`AUTH` giữ nguyên hành vi hôm nay. Bốn connection `opencode` được **gộp phía server** thành một connection ba khoá bằng một route `import` + một lượt chạy runbook một lần trên máy chủ nhà.

---

## 0. Trạng thái đo được hôm nay (đọc từ code tại `deda6e8`, không đoán)

| Sự thật | Chỗ đo | Hệ quả cho kế hoạch |
|---|---|---|
| Mỗi connection chỉ có **một** dòng credential; khoá chính là `connection.id` | `router/src/store.mjs:32` (`credentials (id TEXT PRIMARY KEY, encrypted TEXT NOT NULL)`), `service.mjs:237` `saveCredentials(c.id, credential)` | Ring phải dựng **trên** bảng này, không đổi bảng, không đổi crypto |
| AES-256-GCM với **AAD = id của dòng**, không phải id connection | `store.mjs:44` `cipher.setAAD(Buffer.from(id))` | Chuyển quyền sở hữu một khoá sang connection khác là **thao tác dữ liệu**, không phải thao tác mã hoá → không cần re-encrypt |
| Vòng xoay hôm nay là **giữa các connection**: `provider_config.connectionOrder` + `roundRobin`, alias `round_robin` | `engine.mjs:24-35`, `:36-47`, `service.mjs:202-211` | Ring là vòng lặp **lồng bên trong** một target; hai cơ chế cũ giữ nguyên, không thay |
| Cooldown hôm nay: đếm **2 strike** trong 5 phút rồi nghỉ 5 s–5 phút, theo `connection/model` | `engine.mjs:161-171` (`count >= 2`, `Math.min(Math.max(retryAfterMs \|\| 30_000, 5_000), 5 * 60_000)`) | Luật này bị **thay** bằng luật theo từng khoá: nghỉ ngay ở 429 đầu, 30 s–2 phút |
| `generate()` lấy credential ở **một chỗ duy nhất** | `engine.mjs:83` `await this.service.credentials(connection.id, combined)` | Chỉ cần đổi chữ ký hàm này thành "lấy khoá theo `keyId`", mọi adapter không phải sửa |
| Một connection `opencode` = một **session** = một bucket hạn mức | `providers/opencode.mjs:179-182` `['opencode', credentials?.id \|\| credentials?.label \|\| '', connection?.id …].join('\0')` | Khoá trong ring **phải mang danh tính riêng**, nếu không ba khoá gộp về một connection sẽ dùng chung một bucket và vòng xoay vô nghĩa |
| Chỉ `antigravity` gieo `retryAfterMs` | grep `retryAfterMs\|retry-after` trong `router/src`: `errors.mjs:55`, `antigravity.mjs:131/132/151/166/448`, `engine.mjs:168` | Phải có một hàm đọc header `retry-after` dùng chung cho mọi adapter |
| Luật "429 ⇒ khoá kế tiếp" chỉ là **quy ước tay**, ghi trong tài liệu | `docs/plan/v27/research-quality-tests.md` §2.2–2.3 | Router tự làm việc đó; tài liệu phải được cập nhật (R-4) |
| Harness chỉ retry **cùng** connection, không biết gì về khoá | `backend/src/agentbox/agent_core/failures.py:203-256`; `runtime.py:528-537` gửi mỗi header admin | Không sửa harness; lỗi 429 thật kèm `retryAfterMs` đã đi qua `errors.mjs:53-56` nên `retry_advice` vẫn đọc được |
| UI + design vòng này đã chốt sẵn **5 route** và **10 field/khoá** | `v29-keyring-ui-plan.md` §"hợp đồng"; mockup 01–06; ảnh `v29_ui_01..06*.png` | Router phải khớp đúng tên, không đổi tên, không thêm tên thứ hai |
| Bốn connection `opencode` đang sống, mỗi cái một credential | quét DB sống: `3d27b0b0` (key 3, ready, 43 model), `7c59f6b5` (bản trùng, **failed**, 42 model), `a43ff124` (key 2, ready, 80 model), `f8a5f4e8` (key 1, ready, 43 model) | Runbook R-5 có id cụ thể; khoá không bao giờ phải gõ lại |

## 1. Hợp đồng chốt trước khi code (những chỗ không được phép đoán)

### 1.1 "Khoá" là gì — storage

- **Một khoá = một dòng `credentials` sẵn có.** `keys[].id` **chính là** id của dòng đó. Bảng, khoá mã hoá, AAD, định dạng `iv|authTag|content` **không đổi** (`store.mjs:30-57` giữ nguyên từng dòng).
- **Thứ tự và nhãn nằm trên connection record**: `connection.keys = [{ id, label, prefix, createdAt }, …]`, mảng **có thứ tự** = thứ tự thử. Đây là dữ liệu **không bí mật**, được lưu như mọi field khác của connection.
- **Di trú không re-encrypt**: với connection cũ, khoá đầu tiên giữ **nguyên id dòng = `connection.id`**. Vì AAD là id dòng chứ không phải id connection (`store.mjs:44`), gán dòng đó cho một connection khác là việc của *bảng `records`*, không phải của crypto. Hệ quả: **không có thao tác mật mã nào trong cả kế hoạch này**, ciphertext trong DB không đổi một byte.
- **Di trú chỉ thêm, chạy một lần, idempotent** — `service.ensureRing(c)`:
  1. `if (Array.isArray(c.keys)) return c;` (đã có ring, không làm gì).
  2. `const blob = this.store.credentials(c.id); if (!blob) return c;` (không có credential — ví dụ `opencode` chưa từng lưu khoá — thì **không** tạo ring rỗng; `keys` vắng = "connection chưa có khoá", đúng nhánh legacy của UI).
  3. `c.keys = [{ id: c.id, label: c.name || 'Key 1', prefix: headOf(blob.apiKey || blob.accessToken), createdAt: Date.now() }]` rồi `this.store.put('connection', c)`.
  4. `headOf(secret)` = 6 ký tự đầu + `…` khi chuỗi dài hơn, `null` khi blob không có `apiKey`/`accessToken`. **Không bao giờ** quá 6 ký tự của một secret rời khỏi store. (Mockup 02 vẽ `••••4f2a` — nửa UI cứ vẽ theo ý mockup; router chỉ gửi `prefix`.)
  - Gọi `ensureRing` ở **hai chỗ**: `sanitizeConnection` (đường khởi động, `service.mjs:122-192`, đã có sẵn cơ chế tự lành + `put` khi `modified`) và `connection(id)`/`connections()` (lưới an toàn cho ghi thẳng vào store).
- **Bất biến sau vòng này:** `keys` là mảng ⟺ connection có ít nhất một dòng credential. Hết dòng credential ⇒ `credentialPresent: false`, `authState: 'required'` (connection **vẫn sống**, không tự xoá — mockup 05 + `v29-keyring-ui-plan.md` chốt đúng vậy), và `validTarget()` loại nó khỏi định tuyến vì `authState !== 'ready'` (`service.mjs:636`).
- **Thêm/xoá khoá đổi `credentialPresent`/`authState` theo đúng tiền lệ `patch`**: thêm hoặc thay khoá ⇒ `credentialPresent = true`, `authState = 'ready'` (giống `service.mjs:401`); xoá khoá cuối ⇒ `credentialPresent = false`, `authState = 'required'`; `inferenceState = 'unknown'`, `error = null` (bản án cũ đã hết giá trị); **không** `cancelConnection` (không huỷ lượt đang chạy), **không** đụng `discoveryState`/`models`.
- **Trần số khoá**: `MAX_KEYS_PER_CONNECTION = 10` (đủ cho 4 connection đang có + biên rộng; chặn một ring 200 khoá do lỗi tay).

### 1.2 Vòng xoay trong một connection (engine)

- **Thứ tự = "khoá trên cùng được dùng trước"** (đúng câu chú thích trên mockup 02/03), **không** dùng con trỏ xoay vòng: request luôn bắt đầu ở khoá **đầu tiên chưa nghỉ** theo thứ tự ring. Vì sao: (a) đúng thói quen hiện tại của chủ nhà (dùng key 1 tới hạn mức rồi mới sang key 2/3), (b) `Khoá 3: chưa dùng` và `Lượt kế tiếp sẽ chờ tới 14:32 — lúc Khoá 1 trở lại vòng xoay` trên mockup 02/03 chỉ đúng với luật này, (c) không cần con trỏ ⇒ không thêm trạng thái phải bền hoá.
- **Chỉ `RATE_LIMIT` mới đổi khoá trong cùng một request** (quyết định của chủ nhà: `5xx`/`AUTH` giữ nguyên như hôm nay). Cụ thể: bắt được `safe.code === 'RATE_LIMIT'` ⇒ **park khoá đó** rồi, nếu chưa phát ra nội dung nào cho client (`!emitted`) và còn khoá khác trong ring, **thử khoá kế tiếp ngay trong request này**; hết khoá ⇒ rơi xuống hành vi cũ (đi tiếp target khác, hoặc ném lỗi).
- **`400` (hay mọi 4xx request-scoped) không park, không đổi khoá** — giữ nguyên ruột `auth-cooldown.test.mjs:68-102`.
- **Mọi khoá đều đang nghỉ ⇒ ném đúng lỗi thật của provider.** `KeyRing` nhớ lỗi thật gần nhất theo từng khoá; khi ring không có khoá nào gọi được, engine lấy `lastError` thật đó (giữ nguyên `code`/`message`/`status`/`retryAfterMs`, **không** bọc lại thành câu tổng hợp). Chỉ có **một** câu tổng hợp duy nhất, dùng cho trường hợp không thể xảy ra trên thực tế (ring đang nghỉ nhưng chưa từng có lỗi nào): `new RouterError('RATE_LIMIT', 'Every key on this connection is cooling down after a provider limit.', 429, true)`. Và vì phép kiểm nghỉ nằm **trước** lời gọi adapter, một request rơi vào lúc cả ba khoá nghỉ **không tiêu tốn một lượt gọi provider nào**.
- **Không đổi khoá giữa lúc đang stream**: giữ đúng luật `engine.mjs:179` (`emitted ⇒ throw safe`); một request đang chạy không bị huỷ khi request song song park mất khoá của nó.
- **Danh tính khoá cho adapter**: `service.credentials(connectionId, signal, keyId)` trả `{ ...blob, id: keyId, [(projectId)] }` — `id` được **tiêm lúc đọc**, **không** ghi vào blob. Nhờ vậy `opencode.mjs:179-182` thấy mỗi khoá là một session riêng, blob trên đĩa không đổi. Không có `keyId` ⇒ dùng `keys[0]` (đúng nghĩa "credential của connection" như hôm nay).
- **Không có keyId ⇒ vẫn đi qua ring**: `credentials()` **không bao giờ** đọc thẳng `store.credentials(connectionId)` nữa; nó giải qua ring rồi mới đọc dòng. Nhờ vậy một dòng mồ côi (khoá đã bị chuyển đi) không thể bị đọc nhầm, và ring rỗng cho ra đúng câu AUTH 401 hôm nay (`service.mjs:433`).
- **Vòng xoay connection cấp trên giữ nguyên**: `roundRobin`/`connectionOrder` (`engine.mjs:24-35`) và alias `round_robin` (`:36-47`) không đổi; chỉ phép lọc "target đang nghỉ" ở `:41` đổi nguồn từ `this.cooldowns` sang ring (`service.hasCallableKeys(connectionId)`).
- **Xoá hai map cũ**: `this.cooldowns` và `this.rateLimitStrikes` (`engine.mjs:7`) biến mất cùng luật 2-strike; `this.rotation` (xoay connection) **ở lại**. Trạng thái nghỉ của khoá sống trong `KeyRing` (in-memory) — restart là mọi khoá về vòng xoay ngay, đúng ý đồ (nghỉ 30 s–2 phút thì không cần bền hoá; xem "Còn mở" #1).
- **`lastUsedAt` là thứ duy nhất được ghi bền**: ghi kèm vào `connection.keys[i].lastUsedAt` trong lần ghi connection đã có sẵn ở đường thành công (`engine.mjs:132-133`) — không thêm lần ghi DB nào; `state`/`cooldownUntil`/`lastError*` chỉ sống trong RAM.

### 1.3 Luật cooldown, và trần 2 phút từ đâu ra

```js
// router/src/keyring.mjs — công thức duy nhất
const KEY_COOLDOWN_MS = 30_000;       // mốc mặc định: quyết định của chủ nhà
const KEY_COOLDOWN_MAX_MS = 120_000;  // trần: quy ước của dự án trong vòng này
duration = Math.min(Math.max(Number(retryAfterMs) || KEY_COOLDOWN_MS, KEY_COOLDOWN_MS), KEY_COOLDOWN_MAX_MS);
```

- `retry-after` của provider **chỉ được nâng**, không được hạ: `Retry-After: 3` ⇒ 30 s; `Retry-After: 90` ⇒ 90 s; `Retry-After: 600` ⇒ **120 s** (trần); không có header ⇒ 30 s; giá trị rác ⇒ 30 s.
- **Trần 2 phút là quy ước của dự án, không phải con số của nhà cung cấp nào.** Mốc 30 s lấy từ quyết định của chủ nhà (bucket free-tier hiếm khi hồi nhanh hơn). Trần 120 s được chọn vì hai lý do ghi thẳng vào tài liệu: (a) một `retry-after` vô lý (ví dụ 3600) không được phép âm thầm bỏ một khoá khỏi vòng xoay quá lâu — hết cửa sổ thì khoá về vòng, provider nói "vẫn 429" và ring park lại bằng con số mới; (b) cửa sổ nghỉ không vượt xa nhịp retry của harness (`RATE_LIMIT_MIN/MAX = 2/30 s`, `RETRY_BUDGET_SECONDS = 60` — `backend/src/agentbox/agent_core/failures.py:203-256`). Ghi vào **`docs/plan/retry-policy.md`** (mục cooldown của router, nơi đang ghi luật 5 s–5 phút) và **`router/CONTRACT.md`** (mục key ring).
- Nghỉ **theo từng khoá** (không theo `khoá/model`). Đây là chọn có ý thức: bucket của `opencode` là theo session `(khoá, connection, model)`, nhưng giao diện, mockup và thói quen của chủ nhà đều nói theo **khoá**; cooldown thô hơn bucket một chút và chỉ làm ta *bỏ qua* một khoá vừa mới 429, không bao giờ làm ta dùng nhầm một khoá đang hạn mức. Ghi lại trong `CONTRACT.md`.
- `retry-after` đi vào bằng đường chung: `parseRetryAfter(value)` mới trong `providers/common.mjs` (nhận cả `30` giây và HTTP-date), `providerError(status, retryable, detail, retryAfterMs)` gắn `error.retryAfterMs`, `ensureOk(response)` (`common.mjs:16-31`) đọc header. Riêng `opencode.mjs` (đường của chủ nhà) đọc header trong `generate` rồi truyền xuống `opencodeError` tại `opencode.mjs:684`. `antigravity.mjs` đã tự làm — để yên.

### 1.4 Bề mặt HTTP (khớp đúng tên mà nửa UI đã chốt)

| Route | Body | Trả về | Luật |
|---|---|---|---|
| `POST /api/router/connections/:id/keys` | `{ label?, key? }` | `201` connection đã trang trí | `key` bắt buộc với provider cần khoá; `opencode` (anonymous) cho phép bỏ trống; thêm vào **cuối** ring; `label` mặc định `Key <n>` |
| `PATCH /api/router/connections/:id/keys/:keyId` | `{ key?, label? }` | `200` connection | Thay secret của **đúng khoá đó** hoặc đổi nhãn; **không** reset danh sách `models` (khác nhánh legacy `PATCH {apiKey}` — xem 1.6) |
| `DELETE /api/router/connections/:id/keys/:keyId` | — | `200` connection | Xoá khoá cuối ⇒ ring rỗng, connection **ở lại** (`authState: 'required'`) |
| `POST /api/router/connections/:id/keys/:keyId/try` | `{ modelId? }` | `200` `{ connection, probe }` | Bỏ nghỉ + xoá dòng lỗi của khoá; nếu chọn được model thì chạy **một** probe qua `testInference` ghim khoá; probe 429 ⇒ park lại theo luật mới; không có model ⇒ `probe: null` (nút "Thử ngay" của UI giữ nguyên nhãn trong cả hai trường hợp) |
| `POST /api/router/connections/:id/keys/import` | `{ fromConnectionId }` | `200` connection | Chuyển **toàn bộ** khoá của nguồn vào **cuối** ring đích, giữ thứ tự; nguồn rỗng ring nhưng vẫn sống; xem bảng kiểm ở dưới |

**Kiểm tra của `import`** (ném `RouterError` — envelope sẵn có ở `errors.mjs:53-56`):

| Ca | Kết quả |
|---|---|
| `fromConnectionId` thiếu/rỗng | `400 INVALID_REQUEST` "Choose a connection to move keys from." |
| nguồn = đích | `400 INVALID_REQUEST` "Choose a different connection." |
| nguồn/đích không tồn tại | `404 NOT_FOUND` (qua `service.connection`, `service.mjs:193`) |
| khác `providerId` | `400 INVALID_REQUEST` "Keys can only move between connections of the same provider." |
| khác `endpoint` (provider do người dùng khai endpoint: `custom`, `deepseek`, …) | `400 INVALID_REQUEST` "Keys can only move between connections with the same endpoint." — nếu không có luật này, một khoá `custom` sẽ lặng lẽ bị trỏ sang endpoint khác |
| đích `enabled === false` | `400 INVALID_REQUEST` "Enable the target connection before moving keys into it." |
| nguồn không có khoá nào | `400 INVALID_REQUEST` "The source connection has no key to move." |
| đích đã đủ `MAX_KEYS_PER_CONNECTION` | `400 INVALID_REQUEST` |
| hợp lệ | **không** dedupe, **không** re-encrypt: mỗi entry `{id,label,prefix,createdAt}` được **bê nguyên** sang đích, `label` giữ nguyên (legacy chưa có nhãn ⇒ lấy `source.name`, cho ra đúng "OpenCode Free (key 2)" như mockup 06) |

- **Xoá connection phải từ chối khi còn khoá**: `DELETE /api/router/connections/:id` ⇒ `409 KEYS_PRESENT` "Remove the N keys on this connection first — deleting it would drop them." (thêm `KEYS_PRESENT` vào bảng `messages` ở `errors.mjs:10-22`). Nút Delete của UI đã disable sẵn — đây là lớp thứ hai cho người gọi API trực tiếp. Và **`service.remove()` (`service.mjs:419-428`) phải bỏ dòng `store.removeCredentials(id)` vô điều kiện**: sau khi gộp, dòng credential của một connection shell (id = `a43ff124`…) đã thuộc ring của đích, xoá nó là **xoá mất khoá của đích**. Thay bằng: chỉ xoá các dòng thuộc **ring của chính connection đó** (ring rỗng ⇒ không xoá gì).
- **Không route `GET` riêng cho ring**: trạng thái khoá đi kèm snapshot. `GET /api/router/connections` (`server.mjs:270`) hiện trả `store.list('connection')` thô ⇒ đổi thành `service.connections()` để nó cũng có `keys`/`activeKeyId` như `GET /api/router/state`.
- **Field khoá trong snapshot** (khớp hợp đồng UI): `connection.keys[]` = `{ id, label, prefix, createdAt, state, cooldownUntil, resetAt, lastErrorCode, lastErrorMessage, lastUsedAt }` + `connection.activeKeyId` (khoá của **lượt thử gần nhất**; `null` khi chưa dùng). `state ∈ 'ready' | 'cooling' | 'exhausted' | 'error'`; `exhausted` = đang nghỉ và câu 429 có chữ hạn mức (`/quota|usage limit|exhaust|hạn mức/i`) — với `opencode` ("quota reached for this session") sẽ ra `exhausted`, đúng chữ "hết hạn mức" của mockup; `resetAt` lấy từ `connection.quota` khớp `modelId` khi provider có báo (opencode trả stub rỗng ⇒ `null`).
- **Không đổi bộ giá trị `inferenceState`** (`'unknown' | 'ready' | 'failed'`, `frontend/src/types/provider.ts:58`): mockup 03 vẽ pill `inference rate_limited` — điều kiện đó UI suy ra từ `keys[]` (mọi khoá đang nghỉ); router **không** thêm giá trị thứ tư và **không** bịa câu lỗi cấp connection cho 429.
- **Usage**: `record.keyId` + `record.keyLabel` (một dòng ở `engine.mjs:67`; usage là JSON trong bảng `records` nên **không** có migration schema). Nửa UI muốn hiện thì tự thêm field — ngoài phạm vi kế hoạch này.

### 1.5 Bất biến an toàn (không được vi phạm)

1. Khoá vẫn mã hoá at-rest bằng master key hiện có (`store.mjs:21-48`); kế hoạch này **không** chạm vào crypto.
2. Ra khỏi router: `id`, `label`, `prefix` (≤ 6 ký tự của secret), `state`, `cooldownUntil`, `resetAt`, `lastErrorCode/Message`, `lastUsedAt`. **Không bao giờ** raw key, blob, ciphertext hay `hash` — kể cả trong thân lỗi 4xx/5xx và log (`safeError` giữ nguyên).
3. Route mới tự động nằm sau `admin(req)` (`server.mjs:248`) ⇒ chỉ loopback + same-origin; `BRIDGE_PATHS` (`server.mjs:329`) **không** đổi ⇒ sandbox trong box không thấy được mặt quản trị này.
4. `label` do người dùng đặt, cắt theo quy tắc `label()`/giới hạn độ dài hiện có (`service.mjs` `label()`); nhãn không phải đường dẫn file, không nội suy vào shell.
5. Một khoá đã bị chuyển đi vẫn là **một dòng duy nhất**, không nhân bản: ring nguồn bỏ entry, ring đích thêm entry — không có hai connection cùng trỏ vào một dòng.

### 1.6 Không đụng tới (do-not-touch)

`frontend/**` (peer `v29-plan-keyring-ui` + `v29-plan-route`; kế hoạch này chỉ **bảo đảm** JSON, không sửa UI) · `backend/**` (harness không đổi một dòng; `failures.py` vẫn chỉ retry cùng connection) · hình dạng wire của OpenCode Free (`opencode.mjs` + `CONTRACT.md:21-23`: UA versioned, decoy tools, `stream: true`, session shape) · framing `/v1/*` và Anthropic ingress · OAuth flow (chỉ 2 dòng ghi credential, xem R-1.6) · gateway keys `kind='key'` (`/api/router/keys` — khái niệm khác, không trộn) · **legacy `PATCH {apiKey}` giữ nguyên hành vi hôm nay kể cả phần reset `models`** (`core.test.mjs:54-63` ghim điều này), trong khi `PATCH .../keys/:keyId` cố ý **không** reset `models` (endpoint không đổi thì danh sách model không đổi; sửa một chữ trong khoá 2 không được xoá 43 model của connection).

---

## 2. Tasks — thứ tự thực thi

Sáu task; mỗi task để lại `cd router && npm test` xanh trước khi sang task sau. Nhãn `[song song N]` = chạy được cùng lúc với nhóm N (không giao tệp); `[after X]` = phải xong X trước.

#### 0. **[song song 1]** R-0 — `router/src/keyring.mjs` + đường `retry-after` dùng chung

**Hiện trạng:** không có khái niệm "khoá" trong code; trạng thái nghỉ nằm trong hai map in-memory của engine (`engine.mjs:7`) và luật cooldown viết cứng ở `engine.mjs:161-171`; chỉ `antigravity.mjs` gieo `retryAfterMs`.
**Thay đổi:**
- **0.1** Tệp mới `router/src/keyring.mjs` (~120–150 dòng, thuần in-memory, không I/O): hằng số `KEY_COOLDOWN_MS = 30_000`, `KEY_COOLDOWN_MAX_MS = 120_000`, `MAX_KEYS_PER_CONNECTION = 10`; `headOf(secret)` (≤ 6 ký tự, `null` khi không có secret); `cooldownFor(retryAfterMs)` — công thức duy nhất của §1.3; `QUOTA_RE = /quota|usage limit|exhaust|hạn mức/i` + `classifyState(entry, now)` (§1.4); lớp `KeyRing` với `pick(connection, now)`, `park(keyId, { retryAfterMs, error })`, `clear(keyId)`, `note(keyId, error)`, `state(connection, now)` (trang trí `keys[]` + `activeKeyId`), `hasCallable(connection, now)` (§1.2). Lỗi thật được giữ **nguyên** `code`/`message`/`status`/`retryAfterMs`, không bọc lại.
- **0.2** `providers/common.mjs`: `parseRetryAfter(value)` (nhận số giây hoặc HTTP-date; rác ⇒ `null`), mở rộng `providerError(status, retryable, detail, retryAfterMs)` (gắn field khi là số hữu hạn), `ensureOk(response)` (`:16-31`) đọc header `retry-after`.
- **0.3** `providers/opencode.mjs` (đường của chủ nhà): đọc header trong `generate` rồi truyền xuống `opencodeError(status, statusText, errorText, retryAfterMs)` (call site `:684`); câu 429 ở `:559-560` giữ nguyên chữ.
- **0.4** `antigravity.mjs` **không đổi** (đã tự gieo `retryAfterMs`); các adapter khác không đổi (xem "Còn mở" #5).

**Nghiệm thu R-0 (máy kiểm được):** `router/tests/keyring.test.mjs` (mới) — bảng `cooldownFor`: không header ⇒ `30_000`; `3` ⇒ `30_000`; `90` ⇒ `90_000`; `600` ⇒ `120_000`; rác ⇒ `30_000`. `headOf` không bao giờ trả quá 6 ký tự của secret và trả `null` khi blob không có `apiKey`/`accessToken`. `classifyState`: 429 kèm chữ hạn mức ⇒ `exhausted`, 429 thường ⇒ `cooling`, lỗi khác ⇒ `error`. Thứ tự ring: khoá trên cùng trước, khoá đang nghỉ bị bỏ qua, hết cửa sổ (truyền `now`) tự về vòng. `hasCallable` đúng khi mọi khoá nghỉ. Bổ sung `router/tests/providers.test.mjs`: `ensureOk` với `Retry-After: 90` ⇒ `error.retryAfterMs === 90_000`; `router/tests/opencode.test.mjs`: 429 kèm header ⇒ `retryAfterMs` đi ra ngoài.

#### 1. **[after R-0]** R-1 — `router/src/service.mjs` (+ `oauth.mjs`, `errors.mjs`): ring sống trên storage cũ

**Hiện trạng:** `service.credentials(id)` đọc thẳng dòng credential của connection; `remove()` xoá dòng vô điều kiện; `snapshot()` trả connection thô; tám chỗ ghi credential đều dùng row id = connection id.
**Thay đổi:**
- **1.1** `ensureRing(c)` đúng §1.1: thêm, một lần, idempotent, **không** tạo ring khi chưa có dòng credential; gọi từ `sanitizeConnection` (`service.mjs:122-192`) **và** từ `connection(id)`/`connections()` (lưới an toàn). Dọn `activeKeyId` nếu nó không còn trong ring. **`router/src/store.mjs` không đổi một dòng** — đọc/ghi theo row id đã đủ.
- **1.2** `service.connections()` = danh sách connection đã trang trí (`ensureRing` + `keyRing.state(c, Date.now())`); `snapshot()` (`:195-197`) dùng nó ⇒ `GET /state` và `GET /connections` cùng hình dạng, cùng field.
- **1.3** CRUD khoá: `addKey(id, { label, key })`, `replaceKey(id, keyId, { key, label })`, `removeKey(id, keyId)`; nhãn mặc định `Key <n>`; trần `MAX_KEYS_PER_CONNECTION`; chuyển `credentialPresent`/`authState` đúng §1.1 (thêm/thay ⇒ `ready`; xoá khoá cuối ⇒ `required`, connection **ở lại**); `inferenceState = 'unknown'`, `error = null`; **không** `cancelConnection`, **không** đụng `models`/`discoveryState`.
- **1.4** `credentials(connectionId, signal, keyId)` giải **qua ring** rồi mới đọc dòng và trả `{ ...blob, id: keyId, [(projectId)] }` (§1.2); không `keyId` ⇒ `keys[0]`; ring rỗng ⇒ đúng câu AUTH 401 cũ (`service.mjs:433`). Thêm `hasCallableKeys(connectionId, now)` cho engine.
- **1.5** `importKeys(id, fromConnectionId)` với **toàn bộ** bảng kiểm §1.4 (8 ca), chuyển nguyên `{ id, label, prefix, createdAt }` sang **cuối** ring đích, không dedupe, không re-encrypt; nguồn rỗng ring nhưng vẫn sống.
- **1.6** **Mọi chỗ ghi credential đi qua một helper `credentialRowId(c)`** = `c.keys?.[0]?.id ?? c.id`: `service.mjs:237`, `:396`, `:406`, `:441`, `:511`, `:513` và `oauth.mjs:249`, `:298`. Vì sao bắt buộc: sau khi gộp, dòng `c.id` có thể **không** thuộc ring của connection nữa, ghi vào đó là tạo dòng mồ côi mà ring không bao giờ đọc (khoá "biến mất" một cách im lặng). Ghi secret vào khoá nào thì làm mới luôn `keys[i].prefix = headOf(secret)` và xoá `lastError*` của khoá đó. Nhánh legacy `PATCH { apiKey }` giữ nguyên hành vi hôm nay **kể cả phần reset `models`** (`core.test.mjs:54-63`) — nó chỉ đổi đích ghi thành khoá đầu của ring.
- **1.7** `remove(id)` (`:419-428`): ném `409 KEYS_PRESENT` khi ring còn khoá (thêm `KEYS_PRESENT` vào `messages` ở `errors.mjs:10-22`), và chỉ `store.removeCredentials(rowId)` cho **những row id thuộc ring của chính nó** (ring rỗng ⇒ không xoá gì) — bỏ dòng `store.removeCredentials(id)` vô điều kiện.
- **1.8** `tryKey(id, keyId, { modelId })`: `keyRing.clear(keyId)` + xoá `lastError*` + `activeKeyId = keyId`; nếu có `modelId` thuộc connection thì chạy đúng **một** lượt `testInference` **ghim** khoá đó (probe 429 ⇒ park lại theo luật mới); không có model ⇒ `probe: null` (§1.4).

**Nghiệm thu R-1 (máy kiểm được):** `router/tests/keyring-service.test.mjs` (mới, dựng fixture như `core.test.mjs:18-28`) — `ensureRing` chạy hai lần không đổi `id`/`createdAt` và **không** tạo ring cho connection `opencode` chưa từng có khoá; `addKey`/`removeKey` đổi `credentialPresent`/`authState` đúng §1.1 và **không** reset `models`; `credentials(id, null, keyId)` trả `id === keyId` trong khi `store.credentials(rowId).apiKey` **không đổi** (chứng minh không ghi `id` xuống đĩa); `importKeys` phủ đủ 8 ca của bảng §1.4 (mỗi ca `assert.rejects` với đúng `code`/`status`, ca hợp lệ ⇒ ring đích dài thêm, ring nguồn rỗng, `store.credentials(rowId)` vẫn đọc được, `JSON.stringify(snapshot())` không chứa secret); `remove()` khi còn khoá ⇒ `KEYS_PRESENT` 409; xoá một connection đã rỗng ring **không** xoá dòng của connection khác; `tryKey` không `modelId` ⇒ `probe: null` và khoá hết nghỉ.

#### 2. **[song song 2 · after R-1]** R-2 — `router/src/engine.mjs`: vòng khoá lồng trong vòng target

**Hiện trạng:** mỗi target dùng một credential; hai map `cooldowns`/`rateLimitStrikes`; luật 2 strike, nghỉ 5 s–5 phút (`:161-171`).
**Thay đổi:**
- **2.1** Thêm **vòng lặp khoá** bên trong vòng target `:70-181`: chọn khoá bằng `keyRing.pick(connection, now)` (khoá trên cùng chưa nghỉ — §1.2), gọi `service.credentials(connection.id, combined, keyId)` rồi gọi adapter với khoá đó.
- **2.2** `safe.code === 'RATE_LIMIT'` ⇒ `keyRing.park(keyId, { retryAfterMs: safe.retryAfterMs, error: safe })` rồi thử **khoá kế tiếp trong cùng request**; mọi lỗi khác ⇒ `keyRing.note(keyId, safe)` và đi tiếp như hôm nay (`400`/`4xx` request-scoped, `5xx`, `AUTH` **không** đổi khoá — §1.2, `:179` `emitted ⇒ throw safe` giữ nguyên).
- **2.3** Xoá `this.cooldowns` + `this.rateLimitStrikes` (`:7`) và cả khối `:161-171`; `this.rotation` (xoay connection) ở lại; giữ lời gọi `service.quota(connection.id)` best-effort ở nhánh 429 (nuôi `resetAt`).
- **2.4** Hết khoá gọi được ⇒ ném **đúng lỗi thật gần nhất** của ring (§1.2); câu tổng hợp chỉ dùng cho ca bất khả (ring nghỉ mà chưa từng có lỗi). Phép kiểm nghỉ nằm **trước** lời gọi adapter ⇒ lượt rơi vào lúc cả ring nghỉ **không tốn một lượt gọi provider nào**.
- **2.5** `record.keyId`/`record.keyLabel` (`:67`) cho usage; đường thành công `:132-133` ghi thêm `keys[i].lastUsedAt = Date.now()` + `connection.activeKeyId = keyId` trong **lần ghi connection sẵn có** (không thêm lần ghi DB nào — §1.2).
- **2.6** Alias `round_robin` lọc target đang nghỉ ở `:41`: đổi nguồn từ `this.cooldowns` sang `service.hasCallableKeys(connectionId)`.

**Nghiệm thu R-2 (máy kiểm được):** `router/tests/keyring-engine.test.mjs` (mới, fixture adapter giả như `auth-cooldown.test.mjs`) — ring ba khoá, adapter 429 cho khoá 1 và 2 ⇒ đúng **ba** lượt gọi theo thứ tự ring, lượt đó thành công, `usage[0].keyId` là khoá 3; khoá vừa park **không** được gọi ở lượt kế tiếp (đếm lượt gọi) và **được** gọi lại sau khi hết cửa sổ (dùng `now`/cửa sổ ngắn); cả ring 429 ⇒ lỗi ném ra đúng `code`/`message`/`retryAfterMs` của provider và số lượt gọi provider của lượt sau `= 0`; `400` ⇒ không park khoá nào, lượt kế tiếp vẫn gọi khoá 1; `5xx`/`AUTH` giữ nguyên hành vi hôm nay. **Hai tệp cũ phải sửa:** `router/tests/auth-cooldown.test.mjs:83-84, 110, 123-127, 130` (hai map đã bị xoá; ca 429 viết lại thành "park đúng khoá, khoá khác vẫn được dùng"; ruột ca 400 ở `:68-102` giữ nguyên) và `router/tests/core.test.mjs:73` — với ring một khoá, lượt thứ hai đi thẳng sang connection thứ hai (`assert.deepEqual(calls, [second.id])`) thay vì gọi lại connection vừa 429; các assert còn lại của `:64-74` giữ nguyên, kể cả `assert.rejects(..., e => e.status === 429)` ở cuối (giờ là **lỗi thật** `'Limit'` đi ra từ ring).

#### 3. **[song song 2 · after R-1]** R-3 — `router/src/server.mjs`: năm route + `GET /api/router/connections`

**Hiện trạng:** bộ khớp `:283-290` là `^/api/router/connections/([^/]+)(?:/(test|models/refresh|quota))?$`; `GET /api/router/connections` (`:270`) trả dòng thô từ store.
**Thay đổi:**
- **3.1** Mở rộng bộ khớp thành `/api/router/connections/([^/]+)/keys(?:/([^/]+))?(?:/try)?$` và xử lý nhánh **`keys/import` TRƯỚC** nhánh `:keyId` (nếu không, chữ `import` bị nuốt làm `keyId`): `POST .../keys` ⇒ `201`, `PATCH`/`DELETE .../keys/:keyId` ⇒ `200`, `POST .../keys/:keyId/try` ⇒ `200 { connection, probe }`, `POST .../keys/import` ⇒ `200` — đúng bảng §1.4, không đổi tên, không thêm route thứ hai.
- **3.2** Đọc JSON body + kiểm kiểu như các route hiện có; lỗi đi qua `errorEnvelope` sẵn có (`:321`), không có bảng lỗi riêng.
- **3.3** `GET /api/router/connections` (`:270`) ⇒ `service.connections()`.
- **3.4** `DELETE /api/router/connections/:id` không cần code mới: `service.remove()` ném `409 KEYS_PRESENT`, catch hiện tại trả envelope đúng.
- **3.5** Không đụng `admin(req)` (`:69-73` — route mới tự động nằm sau) và `BRIDGE_PATHS` (`:329`).

**Nghiệm thu R-3 (máy kiểm được):** `router/tests/keyring-http.test.mjs` (mới, theo idiom `core.test.mjs:138-159`: `createRouterServer` + `listen(0, '127.0.0.1')` + header `X-BoxFox-Admin`) — thêm hai khoá rồi `GET /api/router/connections` và `GET /api/router/state` đều thấy `keys` hai phần tử với `state`/`prefix`/`lastUsedAt`; **không** chuỗi secret nào xuất hiện trong `JSON.stringify` của bất kỳ response nào (idiom `core.test.mjs:149`); `DELETE .../keys/<id>` rồi `DELETE .../connections/<id>` khi còn khoá ⇒ `409 KEYS_PRESENT`; `POST .../keys/import` thiếu `fromConnectionId` ⇒ 400, khác provider ⇒ 400, hợp lệ ⇒ 200 và nguồn rỗng ring; `POST .../keys/<id>/try` không `modelId` ⇒ 200 `probe: null`; thiếu header admin ⇒ 403 như cũ.

#### 4. **[after R-2, R-3]** R-4 — Tài liệu: `router/CONTRACT.md`, `docs/plan/retry-policy.md`, `docs/plan/v27/research-quality-tests.md`

**Hiện trạng:** `retry-policy.md` §1 ghi luật router "cooldown 5 s–5 phút sau 2 lần 429 liên tiếp" (`:14-17`); `research-quality-tests.md` §2.2-2.3 ghi bốn connection + thao tác tay đổi `BOXFOX_LIVE_CONNECTION_ID`, và ghim connection mặc định `7c59f6b5` (`:50`) — chính là connection sẽ bị xoá ở R-5.
**Thay đổi:**
- **4.1** `router/CONTRACT.md`: mục "Key ring" — khoá = dòng `credentials` sẵn có; thứ tự = ring order (khoá trên cùng trước); cooldown 30 s mặc định, `retry-after` chỉ **nâng**, trần **120 s là quy ước của dự án** kèm hai lý do ở §1.3; năm route; trần 10 khoá; `PATCH .../keys/:keyId` không reset `models`; `DELETE` connection ⇒ 409 khi còn khoá.
- **4.2** `docs/plan/retry-policy.md`: thay hàng của router bằng luật theo từng khoá; ghi rõ lỗi thật luôn nổi lên khi cả ring nghỉ và lượt đó không tốn lượt gọi provider.
- **4.3** `docs/plan/v27/research-quality-tests.md` §2.2-2.3: bảng bốn connection ⇒ **một** connection ba khoá (id của survivor, chốt ở R-5); bỏ bước đổi tay `BOXFOX_LIVE_CONNECTION_ID` (429 **tự** xoay khoá); ghi chú connection mặc định `7c59f6b5` đã bị xoá trong runbook R-5.

**Nghiệm thu R-4 (máy kiểm được):** `grep -c "5 s–5 phút" docs/plan/retry-policy.md` = 0 và cụm "2 lần 429" = 0, có mặt 30 s/120 s; `router/CONTRACT.md` liệt kê đủ **năm** đường dẫn `/keys` (đếm 5) và tên route khớp chuỗi trong `router/src/server.mjs`; `docs/plan/v27/research-quality-tests.md` không còn câu "chạy lại y hệt với key 2, rồi key 3"; `cd router && npm test` vẫn xanh.

#### 5. **[after R-4]** R-5 — Runbook một lần trên máy chủ nhà (gộp bốn connection `opencode`)

**Hiện trạng:** bốn connection sống — `f8a5f4e8…` (key 1, `ready`, 43 model), `a43ff124…` (key 2, `ready`, 80 model), `3d27b0b0…` (key 3, `ready`, 43 model), `7c59f6b5…` (bản trùng, `failed`, 42 model); connection mặc định của lượt chạy sống hiện **là `7c59f6b5`** (`docs/plan/v27/research-quality-tests.md:50`, `backend/tests/integration/test_peer_mesh_chain.py:316`).
**Thay đổi:** tệp mới `docs/plan/v29-keyring-merge-runbook.md` (theo lối `docs/plan/v22-plans-migration-runbook.md`) chứa **đúng** các bước sau, chủ nhà chạy một lần. Chủ nhà **không bao giờ dán lại khoá**; không có re-encrypt; ciphertext trong DB không đổi một byte.
1. **Sao lưu trước khi làm**: copy `~/.local/share/boxfox/router/router.sqlite` (+ `master.key`) — hoặc `$BOXFOX_ROUTER_DATA_DIR` nếu máy đặt biến này — ra một tệp `.bak` có ngày.
2. **Ghi lại tham chiếu hiện tại**: `GET /api/router/state` ⇒ chép ra `defaultRoute`, alias nào trỏ vào bốn id này, `providerConfig('opencode').connectionOrder`, và biến `BOXFOX_LIVE_CONNECTION_ID` đang dùng. **Survivor đề xuất: `f8a5f4e8-0986-45f9-bf5b-555e8b96a95c`** ("OpenCode Free (key 1)"). Nếu `defaultRoute`/alias đang trỏ vào một id khác trong bốn id ⇒ lấy **id đó** làm survivor để không phá tham chiếu; nếu trỏ vào `7c59f6b5` (mặc định hôm nay) thì bước 9 phải trỏ lại survivor.
3. `POST /api/router/connections/f8a5f4e8-0986-45f9-bf5b-555e8b96a95c/keys/import` body `{"fromConnectionId":"a43ff124-359f-4da5-bbd0-82c54df64a53"}` ⇒ survivor có 2 khoá.
4. `POST` y hệt với body `{"fromConnectionId":"3d27b0b0-1de7-4c67-a803-c6e26afab631"}` ⇒ survivor có **3 khoá**, thứ tự `[f8a5f4e8, a43ff124, 3d27b0b0]` = key 1, key 2, key 3.
5. **Kiểm giữa đường**: `GET /api/router/state` ⇒ survivor `keys.length === 3` với ba `prefix` **đúng bằng** ba `prefix` chép ở bước 2 (bằng chứng không có khoá nào bị gõ lại); `a43ff124` và `3d27b0b0` có `keys: []`, `credentialPresent: false`, `authState: 'required'`, vẫn nằm trong danh sách (không tự xoá — §1.1).
6. **Bỏ khoá thứ tư**: `DELETE /api/router/connections/7c59f6b5-d0ee-4206-9d04-bc19936b0681/keys/7c59f6b5-d0ee-4206-9d04-bc19936b0681` (khoá duy nhất của bản trùng — chủ nhà chốt **đúng ba khoá**; nếu đó là bản dán lại của key 1 thì không mất gì), rồi `DELETE /api/router/connections/7c59f6b5-d0ee-4206-9d04-bc19936b0681`.
7. `DELETE /api/router/connections/a43ff124-359f-4da5-bbd0-82c54df64a53` và `.../3d27b0b0-1de7-4c67-a803-c6e26afab631` (ring đã rỗng ⇒ qua được cửa 409).
8. **Đặt tên lại**: `PATCH /api/router/connections/f8a5f4e8-…` body `{"name":"OpenCode Free"}`; tuỳ chọn `PATCH .../keys/<rowId>` body `{"label":"Khoá 1"|"Khoá 2"|"Khoá 3"}` cho khớp mockup 02.
9. **Trỏ lại mặc định**: nếu `defaultRoute` còn trỏ id đã xoá ⇒ `PUT /api/router/default` về survivor; đặt `BOXFOX_LIVE_CONNECTION_ID=<survivor>` cho lượt chạy sống (mặc định trong `test_peer_mesh_chain.py:316` vẫn là id đã xoá — xem "Còn mở" #6).
10. **Kiểm cuối**: `GET /api/router/state` ⇒ đúng **một** connection `opencode` ba khoá; chạy **một** lượt thật; ghi một hàng vào `docs/tracking/test-rounds.md` theo lệ thường.

**Nghiệm thu R-5 (máy kiểm được):** sau bước 5 và bước 10, `state` chỉ còn **một** connection `opencode`; `keys` của survivor có 3 phần tử với `id` **bằng đúng** ba id gốc ở §0; ba `prefix` trước và sau giống nhau; số dòng bảng `credentials` giảm 4 → 3 (nếu có `sqlite3`: `SELECT count(*) FROM credentials`) và ciphertext các dòng cũ khớp bản `.bak` ở bước 1; lượt chạy thật ghi `usage[0].keyId` (một trong ba id) và `keyLabel`.

---

## 3. Testing (máy chạy được)

- Lệnh duy nhất: `cd router && npm test` (`node --import ./tests/isolate-logs.mjs --test tests/*.test.mjs`) — chạy offline, adapter giả, không cần mạng; chạy sau **mỗi** task.
- Bốn tệp test mới: `keyring.test.mjs` (R-0), `keyring-service.test.mjs` (R-1), `keyring-engine.test.mjs` (R-2), `keyring-http.test.mjs` (R-3). Bốn tệp cũ sửa nhẹ: `auth-cooldown.test.mjs`, `core.test.mjs:73`, `providers.test.mjs`, `opencode.test.mjs`. 11 tệp còn lại (trong 15 tệp `tests/*.test.mjs` hiện có) **không** đổi một dòng.

| Ca | Tệp | Khẳng định máy kiểm được |
|---|---|---|
| Xoay khoá đúng lúc | `keyring-engine.test.mjs` | 429 khoá 1 ⇒ lượt đó gọi khoá 2 **trong cùng request**; usage ghi `keyId` của khoá đã thành công |
| Không xoay khi không phải 429 | `keyring-engine.test.mjs`, `auth-cooldown.test.mjs:68-102` | `400` ⇒ không park, lượt sau vẫn khoá 1; `5xx`/`AUTH` giữ nguyên hành vi hôm nay |
| Cửa sổ nghỉ | `keyring.test.mjs` + `keyring-engine.test.mjs` | 30 s mặc định; `retry-after 90` ⇒ 90 s; `retry-after 600` ⇒ 120 s (trần); hết cửa sổ ⇒ khoá về vòng xoay |
| Cả ring nghỉ | `keyring-engine.test.mjs` | Lỗi ném ra **đúng** `code`/`message`/`status`/`retryAfterMs` của provider; số lượt gọi provider của lượt đó `= 0` |
| Thứ tự | `keyring-engine.test.mjs` | Thứ tự gọi = thứ tự ring; sau khi hết nghỉ, khoá 1 lại đứng đầu |
| Legacy một khoá | `core.test.mjs`, `cost.test.mjs` | Connection một khoá hành xử như hôm nay (trừ assert đã sửa ở `core.test.mjs:73`); `store.credentials(c.id)` vẫn đọc được |
| Import | `keyring-service.test.mjs`, `keyring-http.test.mjs` | Đủ 8 ca từ chối của bảng §1.4; ca hợp lệ ⇒ ring đích dài thêm, ring nguồn rỗng, nguồn vẫn sống |
| Xoá connection | `keyring-http.test.mjs` | Còn khoá ⇒ `409 KEYS_PRESENT`; ring rỗng ⇒ xoá được và **không** xoá dòng của connection khác |
| Không lộ secret | `keyring-http.test.mjs`, `keyring-service.test.mjs` | `JSON.stringify` của mọi response và của `snapshot()` không chứa secret; chỉ `prefix` ≤ 6 ký tự |
| Không mã hoá lại | `keyring-service.test.mjs` | Trước/sau `importKeys`, ciphertext của dòng trong `router.sqlite` **không đổi** byte nào; `store.credentials(rowId).apiKey` vẫn là secret cũ |
| Session riêng theo khoá | `keyring-engine.test.mjs` | Ba khoá trong một connection ⇒ `credentials.id` khác nhau (bucket `opencode` tách), blob trên đĩa không đổi |

- Kiểm sống (thủ công, một lần, do chủ nhà chạy sau R-5): ba bước 5/10 của runbook, rồi một lượt thật; tuỳ chọn `npm run test:live` (`router/scripts/live-test.mjs`, cần provider thật) và ghi một hàng vào `docs/tracking/test-rounds.md`.
- Ngoài phạm vi test: harness `backend/tests/**` (không đổi), UI `frontend/**` (peer UI tự test).

---

## 4. Quy mô thay đổi và thứ tự chạy

| Tệp | Trạng thái | Ước lượng dòng |
|---|---|---|
| `router/src/keyring.mjs` | **mới** | ~140 |
| `router/src/service.mjs` (679) | sửa | +130 / −10 |
| `router/src/engine.mjs` (193) | sửa | +60 / −25 |
| `router/src/server.mjs` (350) | sửa | +45 |
| `router/src/providers/common.mjs` (186) | sửa | +18 |
| `router/src/providers/opencode.mjs` (724) | sửa | +8 |
| `router/src/errors.mjs` (56) | sửa | +1 |
| `router/src/oauth.mjs` (408) | sửa | +2 |
| `router/src/store.mjs` (77) | **không đổi** | 0 |
| `router/tests/keyring.test.mjs` | **mới** | ~150 |
| `router/tests/keyring-service.test.mjs` | **mới** | ~180 |
| `router/tests/keyring-engine.test.mjs` | **mới** | ~160 |
| `router/tests/keyring-http.test.mjs` | **mới** | ~120 |
| `router/tests/auth-cooldown.test.mjs` (132) | sửa | +35 / −20 |
| `router/tests/core.test.mjs`, `providers.test.mjs`, `opencode.test.mjs` | sửa | +25 |
| `router/CONTRACT.md` (23) | sửa | +20 |
| `docs/plan/retry-policy.md`, `docs/plan/v27/research-quality-tests.md` | sửa | ~25 |
| `docs/plan/v29-keyring-merge-runbook.md` | **mới** | ~70 |

Tổng: **khoảng 1 200 dòng** (≈ 400 dòng code sản phẩm, ≈ 670 dòng test, ≈ 115 dòng tài liệu), **5 tệp mới**, 1 tệp code **không** đổi (`store.mjs`).

Thứ tự chạy: **R-0** → **R-1** → (**R-2** ∥ **R-3**) → **R-4** → **R-5** (viết runbook) → chủ nhà chạy runbook một lần. Mỗi mốc dừng lại ở `cd router && npm test` xanh; R-2 và R-3 không giao tệp nên chạy song song được.

---

## 5. Còn mở (6 điều, không chặn vòng này)

1. **Nghỉ là in-memory**: restart router ⇒ mọi khoá về vòng xoay ngay (đúng ý đồ với cửa sổ 30 s–2 phút). Muốn "nghỉ xuyên restart" thì phải thêm field bền — chưa làm.
2. **`authState: 'expired'` vẫn là cấp connection**: `403 FreeTierError` của **một** khoá đánh dấu cả connection (`engine.mjs:152`), kể cả khi khoá khác còn dùng được. Siết theo khoá là việc của vòng sau.
3. **Import không tự tắt connection nguồn**: nguồn ở lại với ring rỗng, `authState: 'required'`, bị `validTarget()` loại khỏi định tuyến (`service.mjs:636`). Chốt vậy cho khớp mockup 05 và nửa UI.
4. **Nhãn khoá gộp giữ nguyên của nguồn** ⇒ sau runbook nhãn đọc "OpenCode Free (key 2)…"; muốn "Khoá 2" thì `PATCH .../keys/:keyId` (bước 8 của runbook, tuỳ chọn).
5. **429 không phải lúc nào cũng là `RATE_LIMIT`**: một số adapter ném 429 dưới `PROVIDER_ERROR` (ví dụ `openrouter.mjs:186`), nên những đường đó **không** xoay khoá. Chủ nhà chỉ dùng `opencode` nên không chặn vòng này.
6. **Tham chiếu cũ tới id sẽ bị xoá**: `backend/tests/integration/test_peer_mesh_chain.py:316` vẫn mặc định `BOXFOX_LIVE_CONNECTION_ID=7c59f6b5…`. Backend ngoài phạm vi kế hoạch — lượt chạy sống phải truyền biến môi trường (bước 9 runbook), hoặc một vòng sau sửa mặc định.

---

## 6. Bàn giao design (chỉ tham chiếu, không chép lại)

| Màn | Mockup | Ảnh kiểm | Ràng buộc đặt lên router |
|---|---|---|---|
| 01 ba khoá | `/code/.plans/designs/v29-keyring-01-three-keys.html` | `/code/.generated_artifacts/images/v29_ui_01-three-keys.png` | `keys` 3 phần tử `ready`, dòng "Tự chuyển khoá khi hết hạn mức" |
| 02 một khoá nghỉ | `v29-keyring-02-one-cooling.html` | `v29_ui_02-one-cooling.png` | `state`/`cooldownUntil`/`lastError`/`lastUsedAt` theo từng khoá; nghỉ 30 s theo `retry-after`, trần 2 phút |
| 03 cả ba hết hạn mức | `v29-keyring-03-all-exhausted.html` | `v29_ui_03-all-exhausted.png` | Lỗi **thật** của provider nổi lên; pill `inference rate_limited` do UI suy từ `keys[]` (router không thêm giá trị `inferenceState` thứ tư) |
| 04 thêm khoá | `v29-keyring-04-add-key.html` | `v29_ui_04-add-key.png` | `POST .../keys { label, key }`; secret không hiện lại sau khi lưu |
| 05 ring rỗng | `v29-keyring-05-empty.html` | `v29_ui_05-empty.png` | Xoá khoá cuối ⇒ connection ở lại, `authState: 'required'`, không tự xoá |
| 06 gộp khoá | `v29-keyring-06-merge.html` | `v29_ui_06-merge.png` | `POST .../keys/import { fromConnectionId }`; khoá sang **cuối** ring, giữ nhãn |
| (chung) | `/code/.plans/designs/design-plan.json` | — | 9 section (6 key ring + 3 picker của peer `v29-design-route`); kế hoạch này chỉ **bảo đảm JSON**: 5 route + 10 field/khoá + `activeKeyId` |

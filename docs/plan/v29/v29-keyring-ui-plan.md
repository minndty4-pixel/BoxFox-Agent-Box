# Kế hoạch chi tiết — Vòng 29: "key ring" (phần GIAO DIỆN)

**Phạm vi:** chỉ `frontend/**`. Không sửa `router/**`, `backend/**`, `docs/**`. Không thêm dependency.
**Điểm neo:** repo `/code/minndty3-design/BoxFox-Agent-Box`, nhánh `vorflux/v27-research-rework`, HEAD `deda6e8`.

---

## 0. Quyết định đã chốt và hợp đồng phụ thuộc

**Chủ nhà đã chốt (không bàn lại):**
1. Một connection giữ **danh sách khoá có thứ tự** (key ring); xoay khoá **bên trong** connection đó, chỉ khi **429 / hết hạn mức**.
2. Khoá vừa trả 429 bị **nghỉ 30 giây** (hoặc `retry-after` của provider, trần 2 phút) rồi tự quay lại vòng xoay.
3. Chủ nhà muốn **một dòng cho mỗi model** thay vì "opencode key1 model A, opencode key2 model A".

**Hai quyết định mới (vòng này phải phục vụ):**
4. **Gộp khoá 4 connection `opencode` còn MỘT connection**: giữ "OpenCode Free" (3 khoá), xoá connection trùng. UI cần hành động **"Merge keys from another connection"** trên card (chọn một connection **cùng provider**, router chuyển khoá phía server, UI **không bao giờ thấy secret**), và đường xoá connection **bị từ chối khi trong connection còn khoá**.
5. Danh sách model của màn này **gộp còn một dòng cho mỗi model**.

**Hợp đồng phụ thuộc router — ĐỌC `v29-keyring-router-plan.md` TRƯỚC KHI NỐI DÂY.**
Kế hoạch này KHÔNG tự đặt tên route router. Bảng dưới là **hợp đồng UI cần**; router plan giữ tên thật. Nếu tên khác, chỉ **5 hằng số template** trong `frontend/src/lib/routerKeyPaths.ts` phải sửa — không sửa chỗ nào khác.

| Việc UI làm | Route UI gọi (chờ router plan chốt) | Ghi chú |
|---|---|---|
| Thêm khoá vào connection | `POST /api/router/connections/{id}/keys` body `{ label?, key }` | Trả về danh sách khoá mới (không trả secret) |
| Thay khoá của MỘT dòng | `PATCH /api/router/connections/{id}/keys/{keyId}` body `{ key, label? }` | |
| Bỏ MỘT khoá | `DELETE /api/router/connections/{id}/keys/{keyId}` | Xoá khoá cuối ⇒ connection hết khoá (không tự xoá connection) |
| "Thử ngay" khoá đang nghỉ | `POST /api/router/connections/{id}/keys/{keyId}/try` | Bỏ cooldown + thử một lần; nếu router chỉ có "resume" thì giữ nhãn "Try now" |
| Gộp khoá từ connection khác | `POST /api/router/connections/{id}/keys/import` body `{ fromConnectionId }` | Router chuyển khoá phía server; UI chỉ gửi id |
| Tải danh sách khoá | `GET /api/router/state` (field mới trên mỗi connection) | Xem §1 |

**Trường snapshot UI cần (router plan chốt tên; UI đọc phòng thủ):**

| Field | Kiểu | Dùng để |
|---|---|---|
| `connection.keys[]` | mảng, **vắng ⇒ chế độ legacy** | Toàn bộ key ring |
| `keys[].id` | string | URL cho PATCH/DELETE/try |
| `keys[].label` | string | Tên chủ nhà đặt khi thêm khoá |
| `keys[].prefix` | string, **chỉ tiền tố** (≤ 12 ký tự) | Hiện dạng `sk-or-v1-8f3c…` |
| `keys[].state` | `'ready' \| 'cooling' \| 'exhausted' \| 'error'` | Bốn nhãn trạng thái |
| `keys[].cooldownUntil` | epoch ms \| null | Đếm ngược + "nghỉ tới HH:MM" |
| `keys[].resetAt` | epoch ms \| null | Với `exhausted`: mốc hạn mức mở lại |
| `keys[].lastErrorCode`, `keys[].lastErrorMessage` | string \| null | Dòng lỗi cuối (router phải gửi chuỗi **đã an toàn**, không chứa khoá) |
| `keys[].lastUsedAt` | epoch ms \| null | "dùng gần nhất 3 phút trước" |
| `connection.activeKeyId` (khuyến nghị, không bắt buộc) | string \| null | Đánh dấu dòng khoá đang phục vụ lượt gần nhất; **vắng thì UI không đoán** |

**Không làm trong vòng này:** `frontend/src/components/settings/LlmApiKeysView.tsx` và `frontend/src/components/settings/RouterView.tsx` là **file chết, không được tham chiếu ở đâu** — không đụng tới. Gateway keys (`kind='key'`, `AccessSection` dòng 1636-1651) là **khái niệm khác** — không trộn.

---

## 1. Kiểu dữ liệu và luật trạng thái

**T1 — `frontend/src/types/provider.ts`**
- Thêm `export interface ConnectionKey { id: string; label: string; prefix: string; state: 'ready' | 'cooling' | 'exhausted' | 'error'; cooldownUntil: number | null; resetAt: number | null; lastErrorCode: string | null; lastErrorMessage: string | null; lastUsedAt: number | null }`.
- Thêm vào `ProviderConnection` (dòng 52-62): `keys?: ConnectionKey[]` và `activeKeyId?: string | null` — **optional**, đúng kiểu phòng thủ đã dùng cho `autoSync?`, `costMode?`, `lastDiscoveryAttemptAt?`.

**Luật phòng thủ (một chỗ, dùng chung):** `const keyRing = Array.isArray(connection.keys) ? connection.keys : null`. `keyRing === null` ⇒ card giữ **nguyên hành vi hôm nay** (input "Replace API key" dòng 408 + `PATCH {apiKey}`). Đường legacy **không được xoá** trong vòng này, vì harness/router cũ vẫn chạy được (tiền lệ `_Legacy*` trong chính file này).

**Bốn trạng thái khoá (UI chỉ RENDER, không tự suy diễn):**

| `state` | Nhãn hiện trên dòng | Ghi chú |
|---|---|---|
| `ready` | `ready` (xanh, dùng `Pill value="ready"`) | Sẵn sàng trong vòng xoay |
| `cooling` | `cooling · 14:32` + `12s` đang đếm | `14:32` = giờ `cooldownUntil`; `12s` = số giây còn lại, cập nhật mỗi giây |
| `exhausted` | `quota exhausted` (+ `· opens 15:00` nếu có `resetAt`) | Hạn mức dài hơn trần cooldown |
| `error` | `error` (đỏ) + một dòng `lastErrorMessage` (≤ 160 ký tự, một dòng, `truncate`) | Kèm mã `lastErrorCode` trong `title` |
| giá trị lạ | `unknown` (xám) | Không crash, không đoán |

`cooling` với `cooldownUntil` đã qua mà snapshot chưa đổi ⇒ vẫn hiện `cooling`; **UI không tự đổi trạng thái** (router là nguồn sự thật) — chỉ ẩn số đếm khi ≤ 0 và hiện `checking…` mờ.

---

## 2. Thành phần mới

### 2.1 `frontend/src/components/settings/ConnectionKeyRing.tsx` (mới, ~190 dòng)

Đầu vào: `{ connection: ProviderConnection }`. Dùng `useProviderStore` (`request` dòng 43-62; `probeModel` **không dùng** ở đây).

**Bố cục (giữ đúng ngôn ngữ thị giác đang có: `field`/`secondary`/`primary` dòng 49-51, `Pill` từ `../providers/ProviderStatus`, `Empty` dòng 1653-1655):**
1. Dòng tiêu đề: `Keys on this connection` + `{keys.length} keys` + dòng phụ **`Rotates automatically when a key runs out of quota.`** (tương đương "Tự chuyển khoá khi hết hạn mức").
2. `<ul role="list">` mỗi khoá một `<li>` (viền `border-line`, nền `bg-panel2`, bo `rounded-lg`, `px-2.5 py-2`):
   - hàng 1: `<span className="font-mono text-[11px]">{maskPrefix(key.prefix)}</span>` + `label` (đậm, `truncate`) + `Pill` trạng thái + `Đang dùng` nếu `connection.activeKeyId === key.id`;
   - hàng 2 (chỉ khi có): `nghỉ tới HH:MM · 12s`, `hạn mức mở lại HH:MM`, `dùng gần nhất {shortTimestamp(lastUsedAt)}`, dòng lỗi cuối (đỏ, một dòng, `title` = mã lỗi);
   - hàng 3: nút `Replace key` (`KeyRound`), `Remove key` (`Trash2`, viền đỏ), `Try now` (`RefreshCw`, **chỉ hiện khi `state !== 'ready'`**).
3. Ô nhập khoá: `showInput` cục bộ; `input type="password" autoComplete="off"` + `label` (tuỳ chọn, `placeholder="e.g. key 2"`) + `Save` / `Cancel`. **Không** giữ giá trị sau khi lưu hoặc huỷ.
4. Nút `Add key` (`Plus`, `secondary`) ở cuối danh sách; khi `keys.length === 0` thì khối này chính là empty state: `Empty text="No key on this connection yet."` + nút `Add key` (`primary`) — **đây là chỗ "Add key" cho connection chưa có khoá**, không bắt chủ nhà đi vòng qua nút Edit.

**Che khoá — quy tắc cứng:**
- `maskPrefix(value)`: lấy tối đa **6 ký tự đầu** + `…`; nếu chuỗi ngắn hơn 6 thì vẫn cắt còn 6. Không hàm nào khác được in `prefix` ra ngoài.
- UI **không bao giờ** giữ secret trong state sau khi lưu/huỷ, không log, không đưa vào `title`/`aria-label`.
- `lastErrorMessage` đi qua `scrub(text)`: cắt ≤ 160 ký tự, thay mọi chuỗi `≥ 20` ký tự liền không dấu cách bằng `<redacted>` — một dòng bảo hiểm cho trường hợp router lỡ gửi secret.

**Gọi router:** `run(request(path, 'POST'|'PATCH'|'DELETE', body))` — dùng đúng helper `run(action)` dòng 46 của `ProviderView` (ở file mới thì định nghĩa lại y hệt: `try { await action } catch { /* lỗi đã nằm ở store */ }`), nên mọi lỗi router vẫn hiện ở banner `role="alert"` dòng 131 và/hoặc dòng `connection.error`. Sau mỗi lệnh thành công, `request()` đã tự `load()` lại snapshot (providerStore.ts:43-62) ⇒ **không cần state cục bộ cho danh sách**.

**A11y (xem §6):** mỗi `<li>` là một vùng có `aria-label` = `Key {label || prefix}`; nút có tên truy cập kèm nhãn khoá (`Remove key {label}`); số giây đếm ngược `aria-hidden="true"`; một `role="status" aria-live="polite"` cấp khối chỉ đọc **chuyển trạng thái**.

**Đồng hồ đếm ngược:** một `setInterval(1000)` **duy nhất** trong khối, chỉ chạy khi `keys.some(k => k.cooldownUntil && k.cooldownUntil > Date.now())`; `useEffect` dọn interval khi unmount hoặc khi không còn khoá nào nghỉ. Không dùng `setTimeout` mỗi dòng.

**i18n:** chuỗi tiếng Anh inline (xem §6) — đúng quy ước của màn Settings, không import `frontend/src/i18n/**`.

### 2.2 `frontend/src/components/settings/ProviderModelList.tsx` (mới, ~150 dòng)

Chuyển `ModelToggleList` (`ProviderView.tsx` dòng **1313-1436**) sang file riêng và **đổi từ per-connection thành per-provider**:

- Props: `{ connections: ProviderConnection[] }` (chỉ những connection đã lọc `enabled && authState === 'ready' && discoveryState === 'ready'`).
- `rows = dedupeByModel(connections)`: gom theo `model.id`, giữ **model row đầu tiên** theo thứ tự connection đã sắp theo `connectionOrder` (xem `RouterProviderDetailV2` dòng 556-557), kèm `serving: ProviderConnection[]` và `modelIds: string[]`.
- Mỗi dòng: giữ nguyên phần thân hiện có (capability chips 1355-1369, `role="status"` sr-only 1393, `input aria-label={`Enable ${model.id}`}` 1405, nút Test/Disable/Copy, `latencyTitle` 1304) **cộng** một chip `{serving.length} connections` khi `serving.length > 1` (kèm `title` = danh sách tên connection).
- **Toggle nhiều connection:** `patchEnabled(next)` gọi **tuần tự** một `PATCH /api/router/connections/{id}` per serving connection (không `Promise.all`: giữ đúng thói quen của file và để thông điệp lỗi đọc được). Checkbox `checked = mọi serving connection đều bật`; một phần ⇒ `ref.indeterminate = true` (dùng `HTMLInputElement.indeterminate`, không cần thư viện). Sau khi chạy, nếu lỗi một phần, in `Enabled in 2 of 3 connections.` (đỏ, dòng nhỏ dưới dòng model) — **không im lặng**.
- **Probe:** `probeModel(serving[0].id, model.id, signal)` (connection hạng cao nhất — đúng connection router sẽ dùng); giữ nguyên `AbortController` set (1323-1327) và `probeModel` không qua `request()` (providerStore.ts:71-82). Dòng ghi `Tested via {serving[0].name}` khi `serving.length > 1`.
- "Manage models" (`ModelManagerModal`) và "Add model by hand" gắn với `serving[0]` (một connection cụ thể — thêm model thủ công là việc của một connection).

### 2.3 `ProviderView.tsx` — điểm gắn chính xác

**Tab API (`ApiPanel` 194-252, vòng lặp card dòng 246):**
- Trong `ConnectionCard` (286-443), khối `editOpen` (403-421): **thay dòng 408** (`<label ...>Replace API key ...`) bằng `<ConnectionKeyRing connection={connection} />`; grid dòng 406 đổi thành `md:grid-cols-2` (Name + Base URL cho `custom`).
- Dòng 389 (`No API key saved on this connection. Add one in Edit, then Refresh models.`) thay bằng `<ConnectionKeyRing connection={connection} />` rút gọn ở chế độ empty — nói cách khác khối key ring **luôn có mặt** ở đầu card (khi `keys` có mặt), còn nhánh legacy mới giữ câu cũ.
- Nút `Edit endpoint & key` dòng 377 vẫn mở khối Edit (đổi nhãn thành `Edit name & endpoint` khi `keys` có mặt, để không hứa một ô khoá không còn ở đó).
- **Bỏ** `<ModelToggleList connection={connection} />` khỏi card (dòng 433); thêm **một** khối model cấp provider ngay sau danh sách card (sau dòng 246): `<ProviderModelList connections={readyConnections} />` với tiêu đề `Models` + dòng phụ `One row per model · served by N connection(s)`.
- Thêm hành động **"Merge keys from another connection"** trên card (§3).

**Tab Router (`RouterProviderDetailV2` 544-691, render card dòng 685):**
- `OAuthOrApiConnectionCard` (745-936): khi `!isOAuth` (759), thay khối input đơn 829-861 bằng `<ConnectionKeyRing connection={connection} />`, và nút 875-882 thành công tắc mở/đóng khối đó (giữ icon `KeyRound`). Khi `isOAuth === true`: **giữ nguyên** input đơn hôm nay (access token không phải key ring).
- Bỏ `ModelToggleList` khỏi nhánh `913-917`; thêm `<ProviderModelList connections={...} />` một lần cho cả provider, sau khối danh sách connection (sau dòng 688).

---

## 3. Gộp khoá (quyết định mới 1)

**Đặt ở đâu:** trong `ConnectionCard` (tab API) và `OAuthOrApiConnectionCard` (tab Router) — cùng một component con `MergeKeysRow` nằm trong `ConnectionKeyRing.tsx`, render khi provider có **≥ 2 connection và bản thân connection này có ≥ 1 khoá**.

**Luồng:**
1. `<select aria-label="Merge keys from">` liệt kê **các connection khác của CÙNG `providerId`** đang có `keys.length > 0`; option = `{connection.name} · {n} keys`.
2. Nút `Merge into this connection` (`secondary`, icon `Plus`/`KeyRound`). Dòng xác nhận ngay dưới: `Move 3 keys from “OpenCode Free (key 2)” into this connection. The router moves them; the secret never leaves the server.`
3. Bấm ⇒ `POST .../keys/import { fromConnectionId }`. Busy: nút `disabled={busy}` + nhãn `Merging…` + `aria-busy` (giữ thói quen của nút Test dòng 427-431).
4. Thành công ⇒ `request()` tự `load()` lại snapshot; không state cục bộ.

**Sau khi gộp, connection NGUỒN ra sao (phải nói rõ cho chủ nhà):**
- Card nguồn **vẫn hiện** (không tự biến mất, không tự xoá), ở **empty state** của key ring: `No key on this connection yet.` + nút `Add key`, **cộng** một dòng xanh `3 keys moved to “OpenCode Free”. Delete this connection if you no longer need it.`
- Nút `Delete` của card nguồn **được BẬT** ngay (vì `keys.length === 0`), nên chủ nhà xoá connection trùng bằng đúng một cú bấm — đây là cách "connection trùng bị xoá" xảy ra.
- **Không có xoá tự động**: không đường nào trong UI tự gọi `DELETE`, kể cả khi nguồn vừa rỗng khoá.
- Chọn trong rail **không đổi**: `ProviderRail` nhận `selectedId={chosen?.id}` (ApiPanel dòng 218) — đơn vị chọn là **provider**, không phải connection. Sau khi gộp, dòng trạng thái provider tự đổi số (`providerStatusLine` đọc `connections`: từ `4 connection ready` còn `1 connection ready`) vì snapshot mới.
- Provider còn lại **0 connection** ⇒ `ApiPanel` rơi vào `Empty text="No API connection configured yet."` (dòng 246) như hôm nay; không có nhánh mới.

**Đường xoá connection bị chặn khi còn khoá (hai lớp, cả hai đều nói thật):**
- **UI chặn trước:** nút `Delete` trong khối Edit (`ConnectionCard` dòng 418) và trong hàng hành động tab Router (dòng 900-908) `disabled` khi `keyRing !== null && keyRing.length > 0`, kèm dòng lý do ngay dưới: `Remove the {n} key(s) on this connection first — delete would drop them.`
- **Router chặn sau:** nếu vẫn tới lượt gọi, lỗi của router hiện nguyên văn ở banner `role="alert"` dòng 131 (qua `run()` → `request()` → `set({error})`), **không thay bằng câu chữ của UI**.

---

## 4. Danh sách model — quyết định mới 2

**Chọn: GỘP theo provider — một dòng cho mỗi `model.id`, ghi rõ số connection đang phục vụ.** Nếu provider còn nhiều connection cùng cung cấp một model, model đó **vẫn chỉ có MỘT dòng**, thêm chip `{n} connections`.

**Lý do (bốn ý, theo thứ tự sức nặng):**
1. Đúng nguyên văn yêu cầu chủ nhà: "một dòng cho mỗi model" — không phải "một dòng cho mỗi connection".
2. Sau khi gộp (§3), trường hợp thường gặp là **một connection/provider**, nên dạng gộp **thu về đúng danh sách hôm nay** — không thêm gì trong ca phổ biến.
3. Không để lỗi cũ quay lại: ai thêm connection thứ hai sau này cũng không làm danh sách nhân đôi.
4. Một luật dùng chung cho cả ba chỗ hiển thị model (card, khối Models, model picker trong chat) ⇒ một test ghim được cả ba.

**Cái mất khi gộp (nói thật, không giấu):** một dòng model không còn nói "model này thuộc riêng connection nào". Bù bằng chip `{n} connections` + `title` liệt kê tên, và dòng `Tested via {name}` khi test. Toggle ghi cho **mọi** connection phục vụ; checkbox một phần hiện `indeterminate`; lỗi một phần hiện `Enabled in 2 of 3 connections.`

**Model picker trong chat (`frontend/src/components/chat/HarnessModelPicker.tsx` dòng 66-83) phải theo cùng luật** — đây chính là chỗ chủ nhà nhìn thấy "key1 model A, key2 model A": hôm nay `liveModels` `flatMap` mỗi (connection, model) thành một entry. Đổi thành gom theo `${providerId}::${modelId}`, giữ connection **hạng cao nhất** (theo `connectionOrder`; không có thì theo thứ tự snapshot) cho `id: \`model:${c.id}:${m.id}\`` (giá trị composer gửi đi không đổi kiểu), và đổi nhãn từ `${c.name} · ${m.name}` sang `${providerName} · ${m.name}` khi có > 1 connection phục vụ (`providerName` lấy từ `snapshot.providers`).

**Cố ý KHÔNG đổi:** `publicTargets` (dòng 58-70) vẫn một mục cho mỗi (connection, model) — **route target phải trỏ đúng một connection** (`{connectionId, modelId}`, dùng ở RoutingSection 1448, AliasCard 1484, `allowedModels` 1638); gộp ở đó sẽ làm alias mất đường lui sang connection thứ hai. Ghi chú này vào comment cạnh hàm để lần sau không ai "dọn" nó.

**Giao kèm với peer `v29-plan-route`:** peer đó lập kế hoạch **chọn model theo `providerId + modelId`** (giá trị composer gửi đi, `harnessChatStore.ts:642-713`, nhánh `selection kind 'model'`). Hai kế hoạch chồng nhau **đúng một điểm**: cùng muốn `HarnessModelPicker` hết nhân đôi. Kế hoạch này chỉ sửa **phần dựng danh sách** trong `liveModels` (dòng 66-83); việc đổi khoá chọn từ `model:{connectionId}:{modelId}` sang provider+model là **của peer, không làm ở đây**. Nếu peer chốt hình dạng `id` mới, sửa T5 theo peer (một chỗ, ~10 dòng) và **giữ** việc gộp dòng — hai việc độc lập.

---

## 5. Kiểm thử

**Đang phủ vùng này (phải giữ xanh):**
- `frontend/src/components/settings/ProviderConnectionCard.test.tsx` — 12 ca: card thu gọn (dòng 106-112 ghim chữ `Replace API key` và "không có `input[type="password"]` khi gấp"), probe một lần + `aria-busy`, lỗi 403 AUTH, hai PATCH `enabledModelIds` (đủ/ rỗng), chip custom + probe riêng, ba đường ra của listing hỏng, `Add model by hand`, tiêu đề latency, focus Base URL, hint endpoint.
- `frontend/src/store/providerStore.test.ts` — 6 ca: snapshot cũ bị bỏ qua (`loadRevision`), header admin + `credentials:'same-origin'`, key dùng một lần, probe không khoá form và không bắn lỗi toàn cục, envelope lỗi probe.

**Ca phải SỬA (không được để đỏ):**
- `ProviderConnectionCard.test.tsx` ca 1: bỏ ghim chữ `Replace API key`; thay bằng ghim mới — khi `keys` **vắng** (fixture cũ) card vẫn nói `Replace API key`; khi gấp thì không có `input[type="password"]` (giữ nguyên ý nghĩa). Ca 4 giữ nguyên vì fixture chỉ có MỘT connection (`openrouter-key`) ⇒ khối Models cấp provider ghi đúng một PATCH vào `/api/router/connections/openrouter-key` (đường dẫn không đổi).

**Ca MỚI — `frontend/src/components/settings/ConnectionKeyRing.test.tsx` (mới):**
1. `keys: []` ⇒ empty state `No key on this connection yet.` + nút `Add key`.
2. Thêm khoá: gõ label + key, `Save` ⇒ **một** `POST /api/router/connections/{id}/keys` với body chứa `key`; sau đó danh sách dài thêm một dòng (snapshot giả được cập nhật bởi fetch mock).
3. `Remove key` dòng cuối ⇒ `DELETE .../keys/{keyId}`, và sau khi load lại snapshot `keys: []` ⇒ quay về empty state.
4. Khoá `cooling`: dòng hiện `cooling · HH:MM`, số giây đếm ngược **giảm sau 1 giây** (dùng `vi.useFakeTimers()`), và `Try now` gọi `POST .../keys/{keyId}/try`.
5. Khoá `exhausted` + `resetAt` ⇒ hiện `quota exhausted` và mốc mở lại.
6. Khoá `error` ⇒ hiện `lastErrorMessage` một dòng, và `lastErrorCode` nằm trong `title`.
7. **Không bao giờ lộ khoá:** fixture có `prefix = 'sk-or-v1-8f3c9d2e1b7a4c6f5e8d'` (dài) và `lastErrorMessage` chứa một chuỗi giống khoá ⇒ `expect(host.textContent).not.toContain(<chuỗi đầy đủ>)`; đồng thời sau `Save`, `expect(host.textContent).not.toContain(SECRET)` và `expect(host.querySelector('input[type="password"]')?.value ?? '')` rỗng.
8. Phòng thủ: connection **không có field `keys`** ⇒ card vẫn render input `Replace API key` cũ và **không** crash (đường legacy).

**Ca MỚI — trong `ProviderConnectionCard.test.tsx`:**
9. **Không nhân đôi dòng model:** fixture hai connection cùng providerId `openrouter`, cùng model `gpt-5-mini` ⇒ chỉ **một** `input[aria-label="Enable gpt-5-mini"]` trong toàn bộ `host`, và chip `2 connections`. Bật một chiều ⇒ hai PATCH, một cho mỗi connection id.
10. Bỏ khoá cuối ⇒ empty state (đã có ở ca 3 của file ring; ở đây ghim cùng luồng qua card thật).
11. Gộp khoá: hai connection cùng provider, nguồn có 1 khoá ⇒ `POST .../keys/import` với `{ fromConnectionId }`; snapshot sau đó nguồn `keys: []` ⇒ card nguồn hiện empty state + dòng `keys moved to`, và nút `Delete` của nó bật.
12. `Delete` **bị chặn** khi connection còn khoá: nút `disabled` + dòng lý do; `fetch` **không** thấy `DELETE`.

**Ca MỚI — `frontend/src/components/settings/ProviderModelList.test.tsx` (mới):**
1. Hai connection cùng provider, cùng `model.id` ⇒ **một** dòng, chip `2 connections`, `title` có tên hai connection.
2. Bật một dòng ⇒ **hai** PATCH (mỗi connection một lượt) và không `Promise.all` (kiểm tra bằng thứ tự request trong fetch mock).
3. Một connection bật / một connection tắt ⇒ checkbox `indeterminate`, và sau khi bật ⇒ `checked`.
4. PATCH thứ hai lỗi ⇒ dòng `Enabled in 2 of 3 connections.` xuất hiện, không nuốt lỗi.
5. `Test` chỉ gọi **một** URL probe: `.../connections/{serving[0].id}/models/{modelId}/test`, và dòng `Tested via {name}` hiện khi > 1 connection.

**Ca MỚI — `frontend/src/components/chat/HarnessModelPicker.test.tsx`** (nếu file chưa có thì tạo): hai connection cùng provider cùng một model ⇒ picker có **một** option cho model đó, nhãn `{providerName} · {modelName}`, và `id` ghim connection hạng cao nhất.

**Ca MỚI — `frontend/src/store/providerStore.test.ts` (+2):**
13. Snapshot có `keys` ⇒ `load()` trả về nguyên mảng (không cắt/đổi tên field).
14. `POST .../keys` bị 429 ⇒ `request()` ném `ProviderApiError` có `code/status`, đặt `error` cho banner, **và vẫn `load()` lại snapshot** (giữ nguyên hợp đồng dòng 43-62).

**Lệnh chạy (đo được, dùng đúng cách repo đang chạy):**
- `cd frontend && VITE_BOX_API_URL=http://localhost:8081 npx vitest run` (toàn bộ suite; baseline gần nhất 126 file / 1130 ca xanh).
- Nhóm hẹp: `npx vitest run src/components/settings src/components/chat/HarnessModelPicker.test.tsx src/store/providerStore.test.ts`.
- `npm run typecheck` (`tsc -b --noEmit`) và `npx eslint` trên các file đã sửa.
- Không chạy backend/router; không rebuild box; không đụng tiến trình 3100/3101/3102.

---

## 6. A11y + i18n (không thêm dependency)

**Ngôn ngữ chuỗi UI — sự thật đã đo:** màn Settings **không** có i18n. `frontend/src/i18n/**` chỉ phục vụ nhãn chat/answer (`en.ts`, `vi.ts`, `answerLang.ts`, `answerLabels.ts`); `ProviderView.tsx` có **0** lời gọi `t()`/`tLabel()` và toàn bộ chuỗi ở đó là tiếng Anh hardcode (`Replace API key`, `Refresh models`, `No API connection configured yet.`, `Edit endpoint & key`…). Vậy:
- Bốn nhãn trạng thái ship **tiếng Anh**: `ready` / `cooling · 14:32` / `quota exhausted` / `error`. Bốn từ tiếng Việt mà chủ nhà dùng (`ready` / `nghỉ tới HH:MM` / `hết hạn mức` / `lỗi`) là **bản dịch 1-1** của đúng bốn nhãn đó.
- Gom **tất cả** chuỗi mới vào **một** hằng số ở đầu `ConnectionKeyRing.tsx`: `const KEY_RING_COPY = { addKey: 'Add key', replaceKey: 'Replace key', removeKey: 'Remove key', tryNow: 'Try now', merge: 'Merge keys from another connection', …, stateReady: 'ready', stateCooling: 'cooling', stateExhausted: 'quota exhausted', stateError: 'error', rotationHint: 'Rotates automatically when a key runs out of quota.' }`. Đổi sang tiếng Việt = sửa một khối. Không import `i18n` (màn Settings chưa có cơ chế đó; tự ý dùng sẽ tạo hai hệ chuỗi trong cùng một trang).
- Giữ đúng văn phong câu chữ hiện có: câu ngắn, nói việc thật, không hứa quá (`Remove the 2 keys on this connection first — delete would drop them.`).

**A11y:**
- Danh sách khoá: `<ul role="list">` + `<li>`; mỗi `<li>` có `aria-label={`Key ${label || maskPrefix(prefix)}`}`.
- Nút mang tên khoá: `Remove key {label}`, `Replace key {label}`, `Try key {label} now` (đừng để ba nút cùng tên "Remove" trong một `ul` — trình đọc màn hình không phân biệt được).
- Ô nhập: `<label>` bọc input (thói quen của file), `autoComplete="off"`, `type="password"`; nút `Save` gắn `aria-busy` khi đang gửi.
- **`aria-live` cho khoá đang nghỉ:** một khối `role="status" aria-live="polite"` **cấp card** (không phải trong từng dòng), chỉ ghi **chuyển trạng thái**: `Key 2 is cooling — it rejoins rotation at 14:32.` / `Key 2 is ready again.` Số giây đếm ngược nằm **ngoài** vùng live (hoặc `aria-hidden="true"`) để không đọc lại mỗi giây.
- Checkbox model một phần: `ref.indeterminate` + `aria-checked` không cần chỉnh (native); dòng `Enabled in 2 of 3 connections.` là text thường.
- Không dùng màu làm tín hiệu duy nhất: mỗi trạng thái đều có **chữ** (`ready`/`cooling`/…), màu chỉ là phụ.
- Giữ nguyên mọi `role`/`aria` đang có: tablist 104-127, `role="alert"` 131, `aria-expanded`/`aria-controls` của các khối gấp.

**Không thêm dependency:** chỉ dùng `react`, `lucide-react` (đã có), `Intl`/`toLocaleTimeString` (đã dùng ở `shortTimestamp` 263 và `formatResetTime` 1014-1025 — **tái dùng hai helper này**, đừng viết định dạng mới). Không `date-fns`, không `react-i18next`, không thư viện đếm ngược.

---

## 7. Kích thước và thứ tự thi công

| # | Việc | Tệp | Dòng (ước) | Thứ tự |
|---|---|---|---|---|
| T1 | Kiểu `ConnectionKey` + field optional | `frontend/src/types/provider.ts` | +25 | — |
| T2 | 5 hằng số đường dẫn router (một chỗ, để khớp router plan) | `frontend/src/lib/routerKeyPaths.ts` (mới) | ~20 | after T1 |
| T2b | Ring: dòng khoá, 4 trạng thái, add/replace/remove/try, gộp, a11y | `frontend/src/components/settings/ConnectionKeyRing.tsx` (mới) | ~190 | after T2 |
| T3 | Danh sách model cấp provider (chuyển từ `ModelToggleList` 1313-1436 + dedupe + toggle nhiều connection) | `frontend/src/components/settings/ProviderModelList.tsx` (mới) | ~150 | after T1 |
| T4 | Nối dây: thay input dòng 408, empty state dòng 389, bỏ `ModelToggleList` khỏi 2 card, thêm khối Models, mount tab Router, chặn Delete | `frontend/src/components/settings/ProviderView.tsx` | −25 / +90 | after T2b, T3 |
| T5 | Dedupe model picker trong chat | `frontend/src/components/chat/HarnessModelPicker.tsx` | +10 / −6 | after T3 |
| T6 | Test: sửa 2 file hiện có + 3 file test mới | `ProviderConnectionCard.test.tsx`, `providerStore.test.ts`, `ConnectionKeyRing.test.tsx` (mới), `ProviderModelList.test.tsx` (mới), `HarnessModelPicker.test.tsx` | +330 | after T4/T5 |
| T7 | Chốt: `tsc -b --noEmit`, `eslint`, full vitest, soát 5 hằng số đường dẫn với router plan | — | — | after T6 |

Tổng: **~9 file, khoảng +810 / −40 dòng**, không dependency mới. T2b và T3 **chạy song song** được (hai file mới, không chung state).

---

## 8. Chưa rõ / còn mở (tối đa 6)

1. **Tên route router** (5 đường dẫn ở §0) chưa tồn tại — `v29-keyring-router-plan.md` chưa được viết lúc lập kế hoạch này. Việc nối dây (T4) **không được bắt đầu** trước khi đọc bản đó; mọi sai lệch chỉ sửa trong `frontend/src/lib/routerKeyPaths.ts`.
2. **Ngôn ngữ 4 nhãn trạng thái:** kế hoạch chọn **tiếng Anh** cho khớp toàn màn Settings (chủ nhà đã viết `nghỉ tới HH:MM` / `hết hạn mức` / `lỗi` trong yêu cầu). Nếu chủ nhà muốn tiếng Việt, đổi `KEY_RING_COPY` (một khối) — nhưng khi đó bốn nhãn tiếng Việt sẽ nằm giữa màn tiếng Anh.
3. **"Gộp khoá" chuyển TẤT CẢ khoá của connection nguồn hay từng khoá một?** Kế hoạch giả định **tất cả** (khớp ca "gộp 4 connection opencode còn 1"): UI gửi `{ fromConnectionId }` và in trước số khoá sẽ chuyển. Nếu router chọn ngữ nghĩa từng khoá, UI cần thêm nút "Move this key to…" trên **từng dòng** (thêm ~20 dòng, không đổi phần còn lại).
4. **Đường xoá khoá cuối:** kế hoạch giả định router **giữ connection** (rỗng khoá) chứ không tự xoá — UI hiện empty state + nút Delete. Nếu router tự xoá connection khi hết khoá, câu chữ dòng 389 phải đổi thành "connection đã bị xoá" và card biến mất — cần chốt.
5. **Khoá đang nghỉ có được `Try now` gọi khi `busy` toàn cục?** Kế hoạch: nút `Try now` **không** bị `busy` chặn (giống `probeModel`, để một lượt thử khoá không khoá cả trang) nhưng tự `disabled` khi chính nó đang chạy. Cần xác nhận đây là ý muốn.
6. **`activeKeyId` có được router trả không?** Nếu không, UI **không** đánh dấu "đang dùng" ở đâu cả (không đoán từ `lastUsedAt`, vì nhiều khoá có thể cùng thời điểm).

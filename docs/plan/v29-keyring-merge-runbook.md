# Runbook — gộp bốn connection `opencode` thành một key ring ba khoá (vòng 29, R-5)

> Việc R-5 của kế hoạch `v29-keyring-router-plan.md`. **Chủ nhà chạy một lần** trên máy của mình,
> sau khi bản router vòng 29 đã lên (năm đường dẫn `/keys` phải trả lời — xem bước 0).
> Không bao giờ dán lại khoá, không re-encrypt: mỗi khoá vẫn là **đúng dòng `credentials` đã mã
> hoá sẵn có**, chỉ đổi quyền sở hữu ở bảng `records` (AAD của blob là id **dòng**, không phải id
> connection — `router/src/store.mjs:44`). Ciphertext trong `router.sqlite` không đổi một byte.

## Khi nào dùng

- Bốn connection `opencode` đang sống, mỗi cái một credential: `f8a5f4e8…` (key 1), `a43ff124…`
  (key 2), `3d27b0b0…` (key 3) và `7c59f6b5…` (bản dán lại của key 1, `failed`, từng là mặc định
  của lượt chạy sống).
- Muốn "429 thì sang khoá kế tiếp" do **router tự làm**, không phải thao tác tay đổi
  `BOXFOX_LIVE_CONNECTION_ID` giữa các lượt (`docs/plan/v27/research-quality-tests.md` §2.3).
- Chỉ dùng cho bốn id này. Connection mới thì thêm khoá bằng nút của giao diện, không cần runbook.

## Chuẩn bị

- Router là **bản vòng 29 trở lên** (`cd router && npm test` xanh). Kiểm nhanh ở bước 0.
- Header quản trị cho mọi lệnh: `X-BoxFox-Admin: 1` + `Origin: http://localhost:3100`.
- Router ở `http://127.0.0.1:3101`; dữ liệu ở `~/.local/share/boxfox/router/` —
  hoặc `$BOXFOX_ROUTER_DATA_DIR` nếu máy đặt biến này (`router/src/store.mjs:10`).

```bash
export ROUTER='http://127.0.0.1:3101'
export ADMIN=(-H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' -H 'Content-Type: application/json')
export BOXFOX_ROUTER_DATA_DIR="${BOXFOX_ROUTER_DATA_DIR:-$HOME/.local/share/boxfox/router}"
export SURVIVOR='f8a5f4e8-0986-45f9-bf5b-555e8b96a95c'
export KEY2='a43ff124-359f-4da5-bbd0-82c54df64a53'
export KEY3='3d27b0b0-1de7-4c67-a803-c6e26afab631'
export DUPLICATE='7c59f6b5-d0ee-4206-9d04-bc19936b0681'

# 0. Router đã có đường dẫn khoá chưa? Phép thử này KHÔNG ghi gì: import thiếu nguồn ⇒
#    400 "Choose a connection to move keys from."; bản cũ chưa có route ⇒ 404.
curl -s "${ADMIN[@]}" -X POST "$ROUTER/api/router/connections/$SURVIVOR/keys/import" -d '{}' -w '\n%{http_code}\n'
# Và hình dạng ring hiện tại (bản vòng 29 trả `keys` cho connection có credential):
curl -s "${ADMIN[@]}" "$ROUTER/api/router/connections" | python3 -c 'import json,sys;print([(c["id"],len(c["keys"])) for c in json.load(sys.stdin) if c.get("keys") is not None])'
```

## Mười bước (đúng thứ tự)

```bash
# 1. Sao lưu TRƯỚC khi làm: DB + khoá chủ.
cp -a "$BOXFOX_ROUTER_DATA_DIR/router.sqlite" "$BOXFOX_ROUTER_DATA_DIR/router.sqlite.$(date -u +%Y%m%dT%H%M%SZ).bak"
cp -a "$BOXFOX_ROUTER_DATA_DIR/master.key"    "$BOXFOX_ROUTER_DATA_DIR/master.key.$(date -u +%Y%m%dT%H%M%SZ).bak"
ls -l "$BOXFOX_ROUTER_DATA_DIR"/*.bak

# 2. Ghi lại tham chiếu hiện tại: defaultRoute, alias nào trỏ vào bốn id này,
#    providerConfig('opencode').connectionOrder, và BOXFOX_LIVE_CONNECTION_ID đang dùng.
curl -s "${ADMIN[@]}" "$ROUTER/api/router/state" > /var/tmp/v29-state-before.json
python3 - <<'PY'
import json
state = json.load(open('/var/tmp/v29-state-before.json'))
four = {'f8a5f4e8-0986-45f9-bf5b-555e8b96a95c', 'a43ff124-359f-4da5-bbd0-82c54df64a53',
        '3d27b0b0-1de7-4c67-a803-c6e26afab631', '7c59f6b5-d0ee-4206-9d04-bc19936b0681'}
print('defaultRoute:', state['defaultRoute'])
print('aliases     :', [(a['id'], a['name'], [t['connectionId'] for t in a['targets'] if t['connectionId'] in four]) for a in state['aliases']])
print('order       :', next((config['connectionOrder'] for config in state['providerConfigs'] if config['id'] == 'opencode'), None))
for connection in state['connections']:
    if connection['providerId'] == 'opencode':
        keys = connection.get('keys')
        print(connection['id'], connection.get('name'), 'keys=', None if keys is None else [(k['id'], k['label'], k['prefix']) for k in keys])
PY
```

**Chốt survivor.** Đề xuất: `$SURVIVOR` = `f8a5f4e8…` ("key 1"). Nếu `default` hoặc một alias đang
trỏ vào một id **khác** trong bốn id ⇒ lấy **id đó** làm survivor để không phá tham chiếu. Nếu
tham chiếu đang trỏ vào `$DUPLICATE` ⇒ vẫn làm bình thường, nhưng **bước 9 bắt buộc** trỏ lại
survivor. Ba `prefix` in ở trên là **bằng chứng gốc** cho bước 5 — chép ra giấy hoặc giữ
`/var/tmp/v29-state-before.json`.

```bash
# 3. Chuyển toàn bộ khoá của key 2 vào CUỐI ring của survivor (khoá tự bê nguyên dòng đã mã hoá).
curl -s "${ADMIN[@]}" -X POST "$ROUTER/api/router/connections/$SURVIVOR/keys/import" \
  -d "{\"fromConnectionId\":\"$KEY2\"}" | python3 -c 'import json,sys;c=json.load(sys.stdin);print(len(c["keys"]),"khoá:",[k["id"] for k in c["keys"]])'

# 4. Y hệt với key 3 ⇒ survivor phải có ĐÚNG ba khoá, thứ tự [f8a5f4e8, a43ff124, 3d27b0b0].
curl -s "${ADMIN[@]}" -X POST "$ROUTER/api/router/connections/$SURVIVOR/keys/import" \
  -d "{\"fromConnectionId\":\"$KEY3\"}" | python3 -c 'import json,sys;c=json.load(sys.stdin);print(len(c["keys"]),"khoá:",[k["id"] for k in c["keys"]])'

# 5. Kiểm giữa đường: survivor ba khoá với ba `prefix` ĐÚNG BẰNG ba prefix ở bước 2;
#    hai connection nguồn rỗng ring nhưng vẫn sống (credentialPresent:false, authState:'required').
curl -s "${ADMIN[@]}" "$ROUTER/api/router/state" > /var/tmp/v29-state-mid.json
python3 - <<'PY'
import json
before = {c['id']: [(k['id'], k['prefix']) for k in (c.get('keys') or [])] for c in json.load(open('/var/tmp/v29-state-before.json'))['connections']}
after = {c['id']: c for c in json.load(open('/var/tmp/v29-state-mid.json'))['connections']}
survivor = after['f8a5f4e8-0986-45f9-bf5b-555e8b96a95c']
keys = survivor['keys']
assert [k['id'] for k in keys] == ['f8a5f4e8-0986-45f9-bf5b-555e8b96a95c', 'a43ff124-359f-4da5-bbd0-82c54df64a53', '3d27b0b0-1de7-4c67-a803-c6e26afab631'], keys
moved = {k['id']: k['prefix'] for k in keys[1:]}
assert moved['a43ff124-359f-4da5-bbd0-82c54df64a53'] == before['a43ff124-359f-4da5-bbd0-82c54df64a53'][0][1], 'prefix key 2 đổi — khoá đã bị gõ lại, DỪNG'
assert moved['3d27b0b0-1de7-4c67-a803-c6e26afab631'] == before['3d27b0b0-1de7-4c67-a803-c6e26afab631'][0][1], 'prefix key 3 đổi — khoá đã bị gõ lại, DỪNG'
for shell in ('a43ff124-359f-4da5-bbd0-82c54df64a53', '3d27b0b0-1de7-4c67-a803-c6e26afab631'):
    assert after[shell]['keys'] == [] and after[shell]['credentialPresent'] is False and after[shell]['authState'] == 'required', shell
print('ba prefix không đổi; hai shell còn sống với ring rỗng')
PY

# 6. Bỏ khoá thứ tư: xoá khoá duy nhất của bản trùng rồi xoá luôn bản trùng.
curl -s "${ADMIN[@]}" -X DELETE "$ROUTER/api/router/connections/$DUPLICATE/keys/$DUPLICATE" > /dev/null
curl -s "${ADMIN[@]}" -X DELETE "$ROUTER/api/router/connections/$DUPLICATE" -o /dev/null -w 'xoá bản trùng: %{http_code}\n'

# 7. Xoá hai shell (ring đã rỗng ⇒ qua được cửa 409 KEYS_PRESENT).
curl -s "${ADMIN[@]}" -X DELETE "$ROUTER/api/router/connections/$KEY2" -o /dev/null -w 'xoá shell key 2: %{http_code}\n'
curl -s "${ADMIN[@]}" -X DELETE "$ROUTER/api/router/connections/$KEY3" -o /dev/null -w 'xoá shell key 3: %{http_code}\n'

# 8. Đặt tên lại cho khớp mockup; nhãn khoá là tuỳ chọn.
curl -s "${ADMIN[@]}" -X PATCH "$ROUTER/api/router/connections/$SURVIVOR" -d '{"name":"OpenCode Free"}' > /dev/null
# curl -s "${ADMIN[@]}" -X PATCH "$ROUTER/api/router/connections/$SURVIVOR/keys/<keyId>" -d '{"label":"Khoá 2"}'

# 9. Trỏ lại mặc định NẾU tham chiếu cũ đang trỏ vào id đã xoá; và đặt biến cho lượt chạy sống.
# curl -s "${ADMIN[@]}" -X PUT "$ROUTER/api/router/default" -d "{\"connectionId\":\"$SURVIVOR\",\"modelId\":\"<modelId>\"}"
export BOXFOX_LIVE_CONNECTION_ID="$SURVIVOR"   # mặc định trong test_peer_mesh_chain.py:316 vẫn là id đã xoá

# 10. Kiểm cuối + một lượt sống (xem "Nghiệm thu" bên dưới).
curl -s "${ADMIN[@]}" "$ROUTER/api/router/state" | python3 -c 'import json,sys;s=json.load(sys.stdin);free=[c for c in s["connections"] if c["providerId"]=="opencode"];print(len(free),"connection opencode:",[(c["id"],len(c["keys"])) for c in free])'
```

## Nghiệm thu (máy kiểm được)

```bash
# a. Chỉ còn MỘT connection opencode, và nó có đúng ba khoá.
curl -s "${ADMIN[@]}" "$ROUTER/api/router/state" | python3 -c 'import json,sys;s=json.load(sys.stdin);free=[c for c in s["connections"] if c["providerId"]=="opencode"];assert len(free)==1,free;assert len(free[0]["keys"])==3;print("ok:",free[0]["id"],[k["id"] for k in free[0]["keys"]])'

# b. Bảng credentials 4 → 3 dòng, và ciphertext của ba dòng cũ giữ nguyên từng byte so với bản .bak.
#    (Máy này không có CLI `sqlite3`; dùng module của Python, mở read-only.)
python3 - <<'PY'
import glob, os, sqlite3
data = os.path.expandvars('$BOXFOX_ROUTER_DATA_DIR')
old = sorted(glob.glob(data + '/router.sqlite.*.bak'))[0]
def rows(path):
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    got = dict(db.execute('SELECT id, encrypted FROM credentials'))
    db.close()
    return got
before, after = rows(old), rows(data + '/router.sqlite')
four = ('f8a5f4e8-0986-45f9-bf5b-555e8b96a95c', 'a43ff124-359f-4da5-bbd0-82c54df64a53',
        '3d27b0b0-1de7-4c67-a803-c6e26afab631', '7c59f6b5-d0ee-4206-9d04-bc19936b0681')
print('số dòng credentials:', len(before), '->', len(after), '(bốn dòng opencode rời đi một)')
for key_id in four:
    assert key_id in before, f'{key_id} không có trong bản .bak — kiểm lại id trước khi làm tiếp'
for key_id in four[:3]:
    assert key_id in after and after[key_id] == before[key_id], f'ciphertext đổi ở {key_id} — DỪNG và khôi phục bản .bak'
assert '7c59f6b5-d0ee-4206-9d04-bc19936b0681' not in after, 'dòng của bản trùng chưa được xoá'
print('ba dòng cũ giữ nguyên từng byte; dòng bản trùng đã đi; không có re-encrypt')
PY

# c. Một lượt sống: hàng usage phải mang keyId/keyLabel của khoá đã phục vụ.
BOXFOX_LIVE_CONNECTION_ID="$SURVIVOR" BOXFOX_LIVE_MODEL_ID=muse-spark-1.3-contributor-free \
  ./.venv/bin/python -m pytest backend/tests/integration/test_peer_mesh_chain.py -q -p no:randomly
curl -s "${ADMIN[@]}" "$ROUTER/api/router/usage" | python3 -c 'import json,sys;u=json.load(sys.stdin)[0];print(u["status"],u.get("keyId"),u.get("keyLabel"))'
```

Sau đó ghi **một hàng** vào `docs/tracking/test-rounds.md` §vòng 27 theo lệ thường: thời điểm,
model, nhãn khoá (từ `keyId`/`keyLabel` ở (c)), mã lỗi, kết luận.

## Nếu có gì sai

- **Khôi phục**: dừng router, `cp -a` tệp `.bak` ở bước 1 về `router.sqlite` (và `master.key` nếu
  đã đổi), rồi mở lại. Bản sao là ảnh chụp cả DB, nên mọi bước 3–8 đều lùi được.
- **`404` ở bước 0**: router chưa có vòng 29. Cập nhật router rồi chạy lại từ bước 1.
- **`400` ở bước 3/4**: đọc `error.message` — sai provider/endpoint, nguồn rỗng, đích bị tắt, hoặc
  đích đã đủ 10 khoá. Không có gì bị ghi khi import bị từ chối.
- **`409 KEYS_PRESENT` ở bước 7**: ring của shell chưa rỗng — nghĩa là một khoá chưa được chuyển
  sang survivor; chạy lại bước 3/4 với đúng id đó trước khi xoá.
- **`prefix` ở bước 5 không khớp**: khoá đã bị thay bằng khoá khác. Không xoá gì nữa; khôi phục bản
  `.bak` ở bước 1 rồi làm lại từ bước 2.

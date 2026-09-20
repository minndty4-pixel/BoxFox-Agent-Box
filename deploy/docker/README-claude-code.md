# Claude Code trong box — chạy `/claude-code` KHÔNG cần tài khoản Anthropic

Tài liệu này mô tả đường chạy `/claude-code` sau khi box có Claude Code CLI và
box được phép nói chuyện với router BoxFox. Đọc kèm:

- `deploy/docker/Dockerfile` — lớp 4.8 (Node + CLI + bubblewrap) và lý do từng thứ.
- `deploy/docker/box-firewall` + `deploy/docker/box-firewall-rules.py` — công tắc egress (②a/②b).
- `backend/src/agentbox/sandbox/claude_executor.py` / `claude_worker.py` — hợp đồng biến môi trường + readiness.
- `docs/plan/agent-box-plan.md` mục 7.4.1 (công tắc mạng) và 7.5 (thành phần trong box).

---

## 1. Hai luồng model song song (và vì sao không xung đột)

| | Ai gọi | Giao thức | Đối tượng | Bật/tắt bởi |
|---|---|---|---|---|
| **Luồng 1 — mặc định** | harness (`:3102`) | OpenAI chat/completions | `POST /v1/chat/completions` của router | luôn chạy |
| **Luồng 2 — chỉ khi người dùng gõ `/claude-code`** | Claude Code CLI **trong box** | Anthropic Messages | `POST /v1/messages` của router | lệnh `/claude-code` |

Luồng 1 không đổi: UI → harness → router → nhà cung cấp (antigravity/openrouter/…).

Luồng 2 thêm một *client khác* cho cùng router: CLI trong box. Sản phẩm không tự
gọi luồng này; nó chỉ chạy khi người dùng gõ `/claude-code <việc>`, và khi đó
`runtime_commands.py` mới pre-flight CLI rồi mở một child session `executor='claude-code'`.

Vì sao cần: CLI không có tài khoản Anthropic để đăng nhập, nên nó phải lấy model
từ router. Cách làm giống 9router: trỏ `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
về một endpoint nói được giao thức Anthropic — **không cần binary bọc ngoài**.

---

## 2. Trong image có gì (và vì sao)

Lớp 4.8 của `deploy/docker/Dockerfile`, ghim phiên bản bằng ARG:

| Thành phần | Phiên bản | Vì sao nằm trong image |
|---|---|---|
| `bubblewrap` (`/usr/bin/bwrap`) | gói Ubuntu 24.04 (0.9.0) | `claude_worker.py` bọc các role CHỈ ĐỌC (`explore/plan/design/review/research`) trong `bwrap --ro-bind / /`; thiếu nó thì probe báo `readOnlyIsolation: false` và các role đó từ chối chạy |
| Node.js (`/opt/node`, có trong `PATH`) | `ARG NODE_VERSION=24.21.0` (LTS Krypton, tarball chính thức + kiểm SHA256) | `@anthropic-ai/claude-code` khai `engines.node >= 22`; nodejs 18 của Ubuntu không đủ |
| `@anthropic-ai/claude-code` (`/opt/node/bin/claude`, symlink `/usr/local/bin/claude`) | `ARG CLAUDE_CODE_VERSION=2.1.278` | chính CLI mà lệnh `/claude-code` gọi. Bản npm kèm binary native linux-x64/arm64 (postinstall chép từ optionalDependencies) nên lúc chạy không có tiến trình Node thường trú. Build sẽ ĐỎ nếu `claude --version` không chạy được |

Chi phí: khoảng **+240 MB** image (binary native).

> Ngoại lệ có chủ ý với triết lý "MÁY TRỐNG": Node vẫn KHÔNG phải stack mặc định
> cho dự án của người dùng — nó ở đây chỉ vì một lệnh của sản phẩm cần nó, và box
> mặc định không ra mạng để agent tự cài. Xem ghi chú đầu `Dockerfile`.

---

## 3. Biến môi trường — hợp đồng harness → box

Harness (host) đọc **tên có tiền tố BoxFox**; worker trong box đổi tên thành biến
CLI hiểu. Biến `ANTHROPIC_*` thô **không bao giờ** nằm trong môi trường container.

| Biến harness (đặt khi khởi động `:3102`) | Biến CLI tương ứng | Bắt buộc |
|---|---|---|
| `BOXFOX_ANTHROPIC_BASE_URL` | `ANTHROPIC_BASE_URL` | ✅ (cùng token) |
| `BOXFOX_ANTHROPIC_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` | ✅ (cùng base URL) |
| `BOXFOX_ANTHROPIC_MODEL` | `ANTHROPIC_MODEL` | — |
| `BOXFOX_ANTHROPIC_DEFAULT_OPUS_MODEL` | `ANTHROPIC_DEFAULT_OPUS_MODEL` | — |
| `BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL` | `ANTHROPIC_DEFAULT_SONNET_MODEL` | — |
| `BOXFOX_ANTHROPIC_DEFAULT_HAIKU_MODEL` | `ANTHROPIC_DEFAULT_HAIKU_MODEL` | — |

Ví dụ (chạy trên host, trước khi start harness):

```bash
export BOXFOX_ANTHROPIC_BASE_URL="http://172.18.0.1:3101"      # KHÔNG thêm /v1
export BOXFOX_ANTHROPIC_AUTH_TOKEN="bf_..."                     # khoá BoxFox của router
export BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL="<connectionId>/gemini-3.6-flash-high"
export BOXFOX_ANTHROPIC_DEFAULT_HAIKU_MODEL="<connectionId>/gemini-3.6-flash-high"
exec .venv/bin/python scripts/run-harness.py
```

Trên Windows (PowerShell) — `scripts/start.ps1` không đọc file `.env` nào, nó chỉ
kế thừa môi trường của shell đang gọi, nên đặt biến trước khi chạy:

```powershell
$env:BOXFOX_ANTHROPIC_BASE_URL   = "http://172.18.0.1:3101"
$env:BOXFOX_ANTHROPIC_AUTH_TOKEN = "bf_..."
$env:BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL = "<connectionId>/gemini-3.6-flash-high"
.\scripts\start.ps1
```

Tạo khoá BoxFox (router, admin header như mọi route `/api/router/*`):

```bash
curl -s -X POST http://127.0.0.1:3101/api/router/keys \
  -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' \
  -H 'content-type: application/json' -d '{"name":"box-claude-code"}'
```

Cơ chế, từng bước:

1. `ClaudeExecutor` đọc 6 biến trên từ môi trường harness và thêm `-e NAME=value`
   cho mỗi biến **đã đặt và khác rỗng** vào dòng `docker exec`. Không đặt gì ⇒
   không có cờ `-e` nào (hành vi y như trước).
2. `claude_worker.py` trong box đổi tên thành `ANTHROPIC_*`, ghi/cập nhật
   `~/.claude/settings.json` (**idempotent**, giữ nguyên khoá lạ của người dùng,
   `hasCompletedOnboarding: true` + khối `env`), và đặt các biến đó vào **môi
   trường tiến trình CLI**.
3. Token **không bao giờ** được gửi ra harness: readiness chỉ báo `baseUrl` và
   `settingsFile`; mọi thông báo lỗi đi qua `mask()`.

Hai chi tiết đã kiểm bằng chính binary `claude` 2.1.278 (đừng "sửa lại cho khớp
trực giác"):

- CLI **tự ghép** `/v1/messages` vào base URL (chuỗi trong binary:
  `` `${d.baseUrl.replace(/\/$/,"")}/v1/messages` ``). Vì vậy base URL **không
  được** có `/v1` ở cuối; nếu bạn dán quy ước `…/v1` (cách 9router ghi vào
  settings.json), worker **bỏ** `/v1` dư thừa và báo lại URL hiệu lực trong
  `baseUrl` của readiness.
- argv của worker có `--setting-sources ''` (tắt nguồn `userSettings`), nên khi
  chạy qua `/claude-code` thì `~/.claude/settings.json` **không** được CLI đọc —
  đó là lý do biến `ANTHROPIC_*` phải được đặt thẳng vào môi trường tiến trình
  CLI. File settings vẫn được ghi để người dùng (hoặc agent) tự mở terminal
  trong box và chạy `claude` bằng tay vẫn có cấu hình.

**Lưu ý bảo mật:** token đi qua `docker exec -e`, tức trong thời gian chạy nó
xuất hiện trong argv của tiến trình `docker exec` trên host (`ps`) và trong môi
trường của tiến trình CLI trong box. Hãy dùng một khoá BoxFox **riêng cho box**
để có thể thu hồi bất cứ lúc nào; token không được ghi vào log, không nằm trong
event nào gửi lên UI.

---

## 4. Readiness — hai đường, một payload

Endpoint (UI dùng chính nó; `SkillsView` in nguyên JSON):

```bash
curl -s http://127.0.0.1:3102/api/agent/executors/claude-code \
  -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' | python3 -m json.tool
```

Payload luôn có các khoá cũ (`executor, status, binary, authenticated, version,
readOnlyIsolation, skillMount, structuredOutput, reason`) và **thêm** ba khoá mới:
`auth`, `baseUrl`, `settingsFile` (không đổi khoá nào đã có).

| `auth` | Điều kiện | `status` |
|---|---|---|
| `'router'` | `claude` + `structuredOutput` + `skillMount` + **base URL và token** đã cấu hình + **router trả lời TCP từ trong box** | `ready` |
| `'router'` | như trên nhưng router KHÔNG trả lời từ trong box | `setup_required` (lý do nói rõ phải mở cầu nối) |
| `'account'` | `claude auth status` → `loggedIn: true` + `structuredOutput` + `skillMount` | `ready` |
| `null` | chưa đăng nhập và chưa cấu hình router | `setup_required` |

Chuỗi lý do (giữ nguyên văn bản cũ khi thiếu CLI/thiếu đăng nhập):

| Tình huống | `reason` |
|---|---|
| Không có `claude` | `Install Claude Code inside the sandbox, then sign in there.` |
| Có CLI, thiếu đăng nhập, chưa có router | `Check sandbox login, CLI version and read-only skill mount.` |
| Có base URL + token nhưng box không tới được router | `BoxFox router is not reachable from inside the sandbox: open the LLM bridge (BOX_LLM_BRIDGE=on + BOX_LLM_BRIDGE_HOST=<docker gateway>) and bind the router on that address (BOXFOX_ROUTER_BRIDGE_HOST).` |
| Role chỉ đọc mà `bwrap` không chạy được | `setup_required: read-only roles require working bubblewrap isolation` |

Chưa cấu hình biến nào ⇒ **không ghi file nào**, không cờ `-e`, không đổi hành vi.

---

## 5. Cầu nối mạng (reachability) — opt-in, mặc định TẮT

Box khởi động với `iptables -P OUTPUT DROP` và chỉ accept loopback + 4 cổng dịch
vụ (5900/6080/8080/8081). Router lại bind `127.0.0.1:3101`. Kết quả: CLI trong box
**không có đường** tới router, và `curl` từ trong box trả về exit 000.

### 5.1 Phía box (đã làm trong repo này)

```bash
# deploy/docker/.env  (chỉ tạo khi muốn bật)
BOX_LLM_BRIDGE=on
BOX_LLM_BRIDGE_HOST=172.18.0.1   # bỏ trống ⇒ tự lấy gateway mặc định của container
BOX_LLM_BRIDGE_PORT=3101
```

Khi đó `box-firewall off` (thế mặc định lúc boot) sinh thêm **đúng một** luật,
đứng TRƯỚC luật `REJECT`:

```
-A OUTPUT -d 172.18.0.1 -p tcp --dport 3101 -j ACCEPT
```

- Luật do `box-firewall-rules.py` sinh (hàm thuần, có test riêng). Cấu hình sai
  (thiếu gateway, host không phải IPv4, cổng ngoài 1–65535, giá trị lạ) ⇒ luật
  cầu nối **bị bỏ**, giữ nguyên thế phòng thủ, và một dòng cảnh báo vào log
  container. Script `box-firewall` còn có đường dự phòng fail-closed nếu thiếu bộ
  sinh luật (thà giữ luật cũ còn hơn để OUTPUT không có luật nào = Docker mặc
  định ACCEPT).
- Nút Mạng trên UI (`/__box/network on|off`) chạy lại chính script này nên cầu nối
  tự quay lại khi người dùng tắt mạng; bật mạng = mở toàn phần (thế cũ).

Kiểm bên trong box:

```bash
docker logs agentbox-box 2>&1 | grep -i box-firewall     # có dòng "cầu nối LLM: accept egress tới …"
docker exec --user root agentbox-box iptables -S OUTPUT
docker exec --user agent agentbox-box bash -lc 'timeout 3 bash -c "</dev/tcp/172.18.0.1/3101" && echo REACHABLE'
```

### 5.2 Phía router (CÒN THIẾU — thuộc `router/src/**`, không nằm trong thay đổi này)

Router hiện `server.listen(port, '127.0.0.1')` (`router/src/main.mjs`) và
`allowedHosts` chỉ chấp nhận `localhost:3101`/`127.0.0.1:3101`
(`router/src/server.mjs`). Muốn box tới được thì phải:

1. **Thêm listener trên gateway của bridge** (ví dụ env `BOXFOX_ROUTER_BRIDGE_HOST=172.18.0.1`,
   cùng cổng 3101) — đây là địa chỉ mà container nhìn thấy của máy host. Chỉ bind
   đúng địa chỉ bridge, KHÔNG bind `0.0.0.0`, nếu không router sẽ lộ ra LAN.
2. **Thêm host đó vào `allowedHosts`** (`172.18.0.1:3101`), vì mọi request của box
   mang header `Host: 172.18.0.1:3101` và router trả 403 `Host not allowed.` nếu thiếu.

Lấy gateway một cách chắc chắn:

```bash
docker network inspect boxnet --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'
```

### 5.3 Rủi ro của việc bật cầu nối

- Luật này mở egress TCP tới **cổng router trên máy host** cho **mọi** tiến trình
  trong box, không riêng Claude Code. Box vẫn KHÔNG ra internet, nhưng đây là một
  đường ra khỏi box — chỉ bật khi bạn thật sự dùng `/claude-code`.
- Router đứng sau đường đó là bề mặt HTTP của chính sản phẩm: request vào
  `/v1/messages` vẫn phải qua kiểm khoá BoxFox (`x-api-key` hoặc `Authorization:
  Bearer bf_…`) như luồng 1.
- Mặc định (`BOX_LLM_BRIDGE` không đặt / `off`) giữ nguyên thế phòng thủ cũ.

---

## 6. Build và kiểm bằng container dùng-một-lần

```bash
cd deploy/docker

# 1) build lại image (không đụng tới container đang chạy)
docker compose build

# 2) kiểm nội dung image bằng container dùng một lần (KHÔNG phải container thật)
docker run --rm --entrypoint bash agentbox-sandbox:latest -lc \
  'node --version; claude --version; bwrap --version'
#   v24.21.0
#   2.1.278 (Claude Code)
#   bubblewrap 0.9.0

# 3) kiểm luật egress sinh ra (không cần root, không cần iptables)
python3 box-firewall-rules.py off
BOX_LLM_BRIDGE=on BOX_LLM_BRIDGE_HOST=172.18.0.1 BOX_LLM_BRIDGE_PORT=3101 python3 box-firewall-rules.py off

# 4) test tự động của lớp deploy
python3 -m unittest discover -s tests -p "test_*.py"
```

Trạng thái sau bước 1–2 là "image đã sẵn sàng". Container thật vẫn chạy image cũ
cho tới khi nó được **tạo lại** (`docker compose up -d --force-recreate box`) —
lệnh đó làm gián đoạn phiên desktop đang mở, nên chỉ chạy khi người dùng đồng ý.

Kiểm cả script áp luật (`box-firewall`) trong container dùng-một-lần — cần
`NET_ADMIN` như container thật, nhưng KHÔNG đụng tới `agentbox-box`:

```bash
docker run --rm --cap-add NET_ADMIN --entrypoint bash agentbox-sandbox:latest -lc \
  'BOX_LLM_BRIDGE=on BOX_LLM_BRIDGE_HOST=172.18.0.1 box-firewall off; iptables -S OUTPUT; cat /run/box-net-state'
# phải thấy luật "-A OUTPUT -d 172.18.0.1/32 -p tcp -m tcp --dport 3101 -j ACCEPT"
# nằm trước "-A OUTPUT -j REJECT", và "off"
```

Bộ test thật của đường này (không Docker, dùng CLI giả + HOME tạm):

```bash
.venv/bin/python -m pytest backend/tests/unit/test_claude_worker_router.py backend/tests/unit/test_claude_executor.py -q
```

---

## 7. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách kiểm |
|---|---|---|
| HTTP 400 `SETUP_REQUIRED: Install Claude Code inside the sandbox…` | container vẫn chạy image CŨ (chưa recreate) | `docker exec --user agent agentbox-box bash -lc 'command -v claude'` |
| HTTP 400 `SETUP_REQUIRED: BoxFox router is not reachable from inside the sandbox…` | `BOX_LLM_BRIDGE` còn `off`, hoặc router chưa bind địa chỉ bridge | `docker exec --user root agentbox-box iptables -S OUTPUT` + mục 5.2 |
| CLI chạy nhưng 404 trên `/v1/v1/messages` | base URL có `/v1` ở cuối ở một bản worker cũ | readiness trả `baseUrl` — phải KHÔNG có `/v1` |
| 401 `Valid BoxFox API key required.` | token sai/hết hiệu lực, hoặc khoá bị tắt | tạo khoá mới ở mục 3 rồi đặt lại `BOXFOX_ANTHROPIC_AUTH_TOKEN`, khởi động lại harness |
| 403 `Host not allowed.` | router chưa thêm `172.18.0.1:3101` vào `allowedHosts` | mục 5.2 |
| `setup_required: read-only roles require working bubblewrap isolation` | container cũ (chưa có bwrap), hoặc seccomp/user-namespace chặn bwrap | `docker run --rm --entrypoint bash agentbox-sandbox:latest -lc 'bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp -- echo ok'` |
| `/claude-code` trả `CHILD_FAILED` | child chạy được nhưng CLI thoát khác 0 | mở child session trong tab Sub-agents; event `executor`/`error` có mã lỗi thật |

---

## 8. Việc còn nợ sau tài liệu này

1. **Container thật chưa được tạo lại** — nó vẫn chạy image trước lớp 4.8, nên
   `/claude-code` chưa thể chạy end-to-end cho tới khi recreate (gián đoạn desktop).
2. **Router chưa bind địa chỉ bridge** (mục 5.2) — cầu nối ở phía box đã sẵn sàng
   nhưng chưa có gì lắng nghe ở đầu kia.
3. Giao thức Anthropic đầy đủ (tools/tool_use/count_tokens) thuộc luồng ingress
   của router — xem `router/CONTRACT.md`.

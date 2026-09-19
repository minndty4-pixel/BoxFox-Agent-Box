# Skill loading và slash commands cho BoxFox

## 1. Kết quả đối chiếu và phạm vi

Hermes dùng ba bước: đưa tên/mô tả vào catalog → nạp đầy đủ `SKILL.md` khi chọn → đọc thêm tài liệu/script liên quan khi cần. Slash command kích hoạt skill trực tiếp; câu thường để model chọn dựa trên ý định và mô tả skill.

Hermes còn có kiểm tra môi trường, lọc skill bị tắt, chống trùng tên/lệnh, tránh nạp lại nội dung không đổi và xóa trạng thái “đã nạp” sau context compression. Cơ chế này không tự bảo đảm hai workflow như Claude Code và Codex không xung đột; BoxFox cần bổ sung chính sách riêng.

BoxFox hiện có các khoảng thiếu đã xác nhận:

- [Skill catalog](D:/create/BoxFox-Agent-Box/backend/src/agentbox/skills/catalog.py) đọc package đầy đủ, nhưng readiness mới là nhãn chung; chưa có kiểm tra dependency thực tế.
- [Harness runtime](D:/create/BoxFox-Agent-Box/backend/src/agentbox/agent_core/runtime.py) truyền toàn bộ skill của cha cho con, chưa áp dụng `Role.skills`.
- Có registry hướng dẫn rút gọn song song với catalog nguồn đầy đủ.
- Bảng phím tắt quảng bá slash commands nhưng đường gửi chat chưa có dispatcher tương ứng.
- Đường dẫn skill trả về thuộc host, còn terminal chạy trong Docker.
- Toggle Settings lưu ở trình duyệt và áp dụng lúc tạo session; chưa phải cấu hình thống nhất phía backend.

Đợt này tích hợp **Claude Code CLI thật**, tự chọn skill theo ý định và tạo lệnh custom trong Settings. Codex/OpenCode giữ nguyên trong danh mục; chưa bổ sung adapter thực thi. Giữ bố cục thanh chat hiện tại.

## 2. Cơ chế skill phù hợp với sub-agent

- Dùng một catalog chuẩn cho runtime, Settings và slash commands. Giữ ID hiện tại qua bảng ánh xạ khi chuẩn hóa; registry rút gọn cũ chuyển sang đọc cùng nguồn, không chèn thêm bản hướng dẫn trùng.
- Phân biệt rõ **được bật**, **sẵn sàng sử dụng**, **đã nạp trong context**. Bật skill không đồng nghĩa nạp toàn bộ nội dung hay đã có CLI/credential.
- Đọc metadata Hermes về mô tả, platform, dependency và skill liên quan. `related_skills` chỉ là gợi ý, không tự nạp tất cả.
- Backend lưu cấu hình bật/tắt; nhập cấu hình localStorage một lần khi chưa có cấu hình backend. Thay đổi áp dụng từ lượt kế tiếp; lượt đang chạy dùng snapshot đã nhận.
- Catalog tổng thể chỉ chứa metadata. Sub-agent nhận skill được bật và phù hợp vai trò; ưu tiên mapping sẵn có cho Explore, Debug, Review, Simplify, Testing, Research. Plan/Design chỉ nhận workflow phù hợp quyền của mình.
- Thêm bước resolve trước thực thi: slash chọn chính xác; câu thường được phân loại ý định rồi kiểm tra lại bằng policy. “Dùng Claude Code sửa lỗi” kích hoạt; “Claude Code khác Codex thế nào?” không chạy CLI.
- Mỗi lượt công việc chỉ chọn một executor CLI. Yêu cầu chọn đồng thời Claude Code/Codex/OpenCode phải được làm rõ trước khi chạy; không âm thầm chọn một hoặc tự chuyển sang model khác.
- Skill workflow có thể kết hợp nếu tương thích. Quyền tool và vai trò vẫn do backend kiểm soát; nội dung skill không nâng quyền sub-agent.
- Theo dõi nội dung đã nạp theo session con, lượt, hash và thế hệ context. Đọc trùng trả tham chiếu chỉ khi nội dung đầy đủ còn trong context; sau compression phải nạp lại skill đang cần. Skill lượt trước không tự giữ hiệu lực ở lượt sau.
- Mount package đã chọn vào sandbox ở đường dẫn chỉ đọc; tài liệu/script dùng đường dẫn sandbox thực tế. Không tự thực thi inline shell khi đọc Markdown. Skill quá lớn phải báo vượt ngân sách, không cắt ngầm.
- Ghi sự kiện chọn/nạp/bỏ qua skill và lý do để UI và benchmark có bằng chứng kiểm tra.

## 3. Slash commands và Claude Code

Backend giữ registry lệnh duy nhất; autocomplete và bảng hướng dẫn đọc từ registry đó.

| Lệnh | Hành vi |
|---|---|
| `/help`, `/skills` | Xem lệnh khả dụng, skill, trạng thái và lý do chưa dùng được |
| `/skill <id> <yêu cầu>` | Gọi skill theo ID chính xác |
| `/<skill-slug> <yêu cầu>` | Alias cho skill đã bật, đã kiểm tra tương thích và không trùng tên |
| `/claude-code <yêu cầu>` | Gọi Claude Code CLI qua adapter |
| `/claude-design <yêu cầu>` | Workflow thiết kế; Design lập đặc tả, Build tạo artifact, Testing kiểm chứng |
| `/plan`, `/explore`, `/design`, `/build`, `/debug`, `/review`, `/simplify`, `/test`, `/research` | Giao lượt công việc cho vai trò tương ứng trong harness hiện tại |
| `/agents`, `/status`, `/context` | Xem agent, executor, skill đã nạp, trạng thái và ước lượng context |
| `/compact` | Nén context khi session rảnh, giữ checkpoint và tái nạp skill cần thiết |
| `/stop` | Dừng lượt hiện tại và các child/process thuộc lượt đó |

Quy tắc thực thi:

- `/plan` chỉ tạo kế hoạch, không tự chuyển sang Build. Vai trò bị tắt trả trạng thái rõ ràng.
- Dùng `/plan` chuẩn; không thêm cú pháp riêng `/.plan`.
- Built-in giữ tên ưu tiên. Skill trùng tên vẫn gọi qua `/skill <id>`; custom command không được ghi đè tên hoặc alias hiện có.
- Chỉ parse lệnh ở đầu tin nhắn do user gửi; code block, trích dẫn, đường dẫn và tool output không được biến thành lệnh.
- Lệnh không nhận diện trả gợi ý, không bị gửi xuống model như thể đã thực thi. V1 mỗi tin nhắn một lệnh; kết hợp nhiều skill bằng custom command.
- Khi đang chạy, cho phép lệnh xem trạng thái và `/stop`; lệnh tạo công việc/nén context báo bận, không tự queue.
- Tạm bỏ các mục chưa có implementation thật như `/goal`, `/btw`, `/learn`, `/clear` khỏi bảng lệnh. Hoãn loop, heartbeat, rollback, skill tự sửa và bundle lồng nhau.

**Claude Code adapter**

- Tách vai trò chuyên môn khỏi executor: `native` hoặc `claude-code`. `/claude-code` mặc định tạo child Build; custom command có thể chọn vai trò khác.
- Kiểm tra binary, phiên bản, auth và workspace trong sandbox. Thiếu điều kiện trả `setup_required`; không tự cài hoặc sao chép credential host.
- Dùng chế độ non-interactive có output cấu trúc; xác minh flags bằng CLI thực tế khi triển khai. Prompt truyền qua stdin/argv, không nối vào shell command.
- Quản lý process theo child session: stream sự kiện, deadline, Stop, exit code, lỗi và artifact. Stop phải chấm dứt process bên container.
- Vai trò đọc dùng môi trường không được ghi workspace; quyền CLI không vượt quyền child. Writer lock hiện tại bao phủ cả tác vụ CLI ghi code.
- Claude Code dùng cấu hình/auth riêng của CLI; model BoxFox không tự biến thành model CLI. UI ghi rõ executor thực tế.
- Chuẩn bị contract cho cửa sổ CLI con sau này; đợt này hiển thị trong sub-agent inspector hiện có.
- Codex/OpenCode vẫn xem được trong Settings nhưng chưa quảng bá là lệnh thực thi sẵn sàng; yêu cầu sử dụng phải báo adapter chưa hỗ trợ.

**Custom commands và interface**

- Thêm Settings → Skills → Commands: tạo, sửa, bật/tắt, xóa và xem trước cách resolve.
- Một lệnh gồm slug, mô tả, prompt template, danh sách skill, vai trò và executor. Template chỉ thay `$ARGUMENTS` bằng văn bản; không chạy shell hoặc mở rộng thành lệnh khác.
- Backend lưu SQLite với revision. Kiểm tra skill tồn tại, xung đột executor, quyền vai trò và trùng tên trước khi lưu.
- Bổ sung API catalog/resolve/CRUD cho commands; đường gửi turn hiện có gọi chung resolver. Preview chỉ resolve, không chạy CLI hay gọi model.
- Lưu invocation ID, revision lệnh, skill/hash và executor trong event. Retry kỹ thuật cùng invocation không được tạo thêm child; retry chủ động tạo invocation mới.

## 4. Benchmark và nghiệm thu

Tạo bộ fixture versioned, chạy trên database và sandbox riêng; không dùng session đang làm việc của agent coding khác.

**Benchmark xác định, không phụ thuộc LLM**

- 80 ca cho parser, alias, trùng tên, custom CRUD/revision, skill disabled, role disabled, template và tin nhắn chứa code/path.
- 30 ca lifecycle: nạp đúng file đầy đủ, đọc reference, hash đổi, dedup, compression, restart, session đồng thời và không truyền skill sai sang child.
- 20 ca adapter bằng CLI simulator: thiếu binary/auth, stream chia chunk, lỗi, timeout, Stop, process cleanup, chống chạy lặp và giới hạn quyền.
- Yêu cầu toàn bộ ca xác định pass.

**Benchmark chọn skill theo ngôn ngữ**

- 60 prompt Việt/Anh, mỗi prompt chạy ba lần trên một model cố định.
- Bao gồm yêu cầu rõ ràng, phủ định, so sánh công cụ, đổi executor giữa lượt, nhiều skill tương thích và executor xung đột.
- Chấm bằng event resolve, skill thực sự đã nạp và executor được gọi; không chỉ chấm câu trả lời.
- Mục tiêu: chọn đúng intent/skill ≥95%; không chạy CLI ở ca chỉ hỏi/so sánh; không chạy sai executor, skill bị tắt hoặc vượt quyền.
- Báo số lần model gọi thêm, token metadata/nội dung skill và latency p50/p95, tách khỏi thời gian inference.

**Browser và CLI thật**

- Tạo custom `/fix-with-claude`, reload, sửa, disable, kiểm tra autocomplete và lỗi trùng tên.
- Test bàn phím, IME tiếng Việt, mobile 390 px; bảo toàn các điều khiển thanh chat.
- Dùng Claude Code trong repo thử nghiệm: đọc cấu trúc, sửa lỗi nhỏ có test, review chỉ đọc, Stop tác vụ và kiểm tra session sau restart.
- Kiểm tra `/claude-design` chuyển Design → Build → Testing với artifact thực tế.
- Nếu CLI chưa cài/đăng nhập, ghi `blocked`; simulator pass không được tính là live pass.
- Báo cáo gắn commit, diff, model và phiên bản CLI dùng kiểm thử. Đồng bộ lại phần agent coding khác đã sửa trước khi áp dụng patch; giữ manifest nguồn Hermes và license cho module adapt.

Hoàn thành khi lệnh và skill được resolve nhất quán ở UI/backend, sub-agent nhận đúng hướng dẫn và quyền, custom commands tồn tại qua restart, benchmark đạt ngưỡng, và Claude Code có ít nhất một tác vụ live tạo kết quả được kiểm chứng.

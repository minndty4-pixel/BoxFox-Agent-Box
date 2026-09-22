# Runbook — nạp header `.plans` và xoá kế hoạch thử (đợt 22, phần C / chốt D-2)

> Việc C3 của kế hoạch `v1-foundation`: `migrate_plans.py` được stage vào image
> (`/usr/local/bin/migrate_plans.py`) và từ đây `--apply` **luôn sao lưu trước khi ghi**.
> Luật tên thư mục sao lưu: `docs/naming.md` §7 (BOX-5); mặt workspace: `docs/architecture/workspace-files.md`
> § *Sao lưu `.plans`*.

## Khi nào dùng

- Có tệp `.plans/vN-*.md` **chưa có khối** `<!-- boxfox-plan … -->` (plan cũ, hoặc plan do harness ghi
  trước vòng 20) → header là thứ nói ra phiên bản THẬT của một nhóm, để người đọc và UI không phải suy
  từ bộ đếm chung.
- Có hai nhóm thật ra là **một chủ đề** (hai slug khác nhau) → `--merge <nguồn>=<đích>`.
- Có một **kế hoạch thử** cần dọn → `--delete-orphan vN-slug.md` (đường xoá duy nhất, có cổng `P:`).

## Bốn bước (đúng thứ tự)

```bash
# 1. Sao lưu DB harness TRƯỚC (máy này không có CLI `sqlite3`; dùng module của Python).
python3 -c "import sqlite3,os;src=sqlite3.connect(os.path.expanduser('~/BoxFox/harness/sessions.sqlite'));dst=sqlite3.connect('/var/tmp/sessions-backup.sqlite');src.backup(dst);dst.close();print('backup ok')"

# 2. Xem trước TRONG BOX (không ghi byte nào): đọc JSON, xem `headers`/`merges`/`delete`.
docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py

# 3. Ghi thật. Việc này TỰ sao lưu mọi tệp vN-*.md vào
#    /home/agent/workspace/.plans-backups/<UTC>/ (kèm manifest.json có sha256 từng tệp).
docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py --apply

# 4. Chạy lại dry-run: phải ra "nothingToDo": true (và không tạo thêm thư mục sao lưu nào).
docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py
```

Trên **bản sao** (cách an toàn để thử cơ chế mà không đụng `.plans` sống):

```bash
docker exec agentbox-box sh -lc 'rm -rf /var/tmp/plans-copy && cp -a /home/agent/workspace/.plans /var/tmp/plans-copy'
docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py --root /var/tmp/plans-copy
docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py --root /var/tmp/plans-copy --apply
docker exec agentbox-box sh -lc 'ls -l /var/tmp/plans-backups/*/ && python3 -c "import json,glob;print(json.load(open(glob.glob(\"/var/tmp/plans-backups/*/manifest.json\")[0]))[\"wrote\"])"'
```

Bản sao mặc định nằm **cạnh** gốc `.plans` (`<gốc>/../.plans-backups/<UTC>/`), nên bản sao của một bản
sao dưới `/var/tmp/plans-copy` là `/var/tmp/.plans-backups/<UTC>/`. `--backup-dir DIR` đổi **chỗ** chứ
không đổi **luật**: bản sao vẫn vào `DIR/<UTC>/` (đó là lý do dòng `ls` ở trên có `*/`); **không** có
cờ tắt sao lưu.

## Nếu tệp chưa staged (image chưa build lại)

```bash
docker cp deploy/docker/migrate_plans.py agentbox-box:/usr/local/bin/migrate_plans.py
docker cp deploy/docker/plan_files.py    agentbox-box:/usr/local/bin/plan_files.py   # script nhập lại tệp này
```

Đường chính thức là **build lại box** (`cd deploy/docker && docker compose build`, xem `docs/setup`), vì
`COPY migrate_plans.py /usr/local/bin/migrate_plans.py` đã có trong Dockerfile (lớp 5).

## Cổng `P:` — vì sao có thể bị TỪ CHỐI (exit 2)

`--delete-orphan` chỉ xoá khi **không** bản ghi `P:` nào trong `.session-history` giữ tệp đó. Bản ghi
`P:` là dấu "kế hoạch này đã có thật trong nhật ký phiên":

```json
{"kind":"plan","id":"P:boxfox-5-upgrades@v1","session":"67bdfd4b…","status":"draft",
 "data":{"identity":"boxfox-5-upgrades","version":1,"relativePath":".plans/v1-boxfox-5-upgrades.md"}}
```

Khớp theo `data.relativePath` **hoặc** `data.identity` (đường dẫn đổi được, identity thì không), và nhật
ký **không đọc được** cũng tính là người giữ — luật là "thấy bản ghi thì từ chối", không phải "chỉ khi
chắc chắn". Kế hoạch đang có điểm trong nhật ký thì không còn là kế hoạch thử: xoá tay nếu bạn thật sự
muốn, rồi ghim lại nhật ký.

Phép kiểm thứ hai (bản chuẩn nằm ở DB harness, chạy tay trên máy chủ nhà):

```bash
python3 -c "import sqlite3,os;p=os.path.expanduser('~/BoxFox/harness/sessions.sqlite');c=sqlite3.connect('file:'+p+'?mode=ro',uri=True);print(c.execute(\"select count(*) from journal where kind='plan'\").fetchall())"
```

## Khôi phục từ bản sao

```bash
# Đọc manifest trước: biết lần chạy đó định làm gì (`reason`) và từng tệp có sha256 nào.
ls -l /home/agent/workspace/.plans-backups/*/
python3 -c "import json,glob;print(json.load(open(sorted(glob.glob('/home/agent/workspace/.plans-backups/*/manifest.json'))[-1])))"
# Đưa cả cây về đúng chỗ (bản sao giữ đúng cây con của .plans):
cp -a /home/agent/workspace/.plans-backups/<UTC>/. /home/agent/workspace/.plans/
```

`.plans-backups` **không** nằm trong `PROTECTED_PATHS` — đây là rác đọc được: `rm -rf` thư mục `<UTC>`
khi không cần nữa.

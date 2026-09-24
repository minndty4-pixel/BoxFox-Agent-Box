"""C-2 (vòng 27, đợt 4) — op `dossier_write`: một lời gọi ghi TRỌN một hồ sơ nghiên cứu.

Sự việc đo được (vòng 21–27): research trả về câu trả lời bị cắt ở trần 8 000 ký tự, nên một hồ sơ
34 000 ký tự không có chỗ ở nào THẬT — muốn kiểm lại thì phải đi tìm ở nơi khác. Chỗ đúng là tệp
trong workspace: `.research/<việc>/` giữ hồ sơ + sổ nguồn + bảng + biên bản phản biện, và người dùng
mở lại được từng tệp.

Bài này chạy ĐÚNG cửa vào của worker (`worker.execute('dossier_write', …)`, thứ harness gửi nội
tuyến vào box mỗi lượt) trên một thư mục tạm — máy chủ nhà không có `/home/agent/workspace` — và
khoá những luật dễ vỡ nhất:

- ghi đủ bộ tệp, ĐÚNG THỨ TỰ, và không đụng gì ngoài `.research/`;
- `sources.jsonl` là một đối tượng JSON mỗi dòng, giữ nguyên khoá; hàng thiếu khoá KHÔNG làm nổ;
- trần 256 KiB cho TỪNG tệp, kiểm HẾT trước khi ghi BẤT KỲ tệp nào (từ chối trước, ghi sau);
- tệp hồ sơ đã có số version ⇒ từ chối và KHÔNG ghi gì (kể cả `sources.jsonl`) khi chưa cho ghi đè;
- `overwrite=True` ⇒ thay nội dung, `sha1` đổi; bản `v2` ghi lại sổ nguồn nhưng không đụng bản `v1`;
- đường dẫn phải khớp `.research/<việc>/<tên>.md`; thoát workspace ⇒ câu lỗi cũ của `path()`;
- ghi qua tên tạm rồi thay thế, nên chết giữa lúc ghi cũng không để lại tệp dở dang;
- hồ sơ 34 000+ ký tự nằm trọn trong tệp và `file_read` đọc lại được nguyên vẹn.
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path

import pytest

import agentbox.sandbox.worker as worker

DOSSIER = '.research/thi-truong-chip/v1-thi-truong-chip.md'
DOSSIER_V2 = '.research/thi-truong-chip/v2-thi-truong-chip.md'
FOLDER = '.research/thi-truong-chip'
JSONL = FOLDER + '/sources.jsonl'
SOURCES_MD = FOLDER + '/sources.md'
HEADER = ('<!-- boxfox-research\nVersion: v1\nResearchId: thi-truong-chip\nProfile: quick\n'
          'Level: 2\nCritique: none\nGate: warn\nRows: 2\n-->\n\n')
BODY = HEADER + '# Thị trường chip Q3\n\nGiá wafer tăng 12% so với quý trước.\n'
TABLES = [{'name': 'gia-theo-quy',
           'markdown': '# Giá theo quý\n\n| Quý | Giá |\n| --- | --- |\n| Q3 | +12% |\n'},
          {'name': 'dung-luong',
           'markdown': '# Dung lượng\n\nNhà máy mới thêm 40k wafer/tháng.\n'}]
REVIEW = '# Phản biện\n\nKhông có lỗi chặn; một nguồn tier 3 chưa đối chiếu.\n'


def _box(tmp_path):
    """Trỏ `ROOT` của worker vào thư mục tạm — máy chủ nhà không có `/home/agent/workspace`."""
    worker.ROOT = Path(tmp_path).resolve()
    return worker.ROOT


def _rows():
    """Hai hàng sổ nguồn thật: khoá đúng như harness dựng từ thẻ nguồn."""
    return [
        {'tier': 2, 'host': 'example.com', 'claim': 'Giá wafer tăng 12%',
         'url': 'https://example.com/wafer', 'fetchedAt': '2026-09-20',
         'excerpt': 'Wafer prices rose 12% in Q3.'},
        {'tier': 1, 'host': 'wire.com', 'claim': 'Nhà máy mở rộng',
         'url': 'https://wire.com/fab', 'fetchedAt': '2026-09-21',
         'excerpt': 'The fab expands.'},
    ]


def _payload(**over):
    args = {'path': DOSSIER, 'markdown': BODY, 'rows': _rows(), 'title': 'Thị trường chip Q3'}
    args.update(over)
    return args


def _refused(args):
    """Lượt gọi bị từ chối: trả về ĐÚNG câu lỗi để bài kiểm đọc lý do, không nuốt mọi kiểu hỏng."""
    with pytest.raises(ValueError) as caught:
        worker.execute('dossier_write', args, 'session-1')
    return str(caught.value)


def _written(root):
    """Mọi tệp có thật trong workspace, đường dẫn posix tương đối — để thấy KHÔNG có gì khác."""
    return sorted(item.relative_to(root).as_posix() for item in root.rglob('*') if item.is_file())


def _text(root, relative):
    return (root / relative).read_text(encoding='utf-8')


def test_dossier_write_ghi_du_bo_tep_theo_dung_thu_tu(tmp_path):
    root = _box(tmp_path)
    result = worker.execute('dossier_write', _payload(tables=TABLES, review=REVIEW), 'session-1')

    assert result['content'] == 'Written ' + DOSSIER
    assert result['relativePath'] == DOSSIER and result['slug'] == 'thi-truong-chip'
    assert result['version'] == 1, 'số version đọc từ tiền tố `v<N>-` của tên tệp hồ sơ'
    assert result['bytes'] == len(BODY.encode('utf-8')), 'bytes là kích thước THẬT của tệp hồ sơ'
    # Hợp đồng chốt tên khoá là `sha1`, nhưng giá trị lấy từ chính hàm băm của mô-đun (`sha256_of`)
    # — cùng đơn vị với mảnh bằng chứng của mọi lần ghi khác, không có hai thước đo trong worker.
    assert result['sha1'] == hashlib.sha256(BODY.encode('utf-8')).hexdigest()
    datetime.strptime(result['writtenAt'], '%Y-%m-%dT%H:%M:%SZ')
    assert result['files'] == [DOSSIER, JSONL, SOURCES_MD, FOLDER + '/tables/gia-theo-quy.md',
                               FOLDER + '/tables/dung-luong.md', FOLDER + '/review.md']
    # `files` là thứ tự hợp đồng (hồ sơ trước, rồi sổ, bảng, biên bản), `_written` là thứ tự ổ đĩa.
    assert _written(root) == sorted(result['files']), 'ghi đúng bộ tệp, không rơi rớt tệp nào khác'
    assert _text(root, DOSSIER) == BODY, 'tệp hồ sơ giữ nguyên nội dung gửi vào, kể cả khối đầu'
    assert _text(root, FOLDER + '/tables/gia-theo-quy.md') == TABLES[0]['markdown']
    assert _text(root, FOLDER + '/review.md') == REVIEW


def test_sources_jsonl_mot_doi_tuong_moi_dong_va_giu_nguyen_khoa(tmp_path):
    root = _box(tmp_path)
    rows = _rows()
    worker.execute('dossier_write', _payload(rows=rows), 'session-1')

    raw = _text(root, JSONL)
    assert raw.endswith('\n'), 'dòng cuối phải có \\n'
    assert len(raw.splitlines()) == 2, 'một dòng cho mỗi hàng'
    assert [json.loads(line) for line in raw.splitlines()] == rows, 'JSONL là bản máy đọc của rows'
    assert json.loads(raw.splitlines()[0])['excerpt'] == 'Wafer prices rose 12% in Q3.'
    assert 'Wafer prices rose 12% in Q3.' in raw, 'ensure_ascii=False để tệp còn đọc được'


def test_sources_md_la_ban_nguoi_doc_co_tang_host_ngay_va_trich_nguyen_van(tmp_path):
    root = _box(tmp_path)
    worker.execute('dossier_write', _payload(), 'session-1')

    markdown = _text(root, SOURCES_MD)
    assert markdown.startswith('# Nguồn'), 'sổ nguồn bản người đọc phải mở bằng một tiêu đề'
    for needle in ('2', 'example.com', 'Giá wafer tăng 12%', 'https://example.com/wafer',
                   '2026-09-20', 'Wafer prices rose 12% in Q3.'):
        assert needle in markdown, 'thiếu %r trong sổ nguồn bản người đọc' % needle


def test_hang_thieu_khoa_khong_lam_no_lan_ghi(tmp_path):
    """Dữ liệu từ model: hàng thiếu khoá/kiểu lạ phải đi qua `.get` + mặc định, không ném."""
    root = _box(tmp_path)
    rows = [{}, {'excerpt': 'chỉ có trích dẫn'}, {'url': 'khong-phai-url', 'tier': 3}, None, 7]
    result = worker.execute('dossier_write', _payload(rows=rows), 'session-1')

    assert result['bytes'] == len(BODY.encode('utf-8'))
    lines = _text(root, JSONL).splitlines()
    # Mỗi dòng phải là MỘT ĐỐI TƯỢNG JSON: hàng `None` thành `{}`, hàng không phải dict thành
    # `{'claim': str(...)}` — không dòng nào là `null` để bên đọc vấp.
    assert [json.loads(line) for line in lines] == [{}, {'excerpt': 'chỉ có trích dẫn'},
                                                    {'url': 'khong-phai-url', 'tier': 3}, {},
                                                    {'claim': '7'}]
    markdown = _text(root, SOURCES_MD)
    assert '(không có khẳng định)' in markdown, 'hàng thiếu `claim` phải có chỗ trống đọc được'
    assert 'chỉ có trích dẫn' in markdown, 'trích dẫn còn thì phải hiện trong bản người đọc'
    assert 'khong-phai-url' in markdown, 'URL lạ vẫn phải nằm trong sổ, không bị nuốt'


def test_khong_co_nguon_van_ghi_du_hai_tep_so(tmp_path):
    """`rows` rỗng/thiếu: hồ sơ vẫn ghi được — tệp sổ rỗng còn hơn một lời gọi nổ giữa lượt."""
    root = _box(tmp_path)
    result = worker.execute('dossier_write', _payload(rows=[]), 'session-1')

    assert result['files'] == [DOSSIER, JSONL, SOURCES_MD]
    assert _text(root, JSONL) == '', 'không có nguồn ⇒ tệp JSONL rỗng, không phải tệp không tồn tại'
    assert '(chưa có nguồn nào)' in _text(root, SOURCES_MD)


def test_tables_va_review_chi_ghi_khi_duoc_cho(tmp_path):
    root = _box(tmp_path)
    result = worker.execute('dossier_write', _payload(), 'session-1')

    assert result['files'] == [DOSSIER, JSONL, SOURCES_MD]
    assert not (root / FOLDER / 'tables').exists(), 'không có bảng nào thì không dựng `tables/`'
    assert not (root / FOLDER / 'review.md').exists()
    assert _written(root) == sorted(result['files'])


@pytest.mark.parametrize('bad', ['.research/Thi-Truong/v1-x.md',
                                 '.research/thi-truong/v1-x.markdown',
                                 '.research/thi-truong.md', '.research/thi-truong/.md',
                                 '.plans/v1-x.md'])
def test_duong_dan_sai_khuon_thi_tu_choi(tmp_path, bad):
    root = _box(tmp_path)
    message = _refused(_payload(path=bad))

    assert message == 'DOSSIER_PATH_INVALID: .research/<việc>/<tên>.md', message
    assert _written(root) == [] and not (root / '.research').exists(), 'từ chối thì không tạo gì'


def test_tables_dang_rong_nhu_harness_gui_khong_giet_ca_lan_ghi(tmp_path):
    """ĐO ĐƯỢC: `research_runtime._dossier_op_args` LUÔN gửi `tables` dạng dict (rỗng khi model
    không gửi bảng), nên một `{}` không được biến cả lần ghi hồ sơ thành `DOSSIER_TABLE_INVALID`."""
    root = _box(tmp_path)
    result = worker.execute('dossier_write', _payload(tables={}), 'session-1')

    assert result['files'] == [DOSSIER, JSONL, SOURCES_MD]
    assert _text(root, DOSSIER) == BODY and _written(root) == sorted(result['files'])


def test_tables_dang_mapping_cung_ghi_thanh_tung_tep(tmp_path):
    """Hình dạng mà đường gửi thật chuyển tiếp được: `{tên: markdown}`."""
    root = _box(tmp_path)
    result = worker.execute('dossier_write',
                            _payload(tables={'gia-theo-quy': TABLES[0]['markdown']}), 'session-1')

    assert result['files'] == [DOSSIER, JSONL, SOURCES_MD, FOLDER + '/tables/gia-theo-quy.md']
    assert _text(root, FOLDER + '/tables/gia-theo-quy.md') == TABLES[0]['markdown']


@pytest.mark.parametrize('folder', ['thi-truong-chip-20260924-0310',
                                    'chuyen-tuyen-dung-tuyen-bao-hiem-20260924-0310'])
def test_phong_ho_so_dang_co_dau_thoi_gian_van_ghi_duoc(tmp_path, folder):
    """Phòng THẬT của harness: `dossier_dir_for()` = `<slug>-<yyyymmdd-hhmm>`, tới 54 ký tự."""
    root = _box(tmp_path)
    relative = f'.research/{folder}/v1-thi-truong-chip.md'
    result = worker.execute('dossier_write', _payload(path=relative), 'session-1')

    assert result['relativePath'] == relative
    assert _text(root, relative) == BODY


def test_ten_phong_qua_dai_van_tu_choi(tmp_path):
    """Rộng đủ cho phòng thật của harness, không mở toang: 62 ký tự vẫn bị chặn."""
    root = _box(tmp_path)
    message = _refused(_payload(path='.research/' + 'a' * 62 + '/v1-x.md'))

    assert message == 'DOSSIER_PATH_INVALID: .research/<việc>/<tên>.md', message
    assert _written(root) == [] and not (root / '.research').exists()


def test_hop_dong_tham_so_dung_nhu_harness_gui(tmp_path):
    """Ghim ĐÚNG hình dạng `research_runtime._dossier_op_args` gửi sang: đủ khoá, hàng dict, `{}`."""
    root = _box(tmp_path)
    args = {'path': DOSSIER, 'markdown': BODY, 'title': 'Thị trường chip Q3',
            'rows': [{'rowId': 'r1', 'claim': 'Giá wafer tăng 12%', 'url': 'https://example.com/wafer',
                      'host': 'example.com', 'tier': 2, 'type': 'bài viết',
                      'excerpt': 'Wafer prices rose 12% in Q3.', 'fetchedAt': '2026-09-20T00:00:00Z',
                      'origin': 'web_fetch', 'method': 'http', 'status': 'ok'}],
            'tables': {}, 'review': '', 'overwrite': False}
    result = worker.execute('dossier_write', args, 'session-1')

    assert result['files'] == [DOSSIER, JSONL, SOURCES_MD]
    assert result['version'] == 1 and result['slug'] == 'thi-truong-chip'
    assert json.loads(_text(root, JSONL).strip().splitlines()[0])['rowId'] == 'r1'
    assert 'Giá wafer tăng 12%' in _text(root, SOURCES_MD)
    assert 'example.com' in _text(root, SOURCES_MD)


@pytest.mark.parametrize('bad', ['../ngoai-workspace.md', '../../etc/passwd',
                                 '.research/../../ngoai-workspace.md'])
def test_thoat_khoi_workspace_thi_cong_cu_chan(tmp_path, bad):
    """Cổng cũ của mô-đun phải chạy TRƯỚC, đúng câu lỗi cũ — kể cả đường dẫn mở đầu `.research/`."""
    root = _box(tmp_path)
    message = _refused(_payload(path=bad))

    assert message == 'Path Traversal Denied: outside sandbox workspace', message
    assert _written(root) == []


def test_ho_so_qua_tran_thi_tu_choi_truoc_khi_ghi(tmp_path, monkeypatch):
    root = _box(tmp_path)
    monkeypatch.setattr(worker, 'DOSSIER_MAX_BYTES', 4096)
    message = _refused(_payload(markdown='x' * 4097))

    assert message.startswith('DOSSIER_TOO_LARGE'), message
    assert _written(root) == [] and not (root / '.research').exists(), 'từ chối trước, ghi sau'


def test_tep_phu_qua_tran_cung_chan_ca_ho_so(tmp_path, monkeypatch):
    """Trần áp cho TỪNG tệp: `review.md` quá lớn phải chặn cả hồ sơ, không để lại nửa bộ tệp."""
    root = _box(tmp_path)
    monkeypatch.setattr(worker, 'DOSSIER_MAX_BYTES', 4096)
    message = _refused(_payload(review='r' * 5000))

    assert message.startswith('DOSSIER_TOO_LARGE') and 'review.md' in message
    assert _written(root) == [] and not (root / FOLDER).exists()


def test_so_version_da_dung_thi_khong_ghi_gi(tmp_path):
    root = _box(tmp_path)
    (root / FOLDER).mkdir(parents=True, exist_ok=True)
    (root / DOSSIER).write_text('bản cũ đang dở', encoding='utf-8')

    message = _refused(_payload())

    assert message == ('DOSSIER_VERSION_TAKEN: ' + DOSSIER +
                       ' already exists; write the next version'), message
    assert _text(root, DOSSIER) == 'bản cũ đang dở', 'không được đụng vào tệp đã có'
    assert not (root / JSONL).exists(), 'từ chối thì `sources.jsonl` cũng không được ghi'
    assert _written(root) == [DOSSIER]


def test_ghi_de_thi_thay_noi_dung_va_doi_bam(tmp_path):
    root = _box(tmp_path)
    first = worker.execute('dossier_write', _payload(), 'session-1')
    second = worker.execute('dossier_write', _payload(markdown=BODY + '\nBổ sung sau phản biện.\n',
                                                      overwrite=True), 'session-1')

    assert second['files'] == first['files'] and second['version'] == 1
    assert second['sha1'] != first['sha1'], 'ghi đè thì băm của tệp hồ sơ phải đổi'
    assert _text(root, DOSSIER).endswith('Bổ sung sau phản biện.\n')
    assert second['bytes'] > first['bytes']


def test_ban_v2_ghi_lai_so_nguon_nhung_khong_dung_toi_ban_v1(tmp_path):
    """Số version là của TỆP HỒ SƠ: bản `v2` ghi lại sổ nguồn của thư mục việc (chủ ý)."""
    root = _box(tmp_path)
    worker.execute('dossier_write', _payload(), 'session-1')
    row = {'tier': 1, 'claim': 'nguồn mới', 'url': 'https://moi.example/x',
           'fetchedAt': '2026-09-22'}
    second = worker.execute('dossier_write', _payload(path=DOSSIER_V2, rows=[row]), 'session-1')

    assert second['version'] == 2 and second['files'] == [DOSSIER_V2, JSONL, SOURCES_MD]
    assert _text(root, DOSSIER) == BODY, 'bản v1 còn nguyên'
    assert json.loads(_text(root, JSONL).strip()) == row, 'sổ nguồn là của cả thư mục việc'
    assert _written(root) == sorted([DOSSIER, DOSSIER_V2, JSONL, SOURCES_MD])


@pytest.mark.parametrize('name', ['../../ngoai', 'x/y', '', '.an', 'a' * 62])
def test_ten_bang_di_thang_vao_duong_dan_bi_chan(tmp_path, name):
    """Tên bảng thành `tables/<tên>.md`: phải là MỘT đoạn tên, không thoát ra ngoài, không rỗng."""
    root = _box(tmp_path)
    message = _refused(_payload(tables=[{'name': name, 'markdown': '# Bảng\n'}]))

    assert message.startswith('DOSSIER_TABLE_INVALID'), message
    assert _written(root) == []


@pytest.mark.parametrize('markdown', ['', '   \n', None])
def test_markdown_rong_thi_tu_choi(tmp_path, markdown):
    root = _box(tmp_path)
    message = _refused(_payload(markdown=markdown))

    assert message == 'Dossier markdown must not be empty', message
    assert _written(root) == []


def test_dung_giua_luc_ghi_khong_de_lai_tep_tam(tmp_path, monkeypatch):
    """Tiến trình chết giữa lúc thay tệp (ở đây là `os.replace` ném) ⇒ không có tệp dở dang nào."""
    root = _box(tmp_path)

    def boom(source, target):
        raise OSError('đĩa hỏng giữa lúc ghi')

    monkeypatch.setattr(worker.os, 'replace', boom)
    with pytest.raises(OSError):
        worker.execute('dossier_write', _payload(), 'session-1')

    leftover = _written(root)
    assert leftover == [], 'không được để lại tệp hồ sơ dở dang hay tên tạm: %s' % leftover


def test_title_dai_bi_cat_con_120_ky_tu(tmp_path):
    _box(tmp_path)
    result = worker.execute('dossier_write', _payload(title='t' * 200), 'session-1')

    assert result['title'] == 't' * 120


def test_ho_so_nhanh_34k_ghi_duoc_va_doc_lai_bang_file_read(tmp_path):
    """Số đo thật của hợp đồng: nhánh 34 000+ ký tự (thứ bị cắt ở trần câu trả lời 8 000 ký tự)
    nằm trọn trong tệp và `file_read` đọc lại được nguyên vẹn."""
    root = _box(tmp_path)
    detail = ''.join('Chi tiết %04d: giá wafer tăng 12%%, nguồn tier 2, đã đối chiếu.\n' % index
                     for index in range(900))
    body = HEADER + '# Nhánh giá wafer\n\n' + detail
    assert len(body) > 34000, 'phép đo phải vượt 34 000 KÝ TỰ như hợp đồng nói'
    assert len(body.encode('utf-8')) < worker.DOSSIER_MAX_BYTES, 'và vẫn nằm dưới trần một tệp'

    result = worker.execute('dossier_write', {'path': '.research/gia-wafer/v1-gia-wafer.md',
                                              'markdown': body, 'rows': _rows()}, 'session-1')
    payload = worker.execute('file_read', {'path': result['relativePath'], 'limit': 60000},
                             'session-1')

    assert result['bytes'] == len(body.encode('utf-8'))
    assert payload['truncated'] is False and payload['content'] == body
    assert (root / result['relativePath']).read_text(encoding='utf-8') == body


def test_tran_va_phong_theo_hop_dong_da_chot():
    """Ba con số của hợp đồng §4: phòng `.research`, trần 256 KiB một tệp, khuôn đường dẫn hồ sơ."""
    assert worker.DOSSIER_ROOM == '.research'
    assert worker.DOSSIER_MAX_BYTES == 262144
    assert worker.DOSSIER_PATH_RE.fullmatch(DOSSIER)

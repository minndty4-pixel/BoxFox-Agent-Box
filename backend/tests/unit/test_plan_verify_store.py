"""Hai sổ mới của vòng lặp kế hoạch (vòng 25, D-33): `plan_verifications` + `plan_owners`.

Vì sao có tệp này: cổng duyệt (`PLAN_APPROVAL_UNVERIFIED`) đọc một hàng trong
`plan_verifications`, và tab Plan mở được một lượt thật nhờ hàng trong `plan_owners`. Cả hai là
**nguồn chân lý** cho hai câu hỏi khác nhau ("bản này có phản biện đạt chưa?" và "mở lại ở phiên
nào?"), nên chúng phải ghi được, đọc lại được, không nhân hàng khi ghi lại, và không bao giờ làm
hỏng khởi động khi DB đã có bảng từ trước (cột `resumed` là cột **cộng thêm**).
"""
from __future__ import annotations

import json
import sqlite3

from agentbox.memory.session_store import SessionStore

IDENTITY = 'clinical-patient-record-lookup-research'


def store_at(tmp_path):
    return SessionStore(tmp_path / 'sessions.db')


def test_a_verification_round_trips_with_its_critic_evidence(tmp_path):
    """Ghi rồi đọc lại: verdict, `issues` đã giải JSON, và dấu vết người phản biện."""
    store = store_at(tmp_path)
    issues = [{'severity': 'high', 'text': 'mốc 3 không có lệnh kiểm', 'fix': 'thêm lệnh + kỳ vọng'},
              {'severity': 'low', 'text': 'thiếu mục rủi ro về mạng', 'fix': ''}]
    row = store.record_plan_verification(IDENTITY, 2, 'revise', issues=issues,
                                        summary='bản 2 thiếu lệnh kiểm cho mốc 3',
                                        critic_session_id='critic-1', critic_answer_chars=912,
                                        critic_verdict='revise')
    assert row['verdict'] == 'revise' and row['version'] == 2
    assert row['summary'] == 'bản 2 thiếu lệnh kiểm cho mốc 3'
    assert row['critic_session_id'] == 'critic-1'
    assert row['critic_answer_chars'] == 912 and row['critic_verdict'] == 'revise'
    # `issues` đi vào DB dưới dạng JSON và trở ra dưới dạng danh sách — giao diện đọc thẳng nó.
    raw = store.db.execute('SELECT issues FROM plan_verifications WHERE identity=? AND version=?',
                           (IDENTITY, 2)).fetchone()['issues']
    assert json.loads(raw) == issues
    assert store.plan_verification(IDENTITY, 2)['issues'] == issues
    assert store.plan_verification(IDENTITY, 3) is None, 'bản khác không có hàng nào'
    store.close()


def test_recording_the_same_version_again_replaces_and_never_duplicates(tmp_path):
    """Một bản chỉ có MỘT phán quyết: vòng `revise` thứ hai ghi đè hàng cũ của đúng bản đó."""
    store = store_at(tmp_path)
    store.record_plan_verification(IDENTITY, 1, 'revise', issues=[{'severity': 'high', 'text': 'x',
                                                                   'fix': 'y'}],
                                   critic_session_id='critic-1', critic_answer_chars=500,
                                   critic_verdict='revise')
    later = store.record_plan_verification(IDENTITY, 1, 'ok', summary='đã sửa hết',
                                          critic_session_id='critic-2', critic_answer_chars=1200,
                                          critic_verdict='ok')
    assert later['verdict'] == 'ok' and later['issues'] == []
    assert later['critic_session_id'] == 'critic-2'
    total = store.db.execute('SELECT COUNT(*) AS total FROM plan_verifications').fetchone()['total']
    assert total == 1, 'cùng (identity, version) không bao giờ nhân hàng'
    # Bản khác vẫn là hàng riêng.
    store.record_plan_verification(IDENTITY, 2, 'ok', critic_answer_chars=800, critic_verdict='ok')
    assert {row['version'] for row in store.db.execute('SELECT version FROM plan_verifications')} == {1, 2}
    store.close()


def test_plan_verification_rejects_a_verdict_outside_the_two_values(tmp_path):
    store = store_at(tmp_path)
    for bad in ('maybe', 'OK', ''):
        try:
            store.record_plan_verification(IDENTITY, 1, bad)
        except ValueError as exc:
            assert 'verdict' in str(exc)
        else:
            raise AssertionError('phải từ chối verdict ' + repr(bad))
    store.close()


def test_the_owner_row_keeps_the_first_sighting_and_follows_the_latest_write(tmp_path):
    """`first_session_id`/`created` là dấu vết lần ghi ĐẦU; `session_id`/`version` đi theo lần mới."""
    store = store_at(tmp_path)
    first = store.record_plan_owner(IDENTITY, 'sess-1', slug='clinical-patient-record-lookup-research',
                                    relative_path='.plans/v1-clinical.md', version=1)
    assert (first['session_id'], first['first_session_id']) == ('sess-1', 'sess-1')
    assert first['version'] == 1 and first['created'] == first['updated']
    second = store.record_plan_owner(IDENTITY, 'sess-1', relative_path='.plans/v2-clinical.md',
                                     version=2)
    assert (second['session_id'], second['first_session_id']) == ('sess-1', 'sess-1')
    assert second['version'] == 2 and second['relative_path'] == '.plans/v2-clinical.md'
    assert second['created'] == first['created'] and second['updated'] >= first['updated']
    total = store.db.execute('SELECT COUNT(*) AS total FROM plan_owners').fetchone()['total']
    assert total == 1, 'một nhóm kế hoạch chỉ có một hàng sở hữu'
    assert store.plan_owner('plan-not-recorded') is None
    store.close()


def test_plan_written_at_finds_the_newest_row_of_the_exact_version(tmp_path):
    """Cổng provenance đọc mốc này: phải là hàng MỚI NHẤT khớp `(identity, version)`, và `None` khi trống."""
    store = store_at(tmp_path)
    first = store.create({'skills': []})['id']
    child = store.create({'skills': []}, role='plan', parent_id=first)['id']
    assert store.plan_written_at([first, child], IDENTITY, 1) is None, 'chưa ghi gì thì không có mốc'
    store.emit(first, 'plan_written', {'identity': IDENTITY, 'version': 1, 'relativePath': 'a.md'})
    store.emit(first, 'plan_written', {'identity': 'another-plan', 'version': 1, 'relativePath': 'b.md'})
    store.emit(child, 'plan_written', {'identity': IDENTITY, 'version': 2, 'relativePath': 'c.md'})
    first_mark = store.plan_written_at([first, child], IDENTITY, 1)
    second_mark = store.plan_written_at([first, child], IDENTITY, 2)
    assert first_mark is not None and second_mark is not None
    assert isinstance(first_mark, float) and second_mark >= first_mark
    assert store.plan_written_at([first, child], IDENTITY, 3) is None, 'bản chưa ghi thì không có mốc'
    # Hàng MỚI NHẤT thắng: ghi lại đúng bản 1 ở phiên khác thì mốc phải nhích lên.
    store.emit(child, 'plan_written', {'identity': IDENTITY, 'version': 1, 'relativePath': 'd.md'})
    assert store.plan_written_at([first, child], IDENTITY, 1) >= second_mark
    # Phiên con KHÔNG nằm trong tập thì không được tính — đây là ranh giới thật của cổng.
    assert store.plan_written_at([first], IDENTITY, 2) is None
    store.close()


def test_last_turn_status_reads_the_partial_mark_and_its_code(tmp_path):
    """`sessions.status` vẫn `completed` khi lượt dở; sự thật nằm ở hàng `turn_end` + notice bền."""
    store = store_at(tmp_path)
    sid = store.create({'skills': []})['id']
    assert store.last_turn_status(sid) is None
    store.emit(sid, 'turn_end', {'turn': 1, 'status': 'completed', 'stepsUsed': 3})
    assert store.last_turn_status(sid) == {'turn': 1, 'status': 'completed', 'partial': False,
                                           'code': None,
                                           'at': store.last_turn_status(sid)['at']}
    store.emit(sid, 'turn_end', {'turn': 2, 'status': 'partial', 'stepsUsed': 40})
    store.emit(sid, 'notice', {'code': 'DEADLINE_REACHED', 'partial': True,
                               'message': 'hết giờ giữa lượt'})
    latest = store.last_turn_status(sid)
    assert latest['turn'] == 2 and latest['partial'] is True and latest['code'] == 'DEADLINE_REACHED'
    # Một notice KHÔNG mang `partial` không được dùng làm mã lý do.
    store.emit(sid, 'notice', {'code': 'SOMETHING_ELSE', 'partial': False})
    assert store.last_turn_status(sid)['code'] == 'DEADLINE_REACHED'
    assert store.get(sid)['status'] == 'idle', 'hàm này không đổi trạng thái phiên'
    store.close()


def test_the_resumed_column_defaults_to_zero_and_can_be_flipped(tmp_path):
    store = store_at(tmp_path)
    row = store.record_plan_review(IDENTITY, 1, 'approved', note='ok', source='plan-tab',
                                   session_id='sess-1')
    assert row['resumed'] == 0, 'một hàng mới chưa mở lượt nào'
    again = store.set_plan_review_resumed(IDENTITY, 1)
    assert again['resumed'] == 1
    assert store.plan_review(IDENTITY, 1)['resumed'] == 1
    store.set_plan_review_resumed(IDENTITY, 1, resumed=False)
    assert store.plan_review(IDENTITY, 1)['resumed'] == 0
    store.set_plan_review_resumed(IDENTITY, 7, resumed=True)  # bản không có hàng: no-op, không ném
    assert store.plan_reviews_for(IDENTITY) == [store.plan_review(IDENTITY, 1)]
    store.close()


def test_a_database_written_before_this_round_gains_the_new_column(tmp_path):
    """DB sống đã có `plan_reviews` (chưa có `resumed`): mở lên phải tự thêm cột, không sập."""
    path = tmp_path / 'sessions.db'
    legacy = sqlite3.connect(path)
    legacy.executescript('''
        CREATE TABLE plan_reviews (
            identity TEXT NOT NULL, version INTEGER NOT NULL,
            decision TEXT NOT NULL CHECK(decision IN ('approved','changes_requested')),
            note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'plan-tab',
            session_id TEXT, decided_at REAL NOT NULL,
            content_size INTEGER, content_modified_at TEXT,
            PRIMARY KEY (identity, version));
    ''')
    legacy.execute("INSERT INTO plan_reviews(identity,version,decision,note,source,decided_at)"
                   ' VALUES(?,?,?,?,?,?)', (IDENTITY, 1, 'approved', 'duyệt cũ', 'plan-tab', 1.0))
    legacy.commit()
    legacy.close()

    store = SessionStore(path)
    columns = {row['name'] for row in store.db.execute('PRAGMA table_info(plan_reviews)')}
    assert 'resumed' in columns
    assert store.plan_review(IDENTITY, 1)['resumed'] == 0, 'hàng cũ đọc được, mặc định 0'
    assert store.plan_verification(IDENTITY, 1) is None
    assert store.plan_owner(IDENTITY) is None
    store.close()

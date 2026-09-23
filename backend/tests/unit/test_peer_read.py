"""T8 — `peer_read`: đọc luồng VIỆC của một phiên bạn, không đọc chỉ thị hay transcript của cha.

Mesh chỉ hữu ích khi một phiên con đọc được việc của phiên con khác (L1/L2: hai con chạy song song
trong cùng một lượt cha, con này cần thấy con kia đã làm tới đâu). Nhưng "phiên con" không phải một
hàng rào quyền: nếu ai cũng đọc được mọi phiên con trên máy thì đó là rò rỉ, không phải mesh. Bộ kiểm
này khẳng định cả hai mặt — hàng rào phạm vi (anh em cùng cha, hoặc con của chính mình) và máy cắt
(mọi chuỗi bị cắt, ảnh và hai bản echo `prompt`/`context` bị bỏ).
"""
import asyncio
import json

import pytest

from agentbox.agent_core.runtime import (HarnessRuntime, PEER_READ_CHAR_LIMIT, PEER_READ_DEFAULT_ROWS,
                                         PEER_READ_MAX_ROWS)
from agentbox.memory.session_store import SessionStore

LONG = 'x' * (PEER_READ_CHAR_LIMIT * 3)


class FixtureModel:
    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        raise AssertionError('peer_read không được gọi model')


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def build(tmp_path, name='peer-read.db'):
    store = SessionStore(tmp_path / name)
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    return store, runtime


def spawn(store, parent_id, role='review'):
    sid = store.create({'skills': []}, role=role, parent_id=parent_id)['id']
    store.child_start(sid, parent_id, 1, 1, role, goal=f'việc của {role}')
    return sid


def read(runtime, sid, args):
    return asyncio.run(runtime.dispatch({'id': sid, 'config': {'skills': []}}, 'peer_read', args))


# --------------------------------------------------------------------------- #
# Phạm vi: ai đọc được ai
# --------------------------------------------------------------------------- #

def test_peer_read_anh_em_cung_cha_doc_duoc_viec_cua_nhau(tmp_path):
    store, runtime = build(tmp_path)
    parent = store.create({'skills': []})['id']
    first, second = spawn(store, parent, 'build'), spawn(store, parent, 'review')
    store.emit(second, 'tool', {'name': 'file_read', 'path': 'backend/src/agentbox/api/server.py'})
    store.emit(second, 'assistant', {'text': 'Soát xong 3 tệp.', 'final': True})
    store.emit(first, 'assistant', {'text': 'việc của CHÍNH tôi', 'final': True})

    answer = read(runtime, first, {'sessionId': second})
    assert answer['sessionId'] == second
    assert [row['type'] for row in answer['events']] == ['tool', 'assistant']
    assert [row['seq'] for row in answer['events']] == sorted(row['seq'] for row in answer['events'])
    assert answer['events'][0]['data']['path'] == 'backend/src/agentbox/api/server.py'
    assert answer['events'][1]['data']['text'] == 'Soát xong 3 tệp.'
    assert answer['limit'] == PEER_READ_DEFAULT_ROWS and answer['truncated'] is False
    assert 'việc của CHÍNH tôi' not in json.dumps(answer, ensure_ascii=False), 'chỉ đọc phiên được hỏi'
    store.close()


def test_peer_read_tu_choi_phien_khac_cha(tmp_path):
    store, runtime = build(tmp_path)
    ours, theirs = store.create({'skills': []})['id'], store.create({'skills': []})['id']
    sibling = spawn(store, ours)
    stranger = spawn(store, theirs)

    with pytest.raises(PermissionError) as refused:
        read(runtime, sibling, {'sessionId': stranger})
    assert 'PEER_SCOPE' in str(refused.value)
    store.close()


def test_peer_read_orchestrator_doc_con_minh_thi_duoc_doc_chau_thi_khong(tmp_path):
    store, runtime = build(tmp_path)
    root = store.create({'skills': []})['id']
    child = spawn(store, root, 'build')
    grandchild = spawn(store, child, 'testing')
    store.emit(child, 'assistant', {'text': 'con trả lời cha', 'final': True})
    store.emit(grandchild, 'assistant', {'text': 'cháu trả lời con', 'final': True})

    answer = read(runtime, root, {'sessionId': child})
    assert [row['data']['text'] for row in answer['events']] == ['con trả lời cha']
    with pytest.raises(PermissionError):
        read(runtime, root, {'sessionId': grandchild})
    store.close()


def test_peer_read_tu_choi_phien_goc_va_session_id_la(tmp_path):
    store, runtime = build(tmp_path)
    root = store.create({'skills': []})['id']
    child = spawn(store, root)

    with pytest.raises(PermissionError):
        read(runtime, child, {'sessionId': child})
    for args in ({}, {'sessionId': ''}, {'sessionId': 'khong-co-that'}, {'sessionId': root}):
        with pytest.raises(PermissionError):
            read(runtime, child, args)
    store.close()


# --------------------------------------------------------------------------- #
# Máy cắt: chuỗi, ảnh, và hai bản echo của cha
# --------------------------------------------------------------------------- #

def test_peer_read_cat_moi_chuoi_va_bo_anh_prompt_context(tmp_path):
    store, runtime = build(tmp_path)
    parent = store.create({'skills': []})['id']
    first, second = spawn(store, parent, 'build'), spawn(store, parent, 'explore')
    store.emit(second, 'tool', {
        'name': 'file_read',
        'text': LONG,
        'image': 'data:image/png;base64,AAAA',
        'nested': {'base64': 'AAAA', 'deep': {'deeper': {'text': LONG}}},
        'result': {'content': 'ngắn thôi'},
    })
    # Hai bản echo của event `child` là chỉ thị CHA viết cho con, không phải việc của con.
    store.emit(second, 'child', {'sessionId': second, 'role': 'explore',
                                 'prompt': 'chỉ thị của cha', 'context': 'ngữ cảnh của cha'})

    answer = read(runtime, first, {'sessionId': second})
    tool, child = answer['events'][0]['data'], answer['events'][1]['data']
    assert tool['text'] == LONG[:PEER_READ_CHAR_LIMIT]
    assert 'image' not in tool and 'base64' not in tool['nested']
    assert tool['nested']['deep']['deeper']['text'] == LONG[:PEER_READ_CHAR_LIMIT]
    assert tool['result'] == {'content': 'ngắn thôi'}, 'cắt chuỗi nhưng giữ hình dạng JSON'
    assert 'prompt' not in child and 'context' not in child
    assert json.dumps(answer, ensure_ascii=False).find('AAAA') == -1, 'không một mẩu ảnh nào lọt ra'
    assert json.dumps(answer, ensure_ascii=False).find('chỉ thị của cha') == -1
    store.close()


def test_peer_read_khong_tra_messages_chi_tra_event(tmp_path):
    store, runtime = build(tmp_path)
    parent = store.create({'skills': []})['id']
    first, second = spawn(store, parent), spawn(store, parent)
    store.save(second, [{'role': 'user', 'content': 'bí mật của con'}], 'running')
    store.emit(second, 'assistant', {'text': 'câu trả lời', 'final': True})

    answer = read(runtime, first, {'sessionId': second})
    assert set(answer) == {'sessionId', 'events', 'limit', 'window', 'truncated'}
    assert 'bí mật của con' not in json.dumps(answer, ensure_ascii=False)
    store.close()


# --------------------------------------------------------------------------- #
# Cửa sổ đọc: kho, trần và mốc
# --------------------------------------------------------------------------- #

def test_peer_read_kep_limit_va_noi_that_khi_cua_so_bi_cat(tmp_path):
    store, runtime = build(tmp_path)
    parent = store.create({'skills': []})['id']
    first, second = spawn(store, parent), spawn(store, parent)
    for index in range(PEER_READ_MAX_ROWS + 10):
        store.emit(second, 'notice', {'index': index})

    wide = read(runtime, first, {'sessionId': second, 'limit': 10_000})
    assert wide['limit'] == PEER_READ_MAX_ROWS, 'trần là trần, không nhận số lớn hơn'
    assert len(wide['events']) == PEER_READ_MAX_ROWS
    assert wide['window'] == PEER_READ_MAX_ROWS + 10 and wide['truncated'] is True

    narrow = read(runtime, first, {'sessionId': second, 'limit': 3})
    assert [row['data']['index'] for row in narrow['events']] == [0, 1, 2]
    assert narrow['truncated'] is True

    after = read(runtime, first, {'sessionId': second, 'afterSeq': narrow['events'][-1]['seq'], 'limit': 2})
    assert [row['data']['index'] for row in after['events']] == [3, 4], '`afterSeq` là mốc đọc tiếp'
    assert after['truncated'] is True
    store.close()


def test_peer_read_ghi_nhat_ky_he_thong_moi_lan_doc(tmp_path, monkeypatch):
    store, runtime = build(tmp_path)
    parent = store.create({'skills': []})['id']
    first, second = spawn(store, parent), spawn(store, parent)
    store.emit(second, 'notice', {'index': 1})
    written = []
    monkeypatch.setattr('agentbox.agent_core.runtime.system_log.write',
                        lambda event, **kwargs: written.append((event, kwargs)))

    read(runtime, first, {'sessionId': second, 'limit': 7})
    assert [event for event, _ in written] == ['peer.read']
    assert written[0][1]['session_id'] == first and written[0][1]['target'] == second
    assert written[0][1]['rows'] == 1 and written[0][1]['window'] == 1
    store.close()

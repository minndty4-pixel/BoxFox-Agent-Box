"""C2 — phiên con chết khi nhà cung cấp cắt ở trần output.

Đo sống 2026-09-21: phiên con `6bd868ad…` trả `finishReason: length, outputTokens: 4096,
toolCalls: 0` → `TURN_EMPTY_RESPONSE`, KHÔNG thử lại lần nào, và cha đọc kết quả đó thành
con `failed`. Đây là lỗi TẠM THỜI của nhà cung cấp: cùng câu hỏi, xin ít token hơn (và bỏ
bộ tool — chính bộ tool vừa ngốn hết trần) là có câu trả lời. Bản này thử lại ĐÚNG MỘT lần;
nếu vẫn bị cắt thì lượt đó là `partial` (notice bền `PROVIDER_OUTPUT_TRUNCATED`), và cha
nhận `partial` chứ không phải một "thành công" nửa vời.
"""
import asyncio
import copy
import json

from agentbox.agent_core.limits import TRUNCATED_OUTPUT_MAX_TOKENS, TRUNCATED_OUTPUT_NOTICE_CODE
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.memory.session_store import SessionStore


def answer(text='done', calls=None, finish='stop', usage=None):
    return {'choices': [{'message': {'content': text, **({'tool_calls': calls} if calls else {})},
                         'finish_reason': 'tool_calls' if calls else finish}],
            'usage': usage if usage is not None else {'prompt_tokens': 10, 'completion_tokens': 2}}


def truncated(text='nửa câu trả lời', output_tokens=4096):
    return answer(text, finish='length', usage={'prompt_tokens': 900, 'completion_tokens': output_tokens})


def call(name, args, cid='c1'):
    return {'id': cid, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


class FixtureModel:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append({'messages': copy.deepcopy(messages), 'tools': copy.deepcopy(tools),
                              'max_tokens': max_tokens})
        return next(self.responses)


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def run_turn(tmp_path, client, values=None, prompt='làm việc'):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), client)
    session = runtime.create(values or {'skills': []})

    async def run():
        runtime.start(session['id'], prompt)
        return await runtime.tasks[session['id']]

    return store, runtime, session, asyncio.run(run())


def notices(store, sid, code):
    return [e['data'] for e in store.events(sid) if e['type'] == 'notice' and e['data'].get('code') == code]


def turn_ends(store, sid):
    return [e['data'] for e in store.events(sid) if e['type'] == 'turn_end']


# --------------------------------------------------------------------------- #
# Xin ít token hơn, bỏ bộ tool: một lần, và chỉ khi chưa có tool call nào
# --------------------------------------------------------------------------- #

def test_a_truncated_first_answer_is_retried_exactly_once_without_tools(tmp_path):
    client = FixtureModel([truncated('nửa câu'), answer('câu trả lời trọn vẹn')])
    store, runtime, session, result = run_turn(tmp_path, client)

    assert len(client.requests) == 2, 'một lần thử lại, không phải một vòng lặp'
    retry = client.requests[1]
    assert retry['max_tokens'] == TRUNCATED_OUTPUT_MAX_TOKENS == 2048
    assert retry['tools'] == [], 'bộ tool chính là thứ vừa ngốn hết trần output'
    assert client.requests[0]['max_tokens'] == 4096, 'lần gọi đầu giữ nguyên như trước'
    assert [m['role'] for m in retry['messages']] == ['system', 'user'], 'cùng transcript, chưa thêm gì'
    assert result == 'câu trả lời trọn vẹn', 'câu trả lời thử lại là kết quả của lượt'
    assert store.get(session['id'])['status'] == 'completed'
    assert notices(store, session['id'], TRUNCATED_OUTPUT_NOTICE_CODE) == [], \
        'thử lại thành công thì không có gì phải báo là dở'
    assert turn_ends(store, session['id'])[-1]['status'] == 'completed'
    assert runtime.truncated_turn(session['id']) is False
    store.close()


def test_a_length_stop_that_still_asked_for_a_tool_is_not_retried(tmp_path):
    client = FixtureModel([answer(calls=[call('file_read', {'path': 'x'})], finish='length'),
                           answer('xong')])
    store, _runtime, session, result = run_turn(tmp_path, client)
    assert len(client.requests) == 2, 'không có lần gọi thừa nào'
    assert client.requests[1]['tools'] != [], 'lượt hai là lượt bình thường, có tool schema'
    assert result == 'xong' and store.get(session['id'])['status'] == 'completed'
    store.close()


# --------------------------------------------------------------------------- #
# Vẫn bị cắt sau khi thử lại: lượt là `partial`, và điều đó là bền
# --------------------------------------------------------------------------- #

def test_a_turn_truncated_twice_is_reported_as_partial(tmp_path):
    client = FixtureModel([truncated('phần đầu của câu trả lời', 4096),
                           truncated('phần đầu của câu trả lời', 2048)])
    store, runtime, session, result = run_turn(tmp_path, client)
    sid = session['id']

    assert len(client.requests) == 2, 'vẫn chỉ một lần thử lại'
    assert isinstance(result, str) and result.startswith('phần đầu'), \
        '_run vẫn trả TEXT cho người gọi, không phải một hình dạng của client'
    stored = store.get(sid)
    assert stored['status'] == 'completed', 'từ vựng trạng thái phiên không đổi'
    assert stored['messages'][-1] == {'role': 'assistant', 'content': 'phần đầu của câu trả lời'}
    rows = notices(store, sid, TRUNCATED_OUTPUT_NOTICE_CODE)
    assert len(rows) == 1, 'đúng một notice cho một lượt'
    assert rows[0]['partial'] is True
    assert rows[0]['outputTokens'] == 2048, 'số token THẬT của lần thử lại thứ hai'
    assert runtime.truncated_turn(sid) is True
    end = turn_ends(store, sid)[-1]
    assert end['status'] == 'partial' and end['finishReason'] == 'length'
    assert end['outputTokens'] == 2048
    # `finish` vẫn nói `completed` (payload cũ không đổi), còn sự thật dở nằm ở `turn_end` + notice.
    assert [e['data'] for e in store.events(sid) if e['type'] == 'finish'] == [{'status': 'completed'}]
    store.close()


# --------------------------------------------------------------------------- #
# Cha đọc kết quả con: `partial`, không phải `failed` và không phải "xong"
# --------------------------------------------------------------------------- #

def test_the_parent_sees_a_truncated_child_as_partial(tmp_path):
    client = FixtureModel([answer(calls=[call('delegate_task', {'role': 'research', 'goal': 'tra cứu'})]),
                           truncated('phần đầu của báo cáo', 4096),
                           truncated('phần đầu của báo cáo', 2048),
                           answer('câu trả lời cuối của cha')])
    store, runtime, session, result = run_turn(tmp_path, client, prompt='nhờ chuyên gia')
    sid = session['id']

    child_events = [e['data'] for e in store.events(sid) if e['type'] == 'child']
    assert child_events[0]['status'] == 'started' and len(child_events) == 2
    child = child_events[-1]  # hàng thứ hai là kết quả cuối cùng cha dùng
    assert child['status'] == 'partial'
    assert child['reason'] == TRUNCATED_OUTPUT_NOTICE_CODE
    assert child['is_error'] is True, 'cha phải biết đây không phải một kết quả trọn vẹn'
    assert child['last_error'] == TRUNCATED_OUTPUT_NOTICE_CODE
    assert 'status=partial' in child['summary'], 'dòng chẩn đoán cho cha nói đúng trạng thái'
    assert 'phần đầu của báo cáo' in child['summary'], 'phần trả lời được vẫn tới tay cha'

    child_row = store.get(child['sessionId'])
    assert child_row['status'] == 'completed', 'hàng `sessions` của con đổi từ vựng: KHÔNG'
    assert turn_ends(store, child['sessionId'])[-1]['status'] == 'partial'
    assert store.get(sid)['status'] == 'completed', 'lượt cha vẫn xong bình thường'
    assert result == 'câu trả lời cuối của cha'
    store.close()

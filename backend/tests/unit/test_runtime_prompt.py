"""Vòng 23 — khuôn báo cáo cuối và bản nhắc việc của lượt đi vào PROMPT, không vào cổng (P1.1–P1.5).

Chủ nhà chốt (D-18/D-20/D-24): cổng bằng chứng không được thêm tiêu chí nào về cấu trúc hay ngôn
ngữ của câu trả lời, nên hai thứ dưới đây phải sống ở tầng prompt và phải kiểm được mà KHÔNG cần
model thật:

- **P1.1/P1.2/P1.4** — một khuôn NĂM PHẦN, một nguồn tên phần (`runtime.FINAL_REPORT_PARTS`), mặt
  chữ thật sự được nạp (`AGENT.md` §3.4) và câu chỉ dẫn trong SOP chỉ TRỎ VỀ khuôn, không chép lời.
  Không một chuỗi tiếng Việt nào trong khuôn: chữ thật do model viết, bằng ngôn ngữ nó đang trả lời.
- **P1.5** — bản nhắc việc của lượt (`turn_recap`) có mặt khi lượt đã đổi/lệnh, VẮNG khi lượt chỉ đọc,
  chỉ vào phiên chính, và không bao giờ lọt vào transcript hay câu trả lời.
"""
from __future__ import annotations

import asyncio
import copy
import json
from agentbox.agent_core import runtime as runtime_module
from agentbox.agent_core.roles import ROLES
from agentbox.agent_core.runtime import HarnessRuntime, get_agent_identity, turn_recap
from agentbox.memory.session_store import SessionStore

FINAL_REPORT_SECTION = '=== FINAL REPORT ==='
SECTION_34 = '### 3.4.'
# Tên NĂM phần (phần trước ' - ' của mỗi mục) — thứ tự là hợp đồng, lời giải thích thì không.
PART_HEADS = tuple(part.split(' - ')[0] for part in runtime_module.FINAL_REPORT_PARTS)


def answer(text='done', calls=None):
    return {'choices': [{'message': {'content': text, **({'tool_calls': calls} if calls else {})},
                         'finish_reason': 'tool_calls' if calls else 'stop'}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2}}


def call(name, args, cid='c1'):
    return {'id': cid, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


class Model:
    """Model giả: trả lần lượt các câu trả lời và ghi lại ĐÚNG `messages` của mỗi lần gọi."""

    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append(copy.deepcopy(messages))
        return next(self.responses)


class Executor:
    """Executor giả tối thiểu: đủ để lượt chạy, không ghi đĩa, không gọi box."""

    async def execute(self, name, args, sid, **_identity):
        if name == 'file_write':
            return {'content': f"Written {args.get('path')}"}
        if name in ('terminal_exec', 'run_command'):
            return {'content': 'ok', 'exit_code': 0}
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def run_turn(tmp_path, client, prompt, *, name='prompt.db', role='orchestrator', parent_id=None):
    store = SessionStore(tmp_path / name)
    runtime = HarnessRuntime(store, Executor(), client)
    session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'deepseek-v4-flash'},
                             parent_id=parent_id, role=role)
    sid = session['id']

    async def run():
        await runtime.submit(sid, prompt)
        await runtime.tasks[sid]

    asyncio.run(run())
    return store, runtime, session


def system_prompt(runtime, session):
    return runtime.store.get(session['id'])['messages'][0]['content']


def assistant_text(store, sid):
    return [event['data'] for event in store.events(sid) if event['type'] == 'assistant'][-1]['text']


def recap_messages(messages):
    return [message for message in messages
            if isinstance(message.get('content'), str)
            and message['content'].startswith(runtime_module.RECAP_HEADER)]


def marker_count(text, marker):
    return text.count(marker)


# ------------------------------------------------------------------ P1.1/P1.4 khuôn báo cáo cuối

def test_phien_chinh_nhan_du_nam_phan_trong_prompt(tmp_path):
    """P1.4(a) — prompt của phiên chính mang đủ năm phần, đúng thứ tự của `FINAL_REPORT_PARTS`."""
    store, runtime, session = run_turn(tmp_path, Model([answer('xong')]), 'việc gì đó')
    prompt = system_prompt(runtime, session)

    assert FINAL_REPORT_SECTION in prompt
    assert runtime_module.FINAL_REPORT_GUIDANCE in prompt
    positions = [prompt.index(head) for head in PART_HEADS]
    assert positions == sorted(positions) and all(position >= 0 for position in positions)
    assert prompt.index('=== ANSWER LENGTH ===') < prompt.index(FINAL_REPORT_SECTION)
    store.close()


def test_moi_vai_nhan_chu_dan_do_dai_nhung_chi_phien_chinh_nhan_khuon_bao_cao(tmp_path):
    """P1.4(b) — `ANSWER LENGTH` cho MỌI vai; khối `FINAL REPORT` chỉ cho phiên chính (D-18)."""
    store = SessionStore(tmp_path / 'roles.db')
    runtime = HarnessRuntime(store, Executor(), Model([]))
    main = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'm'})
    prompt = system_prompt(runtime, main)
    assert runtime_module.ANSWER_LENGTH_HINT in prompt and FINAL_REPORT_SECTION in prompt

    for role in ROLES:
        child = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'm'},
                               parent_id=main['id'], role=role)
        child_prompt = system_prompt(runtime, child)
        assert runtime_module.ANSWER_LENGTH_HINT in child_prompt, f'vai {role} phải biết độ dài câu trả lời'
        assert FINAL_REPORT_SECTION not in child_prompt, f'vai {role} trả kết quả cho CHA, không báo cáo chủ nhà'
        assert f'=== ASSIGNED ROLE: {role.upper()} ===' in child_prompt
        assert ROLES[role].instructions in child_prompt
    store.close()


def test_cau_chi_dan_sop_tro_ve_khuon_chu_khong_chep_lai_loi():
    """P1.1 — câu chỉ dẫn cuối trong SOP trỏ về khối `FINAL REPORT`, không có bản chép thứ hai.

    Hai bản chép là cách hai mặt lệch nhau: bản được nạp thật là `AGENT.md`, còn SOP chỉ phải nói
    "viết theo khuôn đã nêu".
    """
    sop = runtime_module.ORCHESTRATOR_SOP_GUIDANCE
    assert 'FINAL REPORT block' in sop
    assert 'Deliver a clear, professional summary to the user highlighting' not in sop
    # Mỗi phần chỉ được ĐỊNH NGHĨA ở một chỗ: SOP không lặp lại lời của khuôn.
    assert [head for head in PART_HEADS if head in sop] == [], 'khuôn chỉ được định nghĩa ở MỘT chỗ'


def test_agent_md_muc_34_la_ban_that_su_duoc_nap_va_co_du_nam_muc(tmp_path):
    """P1.2/P1.4(c) — `get_agent_identity()` (nguồn THẬT của prompt) có §3.4 với năm mục, đúng thứ tự."""
    identity = get_agent_identity()
    assert identity != runtime_module.IDENTITY, 'bài kiểm này chỉ có nghĩa khi AGENT.md đang được nạp'
    start = identity.index(SECTION_34)
    end = identity.index('### 3.5.', start)
    section = identity[start:end]

    positions = [section.index(head) for head in PART_HEADS]
    assert positions == sorted(positions), 'năm mục phải cùng thứ tự với `FINAL_REPORT_PARTS`'
    assert 'Never invent either' in section
    assert 'Evidence' in section and 'never tell the owner to open an "Evidence" block' in section


def test_khuon_khong_mang_mot_chu_tieng_viet_nao():
    """P1.4(d)/C2/D-24 — tên phần và câu chỉ dẫn là tiếng Anh (ngôn ngữ của prompt): chữ thật của
    câu trả lời do model viết, bằng ngôn ngữ nó đang trả lời, nên khuôn không được gài sẵn câu mẫu."""
    for text in (runtime_module.FINAL_REPORT_GUIDANCE, *runtime_module.FINAL_REPORT_PARTS):
        assert text.isascii(), 'khuôn phải thuần ASCII'
    identity = get_agent_identity()
    section = identity[identity.index(SECTION_34):identity.index('### 3.5.', identity.index(SECTION_34))]
    assert section.isascii(), 'mục §3.4 trong AGENT.md phải thuần ASCII'
    assert len(runtime_module.FINAL_REPORT_GUIDANCE.splitlines()) <= 8


def test_khuon_khong_bi_nuot_khi_danh_sach_ky_nang_duoc_dung_lai(tmp_path):
    """P1.1/P1.4(e) — đo được: mọi lượt gửi đi đều dựng lại khối KỸ NĂNG, không được nuốt phần đuôi.

    Bản cũ của `_next_turn_skills` cắt từ marker kỹ năng tới hết chuỗi rồi chỉ ghép lại khối
    `OWNER-CONFIGURED DIRECTIVES`, nên ngay lượt ĐẦU TIÊN mô hình đã không còn `=== ANSWER LENGTH ===`
    và không còn khối `=== FINAL REPORT ===` — khuôn báo cáo của vòng 23 thành vô hiệu dù mọi bài
    kiểm gọi thẳng `create()` đều xanh. Bài này kiểm ĐÚNG `messages` mà mô hình nhận.
    """
    client = Model([answer('xong')])
    store, runtime, session = run_turn(tmp_path, client, 'việc gì đó')
    sid = session['id']
    seen = client.requests[0][0]['content']

    assert seen == system_prompt(runtime, session), 'prompt trong transcript phải là prompt mô hình đọc'
    assert '=== ANSWER LENGTH ===' in seen and runtime_module.ANSWER_LENGTH_HINT in seen
    assert FINAL_REPORT_SECTION in seen and runtime_module.FINAL_REPORT_GUIDANCE in seen
    assert marker_count(seen, '=== ENABLED SKILLS') == 1, 'khối kỹ năng không được nhân đôi'
    store.close()


# ------------------------------------------------------------------------- P1.5 bản nhắc việc

def test_recap_co_mat_khi_luot_co_thay_doi_va_khong_lot_vao_cau_tra_loi(tmp_path):
    """P1.5 — lượt có việc để nhắc: bước tổng kết nhận danh sách máy đọc được của chính lượt đó."""
    client = Model([answer('', calls=[call('file_write', {'path': 'src/app.py', 'content': 'x'})]),
                    answer('Đã sửa `src/app.py`.')])
    store, runtime, session = run_turn(tmp_path, client, 'sửa app giúp tôi')
    sid = session['id']

    recap = recap_messages(client.requests[1])
    assert len(recap) == 1, 'bước tổng kết phải có ĐÚNG một khối nhắc việc'
    content = recap[0]['content']
    assert 'owner request (excerpt): sửa app giúp tôi' in content
    assert 'files changed: src/app.py' in content
    assert content.startswith(runtime_module.RECAP_HEADER)
    assert 'must not be pasted into it' in content
    assert len(content.splitlines()) <= runtime_module.RECAP_MAX_LINES + 2
    assert recap_messages(client.requests[0]) == [], 'lượt chưa làm gì thì không tốn một dòng nào'

    transcript = json.dumps(runtime.store.get(sid)['messages'], ensure_ascii=False)
    assert runtime_module.RECAP_HEADER not in transcript, 'khối nhắc việc KHÔNG vào transcript'
    assert assistant_text(store, sid) == 'Đã sửa `src/app.py`.'
    assert runtime_module.RECAP_HEADER not in assistant_text(store, sid), 'không lọt vào câu trả lời'
    store.close()


def test_recap_vang_khi_luot_chi_doc(tmp_path):
    """P1.5 — lượt chỉ đọc không có gì để nhắc: khối này không được ăn ngữ cảnh của mọi lượt."""
    client = Model([answer('', calls=[call('file_read', {'path': 'src/app.py'})]),
                    answer('Đã đọc tệp: nội dung là x.')])
    store, _runtime, session = run_turn(tmp_path, client, 'đọc tệp này')
    sid = session['id']

    assert recap_messages(client.requests[1]) == []
    assert runtime_module.RECAP_HEADER not in json.dumps(client.requests[1], ensure_ascii=False)
    assert assistant_text(store, sid) == 'Đã đọc tệp: nội dung là x.'
    store.close()


def test_recap_chi_danh_cho_phien_chinh(tmp_path):
    """P1.5 — phiên con trả kết quả cho CHA theo `Result contract`, không nhận bản nhắc việc của lượt."""
    client = Model([answer('', calls=[call('file_write', {'path': 'src/app.py', 'content': 'x'})]),
                    answer('Đã sửa `src/app.py`.')])
    store, _runtime, session = run_turn(tmp_path, client, 'sửa app', role='build', name='child.db')
    sid = session['id']

    assert store.get(sid)['role'] == 'build'
    assert [message for message in client.requests[-1]
            if isinstance(message.get('content'), str)
            and message['content'].startswith(runtime_module.RECAP_HEADER)] == []
    store.close()


def test_ban_nhac_viec_chi_lay_du_lieu_da_co_va_khong_bao_gio_lam_hong_luot():
    """P1.5 — hàm thuần: dựng từ `tool_end` đã có, và mọi hỏng hóc bên trong trả `''`.

    Bản nhắc việc dùng chung `evidence_gate` với cổng, nên nếu nó để lỗi bay lên thì một test tiêm
    lỗi vào cổng ("cổng hỏng thì lượt đi tiếp") sẽ giết lượt — chữ THÊM cho bước tổng kết không
    được phép làm điều đó.
    """
    calls = [{'name': 'terminal_exec', 'args': {'command': 'pytest -q'}, 'step': 3,
              'result': {'content': '1 passed', 'exit_code': 0}}]
    text = turn_recap(calls, 'chạy test')
    assert 'command run: pytest -q (exit 0)' in text
    assert turn_recap([], None) == '' and turn_recap(None, None) == ''

    class Boom:
        def __getattr__(self, _name):
            raise RuntimeError('gate exploded')

    original = runtime_module.evidence_gate
    runtime_module.evidence_gate = Boom()
    try:
        assert turn_recap(calls, 'chạy test') == ''
    finally:
        runtime_module.evidence_gate = original


def test_recap_khong_tinh_vao_do_dai_cau_tra_loi(tmp_path):
    """P1.5 — khối nhắc việc nằm trong YÊU CẦU của bước, không phải trong câu trả lời: câu trả lời
    dài tới đâu vẫn chỉ bị đo bằng chính nó."""
    long_answer = 'x' * 500
    client = Model([answer('', calls=[call('file_write', {'path': 'src/app.py', 'content': 'x'})]),
                    answer(long_answer)])
    store, _runtime, session = run_turn(tmp_path, client, 'sửa app')
    sid = session['id']

    assert assistant_text(store, sid) == long_answer
    assert runtime_module.RECAP_HEADER not in assistant_text(store, sid)
    assert [message for message in client.requests[-1]
            if isinstance(message.get('content'), str)
            and message['content'].startswith(runtime_module.RECAP_HEADER)], 'khối nhắc việc vẫn ở YÊU CẦU'
    store.close()

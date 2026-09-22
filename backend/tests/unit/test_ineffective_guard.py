"""Bộ đếm "nén không ăn thua" (Phần D đợt 20, việc N9).

Ca sống 2026-09-21 (`43a92d61`): cờ `ineffective` bật **bốn lần liên tiếp** mà không ai hành động —
mỗi lần lại đốt thêm một lượt tóm tắt bên trong cùng một hạn chót, và phiên vẫn chết ở trần. Luật
mới: hai lần liên tiếp thì lần nén tự động kế tiếp **nói thẳng** ra (`CONTEXT_LIMIT`) thay vì gộp
tiếp; `/compact` của người dùng vẫn đi qua được và đặt lại bộ đếm.
"""
import asyncio
import json

from agentbox.agent_core import compression
from agentbox.agent_core.compression import ContextCompressor, estimate_tokens


def _call(index, pad=0):
    args = {'command': f'echo {index}' + 'c' * pad}
    return {'id': f'call_{index}', 'type': 'function',
            'function': {'name': 'terminal_exec', 'arguments': json.dumps(args)}}


def _turn(index, pad):
    return [{'role': 'assistant', 'content': None, 'tool_calls': [_call(index, pad)]},
            {'role': 'tool', 'tool_call_id': f'call_{index}', 'name': 'terminal_exec',
             'content': f'[{index}] ' + 'x' * pad}]


def _history(turns, pad):
    messages = [{'role': 'system', 'content': 'stable'}, {'role': 'user', 'content': 'goal'}]
    for index in range(turns):
        messages += _turn(index, pad)
    return messages


def _bulky_tail_history():
    """Đuôi nặng nằm sát ngưỡng của cửa sổ 40 000 → nén xong vẫn sát ngưỡng (đúng ca `ineffective`)."""
    return _history(20, 300) + sum((_turn(20 + index, 9000) for index in range(4)), [])


def _answer(text, finish='stop'):
    return {'choices': [{'message': {'content': text}, 'finish_reason': finish}]}


async def _good_summary(history, max_tokens=None):
    return _answer('Goal: older turns. Evidence: tool results.')


def test_the_first_ineffective_fold_is_counted_silently(monkeypatch):
    """Lần một: cờ `ineffective` bật, bộ đếm lên 1, và KHÔNG có gì ném ra ngoài."""
    monkeypatch.setattr(compression, 'COMPRESSION_THRASH_SECONDS', 0.0)
    messages = _bulky_tail_history()
    compressor = ContextCompressor(40_000)

    result, event = asyncio.run(compressor.compact(messages, [], _good_summary))
    assert event['kind'] == 'summary' and event['ineffective'] is True, event
    assert compressor._ineffective_streak == 1
    assert result is not messages, 'bản nén vẫn được dùng'


def test_the_second_ineffective_fold_still_returns_a_result(monkeypatch):
    monkeypatch.setattr(compression, 'COMPRESSION_THRASH_SECONDS', 0.0)
    messages = _bulky_tail_history()
    compressor = ContextCompressor(40_000)

    async def run():
        await compressor.compact(messages, [], _good_summary)
        return await compressor.compact(messages, [], _good_summary)

    _, event = asyncio.run(run())
    assert event['kind'] == 'summary' and event['ineffective'] is True, event
    assert compressor._ineffective_streak == 2


def test_the_third_automatic_fold_refuses_with_an_honest_context_limit(monkeypatch):
    """Lần ba: không gộp nữa, không đốt thêm lượt tóm tắt — trả `CONTEXT_LIMIT` kèm câu chỉ việc."""
    monkeypatch.setattr(compression, 'COMPRESSION_THRASH_SECONDS', 0.0)
    messages = _bulky_tail_history()
    compressor = ContextCompressor(40_000)
    calls = []

    async def summarize(history, max_tokens=None):
        calls.append(max_tokens)
        return _answer('Goal: older turns. Evidence: tool results.')

    async def run():
        await compressor.compact(messages, [], summarize)
        await compressor.compact(messages, [], summarize)
        return await compressor.compact(messages, [], summarize)

    try:
        asyncio.run(run())
        raise AssertionError('lần nén thứ ba phải từ chối')
    except ValueError as exc:
        assert str(exc).startswith('CONTEXT_LIMIT'), exc
        assert 'ineffective twice' in str(exc), exc
    assert len(calls) == 2, 'lần thứ ba không được gọi nhà cung cấp nữa'


def test_a_summary_that_really_shrinks_resets_the_counter(monkeypatch):
    """Nén thành công (bản gộp thật sự nhỏ hơn ngưỡng) phải đặt lại bộ đếm.

    Đường vào: `/compact` bỏ qua nhánh thoát sớm của phép tỉa, nên bản tóm tắt chạy trên transcript
    mà phần đuôi nhẹ — đúng ca người dùng bấm `/compact` sau một lượt dài.
    """
    monkeypatch.setattr(compression, 'COMPRESSION_THRASH_SECONDS', 0.0)
    compressor = ContextCompressor(40_000)

    async def run():
        # 1) một lần nén tự động không ăn thua → bộ đếm = 1
        first = await compressor.compact(_bulky_tail_history(), [], _good_summary)
        # 2) một lần nén có ý thức trên transcript nhẹ → bản gộp nhỏ hơn hẳn ngưỡng
        second = await compressor.compact(_history(40, 1000), [], _good_summary, force=True)
        return first, second

    (_, ineffective), (result, event) = asyncio.run(run())
    assert ineffective['ineffective'] is True
    assert event['kind'] == 'summary' and 'ineffective' not in event, event
    assert estimate_tokens(result) < compressor.threshold * compression.INEFFECTIVE_PROGRESS_FRACTION
    assert compressor._ineffective_streak == 0, 'bộ đếm phải được đặt lại sau một lần gộp thật sự'


def test_a_forced_compaction_is_never_blocked_by_the_counter(monkeypatch):
    """`/compact` là lệnh của người dùng: bộ đếm không được chặn nó, và lệnh đó đặt lại bộ đếm."""
    monkeypatch.setattr(compression, 'COMPRESSION_THRASH_SECONDS', 0.0)
    messages = _bulky_tail_history()
    compressor = ContextCompressor(40_000)

    async def run():
        await compressor.compact(messages, [], _good_summary)
        await compressor.compact(messages, [], _good_summary)
        return await compressor.compact(messages, [], _good_summary, force=True)

    _, event = asyncio.run(run())
    assert event['kind'] == 'summary', event
    assert compressor._ineffective_streak in (0, 1), 'đặt lại trước khi chạy, rồi đếm lại từ đầu'

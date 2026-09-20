"""Regression tests for the E2E fix batch (docs/plan/fix-plan-e2e-defects.md).

Covers: compaction on a short conversation, context-window resolution from router
metadata, thinking level preserved at session create, and the /claude-code pre-flight.
"""
import asyncio
import copy
import json

import pytest

from agentbox.agent_core.compression import ContextCompressor
from agentbox.agent_core.runtime import HarnessRuntime, resolve_context_window
from agentbox.memory.session_store import SessionStore


class FixtureModel:
    def __init__(self, responses=()):
        self.responses = iter(responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append(copy.deepcopy((messages, tools, route)))
        return next(self.responses)


class FixtureExecutor:
    def __init__(self):
        self.container = None
        self.calls = []

    async def execute(self, name, args, sid):
        self.calls.append((name, args, sid))
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def test_compact_short_conversation_is_unchanged():
    """A short chat must not fail: the summary is longer than the transcript, so keep the original."""

    async def run():
        compressor = ContextCompressor(1_000_000)
        messages = [
            {'role': 'system', 'content': 'system'},
            {'role': 'user', 'content': 'A1'},
            {'role': 'assistant', 'content': 'A1'},
            {'role': 'user', 'content': 'A2'},
            {'role': 'assistant', 'content': 'A2'},
            {'role': 'user', 'content': 'A3'},
        ]

        async def summarize(history):
            # A realistic compaction summary is longer than a three-word transcript.
            return {'choices': [{'message': {'content': 'Goal: ' + ('keep the context small. ' * 40)},
                                 'finish_reason': 'stop'}]}

        result, event = await compressor.compact(messages, [], summarize, force=True)
        assert result == messages, 'the original transcript must be preserved'
        assert event['kind'] == 'unchanged'
        assert event['reason'] == 'summary_not_smaller'
        assert event['beforeEstimate'] == event['afterEstimate']

    asyncio.run(run())


def test_compact_still_reports_context_limit_when_truly_over_budget():
    """A genuinely oversized turn must still fail with CONTEXT_LIMIT."""

    async def run():
        compressor = ContextCompressor(2048)
        messages = [{'role': 'user', 'content': 'x' * 20000}]

        async def summarize(history):
            raise AssertionError('must not summarize when the transcript cannot be cut')

        with pytest.raises(ValueError, match='CONTEXT_LIMIT'):
            await compressor.compact(messages, [], summarize, force=True)

    asyncio.run(run())


def test_context_window_prefers_explicit_then_router_metadata():
    """An explicit request wins, then router metadata, then the name heuristic."""
    assert resolve_context_window('claude-sonnet-4-6', None, {'contextWindow': 1_000_000}) == 1_000_000
    assert resolve_context_window('claude-sonnet-4-6', 8000, {'contextWindow': 1_000_000}) == 8000
    assert resolve_context_window('claude-sonnet-4-6', None, None) == 200_000
    assert resolve_context_window('gemini-3.8-flash-high', None, None) == 1_000_000
    # Unknown metadata must not raise or shadow the explicit request.
    assert resolve_context_window('mystery-model', 5000, {'contextWindow': None}) == 5000
    assert resolve_context_window('mystery-model', None, {'contextWindow': 'nonsense'}) == 128_000


def test_session_create_keeps_thinking_level(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'm1', 'thinkingLevel': 'high'})
    assert session['config']['route']['thinkingLevel'] == 'high'
    assert session['config']['route']['modelId'] == 'm1'
    store.close()


def _thinking_metadata(thinking_type, levels, default=None, model_id=None):
    record = {'contextWindow': 1_000_000, 'thinkingType': thinking_type,
              'thinkingLevels': levels, 'defaultThinking': default}
    if model_id:
        record['id'] = model_id
    return record


def test_session_create_accepts_published_thinking_level(tmp_path):
    """Mức nằm trong danh sách model công bố được nhận (và chuẩn hoá hoa/thường)."""
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'gemini-3.6-flash',
                              'thinkingLevel': 'HIGH', 'modelMetadata': _thinking_metadata('effort', ['low', 'medium', 'high'], 'high')})
    assert session['config']['route']['thinkingLevel'] == 'high'
    store.close()


def test_session_create_rejects_unsupported_thinking_level(tmp_path):
    """Mức provider không công bố phải bị từ chối kèm mã lỗi, không lưu im lặng."""
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    with pytest.raises(ValueError, match='THINKING_LEVEL_UNSUPPORTED'):
        runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'gemini-3.6-flash',
                        'thinkingLevel': 'ultra', 'modelMetadata': _thinking_metadata('effort', ['low', 'medium', 'high'], 'high')})
    assert runtime.store.list(100) == [], 'phiên bị từ chối không được tạo'
    store.close()


@pytest.mark.parametrize('thinking_type,levels', [('fixed', []), ('none', [])])
def test_session_create_drops_thinking_level_when_model_publishes_none(tmp_path, thinking_type, levels):
    """Model không có điều khiển thinking (`fixed`/`none`) thì DROP, không báo lỗi."""
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'gemini-3.6-flash-high',
                              'thinkingLevel': 'high', 'modelMetadata': _thinking_metadata(thinking_type, levels, 'high')})
    assert 'thinkingLevel' not in session['config']['route'], 'giá trị provider bỏ qua không được lưu'
    assert session['config']['route']['modelId'] == 'gemini-3.6-flash-high'
    store.close()


def test_session_create_drops_thinking_level_when_metadata_has_no_levels(tmp_path):
    """Metadata có mặt nhưng không kèm danh sách mức → cũng là "không công bố mức"."""
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'mystery',
                              'thinkingLevel': 'high', 'modelMetadata': {'contextWindow': 200_000}})
    assert 'thinkingLevel' not in session['config']['route']
    store.close()


def _turn_response():
    return {'choices': [{'message': {'content': 'done'}, 'finish_reason': 'stop'}]}


def test_turn_route_normalizes_published_and_drops_unpublished_thinking_level(tmp_path):
    """UI gửi `thinkingLevel` ở MỖI lượt: route của lượt cũng phải được đối chiếu."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        responses = [_turn_response(), _turn_response()]
        runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel(responses))
        effort = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'gemini-3.6-flash',
                                 'modelMetadata': _thinking_metadata('effort', ['low', 'medium', 'high'], 'high', 'gemini-3.6-flash')})
        await runtime.submit(effort['id'], 'hello', None,
                             {'connectionId': 'c1', 'modelId': 'gemini-3.6-flash', 'thinkingLevel': 'HIGH'})
        await runtime.tasks[effort['id']]
        assert store.get(effort['id'])['config']['route']['thinkingLevel'] == 'high'

        fixed = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'gemini-3.6-flash-high',
                                'modelMetadata': _thinking_metadata('fixed', [], 'high', 'gemini-3.6-flash-high')})
        await runtime.submit(fixed['id'], 'hello', None,
                             {'connectionId': 'c1', 'modelId': 'gemini-3.6-flash-high', 'thinkingLevel': 'high'})
        await runtime.tasks[fixed['id']]
        assert 'thinkingLevel' not in store.get(fixed['id'])['config']['route']
        store.close()

    asyncio.run(run())


def test_turn_route_rejects_unsupported_thinking_level(tmp_path):
    """Mức sai gửi kèm lượt bị từ chối, KHÔNG được lưu vào route của phiên."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
        session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'gemini-3.6-flash',
                                  'modelMetadata': _thinking_metadata('effort', ['low', 'medium', 'high'], 'high', 'gemini-3.6-flash')})
        with pytest.raises(ValueError, match='THINKING_LEVEL_UNSUPPORTED'):
            await runtime.submit(session['id'], 'hello', None,
                                 {'connectionId': 'c1', 'modelId': 'gemini-3.6-flash', 'thinkingLevel': 'ultra'})
        assert 'thinkingLevel' not in store.get(session['id'])['config']['route']
        assert store.get(session['id'])['status'] != 'running', 'lượt bị từ chối không được chạy'
        store.close()

    asyncio.run(run())


def test_session_create_uses_router_metadata_context_window(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'claude-opus-4-6-thinking',
                              'modelMetadata': {'contextWindow': 1_000_000, 'thinkingType': 'effort'}})
    assert session['config']['contextWindow'] == 1_000_000
    store.close()


def test_claude_code_dispatch_requires_setup_instead_of_child_failed(tmp_path, monkeypatch):
    """A missing CLI must produce SETUP_REQUIRED and must not create a child session."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        executor = FixtureExecutor()
        runtime = HarnessRuntime(store, executor, FixtureModel())
        runtime.commands.configure({'enabled': list(runtime.catalog.items), 'revision': 0})
        enabled = runtime.commands.settings()['enabled']
        session = runtime.create({'skills': [], 'subagents': []})
        resolved = runtime.commands.resolve('/claude-code List the files.', enabled)

        async def fake_probe(self):
            return {'executor': 'claude-code', 'status': 'setup_required', 'binary': False,
                    'reason': 'Install Claude Code inside the sandbox, then sign in there.'}

        monkeypatch.setattr('agentbox.sandbox.claude_executor.ClaudeExecutor.probe', fake_probe)
        # _command_task records failures as an error event instead of raising to the caller.
        await runtime._command_task(session['id'], resolved, None)
        events = runtime.store.events(session['id'])
        errors = [event for event in events if event['type'] == 'error']
        assert errors, 'a setup failure must be reported to the user'
        assert 'SETUP_REQUIRED' in errors[0]['data']['message']
        assert 'Install Claude Code inside the sandbox' in errors[0]['data']['message']
        children = store.db.execute('SELECT id FROM sessions WHERE parent_id=?', (session['id'],)).fetchall()
        assert list(children) == [], 'no child session may be created when the CLI is missing'
        store.close()

    asyncio.run(run())


def test_claude_code_role_is_decoupled_from_executor():
    """The CLI transport must not force a role: the role table is overridable."""
    from agentbox.skills.commands import CLI_DEFAULT_ROLES

    assert CLI_DEFAULT_ROLES['claude-code'] == 'build'
    store = None
    try:
        import tempfile
        from pathlib import Path
        from agentbox.skills.commands import CommandRegistry
        from agentbox.skills.catalog import SkillCatalog
        with tempfile.TemporaryDirectory() as tmp:
            store = SessionStore(Path(tmp) / 'commands.db')
            registry = CommandRegistry(store, SkillCatalog())
            registry.configure({'enabled': list(registry.catalog.items), 'revision': 0})
            resolved = registry.resolve('/claude-code List the files.')
            assert resolved.executor == 'claude-code'
            assert resolved.role == CLI_DEFAULT_ROLES['claude-code']
            custom = registry.save({'slug': 'delegate', 'template': 'Do $ARGUMENTS', 'role': 'review',
                                    'executor': 'claude-code', 'skills': []})
            assert custom['role'] == 'review'
    finally:
        if store is not None:
            store.close()


def test_probe_reason_is_surfaced_for_the_ui():
    """The SETUP_REQUIRED message must carry the actionable reason from the probe."""
    reason = 'Install Claude Code inside the sandbox, then sign in there.'
    assert json.dumps({'error': 'SETUP_REQUIRED: ' + reason}).count('SETUP_REQUIRED') == 1

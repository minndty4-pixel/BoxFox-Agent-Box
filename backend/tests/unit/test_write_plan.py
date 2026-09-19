"""write_plan: the sandbox picks the next free version and the harness reports it honestly.

Contract: docs/plan/next-batch-contract.md §1 (plan_written + ui_intent).
"""
import asyncio
import copy
import json

import pytest

import agentbox.sandbox.worker as worker
from agentbox.agent_core.runtime import HarnessRuntime, plan_identity, plan_slug, plan_title
from agentbox.memory.session_store import SessionStore

PLAN_MARKDOWN = '# Workspace plan\n\n- step 1\n'


def answer(text='done', calls=None, finish='stop'):
    return {'choices': [{'message': {'content': text, **({'tool_calls': calls} if calls else {})},
                         'finish_reason': 'tool_calls' if calls else finish}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2}}


def call(name, args, cid='c1'):
    return {'id': cid, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


class FixtureModel:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append(copy.deepcopy((messages, tools, route)))
        return next(self.responses)


class PlanFixtureExecutor:
    """Stands in for the sandbox worker: confirms the same metadata the real container returns.

    Note the `identity` field: like the real worker it is the file stem (`vN-slug`), and the harness must
    ignore it — the published `plan_written.identity` is derived from the confirmed `relativePath`.
    """

    def __init__(self, versions=()):
        self.calls = []
        self.used = set(versions)

    async def execute(self, name, args, sid):
        self.calls.append((name, args, sid))
        assert name == 'write_plan', 'write_plan must go through the sandbox executor'
        version = max(self.used or {0}) + 1
        self.used.add(version)
        return {'content': 'Written ' + args['slug'], 'identity': f"v{version}-{args['slug']}", 'version': version,
                'slug': args['slug'], 'relativePath': f".plans/v{version}-{args['slug']}.md",
                'bytes': len(args['markdown'].encode('utf-8'))}

    async def cleanup(self, sid):
        return None


class NestedPlanExecutor(PlanFixtureExecutor):
    """A sandbox that nests the plan under `.plans/<dir>/`, which plan_files.py groups as `dir/slug`."""

    async def execute(self, name, args, sid):
        self.calls.append((name, args, sid))
        return {'content': 'Written docs/docs', 'identity': 'v1-docs', 'version': 1, 'slug': 'docs',
                'relativePath': '.plans/docs/v1-docs.md', 'title': 'Docs',
                'bytes': len(args['markdown'].encode('utf-8'))}

    async def cleanup(self, sid):
        return None


class SilentExecutor(PlanFixtureExecutor):
    async def execute(self, name, args, sid):
        raise AssertionError('the sandbox must not be called: ' + name)


def events_of(store, sid, kind):
    return [event for event in store.events(sid) if event['type'] == kind]


def tool_results(store, sid):
    return [json.loads(message['content']) for message in store.get(sid)['messages'] if message['role'] == 'tool']


def test_write_plan_emits_plan_written_then_ui_intent(tmp_path):
    """The next free version is used and the two events are emitted in the contract's order."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        executor = PlanFixtureExecutor()
        model = FixtureModel([
            answer('Viết plan', calls=[call('write_plan', {'slug': 'Workspace Plan', 'markdown': PLAN_MARKDOWN, 'title': ''})]),
            answer('Đã ghi plan'),
            answer('Viết tiếp', calls=[call('write_plan', {'slug': 'workspace-plan', 'markdown': 'v2 body'})]),
            answer('Đã ghi bản 2')])
        runtime = HarnessRuntime(store, executor, model)
        sid = runtime.create({'skills': []})['id']

        await runtime.start(sid, 'Lên plan')
        calls = [(name, args, call_sid) for name, args, call_sid in executor.calls]
        assert [name for name, _, _ in calls] == ['write_plan']
        name, args, call_sid = calls[0]
        assert args['slug'] == 'workspace-plan', 'the slug must be normalized before it reaches the sandbox'
        assert args['markdown'] == PLAN_MARKDOWN and call_sid == sid

        written = events_of(store, sid, 'plan_written')
        assert len(written) == 1
        assert set(written[0]['data']) == {'identity', 'version', 'slug', 'relativePath', 'title', 'bytes'}
        assert written[0]['data'] == {'identity': 'workspace-plan', 'version': 1, 'slug': 'workspace-plan',
                                      'relativePath': '.plans/v1-workspace-plan.md', 'title': 'Workspace plan',
                                      'bytes': len(PLAN_MARKDOWN.encode('utf-8'))}
        intent = events_of(store, sid, 'ui_intent')
        assert len(intent) == 1
        assert intent[0]['data'] == {'tab': 'plan', 'target': {'identity': 'workspace-plan', 'version': 1},
                                     'reason': 'plan_written'}
        assert intent[0]['seq'] == written[0]['seq'] + 1, 'ui_intent must follow plan_written immediately'

        seen = tool_results(store, sid)[-1]
        assert not seen.get('is_error')
        assert seen['relativePath'] == '.plans/v1-workspace-plan.md' and seen['version'] == 1
        assert seen['title'] == 'Workspace plan'

        # a second plan in the same session never reuses v1
        await runtime.start(sid, 'Lên plan bản 2')
        assert [event['data']['relativePath'] for event in events_of(store, sid, 'plan_written')] == \
            ['.plans/v1-workspace-plan.md', '.plans/v2-workspace-plan.md']
        assert [event['data']['target']['identity'] for event in events_of(store, sid, 'ui_intent')] == \
            ['workspace-plan', 'workspace-plan'], 'identity is the reader key, never version-qualified'
        assert [event['data']['target']['version'] for event in events_of(store, sid, 'ui_intent')] == [1, 2], \
            'the version disambiguates two writes of the same plan'
        assert [event['data']['identity'] for event in events_of(store, sid, 'plan_written')] == \
            ['workspace-plan', 'workspace-plan']
        assert store.get(sid)['status'] == 'completed'
        store.close()

    asyncio.run(run())


def test_nested_plan_target_uses_the_reader_identity_and_version(tmp_path):
    """A nested plan must be targetable by the (identity, version) pair `GET /__box/plans` returns."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        runtime = HarnessRuntime(store, NestedPlanExecutor(), FixtureModel([
            answer(calls=[call('write_plan', {'slug': 'docs', 'markdown': PLAN_MARKDOWN, 'title': 'Docs'})]),
            answer('Đã ghi plan')]))
        sid = runtime.create({'skills': []})['id']

        await runtime.start(sid, 'Ghi plan')
        written = events_of(store, sid, 'plan_written')
        assert written[0]['data'] == {'identity': 'docs/docs', 'version': 1, 'slug': 'docs',
                                      'relativePath': '.plans/docs/v1-docs.md', 'title': 'Docs',
                                      'bytes': len(PLAN_MARKDOWN.encode('utf-8'))}
        assert events_of(store, sid, 'ui_intent')[0]['data'] == \
            {'tab': 'plan', 'target': {'identity': 'docs/docs', 'version': 1}, 'reason': 'plan_written'}
        assert tool_results(store, sid)[-1]['relativePath'] == '.plans/docs/v1-docs.md'
        store.close()

    asyncio.run(run())


def test_write_plan_rejects_an_unusable_slug(tmp_path):
    """A slug that cannot be a plan filename fails loudly and never reaches the sandbox."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        model = FixtureModel([answer(calls=[call('write_plan', {'slug': '###', 'markdown': PLAN_MARKDOWN})]),
                              answer('Không ghi được plan')])
        runtime = HarnessRuntime(store, SilentExecutor(), model)
        sid = runtime.create({'skills': []})['id']

        await runtime.start(sid, 'Ghi plan')
        assert events_of(store, sid, 'plan_written') == []
        assert events_of(store, sid, 'ui_intent') == []
        failures = [result for result in tool_results(store, sid) if result.get('is_error')]
        assert failures and 'PLAN_SLUG_INVALID' in failures[0]['error']
        assert store.get(sid)['status'] == 'completed', 'the agent keeps going after a refused plan'
        store.close()

    asyncio.run(run())


def test_write_plan_refuses_a_lying_sandbox(tmp_path):
    """plan_written is never emitted unless the sandbox confirms a real plan path."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')

        class Lying(PlanFixtureExecutor):
            async def execute(self, name, args, sid):
                return {'content': 'ok'}

        runtime = HarnessRuntime(store, Lying(), FixtureModel([
            answer(calls=[call('write_plan', {'slug': 'workspace-plan', 'markdown': PLAN_MARKDOWN})]),
            answer('Bỏ qua')]))
        sid = runtime.create({'skills': []})['id']

        await runtime.start(sid, 'Ghi plan')
        assert events_of(store, sid, 'plan_written') == []
        assert events_of(store, sid, 'ui_intent') == []
        failures = [result for result in tool_results(store, sid) if result.get('is_error')]
        assert failures and 'PLAN_WRITE_FAILED' in failures[0]['error']
        store.close()

        # a path the plan reader would ignore is not a plan: no identity can be derived from it, so refuse
        other = SessionStore(tmp_path / 'off-path.db')

        class OffPath(PlanFixtureExecutor):
            async def execute(self, name, args, sid):
                return {'content': 'ok', 'version': 1, 'relativePath': '.plans/Bad Dir/v1-x.md'}

        runtime = HarnessRuntime(other, OffPath(), FixtureModel([
            answer(calls=[call('write_plan', {'slug': 'x', 'markdown': PLAN_MARKDOWN})]),
            answer('Bỏ qua')]))
        sid = runtime.create({'skills': []})['id']

        await runtime.start(sid, 'Ghi plan')
        assert events_of(other, sid, 'plan_written') == []
        assert events_of(other, sid, 'ui_intent') == []
        assert 'PLAN_WRITE_FAILED' in [result['error'] for result in tool_results(other, sid)
                                       if result.get('is_error')][0]
        other.close()

    asyncio.run(run())


def test_plan_slug_and_title_helpers():
    assert plan_slug('  Workspace  Plan v2 ') == 'workspace-plan-v2'
    assert plan_slug('Kế hoạch') == 'k-ho-ch'
    for bad in ('', '   ', '###', '---'):
        with pytest.raises(ValueError, match='PLAN_SLUG_INVALID'):
            plan_slug(bad)
    assert plan_title('', PLAN_MARKDOWN, 'workspace-plan') == 'Workspace plan'
    assert plan_title('My own title', '# Ignored\n', 'workspace-plan') == 'My own title'
    assert plan_title('', 'no heading here', 'workspace-plan') == 'Workspace plan'


def test_plan_identity_helper_mirrors_the_plan_reader():
    """plan_files.py:315-321 identity: bare slug at the root of .plans/, `dir/slug` when nested, never `vN-`."""
    assert plan_identity('.plans/v2-workspace-plan.md') == 'workspace-plan'
    assert plan_identity('.plans/docs/v1-docs.md') == 'docs/docs'
    assert plan_identity('.plans/a/b/v7-pilot.md') == 'a/b/pilot'
    for reader_ignored in ('.plans/v1-Bad.md', '.plans/Bad Dir/v1-x.md', 'plans/v1-x.md', '.plans/v1-x.txt', '', None):
        assert plan_identity(reader_ignored) == '', 'a path the reader ignores has no identity: ' + repr(reader_ignored)
    assert 'v2-' not in plan_identity('.plans/v2-workspace-plan.md'), 'identity must never carry the version prefix'


def test_worker_write_plan_picks_the_next_free_version(tmp_path, monkeypatch):
    """The sandbox writer never overwrites a version and only produces names plan_files.py accepts."""
    monkeypatch.setattr(worker, 'ROOT', tmp_path)

    first = worker.execute('write_plan', {'slug': 'workspace-plan', 'markdown': PLAN_MARKDOWN}, 'session')
    assert first['relativePath'] == '.plans/v1-workspace-plan.md'
    # the sandbox's own `identity` is its file stem; the harness publishes plan_identity(relativePath) instead
    assert first['identity'] == 'v1-workspace-plan' and first['version'] == 1 and first['slug'] == 'workspace-plan'
    assert first['bytes'] == len(PLAN_MARKDOWN.encode('utf-8'))
    assert (tmp_path / '.plans' / 'v1-workspace-plan.md').read_text(encoding='utf-8') == PLAN_MARKDOWN

    second = worker.execute('write_plan', {'slug': 'workspace-plan', 'markdown': 'second body'}, 'session')
    assert second['relativePath'] == '.plans/v2-workspace-plan.md'

    # an existing higher version (from anywhere) pushes the next free number, and is left untouched
    (tmp_path / '.plans' / 'v5-other.md').write_text('other plan', encoding='utf-8')
    third = worker.execute('write_plan', {'slug': 'other', 'markdown': 'third body'}, 'session')
    assert third['relativePath'] == '.plans/v6-other.md'
    assert (tmp_path / '.plans' / 'v5-other.md').read_text(encoding='utf-8') == 'other plan'
    assert (tmp_path / '.plans' / 'v1-workspace-plan.md').read_text(encoding='utf-8') == PLAN_MARKDOWN
    assert sorted(item.name for item in (tmp_path / '.plans').iterdir()) == \
        ['v1-workspace-plan.md', 'v2-workspace-plan.md', 'v5-other.md', 'v6-other.md']
    assert worker.PLAN_FILENAME.fullmatch('v6-other.md'), 'names must match deploy/docker/plan_files.py:18-22'


def test_worker_write_plan_refuses_bad_slug_and_empty_content(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, 'ROOT', tmp_path)
    with pytest.raises(ValueError, match='slug'):
        worker.execute('write_plan', {'slug': 'Bad Slug', 'markdown': PLAN_MARKDOWN}, 'session')
    with pytest.raises(ValueError, match='empty'):
        worker.execute('write_plan', {'slug': 'good-slug', 'markdown': '   '}, 'session')
    with pytest.raises(ValueError, match='1 MiB'):
        worker.execute('write_plan', {'slug': 'good-slug', 'markdown': 'x' * 1048577}, 'session')
    assert not (tmp_path / '.plans').exists(), 'a refused plan must not create the folder'

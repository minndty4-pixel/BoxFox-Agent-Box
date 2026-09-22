"""Delegation must have a contract: a stated result shape, a bounded child answer and real evidence.

The owner asked for a plan for a "patient record lookup agent" and the child's free-form answer was
useless: no evidence, no verification, and nothing bounded the text. These tests pin the fix —
delegate_task now demands a result shape, the child prompt ends with the result contract, and every
child string is bounded before it reaches the event stream or the parent's tool result.
"""
import asyncio
import copy
import json

from agentbox.agent_core.runtime import (CHILD_ANSWER_MAX_CHARS, CHILD_ECHO_MAX_CHARS,
                                         CHILD_EXPECT_MAX_CHARS, CHILD_RESULT_CONTRACT, HarnessRuntime)
from agentbox.agent_core.tool_contracts import SCHEMAS
from agentbox.memory.session_store import SessionStore

BIG_CONTEXT = 'C' * 20000


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


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def delegate_args(**overrides):
    args = {'role': 'research', 'goal': 'Find out how FHIR Patient search works'}
    args.update(overrides)
    return args


def run_delegation(tmp_path, delegate_task_args, child_answer, parent_values=None):
    """Parent delegates once, the child answers with `child_answer`, the parent finishes."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        model = FixtureModel([answer(calls=[call('delegate_task', delegate_task_args)]),
                              answer(child_answer), answer('parent final')])
        runtime = HarnessRuntime(store, FixtureExecutor(), model)
        sid = runtime.create({'skills': [], **(parent_values or {})})['id']
        await runtime.start(sid, 'Delegate to a specialist')
        child_events = [event['data'] for event in store.events(sid) if event['type'] == 'child']
        tool_messages = [message for message in store.get(sid)['messages'] if message['role'] == 'tool']
        child = store.get(child_events[0]['sessionId'])
        store.close()
        return child_events, tool_messages, child

    return asyncio.run(run())


def test_delegate_task_schema_states_the_result_shape_and_stays_backward_compatible():
    schema = next(s for s in SCHEMAS if s['function']['name'] == 'delegate_task')['function']
    properties = schema['parameters']['properties']
    assert set(properties) == {'role', 'goal', 'context', 'expect'}
    assert schema['parameters']['required'] == ['role', 'goal'], \
        'existing callers send role/goal/context only: nothing new may become required'
    for name, spec in properties.items():
        assert spec.get('description', '').strip(), f'{name} must describe itself'
    assert properties['role']['enum'] == ['explore', 'plan', 'design', 'build', 'debug', 'review',
                                          'simplify', 'testing', 'research']
    assert 'RESULT SHAPE' in properties['expect']['description']
    assert 'RESULT SHAPE' in schema['description'] and 'evidence' in schema['description']
    # the only web-capable role is named where the parent chooses it, together with its limits
    assert 'research' in properties['role']['description']
    assert 'web_search' in properties['role']['description']
    assert 'could not verify' in properties['role']['description']


def test_child_prompt_carries_the_result_contract_and_the_parents_expected_shape(tmp_path):
    expect = 'Return the FHIR search parameters with the exact doc URL, plus the command you ran.'
    child_events, _, child = run_delegation(
        tmp_path, delegate_args(context='Earlier phase: the repo has no FHIR client.', expect=expect),
        'short child answer')
    prompt = [message['content'] for message in child['messages'] if message['role'] == 'user'][-1]
    assert 'Find out how FHIR Patient search works' in prompt, 'the goal must survive'
    assert 'Earlier phase: the repo has no FHIR client.' in prompt, 'the parent context must survive'
    assert expect in prompt, 'the parent-stated result shape must reach the child verbatim'
    for section in ('## Findings', '## Evidence', '## Verification performed', '## Limitations & open questions'):
        assert section in prompt, f'the result contract must require {section}'
    assert 'Never claim success without evidence' in prompt
    assert prompt.endswith(CHILD_RESULT_CONTRACT)
    # bounded growth: the contract is a fixed-size suffix, the parent's shape is capped
    assert len(CHILD_RESULT_CONTRACT) <= 1200
    assert len(prompt) <= len('Find out how FHIR Patient search works') + 16000 + CHILD_EXPECT_MAX_CHARS \
        + len(CHILD_RESULT_CONTRACT) + 64


def test_child_budget_is_clamped_by_the_parent_and_by_the_engine_ceiling(tmp_path):
    """B6 — con 40 bước / 300 s, nhưng KHÔNG BAO GIỜ vượt cha (luật `min()` giữ nguyên).

    `300 s` là **trần**, không phải bảo đảm: hạn chót mặc định của cha là 180 s nên lượt mặc
    định luôn kẹp con xuống 180 s — không lượt nào thực sự dài thêm vì con.
    """
    cases = [
        ({'maxSteps': 60, 'deadlineSeconds': 600}, 40, 300),
        ({'maxSteps': 12, 'deadlineSeconds': 60}, 12, 60),
        ({}, 40, 180),
    ]
    for parent_values, steps, seconds in cases:
        _, _, child = run_delegation(tmp_path / f"p{steps}-{seconds}", delegate_args(),
                                     'child answer', parent_values=parent_values)
        assert child['config']['maxSteps'] == steps, parent_values
        assert child['config']['deadlineSeconds'] == seconds, parent_values


def test_a_runaway_child_answer_is_bounded_and_reported_honestly(tmp_path):
    child_events, tool_messages, child = run_delegation(tmp_path, delegate_args(), 'x' * 30000)
    started, finished = child_events[0], child_events[-1]
    assert started['status'] == 'started' and 'summary' not in started
    assert finished['truncated'] is True
    assert finished['answerChars'] == 30000, 'the parent is told the real size of the answer'
    assert len(finished['summary']) <= CHILD_ANSWER_MAX_CHARS + 100
    assert finished['summary'].endswith('the full text stays in the child transcript.]')
    assert finished['is_error'] is False and finished['status'] == 'completed'
    # the child transcript keeps the whole answer: only the copies are bounded
    assert len([m for m in child['messages'] if m['role'] == 'assistant'][-1]['content']) == 30000
    assert json.loads(tool_messages[-1]['content'])['truncated'] is True


def test_a_normal_child_answer_is_not_marked_as_truncated(tmp_path):
    child_events, tool_messages, _ = run_delegation(tmp_path, delegate_args(), 'child evidence')
    finished = child_events[-1]
    assert finished['summary'] == 'child evidence'
    assert finished['truncated'] is False
    assert finished['answerChars'] == len('child evidence')
    assert json.loads(tool_messages[-1]['content'])['summary'] == 'child evidence'


def test_a_huge_parent_context_never_mangles_the_delegation_result(tmp_path):
    """Echoes are bounded, so the parent's tool result stays parseable instead of hitting the 20000 clamp."""

    child_events, tool_messages, child = run_delegation(
        tmp_path, delegate_args(context=BIG_CONTEXT, expect='E' * 5000), 'y' * 9000)
    started, finished = child_events[0], child_events[-1]
    assert len(started['context']) <= CHILD_ECHO_MAX_CHARS + 100, 'the echo is bounded'
    assert len(started['prompt']) <= CHILD_ECHO_MAX_CHARS + 100
    assert len(finished['goal']) <= CHILD_ECHO_MAX_CHARS + 100
    assert len(json.dumps(finished)) < 20000, 'the parent-facing result must fit without the tool-output clamp'
    content = tool_messages[-1]['content']
    assert len(content) < 20000 and '[Output bounded' not in content
    payload = json.loads(content)
    assert payload['status'] == 'completed' and payload['answerChars'] == 9000
    assert payload['tools_run'] == [] and payload['sessionId'] == finished['sessionId']
    # data fidelity: only the copies are bounded — the child really received the full 16000-char context
    prompt = [message['content'] for message in child['messages'] if message['role'] == 'user'][-1]
    assert BIG_CONTEXT[:16000] in prompt
    assert 'E' * 2000 in prompt, "the parent's result shape reaches the child at full length of its own cap"

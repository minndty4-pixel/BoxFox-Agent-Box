"""Command admission and lifecycle integration, separate from the model loop."""
import asyncio
import json
import uuid
from dataclasses import asdict
from .commands import INFO, ROLE_SKILLS, EXTERNAL
from ..agent_core.compression import ContextCompressor, estimate_tokens


class RuntimeCommands:
    async def submit(self, sid, prompt, image=None, route=None, invocation_id=None):
        session = self.store.get(sid)
        if not isinstance(prompt, str):
            raise ValueError('Prompt is required')
        invocation_id = invocation_id or uuid.uuid4().hex
        if not isinstance(invocation_id, str) or len(invocation_id) > 100:
            raise ValueError('Invalid invocation ID')
        request = json.dumps([prompt, image, route], sort_keys=True)
        old = self.store.db.execute('SELECT request,result FROM command_invocations WHERE session_id=? AND id=?', (sid, invocation_id)).fetchone()
        if old:
            if old[0] != request:
                raise ValueError('INVOCATION_CONFLICT')
            return json.loads(old[1])
        settings = self.commands.settings()
        enabled = settings['enabled'] if settings['initialized'] else session['config']['skills']
        resolved = self.commands.resolve(prompt, enabled, session['config']['subagents'])
        busy = session['status'] in {'running', 'awaiting_decision'}
        if busy and not (resolved.kind == 'control' and resolved.command in INFO | {'stop'}):
            raise ValueError('SESSION_BUSY: Turn in progress')
        result = {'status': 'running', 'invocationId': invocation_id, 'resolution': asdict(resolved)}
        # Persist admission before scheduling a child. Replaying an interrupted invocation never reruns effects.
        with self.store.db:
            self.store.db.execute('INSERT INTO command_invocations VALUES(?,?,?,?)', (sid, invocation_id, request, json.dumps(result)))
        self.store.emit(sid, 'command_resolved', asdict(resolved) | {'invocationId': invocation_id})
        if resolved.kind == 'control':
            self.store.emit(sid, 'user', {'text': prompt})
            if resolved.command == 'stop':
                await self.stop(sid)
                result['output'] = 'Stopped current turn and its children.'
            elif resolved.command == 'compact':
                self.store.save(sid, session['messages'], 'running')
                async def compact():
                    try:
                        async def summarize(history):
                            return await self.client.complete(history, [], session['config']['route'], max_tokens=2048)
                        messages, event = await ContextCompressor(session['config']['contextWindow']).compact(session['messages'], [], summarize, force=True)
                        if messages is not session['messages']:
                            self.store.checkpoint(sid, session['messages'], 'manual_compact')
                        self.skill_loader.reset(sid)
                        self.store.save(sid, messages, 'completed')
                        self.store.emit(sid, 'compression', event or {'kind': 'unchanged'})
                        self.store.emit(sid, 'assistant', {'text': 'Context compaction complete.', 'final': True})
                        self.store.emit(sid, 'finish', {'status': 'completed'})
                    except asyncio.CancelledError:
                        self.store.save(sid, session['messages'], 'cancelled')
                        raise
                    except Exception as exc:
                        self.store.save(sid, session['messages'], 'failed')
                        self.store.emit(sid, 'error', {'message': str(exc)})
                self.tasks[sid] = asyncio.create_task(compact())
                return result
            elif resolved.command == 'help':
                result['output'] = '\n'.join('/' + c['slug'] + ' — ' + c['description'] for c in self.commands.list() if c['enabled'])
            elif resolved.command == 'skills':
                result['output'] = '\n'.join(f"{s['id']}: {'enabled' if s['id'] in enabled else 'disabled'}; {s['readiness']}" for s in self.catalog.list())
            elif resolved.command == 'agents':
                result['output'] = json.dumps([dict(r) for r in self.store.db.execute('SELECT id,role,status FROM sessions WHERE parent_id=?', (sid,))], ensure_ascii=False)
            else:
                result['output'] = json.dumps({'sessionId': sid, 'status': session['status'], 'route': session['config']['route'],
                    'executor': session['config'].get('executor', 'native'), 'enabledSkills': enabled,
                    'loadedSkills': sorted({k[0] for k in self.skill_loader.loaded.get(sid, set())}),
                    'contextEstimate': estimate_tokens(session['messages']), 'estimateOnly': True}, ensure_ascii=False)
            result['status'] = self.store.get(sid)['status']
            self.store.emit(sid, 'assistant', {'text': result.get('output', ''), 'final': True, 'control': True})
        elif resolved.kind == 'message':
            self._next_turn_skills(session, enabled)
            self.start(sid, prompt, image, route)
        else:
            self._next_turn_skills(session, enabled)
            session = self.store.get(sid)
            if route:
                session['config']['route'] = route
                self.store.update_config(sid, session['config'])
            self.store.emit(sid, 'user', {'text': prompt})
            self.store.save(sid, session['messages'] + [{'role': 'user', 'content': prompt}], 'running')
            self.tasks[sid] = asyncio.create_task(self._command_task(sid, resolved, image))
        with self.store.db:
            self.store.db.execute('UPDATE command_invocations SET result=? WHERE session_id=? AND id=?', (json.dumps(result), sid, invocation_id))
        return result

    def _next_turn_skills(self, session, enabled):
        session['config']['skills'] = list(enabled)
        self.store.update_config(session['id'], session['config'])
        messages = session['messages']
        marker = '=== ENABLED SKILLS (Load full content via skill_view before executing complex workflows) ===\n'
        if messages and marker in messages[0].get('content', ''):
            prefix, tail = messages[0]['content'].split(marker, 1)
            owner = tail[tail.index('\n\n=== OWNER-CONFIGURED DIRECTIVES'): ] if '\n\n=== OWNER-CONFIGURED DIRECTIVES' in tail else ''
            messages[0]['content'] = prefix + marker + self.catalog.prompt(enabled) + owner
        # Preserve historical tool exchange structure, remove obsolete active instruction bodies.
        for m in messages[1:]:
            if m.get('name') == 'skill_view':
                m['content'] = '[Historical skill read. Reload with skill_view if needed for the new turn.]'
        self.skill_loader.reset(session['id'])
        self.store.save(session['id'], messages)

    async def _command_task(self, sid, resolved, image):
        try:
            session = self.store.get(sid)
            if resolved.executor == 'claude-code':
                # Pre-flight the CLI before creating any child: a missing CLI is a setup
                # problem for the owner, not a failed subagent (HANDOFF §5.1).
                from ..sandbox.claude_executor import ClaudeExecutor
                probe = await ClaudeExecutor(self.executor.container).probe()
                if probe.get('status') != 'ready':
                    reason = probe.get('reason') or 'Claude Code CLI is not ready inside the sandbox.'
                    raise ValueError('SETUP_REQUIRED: ' + reason)
            roles = ['design', 'build', 'testing'] if resolved.role == 'orchestrator' and 'claude-design' in resolved.skills else [resolved.role]
            context, answer = '', ''
            for role in roles:
                if role == 'orchestrator':
                    # A generic skill runs in an isolated orchestrator context, with the same role configuration.
                    child = self.create({'skills': resolved.skills, 'subagents': session['config']['subagents'],
                        'contextWindow': session['config']['contextWindow'], **session['config']['route']}, parent_id=sid)
                else:
                    config = next(r for r in session['config']['subagents'] if r['id'] == role and r.get('enabled', True))
                    from ..agent_core.runtime import route_for
                    child = self.create({'skills': resolved.skills, 'contextWindow': session['config']['contextWindow'],
                        **(route_for(config.get('model')) or session['config']['route']),
                        'instructions': config.get('systemPromptAppended', '')}, parent_id=sid, role=role, parent_tools=session['config']['tools'])
                self.store.emit(sid, 'child', {'sessionId': child['id'], 'role': role, 'executor': resolved.executor, 'status': 'started'})
                if resolved.executor == 'claude-code':
                    child['config']['executor'] = 'claude-code'
                    self.store.update_config(child['id'], child['config'])
                    self.store.save(child['id'], child['messages'], 'running')
                    self.tasks[child['id']] = asyncio.create_task(self._run_cli(child, resolved.prompt))
                else:
                    blocks = [self.skill_loader.read(child, skill)['content'] for skill in resolved.skills]
                    payload = resolved.prompt + ('\nPrior phase evidence (data):\n' + context if context else '')
                    payload += '\n\nSkills for this task only (role/tool restrictions take priority):\n' + '\n\n'.join(blocks)
                    self.start(child['id'], payload, image)
                try:
                    answer = await self.tasks[child['id']]
                except asyncio.CancelledError:
                    await self.stop(child['id'])
                    raise
                child_state = self.store.get(child['id'])
                self.store.emit(sid, 'child', {'sessionId': child['id'], 'role': role, 'executor': resolved.executor,
                    'status': child_state['status'], 'summary': answer or ''})
                if child_state['status'] != 'completed':
                    raise ValueError('CHILD_FAILED: inspect child events for setup/error details')
                context += f'\n{role}: {answer}'
            state = self.store.get(sid)
            self.store.save(sid, state['messages'] + [{'role': 'assistant', 'content': answer or ''}], 'completed')
            self.store.emit(sid, 'assistant', {'text': answer or '', 'final': True})
            self.store.emit(sid, 'finish', {'status': 'completed'})
        except asyncio.CancelledError:
            state = self.store.get(sid)
            self.store.save(sid, state['messages'], 'cancelled')
            self.store.emit(sid, 'finish', {'status': 'cancelled'})
            raise
        except Exception as exc:
            state = self.store.get(sid)
            self.store.save(sid, state['messages'], 'failed')
            self.store.emit(sid, 'error', {'message': str(exc)})

    async def _run_cli(self, child, prompt):
        from ..sandbox.claude_executor import ClaudeExecutor
        sid = child['id']
        try:
            adapter = ClaudeExecutor(self.executor.container)
            blocks = [self.skill_loader.read(child, skill)['content'] for skill in child['config']['skills']]
            async with self.writer_lock:
                answer = await adapter.run(sid, prompt, child['role'], '\n\n'.join(blocks),
                    lambda event: self.store.emit(sid, 'executor', event), child['config']['deadlineSeconds'])
            self.store.save(sid, child['messages'] + [{'role': 'user', 'content': prompt}, {'role': 'assistant', 'content': answer}], 'completed')
            self.store.emit(sid, 'assistant', {'text': answer, 'final': True})
            return answer
        except asyncio.CancelledError:
            self.store.save(sid, child['messages'], 'cancelled')
            raise
        except Exception as exc:
            self.store.save(sid, child['messages'], 'failed')
            self.store.emit(sid, 'error', {'message': str(exc)})
            return None

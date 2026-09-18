"""Only tools with an executable v0 adapter are advertised."""


def tool(name, description, properties, required=()):
    return {'type': 'function', 'function': {'name': name, 'description': description,
        'parameters': {'type': 'object', 'properties': properties, 'required': list(required)}}}


STRING = {'type': 'string'}
SCHEMAS = [
    tool('file_read', 'Read a UTF-8 file inside the sandbox workspace.', {'path': STRING}, ['path']),
    tool('file_write', 'Write a file inside the sandbox workspace.', {'path': STRING, 'content': STRING}, ['path', 'content']),
    tool('file_edit_block', 'Replace one exact block after reading the file.', {'path': STRING, 'old_text': STRING, 'new_text': STRING}, ['path', 'old_text', 'new_text']),
    tool('codebase_glob', 'List workspace files matching a relative glob.', {'pattern': STRING}),
    tool('codebase_grep', 'Find literal text in workspace files.', {'query': STRING, 'path': STRING}, ['query']),
    tool('terminal_exec', 'Run Bash inside the sandbox, never on the host. Returns exit code and output.', {'command': STRING, 'timeout': {'type': 'integer'}}, ['command']),
    tool('computer_screen_capture', 'Capture the actual sandbox display; returns an image and artifact.', {}),
    tool('computer_screen_record', 'Start/stop/status real sandbox screen recording for this session.', {'action': {'type': 'string', 'enum': ['start', 'stop', 'status']}}, ['action']),
    tool('computer_use', 'Send input to sandbox X11 display. Capture screen before deciding coordinates and after acting.',
         {'action': {'type': 'string', 'enum': ['click', 'type', 'key', 'scroll']}, 'x': {'type': 'integer'}, 'y': {'type': 'integer'}, 'text': STRING, 'key': STRING, 'direction': STRING, 'steps': {'type': 'integer'}}, ['action']),
    tool('browser_use', 'Control this session browser tab in the sandbox. Use current snapshot refs for click/fill.',
         {'action': {'type': 'string', 'enum': ['navigate', 'snapshot', 'click', 'fill', 'key', 'screenshot']}, 'url': STRING, 'ref': STRING, 'text': STRING, 'key': STRING}, ['action']),
    tool('skills_list', 'List enabled skills metadata; then load relevant full instructions with skill_view.', {}),
    tool('skill_view', 'Read a complete enabled skill or a linked UTF-8 file in its package. Scripts are not auto-executed.', {'id': STRING, 'file_path': STRING}, ['id']),
    tool('session_search', 'Search this session durable checkpoint history for a literal term.', {'query': STRING}, ['query']),
    tool('delegate_task', 'Run one enabled specialist with isolated context. Return its real result/evidence. Never assume success.',
         {'role': {'type': 'string', 'enum': ['explore', 'plan', 'design', 'build', 'debug', 'review', 'simplify', 'testing', 'research']}, 'goal': STRING, 'context': STRING}, ['role', 'goal']),
]


def schemas_for(names):
    return [s for s in SCHEMAS if s['function']['name'] in names]

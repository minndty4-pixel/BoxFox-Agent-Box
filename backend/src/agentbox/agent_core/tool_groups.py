"""Tám nhóm công cụ của runtime — bảng "Nút vặn của runtime" nói với giao diện.

Bảng này là nguồn duy nhất cho khối "Tool access" ở tab Harness: hợp của tám nhóm
phải bằng ĐÚNG bộ công cụ của orchestrator (`roles.ORCHESTRATOR_TOOLS`, 24 công cụ),
và mỗi nhóm giữ trật tự như bảng trong kế hoạch. `alwaysOn` đánh dấu nhóm không thể
tắt: hỏi người dùng và xin phép là hai công cụ quyết định (`roles.DECISION`), mọi
vai trò đều có, nên một harness tắt chúng là một harness không còn hỏi được ai.

Chỉ `runtime.py` mới quyết định bộ công cụ thật của một phiên; tệp này chỉ MÔ TẢ
cách chia nhóm, không cấp quyền gì thêm.
"""

TOOL_GROUPS = [
    {'key': 'repositoryReading',
     'tools': ['file_read', 'codebase_glob', 'codebase_grep'],
     'alwaysOn': False},
    {'key': 'skills',
     'tools': ['skills_list', 'skill_view'],
     'alwaysOn': False},
    {'key': 'filesTerminal',
     'tools': ['file_write', 'file_edit_block', 'terminal_exec'],
     'alwaysOn': False},
    {'key': 'screenBrowser',
     'tools': ['computer_screen_capture', 'computer_screen_record', 'computer_use',
               'browser_use', 'inspect_element'],
     'alwaysOn': False},
    {'key': 'webResearch',
     'tools': ['web_search', 'web_fetch', 'read_source', 'paper_citations'],
     'alwaysOn': False},
    {'key': 'delegationPlans',
     'tools': ['delegate_task', 'session_search', 'write_plan', 'plan_verify', 'journal_write', 'journal_brief'],
     'alwaysOn': False},
    {'key': 'peerMesh',
     'tools': ['peer_read', 'await_children'],
     'alwaysOn': False},
    {'key': 'questionsApprovals',
     'tools': ['ask_user', 'request_approval'],
     'alwaysOn': True},
]


def tool_groups():
    """Bản sao cho route: người gọi không sửa được bảng gốc trong module."""
    return [{'key': group['key'], 'tools': list(group['tools']), 'alwaysOn': group['alwaysOn']}
            for group in TOOL_GROUPS]

"""Test-session defaults.

The developer system log (``~/BoxFox/logs``) is production evidence: a unit
test must never append to it. ``SystemLog`` reads the directory when the shared
instance is created, so this file has to set the variable before any
``agentbox`` import happens — pytest imports ``conftest.py`` first.
"""
from __future__ import annotations

import os
import tempfile

os.environ.setdefault(
    'BOXFOX_SYSTEM_LOG_DIR',
    tempfile.mkdtemp(prefix='boxfox-test-logs-'),
)

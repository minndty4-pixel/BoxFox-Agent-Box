"""Developer-facing observability: the host-side system log (invisible to the box).

The shared writer instance lives in `agentbox.observability.system_log.system_log`;
import it from that module so this package does not shadow the submodule name.
"""

from .system_log import SystemLog  # noqa: F401

__all__ = ['SystemLog']

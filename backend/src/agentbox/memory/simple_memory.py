"""Simple In-Memory Session Storage for BoxFox Agent Box.

Supports both stateless (no-memory, 1-turn) mode and stateful multi-turn history.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ChatMessage:
    """A message in an agent chat session."""
    role: str  # "system", "user", "assistant", "tool"
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"role": self.role}
        if self.content is not None:
            d["content"] = self.content
        if self.tool_calls:
            d["tool_calls"] = self.tool_calls
        if self.tool_call_id:
            d["tool_call_id"] = self.tool_call_id
        if self.name:
            d["name"] = self.name
        return d


class SimpleSessionMemory:
    """Stores conversation turns in memory. Can be cleared or configured for 1-turn mode."""

    def __init__(self, is_stateless: bool = False) -> None:
        self.is_stateless = is_stateless
        self.messages: List[ChatMessage] = []

    def add_message(
        self,
        role: str,
        content: Optional[str] = None,
        tool_calls: Optional[List[Dict[str, Any]]] = None,
        tool_call_id: Optional[str] = None,
        name: Optional[str] = None,
    ) -> ChatMessage:
        msg = ChatMessage(
            role=role,
            content=content,
            tool_calls=tool_calls,
            tool_call_id=tool_call_id,
            name=name,
        )
        self.messages.append(msg)
        return msg

    def get_messages(self) -> List[Dict[str, Any]]:
        """Return messages formatted for OpenAI-compatible chat payload."""
        if self.is_stateless:
            # If stateless (no memory), only return system prompt (if any) and last user/assistant turn
            if not self.messages:
                return []
            # Keep system message and the last user-initiated interaction
            system_msgs = [m.to_dict() for m in self.messages if m.role == "system"]
            non_system = [m.to_dict() for m in self.messages if m.role != "system"]
            return system_msgs + non_system[-3:] if len(non_system) > 3 else [m.to_dict() for m in self.messages]
        return [m.to_dict() for m in self.messages]

    def clear(self) -> None:
        self.messages.clear()

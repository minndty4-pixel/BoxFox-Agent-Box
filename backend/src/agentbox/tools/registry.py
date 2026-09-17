"""Tool Registry for BoxFox Agent Box.

Manages tool registration, lookup, permission inspection, and schema generation
for Model Routers and Agent Core.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Type

from .base import BaseTool, RiskTier

logger = logging.getLogger(__name__)


class ToolRegistry:
    """Registry that holds all available tools for BoxFox agents."""

    def __init__(self) -> None:
        self._tools: Dict[str, BaseTool] = {}
        self._risk_tiers: Dict[str, RiskTier] = {}

    def register(self, tool: BaseTool) -> BaseTool:
        """Register a tool instance."""
        if tool.name in self._tools:
            logger.debug(f"Overwriting existing tool registration: '{tool.name}'")
        self._tools[tool.name] = tool
        self._risk_tiers[tool.name] = tool.risk_tier
        return tool

    def get(self, name: str) -> Optional[BaseTool]:
        """Get a tool by name."""
        return self._tools.get(name)

    def has(self, name: str) -> bool:
        """Check if a tool exists."""
        return name in self._tools

    def list_tools(self) -> List[BaseTool]:
        """Get all registered tools."""
        return list(self._tools.values())

    def list_names(self) -> List[str]:
        """Get all registered tool names."""
        return list(self._tools.keys())

    def get_schemas(self, filter_names: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Export function calling schemas compatible with OpenAI / Anthropic format."""
        schemas = []
        for name, tool in self._tools.items():
            if filter_names is not None and name not in filter_names:
                continue
            schemas.append(tool.to_schema())
        return schemas

    def get_risk_tier(self, name: str) -> Optional[RiskTier]:
        """Get risk tier for a tool."""
        return self._risk_tiers.get(name)


# Global default registry instance
default_registry = ToolRegistry()

# -------------------------------------------------
# Future import – must be the first non‑docstring line
# -------------------------------------------------
from __future__ import annotations

# -------------------------------------------------
# Standard‑library imports
# -------------------------------------------------
from ast import arguments
from dataclasses import dataclass
from enum import Enum
import json
from typing import Any, Optional


# ----------------------------------------------------------------------
# Core data structures
# ----------------------------------------------------------------------
@dataclass
class TextDelta:
    """Represents a delta in text, typically used in streaming responses."""
    content: str
    role: str

    def __str__(self) -> str:
        return self.content


class StreamEventType(str, Enum):
    """Enum representing different kinds of events in a streaming response."""
    TEXT_DELTA = "text_delta"
    MESSAGE_COMPLETE = "message_complete"
    ERROR = "error"
    
    TOOL_CALL_START="tool_call_start"
    TOOL_CALL_DELTA="tool_call_delta"
    TOOL_CALL_COMPLETE="tool_call_complete"


@dataclass
class TokenUsage:
    """Token‑usage statistics for a request/response."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cached_tokens: int = 0

    def __add__(self, other: TokenUsage) -> TokenUsage:
        """Return a new TokenUsage with the sum of two usages."""
        return TokenUsage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
            cached_tokens=self.cached_tokens + other.cached_tokens,
        )

@dataclass
class ToolCallDelta:
    call_id:str
    name:str|None
    arguments_delta:str=""
    
@dataclass
class ToolResultMessage:
    tool_call_id :str
    content:str
    is_error: bool = False
    
    def to_openai_message(self)->dict[str,Any]:
        return {
            'role':'tool',
            'tool_call_id':self.tool_call_id,
            'content': self.content,
        }
    
@dataclass
class ToolCall:
    call_id:str
    name:str|None
    arguments:str=""

@dataclass
class StreamEvent:
    """A single event emitted by the LLM client during streaming."""
    type: StreamEventType
    text_delta: TextDelta|None= None
    error: str|None= None
    finish_reason: str|None= None
    tool_call_delta:ToolCallDelta|None=None
    tool_call:ToolCall|None=None
    usage: TokenUsage|None= None

def parse_tool_call_arguments(arguments_str:str)->dict[str,Any]:
    if not arguments_str:
        return {}
    try:
        return json.loads(arguments_str)
    except json.JSONDecodeError:
        return {"raw_arguments": arguments_str}
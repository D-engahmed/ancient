# -------------------------------------------------
# Future import – must be the first non‑docstring line
# -------------------------------------------------
from __future__ import annotations

# -------------------------------------------------
# Standard‑library imports
# -------------------------------------------------
from dataclasses import dataclass
from enum import Enum
from typing import Optional


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
class StreamEvent:
    """A single event emitted by the LLM client during streaming."""
    type: StreamEventType
    text_delta: Optional[TextDelta] = None
    error: Optional[str] = None
    finish_reason: Optional[str] = None
    usage: Optional[TokenUsage] = None
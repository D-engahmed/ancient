from openai import AsyncOpenAI, RateLimitError, APIConnectionError, APIError
from typing import AsyncGenerator, Optional, Any
import asyncio
import os
import logging
from client.response import (
    StreamEventType,
    StreamEvent, 
    TextDelta, 
    TokenUsage,
    ToolCall,
    ToolCallDelta,
    parse_tool_call_arguments,
    )

logger = logging.getLogger(__name__)


class LLMClient:
    """
    Asynchronous client manager for OpenAI-compatible LLM APIs.
    
    This class provides a unified interface for making chat completion requests
    with built-in retry logic, error handling, and support for both streaming
    and non-streaming responses.
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: int = 60,
        max_retries: int = 3,
        organization: Optional[str] = None,
    ):
        """
        Initialize the LLM client manager.
        
        Args:
            api_key: API key for authentication. If None, reads from LLM_API_KEY env variable.
            base_url: API base URL. Defaults to OpenRouter endpoint.
            timeout: Request timeout in seconds.
            max_retries: Maximum number of retry attempts for failed requests.
            organization: Optional organization ID for API requests.
            
        Raises:
            ValueError: If API key is not provided and not found in environment.
        """
        # Singleton pattern - client is created lazily on first use
        self._client: Optional[AsyncOpenAI] = None
        
        # Get API key from parameter, environment variable, or use hardcoded fallback
        # TODO: Remove hardcoded API key - SECURITY RISK!
        # TODO: Implement secure key management (e.g., secrets manager, encrypted config)
        self._api_key = api_key or os.getenv("LLM_API_KEY") or "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"
        
        # Configure API endpoint (defaults to OpenRouter)
        # TODO: Support multiple providers (OpenAI, Anthropic, local models)
        # TODO: Implement automatic provider selection based on model name
        self._base_url = base_url or "https://openrouter.ai/api/v1"
        
        # Request timeout and retry configuration
        self._timeout = timeout
        self._max_retries = max_retries
        self._organization = organization
        
        # Validate that we have an API key
        if not self._api_key:
            raise ValueError(
                "LLM API key must be provided either as parameter or "
                "LLM_API_KEY environment variable"
            )

    def get_client(self) -> AsyncOpenAI:
        """
        Get or create the AsyncOpenAI client instance (singleton pattern).
        
        This lazy initialization ensures the client is only created when needed
        and reused for subsequent requests.
        
        Returns:
            AsyncOpenAI: Configured OpenAI async client.
            
        Raises:
            Exception: If client initialization fails.
        """
        if self._client is None:
            try:
                self._client = AsyncOpenAI(
                    api_key=self._api_key,
                    base_url=self._base_url,
                    timeout=self._timeout,
                    max_retries=self._max_retries,
                    organization=self._organization,
                )
                logger.info("AsyncOpenAI client initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize AsyncOpenAI client: {e}")
                raise
        return self._client

    async def close(self):
        """
        Close the client connection gracefully.
        
        This should be called when the client is no longer needed to free resources.
        Good practice: use in context manager or cleanup handlers.
        """
        if self._client is not None:
            await self._client.close()
            self._client = None
            logger.info("AsyncOpenAI client closed")
            
    def _build_tools(self, tools:list[dict[str,Any]])->list[dict[str,Any]]:
        return [
            {
                "type":"function",
                "function":{
                    "name":tool["name"],
                    "description":tool.get("description", ""),
                    "parameters":tool.get(
                        "parameters", 
                        {
                        
                        "type":"object",
                        "properties":{},
                        
                        },
                    ),
                },
            }
            for tool in tools
        ]

    async def chat_completion(
        self,
        messages: list[dict[str, Any]],
        stream: bool = True,
        tools:list[dict[str,Any]]|None=None,
        model = "qwen/qwen3-coder:free",
        **kwargs: Any
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Create a chat completion with automatic retry logic.
        
        This method handles both streaming and non-streaming responses with
        exponential backoff retry logic for transient failures.
        
        Args:
            messages: List of message dictionaries (role, content pairs).
            stream: Whether to stream the response incrementally.
            model: Model identifier to use for completion.
            **kwargs: Additional parameters to pass to the API.
            
        Yields:
            StreamEvent: Events containing response chunks, errors, or completion signals.
            
        Implementation details:
            - Retries with exponential backoff: 1s, 2s, 4s for rate limits
            - Immediate retry on connection errors (up to max_retries)
            - Yields error events for unrecoverable failures
        """
        client = self.get_client()
        
        # Prepare API request parameters
        # TODO: Add support for additional parameters (temperature, max_tokens, etc.)
        # TODO: Implement parameter validation
        api_kwargs = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs  # Allow caller to override defaults
        }
        
        if tools:
            api_kwargs["tools"]=self._build_tools(tools)
            kwargs["tool_choice"]= "auto"
        
        # Retry loop with exponential backoff
        for attempt in range(self._max_retries + 1):
            try:
                # Route to appropriate handler based on streaming mode
                if stream:
                    async for event in self._stream_response(client, api_kwargs):
                        yield event
                else:
                    event = await self._non_stream_response(client, api_kwargs)
                    yield event
                return  # Success - exit retry loop
                
            except RateLimitError as e:
                # Rate limit hit - use exponential backoff before retry
                if attempt < self._max_retries:
                    # Exponential backoff: 1s → 2s → 4s
                    wait_time = 2 ** attempt
                    logger.warning(
                        f"Rate limit hit (attempt {attempt + 1}/{self._max_retries + 1}). "
                        f"Retrying in {wait_time}s..."
                    )
                    await asyncio.sleep(wait_time)
                else:
                    # Max retries exceeded - yield error event
                    logger.error(f"Rate limit exceeded after {self._max_retries + 1} attempts")
                    yield StreamEvent(
                        type=StreamEventType.ERROR,
                        error=f"Rate limit exceeded after retries: {e}",
                    )
                    return
                    
            except APIConnectionError as e:
                # Connection error - retry immediately (network might recover)
                if attempt < self._max_retries:
                    logger.warning(
                        f"Connection error (attempt {attempt + 1}/{self._max_retries + 1}). "
                        f"Retrying immediately..."
                    )
                    # No sleep for connection errors - fail fast if network is down
                else:
                    logger.error(f"Connection failed after {self._max_retries + 1} attempts")
                    yield StreamEvent(
                        type=StreamEventType.ERROR,
                        error=f"Connection failed after retries: {e}",
                    )
                    return
                    
            except APIError as e:
                # General API error - log and yield error event
                logger.error(f"API error occurred: {e}")
                yield StreamEvent(
                    type=StreamEventType.ERROR,
                    error=f"API error: {e}",
                )
                return
                
            except Exception as e:
                # Unexpected error - log and yield error event
                logger.error(f"Unexpected error in chat_completion: {e}", exc_info=True)
                yield StreamEvent(
                    type=StreamEventType.ERROR,
                    error=f"Unexpected error  in llm client: {e}",
                )
                return

    async def _stream_response(
        self,
        client: AsyncOpenAI,
        kwargs: dict[str, Any]
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Handle streaming response from the API.
        
        This method processes the API's streaming response chunk by chunk,
        yielding events for each text delta and a final completion event.
        
        Args:
            client: The AsyncOpenAI client instance.
            kwargs: Parameters to pass to the chat.completions.create call.
            
        Yields:
            StreamEvent: TEXT_DELTA events for each chunk, MESSAGE_COMPLETE at end.
            
        ✔ TODO: Add support for function/tool calls in streaming mode DOnE
        TODO: Handle multiple choices if max_choices > 1
        TODO: Add streaming timeout handling
        """
        # Create streaming completion
        response = await client.chat.completions.create(**kwargs)
        
        # Track usage and finish reason (sent with final event)
        usage: Optional[TokenUsage] = None
        finish_reason: Optional[str] = None
        tool_calls:dict[int,dict[str,Any]]={}
        
        # Process each chunk in the stream
        async for chunk in response:
            # Extract token usage information if present
            # Note: Usage is typically only in the last chunk
            if hasattr(chunk, "usage") and chunk.usage:
                usage = TokenUsage(
                    prompt_tokens=chunk.usage.prompt_tokens,
                    total_tokens=chunk.usage.total_tokens,
                    cached_tokens=chunk.usage.prompt_tokens_details.cached_tokens
                    if chunk.usage.prompt_tokens_details
                    else 0,
                )
            
            # Skip chunks with no choices
            if not chunk.choices:
                continue
            
            # Get the first choice (most APIs only return one)
            choice = chunk.choices[0]
            delta = choice.delta
            
            # Capture finish reason if present
            if choice.finish_reason:
                finish_reason = choice.finish_reason
            
            # Yield text content as it arrives
            if delta.content:
                yield StreamEvent(
                    type=StreamEventType.TEXT_DELTA,
                    text_delta=TextDelta(
                        content=delta.content,
                        role=delta.role if delta.role else "assistant"
                    ),
                )
            
            if delta.tool_calls:
                for tool_call_delta in delta.tool_calls:
                    idx = tool_call_delta.index

                    if idx not in tool_calls:
                        tool_calls[idx]={
                            'id': tool_call_delta.id or "",
                            "name": "",
                            "arguments": "",
                        }
                        if tool_call_delta.function:
                            if tool_call_delta.function.name:
                                tool_calls[idx]["name"] = tool_call_delta.function.name
                                yield StreamEvent(
                                    type=StreamEventType.TOOL_CALL_START,
                                    tool_call_delta=ToolCallDelta(
                                        call_id= tool_calls[idx]['id'],
                                        name= tool_call_delta.function.name,
                                        
                                        ),
                                    
                                ) 
                            
                            if tool_call_delta.function.arguments:
                                tool_calls[idx]["arguments"] += tool_call_delta.function.arguments
                                yield StreamEvent(
                                    type=StreamEventType.TOOL_CALL_DELTA,
                                    tool_call_delta=ToolCallDelta(
                                        call_id= tool_calls[idx]['id'],
                                        name= tool_call_delta.function.name,
                                        arguments_delta=tool_call_delta.function.arguments,
                                        ),
                                    
                                ) 
            
            
        for idx ,tc in tool_calls.items():
            yield StreamEvent(
                type=StreamEventType.TOOL_CALL_COMPLETE,
                tool_call= ToolCall(
                    call_id=tc['id'],
                    name=tc['name'],
                    arguments=parse_tool_call_arguments(tc['arguments']),
                    
                )
            )  
        
        # Signal completion with final usage statistics
        yield StreamEvent(
            type=StreamEventType.MESSAGE_COMPLETE,
            finish_reason=finish_reason,
            usage=usage,
        )

    async def _non_stream_response(
        self,
        client: AsyncOpenAI,
        kwargs: dict[str, Any]
    ) -> StreamEvent:
        """
        Handle non-streaming response from the API.
        
        This method waits for the complete response and returns it as a single event.
        Useful for cases where streaming overhead is unnecessary.
        
        Args:
            client: The AsyncOpenAI client instance.
            kwargs: Parameters to pass to the chat.completions.create call.
            
        Returns:
            StreamEvent: MESSAGE_COMPLETE event with full response.
            
        TODO: Add support for function/tool calls
        TODO: Handle multiple choices if max_choices > 1
        """
        # Get complete response in one call
        response = await client.chat.completions.create(**kwargs)
        
        # Extract the first choice
        choice = response.choices[0]
        message = choice.message
        
        # Build text delta if content exists
        text_delta = None
        if message.content:
            text_delta = TextDelta(
                content=message.content,
                role=message.role,
            )
        
        tool_calls:list[ToolCall]=[]
        if message.tool_calls:
            for tc in message.tool_calls:
                tool_calls.append(
                    ToolCall(
                        call_id=tc.id ,
                        name=tc.function.name,
                        arguments=parse_tool_call_arguments(tc.function.arguments)
                    )
                )
        
        # Extract usage information if available
        usage = None
        if response.usage:
            usage = TokenUsage(
                prompt_tokens=response.usage.prompt_tokens,
                total_tokens=response.usage.total_tokens,
                cached_tokens=response.usage.prompt_tokens_details.cached_tokens
                if response.usage.prompt_tokens_details
                else 0,
            )
        
        # Return complete response as single event
        return StreamEvent(
            type=StreamEventType.MESSAGE_COMPLETE,
            text_delta=text_delta,
            finish_reason=choice.finish_reason,
            usage=usage,
        )


# TODO: CRITICAL - MUST IMPLEMENT
# 1. Security: Remove hardcoded API key and implement secure credential management
#    - Use environment variables or secrets manager (AWS Secrets Manager, HashiCorp Vault)
#    - Add API key rotation support
#    - Implement per-user API key management for multi-tenant systems

# TODO: HIGH PRIORITY - SHOULD IMPLEMENT
# 2. Context Manager: Add async context manager support for automatic cleanup
#    Example: async with LLMClient() as client: ...
# 3. Model Router: Implement automatic model selection based on requirements
#    - Cost optimization (use cheaper models for simple tasks)
#    - Capability-based routing (use GPT-4 for complex reasoning)
# 4. Parameter Validation: Add input validation for messages, temperature, etc.
# 5. Caching Layer: Implement response caching to reduce API costs
#    - Cache identical requests with TTL
#    - Support cache invalidation strategies

# TODO: MEDIUM PRIORITY - NICE TO HAVE
# 6. Function/Tool Calling: Add support for function calls and tool use
# 7. Logging Improvements: Add structured logging with request IDs for debugging
# 8. Metrics Collection: Track latency, token usage, error rates
# 9. Multiple Providers: Support fallback to different providers (OpenAI → Anthropic → Local)
# 10. Batch Processing: Add batch API support for processing multiple requests efficiently

# TODO: LOW PRIORITY - FUTURE ENHANCEMENTS
# 11. Token Counting: Pre-flight token estimation to prevent oversized requests
# 12. Streaming Callbacks: Add callback hooks for monitoring streaming progress
# 13. Request Queueing: Implement rate limit-aware request queue
# 14. Cost Tracking: Add detailed cost calculation per request
from openai import AsyncOpenAI
from typing import AsyncGenerator, Optional, Any
import os
import logging

from client.response import EventType, StreamEvent, TextDelta, TokenUsage
logger = logging.getLogger(__name__)

class LLMClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: int = 60,
        max_retries: int = 1,
        organization: Optional[str] = None,
    ):
        """
        Initialize the OpenAI client manager.
        
        Args:
            api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env variable.
            base_url: API base URL. Defaults to OpenAI's official endpoint.
            timeout: Request timeout in seconds.
            max_retries: Maximum number of retry attempts.
            organization: Optional organization ID.
            
        Raises:
            ValueError: If API key is not provided and not found in environment.
        """
        self._client: Optional[AsyncOpenAI] = None
        self._api_key = os.getenv("LLM_API_KEY") or "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"
        self._base_url = base_url or "https://openrouter.ai/api/v1"
        self._timeout = timeout
        self._max_retries = max_retries
        self._organization = organization
        
        if not self._api_key:
            raise ValueError(
                "LLM API key must be provided either as parameter or "
                "LLM_API_KEY environment variable"
            )
        
        # todo : load api key from config or env variable
        # to future proof, we can make auto routing based on model or other params
        
    def get_client(self) -> AsyncOpenAI:
        """
        Get or create the AsyncOpenAI client instance (singleton pattern).
        
        Returns:
            AsyncOpenAI: Configured OpenAI async client.
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
        """Close the client connection gracefully."""
        if self._client is not None:
            await self._client.close()
            self._client = None
            logger.info("AsyncOpenAI client closed")
            
    async def chat_completion(
        self,
        messages:list[dict[str,Any]],
        stream:bool=True
        ) -> AsyncGenerator[StreamEvent, None]:
        """
        Wrapper for chat completion API call.
        
        Args:
            messages: List of message dictionaries for the chat completion API.
        """
        client = self.get_client()
        kwargs = {
            "model": "mistralai/devstral-2512:free",
            "messages": messages,
            "stream": stream,
        }
        if stream:
            async for event in self._stream_response(client, kwargs):
                yield event
        else:
            event =await self._non_stream_response(client, kwargs)
            yield event
            
        return
            
    async def _stream_response(
        self,
        client:AsyncOpenAI,
        kwargs:dict[str,Any]
        )->AsyncGenerator[StreamEvent, None]:
        response = await client.chat.completions.create(**kwargs)
        
        async for chunk in response:
            yield chunk
    
    async def _non_stream_response(
        self,
        client:AsyncOpenAI,
        kwargs:dict[str,Any]
        )->StreamEvent:
            response = await client.chat.completions.create(**kwargs)
            Choice = response.choices[0]
            massage = Choice.message
            text_delta= None
            if massage.content:
                text_delta = TextDelta(
                    content=massage.content,
                    role=massage.role
                )
            if response.usage:
                usage = TokenUsage(
                    prompt_tokens=response.usage.prompt_tokens,
                    total_tokens=response.usage.total_tokens,
                    cached_tokens=response.usage.prompt_tokens_details.cached_tokens,
                )
                
                return StreamEvent(
                    type=EventType.MESSAGE_COMPLETE,
                    text_delta=text_delta,
                    finish_reason=Choice.finish_reason,
                    usage=usage,
                )
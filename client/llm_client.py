from openai import AsyncOpenAI,RateLimitError,APIConnectionError,APIError
from typing import AsyncGenerator, Optional, Any
import asyncio
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
        max_retries: int = 3,
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
        for attempt in range(self._max_retries + 1):
            try:
                
                if stream:
                    async for event in self._stream_response(client, kwargs):
                        yield event
                else:
                    event =await self._non_stream_response(client, kwargs)
                    yield event
                    
                return
            except RateLimitError as e:
                if attempt <self._max_retries:
                    # attempt -> failed
                    # wait for 1s -> retry 
                    # if fail wait for 2s -> retry 
                    # if fail wait for 4s -> retry
                    # the role of exponenital back of is wait for n_new = n_old*2 for n=1,...,infinity 
                    wait_time = 2**attempt
                    await asyncio.sleep(wait_time)
                else:
                    yield StreamEvent(
                        type= EventType.ERROR,
                        error=f"Rate limit exceeded :{e}",
                    )
                    return
            except APIConnectionError as e:
                if attempt <self._max_retries: 
                    wait_time = 2**attempt
                    await asyncio.sleep(wait_time)
                else:
                    yield StreamEvent(
                        type= EventType.ERROR,
                        error=f"Connection error :{e}",
                    )
                    return
            except APIError as e:
            
                yield StreamEvent(
                    type= EventType.ERROR,
                    error=f"Api error :{e}",
                )
                return
                     
            
    async def _stream_response(
        self,
        client:AsyncOpenAI,
        kwargs:dict[str,Any]
        )->AsyncGenerator[StreamEvent, None]:
        response = await client.chat.completions.create(**kwargs)
        usage:TokenUsage |None=None
        finish_reason :str|None = None
        
        
        async for chunk in response:
            if hasattr(chunk,"usage") and chunk.usage:
                usage = TokenUsage(
                    prompt_tokens=chunk.usage.prompt_tokens,
                    total_tokens=chunk.usage.total_tokens,
                    cached_tokens=chunk.usage.prompt_tokens_details.cached_tokens,
                )
                if not chunk.choices:
                    continue
                    
                choice = chunk.choices[0]
                delta = choice.delta
                
                if choice.finish_reason:
                    finish_reason=choice.finish_reason
                
                
                # handling the text content
                
                if delta.content:
                    yield StreamEvent(
                        type=EventType.TEXT_DELTA,
                        text_delta=TextDelta(delta.content),
                        
                    )
                
        yield StreamEvent(
            # it say hi i complete the massage
            type= EventType.MESSAGE_COMPLETE,
            # and the finish reason is 
            finish_reason= finish_reason,
            usage=usage
        )
        
        
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
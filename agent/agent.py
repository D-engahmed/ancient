from __future__ import annotations
from typing import AsyncGenerator
from agent.event import AgentEvent, AgentEventType
from client.llm_client import LLMClient
from client.response import StreamEventType

class Agent:
    """
    Main agent orchestrator.
    
    Responsibilities:
    - Manages the LLM client connection
    - Handles the agentic loop (message processing)
    - Emits events for the UI to consume
    - Manages context (future: compression, pruning)
    """
    
    def __init__(self):
        # Initialize the LLM client for API communication
        self.client = LLMClient()
        
    async def run(self, message: str) -> AsyncGenerator[AgentEvent, None]:
        """
        Main entry point for processing a user message.
        
        Flow:
        1. Emit AGENT_START event
        2. Run the agentic loop (LLM interaction)
        3. Emit AGENT_END event with final response
        
        Args:
            message: The user's input message
            
        Yields:
            AgentEvent: Events representing the agent's progress
        """
        # Signal that agent processing has started
        yield AgentEvent.agent_start(message)
        
        # Variable to store the complete response
        final_response = ""
        
        # Run the main processing loop
        async for event in self._agentic_loop(message):
            yield event
            
            # Capture the final response when text is complete
            if event.type == AgentEventType.TEXT_COMPLETE:
                final_response = event.data.get("content", "")
        
        # Signal that agent processing has ended
        yield AgentEvent.agent_end(final_response)
        
    async def _agentic_loop(self, user_message: str) -> AsyncGenerator[AgentEvent, None]:
        """
        Core agentic loop that interacts with the LLM.
        
        This method:
        1. Builds the message list for the LLM
        2. Streams the response from the LLM client
        3. Converts LLM events to Agent events
        4. Handles errors gracefully
        
        Args:
            user_message: The user's input to process
            
        Yields:
            AgentEvent: Events for text deltas, completion, or errors
        """
        # Build the conversation messages
        # TODO: In future, this will include conversation history
        messages = [
            {"role": "user", "content": user_message}
        ]
        
        # Accumulate the response text
        response_text = ""
        
        try:
            # Stream completion from the LLM client
            async for event in self.client.chat_completion(
                messages=messages,
                stream=True  # Enable streaming for real-time output
            ):
                # Handle text delta events (streaming chunks)
                if event.type == StreamEventType.TEXT_DELTA:
                    if event.text_delta:
                        content = event.text_delta.content
                        response_text += content
                        # Emit agent event for UI to display
                        yield AgentEvent.text_delta(content)
                
                # Handle completion event
                elif event.type == StreamEventType.MESSAGE_COMPLETE:
                    # Stream is complete - emit final event
                    if response_text:
                        yield AgentEvent.text_complete(response_text)
                
                # Handle error events from LLM client
                elif event.type == StreamEventType.ERROR:
                    error_msg = event.error or "Unknown error occurred."
                    yield AgentEvent.agent_error(error_msg)
                    return  # Stop processing on error
        
        except Exception as e:
            # Catch any unexpected errors in the loop
            yield AgentEvent.agent_error(
                error=str(e),
                details={"location": "_agentic_loop"}
            )
            return
    
    # ---------------------------------------------------------------
    # Async context manager methods for proper resource cleanup
    # ---------------------------------------------------------------
    
    async def __aenter__(self) -> Agent:
        """
        Enter async context manager.
        
        Usage:
            async with Agent() as agent:
                await agent.run(message)
        """
        return self
    
    async def __aexit__(
        self,
        exc_type,
        exc_val,
        exc_tb,
    ) -> None:
        """
        Exit async context manager and cleanup resources.
        
        This ensures the LLM client connection is properly closed
        even if an exception occurs.
        """
        if self.client:
            await self.client.close()
            self.client = None
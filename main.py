import asyncio
import sys  # ADD THIS - needed for sys.exit(1)
import click
from ui.tui import TUI, get_console
from agent.agent import Agent
from agent.event import AgentEventType

console = get_console()

class CLI:
    def __init__(self):
        self.agent: Agent | None = None
        self.tui = TUI(console)
    
    async def run_single(self, message: str) -> str | None:
        """
        run_single: Calls the agent to interact with the LLM client and
        handle context compaction/compression/pruning and tool calls.
        All the main logic is in the agent folder.
        """
        # Use async context manager to ensure proper cleanup
        async with Agent() as agent:
            self.agent = agent
            return await self._process_message(message)
    
    async def _process_message(self, message: str) -> str | None:
        """
        Process a message by streaming events from the agent.
        
        This method:
        1. Receives events from the agent's run() method
        2. Filters for TEXT_DELTA events (streaming text chunks)
        3. Passes the text content to the TUI for display
        """
        if not self.agent:
            return None

        # Variable to accumulate the complete response
        full_response = ""
        assistant_streaming = False
        # Stream events from the agent
        async for event in self.agent.run(message):
            # Handle text delta events (streaming chunks)
            if event.type == AgentEventType.TEXT_DELTA:
                content = event.data.get("content", "")
                if not assistant_streaming:
                    self.tui.begin_assistant()
                    assistant_streaming=True
                self.tui.stream_assistant_delta(content)
                full_response += content  # Accumulate for final response
            
            # Handle completion event
            elif event.type == AgentEventType.TEXT_COMPLETE:
                final_response=event.data.get("content")
                if assistant_streaming:
                    self.tui.end_assistant()
                    assistant_streaming=False
                 
            
            # Handle error events
            elif event.type == AgentEventType.AGENT_ERROR:
                error = event.data.get("error", "Unknown error")
                console.print(f"\n[error]Error: {error}[/]")
                return None
        
        return full_response


@click.command()
@click.argument(
    "prompt", required=False
)
def main(prompt: str | None = None):
    """
    Main CLI entry point.
    
    Usage:
        python main.py "your prompt here"
    """
    cli = CLI()      

    # Show the banner
    cli.tui.show_banner()

    if prompt:
        try:
            result = asyncio.run(cli.run_single(prompt))
            if result is None:
                # Exit with error code if no result
                sys.exit(1)
        except KeyboardInterrupt:
            # Handle Ctrl+C gracefully
            console.print("\n[warning]Interrupted by user[/]")
            sys.exit(0)
        except Exception as e:
            # Catch any unexpected errors
            console.print(f"[error]Unexpected error: {e}[/]")
            sys.exit(1)
    else:
        # No prompt provided - show usage
        console.print("[info]Usage: python main.py \"your prompt here\"[/]")
        sys.exit(0)


if __name__ == "__main__":
    main()
from typing import Any
from rich.console import Console
from rich.theme import Theme
from rich.rule import Rule
from rich.text import Text
# Define the professional agent theme
AGENT_THEME = Theme({
    # General status colors
    "info": "cyan",
    "warning": "yellow",
    "error": "bright_red bold",
    "success": "green",
    "dim": "dim",
    "muted": "grey50",
    "border": "grey35",
    "highlight": "bold cyan",
    
    # Role-based colors (user vs assistant)
    "user": "bright_blue bold",
    "assistant": "bright_white",
    
    # Tool operation colors
    "tool": "bright_magenta bold",
    "tool.read": "cyan",
    "tool.write": "yellow",
    "tool.shell": "magenta",
    "tool.search": "bright_cyan",
    
    # Status indicators
    "status.active": "green bold",
    "status.processing": "yellow bold",
    "status.idle": "grey50",
    "status.error": "red bold",
    
    # Code syntax highlighting
    "code.keyword": "magenta",
    "code.string": "yellow",
    "code.number": "cyan",
    "code.comment": "grey50",
    "code.function": "bright_blue",
    
    # UI element colors
    "prompt": "bright_cyan bold",
    "path": "bright_blue",
    "timestamp": "grey50",
    "separator": "grey35",
    "header": "bold cyan",
    
    # Message type colors
    "msg.system": "bright_yellow",
    "msg.user": "bright_blue",
    "msg.assistant": "bright_white",
    "msg.tool": "bright_magenta",
    
    # Progress indicator colors
    "progress.spinner": "cyan",
    "progress.bar": "bright_cyan",
    "progress.text": "grey70",
})

# Global console instance (singleton pattern)
_console: Console | None = None


def get_console() -> Console:
    """
    Get or create the global Console instance.
    
    This ensures we only have one console throughout the application,
    which maintains consistent styling and prevents duplicate outputs.
    
    Returns:
        Console: The themed console instance
    """
    global _console
    if _console is None:
        _console = Console(
            theme=AGENT_THEME,
            highlight=False  # Disable auto-highlighting to prevent unwanted formatting
        )
    return _console


class TUI:
    """
    Terminal User Interface for the AI agent.

    Handles all visual output to the terminal with consistent theming.
    """
    
    def __init__(self, console: Console | None = None) -> None:
        """
        Initialize the TUI.
        
        Args:
            console: Optional custom console. If None, uses the global instance.
        """
        self.console = console or get_console()
        self._assistant_stream_open= False
        self._tool_args_by_call_id:dict[str,dict[str,Any]]={}
        
    def begin_assistant(self)->None:
        self.console.print()
        self.console.print(Rule(Text("Assistant",style="assistant")))
        self._assistant_stream_open= True
        
    def end_assistant(self)->None:
        if self._assistant_stream_open:
            self.console.print()
        self._assistant_stream_open=False
            
    def stream_assistant_delta(self, content: str) -> None:
        """
        Display streaming text from the assistant without adding newlines.
        
        This method prints text incrementally as it arrives from the LLM,
        creating a typewriter effect.
        
        Args:
            content: The text chunk to display
        """
        # Print without newline (end="") to keep streaming on same line
        # markup=False prevents Rich from interpreting brackets as markup
        self.console.print(content, end="", markup=False)
        
    def show_banner(self) -> None:
        """
        Display the Ancient CLI Agent startup banner.
        
        Shows the Ancient logo with branding and feature highlights.
        """
        banner = """
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║           [special.logo]░█▀█░█▀█░█▀▀░▀█▀░█▀▀░█▀█░▀█▀     [/]               ║
║           [special.logo]░█▀█░█░█░█░░░░█░░█▀▀░█░█░░█░     [/]               ║
║           [special.logo]░▀░▀░▀░▀░▀▀▀░▀▀▀░▀▀▀░▀░▀░░▀░     [/]               ║
║                                                           ║
║   [muted]Multi-LLM Orchestration Agent with Crew Support [/]        ║
║   [muted]Intelligent routing • Context management • Tools[/]        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
        """
        self.console.print(banner)
        self.console.print()
        
    def tool_call_start(self, call_id: str,name:str,argument:dict[str,Any]) -> None:
        """
        Display the start of a tool call.
        
        Args:
            call_id: Unique identifier for the tool call
            name: Name of the tool being called
            argument: Arguments passed to the tool
        """
        self._tool_args_by_call_id[call_id]=argument
        
        
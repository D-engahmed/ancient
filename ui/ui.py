"""
Professional AI CLI Agent Theme - Enhanced Version
Inspired by Claude Code with modern terminal aesthetics
"""

from rich.console import Console
from rich.theme import Theme
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn
from rich.syntax import Syntax
from rich.tree import Tree
from rich.live import Live
from datetime import datetime

# Enhanced professional agent theme
AGENT_THEME = Theme({
    # General - Core UI colors
    "info": "bright_cyan",
    "warning": "bright_yellow",
    "error": "bright_red bold",
    "success": "bright_green",
    "dim": "grey30 dim",
    "muted": "grey50",
    "border": "grey35",
    "highlight": "bold bright_cyan",
    "accent": "bright_magenta",
    
    # Roles - Conversation participants
    "user": "bold bright_blue",
    "assistant": "bright_white",
    "system": "bright_yellow italic",
    
    # Tools - Operation types with distinct colors
    "tool": "bright_magenta bold",
    "tool.read": "bright_cyan",
    "tool.write": "bright_yellow",
    "tool.shell": "bright_magenta",
    "tool.search": "cyan",
    "tool.api": "bright_blue",
    "tool.file": "yellow",
    
    # Status - State indicators
    "status.active": "bright_green bold",
    "status.processing": "bright_yellow bold",
    "status.idle": "grey50",
    "status.error": "bright_red bold",
    "status.paused": "bright_yellow",
    "status.completed": "bright_green",
    
    # Code Syntax - Enhanced highlighting
    "code.keyword": "bright_magenta",
    "code.string": "bright_yellow",
    "code.number": "bright_cyan",
    "code.comment": "grey50 italic",
    "code.function": "bright_blue bold",
    "code.class": "bright_green",
    "code.variable": "bright_white",
    "code.operator": "bright_magenta",
    
    # UI Elements - Interface components
    "prompt": "bright_cyan bold",
    "prompt.cursor": "bright_white reverse",
    "path": "bright_blue underline",
    "timestamp": "grey50",
    "separator": "grey35",
    "header": "bold bright_cyan",
    "footer": "grey50",
    "title": "bold bright_white",
    
    # Messages - Different message types
    "msg.system": "bright_yellow",
    "msg.user": "bright_blue",
    "msg.assistant": "bright_white",
    "msg.tool": "bright_magenta",
    "msg.debug": "grey70",
    
    # Progress - Loading and status bars
    "progress.spinner": "bright_cyan",
    "progress.bar": "bright_cyan",
    "progress.percentage": "bright_white",
    "progress.text": "grey70",
    "progress.time": "grey50",
    
    # Badges - Status badges and labels
    "badge.info": "bright_cyan",
    "badge.warning": "bright_yellow",
    "badge.error": "bright_red",
    "badge.success": "bright_green",
    
    # Special - Decorative elements
    "special.logo": "bold bright_cyan",
    "special.brand": "bright_magenta",
    "special.link": "bright_blue underline",
})

# Initialize console with theme
console = Console(theme=AGENT_THEME)

class AgentUI:
    """Enhanced UI components for AI CLI Agent"""
    
    @staticmethod
    def show_banner():
        """Display startup banner"""
        banner = """
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║     [special.logo]█▀▀█ ▀█▀   █▀▀█ █▀▀▀ █▀▀ █▀▀▄ ▀▀█▀▀[/]\t        ║
║     [special.logo]█▄▄█  █    █▄▄█ █ ▀█ █▀▀ █  █   █  [/]\t        ║
║     [special.logo]▀  ▀ ▄█▄   ▀  ▀ ▀▀▀▀ ▀▀▀ ▀  ▀   ▀  [/]\t        ║
║                                                       ║
║   [muted]Professional AI Assistant powered by Claude [/]        ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
        """
        console.print(banner)
        console.print()
    
    @staticmethod
    def show_status(model: str, tasks: int, status: str = "active"):
        """Display status bar"""
        status_map = {
            "active": ("●", "status.active"),
            "processing": ("⟳", "status.processing"),
            "idle": ("○", "status.idle"),
            "error": ("✗", "status.error")
        }
        icon, style = status_map.get(status, ("●", "status.active"))
        
        console.print(
            f"[{style}]{icon}[/] [{style}]{status.title()}[/]  "
            f"[separator]│[/]  Model: [highlight]{model}[/]  "
            f"[separator]│[/]  Tasks: [success]{tasks}[/] completed  "
            f"[separator]│[/]  [timestamp]{datetime.now().strftime('%H:%M:%S')}[/]"
        )
        console.print()
    
    @staticmethod
    def prompt(text: str = ""):
        """Display input prompt"""
        console.print(f"[prompt]❯[/] {text}", end="")
    
    @staticmethod
    def success(message: str):
        """Display success message"""
        console.print(f"[success]✓[/] {message}")
    
    @staticmethod
    def error(message: str, details: str = None):
        """Display error message"""
        console.print(f"[error]✗[/] {message}")
        if details:
            console.print(f"  [dim]{details}[/]")
    
    @staticmethod
    def info(message: str):
        """Display info message"""
        console.print(f"[info]ℹ[/] {message}")
    
    @staticmethod
    def warning(message: str):
        """Display warning message"""
        console.print(f"[warning]⚠[/] {message}")
    
    @staticmethod
    def task_header(task_name: str):
        """Display task header"""
        console.print()
        console.print(f"[header]▶ Task:[/] [title]{task_name}[/]")
        console.print("[separator]" + "─" * 60 + "[/]")
    
    @staticmethod
    def tool_action(action: str, target: str, tool_type: str = "tool"):
        """Display tool action"""
        icons = {
            "read": "📖",
            "write": "✏️ ",
            "shell": "⚡",
            "search": "🔍",
            "api": "🌐",
            "file": "📄"
        }
        icon = icons.get(tool_type, "🔧")
        console.print(f"  [{tool_type}]{icon} {action}:[/] [path]{target}[/]")
    
    @staticmethod
    def show_code(code: str, language: str = "python", title: str = None):
        """Display syntax-highlighted code"""
        syntax = Syntax(code, language, theme="monokai", line_numbers=True, padding=1)
        if title:
            panel = Panel(syntax, title=f"[header]{title}[/]", border_style="border")
            console.print(panel)
        else:
            console.print(syntax)
    
    @staticmethod
    def show_tree(root_name: str, items: dict):
        """Display tree structure"""
        tree = Tree(f"[header]{root_name}[/]")
        for key, value in items.items():
            if isinstance(value, dict):
                branch = tree.add(f"[info]{key}[/]")
                for sub_key, sub_value in value.items():
                    branch.add(f"[muted]{sub_key}: {sub_value}[/]")
            else:
                tree.add(f"[muted]{key}: {value}[/]")
        console.print(tree)
    
    @staticmethod
    def show_table(title: str, columns: list, rows: list):
        """Display data table"""
        table = Table(title=f"[header]{title}[/]", border_style="border")
        for col in columns:
            table.add_column(col, style="muted")
        for row in rows:
            table.add_row(*row)
        console.print(table)
    
    @staticmethod
    def progress_task(description: str):
        """Create progress indicator"""
        return Progress(
            SpinnerColumn("dots", style="progress.spinner"),
            TextColumn("[progress.text]{task.description}"),
            BarColumn(complete_style="progress.bar", finished_style="success"),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            console=console
        )


def demo_enhanced_ui():
    """Demonstrate the enhanced UI"""
    ui = AgentUI()
    
    # Banner
    ui.show_banner()
    
    # Status bar
    ui.show_status("claude-sonnet-4-5", 12, "active")
    
    # User command
    ui.prompt("[user]ai-agent task \"Build REST API\"[/]")
    console.print()
    
    # Task execution
    ui.task_header("Build REST API")
    ui.info("Analyzing project structure...")
    ui.tool_action("Reading", "package.json", "read")
    ui.tool_action("Writing", "src/api/routes.ts", "write")
    ui.tool_action("Executing", "npm install express", "shell")
    ui.success("Task completed in 3.2s")
    
    # Code display
    console.print()
    sample_code = '''import express from 'express';

const app = express();

app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

app.listen(3000);'''
    
    ui.show_code(sample_code, "typescript", "Generated Code")
    
    # Tree structure
    console.print()
    ui.show_tree("Project Structure", {
        "src/": {
            "api/": "routes.ts, middleware.ts",
            "models/": "user.ts",
            "utils/": "helpers.ts"
        },
        "tests/": {
            "api.test.ts": "Integration tests"
        }
    })
    
    # Progress example
    console.print()
    with ui.progress_task("Installing dependencies") as progress:
        task = progress.add_task("", total=100)
        import time
        for i in range(100):
            progress.update(task, advance=1)
            time.sleep(0.02)
    
    ui.success("All dependencies installed")
    
    # Error example
    console.print()
    ui.error("Failed to deploy", "Missing environment variable: DATABASE_URL")
    
    # Footer
    console.print()
    console.print("[footer]Press Ctrl+C to exit  •  Type 'help' for commands[/]")


if __name__ == "__main__":
    demo_enhanced_ui()
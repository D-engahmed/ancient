from __future__ import annotations
import abc
from enum import Enum
from pathlib import Path
from typing import Any
from pydantic import BaseModel, ValidationError
from dataclasses import dataclass, field

class ToolKind(str,Enum):
    WRITE = "write"
    READ = "read"
    SHELL = "shell"
    NETWORK = "network"
    MEMORY = "memory"
    MCP = "mcp"

@dataclass
class ToolResult:
    success:bool 
    output:str
    error: str|None=None
    metadata :dict[str,Any]=field(default_factory=dict)
    
    # TODO truncation logic

@dataclass
class ToolInvocation:
    #current working directory
    cwd:Path
    params:dir[str:Any]

class Tool(abc.ABC):
    name:str = "tool name"
    description:str ="base tool" 
    kind:ToolKind = ToolKind.READ
    def __init__(self):
        pass    
    
    @property
    def schema(self)-> ( dict[str,Any] | type["BaseModel"] ):
        raise NotImplementedError("Tool must define schema property or class attribute")
    
    @abc.abstractmethod
    async def execute(self,invocation:ToolInvocation)->ToolResult:
        pass
    
    def validate_params(self,params:dict[str,Any])->list[str]:
        schema = self.schema
        if isinstance(schema,type) and issubclass(schema,BaseModel):
            try:
                BaseModel(**params)
            except ValidationError as e:
                errors = []
                for error in e.errors():
                    field = ".".join(str(x) for x in error.get("loc",[]) )
                    msg=error.get("msg","Validation error")
                    errors.append(f"Parameter '{field}': {msg} ")
                return errors
            except Exception as e:
                return [str(e)]
        
        return []
    
    
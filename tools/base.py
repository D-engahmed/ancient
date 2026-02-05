from __future__ import annotations
import abc
from enum import Enum
from pathlib import Path
from typing import Any
from pydantic import BaseModel, ValidationError
from dataclasses import dataclass, field
from pydantic.json_schema import model_json_schema

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
    truncated :bool = False
    
    @classmethod
    def error_result(
        cls,
        error:str,
        output:str = "",
        **kwargs:Any,
    ):
        return cls(
            success = False,
            output = output,
            error=error,
            **kwargs,
        )
    @classmethod
    def success_result(
        cls,
        output:str = "",
        **kwargs:Any,
    ):
        return cls(
            success = True,
            output = output,
            error=None,
            **kwargs,
        )
    
    def to_model_output(self)-> str:
        if self.success:
            return self.output
        
        if self.error:
            return  f'Error: {self.error}\n\n Output:\n \t {self.output}'
    
    # TODO truncation logic

@dataclass 
class ToolConfirmation:
    tool_name : str
    params : dict[str,Any]
    description : str

@dataclass
class ToolInvocation:
    #current working directory
    cwd:Path
    params:dir[str,Any]

class Tool(abc.ABC):
    name:str = "tool name"
    description:str ="base tool" 
    kind:ToolKind = ToolKind.READ
    def __init__(self):
        pass    
    
    @property
    def schema(self)-> ( dict[str,Any] | type["count_tokens"] ):
        raise NotImplementedError("Tool must define schema property or class attribute")
    
    @abc.abstractmethod
    async def execute(self,invocation:ToolInvocation)->ToolResult:
        pass
    
    def validate_params(self,params:dict[str,Any])->list[str]:
        schema = self.schema
        if isinstance(schema,type) and issubclass(schema,BaseModel):
            try:
                schema(**params)
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
    
    def is_mutating(self,params:dict[str,Any])->bool:
        return self.kind in {
            ToolKind.WRITE,
            ToolKind.SHELL,
            ToolKind.NETWORK,
            ToolKind.MEMORY,
        }
    
    async def get_confirmation(self,invocation:ToolInvocation)->ToolInvocation|None:
        if not self.is_mutating(invocation.params):
            return None
        
        return ToolConfirmation(
            tool_name = self.name,
            params = invocation.params,
            description = f"Execute {self.name} : {self.description}"
        )
    
    def to_openai_schema(self)->dict[str,Any]:
        schema = self.schema
        
        if isinstance(schema,type) and issubclass(schema,BaseModel):
            json_schema = model_json_schema(schema,mode="serialization")
            
            return {
                "name" : self.name,
                "description" : self.description,
                "parameters" :{
                        "type" : "object" , 
                        "properties" : json_schema.get("properties" , {}),
                        "required" : json_schema.get("required", {}),
                },
            }
        if isinstance(schema,dict): 
            result = {
                "name" : self.name,
                "description" : self.description,
            }
            
            if 'parameters' in schema:
                result["parameters"] = schema["parameters"]
            else:
                result["parameters"] = schema
                
            return result
        raise ValueError (f'Invalid schema type for tole {self.name}:type(schema)')

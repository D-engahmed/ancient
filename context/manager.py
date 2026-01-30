from prompts.system import get_system_prompt
from dataclasses import dataclass
from utils.text import count_token
from typing import Any

@dataclass
class MessageItem:
    role:str
    content:str
    token_count:int|None = None
    
    def to_dict(self)->dict[str,Any]:
        result :dict[str,Any] = {"role":self.role}
        
        if self.content:
            result["content"]=self.content
            
        return result

class ContextManager:
    def __init__(self)->None:
        self._system_prompt=get_system_prompt()
        self._messages:list[MessageItem] =[]
        self.model="mistralai/devstral-2512:free" # if future we will make it clean/secure using .env and config 
        
    def add_user_message(self,content:str)->None:
        item=MessageItem(
            role="user",
            content=content,
            token_count=count_token(content,self.model)
        )
        self._messages.append(item)
        
    def add_assistant_message(self,content:str)->None:
        item=MessageItem(
            role="assistant",
            content=content or "",
            token_count=count_token(content,self.model)
        )
        self._messages.append(item)
    
    def get_messages(self)->list[dict[str,Any]]:
        message = []
        
        if self._system_prompt:
            message.append(
                {
                    "role":"system",
                    "content":self._system_prompt,
                }
            )
            
            for item in self._messages:
                message.append(item.to_dict())
                
        return message
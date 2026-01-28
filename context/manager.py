from prompts.system import get_system_prompt
from dataclasses import dataclass

@dataclass
class MessageItem:
    role:str
    content:str
    token_count:int|None = None

class ContextManager:
    def __init__(self)->None:
        self._system_prompt=get_system_prompt()
        self._messages:list[MessageItem] =[]
        
    def add_user_message(self,content:str)->None:
        item=MessageItem(
            role="user",
            content=content,
            token_count=
        )
        
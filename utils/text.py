import tiktoken

def get_tokenizer(model:str):
    try:
        encoding=tiktoken.get_encoding(model)
        return encoding.encode
    except Exception:
        encoding=tiktoken.get_encoding("cl100k_base")
        return encoding.encode
    
def count_token(text:str,model:str)->int:
    tokenizer=get_tokenizer(model)
    
    if tokenizer:
        return len(tokenizer(text))
    return estimate_tokens(text)

def estimate_tokens(text:str)->int:
    return max(l ,len(text)//4)
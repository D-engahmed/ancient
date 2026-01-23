import asyncio
from client.llm_client import LLMClient

async def main():
    client=LLMClient()
    massages=[
        {"role":"user","content":"Hello! How are you?"}
    ]
    async for event in client.chat_completion(
        messages=massages,stream=True):
            print (event)
    print("done👍.")


asyncio.run( main())
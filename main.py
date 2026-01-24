import asyncio

from typing import Any

from client.llm_client import LLMClient

import click

class CLI:
    def __init__(self):
        pass
    
    def run_single(self):
        """
        run_single: is to call the agent that interact with the llm clint and handel context compaction or compreation or pruning or the tool calls the holl logic in agent folder
        
        """
        pass
    


async def run(massages:dict[str,Any]):

    client=LLMClient()

    async for event in client.chat_completion(

        messages=massages,stream=True):

            print (event)



@click.command()

@click.argument(

    "prompt",required=False

)

def main(

    prompt:str |None=None

):

    print(prompt)

    massages=[

        {"role":"user","content":prompt}

    ]

    asyncio.run(run(massages))

    print("done👍.")



main()
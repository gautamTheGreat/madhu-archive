import os
import asyncio
from mistralai.client import Mistral
from dotenv import load_dotenv

load_dotenv()

async def test():
    api_key = os.environ.get("MISTRAL_API_KEY")
    if not api_key:
        print("MISTRAL_API_KEY not found")
        return
    client = Mistral(api_key=api_key)
    try:
        resp = await client.chat.complete_async(
            model="mistral-small-latest",
            messages=[{"role": "user", "content": "Hello!"}]
        )
        print(resp.choices[0].message.content)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test())

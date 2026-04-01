import os
import google.generativeai as genai
from dotenv import load_dotenv

# Load from .env file if present
load_dotenv()

def test_gemini():
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("❌ Error: GEMINI_API_KEY environment variable not set. Please set it in your .env file or environment.")
        return

    print("✅ Found GEMINI_API_KEY.")
    
    try:
        genai.configure(api_key=api_key)
        # Using gemini-2.0-flash as seen in your enrich_posts.py
        model = genai.GenerativeModel('gemini-flash-latest')
        
        print("Sending test prompt to Gemini (gemini-flash-latest)...")
        response = model.generate_content("Say 'Hello, World!' and confirm your connection is working.")
        
        if response.text:
            print("✅ Success! Gemini replied:")
            print("-" * 40)
            print(response.text.strip())
            print("-" * 40)
        else:
            print("❌ Success but Gemini replied with empty content.")
            
    except Exception as e:
        print("❌ Failed to connect to Gemini API.")
        print(f"Error: {e}")

if __name__ == "__main__":
    test_gemini()

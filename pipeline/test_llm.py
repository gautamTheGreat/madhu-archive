#!/usr/bin/env python3
"""
test_llm.py

A simple verification script to test Groq API connectivity and JSON parsing
using the modular call_llm function from enrich_posts.py.
"""

import json
import sys
from pathlib import Path

# Add current directory to path so we can import from enrich_posts
sys.path.append(str(Path(__file__).parent))

try:
    from enrich_posts import call_llm, ts_log
except ImportError as e:
    print(f"Error importing from enrich_posts: {e}")
    sys.exit(1)

def test_connectivity():
    ts_log("Testing Groq API connectivity...")
    
    test_prompt = """
    Return a JSON object with exactly two keys:
    1. "status": "success"
    2. "message": "Groq is working!"
    """
    
    result = call_llm(test_prompt)
    
    if "_error" in result:
        ts_log(f"✖ Test failed: {result['_error']}")
        sys.exit(1)
    
    ts_log("✓ Connectivity successful!")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    test_connectivity()

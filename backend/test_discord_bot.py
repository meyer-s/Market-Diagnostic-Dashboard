#!/usr/bin/env python3
"""
Test Discord bot endpoint locally
Simulates a Discord interaction without needing Discord setup
"""
import requests
import json

# Your server URL
BASE_URL = "http://localhost:8000"  # Change to http://100.49.90.221:8000 for remote testing

def test_health():
    """Test Discord health endpoint"""
    print("Testing Discord health endpoint...")
    response = requests.get(f"{BASE_URL}/discord/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    return response.status_code == 200

def test_ping_interaction():
    """Test PING interaction (Discord verification)"""
    print("\n\nTesting PING interaction...")
    payload = {
        "type": 1,  # PING
        "id": "test-interaction-id",
        "application_id": "1432808300780458006",
        "token": "test-token"
    }
    
    response = requests.post(
        f"{BASE_URL}/discord/interactions",
        json=payload,
        headers={"Content-Type": "application/json"}
    )
    
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print(f"Expected: {{'type': 1}} (PONG)")
    return response.status_code == 200 and response.json().get("type") == 1

def test_sweep_command():
    """Test /sweep command interaction"""
    print("\n\nTesting /sweep command interaction...")
    print("(This will start a real sweep - check logs for progress)")
    
    payload = {
        "type": 2,  # APPLICATION_COMMAND
        "id": "test-interaction-id",
        "application_id": "1432808300780458006",
        "token": "test-token",
        "data": {
            "name": "sweep",
            "options": [
                {
                    "name": "symbol",
                    "value": "SPY"
                },
                {
                    "name": "threshold",
                    "value": 30.0
                }
            ]
        }
    }
    
    response = requests.post(
        f"{BASE_URL}/discord/interactions",
        json=payload,
        headers={"Content-Type": "application/json"}
    )
    
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print(f"Expected: {{'type': 5}} (DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE)")
    print("\nNote: The actual sweep runs in background.")
    print("Without DISCORD_BOT_TOKEN set, it won't send followup message.")
    return response.status_code == 200 and response.json().get("type") == 5

if __name__ == "__main__":
    print("=" * 60)
    print("Discord Bot Endpoint Tests")
    print("=" * 60)
    
    results = []
    
    # Test 1: Health
    results.append(("Health Check", test_health()))
    
    # Test 2: PING
    results.append(("PING Interaction", test_ping_interaction()))
    
    # Test 3: Sweep Command
    results.append(("Sweep Command", test_sweep_command()))
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {name}")
    
    all_passed = all(result[1] for result in results)
    print("\n" + ("🎉 All tests passed!" if all_passed else "⚠️  Some tests failed"))
    print("\nNext steps:")
    print("1. Get your Discord bot token from https://discord.com/developers/applications")
    print("2. Add DISCORD_BOT_TOKEN to devops/env/backend.env")
    print("3. Restart backend: docker compose restart backend")
    print("4. Run: python backend/register_discord_commands.py")
    print("5. Configure interaction URL in Discord dashboard")
    print("6. Test /sweep in your Discord server!")

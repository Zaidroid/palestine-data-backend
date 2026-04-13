#!/usr/bin/env python3
"""
Telegram session setup — run ONCE before starting Docker.

  python3 setup_session.py

You will be prompted for a verification code sent to your phone.
After this completes, a session file is saved in ./session/
and Docker can authenticate automatically on every restart.
"""

import asyncio
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from telethon import TelegramClient
except ImportError:
    print("ERROR: Run: pip3 install telethon python-dotenv")
    raise SystemExit(1)

API_ID    = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH  = os.getenv("TELEGRAM_API_HASH", "")
PHONE     = os.getenv("TELEGRAM_PHONE", "")
SESSION   = Path("session") / "wb_alerts"


async def main():
    print("=" * 55)
    print(" West Bank Alert System — Telegram Session Setup")
    print("=" * 55)

    if not API_ID or API_ID == 0:
        print("\nERROR: TELEGRAM_API_ID is not set in .env")
        print("  1. Go to https://my.telegram.org")
        print("  2. Log in → API development tools → Create app")
        print("  3. Copy API ID and API Hash to .env")
        return

    if not PHONE:
        print("\nERROR: TELEGRAM_PHONE is not set in .env")
        print("  Example: TELEGRAM_PHONE=+970591234567")
        return

    Path("session").mkdir(exist_ok=True)

    print(f"\nConnecting as {PHONE}...")
    client = TelegramClient(str(SESSION), API_ID, API_HASH)

    await client.start(phone=PHONE)

    me = await client.get_me()
    print(f"\nAuthenticated as: {me.first_name} (phone: +{me.phone})")
    print(f"Session saved: {SESSION}.session")
    print("\n-> You can now run: docker compose up -d")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())

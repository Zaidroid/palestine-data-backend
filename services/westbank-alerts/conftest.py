"""Pytest bootstrap for the westbank-alerts service.

`app.config` refuses to import unless API_SECRET_KEY is a real (>=16 char) secret,
so set a throwaway one for the test process before any `app.*` import happens.
"""
import os

os.environ.setdefault("API_SECRET_KEY", "test-secret-key-0123456789abcdef")

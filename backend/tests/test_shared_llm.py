from types import SimpleNamespace
from unittest.mock import patch

from src.shared.llm import get_llm


def test_get_llm_prefers_openrouter_key_for_openrouter_provider(monkeypatch):
    monkeypatch.setenv("DEFAULT_AI_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "router-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")

    fake_db = SimpleNamespace(
        query=lambda _model: SimpleNamespace(
            first=lambda: SimpleNamespace(ai_model="gpt-4o-mini", ai_provider="openrouter")
        )
    )

    with patch("langchain_openai.ChatOpenAI") as mock_chat:
        get_llm(fake_db)

    kwargs = mock_chat.call_args.kwargs
    assert kwargs["api_key"] == "router-key"
    assert kwargs["base_url"] == "https://openrouter.ai/api/v1"


def test_get_llm_uses_openai_key_for_openai_provider(monkeypatch):
    monkeypatch.setenv("DEFAULT_AI_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "router-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")

    fake_db = SimpleNamespace(
        query=lambda _model: SimpleNamespace(
            first=lambda: SimpleNamespace(ai_model="gpt-4o-mini", ai_provider="openai")
        )
    )

    with patch("langchain_openai.ChatOpenAI") as mock_chat:
        get_llm(fake_db)

    kwargs = mock_chat.call_args.kwargs
    assert kwargs["api_key"] == "openai-key"
    assert "base_url" not in kwargs

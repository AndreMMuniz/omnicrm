def test_build_allowed_origins_expands_www_variant(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://omnicrm.chat")
    monkeypatch.setenv("FRONTEND_URL", "https://omnicrm.chat")

    from importlib import reload
    import app.core.config as config_module
    import main as main_module

    reload(config_module)
    reload(main_module)

    origins = main_module._build_allowed_origins()
    assert "https://omnicrm.chat" in origins
    assert "https://www.omnicrm.chat" in origins


def test_build_allowed_origins_falls_back_to_localhost(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "")
    monkeypatch.setenv("FRONTEND_URL", "")

    from importlib import reload
    import app.core.config as config_module
    import main as main_module

    reload(config_module)
    reload(main_module)

    origins = main_module._build_allowed_origins()
    assert origins == ["http://localhost:3000", "http://localhost:3001"]


def test_resolve_telegram_bot_token_prefers_database_value(monkeypatch):
    import app.core.database as database_module
    import main as main_module

    class _FakeSettings:
        telegram_bot_token = "db-token"

    class _FakeQuery:
        def first(self):
            return _FakeSettings()

    class _FakeSession:
        def query(self, _model):
            return _FakeQuery()

        def close(self):
            return None

    monkeypatch.setattr(database_module, "SessionLocal", lambda: _FakeSession())
    monkeypatch.setattr(main_module.settings, "TELEGRAM_BOT_TOKEN", "env-token")

    assert main_module._resolve_telegram_bot_token() == "db-token"

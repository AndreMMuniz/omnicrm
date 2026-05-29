import os
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv(override=False)

class Settings(BaseModel):
    PROJECT_NAME: str = "Multi-Channel Chat API"
    VERSION: str = "1.0.0"

    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    DATABASE_ENCRYPTION_KEY: str = os.getenv("DATABASE_ENCRYPTION_KEY", "")
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    AUTH_MODE: str = os.getenv("AUTH_MODE", "supabase").strip().lower()
    LOCAL_AUTH_SECRET: str = os.getenv("LOCAL_AUTH_SECRET", "")

    # AI — supports both OPENAI_API_KEY and OPENROUTER_API_KEY
    # When using OpenRouter, set OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY
    OPENAI_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")

    # Telegram
    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")

    # Email (shared inbox / SMTP + IMAP)
    EMAIL_ADDRESS: str = os.getenv("EMAIL_ADDRESS", "")
    EMAIL_PASSWORD: str = os.getenv("EMAIL_PASSWORD", "")
    EMAIL_IMAP_HOST: str = os.getenv("EMAIL_IMAP_HOST", "")
    EMAIL_IMAP_PORT: int = int(os.getenv("EMAIL_IMAP_PORT", "993"))
    EMAIL_SMTP_HOST: str = os.getenv("EMAIL_SMTP_HOST", "")
    EMAIL_SMTP_PORT: int = int(os.getenv("EMAIL_SMTP_PORT", "587"))
    EMAIL_SMTP_TIMEOUT_SECONDS: int = int(os.getenv("EMAIL_SMTP_TIMEOUT_SECONDS", "8"))
    BREVO_API_KEY: str = os.getenv("BREVO_API_KEY", "")

    # AI Engine — hashing key for searchable PII fields (email_hash, phone_hash)
    # Must be set in production. In dev, falls back to plain SHA-256 (see hashing.py).
    DATABASE_HMAC_KEY: str = os.getenv("DATABASE_HMAC_KEY", "")

    # Deployment
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    WEBHOOK_BASE_URL: str = os.getenv("WEBHOOK_BASE_URL", "")
    ALLOWED_ORIGINS: str = os.getenv("ALLOWED_ORIGINS", "")

    @property
    def supabase_key(self) -> str:
        return self.SUPABASE_SERVICE_ROLE_KEY or self.SUPABASE_ANON_KEY

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def use_local_auth(self) -> bool:
        return self.AUTH_MODE == "local"

    @property
    def local_auth_secret(self) -> str:
        return (
            self.LOCAL_AUTH_SECRET
            or self.DATABASE_ENCRYPTION_KEY
            or self.DATABASE_HMAC_KEY
            or "local-dev-auth-secret"
        )

settings = Settings()

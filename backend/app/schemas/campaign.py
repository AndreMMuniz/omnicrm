from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class CampaignLaunchRequest(BaseModel):
    objective: str = Field(..., min_length=1)
    channel: str
    cadence: dict[str, Any] = Field(..., min_length=1)
    owner_user_id: Optional[UUID] = None
    lead_ids: Optional[list[UUID]] = None
    segment_filter: Optional[dict[str, Any]] = None

    @field_validator("objective", "channel", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("channel")
    @classmethod
    def normalize_channel(cls, value: str) -> str:
        return value.lower()

    @model_validator(mode="after")
    def validate_target_mode(self) -> "CampaignLaunchRequest":
        if bool(self.lead_ids) == bool(self.segment_filter):
            raise ValueError("Provide exactly one target mode: lead_ids or segment_filter")
        return self


class CampaignGenerateStepsRequest(BaseModel):
    step_types: Optional[list[str]] = Field(default=None, max_length=8)


class CampaignStepReviewRequest(BaseModel):
    reviewed_content: Optional[str] = None
    approve: bool = True


class CampaignStepSkipRequest(BaseModel):
    reason: str = Field(..., min_length=1)


class CampaignStateTransitionRequest(BaseModel):
    reason: Optional[str] = None

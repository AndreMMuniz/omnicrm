from __future__ import annotations

from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


GroundingSourceType = Literal[
    "lead",
    "lead_identity",
    "lead_enrichment",
    "lead_scoring",
    "conversation",
    "contact",
    "client",
    "project",
    "proposal",
    "catalog_item",
]


class GroundingCitation(BaseModel):
    source_type: GroundingSourceType
    source_id: str
    source_field: str


class GroundedFact(BaseModel):
    key: str
    value: Any
    source_type: GroundingSourceType
    source_id: str
    source_field: str
    confidence: Optional[float] = None


class GroundedInference(BaseModel):
    key: str
    value: Any
    source_type: GroundingSourceType = "lead_enrichment"
    source_id: str
    source_field: str
    confidence: Optional[float] = None
    rationale: Optional[str] = None


class OmittedGroundingSource(BaseModel):
    source_type: str
    reason: str


class OutreachGroundingRequest(BaseModel):
    channel: Optional[str] = None
    scope: str = Field(default="lead_outreach", min_length=1)

    @field_validator("channel", "scope", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value


class OutreachGroundingResponse(BaseModel):
    entity_type: Literal["lead"]
    entity_id: UUID
    scope: str
    channel: Optional[str] = None
    fallback_mode: bool
    facts: list[GroundedFact]
    inferences: list[GroundedInference]
    citations: list[GroundingCitation]
    omitted_sources: list[OmittedGroundingSource]
    prompt_inputs: dict[str, Any]

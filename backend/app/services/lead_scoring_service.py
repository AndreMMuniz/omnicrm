from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.models import Lead, LeadScoringConfig


@dataclass(frozen=True)
class LeadScoringRules:
    version: str
    thresholds: Dict[str, int]
    low_confidence_threshold: float
    components: Dict[str, int]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "thresholds": dict(self.thresholds),
            "low_confidence_threshold": self.low_confidence_threshold,
            "components": dict(self.components),
        }


@dataclass(frozen=True)
class LeadScoreResult:
    score: int
    qualification_label: str
    score_confidence: float
    low_confidence: bool
    score_breakdown: List[Dict[str, Any]]
    score_rationale: str
    scoring_version: str
    scored_at: datetime


DEFAULT_SCORING_CONFIG = LeadScoringRules(
    version="default-2026-07-08",
    thresholds={"hot": 80, "warm": 50, "cold": 0},
    low_confidence_threshold=0.6,
    components={
        "identity_completeness": 20,
        "company_fit": 20,
        "pain_point_fit": 30,
        "engagement_signal": 20,
        "duplicate_risk": -10,
    },
)


class LeadScoringService:
    def __init__(self, db: Session):
        self.db = db

    def get_config(self) -> LeadScoringRules:
        active = (
            self.db.query(LeadScoringConfig)
            .filter(LeadScoringConfig.is_active.is_(True))
            .order_by(LeadScoringConfig.updated_at.desc())
            .first()
        )
        if not active:
            return DEFAULT_SCORING_CONFIG
        return self._parse_config(active.config)

    def save_config(self, config: Mapping[str, Any]) -> LeadScoringRules:
        parsed = self._parse_config(config)
        self.db.query(LeadScoringConfig).update({"is_active": False})
        row = self.db.query(LeadScoringConfig).filter(LeadScoringConfig.version == parsed.version).first()
        if row:
            row.config = parsed.to_dict()
            row.is_active = True
        else:
            row = LeadScoringConfig(version=parsed.version, config=parsed.to_dict(), is_active=True)
            self.db.add(row)
        self.db.commit()
        return parsed

    def score_lead(self, lead_id: UUID) -> LeadScoreResult:
        lead = self.db.query(Lead).filter(Lead.id == lead_id).first()
        if not lead:
            raise ValueError("Lead not found")

        config = self.get_config()
        breakdown = [
            self._identity_component(lead, config.components["identity_completeness"]),
            self._company_component(lead, config.components["company_fit"]),
            self._pain_point_component(lead, config.components["pain_point_fit"]),
            self._engagement_component(lead, config.components["engagement_signal"]),
            self._duplicate_component(lead, config.components["duplicate_risk"]),
        ]

        raw_score = sum(int(item["points"]) for item in breakdown)
        score = max(0, min(100, raw_score))
        confidence = self._confidence(lead, breakdown)
        low_confidence = confidence < config.low_confidence_threshold
        label = "low_confidence" if low_confidence else self._label_for_score(score, config.thresholds)
        rationale = self._rationale(lead, breakdown, low_confidence)
        scored_at = datetime.now(timezone.utc)

        lead.score = score
        lead.qualification_label = label
        lead.score_confidence = confidence
        lead.score_breakdown = breakdown
        lead.score_rationale = rationale
        lead.scoring_version = config.version
        lead.scored_at = scored_at
        self.db.commit()
        self.db.refresh(lead)

        return LeadScoreResult(
            score=score,
            qualification_label=label,
            score_confidence=confidence,
            low_confidence=low_confidence,
            score_breakdown=breakdown,
            score_rationale=rationale,
            scoring_version=config.version,
            scored_at=scored_at,
        )

    def _parse_config(self, config: Mapping[str, Any]) -> LeadScoringRules:
        version = config.get("version")
        thresholds = config.get("thresholds")
        low_confidence_threshold = config.get("low_confidence_threshold")
        components = config.get("components")

        if not isinstance(version, str) or not version.strip():
            raise ValueError("Scoring config requires a non-empty version")
        if not isinstance(thresholds, dict) or not {"hot", "warm", "cold"}.issubset(thresholds):
            raise ValueError("Scoring config thresholds must include hot, warm, and cold")
        if not isinstance(components, dict):
            raise ValueError("Scoring config components are required")
        required_components = set(DEFAULT_SCORING_CONFIG.components)
        if not required_components.issubset(components):
            missing = ", ".join(sorted(required_components - set(components)))
            raise ValueError(f"Scoring config components missing: {missing}")

        parsed_thresholds = {key: int(thresholds[key]) for key in ("hot", "warm", "cold")}
        if not 0 <= float(low_confidence_threshold) <= 1:
            raise ValueError("low_confidence_threshold must be between 0 and 1")

        parsed_components = {key: int(components[key]) for key in required_components}
        for key, value in parsed_components.items():
            if value < 0 and key != "duplicate_risk":
                raise ValueError(f"Component {key} cannot be negative")

        return LeadScoringRules(
            version=version,
            thresholds=parsed_thresholds,
            low_confidence_threshold=float(low_confidence_threshold),
            components=parsed_components,
        )

    def _identity_component(self, lead: Lead, max_points: int) -> Dict[str, Any]:
        present = [bool(lead.name), bool(lead.email), bool(lead.phone)]
        points = round(max_points * (sum(present) / len(present)))
        return {
            "component": "identity_completeness",
            "points": points,
            "max_points": max_points,
            "source": "lead",
            "rationale": "Lead identity fields are complete enough for follow-up." if points else "Lead is missing name, email, and phone signals.",
        }

    def _company_component(self, lead: Lead, max_points: int) -> Dict[str, Any]:
        has_company = bool(lead.company)
        return {
            "component": "company_fit",
            "points": max_points if has_company else 0,
            "max_points": max_points,
            "source": "lead",
            "rationale": "Company context is present." if has_company else "Company context is missing.",
        }

    def _pain_point_component(self, lead: Lead, max_points: int) -> Dict[str, Any]:
        pain_points = getattr(lead, "pain_points", None) or []
        notes = getattr(lead, "qualification_notes", None)
        inferred = getattr(lead, "ai_inferences", None) or {}
        has_signal = bool(pain_points) or bool(notes) or bool(inferred)
        points = max_points if has_signal else 0
        return {
            "component": "pain_point_fit",
            "points": points,
            "max_points": max_points,
            "source": "ai_inferences" if has_signal else "missing_enrichment",
            "rationale": "Pain point or qualification signals are available." if has_signal else "No enrichment pain-point signal is available yet.",
        }

    def _engagement_component(self, lead: Lead, max_points: int) -> Dict[str, Any]:
        confidence_values = []
        if isinstance(lead.extraction_confidence, dict):
            confidence_values = [float(value) for value in lead.extraction_confidence.values() if isinstance(value, (int, float))]
        avg_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else 0
        points = round(max_points * avg_confidence)
        if lead.extraction_error:
            points = min(points, round(max_points * 0.25))
        return {
            "component": "engagement_signal",
            "points": points,
            "max_points": max_points,
            "source": "extraction_confidence",
            "rationale": "Extraction confidence supports the lead signal." if points else "Extraction confidence is missing or failed.",
        }

    def _duplicate_component(self, lead: Lead, penalty: int) -> Dict[str, Any]:
        return {
            "component": "duplicate_risk",
            "points": penalty if lead.duplicate_risk else 0,
            "max_points": 0,
            "source": "lead",
            "rationale": "Duplicate risk reduces confidence in this lead." if lead.duplicate_risk else "No duplicate risk is currently flagged.",
        }

    def _confidence(self, lead: Lead, breakdown: List[Dict[str, Any]]) -> float:
        available_components = sum(1 for item in breakdown if item["source"] not in {"missing_enrichment"})
        completeness = available_components / len(breakdown)
        if lead.extraction_error:
            completeness -= 0.25
        if lead.duplicate_risk:
            completeness -= 0.1
        return round(max(0.0, min(1.0, completeness)), 2)

    def _label_for_score(self, score: int, thresholds: Dict[str, int]) -> str:
        if score >= thresholds["hot"]:
            return "hot"
        if score >= thresholds["warm"]:
            return "warm"
        return "cold"

    def _rationale(self, lead: Lead, breakdown: List[Dict[str, Any]], low_confidence: bool) -> str:
        positives = [item["component"] for item in breakdown if item["points"] > 0]
        missing = [item["component"] for item in breakdown if item["source"] == "missing_enrichment" or item["points"] == 0]
        parts = []
        if positives:
            parts.append(f"Positive scoring signals: {', '.join(positives)}.")
        if missing:
            parts.append(f"Missing or weak signals: {', '.join(missing)}.")
        if lead.duplicate_risk:
            parts.append("Duplicate risk is flagged.")
        if low_confidence:
            parts.append("Low-confidence scoring: required inputs are missing or unreliable.")
        return " ".join(parts) or "No scoring signals available."

"""ConversationLeadDetector — stateless LangGraph that extracts a lead from a closed conversation.

Graph flow:
  load_messages
      │
      ├─ (empty) ──────────────────────────────────── END
      │
  extract_entities
      │
  check_duplicate
      │
      ├─ (low confidence / duplicate) ─────────────── END
      │
  create_lead ────────────────────────────────────── END

The graph never imports SQLAlchemy. It receives a LeadRepositoryBase-compatible
adapter via the factory function build_lead_detector(repo).
"""

import json
import logging
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from app.ai_engine.adapters.base import LeadRepositoryBase
from app.ai_engine.prompts.entity_extraction import ENTITY_EXTRACTION_PROMPT
from app.ai_engine.schemas.lead_state import ConversationLeadState
from app.core.config import settings

log = logging.getLogger(__name__)

# Qualification thresholds (matches Sprint 1 spec agreed with John/Winston)
_NAME_THRESHOLD  = 0.70
_ID_THRESHOLD    = 0.80   # email or phone must meet this


# ── Node functions ────────────────────────────────────────────────────────────

def _load_messages(state: ConversationLeadState, repo: LeadRepositoryBase) -> dict[str, Any]:
    """Load conversation messages from the repository."""
    try:
        msgs = repo.get_conversation_messages(state["conversation_id"])
        return {"messages": msgs}
    except Exception as exc:
        log.error("lead_detector: load_messages failed for %s: %s", state["conversation_id"], exc)
        return {"messages": [], "errors": [f"load_messages: {exc}"]}


def _extract_entities(state: ConversationLeadState) -> dict[str, Any]:
    """Call LLM to extract name/email/phone/company from conversation messages."""
    if not state.get("messages"):
        return {"extracted_entities": {}, "extraction_confidence": {}, "extraction_error": False}

    conversation_text = "\n".join(
        f"[{m['role'].upper()}] {m['content']}"
        for m in state["messages"]
    )

    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0,
        api_key=settings.OPENAI_API_KEY or None,
        timeout=15,
        max_retries=1,
    )

    try:
        response = llm.invoke([
            {"role": "system", "content": ENTITY_EXTRACTION_PROMPT},
            {"role": "user",   "content": conversation_text},
        ])
        raw = json.loads(response.content)
    except json.JSONDecodeError:
        # Try to extract JSON substring from response
        content = getattr(response, "content", "")
        start = content.find("{")
        end   = content.rfind("}") + 1
        if start != -1 and end > start:
            try:
                raw = json.loads(content[start:end])
            except Exception:
                raw = None
        else:
            raw = None
    except Exception as exc:
        log.error("lead_detector: LLM extraction failed: %s", exc)
        return {
            "extracted_entities": {},
            "extraction_confidence": {},
            "extraction_error": True,
            "errors": [f"extract_entities: {exc}"],
        }

    if not raw:
        return {"extracted_entities": {}, "extraction_confidence": {}, "extraction_error": True}

    entities: dict[str, Any] = {}
    confidence: dict[str, float] = {}

    for field in ("name", "email", "phone", "company"):
        field_data = raw.get(field, {})
        if isinstance(field_data, dict):
            val  = field_data.get("value")
            conf = float(field_data.get("confidence", 0.0))
        else:
            val  = field_data if field_data else None
            conf = 0.0

        if val and str(val).strip():
            entities[field]    = str(val).strip()
            confidence[field]  = conf
        else:
            entities[field]    = None
            confidence[field]  = 0.0

    return {
        "extracted_entities": entities,
        "extraction_confidence": confidence,
        "extraction_error": False,
    }


def _check_duplicate(state: ConversationLeadState, repo: LeadRepositoryBase) -> dict[str, Any]:
    """Check qualification threshold and detect duplicate leads."""
    conf     = state.get("extraction_confidence", {})
    entities = state.get("extracted_entities", {})

    name_ok  = (conf.get("name", 0.0)  >= _NAME_THRESHOLD) and bool(entities.get("name"))
    email_ok = (conf.get("email", 0.0) >= _ID_THRESHOLD)   and bool(entities.get("email"))
    phone_ok = (conf.get("phone", 0.0) >= _ID_THRESHOLD)   and bool(entities.get("phone"))

    if not name_ok or (not email_ok and not phone_ok):
        log.info(
            "lead_detector: conversation %s below qualification threshold — skipping",
            state["conversation_id"],
        )
        return {"existing_lead_id": None, "should_create_lead": False}

    existing = repo.find_lead_by_identifier(
        email=entities.get("email") if email_ok else None,
        phone=entities.get("phone") if phone_ok else None,
    )

    return {
        "existing_lead_id": existing,
        "should_create_lead": True,
    }


def _create_lead(state: ConversationLeadState, repo: LeadRepositoryBase) -> dict[str, Any]:
    """Persist the qualified lead."""
    try:
        lead_id = repo.create_lead(
            conversation_id=state["conversation_id"],
            channel=state["channel"],
            entities=state["extracted_entities"],
            confidence=state["extraction_confidence"],
        )
        return {
            "lead_result": {
                "lead_id": lead_id,
                "created": True,
                "duplicate": False,
                "error": None,
            }
        }
    except Exception as exc:
        log.error(
            "lead_detector: create_lead failed for conversation %s: %s",
            state["conversation_id"], exc,
        )
        return {
            "lead_result": {
                "lead_id": None,
                "created": False,
                "duplicate": False,
                "error": str(exc),
            },
            "errors": [f"create_lead: {exc}"],
        }


# ── Routing conditions ────────────────────────────────────────────────────────

def _route_after_load(state: ConversationLeadState) -> str:
    return "extract" if state.get("messages") else "end"


def _route_after_duplicate_check(state: ConversationLeadState) -> str:
    return "create" if state.get("should_create_lead") else "end"


# ── Graph factory ─────────────────────────────────────────────────────────────

def build_lead_detector(repo: LeadRepositoryBase):
    """Build and compile the ConversationLeadDetector graph with an injected repo.

    The repo is closed over in each node wrapper — the graph itself stays
    stateless and has no direct reference to SQLAlchemy or any DB session.
    """

    def load_messages(state):
        return _load_messages(state, repo)

    def check_duplicate(state):
        return _check_duplicate(state, repo)

    def create_lead(state):
        return _create_lead(state, repo)

    graph = StateGraph(ConversationLeadState)

    graph.add_node("load_messages",    load_messages)
    graph.add_node("extract_entities", _extract_entities)
    graph.add_node("check_duplicate",  check_duplicate)
    graph.add_node("create_lead",      create_lead)

    graph.set_entry_point("load_messages")

    graph.add_conditional_edges(
        "load_messages",
        _route_after_load,
        {"extract": "extract_entities", "end": END},
    )
    graph.add_edge("extract_entities", "check_duplicate")
    graph.add_conditional_edges(
        "check_duplicate",
        _route_after_duplicate_check,
        {"create": "create_lead", "end": END},
    )
    graph.add_edge("create_lead", END)

    return graph.compile()

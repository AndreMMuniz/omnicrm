"""
AIService — generates reply suggestions for agents using LangGraph + LangChain.

Flow:
  1. Load last N messages from conversation
  2. Build context prompt
  3. Call LLM (OpenAI or OpenRouter)
  4. Parse structured suggestions
  5. Persist to ai_suggestions table
  6. Return suggestions list

The LLM model and provider are configured via GeneralSettings (admin panel).
The API key comes from OPENAI_API_KEY env var (used for both OpenAI and OpenRouter).
"""

import json
from typing import List, Optional, TypedDict
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.models import Message, AISuggestion, Conversation


SYSTEM_PROMPT = """You are an AI assistant helping a customer support agent draft replies.
Given the conversation history below, generate exactly 3 short, professional reply suggestions
for the support agent to send next.

Rules:
- Each suggestion must be between 10 and 120 characters.
- Write in the same language as the customer's last message.
- Be friendly, concise, and helpful.
- Do NOT include any explanation or numbering — only output a JSON array of 3 strings.

Example output:
["Sure, let me check that for you.", "I understand, I'll escalate this right away.", "Could you please provide more details?"]
"""


class AIService:
    """Generates reply suggestions for a conversation."""

    CONTEXT_MESSAGES = 10  # how many recent messages to include

    def __init__(self, db: Session):
        self.db = db

    # ── Settings access ───────────────────────────────────────────────────────

    def _get_llm(self):
        """Instantiate LLM from the shared provider/key resolution path."""
        from src.shared.llm import get_llm

        return get_llm(self.db)

    # ── Context builder ───────────────────────────────────────────────────────

    def _build_context(self, conversation_id: UUID) -> str:
        """Build conversation history string from recent messages."""
        messages = (
            self.db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.is_internal == False,
            )
            .order_by(Message.conversation_sequence.desc())
            .limit(self.CONTEXT_MESSAGES)
            .all()
        )
        messages.reverse()  # chronological order

        lines = []
        for m in messages:
            role = "Customer" if m.inbound else "Agent"
            lines.append(f"{role}: {m.content}")
        return "\n".join(lines) if lines else "(no messages yet)"

    # ── LangGraph workflow ────────────────────────────────────────────────────

    async def generate(self, conversation_id: UUID) -> List[str]:
        """
        Generate 3 reply suggestions for the conversation.
        Saves results to the ai_suggestions table and returns them.
        """
        try:
            from langgraph.graph import StateGraph, END
            from langchain_core.messages import HumanMessage, SystemMessage

            context = self._build_context(conversation_id)
            llm = self._get_llm()

            # LangGraph state type
            class State(TypedDict):
                context: str
                suggestions: List[str]

            # Node: call LLM
            async def call_llm(state: State) -> State:
                response = await llm.ainvoke([
                    SystemMessage(content=SYSTEM_PROMPT),
                    HumanMessage(content=f"Conversation history:\n{state['context']}\n\nGenerate 3 reply suggestions as a JSON array:"),
                ])
                raw = response.content.strip()
                # Strip markdown code block if present
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                suggestions = json.loads(raw)
                if not isinstance(suggestions, list):
                    suggestions = [str(suggestions)]
                return {**state, "suggestions": suggestions[:3]}

            # Build minimal graph
            graph = StateGraph(State)
            graph.add_node("llm", call_llm)
            graph.set_entry_point("llm")
            graph.add_edge("llm", END)
            chain = graph.compile()

            result = await chain.ainvoke({"context": context, "suggestions": []})
            suggestions = result.get("suggestions", [])

        except Exception as e:
            print(f"AIService generate error: {e}")
            suggestions = []

        if not suggestions:
            return []

        # Persist to DB (replace old suggestions for this conversation)
        self.db.query(AISuggestion).filter(
            AISuggestion.conversation_id == conversation_id
        ).delete()

        for content in suggestions:
            self.db.add(AISuggestion(
                conversation_id=conversation_id,
                content=str(content),
            ))
        self.db.commit()

        return suggestions

    def get_cached(self, conversation_id: UUID) -> List[str]:
        """Return the last generated suggestions from DB (no LLM call)."""
        rows = (
            self.db.query(AISuggestion)
            .filter(AISuggestion.conversation_id == conversation_id)
            .order_by(AISuggestion.created_at.desc())
            .all()
        )
        return [r.content for r in rows]

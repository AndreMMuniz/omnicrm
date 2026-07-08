"""Conversation business events for lightweight automation hooks."""

from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Awaitable, Callable

log = logging.getLogger(__name__)


class ConversationBusinessEventType(str, Enum):
    NEW_MESSAGE = "new_message"
    ASSIGNMENT_CHANGED = "assignment_changed"
    STATUS_CHANGED = "status_changed"
    NOTE_CREATED = "note_created"
    FOLLOW_UP_MARKED = "follow_up_marked"


@dataclass(frozen=True)
class ConversationBusinessEvent:
    event_type: ConversationBusinessEventType
    conversation_id: str
    channel: str
    source: str
    payload: dict[str, Any] = field(default_factory=dict)
    actor_user_id: str | None = None
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    schema_version: int = 1

    def to_payload(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "event_type": self.event_type.value,
            "occurred_at": self.occurred_at.isoformat(),
            "conversation_id": self.conversation_id,
            "channel": self.channel,
            "actor_user_id": self.actor_user_id,
            "source": self.source,
            **self.payload,
        }


ConversationEventConsumer = Callable[
    [ConversationBusinessEvent],
    Awaitable[None] | None,
]


class ConversationEventDispatcher:
    """In-process dispatcher whose consumers cannot break the primary flow."""

    def __init__(self) -> None:
        self._consumers: list[ConversationEventConsumer] = []

    def register(self, consumer: ConversationEventConsumer) -> None:
        if consumer not in self._consumers:
            self._consumers.append(consumer)

    def unregister(self, consumer: ConversationEventConsumer) -> None:
        if consumer in self._consumers:
            self._consumers.remove(consumer)

    def clear(self) -> None:
        self._consumers.clear()

    async def emit(self, event: ConversationBusinessEvent) -> None:
        for consumer in list(self._consumers):
            try:
                result = consumer(event)
                if inspect.isawaitable(result):
                    await result
            except Exception:
                log.exception(
                    "conversation business-event consumer failed",
                    extra={"event_type": event.event_type.value, "conversation_id": event.conversation_id},
                )


conversation_event_dispatcher = ConversationEventDispatcher()

import enum
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text, Enum, JSON, Integer, Numeric, Date, CheckConstraint, false
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.core.encryption import EncryptedString


def generate_project_reference() -> str:
    return f"PRJ-{uuid.uuid4().hex[:8].upper()}"

# Enums
class ChannelType(enum.Enum):
    WHATSAPP = "whatsapp"
    TELEGRAM = "telegram"
    EMAIL = "email"
    SMS = "sms"
    WEB = "web"

class ConversationStatus(enum.Enum):
    OPEN = "open"
    CLOSED = "closed"
    PENDING = "pending"

class ConversationTag(enum.Enum):
    SUPPORT = "support"
    BILLING = "billing"
    FEEDBACK = "feedback"
    SALES = "sales"
    GENERAL = "general"
    SPAM = "spam"

class DeliveryStatus(enum.Enum):
    PENDING   = "pending"    # not yet dispatched to channel
    SENT      = "sent"       # accepted by channel API
    DELIVERED = "delivered"  # confirmed delivery (where supported)
    FAILED    = "failed"     # channel rejected or unreachable

class MessageType(enum.Enum):
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"
    AUDIO = "audio"

class DefaultRole(enum.Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    USER = "user"


class ProjectStatus(enum.Enum):
    OPEN = "open"
    DONE = "done"
    ARCHIVED = "archived"


class ProjectPriority(enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ProjectSourceType(enum.Enum):
    MANUAL = "manual"
    MESSAGE = "message"


class ProjectTaskStatus(enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELLED = "cancelled"


class ProjectTaskAutomationType(enum.Enum):
    SEND_MESSAGE = "send_message"
    SCHEDULED_ACTION = "scheduled_action"


class ProjectTaskAutomationStatus(enum.Enum):
    SCHEDULED = "scheduled"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CatalogItemType(enum.Enum):
    PRODUCT = "product"
    SERVICE = "service"


class CatalogItemStatus(enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    DISCONTINUED = "discontinued"
    UNDER_REVIEW = "under_review"


class ProposalStatus(enum.Enum):
    DRAFT = "draft"
    SENT = "sent"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ProposalType(enum.Enum):
    PRODUCT = "product"
    SERVICE = "service"


class ClientType(enum.Enum):
    INDIVIDUAL = "individual"
    COMPANY = "company"


OFFICIAL_PROJECT_STAGES = [
    ("lead", "Lead", 1),
    ("qualification", "Qualification", 2),
    ("proposal", "Proposal", 3),
    ("negotiation", "Negotiation", 4),
    ("closed", "Closed", 5),
]


# --- RBAC Models ---

class UserType(Base):
    """Custom role definitions with granular permissions."""
    __tablename__ = "user_types"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, nullable=False)  # e.g. "Admin", "Manager", "User"
    base_role = Column(Enum(DefaultRole), nullable=False, default=DefaultRole.USER)
    is_system = Column(Boolean, default=False)  # True for built-in roles (Admin, Manager, User)

    # Conversation permissions
    can_view_all_conversations = Column(Boolean, default=False)
    can_delete_conversations = Column(Boolean, default=False)

    # Message permissions
    can_edit_messages = Column(Boolean, default=False)
    can_delete_messages = Column(Boolean, default=False)

    # User management permissions
    can_manage_users = Column(Boolean, default=False)
    can_assign_roles = Column(Boolean, default=False)
    can_disable_users = Column(Boolean, default=False)
    can_change_user_password = Column(Boolean, default=False)

    # System permissions
    can_change_settings = Column(Boolean, default=False)
    can_change_branding = Column(Boolean, default=False)
    can_change_ai_model = Column(Boolean, default=False)
    can_view_audit_logs = Column(Boolean, default=False)
    can_create_user_types = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    users = relationship("User", back_populates="user_type")


class User(Base):
    """Internal system users (agents/operators who respond to customers)."""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    auth_id = Column(String(255), unique=True, nullable=False, index=True)  # Supabase Auth UID
    email = Column(String(255), unique=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    avatar = Column(String, nullable=True)
    local_password_hash = Column(String(512), nullable=True)

    user_type_id = Column(UUID(as_uuid=True), ForeignKey("user_types.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    is_approved = Column(Boolean, default=True)  # False for self-signup users until admin approves

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user_type = relationship("UserType", back_populates="users")
    audit_logs = relationship("AuditLog", back_populates="user")


class AuditLog(Base):
    """Tracks sensitive actions for accountability."""
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    action = Column(String(100), nullable=False)  # e.g. "delete_message", "change_ai_model"
    resource_type = Column(String(100), nullable=True)  # e.g. "message", "conversation", "user"
    resource_id = Column(String(255), nullable=True)
    details = Column(JSON, nullable=True)  # Extra context about the action
    ip_address = Column(String(45), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="audit_logs")


# --- Core Chat Models ---

class Contact(Base):
    __tablename__ = "contacts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    avatar = Column(String, nullable=True) # URL to image
    channel_identifier = Column(String(255), nullable=True) # phone number, telegram chat_id, email, etc.
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    conversations = relationship("Conversation", back_populates="contact")
    client = relationship("Client", back_populates="contacts", foreign_keys=[client_id])

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(String(255), nullable=True, index=True) # Thread ID for LangGraph or channel specific thread
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id"), nullable=False)
    assigned_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    project_context_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)

    channel = Column(Enum(ChannelType), default=ChannelType.WEB)
    status = Column(Enum(ConversationStatus), default=ConversationStatus.OPEN)
    tag = Column(Enum(ConversationTag), nullable=True)
    tags = Column(JSON, nullable=False, default=list)
    needs_follow_up = Column(Boolean, default=False, server_default=false(), nullable=False, index=True)
    follow_up_note = Column(Text, nullable=True)
    follow_up_at = Column(DateTime(timezone=True), nullable=True)

    is_unread = Column(Boolean, default=False)
    last_message = Column(Text, nullable=True)
    last_message_date = Column(DateTime(timezone=True), nullable=True)

    # SLA tracking (Story 3.6)
    first_response_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    contact = relationship("Contact", back_populates="conversations")
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])
    project_context = relationship("Project", foreign_keys=[project_context_id])
    messages = relationship("Message", back_populates="conversation")
    ai_suggestions = relationship("AISuggestion", back_populates="conversation")
    source_projects = relationship(
        "Project",
        back_populates="source_conversation",
        foreign_keys="Project.source_conversation_id",
    )

class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)

    # User ID ties to an agent (internal). Contacts don't have user accounts.
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    content = Column(Text, nullable=False)
    inbound = Column(Boolean, default=True) # True if from Contact, False if from us (Agent/Bot)
    message_type = Column(Enum(MessageType), default=MessageType.TEXT)
    is_internal = Column(Boolean, nullable=False, default=False)

    image = Column(String, nullable=True) # URL to image
    file = Column(String, nullable=True) # URL to file

    # Sequencing & deduplication for ordered WebSocket delivery
    conversation_sequence = Column(Integer, nullable=False, default=0)
    idempotency_key = Column(String(255), nullable=True, unique=True)

    # Delivery tracking (Story 4.1)
    delivery_status = Column(
        Enum(DeliveryStatus, values_callable=lambda obj: [e.value for e in obj]),
        nullable=True,
    )  # null = inbound (no delivery)
    delivery_error  = Column(Text, nullable=True)                           # last error reason
    retry_count     = Column(Integer, nullable=False, default=0)
    last_retry_at   = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    conversation = relationship("Conversation", back_populates="messages")
    owner = relationship("User", foreign_keys=[owner_id])
    source_projects = relationship("Project", back_populates="source_message")

class AISuggestion(Base):
    __tablename__ = "ai_suggestions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)

    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    conversation = relationship("Conversation", back_populates="ai_suggestions")

class QuickReply(Base):
    __tablename__ = "quick_replies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shortcut = Column(String(50), unique=True, index=True, nullable=False) # e.g., /hello
    content = Column(Text, nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class GeneralSettings(Base):
    __tablename__ = "general_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_name = Column(String(255), nullable=False, default="Multi-Channel Chat")
    app_email = Column(String(255), nullable=True)
    app_logo = Column(String, nullable=True) # URL to logo

    # Branding
    primary_color = Column(String(7), nullable=True, default="#0F172A")
    secondary_color = Column(String(7), nullable=True, default="#3B82F6")
    accent_color = Column(String(7), nullable=True, default="#10B981")

    # AI Config
    ai_model = Column(String(100), nullable=True, default="gpt-4o-mini")
    ai_provider = Column(String(50), nullable=True, default="openrouter")

    # WhatsApp (Meta Cloud API)
    whatsapp_phone_id = Column(String, nullable=True)
    whatsapp_account_id = Column(String, nullable=True)
    whatsapp_access_token = Column(EncryptedString, nullable=True)
    whatsapp_webhook_token = Column(EncryptedString, nullable=True)

    # Email (IMAP/SMTP)
    email_imap_host = Column(String, nullable=True)
    email_imap_port = Column(Integer, nullable=True, default=993)
    email_smtp_host = Column(String, nullable=True)
    email_smtp_port = Column(Integer, nullable=True, default=587)
    email_address = Column(String, nullable=True)
    email_password = Column(EncryptedString, nullable=True)

    # Telegram
    telegram_bot_token = Column(EncryptedString, nullable=True)

    # SMS (Twilio)
    twilio_account_sid = Column(String, nullable=True)
    twilio_auth_token = Column(EncryptedString, nullable=True)
    twilio_phone_number = Column(String, nullable=True)

    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class ProjectStage(Base):
    __tablename__ = "project_stages"

    key = Column(String(50), primary_key=True)
    label = Column(String(100), nullable=False)
    position = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    projects = relationship("Project", back_populates="stage_definition")


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reference_code = Column(String(32), nullable=False, unique=True, default=generate_project_reference)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    stage = Column(String(50), ForeignKey("project_stages.key"), nullable=False, default="lead")
    status = Column(
        Enum(ProjectStatus, values_callable=lambda obj: [e.value for e in obj], name="projectstatus"),
        nullable=False,
        default=ProjectStatus.OPEN,
    )
    priority = Column(
        Enum(ProjectPriority, values_callable=lambda obj: [e.value for e in obj], name="projectpriority"),
        nullable=False,
        default=ProjectPriority.MEDIUM,
    )
    source_type = Column(
        Enum(ProjectSourceType, values_callable=lambda obj: [e.value for e in obj], name="projectsourcetype"),
        nullable=False,
        default=ProjectSourceType.MANUAL,
    )
    source_message_id = Column(UUID(as_uuid=True), ForeignKey("messages.id"), nullable=True)
    source_conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=True)
    project_context_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True, index=True)
    contact_name = Column(String(255), nullable=True)
    channel = Column(
        Enum(ChannelType, values_callable=lambda obj: [e.value for e in obj], name="projectchanneltype"),
        nullable=True,
    )
    tag = Column(String(100), nullable=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=True)
    value = Column(Integer, nullable=True)
    progress = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    stage_definition = relationship("ProjectStage", back_populates="projects")
    owner = relationship("User", foreign_keys=[owner_user_id])
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    client = relationship("Client")
    contact = relationship("Contact", foreign_keys=[contact_id])
    source_conversation = relationship(
        "Conversation",
        back_populates="source_projects",
        foreign_keys=[source_conversation_id],
    )
    source_message = relationship("Message", back_populates="source_projects")
    project_context = relationship("Project", remote_side=[id], foreign_keys=[project_context_id])
    tasks = relationship(
        "ProjectTask",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ProjectTask.created_at.desc()",
    )


class ProjectTask(Base):
    __tablename__ = "project_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(
        Enum(ProjectTaskStatus, values_callable=lambda obj: [e.value for e in obj], name="projecttaskstatus"),
        nullable=False,
        default=ProjectTaskStatus.OPEN,
    )
    priority = Column(
        Enum(ProjectPriority, values_callable=lambda obj: [e.value for e in obj], name="projectpriority"),
        nullable=False,
        default=ProjectPriority.MEDIUM,
    )
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    source_message_id = Column(UUID(as_uuid=True), ForeignKey("messages.id"), nullable=True)
    source_conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    automation_type = Column(
        Enum(
            ProjectTaskAutomationType,
            values_callable=lambda obj: [e.value for e in obj],
            name="projecttaskautomationtype",
        ),
        nullable=True,
    )
    automation_status = Column(
        Enum(
            ProjectTaskAutomationStatus,
            values_callable=lambda obj: [e.value for e in obj],
            name="projecttaskautomationstatus",
        ),
        nullable=True,
    )
    automation_run_at = Column(DateTime(timezone=True), nullable=True)
    automation_message_content = Column(Text, nullable=True)
    automation_action_label = Column(String(255), nullable=True)
    automation_last_error = Column(Text, nullable=True)
    automation_executed_at = Column(DateTime(timezone=True), nullable=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    project = relationship("Project", back_populates="tasks")
    owner = relationship("User", foreign_keys=[owner_user_id])
    created_by = relationship("User", foreign_keys=[created_by_user_id])


class CatalogCategory(Base):
    __tablename__ = "catalog_categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(120), nullable=False, unique=True)
    label = Column(String(120), nullable=False, unique=True)
    position = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    items = relationship("CatalogItem", back_populates="category_definition")


class CatalogItem(Base):
    __tablename__ = "catalog_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reference_code = Column(String(32), nullable=False, unique=True, default=lambda: f"CAT-{uuid.uuid4().hex[:8].upper()}")
    name = Column(String(255), nullable=False)
    commercial_name = Column(String(255), nullable=False)
    type = Column(
        Enum(CatalogItemType, values_callable=lambda obj: [e.value for e in obj], name="catalogitemtype"),
        nullable=False,
    )
    status = Column(
        Enum(CatalogItemStatus, values_callable=lambda obj: [e.value for e in obj], name="catalogitemstatus"),
        nullable=False,
        default=CatalogItemStatus.ACTIVE,
    )
    category = Column(String(120), nullable=False)
    category_id = Column(UUID(as_uuid=True), ForeignKey("catalog_categories.id"), nullable=True)
    sku = Column(String(120), nullable=True)
    commercial_description = Column(Text, nullable=False)
    internal_notes = Column(Text, nullable=True)
    base_price = Column(Integer, nullable=False, default=0)
    unit = Column(String(120), nullable=False)
    sla_or_delivery_time = Column(String(255), nullable=True)
    usage_rules = Column(Text, nullable=True)
    active_for_support = Column(Boolean, nullable=False, default=True)
    can_be_quoted = Column(Boolean, nullable=False, default=False)
    allows_discount = Column(Boolean, nullable=False, default=False)
    tags = Column(JSON, nullable=True)
    replaced_by_catalog_item_id = Column(UUID(as_uuid=True), ForeignKey("catalog_items.id"), nullable=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    price_updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    created_by = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
    replaced_by_catalog_item = relationship("CatalogItem", remote_side=[id], foreign_keys=[replaced_by_catalog_item_id])
    category_definition = relationship("CatalogCategory", back_populates="items")


class Proposal(Base):
    __tablename__ = "proposals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reference_code = Column(String(32), nullable=False, unique=True, default=lambda: f"PRP-{uuid.uuid4().hex[:8].upper()}")
    title = Column(String(255), nullable=False)
    customer_name = Column(String(255), nullable=True)
    status = Column(
        Enum(ProposalStatus, values_callable=lambda obj: [e.value for e in obj], name="proposalstatus"),
        nullable=False,
        default=ProposalStatus.DRAFT,
    )
    notes = Column(Text, nullable=True)
    subtotal_amount = Column(Integer, nullable=False, default=0)
    discount_amount = Column(Integer, nullable=False, default=0)
    total_amount = Column(Integer, nullable=False, default=0)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # --- novos campos do módulo comercial ---
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id"), nullable=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    proposal_type = Column(
        Enum(ProposalType, values_callable=lambda obj: [e.value for e in obj], name="proposaltype"),
        nullable=True,
    )
    currency = Column(String(3), nullable=False, default="BRL")
    payment_method = Column(String(100), nullable=True)
    payment_terms = Column(Text, nullable=True)
    payment_installments = Column(Integer, nullable=True)
    delivery_deadline = Column(Date, nullable=True)
    delivery_days = Column(Integer, nullable=True)
    valid_until = Column(Date, nullable=True)

    created_by = relationship("User", foreign_keys=[created_by_user_id])
    owner = relationship("User", foreign_keys=[owner_user_id])
    client = relationship("Client", back_populates="proposals")
    items = relationship(
        "ProposalItem",
        back_populates="proposal",
        cascade="all, delete-orphan",
        order_by="ProposalItem.position.asc()",
    )
    service_details = relationship(
        "ProposalServiceDetails",
        back_populates="proposal",
        uselist=False,
        cascade="all, delete-orphan",
    )
    status_history = relationship(
        "ProposalStatusHistory",
        back_populates="proposal",
        order_by="ProposalStatusHistory.created_at.asc()",
    )


class ProposalItem(Base):
    __tablename__ = "proposal_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proposal_id = Column(UUID(as_uuid=True), ForeignKey("proposals.id"), nullable=False)
    catalog_item_id = Column(UUID(as_uuid=True), ForeignKey("catalog_items.id"), nullable=True)
    catalog_reference_code = Column(String(32), nullable=True)
    name_snapshot = Column(String(255), nullable=False)
    commercial_name_snapshot = Column(String(255), nullable=False)
    type_snapshot = Column(String(32), nullable=False)
    sku_snapshot = Column(String(120), nullable=True)
    category_snapshot = Column(String(120), nullable=False)
    commercial_description_snapshot = Column(Text, nullable=False)
    base_price_snapshot = Column(Integer, nullable=False)
    unit_snapshot = Column(String(120), nullable=False)
    sla_or_delivery_time_snapshot = Column(String(255), nullable=True)
    allows_discount_snapshot = Column(Boolean, nullable=False, default=False)
    quantity = Column(Integer, nullable=False, default=1)
    unit_price = Column(Integer, nullable=False)
    discount_amount = Column(Integer, nullable=False, default=0)
    total_amount = Column(Integer, nullable=False)
    position = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    proposal = relationship("Proposal", back_populates="items")
    catalog_item = relationship("CatalogItem", foreign_keys=[catalog_item_id])


# --- Módulo Comercial: Clientes e Propostas Estruturadas ---

class Client(Base):
    __tablename__ = "clients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    country = Column(String(2), nullable=False, default="BR")
    client_type = Column(
        Enum(ClientType, values_callable=lambda obj: [e.value for e in obj], name="clienttype"),
        nullable=False,
        default=ClientType.COMPANY,
    )
    tax_id = Column(String(30), nullable=True)
    tax_id_type = Column(String(20), nullable=True)   # CPF, CNPJ, VAT, EIN, OTHER
    currency = Column(String(3), nullable=False, default="BRL")
    company_name = Column(String(255), nullable=True)
    website = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id"), nullable=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    owner = relationship("User", foreign_keys=[owner_user_id])
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    contact = relationship("Contact", foreign_keys=[contact_id])
    proposals = relationship("Proposal", back_populates="client")
    contacts = relationship("Contact", back_populates="client", foreign_keys="Contact.client_id")


class ProposalServiceDetails(Base):
    """Campos específicos de propostas do tipo Serviço."""
    __tablename__ = "proposal_service_details"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proposal_id = Column(UUID(as_uuid=True), ForeignKey("proposals.id"), nullable=False, unique=True)
    service_name = Column(String(255), nullable=False)
    scope_of_work = Column(Text, nullable=True)
    methodology = Column(Text, nullable=True)
    hourly_rate = Column(Numeric(15, 2), nullable=True)
    estimated_hours = Column(Integer, nullable=True)
    client_responsibilities = Column(ARRAY(Text), nullable=False, default=list)
    delivery_responsibilities = Column(ARRAY(Text), nullable=False, default=list)
    revision_rounds = Column(Integer, nullable=True)
    support_period_days = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    proposal = relationship("Proposal", back_populates="service_details")


class LeadStatus(enum.Enum):
    NEW = "new"
    CONTACTED = "contacted"
    CONVERTED = "converted"
    DISQUALIFIED = "disqualified"


class Lead(Base):
    """AI-detected lead from a closed conversation."""
    __tablename__ = "leads"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True)

    # Extracted entities — plaintext name, encrypted email/phone
    name = Column(String(512), nullable=True)
    email = Column(EncryptedString, nullable=True)
    phone = Column(EncryptedString, nullable=True)
    company = Column(String(512), nullable=True)

    # Deterministic lookup hashes (HMAC-SHA256) — see app/core/hashing.py
    email_hash = Column(String(64), nullable=True)
    phone_hash = Column(String(64), nullable=True)

    source_channel = Column(String(50), nullable=False)
    extraction_confidence = Column(JSON, nullable=False, default=dict)
    extraction_error = Column(Boolean, nullable=False, default=False)
    duplicate_risk = Column(Boolean, nullable=False, default=False)

    status = Column(
        Enum(LeadStatus, values_callable=lambda obj: [e.value for e in obj], name="leadstatus"),
        nullable=False,
        default=LeadStatus.NEW,
    )

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    conversation = relationship("Conversation", foreign_keys=[conversation_id])


class ProposalStatusHistory(Base):
    """Histórico imutável de transições de status de uma proposta."""
    __tablename__ = "proposal_status_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proposal_id = Column(UUID(as_uuid=True), ForeignKey("proposals.id"), nullable=False)
    from_status = Column(String(30), nullable=True)   # NULL na criação
    to_status = Column(String(30), nullable=False)
    changed_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    proposal = relationship("Proposal", back_populates="status_history")
    changed_by = relationship("User", foreign_keys=[changed_by_user_id])

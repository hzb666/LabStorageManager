"""Runtime state model for startup coordination data."""
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.core.time_utils import get_utc_now


class RuntimeState(SQLModel, table=True):
    """Persist small runtime coordination values across restarts."""

    __tablename__ = "runtime_state"

    key: str = Field(primary_key=True, description="Unique runtime state key")
    value: str = Field(default="", description="Stored runtime state value")
    updated_at: datetime = Field(
        default_factory=get_utc_now,
        sa_column_kwargs={"onupdate": get_utc_now},
        description="Last update time",
    )

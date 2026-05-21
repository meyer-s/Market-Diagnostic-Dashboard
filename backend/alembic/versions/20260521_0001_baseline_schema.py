from __future__ import annotations

import importlib
import pkgutil

from alembic import op

from app.core.db import Base
import app.models as model_package


revision = "20260521_0001"
down_revision = None
branch_labels = None
depends_on = None


def _load_models() -> None:
    for module_info in pkgutil.iter_modules(model_package.__path__):
        importlib.import_module(f"{model_package.__name__}.{module_info.name}")


def upgrade() -> None:
    _load_models()
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    _load_models()
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)

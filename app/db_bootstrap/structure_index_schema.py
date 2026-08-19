"""SQLite bootstrap for durable structure-index changes and resolution jobs."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy.engine import Connection

_TRIGGER_STATEMENTS = (
    (
        "trg_structure_cache_index_ai",
        """
    CREATE TRIGGER IF NOT EXISTS trg_structure_cache_index_ai
    AFTER INSERT ON compound_structure_cache
    BEGIN
        SELECT CASE
            WHEN NOT EXISTS (SELECT 1 FROM structure_index_meta WHERE id = 1)
            THEN RAISE(ABORT, 'structure index metadata is missing')
        END;
        UPDATE structure_index_meta
        SET current_revision = current_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        INSERT INTO structure_index_change (
            revision, cas_number, operation, status, smiles_canonical,
            smiles_isomeric, inchikey, source, created_at
        )
        SELECT current_revision, NEW.cas_number, 'add_or_update', NEW.status,
               NEW.smiles_canonical, NEW.smiles_isomeric, NEW.inchikey,
               NEW.source, CURRENT_TIMESTAMP
        FROM structure_index_meta
        WHERE id = 1;
    END
    """,
    ),
    (
        "trg_structure_cache_index_au_fields",
        """
    CREATE TRIGGER IF NOT EXISTS trg_structure_cache_index_au_fields
    AFTER UPDATE OF status, smiles_canonical, smiles_isomeric, inchikey, source
    ON compound_structure_cache
    WHEN OLD.cas_number IS NEW.cas_number
         AND (
             OLD.status IS NOT NEW.status
             OR OLD.smiles_canonical IS NOT NEW.smiles_canonical
             OR OLD.smiles_isomeric IS NOT NEW.smiles_isomeric
             OR OLD.inchikey IS NOT NEW.inchikey
             OR OLD.source IS NOT NEW.source
         )
    BEGIN
        SELECT CASE
            WHEN NOT EXISTS (SELECT 1 FROM structure_index_meta WHERE id = 1)
            THEN RAISE(ABORT, 'structure index metadata is missing')
        END;
        UPDATE structure_index_meta
        SET current_revision = current_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        INSERT INTO structure_index_change (
            revision, cas_number, operation, status, smiles_canonical,
            smiles_isomeric, inchikey, source, created_at
        )
        SELECT current_revision, NEW.cas_number, 'add_or_update', NEW.status,
               NEW.smiles_canonical, NEW.smiles_isomeric, NEW.inchikey,
               NEW.source, CURRENT_TIMESTAMP
        FROM structure_index_meta
        WHERE id = 1;
    END
    """,
    ),
    (
        "trg_structure_cache_index_au_cas",
        """
    CREATE TRIGGER IF NOT EXISTS trg_structure_cache_index_au_cas
    AFTER UPDATE OF cas_number ON compound_structure_cache
    WHEN OLD.cas_number IS NOT NEW.cas_number
    BEGIN
        SELECT CASE
            WHEN NOT EXISTS (SELECT 1 FROM structure_index_meta WHERE id = 1)
            THEN RAISE(ABORT, 'structure index metadata is missing')
        END;
        UPDATE structure_index_meta
        SET current_revision = current_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        INSERT INTO structure_index_change (
            revision, cas_number, operation, created_at
        )
        SELECT current_revision, OLD.cas_number, 'delete', CURRENT_TIMESTAMP
        FROM structure_index_meta
        WHERE id = 1;

        UPDATE structure_index_meta
        SET current_revision = current_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        INSERT INTO structure_index_change (
            revision, cas_number, operation, status, smiles_canonical,
            smiles_isomeric, inchikey, source, created_at
        )
        SELECT current_revision, NEW.cas_number, 'add_or_update', NEW.status,
               NEW.smiles_canonical, NEW.smiles_isomeric, NEW.inchikey,
               NEW.source, CURRENT_TIMESTAMP
        FROM structure_index_meta
        WHERE id = 1;
    END
    """,
    ),
    (
        "trg_structure_cache_index_ad",
        """
    CREATE TRIGGER IF NOT EXISTS trg_structure_cache_index_ad
    AFTER DELETE ON compound_structure_cache
    BEGIN
        SELECT CASE
            WHEN NOT EXISTS (SELECT 1 FROM structure_index_meta WHERE id = 1)
            THEN RAISE(ABORT, 'structure index metadata is missing')
        END;
        UPDATE structure_index_meta
        SET current_revision = current_revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        INSERT INTO structure_index_change (
            revision, cas_number, operation, created_at
        )
        SELECT current_revision, OLD.cas_number, 'delete', CURRENT_TIMESTAMP
        FROM structure_index_meta
        WHERE id = 1;
    END
    """,
    ),
)


def ensure_structure_index_schema(connection: Connection) -> None:
    """Create the revision seed row, indexes, and mutation triggers idempotently."""
    columns = {
        str(row[1])
        for row in connection.exec_driver_sql(
            "PRAGMA table_info(structure_index_meta)"
        ).all()
    }
    if "generation_id" not in columns:
        connection.exec_driver_sql(
            """
            ALTER TABLE structure_index_meta
            ADD COLUMN generation_id VARCHAR(32) NOT NULL DEFAULT ''
            """
        )
    generation_id = uuid4().hex
    connection.exec_driver_sql(
        """
        INSERT OR IGNORE INTO structure_index_meta (
            id, generation_id, current_revision, last_compacted_revision, updated_at
        ) VALUES (1, :generation_id, 0, 0, CURRENT_TIMESTAMP)
        """,
        {"generation_id": generation_id},
    )
    connection.exec_driver_sql(
        """
        UPDATE structure_index_meta
        SET generation_id = :generation_id
        WHERE id = 1 AND (generation_id IS NULL OR generation_id = '')
        """,
        {"generation_id": generation_id},
    )
    connection.exec_driver_sql("DROP INDEX IF EXISTS ix_structure_index_change_cas_revision")
    connection.exec_driver_sql("DROP INDEX IF EXISTS ix_structure_index_change_created_at")
    connection.exec_driver_sql("DROP INDEX IF EXISTS ix_structure_resolution_job_due")
    connection.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS ix_structure_resolution_job_queued_due
        ON structure_resolution_job (state, next_attempt_at)
        """
    )
    connection.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS ix_structure_resolution_job_expired_lease
        ON structure_resolution_job (state, lease_until)
        """
    )
    for trigger_name, statement in _TRIGGER_STATEMENTS:
        connection.exec_driver_sql(f'DROP TRIGGER IF EXISTS "{trigger_name}"')
        connection.exec_driver_sql(statement)

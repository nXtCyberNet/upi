"""
Neo4j database manager.

Provides both sync (setup / batch) and async (runtime) query execution
with connection pooling and health-check support.
"""

import logging
from typing import Any, Dict, List, Optional

from neo4j import GraphDatabase, AsyncGraphDatabase
from neo4j.exceptions import ServiceUnavailable, AuthError

from app.config import settings

logger = logging.getLogger(__name__)


class Neo4jManager:
    """Singleton wrapper around the Neo4j Python driver."""

    _instance: Optional["Neo4jManager"] = None

    def __init__(self) -> None:
        self._driver = None
        self._async_driver = None

    # ── singleton ────────────────────────────────────────────

    @classmethod
    def get_instance(cls) -> "Neo4jManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── lifecycle ────────────────────────────────────────────

    async def connect(self) -> None:
        """Open synchronous + asynchronous driver pools."""
        try:
            self._driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
                max_connection_pool_size=settings.NEO4J_MAX_POOL_SIZE,
            )
            self._async_driver = AsyncGraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
                max_connection_pool_size=settings.NEO4J_MAX_POOL_SIZE,
            )
            self._driver.verify_connectivity()
            logger.info("✅ Neo4j connected at %s", settings.NEO4J_URI)
        except (ServiceUnavailable, AuthError) as exc:
            logger.error("❌ Neo4j connection failed: %s", exc)
            raise

    async def close(self) -> None:
        if self._driver:
            self._driver.close()
        if self._async_driver:
            await self._async_driver.close()
        logger.info("Neo4j drivers closed")

    # ── synchronous helpers (setup / batch) ──────────────────

    def run_sync(self, query: str, params: Dict[str, Any] | None = None) -> List[Dict]:
        with self._driver.session(database=settings.NEO4J_DATABASE) as session:
            result = session.run(query, params or {})
            return [record.data() for record in result]

    def write_sync(self, query: str, params: Dict[str, Any] | None = None) -> List[Dict]:
        with self._driver.session(database=settings.NEO4J_DATABASE) as session:
            result = session.execute_write(
                lambda tx: list(tx.run(query, params or {}))
            )
            return [r.data() for r in result]

    # ── asynchronous helpers (runtime hot-path) ──────────────

    async def run_async(self, query: str, params: Dict[str, Any] | None = None) -> List[Dict]:
        async with self._async_driver.session(database=settings.NEO4J_DATABASE) as session:
            result = await session.run(query, params or {})
            return [record.data() async for record in result]

    async def write_async(self, query: str, params: Dict[str, Any] | None = None) -> List[Dict]:
        async with self._async_driver.session(database=settings.NEO4J_DATABASE) as session:
            # execute_write expects a coroutine that takes an AsyncManagedTransaction
            async def _work(tx):
                res = await tx.run(query, params or {})
                return [record.data() async for record in res]
            return await session.execute_write(_work)

    async def read_async(self, query: str, params: Dict[str, Any] | None = None) -> List[Dict]:
        async with self._async_driver.session(database=settings.NEO4J_DATABASE) as session:
            async def _work(tx):
                res = await tx.run(query, params or {})
                return [record.data() async for record in res]
            return await session.execute_read(_work)

    # ── schema management ────────────────────────────────────

    def setup_schema(self, constraints: List[str], indexes: List[str]) -> None:
        with self._driver.session(database=settings.NEO4J_DATABASE) as session:
            for stmt in constraints + indexes:
                try:
                    session.run(stmt)
                    logger.info("  ✔ %s", stmt[:70])
                except Exception as exc:          # noqa: BLE001
                    logger.warning("  ⚠ %s – %s", stmt[:50], exc)
        logger.info("✅ Schema setup complete")

    def clear_database(self) -> None:
        with self._driver.session(database=settings.NEO4J_DATABASE) as session:
            session.run("MATCH (n) DETACH DELETE n")
        logger.warning("⚠️  All data deleted from Neo4j")

    # ── health check ─────────────────────────────────────────

    async def health_check(self) -> Dict:
        try:
            await self.run_async("RETURN 1 AS ok")
            counts = await self.run_async(
                "MATCH (n) RETURN labels(n)[0] AS label, count(n) AS cnt"
            )
            return {
                "status": "healthy",
                "nodes": {r["label"]: r["cnt"] for r in counts if r["label"]},
            }
        except Exception as exc:  # noqa: BLE001
            return {"status": "unhealthy", "error": str(exc)}

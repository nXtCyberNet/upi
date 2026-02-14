#!/usr/bin/env python3
"""
setup_neo4j.py – Create constraints, indexes, and verify Neo4j connectivity.

Usage:
    python -m scripts.setup_neo4j          # from backend/
    python scripts/setup_neo4j.py          # from backend/
"""

import sys
import os

# Ensure backend/app is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.config import settings
from app.neo4j_manager import Neo4jManager
from app.utils.cypher_queries import SCHEMA_CONSTRAINTS, SCHEMA_INDEXES, MAINT_COUNT_NODES


def main():
    print(f"🔗 Connecting to Neo4j at {settings.NEO4J_URI} …")
    neo4j = Neo4jManager.get_instance()

    # Use sync driver only (no event loop)
    from neo4j import GraphDatabase

    neo4j._driver = GraphDatabase.driver(
        settings.NEO4J_URI,
        auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
        max_connection_pool_size=settings.NEO4J_MAX_POOL_SIZE,
    )
    neo4j._driver.verify_connectivity()
    print("✅ Connected")

    # Setup schema
    print("\n📋 Setting up schema …")
    neo4j.setup_schema(SCHEMA_CONSTRAINTS, SCHEMA_INDEXES)

    # Verify
    print("\n📊 Current node counts:")
    counts = neo4j.run_sync(MAINT_COUNT_NODES)
    if counts:
        for row in counts:
            print(f"   {row['label']}: {row['count']}")
    else:
        print("   (no nodes yet)")

    neo4j._driver.close()
    print("\n✅ Neo4j setup complete!")


if __name__ == "__main__":
    main()

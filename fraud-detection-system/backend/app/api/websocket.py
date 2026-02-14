"""
WebSocket endpoint for real-time fraud alerts.

Clients connect to  ws://<host>/ws/alerts  and receive JSON messages
whenever a transaction exceeds the MEDIUM_RISK_THRESHOLD.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Dict, List, Set

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manage active WebSocket connections."""

    def __init__(self) -> None:
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
        logger.info("WS client connected (%d total)", len(self._connections))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)
        logger.info("WS client disconnected (%d total)", len(self._connections))

    async def broadcast(self, data: Dict) -> None:
        """Send JSON data to every connected client."""
        payload = json.dumps(data, default=str)
        dead: List[WebSocket] = []
        async with self._lock:
            targets = list(self._connections)
        for ws in targets:
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        # cleanup
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)

    @property
    def client_count(self) -> int:
        return len(self._connections)


# singleton
ws_manager = ConnectionManager()


async def alert_callback(alert_data: Dict) -> None:
    """Called by the worker pool when a flagged transaction is scored."""
    await ws_manager.broadcast(alert_data)


async def websocket_endpoint(ws: WebSocket) -> None:
    """FastAPI WebSocket route handler."""
    await ws_manager.connect(ws)
    try:
        while True:
            # keep connection alive; ignore client messages
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(ws)

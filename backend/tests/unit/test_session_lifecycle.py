import asyncio
from pathlib import Path
import pytest
from agentbox.memory.session_store import SessionStore
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.api.server import create_app
from aiohttp.test_utils import TestClient, TestServer


def test_session_store_create_load_persistence(tmp_path):
    db_file = tmp_path / "sessions.sqlite"
    store = SessionStore(db_file)

    # 1. Create session
    config = {"skills": ["browser"], "tools": ["file_read"]}
    session = store.create(config, role="orchestrator")
    sid = session["id"]
    assert sid is not None
    assert session["role"] == "orchestrator"
    assert session["config"] == config
    assert session["status"] == "idle"

    # Add events and checkpoints
    store.emit(sid, "tool_start", {"name": "file_read"})
    store.save(sid, [{"role": "user", "content": "hello"}], status="running")
    store.checkpoint(sid, [{"role": "user", "content": "hello"}], "test_checkpoint")

    events = store.events(sid)
    assert len(events) == 1
    assert events[0]["data"]["name"] == "file_read"

    loaded = store.get(sid)
    assert loaded["status"] == "running"
    assert len(loaded["messages"]) == 1

    # 2. Persistence across restarts
    store.close()

    store2 = SessionStore(db_file)
    # Restart sets running -> interrupted
    reloaded = store2.get(sid)
    assert reloaded["status"] == "interrupted"
    assert reloaded["config"] == config

    # 3. Delete session
    assert store2.delete(sid) is True
    with pytest.raises(KeyError):
        store2.get(sid)
    with pytest.raises(KeyError):
        store2.events(sid)
    store2.close()


def test_session_store_child_cascade_delete(tmp_path):
    db_file = tmp_path / "sessions.sqlite"
    store = SessionStore(db_file)

    parent = store.create({"skills": []}, role="orchestrator")
    child = store.create({"skills": []}, role="frontend", parent_id=parent["id"])

    store.emit(child["id"], "tool_start", {"name": "browser_use"})
    assert len(store.events(child["id"])) == 1

    # Deleting parent should cascade delete child
    store.delete(parent["id"])

    with pytest.raises(KeyError):
        store.get(parent["id"])
    with pytest.raises(KeyError):
        store.get(child["id"])
    store.close()


def test_server_delete_session_endpoint(tmp_path):
    async def run():
        db_file = tmp_path / "sessions.sqlite"
        store = SessionStore(db_file)
        runtime = HarnessRuntime(store, None)
        app = create_app(runtime)

        client = TestClient(TestServer(app))
        await client.start_server()

        try:
            # Create session
            sess = store.create({"skills": [], "tools": []})
            sid = sess["id"]

            # Call DELETE /api/agent/sessions/{sid}
            res = await client.delete(
                f"/api/agent/sessions/{sid}",
                headers={"Host": "127.0.0.1:3102", "X-BoxFox-Admin": "1", "Origin": "http://localhost:3100"}
            )
            assert res.status == 200
            data = await res.json()
            assert data["status"] == "deleted"
            assert data["id"] == sid

            # Check that session no longer exists in store
            with pytest.raises(KeyError):
                store.get(sid)
        finally:
            await client.close()
            store.close()

    asyncio.run(run())

"""`BOXFOX_HARNESS_PORT` phải được đọc lúc dùng, không phải lúc import.

Trước bản sửa, danh sách host cho phép đóng băng ngay khi import `api.server`, nên một
tiến trình đặt biến sau đó bị 403 `Host not allowed` trên cổng nó thật sự bind; giá trị
không phải số thì làm chết tiến trình bằng `ValueError` trần.
"""
import pytest

from agentbox.api import server


def test_default_port_and_hosts(monkeypatch):
    monkeypatch.delenv('BOXFOX_HARNESS_PORT', raising=False)
    assert server.harness_port() == 3102
    hosts = server.allowed_hosts()
    assert {'127.0.0.1:3102', 'localhost:3102', '127.0.0.1:3100', 'localhost:3100'} <= hosts


def test_override_applies_without_losing_the_defaults(monkeypatch):
    monkeypatch.setenv('BOXFOX_HARNESS_PORT', '3112')
    assert server.harness_port() == 3112
    hosts = server.allowed_hosts()
    assert '127.0.0.1:3112' in hosts and 'localhost:3112' in hosts
    # Cổng mặc định vẫn nằm trong danh sách: instance kiểm chứng không đóng đường UI.
    assert '127.0.0.1:3102' in hosts


def test_env_change_after_import_is_honoured(monkeypatch):
    monkeypatch.setenv('BOXFOX_HARNESS_PORT', '3113')
    assert server.harness_port() == 3113
    monkeypatch.setenv('BOXFOX_HARNESS_PORT', '3114')
    assert server.harness_port() == 3114


def test_bad_values_raise_a_named_error(monkeypatch):
    for value in ['abc', '0', '70000', '-1']:
        monkeypatch.setenv('BOXFOX_HARNESS_PORT', value)
        with pytest.raises(ValueError) as err:
            server.harness_port()
        assert 'BOXFOX_HARNESS_PORT' in str(err.value), value

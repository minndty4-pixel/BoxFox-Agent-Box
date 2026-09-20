#!/usr/bin/env python3
"""Sinh luật egress cho công tắc mạng của box — hàm THUẦN, kiểm được không cần root.

Vì sao tách khỏi box-firewall (shell)
-------------------------------------
`box-firewall` chạy bằng root NGAY TRONG container, nên bản thân nó không thể là
đối tượng của unit test. Luật iptables ở đây là DỮ LIỆU: `egress_rules()` là hàm
thuần (không I/O, không gọi iptables), nên test khẳng định được đúng thế phòng
thủ mặc định và đúng MỘT luật accept cho cầu nối LLM mà không cần
NET_ADMIN/root. `box-firewall` chỉ còn việc: flush, gọi file này, rồi `iptables`
từng dòng và đặt policy.

Hợp đồng
--------
    python3 box-firewall-rules.py off   # in từng luật "-A OUTPUT …", mỗi dòng một luật
    python3 box-firewall-rules.py on    # không in gì (chế độ mở: policy ACCEPT)
    exit 0 = đọc stdout (cảnh báo ở stderr)   exit 2 = sai tham số

Cảnh báo cấu hình (ví dụ BOX_LLM_BRIDGE=on nhưng không xác định được gateway)
được in ra stderr và luật cầu nối bị BỎ — thế phòng thủ giữ nguyên, không bao
giờ mở rộng egress vì một biến môi trường gõ sai.

Cầu nối LLM (opt-in, mặc định TẮT)
----------------------------------
`/claude-code` cần Claude Code CLI trong box đi tới router BoxFox. Mặc định
box KHÔNG ra mạng (quy tắc ②a), nên cần một luật accept DUY NHẤT, đúng đích:

    BOX_LLM_BRIDGE=on                # bật (mặc định off — giữ nguyên thế cũ)
    BOX_LLM_BRIDGE_HOST=172.18.0.1   # mặc định: gateway mặc định của container
    BOX_LLM_BRIDGE_PORT=3101         # mặc định: cổng router

Rủi ro (đọc kỹ trước khi bật): luật này mở egress TCP tới cổng router trên máy
host cho MỌI tiến trình trong box, không riêng Claude Code. Nó KHÔNG mở
internet, nhưng nó là một đường ra khỏi box — chỉ bật khi router đã bind đúng
địa chỉ đó (xem deploy/docker/README-claude-code.md).
"""
from __future__ import annotations

import ipaddress
import os
import re
import sys
from pathlib import Path

# Bốn cổng dịch vụ của box (VNC/websockify/code-server/ide-proxy). Chỉ
# ESTABLISHED,RELATED được accept: nhờ vậy Chrome không tái dùng HTTP keep-alive
# để nói chuyện với internet (source port cao, không match luật nào → REJECT).
SERVICE_PORTS = (5900, 6080, 8080, 8081)

DEFAULT_BRIDGE_PORT = 3101
ROUTE_TABLE = Path('/proc/net/route')

BRIDGE_MODE_ENV = 'BOX_LLM_BRIDGE'
BRIDGE_HOST_ENV = 'BOX_LLM_BRIDGE_HOST'
BRIDGE_PORT_ENV = 'BOX_LLM_BRIDGE_PORT'

_TRUTHY = frozenset({'on', '1', 'true', 'yes'})
_FALSY = frozenset({'off', '0', 'false', 'no', ''})
_HEX32 = re.compile(r'^[0-9a-fA-F]{8}$')
RTF_GATEWAY = 0x0002


class BridgeConfigError(ValueError):
    """Biến BOX_LLM_BRIDGE* sai. Luật cầu nối bị bỏ; thế phòng thủ giữ nguyên."""


def default_gateway(text=None):
    """Gateway mặc định của container, đọc từ /proc/net/route (IPv4) hoặc None.

    Không dùng `ip route`: image không cài iproute2, và /proc/net/route là nguồn
    duy nhất luôn có. Gateway trong file này là hex đảo byte
    (0102A8C0 → 192.168.2.1).
    """
    if text is None:
        try:
            text = ROUTE_TABLE.read_text(encoding='utf-8')
        except OSError:
            return None
    for line in text.splitlines()[1:]:
        fields = line.split()
        if len(fields) < 4 or fields[1] != '00000000':
            continue
        try:
            flags = int(fields[3], 16)
        except ValueError:
            continue
        if not flags & RTF_GATEWAY or not _HEX32.match(fields[2]):
            continue
        try:
            return str(ipaddress.IPv4Address(bytes.fromhex(fields[2])[::-1]))
        except ValueError:
            return None
    return None


def bridge_target(mode=None, host=None, port=None, gateway=None):
    """(host, port) khi cầu nối được BẬT, None khi tắt. Sai giá trị ⇒ BridgeConfigError.

    Thứ tự chọn địa chỉ: BOX_LLM_BRIDGE_HOST → gateway mặc định của container.
    Chỉ nhận IPv4 đúng định dạng (địa chỉ là tham số của iptables, không được là
    văn bản tự do).
    """
    value = '' if mode is None else str(mode).strip().lower()
    if value in _FALSY:
        return None
    if value not in _TRUTHY:
        raise BridgeConfigError(f'{BRIDGE_MODE_ENV} phải là "on" hoặc "off" (đang là {mode!r})')
    address = str(host or '').strip() or str(gateway or '').strip()
    if not address:
        raise BridgeConfigError(f'{BRIDGE_MODE_ENV}=on nhưng không xác định được gateway: đặt {BRIDGE_HOST_ENV}')
    try:
        ipaddress.IPv4Address(address)
    except ValueError as exc:
        raise BridgeConfigError(f'{BRIDGE_HOST_ENV} không phải địa chỉ IPv4: {address!r}') from exc
    raw_port = str(port or '').strip() or str(DEFAULT_BRIDGE_PORT)
    if not raw_port.isdigit() or not 1 <= int(raw_port) <= 65535:
        raise BridgeConfigError(f'{BRIDGE_PORT_ENV} không hợp lệ: {port!r}')
    return address, int(raw_port)


def bridge_rule(target):
    """Đúng MỘT luật accept egress tới gateway:cổng router."""
    host, port = target
    return f'-A OUTPUT -d {host} -p tcp --dport {port} -j ACCEPT'


def egress_rules(mode='off', bridge=None):
    """Danh sách luật `iptables -A OUTPUT …` cho một chế độ (hàm thuần)."""
    if str(mode).strip().lower() != 'off':
        return []
    rules = ['-A OUTPUT -o lo -j ACCEPT']
    if bridge:
        rules.append(bridge_rule(bridge))
    rules.extend(f'-A OUTPUT -p tcp --sport {port} -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT'
                 for port in SERVICE_PORTS)
    # REJECT thay vì DROP âm thầm: trình duyệt báo lỗi NGAY thay vì xoay mãi.
    # Luật cầu nối nằm TRƯỚC dòng này — sau REJECT thì nó vô nghĩa.
    rules.append('-A OUTPUT -j REJECT')
    return rules


def plan(mode='off', env=None):
    """Luật + policy cho một chế độ, kèm cầu nối đã giải và lỗi cấu hình (nếu có)."""
    env = os.environ if env is None else env
    bridge, error = None, None
    try:
        bridge = bridge_target(env.get(BRIDGE_MODE_ENV), env.get(BRIDGE_HOST_ENV),
                               env.get(BRIDGE_PORT_ENV), default_gateway())
    except BridgeConfigError as exc:
        error = str(exc)
    return {'mode': mode, 'policy': 'ACCEPT' if str(mode).strip().lower() == 'on' else 'DROP',
            'rules': egress_rules(mode, bridge), 'bridge': bridge, 'bridgeError': error}


def main(argv):
    mode = argv[1] if len(argv) > 1 else ''
    if mode not in ('on', 'off'):
        print('dùng: box-firewall-rules.py on|off', file=sys.stderr)
        return 2
    result = plan(mode)
    for rule in result['rules']:
        print(rule)
    if result['bridgeError']:
        print(f'[box-firewall-rules] CẢNH BÁO: {result["bridgeError"]} '
              f'— cầu nối LLM KHÔNG được mở, giữ nguyên thế phòng thủ', file=sys.stderr)
    elif result['bridge']:
        host, port = result['bridge']
        print(f'[box-firewall-rules] cầu nối LLM: accept egress tới {host}:{port} '
              f'({BRIDGE_MODE_ENV}=on)', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

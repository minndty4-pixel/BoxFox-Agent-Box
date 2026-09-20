"""Luật egress của công tắc mạng — kiểm KHÔNG cần root và KHÔNG chạm iptables.

Hai khẳng định quan trọng nhất:
  1. Mặc định (không đặt BOX_LLM_BRIDGE) KHÔNG có luật nào mở thêm — thế phòng
     thủ y như trước khi có cầu nối LLM.
  2. Khi bật rõ ràng, có ĐÚNG MỘT luật accept egress tới gateway:cổng router, và
     nó đứng TRƯỚC luật REJECT (sau REJECT thì luật vô nghĩa).

Kèm test đồng bộ: bộ luật dự phòng viết trong box-firewall (shell) phải giống
hệt `egress_rules('off')`, để "fail-closed fallback" không âm thầm lệch.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

DOCKER_DIRECTORY = Path(__file__).resolve().parents[1]

# Tên file có gạch ngang (đúng tên lệnh trong image) nên phải nạp bằng spec —
# cùng cách test_ide_proxy_network.py nạp ide-proxy.py.
SPEC = importlib.util.spec_from_file_location("box_firewall_rules", DOCKER_DIRECTORY / "box-firewall-rules.py")
assert SPEC and SPEC.loader
rules = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rules)

SCRIPT = DOCKER_DIRECTORY / "box-firewall-rules.py"
FIREWALL = DOCKER_DIRECTORY / "box-firewall"

# Nội dung /proc/net/route thật của một container trên bridge Docker: gateway
# 172.18.0.1 = hex đảo byte 010012AC (byte AC.12.00.01 viết ngược).
ROUTE_TABLE = """Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0
eth0\t0002A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0
"""


def off_rules(**env):
    plan = rules.plan("off", env)
    return plan["rules"], plan


class EgressRulesTest(unittest.TestCase):
    def test_default_posture_adds_no_bridge_rule(self):
        for env in ({}, {"BOX_LLM_BRIDGE": "off"}, {"BOX_LLM_BRIDGE": ""}, {"BOX_LLM_BRIDGE": "0"}):
            with self.subTest(env=env):
                listing, plan = off_rules(**env)
                self.assertEqual(plan["policy"], "DROP")
                self.assertIsNone(plan["bridge"])
                self.assertIsNone(plan["bridgeError"])
                self.assertEqual(listing[0], "-A OUTPUT -o lo -j ACCEPT")
                self.assertEqual(listing[-1], "-A OUTPUT -j REJECT")
                self.assertEqual(len(listing), 6)
                self.assertFalse([rule for rule in listing if "--dport" in rule])

    def test_enabled_bridge_adds_exactly_one_accept_to_the_gateway(self):
        listing, plan = off_rules(BOX_LLM_BRIDGE="on", BOX_LLM_BRIDGE_HOST="172.18.0.1",
                                  BOX_LLM_BRIDGE_PORT="3101")
        self.assertEqual(plan["bridge"], ("172.18.0.1", 3101))
        accepts = [rule for rule in listing if "-j ACCEPT" in rule and "--dport" in rule]
        self.assertEqual(accepts, ["-A OUTPUT -d 172.18.0.1 -p tcp --dport 3101 -j ACCEPT"])
        self.assertEqual(listing[0], "-A OUTPUT -o lo -j ACCEPT")
        self.assertLess(listing.index(accepts[0]), listing.index("-A OUTPUT -j REJECT"))
        self.assertEqual(len(listing), 7, "chỉ thêm đúng một luật")

    def test_gateway_defaults_to_the_container_default_route(self):
        self.assertEqual(rules.default_gateway(ROUTE_TABLE), "172.18.0.1")
        with mock.patch.object(rules, "default_gateway", return_value=rules.default_gateway(ROUTE_TABLE)):
            listing, plan = off_rules(BOX_LLM_BRIDGE="on")
        self.assertEqual(plan["bridge"], ("172.18.0.1", 3101))
        self.assertIn("-A OUTPUT -d 172.18.0.1 -p tcp --dport 3101 -j ACCEPT", listing)

    def test_unparsable_route_table_yields_no_gateway(self):
        self.assertIsNone(rules.default_gateway(""))
        self.assertIsNone(rules.default_gateway("Iface\tDestination\tGateway\neth0\t010012AC\t00000000\t0001\n"))
        self.assertIsNone(rules.default_gateway("Iface Destination Gateway Flags\neth0 00000000 zzzz 0003\n"))

    def test_enabled_bridge_without_gateway_stays_closed_and_says_why(self):
        with mock.patch.object(rules, "default_gateway", return_value=None):
            listing, plan = off_rules(BOX_LLM_BRIDGE="on")
        self.assertEqual(listing, rules.egress_rules("off"))
        self.assertIsNone(plan["bridge"])
        self.assertIn("BOX_LLM_BRIDGE_HOST", plan["bridgeError"])

    def test_invalid_values_never_open_anything(self):
        for env in ({"BOX_LLM_BRIDGE": "yes please"}, {"BOX_LLM_BRIDGE": "on", "BOX_LLM_BRIDGE_HOST": "router.local"},
                    {"BOX_LLM_BRIDGE": "on", "BOX_LLM_BRIDGE_HOST": "172.18.0.1; rm -rf /"},
                    {"BOX_LLM_BRIDGE": "on", "BOX_LLM_BRIDGE_HOST": "172.18.0.1", "BOX_LLM_BRIDGE_PORT": "0"},
                    {"BOX_LLM_BRIDGE": "on", "BOX_LLM_BRIDGE_HOST": "172.18.0.1", "BOX_LLM_BRIDGE_PORT": "70000"},
                    {"BOX_LLM_BRIDGE": "on", "BOX_LLM_BRIDGE_HOST": "::1"}):
            with self.subTest(env=env):
                listing, plan = off_rules(**env)
                self.assertEqual(listing, rules.egress_rules("off"))
                self.assertTrue(plan["bridgeError"])

    def test_open_mode_has_no_rules(self):
        self.assertEqual(rules.egress_rules("on"), [])
        self.assertEqual(rules.plan("on", {"BOX_LLM_BRIDGE": "on", "BOX_LLM_BRIDGE_HOST": "172.18.0.1"})["policy"], "ACCEPT")


class GeneratorCliTest(unittest.TestCase):
    def run_cli(self, *args, env=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=env, check=False)

    def test_off_prints_rule_lines_and_warns_about_the_bridge(self):
        result = self.run_cli("off", env={"BOX_LLM_BRIDGE": "on", "BOX_LLM_BRIDGE_HOST": "172.18.0.1",
                                         "PATH": "/usr/bin:/bin"})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.splitlines(), rules.egress_rules("off", ("172.18.0.1", 3101)))
        self.assertIn("172.18.0.1:3101", result.stderr)

    def test_off_without_bridge_prints_only_the_default_rules(self):
        result = self.run_cli("off", env={"PATH": "/usr/bin:/bin"})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.splitlines(), rules.egress_rules("off"))
        self.assertEqual(result.stderr, "")

    def test_bad_mode_is_refused(self):
        result = self.run_cli("sideways", env={"PATH": "/usr/bin:/bin"})
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")


class FirewallScriptTest(unittest.TestCase):
    def test_fallback_rules_match_the_generator(self):
        """Luật dự phòng trong box-firewall phải giống hệt luật mặc định sinh ra."""
        text = FIREWALL.read_text(encoding="utf-8")
        fallback = text.split("dùng luật mặc định", 1)[1]
        quoted = re.findall(r"'(-A OUTPUT[^']*)'", fallback)
        self.assertEqual(quoted, rules.egress_rules("off"))

    def test_script_applies_generated_rules_and_sets_the_policy(self):
        text = FIREWALL.read_text(encoding="utf-8")
        self.assertIn("box-firewall-rules.py", text)
        self.assertIn("iptables -F OUTPUT", text)
        self.assertIn("iptables $rule", text)
        self.assertIn("iptables -P OUTPUT DROP", text)
        self.assertIn("iptables -P OUTPUT ACCEPT", text)
        self.assertLess(text.index("box-firewall-rules.py"), text.index("iptables $rule"))

if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Exercise deployed contracts using two accounts from a local Katana startup log.

Uses only Python's standard library and Sozo. The log is deliberately restricted
to development accounts, and the RPC URL must be an HTTP loopback address.
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rpc-url", default="http://127.0.0.1:5050")
    parser.add_argument("--katana-log", required=True, type=Path)
    parser.add_argument("--migrate", action="store_true")
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.rpc_url)
    if url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("Only local HTTP development nodes are supported")

    log = args.katana_log.read_text()
    addresses = re.findall(r"Account address\s*\|\s*(0x[0-9a-fA-F]+)", log)
    keys = re.findall(r"Private key\s*\|\s*(0x[0-9a-fA-F]+)", log)
    if len(addresses) < 2 or len(keys) != len(addresses):
        parser.error("Katana startup log must contain at least two development accounts")

    # Ensure a user's production account/world environment cannot override this test.
    base_env = {k: v for k, v in os.environ.items() if not k.startswith("DOJO_")}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def rpc(method, params):
        request = urllib.request.Request(
            args.rpc_url,
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with opener.open(request, timeout=60) as response:
            result = json.load(response)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result["result"]

    if rpc("starknet_chainId", []) != "0x4b4154414e41":
        parser.error("Expected the default KATANA development chain")

    def sozo(arguments, player=0):
        env = dict(base_env, DOJO_ACCOUNT_ADDRESS=addresses[player], DOJO_PRIVATE_KEY=keys[player])
        result = subprocess.run(
            ["sozo", *map(str, arguments), "--rpc-url", args.rpc_url],
            cwd=ROOT, env=env, text=True, capture_output=True, timeout=240,
        )
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        return result.stdout

    if args.migrate:
        sozo(["migrate", "--wait"])
        print("Local world migrated", flush=True)

    manifest = json.loads((ROOT / "manifest_dev.json").read_text())
    address = next(c["address"] for c in manifest["contracts"] if c["tag"] == "surround-actions")

    def invoke(player, method, *calldata):
        output = sozo(["execute", address, method, *calldata, "--wait"], player)
        transaction = re.search(r"Transaction hash: (0x[0-9a-fA-F]+)", output).group(1)
        receipt = rpc("starknet_getTransactionReceipt", [transaction])
        if receipt["execution_status"] != "SUCCEEDED":
            raise RuntimeError(receipt)
        return transaction

    def call(method, *calldata):
        output = sozo(["call", address, method, *calldata])
        # Sozo 1.8.6 prints a duplicated 0x prefix on call results.
        return [int(value, 16) for value in re.findall(r"0x([0-9a-fA-F]+)", output.replace("0x0x", "0x"))]

    def create(size, komi):
        transaction = invoke(0, "create_game", size, komi, 0, 300, 600)
        trace = rpc("starknet_traceTransaction", [transaction])
        calls = trace["execute_invocation"]["calls"]
        result = next(c["result"] for c in calls if int(c["contract_address"], 16) == int(address, 16))
        game_id = int(result[0], 16)
        invoke(1, "join_game", game_id)
        return game_id

    def assert_game(game_id, expected):
        # get_game uses Cairo Serde field order from Game in src/models.cairo.
        names = [
            "id", "black", "white", "size", "komi_half", "rules_version", "phase",
            "next_player", "move_number", "consecutive_passes", "scoring_round",
            "turn_seconds", "scoring_seconds", "deadline", "board_hash",
            "black_captures", "white_captures", "winner", "finish_reason",
            "black_score_half", "white_score_half",
        ]
        result = call("get_game", game_id)
        assert len(result) == len(names), result
        game = dict(zip(names, result))
        for key, value in expected.items():
            assert game[key] == value, (key, game[key], value)

    game_id = create(9, 13)
    for move, point in enumerate([2, 0, 10, 1, 18, 80]):
        invoke(move % 2, "play", game_id, move, point)
    original = call("get_board", game_id)
    invoke(0, "pass", game_id, 6)
    invoke(1, "pass", game_id, 7)
    invoke(0, "mark_group", game_id, 1, 0, 0, 1)
    invoke(0, "accept_score", game_id, 1, 1)
    invoke(1, "resume_play", game_id, 1)
    assert call("get_board", game_id) == original
    assert_game(game_id, {"phase": 1, "next_player": 1, "move_number": 8})
    invoke(0, "play", game_id, 8, 9)
    invoke(1, "pass", game_id, 9)
    invoke(0, "pass", game_id, 10)
    invoke(1, "accept_score", game_id, 2, 0)
    invoke(0, "accept_score", game_id, 2, 0)
    assert_game(game_id, {
        "phase": 3, "winner": 2, "finish_reason": 1, "black_captures": 2,
        "black_score_half": 12, "white_score_half": 15,
    })
    print(f"9x9 game {game_id}: dispute, unchanged board, resumed capture, agreement verified", flush=True)

    for size, komi in [(13, 13), (19, 15)]:
        game_id = create(size, komi)
        invoke(0, "play", game_id, 0, 0)
        invoke(1, "play", game_id, 1, size * size - 1)
        invoke(0, "pass", game_id, 2)
        invoke(1, "pass", game_id, 3)
        invoke(0, "accept_score", game_id, 1, 0)
        transaction = invoke(1, "accept_score", game_id, 1, 0)
        assert_game(game_id, {
            "phase": 3, "winner": 2, "finish_reason": 1,
            "black_score_half": 2, "white_score_half": 2 + komi,
        })
        resources = rpc("starknet_getTransactionReceipt", [transaction])["execution_resources"]
        print(f"{size}x{size} game {game_id}: settlement verified; local resources {resources}", flush=True)


if __name__ == "__main__":
    main()

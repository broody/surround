#!/usr/bin/env python3
"""Measure full SGF games locally; requires sgfmill, Sozo 1.8.6 and Devnet 0.8.0."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PORT = int(os.environ.get("SURROUND_MOVE_DEVNET_PORT", "6071"))
URL = f"http://127.0.0.1:{PORT}"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def rpc(method, params=None):
    request = urllib.request.Request(URL, data=json.dumps({"jsonrpc": "2.0", "id": 1,
        "method": method, "params": params or {}}).encode(),
        headers={"Content-Type": "application/json"})
    with opener.open(request, timeout=5) as response:
        body = json.load(response)
    if "error" in body:
        raise RuntimeError(body["error"])
    return body["result"]


class MigrationAdapter(BaseHTTPRequestHandler):
    """Bridge only Sozo's version gate; actual execution stays on Devnet 0.14.2.

    Dojo migration uses methods/fields common to RPC 0.9 and 0.10.2. Sozo 1.8.6
    refuses the latter version string. Forward all execution requests unchanged.
    The replay worker connects directly to Devnet with its actual RPC version.
    """
    def log_message(self, *_):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        query = json.loads(raw)
        if query["method"] == "starknet_specVersion":
            payload = json.dumps({"jsonrpc": "2.0", "id": query["id"], "result": "0.9.0"}).encode()
        else:
            request = urllib.request.Request(URL, data=raw, headers={"Content-Type": "application/json"})
            with opener.open(request, timeout=120) as response:
                payload = response.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    spec = importlib.util.spec_from_file_location("sgf_reference", ROOT / "scripts/generate_sgf_fixtures.py")
    reference = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reference)
    fixtures = []
    for record in json.loads((reference.FIXTURES / "manifest.json").read_text())["games"]:
        fixture = reference.validate(record)
        def limbs(points):
            return [hex(sum(1 << (point % 128) for point in points if point // 128 == i)) for i in range(3)]
        fixture["board"] = limbs(fixture["stones"]["b"]) + limbs(fixture["stones"]["w"])
        del fixture["stones"], fixture["dead"]
        fixtures.append(fixture)
    fixture_path = ROOT / "benchmarks/results/move-fixtures.json"
    fixture_path.parent.mkdir(exist_ok=True)
    fixture_path.write_text(json.dumps(fixtures, indent=2) + "\n")
    version = subprocess.check_output(["starknet-devnet", "--version"], text=True).strip()
    if version != "starknet-devnet 0.8.0":
        raise RuntimeError(f"Expected Devnet 0.8.0, got {version}")
    # Refuse to borrow or overwrite any existing node on this port.
    import socket
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))
    env = {k: v for k, v in os.environ.items() if not k.startswith("DOJO_")}
    subprocess.run(["sozo", "build"], cwd=ROOT, env=env, check=True)
    with tempfile.TemporaryDirectory(prefix="surround-move-") as temporary:
        temporary = Path(temporary)
        with (temporary / "node.log").open("w") as log:
            process = subprocess.Popen(["starknet-devnet", "--host", "127.0.0.1", "--port", str(PORT),
                "--accounts", "2", "--chain-id", "KATANA", "--gas-price-fri", "1",
                "--l2-gas-price-fri", "1", "--data-gas-price-fri", "1",
                "--proof-mode", "none", "--state-archive-capacity", "full"], stdout=log, stderr=log)
            adapter = None
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError("Local Devnet failed to start")
                    try:
                        if rpc("starknet_chainId") == "0x4b4154414e41":
                            break
                    except (OSError, ValueError):
                        pass
                    time.sleep(0.1)
                else:
                    raise RuntimeError("Local Devnet readiness timed out")
                accounts = rpc("devnet_getPredeployedAccounts", {"with_balance": False})
                credentials = temporary / "accounts.log"
                credentials.touch(mode=0o600)
                credentials.write_text("\n".join(f'Account address | {a["address"]}\nPrivate key | {a["private_key"]}' for a in accounts))
                adapter = ThreadingHTTPServer(("127.0.0.1", 0), MigrationAdapter)
                threading.Thread(target=adapter.serve_forever, daemon=True).start()
                child = dict(env, DOJO_ACCOUNT_ADDRESS=accounts[0]["address"], DOJO_PRIVATE_KEY=accounts[0]["private_key"])
                migrated = subprocess.run(["sozo", "migrate", "--wait", "--use-blake2s-casm-class-hash",
                    "--rpc-url", f"http://127.0.0.1:{adapter.server_port}"], cwd=ROOT, env=child,
                    capture_output=True, text=True, timeout=240)
                if migrated.returncode:
                    raise RuntimeError(migrated.stdout + migrated.stderr)
                print("Dojo world deployed locally; starting authenticated SGF replay", flush=True)
                subprocess.run(["node", "benchmarks/moves.mjs", URL, str(credentials), str(fixture_path)],
                    cwd=ROOT, env=dict(env, SURROUND_BENCH_NODE="Starknet Devnet 0.8.0",
                        SURROUND_BENCH_OUTPUT="results/moves-modern.json"), check=True, timeout=600)
            finally:
                if adapter:
                    adapter.shutdown()
                    adapter.server_close()
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    main()

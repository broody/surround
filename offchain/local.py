#!/usr/bin/env python3
"""Build and test the offchain channel on a fresh local Devnet; no public funds."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
PORT = int(os.environ.get("SURROUND_CHANNEL_DEVNET_PORT", "6081"))
URL = f"http://127.0.0.1:{PORT}"
spec = importlib.util.spec_from_file_location("local_migration", ROOT/"benchmarks/run_moves.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
migration.URL = URL


def main():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))
    subprocess.run([sys.executable, "offchain/prepare.py", "--check"], cwd=ROOT, check=True)
    subprocess.run(["scarb", "build"], cwd=ROOT/"offchain/cairo", check=True)
    subprocess.run(["node", "offchain/pin.mjs"], cwd=ROOT, check=True)
    env = {k:v for k,v in os.environ.items() if not k.startswith("DOJO_")}
    subprocess.run(["sozo", "build"], cwd=ROOT, env=env, check=True)
    with tempfile.TemporaryDirectory(prefix="surround-channel-") as directory:
        with Path(directory,"node.log").open("w") as log:
            process = subprocess.Popen(["starknet-devnet", "--host", "127.0.0.1", "--port", str(PORT),
                "--accounts", "2", "--chain-id", "KATANA", "--gas-price-fri", "1", "--l2-gas-price-fri", "1",
                "--data-gas-price-fri", "1", "--proof-mode", "none", "--state-archive-capacity", "full"], stdout=log, stderr=log)
            adapter = None
            try:
                for _ in range(100):
                    if process.poll() is not None: raise RuntimeError("Devnet failed to start")
                    try:
                        if migration.rpc("starknet_chainId") == "0x4b4154414e41": break
                    except OSError: pass
                    time.sleep(.1)
                else: raise RuntimeError("Devnet did not become ready")
                accounts = migration.rpc("devnet_getPredeployedAccounts", {"with_balance":False})
                adapter = migration.ThreadingHTTPServer(("127.0.0.1",0), migration.MigrationAdapter)
                threading.Thread(target=adapter.serve_forever,daemon=True).start()
                child = dict(env, DOJO_ACCOUNT_ADDRESS=accounts[0]["address"], DOJO_PRIVATE_KEY=accounts[0]["private_key"])
                migrated = subprocess.run(["sozo","migrate","--wait","--use-blake2s-casm-class-hash","--rpc-url",
                    f"http://127.0.0.1:{adapter.server_port}"], cwd=ROOT, env=child, capture_output=True,text=True,timeout=240)
                if migrated.returncode: raise RuntimeError(migrated.stdout+migrated.stderr)
                print("Actual Dojo channel deployed locally; exercising SDK and settlement",flush=True)
                subprocess.run(["node","offchain/smoke.mjs",URL],cwd=ROOT,env=env,check=True,timeout=600)
            finally:
                if adapter: adapter.shutdown(); adapter.server_close()
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait()


if __name__ == "__main__": main()

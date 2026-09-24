#!/usr/bin/env python3
"""Execute and prove authenticated games locally with real Stwo bootloader proofs.

Usage: python offchain/prove.py [fixture-id ...]
With no IDs, proves all six published games. Output is not a native SNIP-36 proof.
"""
import hashlib
import json
import os
import platform
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
PROJECT = HERE / "proving"
FIELD = 2**251 + 17 * 2**192 + 1
ENV = dict(os.environ, RAYON_NUM_THREADS=os.environ.get("RAYON_NUM_THREADS", "8"))


def run(command, log):
    start = time.perf_counter()
    with log.open("w") as stream:
        process = subprocess.Popen(command, cwd=PROJECT, env=ENV, stdout=stream, stderr=subprocess.STDOUT)
        _, status, usage = os.wait4(process.pid, 0)
        process.returncode = os.waitstatus_to_exitcode(status)
    return {"wall_seconds": time.perf_counter()-start, "exit_code": process.returncode,
        "peak_rss_bytes": usage.ru_maxrss * (1 if platform.system() == "Darwin" else 1024)}, log.read_text()


def expect(result, text):
    if result["exit_code"]:
        raise RuntimeError(text[-2500:])


def main():
    subprocess.run([sys.executable, str(HERE/"prepare.py"), "--check"], check=True)
    names = sys.argv[1:] or [f["id"] for f in json.loads((HERE/"fixtures/manifest.json").read_text())]
    raw = HERE/"results/raw/local-proofs"
    raw.mkdir(parents=True, exist_ok=True)
    expect(*run(["scarb", "build"], raw/"build.log"))
    # Compute expected public encoding with the independently implemented JS SDK.
    expected_source = """import {readFile} from 'node:fs/promises';
import {contextHash,stateHash,encodeState,hex} from './sdk/src/index.mjs';
const f=JSON.parse(await readFile(process.argv[1],'utf8'));
console.log(JSON.stringify([contextHash(f.terms),stateHash(f.start),...encodeState(f.expected)].map(hex)));"""
    output_file = HERE/"results/local-proofs.json"
    result = {"kind": "Real Stwo Cairo bootloader; not native SNIP-36", "platform": platform.platform(),
        "scarb": subprocess.check_output(["scarb", "--version"], cwd=PROJECT, text=True).strip(),
        "threads": int(ENV["RAYON_NUM_THREADS"]), "records": []}
    if output_file.exists():
        result["records"] = [r for r in json.loads(output_file.read_text())["records"] if r["id"] not in names]
    for name in names:
        fixture_path = HERE/f"fixtures/{name}.json"
        fixture = json.loads(fixture_path.read_text())
        folder = raw/name
        folder.mkdir(exist_ok=True)
        args_file = folder/"arguments.json"
        args_file.write_text(json.dumps(fixture["proof_input"]))
        execution, log = run(["scarb", "execute", "--no-build", "--target", "bootloader", "--output", "standard",
            "--arguments-file", str(args_file), "--print-program-output", "--print-resource-usage", "--json"], folder/"execute.log")
        expect(execution, log)
        events = [json.loads(line) for line in log.splitlines() if line.startswith("{")]
        summary = next(e for e in events if "program_output" in e)
        output = [int(x) % FIELD for x in summary["program_output"].splitlines()]
        expected = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", expected_source, str(fixture_path)], cwd=HERE, text=True))
        assert len(output) == 32 and output[:2] == [1,31], "Wrong bootloader framing"
        assert output[3:] == [int(x,16) for x in expected], "JS/Cairo public output mismatch"
        directory = PROJECT/next(e["message"] for e in events if e.get("status") == "saving output to:")
        execution_id = directory.name.removeprefix("execution")
        print(f"{name}: {len(fixture['actions'])} authenticated actions, {summary['resources']['n_steps']:,} VM steps; proving", flush=True)
        proved, log = run(["scarb", "prove", "--execution-id", execution_id, "--json"], folder/"prove.log")
        expect(proved, log)
        proof_path = directory/"proof/proof.json"
        verified, log = run(["scarb", "verify", "--proof-file", str(proof_path), "--json"], folder/"verify.log")
        expect(verified, log)
        data = json.loads(proof_path.read_text())
        memory = data["claim"]["public_data"]["public_memory"]["output"]
        decoded = [sum(limb << (32*i) for i,limb in enumerate(words)) for _,words in memory]
        assert decoded == output, "Proof public output mismatch"
        memory[-4][1][0] ^= 1  # Alter Black's public score, retaining the proof.
        tampered = folder/"tampered.json"
        tampered.write_text(json.dumps(data))
        rejected, log = run(["scarb", "verify", "--proof-file", str(tampered), "--json"], folder/"tamper.log")
        assert rejected["exit_code"] == 1 and "failed to verify proof" in log, "Tampered output accepted"
        tampered.unlink()
        record = {"id":name,"measured_at":datetime.now(timezone.utc).isoformat(),"actions":len(fixture["actions"]),
            "result":fixture.get("result"),"resources":summary["resources"],"execute":execution,"prove":proved,"verify":verified,
            "program_hash":str(output[2]),"public_output":[str(x) for x in output[3:]],"changed_score_rejected":True,
            "proof_path":str(proof_path.relative_to(HERE.parent)),"proof_json_bytes":proof_path.stat().st_size,
            "proof_sha256":hashlib.sha256(proof_path.read_bytes()).hexdigest(),
            "protocol_sha256":hashlib.sha256((HERE.parent/"src/channel_protocol.cairo").read_bytes()).hexdigest()}
        result["records"].append(record)
        output_file.write_text(json.dumps(result, indent=2)+"\n")
        print(f"{name}: verified; prove {proved['wall_seconds']:.2f}s, {proved['peak_rss_bytes']/2**30:.2f} GiB; changed score rejected", flush=True)


if __name__ == "__main__":
    main()

"""Check every constant in ratings/src/math.cairo against high-precision values.

    python3 offchain/ratings/audit/constants.py
"""
from decimal import Decimal as D, getcontext, ROUND_HALF_EVEN
import re, pathlib

getcontext().prec = 60
ROOT = pathlib.Path(__file__).resolve().parents[3]
src = (ROOT / "ratings/src/math.cairo").read_text()
Q = D(2) ** 32


def arr(name):
    body = re.search(name + r": \[i128; \d+\] = \[(.*?)\];", src, re.S).group(1)
    return [int(x) for x in re.findall(r"-?\d+", body)]


def const(name):
    return int(re.search(r"const " + name + r": i128 = (0x[0-9a-f]+|-?\d+);", src).group(1), 0)


def rnd(x):
    return int(x.quantize(D(1), rounding=ROUND_HALF_EVEN))


ln2 = D(2).ln()
pi = D("3.14159265358979323846264338327950288419716939937510582097494")
bad = 0
mu_t = arr("MU_T")
for r, v in enumerate(mu_t):
    want = rnd((D(525) * (D(r) / D("23.15")).exp() - 1500) / D("173.7178") * Q)
    if want != v:
        bad += 1
        print(f"MU_T[{r}] = {v}, want {want} (off {v - want})")
print(f"MU_T: {len(mu_t)} entries, {bad} mismatches")
for r in (0, 7, 13, 24, 29, 30, 38, 39):
    rating = 1500 + D("173.7178") * D(mu_t[r]) / Q
    print(f"  rank({r}) from stored mu: {D('23.15') * (rating / 525).ln():.9f}  rating {rating:.3f}")
print(f"  band 3 (mu 0, rating 1500): rank {D('23.15') * (D(1500) / 525).ln():.6f}")

exp_t = arr("EXP_T")
for j, v in enumerate(exp_t):
    want = rnd((-D(j) / 16).exp() * Q)
    assert v == want, (j, v, want)
print("EXP_T: exact (round half even)")
for name, val in [("LN2", ln2 * Q), ("PI2", pi * pi * Q), ("MIN_PHI", D("0.01") * Q)]:
    got, want = const(name), rnd(val)
    print(f"{name}: {got} want {want} {'OK' if got == want else 'MISMATCH'}")
cnum = const("CNUM_ONE")
exact = D("1.15") * 2 * ln2 * Q * Q
print(f"CNUM_ONE: {cnum}; exact 1.15*2*ln2*2^64 = {exact:.1f}; rel err {(D(cnum) - exact) / exact:.2e}")
print(f"  cnum/2^32 = {D(cnum) / Q}  (round(1.15*2*ln2*2^32) = {rnd(D('1.15') * 2 * ln2 * Q)})")
print(f"  JS CNUM_ONE 6847202285*2^32 = {6847202285 * 2**32}  equal: {6847202285 * 2**32 == cnum}")

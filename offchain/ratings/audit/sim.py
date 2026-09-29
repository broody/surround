"""Long-horizon simulation of Surround's rating model on synthetic populations.

Players have a true strength θ in logits (the model's μ scale: P(a beats b) =
σ(θa − θb)), arrive and churn, pick a starting band, and are paired each day by
closest displayed rank (the matchmaker's rule, 9-rank cap). The model is
offchain/ratings/systems.py's run_surround (the integer update matches it to
~1e-8). Reports, per year, the mean displayed-rank error rank(μ) − rank(θ) of
active established players (inflation > 0), the share pinned at the clamps,
and the drift of the rating "mass".

    python3 offchain/ratings/audit/sim.py [scenario ...]
"""
import bisect
import math
import random
import sys

DAY = 86400.0
MU_T = [(525.0 * math.exp(r / 23.15) - 1500.0) / 173.7178 for r in range(40)]
MU_MIN, MU_MAX = MU_T[0], MU_T[39] - 1e-9
BAND_MU = [MU_T[7], MU_T[13], 0.0, MU_T[29]]
EXT = [(525.0 * math.exp(r / 23.15) - 1500.0) / 173.7178 for r in range(-60, 81)]


def rank_of(mu):
    """OGS rank (0 = 30k) of any μ, extended past the table for true strengths."""
    if mu <= EXT[0]:
        return -60.0
    i = bisect.bisect_right(EXT, mu) - 1
    i = min(i, len(EXT) - 2)
    return -60 + i + (mu - EXT[i]) / (EXT[i + 1] - EXT[i])


def half_life(rank):
    return 15.0 if rank < 16 else 45.0 if rank >= 30 else 15.0 + 30.0 * (rank - 16) / 14


class Model:
    def __init__(self, phi0=2.0, clamp=True, min_phi=0.01):
        self.phi0, self.clamp, self.min_phi = phi0, clamp, min_phi

    def variance(self, p, t):
        if p["phi"] == 0:
            return self.phi0 ** 2
        dt = t - p["last"]
        if dt <= 0:
            return p["phi"] ** 2
        c = 1.15 * 2 * math.log(2) / half_life(rank_of(p["mu"]))
        return min(self.phi0 ** 2, p["phi"] ** 2 + c * c * min(dt, 2 ** 30) / DAY)

    def update(self, a, b, s, t):
        va, vb = self.variance(a, t), self.variance(b, t)
        g = lambda v: 1 / math.sqrt(1 + 3 * v / math.pi ** 2)
        out = []
        for me, v, opp, vo, sc in ((a, va, b, vb, s), (b, vb, a, va, 1 - s)):
            gg = g(vo)
            e = 1 / (1 + math.exp(-gg * (me["mu"] - opp["mu"])))
            v2 = 1 / (1 / v + gg * gg * e * (1 - e))
            mu = me["mu"] + v2 * gg * (sc - e)
            if self.clamp:
                mu = min(MU_MAX, max(MU_MIN, mu))
            out.append((mu, max(self.min_phi, math.sqrt(v2)), mu - me["mu"]))
        for p, (mu, phi, _) in zip((a, b), out):
            p["mu"], p["phi"], p["last"] = mu, phi, max(p["last"], t)
        return out[0][2], out[1][2]


def band_for(theta, how, rng):
    if how == "default":
        return 2  # band 3 (index 2): 1500 / 6k, the matchmaker's default
    if how == "over":  # new players overrate themselves by ~1.5 logits
        theta += 1.5 + rng.gauss(0, 0.5)
    if how == "under":  # sandbaggers: strong players pick the lowest band
        return 0
    if how == "exact":  # a perfect starting estimate (isolates the model's own drift)
        return None
    return min(range(4), key=lambda i: abs(BAND_MU[i] - theta))


def run(name, years=10, arrivals_per_day=12, mean_days=240, games_per_day=1.5, theta_mu=-1.0, theta_sd=2.0,
        band="closest", clamp=True, improve=0.0, seed=1, phi0=2.0):
    rng = random.Random(seed)
    model = Model(phi0=phi0, clamp=clamp)
    players, active = [], []
    t0 = 1.7e9
    entry = []
    print(f"\n== {name} ==")
    print(" year  active  est.  rank err mid (sd)   μ−θ mid   μ−θ all   at 30k  at 9d  entry bias")
    for day in range(int(years * 365)):
        t = t0 + day * DAY
        for _ in range(rng.randrange(2 * arrivals_per_day + 1)):
            theta = rng.gauss(theta_mu, theta_sd)
            bi = band_for(theta, band, rng)
            start = min(MU_MAX, max(MU_MIN, theta)) if bi is None else BAND_MU[bi]
            entry.append(start - theta)
            p = {"theta": theta, "mu": start, "phi": 0.0, "last": 0.0,
                 "until": day + rng.expovariate(1 / mean_days), "w": 0, "l": 0, "est": False, "born": day}
            players.append(p)
            active.append(p)
        active = [p for p in active if p["until"] > day]
        if improve:
            for p in active:  # beginners improve: +improve logits/year for the first two years
                if day - p["born"] < 730:
                    p["theta"] += improve / 365
        # Each active player wants ~games_per_day games; pair by displayed rank.
        today = [p for p in active for _ in range(int(games_per_day) + (rng.random() < games_per_day % 1))]
        today.sort(key=lambda p: rank_of(p["mu"]) + rng.gauss(0, 1.0))
        for i in range(0, len(today) - 1, 2):
            a, b = today[i], today[i + 1]
            if a is b or abs(rank_of(a["mu"]) - rank_of(b["mu"])) > 9:
                continue
            s = 1.0 if rng.random() < 1 / (1 + math.exp(-(a["theta"] - b["theta"]))) else 0.0
            ra, rb = a["mu"], b["mu"]
            model.update(a, b, s, t + rng.random() * DAY)
            for p, sc in ((a, s), (b, 1 - s)):
                p["w" if sc else "l"] += 1
                if not p["est"] and p["phi"] <= 1.0 and p["w"] and p["l"]:
                    p["est"] = True
        if (day + 1) % 365 == 0:
            est = [p for p in active if p["est"]]
            # "mid": true strength well inside the clamps, so no clamp binds on them directly.
            mid = [p for p in est if MU_T[5] <= p["theta"] <= MU_T[35]]
            errs = [rank_of(p["mu"]) - rank_of(p["theta"]) for p in mid]
            m = sum(errs) / max(1, len(errs))
            sd = math.sqrt(sum((e - m) ** 2 for e in errs) / max(1, len(errs)))
            dmid = sum(p["mu"] - p["theta"] for p in mid) / max(1, len(mid))
            dall = sum(p["mu"] - p["theta"] for p in est) / max(1, len(est))
            lo = sum(p["mu"] <= MU_MIN + 1e-12 for p in est) / max(1, len(est))
            hi = sum(p["mu"] >= MU_MAX - 1e-6 for p in est) / max(1, len(est))
            eb = sum(entry) / max(1, len(entry))
            print(f" {(day + 1) // 365:4d}  {len(active):6d} {len(est):5d}  {m:+6.2f} ({sd:4.2f})      {dmid:+.3f}    {dall:+.3f}   {lo:6.1%}  {hi:5.1%}   {eb:+.3f}")


SCENARIOS = {
    "baseline": dict(),
    "exact": dict(band="exact"),
    "exact-no-clamp": dict(band="exact", clamp=False),
    "strong-tail": dict(theta_mu=1.0, theta_sd=2.0),
    "no-clamp": dict(clamp=False),
    "weak-tail": dict(theta_mu=-3.0, theta_sd=2.2),
    "weak-tail-no-clamp": dict(theta_mu=-3.0, theta_sd=2.2, clamp=False),
    "default-band": dict(band="default"),
    "overrated-bands": dict(band="over"),
    "improving": dict(improve=1.0),
    "phi0-3": dict(phi0=3.0),
}

if __name__ == "__main__":
    names = sys.argv[1:] or list(SCENARIOS)
    for n in names:
        run(n, **SCENARIOS[n])

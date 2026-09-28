"""Rating systems replayed over OGS's games. Each returns P(black wins) for
every game, computed before the game updates anything (NaN where skipped).

    python3 systems.py surround data/games.npz data/pred_surround.npz
    GORATINGS=path/to/goratings python3 systems.py ogs data/games.npz data/pred_ogs.npz

`surround` is Surround's model in floating point (sdk/src/rating.mjs is the
integer version). `ogs` is OGS's Glicko-2, one game at a time, with goratings'
analysis defaults. Ranks are OGS's: 0 = 30k, 30 = 1d.
"""
import math
import os
import sys

import numpy as np

DAY = 86400.0
LO, HI = -60, 80  # the rank map extends past 30k-9d for handicap head starts


def ogs_mu(rank):
    return (525.0 * math.exp(rank / 23.15) - 1500.0) / 173.7178


MU_T = [ogs_mu(r) for r in range(LO, HI + 1)]


def mu_of(rank):
    """μ at a rank, linear between whole ranks (as the contract's table)."""
    r = min(max(rank, LO), HI - 1e-9)
    i = int(math.floor(r)) - LO
    return MU_T[i] + (r - math.floor(r)) * (MU_T[i + 1] - MU_T[i])


def rank_of(mu):
    if mu <= MU_T[0]:
        return float(LO)
    lo, hi = 0, len(MU_T) - 2
    while lo < hi:
        mid = (lo + hi) // 2
        if MU_T[mid + 1] > mu:
            hi = mid
        else:
            lo = mid + 1
    return LO + lo + (mu - MU_T[lo]) / (MU_T[lo + 1] - MU_T[lo])


def half_life(rank):
    return 15.0 if rank < 16 else 45.0 if rank >= 30 else 15.0 + 30.0 * (rank - 16) / 14


def run_surround(d, phi0=2.0, drift=1.15, min_phi=0.01, start=0.0, clamp=(0, 39)):
    """Surround's model: Glicko-2 without volatility, aging by KGS half-lives."""
    lo, hi = mu_of(clamp[0]), mu_of(clamp[1]) - 1e-9
    n = len(d["result"])
    p = np.full(n, np.nan, np.float32)
    mu, phi, last = {}, {}, {}

    def variance(x, t):
        if x not in phi:
            return phi0 * phi0
        dt = t - last[x]
        if dt <= 0:
            return phi[x] ** 2
        c = drift * 2 * math.log(2) / half_life(rank_of(mu[x]))
        return min(phi0 * phi0, phi[x] ** 2 + c * c * min(dt, 2 ** 30) / DAY)

    def g(v):
        return 1 / math.sqrt(1 + 3 * v / math.pi ** 2)

    def side(m, v, gg, opp, s):
        e = 1 / (1 + math.exp(-gg * (m - opp)))
        v2 = 1 / (1 / v + gg * gg * e * (1 - e))
        return min(hi, max(lo, m + v2 * gg * (s - e))), max(min_phi, math.sqrt(v2))

    for i in range(n):
        if d["skip"][i]:
            continue
        b, w, h, t = int(d["black"][i]), int(d["white"][i]), float(d["hrd"][i]), float(d["ended"][i])
        mb, mw = mu.get(b, start), mu.get(w, start)
        vb, vw = variance(b, t), variance(w, t)
        mb_eff, mw_eff = (mu_of(rank_of(mb) + h), mu_of(rank_of(mw) - h)) if h else (mb, mw)
        p[i] = 1 / (1 + math.exp(-g(vb + vw) * (mb_eff - mw)))
        s = float(d["result"][i])
        mu[b], phi[b] = side(mb, vb, g(vw), mw_eff, s)
        mu[w], phi[w] = side(mw, vw, g(vb), mb_eff, 1 - s)
        last[b] = max(last.get(b, t), t)
        last[w] = max(last.get(w, t), t)
    return p


def run_ogs(d):
    """goratings analysis/analyze_glicko2_one_game_at_a_time.py (tau 0.5, min RD 10)."""
    sys.path.insert(0, os.environ["GORATINGS"])
    from goratings.math import glicko2 as G

    G.glicko2_configure(tao=0.5, min_rd=10.0, max_rd=500.0, aging_period_days=None)
    rank = lambda rating: math.log(rating / 525.0) * 23.15
    rating = lambda k: 525.0 * math.exp(k / 23.15)

    def update(player, opp, won, t):
        try:
            return G.glicko2_update(player, [(opp, won)], timestamp=t)
        except (OverflowError, ValueError, ZeroDivisionError):
            # goratings' volatility iteration overflows on a few extreme games;
            # redo the step with volatility unchanged.
            gg = 1 / math.sqrt(1 + 3 * opp.phi ** 2 / math.pi ** 2)
            e = 1 / (1 + math.exp(-gg * (player.mu - opp.mu)))
            v = 1 / (gg * gg * e * (1 - e)) if 0 < e < 1 else 9999
            phi = 1 / math.sqrt(1 / (player.phi ** 2 + player.volatility ** 2) + 1 / v)
            mu = player.mu + phi * phi * gg * ((1.0 if won else 0.0) - e)
            return G.Glicko2Entry(min(G.MAX_RATING, max(G.MIN_RATING, G.GLICKO2_SCALE * mu + 1500)),
                                  min(G.MAX_RD, max(G.MIN_RD, G.GLICKO2_SCALE * phi)), player.volatility, t)

    n = len(d["result"])
    p = np.full(n, np.nan, np.float32)
    st = {}
    for i in range(n):
        if d["skip"][i]:
            continue
        b, w, h, t = int(d["black"][i]), int(d["white"][i]), float(d["hrd"][i]), int(d["ended"][i])
        B, W = st.get(b) or G.Glicko2Entry(), st.get(w) or G.Glicko2Entry()
        adj_b = rating(rank(B.rating) + h) - B.rating
        adj_w = rating(rank(W.rating) - h) - W.rating
        gc = 1 / math.sqrt(1 + 3 * (B.phi ** 2 + W.phi ** 2) / math.pi ** 2)
        p[i] = 1 / (1 + math.exp(-gc * (B.rating + adj_b - W.rating) / G.GLICKO2_SCALE))
        s = d["result"][i]
        st[b], st[w] = update(B, W.copy(adj_w), s == 1, t), update(W, B.copy(adj_b), s == 0, t)
    return p


if __name__ == "__main__":
    name, games, out = sys.argv[1:4]
    z = np.load(games)
    d = {k: z[k] for k in z.files}
    np.savez(out, p={"surround": run_surround, "ogs": run_ogs}[name](d))

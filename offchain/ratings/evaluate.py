"""Score predictions on the same games, independent of any system.

    python3 evaluate.py data/games.npz data/pred_surround.npz data/pred_ogs.npz

Games count when decided, not skipped, and both players already have at least
10 rated games; the test split is the last 30% of those by time. Reports log
loss (a coin flip is 0.693) and the calibration slope (1.0 is calibrated,
below 1 overconfident) overall, on even games, per size and on handicap games.
"""
import sys

import numpy as np


def calibration_slope(p, y, iters=50):
    x = np.clip(np.log(p / (1 - p)), -12, 12)
    a, b = 0.0, 1.0
    for _ in range(iters):
        q = 1 / (1 + np.exp(-np.clip(a + b * x, -30, 30)))
        w = q * (1 - q)
        ga, gb = np.sum(y - q), np.sum((y - q) * x)
        haa, hab, hbb = np.sum(w), np.sum(w * x), np.sum(w * x * x)
        det = haa * hbb - hab * hab
        if det <= 0:
            break
        da, db = (hbb * ga - hab * gb) / det, (haa * gb - hab * ga) / det
        step = max(abs(da), abs(db))
        if step > 0.5:
            da, db = da * 0.5 / step, db * 0.5 / step
        a, b = a + da, b + db
        if step < 1e-7:
            break
    return b


def score(p, y, mask):
    m = mask & ~np.isnan(p)
    pp, yy = np.clip(p[m].astype(np.float64), 1e-6, 1 - 1e-6), y[m]
    return -np.mean(yy * np.log(pp) + (1 - yy) * np.log(1 - pp)), calibration_slope(pp, yy), int(m.sum())


def main(games, *preds):
    d = np.load(games)
    y = d["result"].astype(np.float64)
    base = (~d["skip"]) & (d["result"] >= 0) & (d["nb_prior"] >= 10) & (d["nw_prior"] >= 10)
    idx = np.flatnonzero(base)
    test = base.copy()
    test[: idx[int(len(idx) * 0.7)]] = False
    even = d["hcap"] == 0
    slices = [("all", test), ("even", test & even)] + [
        (f"even {s}x{s}", test & even & (d["size"] == s)) for s in (9, 13, 19)] + [("handicap", test & ~even)]
    for path in preds:
        p = np.load(path)["p"]
        print(path)
        for name, mask in slices:
            ll, slope, n = score(p, y, mask)
            print(f"  {name:12s} log loss {ll:.4f}  slope {slope:.2f}  n {n}")


if __name__ == "__main__":
    main(*sys.argv[1:])

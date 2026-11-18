# Token Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/JustForYou11/-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/JustForYou11/-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks,
finds the ones that record no token and are not a wrapped, staked or bridged product of
one that trades, and ranks them by what their launch would be worth, each with the steps
to farm it.

## The model (radar-3)

The implied value is fitted, not taken from a median multiple. On the snapshot's
128 live-token protocols (TVL > 0, market cap > 0) the model fits, by OLS,

```
log(mcap_usd) = 6.9646 + 0.5223 x log(tvl_usd) + effect[category]
fitted_base_usd = exp(log(mcap_usd))
```

The intercept and slope come from the snapshot itself; there is no hardcoded multiple.
Each category's effect is the mean residual of that category's live-token protocols,
shrunk toward zero by `n / (n + 10)`: a category with 1 live name keeps ~9% of its
raw effect, one with 10 keeps half, one with 15 keeps 60%. The largest effects are
Prediction Market +0.59 (n=1, heavily shrunk), Basis Trading +0.45 (n=7) and CEX
+0.35 (n=9); the smallest are Staking Pool -0.51 (n=2), Liquid Staking -0.47 (n=9)
and Lending -0.34 (n=15). Categories with no live names carry an effect of 0.

The radar-2 post-multipliers are kept unchanged on top of the fitted base:

```
implied = round(fitted_base_usd
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + min(chains - 1, 4) x 0.05))
```

The radar-2 median multiple (median mcap/TVL per category, n >= 5, else the global
median, clamped to [0.05, 1.0]) is kept as the validation baseline and as a reference
the dashboard still shows.

### Validation (out-of-sample, on the live-token protocols)

The error is `|log(predicted mcap) - log(actual mcap)|`, the predicted mcap being
the model's full implied value. Leave-one-out refits both models without each of
the 128 live-token protocols in turn; walk-forward sorts the 95 listed live-token
protocols by listing date and trains on the earlier listings, testing on the later
ones, on two expanding folds (cutoff 2023-06-07: train 31, test 64; cutoff
2024-12-19: train 63, test 32; pooled over 96 test predictions).

| metric | radar-2 median | radar-3 fitted | improvement |
| --- | --- | --- | --- |
| leave-one-out log-MAE | 1.8748 | 1.6111 | 14.07% |
| walk-forward log-MAE | 1.8582 | 1.6037 | 13.70% |
| combined | | | **13.88%** |

Variants tried before settling on this one: shrinkage k = 2, 3, 5, 8, 10, 12, 15, 20,
30, 50, 100 (the combined improvement is flat at 12.8–14.7% for k = 5–100, so k = 10
was chosen as the smallest round value on the plateau); slope fixed at 1 instead of
free (combined +1.2%, essentially no gain — the free slope of 0.52 is doing the work);
adding log(age) (leave-one-out 12.3% better but walk-forward 59.3% worse: age
extrapolates badly across listing cohorts, rejected); adding log(#chains) (+10.4%,
worse than the chosen model); a 50/50 blend of the fitted base with the median
multiple (+7.9%, worse than the fitted model alone). The validation numbers above
are also written into `data.js` under `validation`, and the fitted coefficients into
`fitted`.

### Rank ranges

Each row carries `rank_low` / `rank_high`, the 5th / 95th percentile of its rank
across 200 bootstrap refits of the fitted model (resampling the 128 live-token
protocols with replacement, mulberry32 PRNG seeded 20261114 — no `Math.random`, no
clock, so two runs are byte-identical). The top of the board is tight (rank 1 spans
1–2, rank 2 spans 2–3, rank 3 spans 3–4); the median row's range is 46 ranks wide,
which is the honest uncertainty of a fitted model on 128 live names.

### Costed farm plans

Every row carries a costed plan. Gas per transaction follows the protocol's first
chain: Ethereum $4.00, Solana $0.05, Base / Arbitrum / Optimism $0.30, Binance
$0.15, any other chain $1.00. A plan is 1 setup + 1 deposit + one weekly qualifying
transaction per week of the hold (capped at 8) + 1 claim; the hold is 30 / 45 / 60
days by age (60 under 180 days, 45 under a year, else 30). Capital follows the TVL
tiers ($250 at TVL >= $5B, $150 at >= $1B, $100 at >= $100M, else $50). Then
`expected_usd = implied_value_usd x (capital_usd / tvl_usd)`,
`breakeven_usd = total_gas_usd / (capital_usd / tvl_usd)` and
`net_usd = expected_usd - total_gas_usd`. The verdict is `farm` when net > 0,
`thin` when the implied value is at least half the break-even, and `skip`
otherwise. On this snapshot: 116 farm, 35 thin, 47 skip. The six farm steps keep
their old wording; the costed figures live on the row (`farm_cost_usd`,
`farm_breakeven_usd`, `farm_net_usd`, `farm_verdict`, and the `farm` object) for
the dashboard to show.

No protocol name is special-cased. The board carries every rankable pre-token protocol
(198 rows: the 40-protocol watchlist plus 158 early ones below the floor), and the
live-token protocols are set aside with their market caps shown.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, copies
`dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored
`vendor/makefun-board.ts`. Open `out/dashboard/index.html` in a browser; it renders
with no network.

## License

MIT — see LICENSE.

---

<sub>Entered on [make.fun](https://make.fun/?ref=fbka3826&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/miuoas47-gif/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/miuoas47-gif/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every rankable pre-token protocol in the sealed DefiLlama snapshot — all 198 of them, the 40 on the watchlist plus the 158 early ones below the floor — by an implied value calibrated on the live-token protocols themselves. Each category's mcap/TVL median, shrunk toward the overall median, prices a protocol's TVL; growth, maturity and chain breadth adjust it. A protocol is rankable only if it records no token and is not a wrapped, staked or bridged product of a token that already trades: its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no whole word wrapped, staked or staking, and it does not begin with an exchange's name. Protocols whose token already trades are set aside in their own list, at their market's own value. Every row carries a seven-step farm plan with costs and times, derived from the protocol's own record.

## How the value is worked out

implied = round(tvl_usd × ratio(category) × (1 + clamp(change_7d, −60, 120) / 100 × 0.5) × (0.6 + min(age_days, 1095) / 1095 × 0.4) × (1 + 0.02 × min(max(chains − 1, 0), 5))). ratio(category) is the median mcap/TVL of the live-token protocols in that category, shrunk toward the overall median with a prior of 5 — but only when the category has at least 3 live comps; with fewer than 3, the category uses the overall median instead, because a median of 1 or 2 observations is not a median. Categories with no live comps use the overall median too. No protocol name is special-cased and no per-protocol value is hardcoded — the same function scores every row, and the comps table it reads is computed from the snapshot at runtime. The dashboard shows the full comps table, marking which categories fell back, and, for each protocol, the arithmetic with its real numbers.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to the kit input dir>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=6gvkzysc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

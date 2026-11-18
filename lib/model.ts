// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol that records no token and is not a wrapped, staked or bridged
// product of one that trades: the watchlist (the floor, never a ceiling) plus every pre-token
// protocol below the floor the house's own rule keeps. A protocol is pre-token when its index entry
// records no token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token protocols
// are kept apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. Radar-3 fits it, it does not take a
// median multiple: log(mcap) is regressed on log(TVL) over the live-token protocols, with one
// effect per category taken from that category's mean residual and shrunk toward zero by
// n / (n + 10), so a category with one live name keeps ~9% of its raw effect and one with ten
// keeps half. The fitted base is exp(predicted log mcap); the radar-2 growth, maturity and chain
// post-multipliers are kept unchanged:
//
//   log mcap   = intercept + slope x log(TVL) + effect[category]   (OLS on live-token protocols)
//   fittedBase = exp(log mcap)
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainMult  = 1 + min(chains - 1, 4) x 0.05            (multi-chain reach, capped at +20%)
//   implied    = max(1, round(fittedBase x growthMult x maturity x chainMult)), capped at $100B
//
// The radar-2 median multiple is kept as the validation baseline and as a reference the dashboard
// still shows: median(mcap/TVL) per category (n >= 5), else the global median, clamped [0.05, 1.0].
//
// Validation is out-of-sample, on the live-token protocols only, and is reported with the board:
// leave-one-out MAE and walk-forward (expanding window, 2 folds) MAE of
// |log(predicted mcap) - log(actual mcap)|, where the predicted mcap is the model's full implied
// value. Rank ranges come from 200 deterministic bootstrap refits (mulberry32, fixed seed) of the
// fitted model; each board row records the 5th and 95th percentile of its rank across the refits.
// Farm plans are costed with the gas table in this file, so every row's expected value, break-even
// and verdict follow from the same numbers the dashboard shows.
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  multiple_floor: number;
  multiple_cap: number;
  min_category_n: number;
  implied_cap: number;
  shrink_k: number;
  bootstrap_refits: number;
  bootstrap_seed: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.05,
  chain_max_extra: 4,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  min_category_n: 5,
  implied_cap: 100_000_000_000,
  shrink_k: 10,
  bootstrap_refits: 200,
  bootstrap_seed: 20261114,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Gas per transaction in USD, by the protocol's first chain; any other chain costs $1.00. */
export const GAS_USD_BY_CHAIN: Record<string, number> = {
  Ethereum: 4,
  Solana: 0.05,
  Base: 0.3,
  Arbitrum: 0.3,
  Optimism: 0.3,
  Binance: 0.15,
};
export const GAS_USD_DEFAULT = 1.0;
/** The most weekly qualifying transactions a farm plan ever counts. */
export const MAX_WEEKLY_TXS = 8;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  fitted_base_usd: number;
  rank_low: number;
  rank_high: number;
  farm_cost_usd: number;
  farm_breakeven_usd: number;
  farm_net_usd: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
  model: {
    category_multiple: number;
    multiple_source: string;
    fitted_base_usd: number;
    fitted_log_mcap: number;
    category_effect: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm: {
    total_cost_usd: number;
    capital_usd: number;
    breakeven_usd: number;
    expected_usd: number;
    net_usd: number;
    verdict: 'farm' | 'thin' | 'skip';
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  fitted_base_usd: number;
  rank_low: number;
  rank_high: number;
  farm_cost_usd: number;
  farm_breakeven_usd: number;
  farm_net_usd: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparable multiple, for the dashboard's model panel. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  n: number;
  source: string;
}

/** One category's fitted effect: the shrunk mean residual of log(mcap) in that category. */
export interface CategoryEffect {
  category: string;
  effect: number;
  n: number;
}

/** The fitted model, as the dashboard's model panel states it. */
export interface FittedSummary {
  intercept: number;
  slope_log_tvl: number;
  category_effects: CategoryEffect[];
  formula: string;
  notes: string;
}

/** Out-of-sample validation of the fitted model against the radar-2 median baseline. */
export interface ValidationSummary {
  method: string;
  n_live: number;
  baseline: { loo_log_mae: number; walkforward_log_mae: number };
  fitted: { loo_log_mae: number; walkforward_log_mae: number };
  improvement_pct: { loo: number; walkforward: number; combined: number };
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  category_multiples: CategoryMultiple[];
  validation: ValidationSummary;
  fitted: FittedSummary;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The comparables: for every category, the median mcap/TVL of its live-token protocols, and the
 * global median across all of them. A category with fewer than `min_n` live names falls back to the
 * global median, so no multiple rests on one or two names. Kept as the radar-2 baseline and as a
 * reference the dashboard still shows.
 */
export function comparables(
  protocols: SnapshotProtocol[],
  model: ModelConstants,
): { byCategory: Map<string, { multiple: number; n: number; source: string }>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.gecko_id === null || p.symbol === null) continue;
    if (!p.tvl_usd || p.tvl_usd <= 0 || !p.mcap_usd || p.mcap_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratios.get(key) ?? [];
    list.push(ratio);
    ratios.set(key, list);
  }
  const global = Math.min(model.multiple_cap, Math.max(model.multiple_floor, median(all)));
  const byCategory = new Map<string, { multiple: number; n: number; source: string }>();
  for (const [category, list] of ratios) {
    if (list.length >= model.min_category_n) {
      byCategory.set(category, {
        multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, median(list))),
        n: list.length,
        source: `median of ${list.length} live ${category} protocols`,
      });
    }
  }
  return { byCategory, global };
}

/** The multiple one protocol's category carries, and where it came from. */
export function multipleFor(
  protocol: SnapshotProtocol,
  comps: { byCategory: Map<string, { multiple: number; n: number; source: string }>; global: number },
): { multiple: number; source: string } {
  const hit = comps.byCategory.get(protocol.category ?? 'Other');
  if (hit !== undefined) return { multiple: hit.multiple, source: hit.source };
  return { multiple: comps.global, source: 'global median (category has too few live names)' };
}

/** The live-token protocols: they already trade, so they are the set the model is fit and validated on. */
export function liveTokens(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter(
    (p) => p.mcap_usd !== null && p.gecko_id !== null && p.symbol !== null && p.tvl_usd > 0 && p.mcap_usd > 0,
  );
}

/** The fitted model: OLS intercept and slope of log(mcap) on log(TVL), plus shrunk category effects. */
export interface FittedModel {
  intercept: number;
  slopeLogTvl: number;
  effects: Map<string, { effect: number; n: number }>;
}

/**
 * Fit the radar-3 model on a set of live-token protocols: closed-form OLS of log(mcap) on
 * log(TVL), then one effect per category, the mean residual of that category's protocols shrunk
 * toward zero by n / (n + shrink_k). No protocol name is ever read here; only its TVL, market
 * cap and category.
 */
export function fitFitted(protocols: SnapshotProtocol[], model: ModelConstants): FittedModel {
  const live = liveTokens(protocols);
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of live) {
    const x = Math.log(p.tvl_usd);
    const y = Math.log(p.mcap_usd!);
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const slopeLogTvl = denom !== 0 ? (n * sxy - sx * sy) / denom : 1;
  const intercept = n > 0 ? (sy - slopeLogTvl * sx) / n : 0;
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of live) {
    const residual = Math.log(p.mcap_usd!) - (intercept + slopeLogTvl * Math.log(p.tvl_usd));
    const key = p.category ?? 'Other';
    const entry = sums.get(key) ?? { sum: 0, n: 0 };
    entry.sum += residual;
    entry.n += 1;
    sums.set(key, entry);
  }
  const effects = new Map<string, { effect: number; n: number }>();
  for (const [category, entry] of sums) {
    const raw = entry.sum / entry.n;
    effects.set(category, { effect: raw * (entry.n / (entry.n + model.shrink_k)), n: entry.n });
  }
  return { intercept, slopeLogTvl, effects };
}

/** The fitted model's predicted log market cap for one protocol. */
export function fittedLogMcap(protocol: SnapshotProtocol, fitted: FittedModel): number {
  const effect = fitted.effects.get(protocol.category ?? 'Other')?.effect ?? 0;
  return fitted.intercept + fitted.slopeLogTvl * Math.log(protocol.tvl_usd) + effect;
}

/** The category effect one protocol carries under the fitted model (0 when its category has no live names). */
export function categoryEffectFor(protocol: SnapshotProtocol, fitted: FittedModel): number {
  return fitted.effects.get(protocol.category ?? 'Other')?.effect ?? 0;
}

/** The four multipliers and the age one protocol gets under `model`. */
export function multipliers(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra) * model.chain_step;
  return { growthPct, growthMult, maturityMult, chainMult, age };
}

/** The log of the four post-multipliers combined: the step from a base to the full implied value. */
function logPostMultipliers(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const m = multipliers(protocol, asOf, model);
  return Math.log(m.growthMult * m.maturityMult * m.chainMult);
}

/** The four multipliers and the implied value one protocol gets under the radar-2 median model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  comps: { byCategory: Map<string, { multiple: number; n: number; source: string }>; global: number },
): {
  implied: number;
  multiple: number;
  multipleSource: string;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const m = multipliers(protocol, asOf, model);
  const { multiple, source } = multipleFor(protocol, comps);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.min(model.implied_cap, Math.round(base * m.growthMult * m.maturityMult * m.chainMult)));
  return { implied, multiple, multipleSource: source, growthPct: m.growthPct, growthMult: m.growthMult, maturityMult: m.maturityMult, chainMult: m.chainMult, age: m.age };
}

/** The fitted base and the implied value one protocol gets under the radar-3 fitted model. */
export function fittedImpliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fitted: FittedModel,
): {
  implied: number;
  fittedBase: number;
  fittedLogMcap: number;
  categoryEffect: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const m = multipliers(protocol, asOf, model);
  const logMcap = fittedLogMcap(protocol, fitted);
  const fittedBase = Math.exp(logMcap);
  const implied = Math.max(1, Math.min(model.implied_cap, Math.round(fittedBase * m.growthMult * m.maturityMult * m.chainMult)));
  return {
    implied,
    fittedBase,
    fittedLogMcap: logMcap,
    categoryEffect: categoryEffectFor(protocol, fitted),
    growthPct: m.growthPct,
    growthMult: m.growthMult,
    maturityMult: m.maturityMult,
    chainMult: m.chainMult,
    age: m.age,
  };
}

/** The mean absolute error of a list of log errors. */
function meanAbs(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Out-of-sample validation of the fitted model against the radar-2 median baseline, on the
 * live-token protocols only. Leave-one-out refits both models without each protocol in turn;
 * walk-forward sorts the listed live-token protocols by listing date and, on two expanding
 * folds, trains on the earlier listings and tests on the later ones. The error in both cases is
 * |log(predicted mcap) - log(actual mcap)|, the predicted mcap being the model's full implied
 * value (base x growth x maturity x chain post-multipliers, which are identical in both models).
 */
export function validateModels(snapshot: Snapshot, model: ModelConstants = MODEL): ValidationSummary {
  const live = liveTokens(snapshot.protocols);
  const asOf = snapshot.as_of;

  const looBaseline: number[] = [];
  const looFitted: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const train = live.filter((_, j) => j !== i);
    const p = live[i]!;
    const actual = Math.log(p.mcap_usd!);
    const post = logPostMultipliers(p, asOf, model);
    const comps = comparables(train, model);
    const { multiple } = multipleFor(p, comps);
    looBaseline.push(Math.abs(Math.log(p.tvl_usd * multiple) + post - actual));
    const fitted = fitFitted(train, model);
    looFitted.push(Math.abs(fittedLogMcap(p, fitted) + post - actual));
  }

  const listed = live
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const cuts = [Math.floor(listed.length / 3), Math.floor((2 * listed.length) / 3)];
  const foldNotes: string[] = [];
  const wfBaseline: number[] = [];
  const wfFitted: number[] = [];
  for (const cut of cuts) {
    const train = listed.slice(0, cut);
    const test = listed.slice(cut);
    foldNotes.push(`cutoff ${listed[cut]!.listed_at} (train ${train.length}, test ${test.length})`);
    const comps = comparables(train, model);
    const fitted = fitFitted(train, model);
    for (const p of test) {
      const actual = Math.log(p.mcap_usd!);
      const post = logPostMultipliers(p, asOf, model);
      const { multiple } = multipleFor(p, comps);
      wfBaseline.push(Math.abs(Math.log(p.tvl_usd * multiple) + post - actual));
      wfFitted.push(Math.abs(fittedLogMcap(p, fitted) + post - actual));
    }
  }

  const baselineLoo = meanAbs(looBaseline);
  const fittedLoo = meanAbs(looFitted);
  const baselineWf = meanAbs(wfBaseline);
  const fittedWf = meanAbs(wfFitted);
  const impLoo = ((baselineLoo - fittedLoo) / baselineLoo) * 100;
  const impWf = ((baselineWf - fittedWf) / baselineWf) * 100;
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  return {
    method:
      `Leave-one-out and walk-forward (expanding window, 2 folds: ${foldNotes.join('; ')}) MAE of ` +
      `|log(predicted mcap) - log(actual mcap)| on the ${live.length} live-token protocols ` +
      `(tvl>0, mcap>0); the predicted mcap is the model's full implied value (base x growth x ` +
      `maturity x chain post-multipliers, identical in both models). Walk-forward MAE is pooled ` +
      `over the ${wfBaseline.length} test predictions.`,
    n_live: live.length,
    baseline: { loo_log_mae: round4(baselineLoo), walkforward_log_mae: round4(baselineWf) },
    fitted: { loo_log_mae: round4(fittedLoo), walkforward_log_mae: round4(fittedWf) },
    improvement_pct: { loo: round2(impLoo), walkforward: round2(impWf), combined: round2((impLoo + impWf) / 2) },
  };
}

/** A deterministic PRNG (mulberry32): the bootstrap never reads Math.random or the clock. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The q-th percentile of a sorted list, nearest-rank, as a whole number. */
function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/**
 * Rank ranges: refit the fitted model `refits` times on bootstrap resamples of the live-token
 * set (seeded PRNG, so the ranges are identical on every run), re-score every chosen protocol
 * and re-rank. Each protocol's rank_low / rank_high is the 5th / 95th percentile of its rank
 * across the refits.
 */
export function bootstrapRankRanges(
  chosen: SnapshotProtocol[],
  live: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants,
): Map<string, { rankLow: number; rankHigh: number }> {
  const rng = mulberry32(model.bootstrap_seed);
  const ranksBySlug = new Map<string, number[]>();
  for (let b = 0; b < model.bootstrap_refits; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rng() * live.length)]!);
    const fitted = fitFitted(sample, model);
    const scored = chosen.map((p) => ({ slug: p.slug, implied: fittedImpliedValue(p, asOf, model, fitted).implied }));
    scored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    scored.forEach((s, i) => {
      const arr = ranksBySlug.get(s.slug) ?? [];
      arr.push(i + 1);
      ranksBySlug.set(s.slug, arr);
    });
  }
  const ranges = new Map<string, { rankLow: number; rankHigh: number }>();
  for (const [slug, ranks] of ranksBySlug) {
    const sorted = [...ranks].sort((a, b) => a - b);
    ranges.set(slug, { rankLow: percentile(sorted, 0.05), rankHigh: percentile(sorted, 0.95) });
  }
  return ranges;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The categories the watchlist rule keeps out: wrapped, staked or bridged products of a token that trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** An exchange's name at the start of a protocol's name: its staking or custody product, not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** A whole word that marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, and not a wrapped product of a token that trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = comparables(snapshot.protocols, model);
  const fitted = fitFitted(snapshot.protocols, model);
  const live = liveTokens(snapshot.protocols);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the largest by TVL. The floor
  // is where the house's reading started, not where the radar stops.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const chosenList = [...chosen.values()];
  const ranges = bootstrapRankRanges(chosenList, live, snapshot.as_of, model);
  const scored = chosenList.map((p) => {
    const v = fittedImpliedValue(p, snapshot.as_of, model, fitted);
    const { multiple, source } = multipleFor(p, comps);
    const farm = farmCost(p, v.age, v.implied);
    return { p, v, multiple, multipleSource: source, farm, range: ranges.get(p.slug) ?? { rankLow: 0, rankHigh: 0 } };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    fitted_base_usd: s.v.fittedBase,
    rank_low: s.range.rankLow,
    rank_high: s.range.rankHigh,
    farm_cost_usd: s.farm.total_cost_usd,
    farm_breakeven_usd: s.farm.breakeven_usd,
    farm_net_usd: s.farm.net_usd,
    farm_verdict: s.farm.verdict,
    model: {
      category_multiple: s.multiple,
      multiple_source: s.multipleSource,
      fitted_base_usd: s.v.fittedBase,
      fitted_log_mcap: round4(s.v.fittedLogMcap),
      category_effect: round4(s.v.categoryEffect),
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
      age_days: s.v.age,
    },
    farm: {
      total_cost_usd: s.farm.total_cost_usd,
      capital_usd: s.farm.capital_usd,
      breakeven_usd: s.farm.breakeven_usd,
      expected_usd: s.farm.expected_usd,
      net_usd: s.farm.net_usd,
      verdict: s.farm.verdict,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas price of one transaction on a protocol's first chain, in USD. */
export function gasPerTx(p: SnapshotProtocol): number {
  const first = p.chains.length > 0 ? p.chains[0]! : '';
  return GAS_USD_BY_CHAIN[first] ?? GAS_USD_DEFAULT;
}

export interface FarmCost {
  gas_per_tx_usd: number;
  tx_count: number;
  weekly_txs: number;
  hold_days: number;
  capital_usd: number;
  total_cost_usd: number;
  expected_usd: number;
  breakeven_usd: number;
  net_usd: number;
  verdict: 'farm' | 'thin' | 'skip';
}

/**
 * A protocol's costed farm plan: 1 setup + 1 deposit + weekly qualifying transactions (one a
 * week, capped at 8) + 1 claim, each at the first chain's gas price. The capital comes from the
 * TVL tiers; the expected value is the implied value times the position's share of TVL, the
 * break-even is the implied value the position would need for the gas to pay for itself, and the
 * verdict is 'farm' when the expected value covers the gas, 'thin' when the implied value is at
 * least half the break-even, and 'skip' otherwise.
 */
export function farmCost(p: SnapshotProtocol, age: number | null, implied: number): FarmCost {
  const gas = gasPerTx(p);
  const hold = holdDaysFor(age);
  const weekly = Math.min(Math.ceil(hold / 7), MAX_WEEKLY_TXS);
  const txCount = 1 + 1 + weekly + 1;
  const total = round2(gas * txCount);
  const capital = capitalFor(p);
  const share = p.tvl_usd > 0 ? capital / p.tvl_usd : 0;
  const expected = round2(implied * share);
  const breakeven = share > 0 ? round2(total / share) : 1_000_000_000_000;
  const net = round2(expected - total);
  const verdict: 'farm' | 'thin' | 'skip' = net > 0 ? 'farm' : implied >= 0.5 * breakeven ? 'thin' : 'skip';
  return {
    gas_per_tx_usd: gas,
    tx_count: txCount,
    weekly_txs: weekly,
    hold_days: hold,
    capital_usd: capital,
    total_cost_usd: total,
    expected_usd: expected,
    breakeven_usd: breakeven,
    net_usd: net,
    verdict,
  };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('yield') || c.includes('liquidity manager')) return `Deposit $${capital} into ${name}'s managed vault on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking pool') || c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stablecoin wrapper') || c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name}'s chain and use one of its native apps.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action, so the plan is not one deposit and silence. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Make one qualifying action each week: a supply top-up, a small borrow, or a repayment.';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'Swap a small amount each week and add a little liquidity, so the wallet shows repeat volume.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Open and close one small position each week, keeping the margin in the account.';
  if (c.includes('prediction')) return 'Place one small market position each week instead of one large one.';
  if (c.includes('bridge')) return 'Bridge a small amount each week instead of one large transfer.';
  if (c.includes('rwa') || c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('basis')) return 'Top up the position a little each week and claim any points the protocol shows.';
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * The costed figures (total gas, expected value, break-even, verdict) live on the board row and in
 * the dashboard, not in these steps, so the steps keep the gate's 20..600 character shape.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    fitted_base_usd: row.fitted_base_usd,
    rank_low: row.rank_low,
    rank_high: row.rank_high,
    farm_cost_usd: row.farm_cost_usd,
    farm_breakeven_usd: row.farm_breakeven_usd,
    farm_net_usd: row.farm_net_usd,
    farm_verdict: row.farm_verdict,
  };
}

/** The fitted model's summary for the dashboard's model panel. */
export function fittedSummary(fitted: FittedModel, validation: ValidationSummary, model: ModelConstants): FittedSummary {
  const intercept = round4(fitted.intercept);
  const slope = round4(fitted.slopeLogTvl);
  const categoryEffects: CategoryEffect[] = [...fitted.effects.entries()]
    .map(([category, v]) => ({ category, effect: round4(v.effect), n: v.n }))
    .sort((a, b) => b.effect - a.effect || (a.category < b.category ? -1 : 1));
  return {
    intercept,
    slope_log_tvl: slope,
    category_effects: categoryEffects,
    formula:
      `log(mcap_usd) = ${intercept} + ${slope} x log(tvl_usd) + effect[category]; ` +
      `fitted_base_usd = exp(log(mcap_usd)); implied_value_usd = fitted_base_usd x growth_multiplier x ` +
      `maturity_multiplier x chain_multiplier`,
    notes:
      `OLS on the ${validation.n_live} live-token protocols (tvl>0, mcap>0). Category effects are ` +
      `shrunk toward 0 by n/(n+${model.shrink_k}): a category with 1 live name keeps ` +
      `~${Math.round(100 / (1 + model.shrink_k))}% of its raw effect, one with ${model.shrink_k} keeps ` +
      `50%. Out-of-sample vs the radar-2 median baseline: leave-one-out log-MAE ` +
      `${validation.fitted.loo_log_mae} vs ${validation.baseline.loo_log_mae} ` +
      `(${validation.improvement_pct.loo}% better), walk-forward log-MAE ` +
      `${validation.fitted.walkforward_log_mae} vs ${validation.baseline.walkforward_log_mae} ` +
      `(${validation.improvement_pct.walkforward}% better), combined ` +
      `${validation.improvement_pct.combined}% better.`,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = comparables(snapshot.protocols, model);
  const fitted = fitFitted(snapshot.protocols, model);
  const validation = validateModels(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const categoryMultiples: CategoryMultiple[] = [...comps.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: round4(v.multiple), n: v.n, source: v.source }))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(comps.global),
    category_multiples: categoryMultiples,
    validation,
    fitted: fittedSummary(fitted, validation, model),
    watchlist: [...snapshot.watchlist].sort(),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

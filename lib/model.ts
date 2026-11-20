// Token Radar's value model: a sealed DefiLlama snapshot in, a ranked pre-token board out.
//
// A protocol is pre-token when the snapshot records no token for it at all: mcap_usd, gecko_id and
// symbol are all null. A protocol is rankable when it is pre-token, its category is not one of the
// wrapped/staked/bridged product categories (Bridge, Canonical Bridge, Liquid Staking, Liquid
// Restaking, Restaked BTC, CEX), its name carries no whole word wrapped, staked or staking, it does
// not begin with an exchange's name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex,
// Gemini), and its name does not end in a version marker (a space followed by V2, v2, 2.0 or the
// like). That is the house's own watchlist rule: a wrapped or staked product of a token that already
// trades is not a protocol still waiting on a launch of its own, so it must not be ranked as one. The
// parentProtocol part cannot be applied here: parentProtocol is not one of the snapshot's ten
// fields, so the category, name-word and exchange-name parts above are the parts the snapshot
// supports. Live-token protocols never appear on the board; they are listed apart, at their
// market's own value.
//
// Implied value is comps-calibrated from the snapshot itself. For each category, take the live-token
// protocols (mcap_usd > 0, tvl_usd > 0, not CEX) and find the median mcap/TVL. A median of one or
// two observations is not a median, so a category's own median is used only when it has at least 3
// live comps; with fewer, the category falls back to the overall median across all live comps. The
// overall median over all live comps is the fallback, and each category's ratio with n >= 3 is
// shrunk toward it with a prior of 5:
//
//   ratio(C)    = (n_C * median_C + 5 * median_all) / (n_C + 5)   when n_C >= 3
//   ratio(C)    = median_all                                      when n_C < 3 (fallback)
//   growth      = clamp(change_7d ?? 0, -60, 120)
//   growthMult  = 1 + (growth / 100) * 0.5
//   maturity    = 0.6 + min(age_days, 1095) / 1095 * 0.4      (age unknown: 365 days)
//   breadth     = 1 + 0.02 * min(max(chains - 1, 0), 5)
//   implied     = max(1, round(tvl_usd * ratio(C) * growthMult * maturity * breadth))
//
// No protocol name is ever special-cased and no per-protocol value is hardcoded: the same function
// scores every row, and the comps table it reads is computed from the snapshot at runtime.

/** One protocol entry of the sealed snapshot: exactly the ten fields the input carries. */
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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrinkage_prior: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrinkage_prior: 5,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-comps-1';

/** How many live-token protocols the Already launched view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Minimum live comps for a category to use its own median mcap/TVL; fewer fall back to the overall median. */
export const MIN_COMPS_FOR_OWN_MEDIAN = 3;

/** One category's comps: how many live protocols, their median mcap/TVL (null when the category
 *  falls back), the ratio actually used, and whether it fell back to the overall median. */
export interface CompRow {
  category: string;
  n: number;
  median: number | null;
  ratio: number;
  fallback: boolean;
}

/** The comps table: the overall median plus one row per category that has live comps. */
export interface CompsTable {
  median_all: number;
  rows: CompRow[];
}

/** The breakdown a board row carries, so the dashboard can show the arithmetic. */
export interface ModelBreakdown {
  comp_ratio: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number;
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
  listed_at: string | null;
  age_days: number;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the model and its comps. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  formula: string;
  comps: CompsTable;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  rows: BoardRow[];
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

/** Round to four decimals, for a multiplier the dashboard prints. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The median of a non-empty list of finite numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of another protocol's token, not a
 *  protocol still waiting on a launch of its own. (The house rule's parentProtocol part is not
 *  applicable: parentProtocol is not one of the snapshot's ten fields.) */
const WRAPPED_PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word `wrapped`, `staked` or `staking` in a name, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not a wrapped/staked/bridged product
 *  of a token that already trades (by category, by a whole word in its name, or by an exchange
 *  prefix), and not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !VERSIONED.test(p.name)
  );
}

/** Whether a protocol can serve as a live comp: a token that trades, with TVL, not an exchange. */
export function isLiveComp(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/**
 * The comps table, computed from the snapshot at runtime: the median mcap/TVL of the live-token
 * protocols in each category, shrunk toward the overall median with a prior of 5 when the category
 * has at least 3 live comps. A category with fewer than 3 live comps has no usable median of its
 * own, so it falls back to the overall median (median null, fallback true) instead of letting one
 * or two observations set its ratio. Categories with no live comps get no row and also fall back
 * to the overall median.
 */
export function buildComps(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): CompsTable {
  const comps = protocols.filter(isLiveComp);
  const all = comps.map((p) => p.mcap_usd! / p.tvl_usd);
  const medianAll = all.length > 0 ? median(all) : 1;
  const byCategory = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? '';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const rows: CompRow[] = [...byCategory.entries()]
    .map(([category, values]) => {
      const n = values.length;
      if (n < MIN_COMPS_FOR_OWN_MEDIAN) {
        return { category, n, median: null, ratio: round4(medianAll), fallback: true };
      }
      const med = median(values);
      const ratio = (n * med + model.shrinkage_prior * medianAll) / (n + model.shrinkage_prior);
      return { category, n, median: round4(med), ratio: round4(ratio), fallback: false };
    })
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { median_all: round4(medianAll), rows };
}

/** The comps ratio a category's protocols are scored with: its shrunk ratio, else the overall median. */
export function compRatioFor(category: string | null, comps: CompsTable): number {
  if (category === null) return comps.median_all;
  const row = comps.rows.find((r) => r.category === category);
  return row === undefined ? comps.median_all : row.ratio;
}

/** The multipliers and the implied value one protocol gets under the comps-calibrated model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: CompsTable,
  model: ModelConstants = MODEL,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const ratio = compRatioFor(protocol.category, comps);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * ratio * growthMult * maturityMult * breadthMult));
  return {
    implied,
    breakdown: {
      comp_ratio: ratio,
      growth_pct: growthPct,
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      breadth_multiplier: round4(breadthMult),
      age_days: ageForModel,
    },
  };
}

/** The formula, in words and symbols, for the dashboard and the data file. */
export const FORMULA =
  'implied = round(tvl_usd x ratio(category) x (1 + clamp(change_7d, -60, 120) / 100 x 0.5) x ' +
  '(0.6 + min(age_days, 1095) / 1095 x 0.4) x (1 + 0.02 x min(max(chains - 1, 0), 5))). ' +
  'ratio(category) is the median mcap/TVL of the live-token protocols in that category, shrunk toward ' +
  'the overall median with a prior of 5, and only when the category has at least 3 live comps; with ' +
  'fewer than 3, the category uses the overall median instead, because a median of 1 or 2 is not a ' +
  'median. Categories with no live comps use the overall median too.';

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = buildComps(snapshot.protocols, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, when the snapshot carries it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && isRankable(p)) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL. Never a replacement for a
  // watchlist row: a chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, comps, model);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: ageDays(snapshot.as_of, s.p.listed_at) ?? model.unknown_age_days,
    token_status: 'pre-token' as const,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, ageDays(snapshot.as_of, s.p.listed_at)),
  }));
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

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One farm step as a single string: its action, then its cost and time, within 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * only from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names: the wallet, the position, the weekly action, the hold, the claim, the exit and the log.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    stepText(
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper, never in a screenshot or a cloud note.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    stepText(action, `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, '15 minutes to set up'),
    stepText(
      'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet shows steady use rather than one burst.',
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not move the funds between wallets in that time.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes there; never pay anyone to claim for you.`,
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      `Keep this position to at most $${capital} of exposure and plan the exit now: unwind in two tranches, the first after the claim window opens and the rest once the token, if any, is liquid.`,
      `no extra cost beyond the $${capital} already in`,
      '10 minutes to plan, then the exit itself',
    ),
    stepText(
      'Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position, prove the activity, or unwind it later.',
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Already launched view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = buildComps(snapshot.protocols, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    formula: FORMULA,
    comps,
    watchlist: [...snapshot.watchlist].sort(),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    rows: board,
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
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
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
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.token_status !== 'pre-token') return `${r.slug} is not pre-token`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

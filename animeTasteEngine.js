/**
 * NextArcEngine — Multi-dimensional anime taste & recommendation engine
 *
 * Architecture:
 *  ┌─ Categorical vectors  genres, tags, studios (cosine similarity)
 *  ├─ Scalar dimensions    8 axes mapped from AniList tag/genre data
 *  ├─ Boundary tester      probes one dimension at a time, just past tolerance
 *  ├─ Anti-repetition      penalises too-similar runs of cards
 *  └─ Rec mixer            70% strong match · 20% boundary test · 10% wildcard
 *
 * Public API (used by index.html):
 *   engine.update(anime, action)          action: 'like' | 'skip' | 'watch'
 *   engine.finishOnboarding()
 *   engine.trackShown(anime)              call before each card is shown
 *   engine.rankRecommendations(candidates, seenIds)  → ranked anime[]
 *   engine.topTraits(n)                   diagnostics
 *   engine.dimProfiles()                  diagnostics
 */

'use strict';

/* ════════════════════════════════════════════════════════════════════════
   SCALAR DIMENSION EXTRACTION
   Maps AniList tags (name + rank 0–100) and genres → 0–10 intensity scores.

   Each dimension has:
     tagWeights  { tagName: weight }  rank × weight = contribution
     genreBoosts { genre: flatAmount } added when that genre is present
   ════════════════════════════════════════════════════════════════════════ */

const DIM_TAG_WEIGHTS = {

  fanService: {
    'Ecchi':           0.09,
    'Fan Service':     0.08,
    'Nudity':          0.10,
    'Sexual Content':  0.10,
    'Pantsu':          0.07,
    'Harem':           0.05,
    'Reverse Harem':   0.04,
    'Fanservice':      0.08,
  },

  violence: {
    'Violence':          0.09,
    'Gore':              0.10,
    'Graphic Violence':  0.10,
    'Torture':           0.09,
    'War':               0.05,
    'Assassination':     0.05,
    'Survival':          0.04,
    'Blood':             0.06,
  },

  darkness: {
    'Dark Fantasy':   0.08,
    'Tragedy':        0.09,
    'Psychological':  0.08,
    'Despair':        0.09,
    'Death':          0.07,
    'Horror':         0.08,
    'Dystopia':       0.07,
    'Anti-Hero':      0.05,
    'Nihilism':       0.09,
    'Corruption':     0.07,
  },

  romance: {
    'Romance':                   0.09,
    'Love Triangle':             0.09,
    'Unrequited Love':           0.09,
    'First Love':                0.08,
    'Childhood Friend Romance':  0.08,
    'Arranged Marriage':         0.08,
    'Forbidden Love':            0.08,
    'Breakup':                   0.07,
    'Shoujo Romance':            0.08,
  },

  humor: {
    'Parody':          0.09,
    'Slapstick':       0.09,
    'Black Comedy':    0.08,
    'Satire':          0.08,
    'Gag Humor':       0.09,
    'Comedic Relief':  0.07,
    'Tsukkomi':        0.07,
    'Absurdist':       0.08,
  },

  emotionalIntensity: {
    'Tearjerker':        0.10,
    'Tragedy':           0.09,
    'Coming of Age':     0.07,
    'Heartwarming':      0.08,
    'Family Dynamics':   0.07,
    'Grief':             0.09,
    'Self-Discovery':    0.07,
    'Redemption':        0.07,
  },

  // slowPacing is an intermediate — combined with episode count to get final pacing score
  slowPacing: {
    'Slow Pacing':  0.10,
    'Iyashikei':    0.09,
    'Daily Life':   0.06,
    'Slice of Life':0.07,
    'Healing':      0.07,
  },
};

const DIM_GENRE_BOOSTS = {
  fanService:         { 'Ecchi': 5 },
  violence:           { 'Action': 1.5 },
  darkness:           { 'Horror': 5, 'Psychological': 4 },
  romance:            { 'Romance': 5 },
  humor:              { 'Comedy': 5 },
  emotionalIntensity: { 'Drama': 2.5 },
  slowPacing:         { 'Slice of Life': 3 },
};

/**
 * Extract 0–10 scalar intensity scores from an AniList anime object.
 * Returns: { fanService, violence, darkness, romance, humor, emotionalIntensity, pacing, niche }
 */
function extractScalars(anime) {
  const genres = anime.genres || [];
  const tags   = anime.tags   || [];

  // Build a fast lookup: tagName → rank (0–100)
  const tagMap = {};
  for (const t of tags) tagMap[t.name] = t.rank || 0;

  function calcDim(dimName) {
    let score = 0;
    const weights = DIM_TAG_WEIGHTS[dimName] || {};
    for (const [name, w] of Object.entries(weights)) {
      if (tagMap[name]) score += tagMap[name] * w;
    }
    const boosts = DIM_GENRE_BOOSTS[dimName] || {};
    for (const [genre, flat] of Object.entries(boosts)) {
      if (genres.includes(genre)) score += flat;
    }
    return Math.min(score, 10);
  }

  // Pacing: slow-pacing signals + episode count + fast-pacing counter-signals
  let pacing = calcDim('slowPacing');
  const eps = anime.episodes || 12;
  if (eps >= 50)  pacing = Math.min(pacing + 2.0, 10);
  else if (eps >= 24) pacing = Math.min(pacing + 0.8, 10);
  else if (eps <= 1)  pacing = Math.max(pacing - 1.5, 0);
  if (tagMap['Fast-Paced']) pacing = Math.max(pacing - tagMap['Fast-Paced'] * 0.07, 0);
  if (tagMap['Thriller'])   pacing = Math.max(pacing - tagMap['Thriller']   * 0.04, 0);

  // Niche: inverse log-popularity (0 = very mainstream, 10 = very obscure)
  const pop  = Math.max(anime.popularity || 1, 1);
  const niche = Math.max(0, 10 - (Math.log10(pop) / Math.log10(500000)) * 10);

  return {
    fanService:         calcDim('fanService'),
    violence:           calcDim('violence'),
    darkness:           calcDim('darkness'),
    romance:            calcDim('romance'),
    humor:              calcDim('humor'),
    emotionalIntensity: calcDim('emotionalIntensity'),
    pacing:             Math.min(pacing, 10),
    niche:              Math.min(niche, 10),
  };
}

/**
 * Extract categorical keys (genre, tag, studio strings) used for cosine similarity.
 * Only keeps tags with rank ≥ 55 so low-confidence tags don't pollute the vector.
 */
function extractCategorical(anime) {
  const genreKeys  = (anime.genres || []).map(g => `genre:${g}`);
  const tagKeys    = (anime.tags   || [])
                       .filter(t => (t.rank || 0) >= 55)
                       .slice(0, 14)
                       .map(t => `tag:${t.name}`);
  const studioKeys = (anime.studios?.nodes || [])
                       .slice(0, 2)
                       .map(s => `studio:${s.name}`);
  return [...genreKeys, ...tagKeys, ...studioKeys];
}


/* ════════════════════════════════════════════════════════════════════════
   NEXTARCENGINE
   ════════════════════════════════════════════════════════════════════════ */

class NextArcEngine {

  constructor() {

    /* ── Categorical preference vector ──────────────────────────────────
       genre:X, tag:X, studio:X keys → float score
       Positive = liked, negative = disliked. L2-normalised after onboarding. */
    this.catVector = {};

    /* ── Scalar dimension profiles ──────────────────────────────────────
       preferred   : the level the user seems happiest at (running weighted avg)
       tolerance   : highest level they've accepted without skipping
       confidence  : 0–1, how much data we have for this dimension
       All start at sensible neutral defaults. */
    this.dims = {
      fanService:         { preferred: 1.0, tolerance: 2.0,  confidence: 0 },
      violence:           { preferred: 2.0, tolerance: 3.0,  confidence: 0 },
      darkness:           { preferred: 3.0, tolerance: 4.0,  confidence: 0 },
      romance:            { preferred: 3.0, tolerance: 4.0,  confidence: 0 },
      humor:              { preferred: 5.0, tolerance: 6.0,  confidence: 0 },
      emotionalIntensity: { preferred: 5.0, tolerance: 6.0,  confidence: 0 },
      pacing:             { preferred: 5.0, tolerance: 6.5,  confidence: 0 },
      niche:              { preferred: 3.0, tolerance: 5.0,  confidence: 0 },
    };

    /* ── Boundary test state ────────────────────────────────────────────
       pendingTests   : Map<animeId, { dimension, testLevel }>
                        Set when we serve a boundary test; resolved in update().
       dimTestCounts  : how many times we've tested each dimension
                        (used to rotate evenly through all dims). */
    this.pendingTests  = new Map();
    this.dimTestCounts = Object.fromEntries(
      Object.keys(this.dims).map(d => [d, 0])
    );

    /* ── Anti-repetition ────────────────────────────────────────────────
       Keeps a rolling window of the last N scalar profiles served.
       Penalises candidates that look too similar to recent cards. */
    this.recentScalars = [];
    this.MAX_RECENT    = 8;

    /* ── General state ──────────────────────────────────────────────────*/
    this.onboarded   = false;
    this.totalSwipes = 0;
  }


  /* ══════════════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Record a swipe and update the taste profile.
   *
   * action:
   *   'like'   — onboarding right-swipe  (positive, moderate weight)
   *   'skip'   — any left-swipe          (weak negative)
   *   'watch'  — discovery right-swipe   (strong positive — user wants to watch it)
   */
  update(anime, action) {
    const isPositive = action === 'like' || action === 'watch';
    const isWatch    = action === 'watch';
    const catKeys    = extractCategorical(anime);
    const scalars    = extractScalars(anime);
    const id         = anime.id;

    /* Categorical vector update */
    const catDelta = isWatch   ? 3.5
                   : isPositive ? (this.onboarded ? 2.0 : 3.0)
                   : (this.onboarded ? -0.5 : -2.0); // skips punished less post-onboarding

    for (const key of catKeys) {
      this.catVector[key] = (this.catVector[key] || 0) + catDelta;
    }

    /* Scalar dimension update */
    if (isPositive) {
      this._absorbPositive(scalars, isWatch);
    } else {
      this._absorbNegative(scalars);
    }

    /* Boundary test feedback */
    if (this.pendingTests.has(id)) {
      const { dimension, testLevel } = this.pendingTests.get(id);
      this._processBoundaryResult(dimension, testLevel, isPositive);
      this.pendingTests.delete(id);
    }

    this.totalSwipes++;
  }

  /**
   * Call after the 15-card taste check completes.
   * Normalises the categorical vector and switches to post-onboarding weighting.
   */
  finishOnboarding() {
    this._normalise();
    this.onboarded = true;
  }

  /**
   * Call BEFORE showing each card so the anti-repetition tracker stays current.
   */
  trackShown(anime) {
    const scalars = extractScalars(anime);
    this.recentScalars.unshift(scalars);
    if (this.recentScalars.length > this.MAX_RECENT) {
      this.recentScalars.pop();
    }
  }

  /**
   * Build a mixed recommendation queue from a pool of AniList anime objects.
   *
   * Returns an anime[] where each item has an added `_meta` property:
   *   { type: 'strong' | 'boundary' | 'wildcard',
   *     dimension?: string,    // boundary tests only
   *     testLevel?: number }   // boundary tests only
   *
   * Mix: 70% strong match · 20% boundary test · 10% wildcard
   *
   * @param {object[]} candidates  AniList media objects
   * @param {Set|number[]} seenIds IDs to exclude
   * @returns {object[]}
   */
  rankRecommendations(candidates, seenIds = []) {
    const excluded = seenIds instanceof Set ? seenIds : new Set(seenIds);
    const pool = candidates.filter(a => !excluded.has(a.id));
    if (pool.length === 0) return [];

    /* Pre-compute profiles for the whole pool once */
    const profiles = pool.map(anime => ({
      anime,
      scalars:  extractScalars(anime),
      catKeys:  extractCategorical(anime),
    }));

    /* ── Score for strong match ─────────────────────────────────────── */
    const strongScored = profiles
      .map(p => ({ ...p, strongScore: this._scoreStrong(p) }))
      .sort((a, b) => b.strongScore - a.strongScore);

    /* ── Find boundary test candidates ─────────────────────────────── */
    const boundaryDim        = this.onboarded ? this._pickBoundaryDim() : null;
    const boundaryCandidates = boundaryDim
      ? this._findBoundaryCandidates(profiles, boundaryDim)
      : [];

    /* ── Find wildcards ─────────────────────────────────────────────── */
    const wildcardCandidates = this._findWildcards(strongScored);

    /* ── Build the mixed queue ──────────────────────────────────────── */
    const total     = Math.min(pool.length, 30);
    const nStrong   = Math.max(1, Math.round(total * 0.70));
    const nBoundary = Math.max(1, Math.round(total * 0.20));
    const nWild     = Math.max(1, Math.round(total * 0.10));

    const usedIds = new Set();
    const strong  = [];
    const boundary = [];
    const wild    = [];

    /* Strong matches (with anti-repetition) */
    for (const p of this._applyAntiRep(strongScored, nStrong * 2)) {
      if (strong.length >= nStrong) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        strong.push({ ...p.anime, _meta: { type: 'strong' } });
      }
    }

    /* Boundary tests */
    for (const p of boundaryCandidates) {
      if (boundary.length >= nBoundary) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        const testLevel = p.scalars[boundaryDim];
        this.pendingTests.set(p.anime.id, { dimension: boundaryDim, testLevel });
        boundary.push({
          ...p.anime,
          _meta: { type: 'boundary', dimension: boundaryDim, testLevel },
        });
      }
    }

    /* Wildcards */
    for (const p of wildcardCandidates) {
      if (wild.length >= nWild) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        wild.push({ ...p.anime, _meta: { type: 'wildcard' } });
      }
    }

    return this._interleave(strong, boundary, wild);
  }


  /* ══════════════════════════════════════════════════════════════════════
     SCORING
     ══════════════════════════════════════════════════════════════════════ */

  /** Overall strong-match score for one candidate. Returns 0–1. */
  _scoreStrong({ scalars, catKeys }) {
    const catSim    = this._cosineSim(catKeys);           // 0–1
    const scalarFit = this._scalarCompatibility(scalars); // 0–1
    const antiRep   = this._antiRepPenalty(scalars);      // 0–1
    return catSim * 0.55 + scalarFit * 0.40 - antiRep * 0.05;
  }

  /**
   * Average scalar compatibility across all dimensions.
   * Weighted by confidence so unobserved dims don't dominate.
   */
  _scalarCompatibility(scalars) {
    let total = 0, weight = 0;
    for (const [dim, profile] of Object.entries(this.dims)) {
      const level = scalars[dim] ?? 5;
      const score = this._dimScore(dim, level);
      const w     = 0.4 + profile.confidence * 0.6;
      total  += score * w;
      weight += w;
    }
    return weight > 0 ? total / weight : 0.5;
  }

  /**
   * Score a single dimension level against the user's profile.
   * Returns 0–1: 1 = within preferred zone, 0 = well past tolerance.
   *
   * Zones:
   *   |level - preferred| ≤ 1.0   → 1.0  (sweet spot)
   *   1.0 < dist, level ≤ tolerance → linear decay from 1 → 0.35
   *   level > tolerance              → steep penalty
   */
  _dimScore(dim, level) {
    const { preferred, tolerance } = this.dims[dim];
    const dist = Math.abs(level - preferred);

    if (dist <= 1.0) return 1.0;

    if (level <= tolerance) {
      // Between preferred+1 and tolerance: graceful falloff
      return Math.max(0.35, 1.0 - (dist - 1.0) / Math.max(1, tolerance - preferred) * 0.65);
    }

    // Above tolerance: steep penalty
    const excess = level - tolerance;
    return Math.max(0, 0.3 - excess * 0.12);
  }

  /**
   * Cosine similarity between the user's categorical vector and an anime's keys.
   * Anime vector is treated as binary (key present = 1).
   */
  _cosineSim(animeKeys) {
    if (animeKeys.length === 0) return 0;

    let dot = 0, magA = 0, magB = animeKeys.length; // magB = sqrt(sum of 1²)

    for (const k of Object.keys(this.catVector)) {
      dot  += this.catVector[k] * (animeKeys.includes(k) ? 1 : 0);
      magA += this.catVector[k] ** 2;
    }

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }


  /* ══════════════════════════════════════════════════════════════════════
     BOUNDARY TESTING
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Pick which scalar dimension to probe next.
   *
   * Rules:
   *   1. Must have confidence > 0.2 (need real data to test meaningfully)
   *   2. Rotate by least-tested first
   *   3. Break ties by highest confidence (we know most about these)
   */
  _pickBoundaryDim() {
    const eligible = Object.keys(this.dims).filter(
      d => this.dims[d].confidence > 0.20
    );
    if (eligible.length === 0) return null;

    eligible.sort((a, b) => {
      const ta = this.dimTestCounts[a];
      const tb = this.dimTestCounts[b];
      if (ta !== tb) return ta - tb;
      return this.dims[b].confidence - this.dims[a].confidence;
    });

    return eligible[0];
  }

  /**
   * Find candidates that are good probes for `dim`.
   *
   * Requirements:
   *   • dim level is in  [ tolerance + 0.5 ,  tolerance + 2.5 ]
   *     — just past the user's comfort zone, not a huge leap
   *   • All OTHER dimensions score well (we're only changing one thing)
   *   • Good categorical similarity (same genre space)
   */
  _findBoundaryCandidates(profiles, dim) {
    const { tolerance } = this.dims[dim];
    const lo = tolerance + 0.5;
    const hi = tolerance + 2.5;

    return profiles
      .filter(p => {
        const lvl = p.scalars[dim];
        return lvl >= lo && lvl <= hi;
      })
      .map(p => {
        const otherFit = this._scoreOtherDims(p.scalars, dim);
        const catSim   = this._cosineSim(p.catKeys);
        return { ...p, boundaryScore: catSim * 0.5 + otherFit * 0.5 };
      })
      .sort((a, b) => b.boundaryScore - a.boundaryScore);
  }

  /**
   * Scalar compatibility ignoring one dimension — used for boundary tests
   * so we can find anime that are similar in every way EXCEPT the tested dim.
   */
  _scoreOtherDims(scalars, excludeDim) {
    let total = 0, weight = 0;
    for (const [dim, profile] of Object.entries(this.dims)) {
      if (dim === excludeDim) continue;
      const level = scalars[dim] ?? 5;
      const w     = 0.4 + profile.confidence * 0.6;
      total  += this._dimScore(dim, level) * w;
      weight += w;
    }
    return weight > 0 ? total / weight : 0.5;
  }

  /**
   * Process the result of a boundary test.
   *
   *   Liked  → tolerance expands to testLevel + 0.5, preferred nudges up slightly
   *   Skipped → tolerance contracts by 0.5 (floor = current preferred)
   */
  _processBoundaryResult(dimension, testLevel, liked) {
    const p = this.dims[dimension];
    this.dimTestCounts[dimension]++;

    if (liked) {
      p.tolerance  = Math.min(10, testLevel + 0.5);
      p.preferred  = p.preferred * 0.88 + testLevel * 0.12;
    } else {
      p.tolerance  = Math.max(p.preferred, p.tolerance - 0.5);
    }

    p.confidence = Math.min(1, p.confidence + 0.12);
  }


  /* ══════════════════════════════════════════════════════════════════════
     WILDCARDS
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Wildcards come from the bottom third of strong scores — they matched
   * something but are outside the user's normal comfortable zone.
   * Shuffled so wildcards feel unpredictable.
   */
  _findWildcards(strongScored) {
    const cutoff = Math.floor(strongScored.length * 0.70);
    return strongScored
      .slice(cutoff)
      .sort(() => Math.random() - 0.5);
  }


  /* ══════════════════════════════════════════════════════════════════════
     ANTI-REPETITION
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * How similar is this anime to recently-shown cards?
   * Returns 0 (very different) → 1 (almost identical profile).
   */
  _antiRepPenalty(scalars) {
    if (this.recentScalars.length === 0) return 0;
    const dimKeys = Object.keys(this.dims);
    const sims = this.recentScalars.map(recent => {
      const diff = dimKeys.reduce(
        (sum, d) => sum + Math.abs((scalars[d] || 0) - (recent[d] || 0)),
        0
      );
      return 1 - diff / (dimKeys.length * 10); // normalise to 0–1
    });
    return Math.max(...sims);
  }

  /**
   * From a scored pool pick up to `n` candidates, preferring diversity.
   * Top scorer always included; subsequent picks penalised if too similar
   * to the growing result set.
   */
  _applyAntiRep(scoredPool, n) {
    const result    = [];
    const usedScalars = [];

    for (const p of scoredPool) {
      if (result.length >= n) break;

      if (usedScalars.length > 0) {
        const dimKeys = Object.keys(this.dims);
        const maxSim = Math.max(...usedScalars.map(s => {
          const diff = dimKeys.reduce(
            (sum, d) => sum + Math.abs((p.scalars[d] || 0) - (s[d] || 0)),
            0
          );
          return 1 - diff / (dimKeys.length * 10);
        }));
        if (maxSim > 0.88 && result.length >= Math.ceil(n * 0.5)) continue;
      }

      result.push(p);
      usedScalars.push(p.scalars);
    }

    return result;
  }


  /* ══════════════════════════════════════════════════════════════════════
     QUEUE INTERLEAVING
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Distribute boundary tests and wildcards through the queue rather than
   * clumping them at the end.
   *
   * Pattern: …strong…strong…strong…strong…BOUNDARY…strong…strong…WILDCARD…
   */
  _interleave(strong, boundary, wild) {
    const result = [];
    let bI = 0, wI = 0;

    for (let i = 0; i < strong.length; i++) {
      result.push(strong[i]);

      // Boundary test every ~5 strong matches
      if ((i + 1) % 5 === 0 && bI < boundary.length) {
        result.push(boundary[bI++]);
      }
      // Wildcard every ~10 strong matches
      if ((i + 1) % 10 === 0 && wI < wild.length) {
        result.push(wild[wI++]);
      }
    }

    // Append any remainder
    while (bI < boundary.length) result.push(boundary[bI++]);
    while (wI < wild.length)     result.push(wild[wI++]);

    return result;
  }


  /* ══════════════════════════════════════════════════════════════════════
     SCALAR PROFILE UPDATES
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Absorb a positive signal (like or watch).
   * Watch uses a stronger learning rate than a taste-check like.
   */
  _absorbPositive(scalars, isWatch) {
    const lr = isWatch                       ? 0.22
             : this.onboarded               ? 0.15
             :                                0.28; // onboarding: learn fast

    for (const [dim, profile] of Object.entries(this.dims)) {
      const level = scalars[dim] ?? 5;

      // Shift preferred toward this anime's level
      profile.preferred = profile.preferred * (1 - lr) + level * lr;

      // Expand tolerance if this anime was above it
      if (level > profile.tolerance) {
        profile.tolerance = profile.tolerance * 0.65 + level * 0.35;
      }

      // Confidence grows with data
      profile.confidence = Math.min(1, profile.confidence + 0.07);
    }
  }

  /**
   * Absorb a negative signal (skip).
   * Skips are treated as a weak signal — the user may have skipped for any reason.
   *
   * Only adjusts preferred if the anime was meaningfully above it (probably
   * the reason they skipped), so we don't over-penalise.
   */
  _absorbNegative(scalars) {
    const lr = this.onboarded ? 0.05 : 0.10;

    for (const [dim, profile] of Object.entries(this.dims)) {
      const level = scalars[dim] ?? 5;

      // Only nudge preferred down if this anime was significantly above it
      if (level > profile.preferred + 2.5) {
        profile.preferred = profile.preferred * (1 - lr) + (level - 1.5) * lr;
      }

      // Tiny confidence bump (we have more data, even if negative)
      profile.confidence = Math.min(1, profile.confidence + 0.03);
    }
  }


  /* ══════════════════════════════════════════════════════════════════════
     NORMALISATION
     ══════════════════════════════════════════════════════════════════════ */

  _normalise() {
    const mag = Math.sqrt(
      Object.values(this.catVector).reduce((s, v) => s + v * v, 0)
    );
    if (mag > 0) {
      for (const k of Object.keys(this.catVector)) this.catVector[k] /= mag;
    }
  }


  /* ══════════════════════════════════════════════════════════════════════
     DIAGNOSTICS
     ══════════════════════════════════════════════════════════════════════ */

  /** Top N positive genre/tag/studio preferences. */
  topTraits(n = 10) {
    return Object.entries(this.catVector)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([k, v]) => ({ key: k, score: +v.toFixed(3) }));
  }

  /** Current scalar dimension profiles (preferred, tolerance, confidence). */
  dimProfiles() {
    return Object.entries(this.dims).map(([dim, p]) => ({
      dimension:  dim,
      preferred:  +p.preferred.toFixed(2),
      tolerance:  +p.tolerance.toFixed(2),
      confidence: +p.confidence.toFixed(2),
    }));
  }
}


/* ────────────────────────────────────────────────────────────────────────
   CommonJS export (no-op in browser, used if someone imports the module)
   ──────────────────────────────────────────────────────────────────────── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NextArcEngine, extractScalars, extractCategorical };
}

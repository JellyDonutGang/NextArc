/**
 * NextArcEngine v3 — Multi-cluster anime taste modelling
 *
 * Core insight: users don't have a single unified taste. They have
 * multiple distinct taste clusters — dark psychological on Monday,
 * cozy healing on Thursday, hype action on Saturday. Averaging them
 * into one profile destroys the signal. We maintain separate clusters
 * and route recommendations to match the user's real viewing modes.
 *
 * Architecture:
 *  ┌─ Semantic vectors     6 groups per cluster: tone · archetype · visual · tag · genre · studio
 *  │   (plus a global profile used for onboarding and boundary testing)
 *  ├─ Scalar dimensions    13 axes per cluster: 7 tolerance + 6 appetite dims
 *  ├─ Cluster registry     up to 7 taste clusters, auto-detected from swipe patterns
 *  │   Each cluster has its own profile — no cross-cluster averaging
 *  ├─ Boundary tester      probes one dim per cluster, isolates one variable at a time
 *  ├─ Anti-repetition      tone + archetype + scalar diversity, cross-cluster rotation
 *  └─ Rec mixer            per-cluster strong(70%) · boundary(20%) · wildcard(10%)
 *                          Slots allocated proportionally across active clusters
 *
 * Scoring priority (spec order):
 *   tone(26%) · tag(20%) · archetype(14%) · visual(9%) · scalar(16%) ·
 *   studio(7%) · genre(5%) · diversity bonus(3%)
 *   Genre is intentionally the WEAKEST signal.
 *
 * Public API (unchanged from v2):
 *   engine.update(anime, action)
 *   engine.finishOnboarding()
 *   engine.trackShown(anime)
 *   engine.rankRecommendations(candidates, seenIds)  → anime[]
 *   engine.topTraits(n)
 *   engine.dimProfiles()
 *   engine.clusterSummaries()   ← new diagnostic
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   SCALAR DIMENSION TAG WEIGHTS
   score = Σ(tagRank × weight) + genreBoost, clamped [0, 10]
═══════════════════════════════════════════════════════════════════════════ */

const DIM_TAG_WEIGHTS = {

  fanService: {
    'Ecchi':                         0.09,
    'Fan Service':                   0.08,
    'Nudity':                        0.10,
    'Sexual Content':                0.10,
    'Pantsu':                        0.07,
    'Harem':                         0.05,
    'Reverse Harem':                 0.04,
  },

  violence: {
    'Violence':                      0.09,
    'Gore':                          0.10,
    'Graphic Violence':              0.10,
    'Torture':                       0.09,
    'Blood':                         0.06,
    'War':                           0.05,
    'Survival':                      0.04,
    'Assassination':                 0.05,
  },

  darkness: {
    'Dark Fantasy':                  0.08,
    'Tragedy':                       0.09,
    'Despair':                       0.09,
    'Death':                         0.07,
    'Horror':                        0.08,
    'Dystopia':                      0.07,
    'Nihilism':                      0.09,
    'Corruption':                    0.07,
    'Psychological Abuse':           0.07,
    'Depression':                    0.07,
  },

  romance: {
    'Romance':                       0.09,
    'Love Triangle':                 0.09,
    'Unrequited Love':               0.09,
    'First Love':                    0.08,
    'Childhood Friend Romance':      0.08,
    'Forbidden Love':                0.08,
    'Breakup':                       0.07,
    'Arranged Marriage':             0.08,
  },

  humor: {
    'Parody':                        0.09,
    'Slapstick':                     0.09,
    'Black Comedy':                  0.08,
    'Satire':                        0.08,
    'Gag Humor':                     0.09,
    'Comedic Relief':                0.07,
    'Absurdist':                     0.08,
    'Tsukkomi':                      0.06,
  },

  _slowPacing: {
    'Slow Pacing':                   0.10,
    'Iyashikei':                     0.09,
    'Daily Life':                    0.06,
    'Healing':                       0.07,
    'CGDCT':                         0.04,
  },

  niche: {},

  emotionalWeight: {
    'Tearjerker':                    0.10,
    'Tragedy':                       0.09,
    'Coming of Age':                 0.07,
    'Heartwarming':                  0.08,
    'Family Dynamics':               0.07,
    'Grief':                         0.09,
    'Self-Discovery':                0.07,
    'Redemption':                    0.07,
    'Bittersweet':                   0.08,
  },

  hype: {
    'Super Power':                   0.08,
    'Martial Arts':                  0.07,
    'Tournament':                    0.09,
    'Power Fantasy':                 0.08,
    'Adrenaline Rush':               0.09,
    'Overpowered Main Characters':   0.07,
    'Mecha':                         0.05,
    'Battle':                        0.06,
  },

  psychologicalDepth: {
    'Psychological':                 0.10,
    'Mind Games':                    0.10,
    'Philosophy':                    0.08,
    'Unreliable Narrator':           0.09,
    'Memory Manipulation':           0.08,
    'Multiple Personalities':        0.07,
    'Reality vs Fantasy':            0.08,
    'Existentialism':                0.08,
  },

  worldbuilding: {
    'World Building':                0.10,
    'Magic System':                  0.08,
    'Mythology':                     0.07,
    'Political Intrigue':            0.09,
    'Military':                      0.05,
    'Alternate Universe':            0.06,
    'Lore':                          0.07,
  },

  characterDrama: {
    'Character Study':               0.10,
    'Found Family':                  0.09,
    'Rivalry':                       0.09,
    'Betrayal':                      0.10,
    'Family Dynamics':               0.08,
    'Ensemble Cast':                 0.07,
    'Redemption':                    0.07,
    'Bromance':                      0.06,
  },

  moralComplexity: {
    'Moral Dilemmas':                0.10,
    'Anti-Hero':                     0.09,
    'Villain Protagonist':           0.10,
    'Nihilism':                      0.09,
    'Corruption':                    0.08,
    'Gray Morality':                 0.10,
    'Revenge':                       0.06,
    'Ethics':                        0.07,
  },
};

const DIM_GENRE_BOOSTS = {
  fanService:         { 'Ecchi': 5 },
  violence:           { 'Action': 1.5 },
  darkness:           { 'Horror': 5, 'Psychological': 3 },
  romance:            { 'Romance': 5 },
  humor:              { 'Comedy': 5 },
  _slowPacing:        { 'Slice of Life': 3 },
  emotionalWeight:    { 'Drama': 2.5 },
  hype:               { 'Action': 2.5, 'Sports': 2.0 },
  psychologicalDepth: { 'Psychological': 5 },
  worldbuilding:      { 'Fantasy': 1.5, 'Sci-Fi': 2.0, 'Adventure': 1.0 },
  characterDrama:     { 'Drama': 2.0, 'Slice of Life': 1.5 },
  moralComplexity:    { 'Psychological': 2.5 },
};


/* ═══════════════════════════════════════════════════════════════════════════
   HIGHER-LEVEL FEATURE DEFINITIONS
═══════════════════════════════════════════════════════════════════════════ */

const TONE_DEFS = {
  dark: {
    tags:   ['Tragedy', 'Dark Fantasy', 'Horror', 'Despair', 'Dystopia', 'Gore',
             'Death Game', 'Nihilism', 'Psychological Abuse', 'Depression'],
    genres: ['Horror', 'Psychological'],
    min: 0.40,
  },
  emotional: {
    tags:   ['Tearjerker', 'Coming of Age', 'Grief', 'Heartwarming',
             'Family Dynamics', 'Redemption', 'Bittersweet'],
    genres: ['Drama'],
    min: 0.40,
  },
  wholesome: {
    tags:   ['Heartwarming', 'Iyashikei', 'Healing', 'CGDCT', 'Friendship', 'Cute'],
    genres: ['Slice of Life'],
    min: 0.40,
  },
  hype: {
    tags:   ['Tournament', 'Super Power', 'Adrenaline Rush', 'Power Fantasy',
             'Overpowered Main Characters', 'Battle', 'Mecha'],
    genres: ['Action', 'Sports'],
    min: 0.35,
  },
  suspenseful: {
    tags:   ['Thriller', 'Mystery', 'Conspiracy', 'Survival', 'Death Game',
             'Hidden Identity', 'Assassination'],
    genres: ['Mystery', 'Thriller'],
    min: 0.35,
  },
  relaxing: {
    tags:   ['Iyashikei', 'Daily Life', 'Healing', 'CGDCT', 'School Life', 'Moe'],
    genres: ['Slice of Life'],
    min: 0.35,
  },
  inspirational: {
    tags:   ['Underdog', 'Self-Discovery', 'Redemption', 'Overcoming Adversity',
             'Coming of Age', 'Training'],
    genres: ['Sports'],
    min: 0.30,
  },
  comedic: {
    tags:   ['Gag Humor', 'Parody', 'Slapstick', 'Absurdist', 'Black Comedy',
             'Comedic Relief', 'Tsukkomi'],
    genres: ['Comedy'],
    min: 0.30,
  },
  intense: {
    tags:   ['Violence', 'Psychological', 'Survival', 'War', 'Assassination', 'Gore'],
    genres: ['Action', 'Thriller'],
    min: 0.30,
  },
  philosophical: {
    tags:   ['Philosophy', 'Existentialism', 'Nihilism', 'Mind Games', 'Ethics',
             'Unreliable Narrator'],
    genres: ['Psychological'],
    min: 0.30,
  },
};

const VISUAL_DEFS = {
  cinematic: {
    studios: ['ufotable', 'mappa', 'wit studio', 'bones', 'kyoto animation',
              'production i.g', 'madhouse', 'cloverworks', 'a-1 pictures'],
    tags:    ['Cinematography', 'Beautiful Scenery', 'Fluid Animation', 'Sakuga',
              'Detailed Background Art'],
    min: 0.20,
  },
  retro: {
    yearBefore: 2004,
    tags:       ['Classic', '80s', '90s', 'Retro', 'Old School'],
    min: 0,
  },
  colorful: {
    tags:    ['Magical Girl', 'CGDCT', 'Colorful', 'Cute', 'Vibrant'],
    genres:  ['Mahou Shoujo', 'Fantasy'],
    min: 0.40,
  },
  gritty: {
    tags:    ['Gritty', 'Post-Apocalyptic', 'Gore', 'Violence', 'Dark Fantasy', 'Dystopia'],
    genres:  ['Horror'],
    min: 0.35,
  },
  modern: {
    yearAfter: 2016,
    studios:   ['mappa', 'ufotable', 'cloverworks', 'wit studio'],
    tags:      ['CG Animation'],
    min: 0,
  },
};

const ARCHETYPE_DEFS = {
  antihero:     ['Anti-Hero', 'Villain Protagonist', 'Dark Hero', 'Morally Ambiguous Protagonist'],
  overpowered:  ['Overpowered Main Characters', 'Power Fantasy', 'Isekai', 'Cheat Ability'],
  morallyGray:  ['Gray Morality', 'Moral Dilemmas', 'Anti-Hero', 'Nihilism', 'Villain Protagonist'],
  underdog:     ['Underdog', 'Weak to Strong', 'Coming of Age', 'Overcoming Adversity', 'Training'],
  strongFemale: ['Strong Female Lead', 'Female Protagonist', 'Kuudere', 'Tsundere'],
  foundFamily:  ['Found Family', 'Ensemble Cast', 'Teamwork', 'Brotherhood', 'Friendship'],
  rivalry:      ['Rival', 'Competition', 'Tournament', 'Rivalry'],
  villain:      ['Villain Protagonist', 'Antagonist Focus'],
  chaotic:      ['Ensemble Cast', 'Eccentric Characters', 'Multiple Protagonists'],
};


/* ═══════════════════════════════════════════════════════════════════════════
   FEATURE EXTRACTION
═══════════════════════════════════════════════════════════════════════════ */

function extractFeatures(anime) {
  const genres = anime.genres || [];
  const tags   = anime.tags   || [];
  const year   = anime.startDate?.year || null;

  const tagMap = {};
  for (const t of tags) tagMap[t.name] = t.rank || 0;

  function calcDim(dimName) {
    let score = 0;
    for (const [name, w] of Object.entries(DIM_TAG_WEIGHTS[dimName] || {})) {
      if (tagMap[name]) score += tagMap[name] * w;
    }
    for (const [genre, flat] of Object.entries(DIM_GENRE_BOOSTS[dimName] || {})) {
      if (genres.includes(genre)) score += flat;
    }
    return Math.min(score, 10);
  }

  let pacing = calcDim('_slowPacing');
  const eps = anime.episodes || 12;
  if (eps >= 50)    pacing = Math.min(pacing + 2.0, 10);
  else if (eps >= 24) pacing = Math.min(pacing + 0.8, 10);
  else if (eps <= 1)  pacing = Math.max(pacing - 1.5, 0);
  if (tagMap['Fast-Paced']) pacing = Math.max(pacing - tagMap['Fast-Paced'] * 0.07, 0);
  if (tagMap['Thriller'])   pacing = Math.max(pacing - tagMap['Thriller']   * 0.04, 0);

  const pop   = Math.max(anime.popularity || 1, 1);
  const niche = Math.max(0, 10 - (Math.log10(pop) / Math.log10(500_000)) * 10);

  const scalars = {
    fanService:         calcDim('fanService'),
    violence:           calcDim('violence'),
    darkness:           calcDim('darkness'),
    romance:            calcDim('romance'),
    humor:              calcDim('humor'),
    pacing:             Math.min(pacing, 10),
    niche:              Math.min(niche,  10),
    emotionalWeight:    calcDim('emotionalWeight'),
    hype:               calcDim('hype'),
    psychologicalDepth: calcDim('psychologicalDepth'),
    worldbuilding:      calcDim('worldbuilding'),
    characterDrama:     calcDim('characterDrama'),
    moralComplexity:    calcDim('moralComplexity'),
  };

  // Tone keys
  const toneKeys = [];
  for (const [tone, def] of Object.entries(TONE_DEFS)) {
    let signal = 0;
    for (const tag of def.tags)   if (tagMap[tag])          signal += tagMap[tag] / 100;
    for (const g   of def.genres) if (genres.includes(g))   signal += 1.0;
    if (signal >= def.min) toneKeys.push(`tone:${tone}`);
  }

  // Archetype keys
  const archetypeKeys = [];
  for (const [arch, archTags] of Object.entries(ARCHETYPE_DEFS)) {
    if (archTags.some(t => (tagMap[t] || 0) >= 50)) {
      archetypeKeys.push(`archetype:${arch}`);
    }
  }

  // Visual style keys
  const studioNames = (anime.studios?.nodes || []).map(s => s.name.toLowerCase());
  const visualKeys  = [];
  for (const [style, def] of Object.entries(VISUAL_DEFS)) {
    let hit = false;
    if (def.studios    && def.studios.some(s => studioNames.includes(s)))  hit = true;
    if (def.yearBefore && year && year < def.yearBefore)                    hit = true;
    if (def.yearAfter  && year && year > def.yearAfter)                     hit = true;
    if (!hit) {
      let signal = 0;
      for (const tag of (def.tags   || [])) if (tagMap[tag])          signal += tagMap[tag] / 100;
      for (const g   of (def.genres || [])) if (genres.includes(g))   signal += 1.0;
      if (signal >= def.min) hit = true;
    }
    if (hit) visualKeys.push(`visual:${style}`);
  }

  if (year) {
    if      (year >= 2020) visualKeys.push('era:2020s');
    else if (year >= 2010) visualKeys.push('era:2010s');
    else if (year >= 2000) visualKeys.push('era:2000s');
    else                   visualKeys.push('era:1990s');
  }

  const tagKeys = tags
    .filter(t => (t.rank || 0) >= 55)
    .slice(0, 16)
    .map(t => `tag:${t.name}`);

  const genreKeys  = genres.map(g => `genre:${g}`);
  const studioKeys = (anime.studios?.nodes || [])
    .slice(0, 2)
    .map(s => `studio:${s.name}`);

  return {
    scalars,
    keys: { tone: toneKeys, archetype: archetypeKeys, visual: visualKeys,
            tag: tagKeys, genre: genreKeys, studio: studioKeys },
  };
}

/** Default scalar profile for a fresh taste profile. */
function defaultDims() {
  return {
    fanService:         { preferred: 1.0, tolerance: 2.0,  confidence: 0, kind: 'tolerance' },
    violence:           { preferred: 2.0, tolerance: 3.0,  confidence: 0, kind: 'tolerance' },
    darkness:           { preferred: 3.0, tolerance: 4.0,  confidence: 0, kind: 'tolerance' },
    romance:            { preferred: 3.0, tolerance: 4.0,  confidence: 0, kind: 'tolerance' },
    humor:              { preferred: 5.0, tolerance: 6.5,  confidence: 0, kind: 'tolerance' },
    pacing:             { preferred: 5.0, tolerance: 7.0,  confidence: 0, kind: 'tolerance' },
    niche:              { preferred: 3.0, tolerance: 5.5,  confidence: 0, kind: 'tolerance' },
    emotionalWeight:    { preferred: 5.0, tolerance: 9.0,  confidence: 0, kind: 'appetite' },
    hype:               { preferred: 4.0, tolerance: 9.0,  confidence: 0, kind: 'appetite' },
    psychologicalDepth: { preferred: 3.0, tolerance: 8.0,  confidence: 0, kind: 'appetite' },
    worldbuilding:      { preferred: 4.0, tolerance: 9.0,  confidence: 0, kind: 'appetite' },
    characterDrama:     { preferred: 4.0, tolerance: 9.0,  confidence: 0, kind: 'appetite' },
    moralComplexity:    { preferred: 3.0, tolerance: 8.0,  confidence: 0, kind: 'appetite' },
  };
}

/** Default empty 6-group vector set. */
function defaultVectors() {
  return { tone: {}, archetype: {}, visual: {}, tag: {}, genre: {}, studio: {} };
}


/* ═══════════════════════════════════════════════════════════════════════════
   NEXTARCENGINE v3
═══════════════════════════════════════════════════════════════════════════ */

class NextArcEngine {

  constructor() {

    /**
     * GLOBAL PROFILE — used during onboarding and as a fallback.
     * After onboarding, cluster profiles take over as the primary signal.
     */
    this.vectors = defaultVectors();
    this.dims    = defaultDims();

    /**
     * CLUSTER REGISTRY
     * Each cluster is an independent taste profile that emerges naturally
     * from the user's swipe patterns.
     *
     * ClusterProfile shape:
     * {
     *   id:             unique number
     *   tones:          Set<string>   dominant tone:X keys
     *   archetypes:     Set<string>   dominant archetype:X keys
     *   visuals:        Set<string>   dominant visual:X keys
     *   vectors:        { tone, archetype, visual, tag, genre, studio }
     *   dims:           { dim → { preferred, tolerance, confidence, kind } }
     *   weight:         cumulative positive signal strength
     *   count:          number of positive swipes assigned here
     *   lastSeen:       totalSwipes value when last reinforced
     * }
     */
    this.clusters        = [];
    this.nextClusterId   = 0;
    this.MAX_CLUSTERS    = 7;
    this.CLUSTER_JOIN_THRESHOLD = 0.55; // similarity needed to join an existing cluster

    /** Boundary test state (global — boundary testing runs against global profile) */
    this.pendingTests  = new Map();
    this.dimTestCounts = Object.fromEntries(Object.keys(this.dims).map(d => [d, 0]));
    this.dimCooldowns  = Object.fromEntries(Object.keys(this.dims).map(d => [d, 0]));

    /** Anti-repetition */
    this.recentFeatures   = [];   // last 10 shown feature profiles
    this.recentClusterIds = [];   // last 6 cluster IDs served (for cross-cluster rotation)
    this.MAX_RECENT       = 10;
    this.MAX_RECENT_CL    = 6;

    this.onboarded   = false;
    this.totalSwipes = 0;
  }


  /* ════════════════════════════════════════════════════════════════════
     PUBLIC API
     ════════════════════════════════════════════════════════════════════ */

  update(anime, action) {
    if (action === 'skip') { this.totalSwipes++; return; }

    const isSuperLike = action === 'superlike';
    const isPositive  = action === 'like' || action === 'watch' || isSuperLike;
    const isWatch     = action === 'watch';
    const isDislike   = action === 'dislike';
    const features    = extractFeatures(anime);

    // ── Global vector update ───────────────────────────────────────────
    // superlike carries 5.0 — 2.5× the normal post-onboarding like weight
    const catDelta = isSuperLike ?  5.0
                   : isWatch     ?  3.5
                   : isPositive  ? (this.onboarded ?  2.0 :  3.0)
                   :               (this.onboarded ? -2.0 : -3.0);

    for (const [group, keys] of Object.entries(features.keys)) {
      for (const key of keys) {
        this.vectors[group][key] = (this.vectors[group][key] || 0) + catDelta;
      }
    }

    // ── Global scalar update ───────────────────────────────────────────
    if (isPositive) {
      this._absorbPositive(this.dims, features.scalars, isWatch || isSuperLike);
    } else {
      this._absorbNegative(this.dims, features.scalars, isDislike);
    }

    // ── Cluster update (positive signals only) ─────────────────────────
    if (isPositive) {
      const signal = isSuperLike ? 5.0 : isWatch ? 3.5 : (this.onboarded ? 2.0 : 3.0);
      this._absorbIntoCluster(features, signal);
    }

    // ── Boundary test resolution ───────────────────────────────────────
    if (this.pendingTests.has(anime.id)) {
      const { dimension, testLevel } = this.pendingTests.get(anime.id);
      this._processBoundaryResult(dimension, testLevel, isPositive, isDislike);
      this.pendingTests.delete(anime.id);
    }

    for (const d of Object.keys(this.dimCooldowns)) {
      if (this.dimCooldowns[d] > 0) this.dimCooldowns[d]--;
    }

    this.totalSwipes++;
  }

  finishOnboarding() {
    this._normalise(this.vectors);
    for (const cluster of this.clusters) this._normalise(cluster.vectors);
    this.onboarded = true;
  }

  trackShown(anime) {
    const features = extractFeatures(anime);
    this.recentFeatures.unshift(features);
    if (this.recentFeatures.length > this.MAX_RECENT) this.recentFeatures.pop();

    // Track which cluster this card belongs to (for rotation enforcement)
    if (this.clusters.length >= 2) {
      let bestId = -1, bestSim = -1;
      for (const c of this.clusters) {
        const sim = this._clusterSimilarity(features, c);
        if (sim > bestSim) { bestSim = sim; bestId = c.id; }
      }
      this.recentClusterIds.unshift(bestId);
      if (this.recentClusterIds.length > this.MAX_RECENT_CL) this.recentClusterIds.pop();
    }
  }

  /**
   * Rank candidates using multi-cluster scoring when clusters are established,
   * falling back to the global profile during/after onboarding before clusters form.
   */
  rankRecommendations(candidates, seenIds = []) {
    const excluded = seenIds instanceof Set ? seenIds : new Set(seenIds);
    const pool = candidates.filter(a => !excluded.has(a.id));
    if (pool.length === 0) return [];

    const profiles     = pool.map(anime => ({ anime, features: extractFeatures(anime) }));
    const activeClusters = this.onboarded ? this._getActiveClusters() : [];
    const multiCluster   = activeClusters.length >= 2;

    // ── Score every candidate ─────────────────────────────────────────
    const topClusterScore = multiCluster ? activeClusters[0].recencyScore : 1;

    const scored = profiles.map(p => {
      const globalScore = this._scoreAgainstProfile(p.features, this.vectors, this.dims);

      if (!multiCluster) {
        return { ...p, score: globalScore, clusterId: -1 };
      }

      // Score against each cluster; take best-fit (weighted by cluster recency)
      let bestClusterScore = 0;
      let bestClusterId    = -1;

      for (const cluster of activeClusters) {
        const raw      = this._scoreAgainstProfile(p.features, cluster.vectors, cluster.dims);
        const weighted = raw * (cluster.recencyScore / topClusterScore);
        if (weighted > bestClusterScore) {
          bestClusterScore = weighted;
          bestClusterId    = cluster.id;
        }
      }

      // Post-onboarding: clusters provide 65% of the signal; global provides 35%
      const blended = globalScore * 0.35 + bestClusterScore * 0.65;
      return { ...p, score: blended, clusterId: bestClusterId };
    });

    // ── Apply cluster-rotation penalty ────────────────────────────────
    // Prevent the engine from endlessly serving the same cluster
    if (multiCluster && this.recentClusterIds.length > 0) {
      const overservedId = this._mostOverservedClusterId();
      for (const p of scored) {
        if (p.clusterId === overservedId) {
          p.score -= 0.12; // dampen, don't exclude
        }
      }
    }

    // Re-sort after rotation penalty
    scored.sort((a, b) => b.score - a.score);

    // ── Boundary probe ────────────────────────────────────────────────
    const boundaryDim        = this.onboarded ? this._pickBoundaryDim() : null;
    const boundaryCandidates = boundaryDim
      ? this._findBoundaryCandidates(profiles, boundaryDim)
      : [];

    // ── Wildcards ─────────────────────────────────────────────────────
    const wildcardCandidates = this._findWildcards(scored);

    // ── Allocate slots ────────────────────────────────────────────────
    const total     = Math.min(pool.length, 30);
    const nBoundary = this.onboarded ? Math.max(1, Math.round(total * 0.20)) : 0;
    const nWild     = Math.max(1, Math.round(total * 0.10));
    const nStrong   = total - nBoundary - nWild;

    const usedIds  = new Set();
    const boundary = [];
    const wild     = [];

    for (const p of boundaryCandidates) {
      if (boundary.length >= nBoundary) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        const testLevel = p.features.scalars[boundaryDim];
        this.pendingTests.set(p.anime.id, { dimension: boundaryDim, testLevel });
        boundary.push({ ...p.anime, _meta: { type: 'boundary', dimension: boundaryDim, testLevel } });
      }
    }

    for (const p of wildcardCandidates) {
      if (wild.length >= nWild) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        wild.push({ ...p.anime, _meta: { type: 'wildcard' } });
      }
    }

    // Strong picks — distributed across clusters when multi-cluster mode is active
    const strongPool = scored.filter(p => !usedIds.has(p.anime.id));
    const strong = multiCluster
      ? this._pickAcrossClusters(strongPool, activeClusters, nStrong, usedIds)
      : this._pickWithAntiRep(strongPool, nStrong, usedIds);

    return this._interleave(strong, boundary, wild);
  }


  /* ════════════════════════════════════════════════════════════════════
     CLUSTER MANAGEMENT
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Assign a liked/watched anime to an existing cluster or create a new one.
   * This is the engine of taste-lane detection.
   */
  _absorbIntoCluster(features, signal) {
    let bestCluster = null;
    let bestSim     = -1;

    for (const cluster of this.clusters) {
      const sim = this._clusterSimilarity(features, cluster);
      if (sim > bestSim) { bestSim = sim; bestCluster = cluster; }
    }

    if (bestCluster && bestSim >= this.CLUSTER_JOIN_THRESHOLD) {
      this._updateCluster(bestCluster, features, signal);
    } else {
      this.clusters.push(this._createCluster(features, signal));
      if (this.clusters.length > this.MAX_CLUSTERS) {
        this._mergeWeakestClusters();
      }
    }
  }

  _createCluster(features, signal) {
    return {
      id:         this.nextClusterId++,
      tones:      new Set(features.keys.tone),
      archetypes: new Set(features.keys.archetype),
      visuals:    new Set(features.keys.visual),
      vectors:    defaultVectors(),
      dims:       defaultDims(),
      weight:     signal,
      count:      1,
      lastSeen:   this.totalSwipes,
    };
  }

  _updateCluster(cluster, features, signal) {
    const lr = 0.22; // centroid learning rate

    // Update scalar profile
    this._absorbPositive(cluster.dims, features.scalars, false);

    // Update key fingerprints (union — new keys always added)
    for (const t of features.keys.tone)      cluster.tones.add(t);
    for (const a of features.keys.archetype) cluster.archetypes.add(a);
    for (const v of features.keys.visual)    cluster.visuals.add(v);

    // Update cluster-specific categorical vectors
    for (const [group, keys] of Object.entries(features.keys)) {
      for (const key of keys) {
        cluster.vectors[group][key] = (cluster.vectors[group][key] || 0) + signal;
      }
    }

    cluster.weight  += signal;
    cluster.count   += 1;
    cluster.lastSeen = this.totalSwipes;
  }

  /**
   * How well does `features` fit into `cluster`?
   * Tone (55%) + archetype (25%) + scalar proximity (20%).
   *
   * These weights are intentionally different from recommendation scoring:
   * here we're measuring "does this anime belong in this mood lane",
   * which is primarily a tone + character pattern question.
   */
  _clusterSimilarity(features, cluster) {
    const toneOverlap = this._keyOverlap(features.keys.tone,      [...cluster.tones]);
    const archOverlap = this._keyOverlap(features.keys.archetype,  [...cluster.archetypes]);
    const scalarProx  = this._scalarProximity(features.scalars,    cluster.dims);
    return toneOverlap * 0.55 + archOverlap * 0.25 + scalarProx * 0.20;
  }

  /** Jaccard overlap between two key arrays. */
  _keyOverlap(keysA, keysB) {
    if (!keysA.length || !keysB.length) return 0;
    const setA = new Set(keysA);
    const setB = new Set(keysB);
    const intersection = [...setA].filter(k => setB.has(k)).length;
    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
  }

  /** How close are `scalars` to a dims profile centroid? Returns 0–1. */
  _scalarProximity(scalars, dims) {
    const keys = Object.keys(dims);
    const dist = keys.reduce(
      (sum, d) => sum + Math.abs((scalars[d] || 0) - (dims[d]?.preferred || 5)),
      0
    );
    return Math.max(0, 1 - dist / (keys.length * 10));
  }

  /**
   * Merge the two weakest clusters (by weight) to keep the registry lean.
   * Weight-proportional centroid blending preserves the combined history.
   */
  _mergeWeakestClusters() {
    if (this.clusters.length < 2) return;

    const sorted = [...this.clusters].sort((a, b) => a.weight - b.weight);
    const weak   = sorted[0];
    const target = sorted[1];

    const wA = weak.weight   / (weak.weight + target.weight);
    const wB = target.weight / (weak.weight + target.weight);

    // Blend scalar centroids
    for (const dim of Object.keys(target.dims)) {
      target.dims[dim].preferred =
        (target.dims[dim].preferred || 5) * wB +
        (weak.dims[dim]?.preferred  || 5) * wA;
      target.dims[dim].tolerance =
        (target.dims[dim].tolerance || 7) * wB +
        (weak.dims[dim]?.tolerance  || 7) * wA;
    }

    // Merge fingerprints
    for (const t of weak.tones)      target.tones.add(t);
    for (const t of weak.archetypes) target.archetypes.add(t);
    for (const t of weak.visuals)    target.visuals.add(t);

    // Merge vectors
    for (const [group, vec] of Object.entries(weak.vectors)) {
      for (const [k, v] of Object.entries(vec)) {
        target.vectors[group][k] = (target.vectors[group][k] || 0) + v * (wA / wB);
      }
    }

    target.weight  += weak.weight;
    target.count   += weak.count;
    target.lastSeen = Math.max(target.lastSeen, weak.lastSeen);

    this.clusters = this.clusters.filter(c => c !== weak);
  }

  /**
   * Return active clusters sorted by recency-weighted score.
   * Clusters with only 1 swipe are tentative and rank lower.
   */
  _getActiveClusters() {
    const now = this.totalSwipes;
    return this.clusters
      .map(c => ({
        ...c,
        recencyScore: c.weight * Math.pow(0.96, Math.max(0, now - c.lastSeen)) *
                      (c.count >= 2 ? 1.0 : 0.5), // tentative penalty for single-swipe clusters
      }))
      .filter(c => c.recencyScore > 0.5)
      .sort((a, b) => b.recencyScore - a.recencyScore);
  }

  /**
   * Which cluster ID has been over-served recently?
   * Returns -1 if no clear over-served cluster.
   */
  _mostOverservedClusterId() {
    if (this.recentClusterIds.length < 3) return -1;
    const counts = {};
    for (const id of this.recentClusterIds) {
      counts[id] = (counts[id] || 0) + 1;
    }
    const max = Math.max(...Object.values(counts));
    if (max < 3) return -1; // only penalise if truly dominant
    const [id] = Object.entries(counts).find(([, v]) => v === max);
    return Number(id);
  }

  /**
   * Auto-detected human-readable label for a cluster.
   * Uses the 1–2 most prominent tone keys.
   */
  _clusterLabel(cluster) {
    const tones = [...cluster.tones]
      .map(t => t.replace('tone:', ''))
      .sort();
    if (tones.length === 0) {
      const archs = [...cluster.archetypes].map(a => a.replace('archetype:', ''));
      return archs.slice(0, 2).join('+') || 'general';
    }
    return tones.slice(0, 2).join('+');
  }


  /* ════════════════════════════════════════════════════════════════════
     SCORING
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Score an anime's features against any profile (global or per-cluster).
   * Priority: tone > tag > archetype > visual > scalar > studio > genre
   */
  _scoreAgainstProfile(features, vectors, dims) {
    const { scalars, keys } = features;

    const toneSim  = this._groupSim(keys.tone,      vectors, 'tone');
    const tagSim   = this._groupSim(keys.tag,        vectors, 'tag');
    const archSim  = this._groupSim(keys.archetype,  vectors, 'archetype');
    const visSim   = this._groupSim(keys.visual,     vectors, 'visual');
    const stuSim   = this._groupSim(keys.studio,     vectors, 'studio');
    const genSim   = this._groupSim(keys.genre,      vectors, 'genre');
    const scalar   = this._scalarCompatibility(scalars, dims);
    const antiRep  = this._antiRepPenalty(features);

    return (
      toneSim * 0.26 +
      tagSim  * 0.20 +
      archSim * 0.14 +
      visSim  * 0.09 +
      scalar  * 0.16 +
      stuSim  * 0.07 +
      genSim  * 0.05 +
      (1 - antiRep) * 0.03
    );
  }

  /** Convenience: score against global profile (used internally). */
  _scoreStrong(features) {
    return this._scoreAgainstProfile(features, this.vectors, this.dims);
  }

  _scalarCompatibility(scalars, dims) {
    let total = 0, weight = 0;
    for (const [dim, profile] of Object.entries(dims)) {
      const level = scalars[dim] ?? 5;
      const score = this._dimScore(profile, level);
      const w     = 0.3 + profile.confidence * 0.7;
      total  += score * w;
      weight += w;
    }
    return weight > 0 ? total / weight : 0.5;
  }

  _dimScore(profile, level) {
    const { preferred, tolerance } = profile;
    const dist = Math.abs(level - preferred);
    if (dist <= 1.0) return 1.0;
    if (level <= tolerance) {
      const span = Math.max(1, tolerance - preferred);
      return Math.max(0.35, 1.0 - ((dist - 1.0) / span) * 0.65);
    }
    const excess = level - tolerance;
    return Math.max(0, 0.28 - excess * 0.10);
  }

  /**
   * Cosine similarity between `vectors[groupName]` and anime's keys for that group.
   * Negative user entries (disliked) penalise matching anime.
   * Returns 0.3 (neutral) when either side has no data.
   *
   * Remapped: cosSim ∈ [-1, 1] → score ∈ [0, 1]
   */
  _groupSim(animeKeys, vectors, groupName) {
    if (!animeKeys || animeKeys.length === 0) return 0.3;

    const vec     = vectors[groupName] || {};
    const entries = Object.entries(vec);
    if (entries.length === 0) return 0.3;

    const animeSet = new Set(animeKeys);
    let dot = 0, magUser = 0;

    for (const [k, v] of entries) {
      dot     += v * (animeSet.has(k) ? 1 : 0);
      magUser += v * v;
    }

    if (magUser === 0) return 0.3;
    const raw = dot / (Math.sqrt(magUser) * Math.sqrt(animeKeys.length));
    return Math.max(0, Math.min(1, raw * 0.70 + 0.30));
  }


  /* ════════════════════════════════════════════════════════════════════
     MULTI-CLUSTER RECOMMENDATION ALLOCATION
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Distribute `total` strong picks proportionally across active clusters,
   * guaranteeing each cluster gets at least MIN_PER_CLUSTER slots.
   * Picks are interleaved (round-robin by cluster) so variety is immediate.
   */
  _pickAcrossClusters(scoredPool, activeClusters, total, usedIds) {
    const MIN_PER_CLUSTER = 2;

    // Bucket candidates by their best cluster
    const buckets = {};
    for (const c of activeClusters) buckets[c.id] = [];

    for (const p of scoredPool) {
      if (p.clusterId === -1) continue;
      if (buckets[p.clusterId]) buckets[p.clusterId].push(p);
    }

    // Also capture "unclaimed" candidates (no cluster match) — they go last
    const unclaimed = scoredPool.filter(p => p.clusterId === -1 || !buckets[p.clusterId]);

    // Compute slot allocation
    const totalWeight = activeClusters.reduce((s, c) => s + c.recencyScore, 0);
    let remaining = total;

    const slots = {};
    for (const c of activeClusters) {
      slots[c.id] = MIN_PER_CLUSTER;
      remaining  -= MIN_PER_CLUSTER;
    }
    // Distribute remaining proportionally
    for (const c of activeClusters) {
      if (remaining <= 0) break;
      const extra = Math.round(remaining * c.recencyScore / totalWeight);
      slots[c.id] += extra;
      remaining   -= extra;
    }

    // Round-robin fill across clusters
    const result   = [];
    const pointers = {};
    for (const c of activeClusters) pointers[c.id] = 0;

    let made_progress = true;
    while (result.length < total && made_progress) {
      made_progress = false;
      for (const c of activeClusters) {
        if (result.length >= total) break;
        if ((pointers[c.id] || 0) >= (slots[c.id] || 0)) continue;
        const bucket = buckets[c.id] || [];
        while (pointers[c.id] < bucket.length) {
          const p = bucket[pointers[c.id]++];
          if (!usedIds.has(p.anime.id)) {
            usedIds.add(p.anime.id);
            result.push({ ...p.anime, _meta: { type: 'strong', cluster: c.id } });
            made_progress = true;
            break;
          }
        }
      }
    }

    // Fill any remaining slots from unclaimed / overflow
    for (const p of unclaimed) {
      if (result.length >= total) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        result.push({ ...p.anime, _meta: { type: 'strong' } });
      }
    }

    return result;
  }

  /** Single-profile strong picks with anti-repetition (pre-cluster fallback). */
  _pickWithAntiRep(scoredPool, n, usedIds) {
    const result = [];
    const usedFeatures = [];

    for (const p of scoredPool) {
      if (result.length >= n) break;
      if (usedIds.has(p.anime.id)) continue;

      if (usedFeatures.length > 0) {
        const dimKeys = Object.keys(this.dims);
        const maxSim  = Math.max(...usedFeatures.map(f => {
          const diff = dimKeys.reduce(
            (s, d) => s + Math.abs((p.features.scalars[d] || 0) - (f.scalars[d] || 0)),
            0
          );
          return 1 - diff / (dimKeys.length * 10);
        }));
        if (maxSim > 0.87 && result.length >= Math.ceil(n * 0.5)) continue;
      }

      usedIds.add(p.anime.id);
      result.push({ ...p.anime, _meta: { type: 'strong' } });
      usedFeatures.push(p.features);
    }

    return result;
  }


  /* ════════════════════════════════════════════════════════════════════
     BOUNDARY TESTING
     ════════════════════════════════════════════════════════════════════ */

  _pickBoundaryDim() {
    const eligible = Object.keys(this.dims).filter(
      d => this.dims[d].confidence > 0.18 && this.dimCooldowns[d] === 0
    );
    if (eligible.length === 0) return null;

    eligible.sort((a, b) => {
      const tDiff = this.dimTestCounts[a] - this.dimTestCounts[b];
      if (tDiff !== 0) return tDiff;
      return this.dims[b].confidence - this.dims[a].confidence;
    });

    return eligible[0];
  }

  _findBoundaryCandidates(profiles, dim) {
    const { tolerance } = this.dims[dim];
    const lo = tolerance + 0.4;
    const hi = tolerance + 2.8;

    return profiles
      .filter(p => {
        const lvl = p.features.scalars[dim];
        return lvl >= lo && lvl <= hi;
      })
      .map(p => {
        const otherFit = this._scoreOtherDims(p.features.scalars, dim);
        const toneSim  = this._groupSim(p.features.keys.tone, this.vectors, 'tone');
        const tagSim   = this._groupSim(p.features.keys.tag,  this.vectors, 'tag');
        return { ...p, boundaryScore: toneSim * 0.40 + tagSim * 0.30 + otherFit * 0.30 };
      })
      .sort((a, b) => b.boundaryScore - a.boundaryScore);
  }

  _scoreOtherDims(scalars, excludeDim) {
    let total = 0, weight = 0;
    for (const [dim, profile] of Object.entries(this.dims)) {
      if (dim === excludeDim) continue;
      const level = scalars[dim] ?? 5;
      const w     = 0.3 + profile.confidence * 0.7;
      total  += this._dimScore(profile, level) * w;
      weight += w;
    }
    return weight > 0 ? total / weight : 0.5;
  }

  _processBoundaryResult(dimension, testLevel, liked, isDislike = false) {
    const p = this.dims[dimension];
    this.dimTestCounts[dimension]++;
    this.dimCooldowns[dimension] = 4;

    if (liked) {
      p.tolerance = Math.min(10, testLevel + 0.5);
      p.preferred = p.preferred * 0.88 + testLevel * 0.12;
    } else if (isDislike) {
      p.tolerance = Math.max(p.preferred - 0.5, p.tolerance - 1.8);
      p.preferred = Math.max(0, p.preferred - 0.5);
    } else {
      p.tolerance = Math.max(p.preferred, p.tolerance - 0.5);
    }

    p.confidence = Math.min(1, p.confidence + 0.12);
  }


  /* ════════════════════════════════════════════════════════════════════
     WILDCARDS
     ════════════════════════════════════════════════════════════════════ */

  _findWildcards(strongScored) {
    const cutoff = Math.floor(strongScored.length * 0.70);
    return strongScored.slice(cutoff).sort(() => Math.random() - 0.5);
  }


  /* ════════════════════════════════════════════════════════════════════
     ANTI-REPETITION
     ════════════════════════════════════════════════════════════════════ */

  _antiRepPenalty(features) {
    if (this.recentFeatures.length === 0) return 0;

    const dimKeys = Object.keys(this.dims);

    const penalties = this.recentFeatures.map(recent => {
      const diff = dimKeys.reduce(
        (sum, d) => sum + Math.abs((features.scalars[d] || 0) - (recent.scalars[d] || 0)),
        0
      );
      const scalarSim = 1 - diff / (dimKeys.length * 10);

      const toneA = new Set(features.keys.tone);
      const toneB = new Set(recent.keys.tone);
      const toneOverlap = [...toneA].filter(t => toneB.has(t)).length /
                          Math.max(1, Math.max(toneA.size, toneB.size));

      const archA = new Set(features.keys.archetype);
      const archB = new Set(recent.keys.archetype);
      const archOverlap = [...archA].filter(a => archB.has(a)).length /
                          Math.max(1, Math.max(archA.size, archB.size));

      return scalarSim * 0.50 + toneOverlap * 0.30 + archOverlap * 0.20;
    });

    return Math.max(...penalties);
  }


  /* ════════════════════════════════════════════════════════════════════
     QUEUE INTERLEAVING
     ════════════════════════════════════════════════════════════════════ */

  _interleave(strong, boundary, wild) {
    const result = [];
    let bI = 0, wI = 0;

    for (let i = 0; i < strong.length; i++) {
      result.push(strong[i]);
      if ((i + 1) % 5  === 0 && bI < boundary.length) result.push(boundary[bI++]);
      if ((i + 1) % 10 === 0 && wI < wild.length)     result.push(wild[wI++]);
    }

    while (bI < boundary.length) result.push(boundary[bI++]);
    while (wI < wild.length)     result.push(wild[wI++]);

    return result;
  }


  /* ════════════════════════════════════════════════════════════════════
     SCALAR PROFILE UPDATES
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Absorb a positive signal into a dims profile (global or per-cluster).
   * Called with this.dims for the global profile, cluster.dims for clusters.
   */
  _absorbPositive(dims, scalars, isWatch) {
    const lr = isWatch        ? 0.22
             : this.onboarded ? 0.15
             :                  0.28;

    for (const [dim, profile] of Object.entries(dims)) {
      const level = scalars[dim] ?? 5;
      profile.preferred  = profile.preferred * (1 - lr) + level * lr;
      if (level > profile.tolerance) {
        profile.tolerance = profile.tolerance * 0.65 + level * 0.35;
      }
      profile.confidence = Math.min(1, profile.confidence + 0.07);
    }
  }

  _absorbNegative(dims, scalars, isDislike = false) {
    const lr = isDislike
      ? (this.onboarded ? 0.18 : 0.25)
      : (this.onboarded ? 0.05 : 0.10);

    for (const [dim, profile] of Object.entries(dims)) {
      const level = scalars[dim] ?? 5;
      if (isDislike) {
        if (level > profile.preferred + 1.0) {
          profile.preferred = profile.preferred * (1 - lr) + (level - 2.0) * lr;
          if (level > profile.tolerance) {
            profile.tolerance = Math.max(profile.preferred, profile.tolerance - 0.8);
          }
        }
      } else {
        if (level > profile.preferred + 2.5) {
          profile.preferred = profile.preferred * (1 - lr) + (level - 1.5) * lr;
        }
      }
      profile.confidence = Math.min(1, profile.confidence + (isDislike ? 0.07 : 0.03));
    }
  }


  /* ════════════════════════════════════════════════════════════════════
     NORMALISATION
     ════════════════════════════════════════════════════════════════════ */

  _normalise(vectors) {
    for (const vec of Object.values(vectors)) {
      const mag = Math.sqrt(Object.values(vec).reduce((s, v) => s + v * v, 0));
      if (mag > 0) for (const k of Object.keys(vec)) vec[k] /= mag;
    }
  }


  /* ════════════════════════════════════════════════════════════════════
     DIAGNOSTICS
     ════════════════════════════════════════════════════════════════════ */

  topTraits(n = 10) {
    const all = [];
    for (const [group, vec] of Object.entries(this.vectors)) {
      for (const [k, v] of Object.entries(vec)) {
        if (v > 0) all.push({ key: k, group, score: +v.toFixed(3) });
      }
    }
    return all.sort((a, b) => b.score - a.score).slice(0, n);
  }

  dimProfiles() {
    return Object.entries(this.dims).map(([dim, p]) => ({
      dimension:  dim,
      kind:       p.kind,
      preferred:  +p.preferred.toFixed(2),
      tolerance:  +p.tolerance.toFixed(2),
      confidence: +p.confidence.toFixed(2),
    }));
  }

  /**
   * Returns a human-readable summary of all detected taste clusters.
   * Useful for debugging or a future "Your Taste" UI screen.
   */
  clusterSummaries() {
    const active = this._getActiveClusters();
    return active.map((c, rank) => ({
      rank,
      id:         c.id,
      label:      this._clusterLabel(c),
      tones:      [...c.tones].map(t => t.replace('tone:', '')),
      archetypes: [...c.archetypes].map(a => a.replace('archetype:', '')),
      weight:     +c.weight.toFixed(1),
      swipes:     c.count,
      recency:    +c.recencyScore.toFixed(2),
    }));
  }
}


/* ─────────────────────────────────────────────────────────────────────────
   CommonJS export (no-op in browser)
───────────────────────────────────────────────────────────────────────── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NextArcEngine, extractFeatures };
}

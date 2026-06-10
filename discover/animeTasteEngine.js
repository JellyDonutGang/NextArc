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
 *  ├─ Scalar dimensions    17 axes per cluster: 10 tolerance + 7 appetite dims
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
   SIGNAL KEYS — the 20 AI-extracted floats stored in Firestore anime_signals.
   Used by updateSignalProfile() and computeSignalAffinity().
═══════════════════════════════════════════════════════════════════════════ */

const SIGNAL_KEYS = [
  'hype_factor', 'darkness', 'violence_factor', 'horror_factor', 'comfort_factor',
  'romance_centrality', 'intellectual_depth', 'emotional_intensity', 'comedy_factor',
  'fanservice_factor', 'pacing', 'binge_quality', 'rewatch_value', 'newcomer_accessible',
  'quality_consensus', 'divisiveness', 'hidden_gem', 'visual_emphasis',
  'soundtrack_emphasis', 'character_depth_focus',
];

/* ═══════════════════════════════════════════════════════════════════════════
   SCALAR DIMENSION TAG WEIGHTS
   score = Σ(tagRank × weight) + genreBoost, clamped [0, 10]
═══════════════════════════════════════════════════════════════════════════ */

// All tag name keys are lowercase so they match both:
//   • AniList tags (lowercased in tagMap at extraction time)
//   • AniDB tags (already lowercase from UDP API)
// AniDB tags are marked with a comment where they extend beyond AniList's vocabulary.

const DIM_TAG_WEIGHTS = {

  fanService: {
    // AniList (lowercased)
    'ecchi':                         0.09,
    'fan service':                   0.08,
    'nudity':                        0.10,
    'sexual content':                0.10,
    'pantsu':                        0.07,
    'harem':                         0.05,
    'reverse harem':                 0.04,
    // AniDB additions
    'partial nudity':                0.07,
    'suggestive themes':             0.06,
    'swimsuit':                      0.05,
    'large breasts':                 0.06,
    'small breasts':                 0.04,
    'nudism':                        0.07,
    'sexual humour':                 0.05,
    'fanservice':                    0.08,
  },

  violence: {
    // AniList (lowercased)
    'violence':                      0.09,
    'gore':                          0.10,
    'graphic violence':              0.10,
    'torture':                       0.09,
    'blood':                         0.06,
    'war':                           0.05,
    'survival':                      0.04,
    'assassination':                 0.05,
    // AniDB additions
    'intense violence':              0.11,
    'martial arts':                  0.07,
    'gunfights':                     0.07,
    'swordplay':                     0.07,
    'combat':                        0.06,
    'fighting':                      0.06,
    'hand-to-hand combat':           0.06,
    'death':                         0.05,
    'action':                        0.03,
  },

  darkness: {
    // AniList (lowercased)
    'dark fantasy':                  0.08,
    'tragedy':                       0.09,
    'despair':                       0.09,
    'death':                         0.07,
    'horror':                        0.08,
    'dystopia':                      0.07,
    'nihilism':                      0.09,
    'corruption':                    0.07,
    'psychological abuse':           0.07,
    'depression':                    0.07,
    // AniDB additions
    'dark themes':                   0.09,
    'suicide':                       0.08,
    'abuse':                         0.07,
    'grief':                         0.06,
    'war':                           0.05,
    'post-apocalyptic':              0.07,
    'dark':                          0.07,
    'melancholic':                   0.06,
  },

  romance: {
    // AniList (lowercased)
    'romance':                       0.09,
    'love triangle':                 0.09,
    'unrequited love':               0.09,
    'first love':                    0.08,
    'childhood friend romance':      0.08,
    'forbidden love':                0.08,
    'breakup':                       0.07,
    'arranged marriage':             0.08,
    // AniDB additions
    'slow romance':                  0.08,
    'love interest':                 0.06,
    'romantic comedy':               0.07,
    'shoujo ai':                     0.07,
    'shounen ai':                    0.07,
    'one-sided love':                0.08,
    'childhood romance':             0.07,
    'school romance':                0.07,
    'slow when it comes to love':    0.06,
  },

  humor: {
    // AniList (lowercased)
    'parody':                        0.09,
    'slapstick':                     0.09,
    'black comedy':                  0.08,
    'satire':                        0.08,
    'gag humor':                     0.09,
    'comedic relief':                0.07,
    'absurdist':                     0.08,
    'tsukkomi':                      0.06,
    // AniDB additions
    'comedy':                        0.10,
    'physical comedy':               0.08,
    'dark humor':                    0.08,
    'dark comedy':                   0.08,
    'action comedy':                 0.09,
    'comedy of errors':              0.07,
    'absurd':                        0.07,
    'delinquents':                   0.04,
    'four-panel':                    0.05,
  },

  _slowPacing: {
    // AniList (lowercased)
    'slow pacing':                   0.10,
    'iyashikei':                     0.09,
    'daily life':                    0.06,
    'healing':                       0.07,
    'cgdct':                         0.04,
    // AniDB additions
    'slow-paced':                    0.10,
    'slice of life':                 0.06,
    'school life':                   0.05,
    'calm':                          0.07,
    'rural setting':                 0.05,
  },

  niche: {},

  emotionalWeight: {
    // AniList (lowercased)
    'tearjerker':                    0.10,
    'tragedy':                       0.09,
    'coming of age':                 0.07,
    'heartwarming':                  0.08,
    'family dynamics':               0.07,
    'grief':                         0.09,
    'self-discovery':                0.07,
    'redemption':                    0.07,
    'bittersweet':                   0.08,
    // AniDB additions
    'emotional':                     0.08,
    'melancholic':                   0.08,
    'depression':                    0.07,
    'loss':                          0.08,
    'sacrifice':                     0.07,
    'despair':                       0.07,
    'hope':                          0.06,
    'loneliness':                    0.07,
    'nostalgia':                     0.06,
  },

  hype: {
    // AniList (lowercased)
    'super power':                   0.08,
    'martial arts':                  0.07,
    'tournament':                    0.09,
    'power fantasy':                 0.08,
    'adrenaline rush':               0.09,
    'overpowered main characters':   0.07,
    'mecha':                         0.05,
    'battle':                        0.06,
    // AniDB additions
    'action':                        0.05,
    'battles':                       0.07,
    'power system':                  0.08,
    'shounen':                       0.05,
    'fighting':                      0.06,
    'sports':                        0.06,
    'competition':                   0.06,
    'adrenaline':                    0.07,
    'training':                      0.05,
  },

  psychologicalDepth: {
    // AniList (lowercased)
    'psychological':                 0.10,
    'mind games':                    0.10,
    'philosophy':                    0.08,
    'unreliable narrator':           0.09,
    'memory manipulation':           0.08,
    'multiple personalities':        0.07,
    'reality vs fantasy':            0.08,
    'existentialism':                0.08,
    // AniDB additions
    'existential crisis':            0.09,
    'psychological thriller':        0.10,
    'hallucinations':                0.08,
    'dissociation':                  0.08,
    'mental illness':                0.07,
    'manipulation':                  0.07,
    'mind control':                  0.07,
    'conspiracy':                    0.06,
  },

  worldbuilding: {
    // AniList (lowercased)
    'world building':                0.10,
    'magic system':                  0.08,
    'mythology':                     0.07,
    'political intrigue':            0.09,
    'military':                      0.05,
    'alternate universe':            0.06,
    'lore':                          0.07,
    // AniDB additions
    'magic':                         0.07,
    'sci-fi':                        0.06,
    'science fiction':               0.06,
    'space':                         0.06,
    'space travel':                  0.06,
    'future':                        0.06,
    'alternate history':             0.07,
    'post-apocalyptic':              0.07,
    'fantasy world':                 0.07,
    'other planet':                  0.06,
    'empire':                        0.06,
    'war':                           0.05,
    'kingdom':                       0.05,
  },

  characterDrama: {
    // AniList (lowercased)
    'character study':               0.10,
    'found family':                  0.09,
    'rivalry':                       0.09,
    'betrayal':                      0.10,
    'family dynamics':               0.08,
    'ensemble cast':                 0.07,
    'redemption':                    0.07,
    'bromance':                      0.06,
    // AniDB additions
    'character development':         0.10,
    'coming of age':                 0.08,
    'mentor':                        0.07,
    'friendship':                    0.06,
    'teamwork':                      0.06,
    'revenge':                       0.07,
    'sibling relationship':          0.07,
    'parent-child relationship':     0.07,
    'found family':                  0.09,
  },

  moralComplexity: {
    // AniList (lowercased)
    'moral dilemmas':                0.10,
    'anti-hero':                     0.09,
    'villain protagonist':           0.10,
    'nihilism':                      0.09,
    'corruption':                    0.08,
    'gray morality':                 0.10,
    'revenge':                       0.06,
    'ethics':                        0.07,
    // AniDB additions
    'moral dilemma':                 0.10,
    'philosophical':                 0.08,
    'ambiguous ending':              0.07,
    'morally complex':               0.09,
    'anti-villain':                  0.08,
    'war crimes':                    0.07,
    'justice':                       0.06,
    'power struggle':                0.07,
    'protagonist with dark past':    0.07,
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

// All tag names lowercase — matches both AniList (lowercased in tagMap) and AniDB (natively lowercase).
const TONE_DEFS = {
  dark: {
    tags:   ['tragedy', 'dark fantasy', 'horror', 'despair', 'dystopia', 'gore',
             'death game', 'nihilism', 'psychological abuse', 'depression',
             // AniDB
             'dark themes', 'dark', 'suicide', 'abuse', 'post-apocalyptic', 'grief'],
    genres: ['Horror', 'Psychological'],
    min: 0.40,
  },
  emotional: {
    tags:   ['tearjerker', 'coming of age', 'grief', 'heartwarming',
             'family dynamics', 'redemption', 'bittersweet',
             // AniDB
             'emotional', 'melancholic', 'loss', 'sacrifice', 'loneliness', 'nostalgia'],
    genres: ['Drama'],
    min: 0.40,
  },
  wholesome: {
    tags:   ['heartwarming', 'iyashikei', 'healing', 'cgdct', 'friendship', 'cute',
             // AniDB
             'daily life', 'school life', 'calm', 'hope'],
    genres: ['Slice of Life'],
    min: 0.40,
  },
  hype: {
    tags:   ['tournament', 'super power', 'adrenaline rush', 'power fantasy',
             'overpowered main characters', 'battle', 'mecha',
             // AniDB
             'action', 'battles', 'power system', 'fighting', 'competition', 'adrenaline'],
    genres: ['Action', 'Sports'],
    min: 0.35,
  },
  suspenseful: {
    tags:   ['thriller', 'mystery', 'conspiracy', 'survival', 'death game',
             'hidden identity', 'assassination',
             // AniDB
             'suspense', 'mind games', 'plot twist', 'detective'],
    genres: ['Mystery', 'Thriller'],
    min: 0.35,
  },
  relaxing: {
    tags:   ['iyashikei', 'daily life', 'healing', 'cgdct', 'school life', 'moe',
             // AniDB
             'slice of life', 'calm', 'rural setting'],
    genres: ['Slice of Life'],
    min: 0.35,
  },
  inspirational: {
    tags:   ['underdog', 'self-discovery', 'redemption', 'overcoming adversity',
             'coming of age', 'training',
             // AniDB
             'sports', 'teamwork', 'character development', 'hope'],
    genres: ['Sports'],
    min: 0.30,
  },
  comedic: {
    tags:   ['gag humor', 'parody', 'slapstick', 'absurdist', 'black comedy',
             'comedic relief', 'tsukkomi',
             // AniDB
             'comedy', 'physical comedy', 'dark humor', 'action comedy', 'satire', 'dark comedy'],
    genres: ['Comedy'],
    min: 0.30,
  },
  intense: {
    tags:   ['violence', 'psychological', 'survival', 'war', 'assassination', 'gore',
             // AniDB
             'intense violence', 'combat', 'gunfights', 'swordplay', 'martial arts'],
    genres: ['Action', 'Thriller'],
    min: 0.30,
  },
  philosophical: {
    tags:   ['philosophy', 'existentialism', 'nihilism', 'mind games', 'ethics',
             'unreliable narrator',
             // AniDB
             'philosophical', 'existential crisis', 'moral dilemma', 'psychological'],
    genres: ['Psychological'],
    min: 0.30,
  },
  romantic: {
    tags:   ['romance', 'love triangle', 'unrequited love', 'first love',
             'childhood friend romance', 'forbidden love', 'arranged marriage',
             'breakup', 'school romance',
             // AniDB
             'slow romance', 'one-sided love', 'romantic comedy', 'love interest'],
    genres: ['Romance'],
    min: 0.35,
  },
};

const VISUAL_DEFS = {
  cinematic: {
    studios: ['ufotable', 'mappa', 'wit studio', 'bones', 'kyoto animation',
              'production i.g', 'madhouse', 'cloverworks', 'a-1 pictures'],
    tags:    ['cinematography', 'beautiful scenery', 'fluid animation', 'sakuga',
              'detailed background art', 'animation', 'artistic'],
    min: 0.20,
  },
  retro: {
    yearBefore: 2004,
    tags:       ['classic', '80s', '90s', 'retro', 'old school'],
    min: 0,
  },
  colorful: {
    tags:    ['magical girl', 'cgdct', 'colorful', 'cute', 'vibrant', 'moe'],
    genres:  ['Mahou Shoujo', 'Fantasy'],
    min: 0.40,
  },
  gritty: {
    tags:    ['gritty', 'post-apocalyptic', 'gore', 'violence', 'dark fantasy', 'dystopia',
              'dark themes', 'intense violence'],
    genres:  ['Horror'],
    min: 0.35,
  },
  modern: {
    yearAfter: 2016,
    studios:   ['mappa', 'ufotable', 'cloverworks', 'wit studio'],
    tags:      ['cg animation'],
    min: 0,
  },
};

// All tag names lowercase. Threshold in extractFeatures is tagRank >= 50 (AniList) or
// normalized score >= 50 — same check, both scales produce comparable values after merge.
const ARCHETYPE_DEFS = {
  antihero:     ['anti-hero', 'villain protagonist', 'dark hero', 'morally ambiguous protagonist',
                 // AniDB
                 'anti-villain', 'protagonist with dark past'],
  overpowered:  ['overpowered main characters', 'power fantasy', 'isekai', 'cheat ability',
                 // AniDB
                 'reincarnation', 'summoned to another world', 'power system'],
  morallyGray:  ['gray morality', 'moral dilemmas', 'anti-hero', 'nihilism', 'villain protagonist',
                 // AniDB
                 'moral dilemma', 'morally complex', 'philosophical'],
  underdog:     ['underdog', 'weak to strong', 'coming of age', 'overcoming adversity', 'training',
                 // AniDB
                 'character development', 'self-improvement'],
  strongFemale: ['strong female lead', 'female protagonist', 'kuudere', 'tsundere',
                 // AniDB
                 'villainess', 'independent female lead'],
  foundFamily:  ['found family', 'ensemble cast', 'teamwork', 'brotherhood', 'friendship',
                 // AniDB
                 'bonds', 'camaraderie', 'found family'],
  rivalry:      ['rival', 'competition', 'tournament', 'rivalry',
                 // AniDB
                 'rivals', 'competing teams'],
  villain:      ['villain protagonist', 'antagonist focus',
                 // AniDB
                 'villain', 'antagonist'],
  chaotic:      ['ensemble cast', 'eccentric characters', 'multiple protagonists',
                 // AniDB
                 'comedic ensemble', 'unpredictable'],
  // New archetypes from AniDB character tag vocabulary
  tsundere:     ['tsundere'],
  yandere:      ['yandere'],
  harem:        ['harem', 'reverse harem'],
  isekai:       ['isekai', 'reincarnation', 'summoned to another world', 'transported to another world'],
  mentor:       ['mentor', 'teacher-student relationship', 'master-student'],
};

/**
 * EMOTIONAL EXPERIENCE BUCKETS
 * Higher-level layer above raw genres/tags. Each bucket describes the
 * emotional experience an anime delivers, not just what it's about.
 * Scored from tone keys, archetype keys, and scalar dimensions.
 * Exposed as `bucket:X` feature keys tracked in engine.vectors.emotionalBucket.
 *
 * Design rule: buckets must be orthogonal — minimal overlap so the engine
 * can cleanly distinguish taste lanes rather than have everything score high.
 */
const EMOTIONAL_BUCKET_DEFS = {

  // Moral ambiguity, psychological darkness, nihilism, complex villains
  dark_complexity: {
    label:      'dark moral complexity',
    tones:      ['dark', 'philosophical', 'intense'],
    archetypes: ['antihero', 'morallyGray', 'villain'],
    scalars:    { darkness: 0.35, moralComplexity: 0.40, psychologicalDepth: 0.25 },
    antiDims:   { humor: 4.5 }, // high comedy (action-comedies, parody) ≠ dark moral complexity
  },

  // Healing, iyashikei, gentle slice of life, zero stakes warmth
  cozy_comfort: {
    label:      'cozy comfort',
    tones:      ['wholesome', 'relaxing'],
    archetypes: [],
    scalars:    { pacing: 0.45, emotionalWeight: 0.15 },
    antiDims:   { darkness: 2.5, hype: 3.0 }, // darkness or high action kills cozy
  },

  // High-octane battles, power systems, tournaments, adrenaline
  hype_energy: {
    label:      'hype battle energy',
    tones:      ['hype', 'intense'],
    archetypes: ['overpowered', 'rivalry', 'underdog'],
    scalars:    { hype: 0.55, violence: 0.20, worldbuilding: 0.15 },
    antiDims:   { pacing: 7.0 }, // slow-paced anime can't be hype
  },

  // Tearjerker drama, romance, coming-of-age, bittersweet emotional journeys
  emotional_depth: {
    label:      'emotional depth and drama',
    tones:      ['emotional', 'inspirational'],
    archetypes: ['underdog'],
    scalars:    { emotionalWeight: 0.45, romance: 0.25, characterDrama: 0.20 },
    antiDims:   { darkness: 5.0 }, // deep darkness = dark_complexity, not emotional_depth
  },

  // Psychological thriller, unreliable narrators, existential mind benders
  mind_games: {
    label:      'psychological mind games',
    tones:      ['philosophical', 'suspenseful'],
    archetypes: [],
    scalars:    { psychologicalDepth: 0.50, moralComplexity: 0.25, darkness: 0.15 },
    antiDims:   { hype: 4.5 }, // action-heavy anime ≠ mind games
  },

  // Found family bonds, teamwork, ensemble warmth, belonging
  found_family: {
    label:      'found family warmth',
    tones:      ['wholesome', 'inspirational'],
    archetypes: ['foundFamily', 'chaotic'],
    scalars:    { characterDrama: 0.45, humor: 0.15, worldbuilding: 0.15 },
    antiDims:   { darkness: 4.5 },
  },

  // Surreal, avant-garde, late-night strangeness, niche experimental
  weird_niche: {
    label:      'weird niche atmosphere',
    tones:      ['comedic', 'philosophical'],
    archetypes: ['chaotic'],
    scalars:    { niche: 0.50, humor: 0.20, psychologicalDepth: 0.15 },
  },

  // Visually stunning, atmospheric slow burn, art-driven storytelling
  cinematic: {
    label:      'cinematic atmosphere',
    tones:      ['relaxing', 'suspenseful'],
    archetypes: [],
    scalars:    { worldbuilding: 0.30, pacing: 0.30, emotionalWeight: 0.20 },
    visualMatch: 'cinematic',
    antiDims:   { hype: 5.5 },
  },
};


/* ═══════════════════════════════════════════════════════════════════════════
   FEATURE EXTRACTION
═══════════════════════════════════════════════════════════════════════════ */

function extractFeatures(anime) {
  const genres = anime.genres || [];
  const tags   = anime.tags   || [];
  const year   = anime.startDate?.year || null;

  // Normalize all tag names to lowercase so they match both:
  //   • Current AniList API tags (Title Case → lowercased here)
  //   • Future merged Firebase tags (already lowercase from AniDB UDP API)
  const tagMap = {};
  for (const t of tags) {
    const key = t.name.toLowerCase();
    tagMap[key] = Math.max(tagMap[key] || 0, t.rank || 0);
  }

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

  // Episode appetite: log-normalised count → 0–10
  // 1 ep→0.0  12 eps→4.9  24 eps→6.3  50 eps→7.8  150+ eps→10.0
  const epsCount       = Math.max(1, anime.episodes || 12);
  const episodeAppetite = Math.min(10, (Math.log(epsCount) / Math.log(150)) * 10);

  // Format preference: numeric score representing the format of the show.
  // Learnable — users who prefer movies will see formatPreference converge toward 8–9.
  // TV=6  Movie=9  OVA=4  ONA=3  Special=2  default=5
  const _fmt = (anime.format || '').toUpperCase();
  const formatScore =
    _fmt === 'TV'      ? 6.0 :
    _fmt === 'MOVIE'   ? 9.0 :
    _fmt === 'OVA'     ? 4.0 :
    _fmt === 'ONA'     ? 3.0 :
    _fmt === 'SPECIAL' ? 2.0 : 5.0;

  // Source preference: numeric score for the type of source material.
  // Original anime score highest (purely creative vision); game/VN adaptations lowest
  // (typically compressed from very long source, pacing issues).
  const _src = (anime.source || '').toUpperCase().replace(/ /g, '_');
  const sourceScore =
    _src === 'ORIGINAL'      ? 9.0 :
    _src === 'LIGHT_NOVEL'   ? 7.0 :
    _src === 'NOVEL'         ? 7.5 :
    _src === 'MANGA'         ? 6.0 :
    _src === 'MANHWA'        ? 5.5 :
    _src === 'MANHUA'        ? 5.0 :
    _src === 'GAME'          ? 4.0 :
    _src === 'VISUAL_NOVEL'  ? 3.5 :
    _src === 'DOUJINSHI'     ? 3.0 : 5.0;

  // Era preference: how modern/classic the anime is on a 0–10 scale.
  // 2020s→9  2010s→7.5  2000s→5.5  1990s→3.5  pre-1990→1.5
  const _yr = year || 2010;
  const eraScore =
    _yr >= 2020 ? 9.0 :
    _yr >= 2010 ? 7.5 :
    _yr >= 2000 ? 5.5 :
    _yr >= 1990 ? 3.5 : 1.5;

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
    episodeAppetite,
    formatPreference:   formatScore,
    sourcePreference:   sourceScore,
    eraPreference:      eraScore,
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

  // ── Emotional bucket keys ───────────────────────────────────────────────
  // Higher-level experience layer. Scored from tone/archetype/scalar signals.
  // Anti-dims apply a 0.30× penalty if a conflicting scalar is too high,
  // keeping buckets orthogonal (e.g. high darkness suppresses cozy_comfort).
  const bucketKeys = [];
  for (const [bucket, def] of Object.entries(EMOTIONAL_BUCKET_DEFS)) {
    let score = 0;
    for (const tone of def.tones) {
      if (toneKeys.includes(`tone:${tone}`)) score += 2.5;
    }
    for (const arch of (def.archetypes || [])) {
      if (archetypeKeys.includes(`archetype:${arch}`)) score += 1.5;
    }
    for (const [dim, w] of Object.entries(def.scalars || {})) {
      score += (scalars[dim] || 0) * w;
    }
    if (def.visualMatch && visualKeys.includes(`visual:${def.visualMatch}`)) score += 2.0;
    let penalty = 1.0;
    for (const [dim, ceiling] of Object.entries(def.antiDims || {})) {
      if ((scalars[dim] || 0) > ceiling) { penalty = 0.30; break; }
    }
    if (score * penalty >= 1.5) bucketKeys.push(`bucket:${bucket}`);
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
            tag: tagKeys, genre: genreKeys, studio: studioKeys,
            emotionalBucket: bucketKeys },
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
    // Log-normalised episode count (0–10 scale; 12 eps ≈ 4.9, 50 eps ≈ 7.8, 150+ ≈ 10)
    episodeAppetite:    { preferred: 4.9, tolerance: 7.8,  confidence: 0, kind: 'tolerance' },
    // Format: TV=6 Movie=9 OVA=4 ONA=3 Special=2 — learned from swipe patterns
    formatPreference:   { preferred: 6.0, tolerance: 8.5,  confidence: 0, kind: 'tolerance' },
    // Source material: Original=9 LightNovel=7 Manga=6 Game=4 VisualNovel=3.5
    sourcePreference:   { preferred: 5.0, tolerance: 9.0,  confidence: 0, kind: 'appetite' },
    // Era: 2020s=9 2010s=7.5 2000s=5.5 1990s=3.5 pre-1990=1.5
    eraPreference:      { preferred: 7.0, tolerance: 9.0,  confidence: 0, kind: 'tolerance' },
  };
}

/** Default empty 7-group vector set (6 original + emotionalBucket layer). */
function defaultVectors() {
  return { tone: {}, archetype: {}, visual: {}, tag: {}, genre: {}, studio: {}, emotionalBucket: {} };
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
    this.recentFeatures   = [];   // last 20 shown feature profiles (larger window = better diversity tracking)
    this.recentClusterIds = [];   // last 6 cluster IDs served (for cross-cluster rotation)
    this.MAX_RECENT       = 20;   // was 10 — wider window so bucket diversity sees full batch history
    this.MAX_RECENT_CL    = 6;

    this.onboarded      = false;
    this.totalSwipes    = 0;
    this.firstBatchDone = false; // skip boundary probes on the very first post-onboarding batch

    /**
     * SIGNAL PROFILE — learned user preference vector over the 20 AI signal dimensions.
     * Populated async as the user likes/dislikes anime; persisted to localStorage.
     * signalProfile[key] ∈ [0,1]: how much of this signal the user prefers.
     * signalCount: accumulated weight (grows with each learned swipe).
     */
    this.signalProfile = {};
    this.signalCount   = 0;

    /**
     * Liked ID → title map — so fetchFirestoreSimilar can surface
     * "Because you liked [title]" explanation chips on rec cards.
     */
    this.likedIdToTitle = new Map();

    /** Relation-aware scoring — IDs of positively-rated anime (like/watch/superlike).
     *  Used to boost sequels, prequels, and side stories of shows the user loved. */
    this.likedIds = new Set();

    /**
     * Superliked anime IDs — used to apply 5× weight boost in fetchFirestoreSimilar
     * so the most loved shows dominate the similarity merge pool.
     */
    this.superlikedIds = new Set();

    /**
     * Disliked anime IDs — used to trigger similarity pre-fetch so we can build
     * an exclusion set of shows that share DNA with ones the user rejected.
     */
    this.dislikedIds = new Set();
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
    // Dislike signal boosted: -3.0 post-onboarding (was -2.0).
    // One dislike of a dark anime drops tone:dark from cap (4.0) to 1.0,
    // making a real dent instead of being cancelled by the next like.
    const catDelta = isSuperLike ?  5.0
                   : isWatch     ?  3.5
                   : isPositive  ? (this.onboarded ?  2.0 :  3.0)
                   :               (this.onboarded ? -3.0 : -4.0);

    // Cap individual vector components so that a handful of early strong-signal
    // swipes (e.g. several dark-anime likes during onboarding) cannot permanently
    // dominate the cosine similarity calculation.  Relative preference is preserved;
    // we're only preventing runaway dominance by a single tone/tag/bucket.
    const vecCap = this.onboarded ? 4.0 : 6.0;
    for (const [group, keys] of Object.entries(features.keys)) {
      for (const key of keys) {
        const prev = this.vectors[group][key] || 0;
        this.vectors[group][key] = Math.max(-vecCap, Math.min(vecCap, prev + catDelta));
      }
    }

    // ── Global scalar update ───────────────────────────────────────────
    if (isPositive) {
      this._absorbPositive(this.dims, features.scalars, isWatch || isSuperLike, isSuperLike);
    } else {
      this._absorbNegative(this.dims, features.scalars, isDislike);
    }

    // ── Cluster update (positive signals only) ─────────────────────────
    if (isPositive) {
      const signal = isSuperLike ? 5.0 : isWatch ? 3.5 : (this.onboarded ? 2.0 : 3.0);
      this._absorbIntoCluster(features, signal, isSuperLike);
      // Track liked IDs for relation-aware scoring and "Because you liked X" chips
      if (anime.id) {
        this.likedIds.add(anime.id);
        const title = anime.title?.english || anime.title?.romaji || '';
        if (title) this.likedIdToTitle.set(anime.id, title);
        if (isSuperLike) this.superlikedIds.add(anime.id);
      }
    } else if (isDislike && anime.id) {
      this.dislikedIds.add(anime.id);
    }

    // ── Boundary test resolution ───────────────────────────────────────
    if (this.pendingTests.has(anime.id)) {
      const { dimension, testLevel } = this.pendingTests.get(anime.id);
      this._processBoundaryResult(dimension, testLevel, isPositive, isDislike, isSuperLike);
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
  /**
   * @param {object[]} candidates   — raw anime objects from AniList
   * @param {Array|Set} seenIds     — anime IDs to exclude
   * @param {Function|null} signalLookup — optional: (animeId) → signal doc | null
   *   When provided, blends the user's learned signal preferences into scoring.
   *   Signal affinity adds up to 8% to total score — a meaningful tie-breaker
   *   within similarly-ranked candidates without reversing confident matches.
   */
  rankRecommendations(candidates, seenIds = [], signalLookup = null) {
    const excluded = seenIds instanceof Set ? seenIds : new Set(seenIds);
    const pool = candidates.filter(a => !excluded.has(a.id));
    if (pool.length === 0) return [];

    const profiles     = pool.map(anime => ({ anime, features: extractFeatures(anime) }));

    // Build trending map from candidate data (field added to _REC_FIELDS at no extra cost).
    // Used only inside _findWildcards to bias exploration toward currently-buzzing titles.
    const trendingMap = new Map();
    for (const anime of pool) {
      if (anime.trending) trendingMap.set(anime.id, anime.trending);
    }

    const activeClusters = this.onboarded ? this._getActiveClusters() : [];
    const multiCluster   = activeClusters.length >= 2;

    // ── Score every candidate ─────────────────────────────────────────
    const topClusterScore = multiCluster ? activeClusters[0].recencyScore : 1;

    // Signal affinity is non-zero only when we have a learned profile AND a lookup fn
    const hasSignalProfile = signalLookup && Object.keys(this.signalProfile).length >= 5;

    const scored = profiles.map(p => {
      const globalScore = this._scoreAgainstProfile(p.features, this.vectors, this.dims);

      // Quality multiplier: meaningful boost for well-rated anime.
      // Range: score=100 → ×1.0, score=80 → ×0.93, score=60 → ×0.86, score=40 → ×0.79
      // Spread: 21% gap between best and worst rated. Unrated → ×1.0 (no penalty).
      const avgScore    = p.anime.averageScore || 0;
      const qualityMult = avgScore > 0 ? 0.65 + 0.35 * (avgScore / 100) : 1.0;

      // Signal affinity: adds up to 0.08 to total score.
      // Meaningful within similarly-scored groups without reversing dominant matches.
      const signalBonus = hasSignalProfile
        ? this.computeSignalAffinity(signalLookup(p.anime.id)) * 0.12
        : 0;

      if (!multiCluster) {
        return { ...p, score: globalScore * qualityMult + signalBonus, clusterId: -1 };
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
      return { ...p, score: blended * qualityMult + signalBonus, clusterId: bestClusterId };
    });

    // ── Apply cluster-rotation penalty ────────────────────────────────
    // Prevent the engine from endlessly serving the same cluster
    if (multiCluster && this.recentClusterIds.length > 0) {
      const overservedId = this._mostOverservedClusterId();
      for (const p of scored) {
        if (p.clusterId === overservedId) {
          p.score -= 0.28; // was 0.12 — harder dampen to break filter-bubble loop
        }
      }
    }

    // Re-sort after rotation penalty
    scored.sort((a, b) => b.score - a.score);

    // ── Relation-aware boost ──────────────────────────────────────────
    // If the user has positively rated an anime, nudge its sequels, prequels,
    // and parent stories upward. This surfaces "next in series" picks naturally
    // without forcing sequel marathons. Boost is moderate (0.12) so a weak
    // match still won't rank above a strong unrelated pick.
    if (this.likedIds.size > 0) {
      const RELATION_TYPES = new Set(['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY']);
      for (const p of scored) {
        const edges = p.anime.relations?.edges || [];
        const hasLikedRelative = edges.some(edge =>
          edge.node?.type === 'ANIME' &&
          RELATION_TYPES.has(edge.relationType) &&
          this.likedIds.has(edge.node.id)
        );
        if (hasLikedRelative) p.score += 0.12;
      }
      // Re-sort once more after relation boost
      scored.sort((a, b) => b.score - a.score);
    }

    // ── Boundary probe ────────────────────────────────────────────────
    const boundaryDim        = this.onboarded ? this._pickBoundaryDim() : null;
    const boundaryCandidates = boundaryDim
      ? this._findBoundaryCandidates(profiles, boundaryDim)
      : [];

    // ── Wildcards ─────────────────────────────────────────────────────
    const wildcardCandidates = this._findWildcards(scored, trendingMap);

    // ── Allocate slots ────────────────────────────────────────────────
    // Strong 57% · Diversity 15–20% · Boundary 15% · Fresh 8% · Wildcards 3%
    //
    // Diversity slot actively seeds underrepresented emotional buckets using
    // anime quality (averageScore), NOT taste score.  This is the core fix for
    // single-cluster pigeon-holing: even if the entire taste profile is dark,
    // the engine still serves high-quality comedy/slice-of-life/hype picks to
    // give those taste lanes a chance to form new clusters.
    //
    // When only 1 cluster exists the diversity slot grows to 20% — more
    // aggressive exploration to bootstrap cluster variety faster.
    const total               = Math.min(pool.length, 30);
    const hasMultipleClusters = activeClusters.length >= 2;
    const nDiversity = this.onboarded
      ? Math.max(1, Math.round(total * (hasMultipleClusters ? 0.15 : 0.20)))
      : 0;
    // Skip boundary probes on the very first post-onboarding batch so the user's
    // first impression is their strongest taste matches, not edge-of-tolerance probes.
    const isFirstBatch = this.onboarded && !this.firstBatchDone;
    if (isFirstBatch) this.firstBatchDone = true;
    const nBoundary  = (this.onboarded && !isFirstBatch) ? Math.max(1, Math.round(total * 0.15)) : 0;
    const nFresh     = this.onboarded ? Math.max(1, Math.round(total * 0.08)) : 0;
    const nWild      = Math.max(1, Math.round(total * 0.03));
    const nStrong    = total - nDiversity - nBoundary - nFresh - nWild;

    // Median score threshold — fresh picks must clear this to be taste-relevant
    const allScores      = scored.map(p => p.score).sort((a, b) => a - b);
    const medianScore    = allScores[Math.floor(allScores.length / 2)] || 0;
    const freshCandidates     = this.onboarded ? this._findFreshPicks(scored, medianScore)    : [];
    const diversityCandidates = this.onboarded ? this._findBucketDiversityPicks(profiles)     : [];

    const usedIds = new Set();

    // ── Fill diversity FIRST ──────────────────────────────────────────────────
    // Bucket coverage guarantee only holds if diversity candidates are claimed
    // before boundary/wild/fresh can consume the best per-bucket candidate.
    const diversity = [];
    for (const p of diversityCandidates) {
      if (diversity.length >= nDiversity) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        diversity.push({ ...p.anime, _meta: { type: 'diversity' } });
      }
    }

    // ── Then boundary ─────────────────────────────────────────────────────────
    const boundary = [];
    for (const p of boundaryCandidates) {
      if (boundary.length >= nBoundary) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        const testLevel = p.features.scalars[boundaryDim];
        this.pendingTests.set(p.anime.id, { dimension: boundaryDim, testLevel });
        boundary.push({ ...p.anime, _meta: { type: 'boundary', dimension: boundaryDim, testLevel } });
      }
    }

    // ── Then wild ─────────────────────────────────────────────────────────────
    const wild = [];
    for (const p of wildcardCandidates) {
      if (wild.length >= nWild) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        wild.push({ ...p.anime, _meta: { type: 'wildcard' } });
      }
    }

    // ── Then fresh ────────────────────────────────────────────────────────────
    const fresh = [];
    for (const p of freshCandidates) {
      if (fresh.length >= nFresh) break;
      if (!usedIds.has(p.anime.id)) {
        usedIds.add(p.anime.id);
        fresh.push({ ...p.anime, _meta: { type: 'fresh' } });
      }
    }

    // Strong picks — distributed across clusters when multi-cluster mode is active
    const strongPool = scored.filter(p => !usedIds.has(p.anime.id));
    const strong = multiCluster
      ? this._pickAcrossClusters(strongPool, activeClusters, nStrong, usedIds)
      : this._pickWithAntiRep(strongPool, nStrong, usedIds);

    // Interleave, then cap any single bucket at 25% of the batch
    return this._enforceBucketDiversity(this._interleave(strong, boundary, wild, fresh, diversity));
  }


  /* ════════════════════════════════════════════════════════════════════
     SIGNAL PROFILE — learned preference over 20 AI signal dimensions
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Update the running signal preference profile from a swipe event.
   * Called asynchronously from learnSignals() in index.html after a Firestore fetch.
   *
   * @param {object} signals   — Firestore anime_signals doc data
   * @param {number} weight    — swipe weight: +2.5 superlike, +1.0 like, -0.5 dislike
   */
  updateSignalProfile(signals, weight) {
    // Quality multiplier: ai_extracted (reviews) 1.0 > desc_extracted 0.7 > imputed 0.5
    const qualityMult = signals.signal_quality === 'ai_extracted'   ? 1.0
                      : signals.signal_quality === 'desc_extracted'  ? 0.7
                      : 0.5;
    const effectiveW  = weight * qualityMult;
    if (effectiveW === 0) return;

    const newCount = this.signalCount + Math.abs(effectiveW);

    for (const key of SIGNAL_KEYS) {
      let val = signals[key];
      if (val === undefined || val === null) continue;

      // For dislikes: learn the opposite preference (move away from this anime's vibe)
      if (effectiveW < 0) val = 1.0 - val;

      if (this.signalProfile[key] === undefined) {
        // First observation — seed directly
        this.signalProfile[key] = val;
      } else {
        // Weighted running mean: lerp toward new value proportionally to its weight
        const alpha = Math.abs(effectiveW) / newCount;
        this.signalProfile[key] = this.signalProfile[key] * (1 - alpha) + val * alpha;
      }
    }

    this.signalCount = newCount;
  }

  /**
   * How well does an anime's signal vector match the user's learned preferences?
   * Returns 0–1: 1.0 = perfect match, 0.0 = complete opposite.
   * Uses a gaussian kernel so only signals with small preference distance score high.
   *
   * @param {object|null} signals — Firestore anime_signals doc, or null if not cached
   */
  computeSignalAffinity(signals) {
    if (!signals) return 0;
    const profileKeys = Object.keys(this.signalProfile);
    if (profileKeys.length < 3) return 0;   // need some data before it's meaningful

    // ── Average score (baseline: how well candidate matches across ALL signals) ──
    let avgScore = 0, avgCount = 0;
    for (const key of profileKeys) {
      const val = signals[key];
      if (val === undefined || val === null) continue;
      const dist = Math.abs(this.signalProfile[key] - val);
      avgScore += Math.exp(-dist * dist * 8);
      avgCount++;
    }
    avgScore = avgCount > 0 ? avgScore / avgCount : 0;

    // ── Compound score (precision: geometric mean of DISTINCTIVE signal matches) ──
    // "Distinctive" = the user has a clear preference on this dimension,
    // i.e., their learned value has drifted >0.12 away from neutral (0.5).
    // Using only these dimensions sharpens discrimination dramatically:
    // a horror fan who scored 0.0 on darkness will ruthlessly penalise cozy anime.
    const distinctive = profileKeys
      .map(key => ({ key, deviation: Math.abs(this.signalProfile[key] - 0.5) }))
      .filter(({ deviation }) => deviation > 0.12)
      .sort((a, b) => b.deviation - a.deviation)
      .slice(0, 4);

    let compoundScore = avgScore;   // fall back to average if no distinctive dims yet
    if (distinctive.length >= 2) {
      let logSum = 0, cCount = 0;
      for (const { key } of distinctive) {
        const val = signals[key];
        if (val === undefined || val === null) continue;
        const dist = Math.abs(this.signalProfile[key] - val);
        // Use log-space to compute geometric mean safely
        logSum += Math.log(Math.exp(-dist * dist * 8) + 1e-9);
        cCount++;
      }
      if (cCount > 0) {
        compoundScore = Math.exp(logSum / cCount);
      }
    }

    // Blend: compound is sharper but less robust with few data points;
    // average is more stable. Lean 65% compound once we have enough signal.
    const compoundWeight = Math.min(0.65, distinctive.length * 0.20);
    return compoundScore * compoundWeight + avgScore * (1 - compoundWeight);
  }


  /* ════════════════════════════════════════════════════════════════════
     CLUSTER MANAGEMENT
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Assign a liked/watched anime to an existing cluster or create a new one.
   * This is the engine of taste-lane detection.
   */
  _absorbIntoCluster(features, signal, isSuperLike = false) {
    let bestCluster = null;
    let bestSim     = -1;

    for (const cluster of this.clusters) {
      const sim = this._clusterSimilarity(features, cluster);
      if (sim > bestSim) { bestSim = sim; bestCluster = cluster; }
    }

    // Superlike uses a lower join threshold — commit to an existing cluster
    // more aggressively so the strong preference reinforces the right lane.
    const threshold = isSuperLike ? 0.42 : this.CLUSTER_JOIN_THRESHOLD;

    if (bestCluster && bestSim >= threshold) {
      this._updateCluster(bestCluster, features, signal, isSuperLike);
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

  _updateCluster(cluster, features, signal, isSuperLike = false) {
    // Update scalar profile — thread isSuperLike for higher learning rate
    this._absorbPositive(cluster.dims, features.scalars, false, isSuperLike);

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
    // Superlike counts as 2 swipes worth of evidence — boosts cluster weight
    // and recency score so this lane surfaces more reliably in recommendations.
    cluster.count   += isSuperLike ? 2 : 1;
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
    if (max < 2) return -1; // penalise once same cluster fills 2+ of last 6 slots
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
    // Neutral floor lowered 0.30 → 0.15 so positive matches stand out more
    // and negative signals (disliked features) zero out similarity faster.
    return Math.max(0, Math.min(1, raw * 0.85 + 0.15));
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

  _processBoundaryResult(dimension, testLevel, liked, isDislike = false, isSuperLike = false) {
    const p = this.dims[dimension];
    this.dimTestCounts[dimension]++;

    // Superlike at a boundary = strong "yes, push further" signal.
    // Halve the cooldown so the engine re-probes sooner, and expand tolerance
    // more aggressively (1.2 vs 0.5) to match the strength of the preference.
    this.dimCooldowns[dimension] = isSuperLike ? 2 : 4;

    if (liked) {
      p.tolerance = Math.min(10, testLevel + (isSuperLike ? 1.2 : 0.5));
      p.preferred = p.preferred * 0.88 + testLevel * 0.12;
    } else if (isDislike) {
      p.tolerance = Math.max(p.preferred - 0.5, p.tolerance - 1.8);
      p.preferred = Math.max(0, p.preferred - 0.5);
    } else {
      p.tolerance = Math.max(p.preferred, p.tolerance - 0.5);
    }

    // Superlike resolves boundary ambiguity faster: 0.20 confidence gain vs 0.12.
    p.confidence = Math.min(1, p.confidence + (isSuperLike ? 0.20 : 0.12));
  }


  /* ════════════════════════════════════════════════════════════════════
     WILDCARDS
     ════════════════════════════════════════════════════════════════════ */

  _findWildcards(strongScored, trendingMap = new Map()) {
    const cutoff = Math.floor(strongScored.length * 0.70);
    const pool   = strongScored.slice(cutoff);

    // No trending data — pure random as before
    if (trendingMap.size === 0) return pool.sort(() => Math.random() - 0.5);

    // Normalise trending scores within this pool so relative buzz matters,
    // not absolute numbers (AniList trending values vary wildly in magnitude).
    const scores  = pool.map(p => trendingMap.get(p.anime.id) || 0);
    const maxTrend = Math.max(...scores, 1);

    // 65% random + 35% trending bias.
    // Keeps wildcards genuinely exploratory while nudging toward titles that
    // are currently buzzing — if the taste fit is low either way, a trending
    // show is more likely to feel rewarding than a random obscurity.
    return pool
      .map((p, i) => ({
        ...p,
        _wScore: Math.random() * 0.65 + (scores[i] / maxTrend) * 0.35,
      }))
      .sort((a, b) => b._wScore - a._wScore);
  }


  /* ════════════════════════════════════════════════════════════════════
     FRESH PICKS
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Find recent anime (last ~2 years / ~8 seasons) that score above
   * the median taste threshold.
   *
   * Design rules:
   *  - Recency window: startDate.year >= currentYear - 1
   *    Covers the last 8 seasons — broad enough to include full cours and
   *    split-cour continuations, narrow enough to feel genuinely "new".
   *  - Minimum popularity: 1000 — filters titles with too few tags/reviews
   *    for the feature extraction to produce reliable scores.
   *  - Minimum score: medianScore — ensures the fresh pick is actually a
   *    good taste match, not just new.  Without this floor a terrible-fit
   *    recent show could crowd out a great older one.
   *
   * These get 10% of the batch with a dedicated interleave slot (every 8th
   * strong card) so the user sees taste-matched current content without
   * the main strong-pick quality being degraded.
   */
  _findFreshPicks(scoredProfiles, medianScore) {
    const currentYear = new Date().getFullYear();
    const cutoffYear  = currentYear - 1;  // last ~2 years
    const MIN_POP     = 1000;             // floor for data reliability

    return scoredProfiles
      .filter(p => {
        const year = p.anime.startDate?.year;
        const pop  = p.anime.popularity || 0;
        return year >= cutoffYear && pop >= MIN_POP && p.score >= medianScore;
      })
      .sort((a, b) => b.score - a.score);
  }


  /* ════════════════════════════════════════════════════════════════════
     BUCKET DIVERSITY PICKS
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Find one high-quality candidate per underrepresented emotional bucket.
   *
   * This is the primary fix for single-cluster pigeon-holing.  The engine's
   * taste scoring is working correctly — it's genuinely true that dark anime
   * score highest against a dark profile.  The problem is that without exposure
   * to other buckets, new clusters can never form.
   *
   * The solution: ignore taste score entirely for these picks.  Instead, sort
   * candidates within each underrepresented bucket by anime quality (averageScore).
   * This serves the objectively best comedy / slice-of-life / hype anime rather
   * than the best taste-fit version, giving those lanes a real chance to land.
   *
   * Design rules:
   *  - "Underrepresented" = appeared in fewer of the last MAX_RECENT shown cards
   *  - Sorted from least-seen bucket to most-seen — worst first gets first slot
   *  - Quality floor: averageScore >= 65 (decent anime, not random noise)
   *  - Popularity floor: 500 (enough community data to trust the bucket labelling)
   *  - Returns at most one candidate per bucket, capped at 6 total picks
   */
  _findBucketDiversityPicks(profiles) {
    // Count how often each bucket has appeared in recent history
    const recentBucketCounts = {};
    for (const f of this.recentFeatures) {
      for (const b of (f.keys.emotionalBucket || [])) {
        recentBucketCounts[b] = (recentBucketCounts[b] || 0) + 1;
      }
    }

    // Sort all buckets from least-recently-seen to most
    const allBuckets = Object.keys(EMOTIONAL_BUCKET_DEFS).map(k => `bucket:${k}`);
    const byRepresentation = [...allBuckets].sort(
      (a, b) => (recentBucketCounts[a] || 0) - (recentBucketCounts[b] || 0)
    );

    const MIN_QUALITY = 65;  // averageScore floor
    const MIN_POP     = 500; // popularity floor for reliable bucket labelling
    const MAX_PICKS   = 6;
    const picks       = [];

    for (const bucket of byRepresentation) {
      if (picks.length >= MAX_PICKS) break;

      // Skip if this bucket is already well-represented recently
      // (threshold: seen in more than 20% of recent cards)
      const recentCount = recentBucketCounts[bucket] || 0;
      if (recentCount > this.recentFeatures.length * 0.20) continue;

      // Find candidates that belong to this bucket and clear quality floors
      const candidates = profiles
        .filter(p => {
          const buckets = p.features.keys.emotionalBucket || [];
          const score   = p.anime.averageScore || 0;
          const pop     = p.anime.popularity   || 0;
          return buckets.includes(bucket) && score >= MIN_QUALITY && pop >= MIN_POP;
        })
        .sort((a, b) => (b.anime.averageScore || 0) - (a.anime.averageScore || 0));

      if (candidates.length > 0) picks.push(candidates[0]);
    }

    return picks;
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

      // Include emotional-bucket overlap so back-to-back dark_complexity cards
      // get penalised even when their scalar profiles differ slightly.
      const buckA = new Set(features.keys.emotionalBucket);
      const buckB = new Set(recent.keys.emotionalBucket);
      const buckOverlap = (buckA.size > 0 && buckB.size > 0)
        ? [...buckA].filter(b => buckB.has(b)).length / Math.max(buckA.size, buckB.size)
        : 0;

      return scalarSim * 0.40 + toneOverlap * 0.25 + archOverlap * 0.15 + buckOverlap * 0.20;
    });

    return Math.max(...penalties);
  }


  /* ════════════════════════════════════════════════════════════════════
     QUEUE INTERLEAVING
     ════════════════════════════════════════════════════════════════════ */

  _interleave(strong, boundary, wild, fresh = [], diversity = []) {
    const result = [];
    let bI = 0, wI = 0, fI = 0, dI = 0;

    for (let i = 0; i < strong.length; i++) {
      result.push(strong[i]);
      // Every 3rd strong: diversity pick (different emotional bucket, quality-ranked)
      // This is the primary mechanism for breaking single-cluster pigeon-holing.
      if ((i + 1) % 3  === 0 && dI < diversity.length) result.push(diversity[dI++]);
      // Every 5th strong: boundary probe (explores taste edges)
      if ((i + 1) % 5  === 0 && bI < boundary.length)  result.push(boundary[bI++]);
      // Every 8th strong: fresh pick (taste-matched recent anime)
      if ((i + 1) % 8  === 0 && fI < fresh.length)     result.push(fresh[fI++]);
      // Every 15th strong: wildcard (pure random exploration)
      if ((i + 1) % 15 === 0 && wI < wild.length)      result.push(wild[wI++]);
    }

    while (dI < diversity.length) result.push(diversity[dI++]);
    while (fI < fresh.length)     result.push(fresh[fI++]);
    while (bI < boundary.length)  result.push(boundary[bI++]);
    while (wI < wild.length)      result.push(wild[wI++]);

    return result;
  }


  /* ════════════════════════════════════════════════════════════════════
     BUCKET DIVERSITY ENFORCEMENT
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Prevent any single emotional bucket (e.g. dark_complexity) from
   * dominating more than `maxFraction` of the result batch.
   *
   * Over-represented items are deferred to the END of the queue — they
   * are still reachable if the user keeps swiping, just not served first.
   * This directly fixes the "pigeon-holed into dark moral complexity" bug
   * where every rec batch ends up 70-80% dark_complexity.
   */
  _enforceBucketDiversity(ranked, maxFraction = 0.25) {
    if (ranked.length <= 4) return ranked;
    const maxCount     = Math.ceil(ranked.length * maxFraction);
    const bucketCounts = {};
    const result       = [];
    const deferred     = [];

    for (const anime of ranked) {
      const features  = extractFeatures(anime);
      const topBucket = features.keys.emotionalBucket[0] || null;
      const count     = bucketCounts[topBucket] || 0;

      if (!topBucket || count < maxCount) {
        bucketCounts[topBucket] = count + 1;
        result.push(anime);
      } else {
        deferred.push(anime);
      }
    }

    // Deferred items appended at the end — accessible but deprioritised
    return [...result, ...deferred];
  }


  /* ════════════════════════════════════════════════════════════════════
     SCALAR PROFILE UPDATES
     ════════════════════════════════════════════════════════════════════ */

  /**
   * Absorb a positive signal into a dims profile (global or per-cluster).
   * Called with this.dims for the global profile, cluster.dims for clusters.
   */
  _absorbPositive(dims, scalars, isWatch, isSuperLike = false) {
    // Superlike: highest learning rate (0.32) — user is signalling a strong
    // preference so we want the profile to shift meaningfully toward this anime.
    const lr = isSuperLike    ? 0.32
             : isWatch        ? 0.22
             : this.onboarded ? 0.15
             :                  0.28;

    // Superlike also earns more confidence per swipe (0.14 vs 0.07).
    const confGain = isSuperLike ? 0.14 : 0.07;

    for (const [dim, profile] of Object.entries(dims)) {
      const level = scalars[dim] ?? 5;
      profile.preferred  = profile.preferred * (1 - lr) + level * lr;
      if (level > profile.tolerance) {
        profile.tolerance = profile.tolerance * 0.65 + level * 0.35;
      }
      profile.confidence = Math.min(1, profile.confidence + confGain);
    }
  }

  _absorbNegative(dims, scalars, isDislike = false) {
    const lr = isDislike
      ? (this.onboarded ? 0.18 : 0.25)
      : (this.onboarded ? 0.05 : 0.10);

    for (const [dim, profile] of Object.entries(dims)) {
      const level = scalars[dim] ?? 5;
      if (isDislike) {
        // Lower threshold: was +1.0, now +0.5 so repeated dislikes of dark/complex
        // anime actually trigger learning even when preferred has drifted upward.
        if (level > profile.preferred + 0.5) {
          profile.preferred = profile.preferred * (1 - lr) + (level - 2.0) * lr;
          if (level > profile.tolerance) {
            // Stronger tolerance contraction: was -0.8, now -1.5 so the engine
            // stops re-serving the same kind of bad rec after just a few dislikes.
            profile.tolerance = Math.max(profile.preferred, profile.tolerance - 1.5);
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

  /**
   * Adaptive farthest-point seed selection for onboarding.
   *
   * Picks the single best next card from remainingPool to maximise
   * information gain given everything already shown:
   *   • Farthest from all shown cards in 17-dim normalised scalar space
   *   • +2.5 bonus for introducing an emotional bucket not yet seen
   *   • penalty if the candidate's bucket was consistently disliked
   *
   * Cold start (shownCards empty) → returns highest-quality show so the
   * very first card is always a strong, universally-recognisable anchor.
   *
   * @param {object[]} remainingPool  AniList anime not yet shown
   * @param {object[]} shownCards     AniList anime already shown/rated
   * @param {Set}      likedIds       IDs liked or superliked during onboarding
   * @param {Set}      dislikedIds    IDs disliked during onboarding
   * @returns {object|null}
   */
  pickNextSeedCard(remainingPool, shownCards, likedIds = new Set(), dislikedIds = new Set()) {
    if (!remainingPool.length) return null;

    // Cold start: highest average score = best first card, most universally informative
    if (!shownCards.length) {
      return remainingPool.reduce((best, a) =>
        (a.averageScore || 0) > (best.averageScore || 0) ? a : best);
    }

    const DIMS = [
      'fanService','violence','darkness','romance','humor','pacing',
      'niche','emotionalWeight','hype','psychologicalDepth',
      'worldbuilding','characterDrama','moralComplexity',
      'episodeAppetite','formatPreference','sourcePreference','eraPreference',
    ];

    // Pre-compute shown card profiles once
    const shownProfiles = shownCards.map(a => {
      const { scalars, keys } = extractFeatures(a);
      return {
        vec:      DIMS.map(d => (scalars[d] || 0) / 10),
        buckets:  keys.emotionalBucket || [],
        liked:    likedIds.has(a.id),
        disliked: dislikedIds.has(a.id),
      };
    });

    // Bucket-level like/dislike tallies from swipe history
    const bucketLikes    = {};
    const bucketDislikes = {};
    for (const p of shownProfiles) {
      for (const b of p.buckets) {
        if (p.liked)    bucketLikes[b]    = (bucketLikes[b]    || 0) + 1;
        if (p.disliked) bucketDislikes[b] = (bucketDislikes[b] || 0) + 1;
      }
    }

    const seenBuckets = new Set(shownProfiles.flatMap(p => p.buckets));
    const shownVecs   = shownProfiles.map(p => p.vec);

    function sqDist(va, vb) {
      let s = 0;
      for (let i = 0; i < va.length; i++) s += (va[i] - vb[i]) ** 2;
      return s;
    }

    let bestAnime = null, bestScore = -Infinity;

    for (const candidate of remainingPool) {
      const { scalars, keys } = extractFeatures(candidate);
      const vec     = DIMS.map(d => (scalars[d] || 0) / 10);
      const buckets = keys.emotionalBucket || [];

      // Farthest-point: min squared distance to nearest shown card
      const minDist = Math.min(...shownVecs.map(sv => sqDist(vec, sv)));

      // Bucket novelty bonus: reward introducing a dimension not yet mapped
      const novelBonus = buckets.some(b => !seenBuckets.has(b)) ? 2.5 : 0;

      // Dislike penalty: avoid buckets the user has rejected more than liked
      let dislikePenalty = 0;
      for (const b of buckets) {
        const dl = bucketDislikes[b] || 0;
        const lk = bucketLikes[b]    || 0;
        if (dl > 0 && dl > lk) dislikePenalty += dl * 0.4;
      }

      const score = minDist + novelBonus - dislikePenalty;
      if (score > bestScore) { bestScore = score; bestAnime = candidate; }
    }

    return bestAnime || remainingPool[0];
  }
}


/* ─────────────────────────────────────────────────────────────────────────
   CommonJS export (no-op in browser)
───────────────────────────────────────────────────────────────────────── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NextArcEngine, extractFeatures };
}

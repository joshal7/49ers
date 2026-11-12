/**
 * Real-Time Sports News StoryRank, Strict Breaking Classifier, Cross-Format Story Clusterer,
 * Film & Trench Differentiator, and Live/Post-Game Context Engine
 *
 * Architectural Pillars:
 * 1. Lead-Claim Event Precision: Classifies what an item is *actually* announcing from its primary
 *    headline/lead sentence rather than letting background recap paragraphs, press-conference quotes,
 *    retrospective "teams called about" notes, or jersey-number trivia trigger false BREAKING alerts.
 * 2. Strict Badge Lifecycle & Scarcity: Reserves red `BREAKING` / `LIVE INJURY UPDATE` badges strictly
 *    for genuine primary roster/injury/legal state changes within tight freshness windows (<8h for
 *    blockbuster Tier-1 transactions/arrests/season-ending injuries; <4.5h for Tier-2 IR/MRI/roster moves;
 *    max 3 urgent breaking clusters feed-wide), transitioning older moves to calm `ROSTER MOVE` / `INJURY UPDATE`.
 * 3. Google News / Techmeme / HN Hybrid StoryRank: Combines Event Magnitude, Source Trust-Tier Authority,
 *    Multi-Publisher Corroboration Velocity, and Analytical Substance over power-law time gravity
 *    `1 / (ageHours + tau)^G` so new important news rockets to #1 immediately while side notes sit lower.
 * 4. Incremental Cross-Format Story Clustering: Consolidates duplicate articles, tweets, and videos on the
 *    same specific event/angle into a single high-authority lead card with expandable related coverage,
 *    while unpacking media cleanly when filtering by `Tweets`, `Articles`, or `Videos`.
 */

import {
  corroborateAndAnnotateWireStream,
  resolveReporterFromNameOrHandle
} from './beatAttributionEngine.js';

export const SHORT_TWEET_FULL_TEXT_LIMIT = 320;

const URGENT_BREAKING_BADGES = new Set(['BREAKING', 'LIVE INJURY UPDATE', 'LIVE IN-GAME']);

export function isUrgentBreakingBadge(badge = '') {
  return URGENT_BREAKING_BADGES.has(String(badge || '').trim().toUpperCase());
}

const IN_GAME_INJURY_RETURN_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out for the rest|out for the rest of the game|will not return|did not return|cleared to return|back in the game|returning to the game|returned to the game|headed to the locker room|going to the locker room|went to the locker room|blue medical tent|medical tent|evaluated for a concussion|concussion evaluation|carted off|limped off|limping off|helped off the field|helped off|walked off with trainers|with athletic trainers|examined by trainers|examined on the sideline|left the game|exited the game|left sunday'?s game|exited sunday'?s game|in-game injury|injury update:\s*[a-z])\b/i;

const POST_GAME_INJURY_FOLLOWUP_REGEX =
  /\b(suffered a|sustained a|exited (?:sunday|monday|thursday|saturday|the game)|left (?:sunday|monday|thursday|saturday|the game)|did not return|underwent an mri|scheduled for an mri|\bmri\b|\bx-rays?\b|ct scan|tests showed|initial tests|believed to have avoided|feared to have|day-to-day|week-to-week|high-ankle|sprain|strain|concussion protocol|torn acl|torn achilles|torn pectoral|meniscus|fracture|out multiple weeks|out several weeks|shanahan (?:said|noted|confirmed|announced)[\s\S]{0,65}\b(?:injury|ankle|knee|foot|back|shoulder|hamstring|calf|quad|groin|rib|wrist|hand|concussion|mri|day-to-day|week-to-week))\b/i;

const PRACTICE_WARMUP_INJURY_SCOOP_REGEX =
  /\b(not practicing|not seen at practice|working on a side field|rehab field|blue non-contact|non-contact jersey|walking boot|suffered a setback|aggravated his|underwent an mri|scheduled for an mri|high-ankle sprain|torn acl|torn achilles|torn pectoral|meniscus|21-day practice window|designated (?:dt |wr |rb |cb |lb |te |ol |de |qb |s )?[a-z .'-]{0,28}(?:for|to) return|open(?:ed|s|ing)? [a-z .'-]{0,28}practice window|didn['’]?t activate|did not activate|returns? to practice)\b/i;

const EXPECTED_ROUTINE_PRACTICE_ABSENCE_REGEX =
  /\b(isn['’]?t surprising|not (?:a )?(?:particularly )?surprising|wasn['’]?t expected to practice|not expected to be ready this week|having previously reported|veteran rest|vet rest|not injury related|\bnir\b)\b/i;

const PRE_GAME_AVAILABILITY_NOISE_REGEX =
  /\b(inactives?\b|is inactive|are inactive|as inactive|officially inactive|declared inactive|officially active|active vs\.?|active against|expected to be active|will be active|won['’]?t play|will not play|not playing today|not playing tonight|ruled out|rule[sd]? out (?:one|two|three|four|five|\d+)|unlikely to play|likely to play|expected to play|could play|hopes to play|plans to play|set to play|good to go|cleared to play|cleared for week \d+|expected to take on a full workload|full workload|game-time decision|remains on injured reserve|didn['’]?t activate|did not activate|not activated from|doesn['’]?t have a (?:game |injury )?designation|does not carry an? (?:official )?(?:injury |game )?designation|no (?:injury |game )?designation|listed as (?:questionable|doubtful|out)|deemed (?:questionable|doubtful|out))\b/i;

const LEAD_PERMANENT_OR_POSTGAME_EXCLUSION_REGEX =
  /\b(arrested|taken into custody|charged with|indicted|suspended|commissioner['’]?s exempt|under (?:nfl |league |police |federal )?investigation|lawsuit|\btrade[!: ]|agree[sd]? to (?:a )?trade|completing a trade|finalizing a trade|sending [\s\S]{0,60}to (?:the )?(?:49ers|san francisco|niners)|traded (?:to|for)|(?:49ers|san francisco|niners) (?:officially )?(?:acquire[sd]?|acquiring|re-acquir(?:e[sd]?|ing)|trade[sd]? for)|has been traded|agreed to terms|contract extension|signed a \d+-year|signs a \d+-year|restructured his contract|reinstat(?:e|ed|ement)|left squad|hires? [a-z .'-]+ as agent|eyes return to (?:the )?nfl|bonus (?:repayment|forfeiture)|placed on injured reserve|placed [a-z .'()-]+ on (?:injured reserve|ir)\b|put [a-z .'()-]+ on ir\b|lose [a-z .'()-]+ to (?:ir|season-ending)|49ers roster move:|signed [a-z .'()-]+ to (?:the )?(?:active roster|practice squad)|out for (?:the )?(?:rest of (?:the )?)?(?:\d{4} )?season|miss the (?:remainder|rest) of the (?:\d{4} )?season|season-ending|done for the season|season likely over|fractured|broken (?:ankle|leg|arm|foot|collarbone|wrist|hand)|torn (?:acl|achilles|pectoral|meniscus|patellar)|carted off|questionable to return|doubtful to return|ruled out for the rest|will not return|did not return|left (?:sunday|monday|thursday|saturday|the )['’]?s? game|exited (?:sunday|monday|thursday|saturday|the )['’]?s? game|suffered (?:a|an|injuries)\b|sustained (?:a|an)\b|\d+-\d+ (?:win|loss|victory)|beat(?:s)? (?:the )?[a-z]+|reaches career milestone|amid [a-z]+ game|notebook:|reacts? to (?:bounce-back )?win|react following)\b/i;

const PRE_GAME_PLAY_AVAILABILITY_REGEX =
  /\b(inactives?\b|officially inactive|declared inactive|is inactive|are inactive|as inactive|officially active|active vs\.?|active against|expected to be active|will be active|won['’]?t play|will not play|not playing today|not playing tonight|unlikely to play|likely to play|expected to play|could play|hopes to play|planning to play|plans to play|set to play|good to go|cleared to play|cleared for week \d+|prepared to return (?:sunday|monday|thursday|saturday|today|tonight)|to return in week \d+|welcoming back [a-z0-9 -]+ for [a-z0-9 .'-]+ game|ruled out|rule[sd]? out (?:one|two|three|four|five|\d+)|will miss (?:sunday|monday|thursday|saturday|today|tonight|week \d+)|won['’]?t be available (?:sunday|monday|thursday|saturday|today|tonight|in week \d+)|expect [a-z .'-]+ to be available (?:sunday|monday|thursday|saturday|today|tonight)|listed as (?:questionable|doubtful|out)|deemed (?:questionable|doubtful|out)|questionable (?:designation|game status|for (?:sunday|monday|thursday|saturday|today|tonight|week \d+))|doubtful for (?:sunday|monday|thursday|saturday|today|tonight|week \d+)|game-time decision|expected to take on a full workload|full workload (?:sunday|monday|thursday|saturday|today|tonight|against|vs)|doesn['’]?t have a (?:game |injury )?designation|does not carry an? (?:official )?(?:injury |game )?designation|carries no (?:game |injury )?designation|no (?:injury |game )?designation for|questionable (?:designation|game status)[\s\S]{0,25}removed|off the injury report|didn['’]?t activate|did not activate|not activated from|remains on injured reserve|(?:final )?(?:injury|availability|status) updates?\b[\s\S]{0,45}\b(?:before|ahead of|on\b)|final updates? ahead of (?:week \d+|sunday|monday|thursday|saturday)|makes?\s+(?:an?\s+)?(?:[a-z0-9 .'-]{0,40}\s+)?announcement\s+(?:on\s+[a-z0-9 .'-]{2,45}\s+)?(?:before|ahead of)\s+[a-z0-9 .'-]{2,25}\s+game|suffers? [a-z ]*injury ahead of [a-z0-9 .'-]+ game|limited (?:at|in) (?:wednesday|thursday|friday|today)['’]?s? practice|limited at practice today|practiced on a limited basis|didn['’]?t (?:participate in(?: [a-z]+['’]?s?)? practice|practice (?:wednesday|thursday|friday|today))|will not practice today|not going today but hopefully a chance tomorrow|returns? to full practice ahead of|eyes return[\s\S]{0,60}\b(?:could play|questionable|hamstring|ankle|knee|injury|sunday|week \d+))\b/i;

const CLUSTER_PLAY_AVAILABILITY_HEADLINE_REGEX =
  /\b(cleared for week \d+|cleared to play|inactives?\b|who plays|likely to play|unlikely to play|won['’]?t play|will not play|ruled out|expected to play|game-time decision|play likelihood|play probability|practice & availability|availability report|injury designations|availability outlook|active vs\.?|inactive vs\.?)\b/i;

const CLUSTER_NON_AVAILABILITY_EXCLUSION_REGEX =
  /\b(salary cap|cba rollover|front office ledger|trade window|pass-rush geometry|cpoe|out for (?:the )?season|season-ending)\b/i;

const SPECULATIVE_OR_RETROSPECTIVE_EXCLUSION_REGEX =
  /\b(mock trade|trade proposal|trade idea|trade pitch|hypothetical|what if|flashback|on this day|\d+\s+years ago|way-too-early|mailbag|merch|promo code)\b/i;

/**
 * Guards against secondary commentary, podium explainers, post-move reactions, human-interest trivia,
 * and unexecuted retrospective rumors masquerading as primary breaking news.
 */
const SECONDARY_COMMENTARY_OR_REACTION_REGEX =
  /\b(explains? (?:why|how|what)|reveals? (?:why|what|how)|discuss(?:es|ing)? (?:addition|acquiring|why|trade|how)|reacts? to|reaction to|thoughts on (?:the )?(?:49ers['’]? )?(?:agreement|trade|move)|grades? the (?:trade|move)|what [a-z .'-]{2,25} brings|why (?:the )?49ers (?:added|traded|acquired|made)|impressed with|feeling energized|thrilled to be|super excited to be|wife celebrates|makes? strong statement|drops? strong [\s\S]{0,24}statement|addresses? (?:past )?beef|beef [\s\S]{0,28}(?:squashed|past)|feud resurfaces|all good now|freely gave|temporary jersey|jersey no\.\s*\d+|just because people are trading|traded for a reason|tough trade market|shanahan answer when i asked|updated look at (?:their|the)|podcast:|ways to watch|how to watch|transcript:)\b/i;

const RETROSPECTIVE_UNEXECUTED_TRADE_REGEX =
  /\b((?:a lot of |multiple |several )?teams['’]? called (?:the 49ers )?(?:about|to inquire)|called (?:the 49ers )?to inquire|inquired about (?:acquiring )?|had [\s\S]{1,36} on (?:their )?trade radar|were eyeing a trade|was eyeing a trade|considered trading for|almost traded for|nearly traded for|trade nixed)\b/i;

const HUMAN_INTEREST_SIDE_NOTE_REGEX =
  /\b(freely gave|kept his promise|took care of me|jersey (?:no\.|number)|no\.\s*99\b|temporary jersey|wife celebrates|addresses? (?:past )?beef|beef [\s\S]{0,28}(?:squashed|past)|feud resurfaces|social media beef|all good now|makes? strong statement|drops? strong [\s\S]{0,24}statement|gives? true thoughts|face concerning reality|suddenly welcome back|celebrates his|4-word message|drew \d+(?:\.\d+)? million viewers)\b/i;

const AGGREGATOR_REWRITE_OUTLET_REGEX = /\b(heavy on 49ers|heavy\.com|clutchpoints|athlon|yardbarker|total pro sports)\b/i;

const NON_TRANSACTION_RELEASE_REGEX =
  /\breleased\s+(?:a\s+|an\s+|their\s+|the\s+|its\s+|his\s+|her\s+|new\s+|official\s+|week\s+\d+\s+)?(?:statement|video|hype video|trailer|podcast|episode|schedule|depth chart|uniform|uniforms|jersey|renderings|report|rankings|grades|mock|list|photos|highlights|mic['’]?d up)\b/i;

/**
 * Tier-1 Blockbuster Transactions & Major Team Events (Immediate #1 Priority; `BREAKING` badge up to 8h,
 * then `ROSTER MOVE` / `INJURY UPDATE` up to 30h). Covers ALL real NFL insider trade/acquisition phrasings!
 */
const TIER1_MAJOR_BREAKING_EVENT_REGEX =
  /\b(arrested|taken into custody|charged with|indicted|arraigned|felony|misdemeanor|\bdui\b|\bdwi\b|suspended (?:by the nfl|without pay|\d+\s+games?)|commissioner['’]?s exempt|under (?:nfl |league |police |federal )?investigation|lawsuit|sued\b|\btrade[!:]\s*(?:the\s+)?[a-z0-9 .'-]{2,40}\s+(?:are|is)\s+(?:sending|trading|dealing)|trade\s+alert:|agree[sd]? to (?:a )?trade|completing a trade|finalizing a trade|has been traded|sending [\s\S]{1,65}\bto (?:the )?(?:49ers|san francisco|niners)|heading to (?:the )?(?:49ers|san francisco|niners) [\s\S]{1,45}\bfor a (?:\d{4} )?[a-z0-9-]+(?:-round)? pick|swap draft pick for|(?:49ers|san francisco|niners) (?:officially )?(?:trade[sd]? for|acquire[sd]?|acquiring|re-acquir(?:e[sd]?|ing)|have (?:officially )?acquired|officially announce [\s\S]{0,30}trade)|traded (?:to|for) (?:the )?(?:49ers|san francisco|niners|wr|dt|de|cb|lb|qb|rb|te|ot|og)|49ers roster move:\s*acquired|agreed to terms|contract extension|signed a \d+-year|signs a \d+-year|restructured his contract|fired|relieved of (?:his|their) duties|parted ways with|stepping down|announced his retirement|lose [a-z .'-]{2,28} (?:for the season|to season-ending)|out for (?:the )?(?:rest of (?:the )?)?(?:\d{4} )?season|season-ending (?:ankle|knee|achilles|acl|shoulder|pectoral|injury|surgery)|torn (?:acl|achilles|pectoral|patellar))\b/i;

/**
 * Tier-2 Official Roster Moves, IR Designations & Acute Status Rulings (`BREAKING` badge strictly when <= 4.5h old,
 * then `ROSTER MOVE` / `INJURY UPDATE`).
 */
const TIER2_ROSTER_OR_STATUS_MOVE_REGEX =
  /(\bbreaking:|just in:|\bdesignate[sd]? (?:dt |wr |rb |cb |lb |te |ol |de |qb |s )?[a-z .'-]{2,28} (?:for|to) return|open(?:ed|s|ing)? [a-z .'-]{2,28}(?:21-day )?practice window|reinstated|activated (?:[a-z .'-]{2,28} )?(?:from|off) (?:ir|injured reserve)|placed (?:[a-z .'-]{2,28} )?on (?:injured reserve|ir)\b|put [a-z .'-]{2,28} on ir\b|signed (?:[a-z .'-]{2,28} )?to (?:the )?(?:active roster|53-man roster)|claimed [a-z .'-]{2,28} off waivers|\bwaived\b|has been released|have released|officially released|released from (?:ir|injured reserve|the practice squad)|\breleased\s+(?:veteran\s+|rookie\s+)?(?:qb|rb|fb|wr|te|ol|ot|og|c|dl|de|dt|nt|edge|lb|ilb|olb|cb|db|s|k|p|ls)\b|49ers roster move:)/i;

const MINOR_PRACTICE_SQUAD_MOVE_REGEX =
  /\b(signed [\s\S]{0,35}to (?:the )?practice squad|practice squad|elevated [\s\S]{0,30}from (?:the )?practice squad|standard elevation)\b/i;

const CREDIBLE_FORWARD_TRADE_RUMOR_REGEX =
  /\b(trade talks|trade discussions|held trade discussions|in talks to acquire|discussing a trade|fielding calls|making calls|calling teams|exploring a trade|shopping\b|expected to pursue|trade interest in|trade target|trade market for|gauging the (?:trade )?market|in the mix for)\b/i;

const SALIENT_INTERVIEW_OR_FEATURE_REGEX =
  /\b(1-on-1|one-on-one|sit-down|exclusive interview|locker room interview|opened up about|spoke candidly|reflects on|mic['’]?d up|joined knbr|players['’]? tribune|candid interview)\b/i;

const TRUE_FILM_VIDEO_CHANNEL_REGEX =
  /\b(jonnydel|football academy|qb school|jt o['’]?sullivan|chase daniel|alex rollins|film room|brett kollmann|baldy|kurt warner|all[ _-]?22)\b/i;

const TRUE_FILM_VIDEO_TITLE_REGEX =
  /\b(all-22|all 22|film breakdown|film study|film room|tape breakdown|tape study|49ers playbook|qb film|scheme breakdown|x['’]?s (?:and|&) o['’]?s|pass[- ]rush breakdown|coverage breakdown|coaching tape)\b/i;

const WRITTEN_FILM_AND_TRENCH_SIGNAL_REGEX =
  /\b(all-22|all 22|film breakdown|film study|tape breakdown|coaching tape|snap count|snap share|pass[- ]block|run[- ]block|\bpbwr\b|\brswr\b|pressure rate|pass rush|pass-rush|qb sack|pff\s+grad|pff\s+gard|epa\/play|passing epa|rushing epa|yards per play|\bcpoe\b|\bdvoa\b|\byprr\b|\badot\b|success rate|wide-9|stunt|sim pressure|simulated pressure|blitz rate|11 personnel|12 personnel|21 personnel|22 personnel|two-high|single-high|quarters coverage|cover [12346]|man coverage|zone coverage|split-safety|motion rate|play-action|red-zone|third-down|trench(?:es)?|pass protection|o-linem[ae]n|offensive line|defensive line|run defense|run fits?|blocking scheme|route concept|stats and facts|what he brings to the offense|questions at corner|five turnovers|2nd-half takeaways|\d+\s+catches,\s+\d+\s+yards)\b/i;

const NON_FILM_PODIUM_OR_RECAP_VIDEO_REGEX =
  /\b(press conference|media availability|locker room|podium|postgame interview|explains why|reveals (?:why|what)|discusses addition|pumped about|previews week \d+|ways to watch|highlights|reacts to|trade rumor|mailbag)\b/i;

export function extractFirstLeadSentence(text = '') {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  // Temporarily mask periods in initials (C.J., A.J.) and common football abbreviations (vs., No., Jr., Sr., St., Dr.)
  const masked = s
    .replace(/\b([A-Z])\.([A-Z])\./g, '$1\u0000$2\u0000')
    .replace(/\b([A-Z])\.(?=\s+[A-Z])/g, '$1\u0000')
    .replace(/\b(vs|no|st|jr|sr|mr|dr|mt)\./gi, '$1\u0000');
  const m = masked.match(/^[\s\S]{10,240}?[.!?](?=\s+[A-Z"“‘#]|$)/);
  const picked = m ? m[0].trim() : masked.slice(0, 240).trim();
  return picked.replace(/\u0000/g, '.');
}

function extractPrimaryClaimText(item = {}) {
  if (!item || typeof item !== 'object') return '';
  const isTw = item.type === 'tweet' || item.type === 'social';
  if (isTw) {
    return extractFirstLeadSentence(item.fullText || item.title || item.headline || '');
  }
  return String(item.title || item.headline || '').trim();
}

function extractTeamNickname(teamName = '') {
  const clean = String(teamName || '').trim();
  if (!clean) return '';
  const parts = clean.split(/\s+/);
  return parts[parts.length - 1] || '';
}

function escapeRegexToken(s = '') {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Differentiates `Film & Trench` (`'film'`) from general `Videos`, `Trades & Roster` (`'roster'`),
 * `Injury` (`'injury'`), and general `Beat` (`'beat'`) coverage across all media formats.
 *
 * - Videos are ONLY classified as `'film'` when produced by dedicated All-22 tape analysts or
 *   explicitly breaking down game tape/playbook mechanics (never generic podium pressers or talk vlogs).
 * - Written articles and beat threads with substantive All-22, snap-count, trench, coverage-shell,
 *   or EPA/CPOE tactical analysis ARE classified as `'film'`, making `Film & Trench` genuinely cross-media!
 */
export function classifyNewsItemCategory(item = {}) {
  if (!item || typeof item !== 'object') return 'beat';
  const title = String(item.title || item.headline || '').trim();
  const body = String(item.fullText || item.summary || '').trim();
  const lead = extractPrimaryClaimText(item);
  const channelOrAuthor = `${item.outletName || ''} ${item.author || ''} ${item.reporterName || ''}`.trim();
  const combined = `${title} ${body}`.trim();

  if (item.type === 'video' || Boolean(item.videoId)) {
    const isTapeChannel = TRUE_FILM_VIDEO_CHANNEL_REGEX.test(channelOrAuthor);
    const isTapeTitle = TRUE_FILM_VIDEO_TITLE_REGEX.test(title);
    const isPodiumOrVlog = NON_FILM_PODIUM_OR_RECAP_VIDEO_REGEX.test(title) && !isTapeTitle;
    if ((isTapeChannel || isTapeTitle) && !isPodiumOrVlog) {
      return 'film';
    }
    if (
      TIER1_MAJOR_BREAKING_EVENT_REGEX.test(title) ||
      TIER2_ROSTER_OR_STATUS_MOVE_REGEX.test(title) ||
      /\b(trade[sd]?|acquir|roster|cap|contract|extension|free agent|waive[sd]?)\b/i.test(title)
    ) {
      return 'roster';
    }
    if (/\b(injur|practice report|mri|questionable|doubtful|ruled out|inactives?)\b/i.test(title)) {
      return 'injury';
    }
    return 'beat';
  }

  // Primary roster / trade / contract items -> 'roster'
  if (
    !SECONDARY_COMMENTARY_OR_REACTION_REGEX.test(lead) &&
    (TIER1_MAJOR_BREAKING_EVENT_REGEX.test(lead) ||
      TIER2_ROSTER_OR_STATUS_MOVE_REGEX.test(lead) ||
      MINOR_PRACTICE_SQUAD_MOVE_REGEX.test(lead) ||
      CREDIBLE_FORWARD_TRADE_RUMOR_REGEX.test(lead))
  ) {
    if (/\b(injured reserve|\bir\b|21-day|practice window|designate[sd]? [\s\S]{0,30}return)\b/i.test(lead)) {
      return 'roster';
    }
    if (!/\b(mri|x-ray|sprain|strain|concussion|fracture)\b/i.test(lead)) {
      return 'roster';
    }
  }

  // Genuine X's & O's, All-22 tape, snap-count, EPA/CPOE, and trench breakdowns -> 'film'
  const isMockOrOffseasonDraft = /\b(mock draft|draft simulator|7-round|3-round|draft profile|combine)\b/i.test(
    combined
  );
  const filmMatches = combined.match(new RegExp(WRITTEN_FILM_AND_TRENCH_SIGNAL_REGEX.source, 'gi')) || [];
  const headlineHasFilmCue =
    !isMockOrOffseasonDraft &&
    (TRUE_FILM_VIDEO_TITLE_REGEX.test(title) ||
      /\b(snap count|film|all-22|tape|playbook|scheme|trench|pass rush|pass-rush|pff\s+grad|pff\s+gard|o-linem[ae]n|offensive line|run defense|epa|cpoe|dvoa|wide-9|coverage|questions at corner|what he brings to the offense|stats and facts|five turnovers|2nd-half takeaways|\d+\s+catches,\s+\d+\s+yards|play-action|red-zone|third-down)\b/i.test(
        title
      ));
  const isPureInjuryLead =
    /\b(injury report|injury update|did not practice|non-participant|limited participant|not practicing|questionable|doubtful|ruled out|inactives?)\b/i.test(
      lead
    ) && !headlineHasFilmCue;

  if (!isMockOrOffseasonDraft && !isPureInjuryLead && (headlineHasFilmCue || filmMatches.length >= 2)) {
    return 'film';
  }

  if (
    /\b(trade|acquir|cap space|salary cap|dead money|restructure|extension|contract|roster|waive[sd]?|signed|practice squad)\b/i.test(
      lead
    ) &&
    !HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead)
  ) {
    return 'roster';
  }

  if (
    IN_GAME_INJURY_RETURN_REGEX.test(lead) ||
    POST_GAME_INJURY_FOLLOWUP_REGEX.test(lead) ||
    PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(lead) ||
    /\b(injur|practice|questionable|doubtful|ruled out|mri|concussion|achilles|hamstring|ankle|knee)\b/i.test(lead)
  ) {
    return 'injury';
  }

  return 'beat';
}

/**
 * Returns true if `item` (article, tweet, video, or sourceLink) is primarily about
 * single-game pre-kickoff player availability / who is likely to play / won't play /
 * game-day active or inactive status / weekly practice participation, rather than a
 * permanent roster move, post-game injury diagnosis, trade, or game recap.
 */
export function isPreGamePlayAvailabilityItem(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const rawLead = extractPrimaryClaimText(item);
  if (!rawLead) return false;

  if (LEAD_PERMANENT_OR_POSTGAME_EXCLUSION_REGEX.test(rawLead)) {
    return false;
  }

  const summaryLead =
    item.type === 'video' ? '' : extractFirstLeadSentence(item.summary || item.externalTitle || '');
  const combinedCheck = `${rawLead} ${item.title || item.headline || ''} ${summaryLead}`.trim();
  return PRE_GAME_PLAY_AVAILABILITY_REGEX.test(combinedCheck);
}

function decayPriority(base, ageHours, halfLifeHours = 10) {
  if (!Number.isFinite(ageHours) || ageHours <= 0) return Number(base.toFixed(3));
  return Number((base * Math.pow(0.5, ageHours / halfLifeHours)).toFixed(3));
}

/**
 * Resolves live in-game vs. 48-hour post-game & completed-games context from schedule & matchup telemetry.
 */
export function resolveGameNewsContext(appData = null, nowMs = Date.now()) {
  if (!appData || typeof appData !== 'object') {
    return {
      inGame: false,
      postGame48h: false,
      activeKickoffMs: null,
      activeWeek: null,
      activeOppAbbr: '',
      activeOppNickname: '',
      completedKickoffMs: null,
      completedEndMs: null,
      latestCompletedWeek: null,
      latestCompletedKickoffMs: null,
      latestCompletedEndMs: null,
      latestCompletedOppAbbr: '',
      latestCompletedOppNickname: '',
      completedWeeks: [],
      upcomingWeek: null,
      upcomingOppAbbr: '',
      upcomingOppNickname: '',
      tradeDeadlineMs: null
    };
  }

  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const schedule = appData?.scheduleMatchup?.schedule || [];
  const upcoming = appData?.scheduleMatchup?.upcomingMatchup || {};
  const tradeDeadlineIso = appData?.meta?.calendar?.tradeDeadlineIso || '';
  const parsedDeadlineMs = tradeDeadlineIso ? Date.parse(tradeDeadlineIso) : NaN;
  const tradeDeadlineMs = Number.isFinite(parsedDeadlineMs) ? parsedDeadlineMs : null;

  const completedWeeks = [];
  let latestCompleted = null;
  let latestKoMs = -Infinity;
  for (const g of schedule) {
    if (!g || !g.completed || g.isByeWeek) continue;
    const wkNum = Number(g.week);
    if (
      String(g.seasonType || 'REG').toUpperCase() !== 'PRE' &&
      Number.isFinite(wkNum) &&
      wkNum > 0 &&
      !completedWeeks.includes(wkNum)
    ) {
      completedWeeks.push(wkNum);
    }
    const koMs = Date.parse(g.dateIso || '');
    if (Number.isFinite(koMs) && koMs > latestKoMs && koMs <= ts + 6 * 3600_000) {
      latestKoMs = koMs;
      latestCompleted = g;
    } else if (!latestCompleted && !Number.isFinite(koMs)) {
      latestCompleted = g;
    }
  }
  completedWeeks.sort((a, b) => a - b);

  const nextSchedGame = schedule.find(g => g && !g.completed) || null;
  const upcomingWeek =
    Number(upcoming.week) ||
    Number(nextSchedGame?.week) ||
    Number(appData?.meta?.currentWeek) ||
    null;
  const upcomingOppAbbr = String(upcoming.oppAbbr || nextSchedGame?.opponent?.abbr || '').toUpperCase();
  const upcomingOppNickname = extractTeamNickname(upcoming.oppName || nextSchedGame?.opponent?.name || '');

  const latestCompletedWeek = latestCompleted ? Number(latestCompleted.week) || null : null;
  const latestCompletedKickoffMs = Number.isFinite(latestKoMs) ? latestKoMs : null;
  const latestCompletedEndMs =
    latestCompletedKickoffMs !== null ? Math.min(ts, latestCompletedKickoffMs + 3.25 * 3600_000) : null;
  const latestCompletedOppAbbr = String(latestCompleted?.opponent?.abbr || '').toUpperCase();
  const latestCompletedOppNickname = extractTeamNickname(latestCompleted?.opponent?.name || '');

  const sharedCompletedMeta = {
    latestCompletedWeek,
    latestCompletedKickoffMs,
    latestCompletedEndMs,
    latestCompletedOppAbbr,
    latestCompletedOppNickname,
    completedWeeks,
    upcomingWeek,
    upcomingOppAbbr,
    upcomingOppNickname,
    tradeDeadlineMs
  };

  // 1. Check if a 49ers game is currently in progress (from kickoff until completion)
  for (const g of schedule) {
    if (!g || g.completed) continue;
    const koMs = Date.parse(g.dateIso || '');
    const statusLower = String(g.statusDetail || '').toLowerCase();
    const statusIndicatesLive = /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/.test(statusLower);
    if (
      statusIndicatesLive ||
      (Number.isFinite(koMs) && ts >= koMs && ts <= koMs + 4.75 * 3600_000)
    ) {
      return {
        inGame: true,
        postGame48h: false,
        activeKickoffMs: Number.isFinite(koMs) ? koMs : ts - 30 * 60_000,
        activeWeek: Number(g.week) || upcomingWeek,
        activeOppAbbr: String(g.opponent?.abbr || upcomingOppAbbr).toUpperCase(),
        activeOppNickname: extractTeamNickname(g.opponent?.name || '') || upcomingOppNickname,
        completedKickoffMs: null,
        completedEndMs: null,
        ...sharedCompletedMeta
      };
    }
  }

  if (upcoming.liveState === 'in' || upcoming.isGameInProgress) {
    const upKoMs = Date.parse(upcoming.dateIso || upcoming.kickoffIso || '');
    return {
      inGame: true,
      postGame48h: false,
      activeKickoffMs: Number.isFinite(upKoMs) ? upKoMs : ts - 30 * 60_000,
      activeWeek: upcomingWeek,
      activeOppAbbr: upcomingOppAbbr,
      activeOppNickname: upcomingOppNickname,
      completedKickoffMs: null,
      completedEndMs: null,
      ...sharedCompletedMeta
    };
  }

  // 2. Check if a 49ers game completed within the last 48 hours
  if (latestCompleted && Number.isFinite(latestKoMs)) {
    const estEndMs = latestKoMs + 3.25 * 3600_000;
    const sinceEndMs = ts - estEndMs;
    if (ts >= latestKoMs + 2 * 3600_000 && sinceEndMs <= 48 * 3600_000) {
      return {
        inGame: false,
        postGame48h: true,
        activeKickoffMs: null,
        activeWeek: null,
        activeOppAbbr: '',
        activeOppNickname: '',
        completedKickoffMs: latestKoMs,
        completedEndMs: Math.min(ts, estEndMs),
        ...sharedCompletedMeta
      };
    }
  }

  return {
    inGame: false,
    postGame48h: false,
    activeKickoffMs: null,
    activeWeek: null,
    activeOppAbbr: '',
    activeOppNickname: '',
    completedKickoffMs: null,
    completedEndMs: null,
    ...sharedCompletedMeta
  };
}

/**
 * Classifies a news/wire item with strict lead-claim event semantics and tight `BREAKING` freshness decay.
 *
 * Key Guarantees:
 * - Background recaps in `summary` ("When the team traded for Buckner...", "while adding Keenan Allen...")
 *   NEVER trigger false `BREAKING` badges on trivia, podium quotes, or routine practice notes.
 * - Real blockbuster trades ("Trade! The Colts are sending WR Keenan Allen to the 49ers...", "agree to trade",
 *   "49ers trade for...", "The 49ers Acquire...") match immediately at T+0 seconds (`breakingPriority > 3.1`),
 *   wearing `BREAKING` for <= 8h and transitioning cleanly to `ROSTER MOVE` from 8h..30h.
 * - Tier-2 official roster moves ("49ers Designate DT CJ West For Return", IR placements) wear `BREAKING`
 *   strictly when <= 4.5h old, then transition to `ROSTER MOVE`.
 */
export function classifyBreakingItem(item = {}, nowMs = Date.now(), gameContext = null) {
  const ctx =
    gameContext && typeof gameContext === 'object' && gameContext.appData
      ? resolveGameNewsContext(gameContext.appData, nowMs)
      : gameContext;

  const isVideo = item?.type === 'video' || Boolean(item?.videoId);
  const leadClaim = extractPrimaryClaimText(item);
  const fullTweetOrLead =
    item?.type === 'tweet' || item?.type === 'social'
      ? String(item.fullText || item.title || item.headline || '').trim()
      : leadClaim;
  const combined = `${item.title || item.headline || ''} ${item.fullText || ''} ${item.summary || ''}`.trim();

  const pubMs = resolveEffectivePublishTimestampMs(item, nowMs);
  const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 999;

  const isSpeculative = SPECULATIVE_OR_RETROSPECTIVE_EXCLUSION_REGEX.test(combined);
  const isSecondaryOrCommentary =
    isVideo ||
    SECONDARY_COMMENTARY_OR_REACTION_REGEX.test(leadClaim) ||
    RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(leadClaim) ||
    HUMAN_INTEREST_SIDE_NOTE_REGEX.test(leadClaim);
  const isExpectedRoutineAbsence = EXPECTED_ROUTINE_PRACTICE_ABSENCE_REGEX.test(`${leadClaim} ${fullTweetOrLead}`);
  const isSideNote =
    RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(leadClaim) ||
    HUMAN_INTEREST_SIDE_NOTE_REGEX.test(leadClaim);

  // Evaluate primary event patterns strictly against `leadClaim` (never trailing recap paragraphs!)
  const matchesInGame = !isSpeculative && !isSecondaryOrCommentary && IN_GAME_INJURY_RETURN_REGEX.test(leadClaim);
  const matchesPostGameInjury =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isExpectedRoutineAbsence &&
    POST_GAME_INJURY_FOLLOWUP_REGEX.test(leadClaim);
  const matchesPracticeInjuryScoop =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isExpectedRoutineAbsence &&
    PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(leadClaim);
  const matchesPreGameAvailabilityNoise =
    PRE_GAME_AVAILABILITY_NOISE_REGEX.test(leadClaim) || isPreGamePlayAvailabilityItem(item);

  const matchesTier1Major =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !NON_TRANSACTION_RELEASE_REGEX.test(leadClaim) &&
    TIER1_MAJOR_BREAKING_EVENT_REGEX.test(leadClaim);

  const matchesTier2RosterMove =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !NON_TRANSACTION_RELEASE_REGEX.test(leadClaim) &&
    TIER2_ROSTER_OR_STATUS_MOVE_REGEX.test(leadClaim);

  const tradeDeadlinePassed =
    Number.isFinite(ctx?.tradeDeadlineMs) && nowMs > ctx.tradeDeadlineMs + 2 * 3_600_000;
  const matchesCredibleTradeRumor =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !tradeDeadlinePassed &&
    CREDIBLE_FORWARD_TRADE_RUMOR_REGEX.test(leadClaim);

  const matchesSalientInterview = !isSpeculative && SALIENT_INTERVIEW_OR_FEATURE_REGEX.test(combined);

  const repEntry = resolveReporterFromNameOrHandle(
    item.reporterId || item.author || item.reporterName || item.authorHandle
  );
  const effectiveTrustTier = Number(item.trustTier) || repEntry?.trustTier || 2;

  // 1. LIVE IN-GAME MODE: Prioritize in-game injuries (#1) & live game tweets; sink pre-game availability noise to bottom
  if (ctx?.inGame && Number.isFinite(ctx.activeKickoffMs)) {
    const koMs = ctx.activeKickoffMs;
    const isDuringGame = Number.isFinite(pubMs) && pubMs >= koMs - 5 * 60_000;

    if (matchesTier1Major && ageHours <= 6) {
      return {
        isBreaking: true,
        isUrgentBreaking: true,
        isInGameInjury: false,
        storyTier: 'tier1_major',
        breakingPriority: decayPriority(2.95, ageHours, 8),
        breakingBadge: 'BREAKING',
        ageHours
      };
    }

    if (matchesPreGameAvailabilityNoise && !matchesInGame) {
      return {
        isBreaking: false,
        isUrgentBreaking: false,
        isInGameInjury: false,
        isStalePreGameAvailability: true,
        storyTier: 'stale_pregame',
        breakingPriority: -5.0,
        breakingBadge: null,
        ageHours
      };
    }

    if (!isDuringGame) {
      return {
        isBreaking: false,
        isUrgentBreaking: false,
        isInGameInjury: false,
        storyTier: isSideNote ? 'side_note' : 'standard',
        breakingPriority: 0,
        breakingBadge: null,
        ageHours
      };
    }

    if (matchesInGame || matchesPostGameInjury) {
      return {
        isBreaking: true,
        isUrgentBreaking: true,
        isInGameInjury: true,
        storyTier: 'in_game_injury',
        breakingPriority: 3.3,
        breakingBadge: 'LIVE INJURY UPDATE',
        ageHours
      };
    }

    if (matchesCredibleTradeRumor && effectiveTrustTier <= 2) {
      return {
        isBreaking: true,
        isUrgentBreaking: false,
        isInGameInjury: false,
        storyTier: 'trade_intel',
        breakingPriority: 2.25,
        breakingBadge: 'TRADE INTEL',
        ageHours
      };
    }

    if ((item.type === 'tweet' || item.type === 'social') && !isSpeculative) {
      return {
        isBreaking: true,
        isUrgentBreaking: true,
        isInGameInjury: false,
        storyTier: 'live_in_game',
        breakingPriority: 2.1,
        breakingBadge: 'LIVE IN-GAME',
        ageHours
      };
    }
  }

  // Demote any pre-game availability item from a completed game regardless of post-game hour window
  const completedKoRef = ctx?.completedKickoffMs ?? ctx?.latestCompletedKickoffMs ?? null;
  if (!ctx?.inGame && Number.isFinite(completedKoRef) && Number.isFinite(pubMs) && pubMs < completedKoRef + 20 * 60_000) {
    if (matchesPreGameAvailabilityNoise && !LEAD_PERMANENT_OR_POSTGAME_EXCLUSION_REGEX.test(leadClaim)) {
      return {
        isBreaking: false,
        isUrgentBreaking: false,
        isInGameInjury: false,
        isStalePreGameAvailability: true,
        storyTier: 'stale_pregame',
        breakingPriority: -10.0,
        breakingBadge: null,
        ageHours
      };
    }
  }

  // 2. TIER-1 BLOCKBUSTER TRANSACTIONS, ARRESTS/SUSPENSIONS & SEASON-ENDING INJURIES
  //    Always outrank routine post-game injury notes when fresh so trades like Keenan Allen surface at #1 in <1 min!
  if (matchesTier1Major && ageHours <= 30) {
    const isSeasonEndingInj = /\b(out for (?:the )?(?:rest of (?:the )?)?(?:\d{4} )?season|season-ending|lose [\s\S]{1,28} for the season|torn (?:acl|achilles|pectoral|patellar))\b/i.test(
      leadClaim
    );
    const withinBreakingBadgeWindow = ageHours <= 8;
    const badge = withinBreakingBadgeWindow
      ? 'BREAKING'
      : isSeasonEndingInj
        ? 'INJURY UPDATE'
        : 'ROSTER MOVE';
    return {
      isBreaking: withinBreakingBadgeWindow,
      isUrgentBreaking: withinBreakingBadgeWindow,
      isInGameInjury: false,
      storyTier: 'tier1_major',
      breakingPriority: decayPriority(3.25, ageHours, 9.5),
      breakingBadge: badge,
      ageHours
    };
  }

  // 3. LIVE / RECENT SIDELINE IN-GAME INJURY UPDATES (<16h)
  if (matchesInGame && ageHours <= 16) {
    const isUrgent = ageHours <= 4;
    return {
      isBreaking: ageHours <= 8,
      isUrgentBreaking: isUrgent,
      isInGameInjury: ageHours <= 8,
      isPostGameInjuryUpdate: Boolean(ctx?.postGame48h),
      storyTier: 'in_game_injury',
      breakingPriority: isUrgent ? 3.28 : decayPriority(2.65, ageHours, 7.5),
      breakingBadge: ageHours <= 6 ? 'LIVE INJURY UPDATE' : 'INJURY UPDATE',
      ageHours
    };
  }

  // 4. TIER-2 OFFICIAL ROSTER MOVES & IR RETURN DESIGNATIONS (e.g. "49ers Designate DT CJ West For Return")
  //    Wears `BREAKING` strictly when <= 4.5h old, then transitions cleanly to `ROSTER MOVE` up to 24h.
  if (matchesTier2RosterMove && ageHours <= 24) {
    const isExplicitAlertOnly =
      /^(?:breaking|just in):/i.test(leadClaim) &&
      !/\b(designate|practice window|reinstated|activated|placed [\s\S]{0,28}on (?:ir|injured reserve)|signed|claimed|waived|released|49ers roster move)\b/i.test(
        leadClaim
      );
    if (!isExplicitAlertOnly || effectiveTrustTier === 1) {
      const withinBreakingWindow = ageHours <= 4.5;
      return {
        isBreaking: withinBreakingWindow,
        isUrgentBreaking: withinBreakingWindow,
        isInGameInjury: false,
        storyTier: 'tier2_roster',
        breakingPriority: decayPriority(2.68, ageHours, 7.0),
        breakingBadge: withinBreakingWindow ? 'BREAKING' : 'ROSTER MOVE',
        ageHours
      };
    }
  }

  // 5. 48-HOUR POST-GAME DIAGNOSTIC & INJURY FOLLOW-UPS
  if (ctx?.postGame48h && Number.isFinite(ctx.completedKickoffMs)) {
    const koMs = ctx.completedKickoffMs;
    const isPreFinishedGame = Number.isFinite(pubMs) && pubMs < koMs;
    if (!isPreFinishedGame && ageHours <= 42 && matchesPostGameInjury) {
      const hasNewDiagnosticDetail = /\b(mri|x-ray|ct scan|day-to-day|week-to-week|high-ankle|sprain|strain|placed on ir|fracture)\b/i.test(
        leadClaim
      );
      const basePrio = hasNewDiagnosticDetail ? 2.52 : 2.18;
      return {
        isBreaking: ageHours <= 12,
        isUrgentBreaking: false,
        isInGameInjury: ageHours <= 4,
        isPostGameInjuryUpdate: true,
        storyTier: 'post_game_injury',
        breakingPriority: decayPriority(basePrio, ageHours, 9.5),
        breakingBadge: ageHours <= 20 ? 'INJURY UPDATE' : null,
        ageHours
      };
    }
  }

  // 6. CREDIBLE FORWARD-LOOKING INSIDER TRADE INTEL (only while window open, Tier 1-2 insiders)
  if (matchesCredibleTradeRumor && ageHours <= 18 && effectiveTrustTier <= 2) {
    return {
      isBreaking: true,
      isUrgentBreaking: false,
      isInGameInjury: false,
      storyTier: 'trade_intel',
      breakingPriority: decayPriority(2.38, ageHours, 8.5),
      breakingBadge: 'TRADE INTEL',
      ageHours
    };
  }

  // 7. ACUTE PRACTICE / WARMUP INJURY SCOOPS & RETURN-TO-PRACTICE UPDATES
  if ((matchesPracticeInjuryScoop || matchesPostGameInjury) && ageHours <= 14 && !isExpectedRoutineAbsence) {
    const isFirstMover = Boolean(item.isFirstMoverInjuryScoop) && ageHours <= 5;
    return {
      isBreaking: ageHours <= 6,
      isUrgentBreaking: false,
      isInGameInjury: false,
      storyTier: 'practice_injury',
      breakingPriority: decayPriority(isFirstMover ? 2.15 : 1.78, ageHours, 7.5),
      breakingBadge: isFirstMover ? 'INJURY SCOOP' : ageHours <= 12 ? 'INJURY UPDATE' : null,
      ageHours
    };
  }

  // 8. MINOR PRACTICE SQUAD MOVES
  if (!isSpeculative && !isSecondaryOrCommentary && MINOR_PRACTICE_SQUAD_MOVE_REGEX.test(leadClaim) && ageHours <= 14) {
    return {
      isBreaking: false,
      isUrgentBreaking: false,
      isInGameInjury: false,
      storyTier: 'minor_roster',
      breakingPriority: decayPriority(1.15, ageHours, 7.0),
      breakingBadge: ageHours <= 8 ? 'ROSTER MOVE' : null,
      ageHours
    };
  }

  // 9. SALIENT 1-ON-1 PLAYER / LOCKER-ROOM INTERVIEWS & ALL-22 FILM BREAKDOWNS
  if (matchesSalientInterview && ageHours <= 18 && !isSideNote) {
    return {
      isBreaking: false,
      isUrgentBreaking: false,
      isInGameInjury: false,
      storyTier: 'salient_feature',
      breakingPriority: decayPriority(0.95, ageHours, 9.0),
      breakingBadge: null,
      ageHours
    };
  }

  const resolvedCat = item.category === 'film' ? classifyNewsItemCategory(item) : item.category || classifyNewsItemCategory(item);
  if (resolvedCat === 'film' && !isSideNote && ageHours <= 24) {
    return {
      isBreaking: false,
      isUrgentBreaking: false,
      isInGameInjury: false,
      storyTier: 'film_trench',
      breakingPriority: decayPriority(0.88, ageHours, 11.0),
      breakingBadge: 'FILM & TRENCH',
      ageHours
    };
  }

  return {
    isBreaking: false,
    isUrgentBreaking: false,
    isInGameInjury: false,
    storyTier: isSideNote ? 'side_note' : 'standard',
    breakingPriority: 0,
    breakingBadge: null,
    ageHours
  };
}

/**
 * Computes a calibrated Google News / Techmeme / Hacker News hybrid `StoryRank` score for stack-ranking
 * news stories and clusters by combining:
 * - Event Magnitude (Tier-1 Transaction > Tier-2 Roster/IR/MRI > Insider Intel > Core Team/Film/Podium > Side Note)
 * - Source Trust-Tier Authority (Tier 1 Primary Beat & Insiders > Tier 2 Film/Beat > Tier 3 Opinion)
 * - Multi-Source Corroboration & Burst Velocity (`log2(1 + corroborationCount)`)
 * - Analytical Signal vs. Fluff
 * - Power-Law Time Decay `1 / (ageHours + tau)^Gravity` (steeper gravity on side notes/trivia)
 */
export function computeWireStoryRank(item = {}, nowMs = Date.now(), ctx = null) {
  if (!item || typeof item !== 'object') return -999;
  if (item.isStalePreGameAvailability || (item.breakingPriority || 0) < 0) {
    return (item.breakingPriority || -5) * 100;
  }

  const pubMs = resolveEffectivePublishTimestampMs(item, nowMs);
  const rawAgeHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 72;
  // Blend cluster lead age with newest report when clustered, preventing >12h follow-ups from resetting day-old news to 0h
  const clusterAnchorAge =
    typeof item._clusterAnchorAgeHours === 'number' && Number.isFinite(item._clusterAnchorAgeHours)
      ? item._clusterAnchorAgeHours
      : rawAgeHours;

  // Live In-Game Override: keep live sideline injuries & in-game beat updates strictly at the very top
  if (ctx?.inGame) {
    if (item.isInGameInjury) return 500 - Math.min(40, clusterAnchorAge * 8);
    if (item.breakingBadge === 'LIVE IN-GAME') return 360 - Math.min(40, clusterAnchorAge * 8);
    if (item.storyTier === 'tier1_major' && clusterAnchorAge <= 6) return 420 - clusterAnchorAge * 10;
  }

  const storyTier = item.storyTier || 'standard';
  let eventMagnitude = 46;
  let gravity = 1.28;
  const tau = 1.85;

  switch (storyTier) {
    case 'in_game_injury':
      eventMagnitude = 148;
      gravity = 1.22;
      break;
    case 'tier1_major':
      eventMagnitude = 144;
      gravity = 1.15;
      break;
    case 'tier2_roster':
      eventMagnitude = 114;
      gravity = 1.22;
      break;
    case 'post_game_injury':
      eventMagnitude = 104;
      gravity = 1.24;
      break;
    case 'trade_intel':
      eventMagnitude = 102;
      gravity = 1.26;
      break;
    case 'practice_injury':
      eventMagnitude = 90;
      gravity = 1.28;
      break;
    case 'minor_roster':
      eventMagnitude = 68;
      gravity = 1.32;
      break;
    case 'salient_feature':
      eventMagnitude = 64;
      gravity = 1.24;
      break;
    case 'film_trench':
      eventMagnitude = item.type === 'video' ? 54 : 62;
      gravity = 1.24;
      break;
    case 'side_note':
      eventMagnitude = 27;
      gravity = 1.56;
      break;
    default: {
      const lead = extractPrimaryClaimText(item);
      if (HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead) || RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(lead)) {
        eventMagnitude = 27;
        gravity = 1.56;
      } else if (/\b(injury report|practice report|returns? to practice|miss practice)\b/i.test(lead)) {
        eventMagnitude = 76;
        gravity = 1.24;
      } else {
        eventMagnitude = 48;
        gravity = 1.32;
      }
      break;
    }
  }

  const trustTier = Number(item.trustTier) || 2;
  const isRewriteAggregator = AGGREGATOR_REWRITE_OUTLET_REGEX.test(
    `${item.outletName || ''} ${item.url || ''}`
  );
  const authorityBonus = isRewriteAggregator
    ? -12
    : trustTier === 1
      ? 14
      : trustTier === 2
        ? 6
        : -7;

  const totalSources = Math.max(
    1,
    Number(item.clusterSize) ||
      (Array.isArray(item.confirmingReports) ? item.confirmingReports.length + 1 : 0) ||
      Number(item.corroborationCount) ||
      1
  );
  const recentBurstCount = Number(item.recentBurstCount) || (clusterAnchorAge <= 3 ? totalSources : 1);
  const velocityBonus =
    Math.min(22, Math.log2(totalSources) * 8.5) +
    (recentBurstCount >= 3 && clusterAnchorAge <= 6 ? Math.min(10, (recentBurstCount - 1) * 2.5) : 0) +
    (item.isFirstMoverInjuryScoop && totalSources === 1 && clusterAnchorAge <= 4 ? 7 : 0);

  const signal = Math.max(30, Math.min(100, Number(item.signalScore) || 65));
  const fluff = Math.max(0, Math.min(100, Number(item.fluffScore) || 0));
  const substanceBonus = (signal - 55) * 0.22 - fluff * 0.35;

  // Active Urgent Breaking boost ensures genuine <4.5h/<8h breaking transactions & acute injuries
  // always hold Top Stories placement ahead of brand-new routine beat/aggregator posts
  const activeBreakingFloorBoost =
    item.isUrgentBreaking && isUrgentBreakingBadge(item.breakingBadge) ? 16 : 0;

  const numerator = Math.max(8, eventMagnitude + authorityBonus + velocityBonus + substanceBonus);
  const denom = Math.pow(clusterAnchorAge + tau, gravity);
  return Number((numerator / denom + activeBreakingFloorBoost).toFixed(4));
}

function resolveEffectivePublishTimestampMs(item = {}, nowMs = Date.now()) {
  let effMs = item?.publishedAt ? Date.parse(item.publishedAt) : NaN;
  // Clamp timezone-skewed future RSS timestamps (e.g. WordPress blogs emitting ET as UTC) to `nowMs`
  if (Number.isFinite(effMs) && effMs > nowMs + 5 * 60_000) {
    effMs = nowMs;
  }
  if (item?.type === 'video' && item?.summary) {
    const wkMatch = String(item.summary).match(/\b(\d+)\s*w(?:eeks?|ks?)?\s+ago\b/i);
    const moMatch = String(item.summary).match(/\b(\d+)\s*mo(?:nths?)?\s+ago\b/i);
    const dayMatch = String(item.summary).match(/\b(\d+)\s*d(?:ays?)?\s+ago\b/i);
    const hrMatch = String(item.summary).match(/\b(\d+)\s*h(?:ours?|rs?)?\s+ago\b/i);
    if (moMatch) {
      const est = nowMs - Number(moMatch[1]) * 30 * 86_400_000;
      effMs = Number.isFinite(effMs) ? Math.min(effMs, est) : est;
    } else if (wkMatch) {
      const est = nowMs - Number(wkMatch[1]) * 7 * 86_400_000;
      effMs = Number.isFinite(effMs) ? Math.min(effMs, est) : est;
    } else if (dayMatch) {
      const est = nowMs - Number(dayMatch[1]) * 86_400_000;
      effMs = Number.isFinite(effMs) ? Math.min(effMs, est) : est;
    } else if (hrMatch) {
      const est = nowMs - Number(hrMatch[1]) * 3_600_000;
      effMs = Number.isFinite(effMs) ? Math.min(effMs, est) : est;
    }
  }
  return effMs;
}

function extractReferencedWeekNumbers(text = '') {
  const weeks = [];
  for (const m of String(text || '').matchAll(/\b(?:week|wk)\s*(\d{1,2})\b/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 22 && !weeks.includes(n)) {
      weeks.push(n);
    }
  }
  return weeks;
}

/**
 * Returns true when `item` is a pre-game player availability / likely-to-play / active-inactive /
 * practice-status item for a game that has ALREADY completed (and should therefore be hidden).
 */
export function isStaleCompletedGameAvailabilityItem(item = {}, appData = null, nowMs = Date.now()) {
  if (!item || !appData || typeof appData !== 'object') return false;
  const ctx = resolveGameNewsContext(appData, nowMs);
  if (!ctx.completedWeeks || ctx.completedWeeks.length === 0) return false;
  if (!isPreGamePlayAvailabilityItem(item)) return false;

  const completedSet = new Set(ctx.completedWeeks);
  const upcomingWk = ctx.upcomingWeek && !completedSet.has(ctx.upcomingWeek) ? ctx.upcomingWeek : null;
  const upcomingNick = ctx.upcomingOppNickname || '';
  const latestCompKoMs = ctx.latestCompletedKickoffMs;
  const latestCompEndMs = ctx.latestCompletedEndMs;
  const latestCompNick = ctx.latestCompletedOppNickname || '';

  const leadText = extractPrimaryClaimText(item);
  const checkText = `${leadText} ${item.title || item.headline || ''}`.trim();
  const refWeeks = extractReferencedWeekNumbers(checkText);
  const mentionsCompletedWeek = refWeeks.some(w => completedSet.has(w));
  const mentionsUpcomingWeek = upcomingWk !== null && refWeeks.includes(upcomingWk);
  const mentionsUpcomingOpp =
    Boolean(upcomingNick) &&
    new RegExp(`\\b${escapeRegexToken(upcomingNick)}\\b`, 'i').test(checkText);
  const mentionsCompletedOppPreGame =
    Boolean(latestCompNick) &&
    ctx.latestCompletedOppAbbr !== ctx.upcomingOppAbbr &&
    new RegExp(
      `\\b(?:before|ahead of|vs\\.?|versus|against)\\s+(?:the\\s+)?(?:[a-z]+\\s+)?${escapeRegexToken(latestCompNick)}\\b`,
      'i'
    ).test(checkText);

  const effPubMs = resolveEffectivePublishTimestampMs(item, nowMs);

  // 1. Explicit completed week reference (e.g. "Mike Evans won't play Week 9", "Inactives Week 9") without targeting the upcoming week
  if (mentionsCompletedWeek && !mentionsUpcomingWeek) {
    return true;
  }

  // 2. Explicit pre-game framing for the just-completed opponent (e.g. "Before Raiders Game", "Active vs. Raiders")
  if (mentionsCompletedOppPreGame && !mentionsUpcomingWeek && !mentionsUpcomingOpp) {
    return true;
  }

  // 3. Published prior to kickoff of a completed game
  if (Number.isFinite(latestCompKoMs) && Number.isFinite(effPubMs) && effPubMs < latestCompKoMs + 20 * 60_000) {
    const exclusivelyFutureWeek =
      mentionsUpcomingWeek &&
      !mentionsCompletedWeek &&
      !mentionsCompletedOppPreGame &&
      !/\b(sunday|monday|thursday|saturday|today|tonight|this week|inactives?|practice)\b/i.test(leadText);
    if (!exclusivelyFutureWeek) {
      return true;
    }
  }

  // 4. Post-game guard: items published AFTER the completed game ended about the upcoming week/opponent stay visible
  if (Number.isFinite(latestCompEndMs) && Number.isFinite(effPubMs) && effPubMs >= latestCompEndMs) {
    return false;
  }

  return false;
}

/**
 * Filters out pre-game player availability / likely-to-play / inactive news items
 * pertaining to any game that has already completed.
 */
export function filterOutCompletedGameAvailabilityItems(items = [], appData = null, nowMs = Date.now()) {
  if (!Array.isArray(items) || items.length === 0 || !appData) return items;
  const ctx = resolveGameNewsContext(appData, nowMs);
  if (!ctx.completedWeeks || ctx.completedWeeks.length === 0) return items;

  return items
    .filter(it => !isStaleCompletedGameAvailabilityItem(it, appData, nowMs))
    .map(it => {
      if (Array.isArray(it?.confirmingReports) && it.confirmingReports.length > 0) {
        return {
          ...it,
          confirmingReports: it.confirmingReports.filter(
            cr => !isStaleCompletedGameAvailabilityItem(cr, appData, nowMs)
          )
        };
      }
      return it;
    });
}

/**
 * Returns true if an AI-synthesized brief (`clusteredBriefs`) or AI analysis (`allAnalyses`)
 * is about pre-game player availability / who is likely to play for a game that has completed.
 */
export function isCompletedGameAvailabilityCluster(cluster = {}, appData = null, nowMs = Date.now()) {
  if (!cluster || typeof cluster !== 'object' || !appData) return false;
  const ctx = resolveGameNewsContext(appData, nowMs);
  if (!ctx.completedWeeks || ctx.completedWeeks.length === 0) return false;

  const headline = String(cluster.headline || cluster.title || '').trim();
  const catLabel = String(cluster.categoryLabel || cluster.category || '').trim();
  const headerCombined = `${headline} ${catLabel}`.trim();

  if (!headerCombined || CLUSTER_NON_AVAILABILITY_EXCLUSION_REGEX.test(headerCombined)) {
    return false;
  }
  if (!CLUSTER_PLAY_AVAILABILITY_HEADLINE_REGEX.test(headerCombined)) {
    return false;
  }

  const completedSet = new Set(ctx.completedWeeks);
  const upcomingWk = ctx.upcomingWeek && !completedSet.has(ctx.upcomingWeek) ? ctx.upcomingWeek : null;
  const idAndHeader = `${cluster.id || ''} ${headerCombined}`;
  const refWeeks = extractReferencedWeekNumbers(idAndHeader);
  for (const idMatch of String(cluster.id || '').matchAll(/(?:_|^)(?:wk|week)(\d{1,2})\b/gi)) {
    const wn = Number(idMatch[1]);
    if (Number.isFinite(wn) && !refWeeks.includes(wn)) refWeeks.push(wn);
  }

  const mentionsCompletedWeek = refWeeks.some(w => completedSet.has(w));
  const mentionsUpcomingWeek = upcomingWk !== null && refWeeks.includes(upcomingWk);

  if (mentionsCompletedWeek && !mentionsUpcomingWeek) {
    return true;
  }

  const upcomingNick = ctx.upcomingOppNickname || '';
  const latestCompNick = ctx.latestCompletedOppNickname || '';
  const mentionsUpcomingOpp =
    Boolean(upcomingNick) &&
    new RegExp(`\\b${escapeRegexToken(upcomingNick)}\\b`, 'i').test(headline);
  const mentionsCompletedOpp =
    Boolean(latestCompNick) &&
    ctx.latestCompletedOppAbbr !== ctx.upcomingOppAbbr &&
    new RegExp(`\\b${escapeRegexToken(latestCompNick)}\\b`, 'i').test(headline);

  if (mentionsCompletedOpp && !mentionsUpcomingWeek && !mentionsUpcomingOpp) {
    return true;
  }

  const pubIso = cluster.publishedAt || cluster.createdAt || '';
  const pubMs = pubIso ? Date.parse(pubIso) : NaN;
  if (
    !mentionsUpcomingWeek &&
    !mentionsUpcomingOpp &&
    Number.isFinite(ctx.latestCompletedKickoffMs) &&
    Number.isFinite(pubMs) &&
    pubMs < ctx.latestCompletedKickoffMs + 20 * 60_000
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true during an active in-progress game (`inGame`) if an AI-synthesized brief or
 * analysis is focused on pre-game availability / play likelihood for the game already underway,
 * allowing views to sink it to the bottom of the list once kickoff starts.
 */
export function isActiveInGameAvailabilityCluster(cluster = {}, appData = null, nowMs = Date.now()) {
  if (!cluster || typeof cluster !== 'object' || !appData) return false;
  const ctx = resolveGameNewsContext(appData, nowMs);
  if (!ctx.inGame) return false;

  const headline = String(cluster.headline || cluster.title || '').trim();
  const catLabel = String(cluster.categoryLabel || cluster.category || '').trim();
  const headerCombined = `${headline} ${catLabel}`.trim();
  if (!headerCombined || CLUSTER_NON_AVAILABILITY_EXCLUSION_REGEX.test(headerCombined)) {
    return false;
  }
  if (!CLUSTER_PLAY_AVAILABILITY_HEADLINE_REGEX.test(headerCombined)) {
    return false;
  }

  const idAndHeader = `${cluster.id || ''} ${headerCombined}`;
  const refWeeks = extractReferencedWeekNumbers(idAndHeader);
  for (const idMatch of String(cluster.id || '').matchAll(/(?:_|^)(?:wk|week)(\d{1,2})\b/gi)) {
    const wn = Number(idMatch[1]);
    if (Number.isFinite(wn) && !refWeeks.includes(wn)) refWeeks.push(wn);
  }
  if (ctx.activeWeek && refWeeks.length > 0) {
    return refWeeks.includes(ctx.activeWeek);
  }
  return true;
}

/**
 * Hides AI synthesis briefs about pre-game player availability for completed games,
 * scrubs completed-game pre-game availability sourceLinks & inactives hero images from
 * remaining briefs, and demotes pre-game availability briefs to the bottom during live games.
 */
export function filterAndCleanSynthesisClusters(clusters = [], appData = null, nowMs = Date.now()) {
  if (!Array.isArray(clusters) || clusters.length === 0 || !appData) return clusters;
  const ctx = resolveGameNewsContext(appData, nowMs);

  let cleaned = clusters
    .filter(c => !isCompletedGameAvailabilityCluster(c, appData, nowMs))
    .map(c => {
      let nextLinks = Array.isArray(c.sourceLinks) ? c.sourceLinks : null;
      if (nextLinks && ctx.completedWeeks?.length > 0) {
        const filteredLinks = nextLinks.filter(
          sl =>
            !isStaleCompletedGameAvailabilityItem(
              {
                type: sl?.type || 'article',
                title: sl?.title || '',
                fullText: sl?.title || '',
                url: sl?.url || '',
                publishedAt: sl?.publishedAt || null
              },
              appData,
              nowMs
            )
        );
        if (filteredLinks.length > 0) {
          nextLinks = filteredLinks;
        }
      }

      let heroPatch = null;
      if (
        ctx.completedWeeks?.length > 0 &&
        (c.heroImageAlt || c.heroImageLink) &&
        isStaleCompletedGameAvailabilityItem(
          {
            type: 'article',
            title: c.heroImageAlt || '',
            url: c.heroImageLink || '',
            publishedAt: c.publishedAt || null
          },
          appData,
          nowMs
        )
      ) {
        heroPatch = c.videoClip?.videoId
          ? {
              heroImageUrl: `https://i.ytimg.com/vi/${c.videoClip.videoId}/hqdefault.jpg`,
              heroImageAlt: c.videoClip.title || c.headline,
              heroImageSource: c.videoClip.channel || 'YouTube HD Frame',
              heroImageLink: `https://www.youtube.com/watch?v=${c.videoClip.videoId}`,
              heroImageIsEditorial: false
            }
          : {
              heroImageUrl: '',
              heroImageAlt: '',
              heroImageSource: '',
              heroImageLink: '',
              heroImageIsEditorial: false
            };
      }

      if (nextLinks === c.sourceLinks && !heroPatch) return c;
      return {
        ...c,
        ...(nextLinks ? { sourceLinks: nextLinks, synthesizedFromCount: nextLinks.length } : {}),
        ...(heroPatch || {})
      };
    });

  if (ctx.inGame && cleaned.length > 1) {
    const normal = [];
    const demoted = [];
    for (const c of cleaned) {
      if (isActiveInGameAvailabilityCluster(c, appData, nowMs)) {
        demoted.push(c);
      } else {
        normal.push(c);
      }
    }
    cleaned = [...normal, ...demoted];
  }

  return cleaned;
}

/**
 * Sorts tweets, articles & videos using Google News / Techmeme / HN Hybrid `StoryRank`
 * with live in-game & 48h post-game injury awareness and a strict feed-wide `BREAKING` scarcity cap.
 */
export function sortNewsWithBreakingPriority(
  items = [],
  nowMs = Date.now(),
  { activeWindowHours = 18, gameContext = null, appData = null, maxUrgentBreakingBadges = 3 } = {}
) {
  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);
  const effectiveWindowHours = ctx?.postGame48h ? Math.max(48, activeWindowHours) : activeWindowHours;
  const corroborated = corroborateAndAnnotateWireStream(items, nowMs);

  const scored = corroborated
    .map(it => {
      const cls = classifyBreakingItem(it, nowMs, ctx);
      const repEntry = resolveReporterFromNameOrHandle(
        it.reporterId || it.author || it.reporterName || it.authorHandle
      );
      const trustTier = Number(it.trustTier) || repEntry?.trustTier || 2;
      const withinWindow = cls.breakingPriority < 0 || cls.ageHours <= effectiveWindowHours;
      const resolvedCat =
        it.category === 'cap' || it.category === 'scheme'
          ? it.category
          : classifyNewsItemCategory(it);

      const enriched = {
        ...it,
        category: resolvedCat,
        trustTier,
        storyTier: cls.storyTier || 'standard',
        isBreaking: withinWindow ? cls.isBreaking : false,
        isUrgentBreaking: withinWindow ? Boolean(cls.isUrgentBreaking) : false,
        isInGameInjury: withinWindow ? cls.isInGameInjury : false,
        isPostGameInjuryUpdate: Boolean(cls.isPostGameInjuryUpdate),
        isStalePreGameAvailability: Boolean(cls.isStalePreGameAvailability),
        breakingPriority: withinWindow ? cls.breakingPriority : 0,
        breakingBadge: withinWindow ? cls.breakingBadge : null
      };
      enriched.storyRank = computeWireStoryRank(enriched, nowMs, ctx);
      return enriched;
    })
    .sort((a, b) => {
      const aNeg = (a.breakingPriority || 0) < 0;
      const bNeg = (b.breakingPriority || 0) < 0;
      if (aNeg !== bNeg) return aNeg ? 1 : -1;

      const rankDiff = (b.storyRank || 0) - (a.storyRank || 0);
      const aMs = resolveEffectivePublishTimestampMs(a, nowMs) || 0;
      const bMs = resolveEffectivePublishTimestampMs(b, nowMs) || 0;

      // Within a near-tied StoryRank band on items published within 15m, honor First-Mover & Trust-Tier
      if (Math.abs(rankDiff) < 1.2 && Math.abs(bMs - aMs) <= 15 * 60_000) {
        if (a.isFirstMoverInjuryScoop && !b.isFirstMoverInjuryScoop && (a.corroborationCount || 1) === 1) {
          return -1;
        }
        if (b.isFirstMoverInjuryScoop && !a.isFirstMoverInjuryScoop && (b.corroborationCount || 1) === 1) {
          return 1;
        }
        const tierDiff = (a.trustTier || 2) - (b.trustTier || 2);
        if (tierDiff !== 0) return tierDiff;
      }

      if (Math.abs(rankDiff) >= 0.35) return rankDiff;
      return bMs - aMs;
    });

  // Enforce feed-wide BREAKING scarcity cap outside active live games so at most `maxUrgentBreakingBadges`
  // distinct story angles scream `BREAKING` simultaneously (gracefully downgrading overflow to ROSTER MOVE / INJURY UPDATE)
  if (!ctx?.inGame && maxUrgentBreakingBadges > 0) {
    let urgentSeen = 0;
    const seenUrgentKeys = new Set();
    for (const item of scored) {
      if (!isUrgentBreakingBadge(item.breakingBadge)) continue;
      const sigKey = buildStorySignatureKey(item) || item.id || item.title;
      if (seenUrgentKeys.has(sigKey)) continue;
      urgentSeen += 1;
      seenUrgentKeys.add(sigKey);
      if (urgentSeen > maxUrgentBreakingBadges) {
        item.isUrgentBreaking = false;
        item.isBreaking = false;
        item.breakingBadge =
          item.category === 'injury' || item.isInGameInjury ? 'INJURY UPDATE' : 'ROSTER MOVE';
      }
    }
  }

  return scored;
}

function isPureInjuryCard(item) {
  if (!item) return false;
  const lead = extractPrimaryClaimText(item);
  if (TIER1_MAJOR_BREAKING_EVENT_REGEX.test(lead) || CREDIBLE_FORWARD_TRADE_RUMOR_REGEX.test(lead)) {
    return false;
  }
  return Boolean(
    item.isInGameInjury ||
      item.isPostGameInjuryUpdate ||
      item.category === 'injury' ||
      /^(?:LIVE )?INJURY\b/i.test(String(item.breakingBadge || '')) ||
      resolveInjuryMilestoneBucket(lead)
  );
}

/**
 * Ensures injury prioritization never completely crowds out other salient news (trades/roster moves,
 * All-22 film breakdowns, or standout 1-on-1 player interviews) outside live game action, while never
 * artificially promoting low-signal side notes above genuine team news.
 */
export function balanceFeedTopSalience(
  items = [],
  { nowMs = Date.now(), gameContext = null, appData = null, maxConsecutiveInjuries = 2 } = {}
) {
  if (!Array.isArray(items) || items.length <= maxConsecutiveInjuries) return items;
  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);
  if (ctx?.inGame) return items;

  const remaining = [...items];
  const result = [];
  let consecutiveInj = 0;

  while (remaining.length > 0) {
    if (consecutiveInj >= maxConsecutiveInjuries && result.length < 10) {
      const nonInjIdx = remaining.findIndex((cand, idx) => {
        if (idx > 14 || isPureInjuryCard(cand) || cand?.isClickbait) return false;
        if (cand?.storyTier === 'side_note') return false;
        const pubMs = resolveEffectivePublishTimestampMs(cand, nowMs);
        const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 999;
        if (ageHours > 36) return false;
        const text = `${cand.fullText || ''} ${cand.title || ''} ${cand.headline || ''} ${cand.summary || ''}`;
        return (
          (cand.breakingPriority || 0) > 0 ||
          cand.category === 'roster' ||
          cand.category === 'film' ||
          Number(cand.signalScore || 0) >= 48 ||
          SALIENT_INTERVIEW_OR_FEATURE_REGEX.test(text) ||
          CREDIBLE_FORWARD_TRADE_RUMOR_REGEX.test(text) ||
          TIER1_MAJOR_BREAKING_EVENT_REGEX.test(text)
        );
      });

      if (nonInjIdx >= 0) {
        const [picked] = remaining.splice(nonInjIdx, 1);
        result.push(picked);
        consecutiveInj = 0;
        continue;
      }
    }

    const next = remaining.shift();
    result.push(next);
    if (isPureInjuryCard(next)) {
      consecutiveInj += 1;
    } else {
      consecutiveInj = 0;
    }
  }

  return result;
}

function resolveInjuryMilestoneBucket(text = '') {
  const t = String(text || '').toLowerCase();
  if (
    /\b(placed on injured reserve|placed on ir|season-ending|activated from ir|activated off ir|21-day|designate[sd]? [\s\S]{0,30}(?:for|to) return|practice window)\b/.test(
      t
    )
  ) {
    return 'ir_roster_move';
  }
  if (/\b(mri|x-ray|x-rays|ct scan|tests showed|initial tests|imaging)\b/.test(t)) {
    return 'diagnostic_imaging';
  }
  if (/\b(day-to-day|week-to-week|out multiple weeks|out several weeks|miss \d+|expected to miss)\b/.test(t)) {
    return 'recovery_timeline';
  }
  if (
    /\b(questionable to return|doubtful to return|ruled out for the rest|will not return|did not return|exited|left .*game|(?:headed|going|went|walked|taken) to the locker room|medical tent|carted off|suffered a|sustained a)\b/.test(
      t
    )
  ) {
    return 'in_game_injury_status';
  }
  if (PRE_GAME_AVAILABILITY_NOISE_REGEX.test(t)) {
    return 'pre_game_availability';
  }
  return null;
}

const CLUSTER_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'after', 'before', 'ahead', 'into', 'over',
  'under', 'about', 'what', 'when', 'where', 'which', 'while', 'their', 'there', 'have', 'has', 'had',
  'were', 'was', 'been', 'being', 'will', 'would', 'could', 'should', '49ers', 'niners', 'san',
  'francisco', 'nfl', 'team', 'week', 'game', 'read', 'more', 'report', 'reports', 'per', 'via',
  'says', 'said', 'new', 'update', 'updates', 'latest', 'news', 'video', 'watch', 'clip', 'heres',
  'here', 'how', 'why', 'who', 'his', 'him', 'out', 'off', 'one', 'two'
]);

function normalizeStemToken(tok = '') {
  let w = tok.toLowerCase().replace(/^#+/, '').replace(/['’]s$/i, '').replace(/[^a-z0-9-]/g, '');
  if (w.length <= 2 || CLUSTER_STOPWORDS.has(w)) return '';
  if (/^(acquiring|acquired|acquires|acquisition)$/.test(w)) return 'acquire';
  if (/^(trading|traded|trades)$/.test(w)) return 'trade';
  if (/^(explains|explained|explaining|discusses|discussed|reveals|revealed)$/.test(w)) return 'explain';
  if (/^(designates|designated|designating)$/.test(w)) return 'designate';
  if (/^(returns|returned|returning)$/.test(w)) return 'return';
  if (/^(inquires|inquired|inquiring|called|calling)$/.test(w)) return 'inquire';
  if (/^(eyeing|eyed|radar)$/.test(w)) return 'radar';
  if (w.length >= 6 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length >= 5 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length >= 5 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return CLUSTER_STOPWORDS.has(w) ? '' : w;
}

function extractHeadlineTokens(item = {}) {
  const raw = extractPrimaryClaimText(item)
    .replace(/\|.*$/, '')
    .replace(/\bRead:\s*$/i, '');
  const words = raw.split(/\s+/).map(normalizeStemToken).filter(Boolean);
  const tokenSet = new Set(words);
  for (let i = 0; i < words.length - 1; i++) {
    tokenSet.add(`${words[i]}_${words[i + 1]}`);
  }
  return tokenSet;
}

function extractLeadProperNameSlugs(lead = '') {
  const slugs = [];
  const clean = String(lead || '').replace(/^[#"'“‘]+/, '');
  const re = /\b([A-Z]\.?[A-Za-z'.-]{1,14}\s+[A-Z][a-zA-Z'.-]{2,16})(?:\s+(?:Jr\.?|Sr\.?|II|III|IV|V))?\b/g;
  const ignore = new Set([
    'sanfrancisco', 'kyleshanahan', 'johnlynch', 'probowl', 'superbowl', 'nfltrade', 'traderumors',
    'bayarea', 'nbcsports', 'injurylists', 'injuredreserve', 'practicereport', 'injuryreport',
    'lasvegas', 'newyork', 'losangeles', 'greenbay', 'tampabay', 'kansascity', 'newengland', 'neworleans'
  ]);
  let m;
  while ((m = re.exec(clean)) !== null) {
    const slug = m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (slug.length >= 5 && !ignore.has(slug) && !slugs.includes(slug)) {
      slugs.push(slug);
    }
  }
  return slugs;
}

function extractEntitySet(item = {}) {
  const set = new Set();
  for (const mp of item?.mentionedPlayers || []) {
    const nameSlug = String(mp?.name || mp?.id || '')
      .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (nameSlug) set.add(`pname:${nameSlug}`);
  }
  const urlMatch = String(item?.url || '').match(/espn\.com\/nfl\/player\/_\/id\/\d+\/([a-z0-9-]+)/i);
  if (urlMatch?.[1]) {
    const uSlug = urlMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (uSlug) set.add(`pname:${uSlug}`);
  }
  for (const leadSlug of extractLeadProperNameSlugs(extractPrimaryClaimText(item))) {
    set.add(`pname:${leadSlug}`);
  }
  const lead = extractPrimaryClaimText(item).toLowerCase();
  if (/\bshanahan\b/.test(lead)) set.add('coach:shanahan');
  if (/\blynch\b/.test(lead)) set.add('fo:lynch');
  if (/\bjerry rice\b/.test(lead)) set.add('alum:jerryrice');
  if (/\bcowboys|dallas\b/.test(lead)) set.add('opp:dal');
  if (/\braiders|las vegas\b/.test(lead)) set.add('opp:lv');
  if (/\bseahawks|seattle\b/.test(lead)) set.add('opp:sea');
  if (/\brams\b/.test(lead)) set.add('opp:lar');
  if (/\bcolts|indianapolis|indy\b/.test(lead)) set.add('opp:ind');
  return set;
}

function resolvePracticeStatusBucket(text = '') {
  const t = String(text || '').toLowerCase();
  if (/\b(did not practice|not practicing|non-participant|no practice|missed practice|\bdnp\b)\b/.test(t)) {
    return 'dnp';
  }
  if (/\b(limited in (?:his )?(?:return to )?practice|limited today at practice|was limited|limited participant)\b/.test(t)) {
    return 'lp';
  }
  if (/\b(full participant|practiced in full)\b/.test(t)) {
    return 'fp';
  }
  if (/\bday-to-day\b/.test(t)) {
    return 'day_to_day';
  }
  return null;
}

function isPlayerBioWireBlurbItem(item = {}) {
  return (
    /^espn_pwire_/i.test(String(item?.id || '')) ||
    /espn\.com\/nfl\/player\/_\/id\//i.test(String(item?.url || ''))
  );
}

/**
 * Builds a deterministic semantic angle key (`entity::angle`) for exact same-event stories so
 * cross-outlet coverage (Articles + Tweets + Videos) merges reliably without touching distinct angles.
 */
function buildStorySignatureKey(item = {}) {
  const lead = extractPrimaryClaimText(item);
  if (!lead) return null;
  const lower = lead.toLowerCase();

  const primaryPlayer = item?.mentionedPlayers?.[0];
  const leadSlugs = extractLeadProperNameSlugs(lead);
  const pKey = primaryPlayer?.name
    ? String(primaryPlayer.name)
        .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : primaryPlayer?.id
      ? String(primaryPlayer.id).toLowerCase().replace(/[^a-z0-9]/g, '')
      : leadSlugs[0] || '';

  const collectPlayerSlugs = () => {
    const combined = new Set();
    for (const mp of item?.mentionedPlayers || []) {
      const s = String(mp?.name || mp?.id || '')
        .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      if (s) combined.add(s);
    }
    for (const ls of leadSlugs) combined.add(ls);
    return [...combined].sort().slice(0, 2).join('_');
  };

  // 1. Multi-player team-wide Injury / Practice Report summaries ("49ers vs Cowboys injury report: Deebo returns, 6 miss practice")
  if (
    /\b(injury report|injury updates?|pre practice report|players on its practice participation)\b/.test(lower) &&
    ((item?.mentionedPlayers?.length || 0) >= 2 || /\b(\d+ players|several others|not participating)\b/.test(lower)) &&
    !/\bdesignate[sd]?\b/.test(lower)
  ) {
    return 'team::weekly_injury_report';
  }

  // 2. Beef / Feud squashed angle (e.g. Keenan Allen + Mike Evans past beef)
  if (/\b(beef|feud)\b/.test(lower) || (/\ball good now\b/.test(lower) && pKey)) {
    const sortedIds = collectPlayerSlugs();
    return `players_${sortedIds || pKey}::beef_feud`;
  }

  // 3. Jersey number handover / temporary jersey trivia
  if (/\b(freely gave|kept his promise|jersey no\.|number \d+|no\. \d+)\b/.test(lower) && (pKey || leadSlugs.length > 0)) {
    const sortedIds = collectPlayerSlugs();
    return `players_${sortedIds || pKey}::jersey_number`;
  }

  // 4. Retrospective unexecuted trade inquiries / "on trade radar"
  if (RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(lead)) {
    if (/\b(tight end|\bte\b)\b/.test(lower) && /\bpro bowl\b/.test(lower)) {
      return 'target_probowl_te::retro_trade_radar';
    }
    if (pKey) return `${pKey}::retro_trade_inquiry`;
  }

  // 5. Podium / Coach explaining why 49ers traded for / what newly acquired player brings
  if (
    pKey &&
    /\bshanahan\b/.test(lower) &&
    /\b(explains? why|reveals? what|discusses? addition|pumped['’]? about|what [\s\S]{1,25} brings|shares? #?49ers injury updates?,? discusses)\b/.test(
      lower
    )
  ) {
    return `${pKey}::shanahan_podium_fit`;
  }

  // 5b. Newly acquired player introductory locker-room reaction ("energized / thrilled / super excited to be back in the Bay / with the 49ers")
  if (
    pKey &&
    /\b(energized|thrilled|super excited|excited to be (?:back|with|here)|head is ['"“]?spinning)\b/.test(lower) &&
    /\b(trade|49ers|niners|bay)\b/.test(lower)
  ) {
    return `${pKey}::player_arrival_reaction`;
  }

  // 6. Primary Trade Acquisition / Official Trade Announcement for a specific player
  if (
    !SECONDARY_COMMENTARY_OR_REACTION_REGEX.test(lead) &&
    !RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(lead) &&
    /\b(\btrade[!:]|trade alert|agree[sd]? to (?:a )?trade|completing a trade|sending [\s\S]{1,50}to (?:the )?(?:49ers|san francisco|niners)|heading to (?:the )?(?:49ers|san francisco|niners)|(?:49ers|san francisco|niners) (?:officially )?(?:trade[sd]? for|acquire[sd]?|acquiring|have (?:officially )?acquired|announced? [\s\S]{0,35}(?:acquired|trade))|officially announce [\s\S]{0,30}trade|49ers roster move:\s*acquired|swap draft pick)\b/i.test(
      lead
    )
  ) {
    // Match the player whose name actually appears in the lead trade headline, normalizing by name slug so matched vs unmatched player objects still share one key!
    const leadMentioned = (item?.mentionedPlayers || []).find(mp => {
      const surname = String(mp?.name || '')
        .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .trim()
        .split(/\s+/)
        .slice(-1)[0];
      return surname && surname.length >= 3 && new RegExp(`\\b${escapeRegexToken(surname)}\\b`, 'i').test(lead);
    });
    const posNameMatch = lead.match(
      /\b(?:WR|RB|QB|TE|DT|DE|CB|LB|OT|OG|OL|DL|S|FB|K|P)\s+([A-Z][a-z'.-]+\s+[A-Z][a-z'.-]+)/
    );
    const rawTradeName =
      (posNameMatch ? posNameMatch[1] : '') ||
      leadMentioned?.name ||
      primaryPlayer?.name ||
      '';
    const tradeSlug = String(rawTradeName)
      .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (tradeSlug) {
      return `${tradeSlug}::trade_acquisition`;
    }
  }

  // 7. Player-specific Injury Milestone Bucket (IR/21d return, MRI/X-ray, recovery timeline, in-game status, pre-game availability)
  if (pKey && !SECONDARY_COMMENTARY_OR_REACTION_REGEX.test(lead) && !HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead)) {
    const milestoneProbe = `${lead} ${String(item?.fullText || item?.summary || '').slice(0, 140)}`;
    const milestone = resolveInjuryMilestoneBucket(milestoneProbe);
    if (milestone) {
      return `${pKey}::${milestone}`;
    }
  }

  return null;
}

function setOverlapSimilarity(setA, setB) {
  if (!setA.size || !setB.size) return { jaccard: 0, containment: 0 };
  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) inter += 1;
  }
  if (inter === 0) return { jaccard: 0, containment: 0 };
  const union = setA.size + setB.size - inter;
  return {
    jaccard: inter / union,
    containment: inter / Math.min(setA.size, setB.size)
  };
}

function scoreClusterLeadQuality(item = {}) {
  const trustTier = Number(item.trustTier) || 2;
  const isVideo = item.type === 'video' || Boolean(item.videoId);
  const isArticle = item.type === 'article' || item.type === 'post';
  const isPlayerBioBlurb = isPlayerBioWireBlurbItem(item);
  const titleText = String(item.title || item.headline || '').trim();
  const isPromoLinkTweet = !isArticle && /\bread:\s*$/i.test(titleText);
  const isConversationalAside = /^(?:if it helps|pretty interesting|fwiw|fun fact)\b/i.test(titleText);
  const isRewriteAgg = AGGREGATOR_REWRITE_OUTLET_REGEX.test(`${item.outletName || ''} ${item.url || ''}`);

  const tierScore = isRewriteAgg ? 8 : trustTier === 1 ? 34 : trustTier === 2 ? 24 : 4;
  const formatScore = isPlayerBioBlurb
    ? 6
    : isArticle
      ? 18
      : isVideo
        ? 6
        : isPromoLinkTweet
          ? 2
          : 12;
  const conversationalPenalty = isConversationalAside ? -10 : 0;
  const thumbBonus = !isVideo && !isPlayerBioBlurb && item.imageUrl && /^https:\/\//i.test(item.imageUrl) ? 6 : 0;
  const sigBonus = Math.min(18, (Number(item.signalScore) || 65) * 0.18);
  const primaryMoveBonus =
    item.storyTier === 'tier1_major' || item.storyTier === 'tier2_roster' ? 16 : 0;
  const urgencyBonus = isUrgentBreakingBadge(item.breakingBadge) ? 20 : item.breakingBadge ? 6 : 0;
  return tierScore + formatScore + conversationalPenalty + thumbBonus + sigBonus + primaryMoveBonus + urgencyBonus;
}

/**
 * Google News / Techmeme Incremental Hybrid Story Clusterer (`deduplicateAndGroupWireItems`):
 * Consolidates redundant articles, tweets, and videos covering the same underlying news event or angle
 * within a 36-hour sliding window under the highest-authority lead card (`lead.confirmingReports`),
 * re-scoring cluster StoryRank with multi-publisher corroboration velocity.
 *
 * Options:
 * - `preserveFormat`: `'tweets' | 'articles' | 'videos' | null` — when filtering by a specific format tab,
 *   ensures items of that format are never swallowed inside a lead card of a different format!
 */
export function deduplicateAndGroupWireItems(items = [], { nowMs = Date.now(), preserveFormat = null } = {}) {
  if (!Array.isArray(items) || items.length <= 1) return items;

  const clusters = [];

  const matchesPreservedFormat = it => {
    if (!preserveFormat || preserveFormat === 'all') return false;
    if (preserveFormat === 'tweets') return it?.type === 'tweet' || it?.type === 'social';
    if (preserveFormat === 'articles') return it?.type === 'article' || it?.type === 'post';
    if (preserveFormat === 'videos') return it?.type === 'video' || Boolean(it?.videoId);
    return false;
  };

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const itemMs = resolveEffectivePublishTimestampMs(item, nowMs) || 0;
    const sigKey = buildStorySignatureKey(item);
    const tokens = extractHeadlineTokens(item);
    const entities = extractEntitySet(item);
    const outletKey = String(item.outletId || item.outletName || '').toLowerCase();
    const itemPracticeBucket = resolvePracticeStatusBucket(extractPrimaryClaimText(item));
    const itemIsBioBlurb = isPlayerBioWireBlurbItem(item);
    const itemPrimaryUrl = canonicalComparableUrl(item.url || '');
    const itemExternalUrl = canonicalComparableUrl(item.externalUrl || '');

    let matchedCluster = null;
    let bestSim = 0;

    for (const cl of clusters) {
      // Never cross-swallow a format-filtered item into a lead of a different media type
      if (preserveFormat && matchesPreservedFormat(item) !== matchesPreservedFormat(cl.lead)) {
        continue;
      }

      // 36-hour sliding temporal window
      if (itemMs && cl.anchorMs && Math.abs(cl.anchorMs - itemMs) > 36 * 3_600_000) {
        continue;
      }

      // 0. Exact shared article URL (`tweet.externalUrl === article.url` or vice versa)
      const leadUrl = canonicalComparableUrl(cl.lead.url || '');
      const leadExtUrl = canonicalComparableUrl(cl.lead.externalUrl || '');
      if (
        (itemExternalUrl && (itemExternalUrl === leadUrl || itemExternalUrl === leadExtUrl)) ||
        (leadExtUrl && (leadExtUrl === itemPrimaryUrl || leadExtUrl === itemExternalUrl))
      ) {
        matchedCluster = cl;
        bestSim = 1.0;
        break;
      }

      // 1. Exact semantic story signature (`entity::angle`) match (or shared-entity `::beef_feud` / `::jersey_number`)
      if (sigKey && cl.sigKey) {
        if (sigKey === cl.sigKey) {
          matchedCluster = cl;
          bestSim = 1.0;
          break;
        }
        const itemAngle = sigKey.split('::')[1];
        const clAngle = cl.sigKey.split('::')[1];
        if (
          itemAngle &&
          itemAngle === clAngle &&
          (itemAngle === 'beef_feud' || itemAngle === 'jersey_number') &&
          setOverlapSimilarity(entities, cl.entities).jaccard > 0
        ) {
          matchedCluster = cl;
          bestSim = 0.98;
          break;
        }
      }

      const tokSim = setOverlapSimilarity(tokens, cl.tokens);
      const entSim = setOverlapSimilarity(entities, cl.entities);

      // 2. Same-outlet Article + promotional Tweet echo ("Kyle Shanahan reveals... Read:")
      if (
        outletKey &&
        outletKey === cl.outletKey &&
        item.type !== cl.lead.type &&
        (tokSim.containment >= 0.68 || tokSim.jaccard >= 0.52)
      ) {
        matchedCluster = cl;
        bestSim = 0.92;
        break;
      }

      // 2b. Secondary ESPN/RotoWire player-bio paraphrase of a beat reporter's original practice/injury tweet
      //     (e.g. Matt Barrows tweet "CBs Renardo Green (back) and Deommodore Lenoir (foot) are not practicing today"
      //      + ESPN player blurb "Green (back) did not practice Wednesday, Matt Barrows reports")
      const leadIsBioBlurb = isPlayerBioWireBlurbItem(cl.lead);
      if (
        (itemIsBioBlurb || leadIsBioBlurb) &&
        itemIsBioBlurb !== leadIsBioBlurb &&
        item.reporterId &&
        item.reporterId === cl.lead.reporterId &&
        entSim.jaccard > 0 &&
        (!itemMs || !cl.anchorMs || Math.abs(cl.anchorMs - itemMs) <= 14 * 3_600_000)
      ) {
        const leadPracticeBucket = resolvePracticeStatusBucket(extractPrimaryClaimText(cl.lead));
        if (itemPracticeBucket && itemPracticeBucket === leadPracticeBucket) {
          matchedCluster = cl;
          bestSim = 0.9;
          break;
        }
      }

      // Prevent merging items that have DIFFERENT explicit player-specific injury milestones
      if (sigKey && cl.sigKey && sigKey !== cl.sigKey) {
        continue;
      }

      // 3. Cross-outlet TF-IDF Headline Token + Entity Hybrid Similarity (Google News single-pass threshold)
      //    Require shared entities when both items mention players so unrelated player stories never merge!
      const bothHavePlayers =
        (item.mentionedPlayers?.length || 0) > 0 && (cl.lead.mentionedPlayers?.length || 0) > 0;
      if (bothHavePlayers && entSim.jaccard === 0) {
        continue;
      }

      const hybridScore = 0.62 * tokSim.jaccard + 0.38 * entSim.jaccard;
      const strongHeadlineEcho = tokSim.jaccard >= 0.48 || (tokSim.containment >= 0.72 && tokens.size >= 4);
      if ((hybridScore >= 0.46 || strongHeadlineEcho) && hybridScore > bestSim) {
        bestSim = hybridScore;
        matchedCluster = cl;
      }
    }

    if (!matchedCluster) {
      const clonedLead = {
        ...item,
        confirmingReports: Array.isArray(item.confirmingReports) ? [...item.confirmingReports] : []
      };
      clusters.push({
        sigKey,
        outletKey,
        anchorMs: itemMs,
        oldestMs: itemMs,
        newestMs: itemMs,
        tokens: new Set(tokens),
        entities: new Set(entities),
        lead: clonedLead,
        members: [item]
      });
      continue;
    }

    matchedCluster.members.push(item);
    if (itemMs) {
      if (!matchedCluster.oldestMs || itemMs < matchedCluster.oldestMs) matchedCluster.oldestMs = itemMs;
      if (!matchedCluster.newestMs || itemMs > matchedCluster.newestMs) matchedCluster.newestMs = itemMs;
    }
    for (const t of tokens) matchedCluster.tokens.add(t);
    for (const e of entities) matchedCluster.entities.add(e);

    const existingQual = scoreClusterLeadQuality(matchedCluster.lead);
    const candQual = scoreClusterLeadQuality(item);
    const existingMs = resolveEffectivePublishTimestampMs(matchedCluster.lead, nowMs) || 0;
    const candidateIsBetterLead =
      candQual > existingQual + 5 ||
      (Math.abs(candQual - existingQual) <= 5 &&
        itemMs > existingMs + 15 * 60_000 &&
        String(item.fullText || item.title || '').length >=
          String(matchedCluster.lead.fullText || matchedCluster.lead.title || '').length * 0.75);

    if (candidateIsBetterLead) {
      const demotedPrev = { ...matchedCluster.lead };
      const priorConfirming = Array.isArray(demotedPrev.confirmingReports) ? demotedPrev.confirmingReports : [];
      delete demotedPrev.confirmingReports;
      matchedCluster.lead = {
        ...item,
        // Inherit urgent breaking badge if an earlier primary report in the same fresh cluster triggered it
        breakingBadge: item.breakingBadge || demotedPrev.breakingBadge || null,
        isBreaking: Boolean(item.isBreaking || demotedPrev.isBreaking),
        isUrgentBreaking: Boolean(item.isUrgentBreaking || demotedPrev.isUrgentBreaking),
        breakingPriority: Math.max(item.breakingPriority || 0, demotedPrev.breakingPriority || 0),
        storyTier:
          (item.breakingPriority || 0) >= (demotedPrev.breakingPriority || 0)
            ? item.storyTier
            : demotedPrev.storyTier || item.storyTier,
        confirmingReports: [demotedPrev, ...priorConfirming]
      };
      matchedCluster.outletKey = outletKey || matchedCluster.outletKey;
    } else {
      matchedCluster.lead.confirmingReports.push(item);
      if (!matchedCluster.lead.breakingBadge && item.breakingBadge) {
        matchedCluster.lead.breakingBadge = item.breakingBadge;
        matchedCluster.lead.isBreaking = Boolean(item.isBreaking);
        matchedCluster.lead.isUrgentBreaking = Boolean(item.isUrgentBreaking);
      }
      matchedCluster.lead.breakingPriority = Math.max(
        matchedCluster.lead.breakingPriority || 0,
        item.breakingPriority || 0
      );
    }
  }

  // Finalize cluster metadata, sort related coverage by authority/diversity, and re-rank by corroborated StoryRank!
  const finalized = clusters.map(cl => {
    const lead = cl.lead;
    if (Array.isArray(lead.confirmingReports) && lead.confirmingReports.length > 0) {
      // Deduplicate identical URLs or near-identical snippets inside confirmingReports
      const seenUrls = new Set([canonicalComparableUrl(lead.url)]);
      const uniqueRelated = [];
      for (const cr of lead.confirmingReports) {
        const cu = canonicalComparableUrl(cr?.url || '');
        if (cu && !cu.includes('x.com/search?') && seenUrls.has(cu)) continue;
        if (cu) seenUrls.add(cu);
        uniqueRelated.push(cr);
      }
      uniqueRelated.sort((a, b) => scoreClusterLeadQuality(b) - scoreClusterLeadQuality(a));
      lead.confirmingReports = uniqueRelated;

      const distinctSources = new Set(
        [lead, ...uniqueRelated]
          .map(x => String(x.outletName || x.author || x.reporterName || '').toLowerCase().trim())
          .filter(Boolean)
      );
      lead.clusterSize = Math.max(distinctSources.size, uniqueRelated.length + 1);
      lead.recentBurstCount = cl.members.filter(m => {
        const ms = resolveEffectivePublishTimestampMs(m, nowMs);
        return Number.isFinite(ms) && nowMs - ms <= 3 * 3_600_000;
      }).length;

      const leadMs = resolveEffectivePublishTimestampMs(lead, nowMs);
      const leadAge = Number.isFinite(leadMs) ? Math.max(0, (nowMs - leadMs) / 3_600_000) : 24;
      const oldestAge = cl.oldestMs ? Math.max(0, (nowMs - cl.oldestMs) / 3_600_000) : leadAge;
      const newestAge = cl.newestMs ? Math.max(0, (nowMs - cl.newestMs) / 3_600_000) : leadAge;
      // Anchor age prevents late reaction pieces >12h after an event from resetting a yesterday story to 0h
      lead._clusterAnchorAgeHours =
        oldestAge > 14 ? Math.max(leadAge, oldestAge * 0.55) : 0.65 * leadAge + 0.35 * newestAge;
      const priorStoryRank = Number.isFinite(Number(lead.storyRank)) ? Number(lead.storyRank) : 0;
      lead.storyRank = Math.max(priorStoryRank, computeWireStoryRank(lead, nowMs, null));
    }
    return lead;
  });

  // Re-sort finalized clusters if corroboration velocity elevated a multi-source breaking cluster
  finalized.sort((a, b) => {
    const aNeg = (a.breakingPriority || 0) < 0;
    const bNeg = (b.breakingPriority || 0) < 0;
    if (aNeg !== bNeg) return aNeg ? 1 : -1;
    const rDiff = (b.storyRank || 0) - (a.storyRank || 0);
    if (Math.abs(rDiff) >= 0.35) return rDiff;
    const aMs = resolveEffectivePublishTimestampMs(a, nowMs) || 0;
    const bMs = resolveEffectivePublishTimestampMs(b, nowMs) || 0;
    return bMs - aMs;
  });

  return finalized;
}

const AUTHOR_BOILERPLATE_REGEX_CACHE = new Map();

function getCachedAuthorBoilerplateRegexes(cleanAuthor) {
  let pair = AUTHOR_BOILERPLATE_REGEX_CACHE.get(cleanAuthor);
  if (!pair) {
    if (AUTHOR_BOILERPLATE_REGEX_CACHE.size >= 256) {
      AUTHOR_BOILERPLATE_REGEX_CACHE.clear();
    }
    const escapedFull = cleanAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pair = {
      midClauseRegex: new RegExp(
        `,\\s*(?:per\\s+)?${escapedFull}(?:\\s+of\\s+[A-Za-z0-9 .&'-]{2,32})?\\s+(?:reports|reported|notes|writes)(?=\\.|,|;|$)`,
        'gi'
      ),
      leadClauseRegex: new RegExp(
        `^(?:per\\s+${escapedFull}(?:\\s+of\\s+[A-Za-z0-9 .&'-]{2,28})?,\\s*|${escapedFull}\\s+reports:\\s*)`,
        'i'
      )
    };
    AUTHOR_BOILERPLATE_REGEX_CACHE.set(cleanAuthor, pair);
  }
  return pair;
}

/**
 * Strips redundant inline wire attribution like ", Mike Garafolo of NFL Network reports."
 * when `authorName` ("Mike Garafolo") is already rendered once in the card header.
 */
export function stripRedundantAuthorBoilerplate(rawText = '', authorName = '') {
  let cleaned = String(rawText || '').trim();
  const cleanAuthor = String(authorName || '')
    .split('•')[0]
    .trim();
  if (!cleaned || !cleanAuthor || cleanAuthor.length < 4) return cleaned;

  const { midClauseRegex, leadClauseRegex } = getCachedAuthorBoilerplateRegexes(cleanAuthor);
  midClauseRegex.lastIndex = 0;
  cleaned = cleaned.replace(midClauseRegex, '');
  cleaned = cleaned.replace(leadClauseRegex, '');
  if (cleaned.length > 1) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function canonicalComparableUrl(raw = '') {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|s$)/i.test(k)) u.searchParams.delete(k);
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return s.toLowerCase().replace(/^https?:\/\/(?:www\.)?/, '').replace(/\/+$/, '');
  }
}

export function isRedundantProfileSelfLink(externalUrl = '', itemUrl = '') {
  const ext = String(externalUrl || '').trim();
  if (!ext) return true;
  if (itemUrl && canonicalComparableUrl(ext) === canonicalComparableUrl(itemUrl)) return true;
  if (/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/?(?:\?.*)?$/i.test(ext)) {
    return true;
  }
  if (/^https?:\/\/bsky\.app\/profile\/[^/]+\/?$/i.test(ext)) {
    return true;
  }
  return false;
}

/**
 * Formats a tweet's body so short tweets (<= 320 chars) preserve 100% of their full text
 * without mid-sentence truncation, while very long posts trim cleanly at a word boundary.
 */
export function formatTweetBodyForDisplay(rawText = '', limit = SHORT_TWEET_FULL_TEXT_LIMIT) {
  const cleaned = String(rawText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return { text: '', isFullTweet: true, originalLength: 0 };
  }
  if (cleaned.length <= limit) {
    return { text: cleaned, isFullTweet: true, originalLength: cleaned.length };
  }
  const sliced = cleaned.slice(0, limit - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const neat = (lastSpace > limit * 0.7 ? sliced.slice(0, lastSpace) : sliced).trim();
  return { text: `${neat}…`, isFullTweet: false, originalLength: cleaned.length };
}

/**
 * Determines whether a 49ers game is currently live or inside the immediate game-day
 * injury/inactives/post-game window (95m before kickoff through 4.5h after kickoff),
 * triggering ultra-low (<20s) tweet & game-day inactives polling latency.
 */
export function is49ersGameLiveWindow(appData = {}, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const schedule = appData?.scheduleMatchup?.schedule || [];
  const upcoming = appData?.scheduleMatchup?.upcomingMatchup || {};

  if (upcoming.liveState === 'in' || upcoming.isGameInProgress) {
    return true;
  }

  for (const g of schedule) {
    const statusLower = String(g.statusDetail || '').toLowerCase();
    if (/\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/.test(statusLower) && !g.completed) {
      return true;
    }
    const koMs = g.dateIso ? new Date(g.dateIso).getTime() : NaN;
    if (Number.isFinite(koMs)) {
      if (nowMs >= koMs - 95 * 60_000 && nowMs <= koMs + 4.5 * 3600_000) {
        return true;
      }
    }
  }

  const upKoMs =
    upcoming.dateIso || upcoming.kickoffIso
      ? new Date(upcoming.dateIso || upcoming.kickoffIso).getTime()
      : NaN;
  if (Number.isFinite(upKoMs) && nowMs >= upKoMs - 95 * 60_000 && nowMs <= upKoMs + 4.5 * 3600_000) {
    return true;
  }

  return false;
}

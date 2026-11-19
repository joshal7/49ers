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
  BSKY_ACTOR_TO_X_HANDLE,
  corroborateAndAnnotateWireStream,
  isBlueskyPostUrl,
  isDirectXStatusUrl,
  isPodiumSubjectId,
  resolveItemAuthorProfileUrl,
  resolveReporterFromNameOrHandle
} from './beatAttributionEngine.js';
import {
  isPaywalledPublisher,
  sanitizeExternalUrl,
  stripAggregatorBoilerplate
} from './linkIntegrity.js';
import { isEditorialPhotoUrl } from './salientMediaEngine.js';

export const SHORT_TWEET_FULL_TEXT_LIMIT = 320;

const URGENT_BREAKING_BADGES = new Set(['BREAKING', 'LIVE INJURY UPDATE', 'LIVE IN-GAME']);

export function isUrgentBreakingBadge(badge = '') {
  return URGENT_BREAKING_BADGES.has(String(badge || '').trim().toUpperCase());
}

const IN_GAME_INJURY_RETURN_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out for the rest|out for the rest of the game|will not return|did not return|cleared to return|back in the game|returning to the game|returned to the game|headed to the locker room|going to the locker room|went to the locker room|blue medical tent|medical tent|evaluated for a concussion|concussion evaluation|carted off|limped off|limping off|helped off the field|helped off|walked off with trainers|with athletic trainers|examined by trainers|examined on the sideline|left the game|exited the game|left sunday'?s game|exited sunday'?s game|in-game injury|injury update:\s*[a-z])\b/i;

const POST_GAME_INJURY_FOLLOWUP_REGEX =
  /\b(suffered a|sustained a|exited (?:sunday|monday|thursday|saturday|the game)|left (?:sunday|monday|thursday|saturday|the game)|left with (?:a|an|the(?:\s+same)?)\s+[a-z-]+\s+injury|did(?:n['’]?t|\s+not)\s+return|underwent an mri|scheduled for an mri|\bmri\b|\bx-rays?\b|ct scan|tests showed|initial tests|believed to have avoided|feared to have|day-to-day|week-to-week|high-ankle|sprain|strain|concussion protocol|torn acl|torn achilles|torn pectoral|meniscus|fracture|out multiple weeks|out several weeks|(?:49ers\s+)?injury\s+update:\s*(?:kyle\s+)?shanahan|shanahan (?:said|noted|confirmed|announced|provided|reveals?)[\s\S]{0,65}\b(?:injury|ankle|knee|foot|back|shoulder|hamstring|calf|quad|groin|rib|wrist|hand|concussion|mri|day-to-day|week-to-week))\b/i;

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
  /(\bbreaking:|just in:|\bdesignate[sd]? (?:dt |wr |rb |cb |lb |te |ol |de |qb |s )?[a-z .'-]{2,28} (?:for|to) return|open(?:ed|s|ing)? [a-z .'-]{2,28}(?:21-day )?practice window|reinstated|activated (?:[a-z .'-]{2,28} )?(?:from|off) (?:ir|injured reserve)|placed (?:[a-z .'-]{2,28} )?on (?:injured reserve|ir)\b|put [a-z .'-]{2,28} on ir\b|signed (?:[a-z .'-]{2,28} )?to (?:the )?(?:active roster|53-man roster)|claimed [a-z .'-]{2,28} off waivers|restructured (?:dt |wr |rb |cb |lb |te |ol |de |qb |s )?[a-z .'-]{3,28}|converted \$[\d.]+m of [a-z .'-]{3,28}['’]?s [\s\S]{0,35}into signing bonus|\bwaived\b|has been released|have released|officially released|released from (?:ir|injured reserve|the practice squad)|\breleased\s+(?:veteran\s+|rookie\s+)?(?:qb|rb|fb|wr|te|ol|ot|og|c|dl|de|dt|nt|edge|lb|ilb|olb|cb|db|s|k|p|ls)\b|49ers roster move:)/i;

const MINOR_PRACTICE_SQUAD_MOVE_REGEX =
  /\b(signed [\s\S]{0,35}to (?:the )?practice squad|practice squad|elevated [\s\S]{0,30}from (?:the )?practice squad|standard elevation)\b/i;

const CREDIBLE_FORWARD_TRADE_RUMOR_REGEX =
  /\b(trade talks|trade discussions|held trade discussions|in talks to acquire|discussing a trade|fielding calls|making calls|calling teams|exploring a trade|shopping\b|expected to pursue|trade interest in|trade target|trade market for|gauging the (?:trade )?market|in the mix for)\b/i;

const SALIENT_INTERVIEW_OR_FEATURE_REGEX =
  /\b(1-on-1|one-on-one|sit-down|exclusive interview|locker room interview|opened up about|spoke candidly|reflects on|mic['’]?d up|joined knbr|players['’]? tribune|candid interview)\b/i;

const SALIENT_CAP_AND_CONTRACT_SIGNAL_REGEX =
  /\b(salary cap|cap space|cap hit|cap charge|cap number|cap savings|cap relief|cap room|cap table|cap ledger|dead cap|dead money|void years?|option bonus|signing bonus|roster bonus|workout bonus|per-game roster bonus|base salary|prorat(?:ed|ion)|restructure[sd]?|pay cut|contract extension|contract details|contract breakdown|contract terms|multi-year deal|new deal|agreed to terms|franchise tag|transition tag|fifth-year option|5th-year option|bonus forfeiture|bonus repayment|cba (?:article|rollover)|cap rollover|overthecap|over the cap|spotrac)\b/i;

const DEDICATED_PURE_FILM_CHANNEL_REGEX =
  /\b(the qb school|qb school|jt o['’]?sullivan|jonnydel|football academy|alex rollins|qb confidential|kurt warner|baldy|brett kollmann|film room)\b/i;

const TRUE_FILM_VIDEO_CHANNEL_REGEX =
  /\b(jonnydel|football academy|the qb school|qb school|jt o['’]?sullivan|chase daniel|alex rollins|film room|brett kollmann|baldy|kurt warner|qb confidential|all[ _-]?22)\b/i;

const TRUE_FILM_VIDEO_TITLE_REGEX =
  /\b(all-22|all 22|film breakdown|film review|film study|film room|tape breakdown|tape study|film analysis|49ers playbook|qb film|qb school|scheme breakdown|x['’]?s (?:and|&) o['’]?s|pass[- ]rush breakdown|coverage breakdown|coaching tape)\b/i;

const HIGHLIGHT_AND_TEAM_INTEREST_VIDEO_REGEX =
  /\b(game highlights|full game highlights|\bhighlights\b|best plays|every touchdown|every catch|every throw|every completed pass|rushing highlights|receiving highlights|pick[- ]?6|interceptions?|top plays|condensed game|end of game|final drive|game-winning|\btd\b|end zone|outlast|thriller|49hours|forty niner way|brick by brick|mic['’]?d up|from the trenches|locker room|victory speech|postgame recap|game recap|week \d+ recap|sights and sounds|wired|sideline|behind the scenes|tim ryan|knbr)\b/i;

const POST_GAME_RECAP_OR_PRESSER_SIGNAL_REGEX =
  /\b(\d+-\d+\s+(?:win|loss|victory|thriller|shootout|comeback)|outlast(?:s|ed)?|beat(?:s)?\s+(?:the\s+)?[a-z]+|defeat(?:s|ed)?\s+(?:the\s+)?[a-z]+|postgame|post-game|locker room|victory speech|shanahan\s+(?:on|after|said|explains|addresses|recaps)|purdy\s+(?:on|after)|mccaffrey\s+(?:on|after)|final score|instant analysis|takeaways\s+from|grades\s+from|snap counts?\s+from|touchdowns?|pick[- ]?6|\btd\b|end zone)\b/i;

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
export function isSalientCapOrContractItem(item = {}) {
  if (!item || typeof item !== 'object') return false;
  if (item.category === 'cap') return true;
  const lead = extractPrimaryClaimText(item);
  const title = String(item.title || item.headline || '').trim();
  const combined = `${title} ${item.fullText || ''} ${item.summary || ''}`.trim();
  if (HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead)) return false;
  if (SALIENT_CAP_AND_CONTRACT_SIGNAL_REGEX.test(lead) || SALIENT_CAP_AND_CONTRACT_SIGNAL_REGEX.test(title)) {
    return true;
  }
  const capHits = combined.match(new RegExp(SALIENT_CAP_AND_CONTRACT_SIGNAL_REGEX.source, 'gi')) || [];
  return capHits.length >= 2;
}

export function classifyNewsItemCategory(item = {}) {
  if (!item || typeof item !== 'object') return 'beat';
  const title = String(item.title || item.headline || '').trim();
  const body = String(item.fullText || item.summary || '').trim();
  const lead = extractPrimaryClaimText(item);
  const channelOrAuthor = `${item.outletName || ''} ${item.author || ''} ${item.reporterName || ''} ${item.authorHandle || ''}`.trim();
  const combined = `${title} ${body}`.trim();

  if (item.type === 'video' || Boolean(item.videoId) || Boolean(item.videoStreamUrl)) {
    const isTweetStreamClip = Boolean(item.videoStreamUrl) && (item.type === 'tweet' || item.type === 'social');
    const isDedicatedPureFilmChannel =
      (DEDICATED_PURE_FILM_CHANNEL_REGEX.test(channelOrAuthor) ||
        /\b(theqbschool|jonnydelsfa|jonnydel|baldynfl)\b/i.test(channelOrAuthor)) &&
      !/\b(mailbag|q\s*&\s*a|live\s*stream\s*q&a|podcast)\b/i.test(title);
    const isTapeChannel = TRUE_FILM_VIDEO_CHANNEL_REGEX.test(channelOrAuthor);
    const isTapeTitle = TRUE_FILM_VIDEO_TITLE_REGEX.test(title);
    const isPodiumOrVlog = NON_FILM_PODIUM_OR_RECAP_VIDEO_REGEX.test(title) && !isTapeTitle;
    if (isDedicatedPureFilmChannel || ((!isTweetStreamClip && isTapeChannel || isTapeTitle) && !isPodiumOrVlog)) {
      return 'film';
    }
    if (!isTweetStreamClip) {
      if (/\b(trade|traded|acquir|sign|waiv|roster|cap|contract|restructur)\b/i.test(title)) {
        return 'roster';
      }
      return 'beat';
    }
  }

  // Primary roster / trade / salient salary-cap & contract items -> 'roster' (Trades & Roster)
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

  if (isSalientCapOrContractItem(item) && !TRUE_FILM_VIDEO_TITLE_REGEX.test(title)) {
    return 'roster';
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
      postGameImmediate: false,
      midWeekFilmWindow: false,
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
      upcomingKickoffMs: null,
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
  const rawUpcomingKoMs = Date.parse(
    nextSchedGame?.dateIso || upcoming.dateIso || upcoming.kickoffIso || ''
  );
  const upcomingKickoffMs = Number.isFinite(rawUpcomingKoMs) ? rawUpcomingKoMs : null;

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
    upcomingKickoffMs,
    upcomingOppAbbr,
    upcomingOppNickname,
    tradeDeadlineMs
  };

  // 1. Check if a 49ers game is currently in progress (from kickoff until completion)
  for (const g of schedule) {
    if (!g || g.completed || g.isByeWeek || g.opponent?.isTbd || String(g.opponent?.abbr || '').toUpperCase() === 'TBD') {
      continue;
    }
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
        postGameImmediate: false,
        midWeekFilmWindow: false,
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
      postGameImmediate: false,
      midWeekFilmWindow: false,
      activeKickoffMs: Number.isFinite(upKoMs) ? upKoMs : ts - 30 * 60_000,
      activeWeek: upcomingWeek,
      activeOppAbbr: upcomingOppAbbr,
      activeOppNickname: upcomingOppNickname,
      completedKickoffMs: null,
      completedEndMs: null,
      ...sharedCompletedMeta
    };
  }

  // 2. Check if a 49ers game completed within the last 48 hours (with <=24h immediate post-game high-urgency sub-window)
  if (latestCompleted && Number.isFinite(latestKoMs)) {
    const estEndMs = latestKoMs + 3.25 * 3600_000;
    const sinceEndMs = ts - estEndMs;
    if (ts >= latestKoMs + 2 * 3600_000 && sinceEndMs <= 48 * 3600_000) {
      const isImmediatePostGame = sinceEndMs <= 24 * 3600_000;
      return {
        inGame: false,
        postGame48h: true,
        postGameImmediate: isImmediatePostGame,
        midWeekFilmWindow: !isImmediatePostGame,
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

  const hoursToUpcomingKo =
    upcomingKickoffMs !== null ? (upcomingKickoffMs - ts) / 3600_000 : null;
  const midWeekFilmWindow =
    hoursToUpcomingKo !== null ? hoursToUpcomingKo > 26 && hoursToUpcomingKo <= 138 : true;

  return {
    inGame: false,
    postGame48h: false,
    postGameImmediate: false,
    midWeekFilmWindow,
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
const NON_49ERS_NFL_TEAM_NAMES_PATTERN =
  'Cardinals|Falcons|Ravens|Bills|Panthers|Bears|Bengals|Browns|Cowboys|Broncos|Lions|Packers|Texans|Colts|Jaguars|Chiefs|Raiders|Chargers|Rams|Dolphins|Vikings|Patriots|Saints|Giants|Jets|Eagles|Steelers|Seahawks|Buccaneers|Bucs|Titans|Commanders';

const NON_49ERS_NFL_CITIES_OR_TEAMS_REGEX = new RegExp(
  `\\b#?(?:${NON_49ERS_NFL_TEAM_NAMES_PATTERN}|Arizona|Atlanta|Baltimore|Buffalo|Carolina|Chicago|Cincinnati|Cleveland|Dallas|Denver|Detroit|Green Bay|Houston|Indianapolis|Jacksonville|Kansas City|Las Vegas|Miami|Minnesota|New England|New Orleans|Philadelphia|Pittsburgh|Seattle|Tampa Bay|Tennessee)\\b`,
  'i'
);

const NON_49ERS_SUBJECT_LEAD_REGEX = new RegExp(
  `^(?:(?:breaking|just in|update|injury update|roster move|source|sources|per source|per sources|nfl)[:\\s-]+)*(?:the\\s+)?#?(?:${NON_49ERS_NFL_TEAM_NAMES_PATTERN})\\b`,
  'i'
);

const NON_49ERS_POS_SUBJECT_REGEX = new RegExp(
  `\\b#?(?:${NON_49ERS_NFL_TEAM_NAMES_PATTERN})\\s+(?:QB|RB|FB|WR|TE|OL|OT|OG|LT|LG|RT|RG|DL|DE|DT|NT|EDGE|LB|ILB|OLB|MLB|CB|DB|FS|SS|K|P|LS|G|C|T|S|HC|OC|DC|head coach|coach|rookie|star|starter|veteran)\\b`,
  'i'
);

const SF_TRANSACTION_PARTNER_REGEX =
  /\b(?:(?:to|with|from)\s+(?:the\s+)?#?(?:49ers|Niners|San Francisco)\b[\s\S]{0,40}\b(?:trad(?:e|es|ed|ing)|acquir(?:e|es|ed|ing)|send(?:s|ing)|deal)|(?:trad(?:e|es|ed|ing)|acquir(?:e|es|ed|ing)|send(?:s|ing)|deal[\s\S]{0,20})[\s\S]{0,55}\b(?:to|with|from)\s+(?:the\s+)?#?(?:49ers|Niners|San Francisco)|#?(?:49ers|Niners|San Francisco)\s+(?:are\s+|have\s+)?(?:trad(?:e|es|ed|ing)|acquir(?:e|es|ed|ing)|sign(?:s|ed|ing)?|claim(?:s|ed|ing)?|waiv(?:e|ed|ing)|releas(?:e|ed|ing)|designat(?:e|ed|ing)|activat(?:e|ed|ing)|plac(?:e|ed|ing)))\b/i;

const SF_INCIDENTAL_GAME_CLAUSE_REGEX =
  /\b(?:loss to|lost to|win over|victory over|beat|defeat(?:ed)?|against|vs\.?|versus|facing|play(?:ed|ing)?)\s+(?:the\s+)?#?(?:49ers|Niners|San Francisco)\b/gi;

/**
 * Returns true when the lead sentence's primary subject is a non-49ers NFL team or opposing player/coach
 * (e.g., "#Cowboys G Tyler Booker suffered a high-ankle sprain in his team's loss to the #49ers" or
 * "Coach Mike Macdonald noted ahead of Seattle's Week 11 bye..."), rather than an active 49ers player,
 * coach, or bilateral 49ers trade/transaction.
 */
export function isNon49ersTeamSubjectLead(leadClaim = '', item = {}) {
  const lead = String(leadClaim || '').trim();
  if (!lead) return false;
  if (SF_TRANSACTION_PARTNER_REGEX.test(lead)) return false;

  const hasSfRosterMention = Array.isArray(item?.mentionedPlayers) && item.mentionedPlayers.length > 0;
  if (hasSfRosterMention) return false;

  // Strip incidental game-context mentions ("in his team's loss to the #49ers", "against the 49ers")
  const strippedSfIncidental = lead.replace(SF_INCIDENTAL_GAME_CLAUSE_REGEX, '');
  if (/\b#?(?:49ers|Niners|San Francisco|Santa Clara|Shanahan|Lynch|Raheem Morris|Purdy|McCaffrey|Bosa|Kittle|Warner)\b/i.test(strippedSfIncidental)) {
    return false;
  }

  const hasOppLeadSubject =
    NON_49ERS_SUBJECT_LEAD_REGEX.test(lead) ||
    NON_49ERS_POS_SUBJECT_REGEX.test(lead.slice(0, 95)) ||
    NON_49ERS_NFL_CITIES_OR_TEAMS_REGEX.test(strippedSfIncidental);
  return hasOppLeadSubject;
}

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
  const isOpposingTeamOnlySubject = isNon49ersTeamSubjectLead(leadClaim, item);

  // Evaluate primary event patterns strictly against `leadClaim` (never trailing recap paragraphs or opposing-team player injuries!)
  const matchesInGame =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isOpposingTeamOnlySubject &&
    IN_GAME_INJURY_RETURN_REGEX.test(leadClaim);
  const matchesPostGameInjury =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isExpectedRoutineAbsence &&
    !isOpposingTeamOnlySubject &&
    POST_GAME_INJURY_FOLLOWUP_REGEX.test(leadClaim);
  const matchesPracticeInjuryScoop =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isExpectedRoutineAbsence &&
    !isOpposingTeamOnlySubject &&
    PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(leadClaim);
  const matchesPreGameAvailabilityNoise =
    PRE_GAME_AVAILABILITY_NOISE_REGEX.test(leadClaim) || isPreGamePlayAvailabilityItem(item);

  const matchesTier1Major =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isOpposingTeamOnlySubject &&
    !NON_TRANSACTION_RELEASE_REGEX.test(leadClaim) &&
    TIER1_MAJOR_BREAKING_EVENT_REGEX.test(leadClaim);

  const matchesTier2RosterMove =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isOpposingTeamOnlySubject &&
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

  const resolvedCat =
    !item.category || item.category === 'beat' || item.category === 'film'
      ? classifyNewsItemCategory(item)
      : item.category;
  if (resolvedCat === 'film' && !isSideNote && !isOpposingTeamOnlySubject && ageHours <= 36) {
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

  // 10. IMMEDIATE POST-GAME RECAPS, LOCKER ROOM QUOTES & PLAY CLIPS (0–24h post-game)
  if (
    ctx?.postGameImmediate &&
    Number.isFinite(ctx.completedKickoffMs) &&
    Number.isFinite(pubMs) &&
    pubMs >= ctx.completedKickoffMs + 90 * 60_000 &&
    ageHours <= 20 &&
    !isSpeculative &&
    !isSideNote &&
    !isOpposingTeamOnlySubject &&
    (POST_GAME_RECAP_OR_PRESSER_SIGNAL_REGEX.test(combined) || Boolean(item.videoStreamUrl || item.hasHighlightVideo))
  ) {
    return {
      isBreaking: false,
      isUrgentBreaking: false,
      isInGameInjury: false,
      storyTier: 'post_game_recap',
      breakingPriority: decayPriority(1.58, ageHours, 6.0),
      breakingBadge: null,
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
 * - Event Magnitude (Tier-1 Transaction > Tier-2 Roster/IR/MRI > Insider Intel > Post-Game Recap > Core Team/Film/Podium > Side Note)
 * - Source Trust-Tier Authority (Tier 1 Primary Beat & Insiders > Tier 2 Film/Beat > Tier 3 Opinion)
 * - Multi-Source Corroboration & Burst Velocity (`log2(1 + corroborationCount)`, decaying with newest report age)
 * - Weekly-Rhythm Format Weighting (X/Wire Injury, Presser & Highlight Clips boosted on Game Day / +24h; All-22 Film & Trench boosted Tue–Fri)
 * - Kickoff Epoch Wall (demoting pre-kickoff non-Tier-1 chatter once kickoff/completion occurs)
 * - Phase-Aware Power-Law Time Decay `1 / (ageHours + tau)^Gravity`
 */
export function computeWireStoryRank(item = {}, nowMs = Date.now(), ctx = null) {
  if (!item || typeof item !== 'object') return -999;
  if (item.isStalePreGameAvailability || (item.breakingPriority || 0) < 0) {
    return (item.breakingPriority || -5) * 100;
  }

  const pubMs = resolveEffectivePublishTimestampMs(item, nowMs);
  const rawAgeHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 72;
  // Blend cluster lead age with newest report when clustered, preventing >14h follow-ups from resetting day-old news to 0h
  const clusterAnchorAge =
    typeof item._clusterAnchorAgeHours === 'number' && Number.isFinite(item._clusterAnchorAgeHours)
      ? item._clusterAnchorAgeHours
      : rawAgeHours;
  const newestClusterAge =
    typeof item._clusterNewestAgeHours === 'number' && Number.isFinite(item._clusterNewestAgeHours)
      ? item._clusterNewestAgeHours
      : rawAgeHours;

  // Live In-Game Override: keep live sideline injuries & in-game beat updates strictly at the very top
  if (ctx?.inGame) {
    if (item.isInGameInjury) return 500 - Math.min(45, clusterAnchorAge * 12);
    if (item.breakingBadge === 'LIVE IN-GAME') return 360 - Math.min(50, clusterAnchorAge * 14);
    if (item.storyTier === 'tier1_major' && clusterAnchorAge <= 6) return 420 - clusterAnchorAge * 12;
  }

  const storyTier = item.storyTier || 'standard';
  let eventMagnitude = 46;
  let gravity = 1.38;
  const tau = ctx?.inGame ? 0.45 : ctx?.postGameImmediate ? 1.02 : 1.08;

  switch (storyTier) {
    case 'in_game_injury':
      eventMagnitude = 152;
      gravity = 1.26;
      break;
    case 'tier1_major':
      eventMagnitude = 148;
      gravity = 1.22;
      break;
    case 'tier2_roster':
      eventMagnitude = 116;
      gravity = 1.28;
      break;
    case 'post_game_injury':
      eventMagnitude = 126;
      gravity = 1.24;
      break;
    case 'trade_intel':
      eventMagnitude = 102;
      gravity = 1.32;
      break;
    case 'practice_injury':
      eventMagnitude = 92;
      gravity = 1.34;
      break;
    case 'post_game_recap':
      eventMagnitude = 76;
      gravity = 1.34;
      break;
    case 'minor_roster':
      eventMagnitude = 68;
      gravity = 1.40;
      break;
    case 'salient_feature':
      eventMagnitude = 64;
      gravity = 1.32;
      break;
    case 'film_trench':
      eventMagnitude = item.type === 'video' ? 58 : 64;
      gravity = 1.30;
      break;
    case 'side_note':
      eventMagnitude = 26;
      gravity = 1.64;
      break;
    default: {
      const lead = extractPrimaryClaimText(item);
      if (HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead) || RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(lead)) {
        eventMagnitude = 26;
        gravity = 1.64;
      } else if (/\b(injury report|practice report|returns? to practice|miss practice)\b/i.test(lead)) {
        eventMagnitude = 78;
        gravity = 1.30;
      } else {
        eventMagnitude = 48;
        gravity = 1.42;
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
  const velocityDecay = Math.pow(0.5, newestClusterAge / 7.5);
  const rawVelocity =
    (Math.min(22, Math.log2(totalSources) * 8.5) +
      (recentBurstCount >= 3 && clusterAnchorAge <= 6 ? Math.min(10, (recentBurstCount - 1) * 2.5) : 0)) *
    velocityDecay;
  // Prevent low-salience roundup clusters (Power Rankings, Watch Guides, PFF Grades) from shooting to #1
  // just because 4 outlets published the same boilerplate roundup; dampen general similar-story clusters modestly.
  const effectiveVelocity = item._isLowSalienceRoundupCluster
    ? 0
    : item.clusterKind === 'similar'
      ? Math.min(10, rawVelocity * 0.45)
      : rawVelocity;
  const velocityBonus =
    effectiveVelocity +
    (item.isFirstMoverInjuryScoop && totalSources === 1 && clusterAnchorAge <= 4 ? 8 : 0);

  const signal = Math.max(30, Math.min(100, Number(item.signalScore) || 65));
  const fluff = Math.max(0, Math.min(100, Number(item.fluffScore) || 0));
  const substanceBonus = (signal - 55) * 0.22 - fluff * 0.35;
  const isTweetFormat = item.type === 'tweet' || item.type === 'social';
  const socialPlatformBonus = isDirectXStatusUrl(item.url)
    ? 6
    : isBlueskyPostUrl(item.url)
      ? -2
      : 0;

  // Weekly-Rhythm Phase Weighting:
  // - Game-Day & <=24h Post-Game: elevate verified X/beat tweets with injury, presser, recap, or native highlight clips
  // - Mid-Week (Tue–Fri): elevate All-22 Film & Trench (`Jonnydel`, `The QB School`, tactical tape breakdowns)
  let phaseFormatBonus = 0;
  if (ctx?.postGameImmediate && isTweetFormat && trustTier <= 2 && rawAgeHours <= 18) {
    const combinedSignalText = `${item.title || ''} ${item.fullText || ''} ${item.summary || ''}`;
    if (
      storyTier === 'post_game_injury' ||
      storyTier === 'in_game_injury' ||
      storyTier === 'post_game_recap' ||
      Boolean(item.videoStreamUrl || item.hasHighlightVideo) ||
      POST_GAME_RECAP_OR_PRESSER_SIGNAL_REGEX.test(combinedSignalText)
    ) {
      phaseFormatBonus += isDirectXStatusUrl(item.url) ? 16 : 11;
    }
  } else if (ctx?.midWeekFilmWindow && !ctx?.inGame && rawAgeHours <= 36) {
    if (storyTier === 'film_trench' || item.category === 'film') {
      phaseFormatBonus += 14;
    } else if (storyTier === 'salient_feature' && !isTweetFormat) {
      phaseFormatBonus += 7;
    }
  }

  // Decaying Urgent Breaking boost: commands #1 immediately at T+0m (+16), decaying smoothly (2.25h half-life)
  // so 4h–8h-old moves yield #1 to brand-new breaking/post-game developments
  const activeBreakingFloorBoost =
    item.isUrgentBreaking && isUrgentBreakingBadge(item.breakingBadge)
      ? 16 * Math.pow(0.5, rawAgeHours / 2.25)
      : 0;

  const numerator = Math.max(
    8,
    eventMagnitude + authorityBonus + velocityBonus + substanceBonus + socialPlatformBonus + phaseFormatBonus
  );
  const denom = Math.pow(clusterAnchorAge + tau, gravity);
  let baseRank = numerator / denom + activeBreakingFloorBoost;

  // Kickoff Epoch Wall: once a game kicks off or completes (within 72h), demote non-Tier-1 chatter published
  // BEFORE that game's kickoff unless it explicitly targets the upcoming week/opponent
  const refKoMs = ctx?.inGame ? ctx.activeKickoffMs : ctx?.latestCompletedKickoffMs;
  if (
    Number.isFinite(refKoMs) &&
    Number.isFinite(pubMs) &&
    nowMs - refKoMs <= 72 * 3_600_000 &&
    pubMs < refKoMs - 10 * 60_000 &&
    storyTier !== 'tier1_major'
  ) {
    const checkTxt = `${item.title || ''} ${item.headline || ''} ${item.fullText || ''}`;
    const refWks = extractReferencedWeekNumbers(checkTxt);
    const targetsUpcoming =
      (ctx?.upcomingWeek && refWks.includes(ctx.upcomingWeek)) ||
      (ctx?.upcomingOppNickname &&
        ctx.upcomingOppAbbr !== ctx?.latestCompletedOppAbbr &&
        new RegExp(`\\b${escapeRegexToken(ctx.upcomingOppNickname)}\\b`, 'i').test(checkTxt));
    if (!targetsUpcoming) {
      const epochMult = ctx?.inGame || ctx?.postGameImmediate ? 0.25 : 0.42;
      baseRank *= epochMult;
    }
  }

  // Demote non-49ers opposing-player items unless they pertain to the upcoming opponent's matchup context
  const primaryLeadText = extractPrimaryClaimText(item);
  if (isNon49ersTeamSubjectLead(primaryLeadText, item)) {
    const mentionsUpcomingOpp =
      ctx?.upcomingOppNickname &&
      ctx.upcomingOppAbbr !== ctx?.latestCompletedOppAbbr &&
      new RegExp(`\\b${escapeRegexToken(ctx.upcomingOppNickname)}\\b`, 'i').test(primaryLeadText);
    baseRank *= mentionsUpcomingOpp ? 0.72 : 0.25;
  }

  return Number(baseRank.toFixed(4));
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
  for (const m of String(text || '').matchAll(/\b(?:weeks?|wks?)\s*(\d{1,2})(?:\s*(?:&|and|\+|\/|-)\s*(\d{1,2}))?\b/gi)) {
    for (const grp of [m[1], m[2]]) {
      if (!grp) continue;
      const n = Number(grp);
      if (Number.isFinite(n) && n >= 1 && n <= 22 && !weeks.includes(n)) {
        weeks.push(n);
      }
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
        it.category === 'cap'
          ? 'roster'
          : it.category === 'scheme'
            ? 'scheme'
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

      // Within a near-tied StoryRank band on items published within 30m, honor First-Mover, Trust-Tier & X-over-Bluesky
      if (Math.abs(rankDiff) < 1.2 && Math.abs(bMs - aMs) <= 30 * 60_000) {
        if (Math.abs(bMs - aMs) <= 15 * 60_000) {
          if (a.isFirstMoverInjuryScoop && !b.isFirstMoverInjuryScoop && (a.corroborationCount || 1) === 1) {
            return -1;
          }
          if (b.isFirstMoverInjuryScoop && !a.isFirstMoverInjuryScoop && (b.corroborationCount || 1) === 1) {
            return 1;
          }
          const tierDiff = (a.trustTier || 2) - (b.trustTier || 2);
          if (tierDiff !== 0) return tierDiff;
        }
        const aIsX = isDirectXStatusUrl(a.url);
        const bIsX = isDirectXStatusUrl(b.url);
        if (aIsX !== bIsX) return aIsX ? -1 : 1;
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
        const maxNonInjAgeHours = ctx?.postGameImmediate ? 10 : 18;
        if (ageHours > maxNonInjAgeHours) return false;
        if (
          ctx?.postGameImmediate &&
          Number.isFinite(ctx.completedKickoffMs) &&
          Number.isFinite(pubMs) &&
          pubMs < ctx.completedKickoffMs - 10 * 60_000 &&
          cand.storyTier !== 'tier1_major'
        ) {
          return false;
        }
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
  'here', 'how', 'why', 'who', 'his', 'him', 'out', 'off', 'one', 'two',
  'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent', 'havent', 'hasnt', 'ive', 'hes',
  'its', 'thats', 'youre', 'theyre', 'star', 'football'
]);

const MULTI_TOPIC_DIGEST_REGEX =
  /\b(morning report|notebook|snap count|live updates|what midseason|what we learned|5 players to watch|five important 49ers|3 keys|transcript|after further review|minutia minute|nfc notes|mailbag)\b/i;

function isMultiTopicDigestOrRoundup(item = {}) {
  const title = String(item?.title || item?.headline || '').trim();
  if (MULTI_TOPIC_DIGEST_REGEX.test(title)) return true;
  if ((item?.mentionedPlayers?.length || 0) >= 5) return true;
  return false;
}

function cleanWireSummaryForMatching(raw = '') {
  return String(raw || '')
    .replace(/^\s*(?:\(Photo by [^)]+\)\s*\|\s*[^|]+(?:\s+Images)?\s*)/i, '')
    .replace(/^\s*[A-Z][A-Z\s.,'-]{2,32}\s*[-–—]{1,2}\s*(?:[A-Z]+\s+\d{1,2}\s*:\s*)?/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  if (/^(admits|admitted|admission|acknowledges|acknowledged)$/.test(w)) return 'admit';
  if (/^(struggles|struggled|struggling)$/.test(w)) return 'struggle';
  if (/^(sacks|sacked|sackless|sack-less)$/.test(w)) return 'sack';
  if (/^(playing|played|plays)$/.test(w)) return 'play';
  if (/^(hoping|hopes|hoped)$/.test(w)) return 'hope';
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

function extractArticleSummaryTokens(item = {}) {
  const isArticle = item?.type === 'article' || item?.type === 'post';
  if (!isArticle || isMultiTopicDigestOrRoundup(item)) return new Set();
  const clean = cleanWireSummaryForMatching(item?.summary || '').slice(0, 180);
  if (!clean) return new Set();
  const words = clean.split(/\s+/).map(normalizeStemToken).filter(Boolean);
  return new Set(words);
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

  // 6b. Player-specific Contract Restructure / Bonus Conversion
  if (
    pKey &&
    /\b(restructured|converted\s+\$[\d.]+m\s+of\s+[\s\S]{1,35}into\s+signing\s+bonus)\b/i.test(lead)
  ) {
    return `${pKey}::contract_restructure`;
  }

  // 7. Player-specific Injury Milestone Bucket (IR/21d return, MRI/X-ray, recovery timeline, in-game status, pre-game availability)
  if (pKey && !SECONDARY_COMMENTARY_OR_REACTION_REGEX.test(lead) && !HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead)) {
    const milestoneProbe = `${lead} ${String(item?.fullText || item?.summary || '').slice(0, 140)}`;
    const milestone = resolveInjuryMilestoneBucket(milestoneProbe);
    if (milestone) {
      return `${pKey}::${milestone}`;
    }
  }

  // 8. Recurring Weekly NFL News & Beat Quote Archetypes (bounded by 36h sliding window so distinct weeks never collide)
  const isArticleOrPost = item?.type === 'article' || item?.type === 'post';
  const isDigest = isMultiTopicDigestOrRoundup(item);
  const cleanSub = isArticleOrPost && !isDigest ? cleanWireSummaryForMatching(item?.summary || '').slice(0, 175) : '';
  const leadAndSub = cleanSub ? `${lead} ${cleanSub}` : lead;
  const leadAndSubLower = leadAndSub.toLowerCase();

  // Resolve primary player whose surname actually appears in the lead headline so secondary mentions never hijack clustering
  const headlinePlayer = (item?.mentionedPlayers || []).find(mp => {
    const surname = String(mp?.name || '')
      .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
      .trim()
      .split(/\s+/)
      .slice(-1)[0];
    return surname && surname.length >= 3 && new RegExp(`\\b${escapeRegexToken(surname)}\\b`, 'i').test(lead);
  });
  const headlinePKey = headlinePlayer?.name
    ? String(headlinePlayer.name)
        .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : pKey;

  // 8a. Weekly Power Rankings roundups
  if (/\bpower rankings?\b/i.test(lead)) {
    return 'team::power_rankings';
  }

  // 8b. Weekly How to Watch / Stream / Listen / TV & Odds guides
  if (/\b(how to watch|ways to watch|watch,?\s*stream,?\s*and listen)\b/i.test(lead)) {
    return 'team::watch_guide';
  }

  // 8c. Weekly PFF Grades roundups
  if (/\bpff grades?\b/i.test(lead)) {
    return 'team::pff_grades';
  }

  // 8d. Lack of pre-game roster moves hinting positive availability news
  if (/\black of\b[\s\S]{0,20}\broster moves\b/i.test(lead)) {
    return 'team::cb_roster_moves_positive';
  }

  // 8e. Fumble challenge / non-challenge debate
  if (/\bfumble\b/i.test(lead) && /\bchalleng/i.test(lead)) {
    return 'team::fumble_challenge';
  }

  // 8f. Visiting-fan stadium takeover reactions (e.g. AT&T Stadium / Jerry Jones / Dak Prescott)
  if (
    /(?:49ers|niners|niner)\s+(?:fans?|faithful)[\s\S]{0,40}(?:takeover|took over|at&t|stadium|booed)|(?:takeover|took over)[\s\S]{0,30}(?:at&t|cowboys'? stadium)|steep ticket prices[\s\S]{0,45}49ers fan|so many 49ers fans/i.test(
      lead
    )
  ) {
    return 'team::stadium_takeover';
  }

  // 8g. High-altitude / Mexico City acclimation prep (title-only so unrelated Colorado Springs datelines never merge)
  if (/\b(altitude|7,350 feet)\b/i.test(lead)) {
    return 'team::altitude_prep';
  }

  // 8h. Post-game defensive struggles / giving up 40 points reactions
  if (
    !isDigest &&
    /\b(defensive struggles|defensive effort|defense vow|substandard showing|defense left frustrated|giving up 40|allowed 40)\b/i.test(
      lead
    )
  ) {
    return 'team::defensive_struggles_postgame';
  }

  // 8i. Historic offensive explosion / single-game yardage recaps
  if (
    !isDigest &&
    (/\b(?:584|580)\s+(?:total\s+)?yards?\b/i.test(lead) ||
      /\b(?:offensive explosion|offense racks up|broke the cowboys|make nfl history in wild win|tout ['"‘]?incredibly dangerous['"’]? offense)\b/i.test(
        lead
      )) &&
    !/\b(grades for|bonus|block)\b/i.test(lead)
  ) {
    return 'team::week_offensive_explosion';
  }

  // 8j. Player-specific trade deadline asking price reports
  if (headlinePKey && /\b(asking price|high price|2nd-round pick)\b/i.test(lead)) {
    return `${headlinePKey}::retro_trade_inquiry`;
  }

  // 8k. Player-specific practice return hope ("hoping to have X back at practice / returns to practice / flying to Colorado Springs")
  if (
    !isDigest &&
    headlinePKey &&
    /\b(hoping to have|hoping[\s\S]{0,25}returns? to practice|chance to return|hopes to get|fly(?:ing)? (?:to|into) colorado)\b/i.test(
      lead
    )
  ) {
    return `${headlinePKey}::practice_return_hope`;
  }

  // 8l. Player-specific sack drought / slow-start self-critique vs. coach defense (e.g. Nick Bosa "not playing my best" cluster)
  if (
    !isDigest &&
    headlinePlayer &&
    headlinePKey &&
    /\b(sack drought|sack-less|slow start|not playing (?:my|his) best|don['’]?t think i(?:'m|'ve| am| have) play(?:ing|ed) my best|honest admission|productive [\w\s]{2,20}\?|concern about [\w\s]{2,20} upon|first sack[\s\S]{0,35}eludes|not getting many\/any sacks)\b/i.test(
      leadAndSubLower
    )
  ) {
    return /\bshanahan\b/i.test(lead)
      ? `${headlinePKey}::coach_on_sack_drought`
      : `${headlinePKey}::sack_drought_critique`;
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
  const xPlatformBonus = isDirectXStatusUrl(item.url) ? 12 : isBlueskyPostUrl(item.url) ? -4 : 0;
  const nativeStreamBonus = item.videoStreamUrl && /^https:\/\//i.test(String(item.videoStreamUrl)) ? 8 : 0;
  return (
    tierScore +
    formatScore +
    conversationalPenalty +
    thumbBonus +
    sigBonus +
    primaryMoveBonus +
    urgencyBonus +
    xPlatformBonus +
    nativeStreamBonus
  );
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
 * - `groupSimilarStories`: `boolean` (default `true`) — when `false` (e.g. `Latest` chronological wire or
 *   when the user disables Top story grouping in Settings), deduplicates exact canonical URLs only and
 *   leaves distinct articles/tweets flat without hiding items in a similar-stories drawer.
 */
export function deduplicateAndGroupWireItems(
  items = [],
  { nowMs = Date.now(), preserveFormat = null, appData = null, gameContext = null, groupSimilarStories = true } = {}
) {
  if (!Array.isArray(items) || items.length <= 1) return items;

  // Flat exact-URL-only dedup mode (used for Latest chronological wire or when Top story grouping is turned off)
  if (groupSimilarStories === false) {
    const seenUrls = new Set();
    const flat = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const cu = canonicalComparableUrl(item.url || '');
      if (cu && !cu.includes('x.com/search?') && seenUrls.has(cu)) continue;
      if (cu) seenUrls.add(cu);
      flat.push({
        ...item,
        confirmingReports: [],
        clusterKind: undefined,
        _isLowSalienceRoundupCluster: undefined
      });
    }
    return flat;
  }

  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);

  const clusters = [];

  const matchesPreservedFormat = it => {
    if (!preserveFormat || preserveFormat === 'all') return false;
    if (preserveFormat === 'tweets') return it?.type === 'tweet' || it?.type === 'social';
    if (preserveFormat === 'articles') return it?.type === 'article' || it?.type === 'post';
    if (preserveFormat === 'videos') {
      return it?.type === 'video' || Boolean(it?.videoId) || Boolean(it?.videoStreamUrl);
    }
    return false;
  };

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const itemMs = resolveEffectivePublishTimestampMs(item, nowMs) || 0;
    const sigKey = buildStorySignatureKey(item);
    const tokens = extractHeadlineTokens(item);
    const summaryTokens = extractArticleSummaryTokens(item);
    const combinedUnigrams = new Set();
    for (const t of tokens) {
      if (!t.includes('_')) combinedUnigrams.add(t);
    }
    for (const t of summaryTokens) combinedUnigrams.add(t);
    const itemIsDigest = isMultiTopicDigestOrRoundup(item);
    const entities = extractEntitySet(item);
    const entityNameWords = new Set();
    for (const mp of item?.mentionedPlayers || []) {
      for (const part of String(mp?.name || '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length >= 3) entityNameWords.add(part);
      }
    }
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

      // Never swallow an authoritative/film/highlight standalone video card into a text article/tweet cluster (while still allowing Tier-3 vlog echoes to fold under higher-tier reports)
      const isProtectedStandaloneVideo = it =>
        (it.type === 'video' || Boolean(it.videoId)) &&
        Number(it.trustTier || 1) < 3 &&
        !/grant cohn/i.test(`${it.author || ''} ${it.outletName || ''}`);
      if (isProtectedStandaloneVideo(item) !== isProtectedStandaloneVideo(cl.lead)) {
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

      // Prevent merging items that have DIFFERENT explicit player-specific injury milestones or semantic signatures
      if (sigKey && cl.sigKey && sigKey !== cl.sigKey) {
        continue;
      }

      // 2c. Distinct playable videos (e.g. 2:20 quick recap vs 15:15 full NFL game mashup vs 12:38 radio mashup
      //     vs 1:10 Jordan Watkins / 0:58 Jaden Dugger / 2:59 Brock Purdy player highlight cutups) MUST remain
      //     separate video cards rather than getting swallowed into text `confirmingReports`! Only merge two
      //     videos when they are syndicated twin uploads of the exact same clip (matching entities, ~same runtime, Jaccard >= 0.80).
      const itemIsVideo = item.type === 'video' || Boolean(item.videoId) || Boolean(item.videoStreamUrl);
      const leadIsVideo = cl.lead.type === 'video' || Boolean(cl.lead.videoId) || Boolean(cl.lead.videoStreamUrl);
      if (itemIsVideo && leadIsVideo) {
        if (item.videoId && cl.lead.videoId && item.videoId === cl.lead.videoId) {
          matchedCluster = cl;
          bestSim = 1.0;
          break;
        }
        if (item.videoStreamUrl && cl.lead.videoStreamUrl && item.videoStreamUrl === cl.lead.videoStreamUrl) {
          matchedCluster = cl;
          bestSim = 1.0;
          break;
        }
        const parseDurSec = d => {
          const p = String(d || '').trim().split(':').map(Number);
          if (p.length === 2 && p.every(Number.isFinite)) return p[0] * 60 + p[1];
          if (p.length === 3 && p.every(Number.isFinite)) return p[0] * 3600 + p[1] * 60 + p[2];
          return null;
        };
        const durA = parseDurSec(item.duration);
        const durB = parseDurSec(cl.lead.duration);
        const normPlayerKeys = arr =>
          Array.from(
            new Set(
              (arr || [])
                .map(mp =>
                  String(mp?.name || mp?.id || '')
                    .toLowerCase()
                    .replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
                    .replace(/[^a-z0-9]/g, '')
                )
                .filter(Boolean)
            )
          ).sort();
        const pA = normPlayerKeys(item.mentionedPlayers);
        const pB = normPlayerKeys(cl.lead.mentionedPlayers);
        const samePlayers = pA.length === pB.length && pA.every((k, idx) => k === pB[idx]);
        const sameRuntime = durA !== null && durB !== null ? Math.abs(durA - durB) <= 20 : false;
        const isTwinVideoUpload =
          samePlayers &&
          (durA === null || durB === null || sameRuntime) &&
          tokSim.jaccard >= (sameRuntime ? 0.8 : 0.88);
        if (isTwinVideoUpload && tokSim.jaccard > bestSim) {
          bestSim = tokSim.jaccard;
          matchedCluster = cl;
        }
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
        continue;
      }

      // 3b. Summary-assisted Same-Entity Bridge for paraphrased beat articles within 24h
      //     (e.g. headline "makes honest admission about slow start" + summary "not playing his best... first sack"
      //      matching "Nick Bosa: I don't think I've played my best football").
      //     Requires non-entity content tokens to overlap so sharing 2 player names (4 name tokens) never falsely bridges!
      const itemIsArt = item.type === 'article' || item.type === 'post';
      const leadIsArt = cl.lead.type === 'article' || cl.lead.type === 'post';
      if (
        itemIsArt &&
        leadIsArt &&
        !itemIsDigest &&
        !cl.isDigest &&
        entSim.jaccard >= 0.34 &&
        (!itemMs || !cl.anchorMs || Math.abs(cl.anchorMs - itemMs) <= 24 * 3_600_000)
      ) {
        const subSim = setOverlapSimilarity(combinedUnigrams, cl.combinedUnigrams);
        let sharedContentCount = 0;
        for (const t of combinedUnigrams) {
          if (cl.combinedUnigrams.has(t) && !entityNameWords.has(t)) sharedContentCount += 1;
        }
        const summaryBridgeScore = 0.55 * subSim.jaccard + 0.45 * entSim.jaccard;
        if (
          sharedContentCount >= 3 &&
          (subSim.jaccard >= 0.28 || subSim.containment >= 0.5) &&
          summaryBridgeScore >= 0.38 &&
          summaryBridgeScore > bestSim
        ) {
          bestSim = summaryBridgeScore;
          matchedCluster = cl;
        }
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
        isDigest: itemIsDigest,
        anchorMs: itemMs,
        oldestMs: itemMs,
        newestMs: itemMs,
        tokens: new Set(tokens),
        combinedUnigrams: new Set(combinedUnigrams),
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
    for (const t of combinedUnigrams) matchedCluster.combinedUnigrams.add(t);
    for (const e of entities) matchedCluster.entities.add(e);

    const existingQual = scoreClusterLeadQuality(matchedCluster.lead);
    const candQual = scoreClusterLeadQuality(item);
    const existingMs = resolveEffectivePublishTimestampMs(matchedCluster.lead, nowMs) || 0;
    const xUpgradesBskyLead =
      isDirectXStatusUrl(item.url) &&
      isBlueskyPostUrl(matchedCluster.lead.url) &&
      (Number(item.trustTier) || 2) <= (Number(matchedCluster.lead.trustTier) || 2);
    const candidateIsBetterLead =
      xUpgradesBskyLead ||
      candQual > existingQual + 5 ||
      (Math.abs(candQual - existingQual) <= 5 &&
        !isBlueskyPostUrl(item.url) &&
        itemMs > existingMs + 15 * 60_000 &&
        String(item.fullText || item.title || '').length >=
          String(matchedCluster.lead.fullText || matchedCluster.lead.title || '').length * 0.75);

    if (candidateIsBetterLead) {
      const demotedPrev = { ...matchedCluster.lead };
      const priorConfirming = Array.isArray(demotedPrev.confirmingReports) ? demotedPrev.confirmingReports : [];
      delete demotedPrev.confirmingReports;
      const bestClusterImg = isEditorialPhotoUrl(item.imageUrl)
        ? item.imageUrl
        : isEditorialPhotoUrl(demotedPrev.imageUrl)
          ? demotedPrev.imageUrl
          : item.imageUrl || demotedPrev.imageUrl || '';
      matchedCluster.lead = {
        ...item,
        imageUrl: bestClusterImg,
        videoStreamUrl: item.videoStreamUrl || demotedPrev.videoStreamUrl || undefined,
        duration: item.duration || demotedPrev.duration || undefined,
        isHighlightClip: Boolean(item.isHighlightClip || demotedPrev.isHighlightClip) || undefined,
        externalUrl: item.externalUrl || demotedPrev.externalUrl || null,
        externalTitle: item.externalTitle || demotedPrev.externalTitle || null,
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
      if (
        (!isEditorialPhotoUrl(matchedCluster.lead.imageUrl) && isEditorialPhotoUrl(item.imageUrl)) ||
        (!matchedCluster.lead.imageUrl && item.imageUrl)
      ) {
        matchedCluster.lead.imageUrl = item.imageUrl;
      }
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

  // Finalize cluster metadata, classify clusterKind (`corroboration` vs `similar`), sort related coverage, and re-rank!
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

      const isLowSalienceRoundup = /^team::(power_rankings|watch_guide|pff_grades)$/.test(cl.sigKey || '');
      const isBreakingCorroboration =
        !isLowSalienceRoundup &&
        (isUrgentBreakingBadge(lead.breakingBadge) ||
          lead.storyTier === 'tier1_major' ||
          lead.storyTier === 'tier2_roster' ||
          lead.category === 'injury' ||
          lead.category === 'roster' ||
          /::(ir_roster_move|diagnostic_imaging|recovery_timeline|in_game_injury_status|weekly_injury_report|trade_acquisition|contract_restructure|practice_return_hope|cb_roster_moves_positive)$/.test(
            cl.sigKey || ''
          ));
      lead.clusterKind = isBreakingCorroboration ? 'corroboration' : 'similar';
      lead._isLowSalienceRoundupCluster = isLowSalienceRoundup;

      const leadMs = resolveEffectivePublishTimestampMs(lead, nowMs);
      const leadAge = Number.isFinite(leadMs) ? Math.max(0, (nowMs - leadMs) / 3_600_000) : 24;
      const oldestAge = cl.oldestMs ? Math.max(0, (nowMs - cl.oldestMs) / 3_600_000) : leadAge;
      const newestAge = cl.newestMs ? Math.max(0, (nowMs - cl.newestMs) / 3_600_000) : leadAge;
      // Anchor age rewards fresh multi-source developments (<12h) while preventing >14h late reactions from resetting yesterday's story
      lead._clusterNewestAgeHours = newestAge;
      lead._clusterAnchorAgeHours =
        oldestAge > 14 ? Math.max(leadAge, oldestAge * 0.6) : 0.4 * leadAge + 0.6 * newestAge;
      const priorStoryRank = Number.isFinite(Number(lead.storyRank)) ? Number(lead.storyRank) : 0;
      const recomputedRank = computeWireStoryRank(lead, nowMs, ctx);
      lead.storyRank = isLowSalienceRoundup
        ? Math.min(priorStoryRank || recomputedRank, recomputedRank)
        : ctx
          ? recomputedRank
          : Math.max(priorStoryRank, recomputedRank);
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

const NON_ARTICLE_EXTERNAL_HOST_REGEX =
  /(^|\.)(x\.com|twitter\.com|bsky\.app|instagram\.com|threads\.net|facebook\.com|tiktok\.com|reddit\.com|t\.me|youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com|open\.spotify\.com|spotify\.com|podcasts\.apple\.com|music\.amazon\.com|megaphone\.fm|art19\.com|soundcloud\.com|omny\.fm|anchor\.fm|overcast\.fm|pocketcasts\.com)$/i;

const NON_ARTICLE_EXTERNAL_PATH_REGEX =
  /^\/(?:video|videos|watch|shorts|clips|podcast|podcasts|episodes|mlb|nba|nhl|wnba|mls|golf|tennis|soccer)(?:\/|$)|\/nfl\/player\/_\/id\/\d+/i;

const BARE_SECTION_ROOT_PATH_REGEX =
  /^\/(?:news|articles|sports|nfl|49ers|san-francisco-49ers|nfl\/san-francisco-49ers|team|roster|schedule|stats|draft|rumors|feed)?\/?$/i;

const BRAND_SOCIAL_HANDLE_SET = new Set([
  '49erswebzone',
  'nflrums',
  'nfltraderumors',
  'pfrumors',
  'profootballrumors',
  'profootballtalk',
  'nbcs49ers',
  'nbcsauthentic',
  'nbcsportsbayarea',
  'ninersnation',
  '49ers',
  'sfstandard',
  'espnnfl',
  'espn',
  'nfl',
  'nflnetwork',
  'knbr',
  '957thegame',
  'cbssports',
  'yahoosports',
  'bleacherreport',
  'si_nfl',
  'overthecap',
  'spotrac',
  'oursf49ers',
  '49ershive',
  'coach_yac'
]);

const BRAND_SOCIAL_BSKY_ACTOR_REGEX =
  /\/profile\/(49erswebzone|nfltraderumors|profootballrumors|profootballtalk|nbcs49ers|nbcsportsbayarea|ninersnation|sfstandard|espn|espnnfl|nfl|nflnetwork|49ers|knbr|957thegame|cbssports|yahoosports|overthecap|spotrac)(?:\.bsky\.social|\.com)?\//i;

const BRAND_SOCIAL_NAME_REGEX =
  /^(?:49ers webzone|nfl trade rumors|nfltraderumors\.co|pro football rumors|profootballrumors\.com|profootballtalk|nbc profootballtalk|49ers on nbcsba|nbc sports bay area|niners nation|san francisco 49ers(?: official)?|49ers\.com(?: official)?|49ers official|the sf standard|sf standard|espn(?: nfl)?|nfl network|nfl(?: beat wire)?|knbr(?: 680)?|95\.7 the game|cbs sports|yahoo sports|bleacher report|overthecap|spotrac|oursf49ers|49ershive)$/i;

const OUTLET_DOMAIN_MAP = {
  '49ers_webzone': ['49erswebzone.com'],
  nfl_trade_rumors: ['nfltraderumors.co'],
  pfrumors: ['profootballrumors.com'],
  nbcsba: ['nbcsportsbayarea.com', 'nbcsports.com'],
  niners_nation: ['ninersnation.com'],
  sf_standard: ['sfstandard.com'],
  '49ers_official': ['49ers.com'],
  espn: ['espn.com'],
  nfl_network: ['nfl.com', 'nbcsports.com'],
  knbr_radio: ['knbr.com'],
  overthecap: ['overthecap.com']
};

const LINK_DROP_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'in', 'on', 'at', 'to', 'by', 'with', 'from', 'into', 'over',
  'after', 'before', 'about', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'this', 'that', 'these', 'those', 'his', 'her', 'their', 'our', 'its', 'who', 'what', 'why', 'how', 'when',
  'where', 'will', 'can', 'could', 'would', 'should', 'may', 'might', 'not', 'no', 'more', 'most', 'very',
  '49ers', 'niners', 'san', 'francisco', 'nfl', 'read', 'story', 'article', 'link', 'here', 'via', 'per',
  'report', 'recap', 'transcript', 'update', 'updates', 'news', 'details', 'check', 'out', 'full', 'latest',
  'new', 'column', 'piece', 'shares', 'talks', 'explains', 'reveals', 'says', 'said', 'vs'
]);

const TRAILING_LINK_CTA_REGEX =
  /(?:\b(?:read|read more|read here|full story|more here|more|link|details|story|article|here)\s*[:⬇️👇➡️]*\s*$|[⬇️👇➡️🔗]\s*$|(?:https?:\/\/|www\.)\S+\s*$|\b[a-z0-9-]+\.(?:com|co|org|net|football)\/\S+\s*$)/i;

const BRAND_TEASER_HOOK_REGEX =
  /\b(?:here is (?:where|what|how|why)|joined this group|in several (?:different )?ways|in a very unique way|shares (?:his|her|their) (?:grades|thoughts|takeaways|updates)|hands out (?:team )?grades|delivers the takeaways|highlights five|what went into|sounds? off on|sends clear message|reportedly checked in on a|among several teams to inquire about a trade for this|two key 49ers players|check out the full|my latest|new column|new story|here['’]?s (?:what|why|how|where))\b/i;

const COMPLEMENTARY_STORY_POINTER_REGEX =
  /\b(?:story|article|report|column|more|full story|full breakdown|details)\s+(?:via|by|from)\s+@?[A-Za-z][A-Za-z0-9_.-]{2,28}\b/i;

const FIRST_PERSON_TWEET_ANALYSIS_REGEX =
  /\b(?:i think|my take|to me,|imo\b|imho\b|honestly,|worth noting|one thing that stood out|watched the (?:tape|all-22|film)|on the all-22|on tape,)\b/i;

const CONCRETE_STAT_OR_CAP_REGEX =
  /(?:\$\d+(?:\.\d+)?[mk]?\b|\b\d+(?:\.\d+)?%|\b\d+\s*(?:yards|yds|catches|receptions|targets|snaps|sacks|pressures|tds|touchdowns|interceptions|ints|picks|weeks|days|years|games|plays|carries|attempts)\b|\b(?:epa\/play|cpoe|dvoa|yprr|adot|pff grade)\b|[+-]0\.\d{2}\b)/gi;

/**
 * Extracts the best external link payload `{ uri, title, description, thumb }` from a Bluesky
 * feed view `post` and `record`, checking `embed.external`, `embed.media.external` (`recordWithMedia`),
 * `record.embed.external`, and inline `record.facets` (`app.bsky.richtext.facet#link`) so inline
 * article links like `sfstandard.com/2026/...` without an external card are never missed.
 */
export function extractBlueskyBestExternalLink(post = null, rec = null) {
  const extEmbed =
    post?.embed?.external ||
    post?.embed?.media?.external ||
    rec?.embed?.external ||
    rec?.embed?.media?.external ||
    null;
  if (extEmbed?.uri) {
    return {
      uri: String(extEmbed.uri || '').trim(),
      title: String(extEmbed.title || '').trim(),
      description: String(extEmbed.description || '').trim(),
      thumb: String(extEmbed.thumb || '').trim()
    };
  }
  const facets = Array.isArray(rec?.facets) ? rec.facets : [];
  let fallbackUri = '';
  for (const facet of facets) {
    for (const feat of facet?.features || []) {
      if (feat?.$type !== 'app.bsky.richtext.facet#link' || !feat?.uri) continue;
      const uri = String(feat.uri).trim();
      if (!/^https?:\/\//i.test(uri)) continue;
      if (isDirectArticleUrl(uri)) {
        return { uri, title: '', description: '', thumb: '' };
      }
      if (!fallbackUri) fallbackUri = uri;
    }
  }
  return { uri: fallbackUri, title: '', description: '', thumb: '' };
}

/**
 * Returns true strictly when `rawUrl` is a sanitized, free, direct web article URL
 * (excluding social posts, videos, podcasts, player bio profiles, shorteners, paywalls,
 * and bare homepages/section roots).
 */
export function isDirectArticleUrl(rawUrl = '') {
  const safe = sanitizeExternalUrl(rawUrl, null);
  if (!safe) return false;
  try {
    const parsed = new URL(safe);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || '/';
    if (NON_ARTICLE_EXTERNAL_HOST_REGEX.test(host)) return false;
    if (NON_ARTICLE_EXTERNAL_PATH_REGEX.test(pathname)) return false;
    if (BARE_SECTION_ROOT_PATH_REGEX.test(pathname)) return false;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return false;
    if (segments.length === 1) {
      const seg = segments[0];
      const hasQueryId = parsed.searchParams.has('id') || parsed.searchParams.has('p');
      if (!hasQueryId && (seg.length < 10 || !/[-_\d]/.test(seg))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true when an item was posted by a publication, brand, or aggregator social desk
 * (e.g., 49ers Webzone, NFL Trade Rumors, ProFootballTalk, 49ers on NBCSBA, NBC Sports Bay Area,
 * Niners Nation, 49ers.com) rather than an individual human beat reporter or NFL insider.
 */
export function isPublicationOrBrandSocialAccount(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const url = String(item.url || '').trim();
  if (BRAND_SOCIAL_BSKY_ACTOR_REGEX.test(url)) return true;

  const authorRaw = String(item.author || item.reporterName || '').trim();
  const handleClean = String(item.authorHandle || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();

  // Individual journalists in BEAT_REPORTER_DIRECTORY (except brand entries like 49ers_news or ProFootballTalk)
  const repEntry = resolveReporterFromNameOrHandle(item.reporterId || authorRaw || handleClean);
  if (repEntry) {
    if (repEntry.id === '49ers_news') return true;
    if (repEntry.id === 'mike_florio' && (/profootballtalk/i.test(authorRaw) || handleClean === 'profootballtalk')) {
      return true;
    }
    return false;
  }

  if (handleClean && BRAND_SOCIAL_HANDLE_SET.has(handleClean)) return true;
  if (authorRaw && BRAND_SOCIAL_NAME_REGEX.test(authorRaw)) return true;
  return false;
}

function cleanTweetTextForArticleComparison(rawText = '') {
  return String(rawText || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|co|org|net|football)\/\S*/gi, ' ')
    .replace(/\(\s*(?:via|per)\s+@?[A-Za-z0-9_.-]+(?:\.bsky\.social)?\s*\)/gi, ' ')
    .replace(/\b(?:via|per)\s+@?[A-Za-z0-9_.-]+\.bsky\.social\b/gi, ' ')
    .replace(/@[A-Za-z0-9_.-]+\.bsky\.social\b/gi, ' ')
    .replace(/\b(?:read|read more|read here|full story|more here|details|link|story|article)\s*[:⬇️👇➡️]*\s*$/gi, ' ')
    .replace(/#([A-Za-z0-9_]+)/g, (_, tag) => (/^(fttb|nfl|49ersfaithful|gopackgo|cowboysnation)$/i.test(tag) ? ' ' : tag))
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanArticleHeadlineCandidate(rawTitle = '') {
  return stripAggregatorBoilerplate(String(rawTitle || ''))
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|co|org|net|football)\/\S*/gi, ' ')
    .replace(/\(\s*(?:via|per)\s+@?[A-Za-z0-9_.-]+(?:\.bsky\.social)?\s*\)/gi, ' ')
    .replace(/\s*\b(?:read|read more|read here|full story|more here|link)\s*[:⬇️👇➡️]*\s*$/gi, '')
    .replace(/\s+[|–—-]\s+(?:NBC Sports Bay Area|49ers Webzone|ESPN|ProFootballTalk|NFLTradeRumors\.co|Niners Nation|The SF Standard|San Francisco 49ers)\s*$/i, '')
    .replace(/#49ers\b/gi, '49ers')
    .replace(/#([A-Z][A-Za-z0-9]+)/g, '$1')
    .replace(/\s*#(?:FTTB|NFL|49ers)\b/gi, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeArticleComparisonText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !LINK_DROP_STOPWORDS.has(w));
}

function isSameOutletArticleDomain(item = {}, targetUrl = '') {
  if (!targetUrl) return false;
  let host = '';
  try {
    host = new URL(targetUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  const outletId = String(item.outletId || '').trim().toLowerCase();
  const knownDomains = OUTLET_DOMAIN_MAP[outletId] || [];
  if (knownDomains.some(d => host === d || host.endsWith(`.${d}`))) return true;

  const authorSlug = String(item.author || item.outletName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const hostStem = host.split('.')[0].replace(/[^a-z0-9]/g, '');
  if (authorSlug.length >= 5 && hostStem.length >= 5 && (authorSlug.includes(hostStem) || hostStem.includes(authorSlug))) {
    return true;
  }
  return false;
}

function extractCreditedStaffWriterFromBrandPost(rawTweetText = '') {
  const txt = String(rawTweetText || '');
  if (!txt) return null;
  const patterns = [
    /\(\s*(?:via|per)\s+@([A-Za-z0-9_.-]+)\s*\)/i,
    /@([A-Za-z0-9_.-]+)\.bsky\.social(?:'s)?\s+(?:shares|hands out|delivers|highlights|breaks down|grades|writes|updated)/i,
    /\b(?:told|spoke (?:to|with)|joined)\s+@([A-Za-z0-9_.-]+)\.bsky\.social\b/i
  ];
  for (const rx of patterns) {
    const m = txt.match(rx);
    if (!m) continue;
    const rawActorLower = m[1].toLowerCase().trim();
    const mappedX =
      BSKY_ACTOR_TO_X_HANDLE[rawActorLower] ||
      BSKY_ACTOR_TO_X_HANDLE[`${rawActorLower}.bsky.social`] ||
      '';
    const rawCandidate = rawActorLower.replace(/\.bsky\.social$/i, '').trim();
    const resolved =
      (mappedX ? resolveReporterFromNameOrHandle(mappedX) : null) ||
      resolveReporterFromNameOrHandle(rawCandidate);
    if (resolved && !isPodiumSubjectId(resolved.id) && resolved.id !== '49ers_news') {
      return resolved;
    }
  }
  return null;
}

/**
 * Holistically classifies whether a tweet/social post exists ~90%+ strictly to provide a link
 * to a free web article (e.g., publisher/brand link-drops like 49ers Webzone `... Read:`,
 * NFL Trade Rumors / ProFootballTalk exact headline echoes, NBCSBA social-desk article teasers,
 * or individual self-promo link drops) — vs. a salient tweet containing standalone breaking news,
 * stats, quotes, threads, or original commentary where the linked article is merely complementary
 * (e.g., Adam Schefter breaking news + `Story via @BradyHenderson:`).
 */
export function isArticleLinkDropTweet(item = {}) {
  const noPromote = {
    isLinkDrop: false,
    reason: 'not_eligible',
    targetUrl: null,
    cleanTitle: '',
    cleanSummary: '',
    creditedWriter: null
  };
  if (!item || typeof item !== 'object') return noPromote;

  const isSocial =
    item.type === 'tweet' ||
    item.type === 'social' ||
    isBlueskyPostUrl(item.url) ||
    isDirectXStatusUrl(item.url);
  if (!isSocial) return noPromote;

  // Never demote playable video / highlight clips to plain articles
  if (item.videoId || item.videoStreamUrl || item.externalVideoUrl || item.isHighlightClip) {
    return { ...noPromote, reason: 'playable_video' };
  }

  const targetUrl = sanitizeExternalUrl(item.externalUrl, null);
  if (
    !targetUrl ||
    !isDirectArticleUrl(targetUrl) ||
    isPaywalledPublisher(item.outletName, targetUrl) ||
    isRedundantProfileSelfLink(targetUrl, item.url)
  ) {
    return { ...noPromote, reason: 'no_free_article_url' };
  }

  const rawTweetText = stripAggregatorBoilerplate(
    String(item.fullText || item.title || item.headline || '').trim()
  );
  const rawExtTitle = stripAggregatorBoilerplate(String(item.externalTitle || '').trim());
  const rawExtDesc = stripAggregatorBoilerplate(String(item.externalDescription || '').trim());

  // Threads are always substantive tweets
  if (/\b[1-9]\s*\/\s*[2-9]\b|🧵|\bthread\b/i.test(rawTweetText)) {
    return { ...noPromote, reason: 'thread_tweet' };
  }

  // Detect X-to-Bluesky mirror bots that copy the raw tweet body into embed.external.title with empty description
  const isMirrorBotFakeExtTitle =
    Boolean(rawExtTitle) &&
    !rawExtDesc &&
    (rawExtTitle.toLowerCase() === rawTweetText.toLowerCase() ||
      COMPLEMENTARY_STORY_POINTER_REGEX.test(rawExtTitle)) &&
    (rawTweetText.length > 125 || COMPLEMENTARY_STORY_POINTER_REGEX.test(rawTweetText));

  const strippedTweet = cleanTweetTextForArticleComparison(rawTweetText);
  const cleanExtTitle = !isMirrorBotFakeExtTitle ? cleanArticleHeadlineCandidate(rawExtTitle) : '';
  const hasUsableExtTitle =
    cleanExtTitle.length >= 18 &&
    !BRAND_SOCIAL_NAME_REGEX.test(cleanExtTitle) &&
    !/\bon X$/i.test(cleanExtTitle);

  const fallbackCleanedTweetTitle = cleanArticleHeadlineCandidate(rawTweetText);
  const resolvedArticleTitle = hasUsableExtTitle ? cleanExtTitle : fallbackCleanedTweetTitle;
  const cleanSummary =
    rawExtDesc &&
    rawExtDesc.length >= 20 &&
    rawExtDesc.toLowerCase() !== resolvedArticleTitle.toLowerCase()
      ? rawExtDesc.slice(0, 300)
      : '';

  const isBrandAccount = isPublicationOrBrandSocialAccount(item);
  const sameOutletDomain = isSameOutletArticleDomain(item, targetUrl);
  const creditedWriter = isBrandAccount ? extractCreditedStaffWriterFromBrandPost(rawTweetText) : null;

  const tweetTokens = new Set(tokenizeArticleComparisonText(strippedTweet));
  const extTitleTokens = new Set(tokenizeArticleComparisonText(cleanExtTitle));
  let sharedCount = 0;
  const novelWords = [];
  for (const w of tweetTokens) {
    if (extTitleTokens.has(w)) sharedCount += 1;
    else novelWords.push(w);
  }
  const tweetContainment = tweetTokens.size > 0 ? sharedCount / tweetTokens.size : 0;
  const extTitleContainment = extTitleTokens.size > 0 ? sharedCount / extTitleTokens.size : 0;
  const unionSize = tweetTokens.size + extTitleTokens.size - sharedCount;
  const jaccard = unionSize > 0 ? sharedCount / unionSize : 0;

  const sentenceCount = strippedTweet
    ? strippedTweet.split(/[.!?]+(?:\s+|$)/).filter(s => s.trim().length >= 12).length
    : 0;
  const tweetStatHits = strippedTweet.match(CONCRETE_STAT_OR_CAP_REGEX) || [];
  const extTitleLower = cleanExtTitle.toLowerCase();
  const hasNovelStatsOrCap = tweetStatHits.some(hit => !extTitleLower.includes(hit.toLowerCase()));
  const hasDirectQuote = /["“][^"”]{28,}["”]/.test(rawTweetText);
  const hasComplementaryPointer = COMPLEMENTARY_STORY_POINTER_REGEX.test(rawTweetText);
  const hasFirstPersonAnalysis = FIRST_PERSON_TWEET_ANALYSIS_REGEX.test(strippedTweet);
  const hasTrailingCta = TRAILING_LINK_CTA_REGEX.test(rawTweetText);
  const hasTeaserHook = BRAND_TEASER_HOOK_REGEX.test(strippedTweet);

  // 1. Empty or CTA-only link drop (tweet contains virtually no prose besides URL / "Read:")
  if (strippedTweet.length < 18) {
    return {
      isLinkDrop: true,
      reason: 'empty_or_cta_only',
      targetUrl,
      cleanTitle: resolvedArticleTitle,
      cleanSummary,
      creditedWriter
    };
  }

  // 2. Publication / brand / aggregator social-desk account linking to a free article
  if (isBrandAccount) {
    const isRichStandaloneBrandReport =
      strippedTweet.length >= 240 &&
      sentenceCount >= 3 &&
      hasNovelStatsOrCap &&
      !hasTrailingCta &&
      !hasTeaserHook;
    if (!isRichStandaloneBrandReport) {
      return {
        isLinkDrop: true,
        reason: 'brand_article_link_drop',
        targetUrl,
        cleanTitle: resolvedArticleTitle,
        cleanSummary,
        creditedWriter
      };
    }
    return { ...noPromote, reason: 'brand_standalone_report' };
  }

  // --- Individual human beat reporters & NFL insiders below ---
  // Protect salient tweets that deliver standalone news/stats/commentary with a complementary link
  if (hasComplementaryPointer || hasFirstPersonAnalysis || hasNovelStatsOrCap) {
    return { ...noPromote, reason: 'salient_individual_tweet' };
  }

  // 3. Individual journalist exact or near-exact headline echo (no substantive added commentary)
  if (
    hasUsableExtTitle &&
    !hasDirectQuote &&
    (tweetContainment >= 0.72 || jaccard >= 0.6) &&
    novelWords.length <= 5
  ) {
    return {
      isLinkDrop: true,
      reason: 'headline_echo_link_drop',
      targetUrl,
      cleanTitle: resolvedArticleTitle,
      cleanSummary,
      creditedWriter: null
    };
  }

  // 4. Individual journalist explicit self-promo teaser dropping a link to their own publication's article
  const hasStandaloneBreakingFact =
    TIER1_MAJOR_BREAKING_EVENT_REGEX.test(strippedTweet) ||
    TIER2_ROSTER_OR_STATUS_MOVE_REGEX.test(strippedTweet) ||
    IN_GAME_INJURY_RETURN_REGEX.test(strippedTweet) ||
    POST_GAME_INJURY_FOLLOWUP_REGEX.test(strippedTweet) ||
    PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(strippedTweet) ||
    PRE_GAME_PLAY_AVAILABILITY_REGEX.test(strippedTweet);
  const hasInlineOwnDomainSlugAtEnd =
    sameOutletDomain &&
    /(?:https?:\/\/|www\.)?\b[a-z0-9-]+\.(?:com|co|org|net|football)\/\S+\s*$/i.test(rawTweetText);
  if (
    sameOutletDomain &&
    hasTrailingCta &&
    !hasDirectQuote &&
    !hasStandaloneBreakingFact &&
    sentenceCount <= 2 &&
    strippedTweet.length <= 185 &&
    (hasTeaserHook ||
      hasInlineOwnDomainSlugAtEnd ||
      /\b(?:my latest|new column|new story|new piece|here['’]?s my|wrote about|for @?[a-z0-9_]+)\b/i.test(rawTweetText) ||
      (hasUsableExtTitle && Math.max(tweetContainment, extTitleContainment) >= 0.45 && novelWords.length <= 12))
  ) {
    return {
      isLinkDrop: true,
      reason: 'self_promo_article_link_drop',
      targetUrl,
      cleanTitle: resolvedArticleTitle,
      cleanSummary,
      creditedWriter: null
    };
  }

  return { ...noPromote, reason: 'salient_individual_tweet' };
}

/**
 * Promotes a pure link-drop tweet into a first-class `'article'` item linking directly to the
 * canonical article URL (removing the intermediate social hop and redundant `Article:` chip),
 * while leaving salient tweets with complementary links completely untouched as `'tweet'`.
 */
export function promoteLinkDropTweetToArticle(item = {}) {
  const verdict = isArticleLinkDropTweet(item);
  if (!verdict.isLinkDrop || !verdict.targetUrl) return item;

  const promotedTitle = verdict.cleanTitle || item.title || item.headline || '49ers Story';
  const promotedSummary = verdict.cleanSummary || '';
  const writer = verdict.creditedWriter;

  const promoted = {
    ...item,
    type: 'article',
    url: verdict.targetUrl,
    promotedFromSocialUrl: item.promotedFromSocialUrl || item.url || null,
    title: promotedTitle,
    ...(item.headline !== undefined ? { headline: promotedTitle } : {}),
    fullText: undefined,
    isFullTweet: false,
    summary: promotedSummary,
    externalUrl: null,
    externalTitle: null,
    externalDescription: item.externalDescription || promotedSummary || null
  };

  if (writer) {
    promoted.reporterId = writer.id;
    promoted.reporterName = writer.name;
    promoted.author = writer.name;
    promoted.authorHandle = writer.handle || promoted.authorHandle;
    promoted.trustTier = Math.min(Number(promoted.trustTier) || 2, writer.trustTier || 2);
  }

  promoted.authorProfileUrl = resolveItemAuthorProfileUrl(promoted, verdict.targetUrl);
  promoted.category = classifyNewsItemCategory(promoted);
  return promoted;
}

/**
 * Stream-level reconciliation pass that:
 * 1. Promotes every eligible link-drop tweet into a direct `'article'` linking straight to the article.
 * 2. Cross-matches any remaining brand/aggregator link-drop tweet (for example, when a live client
 *    Bluesky embed used an unexpanded `dlvr.it` shortener) against direct `'article'` items already
 *    in the stream with a matching headline/outlet, collapsing the redundant social link-drop into
 *    the canonical direct article while preserving any richer thumbnail or player tags.
 */
export function reconcileLinkDropTweetsWithArticles(items = []) {
  if (!Array.isArray(items) || items.length === 0) return items;

  const pass1 = items.map(it => (it && typeof it === 'object' ? promoteLinkDropTweetToArticle(it) : it));

  const articleEntries = [];
  for (const it of pass1) {
    if (!it || (it.type !== 'article' && it.type !== 'post')) continue;
    if (!isDirectArticleUrl(it.url)) continue;
    const tokens = new Set(tokenizeArticleComparisonText(cleanArticleHeadlineCandidate(it.title || '')));
    if (tokens.size < 2) continue;
    articleEntries.push({
      item: it,
      tokens,
      outletKey: String(it.outletId || it.outletName || '').toLowerCase(),
      pubMs: it.publishedAt ? Date.parse(it.publishedAt) : NaN
    });
  }

  if (articleEntries.length === 0) return pass1;

  const reconciled = [];
  for (const it of pass1) {
    if (!it || typeof it !== 'object') continue;
    const isRemainingBrandSocial =
      (it.type === 'tweet' || it.type === 'social') &&
      !it.videoId &&
      !it.videoStreamUrl &&
      !it.externalVideoUrl &&
      isPublicationOrBrandSocialAccount(it);

    if (!isRemainingBrandSocial) {
      reconciled.push(it);
      continue;
    }

    const twTokens = new Set(
      tokenizeArticleComparisonText(
        cleanTweetTextForArticleComparison(it.fullText || it.title || it.externalTitle || '')
      )
    );
    const twOutletKey = String(it.outletId || it.outletName || '').toLowerCase();
    const twPubMs = it.publishedAt ? Date.parse(it.publishedAt) : NaN;

    let matchedArticle = null;
    if (twTokens.size >= 2) {
      for (const art of articleEntries) {
        if (Number.isFinite(twPubMs) && Number.isFinite(art.pubMs) && Math.abs(twPubMs - art.pubMs) > 36 * 3_600_000) {
          continue;
        }
        let shared = 0;
        for (const w of twTokens) {
          if (art.tokens.has(w)) shared += 1;
        }
        const minLen = Math.min(twTokens.size, art.tokens.size);
        const containment = minLen > 0 ? shared / minLen : 0;
        const jaccard = shared / (twTokens.size + art.tokens.size - shared);
        const sameOutlet = Boolean(twOutletKey && art.outletKey && twOutletKey === art.outletKey);
        if (
          (sameOutlet && (containment >= 0.72 || jaccard >= 0.58)) ||
          (shared >= 4 && containment >= 0.82 && jaccard >= 0.68)
        ) {
          matchedArticle = art.item;
          break;
        }
      }
    }

    if (matchedArticle) {
      // Preserve richer thumbnail, player matches, and social-upgrade mapping onto the canonical direct article
      if (!matchedArticle.imageUrl && it.imageUrl && /^https:\/\//i.test(it.imageUrl)) {
        matchedArticle.imageUrl = it.imageUrl;
      }
      if (!matchedArticle.promotedFromSocialUrl && it.url) {
        matchedArticle.promotedFromSocialUrl = it.url;
      }
      if ((!matchedArticle.mentionedPlayers || matchedArticle.mentionedPlayers.length === 0) && it.mentionedPlayers?.length) {
        matchedArticle.mentionedPlayers = it.mentionedPlayers;
      }
      continue;
    }

    reconciled.push(it);
  }

  return reconciled;
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
    if (!g || g.completed || g.isByeWeek || g.opponent?.isTbd || String(g.opponent?.abbr || '').toUpperCase() === 'TBD') {
      continue;
    }
    const statusLower = String(g.statusDetail || '').toLowerCase();
    if (/\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/.test(statusLower)) {
      return true;
    }
    const koMs = g.dateIso ? new Date(g.dateIso).getTime() : NaN;
    if (Number.isFinite(koMs)) {
      if (nowMs >= koMs - 95 * 60_000 && nowMs <= koMs + 4.5 * 3600_000) {
        return true;
      }
    }
  }

  const umOppUpper = String(upcoming.oppAbbr || upcoming.opponent?.abbr || '').toUpperCase();
  const hasMatchedScheduleEntry = schedule.some(g => g && Number(g.week) === Number(upcoming.week));
  if (
    !hasMatchedScheduleEntry &&
    !upcoming.completed &&
    !upcoming.isByeWeek &&
    !upcoming.isTbd &&
    !upcoming.seasonConcluded &&
    umOppUpper !== 'BYE' &&
    umOppUpper !== 'TBD'
  ) {
    const upKoMs =
      upcoming.dateIso || upcoming.kickoffIso
        ? new Date(upcoming.dateIso || upcoming.kickoffIso).getTime()
        : NaN;
    if (Number.isFinite(upKoMs) && nowMs >= upKoMs - 95 * 60_000 && nowMs <= upKoMs + 4.5 * 3600_000) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true when a video (`item.type === 'video'` or `item.videoId`) is from a prior game slate
 * (e.g. 2+ weeks ago or published before the most recently completed 49ers game) so `Highlights & Videos`
 * and `Film & Trench` refresh cleanly after every completed game while remaining populated in the offseason.
 */
export function isStalePriorGameVideo(item = {}, appData = null, nowMs = Date.now()) {
  if (!item || (item.type !== 'video' && !item.videoId && !item.videoStreamUrl)) return false;

  const pubMs = resolveEffectivePublishTimestampMs(item, nowMs);
  const ageDays = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 86_400_000) : 99;
  const summaryAgeStr = String(item.summary || '');

  if (!appData || typeof appData !== 'object') {
    if (/\b([2-9]\d*\s*w(?:eeks?|ks?)|\d+\s*mo(?:nths?)?|\d+\s*y(?:ears?|rs?))\s+ago\b/i.test(summaryAgeStr)) {
      return true;
    }
    return ageDays > 12;
  }

  const ctx = resolveGameNewsContext(appData, nowMs);
  const latestCompKoMs = ctx.latestCompletedKickoffMs;
  const latestCompWk = ctx.latestCompletedWeek;
  const upcomingWk = ctx.upcomingWeek;
  const latestOppNick = String(ctx.latestCompletedOppNickname || '').trim();
  const upcomingOppNick = String(ctx.upcomingOppNickname || '').trim();
  const isOffseasonWindow =
    Boolean(appData?.scheduleMatchup?.upcomingMatchup?.seasonConcluded) ||
    ((!Number.isFinite(ctx.upcomingKickoffMs) || (ctx.upcomingKickoffMs - nowMs) / 86_400_000 > 21) &&
      (!Number.isFinite(latestCompKoMs) || (nowMs - latestCompKoMs) / 86_400_000 > 21));

  if (isOffseasonWindow) {
    if (/\b([4-9]\d*\s*mo(?:nths?)?|\d+\s*y(?:ears?|rs?))\s+ago\b/i.test(summaryAgeStr)) {
      return true;
    }
    return ageDays > 90;
  }

  if (/\b([2-9]\d*\s*w(?:eeks?|ks?)|\d+\s*mo(?:nths?)?|\d+\s*y(?:ears?|rs?))\s+ago\b/i.test(summaryAgeStr)) {
    return true;
  }

  if (Number.isFinite(latestCompKoMs)) {
    const daysSinceCompletedGame = (nowMs - latestCompKoMs) / 86_400_000;
    // If a game completed within the last 10 days, any video published before that game kicked off is from an older week/pre-game slate
    if (daysSinceCompletedGame >= 0 && daysSinceCompletedGame <= 10.5) {
      if (Number.isFinite(pubMs) && pubMs < latestCompKoMs - 45 * 60_000) {
        return true;
      }
    }
    // Even across a Bye week (10.5..16 days since last game), reject anything >13 days old
    if (daysSinceCompletedGame > 10.5 && daysSinceCompletedGame <= 17 && ageDays > 13) {
      return true;
    }
  }

  // Guard against re-uploaded or search-surfaced videos explicitly tied ONLY to an older completed week/opponent
  const title = String(item.title || item.headline || '').trim();
  const refWeeks = extractReferencedWeekNumbers(title);
  if (refWeeks.length > 0 && latestCompWk) {
    const mentionsLatestOrUpcomingWk = refWeeks.some(
      w => w === latestCompWk || (upcomingWk && w === upcomingWk) || w > latestCompWk
    );
    const mentionsOlderCompletedWk = refWeeks.some(w => w < latestCompWk);
    if (mentionsOlderCompletedWk && !mentionsLatestOrUpcomingWk) {
      return true;
    }
  }

  const schedule = appData?.scheduleMatchup?.schedule || [];
  if (latestCompWk && schedule.length > 0) {
    const mentionsCurrentOrNextOpp =
      (latestOppNick && new RegExp(`\\b${escapeRegexToken(latestOppNick)}\\b`, 'i').test(title)) ||
      (upcomingOppNick && new RegExp(`\\b${escapeRegexToken(upcomingOppNick)}\\b`, 'i').test(title));
    if (!mentionsCurrentOrNextOpp && refWeeks.length === 0) {
      for (const g of schedule) {
        if (!g?.completed || g.isByeWeek || Number(g.week) >= latestCompWk) continue;
        const oldNick = extractTeamNickname(g.opponent?.name || '');
        const oldAbbr = String(g.opponent?.abbr || '').toUpperCase();
        if (
          oldAbbr &&
          oldAbbr !== ctx.latestCompletedOppAbbr &&
          oldAbbr !== ctx.upcomingOppAbbr &&
          ((oldNick && new RegExp(`\\b${escapeRegexToken(oldNick)}\\b`, 'i').test(title)) ||
            new RegExp(`\\b(?:in|vs\\.?|at)\\s+${escapeRegexToken(oldAbbr)}\\b`, 'i').test(title))
        ) {
          return true;
        }
      }
    }
  }

  return ageDays > 16;
}

/**
 * Filters out stale prior-game videos across a list of news/video items while keeping all non-video items intact.
 */
export function filterFreshVideosForCurrentSlate(items = [], appData = null, nowMs = Date.now()) {
  if (!Array.isArray(items) || items.length === 0) return items;
  let fresh = items.filter(it => !isStalePriorGameVideo(it, appData, nowMs));
  // Safety floor right after final whistle (while ESPN/49ers.com clips are transcoding or on stadium Wi-Fi)
  // and during Bye / offseason lulls: never drop `Highlights & Videos` or `Film & Trench` videos to 0 items
  // when recent clips exist in `items`.
  const isVid = it => it?.type === 'video' || Boolean(it?.videoId) || Boolean(it?.videoStreamUrl);
  const isHighlightVid = it => isVid(it) && it?.category !== 'film';
  const isFilmVid = it => isVid(it) && it?.category === 'film';
  if (!fresh.some(isHighlightVid) && items.some(isHighlightVid)) {
    const recentHighlights = items
      .filter(it => {
        if (!isHighlightVid(it)) return false;
        const pMs = resolveEffectivePublishTimestampMs(it, nowMs);
        return Number.isFinite(pMs) && nowMs - pMs <= 14 * 86_400_000;
      })
      .sort((a, b) => (resolveEffectivePublishTimestampMs(b, nowMs) || 0) - (resolveEffectivePublishTimestampMs(a, nowMs) || 0))
      .slice(0, 6);
    if (recentHighlights.length > 0) {
      fresh = [...fresh, ...recentHighlights];
    }
  }
  if (!fresh.some(isFilmVid) && items.some(isFilmVid)) {
    const recentFilm = items
      .filter(it => {
        if (!isFilmVid(it)) return false;
        const pMs = resolveEffectivePublishTimestampMs(it, nowMs);
        return Number.isFinite(pMs) && nowMs - pMs <= 45 * 86_400_000;
      })
      .sort((a, b) => (resolveEffectivePublishTimestampMs(b, nowMs) || 0) - (resolveEffectivePublishTimestampMs(a, nowMs) || 0))
      .slice(0, 6);
    if (recentFilm.length > 0) {
      fresh = [...fresh, ...recentFilm];
    }
  }
  return fresh;
}

/**
 * Ranks non-film videos for `Highlights & Videos` so Game Highlights, Condensed/End-of-Game Recaps,
 * 49Hours / Forty Niner Way, Mic'd Up, Locker Room Victory Speeches, and Player Highlight Reels lead first.
 */
export function scoreHighlightAndTeamVideoSalience(item = {}, appData = null, nowMs = Date.now()) {
  if (!item || typeof item !== 'object') return 0;
  const title = String(item.title || item.headline || '').trim();
  const channel = String(item.outletName || item.author || '').trim();
  const pubMs = resolveEffectivePublishTimestampMs(item, nowMs);
  const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 96;
  const ctx = appData ? resolveGameNewsContext(appData, nowMs) : null;

  let score = 40;

  const isInterviewOrPodium =
    /\b(press conference|media availability|reflects on|chats about|breaks down win|previews week|shares final updates|speak ahead|talk new additions|on first career touchdown|taking on bigger role|you['’]?ve got mail|inside the oval|writing a novel)\b/i.test(
      title
    ) && !/\b(forty niner way|49hours|mic['’]?d up|from the trenches|inside the 49ers locker room)\b/i.test(title);

  const isPlayerHighlightOrBigPlayClip =
    !isInterviewOrPodium &&
    ((item.mentionedPlayers?.length || 0) > 0 || /\b(best plays|every completed pass|every throw|pick[- ]?6|interceptions?|\btd\b|end zone)\b/i.test(title)) &&
    /\b(highlights|best plays|every completed pass|every throw|every catch|rushing highlights|receiving highlights|pick[- ]?6|interceptions?|touchdowns?|\btd\b|end zone|big catch|sacks?)\b/i.test(
      title
    );

  if (!isInterviewOrPodium && /\b(game highlights|full game highlights|condensed game|end of game|final drive|outlast|back-and-forth thriller)\b/i.test(title)) {
    score += 58;
  } else if (isPlayerHighlightOrBigPlayClip) {
    score += 53;
  } else if (!isInterviewOrPodium && /\b(\bhighlights\b|best plays|every touchdown|top plays)\b/i.test(title)) {
    score += 55;
  } else if (/\b(forty niner way|49hours|brick by brick|mic['’]?d up|inside the 49ers locker room|locker room|victory speech|from the trenches|sights and sounds|wired|postgame recap|week \d+ recap|game recap)\b/i.test(title)) {
    score += 46;
  } else if (HIGHLIGHT_AND_TEAM_INTEREST_VIDEO_REGEX.test(title) || SALIENT_INTERVIEW_OR_FEATURE_REGEX.test(title)) {
    score += 24;
  } else if (/\b(preview|talk new additions|speak ahead)\b/i.test(title)) {
    score += 14;
  }

  if (/^(?:nfl|san francisco 49ers)$/i.test(channel)) {
    score += 14;
  } else if (/nbc sports bay area|espn|fox sports|cbs sports|knbr|forever faithful|san francisco 49ers fans/i.test(channel)) {
    score += 10;
  }

  if (ctx?.latestCompletedOppNickname && new RegExp(`\\b${escapeRegexToken(ctx.latestCompletedOppNickname)}\\b`, 'i').test(title)) {
    score += 10;
  }
  if (ctx?.upcomingOppNickname && new RegExp(`\\b${escapeRegexToken(ctx.upcomingOppNickname)}\\b`, 'i').test(title)) {
    score += 6;
  }

  // Freshness boost (<24h) + real decay so brand-new post-game TD clips, recaps, and mid-week 49Hours episodes
  // immediately lead while Sunday game highlights still stay ahead of routine midweek podium pressers
  score += 24 * Math.pow(0.5, ageHours / 16) - Math.min(26, ageHours * 0.28);

  if (
    ctx?.latestCompletedKickoffMs &&
    Number.isFinite(pubMs) &&
    pubMs < ctx.latestCompletedKickoffMs - 45 * 60_000
  ) {
    score -= 55;
  }

  return Number(score.toFixed(2));
}

/**
 * Determines whether an active breaking news item is ALREADY covered by `dailyBrief`.
 * Used so brand-new breaking news that lands after/outside the daily AI brief surfaces at #1 ABOVE the brief
 * until the next daily AI summary incorporates it.
 */
export function isBreakingItemCoveredInBrief(item = {}, dailyBrief = null, nowMs = Date.now()) {
  if (!item || !dailyBrief || typeof dailyBrief !== 'object') return false;

  const coveredUrls = new Set(
    [
      ...(Array.isArray(dailyBrief.coveredUrls) ? dailyBrief.coveredUrls : []),
      ...(Array.isArray(dailyBrief.sources) ? dailyBrief.sources.map(s => s?.url) : [])
    ]
      .map(u => canonicalComparableUrl(u || ''))
      .filter(Boolean)
  );

  const itemComparable = canonicalComparableUrl(item.url || '');
  const extComparable = canonicalComparableUrl(item.externalUrl || '');
  if ((itemComparable && coveredUrls.has(itemComparable)) || (extComparable && coveredUrls.has(extComparable))) {
    return true;
  }
  for (const cr of item.confirmingReports || []) {
    const crUrl = canonicalComparableUrl(cr?.url || '');
    if (crUrl && coveredUrls.has(crUrl)) return true;
  }

  const coveredStoryKeys = new Set(Array.isArray(dailyBrief.coveredStoryKeys) ? dailyBrief.coveredStoryKeys : []);
  const sigKey = buildStorySignatureKey(item);
  if (sigKey && coveredStoryKeys.has(sigKey)) {
    return true;
  }

  const briefGenMs = dailyBrief.generatedAt ? Date.parse(dailyBrief.generatedAt) : NaN;
  const itemPubMs = resolveEffectivePublishTimestampMs(item, nowMs);
  // If the breaking item was published AFTER the daily brief was generated (and matched neither URL nor story signature),
  // it is brand-new breaking news not yet covered in the brief!
  if (Number.isFinite(briefGenMs) && Number.isFinite(itemPubMs) && itemPubMs > briefGenMs + 90_000) {
    return false;
  }

  // For items published BEFORE the daily brief was generated, check if the brief prose already discusses the primary player/topic
  const briefProseLower = [
    dailyBrief.headline || '',
    dailyBrief.summary || '',
    ...(Array.isArray(dailyBrief.bullets) ? dailyBrief.bullets : [])
  ]
    .join(' ')
    .toLowerCase();

  const primaryPlayerName = String(item.mentionedPlayers?.[0]?.name || '').trim();
  if (primaryPlayerName && primaryPlayerName.length >= 5) {
    const cleanFull = primaryPlayerName.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').toLowerCase();
    const surname = cleanFull.split(/\s+/).slice(-1)[0] || '';
    if (briefProseLower.includes(cleanFull) || (surname.length >= 5 && briefProseLower.includes(surname))) {
      return true;
    }
  }

  return false;
}

export const GAME_DAY_ABOVE_BRIEF_LEAD_MS = 90 * 60_000; // 90 minutes prior to kickoff

export function getPacificClockParts(nowMs = Date.now()) {
  const safeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(safeMs));
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const hourRaw = parseInt(map.hour || '0', 10);
    const hour = Number.isFinite(hourRaw) ? hourRaw % 24 : 0;
    const minRaw = parseInt(map.minute || '0', 10);
    return {
      dateKey: `${map.year}-${map.month}-${map.day}`,
      hour24: hour,
      minute: Number.isFinite(minRaw) ? minRaw : 0
    };
  } catch {
    const d = new Date(safeMs);
    return {
      dateKey: d.toISOString().slice(0, 10),
      hour24: d.getUTCHours(),
      minute: d.getUTCMinutes()
    };
  }
}

export function formatGameBriefCycleSlug(game = {}) {
  const st = String(game?.seasonType || 'REG').toUpperCase();
  const wk = Number(game?.week || 0);
  if (st === 'PRE' || wk < 0) {
    const preNum = Number(game?.preseasonWeek) || Math.max(1, Math.abs(wk));
    return `pre${preNum}`;
  }
  if (st === 'POST' || wk >= 19) {
    return `post${wk || 19}`;
  }
  return `wk${Math.max(1, wk || 1)}`;
}

function collectScheduleGamesForBrief(appData = null) {
  if (!appData || typeof appData !== 'object') return [];
  const rawSched = Array.isArray(appData?.scheduleMatchup?.schedule)
    ? appData.scheduleMatchup.schedule
    : [];
  const out = [];
  const seenKeys = new Set();

  for (const g of rawSched) {
    if (!g || g.isByeWeek || g.opponent?.isTbd || String(g.opponent?.abbr || '').toUpperCase() === 'TBD') continue;
    const koIso = g.dateIso || g.kickoffIso || '';
    const koMs = koIso ? Date.parse(koIso) : NaN;
    if (!Number.isFinite(koMs)) continue;
    const key = `${String(g.seasonType || 'REG').toUpperCase()}:${Number(g.week || 0)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push({ game: g, koMs, key });
  }

  const um = appData?.scheduleMatchup?.upcomingMatchup;
  const umOpp = String(um?.oppAbbr || '').toUpperCase();
  if (um && umOpp && umOpp !== 'BYE' && umOpp !== 'TBD' && !um.isTbd && !um.seasonConcluded) {
    const umIso = um.dateIso || um.kickoffIso || '';
    const umKoMs = umIso ? Date.parse(umIso) : NaN;
    const umKey = `REG:${Number(um.week || 0)}`;
    if (Number.isFinite(umKoMs) && !seenKeys.has(umKey)) {
      out.push({
        game: {
          week: Number(um.week || appData?.meta?.currentWeek || 1),
          seasonType: 'REG',
          dateIso: umIso,
          completed: Boolean(um.completed),
          statusState: um.liveState || (um.isGameInProgress ? 'in' : 'pre'),
          statusDetail: um.isGameInProgress ? 'In Progress' : '',
          opponent: { abbr: um.oppAbbr, name: um.oppName || um.oppAbbr }
        },
        koMs: umKoMs,
        key: umKey
      });
    }
  }

  out.sort((a, b) => a.koMs - b.koMs);
  return out;
}

/**
 * Resolves the schedule-aware Daily News Brief cycle key and game-day hold/post-game state.
 * - Non-game days: advances at `peakHourPt` (`17:00 PT` = 5:00 PM PT) to `YYYY-MM-DD@17PT`.
 * - Game days (variable kickoff times — morning international, 10:00 AM PT, 1:05/1:25 PM PT, 5:15/5:20 PM PT TNF/SNF/MNF):
 *   Holds on the prior cycle throughout `[T-90m, Final + podium buffer)`—never firing prematurely before or during a game—
 *   and advances to `YYYY-MM-DD@postgame-wk{N}` once the game has completed, holding that post-game cycle through `17:00 PT` the next day.
 */
export function resolveNewsBriefCycleState(
  nowMs = Date.now(),
  appData = null,
  peakHourPt = 17
) {
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const { dateKey: todayPt, hour24: hourPt } = getPacificClockParts(ts);
  const prevDayAnchorMs = ts - (hourPt + 3) * 3_600_000;
  const { dateKey: prevDatePt } = getPacificClockParts(prevDayAnchorMs);

  const fallbackCycleKey =
    hourPt >= peakHourPt ? `${todayPt}@${peakHourPt}PT` : `${prevDatePt}@${peakHourPt}PT`;

  const games = collectScheduleGamesForBrief(appData);
  if (games.length === 0) {
    return {
      activeCycleKey: fallbackCycleKey,
      isGameDayHold: false,
      isPostGameCycle: false,
      targetGame: null,
      targetKickoffMs: null,
      postGameCycleKey: ''
    };
  }

  const rawStream = Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : [];

  const evalGameState = entry => {
    const { game, koMs } = entry;
    const gameDatePt = getPacificClockParts(koMs).dateKey;
    const slug = formatGameBriefCycleSlug(game);
    const postGameCycleKey = `${gameDatePt}@postgame-${slug}`;
    const statusStr = String(game.statusDetail || '');
    const completedFlag = Boolean(game.completed) || /\bfinal\b/i.test(statusStr);
    const completedAtMs = game.completedAt ? Date.parse(game.completedAt) : NaN;
    const isLiveStatus =
      game.statusState === 'in' ||
      (!completedFlag && /\b(q[1-4]|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/i.test(statusStr));

    let postGameStreamCount = 0;
    for (const it of rawStream) {
      const pMs = resolveEffectivePublishTimestampMs(it, ts);
      if (Number.isFinite(pMs) && pMs >= koMs + 2.4 * 3600_000) {
        postGameStreamCount += 1;
        if (postGameStreamCount >= 4) break;
      }
    }

    const isPostGameReady = Number.isFinite(completedAtMs)
      ? completedFlag &&
        (ts >= completedAtMs + 18 * 60_000 ||
          (postGameStreamCount >= 3 && ts >= completedAtMs + 5 * 60_000))
      : (completedFlag &&
          (ts >= koMs + 3.55 * 3600_000 ||
            (postGameStreamCount >= 3 && ts >= koMs + 3.15 * 3600_000))) ||
        (ts >= koMs + 4.75 * 3600_000 && !isLiveStatus && postGameStreamCount >= 2) ||
        (ts >= koMs + 5.5 * 3600_000 && !isLiveStatus);

    return {
      game,
      koMs,
      gameDatePt,
      postGameCycleKey,
      completedFlag,
      isLiveStatus,
      postGameStreamCount,
      isPostGameReady
    };
  };

  const evaluated = games.map(evalGameState);

  const resolvePriorCycleBeforeDate = gameKoMs => {
    const { hour24: gHour } = getPacificClockParts(gameKoMs);
    const priorAnchorMs = gameKoMs - (gHour + 3) * 3_600_000;
    const priorDatePt = getPacificClockParts(priorAnchorMs).dateKey;
    const priorGame = evaluated.find(e => e.gameDatePt === priorDatePt && e.koMs < gameKoMs);
    if (priorGame) return priorGame.postGameCycleKey;
    return `${priorDatePt}@${peakHourPt}PT`;
  };

  // 1. Check if a game is scheduled today (or currently in its live/post-whistle window across midnight PT)
  const activeOrTodayGame = evaluated.find(
    e =>
      e.gameDatePt === todayPt ||
      (ts >= e.koMs - GAME_DAY_ABOVE_BRIEF_LEAD_MS && ts <= e.koMs + 8.5 * 3600_000 && !e.isPostGameReady)
  );

  if (activeOrTodayGame) {
    // Before T-90m on game day morning/early afternoon (when hourPt < peakHourPt), still on yesterday's cycle cleanly
    if (ts < activeOrTodayGame.koMs - GAME_DAY_ABOVE_BRIEF_LEAD_MS && !activeOrTodayGame.isPostGameReady) {
      return {
        activeCycleKey: resolvePriorCycleBeforeDate(activeOrTodayGame.koMs),
        isGameDayHold: false,
        isPostGameCycle: false,
        targetGame: activeOrTodayGame.game,
        targetKickoffMs: activeOrTodayGame.koMs,
        postGameCycleKey: activeOrTodayGame.postGameCycleKey
      };
    }

    // Inside [T-90m, Post-Game Ready): hold on prior cycle even past 5:00 PM PT until the game completes!
    if (!activeOrTodayGame.isPostGameReady) {
      return {
        activeCycleKey: resolvePriorCycleBeforeDate(activeOrTodayGame.koMs),
        isGameDayHold: true,
        isPostGameCycle: false,
        targetGame: activeOrTodayGame.game,
        targetKickoffMs: activeOrTodayGame.koMs,
        postGameCycleKey: activeOrTodayGame.postGameCycleKey
      };
    }

    // Game has completed & post-game brief window is open!
    return {
      activeCycleKey: activeOrTodayGame.postGameCycleKey,
      isGameDayHold: false,
      isPostGameCycle: true,
      targetGame: activeOrTodayGame.game,
      targetKickoffMs: activeOrTodayGame.koMs,
      postGameCycleKey: activeOrTodayGame.postGameCycleKey
    };
  }

  // 2. Morning/afternoon after a completed game day (before 5:00 PM PT on Day D+1): serve Day D's post-game cycle
  if (hourPt < peakHourPt) {
    const yesterdayGame = evaluated.find(e => e.gameDatePt === prevDatePt && ts >= e.koMs);
    if (yesterdayGame && yesterdayGame.isPostGameReady) {
      return {
        activeCycleKey: yesterdayGame.postGameCycleKey,
        isGameDayHold: false,
        isPostGameCycle: true,
        targetGame: yesterdayGame.game,
        targetKickoffMs: yesterdayGame.koMs,
        postGameCycleKey: yesterdayGame.postGameCycleKey
      };
    }
  }

  return {
    activeCycleKey: fallbackCycleKey,
    isGameDayHold: false,
    isPostGameCycle: false,
    targetGame: null,
    targetKickoffMs: null,
    postGameCycleKey: ''
  };
}

/**
 * Detects when `appData` is still holding a cold pre-game static snapshot even though a scheduled
 * 49ers game kicked off >= 3.25 hours ago (preventing premature post-game synthesis before ESPN/wire hydration).
 */
export function isAppDataAwaitingLivePostGameHydration(appData = null, nowMs = Date.now()) {
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const games = collectScheduleGamesForBrief(appData);
  if (games.length === 0) return false;
  const rawStream = Array.isArray(appData?.news?.rawStream) ? appData.news.rawStream : [];

  for (const { game, koMs } of games) {
    const completedFlag = Boolean(game.completed) || /\bfinal\b/i.test(String(game.statusDetail || ''));
    // 1. Game kicked off >= 3.25h ago, but `appData` still shows `completed: false` with <2 post-game items
    if (!completedFlag && ts >= koMs + 3.25 * 3600_000 && ts <= koMs + 96 * 3600_000) {
      let postGameItems = 0;
      for (const it of rawStream) {
        const pMs = resolveEffectivePublishTimestampMs(it, ts);
        if (Number.isFinite(pMs) && pMs >= koMs + 2.4 * 3600_000) {
          postGameItems += 1;
          if (postGameItems >= 2) break;
        }
      }
      if (postGameItems < 2) {
        return true;
      }
    }
    // 2. Game IS marked completed within last 36h, initial live wire sync is still in flight, and <2 post-game items exist yet
    if (
      completedFlag &&
      appData?._awaitingInitialLiveWireSync === true &&
      ts >= koMs + 2.5 * 3600_000 &&
      ts <= koMs + 36 * 3600_000
    ) {
      let postGameItems = 0;
      for (const it of rawStream) {
        const pMs = resolveEffectivePublishTimestampMs(it, ts);
        if (Number.isFinite(pMs) && pMs >= koMs + 2.0 * 3600_000) {
          postGameItems += 1;
          if (postGameItems >= 2) break;
        }
      }
      if (postGameItems < 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validates whether a cached or upstream `dailyTopNewsBrief` is stale relative to:
 *  1) A completed 49ers game (e.g., Sunday evening / Monday morning brief citing pre-game Thursday practice), OR
 *  2) A newer official weekly practice report (e.g., Friday 5 PM brief citing "missed Thursday practice" when Friday LP/FP/DNP is logged!).
 */
export function isDailyBriefStaleForLiveState(brief = null, appData = null, nowMs = Date.now()) {
  if (!brief || typeof brief !== 'object') return true;
  if (!brief.headline || !Array.isArray(brief.bullets) || brief.bullets.length < 2) return true;
  if (!appData || typeof appData !== 'object') return false;

  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const fullBriefProse = [
    brief.headline || '',
    brief.summary || '',
    ...(Array.isArray(brief.bullets) ? brief.bullets : [])
  ].join(' ');

  // Check midweek / Friday practice-report supersession (Issue A: prevent Thursday practice brief sticking after Friday report posts)
  const prRows = Array.isArray(appData?.health?.practiceReport) ? appData.health.practiceReport : [];
  const hasRealFridayPractice = prRows.some(
    r => r && r.fri && r.fri !== '-' && !/^vet\s*rest$/i.test(String(r.fri).trim())
  );
  const hasRealThursdayPractice = prRows.some(
    r => r && r.thu && r.thu !== '-' && !/^vet\s*rest$/i.test(String(r.thu).trim())
  );
  if (hasRealFridayPractice && !brief.isPostGame) {
    const citesWedOrThuPractice =
      /\b(?:wednesday|thursday)(?:['’]s)?\s+practice(?:\s+(?:report|participation|session))?|\b(?:missed|limited\s+(?:in|at|on|by)|sat\s+out)\s+(?:wednesday|thursday)\b/i.test(
        fullBriefProse
      );
    const mentionsFriday = /\bfriday\b/i.test(fullBriefProse);
    if (citesWedOrThuPractice && !mentionsFriday) {
      return true;
    }
  } else if (hasRealThursdayPractice && !hasRealFridayPractice && !brief.isPostGame) {
    const citesWedPracticeOnly =
      /\bwednesday(?:['’]s)?\s+practice(?:\s+(?:report|participation|session))?|\b(?:missed|limited\s+(?:in|at|on|by)|sat\s+out)\s+wednesday\b/i.test(
        fullBriefProse
      );
    const mentionsThursday = /\bthursday\b/i.test(fullBriefProse);
    if (citesWedPracticeOnly && !mentionsThursday) {
      return true;
    }
  }

  const games = collectScheduleGamesForBrief(appData);
  if (games.length === 0) return false;

  // Find the most recent game that has already completed (or passed kickoff + 5.5h) within the last 42h
  let recentFinished = null;
  for (const entry of games) {
    const completedFlag =
      Boolean(entry.game.completed) ||
      /\bfinal\b/i.test(String(entry.game.statusDetail || '')) ||
      ts >= entry.koMs + 5.5 * 3600_000;
    if (completedFlag && ts >= entry.koMs + 3.25 * 3600_000 && ts - entry.koMs <= 42 * 3600_000) {
      recentFinished = entry;
    }
  }
  if (!recentFinished) return false;

  const { game: compGame, koMs: compKoMs } = recentFinished;
  const genMs = brief.generatedAt ? Date.parse(brief.generatedAt) : NaN;
  if (Number.isFinite(genMs) && genMs < compKoMs + 2.5 * 3600_000) {
    return true;
  }

  const srcTimes = (Array.isArray(brief.sources) ? brief.sources : [])
    .map(s => (s?.publishedAt ? Date.parse(s.publishedAt) : NaN))
    .filter(Number.isFinite);
  if (srcTimes.length > 0 && Math.max(...srcTimes) < compKoMs) {
    return true;
  }

  const compOppNick = extractTeamNickname(compGame.opponent?.name || '');
  const nextUnfinished = games.find(e => !e.game.completed && e.koMs > compKoMs);
  const nextOppNick = nextUnfinished ? extractTeamNickname(nextUnfinished.game.opponent?.name || '') : '';
  if (
    compOppNick &&
    compOppNick.toLowerCase() !== nextOppNick.toLowerCase() &&
    new RegExp(`\\b(ahead of|before)\\s+(?:week\\s+\\d+\\s+(?:vs\\.?|against)\\s+)?(?:the\\s+)?${escapeRegexToken(compOppNick)}\\b`, 'i').test(
      `${brief.headline || ''} ${brief.summary || ''} ${(brief.bullets || []).slice(0, 2).join(' ')}`
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Checks whether `dailyBrief` is a valid, non-stale post-game summary formed for `game`.
 */
export function isPostGameBriefFormedForGame(
  dailyBrief,
  game,
  appData = null,
  nowMs = Date.now(),
  { requireAiSource = false } = {}
) {
  if (!dailyBrief || typeof dailyBrief !== 'object' || !game) return false;
  if (!dailyBrief.headline || !Array.isArray(dailyBrief.bullets) || dailyBrief.bullets.length < 2) {
    return false;
  }
  const koMs = Date.parse(game.dateIso || game.kickoffIso || '');
  if (!Number.isFinite(koMs)) return false;

  if (requireAiSource) {
    const isAi =
      dailyBrief.source === 'live-gemini-daily' || dailyBrief.source === 'pipeline-gemini-daily';
    if (!isAi) return false;
  }

  if (isDailyBriefStaleForLiveState(dailyBrief, appData, nowMs)) {
    return false;
  }

  const gameDatePt = getPacificClockParts(koMs).dateKey;
  const expectedPostGameKey = `${gameDatePt}@postgame-${formatGameBriefCycleSlug(game)}`;

  if (dailyBrief.cycleKey === expectedPostGameKey) {
    return true;
  }
  if (dailyBrief.isPostGame === true && Number(dailyBrief.gameWeek) === Number(game.week)) {
    return true;
  }

  const genMs = dailyBrief.generatedAt ? Date.parse(dailyBrief.generatedAt) : NaN;
  const srcTimes = (Array.isArray(dailyBrief.sources) ? dailyBrief.sources : [])
    .map(s => (s?.publishedAt ? Date.parse(s.publishedAt) : NaN))
    .filter(Number.isFinite);
  if (
    Number.isFinite(genMs) &&
    genMs >= koMs + 2.75 * 3600_000 &&
    srcTimes.length > 0 &&
    Math.max(...srcTimes) >= koMs + 2.25 * 3600_000
  ) {
    return true;
  }

  return false;
}

/**
 * Evaluates whether the `News & Film -> All` feed is inside the `[T-90m, Post-Game Brief Formed)` window,
 * during which ALL new news items (`publishedAt >= kickoff - 90m`) are promoted above the summary card.
 */
export function evaluateGameDayAboveBriefWindow(
  appData = null,
  dailyBrief = null,
  nowMs = Date.now(),
  { requireAiSource = false } = {}
) {
  const inactive = {
    active: false,
    game: null,
    kickoffMs: null,
    windowStartMs: null,
    phaseLabel: '',
    expectedPostGameCycleKey: ''
  };
  if (!appData || typeof appData !== 'object') return inactive;

  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const games = collectScheduleGamesForBrief(appData);
  if (games.length === 0) return inactive;

  // Pick the most recent game whose [kickoff - 90m, kickoff + 24h] window contains `ts`
  let candidate = null;
  for (const entry of games) {
    if (ts >= entry.koMs - GAME_DAY_ABOVE_BRIEF_LEAD_MS && ts <= entry.koMs + 24 * 3600_000) {
      candidate = entry;
    }
  }
  if (!candidate) return inactive;

  const { game, koMs } = candidate;
  const formed = isPostGameBriefFormedForGame(dailyBrief, game, appData, ts, { requireAiSource });
  if (formed) return inactive;

  const gameDatePt = getPacificClockParts(koMs).dateKey;
  const expectedPostGameCycleKey = `${gameDatePt}@postgame-${formatGameBriefCycleSlug(game)}`;
  const completedFlag = Boolean(game.completed) || /\bfinal\b/i.test(String(game.statusDetail || ''));
  const phaseLabel =
    ts < koMs
      ? 'Pre-Game Inactives & Warmups'
      : completedFlag || ts >= koMs + 3.4 * 3600_000
        ? 'Post-Game Live Wire'
        : 'Live In-Game Wire';

  return {
    active: true,
    game,
    kickoffMs: koMs,
    windowStartMs: koMs - GAME_DAY_ABOVE_BRIEF_LEAD_MS,
    phaseLabel,
    expectedPostGameCycleKey
  };
}

function resolveClusterLatestTimestampMs(item = {}, nowMs = Date.now()) {
  let latest = resolveEffectivePublishTimestampMs(item, nowMs);
  if (Array.isArray(item?.confirmingReports)) {
    for (const cr of item.confirmingReports) {
      const crMs = resolveEffectivePublishTimestampMs(cr, nowMs);
      if (Number.isFinite(crMs) && (!Number.isFinite(latest) || crMs > latest)) {
        latest = crMs;
      }
    }
  }
  return latest;
}

/**
 * Partitions a prioritized, deduplicated news stream relative to `dailyBrief`:
 * - Standard Mode: Active urgent breaking news (`BREAKING`, `LIVE INJURY UPDATE`, `LIVE IN-GAME`)
 *   that is NOT already covered in `dailyBrief` (up to 3 items) rises ABOVE the summary block.
 * - Game-Day Mode (`options.promoteAllGameDayNews === true` inside `[T-90m, Post-Game Brief Formed)`):
 *   ALL new news arriving from `T-90m` onward stacks ABOVE the summary card until the post-game AI
 *   summary is generated, immediately reverting to standard breaking-only logic once formed.
 */
export function partitionBreakingNewsAboveBrief(
  items = [],
  dailyBrief = null,
  nowMs = Date.now(),
  options = {}
) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      breakingAboveBrief: [],
      remainingBelowBrief: [],
      gameDayLiveMode: false,
      gameDayPhaseLabel: ''
    };
  }
  if (!dailyBrief || typeof dailyBrief !== 'object') {
    return {
      breakingAboveBrief: [],
      remainingBelowBrief: items,
      gameDayLiveMode: false,
      gameDayPhaseLabel: ''
    };
  }

  const {
    appData = null,
    promoteAllGameDayNews = false,
    requireAiPostGameBrief = false
  } = options || {};

  const gdWindow =
    promoteAllGameDayNews && appData
      ? evaluateGameDayAboveBriefWindow(appData, dailyBrief, nowMs, {
          requireAiSource: requireAiPostGameBrief
        })
      : { active: false, phaseLabel: '' };

  if (gdWindow.active) {
    const breakingAboveBrief = [];
    const remainingBelowBrief = [];
    const briefGenMs = dailyBrief.generatedAt ? Date.parse(dailyBrief.generatedAt) : NaN;
    // Allow 3 minutes of reporter clock-skew tolerance around the exact T-90m inactives release
    const cutoffMs = gdWindow.windowStartMs - 3 * 60_000;

    for (const item of items) {
      const latestMs = resolveClusterLatestTimestampMs(item, nowMs);
      const isActiveUrgent =
        isUrgentBreakingBadge(item?.breakingBadge) ||
        Boolean(
          item?.isUrgentBreaking &&
            (item?.storyTier === 'tier1_major' ||
              item?.storyTier === 'tier2_roster' ||
              item?.storyTier === 'in_game_injury')
        );
      const isNewSinceWindowOpen = Number.isFinite(latestMs) && latestMs >= cutoffMs;
      const alreadyInOldBrief =
        isBreakingItemCoveredInBrief(item, dailyBrief, nowMs) &&
        (!Number.isFinite(briefGenMs) || !Number.isFinite(latestMs) || latestMs <= briefGenMs + 60_000);

      if ((isNewSinceWindowOpen || isActiveUrgent) && !alreadyInOldBrief) {
        breakingAboveBrief.push(item);
      } else {
        remainingBelowBrief.push(item);
      }
    }

    breakingAboveBrief.sort((a, b) => {
      const aInj = a?.isInGameInjury ? 1 : 0;
      const bInj = b?.isInGameInjury ? 1 : 0;
      if (aInj !== bInj) return bInj - aInj;
      const aUrg = isUrgentBreakingBadge(a?.breakingBadge) ? 1 : 0;
      const bUrg = isUrgentBreakingBadge(b?.breakingBadge) ? 1 : 0;
      if (aUrg !== bUrg) return bUrg - aUrg;
      const aMs = resolveClusterLatestTimestampMs(a, nowMs) || 0;
      const bMs = resolveClusterLatestTimestampMs(b, nowMs) || 0;
      return bMs - aMs;
    });

    return {
      breakingAboveBrief,
      remainingBelowBrief,
      gameDayLiveMode: true,
      gameDayPhaseLabel: gdWindow.phaseLabel
    };
  }

  const breakingAboveBrief = [];
  const remainingBelowBrief = [];

  for (const item of items) {
    const isActiveUrgent =
      isUrgentBreakingBadge(item?.breakingBadge) ||
      Boolean(
        item?.isUrgentBreaking &&
          (item?.storyTier === 'tier1_major' ||
            item?.storyTier === 'tier2_roster' ||
            item?.storyTier === 'in_game_injury')
      );

    if (
      isActiveUrgent &&
      breakingAboveBrief.length < 3 &&
      !isBreakingItemCoveredInBrief(item, dailyBrief, nowMs)
    ) {
      breakingAboveBrief.push(item);
    } else {
      remainingBelowBrief.push(item);
    }
  }

  return {
    breakingAboveBrief,
    remainingBelowBrief,
    gameDayLiveMode: false,
    gameDayPhaseLabel: ''
  };
}

export { buildStorySignatureKey };

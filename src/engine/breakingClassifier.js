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
  decodeHtmlEntities,
  isPaywalledPublisher,
  sanitizeExternalUrl,
  stripAggregatorBoilerplate
} from './linkIntegrity.js';
import { isEditorialPhotoUrl } from './salientMediaEngine.js';
import { ALL_NFL_TEAMS, getActiveTeamConfig, resolveTeamConfig } from '../config/teamRegistry.js';

export const SHORT_TWEET_FULL_TEXT_LIMIT = 320;
export const WIRE_ARTICLE_EXCERPT_MAX_CHARS = 280;
export const WIRE_BLURB_SUMMARY_MAX_CHARS = 900;
export const WIRE_SUMMARY_EXPAND_THRESHOLD = 450;
export const WIRE_SUMMARY_PREVIEW_MAX = 320;

const URGENT_BREAKING_BADGES = new Set(['BREAKING', 'LIVE INJURY UPDATE']);

export function isUrgentBreakingBadge(badge = '') {
  return URGENT_BREAKING_BADGES.has(String(badge || '').trim().toUpperCase());
}

// Unambiguous in-game injury, medical tent, cart, or return-status phrases.
// Ambiguous return-to-game idioms ("back in the game", "returning to the game", "returned to the game")
// and locker-room/tunnel walks are evaluated via `matchesInGameInjuryOrReturn()` so team comeback chatter
// (e.g. "letting them back in the game", "gets the 49ers right back in the game") and halftime locker-room
// walks never trigger false `LIVE INJURY UPDATE` badges.
const IN_GAME_EXPLICIT_INJURY_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out(?:\s+for\s+(?:the\s+(?:rest|remainder)|tonight|today|the\s+game))?|downgraded to out|out for the (?:rest|remainder|game|night|day|season|year)|will not return|won['’]?t return|did not return(?!\s+(?:the\s+|a\s+|that\s+|his\s+)?(?:punt|kick|kickoff|fumble|interception))|done for the (?:day|night|game|season|year)|cleared to return|cleared concussion protocol|blue medical tent|medical tent|evaluated for (?:a )?concussion|concussion (?:evaluation|protocol)|being evaluated|being checked (?:in|out in) the (?:blue )?(?:medical )?tent|carted (?:off|to|away|from|back|into|down)|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|loaded\s+onto\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming|comes|came|rolling|rolled|heading|headed)?\s*out|(?:bringing|brought|bring|calling|called|motion(?:ed|ing)?|wav(?:ed|ing)?)\s+(?:out\s+the\s+|for\s+the\s+)cart|medical\s+cart|in an air\s*cast|air\s*cast|splint\b|immobiliz\w*|on crutches|walking boot|non-contact (?:injury|knee|ankle|leg)|(?:down|staying\s+down|remained\s+down|still\s+down)\s+on\s+(?:the\s+)?(?:field|turf|grass)|went\s+down\s+(?:hard|clutching|grabbing|holding|with|on\s+the\s+play|after\s+getting\s+rolled)|rolled\s+up\s+on|limped off|limping off|helped off(?: the field)?|walked off with trainers|with athletic trainers|examined by trainers|examined on the sideline|(?:trainers|medical\s+staff)\s+(?:are\s+)?(?:out|rushing|attending|tending|checking|looking\s+at|examining|surrounding)|being\s+tended\s+to|tended\s+to\s+by\s+trainers|receiving\s+medical\s+attention|(?:left|exited) (?:the|tonight['’]?s|sunday['’]?s|monday['’]?s|thursday['’]?s|saturday['’]?s|today['’]?s) (?:game|contest|matchup)|(?:lower[- ]|upper[- ]|right\s+|left\s+)?leg\s+injur\w*|gruesome\s+(?:[a-z-]+\s+)?injur\w*|in-game injury|injury update:\s*[a-z])\b/i;

const LOCKER_ROOM_OR_TUNNEL_EXIT_REGEX =
  /\b(?:headed|going|went|walked|taken|limped|helped|escorted|carted)\s+(?:off\s+)?(?:to\s+the\s+locker\s+room|(?:into|to|down)\s+the\s+tunnel)\b/i;

const ROUTINE_HALFTIME_OR_POSTGAME_LOCKER_ROOM_REGEX =
  /\b(?:at\s+halftime|for\s+halftime|into\s+halftime|before\s+halftime|for\s+the\s+half|at\s+the\s+half|end\s+of\s+the\s+(?:first\s+)?half|after\s+the\s+(?:game|win|loss|victory))\b/i;

const INJURY_OR_MEDICAL_CONTEXT_REGEX =
  /\b(injur\w*|tent\b|trainer|trainers|medical\s+staff|concussion|ankle|knee|leg\b|shoulder|hamstring|calf|groin|rib|ribs|back\s+(?:spasm|tightness|injury|issue)|wrist|hand\b|finger|thumb|foot\b|toe\b|hip\b|neck\b|head\s+injur\w*|chest|elbow|quad\b|achilles|acl\b|mcl\b|pcl\b|lcl\b|evaluated|cleared|helmet\s+back\s+on|locker\s+room|tunnel|limp(?:ed|ing)?|cart(?:ed)?|air\s*cast|x-rays?|mri\b|shaken\s+up|taped\s+up|hobbled|hobbling)\b/i;

const TEAM_COMEBACK_BACK_IN_GAME_REGEX =
  /\b(?:(?:let|lets|letting|get|gets|got|getting|put|puts|putting|bring|brings|brought|bringing|keep|keeps|kept|keeping|pull|pulls|pulled|pulling|lead|leads|led|leading|claw|claws|clawed|clawing|fight|fights|fought|fighting|climb|climbs|climbed|climbing|crawl|crawls|crawled|crawling|storm|storms|stormed|storming|march|marches|marched|marching|way|right|still|stay|stays|stayed|staying)\s+(?:[a-z0-9#'’.-]+\s+){0,4}(?:back\s+in\s+the\s+game|back\s+into\s+the\s+game)|(?:them|us|themselves|they(?:'re|’re|\s+are)?|we(?:'re|’re|\s+are)?|(?:the\s+)?(?:offense|defense|special\s+teams|team|squad|unit))\s+(?:is\s+|are\s+|'s\s+|’s\s+|'re\s+|’re\s+|right\s+|firmly\s+|suddenly\s+|now\s+)*(?:back\s+in\s+the\s+(?:game|huddle|lineup)|back\s+on\s+the\s+field|returning\s+to\s+the\s+game|returned\s+to\s+(?:the\s+)?game))\b/i;

const SCORE_OR_LEAD_COMMENTARY_REGEX =
  /\b(?:\d+[- ]point\s+(?:lead|deficit)|led\s+[a-z0-9#'’.-]+\s+by\s+\d+|lead(?:s|ing)?\s+by\s+\d+|trail(?:s|ed|ing)?\s+by\s+\d+|up\s+by\s+\d+|down\s+by\s+\d+|cut\s+the\s+(?:lead|deficit)|comeback|blow(?:ing|n)?\s+(?:a|the)\s+lead|back\s+to\s+within\s+\d+|score\s+is\s+\d+-\d+|td\s+pass|touchdown\s+pass|pick-?6|strip-?sack|three-and-out|3-and-out)\b/i;

let ALL_NFL_TEAM_SUBJECT_BEFORE_RETURN_REGEX_CACHE = null;
function getAllNflTeamSubjectBeforeReturnRegex() {
  if (ALL_NFL_TEAM_SUBJECT_BEFORE_RETURN_REGEX_CACHE) return ALL_NFL_TEAM_SUBJECT_BEFORE_RETURN_REGEX_CACHE;
  const tokens = new Set(['49ers', 'niners', 'bucs', 'pats', 'jags', 'santa clara', 'indy']);
  for (const t of ALL_NFL_TEAMS) {
    if (t.nickname) tokens.add(t.nickname.toLowerCase());
    if (t.city) tokens.add(t.city.toLowerCase());
  }
  const pat = [...tokens]
    .map(tok => escapeRegexToken(tok).replace(/\\ /g, '\\s+'))
    .join('|');
  ALL_NFL_TEAM_SUBJECT_BEFORE_RETURN_REGEX_CACHE = new RegExp(
    `\\b#?(?:${pat})(?:['’]s?)?\\s+(?:is\\s+|are\\s+|'s\\s+|’s\\s+|'re\\s+|’re\\s+|right\\s+|firmly\\s+|suddenly\\s+|now\\s+)*(?:back\\s+in\\s+the\\s+game|back\\s+on\\s+the\\s+field|returning\\s+to\\s+the\\s+game|returned\\s+to\\s+(?:the\\s+)?game)\\b`,
    'i'
  );
  return ALL_NFL_TEAM_SUBJECT_BEFORE_RETURN_REGEX_CACHE;
}

const NON_PLAYER_RETURN_SUBJECT_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'they', 'them', 'we', 'us', 'it', 'there', 'here',
  'now', 'still', 'right', 'just', 'back', 'way', 'getting', 'letting', 'putting', 'bringing', 'keeping',
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'today', 'tonight',
  'halftime', 'offense', 'defense', 'team', 'squad', 'unit', 'san', 'new', 'los', 'las', 'green', 'bay',
  'dallas', 'minnesota', 'seattle', 'detroit', 'philadelphia', 'kansas', 'baltimore', 'buffalo',
  'cincinnati', 'houston', 'denver', 'miami', 'atlanta', 'chicago', 'tampa', 'arizona', 'carolina',
  'cleveland', 'indianapolis', 'jacksonville', 'pittsburgh', 'tennessee', 'washington', 'francisco',
  'angeles', 'orleans', 'england', 'vegas', 'york', '49ers', 'niners', 'cowboys', 'vikings', 'seahawks',
  'rams', 'cardinals', 'chiefs', 'eagles', 'lions', 'packers', 'bears', 'ravens', 'bills', 'bengals',
  'browns', 'steelers', 'texans', 'colts', 'jaguars', 'titans', 'broncos', 'chargers', 'raiders',
  'commanders', 'giants', 'falcons', 'panthers', 'saints', 'buccaneers', 'bucs', 'dolphins', 'patriots',
  'pats', 'jets'
]);

const EXPLICIT_RETURNED_TO_ACTION_REGEX =
  /\b(?:returned\s+to\s+(?:the|tonight['’]?s|sunday['’]?s|monday['’]?s|thursday['’]?s|saturday['’]?s|today['’]?s)?\s*(?:game|action)|returning\s+to\s+(?:the|tonight['’]?s|sunday['’]?s|monday['’]?s|thursday['’]?s|saturday['’]?s|today['’]?s)?\s*(?:game|action))\b/i;

const BACK_IN_THE_GAME_PHRASE_REGEX = /\bback\s+in\s+the\s+(?:game|huddle|lineup)\b/i;

const PLAYER_SUBJECT_BACK_IN_GAME_REGEX =
  /(?:^|[.!?;:\n]\s*|\s)((?:[A-Z][a-z'.-]{1,16}(?:\s+[A-Z][a-z'.-]{1,16})?)|[Hh]e)(?:\s+(?:is|was|looks|appears|heading|headed|now|already|officially)|['’]s|\s)\s*back\s+in\s+the\s+(?:game|huddle|lineup)\b/;

function matchesGuardedPlayerReturnToGame(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  const hasReturnedOrReturning = EXPLICIT_RETURNED_TO_ACTION_REGEX.test(s);
  const hasBackInGame = BACK_IN_THE_GAME_PHRASE_REGEX.test(s);
  if (!hasReturnedOrReturning && !hasBackInGame) return false;

  const hasMedicalCue = INJURY_OR_MEDICAL_CONTEXT_REGEX.test(s);

  // Reject team/scoreboard comeback idioms ("letting them back in the game", "gets the 49ers right back in the game", "Dallas is back in the game")
  if (TEAM_COMEBACK_BACK_IN_GAME_REGEX.test(s) || getAllNflTeamSubjectBeforeReturnRegex().test(s)) {
    return false;
  }
  // Reject score/lead/deficit commentary unless paired with explicit medical/injury context
  if (!hasMedicalCue && SCORE_OR_LEAD_COMMENTARY_REGEX.test(s)) {
    return false;
  }
  // Reject halftime team returns ("returned to the game after halftime") without medical context
  if (!hasMedicalCue && /\b(?:after|following)\s+halftime\b/i.test(s)) {
    return false;
  }

  if (hasReturnedOrReturning) {
    return true;
  }

  // For ambiguous "back in the game/huddle/lineup", require either explicit medical context
  // OR a genuine singular player subject directly preceding the return phrase.
  if (hasMedicalCue) return true;
  const subjMatch = s.match(PLAYER_SUBJECT_BACK_IN_GAME_REGEX);
  if (!subjMatch) return false;
  const rawSubject = String(subjMatch[1] || '').trim().toLowerCase();
  const words = rawSubject.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.every(w => NON_PLAYER_RETURN_SUBJECT_WORDS.has(w))) return false;
  return true;
}

export function matchesInGameInjuryOrReturn(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  if (IN_GAME_EXPLICIT_INJURY_REGEX.test(s)) return true;
  if (LOCKER_ROOM_OR_TUNNEL_EXIT_REGEX.test(s)) {
    const isRoutineHalftimeOrPostgame =
      ROUTINE_HALFTIME_OR_POSTGAME_LOCKER_ROOM_REGEX.test(s) &&
      !/\b(?:limp(?:ed|ing)?|help(?:ed|ing)?|escort(?:ed|ing)?|cart(?:ed|ing)?|trainer|trainers|medical|injur\w*|ankle|knee|leg|shoulder|concussion|hamstring|rib|hip|head|neck|wrist|hand|foot|air\s*cast)\b/i.test(s);
    if (!isRoutineHalftimeOrPostgame) return true;
  }
  return matchesGuardedPlayerReturnToGame(s);
}

const MINOR_OR_SPECULATIVE_INJURY_NOISE_REGEX =
  /\b(cramps?|cramping|dehydrat(?:ed|ion)|wind knocked out(?: of him)?|knocked the wind out|(?:missed|out for|sat out|sidelined for|exited for)\s+(?:a|one|two|1|2|a couple(?: of)?|a few)\s+(?:play|plays|snap|snaps)|for a play or two|for a couple(?: of)? (?:plays|snaps)|briefly (?:exited|left|shaken up|sidelined)|catching his breath|got his breath back|needed a breather|just a breather|shook it off|stayed in the game|back in on the next (?:play|snap|series|drive)|minor nick|looks like (?:it )?(?:could|might) be|from the broadcast angle|by video|my guess is|fearing the worst|looks bad|didn['’]?t look good|hopefully not|pray(?:ing|ers) for)\b/i;

const SPECULATIVE_VISUAL_COMPARISON_REGEX =
  /\b(looked\s+(?:very\s+|awfully\s+|eerily\s+)?similar\s+to|looks\s+(?:very\s+|awfully\s+|eerily\s+)?similar\s+to|reminds?\s+me\s+of|reminded\s+me\s+of|looked\s+like\s+(?:a|an|the)?\s*(?:torn|fractured|broken|dislocated|serious|bad)|looks\s+like\s+(?:a|an|the)?\s*(?:torn|fractured|broken|dislocated|serious|bad)|fears?\s+(?:it\s+)?(?:could|might|may)\s+be|by\s+video\s+(?:looks|appears|suggests)|from\s+the\s+broadcast\s+angle)\b/i;

const CONFIRMED_DIAGNOSIS_OR_ACTION_REGEX =
  /\b(confirmed|diagnosed|x-rays?\s+(?:showed|revealed|came\s+back)|mri\s+(?:showed|revealed|confirmed|came\s+back)|tests?\s+(?:showed|revealed|confirmed)|ruled\s+out|downgraded\s+to\s+out|carted\s+(?:off|to|away)|air\s*cast|placed\s+(?:[a-z .'-]{0,28}\s+)?on\s+(?:injured\s+reserve|ir)\b)\b/i;

function isSpeculativeInjuryComparisonOnly(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  return SPECULATIVE_VISUAL_COMPARISON_REGEX.test(s) && !CONFIRMED_DIAGNOSIS_OR_ACTION_REGEX.test(s);
}

const SERIOUS_INJURY_ESCALATION_REGEX =
  /\b(ruled out|downgraded to out|doubtful to return|out for the (?:rest|remainder|game|night|day|season|year)|will not return|won['’]?t return|did not return(?!\s+(?:the\s+|a\s+|that\s+|his\s+)?(?:punt|kick|kickoff|fumble|interception))|done for the (?:day|night|game|season|year)|carted (?:off|to|away|from|back|into|down)|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|loaded\s+onto\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming|comes|came|rolling|rolled|heading|headed)?\s*out|(?:bringing|brought|bring|calling|called|motion(?:ed|ing)?|wav(?:ed|ing)?)\s+(?:out\s+the\s+|for\s+the\s+)cart|medical\s+cart|in an air\s*cast|air\s*cast|splint\b|immobiliz\w*|non-contact (?:injury|knee|ankle|leg)|locker room|(?:into|to|down)\s+the\s+tunnel|concussion (?:evaluation|protocol)|evaluated for (?:a )?concussion|torn (?:acl|achilles|pectoral|meniscus|patellar)|fracture[d]?|broken (?:ankle|leg|arm|foot|collarbone|wrist|hand|rib|ribs|fibula|tibia)|fibula|tibia|gruesome\s+(?:[a-z-]+\s+)?injur\w*|dislocat(?:ed|ion)|on crutches|walking boot|\bmri\b|\bx-rays?\b|ct scan)\b/i;

const CATASTROPHIC_IN_GAME_INJURY_REGEX =
  /\b(carted (?:off|to|away|from|back|into|down)|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|loaded\s+onto\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming|comes|came|rolling|rolled|heading|headed)?\s*out|(?:bringing|brought|bring|calling|called|motion(?:ed|ing)?|wav(?:ed|ing)?)\s+(?:out\s+the\s+|for\s+the\s+)cart|medical\s+cart|in an air\s*cast|air\s*cast|splint\b|non-contact (?:injury|knee|ankle|leg)|torn (?:acl|achilles|pectoral|patellar)|season-ending|out for (?:the )?(?:rest of (?:the )?)?(?:\d{4} )?season|fracture[d]?|broken (?:ankle|leg|arm|foot|collarbone|wrist|hand|fibula|tibia)|fibula|tibia|gruesome\s+(?:[a-z-]+\s+)?injur\w*|dislocat(?:ed|ion)|ambulance|hospital|immobiliz)\b/i;

const SERIOUS_IN_GAME_INJURY_REGEX =
  /\b(ruled out(?:\s+for\s+(?:the\s+(?:rest|remainder)|tonight|today|the\s+game))?|downgraded to out|out for the (?:rest|remainder|game|night|day|season|year)|will not return|won['’]?t return|did not return(?!\s+(?:the\s+|a\s+|that\s+|his\s+)?(?:punt|kick|kickoff|fumble|interception))|done for the (?:day|night|game|season|year)|doubtful to return|unlikely to return|(?:headed|going|went|walked|taken|limped|helped|escorted)\s+(?:off\s+)?(?:to\s+the\s+locker\s+room|(?:into|to|down)\s+the\s+tunnel)|concussion (?:evaluation|protocol)|evaluated for (?:a )?concussion|on crutches|walking boot|high[- ]ankle sprain|out (?:at least )?(?:\d+(?:-\d+)?|multiple|several) weeks)\b/i;

const CONFIRMED_IN_GAME_STATUS_REGEX =
  /\b(ruled out|downgraded to out|questionable to return|doubtful to return|probable to return|out for the (?:rest|remainder|game|night|day|season|year)|will not return|won['’]?t return|did not return(?!\s+(?:the\s+|a\s+|that\s+|his\s+)?(?:punt|kick|kickoff|fumble|interception))|done for the (?:day|night|game|season|year)|cleared to return|cleared concussion protocol|returned to (?:the|tonight['’]?s|sunday['’]?s|monday['’]?s|thursday['’]?s|saturday['’]?s|today['’]?s)?\s*(?:game|action)|blue medical tent|medical tent|locker room|(?:into|to|down)\s+the\s+tunnel|carted|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming|comes|came|rolling|rolled|heading|headed)?\s*out|(?:bringing|brought|bring|calling|called|motion(?:ed|ing)?|wav(?:ed|ing)?)\s+(?:out\s+the\s+|for\s+the\s+)cart|medical\s+cart|air\s*cast|splint\b|walked off with trainers|helped off(?: the field)?|examined by trainers|(?:trainers|medical\s+staff)\s+(?:are\s+)?(?:out|rushing|attending|tending|checking|examining)|concussion (?:evaluation|protocol)|mri|x-rays?|ct scan|confirmed|diagnosed)\b/i;

const DIAGNOSTIC_SCHEDULED_ONLY_REGEX =
  /\b(scheduled for (?:an? )?(?:mri|x-ray|ct scan|tests?|imaging|further testing)|will undergo (?:an? )?(?:mri|x-ray|ct scan|tests?|imaging)|awaiting (?:an? )?(?:mri|test results?)|to undergo (?:an? )?(?:mri|further testing|tests?)|getting (?:an? )?(?:mri|x-rays?)\s+(?:tomorrow|monday|tuesday|today))\b/i;

const MATERIAL_INJURY_DIAGNOSIS_REGEX =
  /\b(not (?:a )?(?:torn )?(?:acl|achilles|fracture|broken)|acl (?:is )?intact|avoided (?:a )?(?:torn |major |serious )?(?:acl|achilles|structural|season-ending|tear|fracture)|no (?:acl|achilles|ligament|structural) (?:tear|damage)|x-rays? (?:came back |were )?negative|negative x-rays?|mri (?:came back |was |showed )?(?:clean|negative|no structural|no tear|intact)|(?:mri|tests?|initial tests?|imaging|ct scan|x-rays?|exams?)\s+(?:showed|confirmed|revealed|diagnosed|indicated)|(?:diagnosed with|confirmed (?:to be |as )?(?:a|an)?)\s+(?:grade\s+[123i]+\s+)?(?:mcl|pcl|lcl|acl|high[- ]ankle|ankle|knee|hamstring|calf|groin|oblique|rib|pectoral|shoulder|foot|lisfranc|turf toe|meniscus|concussion|fracture|sprain|strain|tear|dislocation)|grade\s+[123i]+\s+(?:mcl|pcl|lcl|sprain|strain)|high[- ]ankle sprain|lisfranc|fractured|broken\s+(?:ankle|leg|arm|foot|collarbone|wrist|hand|rib|ribs|thumb|finger)|concussion protocol|(?:out|expected to miss|likely to miss|sidelined)\s+(?:at least\s+)?(?:\d+(?:-\d+)?\s+weeks?|multiple weeks|several weeks|indefinitely)|needs surgery|will undergo surgery|undergoing surgery)\b/i;

const NEGATED_CATASTROPHIC_INJURY_REGEX =
  /\b(not (?:a )?torn|avoided (?:a )?torn|no torn|did not tear|didn['’]?t tear|acl (?:is )?intact|achilles (?:is )?intact)\b/i;

const POST_GAME_INJURY_FOLLOWUP_REGEX =
  /\b(suffered a|sustained a|exited (?:tonight|sunday|monday|thursday|saturday|the game)|left (?:tonight|sunday|monday|thursday|saturday|the game)|left with (?:a|an|the(?:\s+same)?)\s+[a-z-]+\s+injury|did(?:n['’]?t|\s+not)\s+return(?!\s+(?:the\s+|a\s+|that\s+|his\s+)?(?:punt|kick|kickoff|fumble|interception))|underwent an mri|scheduled for an mri|\bmri\b|\bx-rays?\b|ct scan|tests showed|initial tests|believed to have avoided|avoided (?:a )?(?:torn|major|serious)|not (?:a )?(?:torn )?acl|acl (?:is )?intact|feared to have|day-to-day|week-to-week|high-ankle|sprain|strain|concussion protocol|torn acl|torn achilles|torn pectoral|meniscus|fracture|out multiple weeks|out several weeks|(?:49ers\s+)?injury\s+update:\s*(?:kyle\s+)?shanahan|shanahan (?:said|noted|confirmed|announced|provided|reveals?)[\s\S]{0,65}\b(?:injury|ankle|knee|foot|back|shoulder|hamstring|calf|quad|groin|rib|wrist|hand|concussion|mri|day-to-day|week-to-week))\b/i;

const PRACTICE_WARMUP_INJURY_SCOOP_REGEX =
  /\b(not practicing|not seen at practice|working on a side field|rehab field|blue non-contact|non-contact jersey|walking boot|suffered a setback|aggravated his|underwent an mri|scheduled for an mri|high-ankle sprain|torn acl|torn achilles|torn pectoral|meniscus|21-day practice window|designated (?:dt |wr |rb |cb |lb |te |ol |de |qb |s )?[a-z .'-]{0,28}(?:for|to) return|open(?:ed|s|ing)? [a-z .'-]{0,28}practice window|didn['’]?t activate|did not activate|returns? to practice)\b/i;

const EXPECTED_ROUTINE_PRACTICE_ABSENCE_REGEX =
  /\b(isn['’]?t surprising|not (?:a )?(?:particularly )?surprising|wasn['’]?t expected to practice|not expected to be ready this week|having previously reported|veteran rest|vet rest|not injury related|\bnir\b)\b/i;

const PRE_GAME_AVAILABILITY_NOISE_REGEX =
  /\b(inactives?\b|is inactive|are inactive|as inactive|officially inactive|declared inactive|officially active|active vs\.?|active against|expected to be active|will be active|won['’]?t play|will not play|not playing today|not playing tonight|ruled out|rule[sd]? out (?:one|two|three|four|five|\d+)|unlikely to play|likely to play|expected to play|could play|hopes to play|hoping to play|plans to play|set to play|good to go|cleared to play|cleared for week \d+|expected to take on a full workload|full workload|game-time decision|remains on injured reserve|didn['’]?t activate|did not activate|not activated from|doesn['’]?t have a (?:game |injury )?designation|does not carry an? (?:official )?(?:injury |game )?designation|no (?:injury |game )?designation|listed as (?:questionable|doubtful|out)|deemed (?:questionable|doubtful|out)|hoping['"“”‘’]?\s+(?:to['"“”‘’]?\s+have\s+)?[a-z0-9 .()'-]{0,44}\b(?:returns?|back)\s+(?:to|at|in)\s+practice|hopes?\s+(?:to\s+(?:have|get)\s+)?[a-z0-9 .()'-]{0,44}\b(?:returns?|back)\s+(?:to|at|in)\s+practice|hopeful\s+to\s+(?:get|have)\s+[a-z0-9 .()'-]{0,44}\b(?:back|return)\s+(?:to|at|in)\s+practice|still\s+too\s+early\s+to\s+(?:tell|know|say)|not\s+expect(?:ed|ing)\s+[a-z0-9 .()'-]{0,40}(?:to\s+(?:practice|play|be\s+ready)|this\s+week)|trending\s+toward\s+playing|chance\s+to\s+(?:play|return\s+(?:to\s+practice|this\s+week))|further\s+assess\s+[a-z .'-]{0,20}\s+on\s+(?:wednesday|thursday|friday))\b/i;

const OFFICIAL_GAMEDAY_INACTIVES_REGEX =
  /\b(official(?:ly)?\s+(?:week\s+\d+\s+)?inactives?\b|inactives?\s+(?:vs\.?|versus|against|at|for\s+week\s+\d+)|week\s+\d+\s+inactives?\b|declared\s+inactive|officially\s+inactive|officially\s+active|active\s+(?:vs\.?|versus|against)\b|inactives?\s*[:—–-])\b/i;

const LEAD_PERMANENT_OR_POSTGAME_EXCLUSION_REGEX =
  /\b(arrested|taken into custody|charged with|indicted|suspended|commissioner['’]?s exempt|under (?:nfl |league |police |federal )?investigation|lawsuit|\btrade[!: ]|agree[sd]? to (?:a )?trade|completing a trade|finalizing a trade|sending [\s\S]{0,60}to (?:the )?(?:49ers|san francisco|niners)|traded (?:to|for)|(?:49ers|san francisco|niners) (?:officially )?(?:acquire[sd]?|acquiring|re-acquir(?:e[sd]?|ing)|trade[sd]? for)|has been traded|agreed to terms|contract extension|signed a \d+-year|signs a \d+-year|restructured his contract|reinstat(?:e|ed|ement)|left squad|hires? [a-z .'-]+ as agent|eyes return to (?:the )?nfl|bonus (?:repayment|forfeiture)|placed on injured reserve|placed [a-z .'()-]+ on (?:injured reserve|ir)\b|put [a-z .'()-]+ on ir\b|lose [a-z .'()-]+ to (?:ir|season-ending)|designate[sd]? (?:dt |wr |rb |cb |lb |te |ol |de |qb |s )?[a-z .'-]{2,28} (?:for|to) return|open(?:ed|s|ing)? [a-z .'-]{0,32}(?:21-day )?practice window|21-day (?:practice )?window|activated (?:[a-z .'-]{2,28} )?(?:from|off) (?:ir|injured reserve)|\bwaived\b|officially released|has been released|have released|49ers roster move:|roster moves?:|signed [a-z .'()-]+ to (?:the )?(?:active roster|53-man roster|practice squad)|out for (?:the )?(?:rest of (?:the )?)?(?:\d{4} )?season|miss the (?:remainder|rest) of the (?:\d{4} )?season|season-ending|done for the season|season likely over|fractured|broken (?:ankle|leg|arm|foot|collarbone|wrist|hand|fibula|tibia)|torn (?:acl|achilles|pectoral|meniscus|patellar)|carted (?:off|to|away|from|back|into|down)|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming\s+)?out|air\s*cast|questionable to return|doubtful to return|ruled out for the rest|will not return|won['’]?t return|did not return|left (?:sunday|monday|thursday|saturday|the )['’]?s? game|exited (?:sunday|monday|thursday|saturday|the )['’]?s? game|suffered (?:a|an|injuries)\b|sustained (?:a|an)\b|\d+-\d+ (?:win|loss|victory)|beat(?:s)? (?:the )?[a-z]+|blowout\s+(?:week\s+\d+\s+)?win|dismantl(?:e|es|ed|ing)|franchise history|pff\s+grades?|snap\s+counts?|reaches career milestone|amid [a-z]+ game|notebook:|reacts? to (?:bounce-back )?win|react following)\b/i;

const PRE_GAME_PLAY_AVAILABILITY_REGEX =
  /\b(inactives?\b|officially inactive|declared inactive|is inactive|are inactive|as inactive|officially active|active vs\.?|active against|expected to be active|will be active|won['’]?t play|will not play|not playing today|not playing tonight|unlikely to play|likely to play|expected to play|could play|hopes to play|hoping to play|planning to play|plans to play|set to play|good to go|cleared to play|cleared for week \d+|prepared to return (?:sunday|monday|thursday|saturday|today|tonight)|to return in week \d+|welcoming back [a-z0-9 -]+ for [a-z0-9 .'-]+ game|ruled out|rule[sd]? out (?:one|two|three|four|five|\d+)|will miss (?:sunday|monday|thursday|saturday|today|tonight|week \d+)|won['’]?t be available (?:sunday|monday|thursday|saturday|today|tonight|in week \d+)|expect [a-z .'-]+ to be available (?:sunday|monday|thursday|saturday|today|tonight)|listed as (?:questionable|doubtful|out)|deemed (?:questionable|doubtful|out)|questionable (?:designation|game status|for (?:sunday|monday|thursday|saturday|today|tonight|week \d+))|doubtful for (?:sunday|monday|thursday|saturday|today|tonight|week \d+)|game-time decision|expected to take on a full workload|full workload (?:sunday|monday|thursday|saturday|today|tonight|against|vs)|doesn['’]?t have a (?:game |injury )?designation|does not carry an? (?:official )?(?:injury |game )?designation|carries no (?:game |injury )?designation|no (?:injury |game )?designation for|questionable (?:designation|game status)[\s\S]{0,25}removed|off the injury report|didn['’]?t activate|did not activate|not activated from|remains on injured reserve|(?:final )?(?:injury|availability|status) updates?\b[\s\S]{0,45}\b(?:before|ahead of|on\b)|final updates? ahead of (?:week \d+|sunday|monday|thursday|saturday)|makes?\s+(?:an?\s+)?(?:[a-z0-9 .'-]{0,40}\s+)?announcement\s+(?:on\s+[a-z0-9 .'-]{2,45}\s+)?(?:before|ahead of)\s+[a-z0-9 .'-]{2,25}\s+game|suffers? [a-z ]*injury ahead of [a-z0-9 .'-]+ game|limited (?:at|in) (?:wednesday|thursday|friday|today)['’]?s? practice|limited at practice today|practiced on a limited basis|didn['’]?t (?:participate in(?: [a-z]+['’]?s?)? practice|practice (?:wednesday|thursday|friday|today))|did not participate in practice|will not practice today|not practicing (?:wednesday|thursday|friday|today)|not seen at practice|not going today but hopefully a chance tomorrow|returns? to full practice ahead of|eyes return[\s\S]{0,60}\b(?:could play|questionable|hamstring|ankle|knee|injury|sunday|week \d+)|hoping['"“”‘’]?\s+(?:to['"“”‘’]?\s+have\s+)?[a-z0-9 .()'-]{0,44}\b(?:returns?|back)\s+(?:to|at|in)\s+practice|hopes?\s+(?:to\s+(?:have|get)\s+)?[a-z0-9 .()'-]{0,44}\b(?:returns?|back)\s+(?:to|at|in)\s+practice|hopeful\s+to\s+(?:get|have)\s+[a-z0-9 .()'-]{0,44}\b(?:back|return)\s+(?:to|at|in)\s+practice|(?:could|might|expected|set|unlikely|not expected)\s+(?:to\s+)?(?:return\s+to\s+practice|practice\s+(?:this\s+week|wednesday|thursday|friday))|not\s+expect(?:ed|ing)\s+[a-z0-9 .()'-]{0,40}(?:to\s+(?:practice|play|be\s+ready)|this\s+week)|(?:still\s+)?too\s+early\s+to\s+(?:tell|know|say)[\s\S]{0,50}\b(?:practice|play|return|status|week|sunday|monday|thursday)|(?:practice|return|play|status)[\s\S]{0,50}\b(?:still\s+)?too\s+early\s+to\s+(?:tell|know|say)|further\s+assess\s+[a-z .'-]{0,20}\s+on\s+(?:wednesday|thursday|friday)|trending\s+toward\s+(?:playing|returning|missing)|optimistic\s+(?:about\s+)?[a-z0-9 .()'-]{0,40}\b(?:will\s+play|can\s+play|playing|returns?\s+to\s+practice|chances?\s+to\s+play)|chance\s+to\s+(?:play|return\s+(?:to\s+practice|this\s+week|sunday|monday|thursday|week\s+\d+))|status\s+(?:for\s+(?:week\s+\d+|sunday|monday|thursday|saturday|tonight|today)|remains?\s+up\s+in\s+the\s+air)|rehabbing\s+[a-z0-9 .'-]{0,28}\s+(?:will\s+)?fly(?:ing)?\s+(?:to|into)|flying\s+(?:to|into)\s+[a-z ]{2,24}\s+tonight\s+to\s+be\s+with)\b/i;

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
  /\b(freely gave|kept his promise|jersey (?:no\.|number)|no\.\s*99\b|temporary jersey|wife celebrates|addresses? (?:past )?beef|beef [\s\S]{0,28}(?:squashed|past)|feud resurfaces|social media beef|4-word message|drew \d+(?:\.\d+)? million viewers)\b/i;

const AGGREGATOR_REWRITE_OUTLET_REGEX = /\b(heavy on [a-z0-9]+|heavy\.com|clutchpoints|athlon|yardbarker|total pro sports)\b/i;

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
  /\b(the qb school|qb school|jt o['’]?sullivan|jonnydel|sulligenthub|football academy|alex rollins|qb confidential|kurt warner|baldy|baldynfl|trench warfare|brandon thorn|brandonthornnfl|ted nguyen|fb_filmanalysis|brett kollmann|film room|qbklass|derrik klassen|dan orlovsky|danorlovsky7|throwthedamball|judah fortgang|jrfortgang|ghatz_28|george hatzadony|collinsworthpff|nate_tice|nate tice|benjaminsolak|ben solak|fball_insights|football insights|benbbaldwin|ben baldwin|sethwalder|seth walder|sumersports|tejfbanalytics|pff_moo)\b/i;

const TRUE_FILM_VIDEO_CHANNEL_REGEX =
  /\b(jonnydel|sulligenthub|football academy|the qb school|qb school|jt o['’]?sullivan|chase daniel|alex rollins|film room|brett kollmann|baldy|baldynfl|trench warfare|brandon thorn|ted nguyen|fb_filmanalysis|kurt warner|qb confidential|qbklass|dan orlovsky|all[ _-]?22|nate_tice|nate tice|benjaminsolak|ben solak|throwthedamball|ghatz_28|collinsworthpff|fball_insights|benbbaldwin|sethwalder|sumersports|tejfbanalytics|pff_moo)\b/i;

const TRUE_FILM_VIDEO_TITLE_REGEX =
  /\b(all-22|all 22|film breakdown|film review|film study|film room|tape breakdown|tape study|film analysis|playbook|qb film|qb school|scheme breakdown|x['’]?s (?:and|&) o['’]?s|pass[- ]rush(?:er|ing)? breakdown|coverage breakdown|coaching tape|coaches['’]? film|baldy['’]?s?\s*breakdowns?|play[- ]design|review video|endzone angle|end[- ]zone angle|coverage efficiency|separation prevented|on[- ]ball grade)\b/i;

const HIGHLIGHT_AND_TEAM_INTEREST_VIDEO_REGEX =
  /\b(game highlights|full game highlights|\bhighlights\b|best plays|every touchdown|every catch|every throw|every completed pass|rushing highlights|receiving highlights|pick[- ]?6|interceptions?|top plays|condensed game|end of game|final drive|game-winning|\btd\b|end zone|outlast|thriller|49hours|forty niner way|brick by brick|mic['’]?d up|from the trenches|locker room|victory speech|postgame recap|game recap|week \d+ recap|sights and sounds|wired|sideline|behind the scenes|tim ryan|knbr)\b/i;

const POST_GAME_RECAP_OR_PRESSER_SIGNAL_REGEX =
  /\b(\d+-\d+\s+(?:win|loss|victory|thriller|shootout|comeback)|outlast(?:s|ed)?|beat(?:s)?\s+(?:the\s+)?[a-z]+|defeat(?:s|ed)?\s+(?:the\s+)?[a-z]+|postgame|post-game|locker room|victory speech|shanahan\s+(?:on|after|said|explains|addresses|recaps)|purdy\s+(?:on|after)|mccaffrey\s+(?:on|after)|final score|instant analysis|takeaways\s+from|grades\s+from|snap counts?\s+from|touchdowns?|pick[- ]?6|\btd\b|end zone)\b/i;

const WRITTEN_FILM_AND_TRENCH_SIGNAL_REGEX =
  /\b(all-22|all 22|film breakdown|film study|tape breakdown|coaching tape|coaches['’]? film|baldy['’]?s?\s*breakdowns?|play[- ]design|review video|snap count|snap share|pass[- ]block(?:ing)?|run[- ]block(?:ing)?|pass[- ]set|kick[- ]slide|\bpbwr\b|\bprwr\b|\brswr\b|pressure rate|pass[- ]rush(?:er|ing)?|qb sack|pff\s+grad|pff\s+gard|via\s+@?pff\b|offensive\s+grade|defensive\s+grade|rushing\s+grade|coverage\s+grade|blocking\s+grade|on[- ]ball\s+grade|coverage\s+efficiency|separation(?:\s+prevented)?|passer\s+rating(?:\s+allowed)?|yards\s*(?:\/|per)\s*(?:target|att|attempt|route)|comp\s+pct|dropbacks?|epa\/play|passing epa|rushing epa|yards per play|\bcpoe\b|\bdvoa\b|\byprr\b|\badot\b|\bryoe\b|success rate|wide-9|stunt|twist\b|sim pressure|simulated pressure|blitz rate|11 personnel|12 personnel|21 personnel|22 personnel|two-high|single-high|quarters coverage|cover [12346]|man coverage|zone coverage|match coverage|split-safety|motion rate|pre-snap motion|play-action|red-zone|third-down|trench(?:es)?|pass protection|o-linem[ae]n|offensive line|defensive line|run defense|run fits?|blocking scheme|route concept|route running|route stem|route tree|all\s+routes|swat\b|hand fighting|hand placement|long[- ]arm|swim move|rip move|bull rush|spin move|ghost move|speed[- ]to[- ]power|pad level|leverage|pulling|pull block|lead block|combo block|reach block|base block|seal block|down block|ball placement|layered throw|layering|anticipation|progression|check\s*down|pocket presence|pocket movement|eye discipline|footwork|spacing|stressing a (?:specific )?defense|stats and facts|what he brings to the offense|questions at corner|five turnovers|2nd-half takeaways|\d+\s+catches,\s+\d+\s+yards|min\.?\s+\d+\s+(?:snaps|targets|dropbacks|routes))\b/i;

const TRENCH_POSITION_SET = new Set(['OL', 'OT', 'OG', 'C', 'G', 'T', 'LT', 'LG', 'RG', 'RT', 'DL', 'DE', 'DT', 'NT', 'EDGE']);
const FILM_CRAFT_CLIP_COMMENTARY_REGEX =
  /\b(lt|lg|rg|rt|o-?line|d-?line|trench|pass[- ]?rush(?:er|ing)?|block(?:ed|ing|er)?|pull(?:ing|ed)?|combo|seal|anchor|kick[- ]slide|pass[- ]set|swat|rip|swim|bull rush|spin move|long[- ]arm|bend|leverage|pad level|hand placement|rep\b|reps\b|check\s*down|pocket|protection|double team|chip|pancake|gap|run fit|stunt|twist|blitz|edge|interior|guard|tackle|center|nose|route|release|stem|separation|coverage|shell|zone|man|press|disguise|motion|spacing|play[- ]?design|progression|read\b|anticipation|ball placement|timing|footwork|precision|accuracy)\b/i;
const PURE_CELEBRATION_OR_HYPE_ONLY_REGEX =
  /^(?:it had to be done|what a (?:catch|play|throw|run|hit|win)|touchdown|let['’]?s go|wow|sheesh|cooked|got him|bang|mood|vibes)\b/i;

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
  if (item.isLeagueWideFilmChart) return 'film';
  const title = String(item.title || item.headline || '').trim();
  const body = String(item.fullText || item.summary || '').trim();
  const lead = extractPrimaryClaimText(item);
  const channelOrAuthor = `${item.outletName || ''} ${item.author || ''} ${item.reporterName || ''} ${item.authorHandle || ''}`.trim();
  const combined = `${title} ${body}`.trim();
  const isAnimatedGif =
    Boolean(item.isAnimatedGif) ||
    /\/tweet_video\//i.test(String(item.videoStreamUrl || '')) ||
    /\.gif(?:\?|$)/i.test(String(item.videoStreamUrl || ''));
  const hasTrenchPlayerMention =
    Array.isArray(item.mentionedPlayers) &&
    item.mentionedPlayers.some(mp => TRENCH_POSITION_SET.has(String(mp?.position || '').toUpperCase()));

  const resolvedRep = resolveReporterFromNameOrHandle(
    item.reporterId || item.authorHandle || item.author || item.reporterName || ''
  );
  const repCategory = String(item.reporterCategory || resolvedRep?.category || '').toLowerCase();
  const isRegisteredFilmOrAnalyticsCreator =
    repCategory === 'film' || repCategory === 'film_analyst' || repCategory === 'analytics';

  if (item.type === 'video' || Boolean(item.videoId) || Boolean(item.videoStreamUrl)) {
    const isTweetStreamClip = Boolean(item.videoStreamUrl) && (item.type === 'tweet' || item.type === 'social');
    const isDedicatedPureFilmChannel =
      (isRegisteredFilmOrAnalyticsCreator || DEDICATED_PURE_FILM_CHANNEL_REGEX.test(channelOrAuthor)) &&
      !/\b(mailbag|q\s*&\s*a|live\s*stream\s*q&a|podcast)\b/i.test(title);
    const isTapeChannel = TRUE_FILM_VIDEO_CHANNEL_REGEX.test(channelOrAuthor);
    const isTapeTitle = TRUE_FILM_VIDEO_TITLE_REGEX.test(combined);
    const isPodiumOrVlog = NON_FILM_PODIUM_OR_RECAP_VIDEO_REGEX.test(title) && !isTapeTitle;
    if (isDedicatedPureFilmChannel || (((!isTweetStreamClip && isTapeChannel) || isTapeTitle) && !isPodiumOrVlog)) {
      return 'film';
    }
    // Generalized beat reporter All-22 GIFs & football-craft video clips across all 32 teams
    // (while keeping hype/celebration highlight clips cleanly in Highlights & Videos!)
    const isPureInjuryClip = /\b(injury report|injury update|did not practice|carted|concussion|questionable|ruled out|inactives?)\b/i.test(lead);
    const isPureHypeClip = PURE_CELEBRATION_OR_HYPE_ONLY_REGEX.test(title) && !FILM_CRAFT_CLIP_COMMENTARY_REGEX.test(combined);
    if (
      isTweetStreamClip &&
      !isPodiumOrVlog &&
      !isPureInjuryClip &&
      !isPureHypeClip &&
      ((isAnimatedGif && (hasTrenchPlayerMention || FILM_CRAFT_CLIP_COMMENTARY_REGEX.test(combined))) ||
        (FILM_CRAFT_CLIP_COMMENTARY_REGEX.test(combined) &&
          (hasTrenchPlayerMention || WRITTEN_FILM_AND_TRENCH_SIGNAL_REGEX.test(combined))))
    ) {
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

  // Genuine X's & O's, All-22 tape, snap-count, EPA/CPOE, PFF grading, and trench breakdowns -> 'film'
  const isMockOrOffseasonDraft = /\b(mock draft|draft simulator|7-round|3-round|draft profile|combine)\b/i.test(
    combined
  );
  const filmMatches = combined.match(new RegExp(WRITTEN_FILM_AND_TRENCH_SIGNAL_REGEX.source, 'gi')) || [];
  const headlineHasFilmCue =
    !isMockOrOffseasonDraft &&
    (TRUE_FILM_VIDEO_TITLE_REGEX.test(title) ||
      /\b(snap count|film|all-22|tape|playbook|scheme|trench|pass[- ]rush(?:er|ing)?|pff\s+grad|pff\s+gard|via\s+@?pff\b|offensive\s+grade|defensive\s+grade|rushing\s+grade|coverage\s+grade|blocking\s+grade|on[- ]ball\s+grade|coverage\s+efficiency|separation(?:\s+prevented)?|passer\s+rating|yards\/att|yards\/target|dropbacks?|o-linem[ae]n|offensive line|run defense|epa|cpoe|dvoa|yprr|adot|ryoe|pbwr|prwr|wide-9|coverage|play[- ]design|baldy['’]?s?\s*breakdowns?|hand fighting|check\s*down|all\s+routes|questions at corner|what he brings to the offense|stats and facts|five turnovers|2nd-half takeaways|\d+\s+catches,\s+\d+\s+yards|play-action|red-zone|third-down)\b/i.test(
        title
      ));
  const isPureInjuryLead =
    /\b(injury report|injury update|did not practice|non-participant|limited participant|not practicing|questionable|doubtful|ruled out|inactives?)\b/i.test(
      lead
    ) && !headlineHasFilmCue;

  const isFilmCreatorVisualAnalysis =
    !isMockOrOffseasonDraft &&
    !isPureInjuryLead &&
    (isRegisteredFilmOrAnalyticsCreator || /\b(?:pff|next\s*gen\s*stats|sumersports)\b/i.test(channelOrAuthor)) &&
    Boolean(item.hasInlineChartImage || item.imageUrl) &&
    !/\b(power\s+rankings?|mock\s+draft|podcast|mailbag|jersey|cleats|photo\s+of\s+the\s+year|mourning)\b/i.test(combined) &&
    /\b(attack(?:ed|ing)?|between\s+the\s+(?:numbers|hashes)|over\s+the\s+(?:middle|center)|rankings?|grad(?:e|ed|es|ing)|epa|cpoe|yards|route|coverage|blitz|pressure|block(?:ing)?|rush(?:ing)?|pass(?:ing|er)?|scheme|motion|shell|snap|target|separation|trench|protection|leverage)\b/i.test(
      combined
    );

  if (!isMockOrOffseasonDraft && !isPureInjuryLead && (headlineHasFilmCue || filmMatches.length >= 2 || isFilmCreatorVisualAnalysis)) {
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
    matchesInGameInjuryOrReturn(lead) ||
    POST_GAME_INJURY_FOLLOWUP_REGEX.test(lead) ||
    PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(lead) ||
    /\b(injur|practice|questionable|doubtful|ruled out|mri|concussion|achilles|hamstring|ankle|knee)\b/i.test(lead)
  ) {
    return 'injury';
  }

  return 'beat';
}

/**
 * Returns true if `item` is an official game-day actives/inactives announcement
 * (distinct from earlier mid-week speculation about whether a player might practice or play).
 */
export function isOfficialGameDayInactivesAnnouncement(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const rawLead = extractPrimaryClaimText(item);
  if (!rawLead) return false;
  return OFFICIAL_GAMEDAY_INACTIVES_REGEX.test(`${rawLead} ${item.title || item.headline || ''}`);
}

/**
 * Returns true if `item` (article, tweet, video, or sourceLink) is primarily about
 * single-game pre-kickoff player availability / who is likely to play / won't play /
 * game-day active or inactive status / weekly practice participation or return-to-practice
 * speculation, rather than a permanent roster move, post-game injury diagnosis, trade, or game recap.
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
  let latestElapsedKoMs = -Infinity;
  for (const g of schedule) {
    if (!g || g.isByeWeek) continue;
    const koMs = Date.parse(g.dateIso || '');
    const statusLower = String(g.statusDetail || '').toLowerCase();
    const stateLower = String(g.statusState || '').toLowerCase();
    const isTbd = Boolean(g.opponent?.isTbd || String(g.opponent?.abbr || '').toUpperCase() === 'TBD');
    const isDelayedOrCancelled = /\b(postponed|canceled|cancelled|delayed|weather delay|lightning delay|suspended)\b/.test(statusLower);
    const statusIndicatesLive =
      stateLower === 'in' ||
      Boolean(g.isLive) ||
      /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime|end of (?:1st|2nd|3rd|4th))\b/.test(statusLower);
    if (!isTbd && !isDelayedOrCancelled && !statusIndicatesLive && Number.isFinite(koMs) && ts > koMs + 5.5 * 3600_000) {
      if (koMs > latestElapsedKoMs) latestElapsedKoMs = koMs;
    }
    if (!g.completed) continue;
    const wkNum = Number(g.week);
    if (
      String(g.seasonType || 'REG').toUpperCase() !== 'PRE' &&
      Number.isFinite(wkNum) &&
      wkNum > 0 &&
      !completedWeeks.includes(wkNum)
    ) {
      completedWeeks.push(wkNum);
    }
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

  // Detect T-95m pre-kickoff official inactives/actives declaration window (or explicit officialPosted telemetry)
  const gameDayRoster = appData?.health?.gameDayRoster || appData?.scheduleMatchup?.upcomingMatchup?.gameDayRoster || null;
  const inactivesOfficialPosted = Boolean(
    gameDayRoster?.officialPosted &&
      (!upcomingWeek || !gameDayRoster?.week || Number(gameDayRoster.week) === Number(upcomingWeek))
  );
  const inactivesDeclaredWindow = Boolean(
    (upcomingKickoffMs !== null && ts >= upcomingKickoffMs - 95 * 60_000 && ts < upcomingKickoffMs) ||
      (inactivesOfficialPosted && (upcomingKickoffMs === null || ts < upcomingKickoffMs))
  );

  const latestCompletedWeek = latestCompleted ? Number(latestCompleted.week) || null : null;
  const latestCompletedKickoffMs = Number.isFinite(latestKoMs) ? latestKoMs : null;
  const latestElapsedKickoffMs = Number.isFinite(latestElapsedKoMs) ? latestElapsedKoMs : latestCompletedKickoffMs;
  const latestCompletedAtMs = latestCompleted?.completedAt ? Date.parse(latestCompleted.completedAt) : NaN;
  const latestCompletedEndMs = Number.isFinite(latestCompletedAtMs)
    ? Math.min(ts, latestCompletedAtMs)
    : latestCompletedKickoffMs !== null
      ? Math.min(ts, latestCompletedKickoffMs + 3.25 * 3600_000)
      : null;
  const latestCompletedOppAbbr = String(latestCompleted?.opponent?.abbr || '').toUpperCase();
  const latestCompletedOppNickname = extractTeamNickname(latestCompleted?.opponent?.name || '');

  const resolvedTeam = resolveTeamConfig(appData?.meta?.teamAbbr || appData?.meta?.teamSlug || getActiveTeamConfig());
  const sharedCompletedMeta = {
    teamConfig: resolvedTeam,
    latestCompletedWeek,
    latestCompletedKickoffMs,
    latestElapsedKickoffMs,
    latestCompletedEndMs,
    latestCompletedOppAbbr,
    latestCompletedOppNickname,
    completedWeeks,
    upcomingWeek,
    upcomingKickoffMs,
    upcomingOppAbbr,
    upcomingOppNickname,
    inactivesDeclaredWindow,
    inactivesOfficialPosted,
    tradeDeadlineMs,
    rosterPlayers: Array.isArray(appData?.roster?.players) ? appData.roster.players : []
  };

  // 1. Check if a 49ers game is currently in progress (from kickoff until completion; supports OT & weather delays)
  for (const g of schedule) {
    if (!g || g.isByeWeek || g.opponent?.isTbd || String(g.opponent?.abbr || '').toUpperCase() === 'TBD') {
      continue;
    }
    const statusLower = String(g.statusDetail || '').toLowerCase();
    const stateLower = String(g.statusState || '').toLowerCase();
    const isFinished = Boolean(g.completed || stateLower === 'post' || /\bfinal\b/.test(statusLower));
    if (isFinished || /\b(postponed|canceled|cancelled)\b/.test(statusLower)) {
      continue;
    }
    const koMs = Date.parse(g.dateIso || '');
    const isDelayed = /\b(delayed|weather delay|lightning delay|suspended)\b/.test(statusLower);
    const statusIndicatesLive =
      stateLower === 'in' ||
      Boolean(g.isLive) ||
      /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime|end of (?:1st|2nd|3rd|4th))\b/.test(statusLower);
    if (
      (statusIndicatesLive && (!Number.isFinite(koMs) || ts <= koMs + 10 * 3600_000)) ||
      (!isDelayed && Number.isFinite(koMs) && ts >= koMs && ts <= koMs + 5.25 * 3600_000)
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

  const umStatusLower = String(upcoming.statusDetail || '').toLowerCase();
  if (
    !upcoming.completed &&
    String(upcoming.liveState || '').toLowerCase() !== 'post' &&
    !/\bfinal\b/.test(umStatusLower) &&
    (upcoming.liveState === 'in' || upcoming.isGameInProgress)
  ) {
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
    const estEndMs = Number.isFinite(latestCompletedAtMs) ? latestCompletedAtMs : latestKoMs + 3.25 * 3600_000;
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
const TEAM_CLASSIFIER_MATCHERS_CACHE = new Map();

const COMMON_SURNAME_SKIP = new Set([
  'allen', 'brown', 'campbell', 'clark', 'davis', 'green', 'hall', 'harris', 'hill', 'johnson',
  'jones', 'king', 'lewis', 'martin', 'miller', 'moore', 'morris', 'smith', 'taylor', 'thomas',
  'walker', 'white', 'williams', 'wilson', 'wright', 'young'
]);

const EXTRA_TEAM_NICKNAME_ALIASES = {
  SF: ['Niners'],
  TB: ['Bucs'],
  NE: ['Pats'],
  JAX: ['Jags']
};

const EXTRA_TEAM_CITY_ALIASES = {
  SF: ['Santa Clara'],
  IND: ['Indy']
};

function getTeamClassifierMatchers(teamInput = null) {
  const team = resolveTeamConfig(teamInput || getActiveTeamConfig());
  const abbr = String(team?.abbr || 'SF').toUpperCase();
  if (TEAM_CLASSIFIER_MATCHERS_CACHE.has(abbr)) {
    return TEAM_CLASSIFIER_MATCHERS_CACHE.get(abbr);
  }
  const isSf = abbr === 'SF';

  const activeTokensSet = new Set();
  const addTok = v => {
    const clean = String(v || '').trim();
    if (clean && clean.length >= 3) activeTokensSet.add(escapeRegexToken(clean));
  };
  addTok(team?.nickname);
  addTok(team?.city);
  addTok(team?.fullName);
  for (const rn of team?.requiredNicknames || []) addTok(rn);
  for (const al of EXTRA_TEAM_NICKNAME_ALIASES[abbr] || []) addTok(al);
  for (const cal of EXTRA_TEAM_CITY_ALIASES[abbr] || []) addTok(cal);

  const activeTeamPattern = `(?:${[...activeTokensSet].join('|')})`;

  const coachEntityTokens = new Set();
  const coachFullNames = [];
  const coachSurnames = [];
  const coaches = team?.coachesSeed || {};
  for (const full of [coaches.hc, coaches.gm, coaches.oc, coaches.dc]) {
    const clean = String(full || '').trim();
    if (!clean || /head coach|coordinator|general manager/i.test(clean)) continue;
    const escFull = escapeRegexToken(clean).replace(/\\ /g, '\\s+').replace(/['’]/g, "['’]");
    coachEntityTokens.add(escFull);
    coachFullNames.push(escFull);
    const parts = clean.split(/\s+/);
    const sn = (parts[parts.length - 1] || '').replace(/[^A-Za-z'-]/g, '');
    if (sn.length >= 5 && !COMMON_SURNAME_SKIP.has(sn.toLowerCase())) {
      const escSn = escapeRegexToken(sn).replace(/['’]/g, "['’]");
      coachEntityTokens.add(escSn);
      coachSurnames.push(escSn);
    }
  }
  if (isSf) {
    for (const sfStar of ['Purdy', 'McCaffrey', 'Bosa', 'Kittle', 'Warner']) {
      coachEntityTokens.add(sfStar);
    }
  }

  const otherTeamNamesSet = new Set();
  const otherCitiesOrTeamsSet = new Set();
  for (const t of ALL_NFL_TEAMS) {
    if (t.abbr === abbr) continue;
    const nickEsc = escapeRegexToken(t.nickname);
    otherTeamNamesSet.add(nickEsc);
    otherCitiesOrTeamsSet.add(nickEsc);
    if (t.city) {
      otherCitiesOrTeamsSet.add(escapeRegexToken(t.city).replace(/\\ /g, '\\s+'));
    }
    for (const al of EXTRA_TEAM_NICKNAME_ALIASES[t.abbr] || []) {
      const alEsc = escapeRegexToken(al);
      otherTeamNamesSet.add(alEsc);
      otherCitiesOrTeamsSet.add(alEsc);
    }
    for (const cal of EXTRA_TEAM_CITY_ALIASES[t.abbr] || []) {
      otherCitiesOrTeamsSet.add(escapeRegexToken(cal).replace(/\\ /g, '\\s+'));
    }
  }

  const otherTeamNamesPattern = [...otherTeamNamesSet].join('|');
  const otherCitiesOrTeamsPattern = [...otherCitiesOrTeamsSet].join('|');

  const otherCitiesOrTeamsRe = new RegExp(`\\b#?(?:${otherCitiesOrTeamsPattern})\\b`, 'i');
  const otherSubjectLeadRe = new RegExp(
    `^(?:(?:breaking|just in|update|injury update|roster move|source|sources|per source|per sources|nfl)[:\\s-]+)*(?:the\\s+)?#?(?:${otherTeamNamesPattern})(?:['’]s?)?\\b`,
    'i'
  );
  const otherPosSubjectRe = new RegExp(
    `\\b#?(?:${otherTeamNamesPattern})(?:['’]s?)?\\s+(?:QB|RB|FB|WR|TE|OL|OT|OG|LT|LG|RT|RG|DL|DE|DT|NT|EDGE|LB|ILB|OLB|MLB|CB|DB|FS|SS|K|P|LS|G|C|T|S|HC|OC|DC|head coach|coach|right tackle|left tackle|right guard|left guard|center|quarterback|running back|wide receiver|tight end|linebacker|cornerback|safety|defensive end|defensive tackle|pass rusher|edge rusher|rookie|star|starter|veteran)\\b`,
    'i'
  );
  const activeTransactionPartnerRe = new RegExp(
    `\\b(?:(?:to|with|from)\\s+(?:the\\s+)?#?${activeTeamPattern}\\b[\\s\\S]{0,40}\\b(?:trad(?:e|es|ed|ing)|acquir(?:e|es|ed|ing)|send(?:s|ing)|deal)|(?:trad(?:e|es|ed|ing)|acquir(?:e|es|ed|ing)|send(?:s|ing)|deal[\\s\\S]{0,20})[\\s\\S]{0,55}\\b(?:to|with|from)\\s+(?:the\\s+)?#?${activeTeamPattern}|#?${activeTeamPattern}\\s+(?:are\\s+|have\\s+)?(?:trad(?:e|es|ed|ing)|acquir(?:e|es|ed|ing)|sign(?:s|ed|ing)?|claim(?:s|ed|ing)?|waiv(?:e|ed|ing)|releas(?:e|ed|ing)|designat(?:e|ed|ing)|activat(?:e|ed|ing)|plac(?:e|ed|ing)))\\b`,
    'i'
  );
  const activeIncidentalGameClauseRe = new RegExp(
    `\\b(?:loss to|lost to|win over|win vs\\.?|win against|victory over|victory vs\\.?|victory against|blowout(?:\\s+win)?\\s+over|beat(?:s|ing)?|defeat(?:s|ed|ing)?|against|vs\\.?|versus|facing|play(?:ed|ing)?|contest against|game against|matchup (?:against|vs\\.?))\\s+(?:the\\s+)?#?${activeTeamPattern}\\b`,
    'gi'
  );
  const activeEntityRe = new RegExp(
    `\\b#?(?:${[...activeTokensSet, ...coachEntityTokens].join('|')})\\b`,
    'i'
  );
  const activeTradeLeadRe = new RegExp(
    `\\b(?:sending [\\s\\S]{1,65}\\bto (?:the )?#?${activeTeamPattern}|heading to (?:the )?#?${activeTeamPattern} [\\s\\S]{1,45}\\bfor a (?:\\d{4} )?[a-z0-9-]+(?:-round)? pick|#?${activeTeamPattern} (?:officially )?(?:trade[sd]? for|acquire[sd]?|acquiring|re-acquir(?:e[sd]?|ing)|have (?:officially )?acquired|officially announce [\\s\\S]{0,30}trade)|traded (?:to|for) (?:the )?#?${activeTeamPattern}|${activeTeamPattern} roster move:\\s*acquired)\\b`,
    'i'
  );
  const activeRosterMovePrefixRe = new RegExp(`\\b${activeTeamPattern}\\s+roster\\s+move:`, 'i');
  const coachPattern = coachSurnames.length > 0 ? `(?:${[...coachFullNames, ...coachSurnames].join('|')})` : 'head\\s+coach';
  const activeCoachInjuryUpdateRe = new RegExp(
    `\\b(?:(?:${activeTeamPattern}\\s+)?injury\\s+update:\\s*${coachPattern}|${coachPattern}\\s+(?:said|noted|confirmed|announced|provided|reveals?)[\\s\\S]{0,65}\\b(?:injury|ankle|knee|foot|back|shoulder|hamstring|calf|quad|groin|rib|wrist|hand|concussion|mri|day-to-day|week-to-week))\\b`,
    'i'
  );

  const built = {
    abbr,
    isSf,
    team,
    activeTeamPattern,
    otherCitiesOrTeamsRe,
    otherSubjectLeadRe,
    otherPosSubjectRe,
    activeTransactionPartnerRe,
    activeIncidentalGameClauseRe,
    activeEntityRe,
    activeTradeLeadRe,
    activeRosterMovePrefixRe,
    activeCoachInjuryUpdateRe
  };
  TEAM_CLASSIFIER_MATCHERS_CACHE.set(abbr, built);
  return built;
}

const OPPOSING_INJURY_OR_ROSTER_EVENT_REGEX =
  /\b(injur(?:y|ies|ed)|exits?(?:\s+[a-z0-9.'-]+){0,6}\s+with\b|left\s+(?:the|sunday|monday|thursday|saturday|tonight)['’]?s?\s+game|ruled out|questionable(?:\s+to\s+return)?|doubtful(?:\s+to\s+return)?|inactive|injured reserve|\bir\b|torn\s+(?:acl|achilles|pectoral|meniscus|patellar)|sprain|strain|fracture|broken\s+(?:ankle|leg|arm|foot|collarbone|wrist|hand|rib|fibula|tibia)|concussion|carted|air\s*cast|medical tent|(?:headed|going|went|walked|taken|limped|helped|escorted)\s+(?:off\s+)?(?:to\s+the\s+)?locker room|lower[- ]leg|upper[- ]leg|high[- ]ankle|ankle|knee|shoulder|hamstring|calf|groin|quad|foot|back|rib|wrist|hand|mri|x-ray|surgery|waived|released|signed to|practice squad|placed on|activated from|designated to return|back at practice)\b/i;

/**
 * Returns true when the lead sentence's primary subject is an OPPOSING NFL team or opposing player/coach
 * (e.g., on `vikings.joshal.com`: `"49ers' Colton McKivitz exits win vs. Vikings with lower leg injury"`;
 * on `49ers.joshal.com`: `"#Cowboys G Tyler Booker suffered a high-ankle sprain in his team's loss to the #49ers"`),
 * rather than an active-team player, coach, or bilateral trade/transaction involving the active team.
 */
export function isOpposingTeamSubjectLead(leadClaim = '', item = {}, teamInput = null) {
  const lead = String(leadClaim || '').trim();
  if (!lead) return false;
  const m = getTeamClassifierMatchers(teamInput || item?._teamAbbr || getActiveTeamConfig());
  if (m.activeTransactionPartnerRe.test(lead)) return false;

  // Strip incidental game-context mentions ("in his team's loss to the #49ers", "win vs. Vikings", "against the Vikings")
  const strippedIncidental = lead.replace(m.activeIncidentalGameClauseRe, '');

  const mentionedList = Array.isArray(item?.mentionedPlayers) ? item.mentionedPlayers : [];
  const hasExplicitOtherTeamLead =
    m.otherSubjectLeadRe.test(lead) || m.otherPosSubjectRe.test(lead.slice(0, 100));

  // If the lead explicitly opens with an opposing team's possessive/player ("49ers' Colton McKivitz exits win vs. Vikings"),
  // only override if an active-team player is explicitly named in the non-incidental lead itself.
  if (hasExplicitOtherTeamLead) {
    const activePlayerInLead = mentionedList.some(mp => {
      const cleanName = String(mp?.name || '').replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim();
      if (!cleanName || cleanName.length < 4) return false;
      const surname = cleanName.split(/\s+/).pop() || '';
      return (
        new RegExp(`\\b${escapeRegexToken(cleanName)}\\b`, 'i').test(strippedIncidental) ||
        (surname.length >= 5 && new RegExp(`\\b${escapeRegexToken(surname)}\\b`, 'i').test(strippedIncidental))
      );
    });
    if (!activePlayerInLead && !m.activeEntityRe.test(strippedIncidental)) {
      return true;
    }
  }

  if (mentionedList.length > 0) return false;

  if (m.activeEntityRe.test(strippedIncidental)) {
    return false;
  }

  return (
    hasExplicitOtherTeamLead ||
    m.otherCitiesOrTeamsRe.test(strippedIncidental)
  );
}

/**
 * Returns true when an item is strictly an opposing-team player injury, availability, or roster-move report
 * (e.g., `"49ers' Colton McKivitz exits win vs. Vikings with lower leg injury"` on `vikings.joshal.com`)
 * that active-team fans do not want cluttering their team's News feed or breaking alerts.
 */
export function isOpposingTeamOnlyInjuryOrRosterStory(item = {}, teamInput = null) {
  if (!item || typeof item !== 'object') return false;
  const team = resolveTeamConfig(teamInput || item?._teamAbbr || getActiveTeamConfig());
  // Never filter official club RSS, official club videos, official team transactions, or links on the team's own domain
  const ws = String(item.wireSource || '').toLowerCase();
  if (
    ws === '49ers_official_rss' ||
    ws === '49ers_official_videos_rss' ||
    ws === 'club_official_rss' ||
    ws === 'club_video_rss' ||
    ws === 'official_transactions'
  ) {
    return false;
  }
  const clubDomain = String(team?.clubDomain || '').toLowerCase();
  const itemUrlLower = String(item.url || '').toLowerCase();
  const itemOutletLower = String(item.outletId || '').toLowerCase();
  if (
    (clubDomain && itemUrlLower.includes(clubDomain)) ||
    /_official$/i.test(itemOutletLower)
  ) {
    return false;
  }
  const lead = extractPrimaryClaimText(item);
  if (!lead) return false;
  if (!isOpposingTeamSubjectLead(lead, item, team)) return false;
  return (
    OPPOSING_INJURY_OR_ROSTER_EVENT_REGEX.test(lead) ||
    matchesInGameInjuryOrReturn(lead) ||
    MATERIAL_INJURY_DIAGNOSIS_REGEX.test(lead) ||
    TIER2_ROSTER_OR_STATUS_MOVE_REGEX.test(lead)
  );
}

/**
 * Filters opposing-team-only injury/roster articles out of a team's active news stream while leaving
 * active-team stories, bilateral trades, and game recaps intact.
 */
export function filterOutOpposingTeamInjuryItems(items = [], appData = null) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const team = resolveTeamConfig(appData?.meta?.teamAbbr || appData?.meta?.teamSlug || getActiveTeamConfig());
  return items.filter(it => !isOpposingTeamOnlyInjuryOrRosterStory(it, team));
}

const FRANCHISE_CORE_PLAYER_SLUGS = new Set([
  'brockpurdy',
  'christianmccaffrey',
  'nickbosa',
  'fredwarner',
  'georgekittle',
  'trentwilliams'
]);

const CORE_STARTER_FALLBACK_SLUGS = new Set([
  'deommodorelenoir',
  'deebosamuel',
  'mikeevans',
  'rickypearsall',
  'dregreenlaw',
  'osaodighizuwa',
  'deforestbuckner',
  'dominickpuni',
  'coltonmckivitz',
  'jiayirbrown',
  'malikmustapha',
  'jauanjennings',
  'brandonaiyuk',
  'jakebrendel',
  'renardogreen'
]);

function normalizeRosterSlug(name = '') {
  return String(name || '')
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Classifies in-game injury severity (`0.0 .. 1.0`):
 *  - `minor` (`0.10`): wind knocked out, missed a play or two / couple snaps, cramps, shook it off, unconfirmed video speculation
 *  - `moderate` (`0.48–0.55`): questionable to return, blue medical tent, limped/helped off, or cleared/returned to action
 *  - `serious` (`0.82`): ruled out for game, doubtful to return, headed to locker room, concussion evaluation/protocol, confirmed multi-week/MRI news
 *  - `catastrophic` (`1.00`): carted off, air cast, non-contact knee/ankle/leg injury, torn ACL/Achilles/pec, fracture, season-ending
 */
export function computeInGameInjurySeverity(item = {}) {
  const lead = extractPrimaryClaimText(item);
  const full = `${lead} ${String(item?.fullText || item?.title || '').slice(0, 260)}`.trim();
  if (!full) return { severityScore: 0, severityTier: 'minor' };

  const hasSeriousEscalation = SERIOUS_INJURY_ESCALATION_REGEX.test(full);
  const isMinor =
    isSpeculativeInjuryComparisonOnly(full) ||
    (MINOR_OR_SPECULATIVE_INJURY_NOISE_REGEX.test(full) && !hasSeriousEscalation);
  if (isMinor) {
    return { severityScore: 0.1, severityTier: 'minor' };
  }

  const isNegatedTear = NEGATED_CATASTROPHIC_INJURY_REGEX.test(full);
  const fullForCatastrophic = isNegatedTear
    ? full.replace(/\b(?:torn\s+(?:acl|achilles|pectoral|patellar)|season-ending\s+[a-z]+)\b/gi, '')
    : full;

  if (CATASTROPHIC_INJURY_CHECK(fullForCatastrophic)) {
    return { severityScore: 1.0, severityTier: 'catastrophic' };
  }
  const isRoutineHalftimeLockerRoom =
    ROUTINE_HALFTIME_OR_POSTGAME_LOCKER_ROOM_REGEX.test(full) &&
    !INJURY_OR_MEDICAL_CONTEXT_REGEX.test(full.replace(/\b(?:locker\s+room|tunnel)\b/gi, ''));
  if (
    (SERIOUS_IN_GAME_INJURY_REGEX.test(full) && !isRoutineHalftimeLockerRoom) ||
    (MATERIAL_INJURY_DIAGNOSIS_REGEX.test(full) && !DIAGNOSTIC_SCHEDULED_ONLY_REGEX.test(lead))
  ) {
    return { severityScore: 0.82, severityTier: 'serious' };
  }
  const isTeamUnitReturn =
    TEAM_COMEBACK_BACK_IN_GAME_REGEX.test(full) || getAllNflTeamSubjectBeforeReturnRegex().test(full);
  if (
    !isTeamUnitReturn &&
    (/\b(cleared to return|cleared concussion protocol)\b/i.test(full) ||
      matchesGuardedPlayerReturnToGame(full) ||
      (/\bback on the field\b/i.test(full) && !/\b(?:offense|defense|special\s+teams|team|unit|49ers|niners)\b[\s\S]{0,18}\bback on the field\b/i.test(full)))
  ) {
    return { severityScore: 0.48, severityTier: 'moderate' };
  }
  if (matchesInGameInjuryOrReturn(full)) {
    return { severityScore: 0.55, severityTier: 'moderate' };
  }
  return { severityScore: 0.1, severityTier: 'minor' };
}

function CATASTROPHIC_INJURY_CHECK(text = '') {
  return CATASTROPHIC_IN_GAME_INJURY_REGEX.test(text);
}

/**
 * Evaluates the injured 49ers player's roster value (`0.0 .. 1.0`) dynamically from `rosterPlayers`
 * (snap share %, 2026 cap hit / market value, position leverage, starter status) so franchise cornerstones
 * like CMC / Purdy / Bosa / Warner / Kittle / Trent (`0.92–1.00`) outrank core starters (`0.55–0.85`)
 * and rotational/depth players like Sebastian Valdez (`0.16–0.40`).
 */
export function computePlayerRosterValue(item = {}, rosterPlayers = [], teamInput = null) {
  const lead = extractPrimaryClaimText(item);
  const full = `${lead} ${String(item?.fullText || item?.title || '').slice(0, 260)}`.trim();
  const pool = Array.isArray(rosterPlayers) ? rosterPlayers : [];
  const activeTeam = resolveTeamConfig(teamInput || item?._teamAbbr || getActiveTeamConfig());
  const isSf = activeTeam.abbr === 'SF';

  let matchedRosterObj = null;
  let resolvedSlug = resolvePrimaryInjuredPlayerSlug(item, pool, activeTeam);

  // 1. Match primary injured player (earliest in lead) or `item.mentionedPlayers` against `rosterPlayers`
  if (resolvedSlug && pool.length > 0) {
    matchedRosterObj =
      pool.find(p => normalizeRosterSlug(p?.name) === resolvedSlug) || null;
  }
  if (!matchedRosterObj && Array.isArray(item?.mentionedPlayers) && item.mentionedPlayers.length > 0) {
    const mp =
      (resolvedSlug
        ? item.mentionedPlayers.find(m => normalizeRosterSlug(m?.name || m?.id || '') === resolvedSlug)
        : null) || item.mentionedPlayers[0];
    if (!resolvedSlug) resolvedSlug = normalizeRosterSlug(mp?.name || mp?.id || '');
    if (pool.length > 0) {
      matchedRosterObj =
        pool.find(
          p =>
            (mp?.id && p?.id && String(p.id) === String(mp.id)) ||
            (resolvedSlug && normalizeRosterSlug(p?.name) === resolvedSlug)
        ) || null;
    }
  }

  // 2. Fallback: match directly from tweet/headline text against `rosterPlayers` (full name or unique surname/CMC)
  if (!matchedRosterObj && pool.length > 0 && full) {
    const shorthandSlug = isSf ? resolveFallback49ersShorthandSlug(full) : '';
    if (shorthandSlug) {
      matchedRosterObj = pool.find(p => normalizeRosterSlug(p?.name) === shorthandSlug) || null;
      if (!resolvedSlug) resolvedSlug = shorthandSlug;
    }
    if (!matchedRosterObj) {
      const fullLower = full.toLowerCase();
      for (const p of pool) {
        if (!p?.name || p.rosterBucket === 'retired') continue;
        const cleanName = String(p.name).replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim();
        if (cleanName.length >= 5 && fullLower.includes(cleanName.toLowerCase())) {
          matchedRosterObj = p;
          resolvedSlug = normalizeRosterSlug(p.name);
          break;
        }
      }
    }
    // Unique surname fallback inside rosterPlayers (e.g. "Valdez carted off" -> Sebastian Valdez)
    if (!matchedRosterObj) {
      const surnameCounts = new Map();
      for (const p of pool) {
        const parts = String(p?.name || '').replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim().split(/\s+/);
        const sn = parts.length >= 2 ? parts[parts.length - 1].toLowerCase() : '';
        if (sn.length >= 5) surnameCounts.set(sn, (surnameCounts.get(sn) || 0) + 1);
      }
      for (const p of pool) {
        const parts = String(p?.name || '').replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim().split(/\s+/);
        const sn = parts.length >= 2 ? parts[parts.length - 1].toLowerCase() : '';
        if (sn.length >= 5 && surnameCounts.get(sn) === 1 && new RegExp(`\\b${escapeRegexToken(sn)}\\b`, 'i').test(full)) {
          matchedRosterObj = p;
          resolvedSlug = normalizeRosterSlug(p.name);
          break;
        }
      }
    }
  }

  // 3. Fallback when `rosterPlayers` is empty (e.g. unit test without full roster loaded)
  if (!resolvedSlug) {
    const leadSlugs = extractLeadProperNameSlugs(lead);
    resolvedSlug = leadSlugs[0] || (isSf ? resolveFallback49ersShorthandSlug(full) : '');
  }

  // When no active player is identified (e.g., team-level game chatter with zero player subject,
  // or full roster loaded without a match), stay conservative (0.35) so unrecognized/non-player items
  // never accidentally cross the >= 0.50 urgent `LIVE INJURY UPDATE` threshold.
  const noPlayerIdentified = !matchedRosterObj && !resolvedSlug && !item?.mentionedPlayers?.length;
  const fullRosterMiss = pool.length >= 20 && !matchedRosterObj;
  let valueScore =
    noPlayerIdentified || fullRosterMiss || (!isSf && pool.length > 0 && !matchedRosterObj) ? 0.35 : 0.58;
  let playerName = matchedRosterObj?.name || item?.mentionedPlayers?.[0]?.name || '';

  if (matchedRosterObj) {
    const pos = String(matchedRosterObj.position || '').trim().toUpperCase();
    const snap = Number(matchedRosterObj.primarySnapPct ?? matchedRosterObj.snapPct ?? 0);
    const capM = Number(matchedRosterObj.capHit2026 || matchedRosterObj.capHit || 0) / 1_000_000;
    const isStarter = Boolean(matchedRosterObj.isStarter || snap >= 55);

    let s = 0;
    // Snap share component (0.04 .. 0.38)
    if (snap >= 85) s += 0.38;
    else if (snap >= 65) s += 0.3;
    else if (snap >= 50) s += 0.22;
    else if (snap >= 30) s += 0.12;
    else s += 0.04;

    // Market / Cap value component (0.05 .. 0.36)
    if (capM >= 14) s += 0.36;
    else if (capM >= 9) s += 0.32;
    else if (capM >= 5) s += 0.22;
    else if (capM >= 2.5) s += 0.14;
    else s += 0.05;

    // Position & starter leverage (0.00 .. 0.30)
    if (pos === 'QB' && isStarter) s += 0.3;
    else if (isStarter && ['RB', 'WR', 'TE', 'OT', 'DE', 'EDGE', 'CB', 'LB'].includes(pos)) s += 0.16;
    else if (isStarter && ['DT', 'OG', 'C', 'S', 'FS', 'SS', 'FB'].includes(pos)) s += 0.11;
    else if (['K', 'PK', 'P', 'LS'].includes(pos)) s += 0.06;

    valueScore = Math.min(1, Number(s.toFixed(3)));
    const slug = normalizeRosterSlug(matchedRosterObj.name);
    if (isSf && FRANCHISE_CORE_PLAYER_SLUGS.has(slug)) {
      valueScore = Math.max(valueScore, slug === 'brockpurdy' ? 1.0 : 0.95);
    } else if (isSf && CORE_STARTER_FALLBACK_SLUGS.has(slug)) {
      valueScore = Math.max(valueScore, 0.65);
    }
  } else if (isSf && FRANCHISE_CORE_PLAYER_SLUGS.has(resolvedSlug)) {
    valueScore = resolvedSlug === 'brockpurdy' ? 1.0 : 0.95;
  } else if (isSf && CORE_STARTER_FALLBACK_SLUGS.has(resolvedSlug)) {
    valueScore = 0.7;
  } else if (/\b(?:practice squad|backup|reserve|special teamer)\b/i.test(full) || (isSf && /\b(?:valdez|sebastian valdez)\b/i.test(full))) {
    valueScore = 0.2;
  }

  const valueTier =
    valueScore >= 0.85
      ? 'franchise'
      : valueScore >= 0.5
        ? 'core_starter'
        : valueScore >= 0.16
          ? 'rotational'
          : 'depth';

  return { valueScore, valueTier, playerName };
}

/**
 * Combines in-game injury severity (`60%`) and player roster value (`40%`) into a calibrated priority score (`0..1`).
 * Minor 1-2 play knocks (e.g. "wind knocked out for a play or two") are clamped to `0.05` regardless of player star power.
 */
export function computeInGameInjuryPriority(item = {}, rosterPlayers = [], teamInput = null) {
  const sev = computeInGameInjurySeverity(item);
  const val = computePlayerRosterValue(item, rosterPlayers, teamInput);
  const impactScore =
    sev.severityTier === 'minor'
      ? 0.05
      : Number((0.6 * sev.severityScore + 0.4 * val.valueScore).toFixed(3));
  return {
    impactScore,
    ...sev,
    ...val
  };
}

export function classifyBreakingItem(item = {}, nowMs = Date.now(), gameContext = null) {
  const ctx =
    gameContext && typeof gameContext === 'object' && gameContext.appData
      ? resolveGameNewsContext(gameContext.appData, nowMs)
      : gameContext;
  const activeTeam = resolveTeamConfig(
    ctx?.teamConfig || gameContext?.team || item?._teamAbbr || getActiveTeamConfig()
  );
  const teamMatchers = getTeamClassifierMatchers(activeTeam);

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
  const isOpposingTeamOnlySubject = isOpposingTeamSubjectLead(leadClaim, item, activeTeam);

  // Evaluate primary event patterns strictly against `leadClaim` for articles (never trailing recap paragraphs!),
  // while checking the full short tweet body (`fullTweetOrLead`) for multi-sentence live in-game injury tweets
  // (e.g., "Colton McKivitz is down on the turf. Air cast going on his lower leg and the cart is coming out.").
  const isTweetItem = item?.type === 'tweet' || item?.type === 'social';
  const inGameClaimText = isTweetItem ? fullTweetOrLead : leadClaim;
  const hasConfirmedInGameStatus = CONFIRMED_IN_GAME_STATUS_REGEX.test(inGameClaimText);
  const hasSeriousInjuryEscalation = SERIOUS_INJURY_ESCALATION_REGEX.test(`${leadClaim} ${fullTweetOrLead}`);
  const isSpeculativeComparison = isSpeculativeInjuryComparisonOnly(`${leadClaim} ${fullTweetOrLead}`);
  const isMinorOrSpeculativeInjury =
    isSpeculativeComparison ||
    (MINOR_OR_SPECULATIVE_INJURY_NOISE_REGEX.test(`${leadClaim} ${fullTweetOrLead}`) &&
      !hasSeriousInjuryEscalation);
  const isDiagnosticScheduledOnly =
    DIAGNOSTIC_SCHEDULED_ONLY_REGEX.test(leadClaim) && !MATERIAL_INJURY_DIAGNOSIS_REGEX.test(leadClaim);
  const isNegatedCatastrophicTear = NEGATED_CATASTROPHIC_INJURY_REGEX.test(leadClaim);

  const matchesInGame =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isOpposingTeamOnlySubject &&
    !isMinorOrSpeculativeInjury &&
    matchesInGameInjuryOrReturn(inGameClaimText);
  const matchesMaterialInjuryDiagnosis =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isExpectedRoutineAbsence &&
    !isOpposingTeamOnlySubject &&
    !isMinorOrSpeculativeInjury &&
    !isDiagnosticScheduledOnly &&
    MATERIAL_INJURY_DIAGNOSIS_REGEX.test(leadClaim);
  const matchesPostGameInjury =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isExpectedRoutineAbsence &&
    !isOpposingTeamOnlySubject &&
    !isSpeculativeComparison &&
    (POST_GAME_INJURY_FOLLOWUP_REGEX.test(leadClaim) || teamMatchers.activeCoachInjuryUpdateRe.test(leadClaim));
  const matchesPracticeInjuryScoop =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isExpectedRoutineAbsence &&
    !isOpposingTeamOnlySubject &&
    PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(leadClaim);
  const matchesPreGameAvailabilityNoise =
    PRE_GAME_AVAILABILITY_NOISE_REGEX.test(leadClaim) || isPreGamePlayAvailabilityItem(item);

  // Guard TIER1_MAJOR against negated catastrophic injuries ("avoided a torn ACL" / "NOT a torn ACL")
  // and visual-comparison speculation ("looked very similar to the fractured ankle / torn ACL")
  const leadForTier1 = isNegatedCatastrophicTear
    ? leadClaim.replace(/\b(?:torn\s+(?:acl|achilles|pectoral|patellar)|season-ending\s+[a-z]+)\b/gi, '')
    : leadClaim;
  const matchesTier1Major =
    !isSpeculative &&
    !isSpeculativeComparison &&
    !isSecondaryOrCommentary &&
    !isOpposingTeamOnlySubject &&
    !NON_TRANSACTION_RELEASE_REGEX.test(leadClaim) &&
    (TIER1_MAJOR_BREAKING_EVENT_REGEX.test(leadForTier1) || teamMatchers.activeTradeLeadRe.test(leadForTier1));

  const matchesTier2RosterMove =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isOpposingTeamOnlySubject &&
    !NON_TRANSACTION_RELEASE_REGEX.test(leadClaim) &&
    (TIER2_ROSTER_OR_STATUS_MOVE_REGEX.test(leadClaim) || teamMatchers.activeRosterMovePrefixRe.test(leadClaim));

  const tradeDeadlinePassed =
    Number.isFinite(ctx?.tradeDeadlineMs) && nowMs > ctx.tradeDeadlineMs + 2 * 3_600_000;
  const matchesCredibleTradeRumor =
    !isSpeculative &&
    !isSecondaryOrCommentary &&
    !isOpposingTeamOnlySubject &&
    !tradeDeadlinePassed &&
    CREDIBLE_FORWARD_TRADE_RUMOR_REGEX.test(leadClaim);

  const matchesSalientInterview = !isSpeculative && !isOpposingTeamOnlySubject && SALIENT_INTERVIEW_OR_FEATURE_REGEX.test(combined);

  const repEntry = resolveReporterFromNameOrHandle(
    item.reporterId || item.author || item.reporterName || item.authorHandle,
    activeTeam
  );
  const effectiveTrustTier = repEntry?.isOtherTeamBeat
    ? Math.max(3, Number(item.trustTier) || 3)
    : Number(item.trustTier) || repEntry?.trustTier || 2;

  // 1. LIVE IN-GAME MODE: Prioritize in-game injuries (#1) & live game tweets; sink pre-game availability noise to bottom
  if (ctx?.inGame && Number.isFinite(ctx.activeKickoffMs)) {
    const koMs = ctx.activeKickoffMs;
    const isDuringGame = Number.isFinite(pubMs) && pubMs >= koMs - 5 * 60_000;

    if (matchesTier1Major && ageHours <= 6) {
      return {
        isBreaking: true,
        isUrgentBreaking: true,
        isInGameInjury: Boolean(isDuringGame && matchesInGame),
        storyTier: 'tier1_major',
        breakingPriority: decayPriority(2.95, ageHours, 8),
        breakingBadge: 'BREAKING',
        ageHours
      };
    }

    const isExplicitPregameInactivesOrPractice =
      /\b(?:inactives?\b|officially\s+inactive|declared\s+inactive|active\s+vs\.?|active\s+against|expected\s+to\s+be\s+active|didn['’]?t\s+activate|did\s+not\s+activate|remains\s+on\s+injured\s+reserve|practice\s+report|did\s+not\s+practice|limited\s+(?:at|in)\s+(?:wednesday|thursday|friday|today)['’]?s?\s+practice)\b/i.test(
        leadClaim
      );
    if (matchesPreGameAvailabilityNoise && !matchesInGame && (!isDuringGame || isExplicitPregameInactivesOrPractice)) {
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

    // Confirmed/salient in-game injury updates & material diagnostic updates are calibrated by
    // Injury Severity (minor 1-2 play knocks vs moderate vs serious/catastrophic) × Player Value (CMC/franchise/starters vs rotational/depth like Valdez).
    if ((matchesInGame || matchesMaterialInjuryDiagnosis) && (effectiveTrustTier <= 2 || hasConfirmedInGameStatus)) {
      const injPri = computeInGameInjuryPriority(item, ctx?.rosterPlayers, activeTeam);
      if (injPri.severityTier !== 'minor') {
        const isHighValuePlayer = injPri.valueScore >= 0.5;
        const isUrgentLive = isHighValuePlayer || matchesMaterialInjuryDiagnosis;
        return {
          isBreaking: isUrgentLive,
          isUrgentBreaking: isUrgentLive,
          isInGameInjury: true,
          storyTier: 'in_game_injury',
          breakingPriority: isUrgentLive
            ? Number((3.05 + injPri.impactScore * 0.45).toFixed(3))
            : Number((2.55 + injPri.impactScore * 0.4).toFixed(3)),
          breakingBadge: isUrgentLive ? 'LIVE INJURY UPDATE' : 'INJURY UPDATE',
          injurySeverityScore: injPri.severityScore,
          injurySeverityTier: injPri.severityTier,
          playerValueScore: injPri.valueScore,
          playerValueTier: injPri.valueTier,
          injuryImpactScore: injPri.impactScore,
          ageHours
        };
      }
    }

    const isTrackedTeamBeat = Boolean(repEntry && !repEntry.isOtherTeamBeat);

    if (matchesPostGameInjury && !isMinorOrSpeculativeInjury && !isDiagnosticScheduledOnly && (effectiveTrustTier <= 2 || isTrackedTeamBeat)) {
      return {
        isBreaking: true,
        isUrgentBreaking: false,
        isInGameInjury: true,
        storyTier: 'post_game_injury',
        breakingPriority: 2.65,
        breakingBadge: 'INJURY UPDATE',
        ageHours
      };
    }

    if (matchesCredibleTradeRumor && (effectiveTrustTier <= 2 || isTrackedTeamBeat)) {
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

    // Live in-game highlight clips & instant scoring plays (e.g. George Kittle TD highlight) rocket above routine chatter
    const isLiveHighlightOrScoringPlay =
      Boolean(item.isLiveGameHighlight) ||
      item.wireSource === 'espn_live_highlights' ||
      item.wireSource === 'espn_live_scoring_plays' ||
      item.wireSource === '49ers_official_videos_rss' ||
      (Boolean(item.isHighlightClip) && Boolean(item.videoStreamUrl || item.externalVideoUrl || item.videoId));
    if (isLiveHighlightOrScoringPlay && !isSpeculative) {
      return {
        isBreaking: false,
        isUrgentBreaking: false,
        isInGameInjury: false,
        storyTier: 'live_in_game_highlight',
        breakingPriority: 2.35,
        breakingBadge: null,
        ageHours
      };
    }

    // Routine in-game beat tweets stay prioritized in-game (`storyTier: 'live_in_game'`) WITHOUT spamming red breaking badges
    if ((item.type === 'tweet' || item.type === 'social') && !isSpeculative) {
      return {
        isBreaking: false,
        isUrgentBreaking: false,
        isInGameInjury: false,
        storyTier: 'live_in_game',
        breakingPriority: 2.1,
        breakingBadge: null,
        ageHours
      };
    }
  }

  // 1b. T-95m PRE-KICKOFF OFFICIAL INACTIVES DECLARED WINDOW:
  //     Once official actives/inactives drop ahead of kickoff, earlier Mon-Sat speculation hypothesizing
  //     whether a player might practice or play is immediately superseded (while official active/inactive
  //     announcements posted within 3h of kickoff stay visible until kickoff).
  if (
    !ctx?.inGame &&
    ctx?.inactivesDeclaredWindow &&
    matchesPreGameAvailabilityNoise &&
    !LEAD_PERMANENT_OR_POSTGAME_EXCLUSION_REGEX.test(leadClaim)
  ) {
    const isFreshOfficialInactives =
      isOfficialGameDayInactivesAnnouncement(item) &&
      Number.isFinite(pubMs) &&
      (Number.isFinite(ctx.upcomingKickoffMs)
        ? pubMs >= ctx.upcomingKickoffMs - 3 * 3_600_000
        : ageHours <= 3);
    if (!isFreshOfficialInactives) {
      return {
        isBreaking: false,
        isUrgentBreaking: false,
        isInGameInjury: false,
        isStalePreGameAvailability: true,
        storyTier: 'stale_pregame',
        breakingPriority: -8.0,
        breakingBadge: null,
        ageHours
      };
    }
  }

  // Demote any pre-game availability item from a completed (or elapsed-past-kickoff) game regardless of post-game hour window
  const completedKoRef = ctx?.completedKickoffMs ?? ctx?.latestElapsedKickoffMs ?? ctx?.latestCompletedKickoffMs ?? null;
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

  // 3. LIVE / RECENT SIDELINE IN-GAME INJURY UPDATES (<16h), calibrated by Injury Severity × Player Value
  if (matchesInGame && ageHours <= 16 && (effectiveTrustTier <= 2 || hasConfirmedInGameStatus || Boolean(item.isFirstMoverInjuryScoop))) {
    const injPri = computeInGameInjuryPriority(item, ctx?.rosterPlayers, activeTeam);
    if (injPri.severityTier !== 'minor') {
      const isHighValueOrFirstMover = injPri.valueScore >= 0.5 || Boolean(item.isFirstMoverInjuryScoop);
      const isUrgent = ageHours <= 4.5 && isHighValueOrFirstMover;
      return {
        isBreaking: isUrgent,
        isUrgentBreaking: isUrgent,
        isInGameInjury: ageHours <= 8,
        isPostGameInjuryUpdate: Boolean(ctx?.postGame48h),
        storyTier: 'in_game_injury',
        breakingPriority: isUrgent
          ? Number((3.02 + injPri.impactScore * 0.45).toFixed(3))
          : decayPriority(2.45 + injPri.impactScore * 0.35, ageHours, 7.5),
        breakingBadge: isUrgent ? 'LIVE INJURY UPDATE' : 'INJURY UPDATE',
        injurySeverityScore: injPri.severityScore,
        injurySeverityTier: injPri.severityTier,
        playerValueScore: injPri.valueScore,
        playerValueTier: injPri.valueTier,
        injuryImpactScore: injPri.impactScore,
        ageHours
      };
    }
  }

  // 4. TIER-2 OFFICIAL ROSTER MOVES & IR RETURN DESIGNATIONS (e.g. "49ers Designate DT CJ West For Return")
  //    Wears `BREAKING` strictly when <= 4.5h old, then transitions cleanly to `ROSTER MOVE` up to 24h.
  if (matchesTier2RosterMove && ageHours <= 24) {
    const isExplicitAlertOnly =
      /^(?:breaking|just in):/i.test(leadClaim) &&
      !/\b(designate|practice window|reinstated|activated|placed [\s\S]{0,28}on (?:ir|injured reserve)|signed|claimed|waived|released|roster move:)\b/i.test(
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

  // 4b. CONFIRMED MATERIAL INJURY DIAGNOSTIC UPDATES (e.g. "avoided a torn ACL", "X-rays negative", "MRI confirmed MCL sprain, out 2-3 weeks")
  //     Wears urgent `BREAKING` strictly when fresh (<= 4.5h) from Tier 1-2, then transitions to calm `INJURY UPDATE`.
  //     Non-material remarks ("scheduled for an MRI tomorrow", "we'll see Wednesday") fall through to calm Section 5/7.
  const isPreFinishedGameItem =
    ctx?.postGame48h && Number.isFinite(ctx.completedKickoffMs) && Number.isFinite(pubMs) && pubMs < ctx.completedKickoffMs;
  const isVerifiedTeamBeatReporter = Boolean(repEntry && !repEntry.isOtherTeamBeat);
  if (
    matchesMaterialInjuryDiagnosis &&
    !isPreFinishedGameItem &&
    ageHours <= 24 &&
    (effectiveTrustTier <= 2 || isVerifiedTeamBeatReporter) &&
    !(matchesPreGameAvailabilityNoise && !/\b(?:mri|x-ray|ct scan|acl|achilles|intact|avoided|negative|fracture|broken|surgery|concussion protocol|grade\s+[123]|multiple weeks|several weeks|\d+(?:-\d+)?\s+weeks?)\b/i.test(leadClaim))
  ) {
    const withinBreakingWindow = ageHours <= 4.5;
    return {
      isBreaking: withinBreakingWindow,
      isUrgentBreaking: withinBreakingWindow,
      isInGameInjury: false,
      isPostGameInjuryUpdate: Boolean(ctx?.postGame48h),
      storyTier: 'post_game_injury',
      breakingPriority: decayPriority(2.92, ageHours, 8.5),
      breakingBadge: withinBreakingWindow ? 'BREAKING' : 'INJURY UPDATE',
      ageHours
    };
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

  // 6. CREDIBLE FORWARD-LOOKING INSIDER TRADE INTEL (only while window open, tracked beat & national insiders)
  if (matchesCredibleTradeRumor && ageHours <= 18 && (effectiveTrustTier <= 2 || isVerifiedTeamBeatReporter)) {
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

  // Live In-Game Override: prioritize confirmed injuries by Severity × Player Value (e.g. serious CMC > serious Valdez > routine plays/minor knocks)
  if (ctx?.inGame) {
    if (item.isInGameInjury) {
      const impact = Number.isFinite(Number(item.injuryImpactScore))
        ? Number(item.injuryImpactScore)
        : computeInGameInjuryPriority(item, ctx?.rosterPlayers).impactScore;
      if (isUrgentBreakingBadge(item.breakingBadge)) {
        return 500 + impact * 70 - Math.min(40, clusterAnchorAge * 12);
      }
      return 430 + impact * 65 - Math.min(40, clusterAnchorAge * 12);
    }
    if (item.storyTier === 'live_in_game_highlight') return 385 - Math.min(55, clusterAnchorAge * 16);
    if (item.storyTier === 'live_in_game') return 360 - Math.min(50, clusterAnchorAge * 14);
    if (item.storyTier === 'tier1_major' && clusterAnchorAge <= 6) return 420 - clusterAnchorAge * 12;
  }

  const storyTier = item.storyTier || 'standard';
  let eventMagnitude = 48;
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
    case 'live_in_game_highlight':
      eventMagnitude = 90;
      gravity = 1.28;
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
      eventMagnitude =
        Boolean(item.videoStreamUrl || item.videoId || item.isAnimatedGif || item.hasInlineChartImage)
          ? 68
          : 62;
      gravity = 1.30;
      break;
    case 'side_note':
      eventMagnitude = 28;
      gravity = 1.60;
      break;
    default: {
      const lead = extractPrimaryClaimText(item);
      if (HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead) || RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(lead)) {
        eventMagnitude = 28;
        gravity = 1.60;
      } else if (/\b(injury report|practice report|returns? to practice|miss practice)\b/i.test(lead)) {
        eventMagnitude = 78;
        gravity = 1.30;
      } else {
        eventMagnitude = 50;
        gravity = 1.40;
      }
      break;
    }
  }

  const repAuthEntry = resolveReporterFromNameOrHandle(
    item.reporterId || item.author || item.reporterName || item.authorHandle,
    ctx?.teamConfig
  );
  const trustTier = repAuthEntry?.isOtherTeamBeat ? 3 : Number(item.trustTier) || repAuthEntry?.trustTier || 2;
  const isRewriteAggregator = AGGREGATOR_REWRITE_OUTLET_REGEX.test(
    `${item.outletName || ''} ${item.url || ''}`
  );
  // Balanced authority weighting: avoid burying Tier 2 & Tier 3 team beat voices behind Tier 1 reporters
  const authorityBonus = isRewriteAggregator
    ? -10
    : repAuthEntry?.isOtherTeamBeat
      ? -2
      : trustTier === 1
        ? 7
        : trustTier === 2
          ? 6
          : 3;

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

  // Speculative pre-game play/practice availability has a much shorter relevancy shelf life
  // than permanent roster moves, film breakdowns, or post-game analysis even mid-week.
  const isSpeculativePreGameAvail =
    isPreGamePlayAvailabilityItem(item) && !isOfficialGameDayInactivesAnnouncement(item);
  if (isSpeculativePreGameAvail) {
    gravity = Math.max(gravity, 1.72);
  }

  const numerator = Math.max(
    8,
    eventMagnitude + authorityBonus + velocityBonus + substanceBonus + socialPlatformBonus + phaseFormatBonus
  );
  const denom = Math.pow(clusterAnchorAge + tau, gravity);
  let baseRank = numerator / denom + activeBreakingFloorBoost;

  if (isSpeculativePreGameAvail && clusterAnchorAge > 36) {
    baseRank *= 0.45;
  }

  // Kickoff Epoch Wall: once a game kicks off or completes (up to 7 days), demote non-Tier-1 chatter published
  // BEFORE that game's kickoff unless it explicitly targets the upcoming week/opponent
  const refKoMs = ctx?.inGame ? ctx.activeKickoffMs : ctx?.latestCompletedKickoffMs;
  if (
    Number.isFinite(refKoMs) &&
    Number.isFinite(pubMs) &&
    nowMs - refKoMs <= 168 * 3_600_000 &&
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
      const within72h = nowMs - refKoMs <= 72 * 3_600_000;
      const epochMult = isSpeculativePreGameAvail
        ? 0.12
        : ctx?.inGame || ctx?.postGameImmediate
          ? 0.25
          : within72h
            ? 0.42
            : 0.48;
      baseRank *= epochMult;
    }
  }

  // Demote opposing-team-only items unless they pertain to the upcoming opponent's matchup context
  const primaryLeadText = extractPrimaryClaimText(item);
  if (isOpposingTeamSubjectLead(primaryLeadText, item, ctx?.teamConfig)) {
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
        breakingBadge: withinWindow ? cls.breakingBadge : null,
        ...(Number.isFinite(cls.injuryImpactScore)
          ? {
              injurySeverityScore: cls.injurySeverityScore,
              injurySeverityTier: cls.injurySeverityTier,
              playerValueScore: cls.playerValueScore,
              playerValueTier: cls.playerValueTier,
              injuryImpactScore: cls.injuryImpactScore
            }
          : {})
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

      // Within a near-tied StoryRank band on items published within 30m, honor First-Mover, breaking Trust-Tier & X-over-Bluesky
      if (Math.abs(rankDiff) < 1.2 && Math.abs(bMs - aMs) <= 30 * 60_000) {
        if (Math.abs(bMs - aMs) <= 15 * 60_000) {
          if (a.isFirstMoverInjuryScoop && !b.isFirstMoverInjuryScoop && (a.corroborationCount || 1) === 1) {
            return -1;
          }
          if (b.isFirstMoverInjuryScoop && !a.isFirstMoverInjuryScoop && (b.corroborationCount || 1) === 1) {
            return 1;
          }
          if (a.isBreaking || b.isBreaking || a.isInGameInjury || b.isInGameInjury) {
            const tierDiff = (a.trustTier || 2) - (b.trustTier || 2);
            if (tierDiff !== 0) return tierDiff;
          }
        }
        const aIsX = isDirectXStatusUrl(a.url);
        const bIsX = isDirectXStatusUrl(b.url);
        if (aIsX !== bIsX) return aIsX ? -1 : 1;
      }

      if (Math.abs(rankDiff) >= 0.35) return rankDiff;
      return bMs - aMs;
    });

  // Enforce at most ONE breaking / top-pinned injury update per injured player BEFORE the feed-wide scarcity cap
  // so 3 tweets about the same player's injury never stack at the top or crowd out other injured players!
  const rosterPlayersForDedup = Array.isArray(ctx?.rosterPlayers)
    ? ctx.rosterPlayers
    : Array.isArray(appData?.roster?.players)
      ? appData.roster.players
      : [];
  const afterPerPlayerInj = enforceSingleBreakingInjuryPerPlayer(scored, {
    nowMs,
    rosterPlayers: rosterPlayersForDedup,
    teamConfig: ctx?.teamConfig || null
  });
  if (afterPerPlayerInj !== scored) {
    afterPerPlayerInj.sort((a, b) => {
      const aNeg = (a.breakingPriority || 0) < 0;
      const bNeg = (b.breakingPriority || 0) < 0;
      if (aNeg !== bNeg) return aNeg ? 1 : -1;
      const rankDiff = (b.storyRank || 0) - (a.storyRank || 0);
      if (Math.abs(rankDiff) >= 0.35) return rankDiff;
      const aMs = resolveEffectivePublishTimestampMs(a, nowMs) || 0;
      const bMs = resolveEffectivePublishTimestampMs(b, nowMs) || 0;
      return bMs - aMs;
    });
  }

  // Enforce feed-wide BREAKING scarcity cap BOTH in-game and out-of-game so at most `maxUrgentBreakingBadges`
  // distinct story angles wear urgent red badges simultaneously (gracefully downgrading overflow to ROSTER MOVE / INJURY UPDATE).
  if (maxUrgentBreakingBadges > 0) {
    let urgentSeen = 0;
    const seenUrgentKeys = new Set();
    for (const item of afterPerPlayerInj) {
      if (!isUrgentBreakingBadge(item.breakingBadge)) continue;
      const injInfo = analyzeSinglePlayerInjuryItem(item, rosterPlayersForDedup, ctx?.teamConfig || null);
      const sigKey =
        (injInfo.isInjury && injInfo.playerSlug ? `player_injury::${injInfo.playerSlug}` : '') ||
        buildStorySignatureKey(item) ||
        item.id ||
        item.title;
      if (seenUrgentKeys.has(sigKey)) continue;
      urgentSeen += 1;
      seenUrgentKeys.add(sigKey);
      if (urgentSeen > maxUrgentBreakingBadges) {
        item.isUrgentBreaking = false;
        item.isBreaking = false;
        item.breakingBadge =
          item.category === 'injury' || item.isInGameInjury || item.isPostGameInjuryUpdate
            ? 'INJURY UPDATE'
            : 'ROSTER MOVE';
      }
    }
  }

  return afterPerPlayerInj;
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

function resolveAuthorDiversityKey(item = {}) {
  const raw = String(item?.reporterId || item?.authorHandle || item?.reporterName || item?.author || '')
    .toLowerCase()
    .replace(/^@/, '')
    .trim();
  if (!raw || /^(49ers beat|49ers beat wire|espn|nfl|49ers\.com official|san francisco 49ers)$/i.test(raw)) {
    return '';
  }
  return raw;
}

function resolvePlayerDiversityKey(item = {}) {
  if (!item || typeof item !== 'object') return '';
  if (isMultiTopicDigestOrRoundup(item)) return '';
  const lead = extractPrimaryClaimText(item);
  if (!lead) return '';
  const players = Array.isArray(item.mentionedPlayers) ? item.mentionedPlayers : [];
  if (players.length === 0 || players.length > 3) return '';
  const primary = players.find(mp => {
    const surname = String(mp?.name || '')
      .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
      .trim()
      .split(/\s+/)
      .slice(-1)[0];
    return surname && surname.length >= 3 && new RegExp(`\\b${escapeRegexToken(surname)}\\b`, 'i').test(lead);
  });
  const picked = primary || (players.length === 1 ? players[0] : null);
  if (!picked) return '';
  return String(picked.name || picked.id || '')
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Ensures injury prioritization, single-player sagas, and high-frequency individual reporters never crowd out
 * diverse Tier 1/2/3 beat voices, trades/roster moves, All-22 film breakdowns, or standout
 * human-interest stories in `Top` mode, while never displacing urgent live breaking news.
 */
export function balanceFeedTopSalience(
  items = [],
  {
    nowMs = Date.now(),
    gameContext = null,
    appData = null,
    maxConsecutiveInjuries = 2,
    maxConsecutiveSameAuthor = 2,
    maxAuthorInTopWindow = 3,
    maxConsecutiveSamePlayer = 1
  } = {}
) {
  if (!Array.isArray(items) || items.length <= maxConsecutiveInjuries) return items;
  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);
  if (ctx?.inGame) return items;

  const remaining = [...items];
  const result = [];
  let consecutiveInj = 0;
  let lastAuthorKey = '';
  let consecutiveAuthor = 0;
  let lastPlayerKey = '';
  let consecutivePlayer = 0;
  const topAuthorCounts = new Map();

  const recordPicked = picked => {
    result.push(picked);
    if (isPureInjuryCard(picked)) {
      consecutiveInj += 1;
    } else {
      consecutiveInj = 0;
    }
    const aKey = resolveAuthorDiversityKey(picked);
    if (aKey) {
      if (aKey === lastAuthorKey) {
        consecutiveAuthor += 1;
      } else {
        lastAuthorKey = aKey;
        consecutiveAuthor = 1;
      }
      if (result.length <= 18) {
        topAuthorCounts.set(aKey, (topAuthorCounts.get(aKey) || 0) + 1);
      }
    } else {
      lastAuthorKey = '';
      consecutiveAuthor = 0;
    }
    const pKey = resolvePlayerDiversityKey(picked);
    if (pKey) {
      if (pKey === lastPlayerKey) {
        consecutivePlayer += 1;
      } else {
        lastPlayerKey = pKey;
        consecutivePlayer = 1;
      }
    } else {
      lastPlayerKey = '';
      consecutivePlayer = 0;
    }
  };

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
          Number(cand.signalScore || 0) >= 35 ||
          SALIENT_INTERVIEW_OR_FEATURE_REGEX.test(text) ||
          CREDIBLE_FORWARD_TRADE_RUMOR_REGEX.test(text) ||
          TIER1_MAJOR_BREAKING_EVENT_REGEX.test(text)
        );
      });

      if (nonInjIdx >= 0) {
        const [picked] = remaining.splice(nonInjIdx, 1);
        recordPicked(picked);
        continue;
      }
    }

    // Enforce balanced reporter & single-player-saga distribution in Top 22 (prevent one prolific reporter
    // or a multi-phase player saga from stacking consecutive cards when fresh diverse stories sit right below)
    const head = remaining[0];
    const headAuthor = resolveAuthorDiversityKey(head);
    const headPlayer = resolvePlayerDiversityKey(head);
    const headIsUrgent = isUrgentBreakingBadge(head?.breakingBadge);
    const headOverConsecutive =
      Boolean(headAuthor) && headAuthor === lastAuthorKey && consecutiveAuthor >= maxConsecutiveSameAuthor;
    const headOverTopCap =
      Boolean(headAuthor) && result.length < 18 && (topAuthorCounts.get(headAuthor) || 0) >= maxAuthorInTopWindow;
    const headOverSamePlayer =
      Boolean(headPlayer) &&
      maxConsecutiveSamePlayer > 0 &&
      headPlayer === lastPlayerKey &&
      consecutivePlayer >= maxConsecutiveSamePlayer;

    if (!headIsUrgent && (headOverConsecutive || headOverTopCap || headOverSamePlayer) && result.length < 22) {
      const headPubMs = resolveEffectivePublishTimestampMs(head, nowMs) || 0;
      const altIdx = remaining.findIndex((cand, idx) => {
        if (idx === 0 || idx > 16 || cand?.isClickbait) return false;
        if (cand?.storyTier === 'side_note') return false;
        if (consecutiveInj >= maxConsecutiveInjuries && isPureInjuryCard(cand)) return false;
        const candAuthor = resolveAuthorDiversityKey(cand);
        const candPlayer = resolvePlayerDiversityKey(cand);
        if ((headOverConsecutive || headOverTopCap) && candAuthor && candAuthor === headAuthor) return false;
        if (candAuthor && (topAuthorCounts.get(candAuthor) || 0) >= maxAuthorInTopWindow) return false;
        if (headOverSamePlayer && candPlayer && candPlayer === headPlayer) return false;
        const candPubMs = resolveEffectivePublishTimestampMs(cand, nowMs) || 0;
        // Keep temporal coherence: only pull forward an alternate voice/story within 36h of the displaced item
        if (headPubMs && candPubMs && headPubMs - candPubMs > 36 * 3_600_000) return false;
        return true;
      });
      if (altIdx > 0) {
        const [picked] = remaining.splice(altIdx, 1);
        recordPicked(picked);
        continue;
      }
    }

    const next = remaining.shift();
    recordPicked(next);
  }

  return result;
}

const INJURY_BODY_PART_EXTRACT_RE =
  /\b(acl|mcl|pcl|lcl|meniscus|patellar|achilles|concussion|high[- ]ankle|ankle|lower[- ]leg|upper[- ]leg|fibula|tibia|shin|leg|knee|hamstring|calf|groin|quad|quadriceps|hip|shoulder|collarbone|clavicle|rib|ribs|chest|pectoral|pec|back|neck|head|elbow|forearm|wrist|hand|thumb|finger|foot|heel|toe|turf toe|lisfranc|oblique|abdomen|biceps|triceps)\b/i;

function extractNamedInjuryBodyPart(text = '') {
  const m = String(text || '').match(INJURY_BODY_PART_EXTRACT_RE);
  return m ? m[1].toLowerCase().replace(/\s+/g, '-') : '';
}

const INJURY_ANATOMY_GROUP_BY_PART = {
  'lower-leg': 'lower_leg',
  leg: 'lower_leg',
  fibula: 'lower_leg',
  tibia: 'lower_leg',
  shin: 'lower_leg',
  ankle: 'lower_leg',
  'high-ankle': 'lower_leg',
  achilles: 'lower_leg',
  calf: 'lower_leg',
  foot: 'lower_leg',
  heel: 'lower_leg',
  toe: 'lower_leg',
  'turf-toe': 'lower_leg',
  lisfranc: 'lower_leg',
  knee: 'knee',
  acl: 'knee',
  mcl: 'knee',
  pcl: 'knee',
  lcl: 'knee',
  meniscus: 'knee',
  patellar: 'knee',
  'upper-leg': 'upper_leg',
  hamstring: 'upper_leg',
  quad: 'upper_leg',
  quadriceps: 'upper_leg',
  groin: 'upper_leg',
  hip: 'upper_leg',
  shoulder: 'upper_arm',
  collarbone: 'upper_arm',
  clavicle: 'upper_arm',
  chest: 'upper_arm',
  pectoral: 'upper_arm',
  pec: 'upper_arm',
  biceps: 'upper_arm',
  triceps: 'upper_arm',
  elbow: 'upper_arm',
  forearm: 'upper_arm',
  wrist: 'upper_arm',
  hand: 'upper_arm',
  thumb: 'upper_arm',
  finger: 'upper_arm',
  rib: 'torso',
  ribs: 'torso',
  back: 'torso',
  oblique: 'torso',
  abdomen: 'torso',
  head: 'head_neck',
  concussion: 'head_neck',
  neck: 'head_neck'
};

function areInjuryBodyPartsCompatible(partA = '', partB = '') {
  if (!partA || !partB) return true;
  if (partA === partB) return true;
  const gA = INJURY_ANATOMY_GROUP_BY_PART[partA] || partA;
  const gB = INJURY_ANATOMY_GROUP_BY_PART[partB] || partB;
  if (gA === gB) return true;
  if (
    (partA === 'leg' && (gB === 'knee' || gB === 'upper_leg')) ||
    (partB === 'leg' && (gA === 'knee' || gA === 'upper_leg'))
  ) {
    return true;
  }
  return false;
}

const ROSTER_PRIMARY_MATCHER_CACHE = new WeakMap();

function isAsciiWordCharCode(code) {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

function findWordBoundaryIndexLower(haystackLower, needleLower) {
  if (!haystackLower || !needleLower) return -1;
  const nLen = needleLower.length;
  const hLen = haystackLower.length;
  let pos = 0;
  while (pos <= hLen - nLen) {
    const idx = haystackLower.indexOf(needleLower, pos);
    if (idx < 0) return -1;
    const beforeOk = idx === 0 || !isAsciiWordCharCode(haystackLower.charCodeAt(idx - 1));
    const afterPos = idx + nLen;
    const afterOk = afterPos >= hLen || !isAsciiWordCharCode(haystackLower.charCodeAt(afterPos));
    if (beforeOk && afterOk) return idx;
    pos = idx + 1;
  }
  return -1;
}

function getCompiledRosterPrimaryMatchers(pool) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const cached = ROSTER_PRIMARY_MATCHER_CACHE.get(pool);
  if (cached) return cached;
  const activePool = pool.filter(p => p?.name && p.rosterBucket !== 'retired');
  const surnameCounts = new Map();
  const rawEntries = [];
  for (const p of activePool) {
    const cleanName = String(p.name).replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim();
    const slug = normalizeRosterSlug(cleanName);
    if (!slug) continue;
    const fullLower = cleanName.toLowerCase();
    const parts = fullLower.split(/\s+/).filter(Boolean);
    const sn = parts.length >= 2 ? parts[parts.length - 1] : '';
    if (sn.length >= 4) surnameCounts.set(sn, (surnameCounts.get(sn) || 0) + 1);
    rawEntries.push({ slug, fullLower, sn });
  }
  const compiled = rawEntries.map(e => ({
    slug: e.slug,
    fullLower: e.fullLower.length >= 5 ? e.fullLower : '',
    uniqueSurnameLower: e.sn.length >= 5 && surnameCounts.get(e.sn) === 1 ? e.sn : ''
  }));
  ROSTER_PRIMARY_MATCHER_CACHE.set(pool, compiled);
  return compiled;
}

/**
 * Resolves the primary injured/subject player slug for a single-player news item by preferring the
 * player appearing EARLIEST in the lead sentence (so `"McKivitz (lower leg) was carted off... Vederian Lowe took over"`
 * and `"Colton McKivitz's left lower leg injury looked similar to Fred Warner's..."` ALWAYS resolve to `coltonmckivitz`).
 * Returns `''` for multi-player weekly injury reports or multi-topic digests.
 */
export function resolvePrimaryInjuredPlayerSlug(item = {}, rosterPlayers = [], teamInput = null) {
  if (!item || typeof item !== 'object') return '';
  if (isMultiTopicDigestOrRoundup(item)) return '';

  const lead = extractPrimaryClaimText(item);
  const full = String(item.fullText || item.title || item.headline || '').trim();
  const leadLower = lead.toLowerCase();

  if (
    /\b(injury report|pre practice report|players on its practice participation|inactives list)\b/.test(leadLower) &&
    ((item.mentionedPlayers?.length || 0) >= 2 || /\b(\d+ players|several others|not participating)\b/.test(leadLower))
  ) {
    return '';
  }

  const findEarliestMatchInLower = (textLower, candidates = []) => {
    if (!textLower || !Array.isArray(candidates) || candidates.length === 0) return { slug: '', matchCount: 0 };
    let bestIdx = Infinity;
    let bestSlug = '';
    const matchedSlugs = new Set();

    for (const p of candidates) {
      const cleanName = String(p?.name || '')
        .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .trim();
      const slug = normalizeRosterSlug(cleanName || p?.id || '');
      if (!slug || slug.length < 4) continue;
      const cleanLower = cleanName.toLowerCase();
      let hitIdx = -1;
      if (cleanLower.length >= 5) {
        hitIdx = findWordBoundaryIndexLower(textLower, cleanLower);
      }
      if (hitIdx < 0) {
        const parts = cleanLower.split(/\s+/).filter(Boolean);
        const surname = parts.length >= 2 ? parts[parts.length - 1] : '';
        if (surname.length >= 4) {
          hitIdx = findWordBoundaryIndexLower(textLower, surname);
        }
      }
      if (hitIdx >= 0) {
        matchedSlugs.add(slug);
        if (hitIdx < bestIdx) {
          bestIdx = hitIdx;
          bestSlug = slug;
        }
      }
    }
    return { slug: bestSlug, matchCount: matchedSlugs.size };
  };

  const mentioned = Array.isArray(item.mentionedPlayers) ? item.mentionedPlayers : [];
  if (mentioned.length > 0) {
    const inLead = findEarliestMatchInLower(leadLower, mentioned);
    if (
      inLead.matchCount >= 3 &&
      /\b(injury report|practice report|did not practice|not participating|limited|inactives?|ruled out|miss practice)\b/i.test(lead)
    ) {
      return '';
    }
    if (inLead.slug) return inLead.slug;
  }

  const pool = Array.isArray(rosterPlayers) ? rosterPlayers : [];
  if (pool.length > 0 && leadLower) {
    const compiled = getCompiledRosterPrimaryMatchers(pool);
    let bestIdx = Infinity;
    let bestSlug = '';
    for (let i = 0; i < compiled.length; i++) {
      const e = compiled[i];
      let hitIdx = e.fullLower ? findWordBoundaryIndexLower(leadLower, e.fullLower) : -1;
      if (hitIdx < 0 && e.uniqueSurnameLower) {
        hitIdx = findWordBoundaryIndexLower(leadLower, e.uniqueSurnameLower);
      }
      if (hitIdx >= 0 && hitIdx < bestIdx) {
        bestIdx = hitIdx;
        bestSlug = e.slug;
      }
    }
    if (bestSlug) return bestSlug;
  }

  const activeTeam = resolveTeamConfig(teamInput || item?._teamAbbr || getActiveTeamConfig());
  const isSf = activeTeam?.abbr === 'SF';
  const leadSlugs = extractLeadProperNameSlugs(lead);
  if (leadSlugs.length >= 3 && /\b(injury report|practice report|did not practice|not participating|inactives?)\b/i.test(lead)) {
    return '';
  }
  if (leadSlugs[0]) return leadSlugs[0];

  if (isSf) {
    const sfLeadSlug = resolveFallback49ersShorthandSlug(lead);
    if (sfLeadSlug) return sfLeadSlug;
  }

  if (mentioned.length > 0) {
    const inFull = findEarliestMatchInLower(full.toLowerCase(), mentioned);
    if (inFull.slug) return inFull.slug;
    if (mentioned.length === 1) {
      return normalizeRosterSlug(mentioned[0]?.name || mentioned[0]?.id || '');
    }
  }

  if (isSf) {
    const sfFullSlug = resolveFallback49ersShorthandSlug(full);
    if (sfFullSlug) return sfFullSlug;
  }

  return '';
}

const SINGLE_PLAYER_INJURY_CUE_RE =
  /\b(injur\w*|ankle|knee|lower[- ]leg|upper[- ]leg|leg\s+injur\w*|shoulder|hamstring|calf|groin|quad|hip|rib|ribs|back\s+(?:injury|spasm|tightness|issue)|neck|concussion|wrist|hand|thumb|finger|foot|toe|achilles|acl\b|mcl\b|pcl\b|lcl\b|meniscus|pectoral|fibula|tibia|fractur\w*|broken\s+(?:ankle|leg|arm|foot|collarbone|wrist|hand|rib|fibula|tibia)|torn\s+(?:acl|achilles|pectoral|meniscus|patellar)|sprain|strain|dislocat\w*|carted|air\s*cast|medical\s+tent|locker\s+room|questionable\s+to\s+return|doubtful\s+to\s+return|ruled\s+out|injured\s+reserve|\bir\b|practice\s+window|21-day|\bmri\b|x-rays?|surgery)\b/i;

function analyzeSinglePlayerInjuryItem(item = {}, rosterPlayers = [], teamInput = null) {
  const empty = { isInjury: false, playerSlug: '', bodyPart: '', progLevel: 0, isSpeculative: false, milestone: null };
  if (!item || typeof item !== 'object') return empty;
  if (isMultiTopicDigestOrRoundup(item)) return empty;

  const lead = extractPrimaryClaimText(item);
  const full = `${lead} ${String(item.fullText || item.title || '').slice(0, 260)}`.trim();
  if (!lead) return empty;

  // Exclude non-injury transactions, human-interest side notes, trade rumors, and pure film breakdowns
  if (
    HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead) ||
    RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(lead) ||
    CREDIBLE_FORWARD_TRADE_RUMOR_REGEX.test(lead)
  ) {
    return empty;
  }
  const isNonInjuryTradeOrContract =
    /\b(trade[!: ]|agree[sd]? to (?:a )?trade|has been traded|contract extension|signed a \d+-year|signs a \d+-year|restructured|arrested|suspended|award|player of the (?:week|month)|pro bowl)\b/i.test(
      lead
    ) && !/\b(injur\w*|injured reserve|\bir\b|torn|fractur\w*|carted|air\s*cast|ruled out|mri|x-ray)\b/i.test(lead);
  if (isNonInjuryTradeOrContract) return empty;

  // Fast pre-check before resolving roster player slug (avoids unnecessary roster scans on 90% of non-injury items)
  const isSpeculative = isSpeculativeInjuryComparisonOnly(full);
  const progLevel = computeInjuryProgressionLevel(item);
  const milestone = resolveInjuryMilestoneBucket(`${lead} ${String(item.fullText || item.summary || '').slice(0, 140)}`);
  const hasInjurySignal =
    Boolean(item.isInGameInjury) ||
    Boolean(item.isPostGameInjuryUpdate) ||
    item.storyTier === 'in_game_injury' ||
    item.storyTier === 'post_game_injury' ||
    item.storyTier === 'practice_injury' ||
    item.category === 'injury' ||
    /^(?:LIVE )?INJURY\b/i.test(String(item.breakingBadge || '')) ||
    (milestone && milestone !== 'pre_game_availability') ||
    progLevel >= 1 ||
    (isSpeculative && SINGLE_PLAYER_INJURY_CUE_RE.test(full));

  if (!hasInjurySignal) return empty;

  const playerSlug = resolvePrimaryInjuredPlayerSlug(item, rosterPlayers, teamInput);
  if (!playerSlug) return empty;

  const bodyPart = extractNamedInjuryBodyPart(full);
  return {
    isInjury: true,
    playerSlug,
    bodyPart,
    progLevel,
    isSpeculative,
    milestone
  };
}

function isBetterSinglePlayerInjuryLead(cand, winner) {
  const cSpec = Boolean(cand.info?.isSpeculative || cand.info?.progLevel === 0);
  const wSpec = Boolean(winner.info?.isSpeculative || winner.info?.progLevel === 0);
  if (cSpec !== wSpec) return !cSpec;

  const cProg = Number(cand.info?.progLevel || 0);
  const wProg = Number(winner.info?.progLevel || 0);
  const cMs = Number(cand.ms || 0);
  const wMs = Number(winner.ms || 0);

  // Higher injury progression stage wins unless it is >30m older than a genuinely newer major update
  if (cProg !== wProg) {
    if (cProg > wProg) {
      return !wMs || !cMs || cMs >= wMs - 30 * 60_000;
    }
    // `winner` has higher stage; `cand` only overtakes if `cand` is >6h newer AND urgent breaking (e.g. next-day major update)
    return Boolean(
      isUrgentBreakingBadge(cand.item?.breakingBadge) &&
        cMs > wMs + 6 * 3_600_000
    );
  }

  // Same progression stage: adding a specific named body part beats unnamed (within 10m)
  const cHasBody = Boolean(cand.info?.bodyPart);
  const wHasBody = Boolean(winner.info?.bodyPart);
  if (cHasBody !== wHasBody && Math.abs(cMs - wMs) <= 10 * 60_000) {
    return cHasBody;
  }

  // Meaningful recency win (>10m newer) unless candidate is a low-tier rewrite aggregator
  const cIsAgg = AGGREGATOR_REWRITE_OUTLET_REGEX.test(`${cand.item?.outletName || ''} ${cand.item?.url || ''}`);
  const wIsAgg = AGGREGATOR_REWRITE_OUTLET_REGEX.test(`${winner.item?.outletName || ''} ${winner.item?.url || ''}`);
  if (cMs > wMs + 10 * 60_000 && (!cIsAgg || wIsAgg)) return true;
  if (wMs > cMs + 10 * 60_000 && (!wIsAgg || cIsAgg)) return false;

  // Simultaneous burst (<=10m): prefer urgent badge, direct X over Bluesky, higher source quality, then newer timestamp
  const cUrg = isUrgentBreakingBadge(cand.item?.breakingBadge) ? 1 : 0;
  const wUrg = isUrgentBreakingBadge(winner.item?.breakingBadge) ? 1 : 0;
  if (cUrg !== wUrg) return cUrg > wUrg;

  const cQual = scoreClusterLeadQuality(cand.item);
  const wQual = scoreClusterLeadQuality(winner.item);
  if (Math.abs(cQual - wQual) > 2) return cQual > wQual;
  return cMs > wMs;
}

/**
 * Enforces strictly AT MOST ONE breaking / top-pinned injury update per injured player across a news stream:
 *  - Selects the single latest / most-progressed / top new injury update for each injured player
 *    within a 36-hour active injury window.
 *  - Strips urgent `"breaking"` status (`BREAKING` / `LIVE INJURY UPDATE`), clears `isInGameInjury` top-pinning,
 *    and demotes older or out-of-date injury updates for that same player out of the top pinned slots.
 */
export function enforceSingleBreakingInjuryPerPlayer(
  items = [],
  { nowMs = Date.now(), rosterPlayers = [], teamConfig = null, windowHours = 36 } = {}
) {
  if (!Array.isArray(items) || items.length <= 1) return items;
  const maxWindowMs = windowHours * 3_600_000;

  const byPlayer = new Map();
  const itemMeta = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const info = analyzeSinglePlayerInjuryItem(it, rosterPlayers, teamConfig);
    itemMeta[i] = info;
    if (!info.isInjury || !info.playerSlug) continue;
    const ms = resolveClusterLatestTimestampMs(it, nowMs) || 0;
    const isActiveInjuryCandidate =
      isUrgentBreakingBadge(it?.breakingBadge) ||
      Boolean(it?.isUrgentBreaking || it?.isBreaking || it?.isInGameInjury || it?.isPostGameInjuryUpdate) ||
      info.progLevel >= 1;
    if (!isActiveInjuryCandidate) continue;
    if (!byPlayer.has(info.playerSlug)) byPlayer.set(info.playerSlug, []);
    byPlayer.get(info.playerSlug).push({ idx: i, item: it, info, ms });
  }

  if (byPlayer.size === 0) return items;

  const supersededIndices = new Set();

  for (const [, group] of byPlayer.entries()) {
    if (group.length <= 1) continue;
    const newestMs = group.reduce((max, g) => (g.ms > max ? g.ms : max), 0);
    const activeGroup = group.filter(g => !newestMs || !g.ms || newestMs - g.ms <= maxWindowMs);
    if (activeGroup.length <= 1) continue;

    let winner = activeGroup[0];
    for (let j = 1; j < activeGroup.length; j++) {
      if (isBetterSinglePlayerInjuryLead(activeGroup[j], winner)) {
        winner = activeGroup[j];
      }
    }

    for (const entry of activeGroup) {
      if (entry.idx === winner.idx) continue;
      const sameInjury = areInjuryBodyPartsCompatible(entry.info.bodyPart, winner.info.bodyPart);
      if (sameInjury || isUrgentBreakingBadge(entry.item?.breakingBadge)) {
        supersededIndices.add(entry.idx);
      }
    }
  }

  if (supersededIndices.size === 0) return items;

  return items.map((it, idx) => {
    if (!supersededIndices.has(idx)) return it;
    const info = itemMeta[idx];
    const pubMs = resolveEffectivePublishTimestampMs(it, nowMs);
    const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 99;
    const hadUrgent = isUrgentBreakingBadge(it?.breakingBadge) || Boolean(it?.isUrgentBreaking);
    const nextBadge =
      info?.isSpeculative || ageHours > 12
        ? null
        : hadUrgent
          ? 'INJURY UPDATE'
          : it?.breakingBadge && !isUrgentBreakingBadge(it.breakingBadge)
            ? it.breakingBadge
            : null;
    const demotedRank = Number.isFinite(Number(it?.storyRank))
      ? Math.min(Number(it.storyRank), 42)
      : it?.storyRank;
    return {
      ...it,
      isUrgentBreaking: false,
      isBreaking: false,
      isInGameInjury: false,
      isSupersededInjuryUpdate: true,
      breakingPriority: Math.min(Number(it?.breakingPriority) || 0, 0.9),
      breakingBadge: nextBadge,
      ...(Number.isFinite(demotedRank) ? { storyRank: demotedRank } : {})
    };
  });
}

/**
 * Ranks the informational progression stage of an injury report (`0..5`) so that inside an
 * injury story cluster, material new developments IMMEDIATELY supersede earlier preliminary tweets:
 *  - Stage 1: Initial sideline exit / blue medical tent / shaken up / limped off
 *  - Stage 2: Specific body part identified / Questionable to return / locker room / concussion evaluation
 *  - Stage 3: Doubtful to return / carted off / air cast / crutches / walking boot
 *  - Stage 4: Definitively ruled OUT for the game OR cleared/returned to action
 *  - Stage 5: Confirmed diagnostic result (MRI/X-ray/not an ACL/no structural damage/specific tear/timeline)
 */
export function computeInjuryProgressionLevel(item = {}) {
  const lead = extractPrimaryClaimText(item);
  const full = `${lead} ${String(item?.fullText || item?.title || '').slice(0, 260)}`;
  if (!full.trim()) return 0;

  if (
    isSpeculativeInjuryComparisonOnly(full) ||
    (MINOR_OR_SPECULATIVE_INJURY_NOISE_REGEX.test(full) && !SERIOUS_INJURY_ESCALATION_REGEX.test(full))
  ) {
    return 0;
  }

  if (MATERIAL_INJURY_DIAGNOSIS_REGEX.test(full) && !DIAGNOSTIC_SCHEDULED_ONLY_REGEX.test(lead)) {
    return 5;
  }
  if (
    /\b(ruled out(?:\s+for\s+(?:the\s+(?:rest|remainder)|tonight|today|the\s+game))?|downgraded to out|out for the (?:rest|remainder|game|night|day)|will not return|won['’]?t return|did not return(?!\s+(?:the\s+|a\s+|that\s+|his\s+)?(?:punt|kick|kickoff|fumble|interception))|done for the (?:day|night|game)|cleared to return|cleared concussion protocol)\b/i.test(
      full
    ) ||
    matchesGuardedPlayerReturnToGame(full) ||
    (/\bback on the field\b/i.test(full) &&
      !TEAM_COMEBACK_BACK_IN_GAME_REGEX.test(full) &&
      !getAllNflTeamSubjectBeforeReturnRegex().test(full))
  ) {
    return 4;
  }
  if (/\b(doubtful to return|carted (?:off|to the locker room|away)|in an air cast|air cast|on crutches|walking boot|unlikely to return)\b/i.test(full)) {
    return 3;
  }
  const isRoutineHalftimeWalk =
    ROUTINE_HALFTIME_OR_POSTGAME_LOCKER_ROOM_REGEX.test(full) &&
    !INJURY_OR_MEDICAL_CONTEXT_REGEX.test(full.replace(/\b(?:locker\s+room|tunnel)\b/gi, ''));
  if (
    (/\b(questionable to return|probable to return|concussion (?:evaluation|protocol)|evaluated for (?:a )?concussion|(?:headed|going|went|walked|taken) to the locker room)\b/i.test(
      full
    ) &&
      !isRoutineHalftimeWalk) ||
    (matchesInGameInjuryOrReturn(full) && Boolean(extractNamedInjuryBodyPart(full)))
  ) {
    return 2;
  }
  if (matchesInGameInjuryOrReturn(full)) {
    return 1;
  }
  return 0;
}

function resolveInjuryMilestoneBucket(text = '') {
  const t = String(text || '').toLowerCase();
  if (isSpeculativeInjuryComparisonOnly(text)) {
    return null;
  }
  if (
    /\b(placed on injured reserve|placed on ir|season-ending|activated from ir|activated off ir|21-day|designate[sd]? [\s\S]{0,30}(?:for|to) return|practice window)\b/.test(
      t
    )
  ) {
    return 'ir_roster_move';
  }
  if (MATERIAL_INJURY_DIAGNOSIS_REGEX.test(t) && !DIAGNOSTIC_SCHEDULED_ONLY_REGEX.test(t)) {
    return 'diagnostic_result';
  }
  if (DIAGNOSTIC_SCHEDULED_ONLY_REGEX.test(t)) {
    return 'diagnostic_scheduled';
  }
  if (/\b(mri|x-ray|x-rays|ct scan|tests showed|initial tests|imaging)\b/.test(t)) {
    return 'diagnostic_result';
  }
  if (/\b(day-to-day|week-to-week|out multiple weeks|out several weeks|miss \d+|expected to miss)\b/.test(t)) {
    return 'recovery_timeline';
  }
  if (
    /\b(questionable to return|doubtful to return|probable to return|ruled out(?:\s+for\s+(?:the\s+(?:rest|remainder)|tonight|today|the\s+game))?|downgraded to out|out for the (?:rest|remainder|game|night|day)|will not return|won['’]?t return|did not return|done for the (?:day|night|game)|returned to (?:the|tonight['’]?s|sunday['’]?s|monday['’]?s|thursday['’]?s|saturday['’]?s|today['’]?s)?\s*(?:game|action)|cleared to return|cleared concussion protocol|exited|left .*game|(?:headed|going|went|walked|taken) to the locker room|medical tent|carted (?:off|to the locker room)|air cast|suffered a|sustained a)\b/.test(
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

function getActiveTeamStopwords() {
  const active = getActiveTeamConfig();
  const extra = new Set();
  if (active) {
    for (const raw of [active.nickname, active.city, active.slug, active.abbr, ...(active.keywordRules?.requiredNicknames || [])]) {
      for (const part of String(raw || '').toLowerCase().split(/\s+/)) {
        const clean = part.replace(/[^a-z0-9-]/g, '');
        if (clean.length >= 3) extra.add(clean);
      }
    }
  }
  return extra;
}

function normalizeStemToken(tok = '') {
  let w = tok.toLowerCase().replace(/^#+/, '').replace(/['’]s$/i, '').replace(/[^a-z0-9-]/g, '');
  const teamStops = getActiveTeamStopwords();
  if (w.length <= 2 || CLUSTER_STOPWORDS.has(w) || teamStops.has(w)) return '';
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

let NON_PLAYER_PROPER_SLUG_CACHE = null;
function getNonPlayerProperSlugSet(teamInput = null) {
  if (!NON_PLAYER_PROPER_SLUG_CACHE) {
    const base = new Set([
      'sanfrancisco', 'kyleshanahan', 'johnlynch', 'probowl', 'superbowl', 'nfltrade', 'traderumors',
      'bayarea', 'nbcsports', 'injurylists', 'injuredreserve', 'practicereport', 'injuryreport',
      'lasvegas', 'newyork', 'losangeles', 'greenbay', 'tampabay', 'kansascity', 'newengland', 'neworleans',
      'freeagent', 'freeagency', 'multipleteams', 'nfcteam', 'afcteam', 'ninerswire', 'arizonastate',
      'airforce', 'coloradosprings', 'practicesquad', 'activeroster', 'waiverwire', 'landingspots',
      'headcoach', 'generalmanager', 'widereceiver', 'tightend', 'defensiveend', 'runningback',
      'quarterback', 'offensiveline', 'defensiveline', 'passrusher', 'offensivecoordinator', 'defensivecoordinator',
      'adamschefter', 'ianrapoport', 'tompelissero', 'mikegarafolo', 'diannarussini', 'drewrosenhaus',
      'jordanranaan', 'nickwagoner', 'mattbarrows', 'mattmaiocco', 'davidlombardi', 'jenniferleechan',
      'ericbranch', 'grantcohn', 'sanjeshsingh', 'timkawakami', 'caminman', 'davidbonilla',
      'nflnetwork', 'profootballtalk', 'bleacherreport', 'sportsillustrated', 'yahoosports', 'cbssports',
      'nbcsportsbayarea', '49erswebzone', 'ninersnation', 'mondaynight', 'sundaynight', 'thursdaynight',
      'mexicocity', 'santaclara', 'trainingcamp', 'tradedeadline', 'footballteam'
    ]);
    for (const t of ALL_NFL_TEAMS) {
      for (const raw of [t.fullName, t.city, t.nickname, `${t.city} ${t.nickname}`]) {
        const s = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (s.length >= 4) base.add(s);
      }
    }
    NON_PLAYER_PROPER_SLUG_CACHE = base;
  }
  const active = resolveTeamConfig(teamInput || getActiveTeamConfig());
  if (!active?.coachesSeed) return NON_PLAYER_PROPER_SLUG_CACHE;
  const hcSlug = String(active.coachesSeed.hc || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const gmSlug = String(active.coachesSeed.gm || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if ((hcSlug && !NON_PLAYER_PROPER_SLUG_CACHE.has(hcSlug)) || (gmSlug && !NON_PLAYER_PROPER_SLUG_CACHE.has(gmSlug))) {
    const ext = new Set(NON_PLAYER_PROPER_SLUG_CACHE);
    if (hcSlug) ext.add(hcSlug);
    if (gmSlug) ext.add(gmSlug);
    return ext;
  }
  return NON_PLAYER_PROPER_SLUG_CACHE;
}

const UNAMBIGUOUS_NFL_CITY_TO_ABBR = [
  ['washington', 'was'],
  ['pittsburgh', 'pit'],
  ['baltimore', 'bal'],
  ['cincinnati', 'cin'],
  ['cleveland', 'cle'],
  ['philadelphia', 'phi'],
  ['seattle', 'sea'],
  ['dallas', 'dal'],
  ['detroit', 'det'],
  ['denver', 'den'],
  ['miami', 'mia'],
  ['atlanta', 'atl'],
  ['minnesota', 'min'],
  ['carolina', 'car'],
  ['arizona', 'ari'],
  ['houston', 'hou'],
  ['indianapolis', 'ind'],
  ['jacksonville', 'jax'],
  ['tennessee', 'ten'],
  ['buffalo', 'buf'],
  ['chicago', 'chi'],
  ['green bay', 'gb'],
  ['kansas city', 'kc'],
  ['new england', 'ne'],
  ['new orleans', 'no'],
  ['tampa bay', 'tb'],
  ['las vegas', 'lv']
];

function extractNonActiveTeamAbbrsInText(text = '', activeTeam = null) {
  const lower = String(text || '').toLowerCase();
  if (!lower) return [];
  const activeAbbr = String(activeTeam?.abbr || getActiveTeamConfig()?.abbr || 'SF').toLowerCase();
  const found = [];
  const add = abbr => {
    if (abbr && abbr !== activeAbbr && !found.includes(abbr)) found.push(abbr);
  };
  for (const t of ALL_NFL_TEAMS) {
    const abbr = String(t.abbr || '').toLowerCase();
    if (!abbr || abbr === activeAbbr) continue;
    const nick = String(t.nickname || '').toLowerCase();
    if (nick && new RegExp(`\\b${escapeRegexToken(nick)}\\b`, 'i').test(lower)) {
      add(abbr);
    }
  }
  for (const [city, abbr] of UNAMBIGUOUS_NFL_CITY_TO_ABBR) {
    if (abbr === activeAbbr || found.includes(abbr)) continue;
    if (new RegExp(`\\b${escapeRegexToken(city)}\\b`, 'i').test(lower)) {
      // Guard against college/non-NFL city refs (e.g., "Arizona State", "Colorado Springs")
      if (city === 'arizona' && /\barizona\s+state\b/i.test(lower)) continue;
      if (city === 'washington' && /\bwashington\s+(?:state|huskies|dc)\b/i.test(lower)) continue;
      add(abbr);
    }
  }
  return found;
}

function extractLeadProperNameSlugs(lead = '') {
  const slugs = [];
  // Strip NFL position/league prefixes before capitalized player names so `"49ers DE Nick Bosa"` extracts `nickbosa`, NOT `denick`!
  const clean = String(lead || '')
    .replace(/^[#"'“‘]+/, '')
    .replace(/\b(?:QB|RB|FB|WR|TE|OL|OT|OG|DL|DE|DT|NT|EDGE|LB|ILB|OLB|CB|DB|FS|SS|PK|LS|NFL|NFC|AFC)\s+(?=[A-Z]\.?[A-Za-z])/g, '');
  const re = /\b([A-Z]\.?[A-Za-z'.-]{1,14}\s+[A-Z][a-zA-Z'.-]{2,16})(?:\s+(?:Jr\.?|Sr\.?|II|III|IV|V))?\b/g;
  const ignore = getNonPlayerProperSlugSet();
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
  const ignoreNonPlayers = getNonPlayerProperSlugSet();
  for (const mp of item?.mentionedPlayers || []) {
    const nameSlug = String(mp?.name || mp?.id || '')
      .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (nameSlug && !ignoreNonPlayers.has(nameSlug)) set.add(`pname:${nameSlug}`);
  }
  const urlMatch = String(item?.url || '').match(/espn\.com\/nfl\/player\/_\/id\/\d+\/([a-z0-9-]+)/i);
  if (urlMatch?.[1]) {
    const uSlug = urlMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (uSlug && !ignoreNonPlayers.has(uSlug)) set.add(`pname:${uSlug}`);
  }
  for (const leadSlug of extractLeadProperNameSlugs(extractPrimaryClaimText(item))) {
    set.add(`pname:${leadSlug}`);
  }
  const lead = extractPrimaryClaimText(item).toLowerCase();
  const activeEntTeam = getActiveTeamConfig();
  const activeCoachesEnt = activeEntTeam?.coachesSeed || {};
  if (activeEntTeam?.abbr === 'SF') {
    if (/\bshanahan\b/.test(lead)) set.add('coach:shanahan');
    if (/\blynch\b/.test(lead)) set.add('fo:lynch');
    if (/\bjerry rice\b/.test(lead)) set.add('alum:jerryrice');
  } else {
    for (const [role, full] of [['coach', activeCoachesEnt.hc], ['fo', activeCoachesEnt.gm]]) {
      const surname = String(full || '').trim().split(/\s+/).slice(-1)[0]?.toLowerCase();
      if (surname && surname.length >= 4 && new RegExp(`\\b${escapeRegexToken(surname)}\\b`, 'i').test(lead)) {
        set.add(`${role}:${surname}`);
      }
    }
  }
  for (const oppAbbr of extractNonActiveTeamAbbrsInText(lead, activeEntTeam)) {
    set.add(`opp:${oppAbbr}`);
  }
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
  const id = String(item?.id || '');
  const url = String(item?.url || '');
  const ws = String(item?.wireSource || '');
  return (
    ws === 'espn_player_wire' ||
    ws === 'rotowire_rss' ||
    /^espn_pwire_/i.test(id) ||
    /^rw_live_/i.test(id) ||
    /espn\.com\/nfl\/player\/_\/id\//i.test(url) ||
    /rotowire\.com/i.test(url)
  );
}

const GENERIC_PLAY_BY_PLAY_BRIDGE_WORDS = new Set([
  'yard', 'yards', 'catch', 'catches', 'pass', 'passes', 'play', 'plays', 'down', 'touchdown',
  'drive', 'quarter', 'first', 'second', 'third', 'fourth', 'run', 'rush', 'score', 'ball',
  'field', 'target', 'snap', 'snaps', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'today', 'tonight', 'tomorrow', 'yesterday', 'veteran', 'general', 'manager'
]);

function extractOfficialSpeakerKey(item = {}) {
  const isArticle = item?.type === 'article' || item?.type === 'post';
  const isDigest = isMultiTopicDigestOrRoundup(item);
  const lead = extractPrimaryClaimText(item);
  const sub = isArticle && !isDigest ? cleanWireSummaryForMatching(item?.summary || '').slice(0, 175) : '';
  const probe = `${lead} ${sub}`.toLowerCase();
  const activeSpkTeam = getActiveTeamConfig();
  if (activeSpkTeam?.abbr === 'SF') {
    if (/\b(?:john\s+)?lynch\b/.test(probe)) return 'fo:lynch';
    if (/\b(?:kyle\s+)?shanahan\b/.test(probe)) return 'coach:shanahan';
    if (/\b(?:raheem\s+)?morris\b/.test(probe)) return 'coord:morris';
    if (/\b(?:klay\s+)?kubiak\b/.test(probe)) return 'coord:kubiak';
    if (/\b(?:robert\s+)?saleh\b/.test(probe)) return 'coord:saleh';
    if (/\b(?:brandon\s+)?staley\b/.test(probe)) return 'coord:staley';
    if (/\b(?:nick\s+)?sorensen\b/.test(probe)) return 'coord:sorensen';
    if (/\b(?:chris\s+)?foerster\b/.test(probe)) return 'coord:foerster';
    return null;
  }
  const c = activeSpkTeam?.coachesSeed || {};
  for (const [prefix, full] of [['fo', c.gm], ['coach', c.hc], ['coord', c.oc], ['coord', c.dc]]) {
    const clean = String(full || '').trim();
    if (!clean) continue;
    const parts = clean.split(/\s+/);
    const last = parts[parts.length - 1] || '';
    const fullPat = escapeRegexToken(clean.toLowerCase()).replace(/\\ /g, '\\s+');
    const pat = last.length >= 5 ? `(?:${fullPat}|${escapeRegexToken(last.toLowerCase())})` : fullPat;
    if (new RegExp(`\\b${pat}\\b`, 'i').test(probe)) {
      return `${prefix}:${last.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    }
  }
  return null;
}

function resolveBriefingTopicDomain(item = {}) {
  const isArticle = item?.type === 'article' || item?.type === 'post';
  const isDigest = isMultiTopicDigestOrRoundup(item);
  const lead = extractPrimaryClaimText(item);
  const sub = isArticle && !isDigest ? cleanWireSummaryForMatching(item?.summary || '').slice(0, 175) : '';
  const probe = `${lead} ${sub}`.toLowerCase();
  if (
    /\b(injur(?:y|ies|ed)|achilles|hamstring|ankle|knee|back|shoulder|groin|calf|foot|concussion|quad|pectoral|elbow|wrist|thumb|ribs|oblique|recovery|rehab|padded practice|return to practice|back at practice|could return|chance to return|hoping to have|practice window|injured reserve|\bir\b|questionable|doubtful|ruled out|day-to-day|week-to-week|surgery|mri|x-ray|healthy|health update)\b/.test(
      probe
    )
  ) {
    return 'injury_recovery';
  }
  if (
    /\b(trade[ds]?|trading|acquir(?:e|ed|ing)|contract|extension|restructure|salary cap|free agen|signing|re-sign|waiv(?:e|ed)|release[ds]?|asking price|exemption|roster spot)\b/.test(
      probe
    )
  ) {
    return 'trade_contract';
  }
  if (
    /\b(sack|pass rush|snap count|starting|benched|depth chart|film|tape|play-?calling|scheme|weak link|struggl(?:e|es|ing)|breakout|impressed|prais(?:e|es|ed))\b/.test(
      probe
    )
  ) {
    return 'performance_role';
  }
  return null;
}

function extractPrimaryPlayerSlug(item = {}) {
  const players = Array.isArray(item?.mentionedPlayers) ? item.mentionedPlayers : [];
  if (players.length === 0 || players.length > 2) return '';
  const lead = extractPrimaryClaimText(item);
  const matched =
    players.find(mp => {
      const surname = String(mp?.name || '')
        .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .trim()
        .split(/\s+/)
        .slice(-1)[0];
      return surname && surname.length >= 3 && new RegExp(`\\b${escapeRegexToken(surname)}\\b`, 'i').test(lead);
    }) || (players.length === 1 ? players[0] : null);
  if (!matched) return '';
  return String(matched.name || matched.id || '')
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function hasAcuteInjuryEscalation(text = '') {
  return /\b(ruled out|placed on (?:injured reserve|ir)|season-ending|undergo(?:es|ing)? surgery|underwent surgery|\bmri\b|x-ray|setback|carted off|downgraded|will not play|out for (?:sunday|monday|thursday|week \d+))\b/i.test(
    String(text || '')
  );
}

function hasPracticeOrEscalationConflict(bucketA, bucketB, textA = '', textB = '') {
  if (bucketA && bucketB && bucketA !== bucketB) return true;
  const officialStatuses = new Set(['dnp', 'lp', 'fp']);
  if ((officialStatuses.has(bucketA) && !bucketB) || (officialStatuses.has(bucketB) && !bucketA)) {
    return true;
  }
  if (hasAcuteInjuryEscalation(textA) !== hasAcuteInjuryEscalation(textB)) return true;
  return false;
}

/**
 * Builds a deterministic semantic angle key (`entity::angle`) for exact same-event stories so
 * cross-outlet coverage (Articles + Tweets + Videos) merges reliably without touching distinct angles.
 */
const CORE_49ERS_SHORTHAND_PLAYER_SLUGS = [
  { re: /\b(?<!joey\s)bosa\b/i, slug: 'nickbosa' },
  { re: /\bpurdy\b/i, slug: 'brockpurdy' },
  { re: /\bkittle\b/i, slug: 'georgekittle' },
  { re: /\b(?:cmc|mccaffrey)\b/i, slug: 'christianmccaffrey' },
  { re: /\bwarner\b/i, slug: 'fredwarner' },
  { re: /\bpearsall\b/i, slug: 'rickypearsall' },
  { re: /\blenoir\b/i, slug: 'deommodorelenoir' },
  { re: /\bjuszczyk\b/i, slug: 'kylejuszczyk' },
  { re: /\bmustapha\b/i, slug: 'malikmustapha' },
  { re: /\bpuni\b/i, slug: 'dominickpuni' },
  { re: /\bguerendo\b/i, slug: 'isaacguerendo' },
  { re: /\bjennings\b/i, slug: 'jauanjennings' },
  { re: /\bgreenlaw\b/i, slug: 'dregreenlaw' },
  { re: /\bdeebo\b/i, slug: 'deebosamuel' },
  { re: /\baiyuk\b/i, slug: 'brandonaiyuk' },
  { re: /\bpineiro\b/i, slug: 'eddypineiro' },
  { re: /\brenardo\b/i, slug: 'renardogreen' },
  { re: /\bmckivitz\b/i, slug: 'coltonmckivitz' },
  { re: /\bbrendel\b/i, slug: 'jakebrendel' },
  { re: /\bwinters\b/i, slug: 'deewinters' },
  { re: /\bvaldez\b/i, slug: 'sebastianvaldez' }
];

function resolveFallback49ersShorthandSlug(lead = '') {
  for (const entry of CORE_49ERS_SHORTHAND_PLAYER_SLUGS) {
    if (entry.re.test(lead)) return entry.slug;
  }
  return '';
}

const TRANSACTION_SAGA_SIGNING_RE =
  /\b(officially\s+sign(?:s|ed|ing)?|have\s+signed|has\s+signed|signing\s+(?:a\s+)?(?:\d+-year|one-year|two-year|three-year|multi-year|free-agent)?\s*(?:deal|contract)?|agree[sd]?\s+to\s+(?:terms|a\s+\d+-year|a\s+(?:one|two|three)-year|a\s+deal|sign)|claimed\s+(?:[a-z .'-]{0,28}\s+)?off\s+waivers|awarded\s+(?:[a-z .'-]{0,28}\s+)?off\s+waivers|in\s+agreement\s+to\s+sign)\b/i;

const TRANSACTION_SAGA_VISIT_RE =
  /\b(scheduled\s+(?:for\s+(?:a\s+|an\s+)?|to\s+)visit|set\s+to\s+visit|expected\s+to\s+visit|plans?\s+to\s+visit|will\s+visit|visiting\s+(?:with\s+)?(?:the\s+)?|to\s+visit\s+(?:with\s+)?(?:the\s+)?|host(?:s|ed|ing)?\s+(?:[a-z .'-]{0,28}\s+)?for\s+(?:a\s+|an\s+)?(?:free[- ]agent\s+)?(?:visit|workout|meeting)|working\s+out\s+for|workout\s+with|meeting\s+with\s+(?:the\s+)?)\b/i;

const TRANSACTION_SAGA_SPECULATIVE_OUTLOOK_RE =
  /\b(potential\s+(?:[a-z0-9 .'-]{0,28}\s+)?landing\s+spots?|landing\s+spots?|best\s+(?:fits?|destinations?|landing\s+spots?)|top\s+(?:\d+\s+|five\s+|three\s+|four\s+|six\s+)?(?:destinations?|fits?|suitors?|landing\s+spots?|teams?\s+(?:that\s+)?(?:could|should|might))|what['’]?s\s+next\s+for|where\s+(?:could|might|will|should)\s+[a-z .'-]{2,28}\s+(?:land|sign|go|play)|next\s+team\s+(?:odds|favorites?)|favorites?\s+to\s+(?:sign|land)|emerges?\s+as\s+(?:a\s+|the\s+)?favorite\s+to\s+(?:sign|land)|could\s+(?:sign|land)\s+with|makes?\s+sense\s+(?:for|as)\s+(?:a\s+)?(?:fit|destination|suitor))\b/i;

const TRANSACTION_SAGA_FA_CONTEXT_RE =
  /\b(waiv(?:e[sd]?|ing|ers?)|releas(?:e[sd]?|ing)|free[- ]?agen(?:t|cy)|cut\b|unclaimed|sign(?:s|ed|ing)?|landing\s+spots?|destinations?|suitors?|next\s+team|visit(?:s|ed|ing)?|trade[sd]?|divorce|part(?:s|ed|ing)?\s+ways|moved\s+on)\b/i;

const TRANSACTION_SAGA_WAIVER_CLEAR_RE =
  /\b(clear(?:s|ed|ing)?\s+waivers|went\s+unclaimed|goes?\s+unclaimed|unclaimed\s+on\s+waivers|passed\s+through\s+waivers|now\s+a\s+free\s+agent|officially\s+a\s+free\s+agent)\b/i;

const TRANSACTION_SAGA_MARKET_INTEREST_RE =
  /\b(drawing\s+interest|expected\s+to\s+draw\s+interest|generating\s+interest|receiving\s+interest|attracting\s+interest|multiple\s+(?:nfl\s+)?teams\s+(?:interested|expected\s+to\s+pursue|in\s+the\s+mix|pursuing)|several\s+(?:nfl\s+)?teams\s+(?:interested|in\s+the\s+mix))\b/i;

const TRANSACTION_SAGA_DEPARTURE_RE =
  /\b(releas(?:e[sd]?|ing)|waiv(?:e[sd]?|ing)|cut(?:s|ting)?\s+ties\s+with|part(?:s|ed|ing)?\s+ways\s+with|moved\s+on\s+from|ending\s+(?:messy\s+|tumultuous\s+)?divorce|officially\s+released|officially\s+waived)\b/i;

const TRANSACTION_SAGA_CAP_BREAKDOWN_EXCLUSION_RE =
  /\b(salary\s+cap|cap\s+hit|cap\s+space|cap\s+savings|cap\s+implications|cap\s+impact|dead\s+cap|dead\s+money|contract\s+breakdown|financial\s+impact)\b/i;

const MYSTERY_TEAM_CLICKBAIT_RE =
  /\b(nfc|afc|one|mystery|surprising|this|sleeper|dark[- ]horse|rival)\s+(?:team|club|contender|franchise|squad)\b/i;

const TRUNCATED_PAYWALL_TEASER_RE =
  /(?:\.\.\.|…)\s*(?:https?:\/\/)?(?:www\.)?(?:nytimes\.com\/athletic|theathletic\.com|sfchronicle\.com|mercurynews\.com)\//i;

const MULTI_PLAYER_SECOND_TX_CLAUSE_RE =
  /(?:,|;|\bwhile\b)\s*[A-Z][a-zA-Z'.-]+\s+[A-Z][a-zA-Z'.-]+(?:\s+(?:Jr\.?|Sr\.?|II|III|IV|V))?\s+(?:released|waived|signed|cut|placed|elevated|promoted|activated|claimed)/;

/**
 * Classifies single-primary-player roster-departure / waiver / free-agency / team-visit / signing
 * sagas into clean, mutually interpretable lifecycle facets across all 32 NFL clubs so redundant
 * echoes on the same milestone fold into `Similar stories (N)` while genuinely distinct phases &
 * perspectives (e.g. Commanders Visit vs. Cleared Waivers & Market Interest vs. Speculative Landing
 * Spots vs. Original Release) each earn a clean dedicated card.
 */
export function analyzePlayerTransactionSaga(item = {}, rosterPlayers = [], teamInput = null) {
  const empty = {
    isSaga: false,
    playerSlug: '',
    facet: null,
    stage: 0,
    subStage: 0,
    destTeamAbbr: '',
    sigKey: null,
    isMultiPlayerCombo: false,
    isClickbaitMystery: false,
    isSpeculative: false
  };
  if (!item || typeof item !== 'object') return empty;
  if (isMultiTopicDigestOrRoundup(item)) return empty;
  if (item.type === 'video' || Boolean(item.videoId)) return empty;

  const lead = extractPrimaryClaimText(item);
  if (!lead) return empty;
  const leadLower = lead.toLowerCase();
  if (NON_TRANSACTION_RELEASE_REGEX.test(lead)) return empty;
  if (SECONDARY_COMMENTARY_OR_REACTION_REGEX.test(lead)) return empty;
  if (RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(lead)) return empty;
  if (HUMAN_INTEREST_SIDE_NOTE_REGEX.test(lead)) return empty;
  if (TRUE_FILM_VIDEO_TITLE_REGEX.test(lead)) return empty;
  if (resolveInjuryMilestoneBucket(lead)) return empty;
  if (/\b(?:contract\s+extension|multi-?year\s+extension|extended\s+(?:his|their)\s+contract|agree[sd]?\s+to\s+(?:a\s+)?(?:\d+-year\s+)?extension)\b/i.test(lead)) {
    return empty;
  }

  const isArt = item.type === 'article' || item.type === 'post';
  const summaryHead = isArt ? cleanWireSummaryForMatching(item.summary || '').slice(0, 180) : '';
  const probe = `${lead} ${summaryHead}`;
  if (!TRANSACTION_SAGA_FA_CONTEXT_RE.test(probe)) return empty;

  const activeTeam = resolveTeamConfig(teamInput || getActiveTeamConfig());
  const ignoreNonPlayers = getNonPlayerProperSlugSet(activeTeam);

  // Resolve earliest/primary subject player in the lead sentence
  let primarySlug = resolvePrimaryInjuredPlayerSlug(item, rosterPlayers, activeTeam);
  if (primarySlug && ignoreNonPlayers.has(primarySlug)) primarySlug = '';
  if (!primarySlug) {
    let bestPos = Infinity;
    for (const mp of item?.mentionedPlayers || []) {
      const cleanName = String(mp?.name || '')
        .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
        .trim();
      const slug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!slug || ignoreNonPlayers.has(slug)) continue;
      const surname = cleanName.split(/\s+/).slice(-1)[0]?.toLowerCase() || '';
      const fullIdx = cleanName.length >= 5 ? findWordBoundaryIndexLower(leadLower, cleanName.toLowerCase()) : -1;
      const snIdx = surname.length >= 4 ? findWordBoundaryIndexLower(leadLower, surname) : -1;
      const pos = fullIdx >= 0 ? fullIdx : snIdx;
      if (pos >= 0 && pos < bestPos) {
        bestPos = pos;
        primarySlug = slug;
      }
    }
  }
  if (!primarySlug) {
    const leadSlugs = extractLeadProperNameSlugs(lead);
    if (leadSlugs.length > 0) primarySlug = leadSlugs[0];
  }
  if (!primarySlug && activeTeam?.abbr === 'SF') {
    primarySlug = resolveFallback49ersShorthandSlug(lead);
  }
  if (!primarySlug || ignoreNonPlayers.has(primarySlug)) return empty;

  // Detect multi-player combo transaction headlines (e.g. "49ers news: Brandon Aiyuk clears waivers, Robert Beal Jr. released")
  const leadNameSlugs = extractLeadProperNameSlugs(lead);
  const distinctPlayersInLead = new Set([primarySlug]);
  for (const s of leadNameSlugs) distinctPlayersInLead.add(s);
  const isMultiPlayerCombo =
    distinctPlayersInLead.size >= 2 &&
    (MULTI_PLAYER_SECOND_TX_CLAUSE_RE.test(lead) ||
      /,\s*[a-z .'-]{2,28}\s+(?:released|waived|signed|cut)\b/i.test(lead));

  const nonActiveTeams = extractNonActiveTeamAbbrsInText(lead, activeTeam);
  const destTeamAbbr = nonActiveTeams.length === 1 ? nonActiveTeams[0] : '';
  const isClickbaitMystery =
    MYSTERY_TEAM_CLICKBAIT_RE.test(lead) && nonActiveTeams.length === 0;

  // 1. Confirmed Free-Agent Signing / Waiver Claim (Stage 4)
  if (
    TRANSACTION_SAGA_SIGNING_RE.test(lead) &&
    !TRANSACTION_SAGA_SPECULATIVE_OUTLOOK_RE.test(lead) &&
    !/\b(could|might|should|predicted|projected|expected|favorite|rumor|potential)\s+to\s+sign\b/i.test(lead) &&
    !/\b(practice\s+squad)\b/i.test(lead)
  ) {
    return {
      isSaga: true,
      playerSlug: primarySlug,
      facet: 'fa_signing_deal',
      stage: 4,
      subStage: 4.0,
      destTeamAbbr,
      sigKey: destTeamAbbr ? `${primarySlug}::fa_signing::${destTeamAbbr}` : `${primarySlug}::fa_signing`,
      isMultiPlayerCombo,
      isClickbaitMystery,
      isSpeculative: false
    };
  }

  // 2. Concrete Scheduled Team Visit / Workout / Meeting (Stage 3)
  if (TRANSACTION_SAGA_VISIT_RE.test(lead)) {
    return {
      isSaga: true,
      playerSlug: primarySlug,
      facet: 'team_visit_pursuit',
      stage: 3,
      subStage: 3.0,
      destTeamAbbr,
      sigKey: destTeamAbbr ? `${primarySlug}::fa_visit::${destTeamAbbr}` : `${primarySlug}::fa_visit`,
      isMultiPlayerCombo,
      isClickbaitMystery,
      isSpeculative: false
    };
  }

  // 3. Speculative / Analytical Landing Spots, "What's Next", or Mystery-Team Favorite (Stage 0 Perspective)
  if (TRANSACTION_SAGA_SPECULATIVE_OUTLOOK_RE.test(lead)) {
    return {
      isSaga: true,
      playerSlug: primarySlug,
      facet: 'speculative_outlook',
      stage: 0,
      subStage: isClickbaitMystery ? -0.5 : 0.0,
      destTeamAbbr,
      sigKey: `${primarySlug}::fa_speculative_outlook`,
      isMultiPlayerCombo,
      isClickbaitMystery,
      isSpeculative: true
    };
  }

  // 4. Cleared Waivers / Unclaimed / Free-Agent Market Interest (Stage 2; subStage 2.5 confirmed clear > 2.0 interest)
  const isConfirmedWaiverClear = TRANSACTION_SAGA_WAIVER_CLEAR_RE.test(lead);
  const isMarketInterest = TRANSACTION_SAGA_MARKET_INTEREST_RE.test(lead);
  if (isConfirmedWaiverClear || isMarketInterest) {
    return {
      isSaga: true,
      playerSlug: primarySlug,
      facet: 'waiver_clear_market',
      stage: 2,
      subStage: isConfirmedWaiverClear ? 2.5 : 2.0,
      destTeamAbbr,
      sigKey: `${primarySlug}::fa_waiver_market`,
      isMultiPlayerCombo,
      isClickbaitMystery,
      isSpeculative: false
    };
  }

  // 5. Original Club Release / Waiver / Departure (Stage 1)
  //    Exclude cap-breakdown & reaction pieces so unique CBA/analytical perspectives keep their own dedicated card!
  if (
    TRANSACTION_SAGA_DEPARTURE_RE.test(lead) &&
    !TRANSACTION_SAGA_CAP_BREAKDOWN_EXCLUSION_RE.test(lead) &&
    !/\bafter\s+(?:being\s+)?(?:waived|released|release|cut)\b/i.test(lead)
  ) {
    return {
      isSaga: true,
      playerSlug: primarySlug,
      facet: 'departure_release',
      stage: 1,
      subStage: 1.0,
      destTeamAbbr: '',
      sigKey: `${primarySlug}::roster_departure`,
      isMultiPlayerCombo,
      isClickbaitMystery: false,
      isSpeculative: false
    };
  }

  return empty;
}

function buildStorySignatureKey(item = {}, { rosterPlayers = [], teamConfig = null } = {}) {
  const lead = extractPrimaryClaimText(item);
  if (!lead) return null;
  const lower = lead.toLowerCase();

  const activeSigTeam = resolveTeamConfig(teamConfig || getActiveTeamConfig());
  const isSfSig = activeSigTeam?.abbr === 'SF';
  const teamNamesPat = isSfSig
    ? '49ers|san francisco|niners'
    : [activeSigTeam?.fullName, activeSigTeam?.nickname, ...(activeSigTeam?.keywordRules?.requiredNicknames || []), ...(activeSigTeam?.keywordRules?.excludeGenericCity ? [] : [activeSigTeam?.city])]
        .filter(Boolean)
        .map(x => escapeRegexToken(String(x).toLowerCase()))
        .join('|') || 'nfl';
  const hcSurname = String(activeSigTeam?.coachesSeed?.hc || 'shanahan').trim().split(/\s+/).slice(-1)[0]?.toLowerCase() || 'coach';

  const primaryPlayer = item?.mentionedPlayers?.[0];
  const leadSlugs = extractLeadProperNameSlugs(lead);
  const earliestMentionedSlug = resolvePrimaryInjuredPlayerSlug(item, [], activeSigTeam);
  const pKey =
    earliestMentionedSlug ||
    (primaryPlayer?.name
      ? String(primaryPlayer.name)
          .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
      : primaryPlayer?.id
        ? String(primaryPlayer.id).toLowerCase().replace(/[^a-z0-9]/g, '')
        : leadSlugs[0] || (isSfSig ? resolveFallback49ersShorthandSlug(lead) : null));

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

  // 5. Podium / Coach explaining why team traded for / what newly acquired player brings
  if (
    pKey &&
    new RegExp(`\\b${escapeRegexToken(hcSurname)}\\b`, 'i').test(lower) &&
    new RegExp(
      `\\b(explains? why|reveals? what|discusses? addition|pumped['’]? about|what [\\s\\S]{1,25} brings|shares? #?(?:${teamNamesPat}) injury updates?,? discusses)\\b`,
      'i'
    ).test(lower)
  ) {
    return `${pKey}::coach_podium_fit`;
  }

  // 5b. Newly acquired player introductory locker-room reaction
  if (
    pKey &&
    /\b(energized|thrilled|super excited|excited to be (?:back|with|here)|head is ['"“]?spinning)\b/.test(lower) &&
    new RegExp(`\\b(trade|${teamNamesPat}${isSfSig ? '|bay' : ''})\\b`, 'i').test(lower)
  ) {
    return `${pKey}::player_arrival_reaction`;
  }

  // 6. Primary Trade Acquisition / Official Trade Announcement for a specific player
  if (
    !SECONDARY_COMMENTARY_OR_REACTION_REGEX.test(lead) &&
    !RETROSPECTIVE_UNEXECUTED_TRADE_REGEX.test(lead) &&
    new RegExp(
      `\\b(\\btrade[!:]|trade alert|agree[sd]? to (?:a )?trade|completing a trade|sending [\\s\\S]{1,50}to (?:the )?(?:${teamNamesPat})|heading to (?:the )?(?:${teamNamesPat})|(?:${teamNamesPat}) (?:officially )?(?:trade[sd]? for|acquire[sd]?|acquiring|have (?:officially )?acquired|announced? [\\s\\S]{0,35}(?:acquired|trade))|officially announce [\\s\\S]{0,30}trade|(?:${teamNamesPat}) roster move:\\s*acquired|swap draft pick)\\b`,
      'i'
    ).test(lead)
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

  // 7b. Player-specific Roster Departure / Waiver / Free-Agency / Team Visit / Speculative Outlook Saga Facet (All 32 Teams)
  const sagaInfo = analyzePlayerTransactionSaga(item, rosterPlayers, activeSigTeam);
  if (sagaInfo.isSaga && sagaInfo.sigKey) {
    return sagaInfo.sigKey;
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
    /\b(hoping['"“”‘’]?\s+to['"“”‘’]?\s+have|hoping['"“”‘’]?[\s\S]{0,25}returns? to practice|chance to return|hopes to get|fly(?:ing)? (?:to|into) colorado)\b/i.test(
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

function shareAnyPlayerEntity(setA, setB) {
  if (!setA?.size || !setB?.size) return false;
  for (const x of setA) {
    if (x.startsWith('pname:') && setB.has(x)) return true;
  }
  return false;
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

function scoreClusterLeadQuality(item = {}, sagaInfo = null) {
  const trustTier = Number(item.trustTier) || 2;
  const isVideo = item.type === 'video' || Boolean(item.videoId);
  const isArticle = item.type === 'article' || item.type === 'post';
  const isPlayerBioBlurb = isPlayerBioWireBlurbItem(item);
  const titleText = String(item.title || item.headline || '').trim();
  const fullOrTitle = String(item.fullText || item.title || item.headline || '').trim();
  const isPromoLinkTweet = !isArticle && /\bread:\s*$/i.test(titleText);
  const isConversationalAside = /^(?:if it helps|pretty interesting|fwiw|fun fact)\b/i.test(titleText);
  const isRewriteAgg = AGGREGATOR_REWRITE_OUTLET_REGEX.test(`${item.outletName || ''} ${item.url || ''}`);
  const isTruncatedPaywallTeaser =
    !isArticle &&
    (TRUNCATED_PAYWALL_TEASER_RE.test(fullOrTitle) ||
      (/(?:\.\.\.|…)\s*$/.test(titleText) &&
        /(?:nytimes\.com\/athletic|theathletic\.com|sfchronicle\.com|mercurynews\.com)/i.test(
          `${fullOrTitle} ${item.externalUrl || ''}`
        )));
  const isMysteryClickbait =
    Boolean(sagaInfo?.isClickbaitMystery) ||
    (MYSTERY_TEAM_CLICKBAIT_RE.test(titleText) &&
      extractNonActiveTeamAbbrsInText(titleText).length === 0 &&
      /\b(favorite|emerges|landing|sign|trade|suitor|pursuing)\b/i.test(titleText));
  const isMultiPlayerCombo = Boolean(sagaInfo?.isMultiPlayerCombo);
  const hasSpecificNamedTeam =
    Boolean(sagaInfo?.destTeamAbbr) &&
    (sagaInfo?.facet === 'team_visit_pursuit' || sagaInfo?.facet === 'fa_signing_deal');

  const tierScore = isRewriteAgg ? 8 : trustTier === 1 ? 29 : trustTier === 2 ? 23 : 19;
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
  const mysteryClickbaitPenalty = isMysteryClickbait ? -14 : 0;
  const truncatedPaywallPenalty = isTruncatedPaywallTeaser ? -12 : 0;
  const multiPlayerComboPenalty = isMultiPlayerCombo ? -10 : 0;
  const specificityBonus = hasSpecificNamedTeam ? 4 : 0;
  const thumbBonus = !isVideo && !isPlayerBioBlurb && item.imageUrl && /^https:\/\//i.test(item.imageUrl) ? 6 : 0;
  const sigBonus = Math.min(18, (Number(item.signalScore) || 65) * 0.18);
  const primaryMoveBonus =
    item.storyTier === 'tier1_major' || item.storyTier === 'tier2_roster' ? 16 : 0;
  const urgencyBonus = isUrgentBreakingBadge(item.breakingBadge) ? 20 : item.breakingBadge ? 6 : 0;
  const xPlatformBonus = isDirectXStatusUrl(item.url) ? 12 : isBlueskyPostUrl(item.url) ? -4 : 0;
  const nativeStreamBonus = item.videoStreamUrl && /^https:\/\//i.test(String(item.videoStreamUrl)) ? 8 : 0;
  const youtubeVideoBonus = !nativeStreamBonus && item.videoId ? 7 : 0;
  return (
    tierScore +
    formatScore +
    conversationalPenalty +
    mysteryClickbaitPenalty +
    truncatedPaywallPenalty +
    multiPlayerComboPenalty +
    specificityBonus +
    thumbBonus +
    sigBonus +
    primaryMoveBonus +
    urgencyBonus +
    xPlatformBonus +
    nativeStreamBonus +
    youtubeVideoBonus
  );
}

function bestSnapshotSetOverlap(targetSet, leadSet, memberSnapshots = [], field = 'tokens') {
  let best = setOverlapSimilarity(targetSet, leadSet);
  for (const snap of memberSnapshots) {
    const s = snap?.[field];
    if (!s || !s.size) continue;
    const cand = setOverlapSimilarity(targetSet, s);
    if (cand.jaccard > best.jaccard || (cand.jaccard === best.jaccard && cand.containment > best.containment)) {
      best = cand;
    }
  }
  return best;
}

const MAX_ACTIVE_SAGA_CARDS_PER_PLAYER = 4;

/**
 * Merges `donor` cluster into `receiver` cluster (used in Pass-2 twin/saga consolidation),
 * preserving all members in `confirmingReports` and keeping the stronger/higher-stage lead on top.
 */
function mergeClusterInto(receiver, donor, { nowMs = Date.now(), forceKeepReceiverLead = false } = {}) {
  const donorAll = [
    { ...donor.lead, confirmingReports: undefined, isUrgentBreaking: false, isBreaking: false },
    ...(Array.isArray(donor.lead.confirmingReports) ? donor.lead.confirmingReports : [])
  ];
  for (const m of donor.members || []) receiver.members.push(m);
  if (donor.oldestMs && (!receiver.oldestMs || donor.oldestMs < receiver.oldestMs)) {
    receiver.oldestMs = donor.oldestMs;
  }
  if (donor.newestMs && (!receiver.newestMs || donor.newestMs > receiver.newestMs)) {
    receiver.newestMs = donor.newestMs;
  }
  if (!forceKeepReceiverLead) {
    const recStage = receiver.sagaInfo?.isSaga ? Number(receiver.sagaInfo.subStage || 0) : -1;
    const donStage = donor.sagaInfo?.isSaga ? Number(donor.sagaInfo.subStage || 0) : -1;
    const recQual = scoreClusterLeadQuality(receiver.lead, receiver.sagaInfo);
    const donQual = scoreClusterLeadQuality(donor.lead, donor.sagaInfo);
    const donBetter =
      donStage > recStage ||
      (donStage === recStage && donQual > recQual + 3);
    if (donBetter) {
      const prevRecLead = {
        ...receiver.lead,
        isUrgentBreaking: false,
        isBreaking: false
      };
      const prevRecConf = Array.isArray(prevRecLead.confirmingReports) ? prevRecLead.confirmingReports : [];
      delete prevRecLead.confirmingReports;
      const bestImg = isEditorialPhotoUrl(donor.lead.imageUrl)
        ? donor.lead.imageUrl
        : isEditorialPhotoUrl(prevRecLead.imageUrl)
          ? prevRecLead.imageUrl
          : donor.lead.imageUrl || prevRecLead.imageUrl || '';
      receiver.lead = {
        ...donor.lead,
        imageUrl: bestImg,
        breakingPriority: Math.max(donor.lead.breakingPriority || 0, prevRecLead.breakingPriority || 0),
        confirmingReports: [prevRecLead, ...prevRecConf, ...(Array.isArray(donor.lead.confirmingReports) ? donor.lead.confirmingReports : [])]
      };
      receiver.sagaInfo = donor.sagaInfo || receiver.sagaInfo;
      if (donor.sigKey) receiver.sigKey = donor.sigKey;
      if (donStage > recStage) receiver.hasSagaProgressionAdvance = true;
      return;
    }
  }
  if (!Array.isArray(receiver.lead.confirmingReports)) receiver.lead.confirmingReports = [];
  receiver.lead.confirmingReports.push(...donorAll);
  if (
    (!isEditorialPhotoUrl(receiver.lead.imageUrl) && isEditorialPhotoUrl(donor.lead.imageUrl)) ||
    (!receiver.lead.imageUrl && donor.lead.imageUrl)
  ) {
    receiver.lead.imageUrl = donor.lead.imageUrl;
  }
  receiver.lead.breakingPriority = Math.max(
    receiver.lead.breakingPriority || 0,
    donor.lead.breakingPriority || 0
  );
  if (donor.hasSagaProgressionAdvance) receiver.hasSagaProgressionAdvance = true;
  if (donor.hasInjuryProgressionAdvance) receiver.hasInjuryProgressionAdvance = true;
  void nowMs;
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

  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);
  const rosterPlayersForGroup = Array.isArray(ctx?.rosterPlayers)
    ? ctx.rosterPlayers
    : Array.isArray(appData?.roster?.players)
      ? appData.roster.players
      : [];

  // Flat exact-URL-only dedup mode (used for Latest chronological wire or when Top story grouping is turned off)
  // Still prevents red-badge flooding when multiple reporters post older/duplicate updates on the same player injury!
  if (groupSimilarStories === false) {
    const seenUrls = new Set();
    const seenUrgentAngleStage = new Set();
    const flat = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const cu = canonicalComparableUrl(item.url || '');
      if (cu && !cu.includes('x.com/search?') && seenUrls.has(cu)) continue;
      if (cu) seenUrls.add(cu);
      const copy = {
        ...item,
        confirmingReports: [],
        clusterKind: undefined,
        _isLowSalienceRoundupCluster: undefined
      };
      if (isUrgentBreakingBadge(copy.breakingBadge)) {
        const sigKey = buildStorySignatureKey(copy);
        if (sigKey) {
          const prog = computeInjuryProgressionLevel(copy);
          const stageKey = `${sigKey}::p${prog}`;
          if (seenUrgentAngleStage.has(stageKey)) {
            copy.isUrgentBreaking = false;
            copy.isBreaking = false;
            copy.breakingBadge =
              copy.category === 'injury' || copy.isInGameInjury || copy.isPostGameInjuryUpdate
                ? 'INJURY UPDATE'
                : 'ROSTER MOVE';
          } else {
            seenUrgentAngleStage.add(stageKey);
          }
        }
      }
      flat.push(copy);
    }
    return enforceSingleBreakingInjuryPerPlayer(flat, {
      nowMs,
      rosterPlayers: rosterPlayersForGroup,
      teamConfig: ctx?.teamConfig || null
    });
  }

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
    const itemSagaInfo = analyzePlayerTransactionSaga(item, rosterPlayersForGroup, ctx?.teamConfig || null);
    const sigKey = buildStorySignatureKey(item, {
      rosterPlayers: rosterPlayersForGroup,
      teamConfig: ctx?.teamConfig || null
    });
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
    const itemLeadText = extractPrimaryClaimText(item);
    const itemPracticeBucket = resolvePracticeStatusBucket(itemLeadText);
    const itemIsBioBlurb = isPlayerBioWireBlurbItem(item);
    const itemSpeaker = extractOfficialSpeakerKey(item);
    const itemTopicDomain = resolveBriefingTopicDomain(item);
    const itemPrimaryPlayer = extractPrimaryPlayerSlug(item) || (itemSagaInfo.isSaga ? itemSagaInfo.playerSlug : '');
    const itemInjInfo = analyzeSinglePlayerInjuryItem(item, rosterPlayersForGroup, ctx?.teamConfig || null);
    const itemReporterKey = String(item.reporterId || item.reporterName || item.author || '').toLowerCase().trim();
    const itemPrimaryUrl = canonicalComparableUrl(item.url || '');
    const itemExternalUrl = canonicalComparableUrl(item.externalUrl || '');

    let matchedCluster = null;
    let bestSim = 0;

    for (const cl of clusters) {
      // Never cross-swallow a format-filtered item into a lead of a different media type
      if (preserveFormat && matchesPreservedFormat(item) !== matchesPreservedFormat(cl.lead)) {
        continue;
      }

      // Never swallow an authoritative/film/highlight standalone video or GIF clip card into a text article/tweet cluster (while still allowing Tier-3 vlog echoes to fold under higher-tier reports)
      const isProtectedStandaloneVideo = it =>
        (it.type === 'video' || Boolean(it.videoId) || Boolean(it.videoStreamUrl)) &&
        Number(it.trustTier || 1) < 3 &&
        !/grant cohn/i.test(`${it.author || ''} ${it.outletName || ''}`);
      if (isProtectedStandaloneVideo(item) !== isProtectedStandaloneVideo(cl.lead)) {
        continue;
      }

      // Keep league-wide Film & Trench chart posts isolated from team-specific All/Tweets clusters
      if (Boolean(item.filmOnlyScope) !== Boolean(cl.lead.filmOnlyScope)) {
        continue;
      }

      // Adaptive sliding temporal window:
      // - Speculative/analytical outlook pieces trickle over 48h (e.g. "What's next" + "5 landing spots" + "favorite")
      // - Active events use 36h rolling window against lead/newest timestamp, bounded by 48h total cluster span
      const isSpeculativeOutlookPair =
        itemSagaInfo.facet === 'speculative_outlook' && cl.sagaInfo?.facet === 'speculative_outlook';
      const maxWindowMs = (isSpeculativeOutlookPair ? 48 : 36) * 3_600_000;
      const maxSpanMs = (isSpeculativeOutlookPair ? 60 : 48) * 3_600_000;
      if (itemMs && cl.anchorMs) {
        const minGap = Math.min(
          Math.abs(cl.anchorMs - itemMs),
          cl.newestMs ? Math.abs(cl.newestMs - itemMs) : Infinity
        );
        const projectedSpan =
          Math.max(cl.newestMs || cl.anchorMs, itemMs) - Math.min(cl.oldestMs || cl.anchorMs, itemMs);
        if (minGap > maxWindowMs || projectedSpan > maxSpanMs) {
          continue;
        }
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
          setOverlapSimilarity(entities, cl.leadEntities).jaccard > 0
        ) {
          matchedCluster = cl;
          bestSim = 0.98;
          break;
        }
      }

      // Anti-dilution similarity: compare against cluster lead + core member snapshots rather than a ballooned union!
      const tokSim = bestSnapshotSetOverlap(tokens, cl.leadTokens, cl.memberSnapshots, 'tokens');
      const entSim = bestSnapshotSetOverlap(entities, cl.leadEntities, cl.memberSnapshots, 'entities');

      // 1b. Same-Player Active Injury Episode Consolidation:
      //     Consolidates tightly related updates on the SAME injured player & compatible body part
      //     (even across milestones like carted-off -> ruled-out -> fracture confirmation -> visual commentary)
      //     under `Similar stories (N)` while pushing the latest/most-progressed update to the visible card.
      //     Distinct lower-similarity follow-ups >6h apart stay separate (with older breaking badges stripped below).
      const itemIsVideoCheck = item.type === 'video' || Boolean(item.videoId) || Boolean(item.videoStreamUrl);
      const leadIsVideoCheck = cl.lead.type === 'video' || Boolean(cl.lead.videoId) || Boolean(cl.lead.videoStreamUrl);
      if (
        itemInjInfo.isInjury &&
        cl.injInfo?.isInjury &&
        itemInjInfo.playerSlug === cl.injInfo.playerSlug &&
        !itemIsDigest &&
        !cl.isDigest &&
        !itemIsVideoCheck &&
        !leadIsVideoCheck &&
        itemInjInfo.milestone !== 'pre_game_availability' &&
        cl.injInfo.milestone !== 'pre_game_availability' &&
        areInjuryBodyPartsCompatible(itemInjInfo.bodyPart, cl.injInfo.bodyPart)
      ) {
        const refMs = cl.newestMs || cl.anchorMs || 0;
        const gapMs =
          itemMs && refMs
            ? Math.min(Math.abs((cl.anchorMs || refMs) - itemMs), Math.abs(refMs - itemMs))
            : 0;
        const withinTightInjuryWave = gapMs <= 6 * 3_600_000;
        const withinMediumInjuryWindow =
          gapMs <= 18 * 3_600_000 &&
          (Boolean(itemInjInfo.milestone && itemInjInfo.milestone === cl.injInfo.milestone) ||
            tokSim.jaccard >= 0.2 ||
            tokSim.containment >= 0.38 ||
            (Boolean(itemInjInfo.bodyPart && cl.injInfo.bodyPart) &&
              (itemIsBioBlurb || isPlayerBioWireBlurbItem(cl.lead))));
        if (withinTightInjuryWave || withinMediumInjuryWindow) {
          const injSimScore = withinTightInjuryWave ? 0.96 : 0.88;
          if (injSimScore > bestSim) {
            matchedCluster = cl;
            bestSim = injSimScore;
            if (withinTightInjuryWave) break;
          }
        }
      }

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

      // 2b. Secondary ESPN/RotoWire player-wire paraphrase of a beat reporter's original tweet (or twin ESPN+RotoWire blurbs citing same reporter)
      //     (e.g. Matt Maiocco KNBR tweet + RotoWire/ESPN paraphrase citing Matt Maiocco, or Matt Barrows DNP tweet + ESPN bio blurb)
      const leadIsBioBlurb = isPlayerBioWireBlurbItem(cl.lead);
      const leadLeadText = extractPrimaryClaimText(cl.lead);
      const leadPracticeBucket = resolvePracticeStatusBucket(leadLeadText);
      const leadReporterKey = String(cl.lead.reporterId || cl.lead.reporterName || cl.lead.author || '')
        .toLowerCase()
        .trim();
      const statusOrEscalationConflict = hasPracticeOrEscalationConflict(
        itemPracticeBucket,
        leadPracticeBucket,
        itemLeadText,
        leadLeadText
      );
      if (
        (itemIsBioBlurb || leadIsBioBlurb) &&
        itemReporterKey &&
        itemReporterKey === leadReporterKey &&
        shareAnyPlayerEntity(entities, cl.entities) &&
        !statusOrEscalationConflict &&
        (!itemMs || !cl.anchorMs || Math.abs(cl.anchorMs - itemMs) <= 14 * 3_600_000)
      ) {
        const samePracticeBucket = Boolean(itemPracticeBucket && itemPracticeBucket === leadPracticeBucket);
        const withinParaphraseWindow = !itemMs || !cl.anchorMs || Math.abs(cl.anchorMs - itemMs) <= 8 * 3_600_000;
        const sameSpeaker = Boolean(itemSpeaker && cl.speaker && itemSpeaker === cl.speaker);
        let sharedNonEntityWords = 0;
        for (const t of combinedUnigrams) {
          if (cl.combinedUnigrams.has(t) && !entityNameWords.has(t) && !GENERIC_PLAY_BY_PLAY_BRIDGE_WORDS.has(t)) {
            sharedNonEntityWords += 1;
          }
        }
        if (
          samePracticeBucket ||
          (withinParaphraseWindow && (!sigKey || !cl.sigKey || sigKey === cl.sigKey) && (sameSpeaker || sharedNonEntityWords >= 2))
        ) {
          matchedCluster = cl;
          bestSim = 0.9;
          break;
        }
      }

      // Prevent merging items that have DIFFERENT explicit player-specific injury milestones, saga facets, or semantic signatures
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
          continue;
        }

        // Careful Same-Player Short Highlight Clip Grouping (e.g. multiple Mike Evans highlight clips from @StatsOnFire, @49ers, @NBCS49ers, @NFL within 18h)
        // Strictly excludes All-22 film breakdowns, full-game mashups/recaps, podcasts, and podium press conferences!
        const isNonFilmShortHighlightClip = (v, durSecVal) => {
          if (!v || v.category === 'film') return false;
          if (!v.videoStreamUrl && !v.isHighlightClip) return false;
          const t = String(v.title || v.fullText || '').trim();
          if (
            /\b(game highlights|full game highlights|condensed game|podcast|press conference|media availability|locker room|forty niner way|49hours|mic['’]?d up|previews week|speaks to the media)\b/i.test(
              t
            )
          ) {
            return false;
          }
          return durSecVal === null || durSecVal <= 150;
        };
        const gapMsVid = itemMs && cl.anchorMs ? Math.abs(cl.anchorMs - itemMs) : 0;
        const sameSingleHighlightPlayer =
          pA.length === 1 && pB.length === 1 && pA[0] === pB[0];
        if (
          sameSingleHighlightPlayer &&
          gapMsVid <= 18 * 3_600_000 &&
          isNonFilmShortHighlightClip(item, durA) &&
          isNonFilmShortHighlightClip(cl.lead, durB)
        ) {
          const playerClipSim = 0.82;
          if (playerClipSim > bestSim) {
            bestSim = playerClipSim;
            matchedCluster = cl;
          }
        }
        continue;
      }

      // 3. Cross-outlet TF-IDF Headline Token + Entity Hybrid Similarity (non-diluted against lead & core snapshots)
      //    Require shared player entities (`pname:*`) when both items mention players so unrelated player stories never merge via shared coach/opponent!
      const bothHavePlayers =
        (item.mentionedPlayers?.length || 0) > 0 && (cl.lead.mentionedPlayers?.length || 0) > 0;
      if (bothHavePlayers && !shareAnyPlayerEntity(entities, cl.leadEntities)) {
        continue;
      }

      const hasTopicDomainConflict = Boolean(
        itemTopicDomain && cl.topicDomain && itemTopicDomain !== cl.topicDomain
      );
      const hybridScore = 0.62 * tokSim.jaccard + 0.38 * entSim.jaccard;
      const strongHeadlineEcho = tokSim.jaccard >= 0.48 || (tokSim.containment >= 0.72 && tokens.size >= 4);
      if (
        !statusOrEscalationConflict &&
        !hasTopicDomainConflict &&
        (hybridScore >= 0.46 || strongHeadlineEcho) &&
        hybridScore > bestSim
      ) {
        bestSim = hybridScore;
        matchedCluster = cl;
        continue;
      }

      // 3b. Summary-assisted Same-Entity Bridge for paraphrased beat coverage within 24h (articles) or 12h (cross-format article↔tweet)
      //     (e.g. headline "makes honest admission about slow start" + summary "not playing his best... first sack"
      //      matching "Nick Bosa: I don't think I've played my best football").
      //     Requires non-entity, non-play-by-play content tokens to overlap so sharing player names or game stats never falsely bridges!
      const itemIsArt = item.type === 'article' || item.type === 'post';
      const leadIsArt = cl.lead.type === 'article' || cl.lead.type === 'post';
      const sameSinglePlayer = Boolean(itemPrimaryPlayer && cl.primaryPlayer && itemPrimaryPlayer === cl.primaryPlayer);
      const bridgeWindowMs = itemIsArt && leadIsArt ? 24 * 3_600_000 : 12 * 3_600_000;
      if (
        (itemIsArt || leadIsArt) &&
        !itemIsDigest &&
        !cl.isDigest &&
        !itemIsVideo &&
        !leadIsVideo &&
        !statusOrEscalationConflict &&
        ((itemIsArt && leadIsArt && entSim.jaccard >= 0.34) || (sameSinglePlayer && entSim.jaccard >= 0.45)) &&
        (!itemMs || !cl.anchorMs || Math.abs(cl.anchorMs - itemMs) <= bridgeWindowMs)
      ) {
        const subSim = bestSnapshotSetOverlap(combinedUnigrams, cl.leadUnigrams, cl.memberSnapshots, 'unigrams');
        let sharedContentCount = 0;
        for (const t of combinedUnigrams) {
          if (
            cl.leadUnigrams.has(t) &&
            !entityNameWords.has(t) &&
            !GENERIC_PLAY_BY_PLAY_BRIDGE_WORDS.has(t)
          ) {
            sharedContentCount += 1;
          }
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
          continue;
        }
      }

      // 3c. Same-Cycle Official Briefing / Radio Interview Cluster (Cross-Format: Tweet ↔ Wire Blurb ↔ Article)
      //     Groups different pull-quotes from the exact same GM/Coach/Coordinator briefing (e.g. John Lynch on KNBR
      //     discussing Mike Evans' Achilles recovery / padded practice chance) within a tight 10h cycle while
      //     strictly blocking next-day updates, multi-player transcripts, different speakers, or status escalations!
      const leadTimeMs = resolveEffectivePublishTimestampMs(cl.lead, nowMs) || cl.anchorMs;
      const withinBriefingCycle =
        !itemMs ||
        !leadTimeMs ||
        Math.abs(leadTimeMs - itemMs) <= 10 * 3_600_000 ||
        (cl.anchorMs && Math.abs(cl.anchorMs - itemMs) <= 10 * 3_600_000);
      if (
        !itemIsDigest &&
        !cl.isDigest &&
        !itemIsVideo &&
        !leadIsVideo &&
        !statusOrEscalationConflict &&
        itemSpeaker &&
        cl.speaker &&
        itemSpeaker === cl.speaker &&
        sameSinglePlayer &&
        itemTopicDomain &&
        cl.topicDomain &&
        itemTopicDomain === cl.topicDomain &&
        withinBriefingCycle
      ) {
        const briefingScore = 0.84;
        if (briefingScore > bestSim) {
          bestSim = briefingScore;
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
        speaker: itemSpeaker,
        topicDomain: itemTopicDomain,
        primaryPlayer: itemPrimaryPlayer,
        injInfo: itemInjInfo,
        sagaInfo: itemSagaInfo,
        anchorMs: itemMs,
        oldestMs: itemMs,
        newestMs: itemMs,
        leadTokens: new Set(tokens),
        leadUnigrams: new Set(combinedUnigrams),
        leadEntities: new Set(entities),
        memberSnapshots: [{ tokens: new Set(tokens), unigrams: new Set(combinedUnigrams), entities: new Set(entities) }],
        tokens: new Set(tokens),
        combinedUnigrams: new Set(combinedUnigrams),
        entities: new Set(entities),
        lead: clonedLead,
        members: [item]
      });
      continue;
    }

    matchedCluster.members.push(item);
    if (!matchedCluster.speaker && itemSpeaker) matchedCluster.speaker = itemSpeaker;
    if (!matchedCluster.topicDomain && itemTopicDomain) matchedCluster.topicDomain = itemTopicDomain;
    if (!matchedCluster.primaryPlayer && itemPrimaryPlayer) matchedCluster.primaryPlayer = itemPrimaryPlayer;
    if (itemMs) {
      if (!matchedCluster.oldestMs || itemMs < matchedCluster.oldestMs) matchedCluster.oldestMs = itemMs;
      if (!matchedCluster.newestMs || itemMs > matchedCluster.newestMs) matchedCluster.newestMs = itemMs;
    }
    if (matchedCluster.memberSnapshots.length < 5) {
      matchedCluster.memberSnapshots.push({
        tokens: new Set(tokens),
        unigrams: new Set(combinedUnigrams),
        entities: new Set(entities)
      });
    }
    for (const t of tokens) matchedCluster.tokens.add(t);
    for (const t of combinedUnigrams) matchedCluster.combinedUnigrams.add(t);
    for (const e of entities) matchedCluster.entities.add(e);

    const existingQual = scoreClusterLeadQuality(matchedCluster.lead, matchedCluster.sagaInfo);
    const candQual = scoreClusterLeadQuality(item, itemSagaInfo);
    const existingMs = resolveEffectivePublishTimestampMs(matchedCluster.lead, nowMs) || 0;
    const xUpgradesBskyLead =
      isDirectXStatusUrl(item.url) &&
      isBlueskyPostUrl(matchedCluster.lead.url) &&
      (Number(item.trustTier) || 2) <= (Number(matchedCluster.lead.trustTier) || 2);

    // Progression- & recency-aware injury lead promotion:
    // 1. Higher medical progression (MRI diagnosis > Ruled Out/Returned > Carted/Air Cast > Body Part/QTR > Tent > Speculative)
    //    IMMEDIATELY supersedes earlier preliminary tweets on the visible lead card.
    // 2. Within the same injury progression stage, a meaningfully newer update (>10m fresher, non-aggregator)
    //    pushes to the visible card, while a simultaneous <=10m burst picks the highest-authority/direct-X tweet!
    const existingProg = computeInjuryProgressionLevel(matchedCluster.lead);
    const candProg = computeInjuryProgressionLevel(item);
    const existingBody = extractNamedInjuryBodyPart(
      `${matchedCluster.lead.title || ''} ${matchedCluster.lead.fullText || ''}`
    );
    const candBody = extractNamedInjuryBodyPart(`${item.title || ''} ${item.fullText || ''}`);
    const isInjuryCluster = Boolean(
      itemInjInfo.isInjury || matchedCluster.injInfo?.isInjury || Math.max(existingProg, candProg) >= 1
    );
    const existingIsSpeculativeInj = Boolean(
      matchedCluster.injInfo?.isSpeculative || (isInjuryCluster && existingProg === 0)
    );
    const candIsSpeculativeInj = Boolean(itemInjInfo.isSpeculative || (isInjuryCluster && candProg === 0));
    const candAdvancesInjuryStage =
      (existingIsSpeculativeInj && !candIsSpeculativeInj) ||
      candProg > existingProg ||
      (candProg >= 1 &&
        candProg === existingProg &&
        !existingBody &&
        Boolean(candBody) &&
        itemMs >= existingMs - 10 * 60_000);
    const existingHasHigherInjuryStage =
      (!existingIsSpeculativeInj && candIsSpeculativeInj) || existingProg > candProg;

    // Progression- & specificity-aware transaction-saga lead promotion:
    // Inside a player transaction/FA saga cluster (e.g. waiver_clear_market: confirmed waiver clear 2.5 > rumored interest 2.0),
    // higher confirmed stage promotes to Top Story (blocking clickbait mystery headlines and multi-player combos from hijacking).
    const isSagaCluster = Boolean(itemSagaInfo.isSaga && matchedCluster.sagaInfo?.isSaga);
    const candSubStage = isSagaCluster ? Number(itemSagaInfo.subStage || 0) : 0;
    const existingSubStage = isSagaCluster ? Number(matchedCluster.sagaInfo.subStage || 0) : 0;
    const candIsLowQualitySaga =
      itemSagaInfo.isClickbaitMystery ||
      itemSagaInfo.isMultiPlayerCombo ||
      AGGREGATOR_REWRITE_OUTLET_REGEX.test(`${item.outletName || ''} ${item.url || ''}`);
    const existingIsLowQualitySaga =
      Boolean(matchedCluster.sagaInfo?.isClickbaitMystery) ||
      Boolean(matchedCluster.sagaInfo?.isMultiPlayerCombo) ||
      AGGREGATOR_REWRITE_OUTLET_REGEX.test(`${matchedCluster.lead.outletName || ''} ${matchedCluster.lead.url || ''}`);
    const candAdvancesSagaStage =
      isSagaCluster &&
      candSubStage > existingSubStage &&
      (!candIsLowQualitySaga || existingIsLowQualitySaga);
    const existingHasHigherSagaStage =
      isSagaCluster &&
      existingSubStage > candSubStage &&
      (!existingIsLowQualitySaga || candIsLowQualitySaga);

    let candidateIsBetterLead = false;
    if (candAdvancesInjuryStage) {
      candidateIsBetterLead = true;
    } else if (!existingHasHigherInjuryStage) {
      if (isInjuryCluster) {
        const candIsAgg = AGGREGATOR_REWRITE_OUTLET_REGEX.test(`${item.outletName || ''} ${item.url || ''}`);
        const existingIsAgg = AGGREGATOR_REWRITE_OUTLET_REGEX.test(
          `${matchedCluster.lead.outletName || ''} ${matchedCluster.lead.url || ''}`
        );
        const existingRepKey = String(
          matchedCluster.lead.reporterId || matchedCluster.lead.reporterName || matchedCluster.lead.author || ''
        )
          .toLowerCase()
          .trim();
        const isSameReporterBskyDowngrade =
          isBlueskyPostUrl(item.url) &&
          isDirectXStatusUrl(matchedCluster.lead.url) &&
          itemReporterKey &&
          itemReporterKey === existingRepKey;
        const candMeaningfullyNewer =
          itemMs > existingMs + 10 * 60_000 && (!candIsAgg || existingIsAgg) && !isSameReporterBskyDowngrade;
        const existingMeaningfullyNewer =
          existingMs > itemMs + 10 * 60_000 && (!existingIsAgg || candIsAgg);

        if (candMeaningfullyNewer) {
          candidateIsBetterLead = true;
        } else if (!existingMeaningfullyNewer) {
          // Simultaneous burst (<=10m): promote top authority / direct-X / urgent report
          const candUrg = isUrgentBreakingBadge(item.breakingBadge) ? 1 : 0;
          const existingUrg = isUrgentBreakingBadge(matchedCluster.lead.breakingBadge) ? 1 : 0;
          candidateIsBetterLead =
            candUrg > existingUrg ||
            (candUrg === existingUrg &&
              (xUpgradesBskyLead ||
                candQual > existingQual + 2 ||
                (Math.abs(candQual - existingQual) <= 2 && !isBlueskyPostUrl(item.url) && itemMs > existingMs)));
        }
      } else if (candAdvancesSagaStage) {
        candidateIsBetterLead = true;
      } else if (!existingHasHigherSagaStage) {
        const candTier = Number(item.trustTier) || 2;
        const existingTier = Number(matchedCluster.lead.trustTier) || 2;
        const meaningfullyFresherSaga =
          isSagaCluster &&
          !candIsLowQualitySaga &&
          !isBlueskyPostUrl(item.url) &&
          candTier <= existingTier &&
          itemMs > existingMs + 2 * 3_600_000 &&
          candQual >= existingQual - 6;
        candidateIsBetterLead =
          xUpgradesBskyLead ||
          candQual > existingQual + 5 ||
          meaningfullyFresherSaga ||
          (Math.abs(candQual - existingQual) <= 5 &&
            !candIsLowQualitySaga &&
            !isBlueskyPostUrl(item.url) &&
            itemMs > existingMs + 15 * 60_000 &&
            String(item.fullText || item.title || '').length >=
              String(matchedCluster.lead.fullText || matchedCluster.lead.title || '').length * 0.75);
      }
    }

    if (candAdvancesInjuryStage) {
      matchedCluster.hasInjuryProgressionAdvance = true;
    }
    if (candAdvancesSagaStage) {
      matchedCluster.hasSagaProgressionAdvance = true;
    }

    if (candidateIsBetterLead) {
      const demotedPrev = {
        ...matchedCluster.lead,
        isUrgentBreaking: false,
        isBreaking: false
      };
      const priorConfirming = Array.isArray(demotedPrev.confirmingReports) ? demotedPrev.confirmingReports : [];
      delete demotedPrev.confirmingReports;
      const bestClusterImg = isEditorialPhotoUrl(item.imageUrl)
        ? item.imageUrl
        : isEditorialPhotoUrl(demotedPrev.imageUrl)
          ? demotedPrev.imageUrl
          : item.imageUrl || demotedPrev.imageUrl || '';
      const inheritPrevBadge = !candIsSpeculativeInj && !item.breakingBadge && Boolean(demotedPrev.breakingBadge);
      matchedCluster.lead = {
        ...item,
        imageUrl: bestClusterImg,
        videoStreamUrl: item.videoStreamUrl || demotedPrev.videoStreamUrl || undefined,
        isAnimatedGif: Boolean(item.isAnimatedGif || (!item.videoStreamUrl && demotedPrev.isAnimatedGif)) || undefined,
        hasInlineChartImage: Boolean(item.hasInlineChartImage || demotedPrev.hasInlineChartImage) || undefined,
        duration: item.duration || demotedPrev.duration || undefined,
        isHighlightClip: Boolean(item.isHighlightClip || demotedPrev.isHighlightClip) || undefined,
        externalUrl: item.externalUrl || demotedPrev.externalUrl || null,
        externalTitle: item.externalTitle || demotedPrev.externalTitle || null,
        // Keep the newer/higher-stage update's own badge when present, only inheriting from prior lead when non-speculative
        breakingBadge: item.breakingBadge || (inheritPrevBadge ? demotedPrev.breakingBadge : null),
        isBreaking: Boolean(item.isBreaking || (inheritPrevBadge && matchedCluster.lead.isBreaking)),
        isUrgentBreaking: Boolean(item.isUrgentBreaking || (inheritPrevBadge && matchedCluster.lead.isUrgentBreaking)),
        isInGameInjury: Boolean(
          item.isInGameInjury || (!candAdvancesInjuryStage && !candIsSpeculativeInj && matchedCluster.lead.isInGameInjury)
        ),
        breakingPriority: Math.max(item.breakingPriority || 0, demotedPrev.breakingPriority || 0),
        storyTier:
          (item.breakingPriority || 0) >= (demotedPrev.breakingPriority || 0)
            ? item.storyTier
            : demotedPrev.storyTier || item.storyTier,
        confirmingReports: [demotedPrev, ...priorConfirming]
      };
      matchedCluster.outletKey = outletKey || matchedCluster.outletKey;
      matchedCluster.leadTokens = new Set(tokens);
      matchedCluster.leadUnigrams = new Set(combinedUnigrams);
      matchedCluster.leadEntities = new Set(entities);
      if (sigKey) matchedCluster.sigKey = sigKey;
      if (itemInjInfo.isInjury) matchedCluster.injInfo = itemInjInfo;
      if (itemSagaInfo.isSaga) matchedCluster.sagaInfo = itemSagaInfo;
    } else {
      matchedCluster.lead.confirmingReports.push({
        ...item,
        isUrgentBreaking: false,
        isBreaking: false
      });
      if (
        (!isEditorialPhotoUrl(matchedCluster.lead.imageUrl) && isEditorialPhotoUrl(item.imageUrl)) ||
        (!matchedCluster.lead.imageUrl && item.imageUrl)
      ) {
        matchedCluster.lead.imageUrl = item.imageUrl;
      }
      if (!matchedCluster.lead.breakingBadge && item.breakingBadge && !existingIsSpeculativeInj) {
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

  // Pass 2: Twin-Cluster Consolidation, Same-Team Visit -> Signing Fold, Per-Player Saga Card Cap (<=4),
  //         and Superseded Earlier-Phase Rank Dampening across all 32 NFL clubs!
  const activeClusters = clusters.filter(Boolean);
  const removedClusterSet = new Set();

  // 2a. Merge any twin clusters sharing identical sigKey within 48h (can happen when order-dependent leads shifted)
  for (let i = 0; i < activeClusters.length; i++) {
    const a = activeClusters[i];
    if (removedClusterSet.has(a) || !a.sigKey) continue;
    for (let j = i + 1; j < activeClusters.length; j++) {
      const b = activeClusters[j];
      if (removedClusterSet.has(b) || !b.sigKey || a.sigKey !== b.sigKey) continue;
      if (preserveFormat && matchesPreservedFormat(a.lead) !== matchesPreservedFormat(b.lead)) continue;
      const gap =
        a.newestMs && b.newestMs ? Math.abs(a.newestMs - b.newestMs) : 0;
      if (gap <= 48 * 3_600_000) {
        mergeClusterInto(a, b, { nowMs });
        removedClusterSet.add(b);
      }
    }
  }

  // 2b. Per-player Transaction-Saga Lifecycle Consolidation:
  //     - When a player signs with Team X (`fa_signing_deal`), fold any prior `team_visit_pursuit` for Team X within 48h into the signing card.
  //     - Cap active transaction-saga cards per single player at `MAX_ACTIVE_SAGA_CARDS_PER_PLAYER` (4) within 60h by folding the oldest superseded milestone.
  //     - Apply gentle rank dampening to superseded earlier phases (e.g. yesterday's release once waivers cleared / visit scheduled / signed).
  const sagaByPlayer = new Map();
  for (const cl of activeClusters) {
    if (removedClusterSet.has(cl)) continue;
    if (!cl.sagaInfo?.isSaga || !cl.sagaInfo.playerSlug) continue;
    const pSlug = cl.sagaInfo.playerSlug;
    if (!sagaByPlayer.has(pSlug)) sagaByPlayer.set(pSlug, []);
    sagaByPlayer.get(pSlug).push(cl);
  }

  for (const playerClusters of sagaByPlayer.values()) {
    // Same-team visit -> signing fold
    const signings = playerClusters.filter(c => !removedClusterSet.has(c) && c.sagaInfo.facet === 'fa_signing_deal');
    for (const signCl of signings) {
      const sTeam = signCl.sagaInfo.destTeamAbbr;
      for (const visCl of playerClusters) {
        if (removedClusterSet.has(visCl) || visCl === signCl) continue;
        if (visCl.sagaInfo.facet !== 'team_visit_pursuit') continue;
        const vTeam = visCl.sagaInfo.destTeamAbbr;
        if (sTeam && vTeam && sTeam !== vTeam) continue;
        if (!sTeam || vTeam === sTeam) {
          const gap =
            signCl.newestMs && visCl.newestMs ? Math.abs(signCl.newestMs - visCl.newestMs) : 0;
          if (gap <= 48 * 3_600_000) {
            mergeClusterInto(signCl, visCl, { nowMs, forceKeepReceiverLead: true });
            signCl.hasSagaProgressionAdvance = true;
            removedClusterSet.add(visCl);
          }
        }
      }
    }

    // Enforce MAX_ACTIVE_SAGA_CARDS_PER_PLAYER (4) within active 60h window
    let liveSaga = playerClusters.filter(c => !removedClusterSet.has(c));
    const newestSagaMs = liveSaga.reduce((mx, c) => Math.max(mx, c.newestMs || c.anchorMs || 0), 0);
    const recentLiveSaga = liveSaga.filter(
      c => !newestSagaMs || !c.newestMs || newestSagaMs - c.newestMs <= 60 * 3_600_000
    );
    if (recentLiveSaga.length > MAX_ACTIVE_SAGA_CARDS_PER_PLAYER) {
      const foldPriority = c => {
        const f = c.sagaInfo?.facet;
        if (f === 'departure_release') return 1;
        if (f === 'waiver_clear_market') return 2;
        if (f === 'speculative_outlook') return 3;
        if (f === 'team_visit_pursuit') return 4;
        return 5; // fa_signing_deal never folded
      };
      const foldCandidates = [...recentLiveSaga].sort((a, b) => {
        const pDiff = foldPriority(a) - foldPriority(b);
        if (pDiff !== 0) return pDiff;
        return (a.newestMs || 0) - (b.newestMs || 0);
      });
      let activeCount = recentLiveSaga.length;
      for (const donor of foldCandidates) {
        if (activeCount <= MAX_ACTIVE_SAGA_CARDS_PER_PLAYER) break;
        if (donor.sagaInfo?.facet === 'fa_signing_deal') break;
        const survivors = recentLiveSaga.filter(c => c !== donor && !removedClusterSet.has(c));
        // Fold into the nearest higher-stage concrete milestone (e.g. release -> waiver_clear_market -> team_visit -> signing)
        const receiver =
          survivors
            .filter(c => (c.sagaInfo?.stage || 0) >= (donor.sagaInfo?.stage || 0))
            .sort((a, b) => (a.sagaInfo?.stage || 0) - (b.sagaInfo?.stage || 0))[0] ||
          survivors.sort((a, b) => (b.newestMs || 0) - (a.newestMs || 0))[0];
        if (receiver) {
          mergeClusterInto(receiver, donor, { nowMs, forceKeepReceiverLead: true });
          removedClusterSet.add(donor);
          activeCount -= 1;
        }
      }
    }

    // Superseded earlier-phase rank dampening so newest concrete milestones naturally rise above older phases
    liveSaga = playerClusters.filter(c => !removedClusterSet.has(c));
    const maxConcreteStage = liveSaga.reduce((mx, c) => Math.max(mx, c.sagaInfo?.stage || 0), 0);
    if (maxConcreteStage >= 2) {
      for (const cl of liveSaga) {
        const f = cl.sagaInfo?.facet;
        if (f === 'departure_release') {
          cl._sagaSupersededMultiplier = maxConcreteStage >= 4 ? 0.62 : 0.74;
        } else if (f === 'speculative_outlook' && maxConcreteStage >= 4) {
          cl._sagaSupersededMultiplier = 0.65;
        } else if (f === 'waiver_clear_market' && maxConcreteStage >= 4) {
          cl._sagaSupersededMultiplier = 0.72;
        }
      }
    }
  }

  const survivingClusters = activeClusters.filter(cl => !removedClusterSet.has(cl));

  // Finalize cluster metadata, classify clusterKind (`corroboration` vs `similar`), sort related coverage, and re-rank!
  const finalized = survivingClusters.map(cl => {
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
      if (cl.injInfo?.isInjury) {
        uniqueRelated.sort((a, b) => {
          const pDiff = computeInjuryProgressionLevel(b) - computeInjuryProgressionLevel(a);
          if (pDiff !== 0) return pDiff;
          const tDiff =
            (resolveEffectivePublishTimestampMs(b, nowMs) || 0) -
            (resolveEffectivePublishTimestampMs(a, nowMs) || 0);
          if (Math.abs(tDiff) > 5 * 60_000) return tDiff;
          return scoreClusterLeadQuality(b) - scoreClusterLeadQuality(a);
        });
      } else if (cl.sagaInfo?.isSaga) {
        uniqueRelated.sort((a, b) => {
          const sA = analyzePlayerTransactionSaga(a, rosterPlayersForGroup, ctx?.teamConfig || null);
          const sB = analyzePlayerTransactionSaga(b, rosterPlayersForGroup, ctx?.teamConfig || null);
          const stageDiff = (sB.subStage || 0) - (sA.subStage || 0);
          if (Math.abs(stageDiff) >= 0.4) return stageDiff;
          const qDiff = scoreClusterLeadQuality(b, sB) - scoreClusterLeadQuality(a, sA);
          if (Math.abs(qDiff) >= 6) return qDiff;
          return (
            (resolveEffectivePublishTimestampMs(b, nowMs) || 0) -
            (resolveEffectivePublishTimestampMs(a, nowMs) || 0)
          );
        });
      } else {
        uniqueRelated.sort((a, b) => scoreClusterLeadQuality(b) - scoreClusterLeadQuality(a));
      }
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
        !lead.isStalePreGameAvailability &&
        !cl.sagaInfo?.isSpeculative &&
        (isUrgentBreakingBadge(lead.breakingBadge) ||
          lead.storyTier === 'tier1_major' ||
          lead.storyTier === 'tier2_roster' ||
          lead.category === 'injury' ||
          lead.category === 'roster' ||
          /::(ir_roster_move|diagnostic_result|diagnostic_scheduled|diagnostic_imaging|recovery_timeline|in_game_injury_status|weekly_injury_report|trade_acquisition|contract_restructure|practice_return_hope|cb_roster_moves_positive|fa_signing|fa_visit|fa_waiver_market|roster_departure)(?:::[a-z]+)?$/.test(
            cl.sigKey || ''
          ));
      lead.clusterKind = isBreakingCorroboration ? 'corroboration' : 'similar';
      lead._isLowSalienceRoundupCluster = isLowSalienceRoundup;

      const leadMs = resolveEffectivePublishTimestampMs(lead, nowMs);
      const leadAge = Number.isFinite(leadMs) ? Math.max(0, (nowMs - leadMs) / 3_600_000) : 24;
      const oldestAge = cl.oldestMs ? Math.max(0, (nowMs - cl.oldestMs) / 3_600_000) : leadAge;
      const newestAge = cl.newestMs ? Math.max(0, (nowMs - cl.newestMs) / 3_600_000) : leadAge;
      // Anchor age rewards fresh multi-source developments (<12h) and immediately refreshes to `newestAge`
      // whenever a material injury or transaction-saga progression supersedes earlier reports, while
      // preventing an old lead (>6h) from resetting to 0h on minor follow-ups AND preventing a genuinely
      // fresh lead (<=6h) from being dragged backward 20h+ by an older clustered roundup!
      lead._clusterNewestAgeHours = newestAge;
      lead._clusterAnchorAgeHours =
        cl.hasInjuryProgressionAdvance || cl.hasSagaProgressionAdvance
          ? Math.min(leadAge, newestAge)
          : oldestAge > 14
            ? leadAge <= 6
              ? Math.min(Math.max(leadAge, newestAge) + 2, 0.7 * leadAge + 0.3 * oldestAge)
              : Math.max(leadAge, oldestAge * 0.6)
            : 0.4 * leadAge + 0.6 * newestAge;
      const priorStoryRank = Number.isFinite(Number(lead.storyRank)) ? Number(lead.storyRank) : 0;
      const recomputedRank = computeWireStoryRank(lead, nowMs, ctx);
      const baseRank = isLowSalienceRoundup
        ? Math.min(priorStoryRank || recomputedRank, recomputedRank)
        : ctx
          ? recomputedRank
          : Math.max(priorStoryRank, recomputedRank);
      lead.storyRank = cl._sagaSupersededMultiplier
        ? Number((baseRank * cl._sagaSupersededMultiplier).toFixed(4))
        : baseRank;
    } else if (cl._sagaSupersededMultiplier && Number.isFinite(Number(lead.storyRank))) {
      lead.storyRank = Number((Number(lead.storyRank) * cl._sagaSupersededMultiplier).toFixed(4));
    }
    return lead;
  });

  // Final per-player injury enforcement so any older/distinct unmerged injury card for a player
  // who already has a newer breaking injury cluster has its breaking status stripped & demoted!
  const enforcedFinalized = enforceSingleBreakingInjuryPerPlayer(finalized, {
    nowMs,
    rosterPlayers: rosterPlayersForGroup,
    teamConfig: ctx?.teamConfig || null
  });

  // Re-sort finalized clusters if corroboration velocity elevated a multi-source breaking cluster
  enforcedFinalized.sort((a, b) => {
    const aNeg = (a.breakingPriority || 0) < 0;
    const bNeg = (b.breakingPriority || 0) < 0;
    if (aNeg !== bNeg) return aNeg ? 1 : -1;
    const rDiff = (b.storyRank || 0) - (a.storyRank || 0);
    if (Math.abs(rDiff) >= 0.35) return rDiff;
    const aMs = resolveEffectivePublishTimestampMs(a, nowMs) || 0;
    const bMs = resolveEffectivePublishTimestampMs(b, nowMs) || 0;
    return bMs - aMs;
  });

  return enforcedFinalized;
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
  /(^|\.)(x\.com|twitter\.com|bsky\.app|nitter\.net|nitter\.[a-z]+|xcancel\.com|vxtwitter\.com|fxtwitter\.com|instagram\.com|threads\.net|facebook\.com|tiktok\.com|reddit\.com|t\.me|youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com|open\.spotify\.com|spotify\.com|podcasts\.apple\.com|music\.amazon\.com|megaphone\.fm|art19\.com|soundcloud\.com|omny\.fm|anchor\.fm|overcast\.fm|pocketcasts\.com)$/i;

const NON_ARTICLE_EXTERNAL_PATH_REGEX =
  /^\/(?:video|videos|watch|shorts|clips|podcast|podcasts|episodes|mlb|nba|nhl|wnba|mls|golf|tennis|soccer)(?:\/|$)|\/nfl\/player\/_\/id\/\d+/i;

const BARE_SECTION_ROOT_PATH_REGEX =
  /^\/(?:news|articles|sports|nfl|49ers|san-francisco-49ers|nfl\/san-francisco-49ers|team|roster|schedule|stats|draft|rumors|feed)?\/?$/i;

const BRAND_SOCIAL_HANDLE_SET = new Set([
  '49erswebzone',
  'nfltrade_rumors',
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
  const isSocialOriginLink = uri =>
    /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|bsky\.app)\//i.test(String(uri || '').trim());

  const extEmbed =
    post?.embed?.external ||
    post?.embed?.media?.external ||
    rec?.embed?.external ||
    rec?.embed?.media?.external ||
    null;
  const extEmbedUri = String(extEmbed?.uri || '').trim();
  if (extEmbedUri && !isSocialOriginLink(extEmbedUri)) {
    return {
      uri: extEmbedUri,
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
        return {
          uri,
          title: '',
          description: '',
          thumb: String(extEmbed?.thumb || '').trim()
        };
      }
      if (!fallbackUri && !isSocialOriginLink(uri)) fallbackUri = uri;
    }
  }
  if (extEmbedUri && !fallbackUri) {
    return {
      uri: extEmbedUri,
      title: String(extEmbed.title || '').trim(),
      description: String(extEmbed.description || '').trim(),
      thumb: String(extEmbed.thumb || '').trim()
    };
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
    matchesInGameInjuryOrReturn(strippedTweet) ||
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

  const activeTeamPromo = getActiveTeamConfig();
  const promotedTitle = verdict.cleanTitle || item.title || item.headline || `${activeTeamPromo?.nickname || 'NFL'} Story`;
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

const LINKED_ARTICLE_PUBLISHER_MAP = {
  'espn.com': 'ESPN',
  'es.pn': 'ESPN',
  'nbcsportsbayarea.com': 'NBC Sports Bay Area',
  'nbcsports.com': 'NBC Sports',
  '49ers.com': '49ers.com',
  '49erswebzone.com': '49ers Webzone',
  'ninersnation.com': 'Niners Nation',
  'sfstandard.com': 'The SF Standard',
  'nfl.com': 'NFL.com',
  'on.nfl.com': 'NFL.com',
  'cbssports.com': 'CBS Sports',
  'profootballrumors.com': 'Pro Football Rumors',
  'nfltraderumors.co': 'NFLTradeRumors.co',
  'overthecap.com': 'OverTheCap',
  'spotrac.com': 'Spotrac',
  'si.com': 'Sports Illustrated',
  'ninerswire.usatoday.com': 'Niners Wire',
  'usatoday.com': 'USA Today',
  'knbr.com': 'KNBR',
  'foxsports.com': 'FOX Sports',
  'bleacherreport.com': 'Bleacher Report',
  'sports.yahoo.com': 'Yahoo Sports',
  'yahoo.com': 'Yahoo Sports',
  'theringer.com': 'The Ringer',
  'the33rdteam.com': 'The 33rd Team',
  'sfgate.com': 'SFGATE',
  'sacbee.com': 'Sacramento Bee',
  'pff.com': 'PFF',
  'open.spotify.com': 'Spotify',
  'spotify.com': 'Spotify',
  'podcasts.apple.com': 'Apple Podcasts',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube'
};

const PODCAST_EXTERNAL_HOST_RE =
  /(^|\.)(open\.spotify\.com|spotify\.com|podcasts\.apple\.com|music\.amazon\.com|megaphone\.fm|art19\.com|soundcloud\.com|omny\.fm|anchor\.fm|overcast\.fm|pocketcasts\.com)$/i;

const SOCIAL_ORIGIN_LINK_RE =
  /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|bsky\.app|nitter\.net|nitter\.[a-z]+|xcancel\.com|vxtwitter\.com|fxtwitter\.com)\//i;

const linkedArticleStreamIndexCache = new WeakMap();

function extractArticleStoryKey(rawUrl = '') {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  const espnStory = s.match(/espn\.com\/(?:[^/]+\/)*story\/_\/id\/(\d+)/i);
  if (espnStory) return `espn_story:${espnStory[1]}`;
  return '';
}

function getLinkedArticleStreamIndex(rawStream = []) {
  if (!Array.isArray(rawStream) || rawStream.length === 0) return null;
  if (linkedArticleStreamIndexCache.has(rawStream)) {
    return linkedArticleStreamIndexCache.get(rawStream);
  }
  const byCanonicalUrl = new Map();
  const byStoryKey = new Map();
  const registerArticle = cand => {
    if (!cand || typeof cand !== 'object') return;
    if (cand.type !== 'article' && cand.type !== 'post') return;
    const safeUrl = sanitizeExternalUrl(cand.url, null);
    if (!safeUrl || SOCIAL_ORIGIN_LINK_RE.test(safeUrl)) return;
    const canon = canonicalComparableUrl(safeUrl);
    if (canon && !byCanonicalUrl.has(canon)) byCanonicalUrl.set(canon, cand);
    const storyKey = extractArticleStoryKey(safeUrl);
    if (storyKey && !byStoryKey.has(storyKey)) byStoryKey.set(storyKey, cand);
  };
  for (const it of rawStream) {
    registerArticle(it);
    if (Array.isArray(it?.confirmingReports)) {
      for (const cr of it.confirmingReports) registerArticle(cr);
    }
  }
  const index = { byCanonicalUrl, byStoryKey };
  linkedArticleStreamIndexCache.set(rawStream, index);
  return index;
}

function resolveFriendlyPublisherName(domain = '') {
  const clean = String(domain || '')
    .toLowerCase()
    .replace(/^(?:www|m|amp)\./, '')
    .trim();
  if (!clean) return 'Article';
  if (LINKED_ARTICLE_PUBLISHER_MAP[clean]) return LINKED_ARTICLE_PUBLISHER_MAP[clean];
  for (const [hostKey, label] of Object.entries(LINKED_ARTICLE_PUBLISHER_MAP)) {
    if (clean.endsWith(`.${hostKey}`)) return label;
  }
  return clean;
}

function isMirrorBotDuplicateExternalTitle(extTitle = '', tweetBody = '') {
  const norm = str =>
    cleanTweetTextForArticleComparison(String(str || ''))
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const a = norm(extTitle);
  const b = norm(tweetBody);
  if (!a || !b) return false;
  if (a === b) return true;
  const prefixLen = Math.min(48, a.length, b.length);
  if (prefixLen >= 28 && (a.startsWith(b.slice(0, prefixLen)) || b.startsWith(a.slice(0, prefixLen)))) {
    return true;
  }
  const aTokens = new Set(a.split(' ').filter(w => w.length >= 3));
  const bTokens = new Set(b.split(' ').filter(w => w.length >= 3));
  if (aTokens.size >= 4 && bTokens.size >= 4) {
    let shared = 0;
    for (const w of aTokens) {
      if (bTokens.has(w)) shared += 1;
    }
    const containment = shared / Math.min(aTokens.size, bTokens.size);
    if (containment >= 0.84) return true;
  }
  return false;
}

function extractCreditedStoryBylineFromTweet(rawTweetText = '') {
  const txt = String(rawTweetText || '');
  const m = txt.match(/\b(?:story|article|report|column|more|details)\s+(?:via|by|from)\s+@([A-Za-z0-9_.-]{2,30})\b/i);
  if (!m?.[1]) return '';
  const handleRaw = m[1].replace(/\.bsky\.social$/i, '').trim();
  if (!handleRaw) return '';
  const mappedX =
    BSKY_ACTOR_TO_X_HANDLE[m[1].toLowerCase()] ||
    BSKY_ACTOR_TO_X_HANDLE[`${handleRaw.toLowerCase()}.bsky.social`] ||
    '';
  const rep =
    (mappedX ? resolveReporterFromNameOrHandle(mappedX) : null) ||
    resolveReporterFromNameOrHandle(handleRaw);
  if (rep && !isPodiumSubjectId(rep.id) && rep.id !== '49ers_news') {
    return rep.name;
  }
  return `@${handleRaw}`;
}

/**
 * Resolves a clean, direct-click linked article preview payload for any tweet/social item
 * carrying a free, non-social `externalUrl` — allowing users to click straight to the linked
 * article (e.g. ESPN, NBCSBA, 49ers.com, SF Standard) without hopping through X or Bluesky.
 *
 * Cross-references `rawStream` (by canonical URL or ESPN story ID) to recover the real article
 * headline, publisher, byline, and crisp editorial photo whenever Bluesky mirror bots duplicate
 * the tweet text into `embed.external.title`.
 */
export function resolveTweetLinkedArticlePreview(
  item = null,
  { rawStream = [], resolvedItemUrl = '' } = {}
) {
  if (!item || typeof item !== 'object') return null;
  const isTweet = item.type === 'tweet' || item.type === 'social';
  if (!isTweet) return null;

  // Avoid duplicating a linked card when the tweet already renders an inline playable video player
  const hasPlayableVideo = Boolean(
    item.videoId || item.videoStreamUrl || (item.isHighlightClip && item.externalVideoUrl)
  );
  if (hasPlayableVideo) return null;

  const safeExtUrl = sanitizeExternalUrl(item.externalUrl, null);
  if (!safeExtUrl) return null;
  if (SOCIAL_ORIGIN_LINK_RE.test(safeExtUrl)) return null;
  if (isPaywalledPublisher(item.outletName, safeExtUrl)) return null;
  if (isRedundantProfileSelfLink(safeExtUrl, resolvedItemUrl)) return null;
  if (isRedundantProfileSelfLink(safeExtUrl, item.url)) return null;
  if (resolvedItemUrl && canonicalComparableUrl(safeExtUrl) === canonicalComparableUrl(resolvedItemUrl)) {
    return null;
  }
  if (/\bon X$/i.test(String(item.externalTitle || '').trim())) return null;

  let domain = '';
  try {
    domain = new URL(safeExtUrl).hostname.toLowerCase().replace(/^(?:www|m|amp)\./, '');
  } catch {
    return null;
  }
  if (!domain) return null;

  const publisherName = resolveFriendlyPublisherName(domain);
  const isPodcast = PODCAST_EXTERNAL_HOST_RE.test(domain);
  const isArticle = !isPodcast && isDirectArticleUrl(safeExtUrl);

  const streamIndex = getLinkedArticleStreamIndex(rawStream);
  const matchedArticle = streamIndex
    ? streamIndex.byCanonicalUrl.get(canonicalComparableUrl(safeExtUrl)) ||
      streamIndex.byStoryKey.get(extractArticleStoryKey(safeExtUrl)) ||
      null
    : null;

  const tweetText = formatTweetBodyForDisplay(item.fullText || item.title || item.headline || '').text;
  const rawMatchedTitle = matchedArticle?.title
    ? cleanArticleHeadlineCandidate(String(matchedArticle.title))
    : '';
  const rawExtTitle = item.externalTitle
    ? cleanArticleHeadlineCandidate(
        String(item.externalTitle).replace(/\s*(?:Original post|View original post)\s*$/i, '')
      )
    : '';

  let title = '';
  let titleSource = 'editorial_fallback';
  let byline = '';

  if (rawMatchedTitle.length >= 12) {
    title = rawMatchedTitle;
    titleSource = 'stream_match';
    const matchedAuthor = String(matchedArticle.reporterName || matchedArticle.author || '').trim();
    if (
      matchedAuthor &&
      matchedAuthor.toLowerCase() !== publisherName.toLowerCase() &&
      !BRAND_SOCIAL_NAME_REGEX.test(matchedAuthor)
    ) {
      byline = matchedAuthor;
    }
  } else if (
    rawExtTitle.length >= 10 &&
    !BRAND_SOCIAL_NAME_REGEX.test(rawExtTitle) &&
    !/^https?:\/\//i.test(rawExtTitle) &&
    !isMirrorBotDuplicateExternalTitle(rawExtTitle, tweetText)
  ) {
    title = rawExtTitle;
    titleSource = 'external_title';
  }

  if (!byline) {
    byline = extractCreditedStoryBylineFromTweet(tweetText);
  }

  if (!title) {
    if (isPodcast) {
      title = `Listen to episode on ${publisherName}`;
    } else if (isArticle) {
      title = `Read full story on ${publisherName}`;
    } else {
      title = `Open link on ${publisherName}`;
    }
    titleSource = 'editorial_fallback';
  }

  const matchedEditorialImg = isEditorialPhotoUrl(matchedArticle?.imageUrl)
    ? String(matchedArticle.imageUrl).trim()
    : '';
  const itemEditorialImg = isEditorialPhotoUrl(item.imageUrl) ? String(item.imageUrl).trim() : '';
  const preferMatchedOverBsky =
    Boolean(matchedEditorialImg) && (!itemEditorialImg || itemEditorialImg.includes('cdn.bsky.app'));
  const imageUrl = preferMatchedOverBsky ? matchedEditorialImg : itemEditorialImg || matchedEditorialImg || '';

  return {
    url: safeExtUrl,
    domain,
    publisherName,
    title,
    byline,
    imageUrl,
    isDirectArticle: isArticle,
    isPodcast,
    titleSource
  };
}

/**
 * Formats a tweet's body so short tweets (<= 320 chars) preserve 100% of their full text
 * without mid-sentence truncation, while stripping Bluesky mirror-bot "Original post" boilerplate
 * and trimming very long posts cleanly at a word boundary.
 */
export function formatTweetBodyForDisplay(rawText = '', limit = SHORT_TWEET_FULL_TEXT_LIMIT) {
  const cleaned = decodeHtmlEntities(String(rawText || ''))
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:Original post|View original post)\s*$/i, '')
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

  const umStatusLower = String(upcoming.statusDetail || '').toLowerCase();
  const umCompleted = Boolean(
    upcoming.completed || String(upcoming.liveState || '').toLowerCase() === 'post' || /\bfinal\b/.test(umStatusLower)
  );
  if (!umCompleted && (upcoming.liveState === 'in' || upcoming.isGameInProgress)) {
    return true;
  }

  for (const g of schedule) {
    if (!g || g.isByeWeek || g.opponent?.isTbd || String(g.opponent?.abbr || '').toUpperCase() === 'TBD') {
      continue;
    }
    const statusLower = String(g.statusDetail || '').toLowerCase();
    const stateLower = String(g.statusState || '').toLowerCase();
    if (/\b(postponed|canceled|cancelled)\b/.test(statusLower)) {
      continue;
    }
    const isCompleted = Boolean(g.completed || stateLower === 'post' || /\bfinal\b/.test(statusLower));
    if (isCompleted) {
      // Keep 20s fast wire cadence for 35m right after Final so Shanahan's post-game injury presser lands immediately!
      const compAtMs = g.completedAt ? Date.parse(g.completedAt) : NaN;
      if (Number.isFinite(compAtMs) && nowMs >= compAtMs && nowMs <= compAtMs + 35 * 60_000) {
        return true;
      }
      continue;
    }
    const koMs = g.dateIso ? new Date(g.dateIso).getTime() : NaN;
    const isLiveOrDelayed =
      stateLower === 'in' ||
      Boolean(g.isLive) ||
      /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime|end of (?:1st|2nd|3rd|4th)|delayed|weather delay|lightning delay|suspended)\b/.test(
        statusLower
      );
    if (isLiveOrDelayed && (!Number.isFinite(koMs) || nowMs <= koMs + 10 * 3600_000)) {
      return true;
    }
    if (Number.isFinite(koMs)) {
      if (nowMs >= koMs - 95 * 60_000 && nowMs <= koMs + 5.25 * 3600_000) {
        return true;
      }
    }
  }

  const umOppUpper = String(upcoming.oppAbbr || upcoming.opponent?.abbr || '').toUpperCase();
  const hasMatchedScheduleEntry = schedule.some(g => g && Number(g.week) === Number(upcoming.week));
  if (
    !hasMatchedScheduleEntry &&
    !umCompleted &&
    !upcoming.isByeWeek &&
    !upcoming.isTbd &&
    !upcoming.seasonConcluded &&
    umOppUpper !== 'BYE' &&
    umOppUpper !== 'TBD' &&
    !/\b(postponed|canceled|cancelled)\b/.test(umStatusLower)
  ) {
    const upKoMs =
      upcoming.dateIso || upcoming.kickoffIso
        ? new Date(upcoming.dateIso || upcoming.kickoffIso).getTime()
        : NaN;
    if (Number.isFinite(upKoMs) && nowMs >= upKoMs - 95 * 60_000 && nowMs <= upKoMs + 5.25 * 3600_000) {
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
    /\b(press conference|media availability|speaks to the media|meets with the media|reflects on|chats about|breaks down win|previews week|shares final updates|speak ahead|talk new additions|on first career touchdown|taking on bigger role|you['’]?ve got mail|inside the oval|writing a novel|talks after|postgame press)\b/i.test(
      title
    ) && !/\b(forty niner way|49hours|mic['’]?d up|from the trenches|inside the 49ers locker room)\b/i.test(title);

  const isInlineNativeStreamClip = Boolean(item.videoStreamUrl);
  const isExternalOnlyClubLink = item.embeddable === false && !item.videoStreamUrl && !item.videoId;

  const isPlayerHighlightOrBigPlayClip =
    !isInterviewOrPodium &&
    ((item.mentionedPlayers?.length || 0) > 0 || /\b(best plays|every completed pass|every throw|pick[- ]?6|interceptions?|\btd\b|end zone)\b/i.test(title)) &&
    /\b(highlights|best plays|every completed pass|every throw|every catch|rushing highlights|receiving highlights|pick[- ]?6|interceptions?|touchdowns?|\btd\b|end zone|big catch|sacks?)\b/i.test(
      title
    );

  if (!isInterviewOrPodium && /\b(game highlights|full game highlights|condensed game|end of game|final drive|outlast|back-and-forth thriller)\b/i.test(title)) {
    score += 58;
  } else if (isPlayerHighlightOrBigPlayClip) {
    score += 54;
  } else if (!isInterviewOrPodium && /\b(\bhighlights\b|best plays|every touchdown|top plays)\b/i.test(title)) {
    score += 55;
  } else if (/\b(forty niner way|49hours|brick by brick|mic['’]?d up|inside the 49ers locker room|locker room|victory speech|from the trenches|sights and sounds|wired|postgame recap|week \d+ recap|game recap)\b/i.test(title)) {
    score += 46;
  } else if (isInlineNativeStreamClip && !isInterviewOrPodium && Boolean(item.isHighlightClip)) {
    // Beat reporter & team social highlight clips (e.g. @StatsOnFire 0:44 end-zone highlight) should surface strongly alongside official reels
    score += 48;
  } else if (HIGHLIGHT_AND_TEAM_INTEREST_VIDEO_REGEX.test(title) || SALIENT_INTERVIEW_OR_FEATURE_REGEX.test(title)) {
    score += 24;
  } else if (/\b(preview|talk new additions|speak ahead)\b/i.test(title)) {
    score += 10;
  }

  if (isInlineNativeStreamClip && !isInterviewOrPodium) {
    score += 14;
  }
  if (isInterviewOrPodium) {
    score -= 16;
  }
  if (isExternalOnlyClubLink) {
    score -= 8;
  }

  const activeTeamVid = resolveTeamConfig(ctx?.teamConfig || getActiveTeamConfig());
  const teamFullLower = String(activeTeamVid?.fullName || 'San Francisco 49ers').toLowerCase();
  const clubDomainLower = String(activeTeamVid?.clubDomain || '49ers.com').toLowerCase();
  if (/^nfl$/i.test(channel) || channel.toLowerCase() === teamFullLower || channel.toLowerCase().includes(clubDomainLower)) {
    score += isInterviewOrPodium ? 4 : 12;
  } else if (
    activeTeamVid?.abbr === 'SF'
      ? /nbc sports bay area|espn|fox sports|cbs sports|knbr|forever faithful|san francisco 49ers fans|gold standard|x beat|statsonfire|oursf49ers|coach yac/i.test(channel)
      : /espn|fox sports|cbs sports|nfl network|official|x beat/i.test(channel)
  ) {
    score += 12;
  } else if (isInlineNativeStreamClip && !isInterviewOrPodium) {
    score += 8;
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

  const briefGenMs = dailyBrief.generatedAt ? Date.parse(dailyBrief.generatedAt) : NaN;
  const itemPubMs = resolveEffectivePublishTimestampMs(item, nowMs);
  const coveredStoryKeys = new Set(Array.isArray(dailyBrief.coveredStoryKeys) ? dailyBrief.coveredStoryKeys : []);
  const sigKey = buildStorySignatureKey(item);

  // Never let an older brief's `coveredStoryKeys` or an older pre-brief confirming report suppress
  // a brand-new post-brief material injury update (e.g. confirmed MRI result / "not an ACL" / IR placement / ruled-out escalation published >45m after the brief)!
  const isFreshPostBriefMaterialUpdate =
    Number.isFinite(briefGenMs) &&
    Number.isFinite(itemPubMs) &&
    itemPubMs > briefGenMs + 45 * 60_000 &&
    (computeInjuryProgressionLevel(item) >= 4 ||
      /::(diagnostic_result|ir_roster_move)$/.test(sigKey || ''));

  const itemComparable = canonicalComparableUrl(item.url || '');
  const extComparable = canonicalComparableUrl(item.externalUrl || '');
  if ((itemComparable && coveredUrls.has(itemComparable)) || (extComparable && coveredUrls.has(extComparable))) {
    return true;
  }
  if (!isFreshPostBriefMaterialUpdate) {
    for (const cr of item.confirmingReports || []) {
      const crUrl = canonicalComparableUrl(cr?.url || '');
      if (crUrl && coveredUrls.has(crUrl)) return true;
    }
  }

  if (sigKey && coveredStoryKeys.has(sigKey) && !isFreshPostBriefMaterialUpdate) {
    return true;
  }

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

export function getTeamClockParts(nowMs = Date.now(), timeZone = 'America/Los_Angeles') {
  const safeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/Los_Angeles',
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

export function getPacificClockParts(nowMs = Date.now()) {
  return getTeamClockParts(nowMs, 'America/Los_Angeles');
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
  const um = appData?.scheduleMatchup?.upcomingMatchup;
  const umWeek = Number(um?.week || 0) || null;
  const umOpp = String(um?.oppAbbr || '').toUpperCase();
  const umStatusDetail = String(um?.statusDetail || '').trim();
  const umLiveState = String(um?.liveState || '').toLowerCase();

  const out = [];
  const seenKeys = new Set();

  for (const g of rawSched) {
    if (!g || g.isByeWeek || g.opponent?.isTbd || String(g.opponent?.abbr || '').toUpperCase() === 'TBD') continue;
    if (/\b(postponed|canceled|cancelled)\b/i.test(String(g.statusDetail || ''))) continue;
    const koIso = g.dateIso || g.kickoffIso || '';
    const koMs = koIso ? Date.parse(koIso) : NaN;
    if (!Number.isFinite(koMs)) continue;
    const st = String(g.seasonType || 'REG').toUpperCase();
    const wk = Number(g.week || 0);
    const key = `${st}:${wk}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    // Merge freshest live flags from `upcomingMatchup` if it matches this scheduled week
    let effectiveGame = g;
    if (um && umWeek && wk === umWeek && st === 'REG') {
      const mergedCompleted = Boolean(
        g.completed ||
          String(g.statusState || '').toLowerCase() === 'post' ||
          /\bfinal\b/i.test(String(g.statusDetail || '')) ||
          um.completed ||
          umLiveState === 'post' ||
          /\bfinal\b/i.test(umStatusDetail)
      );
      const mergedState = mergedCompleted
        ? 'post'
        : g.statusState === 'in' || g.isLive || umLiveState === 'in' || um.isGameInProgress
          ? 'in'
          : g.statusState || umLiveState || '';
      effectiveGame = {
        ...g,
        completed: mergedCompleted,
        statusState: mergedState,
        isLive: Boolean(g.isLive || um.isGameInProgress || mergedState === 'in'),
        statusDetail: g.statusDetail || umStatusDetail || (um.isGameInProgress ? 'In Progress' : ''),
        completedAt: g.completedAt || um.completedAt || undefined
      };
    }
    out.push({ game: effectiveGame, koMs, key });
  }

  if (
    um &&
    umOpp &&
    umOpp !== 'BYE' &&
    umOpp !== 'TBD' &&
    !um.isTbd &&
    !um.seasonConcluded &&
    !/\b(postponed|canceled|cancelled)\b/i.test(umStatusDetail)
  ) {
    const umIso = um.dateIso || um.kickoffIso || '';
    const umKoMs = umIso ? Date.parse(umIso) : NaN;
    const umKey = `REG:${Number(um.week || 0)}`;
    if (Number.isFinite(umKoMs) && !seenKeys.has(umKey)) {
      out.push({
        game: {
          week: Number(um.week || appData?.meta?.currentWeek || 1),
          seasonType: 'REG',
          dateIso: umIso,
          completed: Boolean(um.completed || umLiveState === 'post' || /\bfinal\b/i.test(umStatusDetail)),
          statusState: umLiveState || (um.isGameInProgress ? 'in' : 'pre'),
          isLive: Boolean(um.isGameInProgress || umLiveState === 'in'),
          statusDetail: umStatusDetail || (um.isGameInProgress ? 'In Progress' : ''),
          completedAt: um.completedAt || undefined,
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
  const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
  const teamTz = activeTeam.timezone || 'America/Los_Angeles';
  const tzSuffix =
    teamTz === 'America/Los_Angeles'
      ? 'PT'
      : /New_York|Detroit|Indiana/i.test(teamTz)
        ? 'ET'
        : /Chicago/i.test(teamTz)
          ? 'CT'
          : 'MT';
  const { dateKey: todayPt, hour24: hourPt } = getTeamClockParts(ts, teamTz);
  const prevDayAnchorMs = ts - (hourPt + 3) * 3_600_000;
  const { dateKey: prevDatePt } = getTeamClockParts(prevDayAnchorMs, teamTz);

  const fallbackCycleKey =
    hourPt >= peakHourPt ? `${todayPt}@${peakHourPt}${tzSuffix}` : `${prevDatePt}@${peakHourPt}${tzSuffix}`;

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
    const gameDatePt = getTeamClockParts(koMs, teamTz).dateKey;
    const slug = formatGameBriefCycleSlug(game);
    const postGameCycleKey = `${gameDatePt}@postgame-${slug}`;
    const statusStr = String(game.statusDetail || '');
    const stateLower = String(game.statusState || '').toLowerCase();
    const completedFlag = Boolean(game.completed) || stateLower === 'post' || /\bfinal\b/i.test(statusStr);
    const completedAtMs = game.completedAt ? Date.parse(game.completedAt) : NaN;
    const isLiveStatus =
      !completedFlag &&
      (stateLower === 'in' ||
        Boolean(game.isLive) ||
        /\b(q[1-4]|1st|2nd|3rd|4th|halftime|in progress|ot|overtime|end of (?:1st|2nd|3rd|4th)|delayed|weather delay|lightning delay|suspended)\b/i.test(
          statusStr
        ));

    // Anchor post-game stream count to actual `completedAtMs` when known so OT/Q4 tweets never bypass the post-whistle buffer!
    const postGameFloorMs = Number.isFinite(completedAtMs) ? completedAtMs - 2 * 60_000 : koMs + 2.4 * 3600_000;
    let postGameStreamCount = 0;
    for (const it of rawStream) {
      const pMs = resolveEffectivePublishTimestampMs(it, ts);
      if (Number.isFinite(pMs) && pMs >= postGameFloorMs) {
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
    const { hour24: gHour } = getTeamClockParts(gameKoMs, teamTz);
    const priorAnchorMs = gameKoMs - (gHour + 3) * 3_600_000;
    const priorDatePt = getTeamClockParts(priorAnchorMs, teamTz).dateKey;
    const priorGame = evaluated.find(e => e.gameDatePt === priorDatePt && e.koMs < gameKoMs);
    if (priorGame) return priorGame.postGameCycleKey;
    return `${priorDatePt}@${peakHourPt}${tzSuffix}`;
  };

  // 1. Check if a game is scheduled today (or currently in its live/OT/delayed post-whistle window across midnight PT)
  const activeOrTodayGame = evaluated.find(
    e =>
      e.gameDatePt === todayPt ||
      (ts >= e.koMs - GAME_DAY_ABOVE_BRIEF_LEAD_MS && ts <= e.koMs + 10.5 * 3600_000 && !e.isPostGameReady)
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

  // Resolve the brief's Pacific cycle weekday (`0=Sun..6=Sat`) from `cycleKey` (preferred) or `generatedAt`.
  // Practice-report supersession MUST ONLY heal a brief from THAT SAME practice day's cycle that was built
  // before the live practice report hydrated — NEVER prematurely wipe Wednesday's brief on Thursday afternoon
  // or Thursday's brief on Friday afternoon (before 5:00 PM PT), and NEVER falsely invalidate Saturday's brief
  // on Saturday night or Sunday morning!
  let briefCycleDow = -1;
  const cycleDateMatch = String(brief.cycleKey || '').match(/^(\d{4})-(\d{2})-(\d{2})@/);
  if (cycleDateMatch) {
    const [, cy, cm, cd] = cycleDateMatch;
    briefCycleDow = new Date(Date.UTC(Number(cy), Number(cm) - 1, Number(cd), 19, 0, 0)).getUTCDay();
  } else if (brief.generatedAt) {
    const genMsForDow = Date.parse(brief.generatedAt);
    if (Number.isFinite(genMsForDow)) {
      const genDateKey = getPacificClockParts(genMsForDow).dateKey;
      const gMatch = String(genDateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (gMatch) {
        briefCycleDow = new Date(
          Date.UTC(Number(gMatch[1]), Number(gMatch[2]) - 1, Number(gMatch[3]), 19, 0, 0)
        ).getUTCDay();
      }
    }
  }

  // Check midweek / Friday practice-report supersession strictly on same-day unhydrated briefs
  const prRows = Array.isArray(appData?.health?.practiceReport) ? appData.health.practiceReport : [];
  const hasRealFridayPractice = prRows.some(
    r => r && r.fri && r.fri !== '-' && !/^vet\s*rest$/i.test(String(r.fri).trim())
  );
  const hasRealThursdayPractice = prRows.some(
    r => r && r.thu && r.thu !== '-' && !/^vet\s*rest$/i.test(String(r.thu).trim())
  );
  const hadFridayAtGen = brief?.practiceReportCoverage?.hasFri === true;
  const hadThursdayAtGen = brief?.practiceReportCoverage?.hasThu === true;

  if (hasRealFridayPractice && !brief.isPostGame && briefCycleDow === 5 && !hadFridayAtGen) {
    const citesWedOrThuPractice =
      /\b(?:wednesday|thursday)(?:['’]s)?\s+practice(?:\s+(?:report|participation|session))?|\b(?:missed|limited\s+(?:in|at|on|by)|sat\s+out)\s+(?:wednesday|thursday)\b/i.test(
        fullBriefProse
      );
    const mentionsFriday = /\bfriday\b/i.test(fullBriefProse);
    const mentionsFinalGameStatus =
      /\b(?:final\s+injury\s+report|game[- ]time\s+decision|questionable|doubtful|ruled\s+out\s+for\s+(?:sunday|monday|thursday|saturday|week\s+\d+)|out\s+for\s+(?:sunday|monday|thursday|saturday)|cleared\s+to\s+play|activated\s+from\s+(?:ir|injured\s+reserve))\b/i.test(
        fullBriefProse
      );
    if (citesWedOrThuPractice && !mentionsFriday && !mentionsFinalGameStatus) {
      return true;
    }
  } else if (
    hasRealThursdayPractice &&
    !hasRealFridayPractice &&
    !brief.isPostGame &&
    briefCycleDow === 4 &&
    !hadThursdayAtGen
  ) {
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

  // Find the most recent game that has already completed (or passed kickoff + 5.5h when NOT live/delayed) within the last 42h
  let recentFinished = null;
  for (const entry of games) {
    const stDetail = String(entry.game.statusDetail || '');
    const stState = String(entry.game.statusState || '').toLowerCase();
    const isStillLiveOrDelayed =
      !entry.game.completed &&
      stState !== 'post' &&
      !/\bfinal\b/i.test(stDetail) &&
      (stState === 'in' ||
        Boolean(entry.game.isLive) ||
        /\b(1st|2nd|3rd|4th|q[1-4]|halftime|in progress|ot|overtime|delayed|weather delay|lightning delay|suspended)\b/i.test(
          stDetail
        ));
    const completedFlag =
      Boolean(entry.game.completed) ||
      stState === 'post' ||
      /\bfinal\b/i.test(stDetail) ||
      (!isStillLiveOrDelayed && ts >= entry.koMs + 5.5 * 3600_000);
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
  const statusStr = String(game.statusDetail || '');
  const stateLower = String(game.statusState || '').toLowerCase();
  const completedFlag = Boolean(game.completed) || stateLower === 'post' || /\bfinal\b/i.test(statusStr);
  const isExplicitLive =
    !completedFlag &&
    (stateLower === 'in' ||
      Boolean(game.isLive) ||
      /\b(q[1-4]|1st|2nd|3rd|4th|halftime|in progress|ot|overtime|end of (?:1st|2nd|3rd|4th))\b/i.test(statusStr));
  const isDelayed = !completedFlag && !isExplicitLive && /\b(delayed|weather delay|lightning delay|suspended)\b/i.test(statusStr);

  const phaseLabel = isExplicitLive
    ? /\b(ot|overtime)\b/i.test(statusStr)
      ? 'Overtime Live Wire'
      : 'Live In-Game Wire'
    : isDelayed
      ? 'Delayed Kickoff • Live Wire'
      : completedFlag
        ? 'Post-Game Live Wire'
        : ts < koMs
          ? 'Pre-Game Inactives & Warmups'
          : ts >= koMs + 3.4 * 3600_000
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
 * - Standard Mode: Active urgent breaking news (`BREAKING`, `LIVE INJURY UPDATE`)
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

  const rosterPlayersForDedup = Array.isArray(appData?.roster?.players) ? appData.roster.players : [];
  const normalizedItems = enforceSingleBreakingInjuryPerPlayer(items, {
    nowMs,
    rosterPlayers: rosterPlayersForDedup
  });

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

    for (const item of normalizedItems) {
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

    const rosterPlayersForSort = rosterPlayersForDedup;
    const resolveGdInjuryTierAndScore = it => {
      const isUrgInj = Boolean(it?.isInGameInjury && isUrgentBreakingBadge(it?.breakingBadge));
      const isUrgOther = !isUrgInj && isUrgentBreakingBadge(it?.breakingBadge);
      const isNonUrgInj = Boolean(it?.isInGameInjury && !isUrgInj);
      const bucket = isUrgInj ? 3 : isUrgOther ? 2 : isNonUrgInj ? 1 : 0;
      const ms = resolveClusterLatestTimestampMs(it, nowMs) || 0;
      if (bucket === 3 || bucket === 1) {
        const impact = Number.isFinite(Number(it?.injuryImpactScore))
          ? Number(it.injuryImpactScore)
          : computeInGameInjuryPriority(it, rosterPlayersForSort).impactScore;
        const ageH = ms > 0 ? Math.max(0, (nowMs - ms) / 3_600_000) : 0;
        // Severity × Player Value dominates (0..100 pts), with gentle recency decay (18 pts/hr)
        return { bucket, score: impact * 100 - ageH * 18, ms };
      }
      return { bucket, score: 0, ms };
    };

    breakingAboveBrief.sort((a, b) => {
      const aMeta = resolveGdInjuryTierAndScore(a);
      const bMeta = resolveGdInjuryTierAndScore(b);
      if (aMeta.bucket !== bMeta.bucket) return bMeta.bucket - aMeta.bucket;
      if ((aMeta.bucket === 3 || aMeta.bucket === 1) && Math.abs(bMeta.score - aMeta.score) >= 0.5) {
        return bMeta.score - aMeta.score;
      }
      return bMeta.ms - aMeta.ms;
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

  for (const item of normalizedItems) {
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

const WIRE_SUMMARY_ABBREV_RE =
  /(?:\b(?:Dr|Mr|Mrs|Ms|Jr|Sr|St|No|Vs|Jan|Feb|Mar|Apr|Aug|Sept|Oct|Nov|Dec|Colo|Calif|Tex|Fla|Minn|Wash|Ariz|Ill|Pa|Ga|La|Mo|Nev|Tenn|Mass|Mich|Wis|Ind|Ky|Va|Md|Conn|Okla|Ore|Ark|Kan|Neb|Utah|Idaho|Mont|Wyo|Ala|Miss|S\.C|N\.C|D\.C|U\.S|a\.m|p\.m|etc)|\b[A-Z])\.$/i;

function normalizeWireSummarySpacing(rawText = '') {
  return String(rawText || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\b(49ers|Niners|[A-Za-z]+s)\s+['’](?=\s|$)/g, "$1'")
    .replace(/\s+['’]s\b/g, "'s")
    .trim();
}

function findCleanSentenceEndIndex(text = '', minIdx = 140, maxIdx = 320) {
  let best = -1;
  const upper = Math.min(text.length, maxIdx);
  for (let i = Math.max(0, minIdx); i < upper; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    let endPos = i + 1;
    while (endPos < text.length && /["”'’)\]]/.test(text[endPos])) endPos += 1;
    if (endPos < text.length && !/\s/.test(text[endPos])) continue;
    if (ch === '.') {
      const prefix = text.slice(Math.max(0, i - 12), i + 1);
      if (WIRE_SUMMARY_ABBREV_RE.test(prefix)) continue;
    }
    if (endPos <= maxIdx) {
      best = endPos;
    }
  }
  return best;
}

/**
 * Produces a clean, sentence- or word-bounded excerpt from raw wire/article text so full-length
 * external articles (e.g., 6,000+ char ESPN story bodies from the player-news API) never bloat
 * feed cards or misclassify unrelated topics.
 */
export function buildBoundedWireSummary(rawText = '', maxChars = WIRE_ARTICLE_EXCERPT_MAX_CHARS) {
  const clean = normalizeWireSummarySpacing(rawText);
  if (!clean) return '';
  const limit = Math.max(80, Number(maxChars) || WIRE_ARTICLE_EXCERPT_MAX_CHARS);
  if (clean.length <= limit) return clean;

  const sentenceEnd = findCleanSentenceEndIndex(clean, Math.floor(limit * 0.52), limit);
  if (sentenceEnd > 0) {
    return clean.slice(0, sentenceEnd).trim();
  }

  let cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= Math.floor(limit * 0.55)) {
    cut = cut.slice(0, lastSpace);
  }
  cut = cut.replace(/[,;:\-—–(\s]+$/, '').trim();
  return cut ? `${cut}…` : `${clean.slice(0, limit - 1).trim()}…`;
}

/**
 * Splits an unusually long feed-card summary (>450 chars — <2% of normal wire items) into a clean
 * collapsed preview + full text for progressive-disclosure "Show more" / "Show less" expansion.
 */
export function splitSummaryForExpandableDisplay(
  summary = '',
  {
    expandThreshold = WIRE_SUMMARY_EXPAND_THRESHOLD,
    previewMax = WIRE_SUMMARY_PREVIEW_MAX,
    minHiddenChars = 60
  } = {}
) {
  const fullText = normalizeWireSummarySpacing(summary);
  if (!fullText || fullText.length <= expandThreshold) {
    return {
      isTruncated: false,
      previewText: fullText,
      fullText,
      endsAtSentence: true
    };
  }

  const sentenceEnd = findCleanSentenceEndIndex(
    fullText,
    Math.floor(previewMax * 0.62),
    Math.min(fullText.length - minHiddenChars, previewMax + 25)
  );
  if (sentenceEnd > 0 && fullText.length - sentenceEnd >= minHiddenChars) {
    return {
      isTruncated: true,
      previewText: fullText.slice(0, sentenceEnd).trim(),
      fullText,
      endsAtSentence: true
    };
  }

  let cut = fullText.slice(0, previewMax);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= Math.floor(previewMax * 0.6)) {
    cut = cut.slice(0, lastSpace);
  }
  cut = cut.replace(/[,;:\-—–(\s]+$/, '').trim();
  if (!cut || fullText.length - cut.length < minHiddenChars) {
    return {
      isTruncated: false,
      previewText: fullText,
      fullText,
      endsAtSentence: true
    };
  }

  return {
    isTruncated: true,
    previewText: `${cut}…`,
    fullText,
    endsAtSentence: false
  };
}

/**
 * Self-heals cached or ingested external article items whose `summary` accidentally contains an
 * entire multi-thousand-character article body (e.g., ESPN `/nfl/story/_/id/...` entries fetched via
 * the player-news API), preserving legitimate RotoWire/beat player blurbs (<=900 chars).
 */
export function sanitizeOversizedDirectArticleSummary(item = {}) {
  if (!item || typeof item !== 'object' || !item.summary) return item;
  const rawSummary = String(item.summary || '').trim();
  if (!rawSummary) return item;

  const url = String(item.url || '').trim();
  const isDirectEspnStory =
    /\/nfl\/story\/_\/id\/\d+/i.test(url) &&
    (item.wireSource === 'espn_player_wire' || String(item.id || '').startsWith('espn_pwire_'));
  const isRunawayArticleDump =
    item.type !== 'tweet' &&
    item.type !== 'social' &&
    rawSummary.length > 1200 &&
    /^https?:\/\//i.test(url) &&
    !/\/nfl\/player\/_\/id\//i.test(url);

  if ((!isDirectEspnStory || rawSummary.length <= 360) && !isRunawayArticleDump) {
    return item;
  }

  const boundedSummary = buildBoundedWireSummary(rawSummary, WIRE_ARTICLE_EXCERPT_MAX_CHARS);
  const next = {
    ...item,
    summary: boundedSummary
  };
  if (next.category === 'film') {
    next.category = classifyNewsItemCategory(next);
  }
  return next;
}

export { buildStorySignatureKey };

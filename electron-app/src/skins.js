// How the avatar looks: which character (a portrait plus a set of voice lines)
// and how big. Pure data and pure functions — no Electron imports — so this file
// loads in the main process, in the renderer, and under plain `node --test`.
// Both processes need the size maths, so it lives here rather than being
// duplicated on each side of the IPC boundary.
//
// Every skin declares five line pools, one per moment the widget speaks:
//
//   working   a task started            sound only (the balloon writes "Working on …")
//   ack       a prompt was answered     sound + text
//   complete  a task finished           sound + text
//   prompt    a question or permission  sound + text
//   error     something went wrong      sound only (the balloon shows the caller's message)
//
// `working` and `ack` share their files: both mean "starting work", and only the
// second one shows text. `error` reuses the question lines the same way.

const DEFAULT_SKIN = 'footman';

// The Footman's pools reproduce the original hardcoded behaviour exactly,
// weights included — the first line of each pair is three times as likely.
const FOOTMAN_ACK = [
  { file: 'as-you-wish.mp3', text: 'As you wish!', weight: 3 },
  { file: 'at-your-service.mp3', text: 'At your service!', weight: 1 },
];

const FOOTMAN_PROMPT = [
  { file: 'my-lord.mp3', text: 'My Lord?', weight: 3 },
  { file: 'your-command.mp3', text: 'Your command?', weight: 1 },
];

// The knight and peasant lines are transcribed from their filenames. Their
// annoyed lines ("Don't push it, buddy!", "Leave me alone!") sit in the same
// pools as the polite ones, at equal weight.
const KNIGHT_ACTION = [
  { file: 'action-atyourservice.wav', text: 'At your service.' },
  { file: 'action-defending.wav', text: 'Defending the realm!' },
  { file: 'action-dontpushit.wav', text: "Don't push it, buddy!" },
  { file: 'action-fortheking.wav', text: 'For the King!' },
  { file: 'action-inyourname.wav', text: 'In your name!' },
  { file: 'action-ofcourse.wav', text: 'Of course!' },
  { file: 'action-verywell.wav', text: 'Very well!' },
  { file: 'action-wemove.wav', text: 'We move!' },
];

const KNIGHT_QUESTION = [
  { file: 'question-growingimpatient.wav', text: "I'm growing impatient!" },
  { file: 'question-makeitquick.wav', text: 'Make it quick!' },
  { file: 'question-sire.wav', text: 'Sire?' },
  { file: 'question-whatho.wav', text: 'What ho?' },
  { file: 'question-yes.wav', text: 'Yes?' },
  { file: 'question-yourmajesty.wav', text: 'Your Majesty?' },
];

const PEASANT_ACTION = [
  { file: 'action-alright.wav', text: 'Alright.' },
  { file: 'action-dont.wav', text: "Don't you have something better to do?" },
  { file: 'action-leave.wav', text: 'Leave me alone!' },
  { file: 'action-okay.wav', text: 'Okay.' },
  { file: 'action-righto.wav', text: 'Righto!' },
  { file: 'action-uhuh.wav', text: 'Uh-huh.' },
  { file: 'action-yes.wav', text: 'Yes!' },
];

const PEASANT_QUESTION = [
  { file: 'question-hello.wav', text: 'Hello?' },
  { file: 'question-milord.wav', text: "M'lord?" },
  { file: 'question-oh-what.wav', text: 'Ohh, what?!' },
  { file: 'question-what.wav', text: 'What?' },
  { file: 'question-yes.wav', text: 'Yes?' },
];

// The peon and goblin sapper lines are transcribed the same way. A handful of
// the peon's are guesses at slurred orcish ("Swobu.", "Uuuuuh?") — they say what
// the clip sounds like, which is all a transcript is here.
const PEON_ACTION = [
  { file: 'action-dabu.wav', text: 'Dabu!' },
  { file: 'action-funny-tummy.wav', text: 'I got a funny tummy!' },
  { file: 'action-lothar.wav', text: 'Lothar!' },
  { file: 'action-swobu.wav', text: 'Swobu.' },
  { file: 'action-tickles.wav', text: 'That tickles!' },
  { file: 'action-you.wav', text: 'You... you...!' },
  { file: 'action-z.wav', text: 'Zug zug!' },
];

const PEON_QUESTION = [
  { file: 'question-attacked.wav', text: "We're under attack!" },
  { file: 'question-lookout.wav', text: 'Look out!' },
  { file: 'question-twobwe.wav', text: 'Trouble?' },
  { file: 'question-ugh.wav', text: 'Ugh?' },
  { file: 'question-uuuuuh.wav', text: 'Uuuuuh?' },
  { file: 'question-what.wav', text: 'What?' },
];

const SAPPER_ACTION = [
  { file: 'action-alright.wav', text: 'Alright!' },
  { file: 'action-certainly.wav', text: 'Certainly!' },
  { file: 'action-okay.wav', text: 'Okay!' },
  { file: 'action-yesboss.wav', text: 'Yes, boss!' },
];

const SAPPER_QUESTION = [
  { file: 'question-kaboom.wav', text: 'Kaboom?' },
  { file: 'question-what.wav', text: 'What?' },
  { file: 'question-whoisit.wav', text: 'Who is it?' },
  { file: 'question-yes.wav', text: 'Yes?' },
];

const SKINS = {
  footman: {
    name: 'Footman',
    dir: 'footman',
    portrait: 'portrait.jpg',
    lines: {
      working: [
        { file: 'at-once-sire.mp3', weight: 3 },
        { file: 'yes-my-lord.mp3', weight: 1 },
      ],
      ack: FOOTMAN_ACK,
      complete: [
        { file: 'work-completed.mp3', text: 'Work complete!', weight: 3 },
        { file: 'work-completed.mp3', text: 'It is done, my Lord!', weight: 1 },
      ],
      prompt: FOOTMAN_PROMPT,
      error: [{ file: 'my-lord.mp3' }],
    },
  },

  knight: {
    name: 'Knight',
    dir: 'knight',
    portrait: 'portrait.webp',
    lines: {
      working: KNIGHT_ACTION,
      ack: KNIGHT_ACTION,
      complete: [
        { file: 'completed-dontforce.wav', text: "Don't force me to hurt ya!" },
        { file: 'completed-gimmeaquest.wav', text: 'Give me a quest!' },
        { file: 'completed-imalive.wav', text: "I'm alive!" },
        { file: 'completed-ineedorders.wav', text: 'I need orders!' },
        { file: 'completed-ready.wav', text: 'Ready to serve!' },
      ],
      prompt: KNIGHT_QUESTION,
      error: KNIGHT_QUESTION,
    },
  },

  peasant: {
    name: 'Peasant',
    dir: 'peasant',
    portrait: 'portrait.webp',
    lines: {
      working: PEASANT_ACTION,
      ack: PEASANT_ACTION,
      complete: [
        { file: 'completed-jobdone.wav', text: "Job's done!" },
        { file: 'completed-morework.wav', text: 'More work?' },
        { file: 'completed-not.wav', text: "I'm not doing that!" },
        { file: 'completed-nowwhat.wav', text: 'Now what?' },
        { file: 'completed-ready.wav', text: 'Ready to work!' },
      ],
      prompt: PEASANT_QUESTION,
      error: PEASANT_QUESTION,
    },
  },

  peon: {
    name: 'Peon',
    dir: 'peon',
    portrait: 'portrait.jpg',
    lines: {
      working: PEON_ACTION,
      ack: PEON_ACTION,
      complete: [
        { file: 'completed-burp.wav', text: '*burp*' },
        { file: 'completed-death.wav', text: 'Aaaargh!' },
        { file: 'completed-missed.wav', text: 'You missed me!' },
        { file: 'completed-ready.wav', text: 'Ready to work!' },
        { file: 'completed-uhuhuh.wav', text: 'Uh-uh-uh!' },
        { file: 'completed-workcomplete.wav', text: 'Work complete!' },
      ],
      prompt: PEON_QUESTION,
      error: PEON_QUESTION,
    },
  },

  'goblin-sapper': {
    name: 'Goblin Sapper',
    dir: 'goblin-sapper',
    portrait: 'portrait.webp',
    lines: {
      working: SAPPER_ACTION,
      ack: SAPPER_ACTION,
      complete: [
        { file: 'completed-beautiful.wav', text: 'Beautiful!' },
        { file: 'completed-explosives.wav', text: 'I love explosives!' },
        { file: 'completed-kaboom.wav', text: 'Kaboom!' },
        { file: 'completed-ready.wav', text: 'Ready to blow!' },
      ],
      prompt: SAPPER_QUESTION,
      error: SAPPER_QUESTION,
    },
  },
};

// Pools that carry no balloon text — the balloon writes its own copy for these.
// `complete` keeps its transcripts even though the balloon now writes plain
// wording for completions: they document what each clip actually says, which is
// what you need when correcting one.
const SOUND_ONLY_ACTIONS = ['working', 'error'];

// ---- Size -------------------------------------------------------------------
// The avatar can be shown at 1×, 2× or 3×. The window layout is built around a
// 64px portrait beside a fixed-width balloon, so every step up adds exactly the
// extra portrait pixels to the window in each direction.
const SCALES = [1, 2, 3];
const DEFAULT_SCALE = 1;
const BASE_AVATAR = 64;
const BASE_WIDTH = 380;
const BASE_HEIGHT = 180;

function avatarSize(scale) {
  return BASE_AVATAR * scale;
}

// The window's resting footprint at a given scale — the size it returns to when
// no balloon is showing.
function windowSizeFor(scale) {
  const extra = BASE_AVATAR * (scale - 1);
  return { width: BASE_WIDTH + extra, height: BASE_HEIGHT + extra };
}

// Resolve the scale to use, on the same precedence as the skin. A value that
// isn't one of the offered steps is ignored rather than trusted — a 12× avatar
// would cover the screen with no obvious way back.
function resolveScale(envValue, configValue) {
  for (const candidate of [envValue, configValue]) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const scale = Number(candidate);
    if (SCALES.includes(scale)) return scale;
    console.warn(`Unsupported scale "${candidate}", falling back to ${DEFAULT_SCALE}×`);
  }
  return DEFAULT_SCALE;
}

// Resolve the skin to use. The environment wins over the config file so a
// one-off launch can override the persisted choice; anything unrecognised
// falls back to the Footman rather than leaving the widget mute.
function resolveSkin(envValue, configValue) {
  for (const candidate of [envValue, configValue]) {
    if (!candidate) continue;
    if (SKINS[candidate]) return candidate;
    console.warn(`Unknown skin "${candidate}", falling back to ${DEFAULT_SKIN}`);
  }
  return DEFAULT_SKIN;
}

// Pick a weighted-random line from a skin's pool for an action. Lines without
// an explicit weight count as 1.
function pickLine(skinId, action) {
  const skin = SKINS[skinId] || SKINS[DEFAULT_SKIN];
  const lines = (skin.lines && skin.lines[action]) || [];
  const total = lines.reduce((sum, l) => sum + (l.weight || 1), 0);
  let r = Math.random() * total;
  for (const line of lines) {
    r -= line.weight || 1;
    if (r < 0) return line;
  }
  return lines[0] || {};
}

module.exports = {
  SKINS, DEFAULT_SKIN, SOUND_ONLY_ACTIONS, resolveSkin, pickLine,
  SCALES, DEFAULT_SCALE, avatarSize, windowSizeFor, resolveScale,
};

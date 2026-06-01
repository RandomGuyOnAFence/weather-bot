// ============================================================
// DEPENDENCIES
// ============================================================
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

// ============================================================
// CONFIG
// ============================================================
const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

// ============================================================
// CONSTANTS (MATCH WEB EXACTLY)
// ============================================================
const SEED = -1753269629;
const NOISE_FACTOR = 0.00018;
const STEP_SECONDS = 600; // 10 min like web version

// ============================================================
// PERLIN NOISE (UNCHANGED)
// ============================================================
const permutation = [
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,
  142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,
  203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
  74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,
  220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,
  132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,
  186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,
  59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,
  70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,
  178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,
  241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,
  176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,
  128,195,78,66,215,61,156,180
];

const perm = new Array(512);
for (let i = 0; i < 512; i++) perm[i] = permutation[i & 255];

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t, a, b) { return a + t * (b - a); }

function grad(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function noise(x, y = 0, z = 0) {
  let fx = Math.floor(x) & 255;
  let fy = Math.floor(y) & 255;
  let fz = Math.floor(z) & 255;

  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);

  const u = fade(x);
  const v = fade(y);
  const w = fade(z);

  const a  = perm[fx] + fy;
  const aa = perm[a] + fz;
  const ab = perm[a + 1] + fz;
  const b  = perm[fx + 1] + fy;
  const ba = perm[b] + fz;
  const bb = perm[b + 1] + fz;

  return lerp(w,
    lerp(v,
      lerp(u, grad(perm[aa], x, y, z), grad(perm[ba], x-1, y, z)),
      lerp(u, grad(perm[ab], x, y-1, z), grad(perm[bb], x-1, y-1, z))
    ),
    lerp(v,
      lerp(u, grad(perm[aa+1], x, y, z-1), grad(perm[ba+1], x-1, y, z-1)),
      lerp(u, grad(perm[ab+1], x, y-1, z-1), grad(perm[bb+1], x-1, y-1, z-1))
    )
  );
}

// ============================================================
// TIME
// ============================================================
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ============================================================
// WEB-ACCURATE SAMPLING
// ============================================================
function sampleAt(t) {
  let intensity = noise(t * NOISE_FACTOR) * 0.5;
  let humidity  = noise(t * NOISE_FACTOR, 123.4567) * 0.5 + 1.35;

  intensity = Math.max(0, Math.min(1, intensity));
  humidity  = Math.max(0, Math.min(1, humidity));

  return { intensity, humidity };
}

function isStorm(t) {
  const s = sampleAt(t);
  return s.intensity > 0.65 && s.humidity > 0.75;
}

// ============================================================
// FIXED STORM SEARCH (LINEAR LIKE WEB)
// ============================================================
function findNextStormStart(hours = 168) {
  const now = nowSec();
  const steps = (hours * 3600) / STEP_SECONDS;

  for (let i = 0; i < steps; i++) {
    const t = (now - SEED) - (i * STEP_SECONDS);
    if (isStorm(t)) {
      return now + (i * STEP_SECONDS);
    }
  }
  return null;
}

// ============================================================
// STORM DURATION (FIXED)
// ============================================================
function findStormDuration(start, maxHours = 72) {
  const steps = (maxHours * 3600) / STEP_SECONDS;
  let duration = 0;

  for (let i = 0; i < steps; i++) {
    const t = (start - SEED) - (i * STEP_SECONDS);
    if (!isStorm(t)) break;
    duration += STEP_SECONDS;
  }

  return duration;
}

// ============================================================
// FORMAT
// ============================================================
function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

// ============================================================
// DISCORD SETUP
// ============================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName("nextstorm").setDescription("Next storm"),
].map(c => c.toJSON());

async function register() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
}

// ============================================================
// READY
// ============================================================
client.once("ready", async () => {
  console.log("Logged in:", client.user.tag);
  await register();
});

// ============================================================
// COMMAND
// ============================================================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName !== "nextstorm") return;

  await i.deferReply();

  const stormStart = findNextStormStart(168);

  if (!stormStart) {
    return i.editReply("⛅ No storms in range (7 days).");
  }

  const duration = findStormDuration(stormStart);
  const stormEnd = stormStart + duration;

  return i.editReply(
    `⛈️ Next storm:\n` +
    `Start: <t:${stormStart}:R>\n` +
    `End: <t:${stormEnd}:R>\n` +
    `Duration: ${formatDuration(duration)}`
  );
});

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN);
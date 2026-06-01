require("dotenv").config();

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
const TOKEN     = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing environment variables. Check Railway Variables.");
  process.exit(1);
}

// ============================================================
// PERLIN NOISE
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
      lerp(u, grad(perm[aa], x, y, z),
               grad(perm[ba], x - 1, y, z)),
      lerp(u, grad(perm[ab], x, y - 1, z),
               grad(perm[bb], x - 1, y - 1, z))
    ),
    lerp(v,
      lerp(u, grad(perm[aa + 1], x, y, z - 1),
               grad(perm[ba + 1], x - 1, y, z - 1)),
      lerp(u, grad(perm[ab + 1], x, y - 1, z - 1),
               grad(perm[bb + 1], x - 1, y - 1, z - 1))
    )
  );
}

// ============================================================
// FIX: TIME NORMALIZATION (IMPORTANT)
// ============================================================
const SEED = -1753269629;
const NOISE_FACTOR = 0.00018;
const STEP_SECONDS = 600;
const BASE_TIME = 1000000000;

function normalizeTime(t) {
  return t - BASE_TIME;
}

// ============================================================
// CORE WEATHER FUNCTIONS
// ============================================================
function getCurrentTimeSec() {
  return Math.floor(Date.now() / 1000);
}

function sampleAt(t) {
  t = normalizeTime(t);

  let intensity = noise(t * NOISE_FACTOR) * 0.5;
  let humidity  = noise(t * NOISE_FACTOR, 123.4567) * 0.5 + 0.5;

  intensity = Math.max(0, Math.min(1, intensity));
  humidity  = Math.max(0, Math.min(1, humidity));

  return { intensity, humidity };
}

function isStorm(t) {
  const { intensity, humidity } = sampleAt(t);
  return intensity > 0.65 && humidity > 0.75;
}

function findNextStormStart(searchHours = 168) {
  const now = getCurrentTimeSec();
  const steps = Math.floor((searchHours * 3600) / STEP_SECONDS);

  let i = 0;

  while (i < steps && isStorm(normalizeTime(now + i * STEP_SECONDS))) i++;

  while (i < steps) {
    const t = normalizeTime(now + i * STEP_SECONDS);

    if (isStorm(t)) {
      return now + i * STEP_SECONDS;
    }
    i++;
  }

  return null;
}

function findStormDuration(startTimestamp, maxHours = 72) {
  const steps = Math.floor((maxHours * 3600) / STEP_SECONDS);
  let duration = 0;

  for (let i = 0; i < steps; i++) {
    const t = normalizeTime(startTimestamp + i * STEP_SECONDS);
    if (!isStorm(t)) break;
    duration += STEP_SECONDS;
  }

  return duration;
}

function formatDuration(seconds) {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  let out = "";
  if (h) out += `${h}h `;
  if (m) out += `${m}m `;
  if (s && !h) out += `${s}s`;

  return out.trim();
}

function getCurrentWeatherType() {
  const now = getCurrentTimeSec();
  const samples = [];

  for (let i = 0; i < 144; i++) {
    samples.push(sampleAt(now - i * STEP_SECONDS));
  }

  const avgI = samples.reduce((a, b) => a + b.intensity, 0) / samples.length;
  const avgH = samples.reduce((a, b) => a + b.humidity, 0) / samples.length;

  if (avgI < 0.2 && avgH < 0.5) return { type: "Clear Skies", emoji: "☀️" };
  if (avgI < 0.6 && avgH < 0.5) return { type: "Partly Cloudy", emoji: "⛅" };
  if (avgI < 0.65 || avgH < 0.75) return { type: "Overcast", emoji: "☁️" };
  if (isStorm(now)) return { type: "Lightning Storm", emoji: "⛈️" };
  return { type: "Rainy", emoji: "🌧️" };
}

function getWeekForecast() {
  const now = getCurrentTimeSec();
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return Array.from({ length: 7 }, (_, dayOffset) => {
    const samples = Array.from({ length: 144 }, (_, i) =>
      sampleAt(now - dayOffset * 86400 - i * STEP_SECONDS)
    );

    const avgI = samples.reduce((a,b)=>a+b.intensity,0)/samples.length;
    const avgH = samples.reduce((a,b)=>a+b.humidity,0)/samples.length;

    let type = "Clear", emoji = "☀️";

    if (avgI < 0.6 && avgH < 0.5) { type = "P.Cloudy"; emoji = "⛅"; }
    else if (avgI < 0.65 || avgH < 0.75) { type = "Overcast"; emoji = "☁️"; }
    else if (avgI < 0.8) { type = "Rainy"; emoji = "🌧️"; }
    else { type = "Stormy"; emoji = "⛈️"; }

    const ts = now + dayOffset * 86400;
    const dayName = days[new Date(ts * 1000).getDay()];

    return { dayName, type, emoji, ts };
  });
}

// ============================================================
// SLASH COMMANDS
// ============================================================
const commands = [
  new SlashCommandBuilder().setName("nextstorm").setDescription("Next storm info"),
  new SlashCommandBuilder().setName("weather").setDescription("Current weather"),
  new SlashCommandBuilder().setName("forecast").setDescription("7-day forecast"),
  new SlashCommandBuilder().setName("stormcheck").setDescription("Storm status"),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
}

// ============================================================
// CLIENT
// ============================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  const now = getCurrentTimeSec();

  if (interaction.commandName === "weather") {
    const w = getCurrentWeatherType();
    return interaction.editReply(`${w.emoji} ${w.type}`);
  }

  if (interaction.commandName === "forecast") {
    const f = getWeekForecast();
    return interaction.editReply(
      f.map(d => `${d.emoji} ${d.dayName} — ${d.type}`).join("\n")
    );
  }

  if (interaction.commandName === "stormcheck") {
    return interaction.editReply(
      isStorm(now)
        ? "⛈️ Storm active"
        : "☀️ No storm"
    );
  }

  if (interaction.commandName === "nextstorm") {
    const start = findNextStormStart();
    if (!start) return interaction.editReply("No storm found");

    const dur = findStormDuration(start);
    return interaction.editReply(
      `⛈️ Next storm <t:${start}:R>\nDuration: ${formatDuration(dur)}`
    );
  }
});

client.login(TOKEN);
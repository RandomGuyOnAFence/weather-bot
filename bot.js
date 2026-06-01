// ============================================================
// DEPENDENCIES
// npm install discord.js
// ============================================================
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

// ============================================================
// CONFIG - fill these in
// ============================================================
const TOKEN      = process.env.DISCORD_TOKEN;
const CLIENT_ID  = process.env.CLIENT_ID;
const GUILD_ID   = process.env.GUILD_ID; // remove this for global commands

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

  const a  = perm[fx]     + fy;
  const aa = perm[a]      + fz;
  const ab = perm[a  + 1] + fz;
  const b  = perm[fx + 1] + fy;
  const ba = perm[b]      + fz;
  const bb = perm[b  + 1] + fz;

  return lerp(w,
    lerp(v,
      lerp(u, grad(perm[aa],     x,     y,     z),
               grad(perm[ba],     x - 1, y,     z)),
      lerp(u, grad(perm[ab],     x,     y - 1, z),
               grad(perm[bb],     x - 1, y - 1, z))
    ),
    lerp(v,
      lerp(u, grad(perm[aa + 1], x,     y,     z - 1),
               grad(perm[ba + 1], x - 1, y,     z - 1)),
      lerp(u, grad(perm[ab + 1], x,     y - 1, z - 1),
               grad(perm[bb + 1], x - 1, y - 1, z - 1))
    )
  );
}

// ============================================================
// CONSTANTS
// ============================================================
const SEED         = -1753269629;
const NOISE_FACTOR = 0.00018;
const STEP_SECONDS = 600; // sample every 10 minutes

// ============================================================
// CORE WEATHER FUNCTIONS
// ============================================================
function getCurrentTimeSec() {
  return Math.floor(Date.now() / 1000);
}

function sampleAt(t) {
  let intensity = noise(t * NOISE_FACTOR) * 0.5;
  let humidity  = Math.round(noise(t * NOISE_FACTOR, 123.4567) * 0.5 + 1.35);
  intensity     = Math.max(0, Math.min(1, intensity));
  humidity      = Math.max(0, Math.min(1, humidity));
  return { intensity, humidity };
}

function isStorm(t) {
  const { intensity, humidity } = sampleAt(t);
  return intensity > 0.65 && humidity > 0.75;
}

// ============================================================
// FIND NEXT STORM START
// Returns Unix timestamp (seconds) of when next storm begins,
// or null if none found within the search window.
// ============================================================
function findNextStormStart(searchHours = 168) { // search 7 days ahead
  const now        = getCurrentTimeSec();
  const maxSeconds = searchHours * 3600;
  const steps      = Math.floor(maxSeconds / STEP_SECONDS);

  // If we are currently in a storm, skip past it first
  let i = 0;
  while (i < steps && isStorm(now - SEED + i * STEP_SECONDS)) i++;

  // Now find where the next storm begins
  while (i < steps) {
    const t = now - SEED + i * STEP_SECONDS;
    if (isStorm(t)) {
      // Refine: walk back to find exact start within this step
      for (let s = STEP_SECONDS; s >= 60; s = Math.floor(s / 2)) {
        const tBack = t - s;
        if (!isStorm(tBack)) break;
        return Math.floor(now + (i * STEP_SECONDS) - s);
      }
      return Math.floor(now + i * STEP_SECONDS);
    }
    i++;
  }

  return null; // no storm found in window
}

// ============================================================
// FIND STORM DURATION
// Given a storm start timestamp, walk forward until it ends.
// Returns duration in seconds.
// ============================================================
function findStormDuration(startTimestamp, maxHours = 72) {
  const maxSeconds = maxHours * 3600;
  const steps      = Math.floor(maxSeconds / STEP_SECONDS);
  let   duration   = 0;

  // Mirror the web script's approach: derive elapsed from the current Unix
  // timestamp and SEED, then use (elapsed + SEED) as the base so that t
  // advances purely by step offsets — matching the original algorithm.
  const elapsed = startTimestamp - SEED;

  for (let i = 0; i < steps; i++) {
    const t = (elapsed + SEED) + i * STEP_SECONDS;
    if (!isStorm(t)) break;
    duration += STEP_SECONDS;
  }

  return duration; // seconds
}

// ============================================================
// FORMAT DURATION  e.g. "2h 34m"
// ============================================================
function formatDuration(seconds) {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  let out = "";
  if (h > 0) out += `${h}h `;
  if (m > 0) out += `${m}m `;
  if (s > 0 && h === 0) out += `${s}s`; // only show seconds if < 1h
  return out.trim();
}

// ============================================================
// CURRENT WEATHER TYPE
// ============================================================
function getCurrentWeatherType() {
  const now = getCurrentTimeSec();
  const samples = [];

  for (let i = 0; i < 144; i++) {
    const t = (now - SEED) - (i * STEP_SECONDS);
    samples.push(sampleAt(t));
  }

  const avgIntensity = samples.reduce((a, b) => a + b.intensity, 0) / samples.length;
  const avgHumidity  = samples.reduce((a, b) => a + b.humidity,  0) / samples.length;

  if (avgIntensity < 0.2  && avgHumidity < 0.5)  return { type: "Clear Skies",      emoji: "☀️"  };
  if (avgIntensity < 0.6  && avgHumidity < 0.5)  return { type: "Partially Cloudy", emoji: "⛅"  };
  if (avgIntensity < 0.65 || avgHumidity < 0.75) return { type: "Overcast",          emoji: "☁️"  };
  if (avgIntensity < 0.65 && avgHumidity < 0.75) return { type: "Rainy",             emoji: "🌧️" };
  if (isStorm(now - SEED))                        return { type: "Lightning Storm",   emoji: "⛈️"  };
  return                                                 { type: "Snowy",             emoji: "❄️"  };
}

// ============================================================
// 7-DAY FORECAST
// ============================================================
function getWeekForecast() {
  const now     = getCurrentTimeSec();
  const days    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const results = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const samples = [];

    for (let i = 0; i < 144; i++) {
      const t = (now - (dayOffset * 86400) - SEED) - (i * STEP_SECONDS);
      samples.push(sampleAt(t));
    }

    const avgI = samples.reduce((a, b) => a + b.intensity, 0) / samples.length;
    const avgH = samples.reduce((a, b) => a + b.humidity,  0) / samples.length;

    let type, emoji;
    if      (avgI < 0.2  && avgH < 0.5)  { type = "Clear";    emoji = "☀️";  }
    else if (avgI < 0.6  && avgH < 0.5)  { type = "P.Cloudy"; emoji = "⛅";  }
    else if (avgI < 0.65 || avgH < 0.75) { type = "Overcast"; emoji = "☁️";  }
    else if (avgI < 0.65 && avgH < 0.75) { type = "Rainy";    emoji = "🌧️"; }
    else                                  { type = "Stormy";   emoji = "⛈️";  }

    const date    = new Date((now + dayOffset * 86400) * 1000);
    const dayName = days[date.getDay()];
    results.push({ dayName, type, emoji });
  }

  return results;
}

// ============================================================
// REGISTER SLASH COMMANDS
// ============================================================
const commands = [
  new SlashCommandBuilder()
    .setName("nextstorm")
    .setDescription("Shows the time until the next storm and how long it will last"),

  new SlashCommandBuilder()
    .setName("weather")
    .setDescription("Shows the current weather conditions"),

  new SlashCommandBuilder()
    .setName("forecast")
    .setDescription("Shows the 7-day weather forecast"),

  new SlashCommandBuilder()
    .setName("stormcheck")
    .setDescription("Check if there is currently a storm active"),
].map(cmd => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // Defer so we have time to compute
  await interaction.deferReply();

  const { commandName } = interaction;

  // ----------------------------------------------------------
  // /nextstorm
  // ----------------------------------------------------------
  if (commandName === "nextstorm") {
    const stormStart = findNextStormStart(168); // search 7 days

    if (!stormStart) {
      return interaction.editReply({
        content: "⛅ **No storms detected** in the next 7 days. Enjoy the calm!"
      });
    }

    const now         = getCurrentTimeSec();
    const duration    = findStormDuration(stormStart, 72);
    const stormEnd    = stormStart + duration;
    const isNow       = stormStart <= now;

    // Discord timestamp formats:
    // <t:UNIX:R> = relative  ("in 3 hours")
    // <t:UNIX:F> = full date ("Monday, June 2 2025 at 3:00 PM")
    // <t:UNIX:t> = short time ("3:00 PM")

    if (isNow) {
      // Storm is happening right now
      return interaction.editReply({
        content: [
          "⛈️ **Storm is active RIGHT NOW!**",
          "",
          `🕐 **Started:** <t:${stormStart}:R>`,
          `🏁 **Ends:** <t:${stormEnd}:R> (<t:${stormEnd}:t>)`,
          `⏱️ **Duration:** ${formatDuration(duration)}`,
          `📅 **End date:** <t:${stormEnd}:F>`,
        ].join("\n")
      });
    } else {
      return interaction.editReply({
        content: [
          "⛈️ **Next Storm Incoming!**",
          "",
          `🕐 **Arrives:** <t:${stormStart}:R> (<t:${stormStart}:t>)`,
          `📅 **Date:** <t:${stormStart}:F>`,
          `⏱️ **Will last:** ${formatDuration(duration)}`,
          `🏁 **Clears:** <t:${stormEnd}:R> (<t:${stormEnd}:t>)`,
        ].join("\n")
      });
    }
  }

  // ----------------------------------------------------------
  // /weather
  // ----------------------------------------------------------
  if (commandName === "weather") {
    const { type, emoji } = getCurrentWeatherType();
    const now             = getCurrentTimeSec();
    const { intensity, humidity } = sampleAt(now - SEED);

    return interaction.editReply({
      content: [
        `${emoji} **Current Weather: ${type}**`,
        "",
        `💧 **Humidity:** ${Math.round(humidity * 100)}%`,
        `🌡️ **Intensity:** ${Math.round(intensity * 100)}%`,
        `🕐 **As of:** <t:${now}:t>`,
      ].join("\n")
    });
  }

  // ----------------------------------------------------------
  // /forecast
  // ----------------------------------------------------------
  if (commandName === "forecast") {
    const forecast = getWeekForecast();
    const lines    = forecast.map(
      (day, i) => `${day.emoji} **${day.dayName}** — ${day.type}`
    );

    return interaction.editReply({
      content: [
        "📅 **7-Day Forecast**",
        "",
        ...lines
      ].join("\n")
    });
  }

  // ----------------------------------------------------------
  // /stormcheck
  // ----------------------------------------------------------
  if (commandName === "stormcheck") {
    const now       = getCurrentTimeSec();
    const storming  = isStorm(now - SEED);

    if (storming) {
      const duration = findStormDuration(now, 72);
      const stormEnd = now + duration;

      return interaction.editReply({
        content: [
          "⛈️ **YES — A storm is active right now!**",
          "",
          `🏁 **Expected to clear:** <t:${stormEnd}:R>`,
          `⏱️ **Remaining duration:** ${formatDuration(duration)}`,
        ].join("\n")
      });
    } else {
      const nextStart = findNextStormStart(168);

      if (!nextStart) {
        return interaction.editReply({
          content: "☀️ **No storm active.** Clear skies ahead for the next 7 days!"
        });
      }

      return interaction.editReply({
        content: [
          "☀️ **No storm active right now.**",
          "",
          `⛈️ **Next storm:** <t:${nextStart}:R>`,
          `📅 **On:** <t:${nextStart}:F>`,
        ].join("\n")
      });
    }
  }
});

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN);
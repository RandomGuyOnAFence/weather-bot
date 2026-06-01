# 1. Use the official Node.js image (Lightweight version)
FROM node:20-bookworm-slim

# 2. Update Linux and forcefully install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# 3. Create a working directory for the bot
WORKDIR /app

# 4. Copy your package.json and install dependencies
COPY package*.json ./
RUN npm install

# 5. Copy the rest of your bot's files (bot.js, Audios folder, etc.)
COPY . .

# 6. Start the bot
CMD ["node", "bot.js"]
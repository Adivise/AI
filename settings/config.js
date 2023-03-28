require("dotenv").config();

module.exports = {
    blocked: ["nanotect_"], // block user from chatter with bot
    channel: process.env.CHANNEL || ["nanotect_"], // the twitch channel you want to join
    username: process.env.USERNAME || "YOUR_USERNAME", // the username of your bot
    oauth: process.env.OAUTH || "YOUR_OAUTH", // the oauth of your bot
    apiKey: process.env.apikey || "YOUR_API_KEY", // openai apikey!

    /// speaker output
    speaker_id: 8,
    ai_name: "Nano-Chan"
}
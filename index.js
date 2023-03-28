const tmi = require("tmi.js");
const { isRomaji, toKana } = require('wanakana');
const emoji_regex = require('emoji-regex');
const player = require("play-sound")(opts = {
  player: "cmdmp3",
});
const VoiceVox = require('./structures/voicevox.js');
const config = require("./settings/config.js");
const translate = require("@iamtraction/google-translate");
const fs = require("fs");

const OpenAi = require('openai-api');
const openAi = new OpenAi(config.apiKey);

const sleep = waitTime => new Promise(resolve => setTimeout(resolve, waitTime));
const escape_regexp = (str) => str.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');

const voicebox = new VoiceVox();
const dictionary = new Map();
let sudachi;

const client = new tmi.client({
  channels: [config.channel],
  connection: {
    reconnect: true,
    secure: true
  },
  identity: {
    username: config.username,
    password: config.oauth
  }
});

async function import_sudachi() {
  sudachi = await import('sudachi');
};

let playing = false;

async function main() {
  console.log("[INFO] Loading sudachi...");
  await import_sudachi();

  client.connect().then(() => {
    console.log("[INFO] AI is Ready!");
  });

  client.on('message', async (channel, tags, message, self) => {
    console.log(`Content (Original): ${tags.username}: ${message}`);
    // convert from any language to en
    const trans = await translate(message, { to: "en" });
    console.log(`Content (Translate): ${trans.text}`);
    // and ask ChatGPT
    await ask_chatgpt(tags, trans);
  });  
}

async function ask_chatgpt(tags, trans) {
  try {
    // ask chatgpt
    const gptResponse = await gpt_response(tags.username, trans.text);
    console.log(`Content (ChatGPT): ${gptResponse}`);
    // translate en to jp
    const res = await translate(gptResponse, { to: 'ja' });
    // check if playing = true don't play
    if (playing === true) return;
    // filter words and play sounds
    await add_text_queue(res.text);
    // write to txt file
    await write_file(tags.username, trans.text, gptResponse);
  } catch (error) {
    console.log(error);
    await sleep(10);
    try_agian();
  }
}


async function write_file(channel, text, gpt) {
  const trimmedLine = text.trim();
  if (trimmedLine.length > 0) {
    await fs.promises.appendFile('./question.txt', `${channel}: ${trimmedLine}\n`);
  }

  const lines = splitIntoLines(gpt);
  for (const line of lines) {
    const trimmedGpt = line.trim();
    if (trimmedGpt.length > 0) {
      await fs.promises.appendFile('./translate.txt', `${trimmedGpt}\n`);
    }
  }
}

function splitIntoLines(text) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    if ((currentLine + ' ' + word).length > 80) {
      lines.push(currentLine.trim());
      currentLine = '';
    }
    currentLine += ' ' + word;
  }
  if (currentLine.trim().length > 0) {
    lines.push(currentLine.trim());
  }
  return lines;
}

async function clear_file(file_path) {
  await fs.promises.writeFile(file_path, '');
}

const lore = fs.readFileSync('./lore.txt', 'utf8');

const toConvo = (username, message) => `${lore}\n${username}:${message}\n${config.ai_name}:`;
const fromConvo = (username, text) => text.split(`\n${username}:`)[0];

async function gpt_response(username, message, parse=toConvo) {
  const gptResponse = await openAi.complete({
    engine: "text-davinci-003",
    prompt: parse(username, message),
    maxTokens: 256,
    temperature: 0.9,
    topP: 0.9,
    presencePenalty: 0.3,
    frequencyPenalty: 0.6,
    bestOf: 1,
    n: 1,
    stream: false,
    stop: [`${config.ai_name}:`,`${username}:`]
  });
  return fromConvo(username, gptResponse.data.choices[0].text);
}

function add_text_queue(message){
  let content = message;
  // 1
  content = content.replace(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi, 'ゆーあーるえる省略');
  // 2
  content = replace_at_dict(content, "123456789");
  console.log(`Content (Replace Dict): ${content}`);
  // 3
  content = clean_message(content);
  console.log(`Content (Clean): ${content}`);
  // 4
  content = fix_reading(content);
  console.log(`Content (Fix Reading): ${content}`);

  return play(content);
}

async function play(message){
  const text_data = get_text_and_speed(message);
  // console.log(`Talk Speed: ${text_data.speed}`);
  const voice_data = {
    speed: map_voice_setting(((100 > text_data.speed) ? 100 : text_data.speed), 0.5, 1.5),
    pitch: map_voice_setting(100, -0.15, 0.15),
    intonation: map_voice_setting(100, 0, 2),
    volume: map_voice_setting((100), 0, 1, 0, 100)
  }

  // console.log(`Voice Data: ${JSON.stringify(voice_data)}`);

  try {
    // download sounds
    await voicebox.synthesis(text_data.text, "output.wav", config.speaker_id, voice_data);
    // play sounds
    player.play(`./sounds/output.wav`);
    // set playing to true
    playing = true;
    // checking duration file
    import("music-metadata").then(m => {
      m.parseFile("./sounds/output.wav", { native: true }).then(async (data) => {
        // add delay
        await sleep(data.format.duration * 1000);
        // set playing to false
        playing = false;
        // clear text
        await clear_file("./question.txt");
        await clear_file("./translate.txt");
      })
    })
  } catch(e) {
    console.log(e);
    await sleep(10);
    play(message);
  }
}

function map_voice_setting(sample, out_min, out_max, in_min = 0, in_max = 200){
  return (sample - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

function get_text_and_speed(text){
  const count = text.length;
  let text_speed = 0;
  let text_after = text;

  if (count < 80) {
    text_speed = 0;
  } else if (count > 80 && count < 280) {
    text_speed = 100;
  } else {
    text_speed = 100;
    text_after = text.slice(0, 280) + "。いかしょうりゃく";
  }
  return { text: text_after, speed: text_speed };
}

function clean_message(text){
  let result = text;

  result = result.replace(/<:([a-z0-9_-]+):[0-9]+>/gi, "$1");
  result = result.replace(emoji_regex(), "");
  result = result.replace(/["#'^\;:,|`{}<>]/, "");
  result = result.replace(/\r?\n/g, "。")

  return result;
}

function replace_at_dict(text, id){
  const connection = dictionary.get(id);
  if(!connection) return text;

  const dict = connection.dict;

  let result = text;
  for(let p = 0; p < 5; p++){
    const tmp_dict = dict.filter(word => word[2] === p);
    for(let d of tmp_dict) result = result.replace(new RegExp(escape_regexp(d[0]), "g"), d[1]);
  }
  return result;
}

function fix_reading(text){
  let tokens = {};
  try {
    tokens = JSON.parse(sudachi.tokenize(text, sudachi.TokenizeMode.C));
  //  console.log(tokens);
  } catch (e) {
    console.log(e);
    return text;
  }

  let result = [];

  for (let token of tokens) {
    if (token.dictionary_form) {
    //  console.log(`KNOWN: ${token.dictionary_form}`);
      if ((token.poses[0].match(/記号/gi) || token.poses[0].match(/空白/gi)) && token.dictionary_form === "キゴウ"){
        result.push(token.surface)
      } else {
        result.push(token.dictionary_form);
      }
    } else {
      if (isRomaji(token.surface)){
        result.push(toKana(token.surface));
      } else {
        result.push(token.surface);
      }
    }
  }

  return result.join("");
}

main();
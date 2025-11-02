/*  Bet-Adviser-Bot  ––  full-feature version  */
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app  = express();
app.use(cors());
app.use(express.static('public'));   // mini-site files
app.use(express.json());

/* ---------- CONFIG ---------- */
const PORT   = process.env.PORT  || 3000;
const ODDS   = process.env.THE_ODDS_API_KEY;
const WEBAPP = process.env.WEB_APP_URL;   // https://xxx.onrender.com
const bot    = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

/* ---------- MEMORY CACHE (live fixtures) ---------- */
let LIVE_FIXTURES = [];   // [ {home, away, kickoff, odds:{1,X,2}} ]
let LAST_FETCH    = 0;

/* ---------- UTILS ---------- */
const poisson = (k, λ) => Math.exp(-λ)*Math.pow(λ,k)/factorial(k);
function factorial(n){ return n<2?1:n*factorial(n-1); }

/* ---------- LIVE ODDS FETCH (every 5 min) ---------- */
async function fetchLiveOdds(){
  if (Date.now()-LAST_FETCH < 5*60*1000) return;
  try{
    // free tier : soccer_epl only – change sport if you have premium
    const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=${ODDS}`;
    const res = await axios.get(url);
    LIVE_FIXTURES = res.data.map(m=>({
      home   : m.home_team,
      away   : m.away_team,
      kickoff: m.commence_time,
      odds   : m.bookmakers[0]?.markets[0]?.outcomes.reduce((a,o)=>(
        {...a, [o.name===m.home_team? '1': o.name===m.away_team? '2':'X']: o.price}),{})
    }));
    LAST_FETCH = Date.now();
    console.log('[LIVE] fetched',LIVE_FIXTURES.length,'matches');
  }catch(e){ console.error('[LIVE] fetch error',e.message); }
}
fetchLiveOdds();
setInterval(fetchLiveOdds, 5*60*1000);

/* ---------- WEB-APP ROUTES ---------- */
// ---- home / live list ----
app.get('/webapp', (_,res)=> res.sendFile(__dirname+'/public/index.html'));
// ---- api live ----
app.get('/api/live', (_,res)=> res.json(LIVE_FIXTURES));
// ---- about ----
app.get('/api/about', (_,res)=> res.json({author:'True-Manno', version:'1.0.0'}));

/* ---------- TELEGRAM ---------- */
const KEYBOARD = {
  keyboard : [
    [{ text: '📊 Get live advice' , web_app:{ url: WEBAPP+'/webapp' } }],
    [{ text: 'ℹ️ About bot'      , web_app:{ url: WEBAPP+'/webapp/#about' } }]
  ],
  resize_keyboard : true,
  one_time_keyboard : false
};

bot.onText(/\/start/,(msg)=>{
  const name = msg.from.first_name || 'friend';
  const date = new Date().toLocaleString('ht-HT');
  bot.sendMessage(
    msg.chat.id,
    `👋 Hey *${name}*!\n🤖 I’m your *Bet-Adviser-Bot*.\n📅 Today: ${date}\n\nTap the button below to get live match advice ⬇️`,
    { parse_mode:'Markdown', reply_markup:KEYBOARD }
  );
});

bot.onText(/\/menu/,(msg)=>{
  const name = msg.from.first_name || 'friend';
  const date = new Date().toLocaleString('ht-HT');
  const guide =
    `📖 *Step-by-step guide for ${name}*\n\n`+
    `1️⃣ Press 📊 *Get live advice* → choose a match inside the mini-site.\n`+
    `2️⃣ The site shows *probability %* & *value edge* in real time.\n`+
    `3️⃣ If edge > 5 % we give a recommended *stake %* (Kelly ½).\n`+
    `4️⃣ Place your bet on any bookmaker you like.\n\n`+
    `💬 Need help? Contact @TrueMannooo`;
  bot.sendMessage(msg.chat.id, guide, { parse_mode:'Markdown', reply_markup:KEYBOARD });
});

/* ---------- ADVISE COMMAND (kept for power users) ---------- */
bot.onText(/\/advise/, async (msg)=>{
  const args = msg.text.split(' ');
  if (args.length<5) return bot.sendMessage(msg.chat.id,
    'Usage: /advise TeamA-TeamB odd1 oddX odd2');
  const [teams,odd1,oddX,odd2] = args.slice(1);
  const [home,away] = teams.split('-');
  try{
    const {data}=await axios.post(`${WEBAPP}/advise`,{home,away,odd1,oddX,odd2});
    let txt='🔮 *Conseil*\\n';
    Object.entries(data.advice).forEach(([k,v])=>{
      txt+=`${k}: prob ${v.prob}% | edge ${v.edge}% | stake ${v.stake}${v.bet?' ✅':' ❌'}\\n`;
    });
    bot.sendMessage(msg.chat.id, txt, {parse_mode:'MarkdownV2'});
  }catch(e){ bot.sendMessage(msg.chat.id,'Erreur: '+e.message); }
});

/* ---------- START HTTP SERVER ---------- */
app.listen(PORT, ()=> console.log(`[HTTP] Web-App listening on :${PORT}`));

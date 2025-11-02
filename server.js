/*  =================  BET-ADVISER-BOT  =================  */
/*  Back-end only – place this code in server.js on Render  */
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app  = express();
app.use(cors());
app.use(express.json());

/* ---------- CONFIG ---------- */
const PORT   = process.env.PORT  || 3000;
const ODDS   = process.env.THE_ODDS_API_KEY;
const WEBAPP = process.env.WEB_APP_URL;   // front URL (Netlify)
const bot    = new TelegramBot(process.env.TELEGRAM_TOKEN, {polling:true});

/* ---------- UTILS ---------- */
const poisson = (k, λ) => Math.exp(-λ) * Math.pow(λ, k) / factorial(k);
function factorial(n){ return n<2?1:n*factorial(n); }
function predictGoals(){
  return [1.4, 1.1]; // stub – replace by real form/xG
}
function poissonMatch(hA, aA){
  let p = {home:0, draw:0, away:0};
  for(let h=0;h<7;h++)for(let a=0;a<7;a++){
     const pr = poisson(h,hA)*poisson(a,aA);
     if(h>a)p.home+=pr; else if(h===a)p.draw+=pr; else p.away+=pr;
  }
  return p;
}
function kellyStake(p, odd, bank=1000, kDiv=2){
  const edge = p*odd-1;
  if(edge<=0) return 0;
  return ((edge/(odd-1))/kDiv * bank).toFixed(2);
}

/* ---------- LIVE ODDS CACHE (5 min) ---------- */
let LIVE_FIXTURES = [];
let LAST_FETCH = 0;
async function fetchLive(){
  if(Date.now()-LAST_FETCH < 5*60*1000) return;
  try{
    const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=${ODDS}`;
    const res = await axios.get(url);
    LIVE_FIXTURES = res.data.map(m=>({
      home:m.home_team,
      away:m.away_team,
      kickoff:m.commence_time,
      odds:m.bookmakers[0]?.markets[0]?.outcomes.reduce((a,o)=>{
        const key = o.name===m.home_team?'1':o.name===m.away_team?'2':'X';
        a[key]=o.price; return a;
      },{})
    }));
    LAST_FETCH=Date.now();
  }catch(e){ console.error('[LIVE]',e.message); }
}
fetchLive(); setInterval(fetchLive, 5*60*1000);

/* ---------- API ROUTES ---------- */
// ---- live list ----
app.get('/api/live', (_,res)=>res.json(LIVE_FIXTURES));
// ---- advice ----
app.post('/advise', (req,res)=>{
  const {home,away,odd1,oddX,odd2,bankroll=1000} = req.body;
  const probs = poissonMatch(...predictGoals());
  const advice={};
  ['1','X','2'].forEach((k,i)=>{
     const odd=[odd1,oddX,odd2][i], p=[probs.home,probs.draw,probs.away][i], edge=p*odd-1;
     advice[k]={prob:(p*100).toFixed(1), edge:(edge*100).toFixed(1), bet:edge>0.05, stake:edge>0.05?kellyStake(p,odd,bankroll):0};
  });
  res.json({match:`${home} vs ${away}`,advice});
});

/* ---------- TELEGRAM ---------- */
const KB = {
  keyboard:[[{text:'📊 Get live advice',web_app:{url:WEBAPP+'/webapp'}}],
            [{text:'ℹ️ About bot',      web_app:{url:WEBAPP+'/webapp#about'}}]],
  resize_keyboard:true, one_time_keyboard:false
};
bot.onText(/\/start/, (msg)=>{
  const name=msg.from.first_name||'friend';
  bot.sendMessage(msg.chat.id,
    `👋 Hey *${name}*!\n🤖 I'm your *Bet-Adviser-Bot*.\n📅 Today: ${new Date().toLocaleString('ht-HT')}\n\nTap the button below ⬇️`,
    {parse_mode:'Markdown', reply_markup:KB});
});
bot.onText(/\/menu/, (msg)=>{
  const name=msg.from.first_name||'friend';
  bot.sendMessage(msg.chat.id,
    `📖 Step-by-step guide for *${name}*\n\n`+
    `1️⃣ Press 📊 *Get live advice* → choose a match inside the mini-site.\n`+
    `2️⃣ The site shows *probability %* & *value edge* in real time.\n`+
    `3️⃣ If edge > 5 % we give a recommended *stake %* (Kelly ½).\n`+
    `4️⃣ Place your bet on any bookmaker you like.\n\n`+
    `💬 Need help? Contact @TrueMannooo`,
    {parse_mode:'Markdown', reply_markup:KB});
});
// --- handle /advise (power users) ---
bot.onText(/\/advise/, async (msg)=>{
  const args=msg.text.split(' ');
  if(args.length<5)return bot.sendMessage(msg.chat.id,'Usage: /advise TeamA-TeamB odd1 oddX odd2');
  const [teams,odd1,oddX,odd2]=args.slice(1);
  const [home,away]=teams.split('-');
  try{
    const {data}=await axios.post(`${WEBAPP}/advise`,{home,away,odd1,oddX,odd2});
    let txt='🔮 Conseil\n';
    Object.entries(data.advice).forEach(([k,v])=>{
      txt+=`${k}: prob ${v.prob}% | edge ${v.edge}% | stake ${v.stake}${v.bet?' ✅':' ❌'}\n`;
    });
    bot.sendMessage(msg.chat.id, txt);
  }catch(e){
    console.error('[BOT]',e.message);
    bot.sendMessage(msg.chat.id,'❌ Erreur: '+e.message);
  }
});
// --- answer pre-filled message (deep-link) ---
bot.onText(/\/start (.+)/, (msg, match)=>{
  const text = decodeURIComponent(match[1]);
  bot.sendMessage(msg.chat.id, text);
});

/* ---------- START HTTP ---------- */
app.listen(PORT, ()=>console.log(`[HTTP] listening on :${PORT}`));

/*  =================  BET-ADVISER-BOT  =================  */
/*  Full single-file : Telegram + Web-App + Live-Odds     */
/*  100 % Node / JS  –  no external framework needed     */
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const path  = require('path');

const app  = express();
app.use(cors());
app.use(express.json());

/*  ----------  CONFIG  ----------  */
const PORT   = process.env.PORT  || 3000;
const ODDS   = process.env.THE_ODDS_API_KEY;
const WEBAPP = process.env.WEB_APP_URL;     // https://xxx.onrender.com
const bot    = new TelegramBot(process.env.TELEGRAM_TOKEN, {polling:true});

/*  ----------  UTILS  ----------  */
const poisson = (k, λ) => Math.exp(-λ) * Math.pow(λ, k) / factorial(k);
function factorial(n){ return n<2?1:n*factorial(n-1); }

function predictGoals(homeStr='WWDWL', awayStr='LLDWD'){
  const map = {W:2, D:1, L:0};
  const hAvg = homeStr.split('').reduce((s,c)=>s+map[c],0)/5 * 0.7;
  const aAvg = awayStr.split('').reduce((s,c)=>s+map[c],0)/5 * 0.6;
  return [hAvg, aAvg];
}
function poissonMatch(homeAvg, awayAvg){
  let p = {home:0, draw:0, away:0};
  for(let h=0;h<7;h++)for(let a=0;a<7;a++){
     const prob = poisson(h,homeAvg)*poisson(a,awayAvg);
     if(h>a)p.home+=prob; else if(h===a)p.draw+=prob; else p.away+=prob;
  }
  return p;
}
function kellyStake(modelProb, odd, bankroll=1000, kDiv=2){
  const edge = modelProb * odd - 1;
  if(edge<=0) return 0;
  return ((edge/(odd-1))/kDiv * bankroll).toFixed(2);
}

/*  ----------  LIVE ODDS CACHE (5 min)  ----------  */
let LIVE_FIXTURES = [];
let LAST_FETCH    = 0;
async function fetchLiveOdds(){
  if(Date.now()-LAST_FETCH < 5*60*1000) return;
  try{
    const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=${ODDS}`;
    const res = await axios.get(url);
    LIVE_FIXTURES = res.data.map(m=>({
      home:m.home_team,
      away:m.away_team,
      kickoff:m.commence_time,
      odds:m.bookmakers[0]?.markets[0]?.outcomes.reduce((a,o)=>{
        const key = o.name===m.home_team ? '1' : o.name===m.away_team ? '2':'X';
        a[key]=o.price; return a;
      },{})
    }));
    LAST_FETCH=Date.now();
  }catch(e){ console.error('[LIVE] fetch error',e.message); }
}
fetchLiveOdds();
setInterval(fetchLiveOdds, 5*60*1000);

/*  ----------  WEB-APP ROUTES  ----------  */
// ---- mini-site ----
app.get('/webapp', (_,res)=>res.send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><title>Bet-Adviser WebApp</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{font-family:Arial,Helvetica,sans-serif;background:#111;color:#eee;margin:0;padding:1rem}
    h1,h2{color:#00ff90}.card{background:#222;border-radius:8px;padding:1rem;margin:.5rem 0}
    button{background:#00ff90;border:none;padding:.7rem 1.2rem;border-radius:4px;font-weight:bold}
  </style>
</head>
<body>
  <h1>📊 Live Matches</h1>
  <div id="list">loading...</div>
  <div id="about" style="margin-top:2rem;font-size:.9rem;color:#aaa">
    <h2>ℹ️ About</h2><p>Bot developed by <strong>True-Manno</strong><br>Data refreshed every 5 min.</p>
  </div>
  <script>
    async function load(){
      const res = await fetch('/api/live');
      const matches = await res.json();
      const box=document.getElementById('list');
      if(!matches.length) return box.innerHTML='<p>No match available now.</p>';
      box.innerHTML=matches.map(m=>`
        <div class="card">
          <strong>${m.home}</strong> vs <strong>${m.away}</strong><br>
          Kick-off: ${new Date(m.kickoff).toLocaleString()}<br>
          Odds: 1 ${m.odds['1']} | X ${m.odds['X']} | 2 ${m.odds['2']}
          <br><button onclick="getAdvice('${m.home}','${m.away}',${m.odds['1']},${m.odds['X']},${m.odds['2']})">Get advice</button>
        </div>`).join('');
    }
    async function getAdvice(h,a,o1,oX,o2){
      const r=await fetch('/advise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({home:h,away:a,odd1:o1,oddX:oX,odd2:o2})});
      const j=await r.json(); alert(JSON.stringify(j.advice,null,2));
    }
    load(); setInterval(load,120000);
  </script>
</body>
</html>`));
// ---- api live ----
app.get('/api/live', (_,res)=>res.json(LIVE_FIXTURES));
// ---- about ----
app.get('/api/about', (_,res)=>res.json({author:'True-Manno',version:'1.0.0'}));

/*  ----  ADVISE ENDPOINT  ----  */
app.post('/advise', (req,res)=>{
  const {home,away,odd1,oddX,odd2,bankroll=1000} = req.body;
  const [hA,aA] = predictGoals();
  const probs = poissonMatch(hA,aA);
  const advice = {};
  ['1','X','2'].forEach((k,i)=>{
     const odd = [odd1,oddX,odd2][i];
     const prob = [probs.home,probs.draw,probs.away][i];
     const edge = prob*odd-1;
     advice[k] = {
       prob:(prob*100).toFixed(1),
       edge:(edge*100).toFixed(1),
       odd,
       bet:edge>0.05,
       stake:edge>0.05?kellyStake(prob,odd,bankroll):0
     };
  });
  res.json({match:`${home} vs ${away}`,advice});
});

/*  ----------  TELEGRAM  ----------  */
const KEYBOARD = {
  keyboard : [
    [{text:'📊 Get live advice', web_app:{url:WEBAPP+'/webapp'}}],
    [{text:'ℹ️ About bot',      web_app:{url:WEBAPP+'/webapp#about'}}]
  ],
  resize_keyboard:true,
  one_time_keyboard:false
};

bot.onText(/\/start/, (msg)=>{
  const name = msg.from.first_name||'friend';
  const date = new Date().toLocaleString('ht-HT');
  bot.sendMessage(msg.chat.id,
    `👋 Hey *${name}*!\n🤖 I'm your *Bet-Adviser-Bot*.\n📅 Today: ${date}\n\nTap the button below to get live match advice ⬇️`,
    {parse_mode:'Markdown',reply_markup:KEYBOARD}
  );
});

bot.onText(/\/menu/, (msg)=>{
  const name = msg.from.first_name||'friend';
  const date = new Date().toLocaleString('ht-HT');
  const txt =
    `📖 Step-by-step guide for *${name}*\n\n`+
    `1️⃣ Press 📊 *Get live advice* → choose a match inside the mini-site.\n`+
    `2️⃣ The site shows *probability %* & *value edge* in real time.\n`+
    `3️⃣ If edge > 5 % we give a recommended *stake %* (Kelly ½).\n`+
    `4️⃣ Place your bet on any bookmaker you like.\n\n`+
    `💬 Need help? Contact @TrueMannooo`;
  bot.sendMessage(msg.chat.id, txt, {parse_mode:'Markdown',reply_markup:KEYBOARD});
});

bot.onText(/\/advise/, async (msg)=>{
  const args = msg.text.split(' ');
  if(args.length<5) return bot.sendMessage(msg.chat.id,
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
  }catch(e){
    console.error('[BOT]',e.message);
    bot.sendMessage(msg.chat.id,'❌ Erreur: '+e.message);
  }
});

/*  ----------  START HTTP SERVER  ----------  */
app.listen(PORT, ()=>console.log(`[HTTP] Web-App listening on :${PORT}`));

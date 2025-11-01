// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { factorial } = require('mathjs');

const app = express();
app.use(express.json());

// --- UTILS ---
const poisson = (k, λ) => Math.exp(-λ) * Math.pow(λ, k) / factorial(k);

function predictGoals(homeStr, awayStr) {
  const map = { W: 2, D: 1, L: 0 };
  const homeAvg = (homeStr.split('').reduce((s, c) => s + map[c], 0) / 5) * 0.7;
  const awayAvg = (awayStr.split('').reduce((s, c) => s + map[c], 0) / 5) * 0.6;
  return [homeAvg, awayAvg];
}

function poissonMatch(homeAvg, awayAvg) {
  let prob = { home: 0, draw: 0, away: 0 };
  for (let h = 0; h < 7; h++) {
    for (let a = 0; a < 7; a++) {
      const p = poisson(h, homeAvg) * poisson(a, awayAvg);
      if (h > a) prob.home += p;
      else if (h === a) prob.draw += p;
      else prob.away += p;
    }
  }
  return prob;
}

function kellyStake(modelProb, odd, bankroll = 1000, kDiv = 2) {
  const edge = modelProb * odd - 1;
  if (edge <= 0) return 0;
  const kelly = edge / (odd - 1);
  return ((kelly / kDiv) * bankroll).toFixed(2);
}

// --- API ---
app.post('/advise', (req, res) => {
  const { home, away, odd1, oddX, odd2, formHome, formAway, bankroll = 1000 } = req.body;
  const [hA, aA] = predictGoals(formHome || 'WWDWL', formAway || 'LLDWD');
  const probs = poissonMatch(hA, aA);

  const advice = {};
  ['1', 'X', '2'].forEach((k, i) => {
    const odd = [odd1, oddX, odd2][i];
    const prob = [probs.home, probs.draw, probs.away][i];
    const edge = prob * odd - 1;
    advice[k] = {
      prob: +(prob * 100).toFixed(1),
      edge: +(edge * 100).toFixed(1),
      odd,
      bet: edge > 0.05,
      stake: edge > 0.05 ? kellyStake(prob, odd, bankroll) : 0
    };
  });

  res.json({ match: `${home} vs ${away}`, advice });
});

// --- TELEGRAM ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
bot.onText(/\/advise/, async msg => {
  const chatId = msg.chat.id;
  const args = msg.text.split(' ');
  if (args.length < 4) return bot.sendMessage(chatId, 'Usage: /advise Chelsea-Arsenal 2.10 3.40 3.60');
  const [teams, odd1, oddX, odd2] = args.slice(1);
  const [home, away] = teams.split('-');
  const payload = { home, away, odd1, oddX, odd2 };
  try {
    const { data } = await axios.post(`${process.env.RAILWAY_URL || 'http://localhost:' + (process.env.PORT || 3000)}/advise`, payload);
    let out = `🔮 Conseil – ${home} vs ${away}\n`;
    Object.entries(data.advice).forEach(([k, v]) => {
      out += `${k}: ${v.prob}% | edge ${v.edge}% | stake ${v.stake} ${v.bet ? '✅' : '❌'}\n`;
    });
    bot.sendMessage(chatId, out);
  } catch (e) {
    bot.sendMessage(chatId, 'Erreur: ' + e.message);
  }
});

// --- START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot adviser on ${PORT}`));

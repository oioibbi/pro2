const SUITS = ["S", "H", "D", "C"];
const SUIT_SYMBOLS = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 2]));
const STREET_NAMES = ["翻牌前", "翻牌", "转牌", "河牌", "摊牌"];
const STARTING_STACK = 1500;
const ACTION_DELAY = 1100;
const MAX_LOG_ITEMS = 12;
const HUMAN_SEAT = 5;
const TOTAL_SEATS = 6;
const ACTIVE_SEAT_MAP = {
  2: [0, 5],
  3: [0, 1, 5],
  4: [0, 1, 4, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};
const BLIND_LEVELS = [
  { small: 10, big: 20 },
  { small: 20, big: 40 },
  { small: 40, big: 80 },
  { small: 80, big: 160 },
  { small: 150, big: 300 },
];

const els = {
  tableStage: document.querySelector(".table-stage"),
  tableAnimLayer: document.getElementById("table-anim-layer"),
  chipAnimLayer: document.getElementById("chip-anim-layer"),
  deckStack: document.getElementById("deck-stack"),
  seats: [...document.querySelectorAll(".seat")],
  communityCards: document.getElementById("community-cards"),
  potValue: document.getElementById("pot-value"),
  currentBet: document.getElementById("current-bet"),
  streetLabel: document.getElementById("street-label"),
  message: document.getElementById("message"),
  turnLabel: document.getElementById("turn-label"),
  toCallValue: document.getElementById("to-call-value"),
  playerCommitment: document.getElementById("player-commitment"),
  blindInfo: document.getElementById("blind-info"),
  aliveCount: document.getElementById("alive-count"),
  handCount: document.getElementById("hand-count"),
  foldBtn: document.getElementById("fold-btn"),
  checkCallBtn: document.getElementById("check-call-btn"),
  raiseBtn: document.getElementById("raise-btn"),
  raiseInput: document.getElementById("raise-input"),
  raiseValue: document.getElementById("raise-value"),
  newHandBtn: document.getElementById("new-hand-btn"),
  resetTableBtn: document.getElementById("reset-table-btn"),
  playerCountSelect: document.getElementById("player-count-select"),
  autoNextCheckbox: document.getElementById("auto-next-checkbox"),
  soundToggleCheckbox: document.getElementById("sound-toggle-checkbox"),
  logList: document.getElementById("log-list"),
};

const state = {
  players: createPlayers(),
  deck: [],
  communityCards: [],
  dealerIndex: 5,
  smallBlindIndex: null,
  bigBlindIndex: null,
  street: -1,
  currentBet: 0,
  minRaise: 20,
  currentTurnIndex: null,
  handActive: false,
  awaitingHuman: false,
  introAnimating: false,
  visibleHoleCounts: Array(TOTAL_SEATS).fill(0),
  pot: 0,
  activeSeatCount: 6,
  handsPlayed: 0,
  blindLevelIndex: 0,
  autoNextHand: false,
  soundEnabled: true,
  pendingAutoStart: null,
  actionLog: [],
  audioContext: null,
  boardAnimatingSlots: [],
  revealingHoleSlots: {},
  boardEnteringSlots: [],
  holeEnteringSlots: {},
};

function createPlayers() {
  return Array.from({ length: TOTAL_SEATS }, (_, seatIndex) => ({
    seatIndex,
    name: seatIndex === HUMAN_SEAT ? "你" : `AI ${seatIndex + 1}`,
    isHuman: seatIndex === HUMAN_SEAT,
    active: true,
    stack: STARTING_STACK,
    cards: [],
    folded: false,
    out: false,
    allIn: false,
    acted: false,
    committed: 0,
    totalContribution: 0,
    statusText: "等待中",
    actionTone: "wait",
    revealCards: seatIndex === HUMAN_SEAT,
    bestScore: null,
    bestLabel: "",
    personality: generatePersonality(seatIndex),
  }));
}

function generatePersonality(seatIndex) {
  if (seatIndex === HUMAN_SEAT) {
    return { aggression: 0, looseness: 0, bluff: 0 };
  }
  return {
    aggression: 0.85 + seatIndex * 0.12,
    looseness: 0.85 + ((seatIndex + 1) % 3) * 0.18,
    bluff: 0.12 + (seatIndex % 2) * 0.08,
  };
}

function currentBlinds() {
  return BLIND_LEVELS[Math.min(state.blindLevelIndex, BLIND_LEVELS.length - 1)];
}

function clearAutoStart() {
  if (state.pendingAutoStart !== null) {
    window.clearTimeout(state.pendingAutoStart);
    state.pendingAutoStart = null;
  }
}

function addLog(entry) {
  state.actionLog.unshift(entry);
  state.actionLog = state.actionLog.slice(0, MAX_LOG_ITEMS);
  renderLog();
}

function renderLog() {
  els.logList.innerHTML = "";
  state.actionLog.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "log-item";
    item.textContent = entry;
    els.logList.appendChild(item);
  });
}

function setMessage(text, shouldLog = false) {
  els.message.textContent = text;
  if (shouldLog) {
    addLog(text);
  }
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function ensureAudioContext() {
  if (!state.soundEnabled) return null;
  if (!state.audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    state.audioContext = new AudioCtor();
  }
  if (state.audioContext.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }
  return state.audioContext;
}

function playTone({ frequency, duration, type = "sine", volume = 0.035, delay = 0 }) {
  const context = ensureAudioContext();
  if (!context) return;
  const startAt = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

function playSound(name, detail = 1) {
  if (!state.soundEnabled) return;
  if (name === "deal") {
    playTone({ frequency: 260 + detail * 18, duration: 0.08, type: "triangle", volume: 0.028 });
    return;
  }
  if (name === "flip") {
    playTone({ frequency: 330 + detail * 22, duration: 0.11, type: "square", volume: 0.022 });
    playTone({ frequency: 220, duration: 0.13, type: "triangle", volume: 0.018, delay: 0.03 });
    return;
  }
  if (name === "chip") {
    playTone({ frequency: 420 + detail * 20, duration: 0.08, type: "triangle", volume: 0.03 });
    playTone({ frequency: 620 + detail * 18, duration: 0.1, type: "sine", volume: 0.024, delay: 0.02 });
    return;
  }
  if (name === "win") {
    playTone({ frequency: 392, duration: 0.16, type: "triangle", volume: 0.04 });
    playTone({ frequency: 494, duration: 0.18, type: "triangle", volume: 0.04, delay: 0.08 });
    playTone({ frequency: 587, duration: 0.24, type: "triangle", volume: 0.045, delay: 0.18 });
  }
}

function rectWithinStage(element) {
  const stageRect = els.tableStage.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - stageRect.left,
    top: rect.top - stageRect.top,
    width: rect.width,
    height: rect.height,
  };
}

function holeCardSlotRect(seatIndex, cardIndex) {
  const seatEl = els.seats[seatIndex];
  const cardsEl = document.getElementById(`seat-cards-${seatIndex}`);
  const stageRect = els.tableStage.getBoundingClientRect();
  const seatRect = seatEl.getBoundingClientRect();
  const cardsRect = cardsEl.getBoundingClientRect();
  const compact = cardsEl.classList.contains("mini-cards");
  const width = compact ? 48 : 76;
  const height = compact ? 68 : 108;
  const gap = 10;
  const baseLeft = (cardsRect.width > 0 ? cardsRect.left : seatRect.left + 18) - stageRect.left;
  const baseTop = (cardsRect.height > 0 ? cardsRect.top : seatRect.top + 72) - stageRect.top;
  return {
    left: baseLeft + cardIndex * (width + gap),
    top: baseTop,
    width,
    height,
  };
}

function cardFaceMarkup(card) {
  const rankText = displayRank(card.rank);
  const redClass = card.suit === "H" || card.suit === "D" ? " red" : "";
  const tightClass = rankText.length > 1 ? " tight" : "";
  return `
    <div class="card-rank${tightClass}">${rankText}</div>
    <div class="card-center">${SUIT_SYMBOLS[card.suit]}</div>
    <div class="card-suit">${SUIT_SYMBOLS[card.suit]}</div>
  `;
}

function seatLayout() {
  return ACTIVE_SEAT_MAP[state.activeSeatCount] || ACTIVE_SEAT_MAP[6];
}

function isSeatActive(seatIndex) {
  return seatLayout().includes(seatIndex);
}

function applyActiveSeats(count) {
  state.activeSeatCount = count;
  state.players.forEach((player) => {
    player.active = isSeatActive(player.seatIndex);
  });
  state.dealerIndex = seatLayout()[seatLayout().length - 1];
  els.tableStage.className = `table-stage players-${count}`;
}

function resetPlayerStack(player) {
  player.stack = STARTING_STACK;
  player.cards = [];
  player.folded = false;
  player.out = !player.active;
  player.allIn = false;
  player.acted = false;
  player.committed = 0;
  player.totalContribution = 0;
  player.statusText = player.active ? "等待开始" : "空座";
  player.actionTone = "wait";
  player.revealCards = player.isHuman;
  player.bestScore = null;
  player.bestLabel = "";
}

function resetTable() {
  clearAutoStart();
  els.tableStage.classList.remove("is-shuffling", "is-dealing");
  state.deck = [];
  state.communityCards = [];
  state.smallBlindIndex = null;
  state.bigBlindIndex = null;
  state.street = -1;
  state.currentBet = 0;
  state.minRaise = currentBlinds().big;
  state.currentTurnIndex = null;
  state.handActive = false;
  state.awaitingHuman = false;
  state.introAnimating = false;
  state.visibleHoleCounts = Array(TOTAL_SEATS).fill(0);
  state.revealingHoleSlots = {};
  state.pot = 0;
  state.handsPlayed = 0;
  state.blindLevelIndex = 0;
  state.actionLog = [];
  state.boardAnimatingSlots = [];
  state.players.forEach(resetPlayerStack);
  setMessage("牌桌已重置，可以开始新的牌局。");
  addLog(`牌桌重置为 ${state.activeSeatCount} 人桌。`);
  updateUI();
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, value: RANK_VALUE[rank] });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function drawCard() {
  return state.deck.shift();
}

function displayRank(rank) {
  return rank === "T" ? "10" : rank;
}

function renderCard(card, hidden = false) {
  const node = document.createElement("div");
  node.className = `card${hidden ? " back" : ""}${!hidden && (card.suit === "H" || card.suit === "D") ? " red" : ""}`;

  if (hidden) {
    node.innerHTML = `<div class="card-back-fill" aria-hidden="true"></div>`;
    return node;
  }

  const rankText = displayRank(card.rank);
  const tightClass = rankText.length > 1 ? " tight" : "";
  node.innerHTML = `
    <div class="card-rank${tightClass}">${rankText}</div>
    <div class="card-center">${SUIT_SYMBOLS[card.suit]}</div>
    <div class="card-suit">${SUIT_SYMBOLS[card.suit]}</div>
  `;
  return node;
}

function settleLiveFlipNode(node, card) {
  if (!node) return;
  node.className = `card${card.suit === "H" || card.suit === "D" ? " red" : ""}`;
  node.innerHTML = cardFaceMarkup(card);
}

async function animateNodeFlip(node, card, soundIndex = 1) {
  if (!node) return;
  node.classList.remove("placeholder", "entering", "is-visible");
  node.classList.add("flip-animating");
  node.style.transformOrigin = "center center";
  node.style.transition = "transform 170ms cubic-bezier(0.55, 0.06, 0.68, 0.19), filter 170ms ease";
  playSound("flip", soundIndex);
  await sleep(20);
  node.style.transform = "scaleX(0.04)";
  node.style.filter = "brightness(0.92)";
  await sleep(180);
  settleLiveFlipNode(node, card);
  node.classList.add("flip-animating", "flip-face-phase");
  node.style.transform = "scaleX(0.04)";
  node.style.filter = "brightness(1.04)";
  void node.offsetWidth;
  node.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), filter 220ms ease";
  node.style.transform = "scaleX(1)";
  node.style.filter = "brightness(1)";
  await sleep(230);
  node.classList.remove("flip-animating", "flip-face-phase");
  node.style.removeProperty("transition");
  node.style.removeProperty("transform");
  node.style.removeProperty("filter");
  node.style.removeProperty("transform-origin");
}

function renderEnteringCard(card, hidden = false) {
  const node = renderCard(card, hidden);
  node.classList.add("entering");
  window.requestAnimationFrame(() => {
    node.classList.add("is-visible");
  });
  return node;
}

function tagCardNode(node, metadata = {}) {
  if (metadata.boardSlot !== undefined) {
    node.dataset.boardSlot = String(metadata.boardSlot);
  }
  if (metadata.holeSeat !== undefined) {
    node.dataset.holeSeat = String(metadata.holeSeat);
  }
  if (metadata.holeSlot !== undefined) {
    node.dataset.holeSlot = String(metadata.holeSlot);
  }
  return node;
}

function findBoardCardNode(slotIndex) {
  return els.communityCards.querySelector(`[data-board-slot="${slotIndex}"]`);
}

function findHoleCardNode(seatIndex, slotIndex) {
  return document.querySelector(
    `#seat-cards-${seatIndex} [data-hole-seat="${seatIndex}"][data-hole-slot="${slotIndex}"]`
  );
}

function renderCardGroup(container, cards, hidden) {
  container.innerHTML = "";
  cards.forEach((card) => container.appendChild(renderCard(card, hidden)));
}

function renderSeatCards(player, container) {
  container.innerHTML = "";
  const revealingSlots = state.revealingHoleSlots[player.seatIndex] || [];
  const enteringSlots = state.holeEnteringSlots[player.seatIndex] || [];
  const visibleCards = state.introAnimating
    ? player.cards.slice(0, state.visibleHoleCounts[player.seatIndex] || 0)
    : player.cards;
  const hideFace = state.introAnimating || (!player.revealCards && state.handActive);

  visibleCards.forEach((card, index) => {
    if (revealingSlots.includes(index)) {
      container.appendChild(renderPlaceholderCard());
      return;
    }
    const cardNode = enteringSlots.includes(index) ? renderEnteringCard(card, hideFace) : renderCard(card, hideFace);
    container.appendChild(tagCardNode(cardNode, { holeSeat: player.seatIndex, holeSlot: index }));
  });
}

function renderPlaceholderCard() {
  const placeholder = renderCard({ rank: "A", suit: "S" }, true);
  placeholder.classList.add("placeholder");
  return placeholder;
}

function renderBoardCards() {
  els.communityCards.innerHTML = "";
  const totalSlots = 5;
  for (let index = 0; index < totalSlots; index += 1) {
    if (state.boardAnimatingSlots.includes(index)) {
      els.communityCards.appendChild(renderPlaceholderCard());
      continue;
    }
    if (index < state.communityCards.length) {
      const cardNode = state.boardEnteringSlots.includes(index)
        ? renderEnteringCard(state.communityCards[index], false)
        : renderCard(state.communityCards[index], false);
      els.communityCards.appendChild(tagCardNode(cardNode, { boardSlot: index }));
    } else if (state.handActive || state.introAnimating) {
      els.communityCards.appendChild(renderCard({ rank: "A", suit: "S" }, true));
    }
  }
}

function syncOverlayToNode(overlay, targetNode, options = {}) {
  if (!targetNode) return;
  const rect = rectWithinStage(targetNode);
  const scale = options.scale ?? 1;
  overlay.style.transition =
    "left 180ms ease, top 180ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease";
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.transform = `${overlay.classList.contains("is-flipped") ? "rotateY(180deg) " : ""}scale(${scale})`;
  overlay.style.opacity = options.opacity ?? "0.18";
}

function setPlayerAction(player, text, tone = "wait") {
  player.statusText = text;
  player.actionTone = tone;
}

function getSeatRole(seatIndex) {
  if (!isSeatActive(seatIndex)) return "";
  if (state.handActive) {
    if (seatIndex === state.dealerIndex) return "庄家";
    if (seatIndex === state.smallBlindIndex) return "小盲";
    if (seatIndex === state.bigBlindIndex) return "大盲";
    return "";
  }
  return seatIndex === state.dealerIndex ? "庄家" : "";
}

function updateSeat(player) {
  const seatEl = els.seats[player.seatIndex];
  const nameEl = document.getElementById(`seat-name-${player.seatIndex}`);
  const stackEl = document.getElementById(`seat-stack-${player.seatIndex}`);
  const cardsEl = document.getElementById(`seat-cards-${player.seatIndex}`);
  const statusEl = document.getElementById(`seat-status-${player.seatIndex}`);
  const roleTag = seatEl.querySelector("[data-role-tag]");

  seatEl.classList.toggle("is-hidden", !player.active);
  seatEl.classList.toggle("is-turn", state.currentTurnIndex === player.seatIndex && state.handActive);
  seatEl.classList.toggle("is-folded", player.folded);
  seatEl.classList.toggle("is-out", player.out && player.active);

  nameEl.textContent = player.name;
  stackEl.textContent = !player.active ? "空座" : player.out ? "已出局" : `筹码: ${player.stack}`;
  statusEl.textContent = player.active ? player.statusText : "未入座";
  statusEl.className = `seat-status tone-${player.actionTone || "wait"}`;
  renderSeatCards(player, cardsEl);

  roleTag.textContent = getSeatRole(player.seatIndex);
  roleTag.style.visibility = roleTag.textContent ? "visible" : "hidden";
}

function activePlayers() {
  return state.players.filter((player) => player.active && !player.out);
}

function contenders() {
  return state.players.filter((player) => player.active && !player.out && !player.folded);
}

function playersAbleToAct() {
  return state.players.filter((player) => player.active && !player.out && !player.folded && !player.allIn);
}

function getHumanPlayer() {
  return state.players[HUMAN_SEAT];
}

function updateBoard() {
  const blinds = currentBlinds();
  renderBoardCards();
  els.potValue.textContent = String(state.pot);
  els.currentBet.textContent = String(state.currentBet);
  els.streetLabel.textContent = state.street >= 0 ? STREET_NAMES[state.street] : "等待开始";
  els.aliveCount.textContent = String(activePlayers().length);
  els.blindInfo.textContent = `${blinds.small} / ${blinds.big}`;
  els.handCount.textContent = String(state.handsPlayed);
}

function updateControls() {
  const human = getHumanPlayer();
  const toCall = human.active ? Math.max(0, state.currentBet - human.committed) : 0;
  const maxTarget = human.committed + human.stack;
  const minTarget = Math.min(maxTarget, Math.max(state.currentBet + state.minRaise, currentBlinds().big * 2));
  const canRaise = state.awaitingHuman && !state.introAnimating && state.handActive && human.active && !human.folded && !human.allIn && maxTarget > state.currentBet;

  els.playerCountSelect.value = String(state.activeSeatCount);
  els.autoNextCheckbox.checked = state.autoNextHand;
  els.turnLabel.textContent = state.currentTurnIndex === null ? "-" : state.players[state.currentTurnIndex].name;
  els.toCallValue.textContent = String(toCall);
  els.playerCommitment.textContent = String(human.committed);

  if (maxTarget >= minTarget) {
    els.raiseInput.min = String(minTarget);
    els.raiseInput.max = String(maxTarget);
    if (Number(els.raiseInput.value) < minTarget || Number(els.raiseInput.value) > maxTarget) {
      els.raiseInput.value = String(minTarget);
    }
  } else {
    els.raiseInput.min = String(maxTarget);
    els.raiseInput.max = String(maxTarget);
    els.raiseInput.value = String(maxTarget);
  }

  els.raiseValue.textContent = els.raiseInput.value;
  els.checkCallBtn.textContent = toCall > 0 ? `跟注 ${toCall}` : "过牌";
  els.raiseBtn.textContent = state.currentBet > 0 ? "加注" : "下注";

  els.foldBtn.disabled = !state.awaitingHuman || state.introAnimating;
  els.checkCallBtn.disabled = !state.awaitingHuman || state.introAnimating;
  els.raiseInput.disabled = !canRaise;
  els.raiseBtn.disabled = !canRaise;
}

function updateUI() {
  state.players.forEach(updateSeat);
  updateBoard();
  updateControls();
  renderLog();
}

function nextEligibleIndex(startIndex, predicate) {
  for (let offset = 1; offset <= TOTAL_SEATS; offset += 1) {
    const candidateIndex = (startIndex + offset) % TOTAL_SEATS;
    const player = state.players[candidateIndex];
    if (predicate(player)) {
      return candidateIndex;
    }
  }
  return null;
}

function moveDealerButton() {
  const nextDealer = nextEligibleIndex(state.dealerIndex, (player) => player.active && !player.out);
  if (nextDealer !== null) {
    state.dealerIndex = nextDealer;
  }
}

function resetPlayerForHand(player) {
  player.cards = [];
  player.folded = !player.active || player.out;
  player.allIn = false;
  player.acted = false;
  player.committed = 0;
  player.totalContribution = 0;
  player.statusText = !player.active ? "空座" : player.out ? "已出局" : "等待发牌";
  player.revealCards = player.isHuman;
  player.bestScore = null;
  player.bestLabel = "";
}

function dealHoleCards() {
  for (let round = 0; round < 2; round += 1) {
    for (let offset = 1; offset <= TOTAL_SEATS; offset += 1) {
      const seatIndex = (state.dealerIndex + offset) % TOTAL_SEATS;
      const player = state.players[seatIndex];
      if (player.active && !player.out) {
        player.cards.push(drawCard());
      }
    }
  }
}

function postBet(player, amount) {
  const actual = Math.min(amount, player.stack);
  player.stack -= actual;
  player.committed += actual;
  player.totalContribution += actual;
  state.pot += actual;
  if (player.stack === 0) {
    player.allIn = true;
  }
  return actual;
}

function postBlind(seatIndex, amount, label) {
  const player = state.players[seatIndex];
  const paid = postBet(player, amount);
  setPlayerAction(player, `${label} ${paid}`, "call");
}

function maybeAdvanceBlindLevel() {
  if (state.handsPlayed > 0 && state.handsPlayed % 5 === 0 && state.blindLevelIndex < BLIND_LEVELS.length - 1) {
    state.blindLevelIndex += 1;
    const blinds = currentBlinds();
    addLog(`盲注升级到 ${blinds.small} / ${blinds.big}。`);
  }
}

function prepareNewHand() {
  clearAutoStart();
  const alive = activePlayers();
  if (alive.length < 2) {
    const winner = alive[0];
    setMessage(`${winner ? winner.name : "无人"}赢下整桌。请重开整桌继续。`, true);
    state.handActive = false;
    updateUI();
    return false;
  }

  state.handsPlayed += 1;
  maybeAdvanceBlindLevel();
  const blinds = currentBlinds();

  moveDealerButton();
  state.deck = shuffle(createDeck());
  state.communityCards = [];
  state.street = 0;
  state.currentBet = blinds.big;
  state.minRaise = blinds.big;
  state.currentTurnIndex = null;
  state.handActive = true;
  state.awaitingHuman = false;
  state.introAnimating = true;
  state.visibleHoleCounts = Array(TOTAL_SEATS).fill(0);
  state.pot = 0;

  state.players.forEach(resetPlayerForHand);
  dealHoleCards();

  state.smallBlindIndex = nextEligibleIndex(state.dealerIndex, (player) => player.active && !player.out);
  state.bigBlindIndex = nextEligibleIndex(state.smallBlindIndex, (player) => player.active && !player.out);

  postBlind(state.smallBlindIndex, blinds.small, "小盲");
  postBlind(state.bigBlindIndex, blinds.big, "大盲");

  state.currentTurnIndex = nextEligibleIndex(state.bigBlindIndex, (player) => player.active && !player.out && !player.folded && !player.allIn);

  state.players.forEach((player) => {
    if (player.active && !player.out && player.statusText === "等待发牌") {
      setPlayerAction(player, "待行动", "wait");
    }
  });

  setMessage(`第 ${state.handsPlayed} 手开始，盲注 ${blinds.small} / ${blinds.big}。`, true);
  return true;
}

function resetStreetState() {
  const bigBlind = currentBlinds().big;
  state.players.forEach((player) => {
    player.committed = 0;
    player.acted = !player.active || player.folded || player.out || player.allIn;
    if (player.active && !player.folded && !player.out) {
      setPlayerAction(player, player.allIn ? "全下等待" : "待行动", player.allIn ? "allin" : "wait");
    }
  });
  state.currentBet = 0;
  state.minRaise = bigBlind;
}

function bettingRoundComplete() {
  const actors = playersAbleToAct();
  if (actors.length <= 1) {
    return true;
  }
  return actors.every((player) => player.acted && player.committed === state.currentBet);
}

function setNextTurnFrom(seatIndex) {
  state.currentTurnIndex = nextEligibleIndex(seatIndex, (player) => player.active && !player.out && !player.folded && !player.allIn);
}

async function awardUncontestedPot() {
  const winner = contenders()[0];
  if (!winner) return;
  els.tableStage.classList.remove("is-shuffling", "is-dealing");
  state.introAnimating = false;
  await animatePotToWinners([winner], state.pot);
  winner.stack += state.pot;
  setPlayerAction(winner, `赢下 ${state.pot}`, "win");
  state.players.forEach((player) => {
    player.revealCards = player.isHuman;
    if (player.active && !player.out && player.stack === 0) {
      player.out = true;
      setPlayerAction(player, "已出局", "fold");
    }
  });
  const winAmount = state.pot;
  state.pot = 0;
  state.handActive = false;
  state.currentTurnIndex = null;
  state.awaitingHuman = false;
  setMessage(`${winner.name}未被跟注，赢下这一手并收下 ${winAmount}。`, true);
  playSound("win");
  updateUI();
  scheduleAutoNextHand();
}

async function advanceStreet() {
  if (!state.handActive) return;
  if (contenders().length <= 1) {
    await awardUncontestedPot();
    return;
  }

  let newCards = [];
  if (state.street === 0) {
    newCards = [drawCard(), drawCard(), drawCard()];
  } else if (state.street === 1 || state.street === 2) {
    newCards = [drawCard()];
  } else {
    showdown();
    return;
  }

  const startIndex = state.communityCards.length;
  await animateBoardCards(newCards, startIndex);
  state.street += 1;
  resetStreetState();
  state.currentTurnIndex = nextEligibleIndex(state.dealerIndex, (player) => player.active && !player.out && !player.folded && !player.allIn);
  setMessage(`${STREET_NAMES[state.street]}开始。`, true);
  updateUI();
  proceedTurn();
}

function runBoardToRiver() {
  while (state.communityCards.length < 5) {
    if (state.communityCards.length === 0) {
      state.communityCards.push(drawCard(), drawCard(), drawCard());
    } else {
      state.communityCards.push(drawCard());
    }
  }
  state.street = 4;
}

async function finishAction(player, message, animateChips = false, chipAmount = 0) {
  player.acted = true;
  if (!player.folded && !player.out) {
    if (player.allIn) {
      setPlayerAction(player, "全下", "allin");
    } else if (player.committed === state.currentBet) {
      setPlayerAction(player, state.currentBet === 0 ? "过牌" : `跟注到 ${player.committed}`, state.currentBet === 0 ? "check" : "call");
    }
  }

  setMessage(message, true);
  if (animateChips) {
    await animateBetToPot(player.seatIndex, chipAmount);
  }

  if (contenders().length <= 1) {
    state.currentTurnIndex = null;
    state.awaitingHuman = false;
    updateUI();
    window.setTimeout(() => {
      awardUncontestedPot();
    }, ACTION_DELAY);
    return;
  }

  if (bettingRoundComplete()) {
    state.currentTurnIndex = null;
    state.awaitingHuman = false;
    updateUI();
    if (playersAbleToAct().length <= 1) {
      runBoardToRiver();
      window.setTimeout(() => {
        showdown();
      }, ACTION_DELAY);
      return;
    }
    if (state.street >= 3) {
      window.setTimeout(() => {
        showdown();
      }, ACTION_DELAY);
    } else {
      window.setTimeout(() => {
        advanceStreet();
      }, ACTION_DELAY);
    }
    return;
  }

  setNextTurnFrom(player.seatIndex);
  state.awaitingHuman = false;
  updateUI();
  proceedTurn();
}

function foldPlayer(player, reason) {
  player.folded = true;
  player.acted = true;
  setPlayerAction(player, "弃牌", "fold");
  finishAction(player, reason, false, 0);
}

function callPlayer(player) {
  const toCall = Math.max(0, state.currentBet - player.committed);
  const paid = postBet(player, toCall);
  if (paid < toCall) {
    setPlayerAction(player, `全下 ${player.committed}`, "allin");
  }
  finishAction(player, `${player.name}${toCall > 0 ? `跟注 ${paid}` : "选择过牌"}。`, paid > 0, paid);
}

function markOthersPending(actingPlayer) {
  state.players.forEach((player) => {
    if (player.active && !player.out && !player.folded && !player.allIn && player.seatIndex !== actingPlayer.seatIndex) {
      player.acted = false;
      if (!player.isHuman) {
        setPlayerAction(player, "待应对", "wait");
      }
    }
  });
}

function raisePlayerTo(player, targetBet) {
  const desired = Math.min(Math.max(targetBet, state.currentBet + state.minRaise), player.committed + player.stack);
  const previousBet = state.currentBet;
  postBet(player, desired - player.committed);
  state.minRaise = Math.max(currentBlinds().big, player.committed - previousBet);
  state.currentBet = player.committed;
  markOthersPending(player);
  setPlayerAction(player, player.allIn ? `全下到 ${player.committed}` : `加注到 ${player.committed}`, player.allIn ? "allin" : "raise");
  finishAction(player, `${player.name}加注到 ${player.committed}。`, true, desired - previousBet);
}

function playerFold() {
  const player = getHumanPlayer();
  if (!state.awaitingHuman || state.currentTurnIndex !== player.seatIndex) return;
  state.awaitingHuman = false;
  foldPlayer(player, "你选择弃牌。");
}

function playerCheckCall() {
  const player = getHumanPlayer();
  if (!state.awaitingHuman || state.currentTurnIndex !== player.seatIndex) return;
  state.awaitingHuman = false;
  callPlayer(player);
}

function playerRaise() {
  const player = getHumanPlayer();
  if (!state.awaitingHuman || state.currentTurnIndex !== player.seatIndex) return;
  const target = Number(els.raiseInput.value);
  if (target <= state.currentBet || target > player.committed + player.stack) return;
  state.awaitingHuman = false;
  raisePlayerTo(player, target);
}

function getPreflopStrength(cards) {
  const values = cards.map((card) => card.value).sort((left, right) => right - left);
  const pair = values[0] === values[1];
  const suited = cards[0].suit === cards[1].suit;
  const gap = Math.abs(values[0] - values[1]);
  return values[0] + values[1] + (pair ? 18 : 0) + (suited ? 3 : 0) + (gap <= 1 ? 2 : 0);
}

function scoreFive(cards) {
  const values = cards.map((card) => card.value).sort((left, right) => right - left);
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  const groups = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return right[0] - left[0];
  });
  const isFlush = new Set(cards.map((card) => card.suit)).size === 1;
  const uniqueValues = [...new Set(values)];
  let straightHigh = 0;

  if (uniqueValues.length === 5) {
    if (uniqueValues[0] - uniqueValues[4] === 4) {
      straightHigh = uniqueValues[0];
    } else if (JSON.stringify(uniqueValues) === JSON.stringify([14, 5, 4, 3, 2])) {
      straightHigh = 5;
    }
  }

  if (isFlush && straightHigh) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (isFlush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) {
    const kickers = groups.slice(1).map(([value]) => value).sort((left, right) => right - left);
    return [3, groups[0][0], ...kickers];
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = groups.filter((group) => group[1] === 2).map(([value]) => value).sort((left, right) => right - left);
    const kicker = groups.find((group) => group[1] === 1)[0];
    return [2, ...pairs, kicker];
  }
  if (groups[0][1] === 2) {
    const kickers = groups.filter((group) => group[1] === 1).map(([value]) => value).sort((left, right) => right - left);
    return [1, groups[0][0], ...kickers];
  }
  return [0, ...values];
}

function compareScore(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function bestScore(cards) {
  let best = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const score = scoreFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareScore(score, best) > 0) {
              best = score;
            }
          }
        }
      }
    }
  }
  return best;
}

function handLabel(score) {
  return ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"][score[0]];
}

function getVisibleStrength(player) {
  if (state.street === 0) {
    return getPreflopStrength(player.cards);
  }
  return bestScore([...player.cards, ...state.communityCards])[0] * 10 + getPreflopStrength(player.cards) / 10;
}

function aiDecision(player) {
  const toCall = Math.max(0, state.currentBet - player.committed);
  const strength = getVisibleStrength(player);
  const tablePressure = Math.max(0.6, contenders().length * 0.22);
  const personality = player.personality;
  const courage = strength - toCall / (currentBlinds().big || 20) * 1.4 + personality.looseness * 3 - tablePressure;
  const canRaise = player.stack + player.committed > state.currentBet + state.minRaise;
  const bluffRoll = Math.random() < personality.bluff * 0.35;

  if (toCall >= player.stack) {
    return courage > 20 ? { type: "call" } : { type: "fold" };
  }

  if (courage < 11 && toCall > 0) {
    return Math.random() < 0.12 + personality.looseness * 0.06 ? { type: "call" } : { type: "fold" };
  }

  if (canRaise && (courage > 23 || bluffRoll)) {
    const raiseBase = state.currentBet === 0 ? currentBlinds().big * 2 : state.currentBet + Math.max(state.minRaise, currentBlinds().big);
    const extra = Math.round((strength + personality.aggression * 6) * (0.4 + Math.random() * 0.4));
    const target = Math.min(player.committed + player.stack, raiseBase + extra);
    return { type: "raise", target };
  }

  return { type: toCall > 0 ? "call" : "check" };
}

function proceedTurn() {
  updateUI();
  if (!state.handActive || state.currentTurnIndex === null || state.introAnimating) return;

  const player = state.players[state.currentTurnIndex];
  if (player.isHuman) {
    state.awaitingHuman = true;
    player.statusText = "轮到你";
    setMessage("轮到你行动。");
    updateUI();
    return;
  }

  state.awaitingHuman = false;
  player.statusText = "思考中";
  updateUI();

  window.setTimeout(() => {
    if (!state.handActive || state.currentTurnIndex !== player.seatIndex) return;
    const decision = aiDecision(player);
    if (decision.type === "fold") {
      foldPlayer(player, `${player.name}弃牌。`);
      return;
    }
    if (decision.type === "raise") {
      raisePlayerTo(player, decision.target);
      return;
    }
    callPlayer(player);
  }, ACTION_DELAY);
}

function seatDealOrder() {
  const order = [];
  for (let offset = 1; offset <= TOTAL_SEATS; offset += 1) {
    const seatIndex = (state.dealerIndex + offset) % TOTAL_SEATS;
    const player = state.players[seatIndex];
    if (player.active && !player.out) {
      order.push(seatIndex);
    }
  }
  return order;
}

function clearDisplayedHoleCards() {
  state.players.forEach((player) => {
    const cardsEl = document.getElementById(`seat-cards-${player.seatIndex}`);
    if (cardsEl) {
      cardsEl.innerHTML = "";
    }
  });
}

function createFlyingCard(startRect, endRect) {
  const stageRect = els.tableStage.getBoundingClientRect();
  const card = document.createElement("div");
  card.className = "deal-card";

  const startLeft = startRect.left - stageRect.left;
  const startTop = startRect.top - stageRect.top;
  const endLeft = endRect.left - stageRect.left;
  const endTop = endRect.top - stageRect.top;

  card.style.left = `${startLeft}px`;
  card.style.top = `${startTop}px`;
  card.style.transform = "translate(0, 0) rotate(0deg) scale(1)";
  els.tableAnimLayer.appendChild(card);

  window.requestAnimationFrame(() => {
    card.style.transition = "transform 260ms ease, opacity 260ms ease";
    card.style.transform = `translate(${endLeft - startLeft}px, ${endTop - startTop}px) rotate(${Math.random() * 18 - 9}deg) scale(0.72)`;
    card.style.opacity = "0.92";
  });

  return sleep(280).then(() => {
    card.remove();
  });
}

function potAnchorRect() {
  return rectWithinStage(document.getElementById("pot-value"));
}

function boardAnchorRect(index) {
  const board = rectWithinStage(els.communityCards);
  return {
    left: board.left + index * 86,
    top: board.top + 8,
    width: 76,
    height: 108,
  };
}

async function animateBoardCards(cards, startIndex) {
  for (let index = 0; index < cards.length; index += 1) {
    const slotIndex = startIndex + index;
    const cardNode = els.communityCards.children[slotIndex];
    await animateNodeFlip(cardNode, cards[index], index + 1);
    if (index < cards.length - 1) {
      await sleep(90);
    }
  }

  state.communityCards.push(...cards);
  updateUI();
}

function chipTier(amount) {
  if (amount >= 180) return { count: 6, className: "large" };
  if (amount >= 80) return { count: 4, className: "medium" };
  return { count: 3, className: "" };
}

async function animateChipMove(fromRect, toRect, amount = 20) {
  const tier = chipTier(amount);
  const chips = [];
  for (let index = 0; index < tier.count; index += 1) {
    const chip = document.createElement("div");
    chip.className = `chip-burst${tier.className ? ` ${tier.className}` : ""}`;
    chip.style.left = `${fromRect.left + index * 7}px`;
    chip.style.top = `${fromRect.top + index * 5}px`;
    els.chipAnimLayer.appendChild(chip);
    chips.push(chip);
  }

  window.requestAnimationFrame(() => {
    chips.forEach((chip, index) => {
      chip.style.transition = `transform 280ms ease, opacity 280ms ease`;
      chip.style.transform = `translate(${toRect.left - fromRect.left + index * 3}px, ${toRect.top - fromRect.top - index * 2}px) scale(0.95)`;
      chip.style.opacity = "0.92";
    });
  });

  playSound("chip", tier.count);
  await sleep(300);
  chips.forEach((chip) => chip.remove());
}

async function animateBetToPot(seatIndex, amount) {
  const seatRect = rectWithinStage(els.seats[seatIndex]);
  const fromRect = {
    left: seatRect.left + seatRect.width / 2 - 10,
    top: seatRect.top + seatRect.height / 2 - 10,
  };
  const potRect = potAnchorRect();
  const toRect = {
    left: potRect.left + potRect.width / 2 - 10,
    top: potRect.top + potRect.height / 2 - 10,
  };
  await animateChipMove(fromRect, toRect, amount);
}

async function animatePotToWinners(winners, amount = 120) {
  const potRect = potAnchorRect();
  for (const player of winners) {
    const seatRect = rectWithinStage(els.seats[player.seatIndex]);
    const toRect = {
      left: seatRect.left + seatRect.width / 2 - 10,
      top: seatRect.top + seatRect.height / 2 - 10,
    };
    const fromRect = {
      left: potRect.left + potRect.width / 2 - 10,
      top: potRect.top + potRect.height / 2 - 10,
    };
    await animateChipMove(fromRect, toRect, amount);
  }
}

async function animatePlayerHandReveal() {
  const player = getHumanPlayer();

  for (let index = 0; index < player.cards.length; index += 1) {
    const cardNode = findHoleCardNode(player.seatIndex, index);
    await animateNodeFlip(cardNode, player.cards[index], index + 1);
    if (index === 0) {
      await sleep(110);
    }
  }
  player.revealCards = true;
  updateUI();
}

async function playHandIntro() {
  const deckRect = els.deckStack.getBoundingClientRect();
  const order = seatDealOrder();
  els.tableStage.classList.add("is-shuffling");
  clearDisplayedHoleCards();
  updateUI();
  await sleep(760);
  els.tableStage.classList.remove("is-shuffling");
  els.tableStage.classList.add("is-dealing");

  for (let round = 0; round < 2; round += 1) {
    for (const seatIndex of order) {
      const seatEl = els.seats[seatIndex];
      const targetRect = {
        left: holeCardSlotRect(seatIndex, round).left + els.tableStage.getBoundingClientRect().left,
        top: holeCardSlotRect(seatIndex, round).top + els.tableStage.getBoundingClientRect().top,
      };
      seatEl.classList.add("is-deal-target");
      await createFlyingCard(deckRect, targetRect);
      playSound("deal", round * 3 + seatIndex + 1);
      seatEl.classList.remove("is-deal-target");
      state.visibleHoleCounts[seatIndex] += 1;
      updateUI();
      await sleep(55);
    }
  }

  els.tableStage.classList.remove("is-dealing");
}

function awardChips(winners, amount) {
  const base = Math.floor(amount / winners.length);
  let remainder = amount % winners.length;
  winners.forEach((player) => {
    player.stack += base;
    if (remainder > 0) {
      player.stack += 1;
      remainder -= 1;
    }
  });
  return winners;
}

async function showdown() {
  els.tableStage.classList.remove("is-shuffling", "is-dealing");
  state.street = 4;
  state.handActive = false;
  state.awaitingHuman = false;
  state.currentTurnIndex = null;
  state.introAnimating = false;

  const liveContenders = contenders();
  liveContenders.forEach((player) => {
    player.revealCards = true;
    player.bestScore = bestScore([...player.cards, ...state.communityCards]);
    player.bestLabel = handLabel(player.bestScore);
    player.statusText = player.bestLabel;
  });

  const levels = [...new Set(state.players
    .filter((player) => player.active)
    .map((player) => player.totalContribution)
    .filter((value) => value > 0))]
    .sort((a, b) => a - b);

  let previousLevel = 0;
  const results = [];
  const allWinnerGroups = [];

  for (const level of levels) {
    const contributors = state.players.filter((player) => player.active && player.totalContribution >= level);
    const amount = (level - previousLevel) * contributors.length;
    const eligible = liveContenders.filter((player) => player.totalContribution >= level);
    previousLevel = level;

    if (!eligible.length || amount <= 0) continue;

    let winners = [eligible[0]];
    let topScore = eligible[0].bestScore;

    for (let index = 1; index < eligible.length; index += 1) {
      const comparison = compareScore(eligible[index].bestScore, topScore);
      if (comparison > 0) {
        winners = [eligible[index]];
        topScore = eligible[index].bestScore;
      } else if (comparison === 0) {
        winners.push(eligible[index]);
      }
    }

    awardChips(winners, amount);
    allWinnerGroups.push(winners);
    results.push(`${winners.map((player) => player.name).join(" / ")}赢得 ${amount}`);
  }

  for (const winners of allWinnerGroups) {
    await animatePotToWinners(winners, Math.max(80, Math.round(state.pot / Math.max(1, allWinnerGroups.length))));
  }

  state.pot = 0;
  state.players.forEach((player) => {
    if (player.active && !player.out && player.stack === 0) {
      player.out = true;
      player.statusText = "已出局";
    }
  });

  const summary = liveContenders.map((player) => `${player.name} ${player.bestLabel}`).join("，");
  setMessage(`摊牌：${summary}。${results.join("；")}。`, true);
  playSound("win");
  updateUI();
  scheduleAutoNextHand();
}

function scheduleAutoNextHand() {
  clearAutoStart();
  if (!state.autoNextHand) return;
  if (activePlayers().length < 2) return;
  state.pendingAutoStart = window.setTimeout(() => {
    state.pendingAutoStart = null;
    startHand();
  }, 1500);
}

function startHand() {
  if (state.handActive) return;
  if (!prepareNewHand()) return;
  if (playersAbleToAct().length <= 1) {
    runBoardToRiver();
    showdown();
    return;
  }
  updateUI();
  playHandIntro().then(() => {
    animatePlayerHandReveal().then(() => {
      state.introAnimating = false;
      updateUI();
      proceedTurn();
    });
  });
}

function syncSoundPreference(enabled) {
  state.soundEnabled = enabled;
  els.soundToggleCheckbox.checked = enabled;
  if (!enabled && state.audioContext) {
    state.audioContext.suspend().catch(() => {});
  } else {
    ensureAudioContext();
  }
}

els.raiseInput.addEventListener("input", () => {
  els.raiseValue.textContent = els.raiseInput.value;
  ensureAudioContext();
});

els.foldBtn.addEventListener("click", () => {
  ensureAudioContext();
  playerFold();
});
els.checkCallBtn.addEventListener("click", () => {
  ensureAudioContext();
  playerCheckCall();
});
els.raiseBtn.addEventListener("click", () => {
  ensureAudioContext();
  playerRaise();
});
els.newHandBtn.addEventListener("click", () => {
  ensureAudioContext();
  startHand();
});

els.playerCountSelect.addEventListener("change", (event) => {
  const nextCount = Number(event.target.value);
  applyActiveSeats(nextCount);
  resetTable();
});

els.autoNextCheckbox.addEventListener("change", (event) => {
  state.autoNextHand = event.target.checked;
  if (!state.handActive) {
    scheduleAutoNextHand();
  }
  updateUI();
});

els.soundToggleCheckbox.addEventListener("change", (event) => {
  syncSoundPreference(event.target.checked);
});

els.resetTableBtn.addEventListener("click", () => {
  ensureAudioContext();
  applyActiveSeats(Number(els.playerCountSelect.value));
  resetTable();
});

applyActiveSeats(6);
syncSoundPreference(true);
resetTable();

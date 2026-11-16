import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";

const VALUES = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
const MATE = 30000;
let stopped = false;
let nodes = 0;
let deadline = 0;
let table = new Map();

self.onmessage = ({ data }) => {
  if (data.type === "stop") {
    stopped = true;
    return;
  }
  if (data.type !== "search") return;
  stopped = false;
  nodes = 0;
  table = new Map();
  deadline = Date.now() + data.timeLimit;
  const game = new Chess(data.fen);
  const rootMoves = orderMoves(game, game.moves({ verbose: true }));
  if (!rootMoves.length) {
    self.postMessage({ type: "done", move: null, nodes });
    return;
  }

  let best = rootMoves[0];
  const maxDepth = data.level === "advanced" ? 8 : data.level === "club" ? 5 : 2;
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const iteration = findRootMove(game, depth, best);
      best = iteration.move;
      self.postMessage({
        type: "progress",
        depth,
        score: iteration.score,
        nodes
      });
    } catch (error) {
      if (error.message !== "search-timeout") throw error;
      break;
    }
    if (Math.abs(best.score || 0) >= MATE - 100) break;
  }

  self.postMessage({
    type: "done",
    move: { from: best.from, to: best.to, promotion: best.promotion },
    nodes
  });
};

function findRootMove(game, depth, previousBest) {
  const moves = orderMoves(game, game.moves({ verbose: true }), uci(previousBest));
  let bestMove = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of moves) {
    checkTime();
    game.move(move);
    const score = -search(game, depth - 1, -beta, -alpha, 1);
    game.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, score);
  }
  bestMove.score = bestScore;
  return { move: bestMove, score: bestScore };
}

function search(game, depth, alpha, beta, ply) {
  if ((++nodes & 1023) === 0) checkTime();
  if (game.isDraw()) return 0;

  const key = game.fen();
  const originalAlpha = alpha;
  const cached = table.get(key);
  if (cached && cached.depth >= depth && ply > 0) {
    if (cached.flag === "exact") return cached.score;
    if (cached.flag === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.flag === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  if (depth <= 0) return quiescence(game, alpha, beta, ply, 5);

  const moves = orderMoves(game, game.moves({ verbose: true }), cached?.best);
  if (!moves.length) return game.isCheck() ? -MATE + ply : 0;

  let bestScore = -Infinity;
  let bestMove = null;
  for (const move of moves) {
    game.move(move);
    const score = -search(game, depth - 1, -beta, -alpha, ply + 1);
    game.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMove = uci(move);
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }

  if (table.size > 120000) table.clear();
  const flag = bestScore <= originalAlpha ? "upper" : bestScore >= beta ? "lower" : "exact";
  table.set(key, { depth, score: bestScore, flag, best: bestMove });
  return bestScore;
}

function quiescence(game, alpha, beta, ply, remaining) {
  if ((++nodes & 1023) === 0) checkTime();
  if (game.isDraw()) return 0;

  const inCheck = game.isCheck();
  const standPat = sideScore(game);
  if (!inCheck) {
    if (standPat >= beta) return beta;
    alpha = Math.max(alpha, standPat);
    if (remaining <= 0) return standPat;
  }

  const moves = game.moves({ verbose: true })
    .filter(move => inCheck || move.captured || move.promotion)
    .sort((a, b) => moveOrder(b) - moveOrder(a));
  if (!moves.length && inCheck) return -MATE + ply;

  for (const move of moves) {
    game.move(move);
    const score = -quiescence(game, -beta, -alpha, ply + 1, remaining - 1);
    game.undo();
    if (score >= beta) return beta;
    alpha = Math.max(alpha, score);
  }
  return alpha;
}

function sideScore(game) {
  const board = game.board();
  let score = 0;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (!piece) continue;
      const sign = piece.color === "w" ? 1 : -1;
      const advance = piece.color === "w" ? 6 - rank : rank - 1;
      const center = 7 - Math.abs(2 * file - 7) - Math.abs(2 * rank - 7);
      let positional = 0;
      if (piece.type === "p") positional = advance * 7 + Math.max(0, center) * 2;
      if (piece.type === "n") positional = center * 5;
      if (piece.type === "b") positional = center * 3;
      if (piece.type === "q") positional = center;
      if (piece.type === "k" && game.history().length < 20) positional = -center * 3;
      score += sign * (VALUES[piece.type] + positional);
    }
  }
  return game.turn() === "w" ? score : -score;
}

function orderMoves(game, moves, preferred) {
  return moves.sort((a, b) => {
    const aKey = uci(a), bKey = uci(b);
    if (aKey === preferred) return -1;
    if (bKey === preferred) return 1;
    const aScore = moveOrder(a) + (a.san.includes("+") ? 35 : 0);
    const bScore = moveOrder(b) + (b.san.includes("+") ? 35 : 0);
    return bScore - aScore;
  });
}

function moveOrder(move) {
  const capture = move.captured
    ? 10 * VALUES[move.captured] - VALUES[move.piece]
    : 0;
  const promotion = move.promotion ? VALUES[move.promotion] : 0;
  return capture + promotion;
}

function uci(move) {
  return move ? move.from + move.to + (move.promotion || "") : "";
}

function checkTime() {
  if (stopped || Date.now() >= deadline) throw new Error("search-timeout");
}

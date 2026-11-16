import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";

const PIECES = { wk:"♔", wq:"♕", wr:"♖", wb:"♗", wn:"♘", wp:"♙", bk:"♚", bq:"♛", br:"♜", bb:"♝", bn:"♞", bp:"♟" };
const PIECE_NAMES = { p:"pawn", n:"knight", b:"bishop", r:"rook", q:"queen", k:"king" };

class ChessGame {
  constructor(root, options = {}) {
    this.root = root;
    this.mode = options.mode || "bot";
    this.level = "club";
    this.game = new Chess();
    this.history = [];
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = [];
    this.flipped = false;
    this.worker = null;
    this.renderShell();
    this.bindEvents();
    this.render();
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="ic-chess-shell">
        <section class="ic-chess-main" aria-label="Chess game">
          <div class="ic-chess-toolbar">
            <label class="ic-chess-control"><span>Play</span>
              <select data-control="mode" aria-label="Play mode">
                <option value="local">Two players</option>
                <option value="bot">Vs computer</option>
              </select>
            </label>
            <label class="ic-chess-control" data-level-control><span>Computer</span>
              <select data-control="level" aria-label="Computer strength">
                <option value="casual">Casual</option>
                <option value="club" selected>Club</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <button class="ic-chess-new" data-action="new" type="button">New game</button>
          </div>
          <div class="ic-chess-status" data-status role="status" aria-live="polite"></div>
          <div class="ic-chess-board" data-board role="group" aria-label="Chessboard"></div>
          <div class="ic-chess-below">
            <span class="ic-chess-board-hint">White moves first · click a piece, then a square</span>
            <button class="ic-chess-quiet-button" data-action="flip" type="button">Flip board</button>
          </div>
        </section>
        <aside class="ic-chess-side">
          <section class="ic-chess-panel">
            <div class="ic-chess-panel-title">Captured pieces</div>
            <div class="ic-chess-capture-row"><span>White</span><div data-captured="white">—</div></div>
            <div class="ic-chess-capture-row"><span>Black</span><div data-captured="black">—</div></div>
          </section>
          <section class="ic-chess-panel">
            <div class="ic-chess-panel-heading"><div class="ic-chess-panel-title">Moves</div>
              <button class="ic-chess-quiet-button" data-action="undo" type="button">Undo</button>
            </div>
            <div class="ic-chess-moves" data-moves>No moves yet</div>
          </section>
          <details class="ic-chess-tools">
            <summary>Position tools</summary>
            <label for="ic-chess-fen">FEN position</label>
            <textarea id="ic-chess-fen" data-fen rows="3" spellcheck="false"></textarea>
            <div class="ic-chess-tool-actions">
              <button data-action="copy-fen" type="button">Copy FEN</button>
              <button data-action="load-fen" type="button">Load FEN</button>
              <button data-action="download-pgn" type="button">Download PGN</button>
            </div>
          </details>
        </aside>
      </div>`;
    this.root.querySelector('[data-control="mode"]').value = this.mode;
    this.syncModeControls();
  }

  bindEvents() {
    this.root.addEventListener("click", event => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "new") this.newGame();
      if (action === "undo") this.undo();
      if (action === "flip") { this.flipped = !this.flipped; this.drawBoard(); }
      if (action === "copy-fen") this.copyFen();
      if (action === "load-fen") this.loadFen();
      if (action === "download-pgn") this.downloadPgn();
      const square = event.target.closest("[data-square]")?.dataset.square;
      if (square) this.tapSquare(square);
    });
    this.root.querySelector('[data-control="mode"]').addEventListener("change", event => {
      this.mode = event.target.value;
      this.newGame();
      this.syncModeControls();
    });
    this.root.querySelector('[data-control="level"]').addEventListener("change", event => {
      this.level = event.target.value;
      if (this.mode === "bot" && this.game.turn() === "b") this.requestBotMove();
    });
  }

  syncModeControls() {
    this.root.querySelector("[data-level-control]").hidden = this.mode !== "bot";
  }

  newGame() {
    this.stopBot();
    this.game.reset();
    this.history = [];
    this.lastMove = [];
    this.selected = null;
    this.legalMoves = [];
    this.render();
  }

  undo() {
    if (!this.history.length) return;
    this.stopBot();
    this.game = new Chess(this.history.pop());
    if (this.mode === "bot" && this.history.length) this.game = new Chess(this.history.pop());
    this.lastMove = [];
    this.selected = null;
    this.legalMoves = [];
    this.render();
  }

  tapSquare(square) {
    if (this.game.isGameOver() || (this.mode === "bot" && this.game.turn() === "b")) return;
    const piece = this.game.get(square);
    if (this.selected && this.legalMoves.some(move => move.to === square)) {
      let promotion = "q";
      if (this.game.get(this.selected)?.type === "p" && ["1", "8"].includes(square[1])) {
        const choice = prompt("Promote to queen, rook, bishop, or knight?", "q");
        if (!choice || !["q", "r", "b", "n"].includes(choice.toLowerCase())) return;
        promotion = choice.toLowerCase();
      }
      this.makeMove(this.selected, square, promotion);
      return;
    }
    if (piece && piece.color === this.game.turn()) {
      this.selected = square;
      this.legalMoves = this.game.moves({ square, verbose: true });
    } else {
      this.selected = null;
      this.legalMoves = [];
    }
    this.render();
  }

  makeMove(from, to, promotion) {
    try {
      this.history.push(this.game.fen());
      const move = this.game.move({ from, to, promotion });
      if (!move) { this.history.pop(); return; }
      this.lastMove = [from, to];
      this.selected = null;
      this.legalMoves = [];
      this.render();
      if (this.mode === "bot" && this.game.turn() === "b" && !this.game.isGameOver()) this.requestBotMove();
    } catch {
      this.history.pop();
    }
  }

  requestBotMove() {
    this.stopBot();
    const worker = new Worker(new URL("./bot-worker.js", import.meta.url), { type: "module" });
    this.worker = worker;
    const status = this.root.querySelector("[data-status]");
    status.textContent = "Computer is thinking…";
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return;
      if (data.type === "progress") {
        status.textContent = "Thinking · depth " + data.depth;
        return;
      }
      if (data.type === "done") {
        this.worker = null;
        worker.terminate();
        if (data.move && this.game.turn() === "b") this.makeMove(data.move.from, data.move.to, data.move.promotion || "q");
        else this.render();
      }
    };
    worker.onerror = () => {
      this.worker = null;
      worker.terminate();
      status.textContent = "Computer unavailable. Try a new game.";
    };
    worker.postMessage({
      type: "search",
      fen: this.game.fen(),
      level: this.level,
      timeLimit: this.level === "advanced" ? 1800 : this.level === "club" ? 700 : 180
    });
  }

  stopBot() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }

  render() { this.drawBoard(); this.drawSidebar(); }

  drawBoard() {
    const boardElement = this.root.querySelector("[data-board]");
    boardElement.replaceChildren();
    const board = this.game.board();
    for (let index = 0; index < 64; index++) {
      const row = Math.floor(index / 8);
      const column = index % 8;
      const rank = this.flipped ? row + 1 : 8 - row;
      const file = this.flipped ? 7 - column : column;
      const square = String.fromCharCode(97 + file) + rank;
      const piece = board[8 - rank][file];
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.square = square;
      button.className = "ic-chess-square " + ((file + rank) % 2 ? "ic-chess-dark" : "ic-chess-light");
      button.setAttribute("aria-label", square + ", " + (piece ? (piece.color === "w" ? "white " : "black ") + PIECE_NAMES[piece.type] : "empty"));
      button.textContent = piece ? PIECES[piece.color + piece.type] : "";
      if (this.selected === square) button.classList.add("ic-chess-selected");
      if (this.lastMove.includes(square)) button.classList.add("ic-chess-last");
      if (this.legalMoves.some(move => move.to === square)) button.classList.add(this.game.get(square) ? "ic-chess-capture" : "ic-chess-legal");
      boardElement.append(button);
    }
  }

  drawSidebar() {
    const moves = this.game.history();
    this.root.querySelector("[data-moves]").textContent = moves.length
      ? moves.map((move, index) => (index % 2 === 0 ? Math.floor(index / 2) + 1 + ". " : "") + move).join("  ")
      : "No moves yet";
    const captures = this.game.history({ verbose: true }).filter(move => move.captured);
    this.root.querySelector('[data-captured="white"]').textContent =
      captures.filter(move => move.color === "w").map(move => PIECES["b" + move.captured]).join(" ") || "—";
    this.root.querySelector('[data-captured="black"]').textContent =
      captures.filter(move => move.color === "b").map(move => PIECES["w" + move.captured]).join(" ") || "—";

    const status = this.root.querySelector("[data-status]");
    if (this.worker) status.textContent = "Computer is thinking…";
    else if (this.game.isCheckmate()) status.textContent = "Checkmate · " + (this.game.turn() === "w" ? "Black" : "White") + " wins";
    else if (this.game.isDraw()) status.textContent = "Game drawn";
    else status.textContent = (this.game.turn() === "w" ? "White" : "Black") + " to move" + (this.game.isCheck() ? " · Check" : "");
    this.root.querySelector("[data-fen]").value = this.game.fen();
    this.root.querySelector('[data-action="undo"]').disabled = !this.history.length;
  }

  async copyFen() {
    const button = this.root.querySelector("[data-action='copy-fen']");
    try {
      await navigator.clipboard.writeText(this.game.fen());
      button.textContent = "Copied";
      setTimeout(() => { if (button.isConnected) button.textContent = "Copy FEN"; }, 1200);
    } catch {
      const field = this.root.querySelector("[data-fen]");
      field.focus();
      field.select();
    }
  }

  loadFen() {
    try {
      this.stopBot();
      this.game = new Chess(this.root.querySelector("[data-fen]").value.trim());
      this.history = [];
      this.lastMove = [];
      this.selected = null;
      this.legalMoves = [];
      this.render();
    } catch {
      this.root.querySelector("[data-status]").textContent = "That FEN position is invalid.";
    }
  }

  downloadPgn() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([this.game.pgn()], { type: "text/plain" }));
    link.download = "israelcraft-game.pgn";
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

let activeGame = null;
export const ICChess = {
  init(options = {}) {
    const root = typeof options.root === "string" ? document.querySelector(options.root) : options.root || document.querySelector("#ic-chess-root");
    if (!root) throw new Error("ICChess root not found");
    activeGame?.stopBot();
    activeGame = new ChessGame(root, options);
    return activeGame;
  },
  exportFEN() { return activeGame?.game.fen() || null; },
  exportPGN() { return activeGame?.game.pgn() || null; },
  loadFEN(fen) {
    if (!activeGame) return false;
    try {
      activeGame.stopBot();
      activeGame.game = new Chess(fen);
      activeGame.history = [];
      activeGame.render();
      return true;
    } catch { return false; }
  },
  newGame() { activeGame?.newGame(); },
  destroy() {
    activeGame?.stopBot();
    activeGame?.root.replaceChildren();
    activeGame = null;
  }
};

window.ICChess = ICChess;
if (document.querySelector("#ic-chess-root")) ICChess.init();

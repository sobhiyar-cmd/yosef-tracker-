import { useState, useEffect, useRef } from "react";
import { supabase, getWins, addWin, resetWins, getHistory, addHistory, removeHistory } from "./db.js";

let uid = 1;

const SAVE_KEY = "yosef_current";
const GOLD = "#c9a227";
const DARK = "#1a1a1a";

// ── current game persisted locally only ──────────────────────────────────────

function loadCurrent() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function saveCurrent(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch {}
}
function clearCurrent() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

// ── win probability ───────────────────────────────────────────────────────────

function winProb(players) {
  const active = players.filter(p => !p.out);
  if (!active.length) return {};
  const dists = active.map(p => ({ id: p.id, d: Math.max(0, 100 - p.total) }));
  const sum = dists.reduce((a, x) => a + x.d, 0);
  const r = {};
  if (sum === 0) active.forEach(p => { r[p.id] = Math.round(100 / active.length); });
  else dists.forEach(x => { r[x.id] = Math.round((x.d / sum) * 100); });
  return r;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState({});
  const [round, setRound] = useState(1);
  const [input, setInput] = useState("");
  const [gameName, setGameName] = useState("");
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedGame, setExpandedGame] = useState(null);
  const [flashSaved, setFlashSaved] = useState(false);
  const [wins, setWins] = useState({});
  const [showAllTime, setShowAllTime] = useState(false);
  const [confirmClearWins, setConfirmClearWins] = useState(false);

  const autoSavedRef = useRef(false);
  const loadingRef = useRef(true);

  // ── load on mount ──
  useEffect(() => {
    const saved = loadCurrent();
    if (saved?.players?.length) {
      setPlayers(saved.players);
      setScores(saved.scores || {});
      setRound(saved.round || 1);
      setGameName(saved.gameName || "");
      uid = Math.max(1, ...saved.players.map(p => p.id)) + 1;
    }
    getHistory().then(setHistory);
    getWins().then(setWins);
    loadingRef.current = false;
  }, []);

  // ── real-time subscriptions (Supabase only) ──
  useEffect(() => {
    if (!supabase) return;
    const winsCh = supabase
      .channel("wins-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "wins" }, () => {
        getWins().then(setWins);
      })
      .subscribe();
    const historyCh = supabase
      .channel("history-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "game_history" }, () => {
        getHistory().then(setHistory);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(winsCh);
      supabase.removeChannel(historyCh);
    };
  }, []);

  // ── derived state ──
  const active = players.filter(p => !p.out);
  const eliminated = players.filter(p => p.out);
  const gameOver = players.length > 1 && eliminated.length > 0 && active.length <= 1;
  const winner = gameOver ? active[0] ?? null : null;

  // ── auto-save current game state locally ──
  useEffect(() => {
    if (loadingRef.current) return;
    if (players.length === 0 && round === 1) return;
    saveCurrent({ players, scores, round, gameName });
  }, [players, scores, round, gameName]);

  // ── persist completed game + win when game ends ──
  useEffect(() => {
    if (!gameOver || players.length === 0 || autoSavedRef.current) return;
    autoSavedRef.current = true;
    const entry = buildHistoryEntry(players, round, gameName, winner, false);
    addHistory(entry).then(() => getHistory().then(setHistory));
    if (winner) addWin(winner.name).then(() => getWins().then(setWins));
    clearCurrent();
  }, [gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── helpers ──
  function buildHistoryEntry(ps, r, name, win, incomplete) {
    return {
      id: Date.now(),
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      gameName: name.trim() || null,
      winner: win?.name ?? (incomplete ? "(in progress)" : "Draw"),
      rounds: r - 1,
      incomplete,
      players: [...ps].sort((a, b) => a.total - b.total).map(p => ({
        name: p.name, score: p.total, out: p.out,
      })),
    };
  }

  const add = () => {
    const n = input.trim();
    if (!n || gameOver) return;
    setPlayers(p => [...p, { id: uid++, name: n, total: 0, out: false }]);
    setInput("");
  };

  const del = id => {
    setPlayers(p => p.filter(x => x.id !== id));
    setScores(s => { const n = { ...s }; delete n[id]; return n; });
  };

  const zero = id => setScores(s => ({ ...s, [id]: 0 }));

  const setScore = (id, v) => setScores(s => {
    const n = { ...s };
    if (v === "") delete n[id]; else n[id] = Number(v);
    return n;
  });

  const ready = active.length > 0 && active.every(p => scores[p.id] !== undefined);

  const next = () => {
    if (!ready || gameOver) return;
    setPlayers(ps => ps.map(p => {
      if (p.out) return p;
      const t = p.total + Number(scores[p.id]);
      return { ...p, total: t, out: t >= 100 };
    }));
    setRound(r => r + 1);
    setScores({});
  };

  const saveSnapshot = async () => {
    if (!players.length) return;
    const entry = buildHistoryEntry(players, round, gameName, winner, !gameOver);
    await addHistory(entry);
    getHistory().then(setHistory);
    setFlashSaved(true);
    setTimeout(() => setFlashSaved(false), 1800);
  };

  const reset = () => {
    setPlayers([]); setScores({}); setRound(1); setInput("");
    setGameName(""); setShowNameEdit(false);
    setConfirmClearWins(false);
    autoSavedRef.current = false;
    clearCurrent();
  };

  const deleteHistoryEntry = async id => {
    await removeHistory(id);
    setHistory(h => h.filter(e => e.id !== id));
    if (expandedGame === id) setExpandedGame(null);
  };

  // ── sorted views ──
  const sorted = [...players].sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    return a.total - b.total;
  });
  const leader = sorted.find(p => !p.out);
  const prob = winProb(players);
  const probList = [...active].sort((a, b) => (prob[b.id] || 0) - (prob[a.id] || 0));

  // ── render ────────────────────────────────────────────────────────────────
  const panels = players.length > 0 && (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: "#0f0f0f", border: "1px solid #1a1a1a", padding: 14 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: GOLD, marginBottom: 10, fontWeight: 700 }}>
          Leaderboard
        </div>
        {sorted.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid #161616", fontSize: 11 }}>
            <span style={{ color: i === 0 && !p.out ? GOLD : "#2a2a2a", width: 14, flexShrink: 0 }}>{i + 1}</span>
            <span style={{ flex: 1, textTransform: "uppercase", letterSpacing: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: p.out ? "line-through" : "none", color: p.out ? "#4a2222" : "#999" }}>
              {p.name}
            </span>
            <span style={{ fontWeight: 700, color: p.out ? "#4a2222" : i === 0 ? GOLD : "#888" }}>{p.total}</span>
          </div>
        ))}
      </div>

      {active.length > 0 && !gameOver && (
        <div style={{ background: "#0f0f0f", border: "1px solid #1a1a1a", padding: 14 }}>
          <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: GOLD, marginBottom: 4, fontWeight: 700 }}>Win Prob</div>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#333", textTransform: "uppercase", marginBottom: 10 }}>Distance from 100</div>
          {probList.map(p => {
            const pct = prob[p.id] || 0;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 52, fontSize: 9, textTransform: "uppercase", color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{p.name}</div>
                <div style={{ flex: 1, height: 3, background: "#1a1a1a" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: GOLD, transition: "width 0.4s" }} />
                </div>
                <div style={{ fontSize: 10, color: GOLD, width: 28, textAlign: "right", flexShrink: 0 }}>{pct}%</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const winsEntries = Object.entries(wins)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const winsMax = winsEntries[0]?.count || 1;

  return (
    <div style={{ background: "#111", minHeight: "100vh", color: "#ccc", fontFamily: "monospace", fontSize: 13 }}>
      <style>{`
        @keyframes glow { 0%,100%{box-shadow:0 0 10px #c9a22799} 50%{box-shadow:0 0 22px #c9a227cc} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
        input[type=number]{-moz-appearance:textfield}
        button{cursor:pointer}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#111}
        ::-webkit-scrollbar-thumb{background:#2a2a2a}
        .wrap { padding: 20px 16px; }
        .body { display: block; }
        .sidebar { display: none; }
        .mobile-panels { margin-top: 20px; }
        @media (min-width: 680px) {
          .wrap { padding: 28px 40px; }
          .body { display: grid; grid-template-columns: 1fr 270px; gap: 24px; align-items: start; }
          .sidebar { display: block; }
          .mobile-panels { display: none; }
        }
        @media (min-width: 1000px) {
          .wrap { padding: 32px 60px; }
          .body { grid-template-columns: 1fr 300px; gap: 32px; }
        }
        @media (min-width: 1400px) {
          .wrap { padding: 36px 100px; }
          .body { grid-template-columns: 1fr 340px; gap: 40px; }
        }
      `}</style>

      <div className="wrap">
        {/* Header */}
        <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 6, color: GOLD, lineHeight: 1 }}>YOSEF</div>
        <div style={{ fontSize: 9, letterSpacing: 3, color: "#555", textTransform: "uppercase", marginBottom: 4 }}>Score Tracker</div>

        {/* Game name */}
        <div style={{ marginBottom: 14, minHeight: 20 }}>
          {showNameEdit ? (
            <input autoFocus value={gameName}
              onChange={e => setGameName(e.target.value)}
              onBlur={() => setShowNameEdit(false)}
              onKeyDown={e => e.key === "Enter" && setShowNameEdit(false)}
              placeholder="Game name..."
              style={{ background: "transparent", border: "none", borderBottom: "1px solid #333", color: "#888", fontFamily: "monospace", fontSize: 10, letterSpacing: 2, padding: "2px 0", outline: "none", width: 200 }}
            />
          ) : (
            <span onClick={() => !gameOver && setShowNameEdit(true)}
              style={{ fontSize: 9, letterSpacing: 2, color: gameName ? "#666" : "#2a2a2a", textTransform: "uppercase", cursor: gameOver ? "default" : "pointer" }}>
              {gameName || (gameOver ? "" : "· name this game")}
            </span>
          )}
        </div>

        <div style={{ height: 1, background: "#1e1e1e", marginBottom: 16 }} />

        {/* Winner banner */}
        {gameOver && (
          <div style={{ background: "#140f00", border: `1px solid ${GOLD}44`, padding: "18px 20px", marginBottom: 18, animation: "fadeIn 0.5s ease", textAlign: "center" }}>
            {winner ? (
              <>
                <div style={{ fontSize: 9, letterSpacing: 4, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>Winner</div>
                <div style={{ fontSize: 30, fontWeight: 900, color: GOLD, letterSpacing: 4, textTransform: "uppercase" }}>{winner.name}</div>
                <div style={{ fontSize: 9, color: "#444", marginTop: 6, letterSpacing: 2 }}>{round - 1} rounds · saved to history</div>
              </>
            ) : (
              <div style={{ fontSize: 16, fontWeight: 900, color: "#888", letterSpacing: 3 }}>DRAW</div>
            )}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, letterSpacing: 2, color: "#555", textTransform: "uppercase" }}>Round</span>
          <span style={{ fontSize: 22, fontWeight: 900, color: GOLD, marginRight: 6 }}>{round}</span>

          {!gameOver && <Btn onClick={next} gold={ready} style={{ animation: ready ? "glow 1.8s infinite" : "none" }}>Next →</Btn>}
          {gameOver && <Btn onClick={reset} style={{ borderColor: GOLD, color: GOLD }}>New Game</Btn>}
          {!gameOver && players.length > 0 && (
            <Btn onClick={saveSnapshot} style={{ borderColor: flashSaved ? GOLD : "#1e3a1e", color: flashSaved ? GOLD : "#3a7a3a" }}>
              {flashSaved ? "Saved ✓" : "Save"}
            </Btn>
          )}
          {!gameOver && <Btn onClick={reset} style={{ borderColor: "#3a1a1a", color: "#7a3a3a" }}>Reset</Btn>}

          <Btn onClick={() => setShowAllTime(v => !v)} style={{ marginLeft: "auto", borderColor: showAllTime ? GOLD : "#222", color: showAllTime ? GOLD : "#555" }}>
            All-Time
          </Btn>
          <Btn onClick={() => setShowHistory(v => !v)} style={{ borderColor: showHistory ? GOLD : "#222", color: showHistory ? GOLD : "#555" }}>
            History{history.length > 0 ? ` (${history.length})` : ""}
          </Btn>
        </div>

        {/* All-Time wins panel */}
        {showAllTime && (
          <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", padding: 14, marginBottom: 18, animation: "fadeIn 0.2s ease" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: GOLD, fontWeight: 700, flex: 1 }}>All-Time Wins</div>
              {winsEntries.length > 0 && !confirmClearWins && (
                <button onClick={() => setConfirmClearWins(true)} style={{ background: "none", border: "none", color: "#333", fontFamily: "monospace", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Clear</button>
              )}
              {confirmClearWins && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 9, color: "#666", letterSpacing: 1 }}>Sure?</span>
                  <button onClick={async () => { await resetWins(); setWins({}); setConfirmClearWins(false); }} style={{ background: "none", border: "none", color: "#c04040", fontFamily: "monospace", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>Yes</button>
                  <button onClick={() => setConfirmClearWins(false)} style={{ background: "none", border: "none", color: "#555", fontFamily: "monospace", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>No</button>
                </div>
              )}
            </div>
            {winsEntries.length === 0 ? (
              <div style={{ color: "#333", fontSize: 10, textAlign: "center", padding: "16px 0", letterSpacing: 2 }}>No wins recorded yet</div>
            ) : winsEntries.map((e, i) => (
              <div key={e.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                <span style={{ color: i === 0 ? GOLD : "#2a2a2a", width: 14, fontSize: 10, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ width: 110, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: i === 0 ? GOLD : "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {e.name}
                </span>
                <div style={{ flex: 1, height: 3, background: "#1a1a1a" }}>
                  <div style={{ height: "100%", width: `${Math.round((e.count / winsMax) * 100)}%`, background: i === 0 ? GOLD : "#3a3a3a", transition: "width 0.4s" }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? GOLD : "#666", width: 24, textAlign: "right", flexShrink: 0 }}>{e.count}</span>
              </div>
            ))}
          </div>
        )}

        {/* History panel */}
        {showHistory && (
          <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", padding: 14, marginBottom: 18, animation: "fadeIn 0.2s ease" }}>
            <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: GOLD, marginBottom: 12, fontWeight: 700 }}>Game History</div>
            {history.length === 0 ? (
              <div style={{ color: "#333", fontSize: 10, textAlign: "center", padding: "16px 0", letterSpacing: 2 }}>No saved games yet</div>
            ) : history.map(g => {
              const isOpen = expandedGame === g.id;
              return (
                <div key={g.id} style={{ borderBottom: "1px solid #171717" }}>
                  <div onClick={() => setExpandedGame(isOpen ? null : g.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", cursor: "pointer" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: g.incomplete ? "#666" : GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{g.winner}</span>
                        {g.incomplete && <span style={{ fontSize: 7, letterSpacing: 1, color: "#444", border: "1px solid #222", padding: "1px 4px" }}>PARTIAL</span>}
                        {g.gameName && <span style={{ fontSize: 8, color: "#555", fontStyle: "italic" }}>"{g.gameName}"</span>}
                      </div>
                      <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: 1 }}>
                        {g.date} · {g.rounds} round{g.rounds !== 1 ? "s" : ""} · {g.players.map(p => p.name).join(", ")}
                      </div>
                    </div>
                    <span style={{ color: "#2a2a2a", fontSize: 10, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                    <button onClick={e => { e.stopPropagation(); deleteHistoryEntry(g.id); }} style={{ background: "none", border: "none", color: "#2a2a2a", fontSize: 15, padding: "0 4px", flexShrink: 0 }}>×</button>
                  </div>
                  {isOpen && (
                    <div style={{ paddingBottom: 10, animation: "fadeIn 0.15s ease" }}>
                      {g.players.map((p, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 10 }}>
                          <span style={{ color: "#2a2a2a", width: 14, flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ flex: 1, textTransform: "uppercase", letterSpacing: 1, color: p.out ? "#3a3a3a" : "#888", textDecoration: p.out ? "line-through" : "none" }}>{p.name}</span>
                          <span style={{ fontWeight: 700, color: !p.out && p.name === g.winner ? GOLD : p.out ? "#2a2a2a" : "#666" }}>{p.score}</span>
                          {!p.out && p.name === g.winner && <span style={{ fontSize: 9, color: GOLD }}>★</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Two-column body */}
        <div className="body">
          <div>
            {!gameOver && (
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
                  placeholder="Player name..."
                  style={{ background: DARK, border: "1px solid #2a2a2a", color: "#ccc", fontFamily: "monospace", fontSize: 12, padding: "6px 10px", outline: "none", flex: 1, minWidth: 0 }}
                />
                <Btn onClick={add} gold>+ Add</Btn>
              </div>
            )}

            {players.length === 0 && !showHistory && !showAllTime && (
              <div style={{ color: "#2a2a2a", fontSize: 10, letterSpacing: 2, textAlign: "center", padding: "20px 0", textTransform: "uppercase" }}>
                Add players to begin
              </div>
            )}

            {players.map((p, i) => {
              const lead = leader?.id === p.id;
              const sv = scores[p.id];
              const isZ = sv === 0;
              return (
                <div key={p.id} style={{ background: DARK, border: `1px solid ${p.out ? "#2a1515" : lead ? "#c9a22733" : "#1e1e1e"}`, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, marginBottom: 6, opacity: p.out ? 0.4 : 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: lead ? GOLD : "#2a2a2a", width: 18, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: p.out ? "line-through" : "none", color: p.out ? "#4a2222" : "#ccc" }}>
                    {p.name}
                  </span>
                  {p.out ? (
                    <span style={{ fontSize: 8, letterSpacing: 2, textTransform: "uppercase", color: "#5a2222", border: "1px solid #3a1515", padding: "2px 5px" }}>Out</span>
                  ) : !gameOver ? (
                    <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
                      <button onClick={() => zero(p.id)} style={{ background: isZ ? "#c9a22718" : "transparent", border: `1px solid ${isZ ? GOLD : "#2a2a2a"}`, color: isZ ? GOLD : "#555", fontFamily: "monospace", fontSize: 11, padding: "4px 8px" }}>0</button>
                      <input type="number" min="0" placeholder="pts"
                        value={isZ ? "" : sv !== undefined ? sv : ""}
                        onChange={e => setScore(p.id, e.target.value)}
                        style={{ background: "#111", border: "1px solid #2a2a2a", color: "#ccc", fontFamily: "monospace", fontSize: 12, padding: "4px 6px", width: 52, textAlign: "center", outline: "none" }}
                      />
                    </div>
                  ) : null}
                  <span style={{ fontWeight: 900, fontSize: 20, minWidth: 36, textAlign: "right", color: p.out ? "#4a2222" : lead ? GOLD : "#bbb", flexShrink: 0 }}>{p.total}</span>
                  {!gameOver && <button onClick={() => del(p.id)} style={{ background: "none", border: "none", color: "#2a2a2a", fontSize: 16, padding: "2px 6px", flexShrink: 0 }}>×</button>}
                </div>
              );
            })}

            <div className="mobile-panels">{panels}</div>
          </div>

          <div className="sidebar">{panels}</div>
        </div>
      </div>
    </div>
  );
}

function Btn({ onClick, children, gold, style = {}, ...rest }) {
  return (
    <button onClick={onClick} style={{ background: "transparent", border: `1px solid ${gold ? GOLD : "#222"}`, color: gold ? GOLD : "#555", fontFamily: "monospace", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", padding: "6px 12px", ...style }} {...rest}>
      {children}
    </button>
  );
}

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

// ── wins ──────────────────────────────────────────────────────────────────────

export async function getWins() {
  if (supabase) {
    const { data, error } = await supabase
      .from("wins")
      .select("name, count")
      .order("count", { ascending: false });
    if (!error && data) return Object.fromEntries(data.map(r => [r.name, r.count]));
  }
  try { return JSON.parse(localStorage.getItem("yosef_wins")) || {}; } catch { return {}; }
}

export async function addWin(name) {
  const n = name.trim().toLowerCase();
  if (supabase) {
    await supabase.rpc("increment_win", { player_name: n });
    return;
  }
  try {
    const w = JSON.parse(localStorage.getItem("yosef_wins")) || {};
    w[n] = (w[n] || 0) + 1;
    localStorage.setItem("yosef_wins", JSON.stringify(w));
  } catch {}
}

export async function resetWins() {
  if (supabase) {
    await supabase.from("wins").delete().neq("name", "___none___");
    return;
  }
  localStorage.removeItem("yosef_wins");
}

// ── history ───────────────────────────────────────────────────────────────────

function toRow(e) {
  return {
    id: e.id,
    date: e.date,
    game_name: e.gameName || null,
    winner: e.winner,
    rounds: e.rounds,
    incomplete: e.incomplete || false,
    players: e.players,
  };
}

function toEntry(r) {
  return {
    id: r.id,
    date: r.date,
    gameName: r.game_name,
    winner: r.winner,
    rounds: r.rounds,
    incomplete: r.incomplete,
    players: r.players,
  };
}

export async function getHistory() {
  if (supabase) {
    const { data, error } = await supabase
      .from("game_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error && data) return data.map(toEntry);
  }
  try { return JSON.parse(localStorage.getItem("yosef_history")) || []; } catch { return []; }
}

export async function addHistory(entry) {
  if (supabase) {
    await supabase.from("game_history").insert(toRow(entry));
    return;
  }
  try {
    const h = JSON.parse(localStorage.getItem("yosef_history")) || [];
    h.unshift(entry);
    localStorage.setItem("yosef_history", JSON.stringify(h.slice(0, 100)));
  } catch {}
}

export async function removeHistory(id) {
  if (supabase) {
    await supabase.from("game_history").delete().eq("id", id);
    return;
  }
  try {
    const h = (JSON.parse(localStorage.getItem("yosef_history")) || []).filter(e => e.id !== id);
    localStorage.setItem("yosef_history", JSON.stringify(h));
  } catch {}
}

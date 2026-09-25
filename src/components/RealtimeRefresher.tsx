"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Subscribes to Realtime postgres_changes on alerts and link_stats_hourly and re-renders the
 * server components (debounced) when anything changes. Data is always re-read server-side through
 * RLS, so a Realtime payload is only a "something changed" signal, never rendered directly.
 */
export function RealtimeRefresher() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 1500);
    };
    const channel = supabaseBrowser()
      .channel("dashboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "link_stats_hourly" }, refresh)
      .subscribe((s) => setStatus(s === "SUBSCRIBED" ? "live" : s.toLowerCase()));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabaseBrowser().removeChannel(channel);
    };
  }, [router]);

  return (
    <span className={`text-xs ${status === "live" ? "text-emerald-700" : "text-slate-500"}`} title="Realtime updates">
      ● {status === "live" ? "Live updates on" : `Realtime ${status}`}
    </span>
  );
}

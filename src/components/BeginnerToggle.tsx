"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBeginnerMode } from "@/actions/user";

/** Switch between the standard brief and the plain-language beginner brief. */
export function BeginnerToggle({ on }: { on: boolean }) {
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <button
        role="switch"
        aria-checked={value}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const next = !value;
            setValue(next);
            const r = await setBeginnerMode(next);
            if (!r.ok) setValue(!next);
            else router.refresh();
          })
        }
        className={`relative h-6 w-11 rounded-full transition ${value ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"} disabled:opacity-60`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${value ? "left-5" : "left-0.5"}`} />
      </button>
      Beginner mode
    </label>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";

export default function RootPage() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? "/today" : "/login");
  }, [loading, session, router]);

  return <p className="p-10 text-sm text-on-surface-variant">Loading…</p>;
}

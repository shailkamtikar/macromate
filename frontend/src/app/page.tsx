"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { Skeleton } from "@/components/Skeleton";
import { useSession } from "@/lib/useSession";

/** `/` is the public landing page for logged-out visitors. A signed-in user
 * is sent straight to their dashboard. */
export default function RootPage() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading && session) router.replace("/today");
  }, [loading, session, router]);

  if (session) {
    return (
      <main aria-busy="true" className="flex flex-1 items-center justify-center p-10">
        <Skeleton className="h-8 w-40" />
      </main>
    );
  }
  return <LandingPage />;
}

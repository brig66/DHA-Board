import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopNav from "@/components/TopNav";
import type { Profile } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/login");

  if (!profile.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card max-w-md p-8 text-center">
          <h1 className="font-display text-xl font-semibold text-ink">
            Your account is awaiting activation
          </h1>
          <p className="mt-2 text-sm text-[#5c584d]">
            {profile.full_name}, you&rsquo;re signed in, but a DHA admin needs to activate your
            account before you can see donor records. Let them know you&rsquo;ve signed up with{" "}
            <strong>{profile.email}</strong>.
          </p>
        </div>
      </main>
    );
  }

  const { count: openDuplicates } = await supabase
    .from("possible_duplicates")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  return (
    <>
      <TopNav profile={profile} openDuplicates={openDuplicates ?? 0} />
      <div className="mx-auto max-w-7xl px-4 py-8">{children}</div>
    </>
  );
}

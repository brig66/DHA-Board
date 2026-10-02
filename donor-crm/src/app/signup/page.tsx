"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const orgName = process.env.NEXT_PUBLIC_ORG_NAME || "the DHA Donor CRM";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="card w-full max-w-sm p-8 text-center">
          <h1 className="font-display text-xl font-semibold text-ink">Check your email</h1>
          <p className="mt-2 text-sm text-[#5c584d]">
            We sent a confirmation link to <strong>{email}</strong>. After confirming, sign in — a
            DHA admin will activate your account so you can see donor records.
          </p>
          <Link href="/login" className="btn btn-primary mt-6 inline-flex">
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <h1 className="font-display text-xl font-semibold text-ink">Create your account</h1>
        <p className="mt-1 text-sm text-[#5c584d]">Request access to {orgName}.</p>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="full_name">Full name</label>
            <input
              id="full_name"
              required
              className="input mt-1"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              className="input mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              minLength={8}
              required
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-coral-600">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-2 w-full">
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-[#5c584d]">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-teal-700">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

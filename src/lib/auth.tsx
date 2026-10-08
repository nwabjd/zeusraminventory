/* ===========================================================================
   Auth provider - Supabase Auth (Google) + ZEUS profile linking.
   ---------------------------------------------------------------------------
   * Not configured (no env vars) => phase "signedOut", cloud=false, app runs
     exactly as before.
   * Configured => Supabase session drives the gate. A session with no
     provisioned/active profile is blocked ("not authorized").
   * Admin-only pending counts are kept fresh via a realtime subscription.
   =========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { cloudEnabled, cloudPendingCounts, cloudSubscribeQueue, cloudWriteAudit, getCloud } from "./cloud";
import type { PendingCounts } from "./cloud";
import type { ProfileRow } from "./cloud-types";
import { isAdmin } from "./approval";

export type AuthPhase = "boot" | "signedOut" | "signedIn";

export interface AuthState {
  phase: AuthPhase;
  cloud: boolean;
  user: User | null;
  profile: ProfileRow | null;
  pendingCounts: PendingCounts;
  signingIn: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(getCloud, []);
  const [phase, setPhase] = useState<AuthPhase>(() => (supabase ? "boot" : "signedOut"));
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>({ sales: 0, purchases: 0 });

  const loggedAudit = useRef<Set<string>>(new Set());

  const loadProfile = useCallback(
    async (userId: string) => {
      const sb = getCloud();
      if (!sb) return;
      const { data, error } = await sb
        .from("profiles")
        .select("*")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (!error && data) setProfile(data as ProfileRow);
      else setProfile(null);
    },
    [],
  );

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const apply = (session: Session | null) => {
      if (!alive) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        setPhase("signedIn");
        void loadProfile(session.user.id);
        const email = session.user.email ?? "";
        if (email && !loggedAudit.current.has(email)) {
          loggedAudit.current.add(email);
          void cloudWriteAudit("LOGIN", "session", session.user.id, { email }, true);
        }
      } else {
        setPhase("signedOut");
        setProfile(null);
      }
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) =>
      apply(session),
    );
    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  /* Admin queue badge - refetch + live refresh. */
  const admin = isAdmin(profile);
  useEffect(() => {
    if (!supabase || !admin) {
      setPendingCounts({ sales: 0, purchases: 0 });
      return;
    }
    let alive = true;
    const refresh = () => {
      void cloudPendingCounts()
        .then((c) => alive && setPendingCounts(c))
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = cloudSubscribeQueue(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [supabase, admin]);

  const signInWithGoogle = useCallback(async () => {
    const sb = getCloud();
    if (!sb) return;
    setSigningIn(true);
    try {
      await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOutStable = useCallback(async () => {
    const sb = getCloud();
    const email = user?.email ?? "";
    const id = user?.id ?? null;
    if (sb) {
      await cloudWriteAudit("LOGOUT", "session", id, { email }, true);
      await sb.auth.signOut();
    }
    setUser(null);
    setProfile(null);
    setPhase("signedOut");
  }, [user]);

  const value = useMemo<AuthState>(
    () => ({
      phase,
      cloud: cloudEnabled(),
      user,
      profile,
      pendingCounts,
      signingIn,
      signInWithGoogle,
      signOut: signOutStable,
    }),
    [phase, user, profile, pendingCounts, signingIn, signInWithGoogle, signOutStable],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
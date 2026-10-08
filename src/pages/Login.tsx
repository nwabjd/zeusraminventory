import { useState } from "react";
import { LogOut, ShieldAlert, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/Controls";

/* ===========================================================================
   ZEUS sign-in.
   ---------------------------------------------------------------------------
   Google OAuth only - the app never touches a password. A Google account is
   not granted access by signing in; it must already be provisioned by an
   administrator (or be the one-time bootstrap admin).
   =========================================================================== */

function Brand() {
  return (
    <svg viewBox="0 0 32 32" className="h-12 w-12" aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" fill="#2551eb" />
      <rect x="9" y="7" width="14" height="18" rx="2.5" fill="#ffffff" opacity="0.14" />
      <rect
        x="11.5"
        y="10"
        width="9"
        height="12"
        rx="1.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.6"
      />
      <path
        d="M13 13.2h6M13 16h6M13 18.8h3.4"
        stroke="#ffffff"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 5.2l1.75 3.05L21 9.05l-2.4 2.35.57 3.3L16 13.05l-3.17 1.65.57-3.3L11 9.05l3.25-.8L16 5.2z"
        fill="#34d399"
      />
    </svg>
  );
}

function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.2 0-10-3.3-11.3-8l-6.6 5.1C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.3 5.3C41 35 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </svg>
  );
}

export function LoginScreen() {
  const { signInWithGoogle, signingIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch {
      setError("Google sign-in could not be started. Check the cloud configuration and try again.");
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Brand />
          <h1 className="mt-4 text-2xl font-bold tracking-[0.22em] text-ink">ZEUS</h1>
          <p className="mt-1 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            RAM &amp; Inventory Management
          </p>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink">Sign in to continue</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Only accounts invited by an administrator can access ZEUS.
          </p>

          <button
            type="button"
            onClick={go}
            disabled={signingIn}
            className="mt-4 flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-[var(--shadow-raised)] transition-colors hover:bg-surface disabled:cursor-wait disabled:opacity-60"
          >
            {signingIn ? (
              <span className="spin h-4 w-4 rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
            ) : (
              <GoogleG className="h-[18px] w-[18px]" />
            )}
            Continue with Google
          </button>

          {error && (
            <p role="alert" className="mt-3 rounded-lg border border-danger-500/30 bg-danger-50 p-2.5 text-xs font-medium text-danger-700">
              {error}
            </p>
          )}

          <p className="mt-4 flex items-start gap-1.5 text-2xs leading-relaxed text-faint">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-profit-600" aria-hidden />
            Passwords are never stored in ZEUS. Google handles authentication;
            ZEUS only knows who you are.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AccountBlocked({ reason }: { reason: "not-authorized" | "inactive" }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Brand />
          <h1 className="mt-4 text-2xl font-bold tracking-[0.22em] text-ink">ZEUS</h1>
        </div>
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-50 text-danger-600">
              <ShieldAlert className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-ink">Access blocked</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {reason === "not-authorized"
                  ? "Your account is not authorized to access ZEUS. Please contact your administrator."
                  : "Your ZEUS account is inactive. Please contact your administrator."}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                icon={<LogOut className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
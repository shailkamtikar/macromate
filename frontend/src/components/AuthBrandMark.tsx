import { LogoMark } from "@/components/Logo";

/** The small MacroMate mark shown above the login/signup forms: the app's
 * own ring logo and wordmark, so the auth screens read as MacroMate rather
 * than a generic auth template. */
export function AuthBrandMark() {
  return (
    <div className="flex flex-col items-center gap-2">
      <LogoMark size={48} />
      <span className="font-display text-base font-extrabold tracking-tight text-on-surface">
        MacroMate
      </span>
    </div>
  );
}

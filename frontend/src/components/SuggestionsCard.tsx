import { SuggestedFood, SuggestionsResponse } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { Icon } from "@/components/Icon";

/** "What to eat next". Loads independently of the diary (see TodayPage), so
 * it has its own loading and error states and never blocks the page. */
export function SuggestionsCard({
  data,
  loading,
  error,
  onRetry,
  onAdd,
}: {
  data: SuggestionsResponse | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onAdd: (food: SuggestedFood) => void;
}) {
  const header = (
    <div className="mb-1 flex items-center gap-1.5 text-primary">
      <Icon name={"psychology"} className="text-lg" />
      <span className="text-xs font-bold uppercase tracking-wider">What to eat next</span>
    </div>
  );

  if (!data && loading) {
    return (
      <section
        data-testid="suggestions-skeleton"
        aria-busy="true"
        className="rounded-[var(--radius-card)] border border-primary/25 bg-surface-container-lowest p-5 shadow-sm"
      >
        {header}
        <Skeleton className="mb-3 mt-2 h-4 w-3/4" />
        <Skeleton className="mb-2 h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </section>
    );
  }

  if (!data && error) {
    return (
      <section
        data-testid="suggestions-error"
        className="card p-5"
      >
        {header}
        <p className="text-sm text-on-surface-variant">
          Couldn&apos;t load suggestions.{" "}
          <button onClick={onRetry} className="font-semibold text-primary underline">
            Retry
          </button>
        </p>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section
      data-testid="suggestions-card"
      className="rounded-[var(--radius-card)] border border-primary/25 bg-surface-container-lowest p-5 shadow-sm"
    >
      {header}
      <p className="mb-1 text-xs text-on-surface-variant">
        Based on what&apos;s left today: {data.remaining_calories} kcal
        {data.protein_is_priority
          ? ` · ${data.remaining_protein_g}g protein still needed`
          : " · protein goal on track"}
      </p>
      <p data-testid="suggestions-message" className="mb-3 text-sm text-on-surface-variant">
        {data.message}
      </p>
      {data.suggestions.length > 0 && (
        <div className="space-y-2">
          {data.suggestions.map((food) => (
            <div
              key={food.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface-container-low p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-on-surface">{food.name}</p>
                <p className="text-xs text-on-surface-variant">
                  {Math.round(food.calories)} kcal · P {Math.round(food.protein_g)}g
                </p>
              </div>
              <button
                onClick={() => onAdd(food)}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary"
                aria-label={`Add ${food.name}`}
              >
                +
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

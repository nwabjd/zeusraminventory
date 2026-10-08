import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { ALL_RAM_SPEEDS, RAM_SPEEDS_BY_GENERATION } from "./constants";
import type { Generation, NamedValue, RamSpeed } from "./types";

/* ===========================================================================
   Reference data
   ---------------------------------------------------------------------------
   The backend keeps user-defined RAM speeds, categories, manufacturers and
   locations. Forms need those lists, and the factory defaults have to keep
   working even before anything is stored, so both sources are merged here and
   fetched once per mount instead of on every keystroke.
   =========================================================================== */

export interface ReferenceData {
  /** All master-data rows keyed by kind: `categories`, `manufacturers`, ... */
  named: Record<string, NamedValue[]>;
  speeds: RamSpeed[];
  /** Distinct values actually used by the catalogue, e.g. `["DDR4", "DDR5"]`. */
  usedGenerations: string[];
  usedCategories: string[];
  usedCapacities: string[];
  usedSpeeds: string[];
  usedManufacturers: string[];
  usedLocations: string[];
  usedConditions: string[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Master-data kinds fetched from the backend. Cities, ranks and RAM
 * types are deliberately absent: they are static frontend constants
 * (`lib/constants.ts`), not database-backed lists, so requesting them
 * here would only produce "Unknown master list" errors.
 */
const NAMED_KINDS = [
  "categories",
  "manufacturers",
  "locations",
  "conditions",
];

export function useReferenceData(): ReferenceData {
  const [named, setNamed] = useState<Record<string, NamedValue[]>>({});
  const [speeds, setSpeeds] = useState<RamSpeed[]>([]);
  const [facets, setFacets] = useState<[string, string[]][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [kindLists, speedList, facetList] = await Promise.all([
        Promise.all(NAMED_KINDS.map((k) => api.listNamedValues(k))),
        api.listSpeeds(),
        api.ramFacets(),
      ]);
      const map: Record<string, NamedValue[]> = {};
      NAMED_KINDS.forEach((k, i) => {
        map[k] = kindLists[i];
      });
      setNamed(map);
      setSpeeds(speedList);
      setFacets(facetList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const facetMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    facets.forEach(([k, v]) => {
      map[k] = v;
    });
    return map;
  }, [facets]);

  return {
    named,
    speeds,
    usedGenerations: facetMap.generation ?? [],
    usedCategories: facetMap.category ?? [],
    usedCapacities: facetMap.capacity ?? [],
    usedSpeeds: facetMap.speed ?? [],
    usedManufacturers: facetMap.manufacturer ?? [],
    usedLocations: facetMap.location ?? [],
    usedConditions: facetMap.condition ?? [],
    loading,
    error,
    reload,
  };
}

/** Named master data merged with any values actually present in the catalogue. */
export function mergeValues(
  named: NamedValue[] = [],
  used: string[],
  builtIn: string[] = [],
): string[] {
  return Array.from(
    new Set([...builtIn, ...used, ...(named || []).map((n) => n.name)]),
  ).sort((a, b) => a.localeCompare(b));
}

/** Speed labels offered for a generation filter. An empty or "all" filter
    folds every generation together; unknown generations offer nothing. */
function approvedSpeedLabels(generation: string): string[] {
  if (!generation || generation === "all") return ALL_RAM_SPEEDS;
  return RAM_SPEEDS_BY_GENERATION[generation as Generation] ?? [];
}

/**
 * Speeds a filter may offer for a generation - never anything but the ZEUS RAM
 * speed matrix. `used` catalogue values are folded in only when they name a
 * matrix label, so historical values outside it (never archived now that the
 * matrix covers the full JEDEC baseline) stay out of every dropdown. Labels
 * are returned in their exact matrix spelling.
 */
export function speedsFor(
  speeds: RamSpeed[],
  generation: string,
  used: string[] = [],
): string[] {
  const byLabel = new Map(
    approvedSpeedLabels(generation).map((label) => [label.toUpperCase(), label]),
  );
  const picked = new Set<string>();
  const consider = (value: string) => {
    const canonical = byLabel.get(value.trim().toUpperCase());
    if (canonical) picked.add(canonical);
  };
  speeds.forEach((s) => {
    if (!generation || generation === "all" || s.generation === generation) {
      consider(s.speed);
    }
  });
  used.forEach(consider);
  return Array.from(picked).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Speed options for a *form*, strictly from the ZEUS RAM speed matrix. Only
 * the DDR generation limits the list - category, capacity, manufacturer and
 * form factor never hide a valid speed (they are independent specs). `current`
 * keeps an existing selection visible even when it is not part of the matrix -
 * the one case a legacy item is edited; the label is the item's stored value,
 * never an offering to new entries.
 */
export function speedOptionsFor(
  speeds: RamSpeed[],
  generation: string,
  _category: string,
  current = "",
): string[] {
  const byLabel = new Map(
    approvedSpeedLabels(generation).map((label) => [label.toUpperCase(), label]),
  );
  const forGen = speeds.filter(
    (s) =>
      s.generation === generation &&
      byLabel.has(s.speed.trim().toUpperCase()),
  );
  const options = Array.from(
    new Set(forGen.map((s) => byLabel.get(s.speed.trim().toUpperCase())!)),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (current && !options.includes(current)) {
    options.push(current);
  }
  return options;
}

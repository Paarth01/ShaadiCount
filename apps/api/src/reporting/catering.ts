export interface CateringInputs {
  confirmedAdults: number;
  confirmedChildren: number;
  maybeAdults: number;
  maybeChildren: number;
  pendingPeople: number; // sum of invited party sizes with no response (upper bound, treated as adults)
}
export interface CateringSettings {
  maybeWeightPercent: number;
  pendingWeightPercent: number;
  bufferPercent: number;
  mealRounding: number;
  adultPricePaise: number | null;
  childPricePaise: number | null;
}
export interface CateringEstimate {
  adultMeals: number;
  childMeals: number;
  estimatedMeals: number;
  estimatedCostPaise: number | null;
  breakdown: { confirmed: number; tentativeWeighted: number; pendingWeighted: number; bufferAdded: number; roundingAdded: number };
}

// Guard against float noise (e.g. 10 * 1.1 = 11.000000000000002) before rounding up.
const ceil = (x: number) => Math.ceil(Math.round(x * 1e6) / 1e6);

/**
 * Planning arithmetic only (not a guarantee of attendance or a catering order):
 *   raw      = confirmed + maybe x maybeWeight% + not-yet-responded x pendingWeight%
 *   meals    = ceil(raw x (1 + buffer%)), then total rounded up to the nearest `mealRounding` (extras billed as adult meals)
 * Pending people have no adult/child split, so they are treated as adults (conservative for cost).
 */
export function calculateCatering(i: CateringInputs, s: CateringSettings): CateringEstimate {
  const mw = s.maybeWeightPercent / 100;
  const pw = s.pendingWeightPercent / 100;
  const adultsRaw = i.confirmedAdults + i.maybeAdults * mw + i.pendingPeople * pw;
  const childrenRaw = i.confirmedChildren + i.maybeChildren * mw;
  const factor = 1 + s.bufferPercent / 100;
  let adultMeals = ceil(adultsRaw * factor);
  const childMeals = ceil(childrenRaw * factor);
  const base = adultMeals + childMeals;
  const total = s.mealRounding > 1 ? Math.ceil(base / s.mealRounding) * s.mealRounding : base;
  const roundingAdded = total - base;
  adultMeals += roundingAdded;

  const priceKnown = (n: number, p: number | null) => n === 0 || p !== null;
  const cost =
    priceKnown(adultMeals, s.adultPricePaise) && priceKnown(childMeals, s.childPricePaise)
      ? adultMeals * (s.adultPricePaise ?? 0) + childMeals * (s.childPricePaise ?? 0)
      : null;

  const confirmed = i.confirmedAdults + i.confirmedChildren;
  const tentativeWeighted = (i.maybeAdults + i.maybeChildren) * mw;
  const pendingWeighted = i.pendingPeople * pw;
  const raw = adultsRaw + childrenRaw;
  return {
    adultMeals,
    childMeals,
    estimatedMeals: total,
    estimatedCostPaise: cost,
    breakdown: {
      confirmed,
      tentativeWeighted: round2(tentativeWeighted),
      pendingWeighted: round2(pendingWeighted),
      bufferAdded: round2(raw * (factor - 1)),
      roundingAdded,
    },
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;
